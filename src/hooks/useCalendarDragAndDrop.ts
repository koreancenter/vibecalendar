import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CalendarEventItem } from '../types';
import { timeToMinutes, minutesToTime } from '../shared/scheduleUtils';

export type TimelineInteractionMode = 'drag' | 'resize-top' | 'resize-bottom';

export interface TimelineInteractionState {
  mode: TimelineInteractionMode;
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

export interface TimelineDragConfig {
  startHour: number;
  endHour: number;
  pxPerHour: number;
  columnDates: string[];
  columnsGridRef: React.RefObject<HTMLDivElement | null>;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  onHoverDateChange?: (date: string | null) => void;
  onSelectEvent: (event: CalendarEventItem) => void;
}

export interface UseCalendarDragAndDropOptions {
  /** Shared callback for moving/resizing an event to a target date (and optional local time slot) */
  onMoveEventDate?: (
    eventId: string,
    targetDate: string,
    targetStartTime?: string,
    targetEndTime?: string
  ) => void;
  /** When true, cell drag-over/drop only activates if a drag started from an internal calendar chip */
  requireActiveCellDrag?: boolean;
  /** Invoked synchronously when a cell chip drag starts (e.g., to dismiss hover tooltips) */
  onCellDragStart?: (eventId: string) => void;
  /** Optional pointer-based timeline drag & 15-minute resize configuration (Week & Day grids) */
  timeline?: TimelineDragConfig;
}

export interface UseCalendarDragAndDropResult {
  // HTML5 Date-Cell Drag & Drop (MonthGridView & WeekGridView all-day/headers)
  draggedEventId: string | null;
  dragOverDate: string | null;
  isCellDragging: boolean;
  handleCellDragStart: (e: React.DragEvent, eventId: string) => void;
  handleCellDragEnd: () => void;
  handleCellDragOver: (e: React.DragEvent, date: string) => void;
  handleCellDragLeave: (e: React.DragEvent, date: string) => void;
  handleCellDrop: (e: React.DragEvent, targetDate: string) => void;

  // Pointer Timeline Slot Drag & Resize (TimeGridCanvas in Week & Day views)
  activeInteraction: TimelineInteractionState | null;
  justDraggedRef: React.MutableRefObject<boolean>;
  startTimelineInteraction: (
    e: React.MouseEvent,
    event: CalendarEventItem,
    mode: TimelineInteractionMode,
    eventDate: string
  ) => void;
}

/**
 * Unified Calendar Drag-and-Drop & Resize hook shared across Month, Week, and Day views.
 *
 * - Eliminates visual flicker during HTML5 cell drag-and-drop via synchronous ref tracking,
 *   RAF-deferred source chip styling (preserving a crisp native drag ghost), and child-node
 *   `contains(relatedTarget)` boundary filtering.
 * - Eliminates timeline jitter via 15-minute snapped state transitions and deduplicated
 *   column-hover notifications.
 */
export function useCalendarDragAndDrop({
  onMoveEventDate,
  requireActiveCellDrag = false,
  onCellDragStart,
  timeline,
}: UseCalendarDragAndDropOptions): UseCalendarDragAndDropResult {
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const draggedEventIdRef = useRef<string | null>(null);
  const dragOverDateRef = useRef<string | null>(null);
  const dragStartRafRef = useRef<number | null>(null);

  const onMoveEventDateRef = useRef(onMoveEventDate);
  onMoveEventDateRef.current = onMoveEventDate;

  const onCellDragStartRef = useRef(onCellDragStart);
  onCellDragStartRef.current = onCellDragStart;

  const clearCellDragState = useCallback(() => {
    if (dragStartRafRef.current !== null) {
      window.cancelAnimationFrame(dragStartRafRef.current);
      dragStartRafRef.current = null;
    }
    draggedEventIdRef.current = null;
    dragOverDateRef.current = null;
    setDraggedEventId(null);
    setDragOverDate(null);
  }, []);

  useEffect(() => {
    return () => {
      if (dragStartRafRef.current !== null) {
        window.cancelAnimationFrame(dragStartRafRef.current);
        dragStartRafRef.current = null;
      }
    };
  }, []);

  const handleCellDragStart = useCallback((e: React.DragEvent, eventId: string) => {
    onCellDragStartRef.current?.(eventId);
    draggedEventIdRef.current = eventId;
    e.dataTransfer.setData('text/plain', eventId);
    e.dataTransfer.effectAllowed = 'move';

    if (dragStartRafRef.current !== null) {
      window.cancelAnimationFrame(dragStartRafRef.current);
    }
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      dragStartRafRef.current = window.requestAnimationFrame(() => {
        dragStartRafRef.current = null;
        if (draggedEventIdRef.current === eventId) {
          setDraggedEventId(eventId);
        }
      });
    } else {
      setDraggedEventId(eventId);
    }
  }, []);

  const handleCellDragEnd = useCallback(() => {
    clearCellDragState();
  }, [clearCellDragState]);

  const handleCellDragOver = useCallback(
    (e: React.DragEvent, date: string) => {
      if (requireActiveCellDrag && !draggedEventIdRef.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverDateRef.current !== date) {
        dragOverDateRef.current = date;
        setDragOverDate(date);
      }
    },
    [requireActiveCellDrag]
  );

  const handleCellDragLeave = useCallback((e: React.DragEvent, date: string) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    if (dragOverDateRef.current === date) {
      dragOverDateRef.current = null;
      setDragOverDate(null);
    }
  }, []);

  const handleCellDrop = useCallback(
    (e: React.DragEvent, targetDate: string) => {
      if (requireActiveCellDrag && !draggedEventIdRef.current) return;
      e.preventDefault();
      const eventId = draggedEventIdRef.current || e.dataTransfer.getData('text/plain');
      clearCellDragState();
      if (eventId) {
        onMoveEventDateRef.current?.(eventId, targetDate);
      }
    },
    [clearCellDragState, requireActiveCellDrag]
  );

  // Pointer-based Timeline Slot Drag & Resize
  const [activeInteraction, setActiveInteraction] = useState<TimelineInteractionState | null>(
    null
  );
  const justDraggedRef = useRef(false);
  const justDraggedTimerRef = useRef<number | null>(null);

  const activeInteractionRef = useRef<TimelineInteractionState | null>(null);
  activeInteractionRef.current = activeInteraction;

  const timelineRef = useRef<TimelineDragConfig | undefined>(timeline);
  timelineRef.current = timeline;

  const lastHoverDateRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (justDraggedTimerRef.current !== null) {
        window.clearTimeout(justDraggedTimerRef.current);
      }
    };
  }, []);

  const startTimelineInteraction = useCallback(
    (
      e: React.MouseEvent,
      event: CalendarEventItem,
      mode: TimelineInteractionMode,
      eventDate: string
    ) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      const startMin = timeToMinutes(event.startTime);
      let endMin = timeToMinutes(event.endTime);
      if (endMin <= startMin) endMin = startMin + 60;

      const scrollTop = timelineRef.current?.scrollContainerRef?.current?.scrollTop ?? 0;

      const state: TimelineInteractionState = {
        mode,
        eventId: event.id,
        originalEvent: event,
        currentDate: eventDate,
        startMinutes: startMin,
        endMinutes: endMin,
        initialMouseX: e.clientX,
        initialMouseY: e.clientY,
        initialScrollTop: scrollTop,
        initialMinutes: mode === 'drag' ? startMin : mode === 'resize-top' ? startMin : endMin,
        hasMoved: false,
      };

      lastHoverDateRef.current = null;
      setActiveInteraction(state);
    },
    []
  );

  const isTimelineActive = Boolean(activeInteraction);
  const activeMode = activeInteraction?.mode;
  const startHour = timeline?.startHour ?? 7;
  const endHour = timeline?.endHour ?? 23;
  const pxPerHour = timeline?.pxPerHour ?? 64;

  useEffect(() => {
    if (!isTimelineActive) return;

    const reportHoverDate = (nextHoverDate: string | null) => {
      if (lastHoverDateRef.current !== nextHoverDate) {
        lastHoverDateRef.current = nextHoverDate;
        timelineRef.current?.onHoverDateChange?.(nextHoverDate);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const state = activeInteractionRef.current;
      const cfg = timelineRef.current;
      if (!state || !cfg) return;

      const deltaX = e.clientX - state.initialMouseX;
      const currentScrollTop =
        cfg.scrollContainerRef?.current?.scrollTop ?? state.initialScrollTop;
      const scrollDeltaY = currentScrollTop - state.initialScrollTop;
      const deltaY = e.clientY - state.initialMouseY + scrollDeltaY;

      const hasMoved = state.hasMoved || Math.hypot(deltaX, deltaY) > 4;

      const rawDeltaMinutes = (deltaY / cfg.pxPerHour) * 60;
      const snappedDeltaMinutes = Math.round(rawDeltaMinutes / 15) * 15;

      const minBoundary = cfg.startHour * 60;
      const maxBoundary = cfg.endHour * 60;

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

        const dates = cfg.columnDates;
        const gridEl = cfg.columnsGridRef.current;
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
        reportHoverDate(nextDate);
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
      const cfg = timelineRef.current;
      reportHoverDate(null);

      if (!state) return;

      if (!state.hasMoved) {
        cfg?.onSelectEvent(state.originalEvent);
      } else {
        justDraggedRef.current = true;
        if (justDraggedTimerRef.current !== null) {
          window.clearTimeout(justDraggedTimerRef.current);
        }
        justDraggedTimerRef.current = window.setTimeout(() => {
          justDraggedRef.current = false;
          justDraggedTimerRef.current = null;
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
  }, [isTimelineActive, activeMode, pxPerHour, startHour, endHour]);

  return {
    draggedEventId,
    dragOverDate,
    isCellDragging: draggedEventId !== null,
    handleCellDragStart,
    handleCellDragEnd,
    handleCellDragOver,
    handleCellDragLeave,
    handleCellDrop,
    activeInteraction,
    justDraggedRef,
    startTimelineInteraction,
  };
}
