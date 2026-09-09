import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Pause, Play, X, RotateCcw, Camera, Eye, EyeOff, ZoomIn, ZoomOut, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, RotateCw,Save, Video, Maximize2 } from 'lucide-react';
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
  const goalW = 360;
  const goalH = 10;
  const goalMat = new THREE.MeshStandardMaterial({ color: '#ffcf5a', emissive: '#ffcf5a', emissiveIntensity: 1.0, roughness: 0.2, metalness: 0.3 });
  const goalTop = new THREE.Mesh(new THREE.BoxGeometry(goalW, goalH, bezelThickness), goalMat);
  goalTop.position.set(worldW/2, -6, -bezelThickness/2);
  group.add(goalTop);
  const goalBottom = new THREE.Mesh(new THREE.BoxGeometry(goalW, goalH, bezelThickness), goalMat);
  goalBottom.position.set(worldW/2, -6, worldH + bezelThickness/2);
  group.add(goalBottom);
  if (worldW >= 900) {
    const goalLeft = new THREE.Mesh(new THREE.BoxGeometry(bezelThickness, goalH, goalW), goalMat);
    goalLeft.position.set(-bezelThickness/2, -6, worldH/2);
    group.add(goalLeft);
    const goalRight = new THREE.Mesh(new THREE.BoxGeometry(bezelThickness, goalH, goalW), goalMat);
    goalRight.position.set(worldW + bezelThickness/2, -6, worldH/2);
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
  return { w: base.w * sc, h: base.h * sc, scale: sc, scaleFactor: 1 };
}

function getAdaptiveCameraPresets(world: {w:number,h:number}, arenaSize: string, isMobile: boolean) {
  const isMobileNow = isMobile || (typeof window !== 'undefined' && window.innerWidth < 768);
  const PRESET_BY_SIZE: any = {
    small:  { distance: 1180, height: 820 },
    medium: { distance: 1380, height: 900 },
    large:  { distance: 1580, height: 980 },
    xlarge: { distance: 1780, height: 1060 },
  };
  const base = PRESET_BY_SIZE[arenaSize] || PRESET_BY_SIZE.medium;
  const mobileBoost = isMobileNow ? 1.12 : 1.0;
  const heightBoost = isMobileNow ? 1.08 : 1.0;
  const distance = base.distance * mobileBoost;
  const height = base.height * heightBoost;
  const basePresets = {
    top: { angle: Math.PI, distance: 400, height: 1400, name: 'من الأعلى', nameEn: 'Top View' },
    bottom: { angle: 0, distance: distance, height: height, name: 'خلفك', nameEn: 'Behind You' },
    topPlayer: { angle: Math.PI, distance: distance, height: height, name: 'خلفك', nameEn: 'Behind You' },
    iso: { angle: 0.6, distance: distance * 0.72, height: height * 0.88, name: 'مائل', nameEn: 'Isometric' },
    sideLeft: { angle: -Math.PI / 2, distance: distance, height: height, name: 'خلفك', nameEn: 'Behind You' },
   sideRight: { angle: Math.PI / 2, distance: distance, height: height, name: 'خلفك', nameEn: 'Behind You' },
  };
  const adapted: any = {};
  for (const k in basePresets) {
    const b: any = (basePresets as any)[k];
    adapted[k] = { ...b, baseDistance: b.distance, baseHeight: b.height, scaleFactor: 1, isMobile: isMobileNow };
  }
  return adapted;
}

const CAM_PRESETS_3D_BASE = {
  top: { angle: Math.PI, distance: 400, height: 1400, name: 'من الأعلى', nameEn: 'Top View' },
  bottom: { angle: 0, distance: 1380, height: 900, name: 'خلفك', nameEn: 'Behind You' },
  topPlayer: { angle: Math.PI, distance: 650, height: 650, name: 'خلف الخصم', nameEn: 'Behind Enemy' },
  iso: { angle: 0.6, distance: 950, height: 800, name: 'مائل', nameEn: 'Isometric' },
  sideLeft: { angle: -Math.PI / 2, distance: 800, height: 500, name: 'يسار', nameEn: 'Left' },
  sideRight: { angle: Math.PI / 2, distance: 800, height: 500, name: 'يمين', nameEn: 'Right' },
} as const;
type Cam3DPresetKey = keyof typeof CAM_PRESETS_3D_BASE;
const CAM_PRESETS_3D = CAM_PRESETS_3D_BASE;

export function GameScreen3D({ 
  roomCode, 
  isHost, 
  players, 
  settings, 
  scores, 
  lastGoal, 
  paused, 
  celebrating, 
  seriesWins = {},        // <-- ADDED: افتراضي فارغ
  currentRound = 1,       // <-- ADDED: افتراضي 1
  onGoal, 
  onTimeUp, 
  onPause, 
  onExit 
}: { 
  roomCode: string; 
  isHost: boolean; 
  players: Player[]; 
  settings: Settings; 
  scores: Scores; 
  lastGoal: string | null; 
  paused: boolean; 
  celebrating: Player | null; 
  seriesWins?: Record<string, number>;   // <-- ADDED
  currentRound?: number;                 // <-- ADDED
  onGoal: (p: Player) => void; 
  onTimeUp: () => void; 
  onPause: () => void; 
  onExit: () => void; 
}) {
  const { i18n } = useTranslation();
  const mountRef = useRef<HTMLDivElement>(null);
  const hintDotRef = useRef<HTMLDivElement>(null);
  const hintTextRef = useRef<HTMLDivElement>(null);
  const hasDraggedRef = useRef(false);
  const noDragStartRef = useRef(performance.now());
  const [timeLeft, setTimeLeft] = useState(settings.mode === 'time'? settings.duration : 0);
  const [rally, setRally] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [countdownSide, setCountdownSide] = useState<string>('');
  const pausedRef = useRef(paused);
  const gameEndedRef = useRef(false);
  const frameIdRef = useRef<number>(0);
  pausedRef.current = paused;

  const isMobileCheck = useMemo(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false, []);
  const world = useMemo(() => getArenaWorld(Math.max(players.length, settings.players || 2), settings.arenaSize), [players.length, settings.players, settings.arenaSize]);
  const adaptivePresets = useMemo(() => getAdaptiveCameraPresets(world as any, settings.arenaSize, isMobileCheck), [world.w, world.h, settings.arenaSize, isMobileCheck]);

  const getMySide = useCallback((): Player['side'] => {
    return (players.find((p) => p.socketId === socket.id)?.side?? players[0]?.side?? 'bottom') as Player['side'];
  }, [players]);

  const mySideForCam = getMySide();
  const initialCam = useMemo(() => {
    const sideKey = mySideForCam === 'top'? 'topPlayer' : mySideForCam === 'left'? 'sideLeft' : mySideForCam === 'right'? 'sideRight' : 'bottom';
    const preset = (adaptivePresets as any)[sideKey] || (adaptivePresets as any).bottom;
    return { angle: preset.angle, targetAngle: preset.angle, distance: preset.distance, targetDistance: preset.distance, height: preset.height, targetHeight: preset.height, targetX: world.w / 2, targetZ: world.h / 2, lookX: world.w / 2, lookZ: world.h / 2, scaleFactor: 1 };
  }, [world, adaptivePresets, mySideForCam]);

  const cam = useRef({...initialCam });
  useEffect(() => {
    const saved = localStorage.getItem('qoud_camera_settings');
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        cam.current = { ...cam.current, ...settings };
      } catch {}
    }
  }, []);

  // --- ADDED: حفظ إعدادات الكاميرا ---
  const saveCameraSettings = useCallback(() => {
    const settings = {
      angle: cam.current.angle,
      distance: cam.current.distance,
      height: cam.current.height,
      targetAngle: cam.current.targetAngle,
      targetDistance: cam.current.targetDistance,
      targetHeight: cam.current.targetHeight,
    };
    localStorage.setItem('qoud_camera_settings', JSON.stringify(settings));
  }, []);

  // --- ADDED: إعادة تعيين الكاميرا إلى الوضع الافتراضي ---
  const resetCameraToDefault = useCallback(() => {
    cam.current = { ...initialCam };
    localStorage.removeItem('qoud_camera_settings');
  }, [initialCam]);
  const threeRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext|null>(null);
  const hitEffectsRef = useRef<any[]>([]);
  const shakeRef = useRef({ intensity: 0 });
  const stateRef = useRef({
    ball: { x: world.w / 2, y: world.h / 2, vx: 0, vy: 0 },
    ballTarget: { x: world.w / 2, y: world.h / 2, vx: 0, vy: 0 },
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
    const sideKey = getMySide() === 'top'? 'topPlayer' : getMySide() === 'left'? 'sideLeft' : getMySide() === 'right'? 'sideRight' : 'bottom';
    const preset = (adaptivePresets as any)[sideKey] || (adaptivePresets as any).bottom;
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
    setCurrentPreset(sideKey as any);
  }, [world, adaptivePresets, getMySide]);

  const applyPreset = useCallback((key: Cam3DPresetKey) => {
    const p = (adaptivePresets as any)[key];
    cam.current.targetAngle = p.angle;
    cam.current.targetDistance = p.distance;
    cam.current.targetHeight = p.height;
    setCurrentPreset(key);
  }, [adaptivePresets]);

  const zoomCam = useCallback((dir: number) => {
    cam.current.targetDistance = Math.max(300, Math.min(3200, cam.current.targetDistance * (dir > 0? 0.85 : 1.18)));
  }, []);

  const rotateCam = useCallback((dir: 'left' | 'right' | 'up' | 'down') => {
    if (dir === 'left') cam.current.targetAngle -= 0.4;
    if (dir === 'right') cam.current.targetAngle += 0.4;
    if (dir === 'up') cam.current.targetHeight = Math.min(2800, cam.current.targetHeight + 120);
    if (dir === 'down') cam.current.targetHeight = Math.max(250, cam.current.targetHeight - 120);
  }, []);

  useEffect(() => {
    cam.current = {...initialCam};
  }, [initialCam]);

  // ============================================================
  // 1. مستمع game-state للجميع (بدلاً من المستمع الخاص بغير المضيف)
  // ============================================================
  useEffect(() => {
    const handleGameState = (data: any) => {
      if (!data) return;
      const mySide = getMySide();
      if (data.ball) {
        stateRef.current.ballTarget.x = data.ball.x;
        stateRef.current.ballTarget.y = data.ball.y;
        stateRef.current.ballTarget.vx = data.ball.vx;
        stateRef.current.ballTarget.vy = data.ball.vy;
      }
      if (data.paddles) {
        Object.keys(data.paddles).forEach((side) => {
          if (side === mySide) return;
          const p = data.paddles[side];
          if (stateRef.current.targetPaddles[side as Player['side']]) {
            stateRef.current.targetPaddles[side as Player['side']].x = p.x;
            stateRef.current.targetPaddles[side as Player['side']].z = p.y; // في 3D نستخدم z بدلاً من y
          }
        });
      }
      if (data.countdown !== undefined) {
        stateRef.current.countdown = data.countdown;
        setCountdown(data.countdown);
      }
      if (data.countdownSide !== undefined) { // 🔥 جديد
        stateRef.current.countdownSide = data.countdownSide || null;
        setCountdownSide(data.countdownSide || '');
      }
      if (data.rally !== undefined) {
        setRally(data.rally);
      }
    };
    socket.on('game-state', handleGameState);
    return () => { socket.off('game-state', handleGameState); };
  }, [getMySide]);

  // ============================================================
  // 2. إرسال paddle-target بدلاً من paddle-input
  // ============================================================
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
      // FIX: تحريك من تحت 110px مثل 2D
      const isTouch = (e as any).pointerType === 'touch' || (e as any).pointerType === 'pen';
      const OFFSET = isTouch? 110 : 55;
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
          const clampedZ = clamp(tz + OFFSET, 45, world.h * 0.38);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          stateRef.current.paddles[mySide].x = clampedX;
          stateRef.current.paddles[mySide].z = clampedZ;
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
        } else if (mySide === 'bottom') {
          const clampedX = clamp(tx, 45, world.w - 45);
          const clampedZ = clamp(tz - OFFSET, world.h * 0.62, world.h - 45);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          stateRef.current.paddles[mySide].x = clampedX;
          stateRef.current.paddles[mySide].z = clampedZ;
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
        } else if (mySide === 'left') {
          const clampedX = clamp(tx + OFFSET, 45, world.w * 0.38);
          const clampedZ = clamp(tz, 45, world.h - 45);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          stateRef.current.paddles[mySide].x = clampedX;
          stateRef.current.paddles[mySide].z = clampedZ;
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
        } else if (mySide === 'right') {
          const clampedX = clamp(tx - OFFSET, world.w * 0.62, world.w - 45);
          const clampedZ = clamp(tz, 45, world.h - 45);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          stateRef.current.paddles[mySide].x = clampedX;
          stateRef.current.paddles[mySide].z = clampedZ;
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
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

  // ============================================================
  // 3. إزالة مستمع paddle-input القديم (نكتفي بـ game-state)
  // ============================================================
 // لم نعد نستخدم paddle-input ولا المستمع القديم
useEffect(() => {
  // لا شيء، أو مجرد تنظيف إذا لزم الأمر
}, []);
  // ============================================================
  // 4. إنشاء المشهد الثلاثي الأبعاد (بدون تغيير)
  // ============================================================
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
    const isMobileFov = mount.clientWidth < 768;
    const fov = isMobileFov ? 52 : 48;
    const camera = new THREE.PerspectiveCamera(fov, mount.clientWidth / mount.clientHeight, 10, 5000);
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
    const sidesNeeded = ensureCount === 2? (['bottom','top'] as Player['side'][]) : (['bottom','top','right','left'] as Player['side'][]);
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
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      if (h < 100) return; // تجاهل القياسات الخاطئة
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    });
    ro.observe(mount);
    // إصلاح أولي للكانفاس
    setTimeout(() => {
      if (mountRef.current && threeRef.current) {
        const w = mountRef.current.clientWidth;
        const h = mountRef.current.clientHeight;
        threeRef.current.camera.aspect = w / h;
        threeRef.current.camera.updateProjectionMatrix();
        threeRef.current.renderer.setSize(w, h);
      }
    }, 100);
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

  // ============================================================
  // 5. فيزياء محددة بدون عشوائية - إصلاح الحركة العشوائية
  // ============================================================
  useEffect(() => {
    const state = stateRef.current;
    const needPlayers = Math.max(2, players.length, settings.players || 2);
    const sidesForCount: Player['side'][] = needPlayers === 2? ['bottom','top'] : ['bottom','top','right','left'];
    const playerForSide = (side: Player['side']) => players.find(p => p.side === side);
    const activeSide = (side: Player['side']) => sidesForCount.includes(side);

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
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.type = 'sine'; o.frequency.setValueAtTime(90 + p * 800, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
          g.gain.setValueAtTime(0.15 + p * 0.85, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.4 + p * 0.25);
          if (panner) { o.connect(g); g.connect(panner); panner.connect(ctx.destination); } else { o.connect(g).connect(ctx.destination); }
          o.start(t); o.stop(t + 0.45);
          if (p > 0.3) {
            const o2 = ctx.createOscillator(); const g2 = ctx.createGain(); const p2 = (ctx as any).createStereoPanner? (ctx as any).createStereoPanner() : null;
            if (p2) p2.pan.value = panVal * 0.8;
            o2.type = p > 0.7? 'square' : 'triangle'; o2.frequency.setValueAtTime(600 + p * 2000, t); o2.frequency.exponentialRampToValueAtTime(180, t + 0.15);
            g2.gain.setValueAtTime(0.22 * p, t); g2.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
            if (p2) { o2.connect(g2); g2.connect(p2); p2.connect(ctx.destination); } else o2.connect(g2).connect(ctx.destination);
            o2.start(t); o2.stop(t + 0.2);
          }
        } catch {}
      }
      if (!threeRef.current?.hitGroup) return;
      const group = threeRef.current.hitGroup;
      const col = p > 0.7? '#ff2233' : p > 0.4? color : '#ffffff';
      const ringGeo = new THREE.RingGeometry(8, 12 + p * 26, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.set(x, 15.5, z); group.add(ring);
      hitEffectsRef.current.push({ mesh: ring, born: performance.now(), power: p, isCore: false });
      if (p > 0.45) {
        const coreGeo = new THREE.CircleGeometry(4 + p * 10, 24); const coreMat = new THREE.MeshBasicMaterial({ color: '#ffcf5a', transparent: true, opacity: 0.9 });
        const core = new THREE.Mesh(coreGeo, coreMat); core.rotation.x = -Math.PI / 2; core.position.set(x, 15.8, z); group.add(core);
        hitEffectsRef.current.push({ mesh: core, born: performance.now(), power: p * 1.3, isCore: true });
      }
      shakeRef.current.intensity = Math.max(shakeRef.current.intensity, p * 18);
      if (threeRef.current?.ball) {
        const ballMat = threeRef.current.ball.material as THREE.MeshStandardMaterial;
        ballMat.emissiveIntensity = 0.85 + p * 3.5; setTimeout(() => { if (ballMat) ballMat.emissiveIntensity = 0.85; }, 120 + p * 80);
      }
    };

    const playGoalSound = () => {
      if(!settings.sound) return;
      try{
        if(!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext||(window as any).webkitAudioContext)();
        const ctx = audioCtxRef.current; if(ctx.state==='suspended') ctx.resume(); const t = ctx.currentTime;
        const master = ctx.createGain(); master.gain.value=1.2; master.connect(ctx.destination);
        [261.63,329.63,392,523.25,659.25].forEach((freq,i)=>{
          const o=ctx.createOscillator(); const g=ctx.createGain(); const p=(ctx as any).createStereoPanner?.(); if(p) p.pan.value=i%2===0?-0.35:0.35;
          o.type='square'; o.frequency.setValueAtTime(freq,t+i*0.08);
          g.gain.setValueAtTime(0,t+i*0.08); g.gain.linearRampToValueAtTime(0.85,t+i*0.08+0.015); g.gain.exponentialRampToValueAtTime(0.001,t+i*0.08+0.7);
          if(p){o.connect(g); g.connect(p); p.connect(master);}else o.connect(g).connect(master);
          o.start(t+i*0.08); o.stop(t+i*0.08+0.75);
        });
        const oB=ctx.createOscillator(); const gB=ctx.createGain(); oB.type='sine'; oB.frequency.setValueAtTime(180,t); oB.frequency.exponentialRampToValueAtTime(35,t+0.6); gB.gain.setValueAtTime(1.0,t); gB.gain.exponentialRampToValueAtTime(0.001,t+0.75); oB.connect(gB).connect(master); oB.start(t); oB.stop(t+0.8);
      }catch{}
    };

    const tick = (now: number) => {
      const delta = Math.min((now - state.last) / 16.67, 2);
      state.last = now;
      if (!pausedRef.current && !gameEndedRef.current) {
        const mySide = getMySide(); 
        // ============================================
        // لا فيزياء محلية، فقط استيفاء من ballTarget و targetPaddles
        // ============================================
        const lerpFactor = 0.15;
        // === فيزياء محددة بدون عشوائية ===
        const ball = state.ball;
        const w = world.w, h = world.h;
        const BALL_R = 14, PADDLE_R = 26, HIT_DIST = BALL_R + PADDLE_R;

        if (state.countdown === 0) {
          // حركة الكرة مع تقسيم الخطوات لمنع المرور عبر المضرب
          const totalVx = ball.vx * delta;
          const totalVy = ball.vy * delta;
          const dist = Math.hypot(totalVx, totalVy);
          const steps = Math.max(1, Math.ceil(dist / 8));
          const stepVx = totalVx / steps;
          const stepVy = totalVy / steps;

          for (let i = 0; i < steps; i++) {
            ball.x += stepVx;
            ball.y += stepVy;

            // تصادم مع المضارب - محدد بدون عشوائية
            for (const side of (['top','bottom','left','right'] as Player['side'][])) {
              if (!activeSide(side)) continue;
              const paddle = state.paddles[side];
              const px = paddle.x, pz = (paddle as any).z;
              const dx = ball.x - px, dy = ball.y - pz;
              const d = Math.hypot(dx, dy);
              if (d < HIT_DIST && d > 0.1) {
                const nx = dx / d, nz = dy / d;
                ball.x = px + nx * (HIT_DIST + 1.5);
                ball.y = pz + nz * (HIT_DIST + 1.5);
                const speed = getInitialSpeed();
                // ارتداد محدد حسب مكان الضرب
                if (side === 'bottom') {
                  ball.vy = -Math.abs(speed);
                  ball.vx = (ball.x - px) * 0.15;
                } else if (side === 'top') {
                  ball.vy = Math.abs(speed);
                  ball.vx = (ball.x - px) * 0.15;
                } else if (side === 'left') {
                  ball.vx = Math.abs(speed);
                  ball.vy = (ball.y - pz) * 0.15;
                } else {
                  ball.vx = -Math.abs(speed);
                  ball.vy = (ball.y - pz) * 0.15;
                }
                // حد أقصى للسرعة لمنع العشوائية
                const maxSpeed = 18;
                const curSpeed = Math.hypot(ball.vx, ball.vy);
                if (curSpeed > maxSpeed) {
                  ball.vx = (ball.vx / curSpeed) * maxSpeed;
                  ball.vy = (ball.vy / curSpeed) * maxSpeed;
                }
                state.rally++; setRally(state.rally);
                break;
              }
            }
          }

          // جدران
          if (ball.y < 16) {
            const goalW = 360;
            const gx1 = (w - goalW)/2, gx2 = gx1 + goalW;
            if (activeSide('top') && ball.x >= gx1 && ball.x <= gx2) {
              // هدف - السيرفر يحسبه
            } else {
              ball.y = 16; ball.vy = Math.abs(ball.vy);
            }
          }
          if (ball.y > h - 16) {
            const goalW = 360;
            const gx1 = (w - goalW)/2, gx2 = gx1 + goalW;
            if (activeSide('bottom') && ball.x >= gx1 && ball.x <= gx2) {
            } else {
              ball.y = h - 16; ball.vy = -Math.abs(ball.vy);
            }
          }
          if (ball.x < 16) {
            const goalW = 360;
            const gy1 = (h - goalW)/2, gy2 = gy1 + goalW;
            if (activeSide('left') && ball.y >= gy1 && ball.y <= gy2) {
            } else {
              ball.x = 16; ball.vx = Math.abs(ball.vx);
            }
          }
          if (ball.x > w - 16) {
            const goalW = 360;
            const gy1 = (h - goalW)/2, gy2 = gy1 + goalW;
            if (activeSide('right') && ball.y >= gy1 && ball.y <= gy2) {
            } else {
              ball.x = w - 16; ball.vx = -Math.abs(ball.vx);
            }
          }

          // تصحيح لطيف من السيرفر بدون قفز
          if (!isOfflineMode) {
            const corrX = state.ballTarget.x - ball.x;
            const corrY = state.ballTarget.y - ball.y;
            if (Math.hypot(corrX, corrY) > 100) {
              ball.x = state.ballTarget.x;
              ball.y = state.ballTarget.y;
              ball.vx = state.ballTarget.vx;
              ball.vy = state.ballTarget.vy;
            } else if (Math.hypot(corrX, corrY) > 10) {
              ball.x += corrX * 0.03;
              ball.y += corrY * 0.03;
            }
          }
        }

        // تحريك المضارب بسلاسة بدون تكرار
        (['top','bottom','right','left'] as Player['side'][]).forEach(side => {
          if (!activeSide(side)) return;
          const t = state.targetPaddles[side];
          const c = state.paddles[side];
          if (side === mySide) {
            c.x += (t.x - c.x) * 0.6;
            c.z += (t.z - c.z) * 0.6;
          } else {
            c.x += (t.x - c.x) * 0.25;
            c.z += (t.z - c.z) * 0.25;
          }
        });
      }
      // رسم المشهد الثلاثي الأبعاد (بدون تغيير)
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
  }, [players, settings, onGoal, onTimeUp, world, getInitialSpeed, isHost, isOfflineMode, roomCode, getMySide]);

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
            <div className="brand" style={{ color: '#fff', fontWeight: 'bold' }}>QOUD 3D • {mySideForCam.toUpperCase()} • HD</div>
            <div className="match-meta" style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <b>{settings.mode === 'time'? formatTime(timeLeft) : '∞'}</b>
              <span>| Rally: {rally}</span>
              {/* --- ADDED: عرض معلومات الجولة والانتصارات --- */}
              {settings.seriesType === 'series' && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', background: '#1a1a1a', padding: '4px 12px', borderRadius: '20px' }}>
                  <span style={{ fontWeight: 'bold', color: '#ffcf5a' }}>جولة {currentRound}/{settings.seriesRounds}</span>
                  {players.map(p => (
                    <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.color }} />
                      <span>{p.name}</span>
                      <strong style={{ color: p.color }}>{(seriesWins[p.id] ?? 0)}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
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
              const sides = need === 2? SIDES_FB.slice(0,2) : SIDES_FB.slice(0,4);
              return sides.map((side, idx) => {
                const p = players.find((pl: any) => pl.side === side) || { id: String(idx), name: side === 'top'? 'سامي' : side === 'right'? 'ليان' : side === 'left'? 'كريم' : 'نورا', color: COLORS_FB[idx], side };
                const isMe = side===mySideForCam;
                return (
                  <div key={p.id + side} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', background: isMe?'#1a2a3a':'#151515', border: `2px solid ${p.color}`, borderRadius: '14px', padding: '6px 16px', minWidth: '90px' }}>
                    <strong style={{ color: p.color, fontSize: '20px', lineHeight: '1', fontWeight: 900 }}>{scores[p.id]?? 0}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ background: p.color, width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block' }} />
                      <span style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>{p.name}{isMe?' (انت)':''}</span>
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
        {/* إصلاح الكانفاس - زر القائمة ثابت لا يغطي */}
        <div style={{ position:'fixed', top: 6, left: 6, zIndex:9999, pointerEvents:'auto' }}>
          <button onClick={onExit} style={{ background:'#ffcf5a', color:'#000', border:'2px solid #000', borderRadius:10, padding:'8px 14px', fontWeight:900, fontSize:12, boxShadow:'0 2px 0 #000' }}>← القائمة</button>
        </div>
        <div style={{ position:'fixed', top: 6, right: 6, zIndex:9999, display:'flex', gap:6, pointerEvents:'auto' }}>
          <button onClick={onPause} style={{ background:'rgba(0,0,0,0.8)', color:'#fff', border:'1px solid #fff', borderRadius:8, padding:'8px 10px', fontSize:11 }}>{paused? '▶️':'⏸️'}</button>
          <button onClick={()=>setShowCamMenu(v=>!v)} style={{ background:'rgba(0,0,0,0.8)', color:'#fff', border:'1px solid #fff', borderRadius:8, padding:'8px 10px', fontSize:11 }}>🎥</button>
        </div>
        {countdown > 0 && (
  <div style={{ position: 'absolute', inset: 0, background: countdownSide ? 'rgba(0,0,0,0.72)' : 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5, gap: '12px', pointerEvents: 'none' }}>
    <span style={{ fontSize: '120px', fontWeight: 900, color: '#ff2233', lineHeight: 1, textShadow: '0 0 25px rgba(0,0,0,0.9)' }}>{countdown}</span>
    {countdownSide && (
      <span style={{ fontSize: '18px', fontWeight: 800, color: '#fff', background: '#222', padding: '6px 16px', borderRadius: 999 }}>
        {getNameForSide(countdownSide as Player['side'])} {isAr ? 'سجل!' : 'Scored!'}
      </span>
    )}
  </div>
)}
        {lastGoal && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(255,34,51,0.9)', color: '#fff', padding: '12px 24px', borderRadius: '12px', fontWeight: 900, zIndex: 6 }}>{isAr? 'هدف!' : 'GOAL!'} {lastGoal}</div>}
        {/* --- ADDED: احتفال الفوز بالجولة مع رقم الجولة --- */}
        {celebrating && (
  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, gap: '8px' }}>
    <div style={{ fontSize: '48px', fontWeight: 900, color: '#ffcf5a', textShadow: '0 0 20px #ffcf5a' }}>
      {celebrating.name} {isAr? 'فاز بالجولة' : 'wins the round'}!
    </div>
    <div style={{ fontSize: '24px', color: '#fff', background: '#222', padding: '8px 24px', borderRadius: '999px' }}>
      {isAr? 'الجولة' : 'Round'} {currentRound} / {settings.seriesRounds}
    </div>
    <div style={{ display: 'flex', gap: '20px', marginTop: '12px' }}>
      {players.map(p => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#111', padding: '6px 12px', borderRadius: '999px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: p.color }} />
          <span style={{ color: '#fff' }}>{p.name}</span>
          <strong style={{ color: '#ffcf5a' }}>{(seriesWins[p.id] ?? 0)}</strong>
        </div>
      ))}
    </div>
  </div>
)}
        {showCamMenu &&!hideUI && (
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 20, background: 'rgba(10,10,10,0.94)', backdropFilter: 'blur(14px)', border: '1px solid #222', borderRadius: 16, padding: 14, width: 300, color: '#fff', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Video size={16} /> {isAr? 'تحكم الكاميرا' : 'Camera'}</b>
              <button onClick={() => setShowCamMenu(false)} style={{ background: '#222', borderRadius: 8, padding: 4, border: 'none', color: '#fff' }}><X size={14} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {(Object.keys(CAM_PRESETS_3D) as Cam3DPresetKey[]).map(k => (
                <button key={k} onClick={() => applyPreset(k)} style={{ padding: '10px 8px', borderRadius: 10, fontWeight: 800, fontSize: 12, border: currentPreset === k? '2px solid #00e5ff' : '1px solid #333', background: currentPreset === k? '#111' : '#0a0a0a', color: currentPreset === k? '#00e5ff' : '#aaa', cursor: 'pointer' }}>
                  {isAr? CAM_PRESETS_3D[k].name : CAM_PRESETS_3D[k].nameEn}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, justifyItems: 'center' }}>
              <div /><button onClick={() => rotateCam('up')} style={btnStyle}><ArrowUp size={18} /></button><div />
              <button onClick={() => rotateCam('left')} style={btnStyle}><ArrowLeft size={18} /></button>
              <button onClick={resetCamera} style={{...btnStyle, background: '#ff4081', color: '#fff' }}><Maximize2 size={16} /></button>
              <button onClick={() => rotateCam('right')} style={btnStyle}><ArrowRight size={18} /></button>
              <div /><button onClick={() => rotateCam('down')} style={btnStyle}><ArrowDown size={18} /></button><div />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => zoomCam(1)} style={{ flex: 1,...btnStyle }}><ZoomIn size={18} /> {isAr? 'قرب' : 'In'}</button>
              <button onClick={() => zoomCam(-1)} style={{ flex: 1,...btnStyle }}><ZoomOut size={18} /> {isAr? 'بعد' : 'Out'}</button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => rotateCam('left')} style={{ flex: 1,...btnStyle }}><RotateCcw size={16} /> {isAr? 'يسار' : 'Left'}</button>
              <button onClick={() => rotateCam('right')} style={{ flex: 1,...btnStyle }}><RotateCw size={16} /> {isAr? 'يمين' : 'Right'}</button>
            </div>
            {/* --- ADDED: أزرار حفظ وإعادة تعيين الكاميرا --- */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveCameraSettings} style={{ flex: 1, ...btnStyle, background: '#00e5ff', color: '#000' }}>
                <Save size={16} /> {isAr? 'حفظ' : 'Save'}
              </button>
              <button onClick={resetCameraToDefault} style={{ flex: 1, ...btnStyle, background: '#ff6b8b', color: '#fff' }}>
                <RotateCcw size={16} /> {isAr? 'إعادة تعيين' : 'Reset'}
              </button>
            </div>
            <button onClick={() => { setHideUI(true); setShowCamMenu(false); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, background: '#111', border: '1px solid #333', color: '#888', cursor: 'pointer' }}>
              <EyeOff size={16} /> {isAr? 'اخفاء كل الازرار' : 'Hide All UI'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
const btnStyle: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fff', borderRadius: 10, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700, cursor: 'pointer' };
