import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Calendar,
  ChevronDown,
  ChevronUp,
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
  X,
} from 'lucide-react';
import {
  CalendarCategory,
  CalendarEventItem,
  ChecklistItem,
  ProjectItem,
  RecurrenceFrequency,
} from '../types';
import { CALENDAR_CATEGORIES, CATEGORY_COLORS } from '../constants/categories';
import { getProjectThemeClasses } from '../constants/projects';
import { ManualEventDraft } from '../hooks/useCalendarEvents';
import { MAX_CUSTOM_LEAD_MINUTES } from '../shared/notificationSchema';
import { RECURRENCE_OPTIONS } from '../shared/recurrenceUtils';
import {
  detectBrowserTimeZone,
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
import { resolveLocationDetails } from '../services/agentApi';

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

function computeNextHourSlot(startTime: string): string {
  const [hStr, mStr] = startTime.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '11:00';
  const total = Math.min(23 * 60 + 45, h * 60 + m + 60);
  const nextH = Math.floor(total / 60);
  const nextM = total % 60;
  return `${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`;
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
  const safeViewerZone = useMemo(
    () =>
      viewerTimeZone && isValidTimeZone(viewerTimeZone)
        ? viewerTimeZone
        : detectBrowserTimeZone(),
    [viewerTimeZone]
  );

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<CalendarCategory>('업무');
  const [date, setDate] = useState(seed.date);
  const [endDate, setEndDate] = useState('');
  const [showEndDateInput, setShowEndDateInput] = useState(false);
  const [isAllDay, setIsAllDay] = useState(false);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [timeZone, setTimeZone] = useState<string>(safeViewerZone);
  const [projectId, setProjectId] = useState<string>('');

  // 단일 스마트 장소·주소 검색 필드 상태
  const [locationQuery, setLocationQuery] = useState('');
  const [resolvedGeo, setResolvedGeo] = useState<ResolvedGeoSnapshot | null>(null);

  // 점진적 공개(Progressive Disclosure): 메모 및 사전 체크리스트
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const [locationPhone, setLocationPhone] = useState(seed.locationPhone || '');
  const [locationMobilePhone, setLocationMobilePhone] = useState(seed.locationMobilePhone || '');
  const [content, setContent] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newCheckText, setNewCheckText] = useState('');

  const [recurrenceFreq, setRecurrenceFreq] = useState<RecurrenceFrequency | 'none'>('none');
  const [recurrenceUntil, setRecurrenceUntil] = useState('');
  const [reminderOption, setReminderOption] = useState<string>('default');
  const [customReminderMins, setCustomReminderMins] = useState<string>('25');

  const [isResolvingLoc, setIsResolvingLoc] = useState(false);
  const [locNotice, setLocNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(seed.title || '');
    setCategory(seed.category || '업무');
    setDate(seed.date);
    setEndDate(seed.endDate || '');
    setShowEndDateInput(Boolean(seed.endDate));
    setIsAllDay(Boolean(seed.isAllDay));
    const initStart = seed.startTime || '10:00';
    const initEnd = seed.endTime || computeNextHourSlot(initStart);
    setStartTime(initStart);
    setEndTime(initEnd);
    setTimeZone(safeViewerZone);
    setProjectId(seed.projectId || '');

    const initialLocQuery = formatCombinedLocation(seed.location, seed.locationAddress, ' · ');
    setLocationQuery(initialLocQuery);
    setResolvedGeo(null);

    setIsDetailsExpanded(Boolean(seed.locationPhone || seed.locationMobilePhone));
    setLocationPhone(seed.locationPhone || '');
    setLocationMobilePhone(seed.locationMobilePhone || '');
    setContent('');
    setChecklist([]);
    setNewCheckText('');
    setRecurrenceFreq('none');
    setRecurrenceUntil('');
    setReminderOption('default');
    setCustomReminderMins('25');
    setIsResolvingLoc(false);
    setLocNotice(null);
    setFormError(null);

    const timer = window.setTimeout(() => {
      titleInputRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [isOpen, seed, safeViewerZone]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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
      title: title || '새 일정',
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
    category,
    existingEvents,
  ]);

  if (!isOpen) return null;

  const handleStartTimeChange = (nextStart: string) => {
    setStartTime(nextStart);
    if (nextStart >= endTime) {
      setEndTime(computeNextHourSlot(nextStart));
    }
    setFormError(null);
  };

  const handleLocationQueryChange = (nextVal: string) => {
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
    setChecklist((prev) => [
      ...prev,
      {
        id: `cchk-${Date.now()}-${prev.length}`,
        text: trimmed,
        done: false,
      },
    ]);
    setNewCheckText('');
  };

  const handleAutoResolveLocation = async () => {
    if (isResolvingLoc) return;
    const rawInput = locationQuery.trim();
    const fallbackQuery = rawInput || title.trim();
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

      if (res.found) {
        const nextLoc = res.location || parsedInput.location || rawInput || fallbackQuery;
        const nextAddr = res.locationAddress || parsedInput.locationAddress;
        const coords = normalizeCoordinates(res.locationLat, res.locationLng);
        const combined = formatCombinedLocation(nextLoc, nextAddr, ' · ');

        setLocationQuery(combined);
        setResolvedGeo({
          combinedInput: combined,
          location: nextLoc || undefined,
          locationAddress: nextAddr || undefined,
          locationLat: coords.locationLat,
          locationLng: coords.locationLng,
        });
        setLocNotice(
          hasValidCoordinates(coords.locationLat, coords.locationLng)
            ? `좌표 확인됨 · ${coords.locationLat!.toFixed(5)}, ${coords.locationLng!.toFixed(5)}`
            : '도로명 주소가 확인되었습니다.'
        );
      } else {
        setLocNotice('일치하는 상세 주소를 찾지 못했습니다. 장소·주소를 직접 입력할 수 있습니다.');
      }
    } catch (err: unknown) {
      setLocNotice(
        err instanceof Error && err.message
          ? err.message
          : '장소 자동 탐색 중 오류가 발생했습니다.'
      );
    } finally {
      setIsResolvingLoc(false);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError('일정 제목을 입력해 주세요.');
      titleInputRef.current?.focus();
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
      title: trimmedTitle,
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

  const optionalSummaryCount =
    (content.trim() ? 1 : 0) +
    checklist.length +
    (newCheckText.trim() ? 1 : 0) +
    (locationPhone.trim() || locationMobilePhone.trim() ? 1 : 0);

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
        className="luxury-glass-border relative w-full max-w-3xl bg-gradient-to-b from-[#171b26]/95 via-[#11141d]/96 to-[#0c0e15]/98 backdrop-blur-xl backdrop-saturate-150 rounded-2xl shadow-[0_24px_56px_-12px_rgba(0,0,0,0.82),0_8px_20px_-4px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col max-h-[92dvh]"
      >
        {/* 헤더 */}
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-neutral-300">
            <Calendar className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <span className="font-semibold text-white tracking-tight">새 일정 등록</span>
            <span aria-hidden="true" className="text-neutral-600">
              ·
            </span>
            <span className="font-mono tabular-nums text-neutral-400">{date}</span>
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

        {/* 본문: 2단 그리드 레이아웃 (중첩 박스 제거 · 단일 뷰 최적화) */}
        <div className="p-5 overflow-y-auto md:overflow-visible select-text">
          <div className="grid grid-cols-1 md:grid-cols-[1.12fr_0.88fr] gap-5 md:gap-6 items-start">
            {/* 좌측 컬럼: 제목 · 카테고리 칩 · 컨텍스트 프로젝트 배지 · 인라인 일시/시간대 */}
            <div className="space-y-3.5 min-w-0">
              {/* 1. 제목 입력 */}
              <div>
                <input
                  ref={titleInputRef}
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="일정 제목 입력 (Ctrl + Enter 빠른 등록)"
                  title="일정 제목 (Ctrl + Enter 또는 ⌘ + Enter로 즉시 등록)"
                  className="w-full h-9.5 px-3.5 rounded-lg bg-white/[0.03] border border-white/[0.10] focus:border-white/28 text-sm font-medium text-white placeholder:text-neutral-500 outline-hidden transition-colors"
                />
              </div>

              {/* 2. 분류 칩 & 컨텍스트 프로젝트 인라인 배지 */}
              <div className="space-y-2">
                <div className="flex items-center gap-1 flex-wrap">
                  {CALENDAR_CATEGORIES.map((cat) => {
                    const active = category === cat;
                    const style = CATEGORY_COLORS[cat];
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategory(cat)}
                        className={`h-7 px-2.5 rounded-md text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                          active
                            ? 'bg-white/[0.12] border-white/[0.24] text-white font-medium'
                            : 'bg-transparent border-white/[0.06] text-neutral-400 hover:text-neutral-200 hover:border-white/[0.14]'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                        <span>{cat}</span>
                      </button>
                    );
                  })}
                </div>

                {/* 컨텍스트 프로젝트 배지 / 글로벌 뷰 인라인 드롭다운 배지 */}
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
                        onClick={() => setProjectId('')}
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
                        onChange={(e) => setProjectId(e.target.value)}
                        aria-label="소속 프로젝트 선택"
                        className="h-6.5 pl-7 pr-6 rounded-md bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] hover:border-white/[0.16] text-[11.5px] text-neutral-300 outline-hidden cursor-pointer appearance-none transition-colors max-w-[240px] truncate"
                      >
                        <option value="" className="bg-[#12151e] text-neutral-300">
                          프로젝트 연결 (일반 일정)
                        </option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id} className="bg-[#12151e] text-neutral-100">
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2 w-3 h-3 text-neutral-500" />
                    </div>
                  ) : null}
                </div>
              </div>

              {/* 3. 컴팩트 2줄 인라인 일시 · 시간대 · 반복 설정 */}
              <div className="pt-3.5 border-t border-white/5 space-y-2.5">
                {/* 1줄: 날짜 + 시작~종료 시간 (또는 다일 종료일) */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="date"
                    value={date}
                    aria-label="시작 날짜"
                    onChange={(e) => {
                      setDate(e.target.value);
                      if (endDate && endDate < e.target.value) {
                        setEndDate('');
                      }
                      if (recurrenceUntil && recurrenceUntil < e.target.value) {
                        setRecurrenceUntil('');
                      }
                      if (formError) setFormError(null);
                    }}
                    className="h-8.5 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.09] focus:border-white/25 text-xs font-mono tabular-nums text-neutral-100 outline-hidden [color-scheme:dark] shrink-0"
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
                          setEndDate(e.target.value);
                          if (formError) setFormError(null);
                        }}
                        className="h-8.5 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.09] focus:border-white/25 text-xs font-mono tabular-nums text-neutral-100 outline-hidden [color-scheme:dark]"
                      />
                      <button
                        type="button"
                        onClick={() => {
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
                        className="h-8.5 px-2 rounded-lg bg-white/[0.03] border border-white/[0.09] focus:border-white/25 text-xs font-mono tabular-nums text-neutral-100 outline-hidden [color-scheme:dark]"
                      />
                      <span className="text-xs text-neutral-500">–</span>
                      <input
                        type="time"
                        value={endTime}
                        aria-label="종료 시간"
                        onChange={(e) => {
                          setEndTime(e.target.value);
                          if (formError) setFormError(null);
                        }}
                        className="h-8.5 px-2 rounded-lg bg-white/[0.03] border border-white/[0.09] focus:border-white/25 text-xs font-mono tabular-nums text-neutral-100 outline-hidden [color-scheme:dark]"
                      />
                    </div>
                  )}
                </div>

                {/* 2줄: 종일 토글 · 시간대 · 다일 토글 · 반복 주기 */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md bg-white/[0.02] border border-white/[0.07] hover:border-white/[0.15] text-neutral-300 cursor-pointer select-none whitespace-nowrap shrink-0 transition-colors">
                    <input
                      type="checkbox"
                      checked={isAllDay}
                      onChange={(e) => setIsAllDay(e.target.checked)}
                      className="rounded border-white/20 bg-[#0d1017] accent-white cursor-pointer"
                    />
                    <span>종일</span>
                  </label>

                  {!isAllDay && (
                    <div className="relative inline-flex items-center shrink-0">
                      <Globe className="pointer-events-none absolute left-2 w-3 h-3 text-neutral-400" />
                      <select
                        value={timeZone}
                        onChange={(e) => setTimeZone(e.target.value)}
                        aria-label="기준 시간대"
                        title="기준 시간대 선택"
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
                      onChange={(e) => setRecurrenceUntil(e.target.value)}
                      title="반복 종료일 (미지정 시 계속 반복)"
                      aria-label="반복 종료일"
                      className="h-7 px-2 rounded-md bg-white/[0.03] border border-white/[0.09] focus:border-white/25 text-[11.5px] font-mono tabular-nums text-neutral-200 outline-hidden [color-scheme:dark] shrink-0"
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
                      title="이 일정의 알림 리드타임 설정"
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
                        className="h-7 w-16 px-2 rounded-md bg-white/[0.03] border border-white/[0.12] focus:border-white/28 text-[11.5px] font-mono tabular-nums text-neutral-100 outline-hidden"
                      />
                      <span className="text-[11px] text-neutral-400 whitespace-nowrap">분 전</span>
                    </div>
                  )}
                </div>

                {/* 시간 충돌 실시간 경고 및 대안 슬롯 */}
                {liveConflict && (
                  <div className="pt-1 flex items-center justify-between gap-2 text-[11px] text-amber-300">
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
                          setStartTime(liveConflict.suggestedSlots[0].startTime);
                          setEndTime(liveConflict.suggestedSlots[0].endTime);
                        }}
                        className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-[10.5px] font-mono tabular-nums text-amber-200 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {liveConflict.suggestedSlots[0].startTime}–
                        {liveConflict.suggestedSlots[0].endTime} 적용
                      </button>
                    )}
                  </div>
                )}

                {formError && (
                  <p className="text-xs text-rose-400 font-medium pt-0.5">{formError}</p>
                )}
              </div>
            </div>

            {/* 우측 컬럼: 스마트 장소·주소 통합 검색 + 점진적 공개(메모 & 체크리스트) */}
            <div className="space-y-3.5 min-w-0 pt-3.5 border-t border-white/5 md:pt-0 md:border-t-0 md:border-l md:border-white/5 md:pl-6">
              {/* 4. 통합 스마트 장소 · 주소 검색 필드 (인라인 지오코딩 액션 아이콘) */}
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
                    className="w-full h-9.5 pl-8.5 pr-15 rounded-lg bg-white/[0.03] border border-white/[0.10] focus:border-white/28 text-xs text-neutral-100 placeholder:text-neutral-500 outline-hidden transition-colors"
                  />
                  <div className="absolute right-1.5 flex items-center gap-0.5">
                    {locationQuery && (
                      <button
                        type="button"
                        onClick={() => {
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

              {/* 5. 점진적 공개(Progressive Disclosure): 상세 메모 & 사전 체크리스트 */}
              {!isDetailsExpanded ? (
                <button
                  type="button"
                  onClick={() => setIsDetailsExpanded(true)}
                  className="w-full h-9.5 px-3 rounded-lg border border-dashed border-white/[0.10] hover:border-white/[0.22] hover:bg-white/[0.025] text-xs text-neutral-400 hover:text-neutral-200 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5 font-medium whitespace-nowrap">
                    <Plus className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                    <span>메모 및 체크리스트 추가</span>
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
                      <span>상세 메모 · 체크리스트</span>
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

                  {/* 장소 연락처 (대표 유선 · 현장 담당자 모바일) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10.5px] text-neutral-400 mb-1 flex items-center gap-1">
                        <Phone className="w-3 h-3 text-sky-400 shrink-0" />
                        <span>장소 대표 유선 전화</span>
                      </label>
                      <input
                        type="tel"
                        value={locationPhone}
                        onChange={(e) => setLocationPhone(e.target.value)}
                        placeholder="예: 02-588-4100"
                        className="w-full h-8 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.09] focus:border-white/25 text-xs font-mono tabular-nums text-neutral-100 placeholder:text-neutral-500 outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="block text-[10.5px] text-neutral-400 mb-1 flex items-center gap-1">
                        <Smartphone className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>현장 안내 / 담당자 모바일</span>
                      </label>
                      <input
                        type="tel"
                        value={locationMobilePhone}
                        onChange={(e) => setLocationMobilePhone(e.target.value)}
                        placeholder="예: 010-8492-3104"
                        className="w-full h-8 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.09] focus:border-white/25 text-xs font-mono tabular-nums text-neutral-100 placeholder:text-neutral-500 outline-hidden"
                      />
                    </div>
                  </div>

                  {/* 상세 메모 */}
                  <textarea
                    rows={2}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="담당자 연락처, 반입 동선, 특이사항 기록..."
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.09] focus:border-white/25 text-xs text-neutral-100 placeholder:text-neutral-500 outline-hidden resize-none leading-relaxed"
                  />

                  {/* 사전 체크리스트 */}
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
                          className="w-full h-8 pl-8 pr-2.5 rounded-lg bg-white/[0.03] border border-white/[0.09] focus:border-white/25 text-xs text-neutral-100 placeholder:text-neutral-500 outline-hidden transition-colors"
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
                              onClick={() =>
                                setChecklist((prev) => prev.filter((c) => c.id !== item.id))
                              }
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
        </div>

        {/* 푸터: 우측 정렬 주요 액션 버튼만 배치 */}
        <div className="px-5 py-3 border-t border-white/[0.06] bg-white/[0.015] flex items-center justify-end gap-2 shrink-0">
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
            title="일정 등록 (Ctrl + Enter / ⌘ + Enter)"
            className="h-8.5 px-4 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            일정 등록
          </button>
        </div>
      </form>
    </div>
  );
};

