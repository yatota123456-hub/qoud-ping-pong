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
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Pure glossy white like reference
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Small black dots - denser like reference
  ctx.fillStyle = '#0a0a0a';
  const cols = 28;
  const rows = 56;
  const spacingX = canvas.width / cols;
  const spacingY = canvas.height / rows;
  for (let y = spacingY / 2; y < canvas.height; y += spacingY) {
    for (let x = spacingX / 2; x < canvas.width; x += spacingX) {
      const offset = (Math.floor(y / spacingY) % 2 === 0) ? 0 : spacingX/2;
      ctx.beginPath();
      ctx.arc(x + offset, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(worldW / 380, worldH / 380);
  tex.anisotropy = 4;
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
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
  scene.add(ambientLight);
  // Soft directional for glossy reflections like reference
  const dir = new THREE.DirectionalLight(0xffffff, 0.55);
  dir.position.set(worldWidth*0.3, 800, worldHeight*0.2);
  scene.add(dir);
  // Neon corner glows - brighter
  const neonColors = [0x00e5ff, 0xff7a28, 0xbf5af2, 0xff2d78];
  const cornerPositions = [
    { x: worldWidth*0.15, z: worldHeight*0.15 },
    { x: worldWidth*0.85, z: worldHeight*0.85 },
    { x: worldWidth*0.15, z: worldHeight*0.85 },
    { x: worldWidth*0.85, z: worldHeight*0.15 },
  ];
  cornerPositions.forEach((pos, idx) => {
    const pointLight = new THREE.PointLight(neonColors[idx % 4], 1.4, Math.max(worldWidth, worldHeight) * 1.1);
    pointLight.position.set(pos.x, 65, pos.z);
    scene.add(pointLight);
  });
  // Center soft fill to mimic photo studio lighting
  const centerLight = new THREE.PointLight(0xffffff, 0.45, worldWidth*1.5);
  centerLight.position.set(worldWidth/2, 400, worldHeight/2);
  scene.add(centerLight);
}

function createArenaFrame(worldW: number, worldH: number) {
  const group = new THREE.Group();
  const bezelThickness = Math.max(32, Math.min(worldW, worldH) * 0.055);
  const bezelHeight = 28;
  const bezelY = 13;

  // Glossy black frame - exactly like reference image
  const bezelMat = new THREE.MeshStandardMaterial({ 
    color: '#080808', 
    roughness: 0.18, 
    metalness: 0.85,
    envMapIntensity: 1.2
  });
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

  // Inner neon LED strip - bright like reference
  const neonRadius = Math.min(42, Math.min(worldW, worldH) * 0.065);
  const neonPts = buildRoundedRectPoints(worldW, worldH, neonRadius, 12);
  const neonCurve = new THREE.CatmullRomCurve3(neonPts, true, 'catmullrom', 0.15);
  const neonGeo = new THREE.TubeGeometry(neonCurve, 160, 6.5, 10, true);
  const neonTex = createNeonGradientTexture();
  const neonMat = new THREE.MeshStandardMaterial({ 
    map: neonTex || undefined,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: neonTex || undefined,
    emissiveIntensity: 1.8,
    roughness: 0.2,
    metalness: 0.1
  });
  const neonTube = new THREE.Mesh(neonGeo, neonMat);
  neonTube.position.y = 22.5;
  group.add(neonTube);

  // Outer thin LED line - like reference image outer glow
  const outerRadius = neonRadius + bezelThickness * 0.6;
  const outerW = worldW + bezelThickness * 0.8;
  const outerH = worldH + bezelThickness * 0.8;
  const outerPts = buildRoundedRectPoints(outerW, outerH, outerRadius, 12);
  const outerCurve = new THREE.CatmullRomCurve3(outerPts.map(p => new THREE.Vector3(p.x - bezelThickness*0.4, 0, p.z - bezelThickness*0.4)), true, 'catmullrom', 0.15);
  const outerGeo = new THREE.TubeGeometry(outerCurve, 160, 1.8, 6, true);
  const outerMat = new THREE.MeshBasicMaterial({ 
    map: neonTex || undefined,
    transparent: true,
    opacity: 0.85
  });
  const outerTube = new THREE.Mesh(outerGeo, outerMat);
  outerTube.position.y = 26;
  group.add(outerTube);

  // Goal gaps - black blocks like reference
  const goalW = 220;
  const goalH = 32;
  const goalMat = new THREE.MeshStandardMaterial({ color: '#020202', roughness: 0.1, metalness: 0.9 });
  const goalTop = new THREE.Mesh(new THREE.BoxGeometry(goalW, goalH, bezelThickness), goalMat);
  goalTop.position.set(worldW/2, bezelY+2, -bezelThickness/2);
  group.add(goalTop);
  const goalBottom = new THREE.Mesh(new THREE.BoxGeometry(goalW, goalH, bezelThickness), goalMat);
  goalBottom.position.set(worldW/2, bezelY+2, worldH + bezelThickness/2);
  group.add(goalBottom);
  if (worldW >= 1100) { // square mode - also side goals
    const goalLeft = new THREE.Mesh(new THREE.BoxGeometry(bezelThickness, goalH, goalW), goalMat);
    goalLeft.position.set(-bezelThickness/2, bezelY+2, worldH/2);
    group.add(goalLeft);
    const goalRight = new THREE.Mesh(new THREE.BoxGeometry(bezelThickness, goalH, goalW), goalMat);
    goalRight.position.set(worldW + bezelThickness/2, bezelY+2, worldH/2);
    group.add(goalRight);
  }

  return group;
}

function getArenaWorld(count: number, size: any = 'medium') {
  const ARENA_SCALES: any = { small: 0.8, medium: 1.0, large: 1.25, xlarge: 1.5 };
  const RECT = { w: 800, h: 1250 };
  const SQUARE = { w: 1200, h: 1200 };
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

  const world = useMemo(() => getArenaWorld(Math.max(players.length, settings.players || 2), settings.arenaSize), [players.length, settings.players, settings.arenaSize]);
  const initialCam = useMemo(() => {
    const camDist = players.length >= 3 ? 1350 : 1350;
    return { angle: 0, targetAngle: 0, distance: camDist, targetDistance: camDist, height: 950, targetHeight: 950, targetX: world.w / 2, targetZ: world.h / 2, lookX: world.w / 2, lookZ: world.h / 2 };
  }, [world, players.length]);

  const cam = useRef({ ...initialCam });
  const threeRef = useRef<any>(null);
  const stateRef = useRef({
    ball: { x: world.w / 2, y: world.h / 2, vx: 5, vy: 6 },
    paddles: { top: world.w / 2, right: world.h / 2, bottom: world.w / 2, left: world.h / 2 },
    last: performance.now(),
    elapsed: 0,
    rally: 0,
    countdown: 0,
    countdownStart: 0,
  });

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
    const tableMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', map: surfaceTexture || undefined, metalness: 0.08, roughness: 0.12, envMapIntensity: 0.8 });
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
    const COLORS_FALLBACK = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];
    const SIDES_ALL: Player['side'][] = ['bottom', 'top', 'right', 'left'];
    // Ensure we have a paddle for each active side even if players prop is incomplete
    const activeSides = players.length >= 3 ? SIDES_ALL.slice(0, players.length) : (['bottom','top'] as Player['side'][]).slice(0, Math.max(2, players.length));
    const ensureCount = Math.max(2, players.length, settings.players || 2);
    const sidesNeeded = ensureCount === 2 ? (['bottom','top'] as Player['side'][]) : ensureCount === 3 ? (['bottom','top','right'] as Player['side'][]) : SIDES_ALL;
    sidesNeeded.forEach((side, idx) => {
      const existing = players.find(p => p.side === side);
      const color = existing?.color || COLORS_FALLBACK[idx] || '#ffcf5a';
      const g = createHatPaddle(color);
      scene.add(g);
      paddles[side] = g;
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

  useEffect(() => {
    const state = stateRef.current;
    const needPlayers = Math.max(2, players.length, settings.players || 2);
    const sidesForCount: Player['side'][] = needPlayers === 2 ? ['bottom','top'] : needPlayers === 3 ? ['bottom','top','right'] : ['bottom','top','right','left'];
    const playerForSide = (side: Player['side']) => players.find(p => p.side === side);
    const activeSide = (side: Player['side']) => sidesForCount.includes(side);
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
          // FIXED AI - Predictive and fast
          const mySide = (players.find((p:any) => p.socketId === socket.id)?.side ?? 'bottom') as any;
          const isComputerSide = (side: string, player: any) => {
            if (side === mySide && !isOfflineMode) return false;
            if (isOfflineMode) {
              if (side === 'bottom') return false;
              return true;
            }
            if (!player) return true;
            return !!player.computer;
          };
          const aiSpeed = (diff: number) => (settings.difficulty === 'hard' ? 14 : settings.difficulty === 'easy' ? 7 : 10) * delta * diff;
          const predX = state.ball.x + state.ball.vx * 14;
          const predY = state.ball.y + state.ball.vy * 14;
          if (topActive && isComputerSide('top', topPlayer)) {
            const s = aiSpeed(1);
            if (state.paddles.top < predX - 8) state.paddles.top += s;
            else if (state.paddles.top > predX + 8) state.paddles.top -= s;
            state.paddles.top = Math.max(55, Math.min(world.w - 55, state.paddles.top));
          }
          if (bottomActive && isComputerSide('bottom', bottomPlayer)) {
            const s = aiSpeed(1);
            if (state.paddles.bottom < predX - 8) state.paddles.bottom += s;
            else if (state.paddles.bottom > predX + 8) state.paddles.bottom -= s;
            state.paddles.bottom = Math.max(55, Math.min(world.w - 55, state.paddles.bottom));
          }
          if (leftActive && isComputerSide('left', leftPlayer)) {
            const s = aiSpeed(1);
            if (state.paddles.left < predY - 8) state.paddles.left += s;
            else if (state.paddles.left > predY + 8) state.paddles.left -= s;
            state.paddles.left = Math.max(55, Math.min(world.h - 55, state.paddles.left));
          }
          if (rightActive && isComputerSide('right', rightPlayer)) {
            const s = aiSpeed(1);
            if (state.paddles.right < predY - 8) state.paddles.right += s;
            else if (state.paddles.right > predY + 8) state.paddles.right -= s;
            state.paddles.right = Math.max(55, Math.min(world.h - 55, state.paddles.right));
          }
          state.ball.x += state.ball.vx * delta;
          state.ball.y += state.ball.vy * delta;
          const r = 12;
          const paddleRadius = 24;
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
          if (state.ball.y - r <= 0) {
            if (topActive) {
              if (inGoalX(state.ball.x)) missed = playerForSide('top');
              else { state.ball.y = r + 1; state.ball.vy = Math.abs(state.ball.vy); }
            } else {
              state.ball.y = r + 1; state.ball.vy = Math.abs(state.ball.vy);
            }
          }
          if (!missed && state.ball.y + r >= world.h) {
            if (bottomActive) {
              if (inGoalX(state.ball.x)) missed = playerForSide('bottom');
              else { state.ball.y = world.h - r - 1; state.ball.vy = -Math.abs(state.ball.vy); }
            } else {
              state.ball.y = world.h - r - 1; state.ball.vy = -Math.abs(state.ball.vy);
            }
          }
          if (!missed && state.ball.x - r <= 0) {
            if (leftActive) {
              if (inGoalY(state.ball.y)) missed = playerForSide('left');
              else { state.ball.x = r + 1; state.ball.vx = Math.abs(state.ball.vx); }
            } else {
              state.ball.x = r + 1; state.ball.vx = Math.abs(state.ball.vx);
            }
          }
          if (!missed && state.ball.x + r >= world.w) {
            if (rightActive) {
              if (inGoalY(state.ball.y)) missed = playerForSide('right');
              else { state.ball.x = world.w - r - 1; state.ball.vx = -Math.abs(state.ball.vx); }
            } else {
              state.ball.x = world.w - r - 1; state.ball.vx = -Math.abs(state.ball.vx);
            }
          }
          if (missed) {
            const realMissed = playerForSide(missed.side);
            onGoal(realMissed);
            state.countdown = 3;
            state.countdownStart = now;
            setCountdown(3);
            state.ball.x = world.w / 2;
            state.ball.y = world.h / 2;
            launchBall();
          }
          setRally(state.rally);
        }
        if (!isOfflineMode) {
          socket.emit('game-state', { code: roomCode, state: { ball: state.ball, paddles: state.paddles, countdown: state.countdown } });
        }
      }
      if (threeRef.current) {
        const { ball, paddles, camera, renderer } = threeRef.current;
        const c = cam.current;
        c.angle += (c.targetAngle - c.angle) * 0.1;
        c.distance += (c.targetDistance - c.distance) * 0.1;
        c.height += (c.targetHeight - c.height) * 0.1;
        const cx = c.lookX + Math.sin(c.angle) * c.distance;
        const cz = c.lookZ + Math.cos(c.angle) * c.distance;
        camera.position.set(cx, c.height, cz);
        camera.lookAt(c.lookX, 0, c.lookZ);
        ball.position.x = state.ball.x;
        ball.position.z = state.ball.y;
        if (paddles['bottom']) paddles['bottom'].position.set(state.paddles.bottom, 12, world.h - 52);
        if (paddles['top']) paddles['top'].position.set(state.paddles.top, 12, 52);
        if (paddles['left']) paddles['left'].position.set(52, 12, state.paddles.left);
        if (paddles['right']) paddles['right'].position.set(world.w - 52, 12, state.paddles.right);
        renderer.render(threeRef.current.scene, camera);
      }
      frameIdRef.current = requestAnimationFrame(tick);
    };
    frameIdRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameIdRef.current);
  }, [players, settings, onGoal, onTimeUp, world, getInitialSpeed, isHost, isOfflineMode, roomCode]);

  function formatTime(s: number) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

  return (
    <main className="game-shell" style={{ background: '#000', display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      {hideUI && (<button onClick={() => setHideUI(false)} style={{ position: 'absolute', top: 16, right: 16, zIndex: 30, background: '#00e5ff', color: '#000', borderRadius: 999, padding: '8px 14px', fontWeight: 900, display: 'flex', gap: 6, alignItems: 'center', border: 'none', cursor: 'pointer' }}><Eye size={16} /> {isAr ? 'اظهار' : 'Show'}</button>)}
      {!hideUI && (
        <>
          <header className="game-topbar" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 24px', alignItems: 'center', zIndex: 10, background: '#0a0a0a', borderBottom: '1px solid #1a1a1a' }}>
            <div className="brand" style={{ color: '#fff', fontWeight: 'bold' }}>QOUD 3D • {players.length >= 3 ? (isAr ? 'مربع' : 'Square') : (isAr ? 'مستطيل' : 'Rect')}</div>
            <div className="match-meta" style={{ color: '#fff' }}><b>{settings.mode === 'time' ? formatTime(timeLeft) : '∞'}</b> | Rally: {rally}</div>
            <div className="game-actions" style={{ display: 'flex', gap: '6px' }}>
              <button className="game-icon" onClick={() => setShowCamMenu(v => !v)} title={isAr ? 'الكاميرا' : 'Camera'} style={{ background: showCamMenu ? '#00e5ff' : '#111', color: showCamMenu ? '#000' : '#fff', borderRadius: 10, width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #333' }}>
                <Camera size={18} />
              </button>
              <button className="game-icon" onClick={onPause} style={{ background: '#111', color: '#fff', borderRadius: 10, width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #333' }}>{paused ? <Play size={18} /> : <Pause size={18} />}</button>
              <button className="game-icon" onClick={resetCamera} style={{ background: '#ffcf5a', color: '#000', borderRadius: 10, width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none' }}><RotateCcw size={16} /></button>
              <button className="game-icon" onClick={onExit} style={{ background: '#111', color: '#ff6b8b', borderRadius: 10, width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #333' }}><X size={18} /></button>
            </div>
          </header>
          <div style={{ display: 'flex', gap: '8px', padding: '10px 16px', background: '#0a0a0a', borderBottom: '1px solid #1a1a1a', overflowX: 'auto' }}>
            {(() => {
              const COLORS_FB = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];
              const SIDES_FB: Player['side'][] = ['bottom','top','right','left'];
              const need = Math.max(2, players.length, settings.players || 2);
              const sides = need === 2 ? SIDES_FB.slice(0,2) : need === 3 ? SIDES_FB.slice(0,3) : SIDES_FB.slice(0,4);
              return sides.map((side, idx) => {
                const p = players.find((pl: any) => pl.side === side) || { id: String(idx), name: side === 'top' ? 'سامي' : side === 'right' ? 'ليان' : side === 'left' ? 'كريم' : 'نورا', color: COLORS_FB[idx], side };
                return (
                  <div key={p.id + side} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#151515', border: `1px solid ${p.color}`, borderRadius: '20px', padding: '6px 12px', minWidth: '90px' }}>
                    <span style={{ background: p.color, width: '10px', height: '10px', borderRadius: '50%', display: 'inline-block' }} />
                    <span style={{ color: '#fff', fontSize: '13px', fontWeight: 700 }}>{p.name}</span>
                    <strong style={{ color: p.color, marginLeft: 'auto' }}>{scores[p.id] ?? scores[idx] ?? 0}</strong>
                  </div>
                );
              });
            })()}
          </div>
        </>
      )}
      <div ref={mountRef} style={{ width: '100%', flex: 1, borderRadius: '22px', overflow: 'hidden', position: 'relative', touchAction: 'none' }}>
        {countdown > 0 && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}><span style={{ fontSize: '120px', fontWeight: 900, color: '#ff2233' }}>{countdown}</span></div>}
        {lastGoal && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(255,34,51,0.9)', color: '#fff', padding: '12px 24px', borderRadius: '12px', fontWeight: 900, zIndex: 6 }}>{isAr ? 'هدف!' : 'GOAL!'} {lastGoal}</div>}
        {showCamMenu && !hideUI && (<div style={{ position: 'absolute', top: 12, right: 12, zIndex: 20, background: 'rgba(10,10,10,0.94)', backdropFilter: 'blur(14px)', border: '1px solid #222', borderRadius: 16, padding: 14, width: 300, color: '#fff', display: 'flex', flexDirection: 'column', gap: 12 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Video size={16} /> {isAr ? 'تحكم الكاميرا' : 'Camera'}</b><button onClick={() => setShowCamMenu(false)} style={{ background: '#222', borderRadius: 8, padding: 4, border: 'none', color: '#fff' }}><X size={14} /></button></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{(Object.keys(CAM_PRESETS_3D) as Cam3DPresetKey[]).map(k => (<button key={k} onClick={() => applyPreset(k)} style={{ padding: '10px 8px', borderRadius: 10, fontWeight: 800, fontSize: 12, border: currentPreset === k ? '2px solid #00e5ff' : '1px solid #333', background: currentPreset === k ? '#111' : '#0a0a0a', color: currentPreset === k ? '#00e5ff' : '#aaa', cursor: 'pointer' }}>{isAr ? CAM_PRESETS_3D[k].name : CAM_PRESETS_3D[k].nameEn}</button>))}</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, justifyItems: 'center' }}><div /><button onClick={() => rotateCam('up')} style={btnStyle}><ArrowUp size={18} /></button><div /><button onClick={() => rotateCam('left')} style={btnStyle}><ArrowLeft size={18} /></button><button onClick={resetCamera} style={{ ...btnStyle, background: '#ff4081', color: '#fff' }}><Maximize2 size={16} /></button><button onClick={() => rotateCam('right')} style={btnStyle}><ArrowRight size={18} /></button><div /><button onClick={() => rotateCam('down')} style={btnStyle}><ArrowDown size={18} /></button><div /></div><div style={{ display: 'flex', gap: 8 }}><button onClick={() => zoomCam(1)} style={{ flex: 1, ...btnStyle }}><ZoomIn size={18} /> {isAr ? 'قرب' : 'In'}</button><button onClick={() => zoomCam(-1)} style={{ flex: 1, ...btnStyle }}><ZoomOut size={18} /> {isAr ? 'بعد' : 'Out'}</button></div><div style={{ display: 'flex', gap: 8 }}><button onClick={() => rotateCam('left')} style={{ flex: 1, ...btnStyle }}><RotateCcw size={16} /> {isAr ? 'يسار' : 'Left'}</button><button onClick={() => rotateCam('right')} style={{ flex: 1, ...btnStyle }}><RotateCw size={16} /> {isAr ? 'يمين' : 'Right'}</button></div><button onClick={() => { setHideUI(true); setShowCamMenu(false); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, background: '#111', border: '1px solid #333', color: '#888', cursor: 'pointer' }}><EyeOff size={16} /> {isAr ? 'اخفاء كل الازرار' : 'Hide All UI'}</button><small style={{ opacity: 0.5, fontSize: 10, textAlign: 'center' }}>{isAr ? 'التحكم بالماوس: اسحب للتدوير' : 'Drag table to move paddle'}</small></div>)}
      </div>
    </main>
  );
}
const btnStyle: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fff', borderRadius: 10, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700, cursor: 'pointer' };
