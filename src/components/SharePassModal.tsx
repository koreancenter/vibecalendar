import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eye,
  FileText,
  Link2,
  Lock,
  MapPin,
  Share2,
  Users,
  X,
} from 'lucide-react';
import { HelpTooltip } from './common/HelpTooltip';
import { CalendarEventItem, ProjectItem } from '../types';
import { addDays, formatKoreanDateWithDay } from '../shared/dateUtils';
import { formatCombinedLocation } from '../shared/locationUtils';
import {
  calculateFreeTimeSlots,
  minutesToTime,
  timeToMinutes,
} from '../shared/scheduleUtils';
import {
  convertLocalSlotToEventZone,
  getTimeZoneMeta,
  projectEventToViewerTimeZone,
  resolveEventTimeZone,
  toViewerProjectedEvent,
} from '../shared/timeZoneUtils';
import {
  buildProjectSharePayload,
  buildSharePassUrl,
  buildSingleEventSharePayload,
  encodeSharePayload,
  formatPassPlainText,
  ShareCardTheme,
  SharedPassPayload,
  SharedProposedSlot,
} from '../utils/shareCodec';
import {
  canUseNativeShare,
  copySharePassImageToClipboard,
  downloadSharePassPng,
  renderSharePassToBlob,
} from '../utils/shareCardCanvas';

export type ShareModalTarget =
  | { kind: 'event'; event: CalendarEventItem }
  | { kind: 'project'; project: ProjectItem };

interface SharePassModalProps {
  target: ShareModalTarget | null;
  events: CalendarEventItem[];
  projects: ProjectItem[];
  viewerTimeZone: string;
  onClose: () => void;
  onPreviewStandalone: (payload: SharedPassPayload) => void;
  onLaunchE2eeSharePass?: (
    payload: SharedPassPayload,
    target: ShareModalTarget
  ) => Promise<void> | void;
  onLaunchLiveCollab?: (
    target: ShareModalTarget,
    proposedSlots: SharedProposedSlot[]
  ) => Promise<void> | void;
  showToast: (msg: string) => void;
}

export const SharePassModal: React.FC<SharePassModalProps> = ({
  target,
  events,
  projects,
  viewerTimeZone,
  onClose,
  onPreviewStandalone,
  onLaunchE2eeSharePass,
  onLaunchLiveCollab,
  showToast,
}) => {
  const [shareMode, setShareMode] = useState<'live-crdt' | 'static-pass'>('live-crdt');
  const [theme, setTheme] = useState<ShareCardTheme>('obsidian');
  const [senderNote, setSenderNote] = useState('');
  const [includeMemo, setIncludeMemo] = useState(false);
  const [includeChecklist, setIncludeChecklist] = useState(false);
  const [includeProposedSlots, setIncludeProposedSlots] = useState(false);
  const [includeCompleted, setIncludeCompleted] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copiedAction, setCopiedAction] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setShareMode(onLaunchE2eeSharePass ? 'live-crdt' : 'static-pass');
    setSenderNote('');
    setIncludeMemo(false);
    setIncludeChecklist(false);
    setIncludeProposedSlots(false);
    setIncludeCompleted(true);
    setCopiedAction(null);
  }, [target, onLaunchE2eeSharePass]);

  useEffect(() => {
    if (!target) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [target, onClose]);

  const candidateProposedSlots = useMemo<SharedProposedSlot[]>(() => {
    if (!target || target.kind !== 'event' || target.event.isAllDay) return [];
    const ev = target.event;
    const sourceTz = resolveEventTimeZone(ev, viewerTimeZone);
    const projectedEv = projectEventToViewerTimeZone(ev, viewerTimeZone);
    const startMin = timeToMinutes(projectedEv.localStartTime);
    const endMin = timeToMinutes(projectedEv.localEndTime);
    const duration = Math.max(30, endMin > startMin ? endMin - startMin : 60);

    const results: SharedProposedSlot[] = [
      {
        date: ev.date,
        startTime: ev.startTime,
        endTime: ev.endTime,
        label: '1순위 제안',
      },
    ];

    const projectedPool = events
      .filter((other) => other.id !== ev.id && !other.isAllDay)
      .map((other) => toViewerProjectedEvent(other, viewerTimeZone));

    for (let dayOffset = 0; dayOffset <= 2 && results.length < 3; dayOffset++) {
      const checkLocalDate =
        dayOffset === 0 ? projectedEv.localDate : addDays(projectedEv.localDate, dayOffset);
      const dayEvents = projectedPool.filter((other) => other.date === checkLocalDate);
      const gaps = calculateFreeTimeSlots(dayEvents, duration);

      for (const gap of gaps) {
        const gStart = timeToMinutes(gap.startTime);
        const gEnd = timeToMinutes(gap.endTime);
        for (
          let candStart = gStart;
          candStart + duration <= gEnd && results.length < 3;
          candStart += 60
        ) {
          const candStartStr = minutesToTime(candStart);
          const candEndStr = minutesToTime(candStart + duration);
          const inSource = convertLocalSlotToEventZone(
            checkLocalDate,
            candStartStr,
            candEndStr,
            viewerTimeZone,
            sourceTz
          );
          const duplicate = results.some(
            (r) =>
              r.date === inSource.date &&
              r.startTime === inSource.startTime &&
              r.endTime === inSource.endTime
          );
          if (!duplicate) {
            results.push({
              date: inSource.date,
              startTime: inSource.startTime,
              endTime: inSource.endTime,
              label: dayOffset === 0 ? '당일 대안' : '익일 대안',
            });
          }
        }
      }
    }

    return results;
  }, [target, events, viewerTimeZone]);

  const payload = useMemo<SharedPassPayload | null>(() => {
    if (!target) return null;
    if (target.kind === 'event') {
      const proj = projects.find((p) => p.id === target.event.projectId);
      return buildSingleEventSharePayload({
        event: target.event,
        viewerTimeZone,
        projectName: proj?.name,
        theme,
        senderNote,
        includeMemo,
        includeChecklist,
        proposedSlots: includeProposedSlots ? candidateProposedSlots : undefined,
      });
    }
    return buildProjectSharePayload({
      project: target.project,
      events,
      viewerTimeZone,
      theme,
      senderNote,
      includeMemo,
      includeCompleted,
    });
  }, [
    target,
    projects,
    events,
    viewerTimeZone,
    theme,
    senderNote,
    includeMemo,
    includeChecklist,
    includeProposedSlots,
    candidateProposedSlots,
    includeCompleted,
  ]);

  if (!target || !payload) return null;

  const markCopied = (key: string) => {
    setCopiedAction(key);
    window.setTimeout(() => {
      setCopiedAction((prev) => (prev === key ? null : prev));
    }, 1800);
  };

  const hasEventMemo =
    target.kind === 'event' ? Boolean(target.event.content?.trim()) : true;
  const hasEventChecklist =
    target.kind === 'event'
      ? Boolean(target.event.checklist && target.event.checklist.length > 0)
      : false;

  const baseFilename =
    payload.kind === 'event' && payload.event
      ? `${payload.event.date}_${payload.event.title}_브리핑패스`
      : payload.project
      ? `${payload.project.name}_일정브리핑`
      : '브리핑패스';

  const handleCopyCardImage = async () => {
    if (busyAction) return;
    setBusyAction('image');
    try {
      const blob = await renderSharePassToBlob(payload, theme);
      const copied = await copySharePassImageToClipboard(blob);
      if (copied) {
        markCopied('image');
        showToast('브리핑 카드 이미지를 복사했습니다. 카카오톡이나 메시지에 바로 붙여넣으세요.');
      } else {
        downloadSharePassPng(blob, baseFilename);
        showToast('클립보드 이미지 제한 환경이어서 고해상도 PNG 파일로 저장했습니다.');
      }
    } catch {
      showToast('브리핑 카드 이미지 생성 중 오류가 발생했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadPng = async () => {
    if (busyAction) return;
    setBusyAction('download');
    try {
      const blob = await renderSharePassToBlob(payload, theme);
      downloadSharePassPng(blob, baseFilename);
      showToast('고해상도 브리핑 카드 PNG 파일을 저장했습니다.');
    } catch {
      showToast('PNG 파일 저장에 실패했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyShareLink = async () => {
    if (busyAction) return;
    setBusyAction('link');
    try {
      const token = await encodeSharePayload(payload);
      const url = buildSharePassUrl(token);
      await navigator.clipboard.writeText(url);
      markCopied('link');
      showToast('수신자 전용 브리핑 패스 링크를 복사했습니다.');
    } catch {
      showToast('링크 복사에 실패했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyBriefingText = async () => {
    if (busyAction) return;
    setBusyAction('text');
    try {
      const token = await encodeSharePayload(payload);
      const url = buildSharePassUrl(token);
      const text = formatPassPlainText(payload, url);
      await navigator.clipboard.writeText(text);
      markCopied('text');
      showToast('브리핑 요약 문구와 전용 링크를 함께 복사했습니다.');
    } catch {
      showToast('문구 복사에 실패했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleNativeShare = async () => {
    if (busyAction || !canUseNativeShare()) return;
    setBusyAction('native');
    try {
      const [blob, token] = await Promise.all([
        renderSharePassToBlob(payload, theme),
        encodeSharePayload(payload),
      ]);
      const url = buildSharePassUrl(token);
      const title =
        payload.kind === 'event' && payload.event
          ? payload.event.title
          : payload.project?.name || '일정 브리핑 패스';
      const text = formatPassPlainText(payload);
      const file = new File([blob], `${baseFilename}.png`, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title,
          text,
          url,
          files: [file],
        });
      } else {
        await navigator.share({
          title,
          text: `${text}\n\n${url}`,
          url,
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 사용자가 공유 시트를 닫은 경우 무시
      } else {
        showToast('기기 공유 시트를 열지 못했습니다. 이미지 복사나 링크 복사를 이용해 주세요.');
      }
    } finally {
      setBusyAction(null);
    }
  };

  const isEditorial = theme === 'editorial';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-pass-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="luxury-glass-border w-full max-w-4xl h-[560px] max-h-[90vh] bg-gradient-to-b from-[#141724]/96 via-[#0f121a]/96 to-[#090b12]/98 backdrop-blur-xl border border-white/[0.09] rounded-2xl shadow-[0_28px_72px_-16px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col select-none"
      >
        {/* 상단 헤더 */}
        <div className="h-12 px-5 sm:px-6 border-b border-white/[0.06] bg-[#11141d]/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3
              id="share-pass-modal-title"
              className="text-sm font-semibold text-white tracking-tight whitespace-nowrap"
            >
              {payload.kind === 'event' ? '일정 브리핑 패스 공유' : '프로젝트 일정표 패스 공유'}
            </h3>
            <HelpTooltip
              title="서버리스 종단간 암호화(E2EE) 패스"
              content="외부 수신자의 회원가입이나 로그인 없이, URL 해시 파편(#sk=)을 통해 브라우저 간 종단간 암호화(AES-256-GCM)로 안전하게 단방향 공유됩니다."
              align="left"
              placement="bottom"
            />
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0"
            title="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 본문 2단 레이아웃: 좌측 실시간 보딩패스 프리뷰 / 우측 설정 및 공유 액션 */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* 좌측: 실시간 브리핑 패스 미리보기 */}
          <div
            className={`lg:col-span-7 p-5 sm:p-6 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-white/[0.07] overflow-y-auto transition-colors duration-150 ${
              isEditorial ? 'bg-[#eef1f5]' : 'bg-[#080a10]'
            }`}
          >
            <div
              className={`w-full max-w-md rounded-2xl border p-5 sm:p-6 transition-colors duration-150 select-text ${
                isEditorial
                  ? 'bg-white border-slate-900/[0.11] text-slate-900 shadow-sm'
                  : 'bg-[#10131c] border-white/[0.12] text-slate-50'
              }`}
            >
              {payload.kind === 'event' && payload.event ? (
                (() => {
                  const ev = payload.event;
                  const tzMeta = getTimeZoneMeta(ev.timeZone);
                  return (
                    <div className="space-y-4">
                      {/* 킥커 & 타이틀 */}
                      <div>
                        <p
                          className={`text-[11px] font-medium ${
                            isEditorial ? 'text-slate-500' : 'text-neutral-400'
                          }`}
                        >
                          {ev.projectName
                            ? `${ev.projectName} · ${ev.category}`
                            : `일정 브리핑 패스 · ${ev.category}`}
                        </p>
                        <h4
                          className={`mt-1.5 text-lg sm:text-xl font-bold leading-snug break-words [text-wrap:balance] ${
                            isEditorial ? 'text-slate-900' : 'text-white'
                          }`}
                        >
                          {ev.title}
                        </h4>
                      </div>

                      {/* 절취선 */}
                      <div
                        className={`border-t border-dashed ${
                          isEditorial ? 'border-slate-300' : 'border-white/[0.12]'
                        }`}
                      />

                      {/* 일자 & 시간 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <span
                            className={`text-[11px] block ${
                              isEditorial ? 'text-slate-500' : 'text-neutral-400'
                            }`}
                          >
                            일자
                          </span>
                          <span className="mt-0.5 block text-sm font-mono font-semibold tabular-nums">
                            {formatKoreanDateWithDay(ev.date, false)}
                          </span>
                        </div>
                        <div>
                          <span
                            className={`text-[11px] block ${
                              isEditorial ? 'text-slate-500' : 'text-neutral-400'
                            }`}
                          >
                            시간 · 기준 시간대
                          </span>
                          <span className="mt-0.5 block text-sm font-mono font-semibold tabular-nums">
                            {ev.isAllDay
                              ? '종일 일정'
                              : `${ev.startTime} – ${ev.endTime} ${tzMeta.shortCode}`}
                          </span>
                          {!ev.isAllDay && (
                            <span
                              className={`text-[11px] block mt-0.5 ${
                                isEditorial ? 'text-slate-500' : 'text-neutral-500'
                              }`}
                            >
                              {tzMeta.cityKo} 현지 시각 기준
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 장소 · 상세 주소 */}
                      {(ev.location || ev.locationAddress) && (
                        <div
                          className={`pt-3 border-t ${
                            isEditorial ? 'border-slate-200/80' : 'border-white/[0.07]'
                          }`}
                        >
                          <span
                            className={`text-[11px] block ${
                              isEditorial ? 'text-slate-500' : 'text-neutral-400'
                            }`}
                          >
                            장소 · 상세 주소
                          </span>
                          <div className="mt-1 flex items-start gap-1.5">
                            <MapPin
                              className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                                isEditorial ? 'text-slate-500' : 'text-neutral-400'
                              }`}
                            />
                            <div className="min-w-0">
                              {ev.location && (
                                <span className="block text-xs sm:text-sm font-medium break-words">
                                  {ev.location}
                                </span>
                              )}
                              {ev.locationAddress && (
                                <span
                                  className={`block text-[11px] sm:text-xs mt-0.5 break-words ${
                                    isEditorial ? 'text-slate-500' : 'text-neutral-400'
                                  }`}
                                >
                                  {ev.locationAddress}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 전달 한마디 */}
                      {payload.senderNote && (
                        <div
                          className={`p-3 rounded-xl border ${
                            isEditorial
                              ? 'bg-slate-50 border-slate-200 text-slate-800'
                              : 'bg-[#161a26] border-white/[0.08] text-neutral-100'
                          }`}
                        >
                          <span
                            className={`text-[10px] font-medium block mb-1 ${
                              isEditorial ? 'text-slate-500' : 'text-neutral-400'
                            }`}
                          >
                            전달 사항
                          </span>
                          <p className="text-xs sm:text-[13px] leading-relaxed break-words">
                            {payload.senderNote}
                          </p>
                        </div>
                      )}

                      {/* 상세 메모 */}
                      {ev.content && (
                        <div
                          className={`pt-3 border-t ${
                            isEditorial ? 'border-slate-200/80' : 'border-white/[0.07]'
                          }`}
                        >
                          <span
                            className={`text-[11px] block mb-1 ${
                              isEditorial ? 'text-slate-500' : 'text-neutral-400'
                            }`}
                          >
                            상세 메모
                          </span>
                          <p
                            className={`text-xs whitespace-pre-wrap leading-relaxed line-clamp-4 ${
                              isEditorial ? 'text-slate-700' : 'text-neutral-300'
                            }`}
                          >
                            {ev.content}
                          </p>
                        </div>
                      )}

                      {/* 체크리스트 */}
                      {ev.checklist && ev.checklist.length > 0 && (
                        <div
                          className={`pt-3 border-t space-y-1.5 ${
                            isEditorial ? 'border-slate-200/80' : 'border-white/[0.07]'
                          }`}
                        >
                          <span
                            className={`text-[11px] block font-mono tabular-nums ${
                              isEditorial ? 'text-slate-500' : 'text-neutral-400'
                            }`}
                          >
                            체크리스트 · {ev.checklist.length}건
                          </span>
                          {ev.checklist.slice(0, 4).map((item) => (
                            <div key={item.id} className="flex items-center gap-2 text-xs">
                              <span
                                className={`font-mono text-[11px] ${
                                  isEditorial ? 'text-slate-400' : 'text-neutral-500'
                                }`}
                              >
                                [{item.done ? 'v' : ' '}]
                              </span>
                              <span
                                className={
                                  item.done
                                    ? 'line-through opacity-55'
                                    : isEditorial
                                    ? 'text-slate-700'
                                    : 'text-neutral-200'
                                }
                              >
                                {item.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {ev.proposedSlots && ev.proposedSlots.length > 0 && (
                        <div className="space-y-1.5">
                          <span
                            className={`text-[11px] font-medium block ${
                              isEditorial ? 'text-slate-400' : 'text-neutral-400'
                            }`}
                          >
                            후보 시간 제안 · {ev.proposedSlots.length}개 옵션
                          </span>
                          <div className="space-y-1">
                            {ev.proposedSlots.map((slot, idx) => (
                              <div
                                key={`${slot.date}-${slot.startTime}-${idx}`}
                                className={`text-xs font-mono tabular-nums flex items-center justify-between gap-2 ${
                                  isEditorial ? 'text-slate-700' : 'text-neutral-200'
                                }`}
                              >
                                <span>
                                  #{idx + 1} {slot.date} {slot.startTime}–{slot.endTime}{' '}
                                  {tzMeta.shortCode}
                                </span>
                                {slot.label && (
                                  <span
                                    className={`font-sans text-[11px] ${
                                      isEditorial ? 'text-slate-400' : 'text-neutral-500'
                                    }`}
                                  >
                                    {slot.label}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 패스 푸터 */}
                      <div
                        className={`pt-3 border-t flex items-center justify-between text-[10px] ${
                          isEditorial
                            ? 'border-slate-200/80 text-slate-400'
                            : 'border-white/[0.07] text-neutral-500'
                        }`}
                      >
                        <span>바이브 행사 · 브리핑 패스</span>
                        <span className="font-mono tabular-nums">발행 {payload.issuedAt}</span>
                      </div>
                    </div>
                  );
                })()
              ) : payload.project ? (
                <div className="space-y-4">
                  <div>
                    <p
                      className={`text-[11px] font-medium ${
                        isEditorial ? 'text-slate-500' : 'text-neutral-400'
                      }`}
                    >
                      {['프로젝트 일정 브리핑', payload.project.clientOrOrg, payload.project.code]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <h4
                      className={`mt-1 text-lg sm:text-xl font-bold leading-snug break-words [text-wrap:balance] ${
                        isEditorial ? 'text-slate-900' : 'text-white'
                      }`}
                    >
                      {payload.project.name}
                    </h4>
                    <p
                      className={`mt-1 text-xs font-mono tabular-nums ${
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
                      className={`p-3 rounded-xl border ${
                        isEditorial
                          ? 'bg-slate-50 border-slate-200 text-slate-800'
                          : 'bg-[#161a26] border-white/[0.08] text-neutral-100'
                      }`}
                    >
                      <span
                        className={`text-[10px] font-medium block mb-1 ${
                          isEditorial ? 'text-slate-500' : 'text-neutral-400'
                        }`}
                      >
                        전달 사항
                      </span>
                      <p className="text-xs leading-relaxed break-words">{payload.senderNote}</p>
                    </div>
                  )}

                  <div
                    className={`border-t border-dashed ${
                      isEditorial ? 'border-slate-300' : 'border-white/[0.12]'
                    }`}
                  />

                  <div
                    className={`divide-y ${
                      isEditorial ? 'divide-slate-200/80' : 'divide-white/[0.06]'
                    }`}
                  >
                    {payload.project.events.length === 0 ? (
                      <p className="py-4 text-xs text-neutral-500">공유할 일정이 없습니다.</p>
                    ) : (
                      payload.project.events.slice(0, 5).map((ev) => {
                        const tzMeta = getTimeZoneMeta(ev.timeZone);
                        return (
                          <div
                            key={ev.id}
                            className="py-2 first:pt-0 last:pb-0 flex items-start gap-3 text-xs"
                          >
                            <span
                              className={`w-28 shrink-0 font-mono tabular-nums text-[11px] pt-0.5 ${
                                isEditorial ? 'text-slate-500' : 'text-neutral-400'
                              }`}
                            >
                              {ev.date.slice(5).replace('-', '.')}{' '}
                              {ev.isAllDay ? '종일' : `${ev.startTime} ${tzMeta.shortCode}`}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold truncate">{ev.title}</p>
                              {(ev.location || ev.locationAddress) && (
                                <p
                                  className={`text-[11px] truncate ${
                                    isEditorial ? 'text-slate-500' : 'text-neutral-400'
                                  }`}
                                >
                                  {formatCombinedLocation(ev.location, ev.locationAddress)}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {payload.project.events.length > 5 && (
                    <p
                      className={`text-[11px] font-mono tabular-nums ${
                        isEditorial ? 'text-slate-500' : 'text-neutral-400'
                      }`}
                    >
                      외 {payload.project.events.length - 5}건 일정 포함
                    </p>
                  )}

                  <div
                    className={`pt-3 border-t flex items-center justify-between text-[10px] ${
                      isEditorial
                        ? 'border-slate-200/80 text-slate-400'
                        : 'border-white/[0.07] text-neutral-500'
                    }`}
                  >
                    <span>바이브 행사 · 브리핑 패스</span>
                    <span className="font-mono tabular-nums">발행 {payload.issuedAt}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* 우측: 브리핑 패스 구성 & 직관적 미니멀 액션 */}
          <div className="lg:col-span-5 p-5 sm:p-6 flex flex-col justify-between gap-4 bg-[#0e1118] overflow-y-auto">
            <div className="space-y-3.5">
              {/* 1. 패스 공유 방식 (단일 직관적 세그먼트) */}
              {onLaunchE2eeSharePass && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[11px] font-semibold text-neutral-400">공유 모드</span>
                    <span className="text-[10.5px] text-neutral-500 font-mono">
                      {shareMode === 'live-crdt' ? 'E2EE 실시간 협업' : '정적 스냅샷'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#141722] border border-white/[0.07]">
                    <button
                      type="button"
                      onClick={() => setShareMode('live-crdt')}
                      className={`h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                        shareMode === 'live-crdt'
                          ? 'bg-white text-neutral-950 shadow-xs'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>실시간 공동편집</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShareMode('static-pass')}
                      className={`h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                        shareMode === 'static-pass'
                          ? 'bg-white text-neutral-950 shadow-xs'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>정적 브리핑 카드</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 2. 패스 스킨 테마 (인라인 토글) */}
              <div className="flex items-center justify-between text-xs pt-0.5">
                <span className="text-[11px] font-medium text-neutral-400">디자인 스킨</span>
                <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[#141722] border border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setTheme('obsidian')}
                    className={`h-6 px-2.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      theme === 'obsidian'
                        ? 'bg-white/[0.14] text-white font-semibold'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    옵시디언 다크
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('editorial')}
                    className={`h-6 px-2.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      theme === 'editorial'
                        ? 'bg-white text-slate-900 font-semibold'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    화이트 페이퍼
                  </button>
                </div>
              </div>

              {/* 3. 전달 메모 / 공동 노트 */}
              <div className="space-y-1.5">
                <label
                  htmlFor="share-sender-note"
                  className="text-[11px] font-medium text-neutral-400 block"
                >
                  {shareMode === 'live-crdt'
                    ? '초기 공동 메모 (참여자 실시간 동기화)'
                    : '전달 사항 (카드 내 표시)'}
                </label>
                <div className="relative">
                  <input
                    id="share-sender-note"
                    type="text"
                    maxLength={140}
                    value={senderNote}
                    onChange={(e) => setSenderNote(e.target.value)}
                    placeholder={
                      shareMode === 'live-crdt'
                        ? '예: 정문 회전교차로 앞 비상등 대기 부탁드립니다'
                        : '수신자에게 전달할 메모를 입력하세요'
                    }
                    className="w-full h-8.5 px-3 pr-7 rounded-xl bg-[#141722] border border-white/[0.08] focus:border-white/20 text-xs text-white placeholder:text-neutral-500 outline-none transition-colors"
                  />
                  {senderNote && (
                    <button
                      type="button"
                      onClick={() => setSenderNote('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-neutral-500 hover:text-neutral-200 cursor-pointer"
                      title="입력 지우기"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* 4. 공개 항목 (미니멀 칩 토글 버튼) */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-neutral-400 block">
                  공개 항목 포함
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {target.kind === 'event' ? (
                    <>
                      {hasEventMemo && (
                        <button
                          type="button"
                          onClick={() => setIncludeMemo(!includeMemo)}
                          className={`h-7 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition-all cursor-pointer ${
                            includeMemo
                              ? 'bg-white/[0.12] border-white/20 text-white'
                              : 'bg-[#141722] border-white/[0.06] text-neutral-500 hover:text-neutral-300'
                          }`}
                        >
                          <Check
                            className={`w-3 h-3 ${includeMemo ? 'text-emerald-400' : 'opacity-0'}`}
                          />
                          <span>상세 메모</span>
                        </button>
                      )}
                      {hasEventChecklist && (
                        <button
                          type="button"
                          onClick={() => setIncludeChecklist(!includeChecklist)}
                          className={`h-7 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition-all cursor-pointer ${
                            includeChecklist
                              ? 'bg-white/[0.12] border-white/20 text-white'
                              : 'bg-[#141722] border-white/[0.06] text-neutral-500 hover:text-neutral-300'
                          }`}
                        >
                          <Check
                            className={`w-3 h-3 ${
                              includeChecklist ? 'text-emerald-400' : 'opacity-0'
                            }`}
                          />
                          <span>체크리스트</span>
                        </button>
                      )}
                      {!target.event.isAllDay && candidateProposedSlots.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setIncludeProposedSlots(!includeProposedSlots)}
                          className={`h-7 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition-all cursor-pointer ${
                            includeProposedSlots
                              ? 'bg-white/[0.12] border-white/20 text-white'
                              : 'bg-[#141722] border-white/[0.06] text-neutral-500 hover:text-neutral-300'
                          }`}
                        >
                          <Check
                            className={`w-3 h-3 ${
                              includeProposedSlots ? 'text-emerald-400' : 'opacity-0'
                            }`}
                          />
                          <span>후보 시간 ({candidateProposedSlots.length}개)</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIncludeCompleted(!includeCompleted)}
                      className={`h-7 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition-all cursor-pointer ${
                        includeCompleted
                          ? 'bg-white/[0.12] border-white/20 text-white'
                          : 'bg-[#141722] border-white/[0.06] text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      <Check
                        className={`w-3 h-3 ${
                          includeCompleted ? 'text-emerald-400' : 'opacity-0'
                        }`}
                      />
                      <span>완료된 일정 포함</span>
                    </button>
                  )}
                </div>
              </div>

              {/* 암호화 보안 안내 */}
              <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 pt-0.5">
                <Lock className="w-3 h-3 text-emerald-400/90 shrink-0" />
                <span>
                  {shareMode === 'live-crdt'
                    ? 'Yjs CRDT 종단간 암호화: 마스터 키(#sk)는 서버로 전송되지 않습니다.'
                    : '불변 암호화 패스: 선택된 항목만 안전하게 전달됩니다.'}
                </span>
              </div>
            </div>

            {/* 5. 공유 액션 버튼 그룹 (미니멀리즘 집중 레이아웃) */}
            <div className="space-y-2 pt-3 border-t border-white/[0.06]">
              {shareMode === 'live-crdt' && onLaunchE2eeSharePass ? (
                <>
                  {/* 대표 액션: 실시간 협업 개설 및 링크 복사 */}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!target) return;
                      setBusyAction('e2ee-crdt');
                      try {
                        await onLaunchE2eeSharePass(payload, target);
                      } finally {
                        setBusyAction(null);
                      }
                    }}
                    disabled={Boolean(busyAction)}
                    className="w-full h-10 px-4 rounded-xl bg-white hover:bg-neutral-200 text-neutral-950 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60 shadow-xs"
                  >
                    <Lock className="w-4 h-4 shrink-0" />
                    <span>
                      {busyAction === 'e2ee-crdt'
                        ? 'CRDT 암호화 스페이스 생성 중...'
                        : '실시간 E2EE 협업 개설 · 링크 복사'}
                    </span>
                  </button>

                  {/* 보조 액션 툴바 (깔끔한 1열 3분할 툴바) */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={handleCopyCardImage}
                      disabled={Boolean(busyAction)}
                      className="h-8.5 px-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.07] text-neutral-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      title="카드 이미지 복사 (메신저 바로 붙여넣기)"
                    >
                      {copiedAction === 'image' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>{copiedAction === 'image' ? '복사됨' : '이미지 복사'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onPreviewStandalone(payload)}
                      disabled={Boolean(busyAction)}
                      className="h-8.5 px-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.07] text-neutral-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      title="수신자 화면 미리보기"
                    >
                      <Eye className="w-3.5 h-3.5 shrink-0" />
                      <span>미리보기</span>
                    </button>

                    {onLaunchLiveCollab ? (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!target) return;
                          setBusyAction('collab');
                          try {
                            await onLaunchLiveCollab(target, candidateProposedSlots);
                          } finally {
                            setBusyAction(null);
                          }
                        }}
                        disabled={Boolean(busyAction)}
                        className="h-8.5 px-2 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/25 text-indigo-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
                        title="시간대 투표 전용 룸 개설"
                      >
                        <Users className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
                        <span>시간대 투표</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleDownloadPng}
                        disabled={Boolean(busyAction)}
                        className="h-8.5 px-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.07] text-neutral-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5 shrink-0" />
                        <span>PNG 저장</span>
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* 대표 액션: 카드 이미지 복사 (메신저 전송용) */}
                  <button
                    type="button"
                    onClick={handleCopyCardImage}
                    disabled={Boolean(busyAction)}
                    className="w-full h-10 px-4 rounded-xl bg-white hover:bg-neutral-200 text-neutral-950 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60 shadow-xs"
                  >
                    {copiedAction === 'image' ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>카드 이미지 복사됨 (메신저 붙여넣기)</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 shrink-0" />
                        <span>카드 이미지 복사 (메신저 바로 전송)</span>
                      </>
                    )}
                  </button>

                  {/* 보조 액션 툴바 (깔끔한 3열 툴바) */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={handleCopyShareLink}
                      disabled={Boolean(busyAction)}
                      className="h-8.5 px-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.07] text-neutral-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {copiedAction === 'link' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>{copiedAction === 'link' ? '복사됨' : '링크 복사'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadPng}
                      disabled={Boolean(busyAction)}
                      className="h-8.5 px-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.07] text-neutral-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      <span>PNG 저장</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onPreviewStandalone(payload)}
                      disabled={Boolean(busyAction)}
                      className="h-8.5 px-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.07] text-neutral-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5 shrink-0" />
                      <span>미리보기</span>
                    </button>
                  </div>

                  {canUseNativeShare() && (
                    <button
                      type="button"
                      onClick={handleNativeShare}
                      disabled={Boolean(busyAction)}
                      className="w-full h-8 px-3 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-neutral-400 hover:text-neutral-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Share2 className="w-3.5 h-3.5 shrink-0" />
                      <span>기기 공유 시트 열기</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
