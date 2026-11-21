import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  CornerDownLeft,
  FileText,
  FolderKanban,
  Globe,
  ListTodo,
  Loader2,
  MapPin,
  Phone,
  Plus,
  Repeat,
  Search,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AiModelSelection,
  CalendarCategory,
  CalendarEventItem,
  ChecklistItem,
  ProjectItem,
  RecurrenceFrequency,
} from '../types';
import { HelpTooltip } from './common/HelpTooltip';
import { CALENDAR_CATEGORIES, CATEGORY_COLORS, getLocalizedCategory } from '../constants/categories';
import { getProjectThemeClasses } from '../constants/projects';
import { ManualEventDraft } from '../hooks/useCalendarEvents';
import { MAX_CUSTOM_LEAD_MINUTES } from '../shared/notificationSchema';
import {
  formatRecurrenceShortLabel,
  RECURRENCE_OPTIONS,
} from '../shared/recurrenceUtils';
import {
  detectBrowserTimeZone,
  getTimeZoneMeta,
  GLOBAL_EVENT_TIMEZONES,
  isValidTimeZone,
  mapEventsToViewerZone,
  TimeZoneOption,
  toViewerProjectedEvent,
} from '../shared/timeZoneUtils';
import { detectConflictAndSuggest } from '../shared/scheduleUtils';
import {
  formatCombinedLocation,
  hasValidCoordinates,
  normalizeCoordinates,
  normalizePlaceAndAddress,
  parseCoordinatePairFromString,
} from '../shared/locationUtils';
import { addDays, getTodayDateString } from '../shared/dateUtils';
import {
  DEFAULT_AI_MODEL_SELECTION,
  resolveLocationDetails,
  sendAgentCommand,
} from '../services/agentApi';
import { ensureCloudKeyHydrated } from '../utils/cloudApiKeyStorage';
import { computeNextHourSlot, parseNaturalEventText } from '../utils/naturalEventParser';

export interface EventComposerSeed {
  title?: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  isAllDay?: boolean;
  projectId?: string;
  category?: CalendarCategory;
  location?: string;
  locationAddress?: string;
  locationPhone?: string;
  locationMobilePhone?: string;
}

interface EventComposerModalProps {
  isOpen: boolean;
  seed: EventComposerSeed;
  viewerTimeZone?: string;
  existingEvents: CalendarEventItem[];
  projects: ProjectItem[];
  onClose: () => void;
  onSubmit: (draft: ManualEventDraft) => void;
}

interface ResolvedGeoSnapshot {
  combinedInput: string;
  location?: string;
  locationAddress?: string;
  locationLat?: number;
  locationLng?: number;
}

type OverrideFieldKey =
  | 'title'
  | 'date'
  | 'time'
  | 'timeZone'
  | 'category'
  | 'project'
  | 'location'
  | 'phone'
  | 'checklist'
  | 'recurrence';

type ChipPopoverKey =
  | 'date'
  | 'time'
  | 'timeZone'
  | 'category'
  | 'project'
  | 'location'
  | 'phone'
  | 'checklist'
  | 'recurrence';

async function resolveComposerAiSelection(): Promise<{
  configured: boolean;
  selection: AiModelSelection;
}> {
  const { apiKey, models } = await ensureCloudKeyHydrated();
  let parsed: Partial<AiModelSelection> | null = null;
  try {
    const raw = localStorage.getItem('vibe_ai_model_selection_v1');
    if (raw) {
      parsed = JSON.parse(raw) as Partial<AiModelSelection>;
    }
  } catch {
    parsed = null;
  }

  const savedOllamaUrl =
    typeof parsed?.ollamaBaseUrl === 'string' && parsed.ollamaBaseUrl
      ? parsed.ollamaBaseUrl
      : DEFAULT_AI_MODEL_SELECTION.ollamaBaseUrl;

  if (
    parsed &&
    (parsed.provider === 'ollama' || parsed.provider === 'webllm') &&
    typeof parsed.modelId === 'string' &&
    parsed.modelId
  ) {
    return {
      configured: true,
      selection: {
        provider: parsed.provider,
        modelId: parsed.modelId,
        displayName: parsed.displayName || parsed.modelId,
        ollamaBaseUrl: savedOllamaUrl,
      },
    };
  }

  if (apiKey && models.length > 0) {
    const matched = models.find((m) => m.id === parsed?.modelId) || models[0];
    return {
      configured: true,
      selection: {
        provider: 'cloud',
        modelId: matched.id,
        displayName: matched.label,
        ollamaBaseUrl: savedOllamaUrl,
      },
    };
  }

  return {
    configured: false,
    selection: DEFAULT_AI_MODEL_SELECTION,
  };
}

export const EventComposerModal: React.FC<EventComposerModalProps> = ({
  isOpen,
  seed,
  viewerTimeZone,
  existingEvents,
  projects,
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const safeViewerZone = useMemo(
    () =>
      viewerTimeZone && isValidTimeZone(viewerTimeZone)
        ? viewerTimeZone
        : detectBrowserTimeZone(),
    [viewerTimeZone]
  );

  const initialSeedParse = useMemo(() => {
    const baseDate = seed?.date || getTodayDateString();
    const baseStart = seed?.startTime || '10:00';
    const baseEnd = seed?.endTime || computeNextHourSlot(baseStart);
    const seedText = seed?.title || '';
    const parsed = parseNaturalEventText(seedText, {
      baseDate,
      defaultStartTime: baseStart,
      defaultEndTime: baseEnd,
      defaultIsAllDay: Boolean(seed?.isAllDay),
      defaultCategory: seed?.category || '업무',
      defaultProjectId: seed?.projectId || '',
      defaultLocation: seed?.location || '',
      defaultLocationAddress: seed?.locationAddress || '',
      defaultLocationPhone: seed?.locationPhone || '',
      defaultLocationMobilePhone: seed?.locationMobilePhone || '',
      viewerTimeZone: safeViewerZone,
      projects,
    });
    return { seedText, baseDate, baseStart, baseEnd, parsed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1. Primary Omni-Input State
  const [omniInput, setOmniInput] = useState(initialSeedParse.seedText);

  // 2. Live Parsed + Overridable Event Fields
  const [title, setTitle] = useState(
    initialSeedParse.seedText ? initialSeedParse.parsed.title : ''
  );
  const [category, setCategory] = useState<CalendarCategory>(
    initialSeedParse.seedText ? initialSeedParse.parsed.category : seed?.category || '업무'
  );
  const [date, setDate] = useState(
    initialSeedParse.seedText ? initialSeedParse.parsed.date : initialSeedParse.baseDate
  );
  const [endDate, setEndDate] = useState(
    initialSeedParse.seedText
      ? initialSeedParse.parsed.endDate || seed?.endDate || ''
      : seed?.endDate || ''
  );
  const [showEndDateInput, setShowEndDateInput] = useState(
    Boolean(
      initialSeedParse.seedText
        ? initialSeedParse.parsed.endDate || seed?.endDate
        : seed?.endDate
    )
  );
  const [isAllDay, setIsAllDay] = useState(
    initialSeedParse.seedText ? initialSeedParse.parsed.isAllDay : Boolean(seed?.isAllDay)
  );
  const [startTime, setStartTime] = useState(
    initialSeedParse.seedText ? initialSeedParse.parsed.startTime : initialSeedParse.baseStart
  );
  const [endTime, setEndTime] = useState(
    initialSeedParse.seedText ? initialSeedParse.parsed.endTime : initialSeedParse.baseEnd
  );
  const [timeZone, setTimeZone] = useState<string>(
    initialSeedParse.seedText ? initialSeedParse.parsed.timeZone : safeViewerZone
  );
  const [projectId, setProjectId] = useState<string>(
    initialSeedParse.seedText ? initialSeedParse.parsed.projectId : seed?.projectId || ''
  );

  const [locationQuery, setLocationQuery] = useState(
    formatCombinedLocation(
      initialSeedParse.seedText ? initialSeedParse.parsed.location : seed?.location,
      initialSeedParse.seedText ? initialSeedParse.parsed.locationAddress : seed?.locationAddress,
      ' · '
    )
  );
  const [resolvedGeo, setResolvedGeo] = useState<ResolvedGeoSnapshot | null>(null);

  const [locationPhone, setLocationPhone] = useState(
    initialSeedParse.seedText
      ? initialSeedParse.parsed.locationPhone
      : seed?.locationPhone || ''
  );
  const [locationMobilePhone, setLocationMobilePhone] = useState(
    initialSeedParse.seedText
      ? initialSeedParse.parsed.locationMobilePhone
      : seed?.locationMobilePhone || ''
  );
  const [content, setContent] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    initialSeedParse.seedText
      ? initialSeedParse.parsed.checklistItems.map((itemText, idx) => ({
          id: `nlp-chk-${idx}`,
          text: itemText,
          done: false,
        }))
      : []
  );
  const [newCheckText, setNewCheckText] = useState('');

  const [recurrenceFreq, setRecurrenceFreq] = useState<RecurrenceFrequency | 'none'>(
    initialSeedParse.seedText ? initialSeedParse.parsed.recurrence?.frequency || 'none' : 'none'
  );
  const [recurrenceUntil, setRecurrenceUntil] = useState('');
  const [reminderOption, setReminderOption] = useState<string>('default');
  const [customReminderMins, setCustomReminderMins] = useState<string>('25');

  // 3. Progressive Disclosure & Chip Popover State
  const [isDetailedFormOpen, setIsDetailedFormOpen] = useState(false);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const [activePopover, setActivePopover] = useState<ChipPopoverKey | null>(null);

  // 4. Micro-animation & Feedback State
  const [pulsingChips, setPulsingChips] = useState<Partial<Record<ChipPopoverKey, boolean>>>({});
  const [isAiParsing, setIsAiParsing] = useState(false);
  const [aiNotice, setAiNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [isResolvingLoc, setIsResolvingLoc] = useState(false);
  const [locNotice, setLocNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const omniInputRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const chipZoneRef = useRef<HTMLDivElement>(null);
  const manualOverridesRef = useRef<Set<OverrideFieldKey>>(new Set());
  const prevChipSignaturesRef = useRef<Partial<Record<ChipPopoverKey, string>>>({});
  const pulseTimersRef = useRef<Partial<Record<ChipPopoverKey, number>>>({});
  const aiRequestSeqRef = useRef(0);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  const triggerChipPulse = useCallback((chipKey: ChipPopoverKey) => {
    const existingTimer = pulseTimersRef.current[chipKey];
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }
    setPulsingChips((prev) => ({ ...prev, [chipKey]: true }));
    pulseTimersRef.current[chipKey] = window.setTimeout(() => {
      setPulsingChips((prev) => ({ ...prev, [chipKey]: false }));
      delete pulseTimersRef.current[chipKey];
    }, 420);
  }, []);

  const syncChipPulsesFromValues = useCallback(
    (nextSigs: Partial<Record<ChipPopoverKey, string>>, shouldPulse: boolean) => {
      const prev = prevChipSignaturesRef.current;
      if (shouldPulse) {
        (Object.keys(nextSigs) as ChipPopoverKey[]).forEach((key) => {
          if (prev[key] !== undefined && prev[key] !== nextSigs[key]) {
            triggerChipPulse(key);
          }
        });
      }
      prevChipSignaturesRef.current = nextSigs;
    },
    [triggerChipPulse]
  );

  const autoResizeOmniTextarea = useCallback(() => {
    const el = omniInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(60, Math.min(144, el.scrollHeight))}px`;
  }, []);

  // Baseline defaults derived from seed
  const baselineDefaults = useMemo(() => {
    const baseDate = seed?.date || getTodayDateString();
    const baseStart = seed?.startTime || '10:00';
    const baseEnd = seed?.endTime || computeNextHourSlot(baseStart);
    return {
      baseDate,
      baseStart,
      baseEnd,
      baseAllDay: Boolean(seed?.isAllDay),
      baseCategory: seed?.category || ('업무' as CalendarCategory),
      baseProjectId: seed?.projectId || '',
      baseLoc: seed?.location || '',
      baseAddr: seed?.locationAddress || '',
      basePhone: seed?.locationPhone || '',
      baseMobile: seed?.locationMobilePhone || '',
    };
  }, [seed]);

  // Apply deterministic parse to non-overridden fields
  const applyLiveNaturalParse = useCallback(
    (inputText: string, pulseChanges: boolean) => {
      const parsed = parseNaturalEventText(inputText, {
        baseDate: baselineDefaults.baseDate,
        defaultStartTime: baselineDefaults.baseStart,
        defaultEndTime: baselineDefaults.baseEnd,
        defaultIsAllDay: baselineDefaults.baseAllDay,
        defaultCategory: baselineDefaults.baseCategory,
        defaultProjectId: baselineDefaults.baseProjectId,
        defaultLocation: baselineDefaults.baseLoc,
        defaultLocationAddress: baselineDefaults.baseAddr,
        defaultLocationPhone: baselineDefaults.basePhone,
        defaultLocationMobilePhone: baselineDefaults.baseMobile,
        viewerTimeZone: safeViewerZone,
        projects,
      });

      const overrides = manualOverridesRef.current;

      const resolvedTitle = overrides.has('title') ? title : parsed.title;
      const resolvedDate = overrides.has('date') ? date : parsed.date;
      const resolvedEndDate = overrides.has('date') ? endDate : parsed.endDate || '';
      const resolvedStartTime = overrides.has('time') ? startTime : parsed.startTime;
      const resolvedEndTime = overrides.has('time') ? endTime : parsed.endTime;
      const resolvedAllDay = overrides.has('time') ? isAllDay : parsed.isAllDay;
      const resolvedTz = overrides.has('timeZone') ? timeZone : parsed.timeZone;
      const resolvedCategory = overrides.has('category') ? category : parsed.category;
      const resolvedProj = overrides.has('project') ? projectId : parsed.projectId;
      const parsedLocCombined = formatCombinedLocation(
        parsed.location,
        parsed.locationAddress,
        ' · '
      );
      const resolvedLocQuery = overrides.has('location') ? locationQuery : parsedLocCombined;
      const resolvedPhone = overrides.has('phone') ? locationPhone : parsed.locationPhone;
      const resolvedMobile = overrides.has('phone')
        ? locationMobilePhone
        : parsed.locationMobilePhone;
      const resolvedChecklist = overrides.has('checklist')
        ? checklist
        : parsed.checklistItems.map((itemText, idx) => ({
            id: `nlp-chk-${idx}`,
            text: itemText,
            done: false,
          }));
      const resolvedRecurrence = overrides.has('recurrence')
        ? recurrenceFreq
        : parsed.recurrence?.frequency || 'none';

      if (!overrides.has('title')) setTitle(resolvedTitle);
      if (!overrides.has('date')) {
        setDate(resolvedDate);
        setEndDate(resolvedEndDate);
        setShowEndDateInput(Boolean(resolvedEndDate));
      }
      if (!overrides.has('time')) {
        setIsAllDay(resolvedAllDay);
        setStartTime(resolvedStartTime);
        setEndTime(resolvedEndTime);
      }
      if (!overrides.has('timeZone')) setTimeZone(resolvedTz);
      if (!overrides.has('category')) setCategory(resolvedCategory);
      if (!overrides.has('project')) setProjectId(resolvedProj);
      if (!overrides.has('location')) {
        setLocationQuery(resolvedLocQuery);
        if (resolvedGeo && resolvedLocQuery !== resolvedGeo.combinedInput) {
          setResolvedGeo(null);
        }
      }
      if (!overrides.has('phone')) {
        setLocationPhone(resolvedPhone);
        setLocationMobilePhone(resolvedMobile);
      }
      if (!overrides.has('checklist')) {
        setChecklist(resolvedChecklist);
      }
      if (!overrides.has('recurrence')) {
        setRecurrenceFreq(resolvedRecurrence);
      }

      syncChipPulsesFromValues(
        {
          date: `${resolvedDate}|${resolvedEndDate}`,
          time: resolvedAllDay ? 'all-day' : `${resolvedStartTime}-${resolvedEndTime}`,
          timeZone: resolvedTz,
          category: resolvedCategory,
          project: resolvedProj,
          location: resolvedLocQuery,
          phone: `${resolvedMobile}|${resolvedPhone}`,
          checklist: resolvedChecklist.map((c) => c.text).join('|'),
          recurrence: resolvedRecurrence,
        },
        pulseChanges
      );
    },
    [
      baselineDefaults,
      safeViewerZone,
      projects,
      title,
      date,
      endDate,
      startTime,
      endTime,
      isAllDay,
      timeZone,
      category,
      projectId,
      locationQuery,
      resolvedGeo,
      locationPhone,
      locationMobilePhone,
      checklist,
      recurrenceFreq,
      syncChipPulsesFromValues,
    ]
  );

  // Initialize / Reset on modal open
  useEffect(() => {
    if (!isOpen) return;

    manualOverridesRef.current = new Set();
    aiRequestSeqRef.current += 1;

    const initialSeedText = seed?.title || '';
    const initialParsed = parseNaturalEventText(initialSeedText, {
      baseDate: baselineDefaults.baseDate,
      defaultStartTime: baselineDefaults.baseStart,
      defaultEndTime: baselineDefaults.baseEnd,
      defaultIsAllDay: baselineDefaults.baseAllDay,
      defaultCategory: baselineDefaults.baseCategory,
      defaultProjectId: baselineDefaults.baseProjectId,
      defaultLocation: baselineDefaults.baseLoc,
      defaultLocationAddress: baselineDefaults.baseAddr,
      defaultLocationPhone: baselineDefaults.basePhone,
      defaultLocationMobilePhone: baselineDefaults.baseMobile,
      viewerTimeZone: safeViewerZone,
      projects,
    });

    const initDate = initialSeedText ? initialParsed.date : baselineDefaults.baseDate;
    const initEndDate = initialSeedText
      ? initialParsed.endDate || seed?.endDate || ''
      : seed?.endDate || '';
    const initAllDay = initialSeedText ? initialParsed.isAllDay : baselineDefaults.baseAllDay;
    const initStart = initialSeedText ? initialParsed.startTime : baselineDefaults.baseStart;
    const initEnd = initialSeedText ? initialParsed.endTime : baselineDefaults.baseEnd;
    const initTz = initialSeedText ? initialParsed.timeZone : safeViewerZone;
    const initCat = initialSeedText ? initialParsed.category : baselineDefaults.baseCategory;
    const initProj = initialSeedText ? initialParsed.projectId : baselineDefaults.baseProjectId;
    const initLoc = formatCombinedLocation(
      initialSeedText ? initialParsed.location : baselineDefaults.baseLoc,
      initialSeedText ? initialParsed.locationAddress : baselineDefaults.baseAddr,
      ' · '
    );
    const initPhone = initialSeedText ? initialParsed.locationPhone : baselineDefaults.basePhone;
    const initMobile = initialSeedText
      ? initialParsed.locationMobilePhone
      : baselineDefaults.baseMobile;
    const initChecklist = initialSeedText
      ? initialParsed.checklistItems.map((tItem, idx) => ({
          id: `nlp-chk-${idx}`,
          text: tItem,
          done: false,
        }))
      : [];
    const initRecurrence = initialSeedText
      ? initialParsed.recurrence?.frequency || 'none'
      : 'none';

    setOmniInput(initialSeedText);
    setTitle(initialSeedText ? initialParsed.title : '');
    setCategory(initCat);
    setDate(initDate);
    setEndDate(initEndDate);
    setShowEndDateInput(Boolean(initEndDate));
    setIsAllDay(initAllDay);
    setStartTime(initStart);
    setEndTime(initEnd);
    setTimeZone(initTz);
    setProjectId(initProj);
    setLocationQuery(initLoc);
    setResolvedGeo(null);
    setLocationPhone(initPhone);
    setLocationMobilePhone(initMobile);
    setContent('');
    setChecklist(initChecklist);
    setNewCheckText('');
    setRecurrenceFreq(initRecurrence);
    setRecurrenceUntil('');
    setReminderOption('default');
    setCustomReminderMins('25');

    setIsDetailedFormOpen(false);
    setIsDetailsExpanded(Boolean(initPhone || initMobile || initChecklist.length > 0));
    setActivePopover(null);
    setPulsingChips({});
    setIsAiParsing(false);
    setAiNotice(null);
    setIsResolvingLoc(false);
    setLocNotice(null);
    setFormError(null);

    prevChipSignaturesRef.current = {
      date: `${initDate}|${initEndDate}`,
      time: initAllDay ? 'all-day' : `${initStart}-${initEnd}`,
      timeZone: initTz,
      category: initCat,
      project: initProj,
      location: initLoc,
      phone: `${initMobile}|${initPhone}`,
      checklist: initChecklist.map((c) => c.text).join('|'),
      recurrence: initRecurrence,
    };

    const timer = window.setTimeout(() => {
      omniInputRef.current?.focus();
      autoResizeOmniTextarea();
    }, 40);

    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, seed, safeViewerZone]);

  useEffect(() => {
    const timersMap = pulseTimersRef.current;
    return () => {
      Object.values(timersMap).forEach((id) => {
        if (id) window.clearTimeout(id);
      });
    };
  }, []);

  // Close popover first on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (activePopover) {
          setActivePopover(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activePopover, onClose]);

  useEffect(() => {
    if (!isOpen || !activePopover) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (chipZoneRef.current && !chipZoneRef.current.contains(e.target as Node)) {
        setActivePopover(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, activePopover]);

  const timeZoneOptions = useMemo(() => {
    const map = new Map<string, TimeZoneOption>();
    for (const tz of GLOBAL_EVENT_TIMEZONES) {
      map.set(tz.iana, tz);
    }
    if (!map.has(safeViewerZone)) {
      map.set(safeViewerZone, {
        iana: safeViewerZone,
        shortCode: 'LOCAL',
        cityKo: safeViewerZone,
        cityEn: safeViewerZone,
        countryKo: '현재 위치',
      });
    }
    return Array.from(map.values());
  }, [safeViewerZone]);

  const activeTimeZoneMeta = useMemo(() => getTimeZoneMeta(timeZone), [timeZone]);

  const selectedProject = useMemo(
    () => (projectId ? projects.find((p) => p.id === projectId) ?? null : null),
    [projectId, projects]
  );

  const selectedProjectTheme = useMemo(
    () => getProjectThemeClasses(selectedProject?.color),
    [selectedProject?.color]
  );

  const liveConflict = useMemo(() => {
    if (!isOpen || isAllDay || !date || !startTime || !endTime || endTime <= startTime) {
      return null;
    }
    const probeEvent: CalendarEventItem = {
      id: '__composer_probe__',
      title: title || omniInput.trim() || '새 일정',
      date,
      startTime,
      endTime,
      timeZone: timeZone || safeViewerZone,
      isAllDay: false,
      category,
    };
    const projectedProbe = toViewerProjectedEvent(probeEvent, safeViewerZone);
    const projectedExisting = mapEventsToViewerZone(existingEvents, safeViewerZone);
    const result = detectConflictAndSuggest(
      projectedProbe.date,
      projectedProbe.startTime,
      projectedProbe.endTime,
      projectedExisting
    );
    return result.hasConflict ? result : null;
  }, [
    isOpen,
    isAllDay,
    date,
    startTime,
    endTime,
    timeZone,
    safeViewerZone,
    title,
    omniInput,
    category,
    existingEvents,
  ]);

  if (!isOpen) return null;

  const markManualOverride = (field: OverrideFieldKey) => {
    manualOverridesRef.current.add(field);
  };

  const handleOmniInputChange = (nextVal: string) => {
    setOmniInput(nextVal);
    if (formError) setFormError(null);
    if (aiNotice) setAiNotice(null);
    applyLiveNaturalParse(nextVal, true);
    window.requestAnimationFrame(autoResizeOmniTextarea);
  };

  const handleStartTimeChange = (nextStart: string) => {
    markManualOverride('time');
    setStartTime(nextStart);
    if (nextStart >= endTime) {
      setEndTime(computeNextHourSlot(nextStart));
    }
    triggerChipPulse('time');
    setFormError(null);
  };

  const handleLocationQueryChange = (nextVal: string) => {
    markManualOverride('location');
    setLocationQuery(nextVal);
    if (resolvedGeo && nextVal.trim() !== resolvedGeo.combinedInput) {
      setResolvedGeo(null);
    }
    if (locNotice) {
      setLocNotice(null);
    }
  };

  const handleAddChecklistDraft = () => {
    const trimmed = newCheckText.trim();
    if (!trimmed) return;
    markManualOverride('checklist');
    setChecklist((prev) => [
      ...prev,
      {
        id: `cchk-${Date.now()}-${prev.length}`,
        text: trimmed,
        done: false,
      },
    ]);
    setNewCheckText('');
    triggerChipPulse('checklist');
  };

  const handleAutoResolveLocation = async () => {
    if (isResolvingLoc) return;
    const rawInput = locationQuery.trim();
    const fallbackQuery = rawInput || title.trim() || omniInput.trim();
    if (!fallbackQuery) {
      setLocNotice('탐색할 장소명이나 주소를 먼저 입력해 주세요.');
      return;
    }

    const parsedInput = normalizePlaceAndAddress(rawInput);
    setIsResolvingLoc(true);
    setLocNotice(null);

    try {
      const res = await resolveLocationDetails({
        location: parsedInput.location || fallbackQuery,
        locationAddress: parsedInput.locationAddress,
      });

      if (!isOpenRef.current) return;

      if (res.found) {
        const nextLoc = res.location || parsedInput.location || rawInput || fallbackQuery;
        const nextAddr = res.locationAddress || parsedInput.locationAddress;
        const coords = normalizeCoordinates(res.locationLat, res.locationLng);
        const combined = formatCombinedLocation(nextLoc, nextAddr, ' · ');

        markManualOverride('location');
        setLocationQuery(combined);
        setResolvedGeo({
          combinedInput: combined,
          location: nextLoc || undefined,
          locationAddress: nextAddr || undefined,
          locationLat: coords.locationLat,
          locationLng: coords.locationLng,
        });
        triggerChipPulse('location');
        setLocNotice(
          hasValidCoordinates(coords.locationLat, coords.locationLng)
            ? `좌표 확인됨 · ${coords.locationLat!.toFixed(5)}, ${coords.locationLng!.toFixed(5)}`
            : '도로명 주소가 확인되었습니다.'
        );
      } else {
        setLocNotice('일치하는 상세 주소를 찾지 못했습니다. 장소·주소를 직접 입력할 수 있습니다.');
      }
    } catch (err: unknown) {
      if (!isOpenRef.current) return;
      setLocNotice(
        err instanceof Error && err.message
          ? err.message
          : '장소 자동 탐색 중 오류가 발생했습니다.'
      );
    } finally {
      if (isOpenRef.current) {
        setIsResolvingLoc(false);
      }
    }
  };

  const handleAiDeepParse = async () => {
    const rawPrompt = omniInput.trim();
    if (!rawPrompt) {
      setAiNotice({ kind: 'info', text: '분석할 자연어 일정 문장을 먼저 입력해 주세요.' });
      omniInputRef.current?.focus();
      return;
    }
    if (isAiParsing) return;

    setIsAiParsing(true);
    setAiNotice(null);
    const reqId = ++aiRequestSeqRef.current;

    try {
      const { configured, selection } = await resolveComposerAiSelection();
      if (!isOpenRef.current || aiRequestSeqRef.current !== reqId) return;

      if (!configured) {
        setAiNotice({
          kind: 'error',
          text: 'AI 어시스턴트 설정에서 Gemini API Key 또는 로컬 모델을 연결하면 정밀 분석을 사용할 수 있습니다.',
        });
        return;
      }

      const extractionPrompt = [
        '다음 단일 문장에서 일정 1개의 세부 정보(제목, 날짜, 시작/종료 시각, 종일 여부, 시간대, 카테고리, 소속 프로젝트, 장소명과 상세 도로명 주소, 연락처, 사전 준비 체크리스트, 반복 주기, 상세 메모)를 정밀 추출하여 CREATE_EVENT로 반환해 주세요.',
        `입력 문장: "${rawPrompt}"`,
      ].join('\n');

      const res = await sendAgentCommand(
        extractionPrompt,
        {
          currentYear: parseInt((date || baselineDefaults.baseDate).slice(0, 4), 10) || 2026,
          selectedDate: date || baselineDefaults.baseDate,
          viewerTimeZone: safeViewerZone,
          existingEvents,
          projects,
          selectedProjectId: projectId || 'all',
        },
        undefined,
        undefined,
        selection
      );

      if (!isOpenRef.current || aiRequestSeqRef.current !== reqId) return;

      const extracted = res.createdEvents?.[0];
      if (!extracted) {
        setAiNotice({
          kind: 'info',
          text: '추가 세부 항목을 추출하지 못해 실시간 파싱 결과를 유지합니다.',
        });
        return;
      }

      const nextTitle = extracted.title?.trim() || title || rawPrompt;
      setTitle(nextTitle);
      markManualOverride('title');

      if (extracted.date && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)) {
        setDate(extracted.date);
        const nextEndDate =
          extracted.endDate && extracted.endDate > extracted.date ? extracted.endDate : '';
        setEndDate(nextEndDate);
        setShowEndDateInput(Boolean(nextEndDate));
        markManualOverride('date');
        triggerChipPulse('date');
      }

      if (typeof extracted.isAllDay === 'boolean') {
        setIsAllDay(extracted.isAllDay);
      }
      if (extracted.startTime) {
        setStartTime(extracted.startTime);
      }
      if (extracted.endTime) {
        setEndTime(extracted.endTime);
      }
      if (extracted.startTime || extracted.endTime || typeof extracted.isAllDay === 'boolean') {
        markManualOverride('time');
        triggerChipPulse('time');
      }

      if (extracted.timeZone && isValidTimeZone(extracted.timeZone)) {
        setTimeZone(extracted.timeZone);
        markManualOverride('timeZone');
        triggerChipPulse('timeZone');
      }

      if (extracted.category && CALENDAR_CATEGORIES.includes(extracted.category)) {
        setCategory(extracted.category);
        markManualOverride('category');
        triggerChipPulse('category');
      }

      if (extracted.projectId && projects.some((p) => p.id === extracted.projectId)) {
        setProjectId(extracted.projectId);
        markManualOverride('project');
        triggerChipPulse('project');
      }

      if (extracted.location || extracted.locationAddress) {
        const combined = formatCombinedLocation(
          extracted.location,
          extracted.locationAddress,
          ' · '
        );
        const coords = normalizeCoordinates(extracted.locationLat, extracted.locationLng);
        setLocationQuery(combined);
        setResolvedGeo({
          combinedInput: combined,
          location: extracted.location || undefined,
          locationAddress: extracted.locationAddress || undefined,
          locationLat: coords.locationLat,
          locationLng: coords.locationLng,
        });
        markManualOverride('location');
        triggerChipPulse('location');
      }

      if (extracted.locationPhone || extracted.locationMobilePhone) {
        if (extracted.locationPhone) setLocationPhone(extracted.locationPhone);
        if (extracted.locationMobilePhone) setLocationMobilePhone(extracted.locationMobilePhone);
        markManualOverride('phone');
        triggerChipPulse('phone');
      }

      if (extracted.content) {
        setContent(extracted.content);
      }

      if (Array.isArray(extracted.checklist) && extracted.checklist.length > 0) {
        setChecklist(
          extracted.checklist.map((item, idx) => ({
            id: item.id || `ai-chk-${Date.now()}-${idx}`,
            text: item.text,
            done: Boolean(item.done),
          }))
        );
        markManualOverride('checklist');
        triggerChipPulse('checklist');
      }

      if (extracted.recurrence?.frequency) {
        setRecurrenceFreq(extracted.recurrence.frequency);
        if (extracted.recurrence.until) {
          setRecurrenceUntil(extracted.recurrence.until);
        }
        markManualOverride('recurrence');
        triggerChipPulse('recurrence');
      }

      setAiNotice({ kind: 'info', text: 'AI 정밀 분석 결과가 라이브 프리뷰에 반영되었습니다.' });
    } catch (err: unknown) {
      if (!isOpenRef.current || aiRequestSeqRef.current !== reqId) return;
      setAiNotice({
        kind: 'error',
        text:
          err instanceof Error && err.message
            ? err.message
            : 'AI 정밀 분석 중 오류가 발생했습니다.',
      });
    } finally {
      if (isOpenRef.current && aiRequestSeqRef.current === reqId) {
        setIsAiParsing(false);
      }
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const resolvedFinalTitle = title.trim() || omniInput.trim();
    if (!resolvedFinalTitle) {
      setFormError('일정 내용이나 제목을 입력해 주세요.');
      omniInputRef.current?.focus();
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setFormError('유효한 시작 날짜를 선택해 주세요.');
      return;
    }
    if (endDate && endDate < date) {
      setFormError('종료일은 시작일 이후여야 합니다.');
      return;
    }
    if (!isAllDay && endTime <= startTime) {
      setFormError('종료 시간은 시작 시간보다 늦어야 합니다.');
      return;
    }
    if (recurrenceFreq !== 'none' && recurrenceUntil && recurrenceUntil < date) {
      setFormError('반복 종료일은 시작일 이후여야 합니다.');
      return;
    }

    const pendingChecks = newCheckText.trim()
      ? [
          ...checklist,
          { id: `cchk-${Date.now()}-last`, text: newCheckText.trim(), done: false },
        ]
      : checklist;

    const trimmedLocQuery = locationQuery.trim();
    let finalLocation: string | undefined;
    let finalAddress: string | undefined;
    let finalLat: number | undefined;
    let finalLng: number | undefined;

    if (trimmedLocQuery) {
      if (resolvedGeo && trimmedLocQuery === resolvedGeo.combinedInput) {
        finalLocation = resolvedGeo.location;
        finalAddress = resolvedGeo.locationAddress;
        finalLat = resolvedGeo.locationLat;
        finalLng = resolvedGeo.locationLng;
      } else {
        const directCoords = parseCoordinatePairFromString(trimmedLocQuery);
        if (directCoords) {
          finalLocation = trimmedLocQuery;
          finalLat = directCoords.lat;
          finalLng = directCoords.lng;
        } else {
          const normalized = normalizePlaceAndAddress(trimmedLocQuery);
          finalLocation = normalized.location || trimmedLocQuery;
          finalAddress = normalized.locationAddress;
        }
      }
    }

    let resolvedReminderMinutes: number[] | undefined;
    if (reminderOption === 'off') {
      resolvedReminderMinutes = [];
    } else if (reminderOption === 'custom') {
      const parsedCustom = Number(customReminderMins);
      if (
        !Number.isFinite(parsedCustom) ||
        parsedCustom < 0 ||
        parsedCustom > MAX_CUSTOM_LEAD_MINUTES
      ) {
        setFormError(`커스텀 알림 시간은 0 ~ ${MAX_CUSTOM_LEAD_MINUTES}분 사이로 입력해 주세요.`);
        return;
      }
      resolvedReminderMinutes = [Math.round(parsedCustom)];
    } else if (reminderOption !== 'default') {
      resolvedReminderMinutes = reminderOption
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= MAX_CUSTOM_LEAD_MINUTES);
    }

    onSubmit({
      title: resolvedFinalTitle,
      date,
      endDate: endDate && endDate > date ? endDate : undefined,
      startTime,
      endTime,
      timeZone: isAllDay ? undefined : timeZone === safeViewerZone ? undefined : timeZone,
      isAllDay,
      category,
      projectId: projectId || undefined,
      location: finalLocation,
      locationAddress: finalAddress,
      locationLat: finalLat,
      locationLng: finalLng,
      locationPhone: locationPhone.trim() || undefined,
      locationMobilePhone: locationMobilePhone.trim() || undefined,
      content: content.trim() || undefined,
      checklist: pendingChecks.length > 0 ? pendingChecks : undefined,
      recurrence:
        recurrenceFreq !== 'none'
          ? {
              frequency: recurrenceFreq,
              ...(recurrenceUntil && recurrenceUntil >= date ? { until: recurrenceUntil } : {}),
            }
          : undefined,
      reminderMinutes: resolvedReminderMinutes,
    });
    onClose();
  };

  const handleFormKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const activeCategoryStyle = CATEGORY_COLORS[category] || CATEGORY_COLORS['업무'];
  const combinedPhoneDisplay = locationMobilePhone || locationPhone;
  const totalChecklistCount = checklist.length + (newCheckText.trim() ? 1 : 0);
  const recurrenceShort =
    recurrenceFreq !== 'none' ? formatRecurrenceShortLabel({ frequency: recurrenceFreq }) : '';

  const optionalSummaryCount =
    (content.trim() ? 1 : 0) +
    totalChecklistCount +
    (locationPhone.trim() || locationMobilePhone.trim() ? 1 : 0) +
    (reminderOption !== 'default' ? 1 : 0);

  const togglePopover = (key: ChipPopoverKey) => {
    setActivePopover((prev) => (prev === key ? null : key));
  };

  const durationMinutes = (() => {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    if ([sh, sm, eh, em].some((v) => !Number.isFinite(v))) return 60;
    return Math.max(15, eh * 60 + em - (sh * 60 + sm));
  })();

  const todayIso = getTodayDateString();
  const tomorrowIso = addDays(todayIso, 1);
  const dayAfterIso = addDays(todayIso, 2);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/68 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="새 일정 등록"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        onKeyDown={handleFormKeyDown}
        className={`luxury-glass-border relative w-full ${
          isDetailedFormOpen ? 'max-w-3xl' : 'max-w-2xl'
        } transition-[max-width] duration-200 bg-gradient-to-b from-[#171b26]/95 via-[#11141d]/96 to-[#0c0e15]/98 backdrop-blur-xl backdrop-saturate-150 rounded-2xl shadow-[0_24px_56px_-12px_rgba(0,0,0,0.82),0_8px_20px_-4px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col max-h-[92dvh]`}
      >
        {/* 헤더 */}
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-neutral-300 min-w-0">
            <Calendar className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <span className="font-semibold text-white tracking-tight">새 일정 등록</span>
            <span aria-hidden="true" className="text-neutral-600">
              ·
            </span>
            <span className="font-mono tabular-nums text-neutral-400">{date}</span>
            <HelpTooltip
              title="자연어 빠른 등록"
              content="날짜·시간·장소·연락처·준비물을 한 문장으로 입력하면 실시간으로 분석되어 칩으로 표시됩니다. 각 칩을 클릭해 세부 값을 바로 수정할 수 있습니다."
              align="left"
              placement="bottom"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="닫기 (Esc)"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 overflow-y-auto select-text space-y-3.5">
          {/* 1. Primary Single Omni-Input Surface */}
          <div className="rounded-xl bg-white/[0.025] border border-white/[0.09] px-4 pt-3.5 pb-2.5">
            <textarea
              ref={omniInputRef}
              rows={2}
              value={omniInput}
              onChange={(e) => handleOmniInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.metaKey &&
                  !e.ctrlKey &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229
                ) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="예: 내일 오후 2시 강남역 코엑스 3층 파트너사 미팅 010-1234-5678 (준비물: 제안서 출력)"
              aria-label="자연어 일정 빠른 입력"
              className="w-full bg-transparent text-[15px] leading-relaxed font-medium text-white placeholder:text-neutral-500/80 outline-none no-focus-outline resize-none"
            />

            <div className="mt-2 pt-2 border-t border-white/[0.05] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {omniInput.trim() && title.trim() && title.trim() !== omniInput.trim() ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400 min-w-0">
                    <span className="text-neutral-500 shrink-0">제목</span>
                    <span className="text-neutral-200 font-medium truncate max-w-[260px]">
                      {title}
                    </span>
                  </span>
                ) : (
                  <span className="text-[11px] text-neutral-500 whitespace-nowrap">
                    Enter 등록 · Shift+Enter 줄바꿈
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleAiDeepParse()}
                disabled={isAiParsing}
                title="AI 모델로 장소 주소, 체크리스트, 시차 등을 정밀 추출해 프리뷰에 반영합니다"
                className="h-6.5 px-2.5 rounded-md bg-white/[0.05] hover:bg-white/[0.11] border border-white/[0.09] hover:border-white/[0.20] text-[11px] font-medium text-neutral-200 hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {isAiParsing ? (
                  <Loader2 className="w-3 h-3 animate-spin text-indigo-300 shrink-0" />
                ) : (
                  <Sparkles className="w-3 h-3 text-amber-300 shrink-0" />
                )}
                <span>{isAiParsing ? '정밀 분석 중...' : 'AI 정밀 분석'}</span>
              </button>
            </div>
          </div>

          {aiNotice && (
            <p
              className={`text-[11.5px] px-1 ${
                aiNotice.kind === 'error' ? 'text-amber-300' : 'text-indigo-200'
              }`}
            >
              {aiNotice.text}
            </p>
          )}

          {/* 2. Real-Time Live Extracted Chips + Compact Inline Popover */}
          <div ref={chipZoneRef} className="relative space-y-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Date Chip */}
              <button
                type="button"
                onClick={() => togglePopover('date')}
                className={`h-7 px-2.5 rounded-md border text-[11.5px] font-mono tabular-nums inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  pulsingChips.date ? 'chip-detected-pulse ' : ''
                }${
                  activePopover === 'date'
                    ? 'bg-white/[0.13] border-white/[0.28] text-white'
                    : 'bg-white/[0.03] border-white/[0.09] hover:border-white/[0.20] text-neutral-200'
                }`}
                title="날짜 수정"
              >
                <Calendar className="w-3 h-3 text-neutral-400 shrink-0" />
                <span>
                  {date}
                  {endDate && endDate > date ? ` ~ ${endDate.slice(5)}` : ''}
                </span>
              </button>

              {/* Time Chip */}
              <button
                type="button"
                onClick={() => togglePopover('time')}
                className={`h-7 px-2.5 rounded-md border text-[11.5px] font-mono tabular-nums inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  pulsingChips.time ? 'chip-detected-pulse ' : ''
                }${
                  activePopover === 'time'
                    ? 'bg-white/[0.13] border-white/[0.28] text-white'
                    : 'bg-white/[0.03] border-white/[0.09] hover:border-white/[0.20] text-neutral-200'
                }`}
                title="시간 및 종일 여부 수정"
              >
                <Clock className="w-3 h-3 text-neutral-400 shrink-0" />
                <span>{isAllDay ? '종일' : `${startTime} – ${endTime}`}</span>
              </button>

              {/* Timezone Chip */}
              {!isAllDay && (
                <button
                  type="button"
                  onClick={() => togglePopover('timeZone')}
                  className={`h-7 px-2.5 rounded-md border text-[11.5px] font-mono inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    pulsingChips.timeZone ? 'chip-detected-pulse ' : ''
                  }${
                    activePopover === 'timeZone'
                      ? 'bg-white/[0.13] border-white/[0.28] text-white'
                      : timeZone !== safeViewerZone
                      ? 'bg-indigo-500/15 border-indigo-400/35 text-indigo-100 hover:border-indigo-300/50'
                      : 'bg-white/[0.025] border-white/[0.07] hover:border-white/[0.18] text-neutral-400 hover:text-neutral-200'
                  }`}
                  title="기준 시간대 변경"
                >
                  <Globe className="w-3 h-3 shrink-0 opacity-80" />
                  <span>
                    {activeTimeZoneMeta.shortCode}
                    {timeZone !== safeViewerZone ? ` · ${activeTimeZoneMeta.cityKo}` : ''}
                  </span>
                </button>
              )}

              {/* Category Badge */}
              <button
                type="button"
                onClick={() => togglePopover('category')}
                className={`h-7 px-2.5 rounded-md border text-[11.5px] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  pulsingChips.category ? 'chip-detected-pulse ' : ''
                }${
                  activePopover === 'category'
                    ? 'bg-white/[0.13] border-white/[0.28] text-white'
                    : 'bg-white/[0.03] border-white/[0.09] hover:border-white/[0.20] text-neutral-200'
                }`}
                title="카테고리 변경"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeCategoryStyle.dot}`} />
                <span>{getLocalizedCategory(category, t)}</span>
              </button>

              {/* Contextual Project Badge */}
              {projects.length > 0 && (
                <button
                  type="button"
                  onClick={() => togglePopover('project')}
                  className={`h-7 px-2.5 rounded-md border text-[11.5px] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 max-w-[190px] ${
                    pulsingChips.project ? 'chip-detected-pulse ' : ''
                  }${
                    activePopover === 'project'
                      ? 'bg-white/[0.13] border-white/[0.28] text-white'
                      : selectedProject
                      ? `${selectedProjectTheme.chipSurfaceClass} hover:border-white/[0.25]`
                      : 'bg-white/[0.02] border-white/[0.07] hover:border-white/[0.18] text-neutral-400 hover:text-neutral-200'
                  }`}
                  title="소속 프로젝트 지정"
                >
                  {selectedProject ? (
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedProjectTheme.dotClass}`}
                    />
                  ) : (
                    <FolderKanban className="w-3 h-3 shrink-0 opacity-75" />
                  )}
                  <span className="truncate">
                    {selectedProject ? selectedProject.name : '프로젝트'}
                  </span>
                </button>
              )}

              {/* Extracted Location Chip */}
              <button
                type="button"
                onClick={() => togglePopover('location')}
                className={`h-7 px-2.5 rounded-md border text-[11.5px] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 max-w-[230px] ${
                  pulsingChips.location ? 'chip-detected-pulse ' : ''
                }${
                  activePopover === 'location'
                    ? 'bg-white/[0.13] border-white/[0.28] text-white'
                    : locationQuery
                    ? 'bg-white/[0.03] border-white/[0.11] hover:border-white/[0.22] text-neutral-100'
                    : 'bg-white/[0.02] border-white/[0.07] hover:border-white/[0.18] text-neutral-400 hover:text-neutral-200'
                }`}
                title={locationQuery || '장소 또는 도로명 주소 입력'}
              >
                <MapPin className="w-3 h-3 text-neutral-400 shrink-0" />
                <span className="truncate">{locationQuery || '장소'}</span>
              </button>

              {/* Extracted Phone Chip */}
              {(combinedPhoneDisplay || activePopover === 'phone') && (
                <button
                  type="button"
                  onClick={() => togglePopover('phone')}
                  className={`h-7 px-2.5 rounded-md border text-[11.5px] font-mono tabular-nums inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    pulsingChips.phone ? 'chip-detected-pulse ' : ''
                  }${
                    activePopover === 'phone'
                      ? 'bg-white/[0.13] border-white/[0.28] text-white'
                      : 'bg-white/[0.03] border-white/[0.11] hover:border-white/[0.22] text-neutral-200'
                  }`}
                  title="장소 및 담당자 연락처 편집"
                >
                  {locationMobilePhone ? (
                    <Smartphone className="w-3 h-3 text-emerald-400 shrink-0" />
                  ) : (
                    <Phone className="w-3 h-3 text-sky-400 shrink-0" />
                  )}
                  <span>{combinedPhoneDisplay || '연락처'}</span>
                </button>
              )}

              {/* Extracted Checklist Count Chip */}
              {(totalChecklistCount > 0 || activePopover === 'checklist') && (
                <button
                  type="button"
                  onClick={() => togglePopover('checklist')}
                  className={`h-7 px-2.5 rounded-md border text-[11.5px] tabular-nums inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    pulsingChips.checklist ? 'chip-detected-pulse ' : ''
                  }${
                    activePopover === 'checklist'
                      ? 'bg-white/[0.13] border-white/[0.28] text-white'
                      : 'bg-white/[0.03] border-white/[0.11] hover:border-white/[0.22] text-neutral-200'
                  }`}
                  title="사전 준비 체크리스트 편집"
                >
                  <ListTodo className="w-3 h-3 text-neutral-400 shrink-0" />
                  <span>체크리스트 {totalChecklistCount}</span>
                </button>
              )}

              {/* Extracted Recurrence Chip */}
              {recurrenceShort && (
                <button
                  type="button"
                  onClick={() => togglePopover('recurrence')}
                  className={`h-7 px-2.5 rounded-md border text-[11.5px] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    pulsingChips.recurrence ? 'chip-detected-pulse ' : ''
                  }${
                    activePopover === 'recurrence'
                      ? 'bg-white/[0.13] border-white/[0.28] text-white'
                      : 'bg-white/[0.03] border-white/[0.11] hover:border-white/[0.22] text-neutral-200'
                  }`}
                  title="반복 주기 수정"
                >
                  <Repeat className="w-3 h-3 text-neutral-400 shrink-0" />
                  <span>{recurrenceShort}</span>
                </button>
              )}
            </div>

            {/* Compact Inline Override Popover */}
            {activePopover && (
              <div
                className="p-3 rounded-xl bg-[#151924]/98 border border-white/[0.12] shadow-[0_14px_36px_rgba(0,0,0,0.62)] space-y-2.5"
                role="region"
                aria-label="선택 항목 빠른 편집"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-neutral-300">
                    {activePopover === 'date' && '날짜 및 다일 기간'}
                    {activePopover === 'time' && '시간 및 종일 설정'}
                    {activePopover === 'timeZone' && '기준 시간대 선택'}
                    {activePopover === 'category' && '카테고리 변경'}
                    {activePopover === 'project' && '소속 프로젝트 선택'}
                    {activePopover === 'location' && '장소 및 주소 검색'}
                    {activePopover === 'phone' && '유선 및 현장 연락처'}
                    {activePopover === 'checklist' && '사전 준비 체크리스트'}
                    {activePopover === 'recurrence' && '반복 주기 설정'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActivePopover(null)}
                    className="text-[11px] text-neutral-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-white/[0.07] transition-colors cursor-pointer"
                  >
                    완료
                  </button>
                </div>

                {activePopover === 'date' && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[
                        { label: '오늘', val: todayIso },
                        { label: '내일', val: tomorrowIso },
                        { label: '모레', val: dayAfterIso },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            markManualOverride('date');
                            setDate(preset.val);
                            if (endDate && endDate < preset.val) setEndDate('');
                            triggerChipPulse('date');
                          }}
                          className={`h-6.5 px-2.5 rounded-md border text-[11px] cursor-pointer transition-colors ${
                            date === preset.val
                              ? 'bg-white/[0.14] border-white/[0.28] text-white'
                              : 'bg-white/[0.02] border-white/[0.08] text-neutral-300 hover:border-white/[0.18]'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => {
                          markManualOverride('date');
                          setDate(e.target.value);
                          if (endDate && endDate < e.target.value) setEndDate('');
                          triggerChipPulse('date');
                        }}
                        className="h-8 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.10] text-xs font-mono tabular-nums text-neutral-100 outline-none [color-scheme:dark]"
                      />
                      {showEndDateInput ? (
                        <div className="inline-flex items-center gap-1.5">
                          <span className="text-xs text-neutral-500">~</span>
                          <input
                            type="date"
                            min={date}
                            value={endDate}
                            onChange={(e) => {
                              markManualOverride('date');
                              setEndDate(e.target.value);
                              triggerChipPulse('date');
                            }}
                            className="h-8 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.10] text-xs font-mono tabular-nums text-neutral-100 outline-none [color-scheme:dark]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              markManualOverride('date');
                              setEndDate('');
                              setShowEndDateInput(false);
                            }}
                            className="p-1 text-neutral-400 hover:text-white cursor-pointer"
                            title="종료일 해제"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            markManualOverride('date');
                            setShowEndDateInput(true);
                            if (!endDate) setEndDate(date);
                          }}
                          className="h-8 px-2.5 rounded-lg border border-white/[0.08] hover:border-white/[0.18] text-[11px] text-neutral-300 cursor-pointer"
                        >
                          + 종료일 추가
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {activePopover === 'time' && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-white/[0.03] border border-white/[0.08] text-xs text-neutral-200 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isAllDay}
                          onChange={(e) => {
                            markManualOverride('time');
                            setIsAllDay(e.target.checked);
                            triggerChipPulse('time');
                          }}
                          className="rounded border-white/20 bg-[#0d1017] accent-white cursor-pointer"
                        />
                        <span>종일</span>
                      </label>

                      {!isAllDay && (
                        <>
                          <input
                            type="time"
                            value={startTime}
                            onChange={(e) => handleStartTimeChange(e.target.value)}
                            className="h-8 px-2 rounded-lg bg-white/[0.03] border border-white/[0.10] text-xs font-mono tabular-nums text-neutral-100 outline-none [color-scheme:dark]"
                          />
                          <span className="text-xs text-neutral-500">–</span>
                          <input
                            type="time"
                            value={endTime}
                            onChange={(e) => {
                              markManualOverride('time');
                              setEndTime(e.target.value);
                              triggerChipPulse('time');
                            }}
                            className="h-8 px-2 rounded-lg bg-white/[0.03] border border-white/[0.10] text-xs font-mono tabular-nums text-neutral-100 outline-none [color-scheme:dark]"
                          />
                          {[30, 60, 120].map((mins) => (
                            <button
                              key={mins}
                              type="button"
                              onClick={() => {
                                markManualOverride('time');
                                setEndTime(computeNextHourSlot(startTime, mins));
                                triggerChipPulse('time');
                              }}
                              className={`h-7 px-2 rounded-md border text-[11px] font-mono tabular-nums cursor-pointer transition-colors ${
                                durationMinutes === mins
                                  ? 'bg-white/[0.13] border-white/[0.25] text-white'
                                  : 'bg-white/[0.02] border-white/[0.08] text-neutral-300 hover:border-white/[0.18]'
                              }`}
                            >
                              {mins >= 60 ? `${mins / 60}h` : `${mins}m`}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {activePopover === 'timeZone' && (
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                    {timeZoneOptions.map((tz) => {
                      const active = timeZone === tz.iana;
                      return (
                        <button
                          key={tz.iana}
                          type="button"
                          onClick={() => {
                            markManualOverride('timeZone');
                            setTimeZone(tz.iana);
                            triggerChipPulse('timeZone');
                            setActivePopover(null);
                          }}
                          className={`h-7 px-2.5 rounded-md border text-[11px] inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                            active
                              ? 'bg-white/[0.14] border-white/[0.28] text-white font-medium'
                              : 'bg-white/[0.02] border-white/[0.07] text-neutral-300 hover:border-white/[0.18]'
                          }`}
                        >
                          <span className="font-mono text-neutral-400">{tz.shortCode}</span>
                          <span>{tz.cityKo}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {activePopover === 'category' && (
                  <div className="flex flex-wrap gap-1.5">
                    {CALENDAR_CATEGORIES.map((cat) => {
                      const active = category === cat;
                      const style = CATEGORY_COLORS[cat];
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            markManualOverride('category');
                            setCategory(cat);
                            triggerChipPulse('category');
                            setActivePopover(null);
                          }}
                          className={`h-7 px-2.5 rounded-md border text-xs inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                            active
                              ? 'bg-white/[0.14] border-white/[0.28] text-white font-medium'
                              : 'bg-white/[0.02] border-white/[0.07] text-neutral-300 hover:border-white/[0.18]'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                          <span>{getLocalizedCategory(cat, t)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {activePopover === 'project' && (
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => {
                        markManualOverride('project');
                        setProjectId('');
                        triggerChipPulse('project');
                        setActivePopover(null);
                      }}
                      className={`h-7 px-2.5 rounded-md border text-xs inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                        !projectId
                          ? 'bg-white/[0.14] border-white/[0.28] text-white font-medium'
                          : 'bg-white/[0.02] border-white/[0.07] text-neutral-300 hover:border-white/[0.18]'
                      }`}
                    >
                      <span>일반 일정 (미지정)</span>
                    </button>
                    {projects.map((proj) => {
                      const active = projectId === proj.id;
                      const theme = getProjectThemeClasses(proj.color);
                      return (
                        <button
                          key={proj.id}
                          type="button"
                          onClick={() => {
                            markManualOverride('project');
                            setProjectId(proj.id);
                            triggerChipPulse('project');
                            setActivePopover(null);
                          }}
                          className={`h-7 px-2.5 rounded-md border text-xs inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                            active
                              ? 'bg-white/[0.14] border-white/[0.28] text-white font-medium'
                              : 'bg-white/[0.02] border-white/[0.07] text-neutral-300 hover:border-white/[0.18]'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${theme.dotClass}`} />
                          <span className="truncate max-w-[180px]">{proj.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {activePopover === 'location' && (
                  <div className="space-y-1.5">
                    <div className="relative flex items-center">
                      <MapPin className="pointer-events-none absolute left-2.5 w-3.5 h-3.5 text-neutral-400" />
                      <input
                        type="text"
                        value={locationQuery}
                        onChange={(e) => handleLocationQueryChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                            e.preventDefault();
                            void handleAutoResolveLocation();
                          }
                        }}
                        placeholder="장소명 또는 도로명 주소 검색 (Enter로 좌표 탐색)"
                        className="w-full h-8.5 pl-8 pr-16 rounded-lg bg-white/[0.03] border border-white/[0.10] text-xs text-neutral-100 placeholder:text-neutral-500 outline-none"
                      />
                      <div className="absolute right-1.5 flex items-center gap-0.5">
                        {locationQuery && (
                          <button
                            type="button"
                            onClick={() => {
                              markManualOverride('location');
                              setLocationQuery('');
                              setResolvedGeo(null);
                              setLocNotice(null);
                            }}
                            className="h-6 w-6 rounded inline-flex items-center justify-center text-neutral-400 hover:text-white cursor-pointer"
                            title="지우기"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleAutoResolveLocation()}
                          disabled={isResolvingLoc}
                          className="h-6.5 w-6.5 rounded inline-flex items-center justify-center text-neutral-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.12] cursor-pointer disabled:opacity-50"
                          title="주소·좌표 탐색"
                        >
                          {isResolvingLoc ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Search className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    {locNotice && (
                      <p className="text-[11px] text-neutral-400 font-mono tabular-nums">
                        {locNotice}
                      </p>
                    )}
                  </div>
                )}

                {activePopover === 'phone' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10.5px] text-neutral-400 mb-1">
                        유선 대표번호
                      </label>
                      <input
                        type="tel"
                        value={locationPhone}
                        onChange={(e) => {
                          markManualOverride('phone');
                          setLocationPhone(e.target.value);
                        }}
                        placeholder="예: 02-588-4100"
                        className="w-full h-8 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.10] text-xs font-mono tabular-nums text-neutral-100 placeholder:text-neutral-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10.5px] text-neutral-400 mb-1">
                        현장 담당자 모바일
                      </label>
                      <input
                        type="tel"
                        value={locationMobilePhone}
                        onChange={(e) => {
                          markManualOverride('phone');
                          setLocationMobilePhone(e.target.value);
                        }}
                        placeholder="예: 010-1234-5678"
                        className="w-full h-8 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.10] text-xs font-mono tabular-nums text-neutral-100 placeholder:text-neutral-500 outline-none"
                      />
                    </div>
                  </div>
                )}

                {activePopover === 'checklist' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={newCheckText}
                        onChange={(e) => setNewCheckText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                            e.preventDefault();
                            handleAddChecklistDraft();
                          }
                        }}
                        placeholder="준비물 또는 체크 항목 입력 후 Enter"
                        className="flex-1 h-8 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.10] text-xs text-neutral-100 placeholder:text-neutral-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAddChecklistDraft}
                        className="h-8 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-xs text-neutral-200 cursor-pointer whitespace-nowrap"
                      >
                        추가
                      </button>
                    </div>
                    {checklist.length > 0 && (
                      <ul className="max-h-28 overflow-y-auto divide-y divide-white/[0.05]">
                        {checklist.map((item) => (
                          <li
                            key={item.id}
                            className="flex items-center justify-between gap-2 py-1 text-xs text-neutral-200"
                          >
                            <span className="inline-flex items-center gap-1.5 truncate">
                              <Check className="w-3 h-3 text-neutral-500 shrink-0" />
                              <span className="truncate">{item.text}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                markManualOverride('checklist');
                                setChecklist((prev) => prev.filter((c) => c.id !== item.id));
                              }}
                              className="p-0.5 text-neutral-500 hover:text-rose-300 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {activePopover === 'recurrence' && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {RECURRENCE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          markManualOverride('recurrence');
                          setRecurrenceFreq(opt.value);
                          if (opt.value === 'none') setRecurrenceUntil('');
                          triggerChipPulse('recurrence');
                        }}
                        className={`h-7 px-2.5 rounded-md border text-xs cursor-pointer transition-colors ${
                          recurrenceFreq === opt.value
                            ? 'bg-white/[0.14] border-white/[0.28] text-white font-medium'
                            : 'bg-white/[0.02] border-white/[0.07] text-neutral-300 hover:border-white/[0.18]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. Real-Time Conflict Detection Banner */}
          {liveConflict && (
            <div className="pt-0.5 flex items-center justify-between gap-2 text-[11px] text-amber-300">
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span className="truncate" title={liveConflict.message}>
                  {liveConflict.message}
                </span>
              </span>
              {liveConflict.suggestedSlots[0] && (
                <button
                  type="button"
                  onClick={() => {
                    markManualOverride('time');
                    setStartTime(liveConflict.suggestedSlots[0].startTime);
                    setEndTime(liveConflict.suggestedSlots[0].endTime);
                    triggerChipPulse('time');
                  }}
                  className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-[10.5px] font-mono tabular-nums text-amber-200 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {liveConflict.suggestedSlots[0].startTime}–
                  {liveConflict.suggestedSlots[0].endTime} 적용
                </button>
              )}
            </div>
          )}

          {formError && <p className="text-xs text-rose-400 font-medium">{formError}</p>}

          {/* 4. Progressive Disclosure Fallback: 기존 2단 세부 필드 편집 드로어 */}
          {isDetailedFormOpen && (
            <div className="pt-4 border-t border-white/[0.07] grid grid-cols-1 md:grid-cols-[1.12fr_0.88fr] gap-5 md:gap-6 items-start">
              {/* 좌측 컬럼: 제목 · 카테고리 칩 · 프로젝트 · 일시/시간대 · 반복/알림 */}
              <div className="space-y-3.5 min-w-0">
                <div>
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={title}
                    onChange={(e) => {
                      markManualOverride('title');
                      setTitle(e.target.value);
                      if (formError) setFormError(null);
                    }}
                    placeholder="일정 제목 직접 입력"
                    className="w-full h-9.5 px-3.5 rounded-lg bg-white/[0.03] border border-white/[0.10] text-sm font-medium text-white placeholder:text-neutral-500 outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    {CALENDAR_CATEGORIES.map((cat) => {
                      const active = category === cat;
                      const style = CATEGORY_COLORS[cat];
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            markManualOverride('category');
                            setCategory(cat);
                          }}
                          className={`h-7 px-2.5 rounded-md text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                            active
                              ? 'bg-white/[0.12] border-white/[0.24] text-white font-medium'
                              : 'bg-transparent border-white/[0.06] text-neutral-400 hover:text-neutral-200 hover:border-white/[0.14]'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                          <span>{getLocalizedCategory(cat, t)}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 min-w-0">
                    {selectedProject ? (
                      <div
                        className={`inline-flex items-center gap-1.5 h-6.5 pl-2.5 pr-1.5 rounded-md border text-xs max-w-full ${selectedProjectTheme.chipSurfaceClass}`}
                        title={`소속 프로젝트: ${selectedProject.name}`}
                      >
                        <FolderKanban className="w-3 h-3 text-neutral-400 shrink-0" />
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedProjectTheme.dotClass}`}
                        />
                        <span className="truncate font-medium max-w-[220px]">
                          {selectedProject.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            markManualOverride('project');
                            setProjectId('');
                          }}
                          className="p-0.5 rounded hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer shrink-0"
                          title="프로젝트 지정 해제"
                          aria-label="프로젝트 지정 해제"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : projects.length > 0 ? (
                      <div className="relative inline-flex items-center">
                        <FolderKanban className="pointer-events-none absolute left-2.5 w-3 h-3 text-neutral-400" />
                        <select
                          value={projectId}
                          onChange={(e) => {
                            markManualOverride('project');
                            setProjectId(e.target.value);
                          }}
                          aria-label="소속 프로젝트 선택"
                          className="h-6.5 pl-7 pr-6 rounded-md bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] hover:border-white/[0.16] text-[11.5px] text-neutral-300 outline-hidden cursor-pointer appearance-none transition-colors max-w-[240px] truncate"
                        >
                          <option value="" className="bg-[#12151e] text-neutral-300">
                            프로젝트 연결 (일반 일정)
                          </option>
                          {projects.map((p) => (
                            <option
                              key={p.id}
                              value={p.id}
                              className="bg-[#12151e] text-neutral-100"
                            >
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 w-3 h-3 text-neutral-500" />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="pt-3.5 border-t border-white/5 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="date"
                      value={date}
                      aria-label="시작 날짜"
                      onChange={(e) => {
                        markManualOverride('date');
                        setDate(e.target.value);
                        if (endDate && endDate < e.target.value) setEndDate('');
                        if (recurrenceUntil && recurrenceUntil < e.target.value) {
                          setRecurrenceUntil('');
                        }
                        if (formError) setFormError(null);
                      }}
                      className="h-8.5 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.09] text-xs font-mono tabular-nums text-neutral-100 outline-none [color-scheme:dark] shrink-0"
                    />

                    {showEndDateInput && (
                      <div className="inline-flex items-center gap-1 shrink-0">
                        <span className="text-xs text-neutral-500">~</span>
                        <input
                          type="date"
                          min={date}
                          value={endDate}
                          aria-label="종료 날짜"
                          onChange={(e) => {
                            markManualOverride('date');
                            setEndDate(e.target.value);
                            if (formError) setFormError(null);
                          }}
                          className="h-8.5 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.09] text-xs font-mono tabular-nums text-neutral-100 outline-none [color-scheme:dark]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            markManualOverride('date');
                            setEndDate('');
                            setShowEndDateInput(false);
                          }}
                          className="p-1 rounded text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
                          title="종료일 해제"
                          aria-label="종료일 해제"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {!isAllDay && (
                      <div className="inline-flex items-center gap-1 shrink-0">
                        <input
                          type="time"
                          value={startTime}
                          aria-label="시작 시간"
                          onChange={(e) => handleStartTimeChange(e.target.value)}
                          className="h-8.5 px-2 rounded-lg bg-white/[0.03] border border-white/[0.09] text-xs font-mono tabular-nums text-neutral-100 outline-none [color-scheme:dark]"
                        />
                        <span className="text-xs text-neutral-500">–</span>
                        <input
                          type="time"
                          value={endTime}
                          aria-label="종료 시간"
                          onChange={(e) => {
                            markManualOverride('time');
                            setEndTime(e.target.value);
                            if (formError) setFormError(null);
                          }}
                          className="h-8.5 px-2 rounded-lg bg-white/[0.03] border border-white/[0.09] text-xs font-mono tabular-nums text-neutral-100 outline-none [color-scheme:dark]"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md bg-white/[0.02] border border-white/[0.07] hover:border-white/[0.15] text-neutral-300 cursor-pointer select-none whitespace-nowrap shrink-0 transition-colors">
                      <input
                        type="checkbox"
                        checked={isAllDay}
                        onChange={(e) => {
                          markManualOverride('time');
                          setIsAllDay(e.target.checked);
                        }}
                        className="rounded border-white/20 bg-[#0d1017] accent-white cursor-pointer"
                      />
                      <span>종일</span>
                    </label>

                    {!isAllDay && (
                      <div className="relative inline-flex items-center shrink-0">
                        <Globe className="pointer-events-none absolute left-2 w-3 h-3 text-neutral-400" />
                        <select
                          value={timeZone}
                          onChange={(e) => {
                            markManualOverride('timeZone');
                            setTimeZone(e.target.value);
                          }}
                          aria-label="기준 시간대"
                          className="h-7 pl-6.5 pr-5.5 rounded-md bg-white/[0.02] border border-white/[0.07] hover:border-white/[0.15] text-[11.5px] font-mono text-neutral-200 outline-hidden cursor-pointer appearance-none transition-colors"
                        >
                          {timeZoneOptions.map((tz) => (
                            <option
                              key={tz.iana}
                              value={tz.iana}
                              className="bg-[#12151e] text-neutral-100"
                            >
                              {tz.shortCode} · {tz.cityKo}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-1.5 w-3 h-3 text-neutral-500" />
                      </div>
                    )}

                    {!showEndDateInput && (
                      <button
                        type="button"
                        onClick={() => {
                          markManualOverride('date');
                          setShowEndDateInput(true);
                          if (!endDate) setEndDate(date);
                        }}
                        className="h-7 px-2 rounded-md border border-white/[0.07] hover:border-white/[0.16] text-[11.5px] text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        + 종료일
                      </button>
                    )}

                    <div className="relative inline-flex items-center shrink-0">
                      <Repeat className="pointer-events-none absolute left-2 w-3 h-3 text-neutral-400" />
                      <select
                        value={recurrenceFreq}
                        onChange={(e) => {
                          markManualOverride('recurrence');
                          const nextVal = e.target.value as RecurrenceFrequency | 'none';
                          setRecurrenceFreq(nextVal);
                          if (nextVal === 'none') {
                            setRecurrenceUntil('');
                          }
                        }}
                        aria-label="반복 주기"
                        className="h-7 pl-6.5 pr-5.5 rounded-md bg-white/[0.02] border border-white/[0.07] hover:border-white/[0.15] text-[11.5px] text-neutral-300 outline-hidden cursor-pointer appearance-none transition-colors"
                      >
                        {RECURRENCE_OPTIONS.map((opt) => (
                          <option
                            key={opt.value}
                            value={opt.value}
                            className="bg-[#12151e] text-neutral-100"
                          >
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-1.5 w-3 h-3 text-neutral-500" />
                    </div>

                    {recurrenceFreq !== 'none' && (
                      <input
                        type="date"
                        min={date}
                        value={recurrenceUntil}
                        onChange={(e) => {
                          markManualOverride('recurrence');
                          setRecurrenceUntil(e.target.value);
                        }}
                        title="반복 종료일 (미지정 시 계속 반복)"
                        aria-label="반복 종료일"
                        className="h-7 px-2 rounded-md bg-white/[0.03] border border-white/[0.09] text-[11.5px] font-mono tabular-nums text-neutral-200 outline-none [color-scheme:dark] shrink-0"
                      />
                    )}

                    <div className="relative inline-flex items-center shrink-0">
                      <Bell className="pointer-events-none absolute left-2 w-3 h-3 text-neutral-400" />
                      <select
                        value={reminderOption}
                        onChange={(e) => {
                          setReminderOption(e.target.value);
                          if (formError) setFormError(null);
                        }}
                        aria-label="일정 알림 리드타임"
                        className="h-7 pl-6.5 pr-5.5 rounded-md bg-white/[0.02] border border-white/[0.07] hover:border-white/[0.15] text-[11.5px] text-neutral-300 outline-hidden cursor-pointer appearance-none transition-colors tabular-nums"
                      >
                        <option value="default" className="bg-[#12151e] text-neutral-100">
                          기본 알림 따름
                        </option>
                        <option value="off" className="bg-[#12151e] text-neutral-100">
                          이 일정 알림 끔
                        </option>
                        <option value="0" className="bg-[#12151e] text-neutral-100">
                          정각 (시작 시각)
                        </option>
                        <option value="5" className="bg-[#12151e] text-neutral-100">
                          5분 전
                        </option>
                        <option value="10" className="bg-[#12151e] text-neutral-100">
                          10분 전
                        </option>
                        <option value="15" className="bg-[#12151e] text-neutral-100">
                          15분 전
                        </option>
                        <option value="30" className="bg-[#12151e] text-neutral-100">
                          30분 전
                        </option>
                        <option value="60" className="bg-[#12151e] text-neutral-100">
                          1시간 전
                        </option>
                        <option value="10,60" className="bg-[#12151e] text-neutral-100">
                          1시간 + 10분 전
                        </option>
                        <option value="1440" className="bg-[#12151e] text-neutral-100">
                          하루 전 (24시간)
                        </option>
                        <option value="custom" className="bg-[#12151e] text-neutral-100">
                          분 직접 입력...
                        </option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-1.5 w-3 h-3 text-neutral-500" />
                    </div>

                    {reminderOption === 'custom' && (
                      <div className="inline-flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          min={0}
                          max={MAX_CUSTOM_LEAD_MINUTES}
                          value={customReminderMins}
                          onChange={(e) => {
                            setCustomReminderMins(e.target.value);
                            if (formError) setFormError(null);
                          }}
                          aria-label="커스텀 알림 분 입력"
                          className="h-7 w-16 px-2 rounded-md bg-white/[0.03] border border-white/[0.12] text-[11.5px] font-mono tabular-nums text-neutral-100 outline-none"
                        />
                        <span className="text-[11px] text-neutral-400 whitespace-nowrap">
                          분 전
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 우측 컬럼: 스마트 장소 검색 + 메모 · 연락처 · 체크리스트 */}
              <div className="space-y-3.5 min-w-0 pt-3.5 border-t border-white/5 md:pt-0 md:border-t-0 md:border-l md:border-white/5 md:pl-6">
                <div className="space-y-1.5">
                  <div className="relative flex items-center">
                    <MapPin className="pointer-events-none absolute left-3 w-3.5 h-3.5 text-neutral-400 shrink-0" />
                    <input
                      type="text"
                      value={locationQuery}
                      onChange={(e) => handleLocationQueryChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                          e.preventDefault();
                          void handleAutoResolveLocation();
                        }
                      }}
                      placeholder="장소명 또는 도로명 주소 검색 (Enter로 좌표 탐색)"
                      className="w-full h-9.5 pl-8.5 pr-15 rounded-lg bg-white/[0.03] border border-white/[0.10] text-xs text-neutral-100 placeholder:text-neutral-500 outline-none"
                    />
                    <div className="absolute right-1.5 flex items-center gap-0.5">
                      {locationQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            markManualOverride('location');
                            setLocationQuery('');
                            setResolvedGeo(null);
                            setLocNotice(null);
                          }}
                          className="h-6.5 w-6.5 rounded-md inline-flex items-center justify-center text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
                          title="장소 입력 지우기"
                          aria-label="장소 입력 지우기"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleAutoResolveLocation()}
                        disabled={isResolvingLoc}
                        className="h-7 w-7 rounded-md inline-flex items-center justify-center text-neutral-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.10] disabled:opacity-50 transition-colors cursor-pointer"
                        title="도로명 주소 및 위경도 자동 탐색 (Enter)"
                        aria-label="도로명 주소 및 위경도 자동 탐색"
                      >
                        {isResolvingLoc ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Search className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {locNotice && (
                    <p className="text-[11px] text-neutral-400 font-mono tabular-nums truncate">
                      {locNotice}
                    </p>
                  )}
                </div>

                {!isDetailsExpanded ? (
                  <button
                    type="button"
                    onClick={() => setIsDetailsExpanded(true)}
                    className="w-full h-9.5 px-3 rounded-lg border border-dashed border-white/[0.10] hover:border-white/[0.22] hover:bg-white/[0.025] text-xs text-neutral-400 hover:text-neutral-200 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-1.5 font-medium whitespace-nowrap">
                      <Plus className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span>메모 · 연락처 · 체크리스트</span>
                    </span>
                    {optionalSummaryCount > 0 ? (
                      <span className="text-[11px] font-mono tabular-nums text-neutral-300 whitespace-nowrap shrink-0">
                        작성됨 ({optionalSummaryCount})
                      </span>
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                    )}
                  </button>
                ) : (
                  <div className="pt-3 border-t border-white/5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] font-medium text-neutral-300 inline-flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        <span>상세 메모 · 연락처 · 체크리스트</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsDetailsExpanded(false)}
                        className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <span>접기</span>
                        <ChevronUp className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10.5px] text-neutral-400 mb-1 flex items-center gap-1">
                          <Phone className="w-3 h-3 text-sky-400 shrink-0" />
                          <span>장소 대표 유선 전화</span>
                        </label>
                        <input
                          type="tel"
                          value={locationPhone}
                          onChange={(e) => {
                            markManualOverride('phone');
                            setLocationPhone(e.target.value);
                          }}
                          placeholder="예: 02-588-4100"
                          className="w-full h-8 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.09] text-xs font-mono tabular-nums text-neutral-100 placeholder:text-neutral-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10.5px] text-neutral-400 mb-1 flex items-center gap-1">
                          <Smartphone className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span>현장 담당자 모바일</span>
                        </label>
                        <input
                          type="tel"
                          value={locationMobilePhone}
                          onChange={(e) => {
                            markManualOverride('phone');
                            setLocationMobilePhone(e.target.value);
                          }}
                          placeholder="예: 010-8492-3104"
                          className="w-full h-8 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.09] text-xs font-mono tabular-nums text-neutral-100 placeholder:text-neutral-500 outline-none"
                        />
                      </div>
                    </div>

                    <textarea
                      rows={2}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="담당자 안내, 반입 동선, 특이사항 기록..."
                      className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.09] text-xs text-neutral-100 placeholder:text-neutral-500 outline-none resize-none leading-relaxed"
                    />

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <div className="relative flex-1 min-w-0 flex items-center">
                          <ListTodo className="pointer-events-none absolute left-2.5 w-3.5 h-3.5 text-neutral-500 shrink-0" />
                          <input
                            type="text"
                            value={newCheckText}
                            onChange={(e) => setNewCheckText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                                e.preventDefault();
                                handleAddChecklistDraft();
                              }
                            }}
                            placeholder="사전 준비 항목 입력 후 Enter"
                            className="w-full h-8 pl-8 pr-2.5 rounded-lg bg-white/[0.03] border border-white/[0.09] text-xs text-neutral-100 placeholder:text-neutral-500 outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleAddChecklistDraft}
                          className="h-8 px-2.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.11] border border-white/[0.08] text-xs text-neutral-200 inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                          title="체크리스트 항목 추가"
                        >
                          <Plus className="w-3.5 h-3.5 shrink-0" />
                          <span>추가</span>
                        </button>
                      </div>

                      {checklist.length > 0 && (
                        <ul className="max-h-24 overflow-y-auto divide-y divide-white/5">
                          {checklist.map((item) => (
                            <li
                              key={item.id}
                              className="flex items-center justify-between gap-2 py-1 px-1 text-xs text-neutral-200"
                            >
                              <span className="truncate">{item.text}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  markManualOverride('checklist');
                                  setChecklist((prev) => prev.filter((c) => c.id !== item.id));
                                }}
                                className="p-0.5 text-neutral-500 hover:text-rose-300 transition-colors cursor-pointer shrink-0"
                                title="항목 삭제"
                                aria-label="항목 삭제"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 푸터: 좌측 세부 필드 토글 + 우측 취소/일정 등록 */}
        <div className="px-5 py-3 border-t border-white/[0.06] bg-white/[0.015] flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setIsDetailedFormOpen((v) => !v)}
            className="h-7.5 px-2.5 rounded-md text-xs text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.05] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {isDetailedFormOpen ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                <span>세부 필드 접기</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>세부 필드 직접 편집</span>
                {optionalSummaryCount > 0 && (
                  <span className="text-[10.5px] font-mono tabular-nums text-neutral-300">
                    ({optionalSummaryCount})
                  </span>
                )}
              </>
            )}
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              title="취소 (Esc)"
              className="h-8.5 px-4 rounded-lg border border-white/[0.09] bg-white/[0.03] hover:bg-white/[0.08] text-xs font-medium text-neutral-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              취소
            </button>
            <button
              type="submit"
              title="일정 등록 (Enter 또는 ⌘/Ctrl + Enter)"
              className="h-8.5 px-4 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>일정 등록</span>
              <CornerDownLeft className="w-3 h-3 opacity-70 shrink-0" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
