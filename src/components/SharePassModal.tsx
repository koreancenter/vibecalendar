import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eye,
  FileText,
  Link2,
  MapPin,
  Share2,
  X,
} from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import { formatKoreanDateWithDay } from '../shared/dateUtils';
import { formatCombinedLocation } from '../shared/locationUtils';
import { getTimeZoneMeta } from '../shared/timeZoneUtils';
import {
  buildProjectSharePayload,
  buildSharePassUrl,
  buildSingleEventSharePayload,
  encodeSharePayload,
  formatPassPlainText,
  ShareCardTheme,
  SharedPassPayload,
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
  showToast: (msg: string) => void;
}

export const SharePassModal: React.FC<SharePassModalProps> = ({
  target,
  events,
  projects,
  viewerTimeZone,
  onClose,
  onPreviewStandalone,
  showToast,
}) => {
  const [theme, setTheme] = useState<ShareCardTheme>('obsidian');
  const [senderNote, setSenderNote] = useState('');
  const [includeMemo, setIncludeMemo] = useState(false);
  const [includeChecklist, setIncludeChecklist] = useState(false);
  const [includeCompleted, setIncludeCompleted] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copiedAction, setCopiedAction] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setSenderNote('');
    setIncludeMemo(false);
    setIncludeChecklist(false);
    setIncludeCompleted(true);
    setCopiedAction(null);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [target, onClose]);

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
        className="w-full max-w-3xl max-h-[90vh] bg-[#0e1118] border border-white/[0.09] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* 상단 헤더 */}
        <div className="h-13 px-5 border-b border-white/[0.07] bg-[#11141d] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3
              id="share-pass-modal-title"
              className="text-sm font-semibold text-white tracking-tight whitespace-nowrap"
            >
              {payload.kind === 'event' ? '일정 브리핑 패스 공유' : '프로젝트 일정표 패스 공유'}
            </h3>
            <span aria-hidden="true" className="text-neutral-600">
              ·
            </span>
            <span className="text-xs text-neutral-400 truncate">
              외부 수신자 로그인 불필요
            </span>
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
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12">
          {/* 좌측: 실시간 브리핑 패스 미리보기 */}
          <div
            className={`lg:col-span-7 p-5 sm:p-6 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-white/[0.07] transition-colors duration-150 ${
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

          {/* 우측: 브리핑 패스 구성 & 원클릭 전달 컨트롤 */}
          <div className="lg:col-span-5 p-5 flex flex-col justify-between gap-5 bg-[#0e1118]">
            <div className="space-y-4">
              {/* 1. 카드 테마 선택 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-neutral-300">패스 스킨</span>
                  <span className="text-[11px] text-neutral-500">
                    {isEditorial ? '주간 야외 가독성 최적' : '기본 다크 브리핑'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#151924] border border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setTheme('obsidian')}
                    className={`h-8 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      theme === 'obsidian'
                        ? 'bg-white/[0.11] text-white'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    옵시디언 다크
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('editorial')}
                    className={`h-8 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      theme === 'editorial'
                        ? 'bg-white text-slate-900'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    화이트 페이퍼
                  </button>
                </div>
              </div>

              {/* 2. 현장 전달 코멘트 (원본 일정 불변) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="share-sender-note" className="font-medium text-neutral-300">
                    전달 한마디
                  </label>
                  <span className="text-[11px] text-neutral-500">패스에만 표시됨</span>
                </div>
                <div className="relative">
                  <input
                    id="share-sender-note"
                    type="text"
                    maxLength={140}
                    value={senderNote}
                    onChange={(e) => setSenderNote(e.target.value)}
                    placeholder="예: 정문 회전교차로 앞 비상등 대기 부탁드립니다"
                    className="w-full h-9 px-3 pr-7 rounded-xl bg-[#151924] border border-white/[0.08] focus:border-white/[0.22] text-xs text-white placeholder:text-neutral-500 outline-hidden transition-colors"
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

              {/* 3. 공개 범위 필터 */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-neutral-300 block">
                  공개 항목 선택
                </span>
                <div className="rounded-xl bg-[#151924] border border-white/[0.06] divide-y divide-white/[0.05]">
                  <label
                    className={`flex items-center justify-between px-3 py-2.5 text-xs ${
                      hasEventMemo ? 'cursor-pointer' : 'opacity-45 cursor-not-allowed'
                    }`}
                  >
                    <span className="text-neutral-200">
                      {target.kind === 'event' ? '상세 메모 포함' : '일정별 세부 메모 포함'}
                    </span>
                    <input
                      type="checkbox"
                      disabled={!hasEventMemo}
                      checked={includeMemo}
                      onChange={(e) => setIncludeMemo(e.target.checked)}
                      className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
                    />
                  </label>

                  {target.kind === 'event' ? (
                    <label
                      className={`flex items-center justify-between px-3 py-2.5 text-xs ${
                        hasEventChecklist ? 'cursor-pointer' : 'opacity-45 cursor-not-allowed'
                      }`}
                    >
                      <span className="text-neutral-200">체크리스트 포함</span>
                      <input
                        type="checkbox"
                        disabled={!hasEventChecklist}
                        checked={includeChecklist}
                        onChange={(e) => setIncludeChecklist(e.target.checked)}
                        className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
                      />
                    </label>
                  ) : (
                    <label className="flex items-center justify-between px-3 py-2.5 text-xs cursor-pointer">
                      <span className="text-neutral-200">완료된 일정 포함</span>
                      <input
                        type="checkbox"
                        checked={includeCompleted}
                        onChange={(e) => setIncludeCompleted(e.target.checked)}
                        className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
                      />
                    </label>
                  )}
                </div>
                <p className="text-[11px] text-neutral-500 leading-relaxed">
                  체크하지 않은 내부 메모와 타 일정 데이터는 링크와 이미지 어디에도 포함되지 않습니다.
                </p>
              </div>
            </div>

            {/* 4. 공유 액션 버튼 그룹 */}
            <div className="space-y-2 pt-2 border-t border-white/[0.06]">
              {/* 대표 액션: 고해상도 카드 이미지 클립보드 복사 */}
              <button
                type="button"
                onClick={handleCopyCardImage}
                disabled={Boolean(busyAction)}
                className="w-full h-10 px-4 rounded-xl bg-white hover:bg-neutral-200 text-neutral-950 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                {copiedAction === 'image' ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>카드 이미지 복사됨 (바로 붙여넣기)</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 shrink-0" />
                    <span>카드 이미지 복사 (카톡·메신저 붙여넣기)</span>
                  </>
                )}
              </button>

              {/* 보조 액션 2열 */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleCopyShareLink}
                  disabled={Boolean(busyAction)}
                  className="h-9 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.07] text-neutral-100 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copiedAction === 'link' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <Link2 className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                  )}
                  <span>{copiedAction === 'link' ? '링크 복사됨' : '전용 링크 복사'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyBriefingText}
                  disabled={Boolean(busyAction)}
                  className="h-9 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.07] text-neutral-100 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copiedAction === 'text' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                  )}
                  <span>{copiedAction === 'text' ? '문구 복사됨' : '문구·링크 복사'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadPng}
                  disabled={Boolean(busyAction)}
                  className="h-9 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.06] text-neutral-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>PNG 저장</span>
                </button>

                <button
                  type="button"
                  onClick={() => onPreviewStandalone(payload)}
                  disabled={Boolean(busyAction)}
                  className="h-9 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.06] text-neutral-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span>수신자 화면 보기</span>
                </button>
              </div>

              {canUseNativeShare() && (
                <button
                  type="button"
                  onClick={handleNativeShare}
                  disabled={Boolean(busyAction)}
                  className="w-full h-9 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.07] text-neutral-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Share2 className="w-3.5 h-3.5 shrink-0" />
                  <span>기기 공유 시트 열기</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
