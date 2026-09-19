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
  computerPlayers?: Array<{ name?: string; color?: string; side?: PlayerSide }>;
};

const roomsByCode = new Map<string, QoudRoom>();
const SIDES: PlayerSide[] = ['bottom', 'top', 'right', 'left'];
const OPPOSITE: Record<PlayerSide, PlayerSide> = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };
const COLORS = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];

const ARENA_SCALES: Record<string, number> = { small: 0.8, medium: 1.0, large: 1.25, xlarge: 1.5 };
const RECT = { w: 700, h: 1050 };
const SQUARE = { w: 1000, h: 1000 };

function getArenaWorld(count: number, size: string = 'medium') {
  const base = count >= 3? SQUARE : RECT;
  const sc = ARENA_SCALES[size] || 1;
  return { w: base.w * sc, h: base.h * sc };
}

// --- تعديل وحيد: 6 أرقام فقط بدون حروف - لدعم الجوال ---
const CODE_ALPHABET = '0123456789';
function generateUniqueCode(len = 6): string {
  let code: string;
  do {
    code = Array.from({ length: len }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (roomsByCode.has(code));
  return code;
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
  private broadcastAccum = 0;

  // Physics
  private paddleTargets = new Map<PlayerSide, { x: number; y: number }>();
  private paddlePrev = new Map<PlayerSide, { x: number; y: number }>();
  private paddleVel = new Map<PlayerSide, { vx: number; vy: number }>();
  private lastHitSide: PlayerSide | null = null;
  private lastHitTime = 0;

  // Series
  private currentRound = 1;
  private totalRounds = 3;
  private seriesType: 'single' | 'series' = 'single';
  private seriesWinsMap = new Map<string, number>();
  private roundHistory: Array<{ round: number; scores: Record<string, number>; winnerId: string | null; isDraw: boolean }> = [];

  // --- إضافة لحل مشكلة التعليق ---
  private readyPlayers = new Set<string>();

  onCreate(options: CreateOptions) {
    // --- تعديل وحيد: فلتر أرقام فقط ---
    let rawCode = String(options.code?? '').replace(/\D/g, '').slice(0, 6);
    let code: string;
    if (!rawCode || rawCode.length < 6 || roomsByCode.has(rawCode)) {
      code = generateUniqueCode(6);
    } else {
      code = rawCode;
      if (roomsByCode.has(code)) {
        code = generateUniqueCode(6);
      }
    }

    const maxPlayers = Math.max(2, Math.min(4, Number(options.maxPlayers) || 2));
    this.settings = {
      mode: 'time', duration: 180, goal: 7, ballSpeed: 10, difficulty: 'normal',
      arenaSize: 'medium', start: 'center', seriesType: 'single', seriesRounds: 3,
     ...options.settings
    };
    this.maxClients = maxPlayers;
    this.seriesType = this.settings.seriesType === 'series'? 'series' : 'single';
    this.totalRounds = Math.max(2, Math.min(10, Number(this.settings.seriesRounds) || 3));
    this.currentRound = 1;
    this.seriesWinsMap.clear();
    this.roundHistory = [];

    const state = new QoudRoomState();
    state.code = code;
    state.status = 'waiting';
    state.maxPlayers = maxPlayers;
    state.hostSessionId = '';
    state.settingsJson = JSON.stringify(this.settings);
    state.ball = new BallState();

    try {
      (state as any).currentRound = 1;
      (state as any).totalRounds = this.totalRounds;
      (state as any).seriesType = this.seriesType;
    } catch {}

    this.setState(state);
    this.setMetadata({ code });
    roomsByCode.set(code, this);

    this.initWorldAndPaddles();

    if (options.computerPlayers?.length) {
      options.computerPlayers.forEach((bot, i) => {
        const ps = new PlayerState();
        ps.id = `bot-${i}`;
        ps.name = bot.name || `بوت ${i + 1}`;
        ps.color = bot.color || COLORS[this.state.players.size % COLORS.length];
        ps.side = (bot.side as PlayerSide) || this.nextSide();
        ps.computer = true;
        this.state.players.set(ps.id, ps);
        this.state.scores.set(ps.id, 0);
      });
    }

    this.onMessage('*', (client, type, payload) => this.handleMessage(type, client, payload));

    // ✅ Fly.io Optimized: 60Hz broadcast, 120Hz simulation
    this.setPatchRate(1000 / 60);
    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), 1000 / 120);
  }

  private initWorldAndPaddles() {
    const needed = Math.max(2, this.state.players.size || this.state.maxPlayers, this.state.maxPlayers);
    this.activeSides = needed >= 3? ['bottom', 'top', 'right', 'left'] : ['bottom', 'top'];
    const world = getArenaWorld(needed, this.settings.arenaSize);
    this.state.worldW = world.w;
    this.state.worldH = world.h;
    try {
      (this.state as any).currentRound = this.currentRound;
      (this.state as any).totalRounds = this.totalRounds;
    } catch {}
    this.state.paddles.clear();
    this.paddlePrev.clear();
    this.paddleVel.clear();
    this.paddleTargets.clear();
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
      this.paddlePrev.set(side, { x: p.x, y: p.y });
      this.paddleVel.set(side, { vx: 0, vy: 0 });
      this.paddleTargets.set(side, { x: p.x, y: p.y });
    });
    this.state.ball.x = world.w / 2;
    this.state.ball.y = world.h / 2;
    this.state.ball.vx = 0;
    this.state.ball.vy = 0;
    this.state.ball.visible = false;
    this.state.timeLeft = this.settings.mode === 'time'? Number(this.settings.duration || 180) : 0;
    this.lastHitSide = null;
  }

  onJoin(client: { sessionId: string }, options: { name?: string; player?: Partial<PlayerState> } = {}) {
    if (this.state.status!== 'waiting') throw new Error('الجولة بدأت بالفعل');
    let name = String(options.name?? options.player?.name?? '').trim();
    if (name.length < 2) name = `لاعب ${this.state.players.size + 1}`;
    const existingNames = [...this.state.players.values()].map((p) => p.name.toLowerCase());
    if (existingNames.includes(name.toLowerCase())) {
      let i = 2;
      while (existingNames.includes(`${name} ${i}`.toLowerCase())) i++;
      name = `${name} ${i}`;
    }
    const side = (options.player?.side as PlayerSide)?? this.nextSide();
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = name;
    player.color = String(options.player?.color?? COLORS[this.humanCount() % COLORS.length]);
    player.side = side;
    player.computer = false;
    this.state.players.set(client.sessionId, player);
    this.state.scores.set(client.sessionId, 0);
    if (!this.seriesWinsMap.has(client.sessionId)) {
      try { (this.state as any).seriesWins?.set(client.sessionId, 0); } catch {}
    }
    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;
    this.broadcastRoom();
  }

  onLeave(client: { sessionId: string }) {
    this.readyPlayers.delete(client.sessionId);
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
    this.readyPlayers.clear();
    if (roomsByCode.get(this.state.code) === this) roomsByCode.delete(this.state.code);
  }

  private handleMessage(type: string, client: { sessionId: string }, payload: any) {
    if (type === 'player-ready') {
      this.readyPlayers.add(client.sessionId);
      this.broadcast('player-ready', { playerId: client.sessionId, count: this.readyPlayers.size, total: this.humanCount() });
      if (this.state.status === 'playing' && this.readyPlayers.size >= this.humanCount()) {
        this.broadcast('all-players-ready', { count: this.readyPlayers.size });
      }
      return;
    }
    if (type === 'all-players-ready') {
      if (client.sessionId === this.state.hostSessionId) {
        this.broadcast('all-players-ready', { count: this.readyPlayers.size });
        this.broadcast('game-started', { settings: this.state.settingsJson });
      }
      return;
    }

    if (type === 'update-name') {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.status!== 'waiting') return;
      let newName = String(payload?.name?? '').trim().slice(0, 15);
      if (newName.length < 2) return;
      const others = [...this.state.players.values()].filter((p) => p.id!== client.sessionId).map((p) => p.name.toLowerCase());
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
      this.readyPlayers.clear();
      this.currentRound = 1;
      this.seriesWinsMap.clear();
      this.roundHistory = [];
      try {
        (this.state as any).currentRound = 1;
        (this.state as any).seriesWins?.clear();
      } catch {}
      for (const p of this.state.players.values()) {
        this.state.scores.set(p.id, 0);
        this.seriesWinsMap.set(p.id, 0);
        try { (this.state as any).seriesWins?.set(p.id, 0); } catch {}
      }
      this.initWorldAndPaddles();
      this.state.status = 'playing';
      this.startCountdown(null);
      this.broadcastGameState();
      this.broadcast('game-started', { settings: this.state.settingsJson });
      this.broadcast('series-started', { totalRounds: this.totalRounds, seriesType: this.seriesType, currentRound: this.currentRound });
      return;
    }

    if (type === 'paddle-target') {
      if (this.state.status!== 'playing') return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const side = player.side as PlayerSide;
      const x = Number(payload?.x);
      const y = Number(payload?.y?? payload?.z);
      if (!Number.isFinite(x) ||!Number.isFinite(y)) return;
      const clamped = this.clampPaddle(side, x, y);
      this.paddleTargets.set(side, clamped);
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
    return { x: Math.max(w * 0.62, Math.min(w - 45, x)), y: Math.max(45, Math.min(h - 45, y)) };
  }

  private humanCount() {
    return [...this.state.players.values()].filter((p) =>!p.computer).length;
  }

  private nextSide(): PlayerSide {
    const occupied = new Set([...this.state.players.values()].map((p) => p.side));
    return SIDES.find((s) =>!occupied.has(s))?? 'bottom';
  }

  private assertHost(client: { sessionId: string }) {
    if (this.state.hostSessionId!== client.sessionId) throw new Error('المنشئ فقط يستطيع تنفيذ هذا الإجراء');
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
      series: {
        currentRound: this.currentRound,
        totalRounds: this.totalRounds,
        seriesType: this.seriesType,
        seriesWins: Object.fromEntries(this.seriesWinsMap.entries()),
        roundHistory: this.roundHistory,
      }
    });
  }

  private startCountdown(scorerSide: PlayerSide | null) {
    this.state.countdown = 3;
    this.state.countdownSide = scorerSide?? '';
    this.countdownStartedAt = Date.now();
    this.state.rally = 0;
    this.state.ball.vx = 0;
    this.state.ball.vy = 0;
    this.state.ball.x = this.state.worldW / 2;
    this.state.ball.y = this.state.worldH / 2;
    this.state.ball.visible = false;
    this.servingActive = false;
    this.lastHitSide = null;
    this.broadcastGameState();
  }

  private launchBall(fromServe = false, side: PlayerSide = 'bottom') {
    const speed = 3.5 + Number(this.settings.ballSpeed || 10) * 0.15;
    if (fromServe) {
      const ang = (Math.random() - 0.5) * 0.8;
      const paddle = this.state.paddles.get(side)!;
      this.state.ball.x = paddle.x;
      this.state.ball.y = paddle.y;
      if (side === 'bottom') { this.state.ball.vx = Math.sin(ang) * speed; this.state.ball.vy = -Math.abs(Math.cos(ang) * speed); }
      else if (side === 'top') { this.state.ball.vx = Math.sin(ang) * speed; this.state.ball.vy = Math.abs(Math.cos(ang) * speed); }
      else if (side === 'left') { this.state.ball.vx = Math.abs(Math.cos(ang) * speed); this.state.ball.vy = Math.sin(ang) * speed; }
      else { this.state.ball.vx = -Math.abs(Math.cos(ang) * speed); this.state.ball.vy = Math.sin(ang) * speed; }
    } else {
      const dirY = Math.random() > 0.5? 1 : -1;
      const ang = (Math.random() - 0.5) * 0.8;
      this.state.ball.vx = Math.sin(ang) * speed;
      this.state.ball.vy = Math.cos(ang) * speed * dirY;
    }
    this.state.ball.visible = true;
  }

  private tick(deltaMs: number) {
    if (this.state.status!== 'playing') return;
    const delta = Math.min(deltaMs / 16.67, 2);

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
      } else {
        this.state.countdown = Math.max(1, Math.ceil(3 - elapsed));
        this.broadcastGameState();
        return;
      }
    }

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

    if (this.settings.mode === 'time') {
      this.elapsedAccum += deltaMs / 1000;
      if (this.elapsedAccum >= 1) {
        this.elapsedAccum = 0;
        this.state.timeLeft = Math.max(0, this.state.timeLeft - 1);
        if (this.state.timeLeft === 0) {
          this.onTimeUpRound();
          return;
        }
      }
    }

    const dtSec = Math.min(deltaMs, 50) / 1000;
    for (const side of this.activeSides) {
      const paddle = this.state.paddles.get(side)!;
      const target = this.paddleTargets.get(side);
      if (!target) continue;
      const player = [...this.state.players.values()].find(p => p.side === side);
      if (player?.computer) continue;
      const prev = this.paddlePrev.get(side) || { x: paddle.x, y: paddle.y };
      paddle.x += (target.x - paddle.x) * Math.min(1, dtSec * 14);
      paddle.y += (target.y - paddle.y) * Math.min(1, dtSec * 14);
      const vx = (paddle.x - prev.x) / dtSec;
      const vy = (paddle.y - prev.y) / dtSec;
      this.paddleVel.set(side, { vx: vx * 0.5, vy: vy * 0.5 });
      this.paddlePrev.set(side, { x: paddle.x, y: paddle.y });
    }
    for (const side of this.activeSides) {
      const paddle = this.state.paddles.get(side);
      if (!paddle) continue;
      const player = [...this.state.players.values()].find(p => p.side === side);
      if (!player?.computer) continue;
      const prev = this.paddlePrev.get(side);
      if (prev) {
        this.paddleVel.set(side, { vx: (paddle.x - prev.x) / dtSec * 0.5, vy: (paddle.y - prev.y) / dtSec * 0.5 });
      }
      this.paddlePrev.set(side, { x: paddle.x, y: paddle.y });
    }

    this.moveComputerPaddles(delta);
    this.stepBallImproved(delta);

    this.broadcastAccum += deltaMs;
    if (this.broadcastAccum >= 16) {
      this.broadcastAccum = 0;
      this.broadcastGameState();
    }
  }

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
          { x: paddle.x, y: paddle.y, vx: this.paddleVel.get(side as PlayerSide)?.vx || 0, vy: this.paddleVel.get(side as PlayerSide)?.vy || 0 }
        ])
      ),
      countdown: this.state.countdown,
      countdownSide: this.state.countdownSide,
      rally: this.state.rally,
      scores: Object.fromEntries(this.state.scores.entries()),
      timeLeft: this.state.timeLeft,
      series: {
        currentRound: this.currentRound,
        totalRounds: this.totalRounds,
        seriesType: this.seriesType,
        seriesWins: Object.fromEntries(this.seriesWinsMap.entries()),
        roundHistory: this.roundHistory,
      }
    });
  }

  private moveComputerPaddles(delta: number) {
    const w = this.state.worldW;
    const h = this.state.worldH;
    const predX = this.state.ball.x + this.state.ball.vx * 14;
    const predY = this.state.ball.y + this.state.ball.vy * 14;
    const diffMax = this.settings.difficulty === 'easy'? 0.85 : this.settings.difficulty === 'hard'? 2.4 : 1.6;
    const chase = (cur: number, target: number) => {
      const diff = target - cur;
      if (Math.abs(diff) < 2) return cur;
      const step = Math.max(-diffMax, Math.min(diffMax, diff * 0.18)) * 6 * delta;
      return cur + step;
    };
    for (const side of this.activeSides) {
      const player = [...this.state.players.values()].find((p) => p.side === side);
      const isComputer =!player || player.computer;
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

  private stepBallImproved(delta: number) {
    const ball = this.state.ball;
    const w = this.state.worldW, h = this.state.worldH;
    const BALL_R = 14;
    const PADDLE_R = 26;
    const HIT_DIST = BALL_R + PADDLE_R;

    const totalVx = ball.vx * delta;
    const totalVy = ball.vy * delta;
    const dist = Math.hypot(totalVx, totalVy);
    const maxStep = 4;
    const steps = Math.max(1, Math.ceil(dist / maxStep));
    const stepVx = totalVx / steps;
    const stepVy = totalVy / steps;

    let missedSide: PlayerSide | null = null;

    for (let i = 0; i < steps &&!missedSide; i++) {
      const prevX = ball.x;
      const prevY = ball.y;
      ball.x += stepVx;
      ball.y += stepVy;

      let bestHit: { side: PlayerSide; t: number; nx: number; ny: number; dist: number } | null = null;

      for (const side of this.activeSides) {
        if (this.lastHitSide === side && Date.now() - this.lastHitTime < 80) continue;

        const paddle = this.state.paddles.get(side)!;
        const px = paddle.x;
        const py = paddle.y;

        const segX = ball.x - prevX;
        const segY = ball.y - prevY;
        const segLenSq = segX * segX + segY * segY;

        let t = 0;
        let closestX = prevX;
        let closestY = prevY;
        if (segLenSq > 0.0001) {
          t = ((px - prevX) * segX + (py - prevY) * segY) / segLenSq;
          t = Math.max(0, Math.min(1, t));
          closestX = prevX + segX * t;
          closestY = prevY + segY * t;
        }

        const dx = closestX - px;
        const dy = closestY - py;
        const d = Math.hypot(dx, dy);

        if (d < HIT_DIST) {
          if (!bestHit || t < bestHit.t) {
            bestHit = {
              side,
              t,
              nx: d > 0.001? dx / d : 0,
              ny: d > 0.001? dy / d : (side === 'bottom'? -1 : side === 'top'? 1 : 0),
              dist: d,
            };
          }
        }
      }

      if (bestHit) {
        const side = bestHit.side;
        const paddle = this.state.paddles.get(side)!;
        const pVel = this.paddleVel.get(side) || { vx: 0, vy: 0 };

        ball.x = paddle.x + bestHit.nx * (HIT_DIST + 1.5);
        ball.y = paddle.y + bestHit.ny * (HIT_DIST + 1.5);

        const currentSpeed = Math.hypot(ball.vx, ball.vy);
        const minHitSpeed = 3.5 + Number(this.settings.ballSpeed || 10) * 0.15;
        const startSpd = Math.max(currentSpeed, minHitSpeed);

        const paddleSpeed = Math.hypot(pVel.vx, pVel.vy);

        let relVx = ball.vx - pVel.vx;
        let relVy = ball.vy - pVel.vy;
        const dot = relVx * bestHit.nx + relVy * bestHit.ny;
        if (dot < 0) {
          relVx -= 2 * dot * bestHit.nx;
          relVy -= 2 * dot * bestHit.ny;
        }

        const speedIncrement = Math.min(1.5, 0.5 + Math.min(paddleSpeed, 15) * 0.05);
        let targetSpeed = startSpd + speedIncrement;

        const maxAllowedSpeed = 16 + Number(this.settings.ballSpeed || 10) * 0.5;
        targetSpeed = Math.min(targetSpeed, maxAllowedSpeed);

        let dirVx = bestHit.nx * 0.75 + pVel.vx * 0.25;
        let dirVy = bestHit.ny * 0.75 + pVel.vy * 0.25;

        const normalDot = dirVx * bestHit.nx + dirVy * bestHit.ny;
        if (normalDot < 0.1) {
          dirVx = bestHit.nx * 0.9 + pVel.vx * 0.1;
          dirVy = bestHit.ny * 0.9 + pVel.vy * 0.1;
        }

        const dirMag = Math.hypot(dirVx, dirVy);
        if (dirMag > 0) {
          ball.vx = (dirVx / dirMag) * targetSpeed;
          ball.vy = (dirVy / dirMag) * targetSpeed;
        }

        this.state.rally += 1;
        this.lastHitSide = side;
        this.lastHitTime = Date.now();
        this.broadcast('hit-effect', { x: ball.x, y: ball.y, side, power: Math.min(1, this.state.rally / 12), paddleVx: pVel.vx, paddleVy: pVel.vy });
      }

      const goalW = w >= 900? 300 : 260;
      const gx1 = (w - goalW) / 2, gx2 = gx1 + goalW;
      const gy1 = (h - goalW) / 2, gy2 = gy1 + goalW;
      const inGX = (x: number) => x >= gx1 && x <= gx2;
      const inGY = (y: number) => y >= gy1 && y <= gy2;

      if (ball.y - BALL_R <= 0) {
        if (this.activeSides.includes('top')) {
          if (inGX(ball.x)) missedSide = 'top';
          else { ball.y = BALL_R + 1; ball.vy = Math.abs(ball.vy); }
        } else { ball.y = BALL_R + 1; ball.vy = Math.abs(ball.vy); }
      }
      if (!missedSide && ball.y + BALL_R >= h) {
        if (this.activeSides.includes('bottom')) {
          if (inGX(ball.x)) missedSide = 'bottom';
          else { ball.y = h - BALL_R - 1; ball.vy = -Math.abs(ball.vy); }
        } else { ball.y = h - BALL_R - 1; ball.vy = -Math.abs(ball.vy); }
      }
      if (!missedSide && ball.x - BALL_R <= 0) {
        if (this.activeSides.includes('left')) {
          if (inGY(ball.y)) missedSide = 'left';
          else { ball.x = BALL_R + 1; ball.vx = Math.abs(ball.vx); }
        } else { ball.x = BALL_R + 1; ball.vx = Math.abs(ball.vx); }
      }
      if (!missedSide && ball.x + BALL_R >= w) {
        if (this.activeSides.includes('right')) {
          if (inGY(ball.y)) missedSide = 'right';
          else { ball.x = w - BALL_R - 1; ball.vx = -Math.abs(ball.vx); }
        } else { ball.x = w - BALL_R - 1; ball.vx = -Math.abs(ball.vx); }
      }

      if (missedSide) {
        this.onGoal(missedSide);
        break;
      }
    }
  }

  private onGoal(missedSide: PlayerSide) {
    const scorerSide = OPPOSITE[missedSide];
    const scorer = [...this.state.players.values()].find((p) => p.side === scorerSide);
    if (scorer) {
      const newScore = (this.state.scores.get(scorer.id)?? 0) + 1;
      this.state.scores.set(scorer.id, newScore);
      this.broadcast('goal-scored', {
        missedSide,
        scorerSide,
        scorerId: scorer.id,
        scores: Object.fromEntries(this.state.scores.entries()),
        series: {
          currentRound: this.currentRound,
          totalRounds: this.totalRounds,
          seriesWins: Object.fromEntries(this.seriesWinsMap.entries()),
        }
      });

      if (this.settings.mode === 'goals' && newScore >= Number(this.settings.goal || 7)) {
        this.finishRound(scorer.id, false);
        return;
      }
    }
    this.startCountdown(scorerSide);
    this.broadcastGameState();
  }

  private onTimeUpRound() {
    const sorted = [...this.state.scores.entries()].sort((a, b) => b[1] - a[1]);
    const maxScore = sorted[0]?.[1]?? 0;
    const topPlayers = sorted.filter(([_, s]) => s === maxScore);
    if (topPlayers.length === 1) {
      this.finishRound(topPlayers[0][0], false);
    } else {
      this.finishRound(null, true);
    }
  }

  private finishRound(winnerId: string | null, isDraw: boolean) {
    const roundScores = Object.fromEntries(this.state.scores.entries());
    const record = { round: this.currentRound, scores: roundScores, winnerId: winnerId, isDraw };
    this.roundHistory.push(record);

    if (!isDraw && winnerId) {
      const cur = this.seriesWinsMap.get(winnerId)?? 0;
      this.seriesWinsMap.set(winnerId, cur + 1);
      try { (this.state as any).seriesWins?.set(winnerId, cur + 1); } catch {}
    }

    this.broadcast('round-finished', {
      round: this.currentRound,
      scores: roundScores,
      winnerId,
      isDraw,
      seriesWins: Object.fromEntries(this.seriesWinsMap.entries()),
      roundHistory: this.roundHistory,
      totalRounds: this.totalRounds,
      currentRound: this.currentRound,
    });

    if (this.seriesType === 'series') {
      if (this.currentRound >= this.totalRounds) {
        this.finishMatchSeries();
      } else {
        this.currentRound++;
        try { (this.state as any).currentRound = this.currentRound; } catch {}
        for (const id of this.state.players.keys()) {
          this.state.scores.set(id, 0);
        }
        this.initWorldAndPaddles();
        this.startCountdown(null);
        this.broadcast('next-round', {
          currentRound: this.currentRound,
          totalRounds: this.totalRounds,
          seriesWins: Object.fromEntries(this.seriesWinsMap.entries()),
          roundHistory: this.roundHistory,
        });
      }
    } else {
      this.finishMatch(winnerId || undefined);
    }
  }

  private finishMatchSeries() {
    const entries = [...this.seriesWinsMap.entries()].sort((a, b) => b[1] - a[1]);
    const maxWins = entries[0]?.[1]?? 0;
    const top = entries.filter(([_, w]) => w === maxWins);
    let finalWinnerId: string | null = null;
    let isOverallDraw = false;
    if (top.length === 1) finalWinnerId = top[0][0];
    else if (top.length > 1) isOverallDraw = true;

    this.broadcast('match-finished', {
      winnerId: finalWinnerId,
      isDraw: isOverallDraw,
      scores: Object.fromEntries(this.state.scores.entries()),
      seriesWins: Object.fromEntries(this.seriesWinsMap.entries()),
      roundHistory: this.roundHistory,
      totalRounds: this.totalRounds,
      seriesType: 'series',
    });
    this.state.status = 'waiting';
    this.readyPlayers.clear();
  }

  private finishMatch(winnerId?: string) {
    let finalWinnerId = winnerId;
    if (!finalWinnerId) {
      const sorted = [...this.state.scores.entries()].sort((a, b) => b[1] - a[1]);
      finalWinnerId = sorted[0]?.[0];
    }
    this.broadcast('match-finished', {
      winnerId: finalWinnerId,
      scores: Object.fromEntries(this.state.scores.entries()),
      seriesWins: Object.fromEntries(this.seriesWinsMap.entries()),
      roundHistory: this.roundHistory,
      seriesType: this.seriesType,
    });
    this.state.status = 'waiting';
    this.readyPlayers.clear();
  }
}

const port = Number(process.env.PORT?? 2567);
const isProduction = process.env.NODE_ENV === 'production';
const httpServer = createServer();
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
  express: async (app) => {
    app.get('/api/rooms', (req, res) => {
      const code = String(req.query.code?? '').replace(/\D/g, '').slice(0, 6);
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
console.log(`[colyseus] Qoud server listening on port ${port} - 6 digits only`);