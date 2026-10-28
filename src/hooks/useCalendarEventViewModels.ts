import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { CalendarCategory, CalendarEventItem, ProjectItem } from '../types';
import {
  detectBrowserTimeZone,
  isValidTimeZone,
  projectEventToViewerTimeZone,
  ResolvedEventTiming,
} from '../shared/timeZoneUtils';
import { EventLuxuryTheme, resolveEventLuxuryTheme } from '../utils/eventTheme';

export interface CalendarEventViewModel {
  /** Event unique ID */
  eventId: string;
  /** Normalized viewer IANA timezone */
  viewerTimeZone: string;
  /** Composite lookup key `${viewerTimeZone}::${eventId}` */
  cacheKey: string;
  /** Raw source calendar event */
  event: CalendarEventItem;
  /** Pre-computed timezone projection in viewerTimeZone */
  timing: ResolvedEventTiming;
  /** Event projected into viewerTimeZone local date/start/end */
  projectedEvent: CalendarEventItem;
  /** Pre-computed luxury theme & linked ProjectItem */
  theme: EventLuxuryTheme;
}

export interface UseCalendarEventViewModelsParams {
  events?: readonly CalendarEventItem[];
  projects?: readonly ProjectItem[];
  viewerTimeZone?: string;
}

export interface CalendarEventViewModelsResult {
  viewerTimeZone: string;
  /** View models indexed by `eventId` for the active `viewerTimeZone` */
  byEventId: ReadonlyMap<string, CalendarEventViewModel>;
  /** View models indexed by composite `${viewerTimeZone}::${eventId}` */
  byZoneAndEventId: ReadonlyMap<string, CalendarEventViewModel>;
  /** Project luxury themes indexed by `projectId` */
  projectThemesById: ReadonlyMap<string, EventLuxuryTheme>;
  /** Ordered list of view models matching input `events` */
  viewModels: CalendarEventViewModel[];
  /** Ordered list of viewer-timezone-projected events matching input `events` */
  projectedEvents: CalendarEventItem[];
  /** Resolves (and memoizes) a view model for any single event on demand */
  getViewModel: (event: CalendarEventItem) => CalendarEventViewModel;
  /** Internal reference to source projects for context hit validation */
  readonly sourceProjects: readonly ProjectItem[];
}

interface CachedTimingEntry {
  eventRef: CalendarEventItem;
  timingSignature: string;
  timing: ResolvedEventTiming;
  projectedEvent: CalendarEventItem;
}

interface CachedThemeEntry {
  category: CalendarCategory;
  projectId: string | undefined;
  projectRef: ProjectItem | undefined;
  theme: EventLuxuryTheme;
}

interface CachedProjectThemeEntry {
  projectRef: ProjectItem;
  color: string;
  theme: EventLuxuryTheme;
}

interface ViewModelInstanceCache {
  timingByZone: Map<string, Map<string, CachedTimingEntry>>;
  themeByEventId: Map<string, CachedThemeEntry>;
  projectThemeById: Map<string, CachedProjectThemeEntry>;
  viewModelByCompositeKey: Map<string, CalendarEventViewModel>;
}

const MAX_CACHED_ZONES = 8;
const EMPTY_EVENTS: readonly CalendarEventItem[] = [];
const EMPTY_PROJECTS: readonly ProjectItem[] = [];

export function createEventViewModelKey(eventId: string, viewerTimeZone: string): string {
  return `${viewerTimeZone}::${eventId}`;
}

export function areShallowArraysEqual<T>(
  a?: readonly T[] | null,
  b?: readonly T[] | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

function createInstanceCache(): ViewModelInstanceCache {
  return {
    timingByZone: new Map(),
    themeByEventId: new Map(),
    projectThemeById: new Map(),
    viewModelByCompositeKey: new Map(),
  };
}

function clearInstanceCache(cache: ViewModelInstanceCache): void {
  cache.timingByZone.clear();
  cache.themeByEventId.clear();
  cache.projectThemeById.clear();
  cache.viewModelByCompositeKey.clear();
}

function buildTimingSignature(event: CalendarEventItem): string {
  return `${event.date}\u0000${event.startTime}\u0000${event.endTime}\u0000${
    event.isAllDay ? '1' : '0'
  }\u0000${event.timeZone || ''}\u0000${event.title}\u0000${event.location || ''}\u0000${
    event.locationAddress || ''
  }`;
}

function toProjectedEventFromTiming(
  event: CalendarEventItem,
  timing: ResolvedEventTiming
): CalendarEventItem {
  if (event.isAllDay || !timing.hasOffsetDiff) {
    return event;
  }
  return {
    ...event,
    date: timing.localDate,
    startTime: timing.localStartTime,
    endTime: timing.localEndTime,
  };
}

function getZoneTimingMap(
  cache: ViewModelInstanceCache,
  viewerTimeZone: string
): Map<string, CachedTimingEntry> {
  let zoneMap = cache.timingByZone.get(viewerTimeZone);
  if (zoneMap) {
    // Refresh insertion order for LRU eviction
    cache.timingByZone.delete(viewerTimeZone);
    cache.timingByZone.set(viewerTimeZone, zoneMap);
    return zoneMap;
  }

  if (cache.timingByZone.size >= MAX_CACHED_ZONES) {
    const oldestZone = cache.timingByZone.keys().next().value;
    if (oldestZone !== undefined) {
      cache.timingByZone.delete(oldestZone);
      const prefix = `${oldestZone}::`;
      for (const compositeKey of cache.viewModelByCompositeKey.keys()) {
        if (compositeKey.startsWith(prefix)) {
          cache.viewModelByCompositeKey.delete(compositeKey);
        }
      }
    }
  }

  zoneMap = new Map<string, CachedTimingEntry>();
  cache.timingByZone.set(viewerTimeZone, zoneMap);
  return zoneMap;
}

function resolveSingleEventViewModel(
  cache: ViewModelInstanceCache,
  zoneMap: Map<string, CachedTimingEntry>,
  projectById: ReadonlyMap<string, ProjectItem>,
  event: CalendarEventItem,
  viewerTimeZone: string
): CalendarEventViewModel {
  const eventId = event.id;

  // 1. Resolve memoized timing & projectedEvent indexed by (viewerTimeZone, eventId)
  let timingEntry = zoneMap.get(eventId);
  if (!timingEntry) {
    const timing = projectEventToViewerTimeZone(event, viewerTimeZone);
    timingEntry = {
      eventRef: event,
      timingSignature: buildTimingSignature(event),
      timing,
      projectedEvent: toProjectedEventFromTiming(event, timing),
    };
    zoneMap.set(eventId, timingEntry);
  } else if (timingEntry.eventRef !== event) {
    const nextSignature = buildTimingSignature(event);
    const timing =
      timingEntry.timingSignature === nextSignature
        ? timingEntry.timing
        : projectEventToViewerTimeZone(event, viewerTimeZone);
    timingEntry = {
      eventRef: event,
      timingSignature: nextSignature,
      timing,
      projectedEvent: toProjectedEventFromTiming(event, timing),
    };
    zoneMap.set(eventId, timingEntry);
  }

  // 2. Resolve memoized luxury theme indexed by eventId + linked ProjectItem
  const linkedProject = event.projectId ? projectById.get(event.projectId) : undefined;
  let themeEntry = cache.themeByEventId.get(eventId);
  if (
    !themeEntry ||
    themeEntry.category !== event.category ||
    themeEntry.projectId !== event.projectId ||
    themeEntry.projectRef !== linkedProject
  ) {
    const theme = resolveEventLuxuryTheme(event, linkedProject ? [linkedProject] : []);
    themeEntry = {
      category: event.category,
      projectId: event.projectId,
      projectRef: linkedProject,
      theme,
    };
    cache.themeByEventId.set(eventId, themeEntry);
  }

  // 3. Resolve composite CalendarEventViewModel indexed by `${viewerTimeZone}::${eventId}`
  const cacheKey = createEventViewModelKey(eventId, viewerTimeZone);
  const existingVm = cache.viewModelByCompositeKey.get(cacheKey);
  if (
    existingVm &&
    existingVm.event === event &&
    existingVm.timing === timingEntry.timing &&
    existingVm.projectedEvent === timingEntry.projectedEvent &&
    existingVm.theme === themeEntry.theme
  ) {
    return existingVm;
  }

  const nextVm: CalendarEventViewModel = {
    eventId,
    viewerTimeZone,
    cacheKey,
    event,
    timing: timingEntry.timing,
    projectedEvent: timingEntry.projectedEvent,
    theme: themeEntry.theme,
  };
  cache.viewModelByCompositeKey.set(cacheKey, nextVm);
  return nextVm;
}

interface CalendarEventViewModelsContextController {
  getSnapshot: () => CalendarEventViewModelsResult;
  subscribe: (listener: () => void) => () => void;
}

const CalendarEventViewModelsContext =
  createContext<CalendarEventViewModelsContextController | null>(null);

export interface CalendarEventViewModelsProviderProps {
  value: CalendarEventViewModelsResult;
  children: React.ReactNode;
}

/**
 * Provides workspace-level pre-computed event view models to descendant views
 * using a stable context controller so `React.memo` boundaries are preserved.
 */
export const CalendarEventViewModelsProvider: React.FC<CalendarEventViewModelsProviderProps> = ({
  value,
  children,
}) => {
  const listenersRef = useRef<Set<() => void>>(new Set());
  const latestValueRef = useRef<CalendarEventViewModelsResult>(value);
  latestValueRef.current = value;

  useEffect(() => {
    listenersRef.current.forEach((listener) => listener());
  }, [value]);

  const controller = useMemo<CalendarEventViewModelsContextController>(
    () => ({
      getSnapshot: () => latestValueRef.current,
      subscribe: (listener: () => void) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    []
  );

  return React.createElement(
    CalendarEventViewModelsContext.Provider,
    { value: controller },
    children
  );
};

function useShallowStableArray<T>(items: readonly T[]): readonly T[] {
  const ref = useRef<readonly T[]>(items);
  if (!areShallowArraysEqual(ref.current, items)) {
    ref.current = items;
  }
  useEffect(() => {
    return () => {
      ref.current = [];
    };
  }, []);
  return ref.current;
}

/**
 * Selector hook for subscribing to a derived slice of the nearest
 * `CalendarEventViewModelsProvider` without re-rendering when unrelated fields change.
 */
export function useCalendarEventViewModelSelector<T>(
  selector: (state: CalendarEventViewModelsResult) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  const controller = useContext(CalendarEventViewModelsContext);
  if (!controller) {
    throw new Error(
      'useCalendarEventViewModelSelector must be used within a CalendarEventViewModelsProvider.'
    );
  }

  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;

  const selectedRef = useRef<{ hasValue: boolean; value: T }>({
    hasValue: false,
    value: undefined as unknown as T,
  });

  const getSelection = () => {
    const next = selectorRef.current(controller.getSnapshot());
    if (selectedRef.current.hasValue && isEqualRef.current(selectedRef.current.value, next)) {
      return selectedRef.current.value;
    }
    selectedRef.current = { hasValue: true, value: next };
    return next;
  };

  return useSyncExternalStore(controller.subscribe, getSelection, getSelection);
}

/**
 * Pre-computes and memoizes `projectEventToViewerTimeZone`, viewer-projected events,
 * and `resolveEventLuxuryTheme` indexed by `eventId` and `viewerTimeZone`.
 *
 * - Reuses pre-computed entries from `CalendarEventViewModelsProvider` when available.
 * - Maintains incremental per-(viewerTimeZone, eventId) and per-eventId caches so
 *   unchanged events/projects never re-run timezone or theme calculations.
 */
export function useCalendarEventViewModels(
  params?: UseCalendarEventViewModelsParams
): CalendarEventViewModelsResult {
  const controller = useContext(CalendarEventViewModelsContext);
  const hasExplicitEvents = params?.events !== undefined;

  // Subscribe to context updates only when called in pure context-consumer mode (no `events` prop)
  const subscribedSnapshot = useSyncExternalStore(
    controller && !hasExplicitEvents ? controller.subscribe : () => () => {},
    () => (controller && !hasExplicitEvents ? controller.getSnapshot() : null),
    () => (controller && !hasExplicitEvents ? controller.getSnapshot() : null)
  );

  const rawEvents = params?.events ?? subscribedSnapshot?.viewModels.map((vm) => vm.event) ?? EMPTY_EVENTS;
  const rawProjects = params?.projects ?? subscribedSnapshot?.sourceProjects ?? EMPTY_PROJECTS;

  const stableEvents = useShallowStableArray(rawEvents);
  const stableProjects = useShallowStableArray(rawProjects);

  const rawViewerTimeZone = params?.viewerTimeZone ?? subscribedSnapshot?.viewerTimeZone;
  const effectiveViewerTimeZone = useMemo(
    () =>
      rawViewerTimeZone && isValidTimeZone(rawViewerTimeZone)
        ? rawViewerTimeZone
        : detectBrowserTimeZone(),
    [rawViewerTimeZone]
  );

  const instanceCacheRef = useRef<ViewModelInstanceCache | null>(null);
  if (!instanceCacheRef.current) {
    instanceCacheRef.current = createInstanceCache();
  }

  useEffect(() => {
    const cache = instanceCacheRef.current;
    return () => {
      if (cache) {
        clearInstanceCache(cache);
      }
    };
  }, []);

  const { projectById, projectThemesById } = useMemo(() => {
    const parentSnapshot = controller?.getSnapshot() ?? null;
    if (
      parentSnapshot &&
      areShallowArraysEqual(parentSnapshot.sourceProjects, stableProjects)
    ) {
      const byId = new Map<string, ProjectItem>();
      for (const proj of stableProjects) {
        byId.set(proj.id, proj);
      }
      return {
        projectById: byId,
        projectThemesById: parentSnapshot.projectThemesById,
      };
    }

    const cache = instanceCacheRef.current!;
    const byId = new Map<string, ProjectItem>();
    const themeMap = new Map<string, EventLuxuryTheme>();
    const activeIds = new Set<string>();

    for (const proj of stableProjects) {
      byId.set(proj.id, proj);
      activeIds.add(proj.id);

      let entry = cache.projectThemeById.get(proj.id);
      if (!entry || entry.projectRef !== proj || entry.color !== proj.color) {
        entry = {
          projectRef: proj,
          color: proj.color,
          theme: resolveEventLuxuryTheme({ projectId: proj.id, category: '기타' }, [proj]),
        };
        cache.projectThemeById.set(proj.id, entry);
      }
      themeMap.set(proj.id, entry.theme);
    }

    for (const cachedId of cache.projectThemeById.keys()) {
      if (!activeIds.has(cachedId)) {
        cache.projectThemeById.delete(cachedId);
      }
    }

    return {
      projectById: byId,
      projectThemesById: themeMap as ReadonlyMap<string, EventLuxuryTheme>,
    };
  }, [controller, stableProjects]);

  return useMemo<CalendarEventViewModelsResult>(() => {
    if (
      subscribedSnapshot &&
      !hasExplicitEvents &&
      subscribedSnapshot.viewerTimeZone === effectiveViewerTimeZone &&
      areShallowArraysEqual(subscribedSnapshot.sourceProjects, stableProjects)
    ) {
      return subscribedSnapshot;
    }

    const parentSnapshot = controller?.getSnapshot() ?? null;
    const canReuseParentEntries = Boolean(
      parentSnapshot &&
        parentSnapshot.viewerTimeZone === effectiveViewerTimeZone &&
        areShallowArraysEqual(parentSnapshot.sourceProjects, stableProjects)
    );

    const cache = instanceCacheRef.current!;
    const zoneMap = getZoneTimingMap(cache, effectiveViewerTimeZone);
    const byEventId = new Map<string, CalendarEventViewModel>();
    const byZoneAndEventId = new Map<string, CalendarEventViewModel>();
    const viewModels: CalendarEventViewModel[] = new Array(stableEvents.length);
    const projectedEvents: CalendarEventItem[] = new Array(stableEvents.length);
    const activeEventIds = new Set<string>();

    for (let i = 0; i < stableEvents.length; i++) {
      const ev = stableEvents[i];
      activeEventIds.add(ev.id);

      let vm: CalendarEventViewModel | undefined;
      if (canReuseParentEntries && parentSnapshot) {
        const candidate = parentSnapshot.byEventId.get(ev.id);
        if (candidate && candidate.event === ev) {
          vm = candidate;
        }
      }

      if (!vm) {
        vm = resolveSingleEventViewModel(
          cache,
          zoneMap,
          projectById,
          ev,
          effectiveViewerTimeZone
        );
      }

      byEventId.set(ev.id, vm);
      byZoneAndEventId.set(vm.cacheKey, vm);
      viewModels[i] = vm;
      projectedEvents[i] = vm.projectedEvent;
    }

    // Prune stale entries from local caches so deleted/locked events are never retained
    for (const cachedEventId of zoneMap.keys()) {
      if (!activeEventIds.has(cachedEventId)) {
        zoneMap.delete(cachedEventId);
        cache.viewModelByCompositeKey.delete(
          createEventViewModelKey(cachedEventId, effectiveViewerTimeZone)
        );
      }
    }
    for (const cachedEventId of cache.themeByEventId.keys()) {
      if (!activeEventIds.has(cachedEventId)) {
        cache.themeByEventId.delete(cachedEventId);
      }
    }

    const getViewModel = (event: CalendarEventItem): CalendarEventViewModel => {
      const directHit = byEventId.get(event.id);
      if (directHit && directHit.event === event) {
        return directHit;
      }
      if (canReuseParentEntries && parentSnapshot) {
        const parentHit = parentSnapshot.byEventId.get(event.id);
        if (parentHit && parentHit.event === event) {
          return parentHit;
        }
      }
      return resolveSingleEventViewModel(
        cache,
        zoneMap,
        projectById,
        event,
        effectiveViewerTimeZone
      );
    };

    return {
      viewerTimeZone: effectiveViewerTimeZone,
      byEventId,
      byZoneAndEventId,
      projectThemesById,
      viewModels,
      projectedEvents,
      getViewModel,
      sourceProjects: stableProjects,
    };
  }, [
    controller,
    effectiveViewerTimeZone,
    hasExplicitEvents,
    projectById,
    projectThemesById,
    stableEvents,
    stableProjects,
    subscribedSnapshot,
  ]);
}
