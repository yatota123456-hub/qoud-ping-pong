import { createServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { Room, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PlayerState, QoudRoomState, type PlayerSide } from '../src/shared/roomSchema';

type CreateOptions = {
  code: string;
  maxPlayers: number;
  settings?: Record<string, unknown>;
  player: { name: string; color: string; side: PlayerSide };
  computerPlayers?: Array<{ name: string; color: string; side: PlayerSide }>;
};

const roomsByCode = new Map<string, QoudRoom>();
const SIDES: PlayerSide[] = ['bottom', 'top', 'right', 'left'];
const COLORS = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];

class QoudRoom extends Room<QoudRoomState> {
  maxClients = 4;

  onCreate(options: CreateOptions) {
    const code = String(options.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (code.length !== 4) throw new Error('Invalid room code');

    const maxPlayers = Math.max(2, Math.min(4, Number(options.maxPlayers) || 2));
    const settings = options.settings ?? {};
    const vsComputer = settings.vsComputer === true;
    // Computer opponents live in the same Colyseus state as human players,
    // while maxClients still counts only real WebSocket connections.
    this.maxClients = vsComputer ? 1 : maxPlayers;
    const state = new QoudRoomState();
    state.code = code;
    state.status = 'waiting';
    state.maxPlayers = maxPlayers;
    state.hostSessionId = '';
    state.settingsJson = JSON.stringify(settings);
    this.setState(state);

    if (vsComputer) {
      for (const [index, computer] of (options.computerPlayers ?? []).entries()) {
        const player = new PlayerState();
        const seat = index + 1;
        player.id = `computer-${seat}`;
        player.name = String(computer.name || `Computer ${seat + 1}`).trim();
        player.color = String(computer.color || COLORS[seat] || COLORS[0]);
        player.side = computer.side ?? SIDES[seat] ?? 'top';
        player.computer = true;
        state.players.set(player.id, player);
        state.scores.set(player.id, 0);
      }
    }

    roomsByCode.set(code, this);
    this.onMessage('*', (client, type, payload) => this.handleMessage(type, client, payload));
  }

  onJoin(client: { sessionId: string }, options: { name?: string; player?: Partial<PlayerState> } = {}) {
    if (this.state.status !== 'waiting') throw new Error('الجولة بدأت بالفعل');

    const name = String(options.name ?? options.player?.name ?? '').trim();
    if (name.length < 2) throw new Error('الاسم قصير جداً');
    if ([...this.state.players.values()].some((player) => player.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('الاسم مستخدم داخل الغرفة');
    }

    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = name;
    player.color = String(options.player?.color ?? '#ffcf5a');
    player.side = (options.player?.side as PlayerSide) ?? this.nextSide();
    player.computer = false;
    this.state.players.set(client.sessionId, player);
    this.state.scores.set(client.sessionId, 0);

    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;
    this.broadcastRoom();
  }

  onLeave(client: { sessionId: string }) {
    const wasHost = this.state.hostSessionId === client.sessionId;
    this.state.players.delete(client.sessionId);
    this.state.scores.delete(client.sessionId);
    if (wasHost) {
      this.broadcast('host-left', { message: 'منشئ الغرفة غادر' });
      this.disconnect();
      return;
    }
    this.broadcastRoom();
  }

  onDispose() {
    if (roomsByCode.get(this.state.code) === this) roomsByCode.delete(this.state.code);
  }

  private handleMessage(type: string, client: { sessionId: string }, payload: any) {
    if (type === 'start-game') {
      this.assertHost(client);
      this.state.status = 'playing';
      for (const player of this.state.players.values()) this.state.scores.set(player.id, 0);
      this.broadcast('game-started', { settings: this.state.settingsJson });
      return;
    }

    if (type === 'goal-scored') {
      this.assertHost(client);
      const requestedScores = payload?.scores;
      if (requestedScores && typeof requestedScores === 'object') {
        for (const player of this.state.players.values()) {
          const score = Number(requestedScores[player.id]);
          if (Number.isFinite(score) && score >= 0) this.state.scores.set(player.id, Math.floor(score));
        }
      } else {
        const missedId = [...this.state.players.values()].find((player) => player.side === payload?.missedSide)?.id;
        const scorer = [...this.state.players.values()].find((player) => player.id !== missedId);
        if (!scorer) return;
        this.state.scores.set(scorer.id, (this.state.scores.get(scorer.id) ?? 0) + 1);
      }
      this.broadcast('goal-scored', { missedSide: payload?.missedSide, scores: Object.fromEntries(this.state.scores.entries()) });
      return;
    }

    if (type === 'match-finished') {
      this.assertHost(client);
      this.broadcast('match-finished', {
        winnerId: payload?.winnerId,
        scores: Object.fromEntries(this.state.scores.entries()),
      });
      return;
    }

    if (type === 'game-state' || type === 'paddle-input') {
      if (type === 'game-state') {
        if (client.sessionId === this.state.hostSessionId) this.broadcast(type, payload, { except: client });
        return;
      }

      const player = this.state.players.get(client.sessionId);
      if (!player || player.computer || payload?.side !== player.side) return;
      const x = Number(payload?.x);
      const y = Number(payload?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      this.broadcast('paddle-input', {
        side: player.side,
        x: Math.max(0, Math.min(1000, x)),
        y: Math.max(0, Math.min(1000, y)),
      }, { except: client });
    }
  }

  private nextSide(): PlayerSide {
    const sides: PlayerSide[] = ['bottom', 'top', 'right', 'left'];
    return sides.find((side) => ![...this.state.players.values()].some((player) => player.side === side)) ?? 'bottom';
  }

  private assertHost(client: { sessionId: string }) {
    if (this.state.hostSessionId !== client.sessionId) throw new Error('المنشئ فقط يستطيع تنفيذ هذا الإجراء');
  }

  private broadcastRoom() {
    this.broadcast('room-update', {
      code: this.state.code,
      status: this.state.status,
      maxPlayers: this.state.maxPlayers,
      hostSessionId: this.state.hostSessionId,
      players: [...this.state.players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        side: player.side,
        computer: player.computer,
        socketId: player.id,
      })),
    });
  }
}

const port = Number(process.env.PORT ?? 5000);
const isProduction = process.env.NODE_ENV === 'production';
const httpServer = createServer();

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
  express: async (app) => {
    app.get('/api/rooms', (req, res) => {
      const code = String(req.query.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code) {
        const room = roomsByCode.get(code);
        if (!room) return res.status(404).json({ error: 'الغرفة غير موجودة' });
        return res.json({ roomId: room.roomId, code });
      }
      return res.json({ count: roomsByCode.size });
    });

    app.get('/health', (_req, res) => res.json({ ok: true, rooms: roomsByCode.size }));

    if (isProduction) {
      const publicDir = path.resolve(import.meta.dirname, '../dist/public');
      app.use(express.static(publicDir, { index: 'index.html' }));
      app.get(/.*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
      return;
    }

    const vite = await createViteServer({
      configFile: path.resolve(import.meta.dirname, '../vite.config.ts'),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use((req, res, next) => vite.middlewares(req, res, next));
  },
});
gameServer.define('qoud', QoudRoom);
await gameServer.listen(port, '0.0.0.0');
console.log(`[colyseus] Qoud server listening on port ${port}`);