import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  INITIAL_CALENDAR_EVENTS,
  LEGACY_REAL_NAME_EVENT_IDS,
} from '../data/sampleEvents';
import {
  CalendarEventItem,
  CalendarCategory,
  ChecklistItem,
  AgentCommandResponse,
  RecommendedVenue,
  GroundedDateSuggestion,
  RecurrenceRule,
} from '../types';
import {
  addDays,
  getDayDistance,
  getEventDateSpan,
  getTodayDateString,
  parseLocalDate,
} from '../shared/dateUtils';
import { normalizeCoordinates, normalizePlaceAndAddress } from '../shared/locationUtils';
import {
  expandRecurringEventsForRange,
  normalizeRecurrenceRule,
  parseOccurrenceIdentity,
  RECURRENCE_OCCURRENCE_SEP,
  resolveMasterEventId,
} from '../shared/recurrenceUtils';
import {
  convertLocalSlotToEventZone,
  detectBrowserTimeZone,
  getTimeZoneMeta,
  inferTimeZoneFromLocation,
  isValidTimeZone,
  projectEventToViewerTimeZone,
  resolveEventTimeZone,
} from '../shared/timeZoneUtils';
import { computeSmartScheduleRebalance } from '../shared/autoScheduler';
import { areShallowArraysEqual } from './useCalendarEventViewModels';

export interface VaultEventsSyncConfig {
  isEncrypted: boolean;
  initialEvents: CalendarEventItem[];
  onEncryptedEventsChange: (events: CalendarEventItem[]) => void;
}

export interface UseCalendarEventsOptions {
  showToast: (msg: string, onUndo?: () => void) => void;
  selectedProjectId?: string | 'all';
  selectedProjectIds?: string[];
  viewerTimeZone?: string;
  vaultEventsConfig?: VaultEventsSyncConfig;
}

export interface ManualEventDraft {
  title: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  timeZone?: string;
  isAllDay: boolean;
  category: CalendarCategory;
  projectId?: string;
  location?: string;
  locationAddress?: string;
  locationLat?: number;
  locationLng?: number;
  content?: string;
  checklist?: ChecklistItem[];
  recurrence?: RecurrenceRule;
}

const STORAGE_KEY_EVENTS = 'ai_smart_calendar_events_v4';
const LEGACY_STORAGE_KEY_EVENTS_V3 = 'ai_smart_calendar_events_v3';

function normalizeStoredEventList(raw: unknown): CalendarEventItem[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter(
      (item): item is CalendarEventItem =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        !item.id.includes(RECURRENCE_OCCURRENCE_SEP) &&
        !LEGACY_REAL_NAME_EVENT_IDS.has(item.id) &&
        typeof item.title === 'string' &&
        typeof item.date === 'string' &&
        typeof item.startTime === 'string' &&
        typeof item.endTime === 'string'
    )
    .map((ev) => {
      const { location, locationAddress } = normalizePlaceAndAddress(
        ev.location,
        ev.locationAddress
      );
      const { locationLat, locationLng } = normalizeCoordinates(ev.locationLat, ev.locationLng);
      const excludedDates = Array.isArray(ev.excludedDates)
        ? ev.excludedDates.filter(
            (d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
          )
        : undefined;
      const completedDates = Array.isArray(ev.completedDates)
        ? ev.completedDates.filter(
            (d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
          )
        : undefined;
      const cleaned: CalendarEventItem = {
        ...ev,
        location,
        locationAddress,
        locationLat,
        locationLng,
        recurrence: normalizeRecurrenceRule(ev.recurrence),
        excludedDates: excludedDates && excludedDates.length > 0 ? excludedDates : undefined,
        completedDates: completedDates && completedDates.length > 0 ? completedDates : undefined,
      };
      delete cleaned.recurrenceMasterId;
      delete cleaned.occurrenceDate;
      return cleaned;
    });
}

export function useCalendarEvents({
  showToast,
  selectedProjectId = 'all',
  selectedProjectIds,
  viewerTimeZone,
  vaultEventsConfig,
}: UseCalendarEventsOptions) {
  const effectiveViewerZone = useMemo(
    () =>
      viewerTimeZone && isValidTimeZone(viewerTimeZone)
        ? viewerTimeZone
        : detectBrowserTimeZone(),
    [viewerTimeZone]
  );

  const [events, setEvents] = useState<CalendarEventItem[]>(() => {
    if (vaultEventsConfig?.isEncrypted) {
      return normalizeStoredEventList(vaultEventsConfig.initialEvents) ?? INITIAL_CALENDAR_EVENTS;
    }
    try {
      const savedV4 = localStorage.getItem(STORAGE_KEY_EVENTS);
      if (savedV4 !== null) {
        const normalized = normalizeStoredEventList(JSON.parse(savedV4));
        if (normalized !== null) return normalized;
      }
      const savedLegacyV3 = localStorage.getItem(LEGACY_STORAGE_KEY_EVENTS_V3);
      if (savedLegacyV3 !== null) {
        localStorage.removeItem(LEGACY_STORAGE_KEY_EVENTS_V3);
        const migrated = normalizeStoredEventList(JSON.parse(savedLegacyV3));
        if (migrated !== null) return migrated;
      }
    } catch {
      // ignore corrupted storage
    }
    return INITIAL_CALENDAR_EVENTS;
  });

  useEffect(() => {
    if (vaultEventsConfig?.isEncrypted) {
      vaultEventsConfig.onEncryptedEventsChange(events);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(events));
    } catch (e) {
      console.warn('이벤트 저장 실패:', e);
    }
  }, [events, vaultEventsConfig]);

  const initialTodayStr = useMemo(() => getTodayDateString(), []);
  const [currentYear, setCurrentYear] = useState<number>(() => {
    const y = parseInt(initialTodayStr.split('-')[0], 10);
    return Number.isFinite(y) ? y : new Date().getFullYear();
  });
  const [currentMonth, setCurrentMonth] = useState<number>(() => {
    const m = parseInt(initialTodayStr.split('-')[1], 10) - 1;
    return Number.isFinite(m) && m >= 0 && m <= 11 ? m : new Date().getMonth();
  });
  const [selectedDate, setSelectedDate] = useState<string>(() => initialTodayStr);
  const [selectedCategory, setSelectedCategory] = useState<CalendarCategory | '전체'>('전체');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventItem | null>(null);

  const activeSelectedIds = useMemo(() => {
    if (selectedProjectIds) return selectedProjectIds;
    return selectedProjectId !== 'all' ? [selectedProjectId] : [];
  }, [selectedProjectId, selectedProjectIds]);

  const primaryProjectId = activeSelectedIds.length >= 1 ? activeSelectedIds[0] : undefined;

  const prevFilteredEventsRef = useRef<CalendarEventItem[]>([]);
  const filteredEvents = useMemo(() => {
    if (selectedCategory === '전체' && activeSelectedIds.length === 0) {
      prevFilteredEventsRef.current = events;
      return events;
    }
    const selectedSet = new Set(activeSelectedIds);
    const next = events.filter((e) => {
      const matchCat = selectedCategory === '전체' || e.category === selectedCategory;
      const matchProj =
        selectedSet.size === 0 || (Boolean(e.projectId) && selectedSet.has(e.projectId!));
      return matchCat && matchProj;
    });
    if (areShallowArraysEqual(prevFilteredEventsRef.current, next)) {
      return prevFilteredEventsRef.current;
    }
    prevFilteredEventsRef.current = next;
    return next;
  }, [events, selectedCategory, activeSelectedIds]);

  const prevSelectedDateEventsRef = useRef<CalendarEventItem[]>([]);
  const selectedDateEvents = useMemo(() => {
    const expandedForDay = expandRecurringEventsForRange(
      filteredEvents,
      selectedDate,
      selectedDate
    );
    const matched: Array<{ event: CalendarEventItem; localStartTime: string }> = [];
    for (const e of expandedForDay) {
      const timing = projectEventToViewerTimeZone(e, effectiveViewerZone);
      const spannedDates = getEventDateSpan(timing.localDate, e.endDate);
      if (spannedDates.includes(selectedDate)) {
        matched.push({ event: e, localStartTime: timing.localStartTime });
      }
    }
    matched.sort((a, b) => {
      if (a.event.isAllDay && !b.event.isAllDay) return -1;
      if (!a.event.isAllDay && b.event.isAllDay) return 1;
      return a.localStartTime.localeCompare(b.localStartTime);
    });
    const next = matched.map((item) => item.event);
    if (areShallowArraysEqual(prevSelectedDateEventsRef.current, next)) {
      return prevSelectedDateEventsRef.current;
    }
    prevSelectedDateEventsRef.current = next;
    return next;
  }, [filteredEvents, selectedDate, effectiveViewerZone]);

  useEffect(() => {
    return () => {
      prevFilteredEventsRef.current = [];
      prevSelectedDateEventsRef.current = [];
    };
  }, []);

  const handlePrevMonth = useCallback(() => {
    setCurrentMonth((prevMonth) => {
      if (prevMonth === 0) {
        setCurrentYear((y) => y - 1);
        return 11;
      }
      return prevMonth - 1;
    });
  }, []);

  const handleNextMonth = useCallback(() => {
    setCurrentMonth((prevMonth) => {
      if (prevMonth === 11) {
        setCurrentYear((y) => y + 1);
        return 0;
      }
      return prevMonth + 1;
    });
  }, []);

  const handleToday = useCallback(() => {
    const todayStr = getTodayDateString();
    const [y, m] = todayStr.split('-').map(Number);
    setCurrentYear(y);
    setCurrentMonth(m - 1);
    setSelectedDate(todayStr);
    showToast(`오늘 날짜(${todayStr})로 이동했습니다.`);
  }, [showToast]);

  const jumpToDate = useCallback((dateStr: string) => {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      if (!Number.isNaN(y) && !Number.isNaN(m)) {
        setCurrentYear(y);
        setCurrentMonth(m);
      }
    }
    setSelectedDate(dateStr);
  }, []);

  const handleMoveEventDate = useCallback(
    (eventId: string, targetDate: string, targetStartTime?: string, targetEndTime?: string) => {
      const { masterId, occurrenceDate } = parseOccurrenceIdentity(eventId);
      const master = events.find((e) => e.id === masterId);
      if (!master) return;

      // 반복 일정 회차를 드래그 이동하면 해당 회차만 개별 일정으로 자동 분리(Detach)
      if (master.recurrence) {
        const occStartDate = occurrenceDate || master.date;
        const spanOffsetDays =
          master.endDate && master.endDate > master.date
            ? Math.min(30, getDayDistance(master.date, master.endDate))
            : 0;
        const occEndDate = spanOffsetDays > 0 ? addDays(occStartDate, spanOffsetDays) : undefined;
        const occInstance: CalendarEventItem = {
          ...master,
          date: occStartDate,
          endDate: occEndDate,
        };

        const oldTiming = projectEventToViewerTimeZone(occInstance, effectiveViewerZone);
        const sourceZone = resolveEventTimeZone(occInstance, effectiveViewerZone);

        let nextDate = targetDate;
        let nextStartTime = occInstance.startTime;
        let nextEndTime = occInstance.endTime;

        if (occInstance.isAllDay) {
          nextDate = targetDate;
        } else if (targetStartTime && targetEndTime) {
          const converted = convertLocalSlotToEventZone(
            targetDate,
            targetStartTime,
            targetEndTime,
            effectiveViewerZone,
            sourceZone
          );
          nextDate = converted.date;
          nextStartTime = converted.startTime;
          nextEndTime = converted.endTime;
        } else {
          const oldLocalDt = parseLocalDate(oldTiming.localDate);
          const newLocalDt = parseLocalDate(targetDate);
          const dayDelta = Math.round(
            (newLocalDt.getTime() - oldLocalDt.getTime()) / 86_400_000
          );
          nextDate = dayDelta !== 0 ? addDays(occInstance.date, dayDelta) : occInstance.date;
        }

        if (
          occInstance.date === nextDate &&
          occInstance.startTime === nextStartTime &&
          occInstance.endTime === nextEndTime
        ) {
          return;
        }

        const prevMasterSnapshot: CalendarEventItem = { ...master };
        const nextExcluded = Array.from(new Set([...(master.excludedDates || []), occStartDate]));
        const wasCompleted = (master.completedDates || []).includes(occStartDate);
        const detachedEvent: CalendarEventItem = {
          ...master,
          id: `detached-evt-${Date.now()}`,
          date: nextDate,
          endDate: spanOffsetDays > 0 ? addDays(nextDate, spanOffsetDays) : undefined,
          startTime: nextStartTime,
          endTime: nextEndTime,
          isCompleted: wasCompleted,
          recurrence: undefined,
          excludedDates: undefined,
          completedDates: undefined,
          recurrenceMasterId: undefined,
          occurrenceDate: undefined,
        };

        setEvents((prev) => [
          detachedEvent,
          ...prev.map((e) =>
            e.id === masterId ? { ...e, excludedDates: nextExcluded } : e
          ),
        ]);
        setSelectedEvent((prev) =>
          prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
            ? detachedEvent
            : prev
        );
        jumpToDate(targetDate);

        showToast(
          `'${master.title}'의 ${occStartDate} 회차가 ${nextDate} 개별 일정으로 분리 이동되었습니다.`,
          () => {
            setEvents((curr) =>
              curr
                .filter((e) => e.id !== detachedEvent.id)
                .map((e) => (e.id === masterId ? prevMasterSnapshot : e))
            );
            setSelectedEvent((curr) => (curr?.id === detachedEvent.id ? null : curr));
            jumpToDate(oldTiming.localDate);
          }
        );
        return;
      }

      const target = master;
      const oldDate = target.date;
      const oldStartTime = target.startTime;
      const oldEndTime = target.endTime;
      const oldTiming = projectEventToViewerTimeZone(target, effectiveViewerZone);
      const sourceZone = resolveEventTimeZone(target, effectiveViewerZone);

      let nextDate = targetDate;
      let nextStartTime = target.startTime;
      let nextEndTime = target.endTime;

      if (target.isAllDay) {
        nextDate = targetDate;
      } else if (targetStartTime && targetEndTime) {
        const converted = convertLocalSlotToEventZone(
          targetDate,
          targetStartTime,
          targetEndTime,
          effectiveViewerZone,
          sourceZone
        );
        nextDate = converted.date;
        nextStartTime = converted.startTime;
        nextEndTime = converted.endTime;
      } else {
        const oldLocalDt = parseLocalDate(oldTiming.localDate);
        const newLocalDt = parseLocalDate(targetDate);
        const dayDelta = Math.round(
          (newLocalDt.getTime() - oldLocalDt.getTime()) / 86_400_000
        );
        nextDate = dayDelta !== 0 ? addDays(target.date, dayDelta) : target.date;
      }

      if (
        target.date === nextDate &&
        target.startTime === nextStartTime &&
        target.endTime === nextEndTime
      ) {
        return;
      }

      setEvents((prev) =>
        prev.map((e) =>
          e.id === target.id
            ? { ...e, date: nextDate, startTime: nextStartTime, endTime: nextEndTime }
            : e
        )
      );
      setSelectedEvent((prev) =>
        prev && prev.id === target.id
          ? { ...prev, date: nextDate, startTime: nextStartTime, endTime: nextEndTime }
          : prev
      );
      jumpToDate(targetDate);

      const zoneSuffix =
        !target.isAllDay && sourceZone !== effectiveViewerZone
          ? ` ${getTimeZoneMeta(sourceZone).shortCode}`
          : '';
      const msg =
        oldStartTime !== nextStartTime || oldEndTime !== nextEndTime
          ? `'${target.title}' 일정이 ${nextDate} ${nextStartTime}~${nextEndTime}${zoneSuffix}로 이동되었습니다.`
          : `'${target.title}' 일정이 ${targetDate}로 이동되었습니다.`;

      showToast(msg, () => {
        setEvents((prev) =>
          prev.map((e) =>
            e.id === target.id
              ? { ...e, date: oldDate, startTime: oldStartTime, endTime: oldEndTime }
              : e
          )
        );
        setSelectedEvent((prev) =>
          prev && prev.id === target.id
            ? { ...prev, date: oldDate, startTime: oldStartTime, endTime: oldEndTime }
            : prev
        );
        jumpToDate(oldTiming.localDate);
      });
    },
    [events, effectiveViewerZone, jumpToDate, showToast]
  );

  const handleDeleteEvent = useCallback(
    (eventId: string, scope: 'single' | 'all' = 'all') => {
      const { masterId, occurrenceDate } = parseOccurrenceIdentity(eventId);
      const target = events.find((e) => e.id === masterId);
      if (!target) return;

      if (scope === 'single' && target.recurrence) {
        const occDate =
          occurrenceDate ||
          (selectedEvent && resolveMasterEventId(selectedEvent.id) === masterId
            ? selectedEvent.occurrenceDate || selectedEvent.date
            : null) ||
          target.date;

        const prevSnapshot: CalendarEventItem = { ...target };
        const nextExcluded = Array.from(new Set([...(target.excludedDates || []), occDate]));

        setEvents((prev) =>
          prev.map((e) => (e.id === masterId ? { ...e, excludedDates: nextExcluded } : e))
        );
        setSelectedEvent((prev) =>
          prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
            ? null
            : prev
        );

        showToast(`'${target.title}'의 ${occDate} 회차가 제외되었습니다.`, () => {
          setEvents((current) =>
            current.map((e) => (e.id === masterId ? prevSnapshot : e))
          );
        });
        return;
      }

      setEvents((prev) => prev.filter((e) => e.id !== masterId));
      setSelectedEvent((prev) =>
        prev && resolveMasterEventId(prev.id) === masterId ? null : prev
      );

      showToast(
        `'${target.title}'${target.recurrence ? ' 전체 반복 일정이' : ' 일정이'} 삭제되었습니다.`,
        () => {
          setEvents((current) => [target, ...current]);
        }
      );
    },
    [events, selectedEvent, showToast]
  );

  const handleToggleComplete = useCallback(
    (eventId: string) => {
      const { masterId, occurrenceDate } = parseOccurrenceIdentity(eventId);
      const master = events.find((e) => e.id === masterId);
      if (!master) return;

      if (master.recurrence) {
        const occDate =
          occurrenceDate ||
          (selectedEvent && resolveMasterEventId(selectedEvent.id) === masterId
            ? selectedEvent.occurrenceDate || selectedEvent.date
            : null) ||
          master.date;

        const completedSet = new Set(
          master.completedDates || (master.isCompleted ? [master.date] : [])
        );
        const nextCompleted = !completedSet.has(occDate);
        if (nextCompleted) {
          completedSet.add(occDate);
        } else {
          completedSet.delete(occDate);
        }
        const nextCompletedDates = Array.from(completedSet);

        setEvents((prev) =>
          prev.map((e) =>
            e.id === masterId
              ? {
                  ...e,
                  isCompleted: occDate === e.date ? nextCompleted : e.isCompleted,
                  completedDates:
                    nextCompletedDates.length > 0 ? nextCompletedDates : undefined,
                }
              : e
          )
        );
        setSelectedEvent((prev) => {
          if (!prev) return prev;
          const prevMasterId = resolveMasterEventId(prev.id);
          const prevOccDate = prev.occurrenceDate || prev.date;
          if (prev.id === eventId || (prevMasterId === masterId && prevOccDate === occDate)) {
            return {
              ...prev,
              isCompleted: nextCompleted,
              completedDates:
                nextCompletedDates.length > 0 ? nextCompletedDates : undefined,
            };
          }
          return prev;
        });
        return;
      }

      setEvents((prev) =>
        prev.map((e) => (e.id === masterId ? { ...e, isCompleted: !e.isCompleted } : e))
      );
      setSelectedEvent((prev) =>
        prev && resolveMasterEventId(prev.id) === masterId
          ? { ...prev, isCompleted: !prev.isCompleted }
          : prev
      );
    },
    [events, selectedEvent]
  );

  const handleToggleChecklistItem = useCallback((eventId: string, itemId: string) => {
    const masterId = resolveMasterEventId(eventId);
    const updateChecklist = (e: CalendarEventItem): CalendarEventItem => {
      const updatedChecklist = (e.checklist || []).map((chk) =>
        chk.id === itemId ? { ...chk, done: !chk.done } : chk
      );
      return { ...e, checklist: updatedChecklist };
    };

    setEvents((prev) => prev.map((e) => (e.id === masterId ? updateChecklist(e) : e)));
    setSelectedEvent((prev) =>
      prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
        ? updateChecklist(prev)
        : prev
    );
  }, []);

  const handleAddChecklistItem = useCallback((eventId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const masterId = resolveMasterEventId(eventId);
    const newItem: ChecklistItem = {
      id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: trimmed,
      done: false,
    };
    const appendChecklist = (e: CalendarEventItem): CalendarEventItem => ({
      ...e,
      checklist: [...(e.checklist || []), newItem],
    });
    setEvents((prev) => prev.map((e) => (e.id === masterId ? appendChecklist(e) : e)));
    setSelectedEvent((prev) =>
      prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
        ? appendChecklist(prev)
        : prev
    );
  }, []);

  const handleUpdateChecklistItemText = useCallback(
    (eventId: string, itemId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const masterId = resolveMasterEventId(eventId);
      const editChecklist = (e: CalendarEventItem): CalendarEventItem => ({
        ...e,
        checklist: (e.checklist || []).map((chk) =>
          chk.id === itemId ? { ...chk, text: trimmed } : chk
        ),
      });
      setEvents((prev) => prev.map((e) => (e.id === masterId ? editChecklist(e) : e)));
      setSelectedEvent((prev) =>
        prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
          ? editChecklist(prev)
          : prev
      );
    },
    []
  );

  const handleDeleteChecklistItem = useCallback((eventId: string, itemId: string) => {
    const masterId = resolveMasterEventId(eventId);
    const removeChecklist = (e: CalendarEventItem): CalendarEventItem => {
      const next = (e.checklist || []).filter((chk) => chk.id !== itemId);
      return { ...e, checklist: next.length > 0 ? next : undefined };
    };
    setEvents((prev) => prev.map((e) => (e.id === masterId ? removeChecklist(e) : e)));
    setSelectedEvent((prev) =>
      prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
        ? removeChecklist(prev)
        : prev
    );
  }, []);

  const handleApplyAgentResponse = useCallback(
    (res: AgentCommandResponse) => {
      let newlyCreated: CalendarEventItem[] = [];
      const prevEventsSnapshot = events;

      if (res.actionType === 'QUERY_EVENTS') {
        if (res.targetDate) {
          jumpToDate(res.targetDate);
        }
        showToast(`${res.targetDate || selectedDate} 스케줄 브리핑을 불러왔습니다.`);
        return [];
      }

      const updatePatches =
        res.updatedEvents && res.updatedEvents.length > 0
          ? res.updatedEvents
          : res.updatedEvent?.id
          ? [res.updatedEvent]
          : [];

      const deleteIdsRaw =
        res.deletedEventIds && res.deletedEventIds.length > 0
          ? res.deletedEventIds
          : res.deletedEventId
          ? [res.deletedEventId]
          : [];
      const deleteMasterSet = new Set(deleteIdsRaw.map((id) => resolveMasterEventId(id)));

      if (res.createdEvents && res.createdEvents.length > 0) {
        const withProj = res.createdEvents.map((ev) => {
          const { location, locationAddress } = normalizePlaceAndAddress(
            ev.location,
            ev.locationAddress
          );
          const { locationLat, locationLng } = normalizeCoordinates(
            ev.locationLat,
            ev.locationLng
          );
          return {
            ...ev,
            location,
            locationAddress,
            locationLat,
            locationLng,
            recurrence: normalizeRecurrenceRule(ev.recurrence),
            projectId: ev.projectId || primaryProjectId,
          };
        });
        newlyCreated = withProj;
        setEvents((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const toAdd = withProj.filter((e) => !existingIds.has(e.id));
          return [...toAdd, ...prev];
        });
        setSelectedEvent(withProj[0]);
        const firstLocalDate = projectEventToViewerTimeZone(
          withProj[0],
          effectiveViewerZone
        ).localDate;
        jumpToDate(firstLocalDate);
      }

      if (updatePatches.length > 0) {
        const patchMap = new Map<string, Partial<CalendarEventItem>>();
        for (const u of updatePatches) {
          if (!u.id) continue;
          const targetMasterId = resolveMasterEventId(u.id);
          const normalizedUpdates: Partial<CalendarEventItem> = { ...u.updates };
          if ('location' in normalizedUpdates || 'locationAddress' in normalizedUpdates) {
            const { location, locationAddress } = normalizePlaceAndAddress(
              normalizedUpdates.location,
              normalizedUpdates.locationAddress
            );
            normalizedUpdates.location = location;
            normalizedUpdates.locationAddress = locationAddress;
          }
          if ('locationLat' in normalizedUpdates || 'locationLng' in normalizedUpdates) {
            const { locationLat, locationLng } = normalizeCoordinates(
              normalizedUpdates.locationLat,
              normalizedUpdates.locationLng
            );
            normalizedUpdates.locationLat = locationLat;
            normalizedUpdates.locationLng = locationLng;
          }
          if ('recurrence' in normalizedUpdates) {
            normalizedUpdates.recurrence = normalizeRecurrenceRule(normalizedUpdates.recurrence);
          }
          patchMap.set(targetMasterId, {
            ...(patchMap.get(targetMasterId) || {}),
            ...normalizedUpdates,
          });
        }

        if (patchMap.size > 0) {
          setEvents((prev) =>
            prev.map((e) => {
              const patch = patchMap.get(e.id);
              return patch ? { ...e, ...patch } : e;
            })
          );
          setSelectedEvent((prev) => {
            if (!prev) return prev;
            const patch = patchMap.get(resolveMasterEventId(prev.id));
            return patch ? { ...prev, ...patch } : prev;
          });
        }
      }

      if (deleteMasterSet.size > 0) {
        setEvents((prev) => prev.filter((e) => !deleteMasterSet.has(e.id)));
        setSelectedEvent((prev) =>
          prev && deleteMasterSet.has(resolveMasterEventId(prev.id)) ? null : prev
        );
      }

      if (!newlyCreated.length && res.targetDate) {
        jumpToDate(res.targetDate);
      }

      const didMutate =
        newlyCreated.length > 0 || updatePatches.length > 0 || deleteMasterSet.size > 0;

      showToast(
        res.replyText || 'AI 요청이 반영되었습니다.',
        didMutate
          ? () => {
              setEvents(prevEventsSnapshot);
              setSelectedEvent(null);
            }
          : undefined
      );
      return newlyCreated;
    },
    [effectiveViewerZone, events, jumpToDate, primaryProjectId, selectedDate, showToast]
  );

  const handleCreateEventFromVenue = useCallback(
    (venue: RecommendedVenue, defaultDate?: string) => {
      const targetDate = venue.targetDate || defaultDate || selectedDate;
      const { location: cleanLoc, locationAddress: cleanAddr } = normalizePlaceAndAddress(
        venue.name,
        venue.address
      );
      const exactVenueName = cleanLoc || venue.name.trim();
      const inferredTz =
        inferTimeZoneFromLocation(`${exactVenueName} ${cleanAddr || ''}`) || undefined;

      const newEvent: CalendarEventItem = {
        id: `venue-evt-${Date.now()}`,
        title: exactVenueName,
        date: targetDate,
        startTime: '12:00',
        endTime: '13:30',
        timeZone: inferredTz,
        isAllDay: false,
        category: '식사·모임',
        projectId: primaryProjectId,
        location: exactVenueName,
        locationAddress: cleanAddr,
        ...normalizeCoordinates(venue.lat, venue.lng),
        content: `${venue.reason}\n\n- 수용인원: ${venue.capacityInfo}\n- 가격대: ${venue.priceRange || '정보 없음'}\n- 대표메뉴: ${venue.recommendedDishes || '없음'}\n- 연락처: ${venue.contact || '없음'}`,
        isCompleted: false,
        checklist: [
          {
            id: `vchk-${Date.now()}-1`,
            text: `${exactVenueName} 예약 확인 (${venue.capacityInfo})`,
            done: false,
          },
          { id: `vchk-${Date.now()}-2`, text: '참석자 인원 재확인', done: false },
        ],
      };

      setEvents((prev) => [newEvent, ...prev]);
      setSelectedEvent(newEvent);

      const localJumpDate = projectEventToViewerTimeZone(newEvent, effectiveViewerZone).localDate;
      jumpToDate(localJumpDate);
      showToast(`'${exactVenueName}' 일정이 ${localJumpDate} 캘린더에 등록되었습니다.`);
      return newEvent;
    },
    [effectiveViewerZone, jumpToDate, primaryProjectId, selectedDate, showToast]
  );

  const handleCreateEventFromGroundedSuggestion = useCallback(
    (suggestion: GroundedDateSuggestion) => {
      const isHoliday = suggestion.kind === 'holiday';
      const isIndustry = suggestion.kind === 'industry_event';
      const { location: cleanLoc, locationAddress: cleanAddr } = normalizePlaceAndAddress(
        suggestion.location,
        suggestion.locationAddress
      );
      const inferredTz =
        inferTimeZoneFromLocation(cleanLoc) ||
        inferTimeZoneFromLocation(cleanAddr) ||
        inferTimeZoneFromLocation(suggestion.title) ||
        undefined;

      const newEvent: CalendarEventItem = {
        id: `grounded-evt-${Date.now()}`,
        title: suggestion.title,
        date: suggestion.date,
        endDate: suggestion.endDate,
        startTime: isHoliday || isIndustry ? '09:00' : '10:00',
        endTime: isHoliday || isIndustry ? '18:00' : '12:00',
        timeZone: !isHoliday && !isIndustry ? inferredTz : undefined,
        isAllDay: isHoliday || isIndustry,
        category: isHoliday ? '기타' : '행사·세미나',
        projectId: !isHoliday ? primaryProjectId : undefined,
        location: cleanLoc,
        locationAddress: cleanAddr,
        ...normalizeCoordinates(suggestion.locationLat, suggestion.locationLng),
        content: suggestion.description,
        isCompleted: false,
        checklist:
          suggestion.kind === 'recommended_date'
            ? [
                {
                  id: `gchk-${Date.now()}-1`,
                  text: '행사장 대관 및 주요 참석자 일정 확정',
                  done: false,
                },
                {
                  id: `gchk-${Date.now()}-2`,
                  text: '초청장 발송 및 세부 진행 식순 점검',
                  done: false,
                },
              ]
            : undefined,
      };

      setEvents((prev) => [newEvent, ...prev]);
      setSelectedEvent(newEvent);
      jumpToDate(suggestion.date);

      showToast(
        `'${suggestion.title}' 일정이 ${suggestion.date} 캘린더에 반영되었습니다.`,
        () => {
          setEvents((curr) => curr.filter((e) => e.id !== newEvent.id));
        }
      );

      return newEvent;
    },
    [jumpToDate, primaryProjectId, showToast]
  );

  const handleUpdateTimeSlot = useCallback(
    (eventId: string, localStartTime: string, localEndTime: string) => {
      const masterId = resolveMasterEventId(eventId);
      const target = events.find((e) => e.id === masterId);
      if (!target) return;

      const timing = projectEventToViewerTimeZone(target, effectiveViewerZone);
      const converted = convertLocalSlotToEventZone(
        timing.localDate,
        localStartTime,
        localEndTime,
        effectiveViewerZone,
        timing.sourceTimeZone
      );

      setEvents((prev) =>
        prev.map((e) =>
          e.id === masterId
            ? {
                ...e,
                date: converted.date,
                startTime: converted.startTime,
                endTime: converted.endTime,
              }
            : e
        )
      );
      setSelectedEvent((prev) =>
        prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
          ? {
              ...prev,
              date: prev.recurrenceMasterId ? prev.date : converted.date,
              startTime: converted.startTime,
              endTime: converted.endTime,
            }
          : prev
      );
      const codeSuffix = !timing.isSameZone ? ` ${timing.sourceMeta.shortCode}` : '';
      showToast(
        `일정 시간이 ${converted.startTime} ~ ${converted.endTime}${codeSuffix}로 변경되었습니다.`
      );
    },
    [events, effectiveViewerZone, showToast]
  );

  const handleUpdateEventTimeZone = useCallback(
    (eventId: string, nextTimeZone: string | undefined) => {
      const masterId = resolveMasterEventId(eventId);
      const validTz = nextTimeZone && isValidTimeZone(nextTimeZone) ? nextTimeZone : undefined;
      setEvents((prev) =>
        prev.map((e) => (e.id === masterId ? { ...e, timeZone: validTz } : e))
      );
      setSelectedEvent((prev) =>
        prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
          ? { ...prev, timeZone: validTz }
          : prev
      );

      const meta = getTimeZoneMeta(validTz || effectiveViewerZone);
      showToast(`일정 기준 시간대가 ${meta.shortCode} (${meta.cityKo})로 설정되었습니다.`);
    },
    [effectiveViewerZone, showToast]
  );

  const handleUpdateEventProject = useCallback(
    (eventId: string, projectId: string | undefined) => {
      const masterId = resolveMasterEventId(eventId);
      setEvents((prev) =>
        prev.map((e) => (e.id === masterId ? { ...e, projectId } : e))
      );
      setSelectedEvent((prev) =>
        prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
          ? { ...prev, projectId }
          : prev
      );
      showToast('일정의 소속 프로젝트가 업데이트되었습니다.');
    },
    [showToast]
  );

  const handleUpdateEventLocation = useCallback(
    (
      eventId: string,
      rawLocation?: string,
      rawAddress?: string,
      rawLat?: number,
      rawLng?: number
    ) => {
      const masterId = resolveMasterEventId(eventId);
      const { location, locationAddress } = normalizePlaceAndAddress(rawLocation, rawAddress);
      const { locationLat, locationLng } =
        location || locationAddress || (rawLat !== undefined && rawLng !== undefined)
          ? normalizeCoordinates(rawLat, rawLng)
          : {};
      setEvents((prev) =>
        prev.map((e) =>
          e.id === masterId
            ? { ...e, location, locationAddress, locationLat, locationLng }
            : e
        )
      );
      setSelectedEvent((prev) =>
        prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
          ? { ...prev, location, locationAddress, locationLat, locationLng }
          : prev
      );
      showToast(
        location || locationAddress || (locationLat !== undefined && locationLng !== undefined)
          ? '일정 장소 · 상세 주소 · 위경도 정보가 업데이트되었습니다.'
          : '일정 장소 정보가 비워졌습니다.'
      );
    },
    [showToast]
  );

  const handleCreateManualEvent = useCallback(
    (draft: ManualEventDraft): CalendarEventItem => {
      const cleanTitle = draft.title.trim() || '새 일정';
      const { location, locationAddress } = normalizePlaceAndAddress(
        draft.location,
        draft.locationAddress
      );
      const { locationLat, locationLng } =
        location ||
        locationAddress ||
        (draft.locationLat !== undefined && draft.locationLng !== undefined)
          ? normalizeCoordinates(draft.locationLat, draft.locationLng)
          : {};

      const validEndDate =
        draft.endDate && /^\d{4}-\d{2}-\d{2}$/.test(draft.endDate) && draft.endDate > draft.date
          ? draft.endDate
          : undefined;

      const validTz =
        !draft.isAllDay && draft.timeZone && isValidTimeZone(draft.timeZone)
          ? draft.timeZone
          : !draft.isAllDay
          ? inferTimeZoneFromLocation(location) ||
            inferTimeZoneFromLocation(locationAddress) ||
            undefined
          : undefined;

      const cleanedChecklist =
        draft.checklist && draft.checklist.length > 0
          ? draft.checklist
              .map((c, idx) => ({
                id: c.id || `mchk-${Date.now()}-${idx}`,
                text: c.text.trim(),
                done: Boolean(c.done),
              }))
              .filter((c) => c.text.length > 0)
          : undefined;

      const newEvent: CalendarEventItem = {
        id: `manual-evt-${Date.now()}`,
        title: cleanTitle,
        date: draft.date,
        endDate: validEndDate,
        startTime: draft.startTime || '10:00',
        endTime: draft.endTime || '11:00',
        timeZone: validTz,
        isAllDay: Boolean(draft.isAllDay),
        category: draft.category || '업무',
        projectId: draft.projectId || undefined,
        location,
        locationAddress,
        locationLat,
        locationLng,
        content: draft.content?.trim() ? draft.content.trim() : undefined,
        isCompleted: false,
        checklist: cleanedChecklist && cleanedChecklist.length > 0 ? cleanedChecklist : undefined,
        recurrence: normalizeRecurrenceRule(draft.recurrence),
      };

      setEvents((prev) => [newEvent, ...prev]);
      setSelectedEvent(newEvent);

      const localJumpDate = projectEventToViewerTimeZone(newEvent, effectiveViewerZone).localDate;
      jumpToDate(localJumpDate);

      showToast(`'${cleanTitle}' 일정이 등록되었습니다.`, () => {
        setEvents((curr) => curr.filter((e) => e.id !== newEvent.id));
        setSelectedEvent((curr) => (curr?.id === newEvent.id ? null : curr));
      });

      return newEvent;
    },
    [effectiveViewerZone, jumpToDate, showToast]
  );

  const handleUpdateEventFields = useCallback(
    (eventId: string, updates: Partial<CalendarEventItem>, toastLabel?: string) => {
      const { masterId, occurrenceDate, isVirtualOccurrence } = parseOccurrenceIdentity(eventId);
      const target = events.find((e) => e.id === masterId);
      if (!target) return;

      const snapshot: CalendarEventItem = { ...target };
      const sanitizedUpdates: Partial<CalendarEventItem> = { ...updates };

      // 가상 회차에서 제목·시간·반복주기만 편집할 때 마스터 시작일(target.date)이 덮어써지지 않도록 보존
      if (isVirtualOccurrence && sanitizedUpdates.date === occurrenceDate) {
        delete sanitizedUpdates.date;
      }

      const merged: CalendarEventItem = { ...target, ...sanitizedUpdates };

      if (merged.title !== undefined) {
        merged.title = merged.title.trim() || target.title;
      }

      if ('endDate' in sanitizedUpdates) {
        merged.endDate =
          sanitizedUpdates.endDate &&
          /^\d{4}-\d{2}-\d{2}$/.test(sanitizedUpdates.endDate) &&
          sanitizedUpdates.endDate > merged.date
            ? sanitizedUpdates.endDate
            : undefined;
      } else if (merged.endDate && merged.endDate <= merged.date) {
        merged.endDate = undefined;
      }

      if (merged.isAllDay) {
        merged.timeZone = undefined;
      } else if ('timeZone' in sanitizedUpdates) {
        merged.timeZone =
          sanitizedUpdates.timeZone && isValidTimeZone(sanitizedUpdates.timeZone)
            ? sanitizedUpdates.timeZone
            : undefined;
      }

      if ('content' in sanitizedUpdates) {
        merged.content = sanitizedUpdates.content?.trim()
          ? sanitizedUpdates.content.trim()
          : undefined;
      }

      if ('location' in sanitizedUpdates || 'locationAddress' in sanitizedUpdates) {
        const normLoc = normalizePlaceAndAddress(merged.location, merged.locationAddress);
        merged.location = normLoc.location;
        merged.locationAddress = normLoc.locationAddress;
      }

      if ('recurrence' in sanitizedUpdates) {
        merged.recurrence = normalizeRecurrenceRule(sanitizedUpdates.recurrence);
        if (!merged.recurrence) {
          merged.excludedDates = undefined;
          merged.completedDates = undefined;
        }
      }

      setEvents((prev) => prev.map((e) => (e.id === masterId ? merged : e)));
      setSelectedEvent((prev) => {
        if (!prev) return prev;
        if (prev.id === masterId) return merged;
        if (prev.id === eventId || resolveMasterEventId(prev.id) === masterId) {
          return {
            ...merged,
            id: merged.recurrence ? prev.id : merged.id,
            date: merged.recurrence ? prev.date : merged.date,
            recurrenceMasterId: merged.recurrence ? masterId : undefined,
            occurrenceDate: merged.recurrence ? prev.occurrenceDate : undefined,
          };
        }
        return prev;
      });

      if (sanitizedUpdates.date && sanitizedUpdates.date !== target.date) {
        const localJump = projectEventToViewerTimeZone(merged, effectiveViewerZone).localDate;
        jumpToDate(localJump);
      }

      if (toastLabel) {
        showToast(toastLabel, () => {
          setEvents((curr) => curr.map((e) => (e.id === masterId ? snapshot : e)));
          setSelectedEvent((curr) =>
            curr && resolveMasterEventId(curr.id) === masterId ? snapshot : curr
          );
        });
      }
    },
    [effectiveViewerZone, events, jumpToDate, showToast]
  );

  const handleImportEvents = useCallback(
    (importedEvents: CalendarEventItem[], summaryMessage: string) => {
      if (!importedEvents.length) {
        showToast(summaryMessage);
        return;
      }
      const importedIds = new Set(importedEvents.map((e) => e.id));
      setEvents((prev) => [...importedEvents, ...prev]);
      setSelectedEvent(importedEvents[0]);
      const firstLocalDate = projectEventToViewerTimeZone(
        importedEvents[0],
        effectiveViewerZone
      ).localDate;
      jumpToDate(firstLocalDate);

      showToast(summaryMessage, () => {
        setEvents((curr) => curr.filter((e) => !importedIds.has(e.id)));
        setSelectedEvent((curr) => (curr && importedIds.has(curr.id) ? null : curr));
      });
    },
    [effectiveViewerZone, jumpToDate, showToast]
  );

  const handlePatchEventsLocations = useCallback(
    (
      patches: Array<{
        id: string;
        location?: string;
        locationAddress?: string;
        locationLat?: number;
        locationLng?: number;
      }>
    ) => {
      if (!patches.length) return;
      const byId = new Map(patches.map((p) => [resolveMasterEventId(p.id), p]));
      const applyPatch = (ev: CalendarEventItem): CalendarEventItem => {
        const p = byId.get(resolveMasterEventId(ev.id));
        if (!p) return ev;
        const norm = normalizePlaceAndAddress(
          p.location || ev.location,
          p.locationAddress || ev.locationAddress
        );
        const coords = normalizeCoordinates(
          p.locationLat ?? ev.locationLat,
          p.locationLng ?? ev.locationLng
        );
        return {
          ...ev,
          location: norm.location || ev.location,
          locationAddress: norm.locationAddress || ev.locationAddress,
          locationLat: coords.locationLat ?? ev.locationLat,
          locationLng: coords.locationLng ?? ev.locationLng,
        };
      };

      setEvents((prev) => prev.map(applyPatch));
      setSelectedEvent((prev) =>
        prev && byId.has(resolveMasterEventId(prev.id)) ? applyPatch(prev) : prev
      );
    },
    []
  );

  const clearProjectAssociation = useCallback((deletedProjectId: string) => {
    setEvents((prev) =>
      prev.map((e) => (e.projectId === deletedProjectId ? { ...e, projectId: undefined } : e))
    );
    setSelectedEvent((prev) =>
      prev && prev.projectId === deletedProjectId ? { ...prev, projectId: undefined } : prev
    );
  }, []);

  const handleAutoRebalanceSchedule = useCallback(
    (scopeDate?: string) => {
      const activeProjectFilterIds =
        selectedProjectIds && selectedProjectIds.length > 0
          ? selectedProjectIds
          : selectedProjectId && selectedProjectId !== 'all'
          ? [selectedProjectId]
          : undefined;

      const result = computeSmartScheduleRebalance(events, {
        viewerTimeZone: effectiveViewerZone,
        todayDateStr: getTodayDateString(),
        scopeDate,
        projectIds: activeProjectFilterIds,
        includeOverdue: true,
      });

      if (result.patches.length === 0) {
        showToast(result.summaryMessage);
        return result;
      }

      const patchMap = new Map(result.patches.map((p) => [p.id, p]));

      setEvents((prev) =>
        prev.map((ev) => {
          const patch = patchMap.get(ev.id);
          if (!patch) return ev;
          return {
            ...ev,
            date: patch.after.date,
            endDate: patch.after.endDate,
            startTime: patch.after.startTime,
            endTime: patch.after.endTime,
          };
        })
      );

      setSelectedEvent((prev) => {
        if (!prev) return prev;
        const patch = patchMap.get(resolveMasterEventId(prev.id));
        if (!patch) return prev;
        return {
          ...prev,
          date: patch.after.date,
          endDate: patch.after.endDate,
          startTime: patch.after.startTime,
          endTime: patch.after.endTime,
        };
      });

      const firstPatched = events.find((e) => patchMap.has(e.id));
      if (scopeDate) {
        jumpToDate(scopeDate);
      } else if (firstPatched) {
        const p = patchMap.get(firstPatched.id)!;
        const projected = projectEventToViewerTimeZone(
          { ...firstPatched, ...p.after },
          effectiveViewerZone
        );
        jumpToDate(projected.localDate);
      }

      showToast(result.summaryMessage, () => {
        setEvents((curr) =>
          curr.map((ev) => {
            const patch = patchMap.get(ev.id);
            if (!patch) return ev;
            return {
              ...ev,
              date: patch.before.date,
              endDate: patch.before.endDate,
              startTime: patch.before.startTime,
              endTime: patch.before.endTime,
            };
          })
        );
        setSelectedEvent((curr) => {
          if (!curr) return curr;
          const patch = patchMap.get(resolveMasterEventId(curr.id));
          if (!patch) return curr;
          return {
            ...curr,
            date: patch.before.date,
            endDate: patch.before.endDate,
            startTime: patch.before.startTime,
            endTime: patch.before.endTime,
          };
        });
      });

      return result;
    },
    [effectiveViewerZone, events, jumpToDate, selectedProjectId, selectedProjectIds, showToast]
  );

  return {
    events,
    setEvents,
    filteredEvents,
    selectedDateEvents,
    currentYear,
    currentMonth,
    selectedDate,
    selectedCategory,
    selectedEvent,
    setCurrentYear,
    setCurrentMonth,
    setSelectedDate,
    setSelectedCategory,
    setSelectedEvent,
    handlePrevMonth,
    handleNextMonth,
    handleToday,
    jumpToDate,
    handleMoveEventDate,
    handleUpdateTimeSlot,
    handleUpdateEventTimeZone,
    handleUpdateEventProject,
    handleUpdateEventLocation,
    handleCreateManualEvent,
    handleUpdateEventFields,
    handleImportEvents,
    handlePatchEventsLocations,
    clearProjectAssociation,
    handleDeleteEvent,
    handleToggleComplete,
    handleToggleChecklistItem,
    handleAddChecklistItem,
    handleUpdateChecklistItemText,
    handleDeleteChecklistItem,
    handleApplyAgentResponse,
    handleCreateEventFromVenue,
    handleCreateEventFromGroundedSuggestion,
    handleAutoRebalanceSchedule,
  };
}
