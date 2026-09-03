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
const MAX_COORD = 2000;

class QoudRoom extends Room<QoudRoomState> {
  maxClients = 4;

  onCreate(options: CreateOptions) {
    const code = String(options.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (code.length !== 4) throw new Error('Invalid room code');
    const maxPlayers = Math.max(2, Math.min(4, Number(options.maxPlayers) || 2));
    const settings = options.settings ?? {};
    this.maxClients = maxPlayers;
    const state = new QoudRoomState();
    state.code = code;
    state.status = 'waiting';
    state.maxPlayers = maxPlayers;
    state.hostSessionId = '';
    state.settingsJson = JSON.stringify(settings);
    this.setState(state);
    this.setMetadata({ code: code });
    roomsByCode.set(code, this);
    this.onMessage('*', (client, type, payload) => this.handleMessage(type, client, payload));
  }

  onJoin(client: { sessionId: string }, options: { name?: string; player?: Partial<PlayerState> } = {}) {
    if (this.state.status !== 'waiting') throw new Error('الجولة بدأت بالفعل');
    let name = String(options.name ?? options.player?.name ?? '').trim();
    if (name.length < 2) name = `لاعب ${this.state.players.size + 1}`;
    const existingNames = [...this.state.players.values()].map(p => p.name.toLowerCase());
    if (existingNames.includes(name.toLowerCase())) {
      let i = 2;
      while (existingNames.includes(`${name} ${i}`.toLowerCase())) i++;
      name = `${name} ${i}`;
    }
    const side = (options.player?.side as PlayerSide) ?? this.nextSide();
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = name;
    player.color = String(options.player?.color ?? COLORS[this.humanCount() % COLORS.length]);
    player.side = side;
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
    if (this.state.players.size === 0) {
      this.disconnect();
      return;
    }
    this.broadcastRoom();
  }

  onDispose() {
    if (roomsByCode.get(this.state.code) === this) roomsByCode.delete(this.state.code);
  }

  private handleMessage(type: string, client: { sessionId: string }, payload: any) {
    if (type === 'update-name') {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.status !== 'waiting') return;
      let newName = String(payload?.name ?? '').trim().slice(0, 15);
      if (newName.length < 2) return;
      const otherNames = [...this.state.players.values()]
        .filter(p => p.id !== client.sessionId)
        .map(p => p.name.toLowerCase());
      if (otherNames.includes(newName.toLowerCase())) {
        let i = 2;
        while (otherNames.includes(`${newName} ${i}`.toLowerCase())) i++;
        newName = `${newName} ${i}`;
      }
      player.name = newName;
      this.broadcastRoom();
      return;
    }
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
      this.state.status = 'waiting';
      return;
    }
    if (type === 'game-state') {
      if (client.sessionId !== this.state.hostSessionId) return;
      const gameState = payload?.state ?? payload;
      if (!gameState) return;
      this.broadcast(type, gameState, { except: client });
      return;
    }
    if (type === 'paddle-input') {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (payload?.side !== player.side) return;
      const x = Number(payload?.x);
      if (!Number.isFinite(x)) return;
      const hostClient = [...this.clients].find(c => c.sessionId === this.state.hostSessionId);
      const data = { side: player.side, x: Math.max(45, Math.min(MAX_COORD - 45, x)) };
      if (hostClient && hostClient.sessionId !== client.sessionId) {
        hostClient.send('paddle-input', data);
      } else {
        this.broadcast('paddle-input', data, { except: client });
      }
      return;
    }
  }

  private humanCount() {
    return [...this.state.players.values()].filter(p => !p.computer).length;
  }

  private nextSide(): PlayerSide {
    const humanOccupied = new Set([...this.state.players.values()].filter(p => !p.computer).map(p => p.side));
    return SIDES.find(side => !humanOccupied.has(side)) ?? 'bottom';
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
      settings: JSON.parse(this.state.settingsJson || '{}'),
      players: [...this.state.players.values()].map(player => ({
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
