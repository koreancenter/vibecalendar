import type { Express } from 'express';
import type { Server as HttpServer, IncomingMessage } from 'http';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { apiRateLimiter, textCommandJsonParser } from './security';
import { collabStore } from './collabRoomStore';
import {
  COLLAB_WS_PATH,
  CollabClientMessage,
  CollabServerMessage,
  CreateCollabRoomRequest,
  pickDeterministicCollabColor,
} from '../shared/collabSchema';

interface ConnectedPeerContext {
  connectionKey: string;
  roomId: string;
  participantId: string;
  displayName: string;
  colorHex: string;
  timeZone: string;
  isHost: boolean;
  isAlive: boolean;
}

export function registerCollabRoutes(app: Express): void {
  // 신규 라이브 협업 룸(시간대 투표 Proposals 또는 공동 런시트) 개설
  app.post(
    '/api/collab/rooms',
    apiRateLimiter,
    textCommandJsonParser,
    (req, res) => {
      const body = req.body as Partial<CreateCollabRoomRequest> | null;
      if (!body || typeof body !== 'object' || typeof body.title !== 'string' || !body.title.trim()) {
        res.status(400).json({ error: '협업 룸 제목과 기본 정보를 전달해 주세요.' });
        return;
      }

      const created = collabStore.createRoom({
        kind: body.kind === 'runsheet' ? 'runsheet' : 'proposal',
        isE2ee: Boolean(body.isE2ee),
        hostDisplayName: typeof body.hostDisplayName === 'string' ? body.hostDisplayName : '호스트',
        title: body.title,
        subtitle: typeof body.subtitle === 'string' ? body.subtitle : undefined,
        location: typeof body.location === 'string' ? body.location : undefined,
        sourceTimeZone: typeof body.sourceTimeZone === 'string' ? body.sourceTimeZone : 'Asia/Seoul',
        durationMinutes: typeof body.durationMinutes === 'number' ? body.durationMinutes : 60,
        category: body.category || '업무',
        proposedSlots: Array.isArray(body.proposedSlots) ? body.proposedSlots : undefined,
        events: Array.isArray(body.events) ? body.events : undefined,
      });

      res.status(201).json(created);
    }
  );

  // 특정 룸 현재 서버 권위 스냅샷 조회
  app.get('/api/collab/rooms/:roomId', apiRateLimiter, (req, res) => {
    const roomId = String(req.params.roomId || '').trim();
    if (!/^[a-zA-Z0-9_-]{6,36}$/.test(roomId)) {
      res.status(400).json({ error: '올바르지 않은 협업 룸 식별자입니다.' });
      return;
    }

    const room = collabStore.getRoomSnapshot(roomId);
    if (!room) {
      res.status(404).json({ error: '존재하지 않거나 만료된 협업 룸입니다.' });
      return;
    }

    res.json({ room });
  });
}

export function attachCollabWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 256 * 1024,
  });

  const roomSockets = new Map<string, Set<WebSocket>>();
  const peerContexts = new WeakMap<WebSocket, ConnectedPeerContext>();

  const sendMessage = (ws: WebSocket, payload: CollabServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  const broadcastToRoom = (roomId: string, payload: CollabServerMessage) => {
    const set = roomSockets.get(roomId);
    if (!set || set.size === 0) return;
    const raw = JSON.stringify(payload);
    for (const sock of set) {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send(raw);
      }
    }
  };

  const detachSocket = (ws: WebSocket) => {
    const ctx = peerContexts.get(ws);
    if (!ctx) return;
    peerContexts.delete(ws);

    const set = roomSockets.get(ctx.roomId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        roomSockets.delete(ctx.roomId);
      }
    }

    const nextPresence = collabStore.removePresence(ctx.roomId, ctx.connectionKey);
    broadcastToRoom(ctx.roomId, {
      type: 'presence:updated',
      presence: nextPresence,
    });
  };

  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    try {
      const hostHeader = req.headers.host || 'localhost:3000';
      const parsedUrl = new URL(req.url || '/', `http://${hostHeader}`);
      if (parsedUrl.pathname !== COLLAB_WS_PATH) {
        return; // 다른 경로(예: Vite HMR 등)는 건드리지 않음
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    const connectionKey = `conn_${crypto.randomBytes(6).toString('hex')}`;

    ws.on('pong', () => {
      const ctx = peerContexts.get(ws);
      if (ctx) {
        ctx.isAlive = true;
      }
    });

    ws.on('message', (rawData) => {
      let msg: CollabClientMessage;
      try {
        const str = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
        msg = JSON.parse(str) as CollabClientMessage;
      } catch {
        sendMessage(ws, {
          type: 'room:error',
          code: 'INVALID_JSON',
          message: '잘못된 실시간 메시지 형식입니다.',
        });
        return;
      }

      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

      if (msg.type === 'room:join') {
        const roomId = String(msg.roomId || '').trim();
        const existingRoom = collabStore.getRoomSnapshot(roomId);
        if (!existingRoom) {
          sendMessage(ws, {
            type: 'room:error',
            code: 'ROOM_NOT_FOUND',
            message: '요청한 라이브 협업 룸을 찾을 수 없습니다.',
          });
          return;
        }

        // 이전 룸에 연결되어 있었다면 먼저 해제
        detachSocket(ws);

        const isHost = collabStore.verifyHostSecret(roomId, msg.hostSecret);
        const participantId = String(msg.participantId || connectionKey).slice(0, 64);
        const displayName = String(msg.displayName || '참여자').trim().slice(0, 40) || '참여자';
        const colorHex =
          typeof msg.colorHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(msg.colorHex)
            ? msg.colorHex
            : pickDeterministicCollabColor(participantId);
        const timeZone = String(msg.timeZone || 'Asia/Seoul').slice(0, 64);

        const ctx: ConnectedPeerContext = {
          connectionKey,
          roomId,
          participantId,
          displayName,
          colorHex,
          timeZone,
          isHost,
          isAlive: true,
        };
        peerContexts.set(ws, ctx);

        let set = roomSockets.get(roomId);
        if (!set) {
          set = new Set();
          roomSockets.set(roomId, set);
        }
        set.add(ws);

        const updatedPresence = collabStore.upsertPresence(roomId, connectionKey, {
          participantId,
          displayName,
          colorHex,
          timeZone,
          role: isHost ? 'host' : 'guest',
          activeTargetId: msg.activeTargetId,
        });

        const freshSnapshot = collabStore.getRoomSnapshot(roomId);
        if (freshSnapshot) {
          sendMessage(ws, {
            type: 'room:init',
            room: freshSnapshot,
            isHost,
          });
        }

        broadcastToRoom(roomId, {
          type: 'presence:updated',
          presence: updatedPresence,
        });
        return;
      }

      const ctx = peerContexts.get(ws);
      if (!ctx) {
        sendMessage(ws, {
          type: 'room:error',
          code: 'NOT_JOINED',
          message: '먼저 협업 룸 세션에 입장해 주세요.',
        });
        return;
      }
      ctx.isAlive = true;

      switch (msg.type) {
        case 'presence:update': {
          if (typeof msg.displayName === 'string' && msg.displayName.trim()) {
            ctx.displayName = msg.displayName.trim().slice(0, 40);
          }
          if (typeof msg.timeZone === 'string' && msg.timeZone.trim()) {
            ctx.timeZone = msg.timeZone.trim().slice(0, 64);
          }
          const presence = collabStore.upsertPresence(ctx.roomId, ctx.connectionKey, {
            participantId: ctx.participantId,
            displayName: ctx.displayName,
            colorHex: ctx.colorHex,
            timeZone: ctx.timeZone,
            role: ctx.isHost ? 'host' : 'guest',
            activeTargetId: msg.activeTargetId,
          });
          broadcastToRoom(ctx.roomId, {
            type: 'presence:updated',
            presence,
          });
          break;
        }

        case 'slot:vote': {
          const result = collabStore.applySlotVote({
            roomId: ctx.roomId,
            mutationId: msg.mutationId,
            slotId: msg.slotId,
            participantId: ctx.participantId,
            displayName: ctx.displayName,
            colorHex: ctx.colorHex,
            timeZone: ctx.timeZone,
            status: msg.status,
          });
          if (result) {
            broadcastToRoom(ctx.roomId, {
              type: 'slot:voted',
              revision: result.revision,
              slotId: result.slotId,
              votes: result.votes,
              mutationId: msg.mutationId,
              updatedAt: result.updatedAt,
            });
          }
          break;
        }

        case 'slot:propose': {
          const result = collabStore.applyProposeSlot({
            roomId: ctx.roomId,
            mutationId: msg.mutationId,
            createdByName: ctx.displayName,
            participantId: ctx.participantId,
            colorHex: ctx.colorHex,
            timeZone: ctx.timeZone,
            slot: msg.slot,
          });
          if (result) {
            broadcastToRoom(ctx.roomId, {
              type: 'slot:proposed',
              revision: result.revision,
              slot: result.slot,
              mutationId: msg.mutationId,
              updatedAt: result.updatedAt,
            });
          }
          break;
        }

        case 'proposal:finalize': {
          const result = collabStore.applyFinalizeSlot({
            roomId: ctx.roomId,
            mutationId: msg.mutationId,
            slotId: msg.slotId,
            hostSecret: msg.hostSecret,
            actorName: ctx.displayName,
          });
          if (!result) {
            sendMessage(ws, {
              type: 'room:error',
              code: 'FORBIDDEN_HOST_ACTION',
              message: '호스트 권한이 확인되지 않아 일정을 확정할 수 없습니다.',
            });
            break;
          }
          broadcastToRoom(ctx.roomId, {
            type: 'proposal:finalized',
            revision: result.revision,
            finalizedSlotId: result.finalizedSlotId,
            systemComment: result.systemComment,
            mutationId: msg.mutationId,
            updatedAt: result.updatedAt,
          });
          break;
        }

        case 'checklist:toggle': {
          const result = collabStore.applyChecklistToggle({
            roomId: ctx.roomId,
            mutationId: msg.mutationId,
            eventId: msg.eventId,
            itemId: msg.itemId,
            done: msg.done,
            actorName: ctx.displayName,
          });
          if (result) {
            broadcastToRoom(ctx.roomId, {
              type: 'checklist:updated',
              revision: result.revision,
              eventId: result.eventId,
              checklist: result.checklist,
              mutationId: msg.mutationId,
              updatedAt: result.updatedAt,
            });
          }
          break;
        }

        case 'checklist:add': {
          const result = collabStore.applyChecklistAdd({
            roomId: ctx.roomId,
            mutationId: msg.mutationId,
            eventId: msg.eventId,
            item: msg.item,
            actorName: ctx.displayName,
          });
          if (result) {
            broadcastToRoom(ctx.roomId, {
              type: 'checklist:updated',
              revision: result.revision,
              eventId: result.eventId,
              checklist: result.checklist,
              mutationId: msg.mutationId,
              updatedAt: result.updatedAt,
            });
          }
          break;
        }

        case 'event:complete': {
          const result = collabStore.applyEventComplete({
            roomId: ctx.roomId,
            mutationId: msg.mutationId,
            eventId: msg.eventId,
            isCompleted: msg.isCompleted,
          });
          if (result) {
            broadcastToRoom(ctx.roomId, {
              type: 'event:updated',
              revision: result.revision,
              eventId: result.eventId,
              isCompleted: result.isCompleted,
              mutationId: msg.mutationId,
              updatedAt: result.updatedAt,
            });
          }
          break;
        }

        case 'events:sync': {
          const result = collabStore.applySyncEvents({
            roomId: ctx.roomId,
            mutationId: msg.mutationId,
            events: msg.events,
            hostSecret: msg.hostSecret,
          });
          if (result) {
            broadcastToRoom(ctx.roomId, {
              type: 'events:synced',
              revision: result.revision,
              events: result.events,
              mutationId: msg.mutationId,
              updatedAt: result.updatedAt,
            });
          }
          break;
        }

        case 'comment:create': {
          const result = collabStore.applyCreateComment({
            roomId: ctx.roomId,
            mutationId: msg.mutationId,
            authorId: ctx.participantId,
            authorName: ctx.displayName,
            authorColor: ctx.colorHex,
            authorTimeZone: ctx.timeZone,
            comment: msg.comment,
          });
          if (result) {
            broadcastToRoom(ctx.roomId, {
              type: 'comment:created',
              revision: result.revision,
              comment: result.comment,
              mutationId: msg.mutationId,
              updatedAt: result.updatedAt,
            });
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      detachSocket(ws);
    });

    ws.on('error', () => {
      detachSocket(ws);
    });
  });

  // 비정상 종료된 소켓 정리(25초 하트비트)
  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      const ctx = peerContexts.get(client);
      if (ctx && !ctx.isAlive) {
        detachSocket(client);
        client.terminate();
        continue;
      }
      if (ctx) {
        ctx.isAlive = false;
      }
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    }
  }, 25_000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}
