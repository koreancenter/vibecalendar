import React, { createContext, useContext } from 'react';
import { CalendarEventItem } from '../types';
import { EventHistoryActionKind, EventHistoryEntry } from '../utils/eventHistoryDiff';

export const MAX_EVENT_HISTORY_STACK = 50;

export interface RecordEventHistoryMeta {
  kind: EventHistoryActionKind;
  label: string;
  detail?: string;
  targetEventId?: string;
  targetEventTitle?: string;
  focusDate?: string;
}

export interface EventHistoryContextValue {
  past: EventHistoryEntry[];
  future: EventHistoryEntry[];
  canUndo: boolean;
  canRedo: boolean;
  undoStep: () => boolean;
  redoStep: () => boolean;
  revertToEntry: (entryId: string) => boolean;
  restoreEventSnapshot: (entryId: string, targetMasterId: string) => boolean;
  getEntriesForEvent: (targetMasterId: string) => EventHistoryEntry[];
  clearHistory: () => void;
}

const EventHistoryContext = createContext<EventHistoryContextValue | null>(null);

export const EventHistoryProvider: React.FC<{
  value: EventHistoryContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => {
  return <EventHistoryContext.Provider value={value}>{children}</EventHistoryContext.Provider>;
};

export function useEventHistoryOptional(): EventHistoryContextValue | null {
  return useContext(EventHistoryContext);
}
