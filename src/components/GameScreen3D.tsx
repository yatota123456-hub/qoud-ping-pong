import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Pause, Play, X, RotateCcw, Camera, Eye, EyeOff, ZoomIn, ZoomOut, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, RotateCw,Save, Video, Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { socket } from '../socket.tsx';

type Player = { id: number | string; name: string; color: string; side: 'top' | 'right' | 'bottom' | 'left'; computer: boolean; socketId?: string };
type Settings = any;
type Scores = Record<string | number, number>;

function createAirHockeySurface(worldW: number, worldH: number) {
  // جودة عالية مثل الصورة: سطح أبيض نقي مع نقاط سوداء دقيقة + خطوط حمراء
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 4096;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  
  // خلفية بيضاء نقية عالية الجودة
  ctx.fillStyle = '#fefefe';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // طبقة تدرج خفيف للواقعية
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, 'rgba(0,0,0,0.02)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.03)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // نقاط سوداء دقيقة جداً مثل الصورة الأصلية - كثافة عالية
  ctx.fillStyle = 'rgba(10,10,10,0.85)';
  const dotSize = 2.2;
  const spacing = 32;
  for (let y = spacing/2; y < canvas.height; y += spacing) {
    const isEvenRow = Math.floor(y / spacing) % 2 === 0;
    for (let x = spacing/2; x < canvas.width; x += spacing) {
      const offset = isEvenRow ? 0 : spacing/2;
      if (x + offset >= canvas.width - spacing/2) continue;
      ctx.beginPath();
      ctx.arc(x + offset, y, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  // خط المنتصف المتقطع أحمر - مثل الصورة
  ctx.strokeStyle = 'rgba(255, 45, 45, 0.9)';
  ctx.lineWidth = 8;
  ctx.setLineDash([40, 30]);
  ctx.beginPath();
  ctx.moveTo(0, canvas.height/2);
  ctx.lineTo(canvas.width, canvas.height/2);
  ctx.stroke();
  ctx.setLineDash([]);
  
  // دوائر الأهداف الحمراء - نصف دائرة في كل طرف
  ctx.strokeStyle = 'rgba(255, 45, 45, 0.95)';
  ctx.lineWidth = 10;
  const goalRadius = 280;
  // هدف علوي
  ctx.beginPath();
  ctx.arc(canvas.width/2, 0, goalRadius, 0, Math.PI, false);
  ctx.stroke();
  // هدف سفلي
  ctx.beginPath();
  ctx.arc(canvas.width/2, canvas.height, goalRadius, Math.PI, Math.PI*2, false);
  ctx.stroke();
  
  // دوائر صغيرة في المنتصف للزينة
  ctx.strokeStyle = 'rgba(255, 45, 45, 0.4)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(canvas.width/2, canvas.height/2, 80, 0, Math.PI*2);
  ctx.stroke();
  
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 16;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
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
  // إضاءة عالية الجودة مثل الصورة - واقعية ونظيفة
  scene.background = new THREE.Color('#0a0a0a');
  scene.fog = new THREE.Fog('#0a0a0a', worldWidth*1.8, worldWidth*4);
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambientLight);
  
  // إضاءة علوية رئيسية قوية - مثل الصورة
  const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
  mainLight.position.set(worldWidth/2, 1200, worldHeight/2);
  mainLight.castShadow = false;
  scene.add(mainLight);
  
  // إضاءة ثانوية لتخفيف الظلال
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.45);
  fillLight.position.set(-worldWidth*0.3, 800, -worldHeight*0.2);
  scene.add(fillLight);
  
  // إضاءات حمراء خفيفة على الحواف - مثل توهج الإطار الأحمر في الصورة
  const edgeLight1 = new THREE.PointLight(0xff2d2d, 0.6, worldWidth*1.5);
  edgeLight1.position.set(worldWidth*0.5, 80, -40);
  scene.add(edgeLight1);
  
  const edgeLight2 = new THREE.PointLight(0xff2d2d, 0.6, worldWidth*1.5);
  edgeLight2.position.set(worldWidth*0.5, 80, worldHeight+40);
  scene.add(edgeLight2);
  
  // إضاءة مركزية ناعمة
  const centerLight = new THREE.PointLight(0xffffff, 0.35, worldWidth*2);
  centerLight.position.set(worldWidth/2, 600, worldHeight/2);
  scene.add(centerLight);
}

function createArenaFrame(worldW: number, worldH: number) {
  const group = new THREE.Group();
  // إطار أحمر عالي الجودة مثل الصورة - لامع ومائل
  const bezelThickness = Math.max(38, Math.min(worldW, worldH) * 0.065);
  const bezelHeight = 36;
  const bezelY = 18;
  
  // مادة حمراء لامعة عالية الجودة مثل الصورة
  const bezelMat = new THREE.MeshStandardMaterial({
    color: '#ff1a1a',
    roughness: 0.22,
    metalness: 0.15,
    emissive: '#ff0000',
    emissiveIntensity: 0.08,
  });
  
  // إطار سفلي مع ميل (bevel) مثل الصورة
  const createBeveledSide = (w: number, h: number, d: number, x: number, z: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(-w/2, -d/2);
    shape.lineTo(w/2, -d/2);
    shape.lineTo(w/2 - 8, d/2);
    shape.lineTo(-w/2 + 8, d/2);
    shape.lineTo(-w/2, -d/2);
    
    const extrudeSettings = {
      steps: 1,
      depth: bezelHeight,
      bevelEnabled: true,
      bevelThickness: 6,
      bevelSize: 4,
      bevelSegments: 4
    };
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geo.rotateX(-Math.PI/2);
    const mesh = new THREE.Mesh(geo, bezelMat);
    mesh.position.set(x, bezelY, z);
    return mesh;
  };
  
  const bezelPieces = [
    { w: worldW + bezelThickness * 2, d: bezelThickness, x: worldW / 2, z: -bezelThickness / 2 },
    { w: worldW + bezelThickness * 2, d: bezelThickness, x: worldW / 2, z: worldH + bezelThickness / 2 },
    { w: bezelThickness, d: worldH, x: -bezelThickness / 2, z: worldH / 2 },
    { w: bezelThickness, d: worldH, x: worldW + bezelThickness / 2, z: worldH / 2 },
  ];
  
  bezelPieces.forEach((p) => {
    const mesh = createBeveledSide(p.w, bezelHeight, p.d, p.x, p.z);
    group.add(mesh);
    
    // طبقة توهج حمراء داخلية
    const glowMat = new THREE.MeshBasicMaterial({
      color: '#ff4444',
      transparent: true,
      opacity: 0.15
    });
    const glowMesh = new THREE.Mesh(
      new THREE.BoxGeometry(p.w * 0.98, 4, p.d * 0.98),
      glowMat
    );
    glowMesh.position.set(p.x, bezelY + bezelHeight/2 + 2, p.z);
    group.add(glowMesh);
  });
  
  // خطوط حمراء دقيقة على الحواف الداخلية - مثل الصورة
  const innerLineMat = new THREE.MeshBasicMaterial({ color: '#ff0000', transparent: true, opacity: 0.9 });
  const lineThickness = 3;
  
  // خط علوي
  const topLine = new THREE.Mesh(
    new THREE.BoxGeometry(worldW, lineThickness, lineThickness),
    innerLineMat
  );
  topLine.position.set(worldW/2, 22, 1);
  group.add(topLine);
  
  // خط سفلي
  const bottomLine = new THREE.Mesh(
    new THREE.BoxGeometry(worldW, lineThickness, lineThickness),
    innerLineMat
  );
  bottomLine.position.set(worldW/2, 22, worldH - 1);
  group.add(bottomLine);
  
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
  const isMobileNow = false;
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
    topPlayer: { angle: Math.PI, distance: 650, height: 650, name: 'خلف الخصم', nameEn: 'Behind Enemy' },
    iso: { angle: 0.6, distance: distance * 0.72, height: height * 0.88, name: 'مائل', nameEn: 'Isometric' },
    sideLeft: { angle: -Math.PI / 2, distance: 800, height: 500, name: 'يسار', nameEn: 'Left' },
    sideRight: { angle: Math.PI / 2, distance: 800, height: 500, name: 'يمين', nameEn: 'Right' },
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
  roomCode, isHost, players, settings, scores, lastGoal, paused, celebrating, 
  seriesWins = {}, currentRound = 1, onGoal, onTimeUp, onPause, onExit 
}: { 
  roomCode: string; isHost: boolean; players: Player[]; settings: Settings; 
  scores: Scores; lastGoal: string | null; paused: boolean; celebrating: Player | null; 
  seriesWins?: Record<string, number>; currentRound?: number; 
  onGoal: (p: Player) => void; onTimeUp: () => void; onPause: () => void; onExit: () => void; 
}) {
  const [localReady, setLocalReady] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [savedCamData, setSavedCamData] = useState<string | null>(null);

  useEffect(() => {
    const savedCam = localStorage.getItem('qoud_camera_preset');
    if (savedCam) {
      setSavedCamData(savedCam);
      setShowRestoreModal(true);
    }
  }, []);

  const restoreCamera = () => {
    setShowRestoreModal(false);
  };

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
  const localReadyRef = useRef(localReady);
  useEffect(()=>{ localReadyRef.current = localReady; }, [localReady]);
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
    serving: { active: false, side: 'bottom' as Player['side'], startTime: 0, requested: false },
    paddleVel: { top: {vx:0, vy:0}, bottom: {vx:0, vy:0}, left: {vx:0, vy:0}, right: {vx:0, vy:0} } as any
  });

  const playersKey = useMemo(() => players.map(p => `${p.side}:${p.color}`).join(','), [players]);

  const [showCamMenu, setShowCamMenu] = useState(false);
  const [hideUI, setHideUI] = useState(false);
  const [currentPreset, setCurrentPreset] = useState<Cam3DPresetKey>('bottom');
  const isAr = i18n.language?.startsWith('ar');

  const getInitialSpeed = useCallback(() => 3 + settings.ballSpeed * 0.2, [settings.ballSpeed]);
  const isOfflineMode =!socket.connected || players.length <= 1;

  const createHatPaddle = useCallback((color: string) => {
    const group = new THREE.Group();
    
    // لون المضرب - أزرق وأحمر مثل الصورة عالية الجودة
    const isBlue = color.toLowerCase().includes('61e7c2') || color.toLowerCase().includes('00e5ff') || color.toLowerCase().includes('blue') || color === '#61e7c2';
    const baseColor = isBlue ? '#0a84ff' : (color === '#ffcf5a' ? '#0a84ff' : color); // الأزرق افتراضي للاعب السفلي
    
    // قاعدة المضرب السفلية - كبيرة ولامعة
    const baseMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.12,
      metalness: 0.1,
      emissive: new THREE.Color(baseColor),
      emissiveIntensity: 0.15
    });
    
    // القاعدة الرئيسية - أسطوانة منخفضة
    const baseGeo = new THREE.CylinderGeometry(32, 34, 14, 48);
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 7;
    group.add(base);
    
    // حلقة خارجية لامعة
    const ringMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.08,
      metalness: 0.2,
      transparent: true,
      opacity: 0.3
    });
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(30, 1.5, 16, 48),
      ringMat
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 10;
    group.add(ring);
    
    // المقبض العلوي - كرة صغيرة
    const handleMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.15,
      metalness: 0.05,
      emissive: new THREE.Color(baseColor),
      emissiveIntensity: 0.2
    });
    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(16, 32, 24),
      handleMat
    );
    handle.position.y = 22;
    handle.scale.y = 0.8;
    group.add(handle);
    
    // توهج داخلي
    const glowMat = new THREE.MeshBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.25
    });
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(36, 36, 2, 32),
      glowMat
    );
    glow.position.y = 2;
    group.add(glow);
    
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
    } as any;
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
    cam.current = {...initialCam} as any;
  }, [initialCam]);

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
            stateRef.current.targetPaddles[side as Player['side']].z = p.y;
          }
        });
      }
      if (data.countdown !== undefined) {
        stateRef.current.countdown = data.countdown;
        setCountdown(data.countdown);
      }
      if (data.countdownSide !== undefined) {
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

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const mouse = new THREE.Vector2();
    const clamp = (v:number,mn:number,mx:number)=>Math.max(mn,Math.min(mx,v));
    const handlePointerMove = (e: PointerEvent) => {
      if (!e.isPrimary || !threeRef.current) return;
      if (e.target instanceof HTMLElement && e.target.closest('button')) return;
      hasDraggedRef.current = true;
      if(hintDotRef.current) hintDotRef.current.style.display='none';
      if(hintTextRef.current) hintTextRef.current.style.display='none';
      const mySide = getMySide();
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
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
        } else if (mySide === 'bottom') {
          const clampedX = clamp(tx, 45, world.w - 45);
          const clampedZ = clamp(tz - OFFSET, world.h * 0.62, world.h - 45);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
        } else if (mySide === 'left') {
          const clampedX = clamp(tx + OFFSET, 45, world.w * 0.38);
          const clampedZ = clamp(tz, 45, world.h - 45);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
        } else if (mySide === 'right') {
          const clampedX = clamp(tx - OFFSET, world.w * 0.62, world.w - 45);
          const clampedZ = clamp(tz, 45, world.h - 45);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
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
    const tableMaterial = new THREE.MeshStandardMaterial({ 
      color: '#ffffff', 
      map: surfaceTexture || undefined, 
      metalness: 0.02, 
      roughness: 0.08,
      envMapIntensity: 0.2
    });
    const table = new THREE.Mesh(new THREE.BoxGeometry(world.w, 12, world.h), tableMaterial);
    table.position.set(world.w / 2, 6, world.h / 2);
    table.receiveShadow = false;
    tableGroup.add(table);
    scene.add(tableGroup);
    const frame = createArenaFrame(world.w, world.h);
    scene.add(frame);
    
    // قرص هوكي عالي الجودة - أسود مع حلقة زرقاء مثل الصورة
    const puckGroup = new THREE.Group();
    
    // الجسم الأساسي - أسود
    const puckMat = new THREE.MeshStandardMaterial({
      color: '#0a0a0a',
      roughness: 0.25,
      metalness: 0.3,
    });
    const puckBase = new THREE.Mesh(
      new THREE.CylinderGeometry(14, 14, 10, 48),
      puckMat
    );
    puckBase.position.y = 5;
    puckGroup.add(puckBase);
    
    // حلقة زرقاء علوية - مثل الصورة
    const blueRingMat = new THREE.MeshStandardMaterial({
      color: '#0a84ff',
      roughness: 0.15,
      metalness: 0.2,
      emissive: '#0a84ff',
      emissiveIntensity: 0.6
    });
    const blueRing = new THREE.Mesh(
      new THREE.TorusGeometry(8, 1.8, 16, 32),
      blueRingMat
    );
    blueRing.rotation.x = Math.PI / 2;
    blueRing.position.y = 10.5;
    puckGroup.add(blueRing);
    
    // توهج أسود
    const puckGlowMat = new THREE.MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.4
    });
    const puckGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(18, 18, 1, 32),
      puckGlowMat
    );
    puckGlow.position.y = 0.5;
    puckGroup.add(puckGlow);
    
    puckGroup.position.y = 18;
    scene.add(puckGroup);
    const ball = puckGroup; // للتوافق مع الكود القديم
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
    const sidesForCount: Player['side'][] = needPlayers === 2? ['bottom','top'] : ['bottom','top','right','left'];
    const activeSide = (side: Player['side']) => sidesForCount.includes(side);

    const tick = (now: number) => {
      const delta = Math.min((now - state.last) / 16.67, 2);
      state.last = now;

      // --- إذا اللعبة لم تبدأ بعد: نرسم فقط الساحة ليراها اللاعب بوضوح ---
      if (threeRef.current) {
        const { ball, paddles, camera, renderer } = threeRef.current;
        const c = cam.current as any;
        c.angle += (c.targetAngle - c.angle) * 0.1;
        c.distance += (c.targetDistance - c.distance) * 0.1;
        c.height += (c.targetHeight - c.height) * 0.1;
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
        camera.position.set(cx, cy, cz);
        camera.lookAt(c.lookX, 0, c.lookZ);

        if (localReadyRef.current && !pausedRef.current && !gameEndedRef.current) {
          const lerpFactor = 0.25;
          state.ball.x += state.ball.vx * delta;
          state.ball.y += state.ball.vy * delta;
          state.ball.x += (state.ballTarget.x - state.ball.x) * lerpFactor;
          state.ball.y += (state.ballTarget.y - state.ball.y) * lerpFactor;
          state.ball.vx = state.ballTarget.vx;
          state.ball.vy = state.ballTarget.vy;
          (['top','bottom','right','left'] as Player['side'][]).forEach(side => {
            if (!activeSide(side)) return;
            const paddle = state.paddles[side];
            const target = state.targetPaddles[side];
            const PADDLE_LERP = 0.3;
            if (side !== getMySide()) {
              paddle.x += (target.x - paddle.x) * PADDLE_LERP;
              paddle.z += (target.z - paddle.z) * PADDLE_LERP;
            }
            const dx = state.ball.x - paddle.x;
            const dy = state.ball.y - paddle.z;
            const dist = Math.hypot(dx, dy);
            const HIT_DIST = 40;
            if (dist < HIT_DIST && dist > 0.5) {
              const overlap = HIT_DIST - dist;
              const nx = dx / dist;
              const ny = dy / dist;
              state.ball.x += nx * overlap;
              state.ball.y += ny * overlap;
            }
          });
          (['top','bottom','right','left'] as Player['side'][]).forEach(side => {
            if (!activeSide(side)) return;
            const target = state.targetPaddles[side];
            const current = state.paddles[side];
            const lf = side === getMySide() ? 1 : lerpFactor;
            current.x += (target.x - current.x) * lf;
            current.z += (target.z - current.z) * lf;
          });
        }

        ball.position.x = state.ball.x;
        ball.position.z = state.ball.y;
        ball.visible = localReadyRef.current ? state.countdown === 0 : true;
        if (paddles['bottom']) paddles['bottom'].position.set(state.paddles.bottom.x, 12, state.paddles.bottom.z);
        if (paddles['top']) paddles['top'].position.set(state.paddles.top.x, 12, state.paddles.top.z);
        if (paddles['left']) paddles['left'].position.set(state.paddles.left.x, 12, state.paddles.left.z);
        if (paddles['right']) paddles['right'].position.set(state.paddles.right.x, 12, state.paddles.right.z);

        if(!hasDraggedRef.current && hintDotRef.current && hintTextRef.current && mountRef.current && localReadyRef.current){
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
      {showRestoreModal && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', zIndex: 10000, color: 'white'
        }}>
          <h2>هناك إعداد كاميرا قديم، هل تريد تحميله؟</h2>
          <div style={{ display: 'flex', gap: '20px', marginTop: '20px' }}>
            <button onClick={restoreCamera} style={{ padding: '15px 30px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px' }}>نعم</button>
            <button onClick={() => { setShowRestoreModal(false); localStorage.removeItem('qoud_camera_preset'); }} style={{ padding: '15px 30px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '5px' }}>لا</button>
          </div>
        </div>
      )}

      {/* --- Overlay الجديد 3D: يغطي كامل الشاشة وشبه شفاف مع backdrop-filter --- */}
      {!localReady && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 9997,
          background: showCamMenu ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.35)',
          backdropFilter: showCamMenu ? 'blur(2px)' : 'blur(12px)',
          WebkitBackdropFilter: showCamMenu ? 'blur(2px)' : 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.3s ease',
          pointerEvents: showCamMenu ? 'none' : 'auto'
        }}>
          <div style={{
            width: showCamMenu ? 'auto' : 'calc(100% - 32px)',
            maxWidth: showCamMenu ? 'none' : '420px',
            background: 'rgba(15,15,20,0.75)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: showCamMenu ? '999px' : '20px',
            padding: showCamMenu ? '10px 16px' : '24px',
            display: 'flex', flexDirection: showCamMenu ? 'row' : 'column', gap: '12px',
            alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            pointerEvents: 'auto',
            position: showCamMenu ? 'absolute' : 'relative',
            bottom: showCamMenu ? '20px' : 'auto',
            transition: 'all 0.3s ease'
          }}>
            {!showCamMenu ? (
              <>
                <div style={{textAlign:'center'}}>
                  <h3 style={{color:'#fff', fontSize:'18px', fontWeight:900, marginBottom:'6px', textAlign:'center'}}>اضبط الكاميرا ثم ابدأ اللعب</h3>
                  <p style={{color:'rgba(255,255,255,0.6)', fontSize:'13px', lineHeight:1.4, textAlign:'center'}}>الساحة ظاهرة بوضوح خلف النافذة - جرب تحريك الكاميرا قبل البدء</p>
                </div>
                <div style={{display:'flex', gap:'12px', width:'100%'}}>
                  <button onClick={()=>setLocalReady(true)} style={{flex:1, padding:'12px 16px', fontSize:'15px', fontWeight:900, cursor:'pointer', background:'#4CAF50', border:'none', color:'white', borderRadius:'12px', boxShadow:'0 4px 12px rgba(76,175,80,0.4)'}}>▶ بدء اللعب</button>
                  <button onClick={()=>setShowCamMenu(true)} style={{flex:1, padding:'12px 16px', fontSize:'15px', fontWeight:900, cursor:'pointer', background:'#2196F3', border:'none', color:'white', borderRadius:'12px', boxShadow:'0 4px 12px rgba(33,150,243,0.4)'}}>📷 تغيير الكاميرا</button>
                </div>
              </>
            ) : (
              <>
                <span style={{color:'rgba(255,255,255,0.7)', fontSize:'12px', fontWeight:700}}>وضع الضبط</span>
                <button onClick={()=>setLocalReady(true)} style={{padding:'8px 18px', borderRadius:'999px', background:'#4CAF50', color:'#fff', fontWeight:900, border:'none', cursor:'pointer', boxShadow:'0 4px 12px rgba(76,175,80,0.4)'}}>▶ بدء اللعب</button>
                <button onClick={()=>setShowCamMenu(false)} style={{padding:'8px 12px', borderRadius:'999px', background:'rgba(255,255,255,0.1)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)', cursor:'pointer'}}>✕ إغلاق</button>
              </>
            )}
          </div>
        </div>
      )}

      {hideUI && (<button onClick={() => setHideUI(false)} style={{ position: 'absolute', top: 16, right: 16, zIndex: 30, background: '#00e5ff', color: '#000', borderRadius: 999, padding: '8px 14px', fontWeight: 900, display: 'flex', gap: 6, alignItems: 'center', border: 'none', cursor: 'pointer' }}><Eye size={16} /> {isAr? 'اظهار' : 'Show'}</button>)}
      {!hideUI && (
        <>
          <header className="game-topbar" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 24px', alignItems: 'center', zIndex: 10, background: '#0a0a0a', borderBottom: '1px solid #1a1a1a' }}>
            <div className="brand" style={{ color: '#fff', fontWeight: 'bold' }}>QOUD 3D • {mySideForCam.toUpperCase()} • HD</div>
            <div className="match-meta" style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <b>{settings.mode === 'time'? formatTime(timeLeft) : '∞'}</b>
              <span>| Rally: {rally}</span>
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
        {localReady && countdown > 0 && (
          <div style={{ position: 'absolute', inset: 0, background: countdownSide ? 'rgba(0,0,0,0.72)' : 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5, gap: '12px', pointerEvents: 'none' }}>
            <span style={{ fontSize: '120px', fontWeight: 900, color: '#ff2233', lineHeight: 1, textShadow: '0 0 25px rgba(0,0,0,0.9)' }}>{countdown}</span>
            {countdownSide && (
              <span style={{ fontSize: '18px', fontWeight: 800, color: '#fff', background: '#222', padding: '6px 16px', borderRadius: 999 }}>
                {getNameForSide(countdownSide as Player['side'])} {isAr ? 'سجل!' : 'Scored!'}
              </span>
            )}
          </div>
        )}
        {localReady && lastGoal && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(255,34,51,0.9)', color: '#fff', padding: '12px 24px', borderRadius: '12px', fontWeight: 900, zIndex: 6 }}>{isAr? 'هدف!' : 'GOAL!'} {lastGoal}</div>}
        {celebrating && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, gap: '8px' }}>
            <div style={{ fontSize: '48px', fontWeight: 900, color: '#ffcf5a', textShadow: '0 0 20px #ffcf5a' }}>{celebrating.name} {isAr? 'فاز بالجولة' : 'wins the round'}!</div>
            <div style={{ fontSize: '24px', color: '#fff', background: '#222', padding: '8px 24px', borderRadius: '999px' }}>{isAr? 'الجولة' : 'Round'} {currentRound} / {settings.seriesRounds}</div>
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
        <button onClick={() => window.location.reload()} style={{ position: 'absolute', top: 12, left: 12, zIndex: 100, background: '#ff2d2d', color: 'white', border: 'none', padding: '10px 14px', borderRadius: 12, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
          <ArrowLeft size={18} /> {isAr ? 'خروج' : 'Exit'}
        </button>

        {/* --- قائمة الكاميرا الجديدة: سلم عمودي على اليمين مثل الصورة --- */}
        {showCamMenu && !hideUI && (
          <div style={{ 
            position: 'absolute', 
            right: 12, 
            top: '50%', 
            transform: 'translateY(-50%)',
            zIndex: 10005, 
            background: 'rgba(10,10,12,0.92)', 
            backdropFilter: 'blur(18px)', 
            WebkitBackdropFilter: 'blur(18px)', 
            border: '1px solid rgba(255,255,255,0.15)', 
            borderRadius: 18, 
            padding: '12px 10px',
            width: 82,
            maxHeight: '88vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0,
            boxShadow: '0 12px 40px rgba(0,0,0,0.8)',
          }}>
            {/* رأس السلم */}
            <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:4, marginBottom:8, width:'100%'}}>
              <button onClick={()=>setShowCamMenu(false)} style={{width:28, height:28, borderRadius:'50%', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', color:'#fff', display:'grid', placeItems:'center', cursor:'pointer'}}><X size={12}/></button>
              <span style={{fontSize:10, fontWeight:900, color:'rgba(255,255,255,0.5)', letterSpacing:1}}>CAM</span>
            </div>

            {/* جسم السلم - مثل الصورة */}
            <div style={{position:'relative', width:'100%', display:'flex', flexDirection:'column', alignItems:'center', gap:0, padding:'0 6px'}}>
              {/* العمودين الجانبيين للسلم */}
              <div style={{position:'absolute', left:8, top:0, bottom:0, width:4, background:'#2a2a2a', borderRadius:2, border:'1px solid #3a3a3a'}} />
              <div style={{position:'absolute', right:8, top:0, bottom:0, width:4, background:'#2a2a2a', borderRadius:2, border:'1px solid #3a3a3a'}} />

              {/* زر Up في الأعلى مثل الصورة */}
              <div style={{zIndex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2, marginBottom:6, width:'100%'}}>
                <button onClick={() => rotateCam('up')} style={{width:'100%', height:36, background: '#ffcf5a', border:'2px solid #000', borderRadius:8, display:'grid', placeItems:'center', cursor:'pointer', boxShadow:'0 2px 0 #000'}}>
                  <ArrowUp size={18} strokeWidth={3} color="#000"/>
                </button>
                <span style={{fontSize:14, fontWeight:900, color:'#fff', textShadow:'0 1px 2px #000'}}>Up</span>
              </div>

              {/* درجات السلم - كل درجة هي preset */}
              {(Object.keys(CAM_PRESETS_3D) as Cam3DPresetKey[]).map((k, idx) => (
                <div key={k} style={{zIndex:1, width:'100%', display:'flex', flexDirection:'column', alignItems:'center', gap:2, marginBottom:6}}>
                  <button 
                    onClick={() => applyPreset(k)} 
                    title={isAr? CAM_PRESETS_3D[k].name : CAM_PRESETS_3D[k].nameEn}
                    style={{ 
                      width:'100%', 
                      height: idx===1 || idx===3 ? 28 : 34,
                      background: currentPreset === k ? '#00e5ff' : (idx%2===0 ? '#1e1e1e' : '#151515'),
                      border: currentPreset === k ? '2px solid #00e5ff' : '1.5px solid #333',
                      borderRadius:6,
                      display:'grid', 
                      placeItems:'center',
                      cursor:'pointer',
                      boxShadow: currentPreset===k ? '0 0 12px rgba(0,229,255,0.6)' : '0 2px 0 #000',
                      transition:'all 0.2s'
                    }}
                  >
                    <span style={{fontSize: idx===1 ? 9 : 10, fontWeight:900, color: currentPreset===k ? '#000' : '#aaa', lineHeight:1}}>
                      {k==='top' ? 'TOP' : k==='bottom' ? 'BOT' : k==='iso' ? 'ISO' : k==='topPlayer' ? 'ENM' : k==='sideLeft' ? 'L' : 'R'}
                    </span>
                  </button>
                  {/* خط أفقي يربط العمودين - درجة السلم */}
                  <div style={{width:'100%', height:3, background: idx%2===0 ? '#3a3a3a' : '#2a2a2a', borderRadius:2, margin:'2px 0'}} />
                </div>
              ))}

              {/* أسفل السلم - تحكم إضافي */}
              <div style={{zIndex:1, display:'flex', flexDirection:'column', gap:6, width:'100%', marginTop:8}}>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:4}}>
                  <button onClick={() => zoomCam(1)} style={{...btnStyle, height:32, padding:0, background:'#222'}}><ZoomIn size={14}/></button>
                  <button onClick={() => zoomCam(-1)} style={{...btnStyle, height:32, padding:0, background:'#222'}}><ZoomOut size={14}/></button>
                </div>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:4}}>
                  <button onClick={() => rotateCam('left')} style={{...btnStyle, height:32, padding:0}}><ArrowLeft size={14}/></button>
                  <button onClick={() => rotateCam('right')} style={{...btnStyle, height:32, padding:0}}><ArrowRight size={14}/></button>
                </div>
                <button onClick={resetCamera} style={{width:'100%', height:32, borderRadius:8, background:'#ff4081', border:'none', color:'#fff', fontWeight:900, fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4}}>
                  <Maximize2 size={12}/> RESET
                </button>
                <div style={{display:'flex', gap:4}}>
                  <button onClick={saveCameraSettings} style={{flex:1, height:28, borderRadius:6, background:'#00e5ff', border:'none', color:'#000', fontWeight:900, fontSize:9, cursor:'pointer'}}><Save size={10}/> SAVE</button>
                  <button onClick={resetCameraToDefault} style={{flex:1, height:28, borderRadius:6, background:'#ff6b8b', border:'none', color:'#fff', fontWeight:900, fontSize:9, cursor:'pointer'}}>CLR</button>
                </div>
                <button onClick={() => { setHideUI(true); setShowCamMenu(false); }} style={{width:'100%', height:26, borderRadius:6, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.5)', fontSize:9, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4}}>
                  <EyeOff size={10}/> HIDE
                </button>
              </div>
            </div>

            {/* تمثيل للساحة مثل الصورة - شكل شبه منحرف صغير */}
            <div style={{marginTop:10, width:'100%', display:'flex', justifyContent:'center', opacity:0.3}}>
              <div style={{width:48, height:32, borderTop:'2px solid #fff', borderBottom:'2px solid #ff6b5a', borderLeft:'3px solid #ff3b30', borderRight:'3px solid #ff3b30', transform:'perspective(30px) rotateX(15deg)', opacity:0.6}} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
const btnStyle: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fff', borderRadius: 8, padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontWeight: 700, cursor: 'pointer', fontSize: '10px' };
