import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Pause, Play, X, RotateCcw, Camera, Eye, EyeOff, ZoomIn, ZoomOut, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, RotateCw, Video, Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { socket } from '../socket.tsx';

type Player = { id: number | string; name: string; color: string; side: 'top' | 'right' | 'bottom' | 'left'; computer: boolean; socketId?: string };
type Settings = any;
type Scores = Record<string | number, number>;

function createAirHockeySurface(worldW: number, worldH: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f2f4f6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a0a0a';
  const cols = 12;
  const rows = 24;
  const spacingX = canvas.width / cols;
  const spacingY = canvas.height / rows;
  for (let y = spacingY / 2; y < canvas.height; y += spacingY) {
    for (let x = spacingX / 2; x < canvas.width; x += spacingX) {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(worldW / 400, worldH / 400);
  tex.anisotropy = 2;
  return tex;
}

function createNeonGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  grad.addColorStop(0.0, '#00e5ff');
  grad.addColorStop(0.2, '#7c4dff');
  grad.addColorStop(0.4, '#ff2d78');
  grad.addColorStop(0.6, '#ff7a28');
  grad.addColorStop(0.8, '#ffcf5a');
  grad.addColorStop(1.0, '#00e5ff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildRoundedRectPoints(w: number, h: number, r: number, segmentsPerCorner = 8) {
  const pts: THREE.Vector3[] = [];
  const addArc = (cx: number, cz: number, a0: number, a1: number) => {
    for (let i = 0; i <= segmentsPerCorner; i++) {
      const t = a0 + (a1 - a0) * (i / segmentsPerCorner);
      pts.push(new THREE.Vector3(cx + Math.cos(t) * r, 0, cz + Math.sin(t) * r));
    }
  };
  addArc(r, r, Math.PI, Math.PI * 1.5);
  addArc(w - r, r, Math.PI * 1.5, Math.PI * 2);
  addArc(w - r, h - r, 0, Math.PI * 0.5);
  addArc(r, h - r, Math.PI * 0.5, Math.PI);
  return pts;
}

function setup3DArenaLighting(scene: THREE.Scene, worldWidth: number, worldHeight: number) {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  const neonColors = [0x00e5ff, 0xffcf5a, 0xbf5af2, 0xff4081];
  const cornerPositions = [
    { x: 0, z: 0 },
    { x: worldWidth, z: worldHeight },
    { x: 0, z: worldHeight },
    { x: worldWidth, z: 0 },
  ];
  cornerPositions.forEach((pos, idx) => {
    const pointLight = new THREE.PointLight(neonColors[idx % 4], 0.8, Math.max(worldWidth, worldHeight) * 1.2);
    pointLight.position.set(pos.x, 40, pos.z);
    scene.add(pointLight);
  });
}

function createArenaFrame(worldW: number, worldH: number) {
  const group = new THREE.Group();
  const bezelThickness = Math.max(24, Math.min(worldW, worldH) * 0.045);
  const bezelHeight = 24;
  const bezelY = 11;
  const bezelMat = new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.4, metalness: 0.5 });
  const bezelPieces = [
    { w: worldW + bezelThickness * 2, d: bezelThickness, x: worldW / 2, z: -bezelThickness / 2 },
    { w: worldW + bezelThickness * 2, d: bezelThickness, x: worldW / 2, z: worldH + bezelThickness / 2 },
    { w: bezelThickness, d: worldH, x: -bezelThickness / 2, z: worldH / 2 },
    { w: bezelThickness, d: worldH, x: worldW + bezelThickness / 2, z: worldH / 2 },
  ];
  bezelPieces.forEach((p) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, bezelHeight, p.d), bezelMat);
    mesh.position.set(p.x, bezelY, p.z);
    group.add(mesh);
  });
  const neonRadius = Math.min(40, Math.min(worldW, worldH) * 0.08);
  const neonPts = buildRoundedRectPoints(worldW, worldH, neonRadius, 8);
  const neonCurve = new THREE.CatmullRomCurve3(neonPts, true, 'catmullrom', 0.15);
  const neonGeo = new THREE.TubeGeometry(neonCurve, 120, 5.5, 8, true);
  const neonTex = createNeonGradientTexture();
  const neonMat = new THREE.MeshBasicMaterial({ map: neonTex || undefined });
  const neonTube = new THREE.Mesh(neonGeo, neonMat);
  neonTube.position.y = 19.5;
  group.add(neonTube);
  return group;
}

function getArenaWorld(count: number, size: any = 'medium') {
  const ARENA_SCALES: any = { small: 0.8, medium: 1.0, large: 1.25, xlarge: 1.5 };
  const RECT = { w: 800, h: 1250 };
  const SQUARE = { w: 1200, h: 1200 };
  // FIXED: 3 players now also square
  const base = count >= 3 ? SQUARE : RECT;
  const sc = ARENA_SCALES[size] || 1;
  return { w: base.w * sc, h: base.h * sc };
}

const CAM_PRESETS_3D = {
  top: { angle: 0, distance: 400, height: 1600, name: 'من الأعلى', nameEn: 'Top View' },
  bottom: { angle: Math.PI, distance: 500, height: 650, name: 'خلفك', nameEn: 'Behind You' },
  topPlayer: { angle: 0, distance: 500, height: 650, name: 'خلف الخصم', nameEn: 'Behind Enemy' },
  iso: { angle: 0.6, distance: 1150, height: 950, name: 'مائل', nameEn: 'Isometric' },
  sideLeft: { angle: -Math.PI / 2, distance: 1000, height: 500, name: 'يسار', nameEn: 'Left' },
  sideRight: { angle: Math.PI / 2, distance: 1000, height: 500, name: 'يمين', nameEn: 'Right' },
} as const;
type Cam3DPresetKey = keyof typeof CAM_PRESETS_3D;

export function GameScreen3D({ roomCode, isHost, players, settings, scores, lastGoal, paused, onGoal, onTimeUp, onPause, onExit }: { roomCode: string; isHost: boolean; players: Player[]; settings: Settings; scores: Scores; lastGoal: string | null; paused: boolean; onGoal: (p: Player) => void; onTimeUp: () => void; onPause: () => void; onExit: () => void; }) {
  const { i18n } = useTranslation();
  const mountRef = useRef<HTMLDivElement>(null);
  const [timeLeft, setTimeLeft] = useState(settings.mode === 'time' ? settings.duration : 0);
  const [rally, setRally] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const pausedRef = useRef(paused);
  const gameEndedRef = useRef(false);
  const frameIdRef = useRef<number>(0);
  pausedRef.current = paused;

  const world = useMemo(() => getArenaWorld(players.length, settings.arenaSize), [players.length, settings.arenaSize]);
  const initialCam = useMemo(() => {
    const camDist = players.length >= 3 ? 1350 : 1350;
    return { angle: 0, targetAngle: 0, distance: camDist, targetDistance: camDist, height: 950, targetHeight: 950, targetX: world.w / 2, targetZ: world.h / 2, lookX: world.w / 2, lookZ: world.h / 2 };
  }, [world, players.length]);

  const cam = useRef({ ...initialCam });
  const threeRef = useRef<any>(null);
  const stateRef = useRef({
    ball: { x: world.w / 2, y: world.h / 2, vx: 5, vy: 6 },
    // top/bottom store an X coordinate (position along width)
    // left/right store a Z coordinate (position along height/depth)
    paddles: { top: world.w / 2, right: world.h / 2, bottom: world.w / 2, left: world.h / 2 },
    last: performance.now(),
    elapsed: 0,
    rally: 0,
    countdown: 0,
    countdownStart: 0,
  });

  // NEW: stable string key so the scene-build effect only reruns when the roster actually changes
  // (must be declared BEFORE the effect that uses it in its dependency array)
  const playersKey = useMemo(() => players.map(p => `${p.side}:${p.color}`).join(','), [players]);

  const [showCamMenu, setShowCamMenu] = useState(false);
  const [hideUI, setHideUI] = useState(false);
  const [currentPreset, setCurrentPreset] = useState<Cam3DPresetKey>('iso');
  const isAr = i18n.language?.startsWith('ar');

  const getInitialSpeed = useCallback(() => 6 + settings.ballSpeed * 0.5, [settings.ballSpeed]);

  const getMySide = useCallback((): Player['side'] => {
    return (players.find((p) => p.socketId === socket.id)?.side ?? players[0]?.side ?? 'bottom') as Player['side'];
  }, [players]);

  const isOfflineMode = !socket.connected || players.length <= 1;

  const createHatPaddle = useCallback((color: string) => {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.15,
      metalness: 0.25,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.45
    });
    const base = new THREE.Mesh(new THREE.TorusGeometry(24, 7, 16, 24), mat);
    base.rotation.x = Math.PI / 2;
    base.position.y = 7;
    group.add(base);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(18, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.position.y = 14;
    group.add(dome);
    return group;
  }, []);

  const resetCamera = useCallback(() => { cam.current = { ...initialCam }; setCurrentPreset('iso'); }, [initialCam]);

  const applyPreset = useCallback((key: Cam3DPresetKey) => {
    const p = CAM_PRESETS_3D[key];
    cam.current.targetAngle = p.angle;
    cam.current.targetDistance = p.distance;
    cam.current.targetHeight = p.height;
    setCurrentPreset(key);
  }, []);

  const zoomCam = useCallback((dir: number) => {
    cam.current.targetDistance = Math.max(300, Math.min(2000, cam.current.targetDistance * (dir > 0 ? 0.85 : 1.18)));
  }, []);

  const rotateCam = useCallback((dir: 'left' | 'right' | 'up' | 'down') => {
    if (dir === 'left') cam.current.targetAngle -= 0.4;
    if (dir === 'right') cam.current.targetAngle += 0.4;
    if (dir === 'up') cam.current.targetHeight = Math.min(1800, cam.current.targetHeight + 120);
    if (dir === 'down') cam.current.targetHeight = Math.max(250, cam.current.targetHeight - 120);
  }, []);

  // POINTER INPUT — now handles all four sides (top/bottom move along X, left/right move along Z)
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const mouse = new THREE.Vector2();
    const handlePointerMove = (e: PointerEvent) => {
      if (!e.isPrimary || !threeRef.current) return;
      const mySide = getMySide();
      const rect = el.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, threeRef.current.camera);
      const target = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, target)) {
        if (mySide === 'top' || mySide === 'bottom') {
          const clampedX = Math.max(45, Math.min(world.w - 45, target.x));
          stateRef.current.paddles[mySide] = clampedX;
          if (!isOfflineMode && !isHost) {
            socket.emit('paddle-input', { code: roomCode, side: mySide, x: clampedX });
          }
        } else if (mySide === 'left' || mySide === 'right') {
          const clampedZ = Math.max(45, Math.min(world.h - 45, target.z));
          stateRef.current.paddles[mySide] = clampedZ;
          if (!isOfflineMode && !isHost) {
            socket.emit('paddle-input', { code: roomCode, side: mySide, x: clampedZ });
          }
        }
      }
    };
    el.addEventListener('pointerdown', handlePointerMove as any);
    el.addEventListener('pointermove', handlePointerMove as any);
    return () => {
      el.removeEventListener('pointerdown', handlePointerMove as any);
      el.removeEventListener('pointermove', handlePointerMove as any);
    };
  }, [world.w, world.h, getMySide, isOfflineMode, isHost, roomCode]);

  // NETWORK SYNC — host now accepts input for all four sides
  useEffect(() => {
    if (isOfflineMode) return;
    if (isHost) {
      const handleInput = (data: { side: Player['side']; x: number }) => {
        if (data.side === 'top' || data.side === 'bottom') {
          stateRef.current.paddles[data.side] = Math.max(45, Math.min(world.w - 45, data.x));
        } else if (data.side === 'left' || data.side === 'right') {
          stateRef.current.paddles[data.side] = Math.max(45, Math.min(world.h - 45, data.x));
        }
      };
      socket.on('paddle-input', handleInput);
      return () => { socket.off('paddle-input', handleInput); };
    }
    const handleState = (serverState: any) => {
      if (!serverState) return;
      if (serverState.ball) stateRef.current.ball = serverState.ball;
      if (serverState.paddles) stateRef.current.paddles = serverState.paddles;
      if (serverState.countdown !== undefined) stateRef.current.countdown = serverState.countdown;
    };
    socket.on('game-state', handleState);
    return () => { socket.off('game-state', handleState); };
  }, [isHost, isOfflineMode, world.w, world.h]);

  // SCENE / MESH SETUP — rebuilds only when arena size or roster composition changes
  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    if (threeRef.current?.renderer) {
      try {
        threeRef.current.renderer.dispose();
        threeRef.current.renderer.forceContextLoss();
        if (mount.contains(threeRef.current.renderer.domElement)) mount.removeChild(threeRef.current.renderer.domElement);
      } catch {}
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');
    setup3DArenaLighting(scene, world.w, world.h);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(200, 900, 300);
    scene.add(dir);
    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 10, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false, depth: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);
    const tableGroup = new THREE.Group();
    const surfaceTexture = createAirHockeySurface(world.w, world.h);
    const tableMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', map: surfaceTexture || undefined, metalness: 0.05, roughness: 0.35 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(world.w, 18, world.h), tableMaterial);
    table.position.set(world.w / 2, 9, world.h / 2);
    tableGroup.add(table);
    scene.add(tableGroup);
    const frame = createArenaFrame(world.w, world.h);
    scene.add(frame);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(12, 24, 24), new THREE.MeshStandardMaterial({ color: '#ff1a2e', emissive: '#ff0011', emissiveIntensity: 0.85 }));
    ball.position.y = 23;
    scene.add(ball);
    const paddles: Record<string, THREE.Group> = {};

    players.forEach(p => {
      const g = createHatPaddle(p.color);
      scene.add(g);
      paddles[p.side] = g;
    });

    threeRef.current = { scene, camera, renderer, ball, paddles, surfaceTexture, tableMaterial };
    const ro = new ResizeObserver(() => {
      if (!mountRef.current || !threeRef.current) return;
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    });
    ro.observe(mount);
    return () => {
      ro.disconnect();
      try {
        renderer.dispose();
        renderer.forceContextLoss();
        surfaceTexture?.dispose();
        tableMaterial.dispose();
      } catch {}
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      threeRef.current = null;
    };
  }, [world.w, world.h, playersKey]);

  // GAME LOOP — physics + render, now covers top/bottom/left/right
  useEffect(() => {
    const state = stateRef.current;
    const playerForSide = (side: Player['side']) => players.find(p => p.side === side);
    const activeSide = (side: Player['side']) => players.some(p => p.side === side);
    const runsPhysics = isHost || isOfflineMode;

    const launchBall = () => {
      const spd = getInitialSpeed();
      const dirY = Math.random() > 0.5 ? 1 : -1;
      const ang = (Math.random() - 0.5) * 0.8;
      state.ball.vx = Math.sin(ang) * spd;
      state.ball.vy = Math.cos(ang) * spd * dirY;
    };
    if (runsPhysics) launchBall();

    const tick = (now: number) => {
      const delta = Math.min((now - state.last) / 16.67, 2);
      state.last = now;
      if (!pausedRef.current && !gameEndedRef.current && runsPhysics) {
        state.elapsed += delta / 60;
        if (settings.mode === 'time' && state.elapsed > 1) {
          state.elapsed = 0;
          setTimeLeft(t => { if (t <= 1) { gameEndedRef.current = true; onTimeUp(); return 0; } return t - 1; });
        }
        if (state.countdown > 0) {
          const e = (now - state.countdownStart) / 1000;
          if (e >= 3) { state.countdown = 0; setCountdown(0); launchBall(); }
          else { setCountdown(Math.ceil(3 - e)); }
        } else {
          const topActive = activeSide('top');
          const bottomActive = activeSide('bottom');
          const leftActive = activeSide('left');
          const rightActive = activeSide('right');
          const topPlayer = playerForSide('top');
          const bottomPlayer = playerForSide('bottom');
          const leftPlayer = playerForSide('left');
          const rightPlayer = playerForSide('right');

          // --- AI for computer-controlled paddles on every active side ---
          if (topActive && (!topPlayer || topPlayer.computer)) {
            const topSpeed = 5 * delta;
            if (state.paddles.top < state.ball.x - 12) state.paddles.top += topSpeed;
            else if (state.paddles.top > state.ball.x + 12) state.paddles.top -= topSpeed;
            state.paddles.top = Math.max(45, Math.min(world.w - 45, state.paddles.top));
          }
          if (bottomActive && bottomPlayer?.computer) {
            const botSpeed = 5 * delta;
            if (state.paddles.bottom < state.ball.x - 12) state.paddles.bottom += botSpeed;
            else if (state.paddles.bottom > state.ball.x + 12) state.paddles.bottom -= botSpeed;
            state.paddles.bottom = Math.max(45, Math.min(world.w - 45, state.paddles.bottom));
          }
          if (leftActive && (!leftPlayer || leftPlayer.computer)) {
            const leftSpeed = 5 * delta;
            if (state.paddles.left < state.ball.y - 12) state.paddles.left += leftSpeed;
            else if (state.paddles.left > state.ball.y + 12) state.paddles.left -= leftSpeed;
            state.paddles.left = Math.max(45, Math.min(world.h - 45, state.paddles.left));
          }
          if (rightActive && rightPlayer?.computer) {
            const rightSpeed = 5 * delta;
            if (state.paddles.right < state.ball.y - 12) state.paddles.right += rightSpeed;
            else if (state.paddles.right > state.ball.y + 12) state.paddles.right -= rightSpeed;
            state.paddles.right = Math.max(45, Math.min(world.h - 45, state.paddles.right));
          }

          state.ball.x += state.ball.vx * delta;
          state.ball.y += state.ball.vy * delta;
          const r = 12;
          const paddleRadius = 24;

          // --- bottom paddle collision ---
          if (bottomActive) {
            const botP = state.paddles.bottom;
            const paddleYBot = world.h - 52;
            const distBot = Math.hypot(state.ball.x - botP, state.ball.y - paddleYBot);
            if (distBot < r + paddleRadius && state.ball.vy > 0) {
              const nx = (state.ball.x - botP) / distBot;
              const ny = (state.ball.y - paddleYBot) / distBot;
              state.ball.x = botP + nx * (r + paddleRadius + 1);
              state.ball.y = paddleYBot + ny * (r + paddleRadius + 1);
              state.ball.vy = -Math.abs(state.ball.vy);
              state.ball.vx += nx * 3.5;
              state.rally++;
            }
          }

          // --- top paddle collision ---
          if (topActive) {
            const topP = state.paddles.top;
            const paddleYTop = 52;
            const distTop = Math.hypot(state.ball.x - topP, state.ball.y - paddleYTop);
            if (distTop < r + paddleRadius && state.ball.vy < 0) {
              const nx = (state.ball.x - topP) / distTop;
              const ny = (state.ball.y - paddleYTop) / distTop;
              state.ball.x = topP + nx * (r + paddleRadius + 1);
              state.ball.y = paddleYTop + ny * (r + paddleRadius + 1);
              state.ball.vy = Math.abs(state.ball.vy);
              state.ball.vx += nx * 3.5;
              state.rally++;
            }
          }

          // --- NEW: left paddle collision ---
          if (leftActive) {
            const leftP = state.paddles.left;
            const paddleXLeft = 52;
            const distLeft = Math.hypot(state.ball.x - paddleXLeft, state.ball.y - leftP);
            if (distLeft < r + paddleRadius && state.ball.vx < 0) {
              const nx = (state.ball.x - paddleXLeft) / distLeft;
              const ny = (state.ball.y - leftP) / distLeft;
              state.ball.x = paddleXLeft + nx * (r + paddleRadius + 1);
              state.ball.y = leftP + ny * (r + paddleRadius + 1);
              state.ball.vx = Math.abs(state.ball.vx);
              state.ball.vy += ny * 3.5;
              state.rally++;
            }
          }

          // --- NEW: right paddle collision ---
          if (rightActive) {
            const rightP = state.paddles.right;
            const paddleXRight = world.w - 52;
            const distRight = Math.hypot(state.ball.x - paddleXRight, state.ball.y - rightP);
            if (distRight < r + paddleRadius && state.ball.vx > 0) {
              const nx = (state.ball.x - paddleXRight) / distRight;
              const ny = (state.ball.y - rightP) / distRight;
              state.ball.x = paddleXRight + nx * (r + paddleRadius + 1);
              state.ball.y = rightP + ny * (r + paddleRadius + 1);
              state.ball.vx = -Math.abs(state.ball.vx);
              state.ball.vy += ny * 3.5;
              state.rally++;
            }
          }

          const GOAL_W = 280;
          const GX1 = (world.w - GOAL_W) / 2, GX2 = GX1 + GOAL_W;
          const GOAL_H = 280;
          const GY1 = (world.h - GOAL_H) / 2, GY2 = GY1 + GOAL_H;
          const inGoalX = (x: number) => x >= GX1 && x <= GX2;
          const inGoalY = (y: number) => y >= GY1 && y <= GY2;
          let missed: Player | undefined;

          // top wall
          if (state.ball.y - r <= 0) {
            if (topActive) {
              if (inGoalX(state.ball.x)) missed = playerForSide('top');
              else { state.ball.y = r + 1; state.ball.vy = Math.abs(state.ball.vy); }
            } else {
              state.ball.y = r + 1; state.ball.vy = Math.abs(state.ball.vy);
            }
          }
          // bottom wall
          if (!missed && state.ball.y + r >= world.h) {
            if (bottomActive) {
              if (inGoalX(state.ball.x)) missed = playerForSide('bottom');
              else { state.ball.y = world.h - r - 1; state.ball.vy = -Math.abs(state.ball.vy); }
            } else {
              state.ball.y = world.h - r - 1; state.ball.vy = -Math.abs(state.ball.vy);
            }
          }
          // NEW: left wall
          if (!missed && state.ball.x - r <= 0) {
            if (leftActive) {
              if (inGoalY(state.ball.y)) missed = playerForSide('left');
              else { state.ball.x = r + 1; state.ball.vx = Math.abs(state.ball.vx); }
            } else {
              state.ball.x = r + 1; state.ball.vx = Math.abs(state.ball.vx);
            }
          }
          // NEW: right wall
          if (!missed && state.ball.x + r >= world.w) {
            if (rightActive) {
              if (inGoalY(state.ball.y)) missed = playerForSide('right');
              else { state.ball.x = world.w - r - 1; state.ball.vx = -Math.abs(state.ball.vx); }
            } else {
              state.ball.x = world.w - r - 1; state.ball.vx = -Math.abs(state.ball.vx);