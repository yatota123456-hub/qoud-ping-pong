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
  canvas.width = 2048;
  canvas.height = 4096;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fefefe';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, 'rgba(0,0,0,0.02)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.03)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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
  // خط المنتصف - مثل الصورة - أحمر متقطع رفيع
  ctx.strokeStyle = 'rgba(255, 60, 60, 0.85)';
  ctx.lineWidth = 4;
  ctx.setLineDash([30, 20]);
  ctx.beginPath();
  ctx.moveTo(0, canvas.height/2);
  ctx.lineTo(canvas.width, canvas.height/2);
  ctx.stroke();
  ctx.setLineDash([]);

  // الأهداف - تكبير كبير مثل الصورة المرفقة - أقواس حمراء كبيرة
  ctx.strokeStyle = 'rgba(255, 30, 30, 0.95)';
  ctx.lineWidth = 6;
  const goalRadius = 420; // تكبير كبير مثل الصورة - كان 280
  const goalLineWidth = 420 * 0.9; // عرض منطقة الهدف
  // هدف علوي - قوس كبير أحمر
  ctx.beginPath();
  ctx.arc(canvas.width/2, 0, goalRadius, 0, Math.PI, false);
  ctx.stroke();
  // هدف سفلي
  ctx.beginPath();
  ctx.arc(canvas.width/2, canvas.height, goalRadius, Math.PI, Math.PI*2, false);
  ctx.stroke();
  
  // إضافة تعبئة شفافة داخل الأهداف لإبرازها مثل الصورة
  ctx.fillStyle = 'rgba(255, 50, 50, 0.06)';
  ctx.beginPath();
  ctx.arc(canvas.width/2, 0, goalRadius, 0, Math.PI, false);
  ctx.lineTo(canvas.width/2 + goalRadius, 0);
  ctx.lineTo(canvas.width/2 - goalRadius, 0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(canvas.width/2, canvas.height, goalRadius, Math.PI, Math.PI*2, false);
  ctx.lineTo(canvas.width/2 - goalRadius, canvas.height);
  ctx.lineTo(canvas.width/2 + goalRadius, canvas.height);
  ctx.closePath();
  ctx.fill();

  // أهداف جانبية للـ 4 لاعبين - مربعة
  if (worldW >= 900 || true) {
    const sideGoalRadius = 360;
    ctx.strokeStyle = 'rgba(255, 30, 30, 0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, canvas.height/2, sideGoalRadius, -Math.PI/2, Math.PI/2, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(canvas.width, canvas.height/2, sideGoalRadius, Math.PI/2, -Math.PI/2, false);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255, 45, 45, 0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(canvas.width/2, canvas.height/2, 70, 0, Math.PI*2);
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
  scene.background = new THREE.Color('#0a0a0a');
  scene.fog = new THREE.Fog('#0a0a0a', worldWidth*1.8, worldWidth*4);
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambientLight);
  const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
  mainLight.position.set(worldWidth/2, 1200, worldHeight/2);
  scene.add(mainLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.45);
  fillLight.position.set(-worldWidth*0.3, 800, -worldHeight*0.2);
  scene.add(fillLight);
  const edgeLight1 = new THREE.PointLight(0xff2d2d, 0.6, worldWidth*1.5);
  edgeLight1.position.set(worldWidth*0.5, 80, -40);
  scene.add(edgeLight1);
  const edgeLight2 = new THREE.PointLight(0xff2d2d, 0.6, worldWidth*1.5);
  edgeLight2.position.set(worldWidth*0.5, 80, worldHeight+40);
  scene.add(edgeLight2);
  const centerLight = new THREE.PointLight(0xffffff, 0.35, worldWidth*2);
  centerLight.position.set(worldWidth/2, 600, worldHeight/2);
  scene.add(centerLight);
}

function createArenaFrameClassic(worldW: number, worldH: number) {
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
  // الأهداف - تكبير كبير مثل الصورة المرفقة - مهمة جداً
  const goalW = Math.max(380, worldW * 0.48); // تكبير كبير - كان 260
  const goalH = 36;
  const goalMat = new THREE.MeshStandardMaterial({ color: '#020202', roughness: 0.1, metalness: 0.9 });
  const goalTop = new THREE.Mesh(new THREE.BoxGeometry(goalW, goalH, bezelThickness), goalMat);
  goalTop.position.set(worldW/2, bezelY+2, -bezelThickness/2);
  group.add(goalTop);
  const goalBottom = new THREE.Mesh(new THREE.BoxGeometry(goalW, goalH, bezelThickness), goalMat);
  goalBottom.position.set(worldW/2, bezelY+2, worldH + bezelThickness/2);
  group.add(goalBottom);
  // إضافة إضاءة حمراء داخل الأهداف مثل الصورة
  const goalLightTop = new THREE.PointLight(0xff1a1a, 0.8, 250);
  goalLightTop.position.set(worldW/2, bezelY, -bezelThickness/2);
  group.add(goalLightTop);
  const goalLightBottom = new THREE.PointLight(0xff1a1a, 0.8, 250);
  goalLightBottom.position.set(worldW/2, bezelY, worldH + bezelThickness/2);
  group.add(goalLightBottom);
  if (worldW >= 900) {
    const sideGoalW = Math.max(320, worldH * 0.42);
    const goalLeft = new THREE.Mesh(new THREE.BoxGeometry(bezelThickness, goalH, sideGoalW), goalMat);
    goalLeft.position.set(-bezelThickness/2, bezelY+2, worldH/2);
    group.add(goalLeft);
    const goalRight = new THREE.Mesh(new THREE.BoxGeometry(bezelThickness, goalH, sideGoalW), goalMat);
    goalRight.position.set(worldW + bezelThickness/2, bezelY+2, worldH/2);
    group.add(goalRight);
  }
  return group;
}

function createArenaFrameModern(worldW: number, worldH: number) {
  const group = new THREE.Group();
  const bezelThickness = Math.max(38, Math.min(worldW, worldH) * 0.065);
  const bezelHeight = 36;
  const bezelY = 18;
  const bezelMat = new THREE.MeshStandardMaterial({
    color: '#ff1a1a',
    roughness: 0.22,
    metalness: 0.15,
    emissive: '#ff0000',
    emissiveIntensity: 0.08,
  });
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
  // الأهداف - تكبير كبير مثل الصورة المرفقة - تمت إضافتها الآن
  const goalW = Math.max(420, worldW * 0.52); // تكبير كبير مثل الصورة - كان 280
  const goalH = 32;
  const goalMat = new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.2, metalness: 0.1, emissive: '#111111', emissiveIntensity: 0.15 });
  // هدف علوي - كبير مثل الصورة
  const goalTop = new THREE.Mesh(new THREE.BoxGeometry(goalW, goalH, bezelThickness + 6), goalMat);
  goalTop.position.set(worldW/2, bezelY+2, -bezelThickness/2 - 3);
  group.add(goalTop);
  // هدف سفلي - كبير مثل الصورة
  const goalBottom = new THREE.Mesh(new THREE.BoxGeometry(goalW, goalH, bezelThickness + 6), goalMat);
  goalBottom.position.set(worldW/2, bezelY+2, worldH + bezelThickness/2 + 3);
  group.add(goalBottom);
  // إضاءة حمراء قوية داخل الهدف مثل الصورة
  const goalLightTop = new THREE.PointLight(0xff1a1a, 0.9, 300);
  goalLightTop.position.set(worldW/2, bezelY, -bezelThickness/2);
  group.add(goalLightTop);
  const goalLightBottom = new THREE.PointLight(0xff1a1a, 0.9, 300);
  goalLightBottom.position.set(worldW/2, bezelY, worldH + bezelThickness/2);
  group.add(goalLightBottom);
  if (worldW >= 800) {
    const sideGoalW = Math.max(380, worldH * 0.48);
    const goalLeft = new THREE.Mesh(new THREE.BoxGeometry(bezelThickness + 6, goalH, sideGoalW), goalMat);
    goalLeft.position.set(-bezelThickness/2 - 3, bezelY+2, worldH/2);
    group.add(goalLeft);
    const goalRight = new THREE.Mesh(new THREE.BoxGeometry(bezelThickness + 6, goalH, sideGoalW), goalMat);
    goalRight.position.set(worldW + bezelThickness/2 + 3, bezelY+2, worldH/2);
    group.add(goalRight);
    // إضاءة جانبية
    const leftLight = new THREE.PointLight(0xff1a1a, 0.7, 250);
    leftLight.position.set(-bezelThickness/2, bezelY, worldH/2);
    group.add(leftLight);
    const rightLight = new THREE.PointLight(0xff1a1a, 0.7, 250);
    rightLight.position.set(worldW + bezelThickness/2, bezelY, worldH/2);
    group.add(rightLight);
  }
  const innerLineMat = new THREE.MeshBasicMaterial({ color: '#ff0000', transparent: true, opacity: 0.9 });
  const lineThickness = 3;
  const topLine = new THREE.Mesh(new THREE.BoxGeometry(worldW, lineThickness, lineThickness), innerLineMat);
  topLine.position.set(worldW/2, 22, 1);
  group.add(topLine);
  const bottomLine = new THREE.Mesh(new THREE.BoxGeometry(worldW, lineThickness, lineThickness), innerLineMat);
  bottomLine.position.set(worldW/2, 22, worldH - 1);
  group.add(bottomLine);
  return group;
}

function createArenaFrame(worldW: number, worldH: number, style: 'classic' | 'modern' = 'modern') {
  return style === 'classic' ? createArenaFrameClassic(worldW, worldH) : createArenaFrameModern(worldW, worldH);
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
  const [arenaStyle, setArenaStyle] = useState<'classic' | 'modern'>('modern');
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

  const createHatPaddle = useCallback((color: string, style: 'classic' | 'modern' = arenaStyle) => {
    const group = new THREE.Group();
    const isBlue = color.toLowerCase().includes('61e7c2') || color.toLowerCase().includes('00e5ff') || color.toLowerCase().includes('blue') || color === '#61e7c2';
    const baseColor = isBlue ? '#0a84ff' : (color === '#ffcf5a' ? '#0a84ff' : color);
    
    if (style === 'classic') {
      // شكل أ - القديم: مضرب كلاسيكي مسطح مع نيون
      const baseMat = new THREE.MeshStandardMaterial({ color: '#080808', roughness: 0.2, metalness: 0.85 });
      const baseGeo = new THREE.CylinderGeometry(34, 34, 10, 48);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 5;
      group.add(base);
      const topMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.15, metalness: 0.2, emissive: baseColor, emissiveIntensity: 0.3 });
      const top = new THREE.Mesh(new THREE.CylinderGeometry(28, 28, 6, 48), topMat);
      top.position.y = 11;
      group.add(top);
      const neonTex = createNeonGradientTexture();
      const ringMat = new THREE.MeshStandardMaterial({ map: neonTex || undefined, emissive: 0xffffff, emissiveMap: neonTex || undefined, emissiveIntensity: 1.2, roughness: 0.2 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(32, 2.5, 16, 64), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 8;
      group.add(ring);
    } else {
      // شكل ب - الجديد: مضرب زجاجي حديث أحمر/أزرق مع توهج
      const baseMat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.12,
        metalness: 0.1,
        emissive: new THREE.Color(baseColor),
        emissiveIntensity: 0.15
      });
      const baseGeo = new THREE.CylinderGeometry(32, 34, 14, 48);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 7;
      group.add(base);
      const ringMat = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.08,
        metalness: 0.2,
        transparent: true,
        opacity: 0.3
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(30, 1.5, 16, 48), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 10;
      group.add(ring);
      const handleMat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.15,
        metalness: 0.05,
        emissive: new THREE.Color(baseColor),
        emissiveIntensity: 0.2
      });
      const handle = new THREE.Mesh(new THREE.SphereGeometry(16, 32, 24), handleMat);
      handle.position.y = 22;
      handle.scale.y = 0.8;
      group.add(handle);
      const glowMat = new THREE.MeshBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: 0.25
      });
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(36, 36, 2, 32), glowMat);
      glow.position.y = 2;
      group.add(glow);
      // إضاءة إضافية للشكل الجديد
      const pointLight = new THREE.PointLight(baseColor, 0.4, 80);
      pointLight.position.set(0, 15, 0);
      group.add(pointLight);
    }
    return group;
  }, [arenaStyle]);

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
      if (data.timeLeft !== undefined) {
        setTimeLeft(data.timeLeft);
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
        // تحديد عدد اللاعبين لتحديد مدى التقدم - 4 لاعبين مربعة يتقدم قليلاً فقط
        const needCount = Math.max(2, players.length, settings.players || 2);
        const isFourPlayers = needCount >= 3; // مربعة 4 لاعبين
        // للـ 4 لاعبين: تقدم قليل جداً (22% و 78%)، للـ 2 لاعبين: تقدم أكبر (38% و 62%)
        const topLimit = isFourPlayers ? world.h * 0.22 : world.h * 0.38;
        const bottomLimit = isFourPlayers ? world.h * 0.78 : world.h * 0.62;
        const leftLimit = isFourPlayers ? world.w * 0.22 : world.w * 0.38;
        const rightLimit = isFourPlayers ? world.w * 0.78 : world.w * 0.62;

        if (mySide === 'top') {
          const clampedX = clamp(tx, 45, world.w - 45);
          const clampedZ = clamp(tz + OFFSET, 45, topLimit);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
        } else if (mySide === 'bottom') {
          const clampedX = clamp(tx, 45, world.w - 45);
          const clampedZ = clamp(tz - OFFSET, bottomLimit, world.h - 45);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
        } else if (mySide === 'left') {
          const clampedX = clamp(tx + OFFSET, 45, leftLimit);
          const clampedZ = clamp(tz, 45, world.h - 45);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
        } else if (mySide === 'right') {
          const clampedX = clamp(tx - OFFSET, rightLimit, world.w - 45);
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
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
    const frame = createArenaFrame(world.w, world.h, arenaStyle);
    scene.add(frame);
    
    const puckGroup = new THREE.Group();
    const puckMat = new THREE.MeshStandardMaterial({
      color: '#0a0a0a',
      roughness: 0.25,
      metalness: 0.3,
    });
    const puckBase = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 10, 48), puckMat);
    puckBase.position.y = 5;
    puckGroup.add(puckBase);
    const blueRingMat = new THREE.MeshStandardMaterial({
      color: '#0a84ff',
      roughness: 0.15,
      metalness: 0.2,
      emissive: '#0a84ff',
      emissiveIntensity: 0.6
    });
    const blueRing = new THREE.Mesh(new THREE.TorusGeometry(8, 1.8, 16, 32), blueRingMat);
    blueRing.rotation.x = Math.PI / 2;
    blueRing.position.y = 10.5;
    puckGroup.add(blueRing);
    const puckGlowMat = new THREE.MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.4
    });
    const puckGlow = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 1, 32), puckGlowMat);
    puckGlow.position.y = 0.5;
    puckGroup.add(puckGlow);
    puckGroup.position.y = 18;
    scene.add(puckGroup);
    const ball = puckGroup;
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
  }, [world.w, world.h, playersKey, arenaStyle]);

  useEffect(() => {
    const state = stateRef.current;
    const needPlayers = Math.max(2, players.length, settings.players || 2);
    const sidesForCount: Player['side'][] = needPlayers === 2? ['bottom','top'] : ['bottom','top','right','left'];
    const activeSide = (side: Player['side']) => sidesForCount.includes(side);

    // إعدادات الفيزياء المحسنة
    const PADDLE_RADIUS = 36;
    const BALL_RADIUS = 14;
    const HIT_DIST = PADDLE_RADIUS + BALL_RADIUS;
    const MIN_SPEED = 4.5;
    const MAX_SPEED = 12;
    const WALL_BOUNCE_DAMP = 0.95;

    const tick = (now: number) => {
      const rawDelta = (now - state.last) / 16.67;
      const delta = Math.min(rawDelta, 2.5); // منع القفزات الكبيرة
      state.last = now;

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
          // حساب سرعة المضارب - مهم لمنع الاختراق
          (['top','bottom','right','left'] as Player['side'][]).forEach(side => {
            if (!activeSide(side)) return;
            const prev = state.lastPaddles[side];
            const curr = state.paddles[side];
            state.paddleVel[side].vx = (curr.x - prev.x) / (delta || 1);
            state.paddleVel[side].vy = (curr.z - prev.z) / (delta || 1);
            prev.x = curr.x;
            prev.z = curr.z;
          });

          // تحديث موقع الكرة - فيزياء محلية مستقرة
          if (state.countdown === 0) {
            // إذا أوفلاين أو Host، نحن نتحكم بالفيزياء
            if (isOfflineMode || isHost) {
              state.ball.x += state.ball.vx * delta;
              state.ball.y += state.ball.vy * delta;
            } else {
              // أونلاين كـ client: تنبؤ + تصحيح بسيط بدون overwrite للسرعة
              state.ball.x += state.ball.vx * delta;
              state.ball.y += state.ball.vy * delta;
              const corrFactor = 0.08; // تصحيح بسيط جداً لتقليل الـ lag
              state.ball.x += (state.ballTarget.x - state.ball.x) * corrFactor;
              state.ball.y += (state.ballTarget.y - state.ball.y) * corrFactor;
              // لا نستبدل السرعة كاملة - ندمج فقط
              if (Math.hypot(state.ballTarget.vx - state.ball.vx, state.ballTarget.vy - state.ball.vy) > 2) {
                state.ball.vx += (state.ballTarget.vx - state.ball.vx) * 0.15;
                state.ball.vy += (state.ballTarget.vy - state.ball.vy) * 0.15;
              }
            }

            // منع الكرة من التعلق أفقياً يمين ويسار
            const speed = Math.hypot(state.ball.vx, state.ball.vy);
            if (speed < MIN_SPEED) {
              const angle = Math.atan2(state.ball.vy, state.ball.vx);
              state.ball.vx = Math.cos(angle) * MIN_SPEED;
              state.ball.vy = Math.sin(angle) * MIN_SPEED;
            }
            if (speed > MAX_SPEED) {
              const angle = Math.atan2(state.ball.vy, state.ball.vx);
              state.ball.vx = Math.cos(angle) * MAX_SPEED;
              state.ball.vy = Math.sin(angle) * MAX_SPEED;
            }
            // إذا المسار أفقي تماماً (vy صغير جداً) - غير المسار
            if (Math.abs(state.ball.vy) < 0.8 && Math.abs(state.ball.vx) > 3) {
              state.ball.vy += (Math.random() - 0.5) * 3;
              // تأكد من عدم الالتصاق
              if (Math.abs(state.ball.vy) < 1) state.ball.vy = (Math.random() > 0.5 ? 1 : -1) * (1.5 + Math.random() * 2);
            }

            // اصطدام بالجدران (ليس الأهداف) - الأهداف كبيرة الآن مثل الصورة
            const goalHalfW = Math.max(210, world.w * 0.26); // تكبير مثل الصورة - كان 140
            const sideGoalHalfW = Math.max(190, world.h * 0.24);
            const leftBound = BALL_RADIUS;
            const rightBound = world.w - BALL_RADIUS;
            const topBound = BALL_RADIUS;
            const bottomBound = world.h - BALL_RADIUS;
            
            // جدران يمين ويسار - مع استثناء الأهداف الجانبية في 4 لاعبين - الأهداف كبيرة الآن
            if (state.ball.x < leftBound) {
              if (needPlayers < 3 || Math.abs(state.ball.y - world.h/2) > sideGoalHalfW) {
                state.ball.x = leftBound;
                state.ball.vx = Math.abs(state.ball.vx) * WALL_BOUNCE_DAMP;
                // تغيير مسار عشوائي بسيط لمنع التعلق
                state.ball.vy += (Math.random() - 0.5) * 1.5;
              }
            }
            if (state.ball.x > rightBound) {
              if (needPlayers < 3 || Math.abs(state.ball.y - world.h/2) > sideGoalHalfW) {
                state.ball.x = rightBound;
                state.ball.vx = -Math.abs(state.ball.vx) * WALL_BOUNCE_DAMP;
                state.ball.vy += (Math.random() - 0.5) * 1.5;
              }
            }
            // جدران فوق وتحت - مع استثناء الأهداف - الأهداف كبيرة الآن مثل الصورة
            if (state.ball.y < topBound) {
              if (Math.abs(state.ball.x - world.w/2) > goalHalfW) {
                state.ball.y = topBound;
                state.ball.vy = Math.abs(state.ball.vy) * WALL_BOUNCE_DAMP;
                state.ball.vx += (Math.random() - 0.5) * 1.5;
              }
            }
            if (state.ball.y > bottomBound) {
              if (Math.abs(state.ball.x - world.w/2) > goalHalfW) {
                state.ball.y = bottomBound;
                state.ball.vy = -Math.abs(state.ball.vy) * WALL_BOUNCE_DAMP;
                state.ball.vx += (Math.random() - 0.5) * 1.5;
              }
            }

            // اصطدام بالمضارب - إصلاح الاختراق من الخلف + lag
            (['top','bottom','right','left'] as Player['side'][]).forEach(side => {
              if (!activeSide(side)) return;
              const paddle = state.paddles[side];
              const pVel = state.paddleVel[side];
              
              const dx = state.ball.x - paddle.x;
              const dy = state.ball.y - paddle.z;
              const dist = Math.hypot(dx, dy);
              
              if (dist >= HIT_DIST || dist < 0.5) return;

              // منع الاصطدام من الخلف - فقط من الأمام
              let isFrontHit = false;
              if (side === 'bottom') {
                // مضرب الأسفل - الأمام هو فوق (الكرة فوق المضرب)
                isFrontHit = state.ball.y < paddle.z && state.ball.vy > 0; // الكرة قادمة من فوق متجهة للأسفل
              } else if (side === 'top') {
                isFrontHit = state.ball.y > paddle.z && state.ball.vy < 0;
              } else if (side === 'left') {
                isFrontHit = state.ball.x > paddle.x && state.ball.vx < 0;
              } else if (side === 'right') {
                isFrontHit = state.ball.x < paddle.x && state.ball.vx > 0;
              }
              
              // إذا ليس أمامي، وتجاوز المضرب - ادفع الكرة للخارج بقوة بدون تغيير مسار كبير (منع الاختراق)
              if (!isFrontHit) {
                // إذا الكرة خلف المضرب وتحاول الاختراق - ادفعها بسرعة
                const pushFactor = 1.5;
                const nx = dx / dist;
                const ny = dy / dist;
                const overlap = HIT_DIST - dist + 2; // +2 لتأمين عدم الاختراق
                state.ball.x += nx * overlap * pushFactor;
                state.ball.y += ny * overlap * pushFactor;
                // لا تغير السرعة كثيراً إذا من الخلف - فقط ادفع
                return;
              }

              // اصطدام أمامي صحيح - فيزياء محسنة
              const nx = dx / dist;
              const ny = dy / dist;
              
              // إخراج الكرة من التداخل فوراً - منع الـ lag
              const overlap = HIT_DIST - dist + 1;
              state.ball.x += nx * overlap;
              state.ball.y += ny * overlap;

              // حساب الارتداد مع سرعة المضرب - مثل Air Hockey الحقيقي
              const paddleSpeedFactor = 0.35;
              const ballVelDotNormal = state.ball.vx * nx + state.ball.vy * ny;
              
              // ارتداد مع إضافة سرعة المضرب
              let newVx = state.ball.vx - 2 * ballVelDotNormal * nx + pVel.vx * paddleSpeedFactor;
              let newVy = state.ball.vy - 2 * ballVelDotNormal * ny + pVel.vy * paddleSpeedFactor;

              // تأثير مكان الضرب على المضرب - يغير المسار
              const hitOffset = side === 'bottom' || side === 'top' 
                ? (state.ball.x - paddle.x) / PADDLE_RADIUS // -1 إلى 1
                : (state.ball.y - paddle.z) / PADDLE_RADIUS;
              
              if (side === 'bottom' || side === 'top') {
                newVx += hitOffset * 3.5; // ضرب الحافة يغير المسار أفقياً
              } else {
                newVy += hitOffset * 3.5;
              }

              // زيادة السرعة قليلاً مع كل ضربة - Rally
              const speedBoost = 1.05 + state.rally * 0.02;
              let newSpeed = Math.hypot(newVx, newVy) * speedBoost;
              newSpeed = Math.min(newSpeed, MAX_SPEED);
              newSpeed = Math.max(newSpeed, MIN_SPEED);
              
              const angle = Math.atan2(newVy, newVx);
              // منع الزاوية الأفقية تماماً
              let finalAngle = angle;
              const deg = angle * 180 / Math.PI;
              if (Math.abs(Math.sin(finalAngle)) < 0.25) { // أقل من 14 درجة
                finalAngle += (Math.random() > 0.5 ? 1 : -1) * 0.35; // أضف 20 درجة
              }
              
              state.ball.vx = Math.cos(finalAngle) * newSpeed;
              state.ball.vy = Math.sin(finalAngle) * newSpeed;

              state.rally++;
              setRally(state.rally);
              
              // إرسال للشبكة إذا Host
              if (isHost && !isOfflineMode) {
                socket.sendBallState?.(state.ball.x, state.ball.y, state.ball.vx, state.ball.vy);
              }
            });
          }

          // تحديث مواقع المضارب - مع منع الـ lag
          (['top','bottom','right','left'] as Player['side'][]).forEach(side => {
            if (!activeSide(side)) return;
            const target = state.targetPaddles[side];
            const current = state.paddles[side];
            if (side === getMySide()) {
              // مضربي أنا - فوري بدون lerp لتقليل الـ lag
              current.x = target.x;
              current.z = target.z;
            } else {
              // مضارب الخصم - lerp سريع لتقليل الـ lag
              const PADDLE_LERP = isOfflineMode ? 1 : 0.45; // كان 0.3 - الآن أسرع
              current.x += (target.x - current.x) * PADDLE_LERP;
              current.z += (target.z - current.z) * PADDLE_LERP;
            }
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

  const totalScore = Object.values(scores as any).reduce((a:any,b:any)=>a+b,0) as number;
  const myScore = scores[players.find(p=>p.side===mySideForCam)?.id || players[0]?.id] ?? 0;
  const opponentScore = totalScore - myScore;

  return (
    <main className="game-shell" style={{ background: '#0a0a0a', display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
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

      {/* لا نغطي الساحة - شريط صغير للبدء في الأسفل فقط + شكل الساحة على اليمين صغير فوق الأيقونات */}
      {!localReady && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9997, display: 'flex', gap: '12px', alignItems: 'center',
          background: 'rgba(15,15,20,0.88)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.15)', borderRadius: '999px', padding: '10px 18px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)', pointerEvents: 'auto'
        }}>
          <button onClick={()=>setLocalReady(true)} style={{padding:'10px 22px', borderRadius:'999px', background:'#4CAF50', color:'#fff', fontWeight:900, border:'none', cursor:'pointer', boxShadow:'0 4px 12px rgba(76,175,80,0.4)', fontSize:'14px'}}>▶ ابدأ بـ {arenaStyle==='classic' ? 'أ' : 'ب'}</button>
          <div style={{width:'1px', height:'22px', background:'rgba(255,255,255,0.15)'}}/>
          <span style={{color:'rgba(255,255,255,0.6)', fontSize:'11px', whiteSpace:'nowrap'}}>اختر الشكل من اليمين ←</span>
          <button onClick={()=>setShowCamMenu(v=>!v)} style={{padding:'8px 14px', borderRadius:'999px', background: showCamMenu ? '#00e5ff' : 'rgba(255,255,255,0.12)', color: showCamMenu ? '#000' : '#fff', border:'none', cursor:'pointer', fontSize:'11px', fontWeight:800}}>{showCamMenu ? 'إخفاء' : '📷 كاميرا'}</button>
        </div>
      )}

      {hideUI && (<button onClick={() => setHideUI(false)} style={{ position: 'absolute', top: 16, right: 16, zIndex: 30, background: '#00e5ff', color: '#000', borderRadius: 999, padding: '8px 14px', fontWeight: 900, display: 'flex', gap: 6, alignItems: 'center', border: 'none', cursor: 'pointer' }}><Eye size={16} /> {isAr? 'اظهار' : 'Show'}</button>)}
      {!hideUI && (
        <>
          {/* شريط علوي احترافي مثل الصورة - 3D AIR HOCKEY / SCORE / TIME / PAUSE / RESET */}
          <header style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0',
            margin: '10px 12px',
            height: '48px',
            background: 'linear-gradient(90deg, #3a3a3a 0%, #3a3a3a 35%, #1a1a1a 35%, #1a1a1a 100%)',
            borderRadius: '10px',
            border: '1px solid #2a2a2a',
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 20,
            position: 'relative'
          }}>
            {/* قسم الشعار - مثل الصورة */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '0 18px',
              height: '100%',
              background: '#5a5a5a',
              clipPath: 'polygon(0 0, 88% 0, 78% 100%, 0 100%)',
              minWidth: '220px'
            }}>
              <div style={{
                width: '32px', height: '22px', background: '#0a0a0a', borderRadius: '50% / 50%',
                border: '2px solid #888', display:'grid', placeItems:'center',
                boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.3)'
              }}>
                <div style={{width:'20px', height:'4px', background:'#0a84ff', borderRadius:'2px'}}/>
              </div>
              <span style={{color:'#000', fontWeight:900, fontSize:'17px', letterSpacing:0.5, fontFamily:'system-ui'}}>3D AIR HOCKEY</span>
            </div>

            {/* قسم النقاط والوقت */}
            <div style={{display:'flex', alignItems:'center', gap:'18px', padding:'0 12px', flex:1, justifyContent:'center'}}>
              <div style={{display:'flex', alignItems:'center', gap:'6px'}}>
                <span style={{color:'rgba(255,255,255,0.5)', fontSize:'10px', fontWeight:700, letterSpacing:1}}>SCORE</span>
                <span style={{color:'#fff', fontWeight:900, fontSize:'18px', fontVariantNumeric:'tabular-nums'}}>
                  {myScore} — {opponentScore}
                </span>
              </div>
              <div style={{width:'1px', height:'24px', background:'rgba(255,255,255,0.1)'}}/>
              <div style={{display:'flex', alignItems:'center', gap:'6px'}}>
                <span style={{color:'rgba(255,255,255,0.5)', fontSize:'10px', fontWeight:700, letterSpacing:1}}>TIME</span>
                <span style={{color:'#fff', fontWeight:900, fontSize:'18px', fontVariantNumeric:'tabular-nums'}}>
                  {settings.mode === 'time'? formatTime(timeLeft) : '∞'} 
                </span>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:'2px', marginLeft:'8px'}}>
                <span style={{color:'#ff2d2d', fontSize:'12px'}}>•</span>
                <span style={{color:'rgba(255,255,255,0.6)', fontSize:'11px'}}>Rally {rally}</span>
              </div>
              {settings.seriesType === 'series' && (
                <div style={{display:'flex', alignItems:'center', gap:'6px', background:'rgba(255,207,90,0.1)', border:'1px solid rgba(255,207,90,0.2)', padding:'2px 8px', borderRadius:'12px'}}>
                  <span style={{color:'#ffcf5a', fontSize:'10px', fontWeight:900}}>R{currentRound}/{settings.seriesRounds}</span>
                </div>
              )}
            </div>

            {/* أزرار التحكم */}
            <div style={{display:'flex', alignItems:'center', gap:'6px', padding:'0 8px 0 0'}}>
              <button onClick={() => setShowCamMenu(v =>!v)} style={{
                background: showCamMenu ? '#00e5ff' : 'rgba(255,255,255,0.08)',
                color: showCamMenu ? '#000' : 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius:'6px', padding:'6px 12px', fontSize:'11px', fontWeight:800,
                cursor:'pointer', display:'flex', alignItems:'center', gap:'4px'
              }}>
                <Camera size={12}/> CAM
              </button>
              <button onClick={onPause} style={{
                background:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.7)',
                border:'1px solid rgba(255,255,255,0.1)', borderRadius:'6px',
                padding:'6px 12px', fontSize:'11px', fontWeight:800, cursor:'pointer',
                display:'flex', alignItems:'center', gap:'4px'
              }}>
                {paused? <><Play size={12}/> RESUME</> : <><Pause size={12}/> PAUSE</>}
              </button>
              <button onClick={resetCamera} style={{
                background:'rgba(255,207,90,0.15)', color:'#ffcf5a',
                border:'1px solid rgba(255,207,90,0.2)', borderRadius:'6px',
                padding:'6px 10px', fontSize:'11px', fontWeight:800, cursor:'pointer'
              }}>
                RESET
              </button>
            </div>
          </header>

          <div style={{ display: 'flex', gap: '8px', padding: '0 12px 8px 12px', overflowX: 'auto' }}>
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
      <div ref={mountRef} style={{ width: '100%', flex: 1, borderRadius: '16px', overflow: 'hidden', position: 'relative', touchAction: 'none', margin: '0 8px 8px 8px', border: '2px solid #1a1a1a' }}>
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
        <button onClick={() => window.location.reload()} style={{ position: 'absolute', top: 12, left: 12, zIndex: 100, background: '#ff2d2d', color: 'white', border: 'none', padding: '8px 12px', borderRadius: 8, fontSize:'11px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
          <ArrowLeft size={14} /> EXIT
        </button>

        {/* شكل الساحة - على اليمين فوق الأيقونات صغير مع رسم الساحة عليه - شكل أ / ب - يختفي عند بدء اللعب */}
        {!hideUI && !localReady && (
          <div style={{
            position: 'absolute', right: 12, top: 12, zIndex: 10004,
            background: 'rgba(10,10,12,0.92)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14, padding: '8px', display: 'flex',
            flexDirection: 'column', gap: '6px', alignItems: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.7)', width: 88
          }}>
            <span style={{fontSize:9, fontWeight:900, color:'rgba(255,255,255,0.5)', letterSpacing:1}}>SHAPE</span>
            <div style={{display:'flex', gap:'6px'}}>
              {/* شكل أ - القديم */}
              <button onClick={()=>setArenaStyle('classic')} title="الشكل القديم - إطار أسود + نيون" style={{
                width:36, height:52, borderRadius:8,
                background: arenaStyle==='classic' ? '#00e5ff' : '#1e1e1e',
                border: arenaStyle==='classic' ? '2px solid #00e5ff' : '1px solid #333',
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer',
                position:'relative', overflow:'hidden', boxShadow: arenaStyle==='classic' ? '0 0 12px rgba(0,229,255,0.5)' : 'none'
              }}>
                <div style={{width:22, height:32, background:'#000', border:'1.5px solid #00e5ff', borderRadius:2, position:'relative'}}>
                  <div style={{position:'absolute', inset:'2px', background:'#fff', opacity:0.9}}/>
                  <div style={{position:'absolute', top:'50%', left:0, right:0, height:'1px', background:'#ff0000'}}/>
                  <div style={{position:'absolute', top:-2, left:'50%', transform:'translateX(-50%)', width:10, height:3, background:'#000'}}/>
                  <div style={{position:'absolute', bottom:-2, left:'50%', transform:'translateX(-50%)', width:10, height:3, background:'#000'}}/>
                </div>
                <span style={{fontSize:11, fontWeight:900, color: arenaStyle==='classic' ? '#000' : '#fff', marginTop:2}}>أ</span>
              </button>
              {/* شكل ب - الجديد */}
              <button onClick={()=>setArenaStyle('modern')} title="الشكل الجديد - إطار أحمر + HD" style={{
                width:36, height:52, borderRadius:8,
                background: arenaStyle==='modern' ? '#00e5ff' : '#1e1e1e',
                border: arenaStyle==='modern' ? '2px solid #00e5ff' : '1px solid #333',
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer',
                position:'relative', overflow:'hidden', boxShadow: arenaStyle==='modern' ? '0 0 12px rgba(0,229,255,0.5)' : 'none'
              }}>
                <div style={{width:22, height:32, background:'#ff1a1a', borderRadius:2, position:'relative', boxShadow:'0 1px 2px rgba(0,0,0,0.3)'}}>
                  <div style={{position:'absolute', inset:'3px', background:'#fefefe', borderRadius:1}}/>
                  <div style={{position:'absolute', top:'50%', left:'3px', right:'3px', height:'1px', background:'#ff0000', opacity:0.8}}/>
                  <div style={{position:'absolute', top:-1, left:'50%', transform:'translateX(-50%)', width:8, height:2, background:'#000', borderRadius:1}}/>
                  <div style={{position:'absolute', bottom:-1, left:'50%', transform:'translateX(-50%)', width:8, height:2, background:'#000', borderRadius:1}}/>
                </div>
                <span style={{fontSize:11, fontWeight:900, color: arenaStyle==='modern' ? '#000' : '#fff', marginTop:2}}>ب</span>
              </button>
            </div>
            <span style={{fontSize:7, color:'rgba(255,255,255,0.35)', textAlign:'center', lineHeight:1.1}}>أ=قديم<br/>ب=جديد</span>
          </div>
        )}

        {showCamMenu && !hideUI && (
          <div style={{ 
            position: 'absolute', 
            right: 12, 
            top: '110px',
            zIndex: 10005, 
            background: 'rgba(10,10,12,0.94)', 
            backdropFilter: 'blur(20px)', 
            WebkitBackdropFilter: 'blur(20px)', 
            border: '1px solid rgba(255,255,255,0.15)', 
            borderRadius: 20, 
            padding: '10px 8px',
            width: 88,
            height: '58vh',
            maxHeight: '520px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0,
            boxShadow: '0 16px 48px rgba(0,0,0,0.85)',
          }}>
            {/* رأس */}
            <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:4, marginBottom:8, width:'100%', flexShrink:0}}>
              <button onClick={()=>setShowCamMenu(false)} style={{width:32, height:32, borderRadius:'50%', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)', color:'#fff', display:'grid', placeItems:'center', cursor:'pointer'}}><X size={14}/></button>
              <span style={{fontSize:10, fontWeight:900, color:'rgba(255,255,255,0.6)', letterSpacing:1.2}}>CAMERA</span>
              <div style={{width:'100%', height:'1px', background:'rgba(255,255,255,0.1)', margin:'4px 0'}}/>
            </div>

            {/* Up - بنفس الحجم */}
            <button onClick={() => rotateCam('up')} style={{
              width: 64, height: 48, minHeight:48, flexShrink:0,
              background: '#ffcf5a', border:'2px solid #000', borderRadius:12,
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
              cursor:'pointer', boxShadow:'0 3px 0 #000, 0 4px 12px rgba(255,207,90,0.4)',
              gap:2, marginBottom:8
            }}>
              <ArrowUp size={20} strokeWidth={3} color="#000"/>
              <span style={{fontSize:10, fontWeight:900, color:'#000'}}>Up</span>
            </button>

            {/* منطقة Scroll للكاميرات - كلها نفس الحجم */}
            <div style={{
              flex:1, width:'100%', overflowY:'auto', overflowX:'hidden',
              display:'flex', flexDirection:'column', alignItems:'center', gap:6,
              padding:'4px 2px', 
              scrollbarWidth:'thin',
              scrollbarColor:'#333 #111',
              borderTop:'1px solid rgba(255,255,255,0.06)',
              borderBottom:'1px solid rgba(255,255,255,0.06)',
              background:'rgba(0,0,0,0.2)', borderRadius:'8px'
            }}>
              <style>{`
                div::-webkit-scrollbar { width: 4px; }
                div::-webkit-scrollbar-track { background: #111; border-radius: 2px; }
                div::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
                div::-webkit-scrollbar-thumb:hover { background: #444; }
              `}</style>
              {(Object.keys(CAM_PRESETS_3D) as Cam3DPresetKey[]).map((k) => (
                <button 
                  key={k}
                  onClick={() => applyPreset(k)} 
                  title={isAr? CAM_PRESETS_3D[k].name : CAM_PRESETS_3D[k].nameEn}
                  style={{ 
                    width: 64, height: 48, minHeight:48, flexShrink:0,
                    background: currentPreset === k ? '#00e5ff' : '#1e1e1e',
                    border: currentPreset === k ? '2px solid #00e5ff' : '1.5px solid #333',
                    borderRadius:12,
                    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                    cursor:'pointer',
                    boxShadow: currentPreset===k ? '0 0 16px rgba(0,229,255,0.6), 0 3px 0 #000' : '0 3px 0 #000',
                    transition:'all 0.2s',
                    gap:2
                  }}
                >
                  <span style={{fontSize: 11, fontWeight:900, color: currentPreset===k ? '#000' : '#fff', lineHeight:1}}>
                    {k==='top' ? 'TOP' : k==='bottom' ? 'BOT' : k==='iso' ? 'ISO' : k==='topPlayer' ? 'ENM' : k==='sideLeft' ? 'LEFT' : 'RIGHT'}
                  </span>
                  <span style={{fontSize:8, fontWeight:700, color: currentPreset===k ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.4)'}}>
                    {k==='top' ? '⬆' : k==='bottom' ? '⬇' : k==='iso' ? '◫' : '◧'}
                  </span>
                </button>
              ))}
              {/* أزرار إضافية بنفس الحجم */}
              <button onClick={() => zoomCam(1)} style={{width:64, height:48, minHeight:48, flexShrink:0, background:'#222', border:'1.5px solid #333', borderRadius:12, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 3px 0 #000', gap:2}}>
                <ZoomIn size={16} color="#fff"/><span style={{fontSize:8, fontWeight:800, color:'#aaa'}}>ZOOM+</span>
              </button>
              <button onClick={() => zoomCam(-1)} style={{width:64, height:48, minHeight:48, flexShrink:0, background:'#222', border:'1.5px solid #333', borderRadius:12, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 3px 0 #000', gap:2}}>
                <ZoomOut size={16} color="#fff"/><span style={{fontSize:8, fontWeight:800, color:'#aaa'}}>ZOOM-</span>
              </button>
              <button onClick={() => rotateCam('left')} style={{width:64, height:48, minHeight:48, flexShrink:0, background:'#1a1a1a', border:'1.5px solid #333', borderRadius:12, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 3px 0 #000', gap:2}}>
                <ArrowLeft size={16} color="#fff"/><span style={{fontSize:8, fontWeight:800, color:'#aaa'}}>LEFT</span>
              </button>
              <button onClick={() => rotateCam('right')} style={{width:64, height:48, minHeight:48, flexShrink:0, background:'#1a1a1a', border:'1.5px solid #333', borderRadius:12, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 3px 0 #000', gap:2}}>
                <ArrowRight size={16} color="#fff"/><span style={{fontSize:8, fontWeight:800, color:'#aaa'}}>RIGHT</span>
              </button>
            </div>

            {/* Down - بنفس الحجم */}
            <button onClick={() => rotateCam('down')} style={{
              width: 64, height: 48, minHeight:48, flexShrink:0,
              background: '#ff6b8b', border:'2px solid #000', borderRadius:12,
              display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
              cursor:'pointer', boxShadow:'0 3px 0 #000, 0 4px 12px rgba(255,107,139,0.4)',
              gap:2, marginTop:8, marginBottom:8
            }}>
              <span style={{fontSize:10, fontWeight:900, color:'#fff'}}>Down</span>
              <ArrowDown size={20} strokeWidth={3} color="#fff"/>
            </button>

            {/* أزرار التحكم السفلية */}
            <div style={{display:'flex', flexDirection:'column', gap:6, width:'100%', flexShrink:0}}>
              <button onClick={resetCamera} style={{width:'100%', height:36, borderRadius:10, background:'#ff4081', border:'none', color:'#fff', fontWeight:900, fontSize:10, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4, boxShadow:'0 2px 0 #000'}}>
                <Maximize2 size={12}/> RESET
              </button>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:4}}>
                <button onClick={saveCameraSettings} style={{height:32, borderRadius:8, background:'#00e5ff', border:'none', color:'#000', fontWeight:900, fontSize:9, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:3}}><Save size={10}/> SAVE</button>
                <button onClick={resetCameraToDefault} style={{height:32, borderRadius:8, background:'#333', border:'1px solid #444', color:'#fff', fontWeight:900, fontSize:9, cursor:'pointer'}}>CLR</button>
              </div>
              <button onClick={() => { setHideUI(true); setShowCamMenu(false); }} style={{width:'100%', height:30, borderRadius:8, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.5)', fontSize:9, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4}}>
                <EyeOff size={10}/> HIDE UI
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{
        display:'flex', justifyContent:'space-between', alignItems:'center',
        padding:'6px 12px', background:'#0a0a0a', borderTop:'1px solid #1a1a1a',
        fontSize:'10px', color:'rgba(255,255,255,0.4)'
      }}>
        <span>CAMERA: PERSPECTIVE • MODE: {currentPreset.toUpperCase()}</span>
        <span>CONTROLS: USE LADDER TO ADJUST CAMERA</span>
      </div>
    </main>
  );
}
const btnStyle: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#fff', borderRadius: 8, padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontWeight: 700, cursor: 'pointer', fontSize: '10px' };
