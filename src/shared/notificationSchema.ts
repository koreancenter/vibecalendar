import { CalendarEventItem, NotificationEnginePreferences } from '../types';
import { addDays } from './dateUtils';
import { expandRecurringEventsForRange } from './recurrenceUtils';
import {
  detectBrowserTimeZone,
  formatClockInTimeZone,
  getTimeZoneOffsetMinutes,
  isValidTimeZone,
  projectEventToViewerTimeZone,
  resolveEventTimeZone,
} from './timeZoneUtils';

export const IDB_NOTIFICATION_DB_NAME = 'vibe_notification_engine_db_v1';
export const IDB_NOTIFICATION_DB_VERSION = 1;

export const IDB_STORE_SCHEDULED_ALERTS = 'scheduled_alerts';
export const IDB_STORE_FIRED_LEDGER = 'fired_ledger';
export const IDB_STORE_OFFLINE_OUTBOX = 'offline_sync_outbox';
export const IDB_STORE_SW_ACTION_INBOX = 'sw_action_inbox';

export const NOTIFICATION_BROADCAST_CHANNEL = 'vibe_notification_engine_bus_v1';

export const BG_SYNC_TAG_EXTERNAL = 'vibe-calendar-bg-sync';
export const BG_SYNC_TAG_REMINDERS = 'vibe-reminder-reconcile';
export const PERIODIC_SYNC_TAG = 'vibe-calendar-periodic-sync';

export const MAX_CUSTOM_LEAD_MINUTES = 10_080; // 최대 7일(10,080분) 전
export const MAX_LEAD_TIMES_PER_ITEM = 5;
export const SCHEDULE_HORIZON_DAYS = 14;
export const MAX_SCHEDULED_ALERTS = 120;

export interface LeadTimePresetOption {
  minutes: number;
  label: string;
  shortLabel: string;
}

export const LEAD_TIME_PRESET_OPTIONS: LeadTimePresetOption[] = [
  { minutes: 0, label: '정각 (시작 시각)', shortLabel: '정각' },
  { minutes: 5, label: '5분 전', shortLabel: '5분 전' },
  { minutes: 10, label: '10분 전', shortLabel: '10분 전' },
  { minutes: 15, label: '15분 전', shortLabel: '15분 전' },
  { minutes: 30, label: '30분 전', shortLabel: '30분 전' },
  { minutes: 60, label: '1시간 전', shortLabel: '1시간 전' },
  { minutes: 120, label: '2시간 전', shortLabel: '2시간 전' },
  { minutes: 1440, label: '하루 전 (24시간)', shortLabel: '1일 전' },
];

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationEnginePreferences = {
  enabled: false,
  defaultLeadMinutes: [10],
  allDayNotifyHour: 9,
  webPushEnabled: false,
  backgroundSyncEnabled: true,
  privacyMaskWhenEncrypted: true,
};

export interface ScheduledAlertRecord {
  triggerId: string;
  eventId: string;
  masterEventId: string;
  eventDate: string; // YYYY-MM-DD (현지 표시 기준 날짜)
  localStartTime: string; // HH:mm
  leadMinutes: number;
  triggerAtMs: number;
  eventStartEpochMs: number;
  notificationTitle: string;
  notificationBody: string;
  isAllDay: boolean;
  isMasked: boolean;
  isSnoozed?: boolean;
  clientId: string;
  updatedAtMs: number;
}

export interface OpaqueServerWakeSlot {
  triggerId: string;
  triggerAtMs: number;
  leadMinutes: number;
}

export interface OfflineSyncTaskRecord {
  taskId: string;
  reason: string;
  accountId?: string;
  queuedAtMs: number;
}

export interface SwActionInboxRecord {
  actionId: string;
  actionType: 'COMPLETE_EVENT' | 'PENDING_EXTERNAL_SYNC';
  eventId?: string;
  eventDate?: string;
  createdAtMs: number;
}

export type NotificationBusMessage =
  | { type: 'ALERT_FIRED'; triggerId: string; firedAtMs: number }
  | { type: 'SW_SNOOZED_ALERT'; triggerId: string; snoozedUntilMs: number }
  | { type: 'SW_COMPLETE_EVENT'; eventId: string; eventDate?: string }
  | { type: 'SW_FOCUS_EVENT'; eventId: string; eventDate?: string }
  | { type: 'SW_EXECUTE_BACKGROUND_SYNC'; reason?: string }
  | { type: 'PREFS_UPDATED'; updatedAtMs: number };

export function normalizeLeadMinutesList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<number>();
  for (const val of raw) {
    const num = typeof val === 'number' ? val : Number(val);
    if (Number.isFinite(num) && num >= 0 && num <= MAX_CUSTOM_LEAD_MINUTES) {
      unique.add(Math.round(num));
    }
  }
  return Array.from(unique)
    .sort((a, b) => a - b)
    .slice(0, MAX_LEAD_TIMES_PER_ITEM);
}

export function formatLeadMinutesLabel(minutes: number, compact = false): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe === 0) return compact ? '정각' : '정각 (시작 시각)';
  if (safe < 60) return `${safe}분 전`;
  if (safe % 1440 === 0) {
    const days = safe / 1440;
    return days === 1 && !compact ? '하루 전 (24시간)' : `${days}일 전`;
  }
  if (safe % 60 === 0) {
    return `${safe / 60}시간 전`;
  }
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return compact ? `${hours}시간 ${mins}분 전` : `${hours}시간 ${mins}분 전`;
}

export function summarizeLeadMinutesList(leads: number[]): string {
  const normalized = normalizeLeadMinutesList(leads);
  if (normalized.length === 0) return '알림 없음';
  return normalized.map((m) => formatLeadMinutesLabel(m, true)).join(' · ');
}

/**
 * 지정된 IANA 타임존의 벽시계 일시(YYYY-MM-DD + HH:mm)를
 * DST 전환 경계까지 보정한 정확한 UTC Epoch Milliseconds로 변환합니다.
 */
export function resolveZonedWallClockEpochMs(
  dateStr: string,
  timeStr: string,
  ianaTimeZone: string
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hhRaw, mmRaw] = (timeStr || '09:00').split(':').map(Number);
  const hh = Number.isFinite(hhRaw) ? Math.min(23, Math.max(0, hhRaw)) : 9;
  const mm = Number.isFinite(mmRaw) ? Math.min(59, Math.max(0, mmRaw)) : 0;

  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;

  const safeZone = isValidTimeZone(ianaTimeZone) ? ianaTimeZone : detectBrowserTimeZone();
  const wallAsUtcMs = Date.UTC(y, m - 1, d, hh, mm, 0, 0);

  // 1차 오프셋 추산 후 DST 경계 정밀 보정(2-pass)
  const firstOffsetMins = getTimeZoneOffsetMinutes(safeZone, new Date(wallAsUtcMs));
  const firstPassEpoch = wallAsUtcMs - firstOffsetMins * 60_000;
  const refinedOffsetMins = getTimeZoneOffsetMinutes(safeZone, new Date(firstPassEpoch));
  return wallAsUtcMs - refinedOffsetMins * 60_000;
}

export interface ComputeAlertScheduleOptions {
  events: CalendarEventItem[];
  viewerTimeZone: string;
  prefs: NotificationEnginePreferences;
  isVaultEncrypted: boolean;
  clientId: string;
  nowMs?: number;
}

/**
 * 향후 14일간의 반복 회차 및 시차 투영 일정을 모두 전개하여
 * 정확한 트리거 시각(triggerAtMs) 기준 알림 스케줄 레코드를 생성합니다.
 */
export function computeUpcomingAlertSchedule({
  events,
  viewerTimeZone,
  prefs,
  isVaultEncrypted,
  clientId,
  nowMs = Date.now(),
}: ComputeAlertScheduleOptions): ScheduledAlertRecord[] {
  if (!prefs.enabled) return [];

  const safeViewerZone = isValidTimeZone(viewerTimeZone) ? viewerTimeZone : detectBrowserTimeZone();
  const nowClock = formatClockInTimeZone(new Date(nowMs), safeViewerZone);
  const viewerTodayStr = nowClock.dateShort.replace(/\./g, '-');
  const rangeStart = addDays(viewerTodayStr, -1);
  const rangeEnd = addDays(viewerTodayStr, SCHEDULE_HORIZON_DAYS);

  const expanded = expandRecurringEventsForRange(events, rangeStart, rangeEnd, 90);
  const windowMinMs = nowMs - 90_000; // 직전 90초 이내 도달 알림까지 즉시 캐치업 허용
  const windowMaxMs = nowMs + SCHEDULE_HORIZON_DAYS * 86_400_000;
  const defaultLeads = normalizeLeadMinutesList(prefs.defaultLeadMinutes);
  const shouldPrivacyMask = Boolean(isVaultEncrypted && prefs.privacyMaskWhenEncrypted);

  const records: ScheduledAlertRecord[] = [];
  const seenTriggerIds = new Set<string>();

  for (const ev of expanded) {
    if (ev.isCompleted) continue;

    const masterEventId = ev.recurrenceMasterId || ev.id;
    const isEventMasked = shouldPrivacyMask || Boolean(ev.externalSync?.isMasked);

    if (ev.isAllDay) {
      // 종일 일정: 개별 알림이 명시적으로 []이면 스킵
      if (Array.isArray(ev.reminderMinutes) && ev.reminderMinutes.length === 0) {
        continue;
      }

      const notifyHour =
        prefs.allDayNotifyHour !== null &&
        prefs.allDayNotifyHour >= 0 &&
        prefs.allDayNotifyHour <= 23
          ? prefs.allDayNotifyHour
          : Array.isArray(ev.reminderMinutes) && ev.reminderMinutes.length > 0
          ? 9
          : null;

      if (notifyHour === null) continue;

      const anchorTimeStr = `${String(notifyHour).padStart(2, '0')}:00`;
      const anchorEpochMs = resolveZonedWallClockEpochMs(ev.date, anchorTimeStr, safeViewerZone);
      if (anchorEpochMs === null) continue;

      const effectiveLeads =
        Array.isArray(ev.reminderMinutes) && ev.reminderMinutes.length > 0
          ? normalizeLeadMinutesList(ev.reminderMinutes)
          : [0];

      for (const leadMin of effectiveLeads) {
        const triggerAtMs = anchorEpochMs - leadMin * 60_000;
        if (triggerAtMs < windowMinMs || triggerAtMs > windowMaxMs) continue;

        const triggerId = `alrt:${ev.id}:${ev.date}:allday:${notifyHour}:${leadMin}`;
        if (seenTriggerIds.has(triggerId)) continue;
        seenTriggerIds.add(triggerId);

        const notificationTitle = isEventMasked
          ? '바이브 행사 · 예정된 종일 일정'
          : leadMin === 0
          ? '바이브 행사 · 오늘 종일 일정 브리핑'
          : `바이브 행사 · 종일 일정 (${formatLeadMinutesLabel(leadMin, true)})`;

        const locSuffix = !isEventMasked && ev.location ? ` · ${ev.location}` : '';
        const notificationBody = isEventMasked
          ? `${ev.date} 종일 일정이 예정되어 있습니다. 앱을 열어 확인해 주세요.`
          : `${ev.title} (${ev.date} 종일${locSuffix})`;

        records.push({
          triggerId,
          eventId: ev.id,
          masterEventId,
          eventDate: ev.date,
          localStartTime: anchorTimeStr,
          leadMinutes: leadMin,
          triggerAtMs,
          eventStartEpochMs: anchorEpochMs,
          notificationTitle,
          notificationBody,
          isAllDay: true,
          isMasked: isEventMasked,
          clientId,
          updatedAtMs: nowMs,
        });
      }
      continue;
    }

    // 시간 지정 일정: 개별 reminderMinutes가 []이면 알림 끔, 배열이면 커스텀 리드타임, undefined이면 전역 기본 리드타임
    let effectiveLeads: number[];
    if (Array.isArray(ev.reminderMinutes)) {
      if (ev.reminderMinutes.length === 0) continue;
      effectiveLeads = normalizeLeadMinutesList(ev.reminderMinutes);
    } else {
      effectiveLeads = defaultLeads;
    }

    if (effectiveLeads.length === 0) continue;

    const sourceZone = resolveEventTimeZone(ev, safeViewerZone);
    const eventStartEpochMs = resolveZonedWallClockEpochMs(ev.date, ev.startTime, sourceZone);
    if (eventStartEpochMs === null) continue;

    const timing = projectEventToViewerTimeZone(ev, safeViewerZone);
    const zoneTag = !timing.isSameZone ? ` · ${ev.startTime} ${timing.sourceMeta.shortCode}` : '';
    const locSuffix = !isEventMasked && ev.location ? ` · ${ev.location}` : '';

    for (const leadMin of effectiveLeads) {
      const triggerAtMs = eventStartEpochMs - leadMin * 60_000;
      if (triggerAtMs < windowMinMs || triggerAtMs > windowMaxMs) continue;

      const triggerId = `alrt:${ev.id}:${timing.localDate}:${timing.localStartTime}:${leadMin}`;
      if (seenTriggerIds.has(triggerId)) continue;
      seenTriggerIds.add(triggerId);

      const leadPhrase =
        leadMin === 0 ? '지금 시작' : `${formatLeadMinutesLabel(leadMin, true).replace(' 전', '')} 후 시작`;

      const notificationTitle = isEventMasked
        ? `바이브 행사 · ${leadPhrase}`
        : `바이브 행사 · ${leadPhrase}`;

      const notificationBody = isEventMasked
        ? `${timing.localStartTime} 예정된 보안 볼트 일정이 시작됩니다.`
        : `${ev.title} (${timing.localStartTime}${zoneTag}${locSuffix})`;

      records.push({
        triggerId,
        eventId: ev.id,
        masterEventId,
        eventDate: timing.localDate,
        localStartTime: timing.localStartTime,
        leadMinutes: leadMin,
        triggerAtMs,
        eventStartEpochMs,
        notificationTitle,
        notificationBody,
        isAllDay: false,
        isMasked: isEventMasked,
        clientId,
        updatedAtMs: nowMs,
      });
    }
  }

  records.sort((a, b) => a.triggerAtMs - b.triggerAtMs);
  return records.slice(0, MAX_SCHEDULED_ALERTS);
}
