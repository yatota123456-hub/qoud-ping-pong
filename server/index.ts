import { createServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { Room, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import {
  PlayerState,
  BallState,
  PaddleState,
  QoudRoomState,
  type PlayerSide,
  getArenaWorld,
  clampPaddlePosition,
  BALL_RADIUS,
  PADDLE_RADIUS,
  BORDER_THICKNESS,
  type ArenaSize,
} from '../src/shared/roomSchema';

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

  // ===== Fixed Timestep Constants =====
  private readonly SIMULATION_RATE = 120; // 120Hz - ثابت  // Hz - معدل المحاكاة
  private readonly BASE_MS = 1000 / this.SIMULATION_RATE;  // 8.33ms
  private readonly FIXED_DELTA = 1 / this.SIMULATION_RATE;  // 1/120

  // === FIXED PHYSICS FOR NO LAG ===
  private readonly BALL_SPEED_BOOST = 1.0; // FIXED: was 1.6 - causes wall penetration // الكرة اسرع 60%
  private readonly FRICTION = 0.998; // balanced // كان 0.998 - احتكاك اقل

  // Physics
  private paddleTargets = new Map<PlayerSide, { x: number; y: number }>();
  private paddlePrev = new Map<PlayerSide, { x: number; y: number }>();
  private paddleVel = new Map<PlayerSide, { vx: number; vy: number }>();
  private lastHitSide: PlayerSide | null = null;
  private lastServeSide: PlayerSide | null = null;
  private lastHitTime = 0;

  // Series
  private currentRound = 1;
  private totalRounds = 3;
  private seriesType: 'single' | 'series' = 'single';
  private seriesWinsMap = new Map<string, number>();
  private roundHistory: Array<{ round: number; scores: Record<string, number>; winnerId: string | null; isDraw: boolean }> = [];

  // --- إضافة لحل مشكلة التعليق ---
  private readyPlayers = new Set<string>();
  private isPaused = false;
  private pausedAt = 0;
  private lastGoalAt = 0; // حماية من تسجيل الهدف مرتين
  private lastBallPos = { x: 0, y: 0, time: 0 };
  private stuckCheckAccum = 0;

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
      mode: 'time', duration: 180, goal: 7, ballSpeed: 9, // FIXED: was 10 - faster default difficulty: 'normal',
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
        ps.name = bot.name || `كمبيوتر ${i + 1}`;
        ps.color = bot.color || COLORS[this.state.players.size % COLORS.length];
        ps.side = (bot.side as PlayerSide) || this.nextSide();
        ps.computer = true;
        this.state.players.set(ps.id, ps);
        this.state.scores.set(ps.id, 0);
      });
    }

    this.onMessage('*', (client, type, payload) => this.handleMessage(type, client, payload));

    // ✅ Fly.io Optimized: 60Hz broadcast, 120Hz simulation
    this.setPatchRate(1000 / 30); // FIXED: was 60Hz - now 30Hz less bandwidth, client predicts rest via rollback
    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), 1000 / 120); // 120Hz sim kept
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
    this.isPaused = false;
    this.pausedAt = 0;
    this.lastBallPos = { x: world.w/2, y: world.h/2, time: Date.now() };
    this.stuckCheckAccum = 0;
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

  // ضبط الإيقاف المؤقت على الخادم مع تعويض الوقت الضائع
  private setPaused(paused: boolean) {
    if (paused && this.state.status !== 'playing') return;
    if (paused && !this.isPaused) {
      this.pausedAt = Date.now();
    }
    if (!paused && this.isPaused && this.pausedAt) {
      const d = Date.now() - this.pausedAt;
      this.countdownStartedAt += d;
      this.servingStartedAt += d;
      this.lastBallPos.time += d;
      this.pausedAt = 0;
    }
    this.isPaused = paused;
    // إرسال لكل العملاء بكل الأسماء المحتملة لضمان التوافق
    this.broadcast('pause-update', { paused });
    this.broadcast('game-paused', { paused });
    this.broadcast('pause-state', { paused });
    this.broadcastRoom();
  }

  private handleMessage(type: string, client: { sessionId: string }, payload: any) {
    // إصلاح مشكلة التعليق في انتظار الأصدقاء
    if (type === 'player-ready') {
      this.readyPlayers.add(client.sessionId);
      this.broadcast('player-ready', { playerId: client.sessionId, count: this.readyPlayers.size, total: this.humanCount() });
      if (this.state.status === 'playing' && this.readyPlayers.size >= this.humanCount()) {
        this.broadcast('all-players-ready', { count: this.readyPlayers.size });
      }
      return;
    }
    if (type === 'all-players-ready') {
      // أي لاعب يمكنه إرسال أنه جاهز، لكن المضيف يبث البدء
      this.readyPlayers.add(client.sessionId);
      if (this.readyPlayers.size >= this.humanCount() || client.sessionId === this.state.hostSessionId) {
        this.broadcast('all-players-ready', { count: this.readyPlayers.size });
        this.broadcast('game-started', { settings: this.state.settingsJson });
      }
      return;
    }

    // إيقاف مؤقت للكل - الخادم هو المرجع حتى لا تستمر الكرة وتسجل أهداف أثناء الإيقاف
    if (type === 'pause-toggle' || type === 'pause-state' || type === 'game-paused' || type === 'pause-update') {
      const paused = typeof payload === 'boolean' ? payload : Boolean(payload?.paused);
      this.setPaused(paused);
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
      this.lastGoalAt = 0;
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
      if (this.state.status !== 'playing') return;
      if (this.isPaused) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const side = player.side as PlayerSide;
      const x = Number(payload?.x);
      const y = Number(payload?.y ?? payload?.z);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const clamped = this.clampPaddle(side, x, y);
      this.paddleTargets.set(side, clamped);

      const vx = Number(payload?.vx);
      const vy = Number(payload?.vy);
      if (Number.isFinite(vx) && Number.isFinite(vy)) {
        this.paddleVel.set(side, {
          vx: Math.max(-2500, Math.min(2500, vx)),
          vy: Math.max(-2500, Math.min(2500, vy)),
        });
      }
      // ملاحظة: لم يعد تحريك المضرب يطلق الكرة تلقائياً، الإطلاق عبر 'request-serve' (أو مهلة أمان في tick)
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
    const isMultiplayer4 = this.activeSides.length >= 3;
    return clampPaddlePosition(side, x, y, this.state.worldW, this.state.worldH, isMultiplayer4);
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
      },
      isPaused: this.isPaused
    });
  }

  private startCountdown(scorerSide: PlayerSide | null) {
    // إذا كانت اللعبة موقوفة نفك الإيقاف ونبلغ الجميع
    if (this.isPaused) this.setPaused(false);

    // تناوب الإرسال: لا يبدأ من نفس المضرب مرتين حتى لو 4 لاعبين
    let finalScorerSide = scorerSide;
    if (scorerSide && this.lastServeSide && scorerSide === this.lastServeSide) {
      const alternatives = this.activeSides.filter(s => s !== this.lastServeSide);
      if (alternatives.length > 0) {
        finalScorerSide = alternatives[Math.floor(Math.random() * alternatives.length)];
      }
    }
    if (finalScorerSide) this.lastServeSide = finalScorerSide;
    
    this.state.countdown = 3;
    this.state.countdownSide = finalScorerSide?? '';
    this.countdownStartedAt = Date.now();
    this.state.rally = 0;
    this.state.ball.vx = 0;
    this.state.ball.vy = 0;
    this.state.ball.x = this.state.worldW / 2;
    this.state.ball.y = this.state.worldH / 2;
    this.state.ball.visible = false;
    this.servingActive = false;
    this.servingRequested = false;
    this.lastHitSide = null;
    this.isPaused = false;
    this.broadcastGameState();
  }

  private launchBall(fromServe = false, side: PlayerSide = 'bottom') {
    // FIXED: respect ballSpeed setting properly, prevent wall penetration
    const baseSpeed = Math.max(2.5, Math.min(12, Number(this.settings.ballSpeed || 9)));
    const speed = 2.2 + baseSpeed * 0.22; // 2.2 + 9*0.22 = 4.18 max, was 5.6+
    if (fromServe) {
      const ang = (Math.random() - 0.5) * 0.8;
      const paddle = this.state.paddles.get(side)!;
      // الكرة تنطلق أمام المضرب (خارج نطاق التصادم) وليس من مركزه
      const gap = PADDLE_RADIUS + BALL_RADIUS + 4;
      if (side === 'bottom') {
        this.state.ball.x = paddle.x; this.state.ball.y = paddle.y - gap;
        this.state.ball.vx = Math.sin(ang) * speed; this.state.ball.vy = -Math.abs(Math.cos(ang) * speed);
      } else if (side === 'top') {
        this.state.ball.x = paddle.x; this.state.ball.y = paddle.y + gap;
        this.state.ball.vx = Math.sin(ang) * speed; this.state.ball.vy = Math.abs(Math.cos(ang) * speed);
      } else if (side === 'left') {
        this.state.ball.x = paddle.x + gap; this.state.ball.y = paddle.y;
        this.state.ball.vx = Math.abs(Math.cos(ang) * speed); this.state.ball.vy = Math.sin(ang) * speed;
      } else {
        this.state.ball.x = paddle.x - gap; this.state.ball.y = paddle.y;
        this.state.ball.vx = -Math.abs(Math.cos(ang) * speed); this.state.ball.vy = Math.sin(ang) * speed;
      }
      // اللاعب الذي أرسل الكرة يُعتبر آخر من لمسها
      this.lastHitSide = side;
      this.lastHitTime = Date.now();
    } else {
      const dirY = Math.random() > 0.5? 1 : -1;
      const ang = (Math.random() - 0.5) * 0.8;
      this.state.ball.x = this.state.worldW / 2;
      this.state.ball.y = this.state.worldH / 2;
      this.state.ball.vx = Math.sin(ang) * speed;
      this.state.ball.vy = Math.cos(ang) * speed * dirY;
      this.lastHitSide = null;
    }
    this.state.ball.visible = true;
    this.lastBallPos = { x: this.state.ball.x, y: this.state.ball.y, time: Date.now() };
  }

  // تحديث كل المضارب (البشر + الكمبيوتر) - تُستدعى أيضاً أثناء العد التنازلي والإرسال
  private updatePaddles(dtSec: number) {
    // 1. Human paddles: Instant 0ms response, zero lag, precise velocity calculation
    for (const side of this.activeSides) {
      const paddle = this.state.paddles.get(side);
      if (!paddle) continue;
      const player = [...this.state.players.values()].find(p => p.side === side);
      if (player?.computer) continue;
      const target = this.paddleTargets.get(side);
      if (!target) continue;
      
      const prev = this.paddlePrev.get(side) || { x: paddle.x, y: paddle.y };
      const clamped = this.clampPaddle(side, target.x, target.y);
      paddle.x = clamped.x;
      paddle.y = clamped.y;
      
      const rawVx = dtSec > 0 ? (paddle.x - prev.x) / dtSec : 0;
      const rawVy = dtSec > 0 ? (paddle.y - prev.y) / dtSec : 0;
      if (Math.abs(rawVx) > 20 || Math.abs(rawVy) > 20) {
        const oldVel = this.paddleVel.get(side) || { vx: 0, vy: 0 };
        this.paddleVel.set(side, {
          vx: Math.max(-2500, Math.min(2500, rawVx * 0.75 + oldVel.vx * 0.25)),
          vy: Math.max(-2500, Math.min(2500, rawVy * 0.75 + oldVel.vy * 0.25)),
        });
      } else {
        const oldVel = this.paddleVel.get(side) || { vx: 0, vy: 0 };
        this.paddleVel.set(side, {
          vx: oldVel.vx * 0.95,
          vy: oldVel.vy * 0.95,
        });
      }
      this.paddlePrev.set(side, { x: paddle.x, y: paddle.y });
    }

    // 2. Computer paddles
    this.moveComputerPaddles(dtSec);
  }

  private tick(deltaMs: number) {
    if (this.state.status!== 'playing') return;
    // إصلاح الإيقاف المؤقت - لا تحرك الكرة إذا متوقف
    if (this.isPaused) {
      this.broadcastAccum += deltaMs;
      if (this.broadcastAccum >= 100) {
        this.broadcastAccum = 0;
        this.broadcastGameState();
      }
      return;
    }

    // FIXED TIMESTEP - ثبات كامل مهما اختلفت الشبكة
    this.accumulator += deltaMs;
    this.accumulator = Math.min(this.accumulator, 100); // منع spiral of death
    const dtSec = this.FIXED_DELTA;
    const delta = 1; // ثابت دائماً

    while (this.accumulator >= this.BASE_MS) {
      // سيتم تنفيذ الفيزياء في الحلقة بالأسفل
      this.accumulator -= this.BASE_MS;
    }

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
          this.state.ball.visible = true;
        } else {
          this.launchBall(false);
        }
      } else {
        this.state.countdown = Math.max(1, Math.ceil(3 - elapsed));
        // المضارب تتحرك أثناء العد التنازلي حتى لا تقفز بعده
        this.updatePaddles(dtSec);
        this.broadcastGameState();
        return;
      }
    }

    if (this.servingActive) {
      // المضارب تتحرك أثناء انتظار الإرسال
      this.updatePaddles(dtSec);
      const paddle = this.state.paddles.get(this.servingSide);
      if (paddle) {
        const offset = PADDLE_RADIUS + BALL_RADIUS + 4;
        if (this.servingSide === 'bottom') { this.state.ball.x = paddle.x; this.state.ball.y = paddle.y - offset; }
        else if (this.servingSide === 'top') { this.state.ball.x = paddle.x; this.state.ball.y = paddle.y + offset; }
        else if (this.servingSide === 'left') { this.state.ball.x = paddle.x + offset; this.state.ball.y = paddle.y; }
        else { this.state.ball.x = paddle.x - offset; this.state.ball.y = paddle.y; }
      }
      this.state.ball.vx = 0;
      this.state.ball.vy = 0;
      const owner = [...this.state.players.values()].find((p) => p.side === this.servingSide);
      // الكمبيوتر يرسل بعد 0.9 ثانية، واللاعب البشري بمهلة أمان 6 ثواني حتى لا تتعلق اللعبة
      const autoDelay = !owner || owner.computer ? 900 : 6000;
      if (Date.now() - this.servingStartedAt > autoDelay) this.servingRequested = true;
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

    this.updatePaddles(dtSec);
    this.stepBallImproved(delta);

    // إصلاح توقف الكرة - anti-stuck
    this.stuckCheckAccum += deltaMs;
    if (this.stuckCheckAccum > 1000) {
      this.stuckCheckAccum = 0;
      const speed = Math.hypot(this.state.ball.vx, this.state.ball.vy);
      const moved = Math.hypot(this.state.ball.x - this.lastBallPos.x, this.state.ball.y - this.lastBallPos.y);
      const timeSinceMove = Date.now() - this.lastBallPos.time;
      
      if (speed < 2.5) {
        const ang = Math.random() * Math.PI * 2;
        const minSpeed = 4.2 + Number(this.settings.ballSpeed || 10) * 0.18;
        this.state.ball.vx = Math.cos(ang) * minSpeed;
        this.state.ball.vy = Math.sin(ang) * minSpeed;
        this.lastBallPos = { x: this.state.ball.x, y: this.state.ball.y, time: Date.now() };
      } else if (moved < 5 && timeSinceMove > 2000) {
        this.state.ball.x = this.state.worldW / 2 + (Math.random()-0.5)*80;
        this.state.ball.y = this.state.worldH / 2 + (Math.random()-0.5)*80;
        const ang = (Math.random()-0.5)*0.8;
        this.state.ball.vx = Math.sin(ang) * 4.5;
        this.state.ball.vy = -Math.abs(Math.cos(ang) * 4.5) - 1;
        this.lastBallPos = { x: this.state.ball.x, y: this.state.ball.y, time: Date.now() };
      } else if (moved > 10) {
        this.lastBallPos = { x: this.state.ball.x, y: this.state.ball.y, time: Date.now() };
      }
    }

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
      worldW: this.state.worldW,
      worldH: this.state.worldH,
      paddles: Object.fromEntries(
        Array.from(this.state.paddles.entries()).map(([side, paddle]) => [
          side,
          { x: paddle.x, y: paddle.y, vx: this.paddleVel.get(side as PlayerSide)?.vx || 0, vy: this.paddleVel.get(side as PlayerSide)?.vy || 0 }
        ])
      ),
      countdown: this.state.countdown,
      // countdownSide = جانب اللاعب الذي سجّل الهدف (وليس صاحب المرمى)
      countdownSide: this.state.countdownSide,
      serving: this.servingActive,
      servingSide: this.servingSide,
      rally: this.state.rally,
      scores: Object.fromEntries(this.state.scores.entries()),
      timeLeft: this.state.timeLeft,
      isPaused: this.isPaused,
      paused: this.isPaused,
      series: {
        currentRound: this.currentRound,
        totalRounds: this.totalRounds,
        seriesType: this.seriesType,
        seriesWins: Object.fromEntries(this.seriesWinsMap.entries()),
        roundHistory: this.roundHistory,
      }
    });
  }

  private moveComputerPaddles(dtSec: number) {
    const w = this.state.worldW;
    const h = this.state.worldH;
    const ball = this.state.ball;
    const diff = this.settings.difficulty;
    const maxSpeed = diff === 'easy' ? 460 : diff === 'hard' ? 1200 : 800;

    const leftWall = BORDER_THICKNESS + BALL_RADIUS;
    const rightWall = w - (BORDER_THICKNESS + BALL_RADIUS);
    const topWall = BORDER_THICKNESS + BALL_RADIUS;
    const bottomWall = h - (BORDER_THICKNESS + BALL_RADIUS);

    const predictX = (startX: number, startVx: number, ticks: number) => {
      let x = startX + startVx * ticks;
      const span = rightWall - leftWall;
      if (span <= 0) return startX;
      while (x < leftWall || x > rightWall) {
        if (x < leftWall) x = leftWall + (leftWall - x);
        if (x > rightWall) x = rightWall - (x - rightWall);
      }
      return x;
    };

    const predictY = (startY: number, startVy: number, ticks: number) => {
      let y = startY + startVy * ticks;
      const span = bottomWall - topWall;
      if (span <= 0) return startY;
      while (y < topWall || y > bottomWall) {
        if (y < topWall) y = topWall + (topWall - y);
        if (y > bottomWall) y = bottomWall - (y - bottomWall);
      }
      return y;
    };

    for (const side of this.activeSides) {
      const player = [...this.state.players.values()].find((p) => p.side === side);
      if (!player || !player.computer) continue;
      const paddle = this.state.paddles.get(side);
      if (!paddle) continue;

      let targetX = paddle.x;
      let targetY = paddle.y;

      if (side === 'top') {
        const homeX = w / 2;
        const homeY = BORDER_THICKNESS + PADDLE_RADIUS + 15;
        if (ball.vy < -0.1) {
          const ticks = Math.max(0, (paddle.y - ball.y) / ball.vy);
          targetX = predictX(ball.x, ball.vx, Math.min(ticks, 80));
          if (ball.y < h * 0.38) {
            targetY = Math.min(h * 0.32, ball.y + PADDLE_RADIUS + 8);
          } else {
            targetY = homeY;
          }
        } else {
          targetX = homeX;
          targetY = homeY;
        }
      } else if (side === 'bottom') {
        const homeX = w / 2;
        const homeY = h - BORDER_THICKNESS - PADDLE_RADIUS - 15;
        if (ball.vy > 0.1) {
          const ticks = Math.max(0, (paddle.y - ball.y) / ball.vy);
          targetX = predictX(ball.x, ball.vx, Math.min(ticks, 80));
          if (ball.y > h * 0.62) {
            targetY = Math.max(h * 0.68, ball.y - PADDLE_RADIUS - 8);
          } else {
            targetY = homeY;
          }
        } else {
          targetX = homeX;
          targetY = homeY;
        }
      } else if (side === 'left') {
        const homeX = BORDER_THICKNESS + PADDLE_RADIUS + 15;
        const homeY = h / 2;
        if (ball.vx < -0.1) {
          const ticks = Math.max(0, (paddle.x - ball.x) / ball.vx);
          targetY = predictY(ball.y, ball.vy, Math.min(ticks, 80));
          if (ball.x < w * 0.38) {
            targetX = Math.min(w * 0.32, ball.x + PADDLE_RADIUS + 8);
          } else {
            targetX = homeX;
          }
        } else {
          targetX = homeX;
          targetY = homeY;
        }
      } else if (side === 'right') {
        const homeX = w - BORDER_THICKNESS - PADDLE_RADIUS - 15;
        const homeY = h / 2;
        if (ball.vx > 0.1) {
          const ticks = Math.max(0, (paddle.x - ball.x) / ball.vx);
          targetY = predictY(ball.y, ball.vy, Math.min(ticks, 80));
          if (ball.x > w * 0.62) {
            targetX = Math.max(w * 0.68, ball.x - PADDLE_RADIUS - 8);
          } else {
            targetX = homeX;
          }
        } else {
          targetX = homeX;
          targetY = homeY;
        }
      }

      const clampedTarget = this.clampPaddle(side, targetX, targetY);
      const dx = clampedTarget.x - paddle.x;
      const dy = clampedTarget.y - paddle.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.min(dist, maxSpeed * dtSec);

      const prev = this.paddlePrev.get(side) || { x: paddle.x, y: paddle.y };
      if (dist > 0.05) {
        paddle.x += (dx / dist) * step;
        paddle.y += (dy / dist) * step;
      }
      const finalClamp = this.clampPaddle(side, paddle.x, paddle.y);
      paddle.x = finalClamp.x;
      paddle.y = finalClamp.y;

      const rawVx = dtSec > 0 ? (paddle.x - prev.x) / dtSec : 0;
      const rawVy = dtSec > 0 ? (paddle.y - prev.y) / dtSec : 0;
      this.paddleVel.set(side, {
        vx: Math.max(-1800, Math.min(1800, rawVx)),
        vy: Math.max(-1800, Math.min(1800, rawVy)),
      });
      this.paddlePrev.set(side, { x: paddle.x, y: paddle.y });
    }
  }

  private stepBallImproved(delta: number) {
    const ball = this.state.ball;
    const w = this.state.worldW, h = this.state.worldH;
    const BALL_R = BALL_RADIUS;
    const PADDLE_R = PADDLE_RADIUS;
    const HIT_DIST = BALL_R + PADDLE_R;

    const totalVx = ball.vx * delta;
    const totalVy = ball.vy * delta;
    const dist = Math.hypot(totalVx, totalVy);
    const maxStep = 3; // FIXED: was 4 - smaller steps prevent wall tunneling
    const steps = Math.max(1, Math.ceil(dist / maxStep));
    const stepVx = totalVx / steps;
    const stepVy = totalVy / steps;

    let missedSide: PlayerSide | null = null;

    for (let i = 0; i < steps && !missedSide; i++) {
      const prevX = ball.x;
      const prevY = ball.y;
      ball.x += stepVx;
      ball.y += stepVy;

      let bestHit: { side: PlayerSide; t: number; nx: number; ny: number; dist: number } | null = null;

      for (const side of this.activeSides) {
        if (this.lastHitSide === side && Date.now() - this.lastHitTime < 90) continue;

        const paddle = this.state.paddles.get(side);
        if (!paddle) continue;

        const segX = ball.x - prevX;
        const segY = ball.y - prevY;
        const segLenSq = segX * segX + segY * segY;

        let t = 0;
        let closestX = prevX;
        let closestY = prevY;
        if (segLenSq > 0.0001) {
          t = ((paddle.x - prevX) * segX + (paddle.y - prevY) * segY) / segLenSq;
          t = Math.max(0, Math.min(1, t));
          closestX = prevX + segX * t;
          closestY = prevY + segY * t;
        }

        const dx = closestX - paddle.x;
        const dy = closestY - paddle.y;
        const d = Math.hypot(dx, dy);

        if (d < HIT_DIST) {
          if (!bestHit || t < bestHit.t) {
            bestHit = {
              side,
              t,
              nx: d > 0.001 ? dx / d : 0,
              ny: d > 0.001 ? dy / d : (side === 'bottom' ? -1 : 1),
              dist: d,
            };
          }
        }
      }

      if (bestHit) {
        const side = bestHit.side;
        const paddle = this.state.paddles.get(side)!;
        const pVel = this.paddleVel.get(side) || { vx: 0, vy: 0 };

        ball.x = paddle.x + bestHit.nx * (HIT_DIST + 2);
        ball.y = paddle.y + bestHit.ny * (HIT_DIST + 2);

        const currentSpeed = Math.hypot(ball.vx, ball.vy);
        const baseSpeed = 4.5 + Number(this.settings.ballSpeed || 10) * 0.2;
        let targetSpeed = Math.max(currentSpeed, baseSpeed);

        if (this.settings.speed === 'gradual') {
          targetSpeed = Math.min(targetSpeed + 0.35, 18);
        } else if (this.settings.speed === 'never_reset') {
          targetSpeed = Math.min(targetSpeed + 0.2, 20);
        } else {
          targetSpeed = baseSpeed;
        }

        const paddleSpeed = Math.hypot(pVel.vx, pVel.vy);
        if (paddleSpeed > 30) {
          targetSpeed = Math.min(targetSpeed + Math.min(paddleSpeed / 200, 4.0), 22);
        }

        let angle = 0;
        if (side === 'bottom') {
          const impactOffset = Math.max(-1, Math.min(1, (ball.x - paddle.x) / PADDLE_R));
          const swipe = Math.max(-1, Math.min(1, pVel.vx / 350));
          angle = Math.max(-1.18, Math.min(1.18, impactOffset * 0.85 + swipe * 0.45));
          ball.vx = Math.sin(angle) * targetSpeed;
          ball.vy = -Math.cos(angle) * targetSpeed;
          if (pVel.vy < -50) ball.vy += Math.max(-5, pVel.vy / 150);
        } else if (side === 'top') {
          const impactOffset = Math.max(-1, Math.min(1, (ball.x - paddle.x) / PADDLE_R));
          const swipe = Math.max(-1, Math.min(1, pVel.vx / 350));
          angle = Math.max(-1.18, Math.min(1.18, impactOffset * 0.85 + swipe * 0.45));
          ball.vx = Math.sin(angle) * targetSpeed;
          ball.vy = Math.cos(angle) * targetSpeed;
          if (pVel.vy > 50) ball.vy += Math.min(5, pVel.vy / 150);
        } else if (side === 'left') {
          const impactOffset = Math.max(-1, Math.min(1, (ball.y - paddle.y) / PADDLE_R));
          const swipe = Math.max(-1, Math.min(1, pVel.vy / 350));
          angle = Math.max(-1.18, Math.min(1.18, impactOffset * 0.85 + swipe * 0.45));
          ball.vx = Math.cos(angle) * targetSpeed;
          ball.vy = Math.sin(angle) * targetSpeed;
          if (pVel.vx > 50) ball.vx += Math.min(5, pVel.vx / 150);
        } else {
          const impactOffset = Math.max(-1, Math.min(1, (ball.y - paddle.y) / PADDLE_R));
          const swipe = Math.max(-1, Math.min(1, pVel.vy / 350));
          angle = Math.max(-1.18, Math.min(1.18, impactOffset * 0.85 + swipe * 0.45));
          ball.vx = -Math.cos(angle) * targetSpeed;
          ball.vy = Math.sin(angle) * targetSpeed;
          if (pVel.vx < -50) ball.vx += Math.max(-5, pVel.vx / 150);
        }

        this.state.rally += 1;
        this.lastHitSide = side;
        this.lastHitTime = Date.now();
        this.broadcast('hit-effect', {
          x: ball.x,
          y: ball.y,
          side,
          power: Math.min(1, this.state.rally / 12),
          paddleVx: pVel.vx,
          paddleVy: pVel.vy,
        });
      }

      const goalW = Math.round(w * 0.52);
      const goalH = Math.round(h * 0.52);
      const gx1 = (w - goalW) / 2, gx2 = gx1 + goalW;
      const gy1 = (h - goalH) / 2, gy2 = gy1 + goalH;

      if (ball.y - BALL_R <= BORDER_THICKNESS) {
        if (this.activeSides.includes('top')) {
          if (ball.x >= gx1 && ball.x <= gx2) {
            if (ball.y <= -BALL_R) missedSide = 'top';
          } else {
            ball.y = BORDER_THICKNESS + BALL_R + 1;
            ball.vy = Math.abs(ball.vy);
          }
        } else {
          ball.y = BORDER_THICKNESS + BALL_R + 1;
          ball.vy = Math.abs(ball.vy);
        }
      }

      if (!missedSide && ball.y + BALL_R >= h - BORDER_THICKNESS) {
        if (this.activeSides.includes('bottom')) {
          if (ball.x >= gx1 && ball.x <= gx2) {
            if (ball.y >= h + BALL_R) missedSide = 'bottom';
          } else {
            ball.y = h - BORDER_THICKNESS - BALL_R - 1;
            ball.vy = -Math.abs(ball.vy);
          }
        } else {
          ball.y = h - BORDER_THICKNESS - BALL_R - 1;
          ball.vy = -Math.abs(ball.vy);
        }
      }

      if (!missedSide && ball.x - BALL_R <= BORDER_THICKNESS) {
        if (this.activeSides.includes('left')) {
          if (ball.y >= gy1 && ball.y <= gy2) {
            if (ball.x <= -BALL_R) missedSide = 'left';
          } else {
            ball.x = BORDER_THICKNESS + BALL_R + 1;
            ball.vx = Math.abs(ball.vx);
          }
        } else {
          ball.x = BORDER_THICKNESS + BALL_R + 1;
          ball.vx = Math.abs(ball.vx);
        }
      }

      if (!missedSide && ball.x + BALL_R >= w - BORDER_THICKNESS) {
        if (this.activeSides.includes('right')) {
          if (ball.y >= gy1 && ball.y <= gy2) {
            if (ball.x >= w + BALL_R) missedSide = 'right';
          } else {
            ball.x = w - BORDER_THICKNESS - BALL_R - 1;
            ball.vx = -Math.abs(ball.vx);
          }
        } else {
          ball.x = w - BORDER_THICKNESS - BALL_R - 1;
          ball.vx = -Math.abs(ball.vx);
        }
      }

      if (missedSide) {
        this.onGoal(missedSide);
        break;
      }
    }
  }

  private onGoal(missedSide: PlayerSide) {
    // حماية صارمة: لا يُحتسب هدفان متتاليان ولا هدف أثناء العد التنازلي
    const nowMs = Date.now();
    if (this.state.countdown > 0 || nowMs - this.lastGoalAt < 1200) return;
    this.lastGoalAt = nowMs;

    // المسجّل = آخر لاعب لمس الكرة (إن لم يكن صاحب المرمى نفسه)، وإلا الخصم المقابل
    const hit = this.lastHitSide;
    let scorerSide: PlayerSide = hit && hit !== missedSide && this.activeSides.includes(hit) ? hit : OPPOSITE[missedSide];
    let scorer = [...this.state.players.values()].find((p) => p.side === scorerSide);
    if (!scorer) {
      scorer = [...this.state.players.values()].find((p) => p.side !== missedSide);
      if (scorer) scorerSide = scorer.side as PlayerSide;
    }
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
    this.lastHitSide = null;
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

const port = Number(process.env.PORT ?? 3000);
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
      // Robust public dir detection for Fly - tries multiple locations
      const possibleDirs = [
        path.resolve(import.meta.dirname, '../dist/public'),
        path.resolve(import.meta.dirname, '../../dist/public'),
        path.resolve(process.cwd(), 'dist/public'),
        path.resolve(process.cwd(), 'dist'),
        path.resolve(import.meta.dirname, '../public'),
      ];
      let publicDir = possibleDirs[0];
      for (const dir of possibleDirs) {
        try {
          const fs = await import('node:fs');
          if (fs.existsSync(path.join(dir, 'index.html'))) {
            publicDir = dir;
            console.log(`[server] Found public dir: ${publicDir}`);
            break;
          }
        } catch {}
      }
      console.log(`[server] Serving static from: ${publicDir}`);
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
console.log(`[colyseus] Qoud server listening on port ${port} - 6 digits only - Pause fixed - Anti-stuck fixed - Goals server-authoritative`);
