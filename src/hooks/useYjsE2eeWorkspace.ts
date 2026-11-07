import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { CalendarCategory } from '../types';
import { ShareCardTheme } from '../utils/shareCodec';
import {
  CollaborativeSharePassView,
  CrdtAwarenessPeerState,
  EncryptedBinaryEnvelope,
  SharePassRsvpStatus,
  SharePassSlotVoteStatus,
  YJS_COMPACTION_THRESHOLD,
  YJS_SHARE_WS_PATH,
  YjsE2eeClientWsMessage,
  YjsE2eeServerWsMessage,
} from '../shared/yjsCollabProtocol';
import {
  DerivedSharePassKeys,
  decryptYjsBinary,
  deriveSharePassKeyBundle,
  encryptYjsBinary,
} from '../utils/yjsE2eeCrypto';
import {
  addProposedSlotInDoc,
  addSharedChecklistInDoc,
  addSharedEventToDoc,
  appendWorkspaceCommentInDoc,
  applyCollaborativeNotesDiff,
  coEditSharedEventInDoc,
  finalizeProposedSlotInDoc,
  readWorkspaceViewFromYDoc,
  setEventRsvpInDoc,
  toggleSharedChecklistInDoc,
  updateWorkspaceMetaInDoc,
  voteProposedSlotInDoc,
} from '../services/yjsSharePassDoc';
import {
  readLocalEncryptedYjsCache,
  writeLocalEncryptedYjsCache,
} from '../services/sharePassWorkspaceClient';

const ORIGIN_REMOTE = 'e2ee-ws-remote';
const ORIGIN_BROADCAST = 'e2ee-bc-remote';
const ORIGIN_CACHE = 'e2ee-local-cache';

export type CrdtSyncStatus = 'initializing' | 'connected' | 'offline-ready' | 'reconnecting' | 'error';

interface BroadcastWireFrame {
  senderPeerId: string;
  kind: 'update' | 'awareness';
  envelope: EncryptedBinaryEnvelope;
}

interface UseYjsE2eeWorkspaceParams {
  docId: string;
  masterKeyB64u?: string;
  participantId: string;
  displayName: string;
  colorHex: string;
  viewerTimeZone: string;
}

export function useYjsE2eeWorkspace({
  docId,
  masterKeyB64u,
  participantId,
  displayName,
  colorHex,
  viewerTimeZone,
}: UseYjsE2eeWorkspaceParams) {
  const [workspace, setWorkspace] = useState<CollaborativeSharePassView | null>(null);
  const [peers, setPeers] = useState<CrdtAwarenessPeerState[]>([]);
  const [remotePeerCount, setRemotePeerCount] = useState<number>(1);
  const [syncStatus, setSyncStatus] = useState<CrdtSyncStatus>('initializing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeFocus, setActiveFocus] = useState<{ field?: string; label?: string }>({});

  const peerId = useMemo(
    () => `peer_${participantId}_${Math.random().toString(36).slice(2, 7)}`,
    [participantId]
  );

  const ydocRef = useRef<Y.Doc | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const keysRef = useRef<DerivedSharePassKeys | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const wsAuthedRef = useRef<boolean>(false);
  const hasOfflinePendingChangesRef = useRef<boolean>(false);
  const appliedSeqSetRef = useRef<Set<number>>(new Set());
  const latestSeqRef = useRef<number>(0);
  const peerClientIdsRef = useRef<Map<string, Set<number>>>(new Map());

  const actorRef = useRef({
    participantId,
    displayName,
    colorHex,
    timeZone: viewerTimeZone,
  });
  actorRef.current = {
    participantId,
    displayName,
    colorHex,
    timeZone: viewerTimeZone,
  };

  useEffect(() => {
    if (!docId) return;
    if (!masterKeyB64u) {
      setSyncStatus('error');
      setErrorMessage(
        '종단간 암호화(E2EE) 마스터 키(#sk=)가 링크에 포함되어 있지 않습니다. 전체 초대 주소를 확인해 주세요.'
      );
      return;
    }

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cacheWriteTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;

    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    ydocRef.current = ydoc;
    awarenessRef.current = awareness;
    appliedSeqSetRef.current = new Set();
    latestSeqRef.current = 0;
    peerClientIdsRef.current = new Map();

    const syncPeersToState = () => {
      if (disposed) return;
      const list: CrdtAwarenessPeerState[] = [];
      awareness.getStates().forEach((state, clientId) => {
        const peer = state?.peer as CrdtAwarenessPeerState | undefined;
        if (peer && peer.participantId) {
          list.push({
            ...peer,
            clientId,
          });
        }
      });
      // Deduplicate by participantId keeping freshest tab state
      const byParticipant = new Map<string, CrdtAwarenessPeerState>();
      for (const item of list) {
        const prev = byParticipant.get(item.participantId);
        if (!prev || item.updatedAt >= prev.updatedAt) {
          byParticipant.set(item.participantId, item);
        }
      }
      setPeers(Array.from(byParticipant.values()));
    };

    const scheduleEncryptedCacheSave = () => {
      if (cacheWriteTimer) clearTimeout(cacheWriteTimer);
      cacheWriteTimer = setTimeout(() => {
        cacheWriteTimer = null;
        const keys = keysRef.current;
        if (disposed || !keys) return;
        const merged = Y.encodeStateAsUpdate(ydoc);
        void encryptYjsBinary(merged, keys.docKey, `doc:${docId}`)
          .then((env) => {
            if (!disposed) {
              writeLocalEncryptedYjsCache(docId, env);
            }
          })
          .catch(() => {
            // ignore cache encryption error
          });
      }, 280);
    };

    const sendWsFrame = (frame: YjsE2eeClientWsMessage): boolean => {
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN && wsAuthedRef.current) {
        sock.send(JSON.stringify(frame));
        return true;
      }
      return false;
    };

    const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (disposed) return;
      setWorkspace(readWorkspaceViewFromYDoc(ydoc));
      scheduleEncryptedCacheSave();

      if (origin === ORIGIN_REMOTE || origin === ORIGIN_BROADCAST || origin === ORIGIN_CACHE) {
        return;
      }

      const keys = keysRef.current;
      if (!keys) {
        hasOfflinePendingChangesRef.current = true;
        return;
      }

      void encryptYjsBinary(update, keys.docKey, `doc:${docId}`)
        .then((envelope) => {
          if (disposed) return;

          // 1) Zero-latency local multi-tab BroadcastChannel sync (works 100% offline)
          if (bcRef.current) {
            const bcMsg: BroadcastWireFrame = {
              senderPeerId: peerId,
              kind: 'update',
              envelope,
            };
            bcRef.current.postMessage(bcMsg);
          }

          // 2) Encrypted WebSocket relay sync
          const sent = sendWsFrame({
            type: 'yjs:update',
            envelope,
          });
          if (!sent) {
            hasOfflinePendingChangesRef.current = true;
          }
        })
        .catch(() => {
          hasOfflinePendingChangesRef.current = true;
        });
    };

    const handleAwarenessUpdate = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      syncPeersToState();
      if (origin === 'remote') return;

      const keys = keysRef.current;
      if (!keys) return;

      const changedClients = [...added, ...updated, ...removed];
      if (changedClients.length === 0) return;

      const encoded = encodeAwarenessUpdate(awareness, changedClients);
      void encryptYjsBinary(encoded, keys.awarenessKey, `awareness:${docId}`)
        .then((envelope) => {
          if (disposed) return;
          if (bcRef.current) {
            const bcMsg: BroadcastWireFrame = {
              senderPeerId: peerId,
              kind: 'awareness',
              envelope,
            };
            bcRef.current.postMessage(bcMsg);
          }
          sendWsFrame({
            type: 'yjs:awareness',
            envelope,
          });
        })
        .catch(() => {
          // ignore ephemeral awareness error
        });
    };

    ydoc.on('update', handleDocUpdate);
    awareness.on('update', handleAwarenessUpdate);

    const bootstrapAndConnect = async () => {
      try {
        const keys = await deriveSharePassKeyBundle(masterKeyB64u, docId);
        if (disposed) return;
        keysRef.current = keys;

        // 1) Hydrate immediately from local encrypted CRDT cache if available (offline-first)
        const cachedEnvelope = readLocalEncryptedYjsCache(docId);
        if (cachedEnvelope) {
          try {
            const cachedBytes = await decryptYjsBinary(
              cachedEnvelope,
              keys.docKey,
              `doc:${docId}`
            );
            if (!disposed) {
              Y.applyUpdate(ydoc, cachedBytes, ORIGIN_CACHE);
              setWorkspace(readWorkspaceViewFromYDoc(ydoc));
              setSyncStatus('offline-ready');
            }
          } catch {
            // ignore stale cache
          }
        }

        // 2) Set initial local Awareness state
        awareness.setLocalStateField('peer', {
          clientId: ydoc.clientID,
          peerId,
          participantId: actorRef.current.participantId,
          displayName: actorRef.current.displayName,
          colorHex: actorRef.current.colorHex,
          timeZone: actorRef.current.timeZone,
          updatedAt: Date.now(),
        } satisfies CrdtAwarenessPeerState);

        // 3) Attach encrypted BroadcastChannel for instant local tab/window CRDT sync
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel(`vibe-yjs-e2ee-${docId}`);
          bcRef.current = bc;
          bc.onmessage = (ev: MessageEvent<BroadcastWireFrame>) => {
            const data = ev.data;
            if (!data || data.senderPeerId === peerId) return;
            if (data.kind === 'update') {
              void decryptYjsBinary(data.envelope, keys.docKey, `doc:${docId}`)
                .then((plain) => {
                  if (!disposed) {
                    Y.applyUpdate(ydoc, plain, ORIGIN_BROADCAST);
                  }
                })
                .catch(() => {});
            } else if (data.kind === 'awareness') {
              void decryptYjsBinary(data.envelope, keys.awarenessKey, `awareness:${docId}`)
                .then((plain) => {
                  if (!disposed) {
                    applyAwarenessUpdate(awareness, plain, 'remote');
                  }
                })
                .catch(() => {});
            }
          };
        }

        // 4) Connect encrypted WebSocket relay
        const connectSocket = () => {
          if (disposed || typeof window === 'undefined') return;
          const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsUrl = `${proto}//${window.location.host}${YJS_SHARE_WS_PATH}`;
          const sock = new WebSocket(wsUrl);
          wsRef.current = sock;
          wsAuthedRef.current = false;

          sock.onopen = () => {
            if (disposed) {
              sock.close();
              return;
            }
            const authFrame: YjsE2eeClientWsMessage = {
              type: 'yjs:auth',
              docId,
              peerId,
              authCapability: keys.authCapability,
              knownSeq: latestSeqRef.current,
            };
            sock.send(JSON.stringify(authFrame));
          };

          sock.onmessage = (event) => {
            if (disposed) return;
            let msg: YjsE2eeServerWsMessage;
            try {
              msg = JSON.parse(String(event.data)) as YjsE2eeServerWsMessage;
            } catch {
              return;
            }

            void (async () => {
              switch (msg.type) {
                case 'yjs:sync_init': {
                  try {
                    const snapPlain = await decryptYjsBinary(
                      msg.encryptedSnapshot,
                      keys.docKey,
                      `doc:${docId}`
                    );
                    if (disposed) return;
                    Y.applyUpdate(ydoc, snapPlain, ORIGIN_REMOTE);
                    if (msg.snapshotSeq > latestSeqRef.current) {
                      latestSeqRef.current = msg.snapshotSeq;
                    }

                    for (const delta of msg.deltas) {
                      if (appliedSeqSetRef.current.has(delta.seq)) continue;
                      const deltaPlain = await decryptYjsBinary(
                        delta.envelope,
                        keys.docKey,
                        `doc:${docId}`
                      );
                      if (disposed) return;
                      Y.applyUpdate(ydoc, deltaPlain, ORIGIN_REMOTE);
                      appliedSeqSetRef.current.add(delta.seq);
                      if (delta.seq > latestSeqRef.current) {
                        latestSeqRef.current = delta.seq;
                      }
                    }

                    wsAuthedRef.current = true;
                    reconnectAttempt = 0;
                    setErrorMessage(null);
                    setSyncStatus('connected');
                    setRemotePeerCount(msg.peerCount);
                    setWorkspace(readWorkspaceViewFromYDoc(ydoc));
                    scheduleEncryptedCacheSave();

                    // Flush any offline CRDT edits accumulated while disconnected
                    if (hasOfflinePendingChangesRef.current) {
                      hasOfflinePendingChangesRef.current = false;
                      const fullMerged = Y.encodeStateAsUpdate(ydoc);
                      const env = await encryptYjsBinary(
                        fullMerged,
                        keys.docKey,
                        `doc:${docId}`
                      );
                      sendWsFrame({ type: 'yjs:update', envelope: env });
                    }

                    // Announce encrypted local Awareness to connected peers
                    const localAw = encodeAwarenessUpdate(awareness, [ydoc.clientID]);
                    const awEnv = await encryptYjsBinary(
                      localAw,
                      keys.awarenessKey,
                      `awareness:${docId}`
                    );
                    sendWsFrame({ type: 'yjs:awareness', envelope: awEnv });

                    // Compact encrypted delta log if threshold reached
                    if (msg.deltas.length >= YJS_COMPACTION_THRESHOLD) {
                      const compactedBytes = Y.encodeStateAsUpdate(ydoc);
                      const compactedEnv = await encryptYjsBinary(
                        compactedBytes,
                        keys.docKey,
                        `doc:${docId}`
                      );
                      sendWsFrame({
                        type: 'yjs:compact',
                        baseSeq: latestSeqRef.current,
                        encryptedSnapshot: compactedEnv,
                      });
                    }
                  } catch {
                    setSyncStatus('error');
                    setErrorMessage(
                      '종단간 암호화 복호화에 실패했습니다. 공유 링크의 #sk= 키가 손상되지 않았는지 확인해 주세요.'
                    );
                  }
                  break;
                }

                case 'yjs:remote_update': {
                  if (appliedSeqSetRef.current.has(msg.delta.seq)) return;
                  appliedSeqSetRef.current.add(msg.delta.seq);
                  if (msg.delta.seq > latestSeqRef.current) {
                    latestSeqRef.current = msg.delta.seq;
                  }
                  if (msg.delta.senderId === peerId) return;

                  try {
                    const plain = await decryptYjsBinary(
                      msg.delta.envelope,
                      keys.docKey,
                      `doc:${docId}`
                    );
                    if (!disposed) {
                      Y.applyUpdate(ydoc, plain, ORIGIN_REMOTE);
                    }
                  } catch {
                    // ignore invalid frame
                  }
                  break;
                }

                case 'yjs:remote_awareness': {
                  try {
                    const plain = await decryptYjsBinary(
                      msg.envelope,
                      keys.awarenessKey,
                      `awareness:${docId}`
                    );
                    if (disposed) return;
                    const beforeIds = new Set(awareness.getStates().keys());
                    applyAwarenessUpdate(awareness, plain, 'remote');
                    const afterStates = awareness.getStates();
                    let tracked = peerClientIdsRef.current.get(msg.peerId);
                    if (!tracked) {
                      tracked = new Set();
                      peerClientIdsRef.current.set(msg.peerId, tracked);
                    }
                    afterStates.forEach((st, cid) => {
                      const p = st?.peer as CrdtAwarenessPeerState | undefined;
                      if (p?.peerId === msg.peerId || !beforeIds.has(cid)) {
                        tracked!.add(cid);
                      }
                    });
                  } catch {
                    // ignore malformed awareness
                  }
                  break;
                }

                case 'yjs:peer_left': {
                  const tracked = peerClientIdsRef.current.get(msg.peerId);
                  if (tracked && tracked.size > 0) {
                    removeAwarenessStates(awareness, Array.from(tracked), 'remote');
                    peerClientIdsRef.current.delete(msg.peerId);
                  }
                  break;
                }

                case 'yjs:peer_count': {
                  setRemotePeerCount(msg.peerCount);
                  break;
                }

                case 'yjs:error': {
                  setErrorMessage(msg.message);
                  if (msg.code === 'DOC_NOT_FOUND' || msg.code === 'AUTH_FAILED') {
                    setSyncStatus('error');
                  }
                  break;
                }
              }
            })();
          };

          sock.onclose = () => {
            wsAuthedRef.current = false;
            if (disposed) return;
            setSyncStatus((prev) => (prev === 'error' ? 'error' : 'reconnecting'));
            const delay = Math.min(1000 * Math.pow(1.6, reconnectAttempt), 10_000);
            reconnectAttempt += 1;
            reconnectTimer = setTimeout(connectSocket, delay);
          };

          sock.onerror = () => {
            // handled by onclose
          };
        };

        connectSocket();
      } catch (err: unknown) {
        if (!disposed) {
          setSyncStatus('error');
          setErrorMessage(
            err instanceof Error
              ? err.message
              : '암호화 키 파생 중 오류가 발생했습니다.'
          );
        }
      }
    };

    void bootstrapAndConnect();

    const handleOnline = () => {
      if (
        !disposed &&
        (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED)
      ) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        void bootstrapAndConnect();
      }
    };
    window.addEventListener('online', handleOnline);

    return () => {
      disposed = true;
      window.removeEventListener('online', handleOnline);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (cacheWriteTimer) clearTimeout(cacheWriteTimer);
      ydoc.off('update', handleDocUpdate);
      awareness.off('update', handleAwarenessUpdate);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'yjs:leave' }));
        } catch {
          // ignore
        }
      }
      wsRef.current?.close();
      bcRef.current?.close();
      awareness.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      awarenessRef.current = null;
    };
  }, [docId, masterKeyB64u, peerId]);

  // Keep local Awareness identity & active editing focus synced in real time
  useEffect(() => {
    const awareness = awarenessRef.current;
    const ydoc = ydocRef.current;
    if (!awareness || !ydoc) return;
    awareness.setLocalStateField('peer', {
      clientId: ydoc.clientID,
      peerId,
      participantId,
      displayName,
      colorHex,
      timeZone: viewerTimeZone,
      activeField: activeFocus.field,
      activeLabel: activeFocus.label,
      updatedAt: Date.now(),
    } satisfies CrdtAwarenessPeerState);
  }, [activeFocus, colorHex, displayName, participantId, peerId, viewerTimeZone]);

  const announceEditingFocus = useCallback((field?: string, label?: string) => {
    setActiveFocus((prev) =>
      prev.field === field && prev.label === label ? prev : { field, label }
    );
  }, []);

  const updateMeta = useCallback(
    (patch: Partial<{ title: string; senderNote: string; theme: ShareCardTheme }>) => {
      if (!ydocRef.current) return;
      updateWorkspaceMetaInDoc(ydocRef.current, patch);
    },
    []
  );

  const updateSharedNotes = useCallback((nextText: string) => {
    if (!ydocRef.current) return;
    applyCollaborativeNotesDiff(ydocRef.current, nextText);
  }, []);

  const coEditEvent = useCallback(
    (
      eventId: string,
      patch: Partial<{
        title: string;
        date: string;
        startTime: string;
        endTime: string;
        isAllDay: boolean;
        category: CalendarCategory;
        location: string;
        content: string;
        isCompleted: boolean;
      }>
    ) => {
      if (!ydocRef.current) return;
      coEditSharedEventInDoc(ydocRef.current, eventId, patch, actorRef.current.displayName);
    },
    []
  );

  const addSharedEvent = useCallback(
    (draft: {
      title: string;
      date: string;
      startTime: string;
      endTime: string;
      timeZone: string;
      isAllDay: boolean;
      category: CalendarCategory;
      location?: string;
      content?: string;
    }) => {
      if (!ydocRef.current) return null;
      return addSharedEventToDoc(ydocRef.current, draft, actorRef.current);
    },
    []
  );

  const setEventRsvp = useCallback(
    (eventId: string, status: SharePassRsvpStatus | null, note?: string) => {
      if (!ydocRef.current) return;
      setEventRsvpInDoc(ydocRef.current, eventId, actorRef.current, status, note);
    },
    []
  );

  const toggleChecklist = useCallback((eventId: string, itemId: string, done: boolean) => {
    if (!ydocRef.current) return;
    toggleSharedChecklistInDoc(
      ydocRef.current,
      eventId,
      itemId,
      done,
      actorRef.current.displayName
    );
  }, []);

  const addChecklist = useCallback((eventId: string, text: string) => {
    if (!ydocRef.current) return;
    addSharedChecklistInDoc(ydocRef.current, eventId, text, actorRef.current.displayName);
  }, []);

  const voteSlot = useCallback((slotId: string, status: SharePassSlotVoteStatus | null) => {
    if (!ydocRef.current) return;
    voteProposedSlotInDoc(ydocRef.current, slotId, actorRef.current, status);
  }, []);

  const proposeSlot = useCallback(
    (slot: {
      date: string;
      startTime: string;
      endTime: string;
      timeZone: string;
      label?: string;
    }) => {
      if (!ydocRef.current) return;
      addProposedSlotInDoc(ydocRef.current, slot, actorRef.current);
    },
    []
  );

  const finalizeSlot = useCallback((slotId: string | null) => {
    if (!ydocRef.current) return;
    finalizeProposedSlotInDoc(ydocRef.current, slotId, actorRef.current.displayName);
  }, []);

  const postComment = useCallback((targetId: string, body: string) => {
    if (!ydocRef.current) return;
    appendWorkspaceCommentInDoc(ydocRef.current, targetId, body, actorRef.current);
  }, []);

  return {
    workspace,
    peers,
    remotePeerCount: Math.max(remotePeerCount, peers.length, 1),
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
  };
}
