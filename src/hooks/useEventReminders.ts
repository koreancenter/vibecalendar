import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarEventItem } from '../types';
import { timeToMinutes } from '../shared/scheduleUtils';
import {
  formatClockInTimeZone,
  projectEventToViewerTimeZone,
} from '../shared/timeZoneUtils';

export type ReminderLeadMinutes = 0 | 10 | 15 | 30;

const STORAGE_REMINDER_LEAD_KEY = 'vibe_event_reminder_lead_v1';
const SESSION_NOTIFIED_SET_KEY = 'vibe_event_notified_keys_v1';

function readStoredLead(): ReminderLeadMinutes {
  if (typeof window === 'undefined') return 0;
  try {
    const val = Number(window.localStorage.getItem(STORAGE_REMINDER_LEAD_KEY) || '0');
    if (val === 10 || val === 15 || val === 30) return val;
  } catch {
    // ignore
  }
  return 0;
}

function readSessionNotified(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(SESSION_NOTIFIED_SET_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x) => typeof x === 'string'));
  } catch {
    // ignore
  }
  return new Set();
}

function persistSessionNotified(keys: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = Array.from(keys).slice(-200);
    window.sessionStorage.setItem(SESSION_NOTIFIED_SET_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

interface UseEventRemindersParams {
  events: CalendarEventItem[];
  viewerTimeZone: string;
  enabled?: boolean;
  onInAppReminder?: (message: string, event: CalendarEventItem) => void;
}

/**
 * 사용자가 명시적으로 활성화(10분/15분/30분 전)한 경우에만 동작하는
 * 로컬 브라우저 임박 일정 알림 훅 (무단 팝업 없음)
 */
export function useEventReminders({
  events,
  viewerTimeZone,
  enabled = true,
  onInAppReminder,
}: UseEventRemindersParams) {
  const [reminderLeadMinutes, setReminderLeadState] = useState<ReminderLeadMinutes>(() =>
    readStoredLead()
  );
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return 'unsupported';
    }
    return Notification.permission;
  });

  const notifiedKeysRef = useRef<Set<string>>(readSessionNotified());
  const onInAppReminderRef = useRef(onInAppReminder);
  onInAppReminderRef.current = onInAppReminder;

  const setReminderLeadMinutes = useCallback(async (lead: ReminderLeadMinutes) => {
    setReminderLeadState(lead);
    try {
      if (lead === 0) {
        window.localStorage.removeItem(STORAGE_REMINDER_LEAD_KEY);
      } else {
        window.localStorage.setItem(STORAGE_REMINDER_LEAD_KEY, String(lead));
      }
    } catch {
      // ignore
    }

    if (lead > 0 && typeof window !== 'undefined' && typeof Notification !== 'undefined') {
      if (Notification.permission === 'default') {
        try {
          const perm = await Notification.requestPermission();
          setNotificationPermission(perm);
        } catch {
          // ignore permission errors in restricted iframes
        }
      } else {
        setNotificationPermission(Notification.permission);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled || reminderLeadMinutes === 0) return;

    const checkUpcomingEvents = () => {
      const now = new Date();
      const clock = formatClockInTimeZone(now, viewerTimeZone);
      const viewerToday = clock.dateShort.replace(/\./g, '-');
      const nowMinutes = clock.hour24 * 60 + clock.minute;

      for (const ev of events) {
        if (ev.isAllDay || ev.isCompleted) continue;
        const timing = projectEventToViewerTimeZone(ev, viewerTimeZone);
        if (timing.localDate !== viewerToday) continue;

        const startMin = timeToMinutes(timing.localStartTime);
        const diff = startMin - nowMinutes;
        if (diff > 0 && diff <= reminderLeadMinutes) {
          const dedupeKey = `${ev.id}@${timing.localDate}@${timing.localStartTime}@${reminderLeadMinutes}`;
          if (notifiedKeysRef.current.has(dedupeKey)) continue;

          notifiedKeysRef.current.add(dedupeKey);
          persistSessionNotified(notifiedKeysRef.current);

          const locationSuffix = ev.location ? ` · ${ev.location}` : '';
          const message = `${diff}분 후 일정 시작: ${ev.title} (${timing.localStartTime}${locationSuffix})`;

          onInAppReminderRef.current?.(message, ev);

          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              new Notification(`바이브 행사 · ${diff}분 후 시작`, {
                body: `${ev.title} (${timing.localStartTime}${locationSuffix})`,
                icon: '/pwa-192x192.png',
                tag: dedupeKey,
              });
            } catch {
              // Ignore Notification constructor restrictions in embedded contexts
            }
          }
        }
      }
    };

    checkUpcomingEvents();
    const timer = setInterval(checkUpcomingEvents, 20000);
    return () => clearInterval(timer);
  }, [enabled, reminderLeadMinutes, events, viewerTimeZone]);

  return {
    reminderLeadMinutes,
    notificationPermission,
    setReminderLeadMinutes,
  };
}
