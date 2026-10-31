import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  detectBrowserTimeZone,
  formatClockInTimeZone,
  formatHourDiffShort,
  getTimeZoneMeta,
  isValidTimeZone,
} from '../shared/timeZoneUtils';

const STORAGE_PRIMARY_TZ_OVERRIDE = 'vibe_primary_tz_override_v1';
const STORAGE_SECONDARY_TZ = 'vibe_secondary_tz_v1';

function readStoredZone(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw && isValidTimeZone(raw)) return raw;
  } catch {
    // Ignore storage read errors
  }
  return null;
}

/**
 * 사용자 기기/브라우저의 현재 위치 시간대를 기본 자동 감지하고,
 * 선택적 보조 시간대(Dual Timezone) 및 수동 기준 시간대 전환을 지원하는 훅
 */
export function useTimeZonePreferences() {
  const [manualPrimaryZone, setManualPrimaryZoneState] = useState<string | null>(() =>
    readStoredZone(STORAGE_PRIMARY_TZ_OVERRIDE)
  );
  const [systemTimeZone, setSystemTimeZone] = useState<string>(() => detectBrowserTimeZone());
  const [secondaryTimeZone, setSecondaryTimeZoneState] = useState<string | null>(() =>
    readStoredZone(STORAGE_SECONDARY_TZ)
  );
  const [now, setNow] = useState<Date>(() => new Date());

  const viewerTimeZone = manualPrimaryZone || systemTimeZone;

  // 출장·이동 후 탭 복귀 시 시스템 타임존 변경 자동 반영
  useEffect(() => {
    const syncSystemZone = () => {
      const detected = detectBrowserTimeZone();
      setSystemTimeZone((prev) => (prev === detected ? prev : detected));
      setNow(new Date());
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncSystemZone();
      }
    };

    window.addEventListener('focus', syncSystemZone);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', syncSystemZone);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // 분 단위 정각에 맞춘 저부하 실시간 클록 동기화
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000 + 80;

    const timeoutId = setTimeout(() => {
      setNow(new Date());
      intervalId = setInterval(() => {
        setNow(new Date());
      }, 15000);
    }, msUntilNextMinute);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const setManualViewerTimeZone = useCallback((tz: string | null) => {
    const valid = tz && isValidTimeZone(tz) ? tz : null;
    setManualPrimaryZoneState(valid);
    try {
      if (valid) {
        window.localStorage.setItem(STORAGE_PRIMARY_TZ_OVERRIDE, valid);
      } else {
        window.localStorage.removeItem(STORAGE_PRIMARY_TZ_OVERRIDE);
      }
    } catch {
      // Ignore storage write errors
    }
  }, []);

  const resetViewerTimeZoneToSystem = useCallback(() => {
    setManualViewerTimeZone(null);
    setSystemTimeZone(detectBrowserTimeZone());
  }, [setManualViewerTimeZone]);

  const setSecondaryTimeZone = useCallback((tz: string | null) => {
    const valid = tz && isValidTimeZone(tz) ? tz : null;
    setSecondaryTimeZoneState(valid);
    try {
      if (valid) {
        window.localStorage.setItem(STORAGE_SECONDARY_TZ, valid);
      } else {
        window.localStorage.removeItem(STORAGE_SECONDARY_TZ);
      }
    } catch {
      // Ignore storage write errors
    }
  }, []);

  const swapPrimaryAndSecondary = useCallback(() => {
    if (!secondaryTimeZone || secondaryTimeZone === viewerTimeZone) return;
    const prevPrimary = viewerTimeZone;
    const prevSecondary = secondaryTimeZone;
    setManualViewerTimeZone(prevSecondary);
    setSecondaryTimeZone(prevPrimary);
  }, [secondaryTimeZone, viewerTimeZone, setManualViewerTimeZone, setSecondaryTimeZone]);

  const effectiveSecondaryTimeZone =
    secondaryTimeZone && secondaryTimeZone !== viewerTimeZone ? secondaryTimeZone : null;

  const viewerMeta = useMemo(() => getTimeZoneMeta(viewerTimeZone), [viewerTimeZone]);
  const viewerClock = useMemo(
    () => formatClockInTimeZone(now, viewerTimeZone),
    [now, viewerTimeZone]
  );

  const secondaryMeta = useMemo(
    () => (effectiveSecondaryTimeZone ? getTimeZoneMeta(effectiveSecondaryTimeZone) : null),
    [effectiveSecondaryTimeZone]
  );
  const secondaryClock = useMemo(
    () =>
      effectiveSecondaryTimeZone ? formatClockInTimeZone(now, effectiveSecondaryTimeZone) : null,
    [now, effectiveSecondaryTimeZone]
  );
  const secondaryDiffLabel = useMemo(
    () =>
      effectiveSecondaryTimeZone
        ? formatHourDiffShort(viewerTimeZone, effectiveSecondaryTimeZone, now)
        : '',
    [viewerTimeZone, effectiveSecondaryTimeZone, now]
  );

  return {
    now,
    systemTimeZone,
    viewerTimeZone,
    isManualPrimary: Boolean(manualPrimaryZone),
    viewerMeta,
    viewerClock,
    secondaryTimeZone: effectiveSecondaryTimeZone,
    secondaryMeta,
    secondaryClock,
    secondaryDiffLabel,
    setManualViewerTimeZone,
    resetViewerTimeZoneToSystem,
    setSecondaryTimeZone,
    swapPrimaryAndSecondary,
  };
}
