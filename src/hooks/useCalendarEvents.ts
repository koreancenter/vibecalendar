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
import {
  areEventsSnapshotsEqual,
  areSingleEventsEqual,
  cloneEventItem,
  cloneEventsList,
  describeEventFieldChanges,
  EventHistoryEntry,
} from '../utils/eventHistoryDiff';
import { areShallowArraysEqual } from './useCalendarEventViewModels';
import {
  EventHistoryContextValue,
  MAX_EVENT_HISTORY_STACK,
  RecordEventHistoryMeta,
} from './useEventHistory';

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

  const eventsRef = useRef<CalendarEventItem[]>(events);
  eventsRef.current = events;

  const [historyStacks, setHistoryStacks] = useState<{
    past: EventHistoryEntry[];
    future: EventHistoryEntry[];
  }>({
    past: [],
    future: [],
  });
  const historyStacksRef = useRef(historyStacks);
  historyStacksRef.current = historyStacks;

  useEffect(() => {
    return () => {
      prevFilteredEventsRef.current = [];
      prevSelectedDateEventsRef.current = [];
      historyStacksRef.current = { past: [], future: [] };
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

  const syncSelectedEventFromList = useCallback((nextEvents: CalendarEventItem[]) => {
    setSelectedEvent((prev) => {
      if (!prev) return null;
      const masterId = resolveMasterEventId(prev.id);
      const matchedMaster = nextEvents.find((e) => e.id === masterId);
      if (!matchedMaster) return null;

      if (prev.recurrenceMasterId && matchedMaster.recurrence) {
        const occDate = prev.occurrenceDate || prev.date;
        if ((matchedMaster.excludedDates || []).includes(occDate)) {
          return null;
        }
        const completedSet = new Set(
          matchedMaster.completedDates || (matchedMaster.isCompleted ? [matchedMaster.date] : [])
        );
        return {
          ...cloneEventItem(matchedMaster),
          id: prev.id,
          date: occDate,
          isCompleted: completedSet.has(occDate),
          recurrenceMasterId: masterId,
          occurrenceDate: occDate,
        };
      }
      return cloneEventItem(matchedMaster);
    });
  }, []);

  const recordEventsTransition = useCallback(
    (
      meta: RecordEventHistoryMeta,
      beforeList: CalendarEventItem[],
      afterList: CalendarEventItem[]
    ): boolean => {
      if (areEventsSnapshotsEqual(beforeList, afterList)) return false;
      const entry: EventHistoryEntry = {
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        kind: meta.kind,
        label: meta.label,
        detail: meta.detail,
        targetEventId: meta.targetEventId,
        targetEventTitle: meta.targetEventTitle,
        focusDate: meta.focusDate,
        beforeEvents: cloneEventsList(beforeList),
        afterEvents: cloneEventsList(afterList),
      };
      const nextPast = [...historyStacksRef.current.past, entry].slice(-MAX_EVENT_HISTORY_STACK);
      const nextStacks = { past: nextPast, future: [] };
      historyStacksRef.current = nextStacks;
      setHistoryStacks(nextStacks);
      return true;
    },
    []
  );

  const undoStep = useCallback((): boolean => {
    const currentPast = historyStacksRef.current.past;
    if (currentPast.length === 0) return false;
    const entry = currentPast[currentPast.length - 1];
    const restoredEvents = cloneEventsList(entry.beforeEvents);
    const nextStacks = {
      past: currentPast.slice(0, -1),
      future: [...historyStacksRef.current.future, entry].slice(-MAX_EVENT_HISTORY_STACK),
    };
    historyStacksRef.current = nextStacks;
    setHistoryStacks(nextStacks);
    eventsRef.current = restoredEvents;
    setEvents(restoredEvents);
    syncSelectedEventFromList(restoredEvents);
    if (entry.focusDate) {
      jumpToDate(entry.focusDate);
    }
    showToast(`되돌림 · ${entry.label}`);
    return true;
  }, [jumpToDate, showToast, syncSelectedEventFromList]);

  const undoStepRef = useRef(undoStep);
  undoStepRef.current = undoStep;

  const redoStep = useCallback((): boolean => {
    const currentFuture = historyStacksRef.current.future;
    if (currentFuture.length === 0) return false;
    const entry = currentFuture[currentFuture.length - 1];
    const reappliedEvents = cloneEventsList(entry.afterEvents);
    const nextStacks = {
      past: [...historyStacksRef.current.past, entry].slice(-MAX_EVENT_HISTORY_STACK),
      future: currentFuture.slice(0, -1),
    };
    historyStacksRef.current = nextStacks;
    setHistoryStacks(nextStacks);
    eventsRef.current = reappliedEvents;
    setEvents(reappliedEvents);
    syncSelectedEventFromList(reappliedEvents);
    if (entry.focusDate) {
      jumpToDate(entry.focusDate);
    }
    showToast(`다시 실행 · ${entry.label}`);
    return true;
  }, [jumpToDate, showToast, syncSelectedEventFromList]);

  const revertToEntry = useCallback(
    (entryId: string): boolean => {
      const currentPast = historyStacksRef.current.past;
      const targetIdx = currentPast.findIndex((e) => e.id === entryId);
      if (targetIdx === -1) return false;
      if (targetIdx === currentPast.length - 1) {
        return undoStep();
      }
      const targetEntry = currentPast[targetIdx];
      const rolledBackCount = currentPast.length - targetIdx;
      const rolledBackForFuture = currentPast.slice(targetIdx).reverse();
      const restoredEvents = cloneEventsList(targetEntry.beforeEvents);
      const nextStacks = {
        past: currentPast.slice(0, targetIdx),
        future: [...historyStacksRef.current.future, ...rolledBackForFuture].slice(
          -MAX_EVENT_HISTORY_STACK
        ),
      };
      historyStacksRef.current = nextStacks;
      setHistoryStacks(nextStacks);
      eventsRef.current = restoredEvents;
      setEvents(restoredEvents);
      syncSelectedEventFromList(restoredEvents);
      if (targetEntry.focusDate) {
        jumpToDate(targetEntry.focusDate);
      }
      showToast(`${rolledBackCount}단계 이전 상태로 복원했습니다 · ${targetEntry.label}`);
      return true;
    },
    [jumpToDate, showToast, syncSelectedEventFromList, undoStep]
  );

  const restoreEventSnapshot = useCallback(
    (entryId: string, targetMasterId: string): boolean => {
      const entry = historyStacksRef.current.past.find((e) => e.id === entryId);
      if (!entry) return false;
      const beforeTarget = entry.beforeEvents.find((e) => e.id === targetMasterId);
      if (!beforeTarget) return false;

      const prevSnapshot = eventsRef.current;
      const currentTarget = prevSnapshot.find((e) => e.id === targetMasterId);
      if (currentTarget && areSingleEventsEqual(currentTarget, beforeTarget)) {
        showToast('이미 선택한 시점과 동일한 상태입니다.');
        return false;
      }

      const restoredClone = cloneEventItem(beforeTarget);
      const nextEvents = currentTarget
        ? prevSnapshot.map((e) => (e.id === targetMasterId ? restoredClone : e))
        : [restoredClone, ...prevSnapshot];
      const diffSummary = currentTarget
        ? describeEventFieldChanges(currentTarget, restoredClone)
        : '삭제된 일정 복원';

      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      syncSelectedEventFromList(nextEvents);
      recordEventsTransition(
        {
          kind: 'restore',
          label: `'${restoredClone.title}' 이전 상태 복원`,
          detail: diffSummary,
          targetEventId: targetMasterId,
          targetEventTitle: restoredClone.title,
          focusDate: restoredClone.date,
        },
        prevSnapshot,
        nextEvents
      );
      showToast(`'${restoredClone.title}' 일정을 선택한 이전 상태로 복원했습니다.`, () => {
        undoStepRef.current();
      });
      return true;
    },
    [recordEventsTransition, showToast, syncSelectedEventFromList]
  );

  const getEntriesForEvent = useCallback(
    (targetMasterId: string): EventHistoryEntry[] => {
      if (!targetMasterId) return [];
      return historyStacks.past
        .filter((entry) => {
          if (entry.targetEventId === targetMasterId) return true;
          const b = entry.beforeEvents.find((e) => e.id === targetMasterId);
          const a = entry.afterEvents.find((e) => e.id === targetMasterId);
          if (!b && !a) return false;
          if (!b || !a) return true;
          return !areSingleEventsEqual(b, a);
        })
        .reverse();
    },
    [historyStacks.past]
  );

  const clearHistory = useCallback(() => {
    const emptyStacks = { past: [], future: [] };
    historyStacksRef.current = emptyStacks;
    setHistoryStacks(emptyStacks);
    showToast('일정 수정 히스토리를 비웠습니다.');
  }, [showToast]);

  const applyEventsWithHistory = useCallback(
    (
      computeNext:
        | CalendarEventItem[]
        | ((prev: CalendarEventItem[]) => CalendarEventItem[]),
      meta: RecordEventHistoryMeta
    ): boolean => {
      const prevSnapshot = eventsRef.current;
      const nextEvents =
        typeof computeNext === 'function' ? computeNext(prevSnapshot) : computeNext;
      if (areEventsSnapshotsEqual(prevSnapshot, nextEvents)) return false;
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      syncSelectedEventFromList(nextEvents);
      recordEventsTransition(meta, prevSnapshot, nextEvents);
      return true;
    },
    [recordEventsTransition, syncSelectedEventFromList]
  );

  const eventHistory = useMemo<EventHistoryContextValue>(
    () => ({
      past: historyStacks.past,
      future: historyStacks.future,
      canUndo: historyStacks.past.length > 0,
      canRedo: historyStacks.future.length > 0,
      undoStep,
      redoStep,
      revertToEntry,
      restoreEventSnapshot,
      getEntriesForEvent,
      clearHistory,
    }),
    [
      clearHistory,
      getEntriesForEvent,
      historyStacks.future,
      historyStacks.past,
      redoStep,
      restoreEventSnapshot,
      revertToEntry,
      undoStep,
    ]
  );

  const handleMoveEventDate = useCallback(
    (eventId: string, targetDate: string, targetStartTime?: string, targetEndTime?: string) => {
      const prevSnapshot = eventsRef.current;
      const { masterId, occurrenceDate } = parseOccurrenceIdentity(eventId);
      const master = prevSnapshot.find((e) => e.id === masterId);
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

        const nextEvents = [
          detachedEvent,
          ...prevSnapshot.map((e) =>
            e.id === masterId ? { ...e, excludedDates: nextExcluded } : e
          ),
        ];
        eventsRef.current = nextEvents;
        setEvents(nextEvents);
        setSelectedEvent((prev) =>
          prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
            ? detachedEvent
            : prev
        );
        jumpToDate(targetDate);

        recordEventsTransition(
          {
            kind: 'move',
            label: `'${master.title}' 회차 분리 이동`,
            detail: `${occStartDate.slice(5)} → ${nextDate.slice(5)} ${
              occInstance.isAllDay ? '종일' : `${nextStartTime}~${nextEndTime}`
            }`,
            targetEventId: masterId,
            targetEventTitle: master.title,
            focusDate: oldTiming.localDate,
          },
          prevSnapshot,
          nextEvents
        );

        showToast(
          `'${master.title}'의 ${occStartDate} 회차가 ${nextDate} 개별 일정으로 분리 이동되었습니다.`,
          () => {
            undoStepRef.current();
          }
        );
        return;
      }

      const target = master;
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

      const updatedTarget: CalendarEventItem = {
        ...target,
        date: nextDate,
        startTime: nextStartTime,
        endTime: nextEndTime,
      };
      const nextEvents = prevSnapshot.map((e) => (e.id === target.id ? updatedTarget : e));
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent((prev) =>
        prev && prev.id === target.id
          ? { ...prev, date: nextDate, startTime: nextStartTime, endTime: nextEndTime }
          : prev
      );
      jumpToDate(targetDate);

      recordEventsTransition(
        {
          kind: 'move',
          label: `'${target.title}' 일시 이동`,
          detail: describeEventFieldChanges(target, updatedTarget),
          targetEventId: target.id,
          targetEventTitle: target.title,
          focusDate: oldTiming.localDate,
        },
        prevSnapshot,
        nextEvents
      );

      const zoneSuffix =
        !target.isAllDay && sourceZone !== effectiveViewerZone
          ? ` ${getTimeZoneMeta(sourceZone).shortCode}`
          : '';
      const msg =
        oldStartTime !== nextStartTime || oldEndTime !== nextEndTime
          ? `'${target.title}' 일정이 ${nextDate} ${nextStartTime}~${nextEndTime}${zoneSuffix}로 이동되었습니다.`
          : `'${target.title}' 일정이 ${targetDate}로 이동되었습니다.`;

      showToast(msg, () => {
        undoStepRef.current();
      });
    },
    [effectiveViewerZone, jumpToDate, recordEventsTransition, showToast]
  );

  const handleDeleteEvent = useCallback(
    (eventId: string, scope: 'single' | 'all' = 'all') => {
      const prevSnapshot = eventsRef.current;
      const { masterId, occurrenceDate } = parseOccurrenceIdentity(eventId);
      const target = prevSnapshot.find((e) => e.id === masterId);
      if (!target) return;

      if (scope === 'single' && target.recurrence) {
        const occDate =
          occurrenceDate ||
          (selectedEvent && resolveMasterEventId(selectedEvent.id) === masterId
            ? selectedEvent.occurrenceDate || selectedEvent.date
            : null) ||
          target.date;

        const nextExcluded = Array.from(new Set([...(target.excludedDates || []), occDate]));
        const nextEvents = prevSnapshot.map((e) =>
          e.id === masterId ? { ...e, excludedDates: nextExcluded } : e
        );
        eventsRef.current = nextEvents;
        setEvents(nextEvents);
        setSelectedEvent((prev) =>
          prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
            ? null
            : prev
        );

        recordEventsTransition(
          {
            kind: 'delete',
            label: `'${target.title}' 회차 제외`,
            detail: `${occDate} 회차 삭제`,
            targetEventId: masterId,
            targetEventTitle: target.title,
            focusDate: occDate,
          },
          prevSnapshot,
          nextEvents
        );

        showToast(`'${target.title}'의 ${occDate} 회차가 제외되었습니다.`, () => {
          undoStepRef.current();
        });
        return;
      }

      const nextEvents = prevSnapshot.filter((e) => e.id !== masterId);
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent((prev) =>
        prev && resolveMasterEventId(prev.id) === masterId ? null : prev
      );

      recordEventsTransition(
        {
          kind: 'delete',
          label: `'${target.title}' 일정 삭제`,
          detail: `${target.date.slice(5)} ${
            target.isAllDay ? '종일' : `${target.startTime}~${target.endTime}`
          }`,
          targetEventId: masterId,
          targetEventTitle: target.title,
          focusDate: target.date,
        },
        prevSnapshot,
        nextEvents
      );

      showToast(
        `'${target.title}'${target.recurrence ? ' 전체 반복 일정이' : ' 일정이'} 삭제되었습니다.`,
        () => {
          undoStepRef.current();
        }
      );
    },
    [recordEventsTransition, selectedEvent, showToast]
  );

  const handleToggleComplete = useCallback(
    (eventId: string) => {
      const prevSnapshot = eventsRef.current;
      const { masterId, occurrenceDate } = parseOccurrenceIdentity(eventId);
      const master = prevSnapshot.find((e) => e.id === masterId);
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

        const nextEvents = prevSnapshot.map((e) =>
          e.id === masterId
            ? {
                ...e,
                isCompleted: occDate === e.date ? nextCompleted : e.isCompleted,
                completedDates: nextCompletedDates.length > 0 ? nextCompletedDates : undefined,
              }
            : e
        );
        eventsRef.current = nextEvents;
        setEvents(nextEvents);
        setSelectedEvent((prev) => {
          if (!prev) return prev;
          const prevMasterId = resolveMasterEventId(prev.id);
          const prevOccDate = prev.occurrenceDate || prev.date;
          if (prev.id === eventId || (prevMasterId === masterId && prevOccDate === occDate)) {
            return {
              ...prev,
              isCompleted: nextCompleted,
              completedDates: nextCompletedDates.length > 0 ? nextCompletedDates : undefined,
            };
          }
          return prev;
        });

        recordEventsTransition(
          {
            kind: 'complete',
            label: `'${master.title}' 완료 상태 변경`,
            detail: `${occDate.slice(5)} ${nextCompleted ? '완료 처리' : '미완료 전환'}`,
            targetEventId: masterId,
            targetEventTitle: master.title,
            focusDate: occDate,
          },
          prevSnapshot,
          nextEvents
        );
        return;
      }

      const nextDone = !master.isCompleted;
      const nextEvents = prevSnapshot.map((e) =>
        e.id === masterId ? { ...e, isCompleted: nextDone } : e
      );
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent((prev) =>
        prev && resolveMasterEventId(prev.id) === masterId
          ? { ...prev, isCompleted: nextDone }
          : prev
      );

      recordEventsTransition(
        {
          kind: 'complete',
          label: `'${master.title}' 완료 상태 변경`,
          detail: nextDone ? '완료 처리' : '미완료로 전환',
          targetEventId: masterId,
          targetEventTitle: master.title,
          focusDate: master.date,
        },
        prevSnapshot,
        nextEvents
      );
    },
    [recordEventsTransition, selectedEvent]
  );

  const handleToggleChecklistItem = useCallback(
    (eventId: string, itemId: string) => {
      const prevSnapshot = eventsRef.current;
      const masterId = resolveMasterEventId(eventId);
      const target = prevSnapshot.find((e) => e.id === masterId);
      if (!target) return;

      const toggledItem = (target.checklist || []).find((chk) => chk.id === itemId);
      if (!toggledItem) return;

      const updateChecklist = (e: CalendarEventItem): CalendarEventItem => ({
        ...e,
        checklist: (e.checklist || []).map((chk) =>
          chk.id === itemId ? { ...chk, done: !chk.done } : chk
        ),
      });

      const nextEvents = prevSnapshot.map((e) => (e.id === masterId ? updateChecklist(e) : e));
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent((prev) =>
        prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
          ? updateChecklist(prev)
          : prev
      );

      recordEventsTransition(
        {
          kind: 'checklist',
          label: `'${target.title}' 체크리스트 변경`,
          detail: `'${toggledItem.text}' ${!toggledItem.done ? '완료' : '미완료'}`,
          targetEventId: masterId,
          targetEventTitle: target.title,
          focusDate: target.date,
        },
        prevSnapshot,
        nextEvents
      );
    },
    [recordEventsTransition]
  );

  const handleAddChecklistItem = useCallback(
    (eventId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const prevSnapshot = eventsRef.current;
      const masterId = resolveMasterEventId(eventId);
      const target = prevSnapshot.find((e) => e.id === masterId);
      if (!target) return;

      const newItem: ChecklistItem = {
        id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: trimmed,
        done: false,
      };
      const appendChecklist = (e: CalendarEventItem): CalendarEventItem => ({
        ...e,
        checklist: [...(e.checklist || []), newItem],
      });

      const nextEvents = prevSnapshot.map((e) => (e.id === masterId ? appendChecklist(e) : e));
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent((prev) =>
        prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
          ? appendChecklist(prev)
          : prev
      );

      recordEventsTransition(
        {
          kind: 'checklist',
          label: `'${target.title}' 체크리스트 추가`,
          detail: `항목 '${trimmed}'`,
          targetEventId: masterId,
          targetEventTitle: target.title,
          focusDate: target.date,
        },
        prevSnapshot,
        nextEvents
      );
    },
    [recordEventsTransition]
  );

  const handleUpdateChecklistItemText = useCallback(
    (eventId: string, itemId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const prevSnapshot = eventsRef.current;
      const masterId = resolveMasterEventId(eventId);
      const target = prevSnapshot.find((e) => e.id === masterId);
      if (!target) return;

      const editChecklist = (e: CalendarEventItem): CalendarEventItem => ({
        ...e,
        checklist: (e.checklist || []).map((chk) =>
          chk.id === itemId ? { ...chk, text: trimmed } : chk
        ),
      });

      const nextEvents = prevSnapshot.map((e) => (e.id === masterId ? editChecklist(e) : e));
      if (areEventsSnapshotsEqual(prevSnapshot, nextEvents)) return;
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent((prev) =>
        prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
          ? editChecklist(prev)
          : prev
      );

      recordEventsTransition(
        {
          kind: 'checklist',
          label: `'${target.title}' 체크리스트 수정`,
          detail: `항목 '${trimmed}'`,
          targetEventId: masterId,
          targetEventTitle: target.title,
          focusDate: target.date,
        },
        prevSnapshot,
        nextEvents
      );
    },
    [recordEventsTransition]
  );

  const handleDeleteChecklistItem = useCallback(
    (eventId: string, itemId: string) => {
      const prevSnapshot = eventsRef.current;
      const masterId = resolveMasterEventId(eventId);
      const target = prevSnapshot.find((e) => e.id === masterId);
      if (!target) return;
      const removedItem = (target.checklist || []).find((chk) => chk.id === itemId);
      if (!removedItem) return;

      const removeChecklist = (e: CalendarEventItem): CalendarEventItem => {
        const next = (e.checklist || []).filter((chk) => chk.id !== itemId);
        return { ...e, checklist: next.length > 0 ? next : undefined };
      };

      const nextEvents = prevSnapshot.map((e) => (e.id === masterId ? removeChecklist(e) : e));
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent((prev) =>
        prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
          ? removeChecklist(prev)
          : prev
      );

      recordEventsTransition(
        {
          kind: 'checklist',
          label: `'${target.title}' 체크리스트 삭제`,
          detail: `항목 '${removedItem.text}' 제거`,
          targetEventId: masterId,
          targetEventTitle: target.title,
          focusDate: target.date,
        },
        prevSnapshot,
        nextEvents
      );
    },
    [recordEventsTransition]
  );

  const handleApplyAgentResponse = useCallback(
    (res: AgentCommandResponse) => {
      let newlyCreated: CalendarEventItem[] = [];
      const prevEventsSnapshot = eventsRef.current;

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

      let workingEvents = [...prevEventsSnapshot];

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
        const existingIds = new Set(workingEvents.map((e) => e.id));
        const toAdd = withProj.filter((e) => !existingIds.has(e.id));
        workingEvents = [...toAdd, ...workingEvents];
        setSelectedEvent(withProj[0]);
        const firstLocalDate = projectEventToViewerTimeZone(
          withProj[0],
          effectiveViewerZone
        ).localDate;
        jumpToDate(firstLocalDate);
      }

      const patchMap = new Map<string, Partial<CalendarEventItem>>();
      if (updatePatches.length > 0) {
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
          workingEvents = workingEvents.map((e) => {
            const patch = patchMap.get(e.id);
            return patch ? { ...e, ...patch } : e;
          });
          setSelectedEvent((prev) => {
            if (!prev) return prev;
            const patch = patchMap.get(resolveMasterEventId(prev.id));
            return patch ? { ...prev, ...patch } : prev;
          });
        }
      }

      if (deleteMasterSet.size > 0) {
        workingEvents = workingEvents.filter((e) => !deleteMasterSet.has(e.id));
        setSelectedEvent((prev) =>
          prev && deleteMasterSet.has(resolveMasterEventId(prev.id)) ? null : prev
        );
      }

      if (!newlyCreated.length && res.targetDate) {
        jumpToDate(res.targetDate);
      }

      const didMutate = !areEventsSnapshotsEqual(prevEventsSnapshot, workingEvents);
      if (didMutate) {
        eventsRef.current = workingEvents;
        setEvents(workingEvents);

        let historyLabel = 'AI 일정 변경';
        let historyDetail: string | undefined;
        let singleTargetId: string | undefined;
        let singleTargetTitle: string | undefined;

        if (newlyCreated.length === 1 && patchMap.size === 0 && deleteMasterSet.size === 0) {
          historyLabel = `'${newlyCreated[0].title}' AI 등록`;
          historyDetail = `${newlyCreated[0].date.slice(5)} ${
            newlyCreated[0].isAllDay
              ? '종일'
              : `${newlyCreated[0].startTime}~${newlyCreated[0].endTime}`
          }`;
          singleTargetId = newlyCreated[0].id;
          singleTargetTitle = newlyCreated[0].title;
        } else if (newlyCreated.length > 1) {
          historyLabel = `AI 일정 일괄 등록 (${newlyCreated.length}건)`;
          historyDetail = newlyCreated[0].title;
        } else if (patchMap.size === 1 && deleteMasterSet.size === 0) {
          const [onlyId] = Array.from(patchMap.keys());
          const beforeEv = prevEventsSnapshot.find((e) => e.id === onlyId);
          const afterEv = workingEvents.find((e) => e.id === onlyId);
          if (beforeEv && afterEv) {
            historyLabel = `'${afterEv.title}' AI 수정`;
            historyDetail = describeEventFieldChanges(beforeEv, afterEv);
            singleTargetId = onlyId;
            singleTargetTitle = afterEv.title;
          }
        } else if (patchMap.size > 1) {
          historyLabel = `AI 일정 일괄 수정 (${patchMap.size}건)`;
          historyDetail = updatePatches[0]?.diffSummary;
        } else if (deleteMasterSet.size > 0) {
          const deletedTitles = prevEventsSnapshot
            .filter((e) => deleteMasterSet.has(e.id))
            .map((e) => e.title);
          historyLabel =
            deletedTitles.length === 1
              ? `'${deletedTitles[0]}' AI 삭제`
              : `AI 일정 삭제 (${deleteMasterSet.size}건)`;
        }

        recordEventsTransition(
          {
            kind: 'ai',
            label: historyLabel,
            detail: historyDetail,
            targetEventId: singleTargetId,
            targetEventTitle: singleTargetTitle,
            focusDate: res.targetDate || selectedDate,
          },
          prevEventsSnapshot,
          workingEvents
        );
      }

      showToast(
        res.replyText || 'AI 요청이 반영되었습니다.',
        didMutate
          ? () => {
              undoStepRef.current();
            }
          : undefined
      );
      return newlyCreated;
    },
    [
      effectiveViewerZone,
      jumpToDate,
      primaryProjectId,
      recordEventsTransition,
      selectedDate,
      showToast,
    ]
  );

  const handleCreateEventFromVenue = useCallback(
    (venue: RecommendedVenue, defaultDate?: string) => {
      const prevSnapshot = eventsRef.current;
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

      const nextEvents = [newEvent, ...prevSnapshot];
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent(newEvent);

      const localJumpDate = projectEventToViewerTimeZone(newEvent, effectiveViewerZone).localDate;
      jumpToDate(localJumpDate);

      recordEventsTransition(
        {
          kind: 'create',
          label: `'${exactVenueName}' 장소 일정 등록`,
          detail: `${localJumpDate.slice(5)} 12:00~13:30`,
          targetEventId: newEvent.id,
          targetEventTitle: exactVenueName,
          focusDate: localJumpDate,
        },
        prevSnapshot,
        nextEvents
      );

      showToast(`'${exactVenueName}' 일정이 ${localJumpDate} 캘린더에 등록되었습니다.`, () => {
        undoStepRef.current();
      });
      return newEvent;
    },
    [effectiveViewerZone, jumpToDate, primaryProjectId, recordEventsTransition, selectedDate, showToast]
  );

  const handleCreateEventFromGroundedSuggestion = useCallback(
    (suggestion: GroundedDateSuggestion) => {
      const prevSnapshot = eventsRef.current;
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

      const nextEvents = [newEvent, ...prevSnapshot];
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent(newEvent);
      jumpToDate(suggestion.date);

      recordEventsTransition(
        {
          kind: 'create',
          label: `'${suggestion.title}' 추천 일정 등록`,
          detail: `${suggestion.date.slice(5)} ${newEvent.isAllDay ? '종일' : `${newEvent.startTime}~${newEvent.endTime}`}`,
          targetEventId: newEvent.id,
          targetEventTitle: suggestion.title,
          focusDate: suggestion.date,
        },
        prevSnapshot,
        nextEvents
      );

      showToast(`'${suggestion.title}' 일정이 ${suggestion.date} 캘린더에 반영되었습니다.`, () => {
        undoStepRef.current();
      });

      return newEvent;
    },
    [jumpToDate, primaryProjectId, recordEventsTransition, showToast]
  );

  const handleUpdateTimeSlot = useCallback(
    (eventId: string, localStartTime: string, localEndTime: string) => {
      const prevSnapshot = eventsRef.current;
      const masterId = resolveMasterEventId(eventId);
      const target = prevSnapshot.find((e) => e.id === masterId);
      if (!target) return;

      const timing = projectEventToViewerTimeZone(target, effectiveViewerZone);
      const converted = convertLocalSlotToEventZone(
        timing.localDate,
        localStartTime,
        localEndTime,
        effectiveViewerZone,
        timing.sourceTimeZone
      );

      const updated: CalendarEventItem = {
        ...target,
        date: converted.date,
        startTime: converted.startTime,
        endTime: converted.endTime,
      };
      if (areSingleEventsEqual(target, updated)) return;

      const nextEvents = prevSnapshot.map((e) => (e.id === masterId ? updated : e));
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
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

      recordEventsTransition(
        {
          kind: 'move',
          label: `'${target.title}' 시간 변경`,
          detail: describeEventFieldChanges(target, updated),
          targetEventId: masterId,
          targetEventTitle: target.title,
          focusDate: timing.localDate,
        },
        prevSnapshot,
        nextEvents
      );

      const codeSuffix = !timing.isSameZone ? ` ${timing.sourceMeta.shortCode}` : '';
      showToast(
        `일정 시간이 ${converted.startTime} ~ ${converted.endTime}${codeSuffix}로 변경되었습니다.`,
        () => {
          undoStepRef.current();
        }
      );
    },
    [effectiveViewerZone, recordEventsTransition, showToast]
  );

  const handleUpdateEventTimeZone = useCallback(
    (eventId: string, nextTimeZone: string | undefined) => {
      const prevSnapshot = eventsRef.current;
      const masterId = resolveMasterEventId(eventId);
      const target = prevSnapshot.find((e) => e.id === masterId);
      if (!target) return;

      const validTz = nextTimeZone && isValidTimeZone(nextTimeZone) ? nextTimeZone : undefined;
      if (target.timeZone === validTz) return;

      const updated: CalendarEventItem = { ...target, timeZone: validTz };
      const nextEvents = prevSnapshot.map((e) => (e.id === masterId ? updated : e));
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent((prev) =>
        prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
          ? { ...prev, timeZone: validTz }
          : prev
      );

      const meta = getTimeZoneMeta(validTz || effectiveViewerZone);
      recordEventsTransition(
        {
          kind: 'update',
          label: `'${target.title}' 시간대 변경`,
          detail: `${meta.cityKo} (${meta.shortCode})`,
          targetEventId: masterId,
          targetEventTitle: target.title,
          focusDate: target.date,
        },
        prevSnapshot,
        nextEvents
      );

      showToast(`일정 기준 시간대가 ${meta.shortCode} (${meta.cityKo})로 설정되었습니다.`, () => {
        undoStepRef.current();
      });
    },
    [effectiveViewerZone, recordEventsTransition, showToast]
  );

  const handleUpdateEventProject = useCallback(
    (eventId: string, projectId: string | undefined) => {
      const prevSnapshot = eventsRef.current;
      const masterId = resolveMasterEventId(eventId);
      const target = prevSnapshot.find((e) => e.id === masterId);
      if (!target || target.projectId === projectId) return;

      const updated: CalendarEventItem = { ...target, projectId };
      const nextEvents = prevSnapshot.map((e) => (e.id === masterId ? updated : e));
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent((prev) =>
        prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
          ? { ...prev, projectId }
          : prev
      );

      recordEventsTransition(
        {
          kind: 'update',
          label: `'${target.title}' 소속 프로젝트 변경`,
          detail: projectId ? '프로젝트 연결' : '프로젝트 연결 해제',
          targetEventId: masterId,
          targetEventTitle: target.title,
          focusDate: target.date,
        },
        prevSnapshot,
        nextEvents
      );

      showToast('일정의 소속 프로젝트가 업데이트되었습니다.', () => {
        undoStepRef.current();
      });
    },
    [recordEventsTransition, showToast]
  );

  const handleUpdateEventLocation = useCallback(
    (
      eventId: string,
      rawLocation?: string,
      rawAddress?: string,
      rawLat?: number,
      rawLng?: number
    ) => {
      const prevSnapshot = eventsRef.current;
      const masterId = resolveMasterEventId(eventId);
      const target = prevSnapshot.find((e) => e.id === masterId);
      if (!target) return;

      const { location, locationAddress } = normalizePlaceAndAddress(rawLocation, rawAddress);
      const { locationLat, locationLng } =
        location || locationAddress || (rawLat !== undefined && rawLng !== undefined)
          ? normalizeCoordinates(rawLat, rawLng)
          : {};
      const updated: CalendarEventItem = {
        ...target,
        location,
        locationAddress,
        locationLat,
        locationLng,
      };
      if (areSingleEventsEqual(target, updated)) return;

      const nextEvents = prevSnapshot.map((e) => (e.id === masterId ? updated : e));
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent((prev) =>
        prev && (prev.id === eventId || resolveMasterEventId(prev.id) === masterId)
          ? { ...prev, location, locationAddress, locationLat, locationLng }
          : prev
      );

      recordEventsTransition(
        {
          kind: 'update',
          label: `'${target.title}' 장소 수정`,
          detail: describeEventFieldChanges(target, updated),
          targetEventId: masterId,
          targetEventTitle: target.title,
          focusDate: target.date,
        },
        prevSnapshot,
        nextEvents
      );

      showToast(
        location || locationAddress || (locationLat !== undefined && locationLng !== undefined)
          ? '일정 장소 · 상세 주소 · 위경도 정보가 업데이트되었습니다.'
          : '일정 장소 정보가 비워졌습니다.',
        () => {
          undoStepRef.current();
        }
      );
    },
    [recordEventsTransition, showToast]
  );

  const handleCreateManualEvent = useCallback(
    (draft: ManualEventDraft): CalendarEventItem => {
      const prevSnapshot = eventsRef.current;
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

      const nextEvents = [newEvent, ...prevSnapshot];
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent(newEvent);

      const localJumpDate = projectEventToViewerTimeZone(newEvent, effectiveViewerZone).localDate;
      jumpToDate(localJumpDate);

      recordEventsTransition(
        {
          kind: 'create',
          label: `'${cleanTitle}' 새 일정 등록`,
          detail: `${newEvent.date.slice(5)} ${
            newEvent.isAllDay ? '종일' : `${newEvent.startTime}~${newEvent.endTime}`
          }`,
          targetEventId: newEvent.id,
          targetEventTitle: cleanTitle,
          focusDate: localJumpDate,
        },
        prevSnapshot,
        nextEvents
      );

      showToast(`'${cleanTitle}' 일정이 등록되었습니다.`, () => {
        undoStepRef.current();
      });

      return newEvent;
    },
    [effectiveViewerZone, jumpToDate, recordEventsTransition, showToast]
  );

  const handleUpdateEventFields = useCallback(
    (eventId: string, updates: Partial<CalendarEventItem>, toastLabel?: string) => {
      const prevSnapshot = eventsRef.current;
      const { masterId, occurrenceDate, isVirtualOccurrence } = parseOccurrenceIdentity(eventId);
      const target = prevSnapshot.find((e) => e.id === masterId);
      if (!target) return;

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

      if (areSingleEventsEqual(target, merged)) return;

      const nextEvents = prevSnapshot.map((e) => (e.id === masterId ? merged : e));
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
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

      recordEventsTransition(
        {
          kind: 'update',
          label: `'${merged.title}' 일정 수정`,
          detail: describeEventFieldChanges(target, merged),
          targetEventId: masterId,
          targetEventTitle: merged.title,
          focusDate: merged.date,
        },
        prevSnapshot,
        nextEvents
      );

      if (toastLabel) {
        showToast(toastLabel, () => {
          undoStepRef.current();
        });
      }
    },
    [effectiveViewerZone, jumpToDate, recordEventsTransition, showToast]
  );

  const handleImportEvents = useCallback(
    (importedEvents: CalendarEventItem[], summaryMessage: string) => {
      if (!importedEvents.length) {
        showToast(summaryMessage);
        return;
      }
      const prevSnapshot = eventsRef.current;
      const nextEvents = [...importedEvents, ...prevSnapshot];
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent(importedEvents[0]);
      const firstLocalDate = projectEventToViewerTimeZone(
        importedEvents[0],
        effectiveViewerZone
      ).localDate;
      jumpToDate(firstLocalDate);

      recordEventsTransition(
        {
          kind: 'import',
          label: `일정 가져오기 (${importedEvents.length}건)`,
          detail: importedEvents[0].title,
          focusDate: firstLocalDate,
        },
        prevSnapshot,
        nextEvents
      );

      showToast(summaryMessage, () => {
        undoStepRef.current();
      });
    },
    [effectiveViewerZone, jumpToDate, recordEventsTransition, showToast]
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

      const nextEvents = eventsRef.current.map(applyPatch);
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent((prev) =>
        prev && byId.has(resolveMasterEventId(prev.id)) ? applyPatch(prev) : prev
      );

      // 백그라운드 위경도 자동 보강은 직전 AI 생성/수정 스택의 afterEvents에 무소음 병합해 1단계 되돌리기 보존
      const currentPast = historyStacksRef.current.past;
      if (currentPast.length > 0) {
        const top = currentPast[currentPast.length - 1];
        const updatedTop: EventHistoryEntry = {
          ...top,
          afterEvents: top.afterEvents.map(applyPatch),
        };
        const nextStacks = {
          ...historyStacksRef.current,
          past: [...currentPast.slice(0, -1), updatedTop],
        };
        historyStacksRef.current = nextStacks;
        setHistoryStacks(nextStacks);
      }
    },
    []
  );

  const clearProjectAssociation = useCallback(
    (deletedProjectId: string) => {
      const prevSnapshot = eventsRef.current;
      const nextEvents = prevSnapshot.map((e) =>
        e.projectId === deletedProjectId ? { ...e, projectId: undefined } : e
      );
      if (areEventsSnapshotsEqual(prevSnapshot, nextEvents)) return;
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedEvent((prev) =>
        prev && prev.projectId === deletedProjectId ? { ...prev, projectId: undefined } : prev
      );
      recordEventsTransition(
        {
          kind: 'update',
          label: '삭제된 프로젝트 연결 해제',
          detail: '일정 프로젝트 참조 초기화',
        },
        prevSnapshot,
        nextEvents
      );
    },
    [recordEventsTransition]
  );

  const handleAutoRebalanceSchedule = useCallback(
    (scopeDate?: string) => {
      const prevSnapshot = eventsRef.current;
      const activeProjectFilterIds =
        selectedProjectIds && selectedProjectIds.length > 0
          ? selectedProjectIds
          : selectedProjectId && selectedProjectId !== 'all'
          ? [selectedProjectId]
          : undefined;

      const result = computeSmartScheduleRebalance(prevSnapshot, {
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

      const nextEvents = prevSnapshot.map((ev) => {
        const patch = patchMap.get(ev.id);
        if (!patch) return ev;
        return {
          ...ev,
          date: patch.after.date,
          endDate: patch.after.endDate,
          startTime: patch.after.startTime,
          endTime: patch.after.endTime,
        };
      });

      eventsRef.current = nextEvents;
      setEvents(nextEvents);

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

      const firstPatched = prevSnapshot.find((e) => patchMap.has(e.id));
      let resolvedJumpDate = scopeDate;
      if (scopeDate) {
        jumpToDate(scopeDate);
      } else if (firstPatched) {
        const p = patchMap.get(firstPatched.id)!;
        const projected = projectEventToViewerTimeZone(
          { ...firstPatched, ...p.after },
          effectiveViewerZone
        );
        resolvedJumpDate = projected.localDate;
        jumpToDate(projected.localDate);
      }

      recordEventsTransition(
        {
          kind: 'rebalance',
          label: `공정 자동 재배치 (${result.patches.length}건)`,
          detail: firstPatched ? `'${firstPatched.title}' 외 일정 슬롯 조정` : undefined,
          focusDate: resolvedJumpDate,
        },
        prevSnapshot,
        nextEvents
      );

      showToast(result.summaryMessage, () => {
        undoStepRef.current();
      });

      return result;
    },
    [
      effectiveViewerZone,
      jumpToDate,
      recordEventsTransition,
      selectedProjectId,
      selectedProjectIds,
      showToast,
    ]
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
    applyEventsWithHistory,
    eventHistory,
  };
}
