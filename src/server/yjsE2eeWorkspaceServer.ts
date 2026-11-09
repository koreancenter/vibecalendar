import type { Express } from 'express';
import type { Server as HttpServer, IncomingMessage } from 'http';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { apiRateLimiter, textCommandJsonParser } from './security';
import {
  CreateEncryptedWorkspaceRequest,
  CreateEncryptedWorkspaceResponse,
  EncryptedBinaryEnvelope,
  EncryptedCrdtDeltaRecord,
  EncryptedWorkspaceServerState,
  MAX_ENCRYPTED_DELTAS_PER_DOC,
  YJS_SHARE_API_BASE,
  YJS_SHARE_WS_PATH,
  YjsE2eeClientWsMessage,
  YjsE2eeServerWsMessage,
} from '../shared/yjsCollabProtocol';

interface StoredEncryptedYjsDoc {
  docId: string;
  authVerifierHash: string;
  snapshotSeq: number;
  encryptedSnapshot: EncryptedBinaryEnvelope;
  deltas: EncryptedCrdtDeltaRecord[];
  createdAt: string;
  updatedAt: string;
}

interface YjsPeerContext {
  docId: string;
  peerId: string;
  isAlive: boolean;
}

const STORAGE_FILE = path.join(os.tmpdir(), 'vibe-yjs-e2ee-workspaces-v1.json');
const MAX_STORED_DOCS = 250;

function isValidEnvelope(env: unknown): env is EncryptedBinaryEnvelope {
  if (!env || typeof env !== 'object') return false;
  const candidate = env as Record<string, unknown>;
  return (
    typeof candidate.iv === 'string' &&
    candidate.iv.length >= 12 &&
    candidate.iv.length <= 48 &&
    typeof candidate.ct === 'string' &&
    candidate.ct.length >= 16 &&
    candidate.ct.length <= 512 * 1024
  );
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function verifyCapabilityConstantTime(authCapability: string, expectedVerifierHex: string): boolean {
  if (!authCapability || !expectedVerifierHex || expectedVerifierHex.length !== 64) {
    return false;
  }
  const actualHex = sha256Hex(authCapability);
  try {
    const a = Buffer.from(actualHex, 'hex');
    const b = Buffer.from(expectedVerifierHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

class ZeroKnowledgeYjsStore {
  private docs = new Map<string, StoredEncryptedYjsDoc>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(STORAGE_FILE)) return;
      const raw = fs.readFileSync(STORAGE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as StoredEncryptedYjsDoc[];
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (item && typeof item.docId === 'string' && isValidEnvelope(item.encryptedSnapshot)) {
          this.docs.set(item.docId, {
            docId: item.docId,
            authVerifierHash: String(item.authVerifierHash || ''),
            snapshotSeq: Number(item.snapshotSeq || 0),
            encryptedSnapshot: item.encryptedSnapshot,
            deltas: Array.isArray(item.deltas) ? item.deltas : [],
            createdAt: String(item.createdAt || new Date().toISOString()),
            updatedAt: String(item.updatedAt || new Date().toISOString()),
          });
        }
      }
    } catch {
      // Ignore corrupt temporary persistence
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        const list = Array.from(this.docs.values())
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, MAX_STORED_DOCS);
        const tmpPath = `${STORAGE_FILE}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(list), 'utf8');
        fs.renameSync(tmpPath, STORAGE_FILE);
      } catch {
        // Ignore non-fatal disk write error
      }
    }, 300);
  }

  private pruneIfNeeded(): void {
    if (this.docs.size <= MAX_STORED_DOCS) return;
    const sorted = Array.from(this.docs.values()).sort((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt)
    );
    const excess = this.docs.size - MAX_STORED_DOCS;
    for (let i = 0; i < excess; i++) {
      this.docs.delete(sorted[i].docId);
    }
  }

  createWorkspace(params: {
    docId?: string;
    authVerifierHash: string;
    encryptedSnapshot: EncryptedBinaryEnvelope;
  }): StoredEncryptedYjsDoc {
    const requestedId = params.docId?.trim();
    const docId =
      requestedId && /^[a-zA-Z0-9_-]{6,48}$/.test(requestedId) && !this.docs.has(requestedId)
        ? requestedId
        : `sp_${crypto.randomBytes(9).toString('base64url')}`;

    const nowIso = new Date().toISOString();
    const created: StoredEncryptedYjsDoc = {
      docId,
      authVerifierHash: params.authVerifierHash.toLowerCase(),
      snapshotSeq: 0,
      encryptedSnapshot: params.encryptedSnapshot,
      deltas: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.docs.set(docId, created);
    this.pruneIfNeeded();
    this.schedulePersist();
    return created;
  }

  verifyAndGetState(
    docId: string,
    authCapability: string,
    knownSeq = 0
  ): EncryptedWorkspaceServerState | null {
    const doc = this.docs.get(docId);
    if (!doc) return null;
    if (!verifyCapabilityConstantTime(authCapability, doc.authVerifierHash)) {
      return null;
    }

    const filteredDeltas =
      knownSeq > doc.snapshotSeq ? doc.deltas.filter((d) => d.seq > knownSeq) : doc.deltas;

    return {
      docId: doc.docId,
      snapshotSeq: doc.snapshotSeq,
      encryptedSnapshot: doc.encryptedSnapshot,
      deltas: filteredDeltas,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  exists(docId: string): boolean {
    return this.docs.has(docId);
  }

  appendEncryptedDelta(params: {
    docId: string;
    senderId: string;
    envelope: EncryptedBinaryEnvelope;
  }): EncryptedCrdtDeltaRecord | null {
    const doc = this.docs.get(params.docId);
    if (!doc) return null;

    const latestSeq =
      doc.deltas.length > 0 ? doc.deltas[doc.deltas.length - 1].seq : doc.snapshotSeq;
    const nextSeq = latestSeq + 1;
    const nowIso = new Date().toISOString();

    const record: EncryptedCrdtDeltaRecord = {
      seq: nextSeq,
      senderId: params.senderId,
      envelope: params.envelope,
      createdAt: nowIso,
    };

    doc.deltas.push(record);
    if (doc.deltas.length > MAX_ENCRYPTED_DELTAS_PER_DOC) {
      doc.deltas = doc.deltas.slice(doc.deltas.length - MAX_ENCRYPTED_DELTAS_PER_DOC);
    }
    doc.updatedAt = nowIso;
    this.schedulePersist();
    return record;
  }

  compactSnapshot(params: {
    docId: string;
    baseSeq: number;
    encryptedSnapshot: EncryptedBinaryEnvelope;
  }): number | null {
    const doc = this.docs.get(params.docId);
    if (!doc) return null;
    if (params.baseSeq <= doc.snapshotSeq) {
      return doc.snapshotSeq;
    }

    const latestSeq =
      doc.deltas.length > 0 ? doc.deltas[doc.deltas.length - 1].seq : doc.snapshotSeq;
    const effectiveSeq = Math.min(params.baseSeq, latestSeq);

    doc.encryptedSnapshot = params.encryptedSnapshot;
    doc.snapshotSeq = effectiveSeq;
    doc.deltas = doc.deltas.filter((d) => d.seq > effectiveSeq);
    doc.updatedAt = new Date().toISOString();
    this.schedulePersist();
    return doc.snapshotSeq;
  }
}

export const yjsE2eeStore = new ZeroKnowledgeYjsStore();

export function registerYjsSharePassRoutes(app: Express): void {
  // Zero-Knowledge E2EE Yjs CRDT 워크스페이스 생성 (서버에는 암호화된 바이너리 스냅샷과 검증 해시만 저장)
  app.post(
    YJS_SHARE_API_BASE,
    apiRateLimiter,
    textCommandJsonParser,
    (req, res) => {
      const body = req.body as Partial<CreateEncryptedWorkspaceRequest> | null;
      if (
        !body ||
        typeof body !== 'object' ||
        typeof body.authVerifierHash !== 'string' ||
        !/^[0-9a-fA-F]{64}$/.test(body.authVerifierHash) ||
        !isValidEnvelope(body.encryptedSnapshot)
      ) {
        res.status(400).json({ error: '유효한 E2EE 암호화 CRDT 스냅샷이 필요합니다.' });
        return;
      }

      const created = yjsE2eeStore.createWorkspace({
        docId: body.docId,
        authVerifierHash: body.authVerifierHash,
        encryptedSnapshot: body.encryptedSnapshot,
      });

      const response: CreateEncryptedWorkspaceResponse = {
        docId: created.docId,
        snapshotSeq: created.snapshotSeq,
        createdAt: created.createdAt,
      };
      res.status(201).json(response);
    }
  );

  // Zero-Knowledge E2EE 스냅샷 + 증분 델타 조회 (헤더 X-SharePass-Auth 로 키 소유 증명 검증)
  app.get(`${YJS_SHARE_API_BASE}/:docId`, apiRateLimiter, (req, res) => {
    const docId = String(req.params.docId || '').trim();
    if (!/^[a-zA-Z0-9_-]{6,48}$/.test(docId)) {
      res.status(400).json({ error: '잘못된 공동편집 문서 식별자입니다.' });
      return;
    }

    if (!yjsE2eeStore.exists(docId)) {
      res.status(404).json({ error: '존재하지 않거나 만료된 공동편집 패스입니다.' });
      return;
    }

    const authHeader = req.headers['x-sharepass-auth'];
    const authCapability = Array.isArray(authHeader) ? authHeader[0] || '' : authHeader || '';
    const state = yjsE2eeStore.verifyAndGetState(docId, authCapability.trim());
    if (!state) {
      res.status(403).json({
        error: '종단간 암호화(E2EE) 키 검증에 실패했습니다. 전체 초대 링크(#sk= 포함)를 확인해 주세요.',
      });
      return;
    }

    res.json(state);
  });
}

export function attachYjsSharePassWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 512 * 1024,
  });

  const docSockets = new Map<string, Set<WebSocket>>();
  const peerContexts = new WeakMap<WebSocket, YjsPeerContext>();

  const sendToSocket = (ws: WebSocket, message: YjsE2eeServerWsMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const broadcastToDoc = (
    docId: string,
    message: YjsE2eeServerWsMessage,
    excludeSocket?: WebSocket
  ) => {
    const sockets = docSockets.get(docId);
    if (!sockets || sockets.size === 0) return;
    const serialized = JSON.stringify(message);
    for (const sock of sockets) {
      if (sock !== excludeSocket && sock.readyState === WebSocket.OPEN) {
        sock.send(serialized);
      }
    }
  };

  const detachPeer = (ws: WebSocket) => {
    const ctx = peerContexts.get(ws);
    if (!ctx) return;
    peerContexts.delete(ws);

    const sockets = docSockets.get(ctx.docId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        docSockets.delete(ctx.docId);
      } else {
        broadcastToDoc(ctx.docId, {
          type: 'yjs:peer_left',
          peerId: ctx.peerId,
        });
        broadcastToDoc(ctx.docId, {
          type: 'yjs:peer_count',
          peerCount: sockets.size,
        });
      }
    }
  };

  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    try {
      const hostHeader = req.headers.host || 'localhost:3000';
      const parsedUrl = new URL(req.url || '/', `http://${hostHeader}`);
      if (parsedUrl.pathname !== YJS_SHARE_WS_PATH) {
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    let socketMessageCount = 0;
    let socketWindowResetAt = Date.now() + 1000;
    const MAX_YJS_MESSAGES_PER_SEC = 40;

    ws.on('pong', () => {
      const ctx = peerContexts.get(ws);
      if (ctx) {
        ctx.isAlive = true;
      }
    });

    ws.on('message', (rawData) => {
      const now = Date.now();
      if (now > socketWindowResetAt) {
        socketMessageCount = 1;
        socketWindowResetAt = now + 1000;
      } else {
        socketMessageCount++;
        if (socketMessageCount > MAX_YJS_MESSAGES_PER_SEC) {
          sendToSocket(ws, {
            type: 'yjs:error',
            code: 'RATE_LIMITED',
            message: '초당 동기화 프레임 한도(40회)를 초과했습니다.',
          });
          return;
        }
      }

      let msg: YjsE2eeClientWsMessage;
      try {
        const text = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
        msg = JSON.parse(text) as YjsE2eeClientWsMessage;
      } catch {
        sendToSocket(ws, {
          type: 'yjs:error',
          code: 'INVALID_FRAME',
          message: '올바르지 않은 암호화 동기화 프레임입니다.',
        });
        return;
      }

      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

      if (msg.type === 'yjs:auth') {
        const docId = String(msg.docId || '').trim();
        if (!yjsE2eeStore.exists(docId)) {
          sendToSocket(ws, {
            type: 'yjs:error',
            code: 'DOC_NOT_FOUND',
            message: '요청한 실시간 공동편집 패스를 찾을 수 없습니다.',
          });
          return;
        }

        const state = yjsE2eeStore.verifyAndGetState(
          docId,
          String(msg.authCapability || '').trim(),
          typeof msg.knownSeq === 'number' ? msg.knownSeq : 0
        );
        if (!state) {
          sendToSocket(ws, {
            type: 'yjs:error',
            code: 'AUTH_FAILED',
            message: '종단간 암호화(E2EE) 키 검증에 실패했습니다.',
          });
          return;
        }

        detachPeer(ws);
        const peerId =
          typeof msg.peerId === 'string' && msg.peerId.trim()
            ? msg.peerId.trim().slice(0, 64)
            : `peer_${crypto.randomBytes(6).toString('hex')}`;

        peerContexts.set(ws, {
          docId,
          peerId,
          isAlive: true,
        });

        let set = docSockets.get(docId);
        if (!set) {
          set = new Set();
          docSockets.set(docId, set);
        }
        set.add(ws);

        sendToSocket(ws, {
          type: 'yjs:sync_init',
          docId,
          snapshotSeq: state.snapshotSeq,
          encryptedSnapshot: state.encryptedSnapshot,
          deltas: state.deltas,
          peerCount: set.size,
        });

        broadcastToDoc(
          docId,
          {
            type: 'yjs:peer_count',
            peerCount: set.size,
          },
          ws
        );
        return;
      }

      const ctx = peerContexts.get(ws);
      if (!ctx) {
        sendToSocket(ws, {
          type: 'yjs:error',
          code: 'UNAUTHORIZED',
          message: '세션 키 인증이 먼저 필요합니다.',
        });
        return;
      }
      ctx.isAlive = true;

      switch (msg.type) {
        case 'yjs:update': {
          if (!isValidEnvelope(msg.envelope)) return;
          const appended = yjsE2eeStore.appendEncryptedDelta({
            docId: ctx.docId,
            senderId: ctx.peerId,
            envelope: msg.envelope,
          });
          if (appended) {
            // 발신자를 포함한 모든 피어에 시퀀스 확정 브로드캐스트(멱등성 보장)
            broadcastToDoc(ctx.docId, {
              type: 'yjs:remote_update',
              delta: appended,
            });
          }
          break;
        }

        case 'yjs:compact': {
          if (typeof msg.baseSeq !== 'number' || !isValidEnvelope(msg.encryptedSnapshot)) {
            return;
          }
          const compactedSeq = yjsE2eeStore.compactSnapshot({
            docId: ctx.docId,
            baseSeq: msg.baseSeq,
            encryptedSnapshot: msg.encryptedSnapshot,
          });
          if (compactedSeq !== null) {
            broadcastToDoc(ctx.docId, {
              type: 'yjs:compacted',
              snapshotSeq: compactedSeq,
            });
          }
          break;
        }

        case 'yjs:awareness': {
          if (!isValidEnvelope(msg.envelope)) return;
          broadcastToDoc(
            ctx.docId,
            {
              type: 'yjs:remote_awareness',
              peerId: ctx.peerId,
              envelope: msg.envelope,
            },
            ws
          );
          break;
        }

        case 'yjs:leave': {
          detachPeer(ws);
          break;
        }
      }
    });

    ws.on('close', () => {
      detachPeer(ws);
    });

    ws.on('error', () => {
      detachPeer(ws);
    });
  });

  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      const ctx = peerContexts.get(client);
      if (ctx && !ctx.isAlive) {
        detachPeer(client);
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
