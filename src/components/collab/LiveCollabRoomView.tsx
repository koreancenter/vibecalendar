import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarCheck,
  CalendarPlus,
  Check,
  CheckSquare,
  Copy,
  Download,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Square,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { CalendarEventItem } from '../../types';
import { formatKoreanDateWithDay } from '../../shared/dateUtils';
import { minutesToTime, timeToMinutes } from '../../shared/scheduleUtils';
import {
  convertLocalSlotToEventZone,
  detectBrowserTimeZone,
  getTimeZoneMeta,
  projectEventToViewerTimeZone,
} from '../../shared/timeZoneUtils';
import {
  CollabProposalSlot,
  CollabRoomSnapshot,
  CollabSharedEvent,
  CollabVoteStatus,
} from '../../shared/collabSchema';
import { buildCollabInviteUrl } from '../../utils/collabCrypto';
import { downloadIcsFile, generateIcsContent } from '../../utils/icsExport';
import { useCollabRoom } from '../../hooks/useCollabRoom';

interface LiveCollabRoomViewProps {
  mode: 'standalone' | 'modal';
  roomId: string;
  roomKeyBase64Url?: string;
  hostSecret?: string;
  linkedEventId?: string;
  linkedProjectId?: string;
  linkedProjectEvents?: CalendarEventItem[];
  participantId: string;
  displayName: string;
  colorHex: string;
  viewerTimeZone?: string;
  onUpdateDisplayName: (name: string) => void;
  onClose: () => void;
  onApplyProposalToWorkspace?: (params: {
    room: CollabRoomSnapshot;
    chosenSlot: CollabProposalSlot;
    linkedEventId?: string;
  }) => void;
  onPullRunsheetToWorkspace?: (params: {
    room: CollabRoomSnapshot;
    linkedProjectId?: string;
  }) => void;
  showToast?: (msg: string) => void;
}

function formatMessageClock(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export const LiveCollabRoomView: React.FC<LiveCollabRoomViewProps> = ({
  mode,
  roomId,
  roomKeyBase64Url,
  hostSecret,
  linkedEventId,
  linkedProjectId,
  linkedProjectEvents,
  participantId,
  displayName,
  colorHex,
  viewerTimeZone: viewerTimeZoneProp,
  onUpdateDisplayName,
  onClose,
  onApplyProposalToWorkspace,
  onPullRunsheetToWorkspace,
  showToast,
}) => {
  const effectiveViewerZone = useMemo(
    () => viewerTimeZoneProp || detectBrowserTimeZone(),
    [viewerTimeZoneProp]
  );
  const viewerTzMeta = useMemo(
    () => getTimeZoneMeta(effectiveViewerZone),
    [effectiveViewerZone]
  );

  const {
    room,
    isHost,
    connectionState,
    errorMessage,
    activeTargetId,
    setActiveTargetId,
    castSlotVote,
    proposeCandidateSlot,
    finalizeProposalSlot,
    toggleSharedChecklistItem,
    addSharedChecklistItem,
    toggleSharedEventComplete,
    pushLocalEventsToRunsheetRoom,
    postComment,
  } = useCollabRoom({
    roomId,
    roomKeyBase64Url,
    hostSecret,
    participantId,
    displayName,
    colorHex,
    viewerTimeZone: effectiveViewerZone,
  });

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [copiedLink, setCopiedLink] = useState(false);
  const [noticeBanner, setNoticeBanner] = useState<string | null>(null);

  // 대안 슬롯 제안 폼 상태
  const [isProposingSlot, setIsProposingSlot] = useState(false);
  const [newSlotDate, setNewSlotDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newSlotStart, setNewSlotStart] = useState('14:00');
  const [newSlotLabel, setNewSlotLabel] = useState('');

  // 이벤트별 체크리스트 추가 입력 상태
  const [checklistDraftByEvent, setChecklistDraftByEvent] = useState<Record<string, string>>({});

  // 코멘트 입력 상태
  const [commentInput, setCommentInput] = useState('');
  const commentsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  useEffect(() => {
    if (mode !== 'modal') return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [mode, onClose]);

  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room?.comments.length, activeTargetId]);

  const notify = (msg: string) => {
    if (showToast) {
      showToast(msg);
      return;
    }
    setNoticeBanner(msg);
    window.setTimeout(() => {
      setNoticeBanner((curr) => (curr === msg ? null : curr));
    }, 2800);
  };

  const handleCopyInviteLink = async () => {
    const url = buildCollabInviteUrl(roomId, roomKeyBase64Url);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
      notify(
        room?.isE2ee
          ? '종단간 암호화(E2EE) 키가 해시(#)에 포함된 실시간 초대 링크를 복사했습니다.'
          : '실시간 협업 룸 초대 링크를 복사했습니다.'
      );
    } catch {
      notify('초대 링크 복사에 실패했습니다.');
    }
  };

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    onUpdateDisplayName(trimmed);
    setIsEditingName(false);
    notify(`표시 이름이 '${trimmed}'(으)로 변경되었습니다.`);
  };

  const handleSubmitNewSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!room) return;
    const dur = Math.max(15, room.durationMinutes || 60);
    const localEnd = minutesToTime(Math.min(23 * 60 + 45, timeToMinutes(newSlotStart) + dur));
    const converted = convertLocalSlotToEventZone(
      newSlotDate,
      newSlotStart,
      localEnd,
      effectiveViewerZone,
      room.sourceTimeZone
    );

    await proposeCandidateSlot({
      date: converted.date,
      startTime: converted.startTime,
      endTime: converted.endTime,
      timeZone: room.sourceTimeZone,
      label: newSlotLabel.trim() || `${displayName} 제안 대안`,
    });
    setNewSlotLabel('');
    setIsProposingSlot(false);
    notify('새로운 대안 시간대가 실시간 투표 목록에 추가되었습니다.');
  };

  const handleDownloadProposalIcs = (slot: CollabProposalSlot) => {
    if (!room) return;
    const calItem: CalendarEventItem = {
      id: `collab-ics-${room.roomId}-${slot.id}`,
      title: room.title,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      timeZone: slot.timeZone || room.sourceTimeZone,
      isAllDay: false,
      category: room.category || '업무',
      location: room.location,
      content: room.subtitle,
    };
    const ics = generateIcsContent([calItem], room.title);
    downloadIcsFile(`${slot.date}_${room.title}.ics`, ics);
  };

  const handleDownloadRunsheetIcs = () => {
    if (!room || room.events.length === 0) return;
    const items: CalendarEventItem[] = room.events.map((ev) => ({
      id: ev.id,
      title: ev.title,
      date: ev.date,
      endDate: ev.endDate,
      startTime: ev.startTime,
      endTime: ev.endTime,
      timeZone: ev.timeZone,
      isAllDay: ev.isAllDay,
      category: ev.category,
      location: ev.location,
      content: ev.content,
      isCompleted: ev.isCompleted,
      checklist: ev.checklist.map((c) => ({ id: c.id, text: c.text, done: c.done })),
    }));
    const ics = generateIcsContent(items, room.title);
    downloadIcsFile(`${room.title}_공동런시트.ics`, ics);
  };

  const groupedRunsheetEvents = useMemo(() => {
    if (!room || room.kind !== 'runsheet') return [];
    const map = new Map<string, CollabSharedEvent[]>();
    for (const ev of room.events) {
      const list = map.get(ev.date) || [];
      list.push(ev);
      map.set(ev.date, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [room]);

  const activeTargetLabel = useMemo(() => {
    if (!room || activeTargetId === 'general') return null;
    const ev = room.events.find((e) => e.id === activeTargetId);
    if (ev) return ev.title;
    const sl = room.proposedSlots.find((s) => s.id === activeTargetId);
    if (sl) return `${sl.date} ${sl.startTime}`;
    return null;
  }, [activeTargetId, room]);

  const visibleComments = useMemo(() => {
    if (!room) return [];
    if (activeTargetId === 'general') return room.comments;
    return room.comments.filter(
      (c) => c.targetId === activeTargetId || c.targetId === 'general' && c.isSystem
    );
  }, [activeTargetId, room]);

  const finalizedSlot = useMemo(() => {
    if (!room || !room.finalizedSlotId) return null;
    return room.proposedSlots.find((s) => s.id === room.finalizedSlotId) || null;
  }, [room]);

  const connectionLabel =
    connectionState === 'connected'
      ? '실시간 동기화 중'
      : connectionState === 'reconnecting'
      ? '재연결 시도 중'
      : connectionState === 'error'
      ? '연결 오류'
      : '세션 연결 중';

  const containerContent = (
    <div
      onClick={(e) => e.stopPropagation()}
      className={
        mode === 'standalone'
          ? 'min-h-screen w-screen bg-[#080a10] text-neutral-100 flex flex-col font-sans antialiased'
          : 'luxury-glass-border relative w-full max-w-5xl h-[86vh] rounded-2xl bg-gradient-to-b from-[#171b26]/96 via-[#10131c]/98 to-[#0b0d14]/99 backdrop-blur-xl shadow-[0_32px_80px_-16px_rgba(0,0,0,0.88)] flex flex-col overflow-hidden text-neutral-100'
      }
    >
      {/* 상단 협업 컨트롤 바 */}
      <header className="px-5 py-3.5 border-b border-white/[0.06] bg-[#0d1018]/90 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {mode === 'standalone' && (
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-xs text-neutral-300 hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>내 워크스페이스</span>
            </button>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-neutral-300 shrink-0" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold text-white tracking-tight truncate">
                {room ? room.title : '실시간 협업 룸 불러오는 중...'}
              </h2>
            </div>

            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-400 tabular-nums">
              <span>
                {room?.kind === 'runsheet' ? '공동 런시트 · 체크리스트' : '실시간 시간대 조율 (Proposals)'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{connectionLabel}</span>
              {room && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>접속 {room.presence.length}명</span>
                </>
              )}
              {room?.isE2ee && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-neutral-300">
                    <Lock className="w-2.5 h-2.5" />
                    <span>AES-256-GCM 종단간 암호화</span>
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>내 기준 {viewerTzMeta.cityKo} ({viewerTzMeta.shortCode})</span>
            </div>
          </div>
        </div>

        {/* 우측: 참여자 이름 편집 · 초대 링크 복사 · 닫기 */}
        <div className="flex items-center gap-2 shrink-0">
          {isEditingName ? (
            <form onSubmit={handleSaveName} className="flex items-center gap-1.5">
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={32}
                autoFocus
                placeholder="표시 이름"
                className="h-8 w-32 px-2.5 rounded-lg bg-[#090b10] border border-white/20 text-xs text-white outline-none"
              />
              <button
                type="submit"
                className="h-8 px-2.5 rounded-lg bg-white text-[#0b0d14] text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                저장
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingName(true)}
              title="실시간 협업 표시 이름 변경"
              className="h-8 px-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] text-xs text-neutral-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <span
                aria-hidden="true"
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: colorHex }}
              />
              <span>{displayName}</span>
              {isHost && <span className="text-[10px] text-neutral-400">· 호스트</span>}
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleCopyInviteLink()}
            className="h-8 px-3 rounded-lg bg-white text-[#0b0d14] hover:bg-neutral-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? '초대 링크 복사됨' : '초대 링크 복사'}</span>
          </button>

          {mode === 'modal' && (
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* 실시간 접속 참여자 프레즌스 바 (정적 배지 없이 깔끔한 인라인 명단) */}
      {room && room.presence.length > 0 && (
        <div className="px-5 py-2 border-b border-white/[0.05] bg-[#0b0e15] flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[11px] text-neutral-500">현재 함께 보는 참여자</span>
            {room.presence.map((p, idx) => {
              const tzShort = getTimeZoneMeta(p.timeZone).shortCode;
              return (
                <span
                  key={`${p.participantId}-${idx}`}
                  className="inline-flex items-center gap-1.5 text-xs text-neutral-200 tabular-nums"
                >
                  <span
                    aria-hidden="true"
                    className="w-4 h-4 rounded-full text-[10px] font-semibold text-[#090b10] inline-flex items-center justify-center shrink-0"
                    style={{ backgroundColor: p.colorHex }}
                  >
                    {p.displayName.slice(0, 1)}
                  </span>
                  <span>{p.displayName}</span>
                  <span className="text-[11px] text-neutral-500">
                    {tzShort}
                    {p.role === 'host' ? ' · 호스트' : ''}
                  </span>
                </span>
              );
            })}
          </div>

          {noticeBanner && (
            <span className="text-xs text-emerald-300">{noticeBanner}</span>
          )}
        </div>
      )}

      {/* 오류 상태 */}
      {errorMessage && !room ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
          <p className="text-sm font-medium text-neutral-200">{errorMessage}</p>
          <p className="text-xs text-neutral-500 max-w-md">
            초대 링크 전체 주소(해시 키 포함)가 올바른지 확인하거나 호스트에게 새 링크를 요청해 주세요.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.1] text-xs font-medium text-white cursor-pointer"
          >
            돌아가기
          </button>
        </div>
      ) : !room ? (
        <div className="flex-1 flex items-center justify-center text-xs text-neutral-400">
          실시간 협업 스냅샷을 동기화하고 있습니다...
        </div>
      ) : (
        /* 메인 2-컬럼 스튜디오: 좌측 조율/런시트 보드 (7) │ 우측 실시간 코멘트 라운지 (5) */
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* 좌측 메인 보드 */}
          <div className="lg:col-span-7 h-full overflow-y-auto border-b lg:border-b-0 lg:border-r border-white/[0.06] divide-y divide-white/[0.06]">
            {/* 룸 메타 요약 */}
            <div className="px-6 py-4 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-neutral-400 flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
                  <span>주최 {room.hostDisplayName}</span>
                  <span aria-hidden="true">·</span>
                  <span>{room.category}</span>
                  {room.kind === 'proposal' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>소요 {room.durationMinutes}분</span>
                    </>
                  )}
                  {room.location && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-neutral-300">{room.location}</span>
                    </>
                  )}
                </div>

                {room.kind === 'runsheet' && (
                  <div className="flex items-center gap-1.5">
                    {isHost && linkedProjectEvents && linkedProjectEvents.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          void pushLocalEventsToRunsheetRoom(linkedProjectEvents);
                          notify('로컬 프로젝트 최신 일정 목록을 협업 룸으로 동기화했습니다.');
                        }}
                        className="h-7 px-2.5 rounded-md border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.09] text-[11px] text-neutral-200 inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>로컬 일정 푸시</span>
                      </button>
                    )}

                    {onPullRunsheetToWorkspace && (
                      <button
                        type="button"
                        onClick={() => {
                          onPullRunsheetToWorkspace({ room, linkedProjectId });
                        }}
                        className="h-7 px-2.5 rounded-md bg-white text-[#0b0d14] hover:bg-neutral-200 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <CalendarCheck className="w-3 h-3" />
                        <span>내 캘린더에 반영</span>
                      </button>
                    )}

                    {room.events.length > 0 && (
                      <button
                        type="button"
                        onClick={handleDownloadRunsheetIcs}
                        className="h-7 px-2.5 rounded-md border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.07] text-[11px] text-neutral-300 inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Download className="w-3 h-3" />
                        <span>.ics</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {room.subtitle && (
                <p className="text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap">
                  {room.subtitle}
                </p>
              )}
            </div>

            {/* CASE A: 실시간 시간대 조율 (Proposals) */}
            {room.kind === 'proposal' && (
              <>
                {finalizedSlot && (
                  <div className="px-6 py-4 bg-emerald-500/[0.06] flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="text-[11px] font-semibold text-emerald-300 block">
                        최종 확정된 일정 시간대
                      </span>
                      {(() => {
                        const projected = projectEventToViewerTimeZone(
                          {
                            id: finalizedSlot.id,
                            title: room.title,
                            date: finalizedSlot.date,
                            startTime: finalizedSlot.startTime,
                            endTime: finalizedSlot.endTime,
                            timeZone: finalizedSlot.timeZone || room.sourceTimeZone,
                            isAllDay: false,
                            category: room.category,
                          },
                          effectiveViewerZone
                        );
                        return (
                          <p className="text-xs font-mono font-semibold text-white tabular-nums">
                            {formatKoreanDateWithDay(projected.localDate, true)} ·{' '}
                            {projected.localStartTime}–{projected.localEndTime}{' '}
                            {projected.viewerMeta.shortCode}
                          </p>
                        );
                      })()}
                    </div>

                    <div className="flex items-center gap-2">
                      {onApplyProposalToWorkspace && (
                        <button
                          type="button"
                          onClick={() =>
                            onApplyProposalToWorkspace({
                              room,
                              chosenSlot: finalizedSlot,
                              linkedEventId,
                            })
                          }
                          className="h-8 px-3 rounded-lg bg-white text-[#0b0d14] hover:bg-neutral-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <CalendarPlus className="w-3.5 h-3.5" />
                          <span>
                            {linkedEventId ? '내 일정 시각 업데이트' : '내 캘린더에 추가'}
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDownloadProposalIcs(finalizedSlot)}
                        className="h-8 px-3 rounded-lg border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.09] text-xs text-neutral-100 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>.ics 저장</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="px-6 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[13px] font-semibold text-white">
                      후보 시간대 실시간 투표 ({room.proposedSlots.length}개)
                    </h3>
                    <button
                      type="button"
                      onClick={() => setIsProposingSlot((prev) => !prev)}
                      className="h-7 px-2.5 rounded-md border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.08] text-xs text-neutral-200 inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>대안 시간대 추가</span>
                    </button>
                  </div>

                  {isProposingSlot && (
                    <form
                      onSubmit={(e) => void handleSubmitNewSlot(e)}
                      className="py-3 border-t border-b border-white/[0.07] flex flex-wrap items-end gap-2.5"
                    >
                      <div>
                        <label className="block text-[11px] text-neutral-400 mb-1">
                          날짜 ({viewerTzMeta.shortCode})
                        </label>
                        <input
                          type="date"
                          value={newSlotDate}
                          onChange={(e) => setNewSlotDate(e.target.value)}
                          required
                          className="h-8 px-2.5 rounded-lg bg-[#090b10] border border-white/[0.12] text-xs text-white font-mono tabular-nums outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-neutral-400 mb-1">
                          시작 시각 ({room.durationMinutes}분)
                        </label>
                        <input
                          type="time"
                          value={newSlotStart}
                          onChange={(e) => setNewSlotStart(e.target.value)}
                          required
                          className="h-8 px-2.5 rounded-lg bg-[#090b10] border border-white/[0.12] text-xs text-white font-mono tabular-nums outline-none"
                        />
                      </div>
                      <div className="flex-1 min-w-[140px]">
                        <label className="block text-[11px] text-neutral-400 mb-1">
                          구분 메모 (선택)
                        </label>
                        <input
                          type="text"
                          value={newSlotLabel}
                          onChange={(e) => setNewSlotLabel(e.target.value)}
                          placeholder="예: 오후 여유 슬롯"
                          className="h-8 w-full px-2.5 rounded-lg bg-[#090b10] border border-white/[0.12] text-xs text-white outline-none"
                        />
                      </div>
                      <button
                        type="submit"
                        className="h-8 px-3 rounded-lg bg-white text-[#0b0d14] text-xs font-semibold cursor-pointer whitespace-nowrap"
                      >
                        추가
                      </button>
                    </form>
                  )}

                  <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
                    {room.proposedSlots.map((slot, idx) => {
                      const projected = projectEventToViewerTimeZone(
                        {
                          id: slot.id,
                          title: room.title,
                          date: slot.date,
                          startTime: slot.startTime,
                          endTime: slot.endTime,
                          timeZone: slot.timeZone || room.sourceTimeZone,
                          isAllDay: false,
                          category: room.category,
                        },
                        effectiveViewerZone
                      );
                      const voteValues = Object.values(slot.votes);
                      const availableVotes = voteValues.filter((v) => v.status === 'available');
                      const tentativeVotes = voteValues.filter((v) => v.status === 'tentative');
                      const unavailableVotes = voteValues.filter((v) => v.status === 'unavailable');
                      const myVote = slot.votes[participantId]?.status ?? null;
                      const isFinalized = room.finalizedSlotId === slot.id;

                      return (
                        <div key={slot.id} className="py-3.5 space-y-2.5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-400 tabular-nums">
                                <span className="font-mono text-neutral-300">후보 {idx + 1}</span>
                                {slot.label && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{slot.label}</span>
                                  </>
                                )}
                                <span aria-hidden="true">·</span>
                                <span>제안 {slot.createdByName}</span>
                                {isFinalized && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-emerald-300 font-semibold">최종 확정됨</span>
                                  </>
                                )}
                              </div>

                              <p className="text-sm font-mono font-semibold text-white tabular-nums">
                                {formatKoreanDateWithDay(projected.localDate, true)} ·{' '}
                                {projected.localStartTime}–{projected.localEndTime}{' '}
                                {projected.viewerMeta.shortCode}
                              </p>

                              {!projected.isSameZone && (
                                <p className="text-[11px] font-mono text-neutral-500 tabular-nums">
                                  원본 기준: {slot.date} {slot.startTime}–{slot.endTime}{' '}
                                  {projected.sourceMeta.shortCode}
                                </p>
                              )}
                            </div>

                            {/* 내 투표 3단 세그먼트 버튼 */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.07]">
                                {(
                                  [
                                    { status: 'available', label: '가능' },
                                    { status: 'tentative', label: '조율' },
                                    { status: 'unavailable', label: '불가' },
                                  ] as Array<{ status: CollabVoteStatus; label: string }>
                                ).map((opt) => {
                                  const selected = myVote === opt.status;
                                  return (
                                    <button
                                      key={opt.status}
                                      type="button"
                                      onClick={() =>
                                        castSlotVote(slot.id, selected ? null : opt.status)
                                      }
                                      className={`h-7 px-2.5 rounded-md text-xs transition-colors cursor-pointer whitespace-nowrap ${
                                        selected
                                          ? opt.status === 'available'
                                            ? 'bg-emerald-400/20 text-emerald-200 font-semibold'
                                            : opt.status === 'tentative'
                                            ? 'bg-amber-400/20 text-amber-200 font-semibold'
                                            : 'bg-rose-400/20 text-rose-200 font-semibold'
                                          : 'text-neutral-400 hover:text-white'
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>

                              {isHost && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    finalizeProposalSlot(isFinalized ? null : slot.id)
                                  }
                                  className={`h-8 px-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                                    isFinalized
                                      ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200'
                                      : 'border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.1] text-neutral-200'
                                  }`}
                                >
                                  {isFinalized ? '확정 해제' : '확정'}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* 실시간 투표 집계 및 참여자 명단 (무테 텍스트 · 구분자) */}
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-neutral-400 tabular-nums">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-emerald-300/90">
                                가능 {availableVotes.length}
                                {availableVotes.length > 0 &&
                                  ` (${availableVotes.map((v) => v.displayName).join(', ')})`}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-300/90">
                                조율 {tentativeVotes.length}
                                {tentativeVotes.length > 0 &&
                                  ` (${tentativeVotes.map((v) => v.displayName).join(', ')})`}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="text-neutral-500">
                                불가 {unavailableVotes.length}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => setActiveTargetId(slot.id)}
                              className={`text-[11px] inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                                activeTargetId === slot.id
                                  ? 'text-white font-medium'
                                  : 'text-neutral-500 hover:text-neutral-300'
                              }`}
                            >
                              <MessageSquare className="w-3 h-3" />
                              <span>슬롯 의견</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* CASE B: 실시간 공동 런시트 & 공동 체크리스트 (TimeTree 스타일) */}
            {room.kind === 'runsheet' && (
              <div className="px-6 py-4 space-y-5">
                {groupedRunsheetEvents.length === 0 ? (
                  <p className="py-8 text-xs text-neutral-500 text-center">
                    공유된 런시트 일정이 아직 없습니다.
                  </p>
                ) : (
                  groupedRunsheetEvents.map(([dateStr, dayEvents]) => (
                    <div key={dateStr} className="space-y-2.5">
                      <div className="flex items-center justify-between border-b border-white/[0.06] pb-1.5">
                        <h3 className="text-xs font-mono font-semibold text-neutral-200 tabular-nums">
                          {formatKoreanDateWithDay(dateStr, false)}
                        </h3>
                        <span className="text-[11px] font-mono text-neutral-500 tabular-nums">
                          {dayEvents.length}개 공정
                        </span>
                      </div>

                      <div className="divide-y divide-white/[0.05]">
                        {dayEvents.map((ev) => {
                          const doneChecklistCount = ev.checklist.filter((c) => c.done).length;
                          const commentCount = room.comments.filter(
                            (c) => c.targetId === ev.id && !c.isSystem
                          ).length;
                          const draftText = checklistDraftByEvent[ev.id] || '';

                          return (
                            <div key={ev.id} className="py-3 space-y-2.5">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-2.5 min-w-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleSharedEventComplete(ev.id, !ev.isCompleted)
                                    }
                                    className="mt-0.5 text-neutral-300 hover:text-white cursor-pointer shrink-0"
                                    aria-label="공정 완료 토글"
                                  >
                                    {ev.isCompleted ? (
                                      <CheckSquare className="w-4 h-4 text-emerald-400" />
                                    ) : (
                                      <Square className="w-4 h-4 text-neutral-500" />
                                    )}
                                  </button>

                                  <div className="min-w-0 space-y-0.5">
                                    <p
                                      className={`text-sm font-medium leading-snug ${
                                        ev.isCompleted
                                          ? 'line-through text-neutral-500'
                                          : 'text-white'
                                      }`}
                                    >
                                      {ev.title}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-400 font-mono tabular-nums">
                                      <span>
                                        {ev.isAllDay ? '종일' : `${ev.startTime}–${ev.endTime}`}
                                      </span>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-sans">{ev.category}</span>
                                      {ev.location && (
                                        <>
                                          <span aria-hidden="true">·</span>
                                          <span className="font-sans text-neutral-300">
                                            {ev.location}
                                          </span>
                                        </>
                                      )}
                                      {ev.checklist.length > 0 && (
                                        <>
                                          <span aria-hidden="true">·</span>
                                          <span>
                                            체크 {doneChecklistCount}/{ev.checklist.length}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => setActiveTargetId(ev.id)}
                                  className={`h-7 px-2.5 rounded-md border text-[11px] inline-flex items-center gap-1 tabular-nums transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                                    activeTargetId === ev.id
                                      ? 'border-white/25 bg-white/[0.11] text-white font-medium'
                                      : 'border-white/[0.07] bg-white/[0.02] text-neutral-400 hover:text-white'
                                  }`}
                                >
                                  <MessageSquare className="w-3 h-3" />
                                  <span>피드 {commentCount > 0 ? commentCount : ''}</span>
                                </button>
                              </div>

                              {/* 공동 실시간 체크리스트 */}
                              <div className="pl-6 space-y-1.5">
                                {ev.checklist.map((chk) => (
                                  <button
                                    key={chk.id}
                                    type="button"
                                    onClick={() =>
                                      toggleSharedChecklistItem(ev.id, chk.id, !chk.done)
                                    }
                                    className="w-full flex items-center justify-between gap-2 text-left text-xs py-0.5 text-neutral-300 hover:text-white cursor-pointer"
                                  >
                                    <span className="flex items-center gap-2 min-w-0">
                                      {chk.done ? (
                                        <CheckSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                      ) : (
                                        <Square className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                                      )}
                                      <span
                                        className={
                                          chk.done
                                            ? 'line-through text-neutral-500 truncate'
                                            : 'truncate'
                                        }
                                      >
                                        {chk.text}
                                      </span>
                                    </span>
                                    {chk.updatedByName && (
                                      <span className="text-[10.5px] text-neutral-500 shrink-0">
                                        {chk.updatedByName}
                                      </span>
                                    )}
                                  </button>
                                ))}

                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    if (!draftText.trim()) return;
                                    void addSharedChecklistItem(ev.id, draftText);
                                    setChecklistDraftByEvent((prev) => ({
                                      ...prev,
                                      [ev.id]: '',
                                    }));
                                  }}
                                  className="flex items-center gap-1.5 pt-0.5"
                                >
                                  <input
                                    type="text"
                                    value={draftText}
                                    onChange={(e) =>
                                      setChecklistDraftByEvent((prev) => ({
                                        ...prev,
                                        [ev.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="+ 공동 준비 항목 추가..."
                                    className="h-7 flex-1 bg-transparent border-b border-white/[0.07] focus:border-white/25 text-xs text-neutral-200 placeholder:text-neutral-600 outline-none"
                                  />
                                  {draftText.trim() && (
                                    <button
                                      type="submit"
                                      className="text-[11px] font-medium text-neutral-300 hover:text-white px-2 py-0.5 cursor-pointer whitespace-nowrap"
                                    >
                                      추가
                                    </button>
                                  )}
                                </form>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* 우측: TimeTree 스타일 실시간 코멘트 · 현장 피드 스레드 */}
          <div className="lg:col-span-5 h-full flex flex-col bg-[#0b0e15]/70 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between gap-2 shrink-0">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-white block truncate">
                  {activeTargetLabel ? `스레드: ${activeTargetLabel}` : '전체 협업 라운지 피드'}
                </span>
                <span className="text-[11px] text-neutral-500 block">
                  메시지와 체크 상태가 접속한 모든 팀원에게 즉시 반영됩니다
                </span>
              </div>

              {activeTargetId !== 'general' && (
                <button
                  type="button"
                  onClick={() => setActiveTargetId('general')}
                  className="h-7 px-2.5 rounded-md border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-[11px] text-neutral-300 cursor-pointer whitespace-nowrap shrink-0"
                >
                  전체 보기
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {visibleComments.length === 0 ? (
                <p className="py-8 text-center text-xs text-neutral-500">
                  첫 코멘트나 현장 진행 상황을 남겨 보세요.
                </p>
              ) : (
                visibleComments.map((cmt) => {
                  if (cmt.isSystem) {
                    return (
                      <div
                        key={cmt.id}
                        className="py-1 text-[11px] text-neutral-400 flex items-center gap-1.5 tabular-nums"
                      >
                        <UserCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>{cmt.body}</span>
                        <span className="text-neutral-600 font-mono">
                          {formatMessageClock(cmt.createdAt)}
                        </span>
                      </div>
                    );
                  }

                  const isMine = cmt.authorId === participantId;
                  const tzCode = getTimeZoneMeta(cmt.authorTimeZone).shortCode;

                  return (
                    <div key={cmt.id} className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 tabular-nums">
                        <span
                          aria-hidden="true"
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: cmt.authorColor }}
                        />
                        <span className={isMine ? 'font-semibold text-white' : 'text-neutral-200'}>
                          {cmt.authorName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-neutral-500">{tzCode}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-neutral-500">
                          {formatMessageClock(cmt.createdAt)}
                        </span>
                      </div>
                      <p className="pl-3.5 text-xs text-neutral-200 leading-relaxed whitespace-pre-wrap break-words select-text">
                        {cmt.body}
                      </p>
                    </div>
                  );
                })
              )}
              <div ref={commentsEndRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!commentInput.trim()) return;
                void postComment(commentInput);
                setCommentInput('');
              }}
              className="p-3 border-t border-white/[0.06] bg-[#0d1018] flex items-center gap-2 shrink-0"
            >
              <input
                type="text"
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder={
                  activeTargetLabel
                    ? `'${activeTargetLabel}'에 대한 실시간 코멘트 입력...`
                    : '팀원들에게 실시간 메시지 남기기...'
                }
                className="h-9 flex-1 px-3 rounded-lg bg-[#080a10] border border-white/[0.09] focus:border-white/25 text-xs text-white placeholder:text-neutral-500 outline-none"
              />
              <button
                type="submit"
                disabled={!commentInput.trim()}
                className="h-9 px-3.5 rounded-lg bg-white text-[#0b0d14] hover:bg-neutral-200 disabled:opacity-40 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>전송</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );

  if (mode === 'standalone') {
    return containerContent;
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[74] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="실시간 멀티유저 협업 룸"
    >
      {containerContent}
    </div>
  );
};
