import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarCheck,
  Check,
  CheckSquare,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Square,
  Users,
  X,
} from 'lucide-react';
import { CalendarCategory } from '../../types';
import { CALENDAR_CATEGORIES } from '../../constants/categories';
import { formatKoreanDateWithDay } from '../../shared/dateUtils';
import { minutesToTime, timeToMinutes } from '../../shared/scheduleUtils';
import {
  convertLocalSlotToEventZone,
  detectBrowserTimeZone,
  getTimeZoneMeta,
  projectEventToViewerTimeZone,
} from '../../shared/timeZoneUtils';
import {
  CollaborativeSharePassView,
  CrdtCollaborativeEventItem,
  SharePassRsvpStatus,
  SharePassSlotVoteStatus,
} from '../../shared/yjsCollabProtocol';
import { buildE2eeSharePassUrl } from '../../utils/yjsE2eeCrypto';
import { convertYDocWorkspaceToSharePayload } from '../../services/yjsSharePassDoc';
import {
  buildGoogleMapsSearchUrl,
  sharedEventToCalendarItem,
} from '../../utils/shareCodec';
import { downloadIcsFile, generateIcsContent } from '../../utils/icsExport';
import { downloadSharePassPng, renderSharePassToBlob } from '../../utils/shareCardCanvas';
import { useYjsE2eeWorkspace } from '../../hooks/useYjsE2eeWorkspace';

interface SharePassCollaborativeWorkspaceProps {
  mode: 'standalone' | 'modal';
  docId: string;
  masterKeyB64u?: string;
  linkedEventId?: string;
  linkedProjectId?: string;
  autoSyncToVault?: boolean;
  onToggleAutoSyncToVault?: (enabled: boolean) => void;
  participantId: string;
  displayName: string;
  colorHex: string;
  viewerTimeZone?: string;
  onUpdateDisplayName: (name: string) => void;
  onClose: () => void;
  onSyncWorkspaceToLocalVault?: (params: {
    docId: string;
    view: CollaborativeSharePassView;
    linkedEventId?: string;
    linkedProjectId?: string;
    silent?: boolean;
  }) => void;
  showToast?: (msg: string) => void;
}

function formatShortClock(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

export const SharePassCollaborativeWorkspace: React.FC<
  SharePassCollaborativeWorkspaceProps
> = ({
  mode,
  docId,
  masterKeyB64u,
  linkedEventId,
  linkedProjectId,
  autoSyncToVault = false,
  onToggleAutoSyncToVault,
  participantId,
  displayName,
  colorHex,
  viewerTimeZone: viewerTimeZoneProp,
  onUpdateDisplayName,
  onClose,
  onSyncWorkspaceToLocalVault,
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
    workspace,
    peers,
    remotePeerCount,
    syncStatus,
    errorMessage,
    announceEditingFocus,
    updateMeta,
    updateSharedNotes,
    coEditEvent,
    addSharedEvent,
    setEventRsvp,
    toggleChecklist,
    addChecklist,
    voteSlot,
    proposeSlot,
    finalizeSlot,
    postComment,
  } = useYjsE2eeWorkspace({
    docId,
    masterKeyB64u,
    participantId,
    displayName,
    colorHex,
    viewerTimeZone: effectiveViewerZone,
  });

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [rsvpNoteByEvent, setRsvpNoteByEvent] = useState<Record<string, string>>({});
  const [checklistInputByEvent, setChecklistInputByEvent] = useState<Record<string, string>>({});
  const [activeFeedTarget, setActiveFeedTarget] = useState<string>('general');
  const [commentInput, setCommentInput] = useState('');
  const [isAddingEvent, setIsAddingEvent] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDate, setNewEventDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newEventStart, setNewEventStart] = useState('10:00');
  const [newEventEnd, setNewEventEnd] = useState('11:00');
  const [newEventLocation, setNewEventLocation] = useState('');
  const [newEventCategory, setNewEventCategory] = useState<CalendarCategory>('업무');

  const [isAddingSlot, setIsAddingSlot] = useState(false);
  const [slotDate, setSlotDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slotStart, setSlotStart] = useState('14:00');
  const [slotLabel, setSlotLabel] = useState('');
  const [exportingPng, setExportingPng] = useState(false);

  // Korean IME-safe Y.Text collaborative notepad state
  const [notesDraft, setNotesDraft] = useState('');
  const isComposingNotesRef = useRef(false);
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const lastAutoSyncedDigestRef = useRef<string>('');

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  useEffect(() => {
    if (mode !== 'modal') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, onClose]);

  // Reconcile incoming remote Y.Text changes without breaking Hangul IME composition
  useEffect(() => {
    if (!workspace) return;
    if (!isComposingNotesRef.current) {
      setNotesDraft((prev) => (prev === workspace.sharedNotes ? prev : workspace.sharedNotes));
    }
  }, [workspace?.sharedNotes]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [workspace?.comments.length]);

  // Live Auto-Sync Bridge -> Local Encrypted Vault when enabled in modal workspace
  useEffect(() => {
    if (
      !autoSyncToVault ||
      !workspace ||
      !onSyncWorkspaceToLocalVault ||
      syncStatus === 'initializing'
    ) {
      return;
    }

    const digest = JSON.stringify({
      t: workspace.title,
      evs: workspace.events.map((e) => [
        e.id,
        e.title,
        e.date,
        e.startTime,
        e.endTime,
        e.location,
        e.content,
        e.isCompleted,
        e.checklist.map((c) => [c.id, c.text, c.done]),
      ]),
    });

    if (!lastAutoSyncedDigestRef.current) {
      // Skip initial mount snapshot so opening the modal doesn't trigger redundant history step
      lastAutoSyncedDigestRef.current = digest;
      return;
    }

    if (digest === lastAutoSyncedDigestRef.current) return;
    lastAutoSyncedDigestRef.current = digest;

    const timer = window.setTimeout(() => {
      onSyncWorkspaceToLocalVault({
        docId,
        view: workspace,
        linkedEventId,
        linkedProjectId,
        silent: true,
      });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [
    autoSyncToVault,
    docId,
    linkedEventId,
    linkedProjectId,
    onSyncWorkspaceToLocalVault,
    syncStatus,
    workspace,
  ]);

  const isEditorial = workspace?.theme === 'editorial';

  const handleCopyInviteLink = async () => {
    if (!masterKeyB64u) return;
    const url = buildE2eeSharePassUrl(docId, masterKeyB64u);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInvite(true);
      showToast?.('종단간 암호화(E2EE) 실시간 공동편집 링크가 복사되었습니다.');
      window.setTimeout(() => setCopiedInvite(false), 1800);
    } catch {
      showToast?.('클립보드 복사에 실패했습니다.');
    }
  };

  const handleSaveParticipantName = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameDraft.trim()) {
      onUpdateDisplayName(nameDraft.trim());
    }
    setIsEditingName(false);
  };

  const handleExportIcs = () => {
    if (!workspace || workspace.events.length === 0) return;
    const payload = convertYDocWorkspaceToSharePayload(workspace);
    const items =
      payload.kind === 'event' && payload.event
        ? [sharedEventToCalendarItem(payload.event)]
        : (payload.project?.events || []).map(sharedEventToCalendarItem);
    if (items.length === 0) return;
    const ics = generateIcsContent(items, workspace.title);
    downloadIcsFile(`${workspace.title}_공동편집일정.ics`, ics);
    showToast?.('실시간 공동편집 일정(.ics) 파일이 다운로드되었습니다.');
  };

  const handleExportPng = async () => {
    if (!workspace || exportingPng) return;
    setExportingPng(true);
    try {
      const payload = convertYDocWorkspaceToSharePayload(workspace);
      const blob = await renderSharePassToBlob(payload, workspace.theme);
      downloadSharePassPng(blob, `${workspace.title}_브리핑패스`);
      showToast?.('최신 공동편집 상태가 반영된 브리핑 카드(PNG)가 저장되었습니다.');
    } finally {
      setExportingPng(false);
    }
  };

  const handleCreateSharedEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventTitle.trim() || !workspace) return;
    addSharedEvent({
      title: newEventTitle.trim(),
      date: newEventDate,
      startTime: newEventStart,
      endTime: newEventEnd,
      timeZone: effectiveViewerZone,
      isAllDay: false,
      category: newEventCategory,
      location: newEventLocation.trim() || undefined,
    });
    setNewEventTitle('');
    setNewEventLocation('');
    setIsAddingEvent(false);
    showToast?.('새 공동 일정이 실시간 CRDT 문서에 추가되었습니다.');
  };

  const handleCreateProposedSlot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !slotDate || !slotStart) return;
    const primaryEv = workspace.events[0];
    const duration = primaryEv
      ? Math.max(
          30,
          timeToMinutes(primaryEv.endTime) > timeToMinutes(primaryEv.startTime)
            ? timeToMinutes(primaryEv.endTime) - timeToMinutes(primaryEv.startTime)
            : 60
        )
      : 60;
    const localEnd = minutesToTime(timeToMinutes(slotStart) + duration);
    const converted = convertLocalSlotToEventZone(
      slotDate,
      slotStart,
      localEnd,
      effectiveViewerZone,
      workspace.sourceTimeZone
    );
    proposeSlot({
      date: converted.date,
      startTime: converted.startTime,
      endTime: converted.endTime,
      timeZone: workspace.sourceTimeZone,
      label: slotLabel.trim() || undefined,
    });
    setSlotLabel('');
    setIsAddingSlot(false);
  };

  const otherNotesEditors = useMemo(
    () =>
      peers.filter(
        (p) => p.participantId !== participantId && p.activeField === 'notes'
      ),
    [participantId, peers]
  );

  const visibleComments = useMemo(() => {
    if (!workspace) return [];
    if (activeFeedTarget === 'general') return workspace.comments;
    return workspace.comments.filter((c) => c.targetId === activeFeedTarget);
  }, [activeFeedTarget, workspace]);

  const syncStatusLabel =
    syncStatus === 'connected'
      ? 'Yjs CRDT 실시간 동기화'
      : syncStatus === 'offline-ready'
      ? '오프라인 로컬 CRDT 편집 중'
      : syncStatus === 'reconnecting'
      ? '재연결 및 자동 병합 대기'
      : syncStatus === 'error'
      ? '암호화 세션 오류'
      : '암호화 문서 복호화 중';

  const bodySurfaceClass = isEditorial
    ? 'bg-[#f3f5f8] text-slate-900'
    : 'bg-[#080a10] text-neutral-100';

  const modalShellClass = isEditorial
    ? 'relative w-full max-w-6xl h-[88vh] rounded-2xl border border-slate-300 bg-[#f6f7f9] text-slate-900 shadow-2xl flex flex-col overflow-hidden'
    : 'luxury-glass-border relative w-full max-w-6xl h-[88vh] rounded-2xl bg-gradient-to-b from-[#161a25]/97 via-[#0f121b]/99 to-[#090b11] backdrop-blur-xl shadow-[0_32px_80px_-16px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden text-neutral-100';

  const borderSubtle = isEditorial ? 'border-slate-200/90' : 'border-white/[0.06]';
  const mutedText = isEditorial ? 'text-slate-500' : 'text-neutral-400';
  const inputBg = isEditorial
    ? 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-slate-400'
    : 'bg-[#090b10] border-white/[0.11] text-white placeholder:text-neutral-500 focus:border-white/30';

  const contentNode = (
    <div
      onClick={(e) => e.stopPropagation()}
      className={
        mode === 'standalone'
          ? `min-h-screen w-screen flex flex-col font-sans antialiased ${bodySurfaceClass}`
          : modalShellClass
      }
    >
      {/* 1. 상단 3-Zone 컨트롤 헤더 */}
      <header
        className={`px-5 py-3 border-b ${borderSubtle} ${
          isEditorial ? 'bg-white/95' : 'bg-[#0c0f17]/95'
        } flex flex-wrap items-center justify-between gap-3 shrink-0`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {mode === 'standalone' && (
            <button
              type="button"
              onClick={onClose}
              className={`h-8 px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isEditorial
                  ? 'border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-800'
                  : 'border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] text-neutral-200'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>내 캘린더 열기</span>
            </button>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 shrink-0 opacity-80" />
              <h2 className="text-sm font-semibold tracking-tight truncate">
                {workspace ? workspace.title : '실시간 E2EE 공동편집 패스'}
              </h2>
            </div>

            <div
              className={`mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums ${mutedText}`}
            >
              <span>{syncStatusLabel}</span>
              <span aria-hidden="true">·</span>
              <span>AES-256-GCM 종단간 암호화</span>
              <span aria-hidden="true">·</span>
              <span>동시 접속 {remotePeerCount}명</span>
              <span aria-hidden="true">·</span>
              <span>
                내 기준 {viewerTzMeta.cityKo} ({viewerTzMeta.shortCode})
              </span>
            </div>
          </div>
        </div>

        {/* 우측 액션 클러스터 */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {workspace && (
            <div
              className={`inline-flex items-center gap-0.5 p-0.5 rounded-lg border text-[11px] ${
                isEditorial
                  ? 'bg-slate-100 border-slate-200'
                  : 'bg-white/[0.04] border-white/[0.08]'
              }`}
            >
              <button
                type="button"
                onClick={() => updateMeta({ theme: 'obsidian' })}
                className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  !isEditorial
                    ? 'bg-white/[0.14] text-white'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                다크
              </button>
              <button
                type="button"
                onClick={() => updateMeta({ theme: 'editorial' })}
                className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  isEditorial
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                화이트
              </button>
            </div>
          )}

          {isEditingName ? (
            <form onSubmit={handleSaveParticipantName} className="flex items-center gap-1.5">
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={32}
                autoFocus
                placeholder="표시 이름"
                className={`h-8 w-28 px-2.5 rounded-lg border text-xs outline-none ${inputBg}`}
              />
              <button
                type="submit"
                className="h-8 px-2.5 rounded-lg bg-indigo-500 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                저장
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingName(true)}
              title="공동편집 참여자 이름 변경"
              className={`h-8 px-2.5 rounded-lg border text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                isEditorial
                  ? 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                  : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] text-neutral-200'
              }`}
            >
              <span
                aria-hidden="true"
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: colorHex }}
              />
              <span>{displayName}</span>
            </button>
          )}

          {onSyncWorkspaceToLocalVault && workspace && (
            <button
              type="button"
              onClick={() =>
                onSyncWorkspaceToLocalVault({
                  docId,
                  view: workspace,
                  linkedEventId,
                  linkedProjectId,
                })
              }
              className={`h-8 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                isEditorial
                  ? 'border-slate-300 bg-white hover:bg-slate-100 text-slate-900'
                  : 'border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.11] text-white'
              }`}
            >
              <CalendarCheck className="w-3.5 h-3.5" />
              <span>내 캘린더에 반영</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleCopyInviteLink()}
            className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              isEditorial
                ? 'bg-slate-900 text-white hover:bg-slate-800'
                : 'bg-white text-[#0b0d14] hover:bg-neutral-200'
            }`}
          >
            {copiedInvite ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedInvite ? 'E2EE 링크 복사됨' : '공동편집 링크 복사'}</span>
          </button>

          {mode === 'modal' && (
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                isEditorial
                  ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/70'
                  : 'text-neutral-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* 2. 실시간 암호화 Awareness 프레즌스 & 볼트 자동 반영 바 */}
      {workspace && (
        <div
          className={`px-5 py-2 border-b ${borderSubtle} ${
            isEditorial ? 'bg-slate-100/80' : 'bg-[#0b0e15]'
          } flex flex-wrap items-center justify-between gap-2 text-xs shrink-0`}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={`text-[11px] ${mutedText}`}>실시간 공동편집자</span>
            {peers.map((p) => {
              const tzShort = getTimeZoneMeta(p.timeZone).shortCode;
              return (
                <span
                  key={p.participantId}
                  className="inline-flex items-center gap-1.5 text-xs tabular-nums"
                >
                  <span
                    aria-hidden="true"
                    className="w-4 h-4 rounded-full text-[10px] font-semibold text-[#090b10] inline-flex items-center justify-center shrink-0"
                    style={{ backgroundColor: p.colorHex }}
                  >
                    {p.displayName.slice(0, 1)}
                  </span>
                  <span className="font-medium">{p.displayName}</span>
                  <span className={`text-[11px] ${mutedText}`}>
                    {tzShort}
                    {p.activeLabel ? ` · ${p.activeLabel}` : ''}
                  </span>
                </span>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            {mode === 'modal' && onToggleAutoSyncToVault && (
              <label className="inline-flex items-center gap-1.5 text-[11px] cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={autoSyncToVault}
                  onChange={(e) => onToggleAutoSyncToVault(e.target.checked)}
                  className="w-3.5 h-3.5 accent-indigo-500 rounded cursor-pointer"
                />
                <span className={mutedText}>로컬 암호화 볼트 실시간 자동 반영</span>
              </label>
            )}

            <button
              type="button"
              onClick={handleExportIcs}
              className={`text-[11px] inline-flex items-center gap-1 hover:underline cursor-pointer whitespace-nowrap ${mutedText}`}
            >
              <Download className="w-3 h-3" />
              <span>.ics 저장</span>
            </button>

            <button
              type="button"
              onClick={() => void handleExportPng()}
              disabled={exportingPng}
              className={`text-[11px] inline-flex items-center gap-1 hover:underline cursor-pointer whitespace-nowrap ${mutedText}`}
            >
              <ImageIcon className="w-3 h-3" />
              <span>{exportingPng ? '렌더링 중...' : 'PNG 카드'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. 본문 영역 */}
      {errorMessage && !workspace ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
          <p className="text-sm font-semibold">{errorMessage}</p>
          <p className={`text-xs max-w-md ${mutedText}`}>
            종단간 암호화 패스는 URL 해시(#sk=)에 포함된 비밀 키가 있어야 복호화됩니다. 발신자에게 전체 링크를 다시 요청해 주세요.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg bg-white text-[#0b0d14] text-xs font-semibold cursor-pointer"
          >
            돌아가기
          </button>
        </div>
      ) : !workspace ? (
        <div className={`flex-1 flex items-center justify-center text-xs ${mutedText}`}>
          종단간 암호화(E2EE) Yjs CRDT 문서를 복호화하고 동기화하는 중입니다...
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* 좌측 7컬럼: 워크스페이스 헤더 · 시간대 슬롯 투표 · 일정 공동편집 & RSVP */}
          <div
            className={`lg:col-span-7 h-full overflow-y-auto border-b lg:border-b-0 lg:border-r ${borderSubtle} divide-y ${
              isEditorial ? 'divide-slate-200/80' : 'divide-white/[0.06]'
            }`}
          >
            {/* A. 공동편집 문서 제목 및 전달 한마디 */}
            <section className="px-6 py-4 space-y-2.5">
              <div className={`text-[11px] flex flex-wrap items-center gap-x-2 tabular-nums ${mutedText}`}>
                <span>
                  {workspace.kind === 'project'
                    ? '프로젝트 공동편집 패스'
                    : '단일 일정 공동편집 패스'}
                </span>
                <span aria-hidden="true">·</span>
                <span>발행 호스트 {workspace.hostDisplayName}</span>
                {workspace.clientOrOrg && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{workspace.clientOrOrg}</span>
                  </>
                )}
              </div>

              <input
                type="text"
                value={workspace.title}
                onFocus={() => announceEditingFocus('meta:title', '제목 수정 중')}
                onBlur={() => announceEditingFocus(undefined, undefined)}
                onChange={(e) => updateMeta({ title: e.target.value })}
                placeholder="공동편집 패스 제목"
                className="w-full bg-transparent text-lg sm:text-xl font-bold tracking-tight outline-none border-b border-transparent focus:border-indigo-400/50 pb-0.5"
              />

              <div className="flex items-center gap-2">
                <span className={`text-xs shrink-0 ${mutedText}`}>현장 안내:</span>
                <input
                  type="text"
                  value={workspace.senderNote}
                  onFocus={() => announceEditingFocus('meta:note', '안내 문구 수정 중')}
                  onBlur={() => announceEditingFocus(undefined, undefined)}
                  onChange={(e) => updateMeta({ senderNote: e.target.value })}
                  placeholder="참석자에게 전달할 한 줄 안내를 함께 편집할 수 있습니다..."
                  className={`flex-1 bg-transparent text-xs outline-none border-b border-transparent focus:border-indigo-400/40 py-0.5 ${
                    isEditorial ? 'text-slate-700' : 'text-neutral-200'
                  }`}
                />
              </div>
            </section>

            {/* B. 후보 시간대 실시간 CRDT 투표 및 확정 (슬롯이 있거나 추가할 때 노출) */}
            {(workspace.proposedSlots.length > 0 || workspace.kind === 'event') && (
              <section className="px-6 py-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold">
                      후보 시간대 조율 ({workspace.proposedSlots.length})
                    </h3>
                    {workspace.finalizedSlotId && (
                      <span className="text-[11px] text-emerald-500 font-medium">
                        · 최종 시간 확정됨
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAddingSlot((prev) => !prev)}
                    className={`h-7 px-2.5 rounded-md border text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                      isEditorial
                        ? 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                        : 'border-white/[0.09] bg-white/[0.03] hover:bg-white/[0.08] text-neutral-200'
                    }`}
                  >
                    <Plus className="w-3 h-3" />
                    <span>후보 시간 제안</span>
                  </button>
                </div>

                {isAddingSlot && (
                  <form
                    onSubmit={handleCreateProposedSlot}
                    className={`py-3 border-t border-b ${borderSubtle} flex flex-wrap items-end gap-2`}
                  >
                    <div>
                      <label className={`block text-[11px] mb-1 ${mutedText}`}>
                        날짜 ({viewerTzMeta.shortCode})
                      </label>
                      <input
                        type="date"
                        value={slotDate}
                        onChange={(e) => setSlotDate(e.target.value)}
                        required
                        className={`h-8 px-2.5 rounded-lg border text-xs font-mono tabular-nums outline-none ${inputBg}`}
                      />
                    </div>
                    <div>
                      <label className={`block text-[11px] mb-1 ${mutedText}`}>시작 시각</label>
                      <input
                        type="time"
                        value={slotStart}
                        onChange={(e) => setSlotStart(e.target.value)}
                        required
                        className={`h-8 px-2.5 rounded-lg border text-xs font-mono tabular-nums outline-none ${inputBg}`}
                      />
                    </div>
                    <div className="flex-1 min-w-[130px]">
                      <label className={`block text-[11px] mb-1 ${mutedText}`}>메모 (선택)</label>
                      <input
                        type="text"
                        value={slotLabel}
                        onChange={(e) => setSlotLabel(e.target.value)}
                        placeholder="예: 오후 대안 슬롯"
                        className={`h-8 w-full px-2.5 rounded-lg border text-xs outline-none ${inputBg}`}
                      />
                    </div>
                    <button
                      type="submit"
                      className="h-8 px-3 rounded-lg bg-indigo-500 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      추가
                    </button>
                  </form>
                )}

                {workspace.proposedSlots.length === 0 ? (
                  <p className={`text-xs ${mutedText}`}>
                    시간 조율이 필요하면 우측 버튼으로 후보 시간대를 제안해 실시간 투표를 진행하세요.
                  </p>
                ) : (
                  <div
                    className={`divide-y ${
                      isEditorial ? 'divide-slate-200/75' : 'divide-white/[0.05]'
                    }`}
                  >
                    {workspace.proposedSlots.map((slot, idx) => {
                      const projected = projectEventToViewerTimeZone(
                        {
                          id: slot.id,
                          title: workspace.title,
                          date: slot.date,
                          startTime: slot.startTime,
                          endTime: slot.endTime,
                          timeZone: slot.timeZone || workspace.sourceTimeZone,
                          isAllDay: false,
                          category: '업무',
                        },
                        effectiveViewerZone
                      );
                      const votes = Object.values(slot.votes);
                      const avail = votes.filter((v) => v.status === 'available');
                      const tent = votes.filter((v) => v.status === 'tentative');
                      const unavail = votes.filter((v) => v.status === 'unavailable');
                      const myVote = slot.votes[participantId]?.status ?? null;
                      const isFinalized = workspace.finalizedSlotId === slot.id;

                      return (
                        <div key={slot.id} className="py-2.5 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className={`text-[11px] flex items-center gap-1.5 tabular-nums ${mutedText}`}>
                                <span className="font-mono">후보 {idx + 1}</span>
                                {slot.label && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{slot.label}</span>
                                  </>
                                )}
                                <span aria-hidden="true">·</span>
                                <span>제안 {slot.createdBy}</span>
                                {isFinalized && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-emerald-500 font-semibold">일정 반영됨</span>
                                  </>
                                )}
                              </div>
                              <p className="text-xs sm:text-sm font-mono font-semibold tabular-nums">
                                {formatKoreanDateWithDay(projected.localDate, true)} ·{' '}
                                {projected.localStartTime}–{projected.localEndTime}{' '}
                                {projected.viewerMeta.shortCode}
                              </p>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <div
                                className={`inline-flex items-center gap-0.5 p-0.5 rounded-lg border ${
                                  isEditorial
                                    ? 'bg-slate-100 border-slate-200'
                                    : 'bg-white/[0.03] border-white/[0.08]'
                                }`}
                              >
                                {(
                                  [
                                    { status: 'available', label: '가능' },
                                    { status: 'tentative', label: '조율' },
                                    { status: 'unavailable', label: '불가' },
                                  ] as Array<{ status: SharePassSlotVoteStatus; label: string }>
                                ).map((opt) => {
                                  const selected = myVote === opt.status;
                                  return (
                                    <button
                                      key={opt.status}
                                      type="button"
                                      onClick={() =>
                                        voteSlot(slot.id, selected ? null : opt.status)
                                      }
                                      className={`h-7 px-2 rounded-md text-xs transition-colors cursor-pointer whitespace-nowrap ${
                                        selected
                                          ? opt.status === 'available'
                                            ? 'bg-emerald-500/20 text-emerald-500 font-semibold'
                                            : opt.status === 'tentative'
                                            ? 'bg-amber-500/20 text-amber-500 font-semibold'
                                            : 'bg-rose-500/20 text-rose-500 font-semibold'
                                          : `${mutedText} hover:opacity-100`
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>

                              <button
                                type="button"
                                onClick={() => finalizeSlot(isFinalized ? null : slot.id)}
                                className={`h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                                  isFinalized
                                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500'
                                    : isEditorial
                                    ? 'border-slate-200 bg-white hover:bg-slate-100 text-slate-700'
                                    : 'border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.1] text-neutral-200'
                                }`}
                              >
                                {isFinalized ? '확정됨' : '확정'}
                              </button>
                            </div>
                          </div>

                          <div className={`text-[11px] flex flex-wrap items-center gap-x-2 tabular-nums ${mutedText}`}>
                            <span>
                              가능 {avail.length}
                              {avail.length > 0 && ` (${avail.map((v) => v.displayName).join(', ')})`}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              조율 {tent.length}
                              {tent.length > 0 && ` (${tent.map((v) => v.displayName).join(', ')})`}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>불가 {unavail.length}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* C. 일정 실시간 공동편집 · 참석 회신(RSVP) · 공동 체크리스트 */}
            <section className="px-6 py-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold">
                  공동 일정 및 실시간 참석 회신 ({workspace.events.length}건)
                </h3>
                <button
                  type="button"
                  onClick={() => setIsAddingEvent((prev) => !prev)}
                  className={`h-7 px-2.5 rounded-md border text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                    isEditorial
                      ? 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                      : 'border-white/[0.09] bg-white/[0.03] hover:bg-white/[0.08] text-neutral-200'
                  }`}
                >
                  <Plus className="w-3 h-3" />
                  <span>공동 일정 추가</span>
                </button>
              </div>

              {isAddingEvent && (
                <form
                  onSubmit={handleCreateSharedEvent}
                  className={`p-3.5 rounded-xl border ${borderSubtle} space-y-2.5`}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <input
                      type="text"
                      value={newEventTitle}
                      onChange={(e) => setNewEventTitle(e.target.value)}
                      required
                      placeholder="새 공동 일정 제목"
                      className={`sm:col-span-6 h-8 px-2.5 rounded-lg border text-xs outline-none ${inputBg}`}
                    />
                    <select
                      value={newEventCategory}
                      onChange={(e) => setNewEventCategory(e.target.value as CalendarCategory)}
                      className={`sm:col-span-3 h-8 px-2 rounded-lg border text-xs outline-none ${inputBg}`}
                    >
                      {CALENDAR_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={newEventDate}
                      onChange={(e) => setNewEventDate(e.target.value)}
                      required
                      className={`sm:col-span-3 h-8 px-2 rounded-lg border text-xs font-mono tabular-nums outline-none ${inputBg}`}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="time"
                      value={newEventStart}
                      onChange={(e) => setNewEventStart(e.target.value)}
                      className={`h-8 px-2.5 rounded-lg border text-xs font-mono tabular-nums outline-none ${inputBg}`}
                    />
                    <span className={`text-xs ${mutedText}`}>–</span>
                    <input
                      type="time"
                      value={newEventEnd}
                      onChange={(e) => setNewEventEnd(e.target.value)}
                      className={`h-8 px-2.5 rounded-lg border text-xs font-mono tabular-nums outline-none ${inputBg}`}
                    />
                    <input
                      type="text"
                      value={newEventLocation}
                      onChange={(e) => setNewEventLocation(e.target.value)}
                      placeholder="장소 (선택)"
                      className={`flex-1 min-w-[140px] h-8 px-2.5 rounded-lg border text-xs outline-none ${inputBg}`}
                    />
                    <button
                      type="submit"
                      className="h-8 px-3 rounded-lg bg-indigo-500 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      등록
                    </button>
                  </div>
                </form>
              )}

              <div
                className={`divide-y ${
                  isEditorial ? 'divide-slate-200/80' : 'divide-white/[0.06]'
                }`}
              >
                {workspace.events.map((ev: CrdtCollaborativeEventItem) => {
                  const projected = projectEventToViewerTimeZone(
                    {
                      id: ev.id,
                      title: ev.title,
                      date: ev.date,
                      endDate: ev.endDate,
                      startTime: ev.startTime,
                      endTime: ev.endTime,
                      timeZone: ev.timeZone,
                      isAllDay: ev.isAllDay,
                      category: ev.category,
                    },
                    effectiveViewerZone
                  );
                  const isEditingThis = editingEventId === ev.id;
                  const eventEditors = peers.filter(
                    (p) =>
                      p.participantId !== participantId &&
                      p.activeField?.startsWith(`event:${ev.id}`)
                  );

                  const rsvpEntries = Object.values(ev.rsvps);
                  const attendingList = rsvpEntries.filter((r) => r.status === 'attending');
                  const maybeList = rsvpEntries.filter((r) => r.status === 'maybe');
                  const declinedList = rsvpEntries.filter((r) => r.status === 'declined');
                  const myRsvp = ev.rsvps[participantId];
                  const checklistDraft = checklistInputByEvent[ev.id] || '';
                  const rsvpNoteDraft =
                    rsvpNoteByEvent[ev.id] !== undefined
                      ? rsvpNoteByEvent[ev.id]
                      : myRsvp?.note || '';

                  return (
                    <article key={ev.id} className="py-4 first:pt-1 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() =>
                              coEditEvent(ev.id, { isCompleted: !ev.isCompleted })
                            }
                            aria-label="완료 상태 전환"
                            className="mt-0.5 cursor-pointer shrink-0"
                          >
                            {ev.isCompleted ? (
                              <CheckSquare className="w-4 h-4 text-emerald-500" />
                            ) : (
                              <Square className={`w-4 h-4 ${mutedText}`} />
                            )}
                          </button>

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4
                                className={`text-sm font-semibold leading-snug ${
                                  ev.isCompleted ? 'line-through opacity-55' : ''
                                }`}
                              >
                                {ev.title}
                              </h4>
                              {eventEditors.length > 0 && (
                                <span className="text-[11px] text-indigo-400">
                                  · {eventEditors.map((p) => p.displayName).join(', ')} 편집 중
                                </span>
                              )}
                            </div>

                            <div
                              className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono tabular-nums ${mutedText}`}
                            >
                              <span>{formatKoreanDateWithDay(projected.localDate, false)}</span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {ev.isAllDay
                                  ? '종일'
                                  : `${projected.localStartTime}–${projected.localEndTime} ${projected.viewerMeta.shortCode}`}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-sans">{ev.category}</span>
                              {ev.location && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <a
                                    href={buildGoogleMapsSearchUrl(ev.location)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-sans inline-flex items-center gap-1 hover:underline"
                                  >
                                    <span>{ev.location}</span>
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                </>
                              )}
                              {ev.lastEditedBy && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-sans text-[11px]">
                                    최근 편집 {ev.lastEditedBy}
                                  </span>
                                </>
                              )}
                            </div>

                            {ev.content && !isEditingThis && (
                              <p className={`text-xs leading-relaxed pt-0.5 ${mutedText}`}>
                                {ev.content}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setEditingEventId((curr) => (curr === ev.id ? null : ev.id))
                            }
                            className={`h-7 px-2.5 rounded-md border text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                              isEditingThis
                                ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-400'
                                : isEditorial
                                ? 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                                : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-neutral-300'
                            }`}
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>{isEditingThis ? '편집 닫기' : '공동편집'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveFeedTarget(ev.id)}
                            className={`h-7 px-2.5 rounded-md border text-[11px] inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                              activeFeedTarget === ev.id
                                ? isEditorial
                                  ? 'border-slate-400 bg-slate-200 text-slate-900 font-medium'
                                  : 'border-white/25 bg-white/[0.11] text-white font-medium'
                                : isEditorial
                                ? 'border-slate-200 bg-white text-slate-600'
                                : 'border-white/[0.07] bg-white/[0.02] text-neutral-400 hover:text-white'
                            }`}
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span>피드</span>
                          </button>
                        </div>
                      </div>

                      {/* 실시간 필드 단위 CRDT 공동편집 패널 (Y.Map 키별 충돌 없는 병합) */}
                      {isEditingThis && (
                        <div
                          className={`ml-6 p-3.5 rounded-xl border ${borderSubtle} space-y-2.5`}
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <div className="sm:col-span-6">
                              <label className={`block text-[10.5px] mb-1 ${mutedText}`}>
                                일정 제목
                              </label>
                              <input
                                type="text"
                                value={ev.title}
                                onFocus={() =>
                                  announceEditingFocus(
                                    `event:${ev.id}:title`,
                                    `'${ev.title}' 제목 편집 중`
                                  )
                                }
                                onBlur={() => announceEditingFocus(undefined, undefined)}
                                onChange={(e) => coEditEvent(ev.id, { title: e.target.value })}
                                className={`h-8 w-full px-2.5 rounded-lg border text-xs outline-none ${inputBg}`}
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className={`block text-[10.5px] mb-1 ${mutedText}`}>
                                날짜 ({getTimeZoneMeta(ev.timeZone).shortCode})
                              </label>
                              <input
                                type="date"
                                value={ev.date}
                                onFocus={() =>
                                  announceEditingFocus(
                                    `event:${ev.id}:date`,
                                    `'${ev.title}' 일자 변경 중`
                                  )
                                }
                                onBlur={() => announceEditingFocus(undefined, undefined)}
                                onChange={(e) => coEditEvent(ev.id, { date: e.target.value })}
                                className={`h-8 w-full px-2 rounded-lg border text-xs font-mono tabular-nums outline-none ${inputBg}`}
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className={`block text-[10.5px] mb-1 ${mutedText}`}>
                                분류
                              </label>
                              <select
                                value={ev.category}
                                onChange={(e) =>
                                  coEditEvent(ev.id, {
                                    category: e.target.value as CalendarCategory,
                                  })
                                }
                                className={`h-8 w-full px-2 rounded-lg border text-xs outline-none ${inputBg}`}
                              >
                                {CALENDAR_CATEGORIES.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {cat}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <div className="sm:col-span-3">
                              <label className={`block text-[10.5px] mb-1 ${mutedText}`}>
                                시작 시각
                              </label>
                              <input
                                type="time"
                                value={ev.startTime}
                                disabled={ev.isAllDay}
                                onFocus={() =>
                                  announceEditingFocus(
                                    `event:${ev.id}:time`,
                                    `'${ev.title}' 시각 조정 중`
                                  )
                                }
                                onBlur={() => announceEditingFocus(undefined, undefined)}
                                onChange={(e) =>
                                  coEditEvent(ev.id, { startTime: e.target.value })
                                }
                                className={`h-8 w-full px-2 rounded-lg border text-xs font-mono tabular-nums outline-none disabled:opacity-40 ${inputBg}`}
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className={`block text-[10.5px] mb-1 ${mutedText}`}>
                                종료 시각
                              </label>
                              <input
                                type="time"
                                value={ev.endTime}
                                disabled={ev.isAllDay}
                                onFocus={() =>
                                  announceEditingFocus(
                                    `event:${ev.id}:time`,
                                    `'${ev.title}' 시각 조정 중`
                                  )
                                }
                                onBlur={() => announceEditingFocus(undefined, undefined)}
                                onChange={(e) => coEditEvent(ev.id, { endTime: e.target.value })}
                                className={`h-8 w-full px-2 rounded-lg border text-xs font-mono tabular-nums outline-none disabled:opacity-40 ${inputBg}`}
                              />
                            </div>
                            <div className="sm:col-span-6">
                              <label className={`block text-[10.5px] mb-1 ${mutedText}`}>
                                장소
                              </label>
                              <input
                                type="text"
                                value={ev.location || ''}
                                onFocus={() =>
                                  announceEditingFocus(
                                    `event:${ev.id}:location`,
                                    `'${ev.title}' 장소 편집 중`
                                  )
                                }
                                onBlur={() => announceEditingFocus(undefined, undefined)}
                                onChange={(e) => coEditEvent(ev.id, { location: e.target.value })}
                                placeholder="회의실 또는 행사장 위치"
                                className={`h-8 w-full px-2.5 rounded-lg border text-xs outline-none ${inputBg}`}
                              />
                            </div>
                          </div>

                          <div>
                            <label className={`block text-[10.5px] mb-1 ${mutedText}`}>
                              세부 메모
                            </label>
                            <input
                              type="text"
                              value={ev.content || ''}
                              onChange={(e) => coEditEvent(ev.id, { content: e.target.value })}
                              placeholder="준비 사항 또는 세부 안건..."
                              className={`h-8 w-full px-2.5 rounded-lg border text-xs outline-none ${inputBg}`}
                            />
                          </div>
                        </div>
                      )}

                      {/* 실시간 암호화 RSVP 상태 바 (참석 · 미정 · 불참) */}
                      <div className="pl-6 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div
                              className={`inline-flex items-center gap-0.5 p-0.5 rounded-lg border ${
                                isEditorial
                                  ? 'bg-slate-100 border-slate-200'
                                  : 'bg-white/[0.03] border-white/[0.08]'
                              }`}
                            >
                              {(
                                [
                                  { status: 'attending', label: '참석' },
                                  { status: 'maybe', label: '미정' },
                                  { status: 'declined', label: '불참' },
                                ] as Array<{ status: SharePassRsvpStatus; label: string }>
                              ).map((opt) => {
                                const selected = myRsvp?.status === opt.status;
                                return (
                                  <button
                                    key={opt.status}
                                    type="button"
                                    onClick={() =>
                                      setEventRsvp(
                                        ev.id,
                                        selected ? null : opt.status,
                                        rsvpNoteDraft
                                      )
                                    }
                                    className={`h-6 px-2.5 rounded-md text-[11px] transition-colors cursor-pointer whitespace-nowrap ${
                                      selected
                                        ? opt.status === 'attending'
                                          ? 'bg-emerald-500/20 text-emerald-500 font-semibold'
                                          : opt.status === 'maybe'
                                          ? 'bg-amber-500/20 text-amber-500 font-semibold'
                                          : 'bg-rose-500/20 text-rose-500 font-semibold'
                                        : `${mutedText} hover:opacity-100`
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>

                            {myRsvp && (
                              <input
                                type="text"
                                value={rsvpNoteDraft}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setRsvpNoteByEvent((prev) => ({ ...prev, [ev.id]: val }));
                                  setEventRsvp(ev.id, myRsvp.status, val);
                                }}
                                maxLength={40}
                                placeholder="회신 한마디 (예: 온라인 참석)"
                                className="h-6 w-40 bg-transparent border-b border-white/[0.08] focus:border-indigo-400/50 text-[11px] outline-none"
                              />
                            )}
                          </div>

                          <div
                            className={`text-[11px] flex flex-wrap items-center gap-x-2 tabular-nums ${mutedText}`}
                          >
                            <span>
                              참석 {attendingList.length}
                              {attendingList.length > 0 &&
                                ` (${attendingList
                                  .map((r) =>
                                    r.note ? `${r.displayName}:${r.note}` : r.displayName
                                  )
                                  .join(', ')})`}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              미정 {maybeList.length}
                              {maybeList.length > 0 &&
                                ` (${maybeList.map((r) => r.displayName).join(', ')})`}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>불참 {declinedList.length}</span>
                          </div>
                        </div>

                        {/* 공동 체크리스트 */}
                        <div className="pt-1 space-y-1">
                          {ev.checklist.map((chk) => (
                            <button
                              key={chk.id}
                              type="button"
                              onClick={() => toggleChecklist(ev.id, chk.id, !chk.done)}
                              className="w-full flex items-center justify-between gap-2 text-left text-xs py-0.5 cursor-pointer"
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                {chk.done ? (
                                  <CheckSquare className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                ) : (
                                  <Square className={`w-3.5 h-3.5 shrink-0 ${mutedText}`} />
                                )}
                                <span
                                  className={
                                    chk.done ? `line-through truncate ${mutedText}` : 'truncate'
                                  }
                                >
                                  {chk.text}
                                </span>
                              </span>
                              {chk.updatedBy && (
                                <span className={`text-[10.5px] shrink-0 ${mutedText}`}>
                                  {chk.updatedBy}
                                </span>
                              )}
                            </button>
                          ))}

                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (!checklistDraft.trim()) return;
                              addChecklist(ev.id, checklistDraft);
                              setChecklistInputByEvent((prev) => ({ ...prev, [ev.id]: '' }));
                            }}
                            className="flex items-center gap-1.5"
                          >
                            <input
                              type="text"
                              value={checklistDraft}
                              onChange={(e) =>
                                setChecklistInputByEvent((prev) => ({
                                  ...prev,
                                  [ev.id]: e.target.value,
                                }))
                              }
                              placeholder="+ 공동 체크리스트 항목 추가..."
                              className={`h-6 flex-1 bg-transparent border-b ${borderSubtle} text-xs outline-none`}
                            />
                            {checklistDraft.trim() && (
                              <button
                                type="submit"
                                className="text-[11px] font-medium px-2 py-0.5 cursor-pointer whitespace-nowrap"
                              >
                                추가
                              </button>
                            )}
                          </form>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>

          {/* 우측 5컬럼: 상단 Y.Text 공동 브리핑 노트 │ 하단 암호화 실시간 피드 */}
          <div className="lg:col-span-5 h-full flex flex-col overflow-hidden">
            {/* 상단: Y.Text 문자 단위 동시 편집 브리핑 패드 */}
            <div
              className={`h-[46%] min-h-[190px] flex flex-col border-b ${borderSubtle} ${
                isEditorial ? 'bg-white' : 'bg-[#0b0e15]/80'
              }`}
            >
              <div className={`px-4 py-2.5 border-b ${borderSubtle} flex items-center justify-between gap-2`}>
                <div className="min-w-0">
                  <span className="text-xs font-semibold block">
                    공동 브리핑 · 회의록 노트 (Y.Text CRDT)
                  </span>
                  <span className={`text-[11px] block truncate ${mutedText}`}>
                    {otherNotesEditors.length > 0
                      ? `${otherNotesEditors.map((p) => p.displayName).join(', ')} 님이 동시에 작성 중입니다`
                      : '여러 참석자가 동시에 입력해도 글자 단위로 자동 병합됩니다'}
                  </span>
                </div>
              </div>

              <textarea
                ref={notesTextareaRef}
                value={notesDraft}
                onFocus={() => announceEditingFocus('notes', '공동 노트 작성 중')}
                onBlur={() => announceEditingFocus(undefined, undefined)}
                onCompositionStart={() => {
                  isComposingNotesRef.current = true;
                }}
                onCompositionEnd={(e) => {
                  isComposingNotesRef.current = false;
                  const composed = e.currentTarget.value;
                  setNotesDraft(composed);
                  updateSharedNotes(composed);
                }}
                onChange={(e) => {
                  const next = e.target.value;
                  setNotesDraft(next);
                  if (!isComposingNotesRef.current) {
                    updateSharedNotes(next);
                  }
                }}
                placeholder="공통 안건, 현장 동선, 변경 합의 사항을 실시간으로 함께 작성해 보세요..."
                className="flex-1 w-full p-4 bg-transparent text-xs leading-relaxed resize-none outline-none select-text"
              />
            </div>

            {/* 하단: 실시간 암호화 피드 */}
            <div
              className={`flex-1 min-h-0 flex flex-col ${
                isEditorial ? 'bg-slate-50/90' : 'bg-[#090c12]'
              }`}
            >
              <div className={`px-4 py-2.5 border-b ${borderSubtle} flex items-center justify-between gap-2 shrink-0`}>
                <span className="text-xs font-semibold truncate">
                  {activeFeedTarget === 'general'
                    ? '실시간 암호화 라운지 피드'
                    : `선택 일정 스레드 (${
                        workspace.events.find((e) => e.id === activeFeedTarget)?.title || '일정'
                      })`}
                </span>
                {activeFeedTarget !== 'general' && (
                  <button
                    type="button"
                    onClick={() => setActiveFeedTarget('general')}
                    className={`text-[11px] hover:underline cursor-pointer whitespace-nowrap ${mutedText}`}
                  >
                    전체 피드 보기
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
                {visibleComments.length === 0 ? (
                  <p className={`py-6 text-center text-xs ${mutedText}`}>
                    모든 대화와 참석 회신은 공유 마스터 키로 종단간 암호화됩니다.
                  </p>
                ) : (
                  visibleComments.map((cmt) => {
                    const tzCode = getTimeZoneMeta(cmt.authorTimeZone).shortCode;
                    return (
                      <div key={cmt.id} className="space-y-0.5">
                        <div className={`flex items-center gap-1.5 text-[11px] tabular-nums ${mutedText}`}>
                          <span
                            aria-hidden="true"
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: cmt.authorColor }}
                          />
                          <span
                            className={`font-medium ${
                              isEditorial ? 'text-slate-900' : 'text-neutral-200'
                            }`}
                          >
                            {cmt.authorName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{tzCode}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{formatShortClock(cmt.createdAt)}</span>
                        </div>
                        <p className="pl-3.5 text-xs leading-relaxed whitespace-pre-wrap break-words select-text">
                          {cmt.body}
                        </p>
                      </div>
                    );
                  })
                )}
                <div ref={feedEndRef} />
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!commentInput.trim()) return;
                  postComment(activeFeedTarget, commentInput);
                  setCommentInput('');
                }}
                className={`p-3 border-t ${borderSubtle} flex items-center gap-2 shrink-0`}
              >
                <input
                  type="text"
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  placeholder="암호화 실시간 메시지 남기기..."
                  className={`h-8 flex-1 px-3 rounded-lg border text-xs outline-none ${inputBg}`}
                />
                <button
                  type="submit"
                  disabled={!commentInput.trim()}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0 ${
                    isEditorial
                      ? 'bg-slate-900 text-white hover:bg-slate-800'
                      : 'bg-white text-[#0b0d14] hover:bg-neutral-200'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>전송</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (mode === 'standalone') {
    return contentNode;
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-5 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="실시간 종단간 암호화 공동편집 SharePass 워크스페이스"
    >
      {contentNode}
    </div>
  );
};
