import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  Copy,
  Edit3,
  ListChecks,
  Loader2,
  Lock,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { CalendarEventItem, ProjectItem, SavedCollabRoomItem } from '../../types';
import { buildCollabInviteUrl, parseCollabInviteFromUrl } from '../../utils/collabCrypto';
import {
  buildE2eeSharePassUrl,
  parseE2eeSharePassInvite,
} from '../../utils/yjsE2eeCrypto';
import { LocalCollabProfile } from '../../hooks/useCollabWorkspace';
import { HelpTooltip } from '../common/HelpTooltip';

interface CollabHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: CalendarEventItem[];
  projects: ProjectItem[];
  selectedDate: string;
  selectedProjectId: string | 'all';
  profile: LocalCollabProfile;
  onUpdateDisplayName: (name: string) => void;
  savedRooms: SavedCollabRoomItem[];
  isCreatingRoom: boolean;
  onOpenRoom: (room: {
    roomId: string;
    kind?: SavedCollabRoomItem['kind'];
    roomKeyBase64Url?: string;
    hostSecret?: string;
    linkedEventId?: string;
    linkedProjectId?: string;
  }) => void;
  onJoinRoomByInvite: (roomId: string, roomKeyBase64Url?: string) => void;
  onJoinSharePassByInvite?: (docId: string, masterKeyB64u: string) => void;
  onCreateSharePassWorkspace?: (params: {
    scope: 'event' | 'project';
    event?: CalendarEventItem;
    project?: ProjectItem;
  }) => Promise<void>;
  onRemoveSavedRoom: (roomId: string) => void;
  onCreateProposalRoom: (params: {
    title: string;
    location?: string;
    durationMinutes: number;
    isE2ee: boolean;
    seedEvent?: CalendarEventItem;
  }) => Promise<{ record: SavedCollabRoomItem; inviteUrl: string }>;
  onCreateRunsheetRoom: (params: {
    title: string;
    subtitle?: string;
    project?: ProjectItem;
    events: CalendarEventItem[];
    isE2ee: boolean;
  }) => Promise<{ record: SavedCollabRoomItem; inviteUrl: string }>;
  showToast: (msg: string) => void;
}

type HubTab = 'rooms' | 'new-sharepass' | 'new-proposal' | 'new-runsheet';

export const CollabHubModal: React.FC<CollabHubModalProps> = ({
  isOpen,
  onClose,
  events,
  projects,
  selectedDate,
  selectedProjectId,
  profile,
  onUpdateDisplayName,
  savedRooms,
  isCreatingRoom,
  onOpenRoom,
  onJoinRoomByInvite,
  onJoinSharePassByInvite,
  onCreateSharePassWorkspace,
  onRemoveSavedRoom,
  onCreateProposalRoom,
  onCreateRunsheetRoom,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<HubTab>('rooms');
  const [nameInput, setNameInput] = useState(profile.displayName);
  const [joinUrlInput, setJoinUrlInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copiedRoomId, setCopiedRoomId] = useState<string | null>(null);

  // 새 E2EE 공동편집 패스(Yjs CRDT) 폼
  const [spScope, setSpScope] = useState<'event' | 'project'>(
    projects.length > 0 && selectedProjectId !== 'all' ? 'project' : 'event'
  );
  const [spEventId, setSpEventId] = useState<string>('');
  const [spProjectId, setSpProjectId] = useState<string>(
    selectedProjectId !== 'all' ? selectedProjectId : projects[0]?.id || ''
  );
  const [isCreatingSharePass, setIsCreatingSharePass] = useState(false);

  // 새 시간대 조율(Proposal) 룸 폼
  const [selectedSeedEventId, setSelectedSeedEventId] = useState<string>('custom');
  const [proposalTitle, setProposalTitle] = useState('');
  const [proposalLocation, setProposalLocation] = useState('');
  const [proposalDuration, setProposalDuration] = useState<number>(60);
  const [proposalE2ee, setProposalE2ee] = useState<boolean>(true);

  // 새 공동 런시트(Runsheet) 룸 폼
  const [selectedRunsheetProjectId, setSelectedRunsheetProjectId] = useState<string>(
    selectedProjectId !== 'all' ? selectedProjectId : projects[0]?.id || 'all'
  );
  const [runsheetTitle, setRunsheetTitle] = useState('');
  const [runsheetE2ee, setRunsheetE2ee] = useState<boolean>(true);

  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      return;
    }
    setNameInput(profile.displayName);
    setJoinError(null);

    // 모달이 처음 열릴 때만 기본 탭을 결정하고, 열려있는 동안에는 사용자의 탭 전환을 보존
    if (!prevIsOpenRef.current) {
      prevIsOpenRef.current = true;
      setActiveTab(
        savedRooms.length > 0
          ? 'rooms'
          : onCreateSharePassWorkspace
          ? 'new-sharepass'
          : 'new-proposal'
      );
    }

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose, onCreateSharePassWorkspace, profile.displayName, savedRooms.length]);

  const upcomingCandidateEvents = useMemo(
    () =>
      events
        .filter((e) => !e.isCompleted)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
        .slice(0, 30),
    [events]
  );

  useEffect(() => {
    if (!spEventId && upcomingCandidateEvents[0]?.id) {
      setSpEventId(upcomingCandidateEvents[0].id);
    }
  }, [spEventId, upcomingCandidateEvents]);

  useEffect(() => {
    if (!spProjectId && projects[0]?.id) {
      setSpProjectId(projects[0].id);
    }
  }, [spProjectId, projects]);

  const selectedRunsheetProject = useMemo(
    () => projects.find((p) => p.id === selectedRunsheetProjectId),
    [projects, selectedRunsheetProjectId]
  );

  const runsheetTargetEvents = useMemo(() => {
    if (selectedRunsheetProjectId === 'all') {
      return events.slice(0, 50);
    }
    return events.filter((e) => e.projectId === selectedRunsheetProjectId);
  }, [events, selectedRunsheetProjectId]);

  if (!isOpen) return null;

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedSharePass = parseE2eeSharePassInvite(joinUrlInput);
    if (parsedSharePass && onJoinSharePassByInvite) {
      setJoinUrlInput('');
      setJoinError(null);
      onJoinSharePassByInvite(parsedSharePass.docId, parsedSharePass.masterKeyB64u);
      return;
    }

    const parsed = parseCollabInviteFromUrl(joinUrlInput);
    if (!parsed) {
      setJoinError(
        '올바른 E2EE 공동편집 링크(?spass=...#sk=...) 또는 라이브 협업 링크(?collab=...#rk=...)를 입력해 주세요.'
      );
      return;
    }
    setJoinUrlInput('');
    setJoinError(null);
    onJoinRoomByInvite(parsed.roomId, parsed.roomKeyBase64Url);
  };

  const handleCreateProposalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const seedEv =
      selectedSeedEventId !== 'custom'
        ? events.find((ev) => ev.id === selectedSeedEventId)
        : undefined;

    const finalTitle = (proposalTitle.trim() || seedEv?.title || `${selectedDate} 미팅 조율`).trim();
    const finalLocation = (proposalLocation.trim() || seedEv?.location || '').trim() || undefined;

    try {
      const { record, inviteUrl } = await onCreateProposalRoom({
        title: finalTitle,
        location: finalLocation,
        durationMinutes: proposalDuration,
        isE2ee: proposalE2ee,
        seedEvent: seedEv,
      });
      await navigator.clipboard.writeText(inviteUrl).catch(() => {});
      showToast('실시간 시간대 조율 룸이 개설되었으며 초대 링크가 복사되었습니다.');
      onOpenRoom(record);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '조율 룸 생성 중 오류가 발생했습니다.');
    }
  };

  const handleCreateRunsheetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalTitle = (
      runsheetTitle.trim() ||
      selectedRunsheetProject?.name ||
      '실시간 공동 행사 런시트'
    ).trim();

    try {
      const { record, inviteUrl } = await onCreateRunsheetRoom({
        title: finalTitle,
        subtitle: selectedRunsheetProject?.description,
        project: selectedRunsheetProject,
        events: runsheetTargetEvents,
        isE2ee: runsheetE2ee,
      });
      await navigator.clipboard.writeText(inviteUrl).catch(() => {});
      showToast('실시간 공동 런시트 룸이 개설되었으며 초대 링크가 복사되었습니다.');
      onOpenRoom(record);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '런시트 룸 생성 중 오류가 발생했습니다.');
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[72] flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="라이브 협업 및 실시간 시간대 조율 허브"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="luxury-glass-border relative w-full max-w-2xl h-[580px] max-h-[90vh] rounded-2xl bg-gradient-to-b from-[#181c27]/96 via-[#11141d]/96 to-[#0c0e15]/98 backdrop-blur-xl shadow-[0_28px_72px_-16px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden text-neutral-200"
      >
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-neutral-300 shrink-0" strokeWidth={1.75} />
            <h2 className="text-[15px] font-semibold text-white tracking-tight truncate">
              라이브 협업 룸 및 실시간 일정 조율 허브
            </h2>
            <HelpTooltip
              title="실시간 E2EE 협업 워크스페이스"
              content="WebSocket 실시간 프레즌스 및 Yjs CRDT 기반으로 공동 브리핑 노트 동시 작성, 글로벌 시차 자동 투표, 공동 현장 런시트를 종단간 암호화로 동기화합니다."
              align="left"
              placement="bottom"
            />
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 내 표시 이름 + 탭 바 */}
        <div className="px-6 py-3 border-b border-white/[0.06] bg-[#0e1119] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.07] flex-wrap">
            {(
              [
                { id: 'rooms', label: `참여 룸 (${savedRooms.length})` },
                ...(onCreateSharePassWorkspace
                  ? ([{ id: 'new-sharepass', label: '새 E2EE 공동편집' }] as Array<{
                      id: HubTab;
                      label: string;
                    }>)
                  : []),
                { id: 'new-proposal', label: '새 시간대 조율' },
                { id: 'new-runsheet', label: '새 공동 런시트' },
              ] as Array<{ id: HubTab; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`h-7 px-3 rounded-md text-xs tabular-nums transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-white/[0.12] text-white font-medium'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!nameInput.trim()) return;
              onUpdateDisplayName(nameInput);
              showToast(`협업 프로필 이름이 '${nameInput.trim()}'(으)로 저장되었습니다.`);
            }}
            className="flex items-center gap-1.5"
          >
            <span className="text-[11px] text-neutral-500">내 이름</span>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={32}
              className="h-7 w-28 px-2 rounded-md bg-[#090b10] border border-white/[0.09] focus:border-white/25 text-xs text-white outline-none"
            />
            {nameInput.trim() !== profile.displayName && (
              <button
                type="submit"
                className="h-7 px-2 rounded-md bg-white text-[#0b0d14] text-[11px] font-semibold cursor-pointer whitespace-nowrap"
              >
                적용
              </button>
            )}
          </form>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {activeTab === 'rooms' && (
            <>
              {/* 초대 링크로 입장 */}
              <form onSubmit={handleJoinSubmit} className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="block text-xs font-medium text-neutral-200">
                    초대 링크 또는 룸 코드로 즉시 합류
                  </label>
                  <HelpTooltip
                    title="초대 링크 지원 규격"
                    content="SharePass 협업 링크(?spass=...#sk=...) 또는 라이브 조율 링크(?collab=...#rk=...)를 붙여넣어 즉시 세션에 참여합니다."
                    align="left"
                    placement="bottom"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={joinUrlInput}
                    onChange={(e) => {
                      setJoinUrlInput(e.target.value);
                      setJoinError(null);
                    }}
                    placeholder="https://...?spass=sp_...#sk=... 또는 ?collab=rm_...#rk=... 붙여넣기"
                    className="h-9 flex-1 px-3 rounded-lg bg-[#090b10] border border-white/[0.1] focus:border-white/25 text-xs text-white placeholder:text-neutral-500 outline-none"
                  />
                  <button
                    type="submit"
                    className="h-9 px-4 rounded-lg bg-white text-[#0b0d14] hover:bg-neutral-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    룸 입장
                  </button>
                </div>
                {joinError && <p className="text-xs text-amber-300">{joinError}</p>}
              </form>

              {/* 내 협업 룸 목록 */}
              <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                <span className="text-xs font-medium text-neutral-300 block">
                  최근 개설 · 참여한 라이브 협업 스페이스
                </span>

                {savedRooms.length === 0 ? (
                  <p className="py-6 text-xs text-neutral-500">
                    아직 저장된 협업 룸이 없습니다. 상단 탭에서 ‘새 E2EE 공동편집’, ‘새 시간대 조율’, 또는 ‘새 공동 런시트’를 개설해 보세요.
                  </p>
                ) : (
                  <div className="divide-y divide-white/[0.06] border-t border-b border-white/[0.06]">
                    {savedRooms.map((item) => (
                      <div
                        key={item.roomId}
                        className="py-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-2">
                            {item.kind === 'sharepass-crdt' ? (
                              <Edit3 className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                            ) : item.kind === 'proposal' ? (
                              <CalendarClock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                            ) : (
                              <ListChecks className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                            )}
                            <span className="text-xs font-semibold text-white truncate">
                              {item.localTitle}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500 tabular-nums">
                            <span>
                              {item.kind === 'sharepass-crdt'
                                ? 'SharePass 공동편집 (Yjs CRDT)'
                                : item.kind === 'proposal'
                                ? '시간대 투표 조율'
                                : '공동 런시트'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {item.kind === 'sharepass-crdt'
                                ? item.autoSyncToVault
                                  ? '로컬 볼트 실시간 반영'
                                  : '무충돌 동시 편집'
                                : item.hostSecret
                                ? '호스트 권한'
                                : '게스트 참여'}
                            </span>
                            {item.isE2ee && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 text-neutral-400">
                                  <Lock className="w-2.5 h-2.5" />
                                  <span>E2EE 암호화</span>
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onOpenRoom(item)}
                            className="h-8 px-3 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <span>열기</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const url =
                                item.kind === 'sharepass-crdt'
                                  ? buildE2eeSharePassUrl(
                                      item.roomId,
                                      item.roomKeyBase64Url || ''
                                    )
                                  : buildCollabInviteUrl(item.roomId, item.roomKeyBase64Url);
                              void navigator.clipboard.writeText(url).then(() => {
                                setCopiedRoomId(item.roomId);
                                window.setTimeout(() => setCopiedRoomId(null), 1600);
                                showToast('암호화 초대 링크를 클립보드에 복사했습니다.');
                              });
                            }}
                            title="초대 링크 복사"
                            className="h-8 w-8 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.08] text-neutral-300 flex items-center justify-center transition-colors cursor-pointer"
                          >
                            {copiedRoomId === item.roomId ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => onRemoveSavedRoom(item.roomId)}
                            title="목록에서 제거"
                            className="h-8 w-8 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.08] text-neutral-500 hover:text-neutral-200 flex items-center justify-center transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'new-sharepass' && onCreateSharePassWorkspace && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (isCreatingSharePass) return;
                setIsCreatingSharePass(true);
                try {
                  if (spScope === 'event') {
                    const ev = events.find((item) => item.id === spEventId) || events[0];
                    if (!ev) {
                      showToast('공동편집할 일정이 없습니다. 먼저 일정을 생성해 주세요.');
                      return;
                    }
                    await onCreateSharePassWorkspace({ scope: 'event', event: ev });
                  } else {
                    const proj =
                      projects.find((item) => item.id === spProjectId) || projects[0];
                    if (!proj) {
                      showToast('공동편집할 프로젝트가 없습니다. 먼저 프로젝트를 생성해 주세요.');
                      return;
                    }
                    await onCreateSharePassWorkspace({ scope: 'project', project: proj });
                  }
                } finally {
                  setIsCreatingSharePass(false);
                }
              }}
              className="space-y-4"
            >
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs font-semibold text-white">
                  실시간 E2EE 공동편집 워크스페이스 개설 (Yjs CRDT)
                </h3>
                <HelpTooltip
                  title="Yjs CRDT 무충돌 동시 편집 & 영지식 암호화"
                  content="기존 단방향 SharePass를 실시간 다자간 무충돌 복제 문서(CRDT)로 진화시켜, 브리핑 노트 공동 작성·일정 세부정보 인라인 수정·참석 여부(RSVP) 응답을 영지식 종단간 암호화로 즉시 동기화합니다."
                  align="left"
                  placement="bottom"
                />
              </div>

              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#090b10] border border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setSpScope('event')}
                  className={`h-8 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    spScope === 'event'
                      ? 'bg-white text-slate-950 font-semibold'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  단일 일정 공동편집 패스
                </button>
                <button
                  type="button"
                  onClick={() => setSpScope('project')}
                  className={`h-8 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    spScope === 'project'
                      ? 'bg-white text-slate-950 font-semibold'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  프로젝트 통합 공동편집 패스
                </button>
              </div>

              {spScope === 'event' ? (
                <div>
                  <label className="block text-xs text-neutral-300 mb-1.5">
                    대상 일정 선택
                  </label>
                  <select
                    value={spEventId}
                    onChange={(e) => setSpEventId(e.target.value)}
                    className="h-9 w-full px-3 rounded-lg bg-[#090b10] border border-white/[0.1] text-xs text-white outline-none"
                  >
                    {upcomingCandidateEvents.length === 0 ? (
                      <option value="">등록된 일정이 없습니다</option>
                    ) : (
                      upcomingCandidateEvents.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          [{ev.date} {ev.isAllDay ? '종일' : ev.startTime}] {ev.title}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-neutral-300 mb-1.5">
                    대상 프로젝트 선택
                  </label>
                  <select
                    value={spProjectId}
                    onChange={(e) => setSpProjectId(e.target.value)}
                    className="h-9 w-full px-3 rounded-lg bg-[#090b10] border border-white/[0.1] text-xs text-white outline-none"
                  >
                    {projects.length === 0 ? (
                      <option value="">등록된 프로젝트가 없습니다</option>
                    ) : (
                      projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({events.filter((e) => e.projectId === p.id).length}개 일정)
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}

              <div className="py-2.5 border-t border-b border-white/[0.06] flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-xs text-neutral-300">
                  <Lock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <span className="font-medium text-white">HKDF-SHA256 키 분리 · AES-256-GCM 암호화</span>
                </div>
                <HelpTooltip
                  title="영지식 종단간 암호화 (Zero-Knowledge)"
                  content="256비트 마스터 키(#sk=...)는 브라우저 URL 해시에만 유지되며 서버로 전송되지 않습니다. 중계 서버는 불투명한 Yjs 암호문 델타만 중계하므로 데이터 원문을 절대 열람할 수 없습니다."
                  align="right"
                  placement="top"
                />
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isCreatingSharePass}
                  className="h-9 px-4 rounded-lg bg-white text-[#0b0d14] hover:bg-neutral-200 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {isCreatingSharePass && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>E2EE 공동편집 스페이스 개설 · 초대 링크 복사</span>
                </button>
              </div>
            </form>
          )}

          {activeTab === 'new-proposal' && (
            <form onSubmit={(e) => void handleCreateProposalSubmit(e)} className="space-y-4">
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs font-semibold text-white">
                  실시간 시간대 투표 조율 룸 개설 (Proposals)
                </h3>
                <HelpTooltip
                  title="글로벌 시차 자동 변환 투표 시스템"
                  content="내 캘린더의 빈 시간대를 자동 탐색해 후보 슬롯을 구성하며, 참석자들은 별도 로그인 없이 각자의 현지 시간대로 투표하고 의견을 남길 수 있습니다."
                  align="left"
                  placement="bottom"
                />
              </div>

              <div>
                <label className="block text-xs text-neutral-300 mb-1.5">
                  기존 일정 연동 (확정 시 해당 일정 시각 자동 업데이트)
                </label>
                <select
                  value={selectedSeedEventId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedSeedEventId(nextId);
                    const matched = events.find((ev) => ev.id === nextId);
                    if (matched) {
                      setProposalTitle(matched.title);
                      setProposalLocation(matched.location || '');
                    }
                  }}
                  className="h-9 w-full px-3 rounded-lg bg-[#090b10] border border-white/[0.1] text-xs text-white outline-none"
                >
                  <option value="custom">새로운 미팅 · 행사 조율 직접 작성</option>
                  {upcomingCandidateEvents.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      [{ev.date} {ev.startTime}] {ev.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs text-neutral-300 mb-1.5">조율 안건 제목</label>
                  <input
                    type="text"
                    value={proposalTitle}
                    onChange={(e) => setProposalTitle(e.target.value)}
                    placeholder="예: 글로벌 파트너십 킥오프 미팅"
                    className="h-9 w-full px-3 rounded-lg bg-[#090b10] border border-white/[0.1] focus:border-white/25 text-xs text-white outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-300 mb-1.5">예상 소요 시간</label>
                  <select
                    value={proposalDuration}
                    onChange={(e) => setProposalDuration(Number(e.target.value))}
                    className="h-9 w-full px-3 rounded-lg bg-[#090b10] border border-white/[0.1] text-xs text-white tabular-nums outline-none"
                  >
                    <option value={30}>30분</option>
                    <option value={60}>60분 (1시간)</option>
                    <option value={90}>90분 (1시간 30분)</option>
                    <option value={120}>120분 (2시간)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-neutral-300 mb-1.5">
                  장소 또는 화상회의 안내 (선택)
                </label>
                <input
                  type="text"
                  value={proposalLocation}
                  onChange={(e) => setProposalLocation(e.target.value)}
                  placeholder="예: Google Meet 또는 코엑스 컨퍼런스룸"
                  className="h-9 w-full px-3 rounded-lg bg-[#090b10] border border-white/[0.1] focus:border-white/25 text-xs text-white outline-none"
                />
              </div>

              <label className="flex items-center justify-between gap-3 py-2.5 border-t border-b border-white/[0.06] cursor-pointer">
                <div className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <span className="text-xs font-medium text-white">AES-256-GCM 종단간 암호화(E2EE) 적용</span>
                  <HelpTooltip
                    title="투표 및 코멘트 암호화 보호"
                    content="복호화 키를 URL 해시(#rk=...)에만 담아 서버가 안건 제목, 장소, 투표자 코멘트 원문을 열람할 수 없도록 안전하게 차단합니다."
                    align="left"
                    placement="top"
                  />
                </div>
                <input
                  type="checkbox"
                  checked={proposalE2ee}
                  onChange={(e) => setProposalE2ee(e.target.checked)}
                  className="accent-white w-4 h-4 cursor-pointer shrink-0"
                />
              </label>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isCreatingRoom}
                  className="h-9 px-4 rounded-lg bg-white text-[#0b0d14] hover:bg-neutral-200 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {isCreatingRoom && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>시간대 조율 룸 개설 및 초대 링크 복사</span>
                </button>
              </div>
            </form>
          )}

          {activeTab === 'new-runsheet' && (
            <form onSubmit={(e) => void handleCreateRunsheetSubmit(e)} className="space-y-4">
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs font-semibold text-white">
                  실시간 공동 런시트 · 현장 체크리스트 개설
                </h3>
                <HelpTooltip
                  title="현장 런시트 실시간 동기화"
                  content="선택한 행사 프로젝트의 일정과 세부 체크리스트를 외부 스태프·파트너와 실시간으로 함께 체크하고 일정별 현장 코멘트를 실시간 동기화합니다."
                  align="left"
                  placement="bottom"
                />
              </div>

              <div>
                <label className="block text-xs text-neutral-300 mb-1.5">
                  대상 행사 프로젝트 선택
                </label>
                <select
                  value={selectedRunsheetProjectId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    setSelectedRunsheetProjectId(pid);
                    const p = projects.find((proj) => proj.id === pid);
                    if (p) {
                      setRunsheetTitle(`${p.name} 공동 런시트`);
                    }
                  }}
                  className="h-9 w-full px-3 rounded-lg bg-[#090b10] border border-white/[0.1] text-xs text-white outline-none"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({events.filter((e) => e.projectId === p.id).length}개 일정)
                    </option>
                  ))}
                  <option value="all">전체 워크스페이스 일정 ({events.length}건)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-neutral-300 mb-1.5">공동 런시트 룸 이름</label>
                <input
                  type="text"
                  value={runsheetTitle}
                  onChange={(e) => setRunsheetTitle(e.target.value)}
                  placeholder={
                    selectedRunsheetProject
                      ? `${selectedRunsheetProject.name} 현장 런시트`
                      : '공동 진행 런시트'
                  }
                  className="h-9 w-full px-3 rounded-lg bg-[#090b10] border border-white/[0.1] focus:border-white/25 text-xs text-white outline-none"
                />
                <span className="mt-1 block text-[11px] text-neutral-500 tabular-nums">
                  총 {runsheetTargetEvents.length}개 일정 및 하위 체크리스트가 초기 동기화됩니다.
                </span>
              </div>

              <label className="flex items-center justify-between gap-3 py-2.5 border-t border-b border-white/[0.06] cursor-pointer">
                <div className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <span className="text-xs font-medium text-white">AES-256-GCM 종단간 암호화(E2EE) 적용</span>
                  <HelpTooltip
                    title="런시트 및 체크리스트 암호화"
                    content="초대 링크 해시(#rk=...)를 보유한 참여자만 공정명, 세부 체크리스트, 현장 대화를 복호화하여 열람할 수 있습니다."
                    align="left"
                    placement="top"
                  />
                </div>
                <input
                  type="checkbox"
                  checked={runsheetE2ee}
                  onChange={(e) => setRunsheetE2ee(e.target.checked)}
                  className="accent-white w-4 h-4 cursor-pointer shrink-0"
                />
              </label>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isCreatingRoom}
                  className="h-9 px-4 rounded-lg bg-white text-[#0b0d14] hover:bg-neutral-200 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {isCreatingRoom && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>공동 런시트 룸 개설 및 초대 링크 복사</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-3 border-t border-white/[0.06] bg-[#0b0d13]/80 flex items-center justify-between text-[11px] text-neutral-500 shrink-0">
          <span>단축키 R로 언제든 라이브 협업 허브를 열 수 있습니다.</span>
          <button
            type="button"
            onClick={onClose}
            className="h-7 px-3 rounded-md border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-xs text-neutral-200 cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
