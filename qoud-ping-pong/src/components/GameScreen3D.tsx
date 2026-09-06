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
  canvas.width = 1024;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a0a0a';
  const cols = 28;
  const rows = 56;
  const spacingX = canvas.width / cols;
  const spacingY = canvas.height / rows;
  for (let y = spacingY / 2; y < canvas.height; y += spacingY) {
    for (let x = spacingX / 2; x < canvas.width; x += spacingX) {
      const offset = (Math.floor(y / spacingY) % 2 === 0)? 0 : spacingX/2;
      ctx.beginPath();
      ctx.arc(x + offset, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(worldW / 380, worldH / 380);
  tex.anisotropy = 16;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

function createNeonGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 64;
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
  tex.anisotropy = 8;
  return tex;
}

function buildRoundedRectPoints(w: number, h: number, r: number, segmentsPerCorner = 16) {
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
  const dir = new THREE.DirectionalLight(0xffffff, 0.55);
  dir.position.set(worldWidth*0.3, 800, worldHeight*0.2);
  scene.add(dir);
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
  const centerLight = new THREE.PointLight(0xffffff, 0.45, worldWidth*1.5);
  centerLight.position.set(worldWidth/2, 400, worldHeight/2);
  scene.add(centerLight);
}

function createArenaFrame(worldW: number, worldH: number) {
  const group = new THREE.Group();
  const bezelThickness = Math.max(32, Math.min(worldW, worldH) * 0.055);
  const bezelHeight = 28;
  const bezelY = 13;
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
  const neonRadius = Math.min(42, Math.min(worldW, worldH) * 0.065);
  const neonPts = buildRoundedRectPoints(worldW, worldH, neonRadius, 16);
  const neonCurve = new THREE.CatmullRomCurve3(neonPts, true, 'catmullrom', 0.15);
  const neonGeo = new THREE.TubeGeometry(neonCurve, 220, 6.5, 16, true);
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
  const outerRadius = neonRadius + bezelThickness * 0.6;
  const outerW = worldW + bezelThickness * 0.8;
  const outerH = worldH + bezelThickness * 0.8;
  const outerPts = buildRoundedRectPoints(outerW, outerH, outerRadius, 16);
  const outerCurve = new THREE.CatmullRomCurve3(outerPts.map(p => new THREE.Vector3(p.x - bezelThickness*0.4, 0, p.z - bezelThickness*0.4)), true, 'catmullrom', 0.15);
  const outerGeo = new THREE.TubeGeometry(outerCurve, 220, 1.8, 12, true);
  const outerMat = new THREE.MeshBasicMaterial({
    map: neonTex || undefined,
    transparent: true,
    opacity: 0.85
  });
  const outerTube = new THREE.Mesh(outerGeo, outerMat);
  outerTube.position.y = 26;
  group.add(outerTube);
  const goalW = 260;
  const goalH = 32;
  const goalMat = new THREE.MeshStandardMaterial({ color: '#020202', roughness: 0.1, metalness: 0.9 });
  const goalTop = new THREE.Mesh(new THREE.BoxGeometry(goalW, goalH, bezelThickness), goalMat);
  goalTop.position.set(worldW/2, bezelY+2, -bezelThickness/2);
  group.add(goalTop);
  const goalBottom = new THREE.Mesh(new THREE.BoxGeometry(goalW, goalH, bezelThickness), goalMat);
  goalBottom.position.set(worldW/2, bezelY+2, worldH + bezelThickness/2);
  group.add(goalBottom);
  if (worldW >= 1100) {
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
  const RECT = { w: 700, h: 1050 };
  const SQUARE = { w: 1000, h: 1000 };
  const base = count >= 3? SQUARE : RECT;
  const sc = ARENA_SCALES[size] || 1;
  return { w: base.w * sc, h: base.h * sc };
}

const CAM_PRESETS_3D = {
  top: { angle: Math.PI, distance: 400, height: 1600, name: 'من الأعلى', nameEn: 'Top View' },
  bottom: { angle: 0, distance: 1550, height: 1150, name: 'خلفك', nameEn: 'Behind You' },
  topPlayer: { angle: Math.PI, distance: 650, height: 750, name: 'خلف الخصم', nameEn: 'Behind Enemy' },
  iso: { angle: 0.6, distance: 1250, height: 1050, name: 'مائل', nameEn: 'Isometric' },
  sideLeft: { angle: -Math.PI / 2, distance: 1100, height: 600, name: 'يسار', nameEn: 'Left' },
  sideRight: { angle: Math.PI / 2, distance: 1100, height: 600, name: 'يمين', nameEn: 'Right' },
} as const;
type Cam3DPresetKey = keyof typeof CAM_PRESETS_3D;

export function GameScreen3D({ roomCode, isHost, players, settings, scores, lastGoal, paused, onGoal, onTimeUp, onPause, onExit }: { roomCode: string; isHost: boolean; players: Player[]; settings: Settings; scores: Scores; lastGoal: string | null; paused: boolean; onGoal: (p: Player) => void; onTimeUp: () => void; onPause: () => void; onExit: () => void; }) {
  const { i18n } = useTranslation();
  const mountRef = useRef<HTMLDivElement>(null);
  const hintDotRef = useRef<HTMLDivElement>(null);
  const hintTextRef = useRef<HTMLDivElement>(null);
  const hasDraggedRef = useRef(false);
  const noDragStartRef = useRef(performance.now());
  const [timeLeft, setTimeLeft] = useState(settings.mode === 'time'? settings.duration : 0);
  const [rally, setRally] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const pausedRef = useRef(paused);
  const gameEndedRef = useRef(false);
  const frameIdRef = useRef<number>(0);
  pausedRef.current = paused;

  const world = useMemo(() => getArenaWorld(Math.max(players.length, settings.players || 2), settings.arenaSize), [players.length, settings.players, settings.arenaSize]);
  const initialCam = useMemo(() => {
    const preset = CAM_PRESETS_3D.bottom;
    return { angle: preset.angle, targetAngle: preset.angle, distance: preset.distance, targetDistance: preset.distance, height: preset.height, targetHeight: preset.height, targetX: world.w / 2, targetZ: world.h / 2, lookX: world.w / 2, lookZ: world.h / 2 };
  }, [world]);

  const cam = useRef({...initialCam });
  const threeRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext|null>(null);
  const hitEffectsRef = useRef<any[]>([]);
  const shakeRef = useRef({ intensity: 0 });
  const stateRef = useRef({
    ball: { x: world.w / 2, y: world.h / 2, vx: 0, vy: 0 },
    paddles: {
      top: { x: world.w / 2, z: 52 },
      right: { x: world.w - 52, z: world.h / 2 },
      bottom: { x: world.w / 2, z: world.h - 52 },
      left: { x: 52, z: world.h / 2 }
    } as any,
    targetPaddles: {
      top: { x: world.w / 2, z: 52 },
      right: { x: world.w - 52, z: world.h / 2 },
      bottom: { x: world.w / 2, z: world.h - 52 },
      left: { x: 52, z: world.h / 2 }
    } as any,
    lastPaddles: {
      top: { x: world.w / 2, z: 52 },
      right: { x: world.w - 52, z: world.h / 2 },
      bottom: { x: world.w / 2, z: world.h - 52 },
      left: { x: 52, z: world.h / 2 }
    } as any,
    last: performance.now(),
    elapsed: 0,
    rally: 0,
    countdown: 0,
    countdownStart: 0,
    countdownSide: null as Player['side'] | null,
    serving: { active: false, side: 'bottom' as Player['side'], startTime: 0, requested: false }
  });

  const playersKey = useMemo(() => players.map(p => `${p.side}:${p.color}`).join(','), [players]);

  const [showCamMenu, setShowCamMenu] = useState(false);
  const [hideUI, setHideUI] = useState(false);
  const [currentPreset, setCurrentPreset] = useState<Cam3DPresetKey>('bottom');
  const isAr = i18n.language?.startsWith('ar');

  const getInitialSpeed = useCallback(() => 6 + settings.ballSpeed * 0.5, [settings.ballSpeed]);

  const getMySide = useCallback((): Player['side'] => {
    return (players.find((p) => p.socketId === socket.id)?.side?? players[0]?.side?? 'bottom') as Player['side'];
  }, [players]);

  const isOfflineMode =!socket.connected || players.length <= 1;

  const createHatPaddle = useCallback((color: string) => {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.15,
      metalness: 0.25,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.45
    });
    const base = new THREE.Mesh(new THREE.TorusGeometry(24, 7, 24, 32), mat);
    base.rotation.x = Math.PI / 2;
    base.position.y = 7;
    group.add(base);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(18, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.position.y = 14;
    group.add(dome);
    return group;
  }, []);

  const resetCamera = useCallback(() => {
    const preset = CAM_PRESETS_3D.bottom;
    cam.current = {
      angle: preset.angle,
      targetAngle: preset.angle,
      distance: preset.distance,
      targetDistance: preset.distance,
      height: preset.height,
      targetHeight: preset.height,
      targetX: world.w / 2,
      targetZ: world.h / 2,
      lookX: world.w / 2,
      lookZ: world.h / 2
    };
    setCurrentPreset('bottom');
  }, [world]);

  const applyPreset = useCallback((key: Cam3DPresetKey) => {
    const p = CAM_PRESETS_3D[key];
    cam.current.targetAngle = p.angle;
    cam.current.targetDistance = p.distance;
    cam.current.targetHeight = p.height;
    setCurrentPreset(key);
  }, []);

  const zoomCam = useCallback((dir: number) => {
    cam.current.targetDistance = Math.max(300, Math.min(2200, cam.current.targetDistance * (dir > 0? 0.85 : 1.18)));
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
    const clamp = (v:number,mn:number,mx:number)=>Math.max(mn,Math.min(mx,v));
    const handlePointerMove = (e: PointerEvent) => {
      if (!e.isPrimary ||!threeRef.current) return;
      hasDraggedRef.current = true;
      if(hintDotRef.current) hintDotRef.current.style.display='none';
      if(hintTextRef.current) hintTextRef.current.style.display='none';
      const mySide = getMySide();
      const isTouch = (e as any).pointerType === 'touch' || (e as any).pointerType === 'pen';
      const OFFSET = isTouch? 75 : 40;
      const rect = el.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, threeRef.current.camera);
      const target = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, target)) {
        let tx = target.x;
        let tz = target.z;
        if (mySide === 'top') {
          const clampedX = clamp(tx, 45, world.w - 45);
          const clampedZ = clamp(tz + OFFSET, 45, world.h * 0.32);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          if (!isOfflineMode &&!isHost) socket.emit('paddle-input', { code: roomCode, side: mySide, x: clampedX, z: clampedZ });
        } else if (mySide === 'bottom') {
          const clampedX = clamp(tx, 45, world.w - 45);
          const clampedZ = clamp(tz - OFFSET, world.h * 0.68, world.h - 45);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          if (!isOfflineMode &&!isHost) socket.emit('paddle-input', { code: roomCode, side: mySide, x: clampedX, z: clampedZ });
        } else if (mySide === 'left') {
          const clampedX = clamp(tx + OFFSET, 45, world.w * 0.32);
          const clampedZ = clamp(tz, 45, world.h - 45);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          if (!isOfflineMode &&!isHost) socket.emit('paddle-input', { code: roomCode, side: mySide, x: clampedX, z: clampedZ });
        } else if (mySide === 'right') {
          const clampedX = clamp(tx - OFFSET, world.w * 0.68, world.w - 45);
          const clampedZ = clamp(tz, 45, world.h - 45);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          if (!isOfflineMode &&!isHost) socket.emit('paddle-input', { code: roomCode, side: mySide, x: clampedX, z: clampedZ });
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
      const handleInput = (data: { side: Player['side']; x: number; z?: number }) => {
        const clamp = (v:number,mn:number,mx:number)=>Math.max(mn,Math.min(mx,v));
        if (data.side === 'top' || data.side === 'bottom') {
          stateRef.current.targetPaddles[data.side].x = clamp(data.x, 45, world.w - 45);
          if (data.z!== undefined) {
            const minZ = data.side === 'top'? 45 : world.h*0.68;
            const maxZ = data.side === 'top'? world.h*0.32 : world.h-45;
            stateRef.current.targetPaddles[data.side].z = clamp(data.z, minZ, maxZ);
          }
        } else if (data.side === 'left' || data.side === 'right') {
          if (data.z!== undefined) stateRef.current.targetPaddles[data.side].z = clamp(data.z, 45, world.h - 45);
          if (data.x!== undefined) {
            const minX = data.side === 'left'? 45 : world.w*0.68;
            const maxX = data.side === 'left'? world.w*0.32 : world.w-45;
            stateRef.current.targetPaddles[data.side].x = clamp(data.x, minX, maxX);
          } else {
            stateRef.current.targetPaddles[data.side].z = clamp(data.x, 45, world.h - 45);
          }
        }
      };
      socket.on('paddle-input', handleInput);
      return () => { socket.off('paddle-input', handleInput); };
    }
    const handleState = (serverState: any) => {
      if (!serverState) return;
      if (serverState.ball) stateRef.current.ball = serverState.ball;
      if (serverState.paddles) {
        Object.keys(serverState.paddles).forEach((k: any) => {
          const val = serverState.paddles[k];
          if (typeof val === 'number') {
            if (k === 'top' || k === 'bottom') stateRef.current.targetPaddles[k].x = Math.max(45, Math.min(world.w - 45, val));
            else stateRef.current.targetPaddles[k].z = Math.max(45, Math.min(world.h - 45, val));
          } else if (val && typeof val.x === 'number') {
            stateRef.current.targetPaddles[k].x = val.x;
            stateRef.current.targetPaddles[k].z = val.z;
          }
        });
      }
      if (serverState.countdown!== undefined) stateRef.current.countdown = serverState.countdown;
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
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
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
    const ball = new THREE.Mesh(new THREE.SphereGeometry(12, 32, 32), new THREE.MeshStandardMaterial({ color: '#ff1a2e', emissive: '#ff0011', emissiveIntensity: 0.85 }));
    ball.position.y = 23;
    scene.add(ball);
    const paddles: Record<string, THREE.Group> = {};
    const COLORS_FALLBACK = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];
    const ensureCount = Math.max(2, players.length, settings.players || 2);
    const sidesNeeded = ensureCount === 2? (['bottom','top'] as Player['side'][]) : ensureCount === 3? (['bottom','top','right'] as Player['side'][]) : (['bottom','top','right','left'] as Player['side'][]);
    sidesNeeded.forEach((side, idx) => {
      const existing = players.find(p => p.side === side);
      const color = existing?.color || COLORS_FALLBACK[idx] || '#ffcf5a';
      const g = createHatPaddle(color);
      scene.add(g);
      paddles[side] = g;
    });
    const hitGroup = new THREE.Group();
    scene.add(hitGroup);
    threeRef.current = { scene, camera, renderer, ball, paddles, hitGroup, surfaceTexture, tableMaterial };
    const ro = new ResizeObserver(() => {
      if (!mountRef.current ||!threeRef.current) return;
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    const sidesForCount: Player['side'][] = needPlayers === 2? ['bottom','top'] : needPlayers === 3? ['bottom','top','right'] : ['bottom','top','right','left'];
    const playerForSide = (side: Player['side']) => players.find(p => p.side === side);
    const activeSide = (side: Player['side']) => sidesForCount.includes(side);
    const runsPhysics = isHost || isOfflineMode;
    const launchBall = () => {
      const spd = getInitialSpeed();
      const dirY = Math.random() > 0.5? 1 : -1;
      const ang = (Math.random() - 0.5) * 0.8;
      state.ball.vx = Math.sin(ang) * spd;
      state.ball.vy = Math.cos(ang) * spd * dirY;
      state.serving.active = false;
    };
    if (runsPhysics) {
      launchBall();
      state.paddles = {
        top: {...state.targetPaddles.top },
        bottom: {...state.targetPaddles.bottom },
        right: {...state.targetPaddles.right },
        left: {...state.targetPaddles.left },
      } as any;
      state.lastPaddles = {
        top: {...state.paddles.top },
        bottom: {...state.paddles.bottom },
        right: {...state.paddles.right },
        left: {...state.paddles.left },
      } as any;
    }

    const triggerHitEffect = (x: number, z: number, power: number, color: string) => {
      const p = Math.max(0, Math.min(1, power));
      if (settings.sound) {
        try {
          if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          const ctx = audioCtxRef.current;
          if (ctx.state === 'suspended') ctx.resume();
          const t = ctx.currentTime;
          const panVal = Math.max(-1, Math.min(1, (x / world.w) * 2 - 1));
          const panner = (ctx as any).createStereoPanner? (ctx as any).createStereoPanner() : null;
          if (panner) panner.pan.value = panVal;
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(90 + p * 800, t);
          o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
          g.gain.setValueAtTime(0.15 + p * 0.85, t);
          g.gain.exponentialRampToValueAtTime(0.01, t + 0.4 + p * 0.25);
          if (panner) { o.connect(g); g.connect(panner); panner.connect(ctx.destination); } else { o.connect(g).connect(ctx.destination); }
          o.start(t); o.stop(t + 0.45);
          if (p > 0.3) {
            const o2 = ctx.createOscillator();
            const g2 = ctx.createGain();
            const p2 = (ctx as any).createStereoPanner? (ctx as any).createStereoPanner() : null;
            if (p2) p2.pan.value = panVal * 0.8;
            o2.type = p > 0.7? 'square' : 'triangle';
            o2.frequency.setValueAtTime(600 + p * 2000, t);
            o2.frequency.exponentialRampToValueAtTime(180, t + 0.15);
            g2.gain.setValueAtTime(0.22 * p, t);
            g2.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
            if (p2) { o2.connect(g2); g2.connect(p2); p2.connect(ctx.destination); } else o2.connect(g2).connect(ctx.destination);
            o2.start(t); o2.stop(t + 0.2);
          }
        } catch {}
      }
      const playGoalSound = () => {
        if(!settings.sound) return;
        try{
          if(!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext||(window as any).webkitAudioContext)();
          const ctx = audioCtxRef.current; if(ctx.state==='suspended') ctx.resume(); const t = ctx.currentTime;
          [440,554,659,880].forEach((freq,i)=>{
            const o = ctx.createOscillator(); const g = ctx.createGain(); const p = (ctx as any).createStereoPanner?.(); if(p) p.pan.value = i%2===0? -0.2:0.2;
            o.type = i<2?'sine':'triangle'; o.frequency.setValueAtTime(freq, t+i*0.11);
            g.gain.setValueAtTime(0,t+i*0.11); g.gain.linearRampToValueAtTime(0.22,t+i*0.11+0.02); g.gain.exponentialRampToValueAtTime(0.001,t+i*0.11+0.45);
            if(p){o.connect(g); g.connect(p); p.connect(ctx.destination);} else o.connect(g).connect(ctx.destination);
            o.start(t+i*0.11); o.stop(t+i*0.11+0.5);
          });
        }catch{}
      };
      if (!threeRef.current?.hitGroup) return;
      const group = threeRef.current.hitGroup;
      const col = p > 0.7? '#ff2233' : p > 0.4? color : '#ffffff';
      const ringGeo = new THREE.RingGeometry(8, 12 + p * 26, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 15.5, z);
      group.add(ring);
      hitEffectsRef.current.push({ mesh: ring, born: performance.now(), power: p, isCore: false });

      if (p > 0.45) {
        const coreGeo = new THREE.CircleGeometry(4 + p * 10, 24);
        const coreMat = new THREE.MeshBasicMaterial({ color: '#ffcf5a', transparent: true, opacity: 0.9 });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.rotation.x = -Math.PI / 2;
        core.position.set(x, 15.8, z);
        group.add(core);
        hitEffectsRef.current.push({ mesh: core, born: performance.now(), power: p * 1.3, isCore: true });
      }
      shakeRef.current.intensity = Math.max(shakeRef.current.intensity, p * 18);
      if (threeRef.current?.ball) {
        const ballMat = threeRef.current.ball.material as THREE.MeshStandardMaterial;
        ballMat.emissiveIntensity = 0.85 + p * 3.5;
        setTimeout(() => { if (ballMat) ballMat.emissiveIntensity = 0.85; }, 120 + p * 80);
      }
    };

    const tick = (now: number) => {
      const delta = Math.min((now - state.last) / 16.67, 2);
      state.last = now;
      if (!pausedRef.current &&!gameEndedRef.current && runsPhysics) {
        state.elapsed += delta / 60;
        if (settings.mode === 'time' && state.elapsed > 1) {
          state.elapsed = 0;
          setTimeLeft(t => { if (t <= 1) { gameEndedRef.current = true; onTimeUp(); return 0; } return t - 1; });
        }
        if (state.countdown > 0) {
          const e = (now - state.countdownStart) / 1000;
          state.ball.x = world.w / 2; state.ball.y = world.h / 2; state.ball.vx = 0; state.ball.vy = 0;
          if (e >= 3) {
            state.countdown = 0; setCountdown(0); state.countdownSide = null;
            state.serving.active = false;
            launchBall();
          } else {
            setCountdown(Math.ceil(3 - e));
            if(hintDotRef.current) hintDotRef.current.style.display='none';
            if(hintTextRef.current) hintTextRef.current.style.display='none';
          }
        } else {
          const mySide = (players.find((p:any) => p.socketId === socket.id)?.side?? 'bottom') as any;
          const isComputerSide = (side: string, player: any) => {
            if (side === mySide &&!isOfflineMode) return false;
            if (isOfflineMode) { if (side === 'bottom') return false; return true; }
            if (!player) return true; return!!player.computer;
          };
          const clamp = (v: number, mn: number, mx: number) => Math.max(mn, Math.min(mx, v));
          const predX = state.ball.x + state.ball.vx * 14;
          const predY = state.ball.y + state.ball.vy * 14;
          state.lastPaddles = {
            top: {...state.paddles.top },
            bottom: {...state.paddles.bottom },
            right: {...state.paddles.right },
            left: {...state.paddles.left },
          } as any;

          (['top','bottom','right','left'] as Player['side'][]).forEach(side => {
            if (!activeSide(side)) return;
            const p = playerForSide(side);
            if (isComputerSide(side, p)) {
              if (side === 'bottom') {
                state.targetPaddles[side].x = clamp(predX, 55, world.w - 55);
                if (state.ball.y > world.h * 0.5) {
                  state.targetPaddles[side].z = clamp(predY, world.h * 0.68, world.h - 55);
                } else {
                  state.targetPaddles[side].z = clamp(world.h * 0.78, world.h * 0.68, world.h - 55);
                }
              } else if (side === 'top') {
                state.targetPaddles[side].x = clamp(predX, 55, world.w - 55);
                if (state.ball.y < world.h * 0.5) {
                  state.targetPaddles[side].z = clamp(predY, 55, world.h * 0.32);
                } else {
                  state.targetPaddles[side].z = clamp(world.h * 0.22, 55, world.h * 0.32);
                }
              } else if (side === 'left') {
                state.targetPaddles[side].z = clamp(predY, 55, world.h - 55);
                if (state.ball.x < world.w * 0.5) {
                  state.targetPaddles[side].x = clamp(predX, 55, world.w * 0.32);
                } else {
                  state.targetPaddles[side].x = clamp(world.w * 0.22, 55, world.w * 0.32);
                }
              } else if (side === 'right') {
                state.targetPaddles[side].z = clamp(predY, 55, world.h - 55);
                if (state.ball.x > world.w * 0.5) {
                  state.targetPaddles[side].x = clamp(predX, world.w * 0.68, world.w - 55);
                } else {
                  state.targetPaddles[side].x = clamp(world.w * 0.78, world.w * 0.68, world.w - 55);
                }
              }
            }
          });
          (['top','bottom','right','left'] as Player['side'][]).forEach(side => {
            if (!activeSide(side)) return;
            const p = playerForSide(side);
            const isHuman =!isComputerSide(side, p);
            const factor = isHuman? 0.38 : 0.18;
            state.paddles[side].x += (state.targetPaddles[side].x - state.paddles[side].x) * factor * delta;
            state.paddles[side].z += (state.targetPaddles[side].z - state.paddles[side].z) * factor * delta;
          });

          state.ball.x += state.ball.vx * delta; state.ball.y += state.ball.vy * delta;
          const r = 12; const paddleRadius = 24;

          const getForwardBoost = (side: Player['side']) => {
            const cur = state.paddles[side];
            const last = state.lastPaddles[side];
            const vx = cur.x - last.x;
            const vz = cur.z - last.z;
            let forward = 0;
            if (side === 'bottom') forward = -vz;
            if (side === 'top') forward = vz;
            if (side === 'left') forward = vx;
            if (side === 'right') forward = -vx;
            const speed = Math.hypot(vx, vz);
            return { vx, vz, forward, speed };
          };

          if (activeSide('bottom')) {
            const bp = state.paddles.bottom;
            const distBot = Math.hypot(state.ball.x - bp.x, state.ball.y - bp.z);
            if (distBot < r + paddleRadius && state.ball.vy > 0 && state.ball.y > bp.z - 20) {
              const nx = (state.ball.x - bp.x) / distBot; const ny = (state.ball.y - bp.z) / distBot;
              state.ball.x = bp.x + nx * (r + paddleRadius + 1); state.ball.y = bp.z + ny * (r + paddleRadius + 1);
              const { vx, vz, forward, speed } = getForwardBoost('bottom');
              let power = 1;
              if (forward > 0.5) power = 1 + Math.min(forward * 0.12, 0.7);
              state.ball.vy = -Math.abs(state.ball.vy) * power + vz * 0.9;
              state.ball.vx = state.ball.vx * power + vx * 0.9 + nx * 3.5;
              const hitPower = Math.min(1, (forward * 0.12 + speed * 0.08 + 0.15));
              const col = playerForSide('bottom')?.color || '#ffcf5a';
              triggerHitEffect(state.ball.x, state.ball.y, hitPower, col);
              state.rally++;
            }
          }
          if (activeSide('top')) {
            const tp = state.paddles.top;
            const distTop = Math.hypot(state.ball.x - tp.x, state.ball.y - tp.z);
            if (distTop < r + paddleRadius && state.ball.vy < 0 && state.ball.y < tp.z + 20) {
              const nx = (state.ball.x - tp.x) / distTop; const ny = (state.ball.y - tp.z) / distTop;
              state.ball.x = tp.x + nx * (r + paddleRadius + 1); state.ball.y = tp.z + ny * (r + paddleRadius + 1);
              const { vx, vz, forward, speed } = getForwardBoost('top');
              let power = 1;
              if (forward > 0.5) power = 1 + Math.min(forward * 0.12, 0.7);
              state.ball.vy = Math.abs(state.ball.vy) * power + vz * 0.9;
              state.ball.vx = state.ball.vx * power + vx * 0.9 + nx * 3.5;
              const hitPower = Math.min(1, (forward * 0.12 + speed * 0.08 + 0.15));
              const col = playerForSide('top')?.color || '#ff6b8b';
              triggerHitEffect(state.ball.x, state.ball.y, hitPower, col);
              state.rally++;
            }
          }
          if (activeSide('left')) {
            const lp = state.paddles.left;
            const distLeft = Math.hypot(state.ball.x - lp.x, state.ball.y - lp.z);
            if (distLeft < r + paddleRadius && state.ball.vx < 0 && state.ball.x > lp.x - 20) {
              const nx = (state.ball.x - lp.x) / distLeft; const ny = (state.ball.y - lp.z) / distLeft;
              state.ball.x = lp.x + nx * (r + paddleRadius + 1); state.ball.y = lp.z + ny * (r + paddleRadius + 1);
              const { vx, vz, forward, speed } = getForwardBoost('left');
              let power = 1;
              if (forward > 0.5) power = 1 + Math.min(forward * 0.12, 0.7);
              state.ball.vx = Math.abs(state.ball.vx) * power + vx * 0.9;
              state.ball.vy = state.ball.vy * power + vz * 0.9 + ny * 3.5;
              const hitPower = Math.min(1, (forward * 0.12 + speed * 0.08 + 0.15));
              const col = playerForSide('left')?.color || '#9b8cff';
              triggerHitEffect(state.ball.x, state.ball.y, hitPower, col);
              state.rally++;
            }
          }
          if (activeSide('right')) {
            const rp = state.paddles.right;
            const distRight = Math.hypot(state.ball.x - rp.x, state.ball.y - rp.z);
            if (distRight < r + paddleRadius && state.ball.vx > 0 && state.ball.x < rp.x + 20) {
              const nx = (state.ball.x - rp.x) / distRight; const ny = (state.ball.y - rp.z) / distRight;
              state.ball.x = rp.x + nx * (r + paddleRadius + 1); state.ball.y = rp.z + ny * (r + paddleRadius + 1);
              const { vx, vz, forward, speed } = getForwardBoost('right');
              let power = 1;
              if (forward > 0.5) power = 1 + Math.min(forward * 0.12, 0.7);
              state.ball.vx = -Math.abs(state.ball.vx) * power + vx * 0.9;
              state.ball.vy = state.ball.vy * power + vz * 0.9 + ny * 3.5;
              const hitPower = Math.min(1, (forward * 0.12 + speed * 0.08 + 0.15));
              const col = playerForSide('right')?.color || '#61e7c2';
              triggerHitEffect(state.ball.x, state.ball.y, hitPower, col);
              state.rally++;
            }
          }
          const maxBallSpeed = 34 + settings.ballSpeed * 1.6 + state.rally * 0.7;
          const curSpeed = Math.hypot(state.ball.vx, state.ball.vy);
          if (curSpeed > maxBallSpeed) { const scale = maxBallSpeed / curSpeed; state.ball.vx *= scale; state.ball.vy *= scale; }
          const GOAL_W = world.w >= 1100? 300 : 260;
          const GX1 = (world.w - GOAL_W) / 2, GX2 = GX1 + GOAL_W;
          const GY1 = (world.h - GOAL_W) / 2, GY2 = GY1 + GOAL_W;
          const inGoalX = (x: number) => x >= GX1 && x <= GX2;
          const inGoalY = (y: number) => y >= GY1 && y <= GY2;
          let missed: Player | undefined;
          if (state.ball.y - r <= 0) { if (activeSide('top')) { if (inGoalX(state.ball.x)) missed = playerForSide('top'); else { state.ball.y = r + 1; state.ball.vy = Math.abs(state.ball.vy); } } else { state.ball.y = r + 1; state.ball.vy = Math.abs(state.ball.vy); } }
          if (!missed && state.ball.y + r >= world.h) { if (activeSide('bottom')) { if (inGoalX(state.ball.x)) missed = playerForSide('bottom'); else { state.ball.y = world.h - r - 1; state.ball.vy = -Math.abs(state.ball.vy); } } else { state.ball.y = world.h - r - 1; state.ball.vy = -Math.abs(state.ball.vy); } }
          if (!missed && state.ball.x - r <= 0) { if (activeSide('left')) { if (inGoalY(state.ball.y)) missed = playerForSide('left'); else { state.ball.x = r + 1; state.ball.vx = Math.abs(state.ball.vx); } } else { state.ball.x = r + 1; state.ball.vx = Math.abs(state.ball.vx); } }
          if (!missed && state.ball.x + r >= world.w) { if (activeSide('right')) { if (inGoalY(state.ball.y)) missed = playerForSide('right'); else { state.ball.x = world.w - r - 1; state.ball.vx = -Math.abs(state.ball.vx); } } else { state.ball.x = world.w - r - 1; state.ball.vx = -Math.abs(state.ball.vx); } }
          if (missed) {
            const realMissed = playerForSide(missed.side)?? missed;
            playGoalSound();
            onGoal(realMissed);
            const opposite: Record<string, Player['side']> = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };
            const scorerSide = opposite[missed.side] as Player['side'];
            const scorer = playerForSide(scorerSide);
            state.ball.x = world.w / 2; state.ball.y = world.h / 2; state.ball.vx = 0; state.ball.vy = 0;
            state.countdown = 3; state.countdownStart = now; state.countdownSide = scorer? scorer.side : scorerSide;
            setCountdown(3); state.rally = 0; setRally(0);
            hasDraggedRef.current = false;
            noDragStartRef.current = now;
            if(hintDotRef.current) hintDotRef.current.style.display='none';
            if(hintTextRef.current) hintTextRef.current.style.display='none';
          } else { setRally(state.rally); }
        }
        if (!isOfflineMode) { socket.emit('game-state', { code: roomCode, state: { ball: state.ball, paddles: state.paddles, countdown: state.countdown } }); }
      }
      if (threeRef.current) {
        const { ball, paddles, camera, renderer, hitGroup } = threeRef.current; const c = cam.current;
        c.angle += (c.targetAngle - c.angle) * 0.1; c.distance += (c.targetDistance - c.distance) * 0.1; c.height += (c.targetHeight - c.height) * 0.1;
        let cx = c.lookX + Math.sin(c.angle) * c.distance;
        let cz = c.lookZ + Math.cos(c.angle) * c.distance;
        let cy = c.height;
        if (shakeRef.current.intensity > 0.1) {
          cx += (Math.random() - 0.5) * shakeRef.current.intensity;
          cz += (Math.random() - 0.5) * shakeRef.current.intensity;
          cy += (Math.random() - 0.5) * shakeRef.current.intensity * 0.5;
          shakeRef.current.intensity *= 0.88;
          if (shakeRef.current.intensity < 0.1) shakeRef.current.intensity = 0;
        }
        camera.position.set(cx, cy, cz); camera.lookAt(c.lookX, 0, c.lookZ);
        ball.position.x = state.ball.x; ball.position.z = state.ball.y;
        ball.visible = state.countdown === 0;
        if (paddles['bottom']) paddles['bottom'].position.set(state.paddles.bottom.x, 12, state.paddles.bottom.z);
        if (paddles['top']) paddles['top'].position.set(state.paddles.top.x, 12, state.paddles.top.z);
        if (paddles['left']) paddles['left'].position.set(state.paddles.left.x, 12, state.paddles.left.z);
        if (paddles['right']) paddles['right'].position.set(state.paddles.right.x, 12, state.paddles.right.z);

        if(!hasDraggedRef.current && hintDotRef.current && hintTextRef.current && mountRef.current){
          const elapsed = now - noDragStartRef.current;
          if(elapsed>3000 && state.countdown===0 &&!pausedRef.current &&!gameEndedRef.current){
            const mySide = getMySide();
            const p = state.paddles[mySide];
            const vec = new THREE.Vector3(p.x, 12, p.z);
            vec.project(camera);
            if(vec.z < 1 && vec.z > -1){
              const rect = mountRef.current.getBoundingClientRect();
              const sx = (vec.x * 0.5 + 0.5) * rect.width;
              const sy = (-vec.y * 0.5 + 0.5) * rect.height;
              hintDotRef.current.style.left = `${sx}px`;
              hintDotRef.current.style.top = `${sy+45}px`;
              hintDotRef.current.style.display = 'block';
              hintTextRef.current.style.left = `${sx+20}px`;
              hintTextRef.current.style.top = `${sy+30}px`;
              hintTextRef.current.style.display = 'block';
            }
          }
        }

        const nowMs = performance.now();
        hitEffectsRef.current = hitEffectsRef.current.filter((e: any) => {
          const age = (nowMs - e.born) / 1000;
          const life = 0.45 + e.power * 0.35;
          if (age > life) {
            hitGroup.remove(e.mesh);
            e.mesh.geometry.dispose();
            (e.mesh.material as any).dispose();
            return false;
          }
          const scale = 1 + age * (5 + e.power * 8);
          if (!e.isCore) e.mesh.scale.set(scale, scale, 1);
          else e.mesh.scale.set(1 + age * 2, 1 + age * 2, 1);
          (e.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (e.isCore? 0.9 : 0.95) - age * (1.8 - e.power * 0.5));
          return true;
        });

        renderer.render(threeRef.current.scene, camera);
      }
      frameIdRef.current = requestAnimationFrame(tick);
    };
    frameIdRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameIdRef.current);
  }, [players, settings, onGoal, onTimeUp, world, getInitialSpeed, isHost, isOfflineMode, roomCode]);

  function formatTime(s: number) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

  const getNameForSide = (side: Player['side'] | null) => {
    if (!side) return '';
    const p = players.find(pl => pl.side === side);
    if (p) return p.name;
    if (side === 'top') return 'سامي';
    if (side === 'right') return 'ليان';
    if (side === 'left') return 'كريم';
    return 'نورا';
  };

  return (
    <main className="game-shell" style={{ background: '#000', display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      {hideUI && (<button onClick={() => setHideUI(false)} style={{ position: 'absolute', top: 16, right: 16, zIndex: 30, background: '#00e5ff', color: '#000', borderRadius: 999, padding: '8px 14px', fontWeight: 900, display: 'flex', gap: 6, alignItems: 'center', border: 'none', cursor: 'pointer' }}><Eye size={16} /> {isAr? 'اظهار' : 'Show'}</button>)}
      {!hideUI && (
        <>
          <header className="game-topbar" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 24px', alignItems: 'center', zIndex: 10, background: '#0a0a0a', borderBottom: '1px solid #1a1a1a' }}>
            <div className="brand" style={{ color: '#fff', fontWeight: 'bold' }}>QOUD 3D • HD • STEREO</div>
            <div className="match-meta" style={{ color: '#fff' }}><b>{settings.mode === 'time'? formatTime(timeLeft) : '∞'}</b> | Rally: {rally}</div>
            <div className="game-actions" style={{ display: 'flex', gap: '6px' }}>
              <button className="game-icon" onClick={() => setShowCamMenu(v =>!v)} title={isAr? 'الكاميرا' : 'Camera'} style={{ background: showCamMenu? '#00e5ff' : '#111', color: showCamMenu? '#000' : '#fff', borderRadius: 10, width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #333' }}>
                <Camera size={18} />
              </button>
              <button className="game-icon" onClick={onPause} style={{ background: '#111', color: '#fff', borderRadius: 10, width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #333' }}>{paused? <Play size={18} /> : <Pause size={18} />}</button>
              <button className="game-icon" onClick={resetCamera} style={{ background: '#ffcf5a', color: '#000', borderRadius: 10, width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none' }}><RotateCcw size={16} /></button>
              <button className="game-icon" onClick={onExit} style={{ background: '#111', color: '#ff6b8b', borderRadius: 10, width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #333' }}><X size={18} /></button>
            </div>
          </header>
          <div style={{ display: 'flex', gap: '8px', padding: '10px 16px', background: '#0a0a0a', borderBottom: '1px solid #1a1a1a', overflowX: 'auto' }}>
            {(() => {
              const COLORS_FB = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];
              const SIDES_FB: Player['side'][] = ['bottom','top','right','left'];
              const need = Math.max(2, players.length, settings.players || 2);
              const sides = need === 2? SIDES_FB.slice(0,2) : need === 3? SIDES_FB.slice(0,3) : SIDES_FB.slice(0,4);
              return sides.map((side, idx) => {
                const p = players.find((pl: any) => pl.side === side) || { id: String(idx), name: side === 'top'? 'سامي' : side === 'right'? 'ليان' : side === 'left'? 'كريم' : 'نورا', color: COLORS_FB[idx], side };
                return (
                  <div key={p.id + side} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', background: '#151515', border: `1px solid ${p.color}`, borderRadius: '14px', padding: '6px 16px', minWidth: '90px' }}>
                    <strong style={{ color: p.color, fontSize: '20px', lineHeight: '1', fontWeight: 900 }}>{scores[p.id]?? 0}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ background: p.color, width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block' }} />
                      <span style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>{p.name}</span>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </>
      )}
      <div ref={mountRef} style={{ width: '100%', flex: 1, borderRadius: '22px', overflow: 'hidden', position: 'relative', touchAction: 'none' }}>
        <style>{`@keyframes hintPulse{0%{transform:translate(-50%,-50%) scale(1); box-shadow:0 0 0 0 rgba(0,229,255,0.7)}70%{transform:translate(-50%,-50%) scale(1.3); box-shadow:0 0 0 12px rgba(0,229,255,0)}100%{transform:translate(-50%,-50%) scale(1); box-shadow:0 0 0 0 rgba(0,229,255,0)}}`}</style>
        <div ref={hintDotRef} style={{position:'absolute', width:'14px', height:'14px', borderRadius:'50%', background:'#00e5ff', border:'2px solid #fff', display:'none', zIndex:20, pointerEvents:'none', animation:'hintPulse 1.2s infinite'}}/>
        <div ref={hintTextRef} style={{position:'absolute', background:'#00e5ff', color:'#000', padding:'6px 12px', borderRadius:999, fontSize:'12px', fontWeight:900, display:'none', zIndex:20, pointerEvents:'none', whiteSpace:'nowrap'}}>👆 حرك المضرب من هنا</div>
        {countdown > 0 && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5, gap: '12px' }}><span style={{ fontSize: '120px', fontWeight: 900, color: '#ff2233', lineHeight: 1 }}>{countdown}</span><span style={{ fontSize: '18px', fontWeight: 800, color: '#fff', background: '#222', padding: '6px 16px', borderRadius: 999 }}>{getNameForSide(stateRef.current.countdownSide)} {isAr? 'سجل!' : 'Scored!'}</span></div>}
        {lastGoal && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(255,34,51,0.9)', color: '#fff', padding: '12px 24px', borderRadius: '12px', fontWeight: 900, zIndex: 6 }}>{isAr? 'هدف!' : 'GOAL!'} {lastGoal}</div>}
        {showCamMenu &&!hideUI && (<div style={{ position: 'absolute', top: 12, right: 12, zIndex: 20, background: 'rgba(10,10,10,0.94)', backdropFilter: 'blur(14px)', border: '1px solid #222', borderRadius: 16, padding: 14, width: 300, color: '#fff', display: 'flex', flexDirection: 'column', gap: 12 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Video size={16} /> {isAr? 'تحكم الكاميرا' : 'Camera'}</b><button onClick={() => setShowCamMenu(false)} style={{ background: '#222', borderRadius: 8, padding: 4, border: 'none', color: '#fff' }}><X size={14} /></button></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{(Object.keys(CAM_PRESETS_3D) as Cam3DPresetKey[]).map(k => (<button key={k} onClick={() => applyPreset(k)} style={{ padding: '10px 8px', borderRadius: 10, fontWeight: 800, fontSize: 12, border: currentPreset === k? '2px solid #00e5ff' : '1px solid #333', background: currentPreset === k? '#111' : '#0a0a0a', color: currentPreset === k? '#00e5ff' : '#aaa', cursor: 'pointer' }}>{isAr? CAM_PRESETS_3D[k].name : CAM_PRESETS_3D[k].nameEn}</button>))}</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, justifyItems: 'center' }}><div /><button onClick={() => rotateCam('up')} style={btnStyle}><ArrowUp size={18} /></button><div /><button onClick={() => rotateCam('left')} style={btnStyle}><ArrowLeft size={18} /></button><button onClick={resetCamera} style={{...btnStyle, background: '#ff4081', color: '#fff' }}><Maximize2 size={16} /></button><button onClick={() => rotateCam('right')} style={btnStyle}><ArrowRight size={18} /></button><div /><button onClick={() => rotateCam('down')} style={btnStyle}><ArrowDown size={18} /></button><div /></div><div style={{ display: 'flex', gap: 8 }}><button onClick={() => zoomCam(1)} style={{ flex: 1,...btnStyle }}><ZoomIn size={18} /> {isAr? 'قرب' : 'In'}</button><button onClick={() => zoomCam(-1)} style={{ flex: 1,...btnStyle }}><ZoomOut size={18} /> {isAr? 'بعد' : 'Out'}</button></div><div style={{ display: 'flex', gap: 8 }}><button onClick={() => rotateCam('left')} style={{ flex: 1,...btnStyle }}><RotateCcw size={16} /> {isAr? 'يسار' : 'Left'}</button><button onClick={() => rotateCam('right')} style={{ flex: 1,...btnStyle }}><RotateCw size={16} /> {isAr? 'يمين' : 'Right'}</button></div><button onClick={() => { setHideUI(true); setShowCamMenu(false); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, background: '#111', border: '1px solid #333', color: '#888', cursor: 'pointer' }}><EyeOff size={16} /> {isAr? 'اخفاء كل الازرار' : 'Hide All UI'}</button></div>)}
      </div>
    </main>
  );
}
const btnStyle: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fff', borderRadius: 10, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700, cursor: 'pointer' };