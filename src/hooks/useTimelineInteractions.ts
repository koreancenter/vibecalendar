import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CalendarEventItem } from '../types';
import { timeToMinutes, minutesToTime } from '../shared/scheduleUtils';

export type InteractionMode = 'drag' | 'resize-top' | 'resize-bottom';

export interface InteractionState {
  mode: InteractionMode;
  eventId: string;
  originalEvent: CalendarEventItem;
  currentDate: string;
  startMinutes: number;
  endMinutes: number;
  initialMouseX: number;
  initialMouseY: number;
  initialScrollTop: number;
  initialMinutes: number;
  hasMoved: boolean;
}

interface UseTimelineInteractionsProps {
  startHour: number;
  endHour: number;
  pxPerHour: number;
  columnDates: string[];
  columnsGridRef: React.RefObject<HTMLDivElement | null>;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  onHoverDateChange?: (date: string | null) => void;
  onMoveEventDate?: (
    eventId: string,
    targetDate: string,
    targetStartTime?: string,
    targetEndTime?: string
  ) => void;
  onSelectEvent: (event: CalendarEventItem) => void;
}

export function useTimelineInteractions({
  startHour,
  endHour,
  pxPerHour,
  columnDates,
  columnsGridRef,
  scrollContainerRef,
  onHoverDateChange,
  onMoveEventDate,
  onSelectEvent,
}: UseTimelineInteractionsProps) {
  const [activeInteraction, setActiveInteraction] = useState<InteractionState | null>(null);
  const justDraggedRef = useRef(false);

  const activeInteractionRef = useRef<InteractionState | null>(null);
  activeInteractionRef.current = activeInteraction;

  const columnDatesRef = useRef<string[]>(columnDates);
  columnDatesRef.current = columnDates;

  const onHoverDateChangeRef = useRef(onHoverDateChange);
  onHoverDateChangeRef.current = onHoverDateChange;

  const onMoveEventDateRef = useRef(onMoveEventDate);
  onMoveEventDateRef.current = onMoveEventDate;

  const onSelectEventRef = useRef(onSelectEvent);
  onSelectEventRef.current = onSelectEvent;

  const startInteraction = useCallback(
    (
      e: React.MouseEvent,
      event: CalendarEventItem,
      mode: InteractionMode,
      eventDate: string
    ) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      const startMin = timeToMinutes(event.startTime);
      let endMin = timeToMinutes(event.endTime);
      if (endMin <= startMin) endMin = startMin + 60;

      const state: InteractionState = {
        mode,
        eventId: event.id,
        originalEvent: event,
        currentDate: eventDate,
        startMinutes: startMin,
        endMinutes: endMin,
        initialMouseX: e.clientX,
        initialMouseY: e.clientY,
        initialScrollTop: scrollContainerRef?.current?.scrollTop ?? 0,
        initialMinutes: mode === 'drag' ? startMin : mode === 'resize-top' ? startMin : endMin,
        hasMoved: false,
      };

      setActiveInteraction(state);
    },
    [scrollContainerRef]
  );

  const isActive = Boolean(activeInteraction);
  const activeMode = activeInteraction?.mode;

  useEffect(() => {
    if (!isActive) return;

    const handleMouseMove = (e: MouseEvent) => {
      const state = activeInteractionRef.current;
      if (!state) return;

      const deltaX = e.clientX - state.initialMouseX;
      const currentScrollTop = scrollContainerRef?.current?.scrollTop ?? state.initialScrollTop;
      const scrollDeltaY = currentScrollTop - state.initialScrollTop;
      const deltaY = e.clientY - state.initialMouseY + scrollDeltaY;

      // 수평(날짜 이동) 또는 수직(시간 이동) 중 어느 방향이든 4px 초과 이동 시 드래그 활성화
      const hasMoved = state.hasMoved || Math.hypot(deltaX, deltaY) > 4;

      const rawDeltaMinutes = (deltaY / pxPerHour) * 60;
      const snappedDeltaMinutes = Math.round(rawDeltaMinutes / 15) * 15;

      const minBoundary = startHour * 60;
      const maxBoundary = endHour * 60;

      const origStart = timeToMinutes(state.originalEvent.startTime);
      let origEnd = timeToMinutes(state.originalEvent.endTime);
      if (origEnd <= origStart) origEnd = origStart + 60;
      const duration = origEnd - origStart;

      let newStart = state.startMinutes;
      let newEnd = state.endMinutes;
      let nextDate = state.currentDate;

      if (state.mode === 'drag') {
        let proposedStart = origStart + snappedDeltaMinutes;
        proposedStart = Math.max(minBoundary, Math.min(maxBoundary - duration, proposedStart));
        newStart = proposedStart;
        newEnd = proposedStart + duration;

        // 다중 컬럼(주간 뷰)일 때 마우스 X 좌표를 기준으로 대상 날짜 컬럼 실시간 산출
        const dates = columnDatesRef.current;
        const gridEl = columnsGridRef.current;
        if (hasMoved && dates.length > 1 && gridEl) {
          const rect = gridEl.getBoundingClientRect();
          if (rect.width > 0) {
            const relX = e.clientX - rect.left;
            const rawIdx = Math.floor((relX / rect.width) * dates.length);
            const clampedIdx = Math.max(0, Math.min(dates.length - 1, rawIdx));
            nextDate = dates[clampedIdx];
          }
        }
      } else if (state.mode === 'resize-bottom') {
        let proposedEnd = origEnd + snappedDeltaMinutes;
        proposedEnd = Math.max(origStart + 15, Math.min(maxBoundary, proposedEnd));
        newStart = origStart;
        newEnd = proposedEnd;
      } else if (state.mode === 'resize-top') {
        let proposedStart = origStart + snappedDeltaMinutes;
        proposedStart = Math.min(origEnd - 15, Math.max(minBoundary, proposedStart));
        newStart = proposedStart;
        newEnd = origEnd;
      }

      if (hasMoved && state.mode === 'drag') {
        onHoverDateChangeRef.current?.(nextDate);
      }

      setActiveInteraction((prev) => {
        if (!prev) return null;
        if (
          prev.currentDate === nextDate &&
          prev.startMinutes === newStart &&
          prev.endMinutes === newEnd &&
          prev.hasMoved === hasMoved
        ) {
          return prev;
        }
        return {
          ...prev,
          currentDate: nextDate,
          startMinutes: newStart,
          endMinutes: newEnd,
          hasMoved,
        };
      });
    };

    const handleMouseUp = () => {
      const state = activeInteractionRef.current;
      onHoverDateChangeRef.current?.(null);

      if (!state) return;

      if (!state.hasMoved) {
        onSelectEventRef.current(state.originalEvent);
      } else {
        justDraggedRef.current = true;
        window.setTimeout(() => {
          justDraggedRef.current = false;
        }, 80);

        if (onMoveEventDateRef.current) {
          const finalStartStr = minutesToTime(state.startMinutes);
          const finalEndStr = minutesToTime(state.endMinutes);

          if (
            state.currentDate !== state.originalEvent.date ||
            finalStartStr !== state.originalEvent.startTime ||
            finalEndStr !== state.originalEvent.endTime
          ) {
            onMoveEventDateRef.current(
              state.eventId,
              state.currentDate,
              finalStartStr,
              finalEndStr
            );
          }
        }
      }

      setActiveInteraction(null);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseup', handleMouseUp);

    document.body.style.userSelect = 'none';
    document.body.style.cursor = activeMode === 'drag' ? 'grabbing' : 'ns-resize';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isActive, activeMode, pxPerHour, startHour, endHour, columnsGridRef, scrollContainerRef]);

  return {
    activeInteraction,
    justDraggedRef,
    startInteraction,
  };
}
