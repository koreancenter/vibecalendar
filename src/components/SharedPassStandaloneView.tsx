import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  CheckSquare,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FolderInput,
  MapPin,
  Square,
} from 'lucide-react';
import { formatKoreanDateWithDay } from '../shared/dateUtils';
import { buildLocationSearchQuery } from '../shared/locationUtils';
import {
  detectBrowserTimeZone,
  getTimeZoneMeta,
  projectEventToViewerTimeZone,
} from '../shared/timeZoneUtils';
import { downloadIcsFile, generateIcsContent } from '../utils/icsExport';
import {
  downloadSharePassPng,
  renderSharePassToBlob,
} from '../utils/shareCardCanvas';
import {
  buildGoogleMapsSearchUrl,
  formatPassPlainText,
  ShareCardTheme,
  SharedEventPassData,
  SharedPassPayload,
  sharedEventToCalendarItem,
} from '../utils/shareCodec';

interface SharedPassStandaloneViewProps {
  payload: SharedPassPayload;
  isPreviewMode?: boolean;
  onImportToWorkspace?: (payload: SharedPassPayload, selectedSlotIndex?: number) => void;
  onExit: () => void;
}

export const SharedPassStandaloneView: React.FC<SharedPassStandaloneViewProps> = ({
  payload,
  isPreviewMode = false,
  onImportToWorkspace,
  onExit,
}) => {
  const [theme, setTheme] = useState<ShareCardTheme>(payload.theme || 'obsidian');

  useEffect(() => {
    if (!isPreviewMode) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onExit();
      }
    };
    window.addEventListener('keydown', handleEsc, { capture: true });
    return () => window.removeEventListener('keydown', handleEsc, { capture: true });
  }, [isPreviewMode, onExit]);
  const [localDoneMap, setLocalDoneMap] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    if (payload.event?.checklist) {
      for (const item of payload.event.checklist) {
        map[item.id] = item.done;
      }
    }
    return map;
  });
  const [copiedText, setCopiedText] = useState(false);
  const [copiedSlotReply, setCopiedSlotReply] = useState(false);
  const [selectedProposalIdx, setSelectedProposalIdx] = useState<number>(0);
  const [downloadingPng, setDownloadingPng] = useState(false);

  const receiverTimeZone = useMemo(() => detectBrowserTimeZone(), []);
  const isEditorial = theme === 'editorial';

  const groupedProjectEvents = useMemo(() => {
    if (payload.kind !== 'project' || !payload.project) return [];
    const groups = new Map<string, SharedEventPassData[]>();
    for (const ev of payload.project.events) {
      const list = groups.get(ev.date) || [];
      list.push(ev);
      groups.set(ev.date, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [payload]);

  const handleSaveSingleIcs = (ev: SharedEventPassData) => {
    const chosenSlot =
      ev.proposedSlots && ev.proposedSlots.length > 0
        ? ev.proposedSlots[selectedProposalIdx] || ev.proposedSlots[0]
        : null;
    const effectiveEv: SharedEventPassData = chosenSlot
      ? {
          ...ev,
          date: chosenSlot.date,
          endDate: undefined,
          startTime: chosenSlot.startTime,
          endTime: chosenSlot.endTime,
        }
      : ev;
    const item = sharedEventToCalendarItem(effectiveEv);
    const ics = generateIcsContent([item], effectiveEv.title);
    downloadIcsFile(`${effectiveEv.date}_${effectiveEv.title}.ics`, ics);
  };

  const handleCopySelectedSlotReply = async (ev: SharedEventPassData) => {
    if (!ev.proposedSlots || ev.proposedSlots.length === 0) return;
    const idx = Math.min(selectedProposalIdx, ev.proposedSlots.length - 1);
    const slot = ev.proposedSlots[idx];
    const tzMeta = getTimeZoneMeta(ev.timeZone);
    const reply = `[일정 확정 회신] '${ev.title}' 일정은 후보 ${idx + 1} (${slot.date} ${slot.startTime}–${slot.endTime} ${tzMeta.shortCode}) 시간대로 참석 가능합니다.`;
    try {
      await navigator.clipboard.writeText(reply);
      setCopiedSlotReply(true);
      window.setTimeout(() => setCopiedSlotReply(false), 1800);
    } catch {
      // ignore clipboard failure
    }
  };

  const handleSaveProjectIcs = () => {
    if (!payload.project) return;
    const items = payload.project.events.map(sharedEventToCalendarItem);
    const ics = generateIcsContent(items, payload.project.name);
    downloadIcsFile(`${payload.project.name}_일정표.ics`, ics);
  };

  const handleDownloadPassPng = async () => {
    if (downloadingPng) return;
    setDownloadingPng(true);
    try {
      const blob = await renderSharePassToBlob(payload, theme);
      const name =
        payload.kind === 'event' && payload.event
          ? `${payload.event.date}_${payload.event.title}_브리핑패스`
          : `${payload.project?.name || '프로젝트'}_브리핑패스`;
      downloadSharePassPng(blob, name);
    } finally {
      setDownloadingPng(false);
    }
  };

  const handleCopySummaryText = async () => {
    try {
      const text = formatPassPlainText(
        payload,
        typeof window !== 'undefined' ? window.location.href : undefined
      );
      await navigator.clipboard.writeText(text);
      setCopiedText(true);
      window.setTimeout(() => setCopiedText(false), 1800);
    } catch {
      // ignore clipboard failure
    }
  };

  return (
    <div
      className={`min-h-screen w-screen overflow-y-auto font-sans antialiased transition-colors duration-150 ${
        isEditorial ? 'bg-[#f1f3f6] text-slate-900' : 'bg-[#080a10] text-neutral-100'
      }`}
    >
      {/* 최소한의 상단 브리핑 바 (단 1줄, 3-Zone 규율 준수) */}
      <header
        className={`h-12 px-4 sm:px-8 border-b flex items-center justify-between gap-4 ${
          isEditorial
            ? 'bg-white/90 border-slate-200/90 text-slate-900'
            : 'bg-[#0c0f17]/90 border-white/[0.07] text-white'
        }`}
      >
        <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
          <span className="text-sm font-semibold tracking-tight">바이브 행사</span>
          <span
            aria-hidden="true"
            className={isEditorial ? 'text-slate-300' : 'text-neutral-600'}
          >
            ·
          </span>
          <span
            className={`text-xs ${
              isEditorial ? 'text-slate-500' : 'text-neutral-400'
            }`}
          >
            일정 브리핑 패스
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* 야외 주간 가독성을 위한 수신자 즉시 테마 전환 */}
          <div
            className={`flex items-center gap-0.5 p-0.5 rounded-lg border text-[11px] ${
              isEditorial
                ? 'bg-slate-100 border-slate-200'
                : 'bg-white/[0.04] border-white/[0.08]'
            }`}
          >
            <button
              type="button"
              onClick={() => setTheme('obsidian')}
              className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                !isEditorial
                  ? 'bg-white/[0.14] text-white'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              다크
            </button>
            <button
              type="button"
              onClick={() => setTheme('editorial')}
              className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isEditorial
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              화이트
            </button>
          </div>

          <button
            type="button"
            onClick={onExit}
            className={`h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              isEditorial
                ? 'bg-slate-900 text-white hover:bg-slate-800'
                : 'bg-white/[0.08] text-neutral-100 hover:bg-white/[0.14]'
            }`}
          >
            {isPreviewMode && <ArrowLeft className="w-3.5 h-3.5 shrink-0" />}
            <span>{isPreviewMode ? '캘린더로 돌아가기' : '내 캘린더 열기'}</span>
          </button>
        </div>
      </header>

      {/* 중앙 브리핑 패스 컨테이너 */}
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {payload.kind === 'event' && payload.event ? (
          (() => {
            const ev = payload.event;
            const calendarItem = sharedEventToCalendarItem(ev);
            const timing = projectEventToViewerTimeZone(calendarItem, receiverTimeZone);
            const tzMeta = getTimeZoneMeta(ev.timeZone);

            return (
              <article
                className={`rounded-2xl border p-6 sm:p-8 space-y-6 ${
                  isEditorial
                    ? 'bg-white border-slate-900/[0.10] shadow-xs'
                    : 'bg-[#10131c] border-white/[0.11]'
                }`}
              >
                {/* 상단 메타데이터 킥커 & 일정 제목 */}
                <div className="space-y-2">
                  <div
                    className={`flex items-center gap-1.5 text-xs flex-wrap ${
                      isEditorial ? 'text-slate-500' : 'text-neutral-400'
                    }`}
                  >
                    <span>{ev.projectName || '공유된 일정'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{ev.category}</span>
                  </div>

                  <h1
                    className={`text-2xl sm:text-3xl font-bold tracking-tight leading-snug break-words [text-wrap:balance] ${
                      isEditorial ? 'text-slate-900' : 'text-white'
                    }`}
                  >
                    {ev.title}
                  </h1>
                </div>

                {/* 보딩패스 절취선 */}
                <div
                  className={`border-t border-dashed ${
                    isEditorial ? 'border-slate-300' : 'border-white/[0.12]'
                  }`}
                />

                {/* 일시 정보 블록 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <span
                      className={`text-xs block ${
                        isEditorial ? 'text-slate-500' : 'text-neutral-400'
                      }`}
                    >
                      일자
                    </span>
                    <p className="mt-1 text-lg font-mono font-semibold tabular-nums">
                      {formatKoreanDateWithDay(ev.date, false)}
                    </p>
                    {ev.endDate && ev.endDate !== ev.date && (
                      <p
                        className={`mt-0.5 text-xs font-mono tabular-nums ${
                          isEditorial ? 'text-slate-500' : 'text-neutral-400'
                        }`}
                      >
                        종료일 {formatKoreanDateWithDay(ev.endDate, false)}
                      </p>
                    )}
                  </div>

                  <div>
                    <span
                      className={`text-xs block ${
                        isEditorial ? 'text-slate-500' : 'text-neutral-400'
                      }`}
                    >
                      시간 · 기준 시간대
                    </span>
                    <p className="mt-1 text-lg font-mono font-semibold tabular-nums">
                      {ev.isAllDay
                        ? '종일 일정'
                        : `${ev.startTime} – ${ev.endTime} ${tzMeta.shortCode}`}
                    </p>
                    {!ev.isAllDay && (
                      <p
                        className={`mt-0.5 text-xs ${
                          isEditorial ? 'text-slate-500' : 'text-neutral-400'
                        }`}
                      >
                        {tzMeta.cityKo} 현지 시각 기준
                      </p>
                    )}
                    {!ev.isAllDay && timing.hasOffsetDiff && (
                      <p
                        className={`mt-1 text-xs font-mono tabular-nums ${
                          isEditorial ? 'text-slate-700' : 'text-neutral-300'
                        }`}
                      >
                        내 휴대폰({timing.viewerMeta.cityKo}) 기준{' '}
                        {timing.localDate !== ev.date ? `${timing.localDate} ` : ''}
                        {timing.localStartTime} – {timing.localEndTime}{' '}
                        {timing.viewerMeta.shortCode}
                      </p>
                    )}
                  </div>
                </div>

                {/* 장소 · 상세 주소 + 지도 앱 바로 열기 액션 */}
                {(ev.location || ev.locationAddress) && (
                  <div
                    className={`pt-5 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isEditorial ? 'border-slate-200/90' : 'border-white/[0.08]'
                    }`}
                  >
                    <div className="min-w-0">
                      <span
                        className={`text-xs block ${
                          isEditorial ? 'text-slate-500' : 'text-neutral-400'
                        }`}
                      >
                        장소 · 상세 주소
                      </span>
                      <div className="mt-1 flex items-start gap-2">
                        <MapPin
                          className={`w-4 h-4 mt-0.5 shrink-0 ${
                            isEditorial ? 'text-slate-600' : 'text-neutral-300'
                          }`}
                        />
                        <div className="min-w-0">
                          {ev.location && (
                            <span className="block text-sm sm:text-base font-medium break-words">
                              {ev.location}
                            </span>
                          )}
                          {ev.locationAddress && (
                            <span
                              className={`block text-xs sm:text-sm mt-0.5 break-words ${
                                isEditorial ? 'text-slate-500' : 'text-neutral-400'
                              }`}
                            >
                              {ev.locationAddress}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <a
                      href={buildGoogleMapsSearchUrl(
                        buildLocationSearchQuery(ev.location, ev.locationAddress)
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`h-9 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                        isEditorial
                          ? 'bg-slate-900 text-white hover:bg-slate-800'
                          : 'bg-white text-neutral-950 hover:bg-neutral-200'
                      }`}
                    >
                      <span>지도 앱으로 위치 열기</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  </div>
                )}

                {/* 전달 사항 코멘트 */}
                {payload.senderNote && (
                  <div
                    className={`p-4 rounded-xl border ${
                      isEditorial
                        ? 'bg-slate-50 border-slate-200/90 text-slate-900'
                        : 'bg-[#161a26] border-white/[0.08] text-neutral-100'
                    }`}
                  >
                    <span
                      className={`text-xs font-medium block mb-1 ${
                        isEditorial ? 'text-slate-500' : 'text-neutral-400'
                      }`}
                    >
                      전달 사항
                    </span>
                    <p className="text-sm leading-relaxed break-words">{payload.senderNote}</p>
                  </div>
                )}

                {/* 상세 메모 */}
                {ev.content && (
                  <div
                    className={`pt-5 border-t space-y-1.5 ${
                      isEditorial ? 'border-slate-200/90' : 'border-white/[0.08]'
                    }`}
                  >
                    <span
                      className={`text-xs block ${
                        isEditorial ? 'text-slate-500' : 'text-neutral-400'
                      }`}
                    >
                      상세 메모
                    </span>
                    <p
                      className={`text-sm whitespace-pre-wrap leading-relaxed ${
                        isEditorial ? 'text-slate-700' : 'text-neutral-200'
                      }`}
                    >
                      {ev.content}
                    </p>
                  </div>
                )}

                {/* 현장 확인용 체크리스트 */}
                {ev.checklist && ev.checklist.length > 0 && (
                  <div
                    className={`pt-5 border-t space-y-2 ${
                      isEditorial ? 'border-slate-200/90' : 'border-white/[0.08]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className={isEditorial ? 'text-slate-500' : 'text-neutral-400'}>
                        현장 체크리스트
                      </span>
                      <span
                        className={`font-mono tabular-nums ${
                          isEditorial ? 'text-slate-500' : 'text-neutral-400'
                        }`}
                      >
                        {
                          ev.checklist.filter((c) => Boolean(localDoneMap[c.id])).length
                        }{' '}
                        / {ev.checklist.length}
                      </span>
                    </div>

                    <div className="space-y-1">
                      {ev.checklist.map((item) => {
                        const isDone = Boolean(localDoneMap[item.id]);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() =>
                              setLocalDoneMap((prev) => ({
                                ...prev,
                                [item.id]: !prev[item.id],
                              }))
                            }
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer ${
                              isEditorial
                                ? 'hover:bg-slate-100'
                                : 'hover:bg-white/[0.04]'
                            }`}
                          >
                            {isDone ? (
                              <CheckSquare className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                              <Square
                                className={`w-4 h-4 shrink-0 ${
                                  isEditorial ? 'text-slate-400' : 'text-neutral-500'
                                }`}
                              />
                            )}
                            <span
                              className={
                                isDone ? 'line-through opacity-55' : ''
                              }
                            >
                              {item.text}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 후보 시간 제안 인터랙티브 선택기 */}
                {ev.proposedSlots && ev.proposedSlots.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-medium flex items-center gap-1.5 ${
                          isEditorial ? 'text-slate-600' : 'text-neutral-300'
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>후보 시간 제안 선택 ({ev.proposedSlots.length}개 옵션)</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopySelectedSlotReply(ev)}
                        className={`h-7 px-2.5 rounded-lg text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          isEditorial
                            ? 'bg-slate-900 text-white hover:bg-slate-800'
                            : 'bg-sky-500/15 border border-sky-400/30 text-sky-200 hover:bg-sky-500/25'
                        }`}
                      >
                        {copiedSlotReply ? (
                          <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                        ) : (
                          <Copy className="w-3 h-3 shrink-0" />
                        )}
                        <span>{copiedSlotReply ? '확정 회신 복사됨' : '선택 시간 확정 회신 복사'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {ev.proposedSlots.map((slot, idx) => {
                        const isSelected = selectedProposalIdx === idx;
                        const slotItem = sharedEventToCalendarItem({
                          ...ev,
                          date: slot.date,
                          endDate: undefined,
                          startTime: slot.startTime,
                          endTime: slot.endTime,
                        });
                        const slotTiming = projectEventToViewerTimeZone(
                          slotItem,
                          receiverTimeZone
                        );

                        return (
                          <button
                            key={`${slot.date}-${slot.startTime}-${idx}`}
                            type="button"
                            onClick={() => setSelectedProposalIdx(idx)}
                            className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                              isSelected
                                ? isEditorial
                                  ? 'border-slate-900 bg-slate-900/[0.04]'
                                  : 'border-sky-400/50 bg-sky-400/[0.08]'
                                : isEditorial
                                ? 'border-slate-200 hover:bg-slate-50'
                                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`text-[11px] font-medium ${
                                  isSelected
                                    ? isEditorial
                                      ? 'text-slate-900'
                                      : 'text-sky-300'
                                    : isEditorial
                                    ? 'text-slate-500'
                                    : 'text-neutral-400'
                                }`}
                              >
                                후보 {idx + 1}
                                {slot.label ? ` · ${slot.label}` : ''}
                              </span>
                              {isSelected && (
                                <Check
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isEditorial ? 'text-slate-900' : 'text-sky-400'
                                  }`}
                                />
                              )}
                            </div>
                            <div className="mt-1 font-mono tabular-nums text-xs font-semibold">
                              {formatKoreanDateWithDay(slot.date, true)} · {slot.startTime} –{' '}
                              {slot.endTime} {tzMeta.shortCode}
                            </div>
                            {slotTiming.hasOffsetDiff && (
                              <div
                                className={`mt-0.5 font-mono tabular-nums text-[11px] ${
                                  isEditorial ? 'text-slate-500' : 'text-neutral-400'
                                }`}
                              >
                                내 위치 기준: {slotTiming.localDate} {slotTiming.localStartTime} –{' '}
                                {slotTiming.localEndTime}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 하단 수신자 유틸리티 액션 */}
                <div
                  className={`pt-5 border-t flex flex-wrap items-center justify-between gap-2 ${
                    isEditorial ? 'border-slate-200/90' : 'border-white/[0.08]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {onImportToWorkspace && !isPreviewMode && (
                      <button
                        type="button"
                        onClick={() => onImportToWorkspace(payload, selectedProposalIdx)}
                        className={`h-10 px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          isEditorial
                            ? 'bg-slate-900 hover:bg-slate-800 text-white'
                            : 'bg-white hover:bg-neutral-200 text-neutral-950'
                        }`}
                      >
                        <FolderInput className="w-4 h-4 shrink-0" />
                        <span>내 워크스페이스에 반영</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleSaveSingleIcs(ev)}
                      className={`h-10 px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        isEditorial
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-900'
                          : 'bg-white/[0.08] hover:bg-white/[0.14] text-white'
                      }`}
                    >
                      <CalendarPlus className="w-4 h-4 shrink-0" />
                      <span>.ics 저장</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadPassPng}
                      disabled={downloadingPng}
                      className={`h-10 px-3.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        isEditorial
                          ? 'border-slate-200 hover:bg-slate-100 text-slate-700'
                          : 'border-white/[0.08] hover:bg-white/[0.06] text-neutral-300'
                      }`}
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      <span>이미지 저장</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopySummaryText}
                      className={`h-10 px-3.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        isEditorial
                          ? 'border-slate-200 hover:bg-slate-100 text-slate-700'
                          : 'border-white/[0.08] hover:bg-white/[0.06] text-neutral-300'
                      }`}
                    >
                      {copiedText ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>{copiedText ? '복사됨' : '내용 복사'}</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })()
        ) : payload.project ? (
          <section className="space-y-5">
            {/* 프로젝트 요약 헤더 패스 */}
            <div
              className={`rounded-2xl border p-6 sm:p-7 space-y-4 ${
                isEditorial
                  ? 'bg-white border-slate-900/[0.10] shadow-xs'
                  : 'bg-[#10131c] border-white/[0.11]'
              }`}
            >
              <div className="space-y-1.5">
                <div
                  className={`flex items-center gap-1.5 text-xs flex-wrap ${
                    isEditorial ? 'text-slate-500' : 'text-neutral-400'
                  }`}
                >
                  <span>프로젝트 일정 브리핑</span>
                  {payload.project.clientOrOrg && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{payload.project.clientOrOrg}</span>
                    </>
                  )}
                  {payload.project.code && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{payload.project.code}</span>
                    </>
                  )}
                </div>

                <h1
                  className={`text-2xl sm:text-3xl font-bold tracking-tight leading-snug break-words [text-wrap:balance] ${
                    isEditorial ? 'text-slate-900' : 'text-white'
                  }`}
                >
                  {payload.project.name}
                </h1>

                <p
                  className={`text-xs sm:text-sm font-mono tabular-nums ${
                    isEditorial ? 'text-slate-600' : 'text-neutral-300'
                  }`}
                >
                  {payload.project.startDate || payload.project.endDate
                    ? `${payload.project.startDate || '미정'} – ${
                        payload.project.endDate || '미정'
                      } · 총 ${payload.project.events.length}건`
                    : `전체 일정 ${payload.project.events.length}건`}
                </p>
              </div>

              {payload.senderNote && (
                <div
                  className={`p-3.5 rounded-xl border ${
                    isEditorial
                      ? 'bg-slate-50 border-slate-200 text-slate-800'
                      : 'bg-[#161a26] border-white/[0.08] text-neutral-100'
                  }`}
                >
                  <span
                    className={`text-xs font-medium block mb-1 ${
                      isEditorial ? 'text-slate-500' : 'text-neutral-400'
                    }`}
                  >
                    전달 사항
                  </span>
                  <p className="text-sm leading-relaxed break-words">{payload.senderNote}</p>
                </div>
              )}

              {payload.project.description && (
                <p
                  className={`text-xs sm:text-sm leading-relaxed ${
                    isEditorial ? 'text-slate-600' : 'text-neutral-300'
                  }`}
                >
                  {payload.project.description}
                </p>
              )}

              <div
                className={`pt-4 border-t flex flex-wrap items-center justify-between gap-2 ${
                  isEditorial ? 'border-slate-200/90' : 'border-white/[0.08]'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {onImportToWorkspace && !isPreviewMode && (
                    <button
                      type="button"
                      onClick={() => onImportToWorkspace(payload)}
                      disabled={payload.project.events.length === 0}
                      className={`h-9 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 ${
                        isEditorial
                          ? 'bg-slate-900 text-white hover:bg-slate-800'
                          : 'bg-white text-neutral-950 hover:bg-neutral-200'
                      }`}
                    >
                      <FolderInput className="w-3.5 h-3.5 shrink-0" />
                      <span>프로젝트·런시트 내 워크스페이스에 반영</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleSaveProjectIcs}
                    disabled={payload.project.events.length === 0}
                    className={`h-9 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 ${
                      isEditorial
                        ? 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                        : 'bg-white/[0.08] text-white hover:bg-white/[0.14]'
                    }`}
                  >
                    <CalendarPlus className="w-3.5 h-3.5 shrink-0" />
                    <span>.ics 저장</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadPassPng}
                    disabled={downloadingPng}
                    className={`h-9 px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      isEditorial
                        ? 'border-slate-200 hover:bg-slate-100 text-slate-700'
                        : 'border-white/[0.08] hover:bg-white/[0.06] text-neutral-300'
                    }`}
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>카드 이미지 저장</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopySummaryText}
                    className={`h-9 px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      isEditorial
                        ? 'border-slate-200 hover:bg-slate-100 text-slate-700'
                        : 'border-white/[0.08] hover:bg-white/[0.06] text-neutral-300'
                    }`}
                  >
                    {copiedText ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>{copiedText ? '복사됨' : '요약 복사'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 일자별 타임테이블 목록 */}
            {groupedProjectEvents.length === 0 ? (
              <div
                className={`rounded-2xl border p-10 text-center text-sm ${
                  isEditorial
                    ? 'bg-white border-slate-200 text-slate-500'
                    : 'bg-[#10131c] border-white/[0.08] text-neutral-400'
                }`}
              >
                공유된 일정 항목이 없습니다.
              </div>
            ) : (
              groupedProjectEvents.map(([dateStr, dayEvents]) => (
                <div
                  key={dateStr}
                  className={`rounded-2xl border overflow-hidden ${
                    isEditorial
                      ? 'bg-white border-slate-900/[0.09]'
                      : 'bg-[#10131c] border-white/[0.09]'
                  }`}
                >
                  <div
                    className={`px-5 py-3 border-b flex items-center justify-between text-xs font-mono tabular-nums ${
                      isEditorial
                        ? 'bg-slate-50 border-slate-200/80 text-slate-700'
                        : 'bg-[#141824] border-white/[0.07] text-neutral-200'
                    }`}
                  >
                    <span className="font-semibold">
                      {formatKoreanDateWithDay(dateStr, false)}
                    </span>
                    <span className={isEditorial ? 'text-slate-500' : 'text-neutral-400'}>
                      {dayEvents.length}건
                    </span>
                  </div>

                  <div
                    className={`divide-y ${
                      isEditorial ? 'divide-slate-200/80' : 'divide-white/[0.06]'
                    }`}
                  >
                    {dayEvents.map((ev) => {
                      const tzMeta = getTimeZoneMeta(ev.timeZone);
                      const timing = projectEventToViewerTimeZone(
                        sharedEventToCalendarItem(ev),
                        receiverTimeZone
                      );
                      return (
                        <div
                          key={ev.id}
                          className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 min-w-0 flex-1">
                            <div className="sm:w-36 shrink-0 font-mono tabular-nums">
                              <span className="text-xs sm:text-sm font-semibold block">
                                {ev.isAllDay
                                  ? '종일'
                                  : `${ev.startTime} – ${ev.endTime} ${tzMeta.shortCode}`}
                              </span>
                              {!ev.isAllDay && timing.hasOffsetDiff && (
                                <span
                                  className={`text-[11px] block ${
                                    isEditorial ? 'text-slate-500' : 'text-neutral-400'
                                  }`}
                                >
                                  현지 {timing.localStartTime} {timing.viewerMeta.shortCode}
                                </span>
                              )}
                            </div>

                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h3 className="text-sm font-semibold break-words">
                                  {ev.title}
                                </h3>
                                <span
                                  aria-hidden="true"
                                  className={
                                    isEditorial ? 'text-slate-300' : 'text-neutral-600'
                                  }
                                >
                                  ·
                                </span>
                                <span
                                  className={`text-xs ${
                                    isEditorial ? 'text-slate-500' : 'text-neutral-400'
                                  }`}
                                >
                                  {ev.category}
                                </span>
                              </div>

                              {(ev.location || ev.locationAddress) && (
                                <div
                                  className={`text-xs flex items-start gap-1 ${
                                    isEditorial ? 'text-slate-600' : 'text-neutral-300'
                                  }`}
                                >
                                  <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-70" />
                                  <div className="min-w-0">
                                    {ev.location && (
                                      <span className="block break-words">{ev.location}</span>
                                    )}
                                    {ev.locationAddress && (
                                      <span
                                        className={`block text-[11px] break-words ${
                                          isEditorial ? 'text-slate-500' : 'text-neutral-400'
                                        }`}
                                      >
                                        {ev.locationAddress}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {ev.content && (
                                <p
                                  className={`text-xs whitespace-pre-wrap pt-0.5 ${
                                    isEditorial ? 'text-slate-500' : 'text-neutral-400'
                                  }`}
                                >
                                  {ev.content}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {(ev.location || ev.locationAddress) && (
                              <a
                                href={buildGoogleMapsSearchUrl(
                                  buildLocationSearchQuery(ev.location, ev.locationAddress)
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`h-7 px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                                  isEditorial
                                    ? 'border-slate-200 hover:bg-slate-100 text-slate-700'
                                    : 'border-white/[0.08] hover:bg-white/[0.07] text-neutral-200'
                                }`}
                              >
                                <span>지도</span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            )}

                            <button
                              type="button"
                              onClick={() => handleSaveSingleIcs(ev)}
                              className={`h-7 px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                                isEditorial
                                  ? 'border-slate-200 hover:bg-slate-100 text-slate-700'
                                  : 'border-white/[0.08] hover:bg-white/[0.07] text-neutral-300'
                              }`}
                              title="이 일정만 캘린더 저장"
                            >
                              <CalendarPlus className="w-3 h-3 shrink-0" />
                              <span>ICS</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
};
