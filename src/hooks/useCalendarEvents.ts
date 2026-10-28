import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  INITIAL_CALENDAR_EVENTS,
  LEGACY_REAL_NAME_EVENT_IDS,
} from '../data/sampleEvents';
import {
  CalendarEventItem,
  CalendarCategory,
  AgentCommandResponse,
  RecommendedVenue,
  GroundedDateSuggestion,
} from '../types';
import { addDays, getTodayDateString, parseLocalDate } from '../shared/dateUtils';
import { normalizeCoordinates, normalizePlaceAndAddress } from '../shared/locationUtils';
import {
  convertLocalSlotToEventZone,
  detectBrowserTimeZone,
  getTimeZoneMeta,
  inferTimeZoneFromLocation,
  isValidTimeZone,
  projectEventToViewerTimeZone,
  resolveEventTimeZone,
} from '../shared/timeZoneUtils';
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
      return {
        ...ev,
        location,
        locationAddress,
        locationLat,
        locationLng,
      };
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
    const matched: Array<{ event: CalendarEventItem; localStartTime: string }> = [];
    for (const e of filteredEvents) {
      const timing = projectEventToViewerTimeZone(e, effectiveViewerZone);
      if (timing.localDate === selectedDate) {
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
      const target = events.find((e) => e.id === eventId);
      if (!target) return;

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
          e.id === eventId
            ? { ...e, date: nextDate, startTime: nextStartTime, endTime: nextEndTime }
            : e
        )
      );
      setSelectedEvent((prev) =>
        prev && prev.id === eventId
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
            e.id === eventId
              ? { ...e, date: oldDate, startTime: oldStartTime, endTime: oldEndTime }
              : e
          )
        );
        setSelectedEvent((prev) =>
          prev && prev.id === eventId
            ? { ...prev, date: oldDate, startTime: oldStartTime, endTime: oldEndTime }
            : prev
        );
        jumpToDate(oldTiming.localDate);
      });
    },
    [events, effectiveViewerZone, jumpToDate, showToast]
  );

  const handleDeleteEvent = useCallback(
    (eventId: string) => {
      const target = events.find((e) => e.id === eventId);
      if (!target) return;

      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      setSelectedEvent((prev) => (prev?.id === eventId ? null : prev));

      showToast(`'${target.title}' 일정이 삭제되었습니다.`, () => {
        setEvents((current) => [...current, target]);
      });
    },
    [events, showToast]
  );

  const handleToggleComplete = useCallback((eventId: string) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, isCompleted: !e.isCompleted } : e))
    );
    setSelectedEvent((prev) =>
      prev && prev.id === eventId ? { ...prev, isCompleted: !prev.isCompleted } : prev
    );
  }, []);

  const handleToggleChecklistItem = useCallback((eventId: string, itemId: string) => {
    const updateChecklist = (e: CalendarEventItem): CalendarEventItem => {
      const updatedChecklist = (e.checklist || []).map((chk) =>
        chk.id === itemId ? { ...chk, done: !chk.done } : chk
      );
      return { ...e, checklist: updatedChecklist };
    };

    setEvents((prev) => prev.map((e) => (e.id === eventId ? updateChecklist(e) : e)));
    setSelectedEvent((prev) => (prev && prev.id === eventId ? updateChecklist(prev) : prev));
  }, []);

  const handleApplyAgentResponse = useCallback(
    (res: AgentCommandResponse) => {
      let newlyCreated: CalendarEventItem[] = [];

      if (res.actionType === 'QUERY_EVENTS') {
        if (res.targetDate) {
          jumpToDate(res.targetDate);
        }
        showToast(`${res.targetDate || selectedDate} 스케줄 브리핑을 불러왔습니다.`);
        return [];
      }

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

      if (res.updatedEvent?.id) {
        const u = res.updatedEvent;
        const normalizedUpdates = { ...u.updates };
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
        setEvents((prev) =>
          prev.map((e) => (e.id === u.id ? { ...e, ...normalizedUpdates } : e))
        );
        setSelectedEvent((prev) =>
          prev && prev.id === u.id ? { ...prev, ...normalizedUpdates } : prev
        );
      }

      if (res.deletedEventId) {
        setEvents((prev) => prev.filter((e) => e.id !== res.deletedEventId));
        setSelectedEvent((prev) => (prev?.id === res.deletedEventId ? null : prev));
      }

      if (!newlyCreated.length && res.targetDate) {
        jumpToDate(res.targetDate);
      }

      showToast(res.replyText || 'AI 요청이 반영되었습니다.');
      return newlyCreated;
    },
    [effectiveViewerZone, jumpToDate, primaryProjectId, selectedDate, showToast]
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
      const target = events.find((e) => e.id === eventId);
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
          e.id === eventId
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
        prev && prev.id === eventId
          ? {
              ...prev,
              date: converted.date,
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
      const validTz = nextTimeZone && isValidTimeZone(nextTimeZone) ? nextTimeZone : undefined;
      setEvents((prev) =>
        prev.map((e) => (e.id === eventId ? { ...e, timeZone: validTz } : e))
      );
      setSelectedEvent((prev) =>
        prev && prev.id === eventId ? { ...prev, timeZone: validTz } : prev
      );

      const meta = getTimeZoneMeta(validTz || effectiveViewerZone);
      showToast(`일정 기준 시간대가 ${meta.shortCode} (${meta.cityKo})로 설정되었습니다.`);
    },
    [effectiveViewerZone, showToast]
  );

  const handleUpdateEventProject = useCallback(
    (eventId: string, projectId: string | undefined) => {
      setEvents((prev) =>
        prev.map((e) => (e.id === eventId ? { ...e, projectId } : e))
      );
      setSelectedEvent((prev) => (prev && prev.id === eventId ? { ...prev, projectId } : prev));
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
      const { location, locationAddress } = normalizePlaceAndAddress(rawLocation, rawAddress);
      const { locationLat, locationLng } =
        location || locationAddress || (rawLat !== undefined && rawLng !== undefined)
          ? normalizeCoordinates(rawLat, rawLng)
          : {};
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? { ...e, location, locationAddress, locationLat, locationLng }
            : e
        )
      );
      setSelectedEvent((prev) =>
        prev && prev.id === eventId
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

  const clearProjectAssociation = useCallback((deletedProjectId: string) => {
    setEvents((prev) =>
      prev.map((e) => (e.projectId === deletedProjectId ? { ...e, projectId: undefined } : e))
    );
    setSelectedEvent((prev) =>
      prev && prev.projectId === deletedProjectId ? { ...prev, projectId: undefined } : prev
    );
  }, []);

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
    clearProjectAssociation,
    handleDeleteEvent,
    handleToggleComplete,
    handleToggleChecklistItem,
    handleApplyAgentResponse,
    handleCreateEventFromVenue,
    handleCreateEventFromGroundedSuggestion,
  };
}
