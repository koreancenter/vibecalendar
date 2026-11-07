import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarEventItem } from '../types';
import {
  COLLAB_WS_PATH,
  CollabClientMessage,
  CollabCommentItem,
  CollabProposalSlot,
  CollabRoomSnapshot,
  CollabServerMessage,
  CollabSharedEvent,
  CollabVoteStatus,
  pickDeterministicCollabColor,
} from '../shared/collabSchema';
import {
  decryptChecklistList,
  decryptCommentItem,
  decryptProposalSlot,
  decryptRoomSnapshot,
  decryptSharedEventFields,
  encryptCollabText,
  encryptSharedEventFields,
  importCollabRoomKey,
} from '../utils/collabCrypto';

export type CollabConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface UseCollabRoomParams {
  roomId: string | null;
  roomKeyBase64Url?: string;
  hostSecret?: string;
  participantId: string;
  displayName: string;
  colorHex?: string;
  viewerTimeZone: string;
}

function makeMutationId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useCollabRoom({
  roomId,
  roomKeyBase64Url,
  hostSecret,
  participantId,
  displayName,
  colorHex,
  viewerTimeZone,
}: UseCollabRoomParams) {
  const [room, setRoom] = useState<CollabRoomSnapshot | null>(null);
  const [isHost, setIsHost] = useState<boolean>(Boolean(hostSecret));
  const [connectionState, setConnectionState] = useState<CollabConnectionState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTargetId, setActiveTargetId] = useState<string>('general');

  const cryptoKeyRef = useRef<CryptoKey | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingQueueRef = useRef<CollabClientMessage[]>([]);
  const activeTargetRef = useRef<string>(activeTargetId);
  activeTargetRef.current = activeTargetId;

  const profileRef = useRef({
    participantId,
    displayName,
    colorHex: colorHex || pickDeterministicCollabColor(participantId),
    viewerTimeZone,
    hostSecret,
  });
  profileRef.current = {
    participantId,
    displayName,
    colorHex: colorHex || pickDeterministicCollabColor(participantId),
    viewerTimeZone,
    hostSecret,
  };

  const sendOrQueue = useCallback((msg: CollabClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return;
    }
    if (msg.type !== 'presence:update' && msg.type !== 'room:join') {
      pendingQueueRef.current.push(msg);
      if (pendingQueueRef.current.length > 50) {
        pendingQueueRef.current.shift();
      }
    }
  }, []);

  // 프로필(표시 이름 · 타임존 · 현재 보고 있는 슬롯/일정) 실시간 브로드캐스트
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !roomId) return;
    ws.send(
      JSON.stringify({
        type: 'presence:update',
        displayName,
        timeZone: viewerTimeZone,
        activeTargetId,
      } satisfies CollabClientMessage)
    );
  }, [activeTargetId, displayName, roomId, viewerTimeZone]);

  // WebSocket 연결 · 지수 백오프 재연결 · 오프라인 큐 플러시 · E2EE 실시간 복호화
  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      setConnectionState('idle');
      setErrorMessage(null);
      pendingQueueRef.current = [];
      return;
    }

    let disposed = false;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    setConnectionState('connecting');
    setErrorMessage(null);
    setActiveTargetId('general');

    const prepareKeyAndConnect = async () => {
      const importedKey = roomKeyBase64Url ? await importCollabRoomKey(roomKeyBase64Url) : null;
      if (disposed) return;
      cryptoKeyRef.current = importedKey;

      // 초기 빠른 스냅샷 하이드레이션 (REST 폴백 겸용)
      try {
        const res = await fetch(`/api/collab/rooms/${encodeURIComponent(roomId)}`);
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          if (!disposed) {
            setConnectionState('error');
            setErrorMessage(errBody.error || '요청한 협업 룸을 찾을 수 없습니다.');
          }
          return;
        }
        const data = (await res.json()) as { room: CollabRoomSnapshot };
        const decrypted = await decryptRoomSnapshot(data.room, importedKey);
        if (!disposed) {
          setRoom(decrypted);
        }
      } catch {
        // 오프라인 시 WebSocket 재연결 루프가 계속 복구 시도
      }

      const openSocket = () => {
        if (disposed || typeof window === 'undefined') return;
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProto}//${window.location.host}${COLLAB_WS_PATH}?roomId=${encodeURIComponent(
          roomId
        )}`;

        let socket: WebSocket;
        try {
          socket = new WebSocket(wsUrl);
        } catch {
          scheduleReconnect();
          return;
        }

        wsRef.current = socket;

        socket.onopen = () => {
          if (disposed) {
            socket.close();
            return;
          }
          attempt = 0;
          setConnectionState('connected');
          setErrorMessage(null);

          const p = profileRef.current;
          const joinMsg: CollabClientMessage = {
            type: 'room:join',
            roomId,
            participantId: p.participantId,
            displayName: p.displayName,
            colorHex: p.colorHex,
            timeZone: p.viewerTimeZone,
            hostSecret: p.hostSecret,
            activeTargetId: activeTargetRef.current,
          };
          socket.send(JSON.stringify(joinMsg));
        };

        socket.onmessage = (ev) => {
          if (disposed || typeof ev.data !== 'string') return;
          let msg: CollabServerMessage;
          try {
            msg = JSON.parse(ev.data) as CollabServerMessage;
          } catch {
            return;
          }

          void (async () => {
            const key = cryptoKeyRef.current;

            switch (msg.type) {
              case 'room:init': {
                const decrypted = await decryptRoomSnapshot(msg.room, key);
                if (disposed) return;
                setIsHost(msg.isHost);
                setRoom(decrypted);

                // 재연결 전 오프라인 상태에서 적재된 변이 큐 순서대로 플러시
                if (pendingQueueRef.current.length > 0 && socket.readyState === WebSocket.OPEN) {
                  const buffered = [...pendingQueueRef.current];
                  pendingQueueRef.current = [];
                  for (const pending of buffered) {
                    socket.send(JSON.stringify(pending));
                  }
                }
                break;
              }

              case 'presence:updated': {
                setRoom((curr) => (curr ? { ...curr, presence: msg.presence } : curr));
                break;
              }

              case 'slot:voted': {
                setRoom((curr) => {
                  if (!curr) return curr;
                  return {
                    ...curr,
                    revision: Math.max(curr.revision, msg.revision),
                    updatedAt: msg.updatedAt,
                    proposedSlots: curr.proposedSlots.map((s) =>
                      s.id === msg.slotId ? { ...s, votes: msg.votes } : s
                    ),
                  };
                });
                break;
              }

              case 'slot:proposed': {
                const decSlot = await decryptProposalSlot(msg.slot, key);
                if (disposed) return;
                setRoom((curr) => {
                  if (!curr) return curr;
                  const exists = curr.proposedSlots.some((s) => s.id === decSlot.id);
                  const nextSlots = exists
                    ? curr.proposedSlots.map((s) => (s.id === decSlot.id ? decSlot : s))
                    : [...curr.proposedSlots, decSlot];
                  return {
                    ...curr,
                    revision: Math.max(curr.revision, msg.revision),
                    updatedAt: msg.updatedAt,
                    proposedSlots: nextSlots,
                  };
                });
                break;
              }

              case 'proposal:finalized': {
                setRoom((curr) => {
                  if (!curr) return curr;
                  const sysCmt = msg.systemComment;
                  const nextComments =
                    sysCmt && !curr.comments.some((c) => c.id === sysCmt.id)
                      ? [...curr.comments, sysCmt]
                      : curr.comments;
                  return {
                    ...curr,
                    revision: Math.max(curr.revision, msg.revision),
                    finalizedSlotId: msg.finalizedSlotId,
                    comments: nextComments,
                    updatedAt: msg.updatedAt,
                  };
                });
                break;
              }

              case 'checklist:updated': {
                const decChecklist = await decryptChecklistList(msg.checklist, key);
                if (disposed) return;
                setRoom((curr) => {
                  if (!curr) return curr;
                  return {
                    ...curr,
                    revision: Math.max(curr.revision, msg.revision),
                    updatedAt: msg.updatedAt,
                    events: curr.events.map((e) =>
                      e.id === msg.eventId
                        ? { ...e, checklist: decChecklist, updatedAt: msg.updatedAt }
                        : e
                    ),
                  };
                });
                break;
              }

              case 'event:updated': {
                setRoom((curr) => {
                  if (!curr) return curr;
                  return {
                    ...curr,
                    revision: Math.max(curr.revision, msg.revision),
                    updatedAt: msg.updatedAt,
                    events: curr.events.map((e) =>
                      e.id === msg.eventId
                        ? { ...e, isCompleted: msg.isCompleted, updatedAt: msg.updatedAt }
                        : e
                    ),
                  };
                });
                break;
              }

              case 'events:synced': {
                const decEvents = await Promise.all(
                  msg.events.map((e) => decryptSharedEventFields(e, key))
                );
                if (disposed) return;
                setRoom((curr) => {
                  if (!curr) return curr;
                  return {
                    ...curr,
                    revision: Math.max(curr.revision, msg.revision),
                    updatedAt: msg.updatedAt,
                    events: decEvents,
                  };
                });
                break;
              }

              case 'comment:created': {
                const decComment = await decryptCommentItem(msg.comment, key);
                if (disposed) return;
                setRoom((curr) => {
                  if (!curr) return curr;
                  const exists = curr.comments.some((c) => c.id === decComment.id);
                  const nextComments = exists
                    ? curr.comments.map((c) => (c.id === decComment.id ? decComment : c))
                    : [...curr.comments, decComment];
                  return {
                    ...curr,
                    revision: Math.max(curr.revision, msg.revision),
                    updatedAt: msg.updatedAt,
                    comments: nextComments,
                  };
                });
                break;
              }

              case 'room:error': {
                if (msg.code === 'ROOM_NOT_FOUND') {
                  setConnectionState('error');
                  setErrorMessage(msg.message);
                } else {
                  setErrorMessage(msg.message);
                }
                break;
              }
            }
          })();
        };

        socket.onclose = () => {
          if (disposed) return;
          wsRef.current = null;
          scheduleReconnect();
        };

        socket.onerror = () => {
          // onclose가 이어서 재연결 스케줄링 수행
        };
      };

      const scheduleReconnect = () => {
        if (disposed) return;
        setConnectionState((prev) => (prev === 'error' ? 'error' : 'reconnecting'));
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        attempt += 1;
        reconnectTimer = window.setTimeout(() => {
          openSocket();
        }, delay);
      };

      openSocket();
    };

    void prepareKeyAndConnect();

    const handleOnline = () => {
      if (!disposed && (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED)) {
        if (reconnectTimer !== null) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        attempt = 0;
        void prepareKeyAndConnect();
      }
    };

    window.addEventListener('online', handleOnline);

    return () => {
      disposed = true;
      window.removeEventListener('online', handleOnline);
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [roomId, roomKeyBase64Url]);

  // --- 낙관적 업데이트 + 서버 권위 브로드캐스트 액션 ---

  const castSlotVote = useCallback(
    (slotId: string, status: CollabVoteStatus | null) => {
      const p = profileRef.current;
      const nowIso = new Date().toISOString();

      setRoom((curr) => {
        if (!curr) return curr;
        return {
          ...curr,
          proposedSlots: curr.proposedSlots.map((slot) => {
            if (slot.id !== slotId) return slot;
            const nextVotes = { ...slot.votes };
            if (status === null) {
              delete nextVotes[p.participantId];
            } else {
              nextVotes[p.participantId] = {
                participantId: p.participantId,
                displayName: p.displayName,
                colorHex: p.colorHex,
                status,
                timeZone: p.viewerTimeZone,
                updatedAt: nowIso,
              };
            }
            return { ...slot, votes: nextVotes };
          }),
        };
      });

      sendOrQueue({
        type: 'slot:vote',
        mutationId: makeMutationId('vote'),
        slotId,
        status,
      });
    },
    [sendOrQueue]
  );

  const proposeCandidateSlot = useCallback(
    async (input: {
      date: string;
      startTime: string;
      endTime: string;
      timeZone: string;
      label?: string;
    }) => {
      const p = profileRef.current;
      const nowIso = new Date().toISOString();
      const slotId = `slot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const isEncrypted = Boolean(room?.isE2ee && cryptoKeyRef.current);

      const optimisticSlot: CollabProposalSlot = {
        id: slotId,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        timeZone: input.timeZone,
        label: input.label?.trim() || undefined,
        createdByName: p.displayName,
        votes: {
          [p.participantId]: {
            participantId: p.participantId,
            displayName: p.displayName,
            colorHex: p.colorHex,
            status: 'available',
            timeZone: p.viewerTimeZone,
            updatedAt: nowIso,
          },
        },
      };

      setRoom((curr) =>
        curr
          ? {
              ...curr,
              proposedSlots: [...curr.proposedSlots, optimisticSlot],
            }
          : curr
      );

      const wireLabel =
        isEncrypted && input.label?.trim()
          ? await encryptCollabText(input.label.trim(), cryptoKeyRef.current)
          : input.label?.trim() || undefined;

      sendOrQueue({
        type: 'slot:propose',
        mutationId: makeMutationId('prop'),
        slot: {
          id: slotId,
          date: input.date,
          startTime: input.startTime,
          endTime: input.endTime,
          timeZone: input.timeZone,
          label: wireLabel,
        },
      });
    },
    [room?.isE2ee, sendOrQueue]
  );

  const finalizeProposalSlot = useCallback(
    (slotId: string | null) => {
      const secret = profileRef.current.hostSecret;
      if (!secret) return;

      setRoom((curr) => (curr ? { ...curr, finalizedSlotId: slotId } : curr));
      sendOrQueue({
        type: 'proposal:finalize',
        mutationId: makeMutationId('fin'),
        slotId,
        hostSecret: secret,
      });
    },
    [sendOrQueue]
  );

  const toggleSharedChecklistItem = useCallback(
    (eventId: string, itemId: string, done: boolean) => {
      const p = profileRef.current;
      const nowIso = new Date().toISOString();

      setRoom((curr) => {
        if (!curr) return curr;
        return {
          ...curr,
          events: curr.events.map((ev) =>
            ev.id === eventId
              ? {
                  ...ev,
                  checklist: ev.checklist.map((c) =>
                    c.id === itemId
                      ? { ...c, done, updatedByName: p.displayName, updatedAt: nowIso }
                      : c
                  ),
                }
              : ev
          ),
        };
      });

      sendOrQueue({
        type: 'checklist:toggle',
        mutationId: makeMutationId('chktog'),
        eventId,
        itemId,
        done,
      });
    },
    [sendOrQueue]
  );

  const addSharedChecklistItem = useCallback(
    async (eventId: string, textPlain: string) => {
      const clean = textPlain.trim();
      if (!clean) return;
      const p = profileRef.current;
      const nowIso = new Date().toISOString();
      const itemId = `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

      setRoom((curr) => {
        if (!curr) return curr;
        return {
          ...curr,
          events: curr.events.map((ev) =>
            ev.id === eventId
              ? {
                  ...ev,
                  checklist: [
                    ...ev.checklist,
                    {
                      id: itemId,
                      text: clean,
                      done: false,
                      updatedByName: p.displayName,
                      updatedAt: nowIso,
                    },
                  ],
                }
              : ev
          ),
        };
      });

      const wireText =
        room?.isE2ee && cryptoKeyRef.current
          ? await encryptCollabText(clean, cryptoKeyRef.current)
          : clean;

      sendOrQueue({
        type: 'checklist:add',
        mutationId: makeMutationId('chkadd'),
        eventId,
        item: {
          id: itemId,
          text: wireText,
          done: false,
        },
      });
    },
    [room?.isE2ee, sendOrQueue]
  );

  const toggleSharedEventComplete = useCallback(
    (eventId: string, isCompleted: boolean) => {
      setRoom((curr) => {
        if (!curr) return curr;
        return {
          ...curr,
          events: curr.events.map((ev) => (ev.id === eventId ? { ...ev, isCompleted } : ev)),
        };
      });

      sendOrQueue({
        type: 'event:complete',
        mutationId: makeMutationId('evtdone'),
        eventId,
        isCompleted,
      });
    },
    [sendOrQueue]
  );

  const pushLocalEventsToRunsheetRoom = useCallback(
    async (localEvents: CalendarEventItem[]) => {
      const secret = profileRef.current.hostSecret;
      if (!secret) return;
      const nowIso = new Date().toISOString();

      const plainShared: CollabSharedEvent[] = localEvents.map((ev) => ({
        id: `cevt_${ev.id}`,
        sourceLocalEventId: ev.id,
        title: ev.title,
        date: ev.date,
        endDate: ev.endDate,
        startTime: ev.startTime,
        endTime: ev.endTime,
        timeZone: ev.timeZone || profileRef.current.viewerTimeZone,
        isAllDay: ev.isAllDay,
        category: ev.category,
        location: ev.location,
        content: ev.content,
        isCompleted: Boolean(ev.isCompleted),
        checklist: (ev.checklist || []).map((c) => ({
          id: c.id,
          text: c.text,
          done: c.done,
          updatedAt: nowIso,
        })),
        updatedAt: nowIso,
      }));

      setRoom((curr) => (curr ? { ...curr, events: plainShared } : curr));

      const wireEvents =
        room?.isE2ee && cryptoKeyRef.current
          ? await Promise.all(
              plainShared.map((item) => encryptSharedEventFields(item, cryptoKeyRef.current))
            )
          : plainShared;

      sendOrQueue({
        type: 'events:sync',
        mutationId: makeMutationId('evtsync'),
        events: wireEvents,
        hostSecret: secret,
      });
    },
    [room?.isE2ee, sendOrQueue]
  );

  const postComment = useCallback(
    async (bodyPlain: string, targetOverride?: string) => {
      const clean = bodyPlain.trim();
      if (!clean) return;
      const p = profileRef.current;
      const targetId = targetOverride || activeTargetRef.current || 'general';
      const commentId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const nowIso = new Date().toISOString();

      const optimisticComment: CollabCommentItem = {
        id: commentId,
        targetId,
        authorId: p.participantId,
        authorName: p.displayName,
        authorColor: p.colorHex,
        authorTimeZone: p.viewerTimeZone,
        body: clean,
        createdAt: nowIso,
      };

      setRoom((curr) =>
        curr
          ? {
              ...curr,
              comments: [...curr.comments, optimisticComment],
            }
          : curr
      );

      const wireBody =
        room?.isE2ee && cryptoKeyRef.current
          ? await encryptCollabText(clean, cryptoKeyRef.current)
          : clean;

      sendOrQueue({
        type: 'comment:create',
        mutationId: makeMutationId('cmt'),
        comment: {
          id: commentId,
          targetId,
          body: wireBody,
        },
      });
    },
    [room?.isE2ee, sendOrQueue]
  );

  return {
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
  };
}
