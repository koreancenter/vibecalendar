import React from 'react';
import { CalendarEventItem } from '../types';
import {
  TimelineInteractionMode,
  TimelineInteractionState,
  useCalendarDragAndDrop,
} from './useCalendarDragAndDrop';

export type InteractionMode = TimelineInteractionMode;
export type InteractionState = TimelineInteractionState;

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
  const { activeInteraction, justDraggedRef, startTimelineInteraction } = useCalendarDragAndDrop({
    onMoveEventDate,
    timeline: {
      startHour,
      endHour,
      pxPerHour,
      columnDates,
      columnsGridRef,
      scrollContainerRef,
      onHoverDateChange,
      onSelectEvent,
    },
  });

  return {
    activeInteraction,
    justDraggedRef,
    startInteraction: startTimelineInteraction,
  };
}
