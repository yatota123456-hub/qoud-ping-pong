import { createServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { Room, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PlayerState, BallState, PaddleState, QoudRoomState, type PlayerSide } from '../src/shared/roomSchema';

type CreateOptions = {
  code: string;
  maxPlayers: number;
  settings?: Record<string, unknown>;
  player: { name: string; color: string; side: PlayerSide };
};

const roomsByCode = new Map<string, QoudRoom>();
const SIDES: PlayerSide[] = ['bottom', 'top', 'right', 'left'];
const OPPOSITE: Record<PlayerSide, PlayerSide> = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };
const COLORS = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];

const ARENA_SCALES: Record<string, number> = { small: 0.8, medium: 1.0, large: 1.25, xlarge: 1.5 };
const RECT = { w: 700, h: 1050 };
const SQUARE = { w: 1000, h: 1000 };

function getArenaWorld(count: number, size: string = 'medium') {
  const base = count >= 3 ? SQUARE : RECT;
  const sc = ARENA_SCALES[size] || 1;
  return { w: base.w * sc, h: base.h * sc };
}

class QoudRoom extends Room<QoudRoomState> {
  maxClients = 4;
  private settings: any = {};
  private activeSides: PlayerSide[] = ['bottom', 'top'];
  private elapsedAccum = 0;
  private countdownStartedAt = 0;
  private servingActive = false;
  private servingSide: PlayerSide = 'bottom';
  private servingStartedAt = 0;
  private servingRequested = false;

  onCreate(options: CreateOptions) {
    const code = String(options.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (code.length !== 4) throw new Error('Invalid room code');
    const maxPlayers = Math.max(2, Math.min(4, Number(options.maxPlayers) || 2));
    this.settings = { mode: 'time', duration: 180, goal: 7, ballSpeed: 10, difficulty: 'normal', arenaSize: 'medium', start: 'center', ...options.settings };
    this.maxClients = maxPlayers;

    const state = new QoudRoomState();
    state.code = code;
    state.status = 'waiting';
    state.maxPlayers = maxPlayers;
    state.hostSessionId = '';
    state.settingsJson = JSON.stringify(this.settings);
    state.ball = new BallState();
    this.setState(state);
    this.setMetadata({ code });
    roomsByCode.set(code, this);

    this.initWorldAndPaddles();
    this.onMessage('*', (client, type, payload) => this.handleMessage(type, client, payload));

    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), 1000 / 60);
  }

  private initWorldAndPaddles() {
    const needed = Math.max(2, this.state.players.size || this.state.maxPlayers, this.state.maxPlayers);
    this.activeSides = needed >= 3 ? ['bottom', 'top', 'right', 'left'] : ['bottom', 'top'];
    const world = getArenaWorld(needed, this.settings.arenaSize);
    this.state.worldW = world.w;
    this.state.worldH = world.h;
    this.state.paddles.clear();
    const defaults: Record<PlayerSide, [number, number]> = {
      top: [world.w / 2, 52],
      bottom: [world.w / 2, world.h - 52],
      left: [52, world.h / 2],
      right: [world.w - 52, world.h / 2],
    };
    (['top', 'right', 'bottom', 'left'] as PlayerSide[]).forEach((side) => {
      const p = new PaddleState();
      p.x = defaults[side][0];
      p.y = defaults[side][1];
      this.state.paddles.set(side, p);
    });
    this.state.ball.x = world.w / 2;
    this.state.ball.y = world.h / 2;
    this.state.ball.vx = 0;
    this.state.ball.vy = 0;
    this.state.ball.visible = false;
    this.state.timeLeft = this.settings.mode === 'time' ? Number(this.settings.duration || 180) : 0;
  }

  onJoin(client: { sessionId: string }, options: { name?: string; player?: Partial<PlayerState> } = {}) {
    if (this.state.status !== 'waiting') throw new Error('الجولة بدأت بالفعل');
    let name = String(options.name ?? options.player?.name ?? '').trim();
    if (name.length < 2) name = `لاعب ${this.state.players.size + 1}`;
    const existingNames = [...this.state.players.values()].map((p) => p.name.toLowerCase());
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
      const others = [...this.state.players.values()].filter((p) => p.id !== client.sessionId).map((p) => p.name.toLowerCase());
      if (others.includes(newName.toLowerCase())) {
        let i = 2;
        while (others.includes(`${newName} ${i}`.toLowerCase())) i++;
        newName = `${newName} ${i}`;
      }
      player.name = newName;
      this.broadcastRoom();
      return;
    }

    if (type === 'start-game') {
      this.assertHost(client);
      for (const p of this.state.players.values()) this.state.scores.set(p.id, 0);
      this.initWorldAndPaddles();
      this.state.status = 'playing';
      this.startCountdown(null);
      this.broadcast('game-started', { settings: this.state.settingsJson });
      return;
    }

    if (type === 'paddle-target') {
      if (this.state.status !== 'playing') return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const side = player.side as PlayerSide;
      const paddle = this.state.paddles.get(side);
      if (!paddle) return;
      const x = Number(payload?.x);
      const y = Number(payload?.y ?? payload?.z);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const clamped = this.clampPaddle(side, x, y);
      paddle.x = clamped.x;
      paddle.y = clamped.y;
      if (this.servingActive && this.servingSide === side) this.servingRequested = true;
      return;
    }

    if (type === 'request-serve') {
      if (this.servingActive && this.state.players.get(client.sessionId)?.side === this.servingSide) {
        this.servingRequested = true;
      }
      return;
    }
  }

  private clampPaddle(side: PlayerSide, x: number, y: number) {
    const w = this.state.worldW, h = this.state.worldH;
    if (side === 'top') return { x: Math.max(45, Math.min(w - 45, x)), y: Math.max(45, Math.min(h * 0.38, y)) };
    if (side === 'bottom') return { x: Math.max(45, Math.min(w - 45, x)), y: Math.max(h * 0.62, Math.min(h - 45, y)) };
    if (side === 'left') return { x: Math.max(45, Math.min(w * 0.38, x)), y: Math.max(45, Math.min(h - 45, y)) };
    return { x: Math.max(w * 0.62, Math.min(w - 45, x)), y: Math.max(45, Math.min(h - 45, y)) }; // right
  }

  private humanCount() {
    return [...this.state.players.values()].filter((p) => !p.computer).length;
  }

  private nextSide(): PlayerSide {
    const occupied = new Set([...this.state.players.values()].map((p) => p.side));
    return SIDES.find((s) => !occupied.has(s)) ?? 'bottom';
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
      players: [...this.state.players.values()].map((p) => ({
        id: p.id, name: p.name, color: p.color, side: p.side, computer: p.computer, socketId: p.id,
      })),
    });
  }

  private startCountdown(scorerSide: PlayerSide | null) {
    this.state.countdown = 3;
    this.state.countdownSide = scorerSide ?? '';
    this.countdownStartedAt = Date.now();
    this.state.rally = 0;
    this.state.ball.vx = 0;
    this.state.ball.vy = 0;
    this.state.ball.x = this.state.worldW / 2;
    this.state.ball.y = this.state.worldH / 2;
    this.state.ball.visible = false;
    this.servingActive = false;
  }

  private launchBall(fromServe = false, side: PlayerSide = 'bottom') {
    const speed = 6 + Number(this.settings.ballSpeed || 10) * 0.5;
    if (fromServe) {
      const ang = (Math.random() - 0.5) * 0.8;
      const paddle = this.state.paddles.get(side)!;
      this.state.ball.x = paddle.x;
      this.state.ball.y = paddle.y;
      if (side === 'bottom') { this.state.ball.vx = Math.sin(ang) * speed; this.state.ball.vy = -Math.abs(Math.cos(ang) * speed) - 1; }
      else if (side === 'top') { this.state.ball.vx = Math.sin(ang) * speed; this.state.ball.vy = Math.abs(Math.cos(ang) * speed) + 1; }
      else if (side === 'left') { this.state.ball.vx = Math.abs(Math.cos(ang) * speed) + 1; this.state.ball.vy = Math.sin(ang) * speed; }
      else { this.state.ball.vx = -Math.abs(Math.cos(ang) * speed) - 1; this.state.ball.vy = Math.sin(ang) * speed; }
    } else {
      const dirY = Math.random() > 0.5 ? 1 : -1;
      const ang = (Math.random() - 0.5) * 0.8;
      this.state.ball.vx = Math.sin(ang) * speed;
      this.state.ball.vy = Math.cos(ang) * speed * dirY;
    }
    this.state.ball.visible = true;
  }

  private tick(deltaMs: number) {
    if (this.state.status !== 'playing') return;
    const delta = Math.min(deltaMs / 16.67, 2);
  
    // العد التنازلي بعد كل هدف
    if (this.state.countdown > 0) {
      const elapsed = (Date.now() - this.countdownStartedAt) / 1000;
      if (elapsed >= 3) {
        this.state.countdown = 0;
        const side = (this.state.countdownSide || 'bottom') as PlayerSide;
        if (this.settings.start === 'paddle') {
          this.servingActive = true;
          this.servingSide = side;
          this.servingStartedAt = Date.now();
          this.servingRequested = false;
        } else {
          this.launchBall(false);
        }
        // بعد انتهاء العد التنازلي، نواصل البث
      } else {
        this.state.countdown = Math.max(1, Math.ceil(3 - elapsed));
        this.broadcastGameState(); // بث أثناء العد التنازلي
        return;
      }
    }
  
    // وضع "ابدأ من المضرب": الكرة ملتصقة بالمضرب لحين الطلب
    if (this.servingActive) {
      const paddle = this.state.paddles.get(this.servingSide);
      if (paddle) {
        const offset = 24;
        if (this.servingSide === 'bottom') { this.state.ball.x = paddle.x; this.state.ball.y = paddle.y - offset; }
        else if (this.servingSide === 'top') { this.state.ball.x = paddle.x; this.state.ball.y = paddle.y + offset; }
        else if (this.servingSide === 'left') { this.state.ball.x = paddle.x - offset; this.state.ball.y = paddle.y; }
        else { this.state.ball.x = paddle.x + offset; this.state.ball.y = paddle.y; }
      }
      const owner = [...this.state.players.values()].find((p) => p.side === this.servingSide);
      if (owner?.computer && Date.now() - this.servingStartedAt > 900) this.servingRequested = true;
      if (this.servingRequested) {
        this.launchBall(true, this.servingSide);
        this.servingActive = false;
        this.servingRequested = false;
      }
      this.broadcastGameState();
      return;
    }
  
    // الوقت
    if (this.settings.mode === 'time') {
      this.elapsedAccum += deltaMs / 1000;
      if (this.elapsedAccum >= 1) {
        this.elapsedAccum = 0;
        this.state.timeLeft = Math.max(0, this.state.timeLeft - 1);
        if (this.state.timeLeft === 0) {
          this.finishMatch();
          return;
        }
      }
    }
  
    this.moveComputerPaddles(delta);
    this.stepBall(delta);
  
    // بث الحالة بعد كل التحديثات
    this.broadcastGameState();
  }
  
  // دالة مساعدة لبث game-state
  private broadcastGameState() {
    this.broadcast('game-state', {
      ball: {
        x: this.state.ball.x,
        y: this.state.ball.y,
        vx: this.state.ball.vx,
        vy: this.state.ball.vy,
        visible: this.state.ball.visible,
      },
      paddles: Object.fromEntries(
        Array.from(this.state.paddles.entries()).map(([side, paddle]) => [
          side,
          { x: paddle.x, y: paddle.y }
        ])
      ),
      countdown: this.state.countdown,
      rally: this.state.rally,
      scores: Object.fromEntries(this.state.scores.entries()),
      timeLeft: this.state.timeLeft,
    });
  }

  private moveComputerPaddles(delta: number) {
    const w = this.state.worldW, h = this.state.worldH;
    const predX = this.state.ball.x + this.state.ball.vx * 12;
    const predY = this.state.ball.y + this.state.ball.vy * 12;
    const diffMax = this.settings.difficulty === 'easy' ? 0.85 : this.settings.difficulty === 'hard' ? 2.15 : 1.45;
    const chase = (cur: number, target: number) => {
      const diff = target - cur;
      if (Math.abs(diff) < 4) return cur;
      const step = Math.max(-diffMax, Math.min(diffMax, diff * 0.15)) * 6 * delta;
      return cur + step;
    };
    for (const side of this.activeSides) {
      const player = [...this.state.players.values()].find((p) => p.side === side);
      const isComputer = !player || player.computer;
      if (!isComputer) continue;
      const paddle = this.state.paddles.get(side)!;
      if (side === 'top' || side === 'bottom') {
        const c = this.clampPaddle(side, chase(paddle.x, predX), paddle.y);
        paddle.x = c.x;
      } else {
        const c = this.clampPaddle(side, paddle.x, chase(paddle.y, predY));
        paddle.y = c.y;
      }
    }
  }

  private stepBall(delta: number) {
    const ball = this.state.ball;
    const w = this.state.worldW, h = this.state.worldH;
    ball.x += ball.vx * delta;
    ball.y += ball.vy * delta;
    const r = 14;
    const paddleRadius = 26;
    const hitDist = r + paddleRadius;

    for (const side of this.activeSides) {
      const paddle = this.state.paddles.get(side)!;
      const dx = ball.x - paddle.x, dy = ball.y - paddle.y;
      const dist = Math.hypot(dx, dy);
      const approaching =
        (side === 'bottom' && ball.vy > 0 && ball.y > paddle.y - 20) ||
        (side === 'top' && ball.vy < 0 && ball.y < paddle.y + 20) ||
        (side === 'left' && ball.vx < 0 && ball.x > paddle.x - 20) ||
        (side === 'right' && ball.vx > 0 && ball.x < paddle.x + 20);
      if (dist < hitDist && approaching) {
        const nx = dist > 0.5 ? dx / dist : 0;
        const ny = dist > 0.5 ? dy / dist : (side === 'bottom' ? -1 : side === 'top' ? 1 : 0);
        ball.x = paddle.x + nx * (hitDist + 1);
        ball.y = paddle.y + ny * (hitDist + 1);
        const baseSpeed = 8 + Number(this.settings.ballSpeed || 10) * 0.7 + this.state.rally * 0.5;
        if (side === 'bottom') { ball.vy = -Math.abs(baseSpeed); ball.vx += nx * 3; }
        else if (side === 'top') { ball.vy = Math.abs(baseSpeed); ball.vx += nx * 3; }
        else if (side === 'left') { ball.vx = Math.abs(baseSpeed); ball.vy += ny * 3; }
        else { ball.vx = -Math.abs(baseSpeed); ball.vy += ny * 3; }
        this.state.rally += 1;
        this.broadcast('hit-effect', { x: ball.x, y: ball.y, side, power: Math.min(1, this.state.rally / 12) });
      }
    }

    const maxSpeed = 30 + Number(this.settings.ballSpeed || 10) * 1.4 + this.state.rally * 0.6;
    const curSpeed = Math.hypot(ball.vx, ball.vy);
    if (curSpeed > maxSpeed) { const s = maxSpeed / curSpeed; ball.vx *= s; ball.vy *= s; }

    const goalW = w >= 900 ? 300 : 260;
    const gx1 = (w - goalW) / 2, gx2 = gx1 + goalW;
    const gy1 = (h - goalW) / 2, gy2 = gy1 + goalW;
    const inGX = (x: number) => x >= gx1 && x <= gx2;
    const inGY = (y: number) => y >= gy1 && y <= gy2;
    let missedSide: PlayerSide | null = null;

    if (ball.y - r <= 0) {
      if (this.activeSides.includes('top')) { if (inGX(ball.x)) missedSide = 'top'; else { ball.y = r + 1; ball.vy = Math.abs(ball.vy); } }
      else { ball.y = r + 1; ball.vy = Math.abs(ball.vy); }
    }
    if (!missedSide && ball.y + r >= h) {
      if (this.activeSides.includes('bottom')) { if (inGX(ball.x)) missedSide = 'bottom'; else { ball.y = h - r - 1; ball.vy = -Math.abs(ball.vy); } }
      else { ball.y = h - r - 1; ball.vy = -Math.abs(ball.vy); }
    }
    if (!missedSide && ball.x - r <= 0) {
      if (this.activeSides.includes('left')) { if (inGY(ball.y)) missedSide = 'left'; else { ball.x = r + 1; ball.vx = Math.abs(ball.vx); } }
      else { ball.x = r + 1; ball.vx = Math.abs(ball.vx); }
    }
    if (!missedSide && ball.x + r >= w) {
      if (this.activeSides.includes('right')) { if (inGY(ball.y)) missedSide = 'right'; else { ball.x = w - r - 1; ball.vx = -Math.abs(ball.vx); } }
      else { ball.x = w - r - 1; ball.vx = -Math.abs(ball.vx); }
    }

    if (missedSide) this.onGoal(missedSide);
  }

  private onGoal(missedSide: PlayerSide) {
    const scorerSide = OPPOSITE[missedSide];
    const scorer = [...this.state.players.values()].find((p) => p.side === scorerSide);
    if (scorer) {
      const newScore = (this.state.scores.get(scorer.id) ?? 0) + 1;
      this.state.scores.set(scorer.id, newScore);
      this.broadcast('goal-scored', { missedSide, scores: Object.fromEntries(this.state.scores.entries()) });
      if (this.settings.mode === 'goals' && newScore >= Number(this.settings.goal || 7)) {
        this.finishMatch(scorer.id);
        return;
      }
    }
    this.startCountdown(scorerSide);
  }

  private finishMatch(winnerId?: string) {
    let finalWinnerId = winnerId;
    if (!finalWinnerId) {
      const sorted = [...this.state.scores.entries()].sort((a, b) => b[1] - a[1]);
      finalWinnerId = sorted[0]?.[0];
    }
    this.broadcast('match-finished', { winnerId: finalWinnerId, scores: Object.fromEntries(this.state.scores.entries()) });
    this.state.status = 'waiting';
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