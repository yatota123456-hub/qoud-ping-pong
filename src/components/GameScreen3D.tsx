import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, LogIn, Minus, Monitor, Pause, Play, Plus, Volume2, X, Zap, ArrowLeft, Gamepad2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GameScreen3D } from './components/GameScreen3D';
import { socket, colyseus } from './socket.tsx';

type Player = { id: number | string; name: string; color: string; side: 'top' | 'right' | 'bottom' | 'left'; computer: boolean; socketId?: string };
type RoomData = { code: string; players: Player[]; maxPlayers: number; status: 'waiting' | 'playing'; createdAt?: number; hostName?: string; hostSocketId?: string; settings?: any; series?: any };
type Vec2 = { x: number; y: number };
type Screen = 'setup' | 'waiting' | 'game' | 'results';
type StartMode = 'paddle' | 'center';
type SpeedMode = 'gradual' | 'fixed' | 'never_reset';
type MatchMode = 'time' | 'goals';
type Difficulty = 'easy' | 'normal' | 'hard';
type ArenaSize = 'small' | 'medium' | 'large' | 'xlarge';
type Settings = { 
  players: number; vsComputer: boolean; difficulty: Difficulty; start: StartMode; 
  mode: MatchMode; duration: number; goal: number; speed: SpeedMode; 
  ballSpeed: number; sound: boolean; graphics: '2d' | '3d'; arenaSize: ArenaSize; 
  seriesType: 'single' | 'series'; seriesRounds: number; 
};
type Scores = Record<string | number, number>;

const ARENA_SCALES: Record<ArenaSize, number> = { small: 0.8, medium: 1.0, large: 1.25, xlarge: 1.5 };
const COLORS = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];
const SIDES: Player['side'][] = ['bottom', 'top', 'right', 'left'];
const RECTANGULAR_WORLD = { w: 700, h: 1050 };
const SQUARE_WORLD = { w: 1000, h: 1000 };
const ZONE = 100;
const PADDLE_MOVE_ZONE = 220;
const PADDLE_SIZE = 42;

function getArenaWorld(playersCount: number, arenaSize: ArenaSize = 'medium') {
  const baseWorld = playersCount >= 3 ? SQUARE_WORLD : RECTANGULAR_WORLD;
  const scale = ARENA_SCALES[arenaSize] || 1.0;
  return { w: baseWorld.w * scale, h: baseWorld.h * scale };
}

function GameScreen({ 
  roomCode, isHost, players, settings, scores, lastGoal, paused, celebrating, 
  seriesWins, currentRound, roundWinner, onGoal, onTimeUp, onPause, onExit 
}: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const hintDotRef = useRef<HTMLDivElement>(null);
  const hintTextRef = useRef<HTMLDivElement>(null);
  const hasDraggedRef = useRef(false);
  const noDragStartRef = useRef(performance.now());
  const controls = useRef({ x: 0, y: 0 });
  const drag = useRef<{ side: Player['side'] | null; x: number; y: number }>({ side: null, x: 500, y: 300 });
  const servingRef = useRef<{ active: boolean; side: Player['side']; startTime: number; requested: boolean }>({ 
    active: settings.start === 'paddle', side: 'bottom', startTime: performance.now(), requested: false 
  });
  
  const [timeLeft, setTimeLeft] = useState(settings.mode === 'time' ? settings.duration : 0);
  const [sound, setSound] = useState(settings.sound);
  const [rally, setRally] = useState(0);
  const [isServing, setIsServing] = useState(settings.start === 'paddle');
  const [countdown, setCountdown] = useState(0);
  const [countdownName, setCountdownName] = useState('');
  const [countdownSide, setCountdownSide] = useState('');
  
  const soundRef = useRef(sound);
  const onTimeUpRef = useRef(onTimeUp);
  const onGoalRef = useRef(onGoal);
  const pausedRef = useRef(paused);
  const celebratingRef = useRef(celebrating);
  const gameEndedRef = useRef(false);
  
  const world = useMemo(() => getArenaWorld(players.length, settings.arenaSize), [players.length, settings.arenaSize]);
  const mySide = useMemo(() => (players.find((p:any)=>p.socketId===socket.id)?.side || players[0]?.side || 'bottom') as Player['side'], [players]);
  const angleMap: any = { bottom: 0, top: Math.PI, right: Math.PI/2, left: -Math.PI/2 };
  const myAngle = angleMap[mySide] ?? 0;
  
  soundRef.current = sound;
  onTimeUpRef.current = onTimeUp;
  onGoalRef.current = onGoal;
  pausedRef.current = paused;
  
  useEffect(() => { celebratingRef.current = celebrating; }, [celebrating]);
  
  const audioCtxRef = useRef<AudioContext|null>(null);
  
  const playHit = useCallback((power: number, xPos: number = world.w/2) => {
    if (!soundRef.current) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext||(window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(90 + power * 800, t);
      o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
      g.gain.setValueAtTime(0.15 + power * 0.85, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.45);
    } catch {}
  }, [world.w]);
  
  const playGoalSound = useCallback(() => {
    if (!soundRef.current) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext||(window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.value = 1.3;
      master.connect(ctx.destination);
      [261, 329, 392, 523, 659].forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(freq, t + i * 0.07);
        g.gain.setValueAtTime(0.9, t + i * 0.07);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.6);
        o.connect(g).connect(master);
        o.start(t + i * 0.07);
        o.stop(t + i * 0.07 + 0.7);
      });
    } catch {}
  }, []);

  const playCelebrationSound = useCallback(() => {
    if (!soundRef.current) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext||(window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.value = 1.5;
      master.connect(ctx.destination);
      const bufferSize = ctx.sampleRate * 8;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.65;
      const crowd = ctx.createBufferSource();
      crowd.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      filter.Q.value = 1;
      const gCrowd = ctx.createGain();
      gCrowd.gain.setValueAtTime(0, t);
      gCrowd.gain.linearRampToValueAtTime(0.95, t + 0.25);
      gCrowd.gain.setValueAtTime(0.95, t + 6.8);
      gCrowd.gain.linearRampToValueAtTime(0, t + 8);
      crowd.connect(filter).connect(gCrowd).connect(master);
      crowd.start(t);
      const whistle = (delay: number, f1: number, f2: number, vol: number) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f1, t + delay);
        o.frequency.linearRampToValueAtTime(f2, t + delay + 0.7);
        g.gain.setValueAtTime(0, t + delay);
        g.gain.linearRampToValueAtTime(vol, t + delay + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, t + delay + 1.4);
        o.connect(g).connect(master);
        o.start(t + delay);
        o.stop(t + delay + 1.5);
      };
      whistle(0.1, 1800, 3800, 1.3);
      whistle(0.9, 2200, 4200, 1.2);
      whistle(2.3, 1600, 3500, 1.1);
      whistle(3.5, 2000, 3900, 1.0);
      [523, 659, 783, 1046, 1318].forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g2 = ctx.createGain();
        o.type = 'square';
        o.frequency.value = freq;
        g2.gain.setValueAtTime(0, t + i * 0.12);
        g2.gain.linearRampToValueAtTime(0.75, t + i * 0.12 + 0.02);
        g2.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.8);
        o.connect(g2).connect(master);
        o.start(t + i * 0.12);
        o.stop(t + i * 0.12 + 0.9);
      });
    } catch {}
  }, []);

  const requestLaunch = useCallback(() => {
    if (servingRef.current.active) servingRef.current.requested = true;
  }, []);

  const getInitialSpeed = useCallback(() => 2.8 + settings.ballSpeed * 0.48, [settings.ballSpeed]);

  // ============================================================
  // 🔥 STATE - محسّن للـ Fly.io latency
  // ============================================================
  const stateRef = useRef({
    ball: { x: world.w / 2, y: world.h / 2, vx: 0, vy: 0 },
    ballTarget: { x: world.w / 2, y: world.h / 2, vx: 0, vy: 0 },
    ballBuffer: [] as Array<{ x: number; y: number; vx: number; vy: number; t: number }>,
    paddles: { 
      top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, 
      bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, 
      left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, 
      right: { x: world.w - 40 - ZONE / 2, y: world.h / 2 } as Vec2 
    },
    targetPaddles: { 
      top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, 
      bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, 
      left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, 
      right: { x: world.w - 40 - ZONE / 2, y: world.h / 2 } as Vec2 
    },
    prevPaddles: { 
      top: { x: world.w / 2, y: 40 + ZONE / 2 } as Vec2, 
      bottom: { x: world.w / 2, y: world.h - 40 - ZONE / 2 } as Vec2, 
      left: { x: 40 + ZONE / 2, y: world.h / 2 } as Vec2, 
      right: { x: world.w - 40 - ZONE / 2, y: world.h / 2 } as Vec2 
    },
    last: performance.now(),
    elapsed: 0,
    rally: 0,
    speedMult: 1,
    countdown: 3,
    countdownStart: performance.now(),
    countdownSide: null as Player['side'] | null,
    effects: [] as { x: number; y: number; born: number; color: string; power: number }[]
  });

  const isOfflineMode = players.length <= 1;

  const getWorldFromClient = useCallback((clientX: number, clientY: number) => {
    const arena = arenaRef.current;
    if (!arena) return { x: world.w / 2, y: world.h / 2 };
    const rect = arena.getBoundingClientRect();
    let wx = ((clientX - rect.left) / rect.width) * world.w;
    let wy = ((clientY - rect.top) / rect.height) * world.h;
    const cos = Math.cos(-myAngle);
    const sin = Math.sin(-myAngle);
    const dx = wx - world.w / 2;
    const dy = wy - world.h / 2;
    return { x: dx * cos - dy * sin + world.w / 2, y: dx * sin + dy * cos + world.h / 2 };
  }, [world, myAngle]);

  // ============================================================
  // 🔥 مستمع game-state محسّن (Fly.io compatible)
  // ============================================================
  useEffect(() => {
    const handleGameState = (data: any) => {
      if (!data || players.length <= 1) return;
      
      if (data.ball) {
        // ✅ Optimized ball interpolation
        stateRef.current.ballTarget = {
          x: data.ball.x,
          y: data.ball.y,
          vx: data.ball.vx,
          vy: data.ball.vy
        };
        
        // Keep buffer for smooth interpolation
        stateRef.current.ballBuffer.push({
          x: data.ball.x,
          y: data.ball.y,
          vx: data.ball.vx,
          vy: data.ball.vy,
          t: performance.now()
        });
        if (stateRef.current.ballBuffer.length > 4) {
          stateRef.current.ballBuffer.shift();
        }
      }
      
      if (data.paddles) {
        Object.keys(data.paddles).forEach((side) => {
          if (side === mySide) return; // تجاهل المضرب الخاص بي
          const p = data.paddles[side];
          if (stateRef.current.targetPaddles[side as Player['side']]) {
            stateRef.current.targetPaddles[side as Player['side']].x = p.x;
            stateRef.current.targetPaddles[side as Player['side']].y = p.y;
          }
        });
      }
      
      if (data.countdown !== undefined) {
        stateRef.current.countdown = data.countdown;
        setCountdown(data.countdown);
      }
      
      if (data.countdownSide !== undefined) {
        setCountdownSide(data.countdownSide || '');
      }
      
      if (data.rally !== undefined) {
        setRally(data.rally);
      }
    };
    
    socket.on('game-state', handleGameState);
    return () => { socket.off('game-state', handleGameState); };
  }, [mySide, players.length]);

  // ============================================================
  // 🔥 Canvas Rendering Loop - محسّن للـ Fly.io
  // ============================================================
  useEffect(() => {
    const canvas = canvasRef.current;
    const arena = arenaRef.current;
    if (!canvas || !arena) return;
    
    const context = canvas.getContext('2d');
    if (!context) return;
    
    const state = stateRef.current;

    const launchBall = (fromServe = false, side: Player['side'] = 'bottom') => {
      const speed = 6 + Number(settings.ballSpeed || 10) * 0.5;
      if (fromServe) {
        const ang = (Math.random() - 0.5) * 0.8;
        const paddle = state.paddles[side];
        state.ball.x = paddle.x;
        state.ball.y = paddle.y;
        if (side === 'bottom') {
          state.ball.vx = Math.sin(ang) * speed;
          state.ball.vy = -Math.abs(Math.cos(ang) * speed) - 1;
        } else if (side === 'top') {
          state.ball.vx = Math.sin(ang) * speed;
          state.ball.vy = Math.abs(Math.cos(ang) * speed) + 1;
        } else if (side === 'left') {
          state.ball.vx = Math.abs(Math.cos(ang) * speed) + 1;
          state.ball.vy = Math.sin(ang) * speed;
        } else {
          state.ball.vx = -Math.abs(Math.cos(ang) * speed) - 1;
          state.ball.vy = Math.sin(ang) * speed;
        }
      } else {
        const dirY = Math.random() > 0.5 ? 1 : -1;
        const ang = (Math.random() - 0.5) * 0.8;
        state.ball.vx = Math.sin(ang) * speed;
        state.ball.vy = Math.cos(ang) * speed * dirY;
      }
    };

    let frame = 0;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = arena.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      context.setTransform(canvas.width / world.w, 0, 0, canvas.height / world.h, 0, 0);
    };
    
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(arena);

    const needCount = Math.max(2, players.length);
    const requiredSides: Player['side'][] = needCount === 2 ? ['bottom', 'top'] : ['bottom', 'top', 'right', 'left'];
    const playerForSide = (side: Player['side']) => 
      players.find((p) => p.side === side) ?? ({ 
        id: side, name: side, color: COLORS[SIDES.indexOf(side)], side, computer: side !== 'bottom' 
      } as Player);
    const active = (side: Player['side']) => requiredSides.includes(side);
    const opposite: Record<string, Player['side']> = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };

    const resetBall = (missedSide?: Player['side']) => {
      const scorerSide = missedSide ? opposite[missedSide] : null;
      const scorer = scorerSide ? playerForSide(scorerSide) : null;
      state.countdown = 3;
      state.countdownStart = performance.now();
      state.countdownSide = scorerSide as any;
      setCountdown(3);
      setCountdownName(scorer ? scorer.name : '');
      state.ball.x = world.w / 2;
      state.ball.y = world.h / 2;
      state.ballTarget.x = world.w / 2;
      state.ballTarget.y = world.h / 2;
      state.ball.vx = 0;
      state.ball.vy = 0;
      state.rally = 0;
      setRally(0);
      state.speedMult = 1;
      hasDraggedRef.current = false;
      noDragStartRef.current = performance.now();
      if (hintDotRef.current) hintDotRef.current.style.display = 'none';
      if (hintTextRef.current) hintTextRef.current.style.display = 'none';
    };

    const clamp = (v: number, mn: number, mx: number) => Math.max(mn, Math.min(mx, v));

    const tick = (now: number) => {
      const delta = Math.min((now - state.last) / 16.67, 2);
      state.last = now;

      if (celebratingRef.current) {
        state.ball.x += state.ball.vx * 0.28 * delta;
        state.ball.y += state.ball.vy * 0.28 * delta;
        if (state.ball.x < 30 || state.ball.x > world.w - 30) state.ball.vx *= -1;
        if (state.ball.y < 30 || state.ball.y > world.h - 30) state.ball.vy *= -1;
        draw(context, state, players, now, false, world, myAngle);
        frame = requestAnimationFrame(tick);
        return;
      }

      if (!pausedRef.current && !gameEndedRef.current) {
        // تحديث موقع المضرب الخاص بي
        if (drag.current.side === mySide) {
          state.targetPaddles[mySide].x = clamp(drag.current.x, 50, world.w - 50);
          if (mySide === 'bottom' || mySide === 'top') {
            const minY = mySide === 'bottom' ? world.h - PADDLE_MOVE_ZONE - 60 : 40;
            const maxY = mySide === 'bottom' ? world.h - 40 : 40 + PADDLE_MOVE_ZONE;
            state.targetPaddles[mySide].y = clamp(drag.current.y, minY, maxY);
          } else {
            state.targetPaddles[mySide].y = clamp(drag.current.y, 50, world.h - 50);
            const minX = mySide === 'left' ? 40 : world.w - PADDLE_MOVE_ZONE - 60;
            const maxX = mySide === 'left' ? 40 + PADDLE_MOVE_ZONE : world.w - 40;
            state.targetPaddles[mySide].x = clamp(drag.current.x, minX, maxX);
          }
          socket.sendPaddleTarget(state.targetPaddles[mySide].x, state.targetPaddles[mySide].y);
        }

        // ============================================================
        // 🔥 Fly.io Optimized Physics
        // ============================================================
        if (isOfflineMode) {
          // محلي: فيزياء سريعة بدون انتظار الخادم
          const ball = state.ball;
          const w = world.w, h = world.h;
          const BALL_R = 14, PADDLE_R = 26, HIT_DIST = BALL_R + PADDLE_R;

          if (state.countdown === 0) {
            const safeDelta = Math.min(delta, 1);
            ball.x += ball.vx * safeDelta * 0.5;
            ball.y += ball.vy * safeDelta * 0.5;

            // تصادم المضارب
            for (const side of requiredSides) {
              if (!active(side)) continue;
              const paddle = state.paddles[side];
              const dx = ball.x - paddle.x, dy = ball.y - paddle.y;
              const d = Math.hypot(dx, dy);
              if (d < HIT_DIST && d > 0.5) {
                const nx = dx / d, ny = dy / d;
                ball.x = paddle.x + nx * (HIT_DIST + 1);
                ball.y = paddle.y + ny * (HIT_DIST + 1);
                const baseSpeed = getInitialSpeed();
                if (side === 'bottom') {
                  ball.vy = -Math.abs(baseSpeed);
                  ball.vx = (ball.x - paddle.x) * 0.15;
                } else if (side === 'top') {
                  ball.vy = Math.abs(baseSpeed);
                  ball.vx = (ball.x - paddle.x) * 0.15;
                } else if (side === 'left') {
                  ball.vx = Math.abs(baseSpeed);
                  ball.vy = (ball.y - paddle.y) * 0.15;
                } else {
                  ball.vx = -Math.abs(baseSpeed);
                  ball.vy = (ball.y - paddle.y) * 0.15;
                }
                state.rally++;
                setRally(state.rally);
              }
            }

            // جدران و أهداف
            const goalW = 300;
            const gx1 = (w - goalW) / 2, gx2 = gx1 + goalW;
            const gy1 = (h - goalW) / 2, gy2 = gy1 + goalW;

            if (ball.y < 18) {
              if (active('top') && ball.x >= gx1 && ball.x <= gx2) {
                onGoalRef.current(playerForSide('bottom'));
                resetBall('top');
              } else {
                ball.y = 18;
                ball.vy = Math.abs(ball.vy);
              }
            }
            if (ball.y > h - 18) {
              if (active('bottom') && ball.x >= gx1 && ball.x <= gx2) {
                onGoalRef.current(playerForSide('top'));
                resetBall('bottom');
              } else {
                ball.y = h - 18;
                ball.vy = -Math.abs(ball.vy);
              }
            }
            if (ball.x < 18) {
              if (active('left') && ball.y >= gy1 && ball.y <= gy2) {
                onGoalRef.current(playerForSide('right'));
                resetBall('left');
              } else {
                ball.x = 18;
                ball.vx = Math.abs(ball.vx);
              }
            }
            if (ball.x > w - 18) {
              if (active('right') && ball.y >= gy1 && ball.y <= gy2) {
                onGoalRef.current(playerForSide('left'));
                resetBall('right');
              } else {
                ball.x = w - 18;
                ball.vx = -Math.abs(ball.vx);
              }
            }
          }

          // تحرك المضارب
          const predX = ball.x + ball.vx * 8;
          const predY = ball.y + ball.vy * 8;
          const diffMax = settings.difficulty === 'easy' ? 0.85 : settings.difficulty === 'hard' ? 2.4 : 1.6;
          const chase = (cur: number, target: number) => {
            const diff = target - cur;
            if (Math.abs(diff) < 2) return cur;
            const step = Math.max(-diffMax, Math.min(diffMax, diff * 0.18)) * 6 * delta;
            return cur + step;
          };
          for (const side of requiredSides) {
            if (!active(side) || side === mySide) continue;
            const paddle = state.paddles[side];
            if (side === 'top' || side === 'bottom') {
              const c = clamp(chase(paddle.x, predX), 50, w - 50);
              paddle.x = c;
            } else {
              const c = clamp(chase(paddle.y, predY), 50, h - 50);
              paddle.y = c;
            }
            state.targetPaddles[side].x = paddle.x;
            state.targetPaddles[side].y = paddle.y;
          }

          const cur = state.paddles[mySide];
          const tgt = state.targetPaddles[mySide];
          cur.x += (tgt.x - cur.x) * 0.5;
          cur.y += (tgt.y - cur.y) * 0.5;
        } else {
          // ✅ Fly.io Server: استيفاء سلس للكرة
          const nowMs = performance.now();
          const buf = state.ballBuffer;
          let smoothX = state.ballTarget.x, smoothY = state.ballTarget.y;

          if (buf.length >= 2) {
            const last = buf[buf.length - 1];
            const dt = (nowMs - last.t) / 1000;
            if (dt < 0.15) {
              smoothX = last.x + last.vx * dt * 30;
              smoothY = last.y + last.vy * dt * 30;
            }
          }

          const dx = smoothX - state.ball.x, dy = smoothY - state.ball.y;
          if (Math.hypot(dx, dy) > 100) {
            state.ball.x = smoothX;
            state.ball.y = smoothY;
          } else {
            state.ball.x += dx * 0.28; // ✅ أسرع من 0.15
            state.ball.y += dy * 0.28;
          }
          state.ball.vx = state.ballTarget.vx;
          state.ball.vy = state.ballTarget.vy;

          // تحرك المضارب بسلاسة
          (['top', 'bottom', 'right', 'left'] as const).forEach(side => {
            if (!active(side)) return;
            const target = state.targetPaddles[side];
            const current = state.paddles[side];
            const lf = side === mySide ? 0.55 : 0.25; // ✅ أسرع
            current.x += (target.x - current.x) * lf;
            current.y += (target.y - current.y) * lf;
          });
        }

        // تلميح الحركة
        if (!hasDraggedRef.current && hintDotRef.current && hintTextRef.current && arenaRef.current) {
          const elapsed = now - noDragStartRef.current;
          if (elapsed > 3000 && state.countdown === 0) {
            const p = state.paddles[mySide];
            const GRAB_OFFSET = 130;
            let hx = p.x, hy = p.y;
            if (mySide === 'bottom') hy = p.y + GRAB_OFFSET;
            else if (mySide === 'top') hy = p.y - GRAB_OFFSET;
            else if (mySide === 'left') hx = p.x - GRAB_OFFSET;
            else hx = p.x + GRAB_OFFSET;
            const cosA = Math.cos(myAngle), sinA = Math.sin(myAngle);
            const dx = hx - world.w / 2, dy = hy - world.h / 2;
            const rx = dx * cosA - dy * sinA + world.w / 2;
            const ry = dx * sinA + dy * cosA + world.h / 2;
            const rect = arenaRef.current.getBoundingClientRect();
            const sx = (rx / world.w) * rect.width;
            const sy = (ry / world.h) * rect.height;
            hintDotRef.current.style.left = `${sx}px`;
            hintDotRef.current.style.top = `${sy}px`;
            hintDotRef.current.style.display = 'block';
            hintTextRef.current.style.left = `${sx + 18}px`;
            hintTextRef.current.style.top = `${sy - 12}px`;
            hintTextRef.current.style.display = 'block';
          }
        }
      }

      draw(context, state, players, now, false, world, myAngle);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [players, settings, getInitialSpeed, isHost, roomCode, mySide, myAngle, playHit, playGoalSound, isOfflineMode]);

  // Keyboard controls
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === ' ' || event.code === 'Space') {
        if (servingRef.current.active) {
          servingRef.current.requested = true;
          event.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (paused || celebrating) return;
    if (isServing) {
      requestLaunch();
      return;
    }
    (event.currentTarget as any).setPointerCapture?.(event.pointerId);
    const pt = getWorldFromClient(event.clientX, event.clientY);
    const isTouch = (event as any).pointerType === 'touch';
    const OFFSET = isTouch ? 130 : 50;
    let tx = pt.x, ty = pt.y;
    if (mySide === 'bottom') ty = pt.y - OFFSET;
    if (mySide === 'top') ty = pt.y + OFFSET;
    if (mySide === 'left') tx = pt.x + OFFSET;
    if (mySide === 'right') tx = pt.x - OFFSET;
    hasDraggedRef.current = true;
    if (hintDotRef.current) hintDotRef.current.style.display = 'none';
    if (hintTextRef.current) hintTextRef.current.style.display = 'none';
    drag.current = { side: mySide, x: tx, y: ty };
    stateRef.current.targetPaddles[mySide].x = tx;
    stateRef.current.targetPaddles[mySide].y = ty;
    socket.sendPaddleTarget(tx, ty);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current.side) return;
    const pt = getWorldFromClient(event.clientX, event.clientY);
    const isTouch = (event as any).pointerType === 'touch';
    const OFFSET = isTouch ? 130 : 50;
    let tx = pt.x, ty = pt.y;
    if (mySide === 'bottom') ty = pt.y - OFFSET;
    if (mySide === 'top') ty = pt.y + OFFSET;
    if (mySide === 'left') tx = pt.x + OFFSET;
    if (mySide === 'right') tx = pt.x - OFFSET;
    drag.current.x = tx;
    drag.current.y = ty;
    stateRef.current.targetPaddles[mySide].x = tx;
    stateRef.current.targetPaddles[mySide].y = ty;
    socket.sendPaddleTarget(tx, ty);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.currentTarget as any).hasPointerCapture?.(event.pointerId)) {
      (event.currentTarget as any).releasePointerCapture(event.pointerId);
    }
    drag.current.side = null;
  };

  const { i18n } = useTranslation();
  const isAr = i18n.language?.startsWith('ar') ?? true;

  return (
    <main className="game-shell" dir="ltr" style={{ touchAction: 'none' }} onContextMenu={e => e.preventDefault()}>
      <style>{`
        @keyframes hintPulse{0%{transform:translate(-50%,-50%) scale(1); box-shadow:0 0 0 0 rgba(0,229,255,0.7)}70%{transform:translate(-50%,-50%) scale(1.3); box-shadow:0 0 0 12px rgba(0,229,255,0)}100%{transform:translate(-50%,-50%) scale(1); box-shadow:0 0 0 0 rgba(0,229,255,0)}}
        @keyframes crashShake{0%{transform:translate(0,0)}20%{transform:translate(-1px,1px)}40%{transform:translate(1px,-1px)}60%{transform:translate(-1px,-1px)}80%{transform:translate(1px,1px)}100%{transform:translate(0,0)}}
        @keyframes celePulse{0%{transform:scale(1)}100%{transform:scale(1.08)}}
      `}</style>
      <header className="game-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="w-9 h-9 bg-black text-[#f6f0d2] border-[2.5px] border-black rounded-[10px] grid place-items-center font-black text-[14px]">Q</div>
          <span style={{ color: '#fff', fontWeight: 'bold' }}>QOUD LED</span>
        </div>
        <div className="match-meta" style={{ display: 'flex', alignItems: 'center', gap: '16px', color: '#fff', fontWeight: 'bold' }}>
          <span>{settings.mode === 'time' ? formatTime(timeLeft) : '∞'}</span>
          <span>|</span>
          <span>{mySide.toUpperCase()}</span>
          {settings.seriesType === 'series' && (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', background: '#1a1a1a', padding: '4px 12px', borderRadius: '20px' }}>
              <span style={{ fontWeight: 'bold', color: '#ffcf5a' }}>جولة {currentRound}/{settings.seriesRounds}</span>
            </div>
          )}
        </div>
        <div className="game-actions" style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setSound(!sound)} style={{ background: '#111', color: '#fff', border: 'none', borderRadius: '8px', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Volume2 size={18} />
          </button>
          <button onClick={onPause} style={{ background: '#111', color: '#fff', border: 'none', borderRadius: '8px', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            {paused ? <Play size={18} /> : <Pause size={18} />}
          </button>
          <button onClick={onExit} style={{ background: '#111', color: '#ff6b8b', border: 'none', borderRadius: '8px', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="score-strip" style={{ display: 'flex', gap: '12px', padding: '12px 16px', background: '#0a0a0a', overflow: 'auto' }}>
        {players.filter(Boolean).map((player: any) => (
          <div key={player.id} style={{ 
            display: 'flex', alignItems: 'center', gap: '8px', background: '#111', 
            border: player.side === mySide ? `2px solid ${player.color}` : '1px solid #333',
            borderRadius: '12px', padding: '8px 12px', minWidth: '120px'
          }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: player.color }} />
            <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '14px' }}>{player.name}</span>
            <strong style={{ color: player.color, marginLeft: 'auto' }}>{scores[player.id] ?? 0}</strong>
          </div>
        ))}
      </div>

      <section className="arena-stage" style={{ width: '100%', maxWidth: '100vw', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          className="arena-frame"
          ref={arenaRef}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{
            touchAction: 'none',
            position: 'relative',
            width: `min(95vw, 760px, ${(88 * (world.w / world.h)).toFixed(2)}vh)`,
            aspectRatio: `${world.w} / ${world.h}`,
            margin: '0 auto',
            borderRadius: '32px',
            overflow: 'hidden',
            background: '#000',
            boxShadow: '0 0 0 2px #111, 0 0 40px rgba(0,229,255,0.25)',
          }}
        >
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
          <div ref={hintDotRef} style={{ position: 'absolute', width: '14px', height: '14px', borderRadius: '50%', background: '#00e5ff', border: '2px solid #fff', display: 'none', zIndex: 20, pointerEvents: 'none', animation: 'hintPulse 1.2s infinite' }} />
          <div ref={hintTextRef} style={{ position: 'absolute', background: '#00e5ff', color: '#000', padding: '6px 12px', borderRadius: 999, fontSize: '12px', fontWeight: 900, display: 'none', zIndex: 20, pointerEvents: 'none', whiteSpace: 'nowrap' }}>👆 حرك المضرب من هنا</div>

          {countdown > 0 && (
            <div style={{ position: 'absolute', inset: 0, background: countdownSide ? 'rgba(0,0,0,0.75)' : 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, pointerEvents: 'none' }}>
              <span style={{ fontSize: '110px', fontWeight: 900, color: '#ff2233', textShadow: '0 0 25px rgba(0,0,0,0.9)' }}>{countdown}</span>
              {countdownSide && (
                <span style={{ background: '#222', color: '#fff', padding: '8px 18px', borderRadius: 999, fontWeight: 800 }}>
                  {players.find((p: any) => p.side === countdownSide)?.name || ''} سجل!
                </span>
              )}
            </div>
          )}

          {lastGoal && !celebrating && (
            <div style={{ position: 'absolute', top: '48%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(255,34,51,0.92)', color: '#fff', padding: '12px 22px', borderRadius: 12, fontWeight: 900, zIndex: 11 }}>
              هدف! {lastGoal}
            </div>
          )}

          {celebrating && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, gap: '8px' }}>
              <div style={{ fontSize: '48px', fontWeight: 900, color: '#ffcf5a', textShadow: '0 0 20px #ffcf5a' }}>
                {celebrating?.name ?? 'لاعب'} فاز!
              </div>
              <div style={{ fontSize: '24px', color: '#fff', background: '#222', padding: '8px 24px', borderRadius: '999px' }}>
                جولة {currentRound} / {settings.seriesRounds}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function draw(context: CanvasRenderingContext2D, state: any, players: Player[], now: number, isServing: boolean, world = RECTANGULAR_WORLD, myAngle = 0) {
  const canvas = context.canvas as HTMLCanvasElement;
  const sx = canvas.width / world.w;
  const sy = canvas.height / world.h;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.restore();

  context.save();
  context.translate(world.w / 2, world.h / 2);
  context.rotate(myAngle);
  context.translate(-world.w / 2, -world.h / 2);

  const outerRadius = 36;
  const borderOuter = 32;
  const borderInner = 14;

  context.fillStyle = '#000000';
  context.fillRect(0, 0, world.w, world.h);

  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + w - r, y);
    context.quadraticCurveTo(x + w, y, x + w, y + r);
    context.lineTo(x + w, y + h - r);
    context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    context.lineTo(x + r, y + h);
    context.quadraticCurveTo(x, y + h, x, y + h - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  };

  context.fillStyle = '#0c0c0c';
  rr(0, 0, world.w, world.h, outerRadius);
  context.fill();

  const ledX = borderOuter - 6;
  const ledY = borderOuter - 6;
  const ledW = world.w - (borderOuter - 6) * 2;
  const ledH = world.h - (borderOuter - 6) * 2;
  const ledR = outerRadius - 10;

  let ledGrad: CanvasGradient;
  if (typeof (context as any).createConicGradient === 'function') {
    ledGrad = (context as any).createConicGradient(-Math.PI * 0.78, world.w / 2, world.h / 2);
    ledGrad.addColorStop(0.00, '#00e5ff');
    ledGrad.addColorStop(0.20, '#7c4dff');
    ledGrad.addColorStop(0.40, '#ff2d78');
    ledGrad.addColorStop(0.60, '#ff7a28');
    ledGrad.addColorStop(0.80, '#ffcf5a');
    ledGrad.addColorStop(1.00, '#00e5ff');
  } else {
    ledGrad = context.createLinearGradient(ledX, ledY, ledX + ledW, ledY + ledH);
    ledGrad.addColorStop(0, '#00e5ff');
    ledGrad.addColorStop(0.5, '#ff2d78');
    ledGrad.addColorStop(1, '#ff8a2a');
  }

  context.save();
  context.shadowBlur = 35;
  context.shadowColor = '#00e5ff';
  context.strokeStyle = ledGrad;
  context.lineWidth = 12;
  context.lineCap = 'round';
  rr(ledX, ledY, ledW, ledH, ledR);
  context.stroke();
  context.restore();

  context.strokeStyle = 'rgba(255,255,255,0.95)';
  context.lineWidth = 4;
  rr(ledX, ledY, ledW, ledH, ledR);
  context.stroke();

  const innerX = borderOuter + borderInner;
  const innerY = borderOuter + borderInner;
  const innerW = world.w - (borderOuter + borderInner) * 2;
  const innerH = world.h - (borderOuter + borderInner) * 2;
  const innerR = outerRadius - 18;

  context.fillStyle = '#f3f5f7';
  rr(innerX, innerY, innerW, innerH, innerR);
  context.fill();

  // رسم الكرة
  const screenRadius = 11 * Math.min(sx, sy);
  const rx = screenRadius / sx;
  const ry = screenRadius / sy;
  context.save();
  context.shadowColor = '#ff1a2e';
  context.shadowBlur = isServing ? 32 : 22;
  context.fillStyle = '#ff2233';
  context.beginPath();
  context.ellipse(state.ball.x, state.ball.y, rx, ry, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  // رسم المضارب
  const colors = Object.fromEntries(players.map((player) => [player.side, player.color]));
  const COLORS_FB = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];
  const active = (side: Player['side']) => {
    if (players.some((player) => player.side === side)) return true;
    const count = Math.max(2, players.length || 2);
    const req = count === 2 ? ['bottom', 'top'] : ['bottom', 'top', 'right', 'left'];
    return (req as string[]).includes(side);
  };

  const drawHatPaddle = (x: number, y: number, color: string) => {
    const size = PADDLE_SIZE;
    context.save();
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 20;
    context.beginPath();
    context.arc(x, y, size / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  };

  if (active('top')) drawHatPaddle(state.paddles.top.x, state.paddles.top.y, colors.top ?? COLORS_FB[1]);
  if (active('bottom')) drawHatPaddle(state.paddles.bottom.x, state.paddles.bottom.y, colors.bottom ?? COLORS_FB[0]);
  if (active('left')) drawHatPaddle(state.paddles.left.x, state.paddles.left.y, colors.left ?? COLORS_FB[3]);
  if (active('right')) drawHatPaddle(state.paddles.right.x, state.paddles.right.y, colors.right ?? COLORS_FB[2]);

  if (state.countdown > 0) {
    context.save();
    context.fillStyle = 'rgba(0,0,0,0.78)';
    context.fillRect(0, 0, world.w, world.h);
    context.fillStyle = '#ff2233';
    context.font = 'bold 120px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = '#ff2233';
    context.shadowBlur = 28;
    context.fillText(String(state.countdown), world.w / 2, world.h / 2);
    context.shadowBlur = 0;
    context.restore();
  }

  context.restore();
}

export { GameScreen };