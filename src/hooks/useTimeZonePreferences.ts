import { useState, useEffect, useMemo } from 'react';
import {
  detectBrowserTimeZone,
  formatClockInTimeZone,
  getTimeZoneMeta,
} from '../shared/timeZoneUtils';

/**
 * 사용자 기기/브라우저의 현재 위치 시간대를 무설정(Zero-UI)으로 자동 감지하고
 * 분 단위 저부하 실시간 시계를 유지하는 훅
 */
export function useTimeZonePreferences() {
  const [viewerTimeZone, setViewerTimeZone] = useState<string>(() => detectBrowserTimeZone());
  const [now, setNow] = useState<Date>(() => new Date());

  // 출장·이동 후 탭 복귀 시 시스템 타임존 변경 자동 반영
  useEffect(() => {
    const syncSystemZone = () => {
      const detected = detectBrowserTimeZone();
      setViewerTimeZone((prev) => (prev === detected ? prev : detected));
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

  const viewerMeta = useMemo(() => getTimeZoneMeta(viewerTimeZone), [viewerTimeZone]);

  const viewerClock = useMemo(
    () => formatClockInTimeZone(now, viewerTimeZone),
    [now, viewerTimeZone]
  );

  return {
    now,
    viewerTimeZone,
    viewerMeta,
    viewerClock,
  };
}
