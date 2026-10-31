import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Clock,
  FileText,
  FolderKanban,
  ListTodo,
  Loader2,
  MapPin,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  CalendarCategory,
  CalendarEventItem,
  ChecklistItem,
  ProjectItem,
} from '../types';
import { CALENDAR_CATEGORIES, CATEGORY_COLORS } from '../constants/categories';
import { ManualEventDraft } from '../hooks/useCalendarEvents';
import {
  detectBrowserTimeZone,
  GLOBAL_EVENT_TIMEZONES,
  isValidTimeZone,
  mapEventsToViewerZone,
  TimeZoneOption,
  toViewerProjectedEvent,
} from '../shared/timeZoneUtils';
import { detectConflictAndSuggest } from '../shared/scheduleUtils';
import { normalizeCoordinates } from '../shared/locationUtils';
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
  const [isAllDay, setIsAllDay] = useState(false);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [timeZone, setTimeZone] = useState<string>(safeViewerZone);
  const [projectId, setProjectId] = useState<string>('');
  const [location, setLocation] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [locationLat, setLocationLat] = useState<number | undefined>(undefined);
  const [locationLng, setLocationLng] = useState<number | undefined>(undefined);
  const [content, setContent] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newCheckText, setNewCheckText] = useState('');

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
    setIsAllDay(Boolean(seed.isAllDay));
    const initStart = seed.startTime || '10:00';
    const initEnd = seed.endTime || computeNextHourSlot(initStart);
    setStartTime(initStart);
    setEndTime(initEnd);
    setTimeZone(safeViewerZone);
    setProjectId(seed.projectId || '');
    setLocation('');
    setLocationAddress('');
    setLocationLat(undefined);
    setLocationLng(undefined);
    setContent('');
    setChecklist([]);
    setNewCheckText('');
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
  }, [isOpen, isAllDay, date, startTime, endTime, timeZone, safeViewerZone, title, category, existingEvents]);

  if (!isOpen) return null;

  const handleStartTimeChange = (nextStart: string) => {
    setStartTime(nextStart);
    if (nextStart >= endTime) {
      setEndTime(computeNextHourSlot(nextStart));
    }
    setFormError(null);
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
    const query = location.trim() || locationAddress.trim() || title.trim();
    if (!query) {
      setLocNotice('탐색할 장소명이나 주소를 먼저 입력해 주세요.');
      return;
    }
    setIsResolvingLoc(true);
    setLocNotice(null);
    try {
      const res = await resolveLocationDetails({
        location: location.trim() || query,
        locationAddress: locationAddress.trim() || undefined,
      });
      if (res.found) {
        if (res.location && !location.trim()) {
          setLocation(res.location);
        }
        if (res.locationAddress) {
          setLocationAddress(res.locationAddress);
        }
        const coords = normalizeCoordinates(res.locationLat, res.locationLng);
        setLocationLat(coords.locationLat);
        setLocationLng(coords.locationLng);
        setLocNotice('도로명 주소 및 위경도 좌표가 확인되었습니다.');
      } else {
        setLocNotice('외부 검색에서 주소·위경도를 찾지 못했습니다. 직접 입력해 주세요.');
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

    const pendingChecks = newCheckText.trim()
      ? [
          ...checklist,
          { id: `cchk-${Date.now()}-last`, text: newCheckText.trim(), done: false },
        ]
      : checklist;

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
      location: location.trim() || undefined,
      locationAddress: locationAddress.trim() || undefined,
      locationLat,
      locationLng,
      content: content.trim() || undefined,
      checklist: pendingChecks.length > 0 ? pendingChecks : undefined,
    });
    onClose();
  };

  const handleFormKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

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
        className="luxury-glass-border w-full max-w-xl bg-[#12151e] border border-white/[0.10] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* 헤더 */}
        <div className="px-5 py-3.5 border-b border-white/[0.07] bg-[#13161f] flex items-center justify-between gap-3 shrink-0">
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
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 본문 입력 영역 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 select-text">
          {/* 1. 제목 */}
          <div>
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (formError) setFormError(null);
              }}
              placeholder="일정 제목 입력 (예: 코엑스 오디토리움 리허설 점검)"
              className="w-full h-10 px-3.5 rounded-xl bg-[#0d1017] border border-white/[0.10] focus:border-white/28 text-sm font-medium text-white placeholder:text-neutral-500 outline-hidden transition-colors"
            />
          </div>

          {/* 2. 분류 선택 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {CALENDAR_CATEGORIES.map((cat) => {
              const active = category === cat;
              const style = CATEGORY_COLORS[cat];
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`h-7 px-2.5 rounded-lg text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                    active
                      ? 'bg-white/[0.11] border-white/[0.24] text-white font-medium'
                      : 'bg-[#0e1118] border-white/[0.06] text-neutral-400 hover:text-neutral-200 hover:border-white/[0.12]'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                  <span>{cat}</span>
                </button>
              );
            })}
          </div>

          {/* 3. 일시 및 시간대 */}
          <div className="p-3.5 rounded-xl bg-[#161a24] border border-white/[0.06] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span>일시 및 시간대</span>
              </span>

              <label className="inline-flex items-center gap-1.5 text-xs text-neutral-300 cursor-pointer select-none whitespace-nowrap shrink-0">
                <input
                  type="checkbox"
                  checked={isAllDay}
                  onChange={(e) => setIsAllDay(e.target.checked)}
                  className="rounded border-white/20 bg-[#0d1017] accent-white cursor-pointer"
                />
                <span>종일 일정</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-neutral-400 mb-1">시작일</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    if (endDate && endDate < e.target.value) {
                      setEndDate('');
                    }
                  }}
                  className="w-full h-9 px-3 rounded-lg bg-[#0d1017] border border-white/[0.09] focus:border-white/25 text-xs font-mono tabular-nums text-neutral-100 outline-hidden [color-scheme:dark]"
                />
              </div>

              <div>
                <label className="block text-[11px] text-neutral-400 mb-1">
                  종료일 <span className="text-neutral-500">(다일 일정 선택 시)</span>
                </label>
                <input
                  type="date"
                  min={date}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-[#0d1017] border border-white/[0.09] focus:border-white/25 text-xs font-mono tabular-nums text-neutral-100 outline-hidden [color-scheme:dark]"
                />
              </div>
            </div>

            {!isAllDay && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-0.5">
                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">시작 시간</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-[#0d1017] border border-white/[0.09] focus:border-white/25 text-xs font-mono tabular-nums text-neutral-100 outline-hidden [color-scheme:dark]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">종료 시간</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => {
                      setEndTime(e.target.value);
                      if (formError) setFormError(null);
                    }}
                    className="w-full h-9 px-3 rounded-lg bg-[#0d1017] border border-white/[0.09] focus:border-white/25 text-xs font-mono tabular-nums text-neutral-100 outline-hidden [color-scheme:dark]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">기준 시간대</label>
                  <select
                    value={timeZone}
                    onChange={(e) => setTimeZone(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg bg-[#0d1017] border border-white/[0.09] focus:border-white/25 text-xs font-mono text-neutral-100 outline-hidden cursor-pointer"
                  >
                    {timeZoneOptions.map((tz) => (
                      <option key={tz.iana} value={tz.iana} className="bg-[#12151e] text-neutral-100">
                        {tz.shortCode} · {tz.cityKo}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {liveConflict && (
              <div className="pt-1 flex items-start justify-between gap-2 text-[11px] text-amber-300">
                <span className="inline-flex items-start gap-1.5 leading-snug">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                  <span>{liveConflict.message}</span>
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
                    {liveConflict.suggestedSlots[0].startTime}–{liveConflict.suggestedSlots[0].endTime} 적용
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 4. 소속 프로젝트 */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#161a24] border border-white/[0.06] text-xs gap-2">
            <span className="font-medium text-neutral-300 flex items-center gap-2 shrink-0">
              <FolderKanban className="w-4 h-4 text-neutral-400 shrink-0" />
              <span>소속 프로젝트</span>
            </span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="bg-[#0d1017] border border-white/[0.09] rounded-lg px-2.5 py-1.5 text-xs text-neutral-100 outline-hidden cursor-pointer hover:border-white/20 transition-colors max-w-[240px] truncate"
            >
              <option value="">(지정 안 됨 / 일반 일정)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* 5. 장소 및 도로명 주소 */}
          <div className="p-3.5 rounded-xl bg-[#161a24] border border-white/[0.06] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span>장소 및 상세 주소</span>
              </span>
              <button
                type="button"
                onClick={() => void handleAutoResolveLocation()}
                disabled={isResolvingLoc}
                className="h-6 px-2.5 rounded-md bg-white/[0.05] hover:bg-white/[0.10] disabled:opacity-50 border border-white/[0.09] text-[10.5px] text-neutral-200 hover:text-white inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {isResolvingLoc ? (
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                ) : (
                  <Search className="w-3 h-3 shrink-0" />
                )}
                <span>{isResolvingLoc ? '탐색 중...' : '주소·위경도 자동 탐색'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="공식 장소·건물·호실명"
                className="w-full h-9 px-3 rounded-lg bg-[#0d1017] border border-white/[0.09] focus:border-white/25 text-xs text-neutral-100 placeholder:text-neutral-500 outline-hidden"
              />
              <input
                type="text"
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                placeholder="시/도 시/군/구 도로명 상세 주소"
                className="w-full h-9 px-3 rounded-lg bg-[#0d1017] border border-white/[0.09] focus:border-white/25 text-xs text-neutral-100 placeholder:text-neutral-500 outline-hidden"
              />
            </div>

            {locNotice && <p className="text-[11px] text-neutral-400">{locNotice}</p>}
          </div>

          {/* 6. 상세 메모 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span>상세 메모 · 파트너 정보</span>
            </label>
            <textarea
              rows={2}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="담당자 연락처, 반입 동선, 특이사항 기록..."
              className="w-full p-3 rounded-xl bg-[#161a24] border border-white/[0.06] focus:border-white/22 text-xs text-neutral-100 placeholder:text-neutral-500 outline-hidden resize-y leading-relaxed"
            />
          </div>

          {/* 7. 사전 체크리스트 */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
              <ListTodo className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span>사전 준비 체크리스트</span>
            </label>

            {checklist.length > 0 && (
              <div className="space-y-1 bg-[#161a24] p-2.5 rounded-xl border border-white/[0.06]">
                {checklist.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-white/[0.02] text-xs text-neutral-200"
                  >
                    <span className="truncate">{item.text}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setChecklist((prev) => prev.filter((c) => c.id !== item.id))
                      }
                      className="text-neutral-500 hover:text-rose-300 transition-colors cursor-pointer shrink-0"
                      title="항목 삭제"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
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
                placeholder="준비 항목 입력 후 Enter (예: 빔프로젝터 HDMI 어댑터 확인)"
                className="flex-1 h-8.5 px-3 rounded-lg bg-[#161a24] border border-white/[0.06] focus:border-white/22 text-xs text-neutral-100 placeholder:text-neutral-500 outline-hidden"
              />
              <button
                type="button"
                onClick={handleAddChecklistDraft}
                className="h-8.5 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-xs text-neutral-200 inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>추가</span>
              </button>
            </div>
          </div>

          {formError && <p className="text-xs text-rose-300">{formError}</p>}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 bg-[#0f121a] border-t border-white/[0.07] flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-neutral-500 font-mono hidden sm:inline">
            ⌘/Ctrl + Enter 빠른 등록
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="h-8.5 px-3.5 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-xs text-neutral-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              취소
            </button>
            <button
              type="submit"
              className="h-8.5 px-4 rounded-xl bg-white text-neutral-950 hover:bg-neutral-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              일정 등록
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
