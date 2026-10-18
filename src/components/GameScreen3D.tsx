import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Pause, Play, X, RotateCcw, Camera, Eye, EyeOff,
  ZoomIn, ZoomOut, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  RotateCw, Save, Video, Maximize2, Trophy, Volume2, VolumeX
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { socket } from '../socket.tsx';
import {
  getArenaWorld as getArenaWorldImported,
  clampPaddlePosition,
  BALL_RADIUS,
  PADDLE_RADIUS,
  BORDER_THICKNESS,
  ARENA_SCALES,
} from '../shared/roomSchema';

type Player = {
  id: number | string;
  name: string;
  color: string;
  side: 'top' | 'right' | 'bottom' | 'left';
  computer: boolean;
  socketId?: string;
  isBot?: boolean;
};
type Settings = any;
type Scores = Record<string | number, number>;

// دالة فحص الجهاز المحمول
const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
};

function safeGetMaxAnisotropy(renderer?: THREE.WebGLRenderer): number {
  try {
    if (!renderer) return 1;
    const max = renderer.capabilities.getMaxAnisotropy();
    return Math.min(max, isMobileDevice() ? 2 : 4);
  } catch {
    return 1;
  }
}

// إنشاء قماش سطح الطاولة بدقة عالية مع حماية ذاكرة الجوال لمنع الشاشة البيضاء
function createAirHockeySurface(worldW: number, worldH: number, renderer?: THREE.WebGLRenderer) {
  const mobile = isMobileDevice();
  const canvas = document.createElement('canvas');
  // 1024x2048 للديسكتوب و 512x1024 للجوال يوفر استهلاك الذاكرة ويمنع Context Loss
  canvas.width = mobile ? 512 : 1024;
  canvas.height = mobile ? 1024 : 2048;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;

  ctx.fillStyle = '#f8f8f8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, 'rgba(0,0,0,0.03)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.03)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // شبكة ثقوب الهواء (Air Hockey Holes)
  ctx.fillStyle = 'rgba(15,15,15,0.85)';
  const dotSize = mobile ? 1.3 : 2.0;
  const spacing = mobile ? 24 : 32;
  for (let y = spacing / 2; y < canvas.height; y += spacing) {
    const isEvenRow = Math.floor(y / spacing) % 2 === 0;
    for (let x = spacing / 2; x < canvas.width; x += spacing) {
      const offset = isEvenRow ? 0 : spacing / 2;
      if (x + offset >= canvas.width - spacing / 2) continue;
      ctx.beginPath();
      ctx.arc(x + offset, y, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // خط الوسط الأحمر المتقطع
  ctx.strokeStyle = 'rgba(255, 45, 45, 0.85)';
  ctx.lineWidth = mobile ? 3 : 5;
  ctx.setLineDash([25, 18]);
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // أقواس منطقة المرمى العلوية والسفلية
  ctx.strokeStyle = '#ff2828';
  ctx.lineWidth = mobile ? 5 : 8;
  const goalRadius = mobile ? 120 : 240;

  // القوس العلوي
  ctx.beginPath();
  ctx.arc(canvas.width / 2, 0, goalRadius, 0, Math.PI, false);
  ctx.stroke();

  // القوس السفلي
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height, goalRadius, Math.PI, Math.PI * 2, false);
  ctx.stroke();

  // تظليل منطقة المرمى
  ctx.fillStyle = 'rgba(255, 30, 30, 0.12)';
  ctx.beginPath();
  ctx.arc(canvas.width / 2, 0, goalRadius, 0, Math.PI, false);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height, goalRadius, Math.PI, Math.PI * 2, false);
  ctx.closePath();
  ctx.fill();

  // خطوط بيضاء داخلية أنيقة
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = mobile ? 2 : 3;
  ctx.beginPath();
  ctx.arc(canvas.width / 2, 0, Math.max(10, goalRadius - 8), 0, Math.PI, false);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height, Math.max(10, goalRadius - 8), Math.PI, Math.PI * 2, false);
  ctx.stroke();

  // أقواس جانبية للمباريات الرباعية (4 لاعبين)
  const isSquareArena = worldW >= 950 && Math.abs(worldW - worldH) < 150;
  if (isSquareArena) {
    const sideGoalRadius = mobile ? 120 : 240;
    ctx.strokeStyle = '#ff2828';
    ctx.lineWidth = mobile ? 5 : 8;
    ctx.beginPath();
    ctx.arc(0, canvas.height / 2, sideGoalRadius, -Math.PI / 2, Math.PI / 2, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(canvas.width, canvas.height / 2, sideGoalRadius, Math.PI / 2, -Math.PI / 2, false);
    ctx.stroke();
  }

  // الدائرة المركزية
  ctx.strokeStyle = 'rgba(255, 45, 45, 0.4)';
  ctx.lineWidth = mobile ? 2.5 : 4;
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, mobile ? 28 : 55, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = safeGetMaxAnisotropy(renderer);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// نسيج التدرج النيوني للإطار المحيط
function createNeonGradientTexture(renderer?: THREE.WebGLRenderer) {
  const mobile = isMobileDevice();
  const canvas = document.createElement('canvas');
  canvas.width = mobile ? 256 : 512;
  canvas.height = mobile ? 16 : 32;
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
  tex.anisotropy = safeGetMaxAnisotropy(renderer);
  tex.needsUpdate = true;
  return tex;
}

function buildRoundedRectPoints(w: number, h: number, r: number, segmentsPerCorner = 12) {
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

// إضاءة الساحة ثلاثية الأبعاد
function setup3DArenaLighting(scene: THREE.Scene, worldWidth: number, worldHeight: number) {
  const mobile = isMobileDevice();
  scene.background = new THREE.Color('#0a0a0a');
  // تخفيف الضباب كي لا تختفي المضارب والكرة
  scene.fog = new THREE.Fog('#0a0a0a', worldWidth * 3, worldWidth * 8);

  const ambientLight = new THREE.AmbientLight(0xffffff, mobile ? 1.05 : 0.85);
  scene.add(ambientLight);

  const mainLight = new THREE.DirectionalLight(0xffffff, mobile ? 1.0 : 1.25);
  mainLight.position.set(worldWidth / 2, 1200, worldHeight / 2);
  scene.add(mainLight);

  if (!mobile) {
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-worldWidth * 0.3, 800, -worldHeight * 0.2);
    scene.add(fillLight);
  }

  const edgeLight1 = new THREE.PointLight(0xff2d2d, 0.5, worldWidth * 1.5);
  edgeLight1.position.set(worldWidth * 0.5, 80, -40);
  scene.add(edgeLight1);

  const edgeLight2 = new THREE.PointLight(0xff2d2d, 0.5, worldWidth * 1.5);
  edgeLight2.position.set(worldWidth * 0.5, 80, worldHeight + 40);
  scene.add(edgeLight2);
}

// الإطار الكلاسيكي
function createArenaFrameClassic(worldW: number, worldH: number, renderer?: THREE.WebGLRenderer) {
  const mobile = isMobileDevice();
  const group = new THREE.Group();
  const bezelThickness = Math.max(30, Math.min(worldW, worldH) * 0.055);
  const bezelHeight = mobile ? 22 : 28;
  const bezelY = 13;
  const bezelMat = new THREE.MeshStandardMaterial({
    color: '#080808',
    roughness: 0.22,
    metalness: 0.8
  });
  const isSquareArena = worldW >= 950 && Math.abs(worldW - worldH) < 150;
  const goalGapW = worldW * 0.68;
  const goalGapH = worldH * 0.58;

  const bezelPieces: any[] = [];
  const topSideWidth = (worldW - goalGapW) / 2 + bezelThickness;
  const topLeftX = -bezelThickness + topSideWidth / 2;
  const topRightX = worldW + bezelThickness - topSideWidth / 2;
  bezelPieces.push(
    { w: topSideWidth, d: bezelThickness, x: topLeftX, z: -bezelThickness / 2 },
    { w: topSideWidth, d: bezelThickness, x: topRightX, z: -bezelThickness / 2 }
  );
  bezelPieces.push(
    { w: topSideWidth, d: bezelThickness, x: topLeftX, z: worldH + bezelThickness / 2 },
    { w: topSideWidth, d: bezelThickness, x: topRightX, z: worldH + bezelThickness / 2 }
  );
  if (isSquareArena) {
    const sideWidth = (worldH - goalGapH) / 2 + bezelThickness;
    const leftTopZ = -bezelThickness + sideWidth / 2;
    const leftBottomZ = worldH + bezelThickness - sideWidth / 2;
    bezelPieces.push(
      { w: bezelThickness, d: sideWidth, x: -bezelThickness / 2, z: leftTopZ },
      { w: bezelThickness, d: sideWidth, x: -bezelThickness / 2, z: leftBottomZ },
      { w: bezelThickness, d: sideWidth, x: worldW + bezelThickness / 2, z: leftTopZ },
      { w: bezelThickness, d: sideWidth, x: worldW + bezelThickness / 2, z: leftBottomZ }
    );
  } else {
    bezelPieces.push(
      { w: bezelThickness, d: worldH, x: -bezelThickness / 2, z: worldH / 2 },
      { w: bezelThickness, d: worldH, x: worldW + bezelThickness / 2, z: worldH / 2 }
    );
  }
  bezelPieces.forEach((p) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, bezelHeight, p.d), bezelMat);
    mesh.position.set(p.x, bezelY, p.z);
    group.add(mesh);
  });

  const neonRadius = Math.min(38, Math.min(worldW, worldH) * 0.06);
  const segCorner = mobile ? 6 : 12;
  const neonPts = buildRoundedRectPoints(worldW, worldH, neonRadius, segCorner);
  const neonCurve = new THREE.CatmullRomCurve3(neonPts, true, 'catmullrom', 0.15);
  const tubeSegs = mobile ? 48 : 96;
  const neonGeo = new THREE.TubeGeometry(neonCurve, tubeSegs, mobile ? 4.0 : 6.0, mobile ? 6 : 10, true);
  const neonTex = createNeonGradientTexture(renderer);
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

  return group;
}

// الإطار العصري
function createArenaFrameModern(worldW: number, worldH: number, renderer?: THREE.WebGLRenderer) {
  const mobile = isMobileDevice();
  const group = new THREE.Group();
  const bezelThickness = Math.max(34, Math.min(worldW, worldH) * 0.065);
  const bezelHeight = mobile ? 24 : 32;
  const bezelY = 16;
  const bezelMat = new THREE.MeshStandardMaterial({
    color: '#ff2222',
    roughness: 0.25,
    metalness: 0.15,
    emissive: '#ff0000',
    emissiveIntensity: 0.08,
  });

  const isSquareArena = worldW >= 950 && Math.abs(worldW - worldH) < 150;
  const goalGapW = worldW * 0.68;
  const goalGapH = worldH * 0.58;

  const createBoxSide = (w: number, d: number, x: number, z: number) => {
    const geo = new THREE.BoxGeometry(w, bezelHeight, d);
    const mesh = new THREE.Mesh(geo, bezelMat);
    mesh.position.set(x, bezelY, z);
    return mesh;
  };

  const topSideWidth = (worldW - goalGapW) / 2 + bezelThickness;
  const topLeftX = -bezelThickness + topSideWidth / 2;
  const topRightX = worldW + bezelThickness - topSideWidth / 2;

  group.add(createBoxSide(topSideWidth, bezelThickness, topLeftX, -bezelThickness / 2));
  group.add(createBoxSide(topSideWidth, bezelThickness, topRightX, -bezelThickness / 2));
  group.add(createBoxSide(topSideWidth, bezelThickness, topLeftX, worldH + bezelThickness / 2));
  group.add(createBoxSide(topSideWidth, bezelThickness, topRightX, worldH + bezelThickness / 2));

  if (isSquareArena) {
    const sideWidth = (worldH - goalGapH) / 2 + bezelThickness;
    const leftTopZ = -bezelThickness + sideWidth / 2;
    const leftBottomZ = worldH + bezelThickness - sideWidth / 2;
    group.add(createBoxSide(bezelThickness, sideWidth, -bezelThickness / 2, leftTopZ));
    group.add(createBoxSide(bezelThickness, sideWidth, -bezelThickness / 2, leftBottomZ));
    group.add(createBoxSide(bezelThickness, sideWidth, worldW + bezelThickness / 2, leftTopZ));
    group.add(createBoxSide(bezelThickness, sideWidth, worldW + bezelThickness / 2, leftBottomZ));
  } else {
    group.add(createBoxSide(bezelThickness, worldH, -bezelThickness / 2, worldH / 2));
    group.add(createBoxSide(bezelThickness, worldH, worldW + bezelThickness / 2, worldH / 2));
  }

  const neonRadius = Math.min(38, Math.min(worldW, worldH) * 0.06);
  const segCorner = mobile ? 6 : 12;
  const neonPts = buildRoundedRectPoints(worldW, worldH, neonRadius, segCorner);
  const neonCurve = new THREE.CatmullRomCurve3(neonPts, true, 'catmullrom', 0.15);
  const tubeSegs = mobile ? 48 : 96;
  const neonGeo = new THREE.TubeGeometry(neonCurve, tubeSegs, mobile ? 4.5 : 6.5, mobile ? 6 : 10, true);
  const neonTex = createNeonGradientTexture(renderer);
  const neonMat = new THREE.MeshStandardMaterial({
    map: neonTex || undefined,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: neonTex || undefined,
    emissiveIntensity: 1.8,
    roughness: 0.2,
    metalness: 0.1
  });
  const neonTube = new THREE.Mesh(neonGeo, neonMat);
  neonTube.position.y = 26;
  group.add(neonTube);

  return group;
}

function createArenaFrame(worldW: number, worldH: number, style: 'classic' | 'modern' = 'modern', renderer?: THREE.WebGLRenderer) {
  if (style === 'classic') return createArenaFrameClassic(worldW, worldH, renderer);
  return createArenaFrameModern(worldW, worldH, renderer);
}

function getArenaWorldSafe(count: number, size: any = 'medium') {
  try {
    if (typeof getArenaWorldImported === 'function') {
      return getArenaWorldImported(count, size);
    }
  } catch {}
  const ARENA_SCALES_LOCAL: any = { small: 0.85, medium: 1.05, large: 1.7, xlarge: 2.2 };
  const RECT = { w: 700, h: 1050 };
  const SQUARE = { w: 1000, h: 1000 };
  const base = count >= 3 ? SQUARE : RECT;
  const sc = ARENA_SCALES_LOCAL[size] || 1;
  return { w: Math.round(base.w * sc), h: Math.round(base.h * sc), scale: sc, scaleFactor: 1 };
}

function getAdaptiveCameraPresets(world: { w: number; h: number }, arenaSize: string, isMobile: boolean) {
  const isMobileNow = typeof window !== 'undefined' ? window.innerWidth < 768 : isMobile;
  const maxDim = Math.max(world.w, world.h);
  const PRESET_BY_SIZE: any = {
    small: { distance: Math.max(920, maxDim * 1.15), height: 680, fov: 52 },
    medium: { distance: Math.max(1100, maxDim * 1.12), height: 750, fov: 50 },
    large: { distance: Math.max(1550, maxDim * 1.16), height: 980, fov: 48 },
    xlarge: { distance: Math.max(1950, maxDim * 1.2), height: 1180, fov: 46 },
  };
  const base = PRESET_BY_SIZE[arenaSize] || PRESET_BY_SIZE.medium;
  const mobileBoost = isMobileNow ? 1.25 : 1.0;
  const heightBoost = isMobileNow ? 1.2 : 1.0;
  const distance = base.distance * mobileBoost;
  const height = base.height * heightBoost;
  const basePresets = {
    top: { angle: Math.PI, distance: 420, height: 1350, name: 'من الأعلى', nameEn: 'Top View' },
    bottom: { angle: 0, distance: distance, height: height, name: 'خلفك', nameEn: 'Behind You' },
    topPlayer: { angle: Math.PI, distance: distance * 0.6, height: height * 0.8, name: 'خلف الخصم', nameEn: 'Behind Enemy' },
    iso: { angle: 0.52, distance: distance * 0.75, height: height * 0.85, name: 'مائل', nameEn: 'Isometric' },
    sideLeft: { angle: -Math.PI / 2, distance: distance * 0.72, height: height * 0.7, name: 'يسار', nameEn: 'Left' },
    sideRight: { angle: Math.PI / 2, distance: distance * 0.72, height: height * 0.7, name: 'يمين', nameEn: 'Right' },
  };
  const adapted: any = {};
  for (const k in basePresets) {
    const b: any = (basePresets as any)[k];
    adapted[k] = { ...b, baseDistance: b.distance, baseHeight: b.height, isMobile: isMobileNow, targetX: world.w / 2, targetZ: world.h / 2, lookX: world.w / 2, lookZ: world.h / 2 };
  }
  return adapted;
}

type Cam3DPresetKey = 'top' | 'bottom' | 'topPlayer' | 'iso' | 'sideLeft' | 'sideRight';
const RENDER_DELAY_MS = 60;

// ===== دوال حماية المضارب (جديدة) =====
const PADDLE_R = 36;
const MAX_PADDLE_V = 14;

function manualClampPaddle(x: number, z: number, side: Player['side'], w: number, h: number) {
  const r = PADDLE_R;
  const m = 20;
  let minX = r + m, maxX = w - r - m, minZ = r + m, maxZ = h - r - m;
  if (side === 'bottom') minZ = h / 2 + r;
  if (side === 'top') maxZ = h / 2 - r;
  if (side === 'left') maxX = w / 2 - r;
  if (side === 'right') minX = w / 2 + r;
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minZ, Math.min(maxZ, z)),
  };
}

function safeClampPaddle(x: number, z: number, side: Player['side'], w: number, h: number) {
  try {
    const r: any = clampPaddlePosition ? (clampPaddlePosition as any)({ x, y: z }, side, w, h) : null;
    if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) return { x: r.x as number, y: r.y as number };
  } catch {}
  return manualClampPaddle(x, z, side, w, h);
}

function defaultPaddlePos(side: Player['side'], w: number, h: number) {
  if (side === 'top') return { x: w / 2, z: 52 };
  if (side === 'bottom') return { x: w / 2, z: h - 52 };
  if (side === 'left') return { x: 52, z: h / 2 };
  return { x: w - 52, z: h / 2 };
}

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
  const [webglError, setWebglError] = useState<string | null>(null);

  // إعدادات الكاميرا واسترجاعها
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(settings?.sound !== false);

  const { i18n } = useTranslation();
  const mountRef = useRef<HTMLDivElement>(null);
  const hintDotRef = useRef<HTMLDivElement>(null);
  const hintTextRef = useRef<HTMLDivElement>(null);
  const [timeLeft, setTimeLeft] = useState(settings.mode === 'time' ? settings.duration : 0);
  const [rally, setRally] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [countdownSide, setCountdownSide] = useState<string>('');
  const pausedRef = useRef(paused);
  const gameEndedRef = useRef(false);
  const frameIdRef = useRef<number>(0);
  const localReadyRef = useRef(localReady);
  useEffect(() => { localReadyRef.current = localReady; }, [localReady]);
  pausedRef.current = paused;

  const isMobileCheck = useMemo(() => isMobileDevice(), []);

  const localWorld = useMemo(
    () => getArenaWorldSafe(Math.max(players.length, settings.players || 2), settings.arenaSize),
    [players.length, settings.players, settings.arenaSize]
  );
  const isVsComputerForWorld = (settings as any).vsComputer || players.some((p: any) => p.computer);
  const isOfflineForWorld = !socket.connected || players.length <= 1 || isVsComputerForWorld;
  const [remoteWorld, setRemoteWorld] = useState<{ w: number; h: number } | null>(() => {
    if (isOfflineForWorld) return null;
    const st = (socket as any).room?.state;
    if (st?.worldW && st?.worldH) return { w: Number(st.worldW), h: Number(st.worldH) };
    return null;
  });
  useEffect(() => {
    if (isOfflineForWorld) { setRemoteWorld(null); return; }
    const applyWorld = (w?: number, h?: number) => {
      if (!w || !h) return;
      setRemoteWorld((prev) => (prev && prev.w === w && prev.h === h) ? prev : { w, h });
    };
    const onRoomUpdate = (rd: any) => applyWorld(rd?.worldW, rd?.worldH);
    socket.on('room-update', onRoomUpdate);
    const st = (socket as any).room?.state;
    if (st?.worldW && st?.worldH) applyWorld(Number(st.worldW), Number(st.worldH));
    return () => { socket.off('room-update', onRoomUpdate); };
  }, [isOfflineForWorld]);

  const world = remoteWorld ?? localWorld;
  const adaptivePresets = useMemo(() => getAdaptiveCameraPresets(world, settings.arenaSize, isMobileCheck), [world, settings.arenaSize, isMobileCheck]);

  const getMySide = useCallback((): Player['side'] => {
    return (players.find((p) => p.socketId === socket.id)?.side ?? players[0]?.side ?? 'bottom') as Player['side'];
  }, [players]);

  const mySideForCam = getMySide();
  const initialCam = useMemo(() => {
    const sideKey = mySideForCam === 'top' ? 'topPlayer' : mySideForCam === 'left' ? 'sideLeft' : mySideForCam === 'right' ? 'sideRight' : 'bottom';
    const preset = (adaptivePresets as any)[sideKey] || (adaptivePresets as any).bottom;
    return {
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
  }, [world, adaptivePresets, mySideForCam]);

  const cam = useRef({ ...initialCam });

  // فحص واسترجاع إعدادات الكاميرا المخزنة مسبقاً
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`qoud_camera_settings_${settings.arenaSize || 'medium'}`);
      if (saved) {
        setShowRestoreModal(true);
      } else {
        cam.current = { ...initialCam };
      }
    } catch {
      cam.current = { ...initialCam };
    }
  }, [settings.arenaSize, initialCam]);

  const restoreCamera = useCallback(() => {
    try {
      const saved = localStorage.getItem(`qoud_camera_settings_${settings.arenaSize || 'medium'}`);
      if (saved) {
        const s = JSON.parse(saved);
        cam.current = {
          ...cam.current,
          ...s,
          targetAngle: s.targetAngle ?? s.angle ?? cam.current.angle,
          targetDistance: s.targetDistance ?? s.distance ?? cam.current.distance,
          targetHeight: s.targetHeight ?? s.height ?? cam.current.height,
          lookX: world.w / 2,
          lookZ: world.h / 2,
        };
      }
    } catch {}
    setShowRestoreModal(false);
  }, [settings.arenaSize, world.w, world.h]);

  const saveCameraSettings = useCallback(() => {
    try {
      const s = {
        angle: cam.current.angle,
        distance: cam.current.distance,
        height: cam.current.height,
        targetAngle: cam.current.targetAngle,
        targetDistance: cam.current.targetDistance,
        targetHeight: cam.current.targetHeight,
      };
      localStorage.setItem(`qoud_camera_settings_${settings.arenaSize || 'medium'}`, JSON.stringify(s));
      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 2000);
    } catch {}
  }, [settings.arenaSize]);

  const resetCameraToDefault = useCallback(() => {
    cam.current = { ...initialCam };
    try {
      localStorage.removeItem(`qoud_camera_settings_${settings.arenaSize || 'medium'}`);
    } catch {}
  }, [initialCam, settings.arenaSize]);

  const threeRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playHitSound3D = (power: number = 0.5) => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current; if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 680 + power * 380;
      gain.gain.value = 0.2 + power * 0.14;
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.14);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.14);
    } catch {}
  };

  const playGoalSound3D = () => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current; if (!ctx) return;
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = 180 + Math.random() * 320;
            gain.gain.value = 0.3;
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.9);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(); osc.stop(ctx.currentTime + 0.9);
          } catch {}
        }, i * 100);
      }
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.frequency.value = 900;
      osc2.frequency.exponentialRampToValueAtTime(1450, ctx.currentTime + 0.4);
      gain2.gain.value = 0.38;
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.75);
      osc2.connect(gain2); gain2.connect(ctx.destination);
      osc2.start(); osc2.stop(ctx.currentTime + 0.75);
    } catch {}
  };

  // نجوم وجزيئات الهدف الاحتفالية (Goal Celebration Stars)
  const hitEffectsRef = useRef<any[]>([]);
  const createGoalStars3D = (x: number, z: number) => {
    if (!threeRef.current) return;
    const { hitGroup } = threeRef.current;
    for (let i = 0; i < 24; i++) {
      const starGeo = new THREE.SphereGeometry(3 + Math.random() * 2.5, 8, 8);
      const starMat = new THREE.MeshBasicMaterial({
        color: ['#ffcf5a', '#ff6b8b', '#61e7c2', '#00e5ff', '#ffffff'][Math.floor(Math.random() * 5)],
        transparent: true, opacity: 1
      });
      const star = new THREE.Mesh(starGeo, starMat);
      star.position.set(x + (Math.random() - 0.5) * 24, 34 + Math.random() * 22, z + (Math.random() - 0.5) * 24);
      const vel = { x: (Math.random() - 0.5) * 13, y: 5 + Math.random() * 9, z: (Math.random() - 0.5) * 13 };
      hitGroup.add(star);
      hitEffectsRef.current.push({ mesh: star, vel, life: 1, decay: 0.02 + Math.random() * 0.016, type: 'star' });
    }
  };

  const shakeRef = useRef({ intensity: 0 });
  const lastBallEmitRef = useRef(0);
  const ballBufferRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; t: number }>>([]);
  const lastDimsRef = useRef({ w: 0, h: 0 });

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
    serving: { active: (settings as any).start === 'paddle', side: 'bottom' as Player['side'], startTime: 0, requested: false },
    paddleVel: { top: { vx: 0, vy: 0 }, bottom: { vx: 0, vy: 0 }, left: { vx: 0, vy: 0 }, right: { vx: 0, vy: 0 } } as any,
    antiStuckApplied: false,
    lastEdgeBounceTime: 0,
  });

  useEffect(() => {
    const s = stateRef.current;
    s.ball.x = world.w / 2; s.ball.y = world.h / 2; s.ball.vx = 0; s.ball.vy = 0;
    s.ballTarget.x = world.w / 2; s.ballTarget.y = world.h / 2; s.ballTarget.vx = 0; s.ballTarget.vy = 0;
    s.paddles.top = { x: world.w / 2, z: 52 };
    s.paddles.bottom = { x: world.w / 2, z: world.h - 52 };
    s.paddles.left = { x: 52, z: world.h / 2 };
    s.paddles.right = { x: world.w - 52, z: world.h / 2 };
    s.targetPaddles = { top: { ...s.paddles.top }, bottom: { ...s.paddles.bottom }, left: { ...s.paddles.left }, right: { ...s.paddles.right } };
    s.lastPaddles = { top: { ...s.paddles.top }, bottom: { ...s.paddles.bottom }, left: { ...s.paddles.left }, right: { ...s.paddles.right } };
    ballBufferRef.current = [];
  }, [world.w, world.h]);

  const playersKey = useMemo(() => players.map(p => `${p.side}:${p.color}`).join(','), [players]);

  const [showCamMenu, setShowCamMenu] = useState(false);
  const [hideUI, setHideUI] = useState(false);
  const [currentPreset, setCurrentPreset] = useState<Cam3DPresetKey>('bottom');
  const [readyPlayers, setReadyPlayers] = useState<string[]>([]);
  const isAr = i18n.language?.startsWith('ar');

  const getInitialSpeed = useCallback(() => 3.5 + settings.ballSpeed * 0.25, [settings.ballSpeed]);
  const isOfflineMode = !socket.connected || players.length <= 1 || settings.vsComputer || players.some((p: any) => p.computer);
  const isVsComputer = settings.vsComputer || players.some((p: any) => p.computer || p.isBot || p.isComputer || p.type === 'bot' || (p.name && (p.name.includes('كمبيوتر') || p.name.toLowerCase().includes('computer') || p.name.toLowerCase().includes('bot') || p.name.toLowerCase().includes('cpu'))));
  const humanCount = Math.max(1, players.filter((p: any) => !p.computer).length);
  const isFriendsMode = !isVsComputer && !!roomCode && humanCount > 1;

  const createHatPaddle = useCallback((colorIn: string, style: 'classic' | 'modern' = arenaStyle) => {
    const color = String(colorIn || '#ffcf5a');
    const group = new THREE.Group();
    const isBlue = color.toLowerCase().includes('61e7c2') || color.toLowerCase().includes('00e5ff') || color.toLowerCase().includes('blue') || color === '#61e7c2';
    const baseColor = isBlue ? '#0a84ff' : (color === '#ffcf5a' ? '#0a84ff' : color);
    const mobile = isMobileDevice();
    const segs = mobile ? 20 : 36;

    if (style === 'classic') {
      const baseMat = new THREE.MeshStandardMaterial({ color: '#080808', roughness: 0.2, metalness: 0.85 });
      const baseGeo = new THREE.CylinderGeometry(34, 34, 10, segs);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 5;
      group.add(base);
      const topMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.15, metalness: 0.2, emissive: baseColor, emissiveIntensity: 0.3 });
      const top = new THREE.Mesh(new THREE.CylinderGeometry(28, 28, 6, segs), topMat);
      top.position.y = 11;
      group.add(top);
    } else {
      const baseMat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.15,
        metalness: 0.1,
        emissive: new THREE.Color(baseColor),
        emissiveIntensity: 0.15
      });
      const baseGeo = new THREE.CylinderGeometry(32, 34, 14, segs);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 7;
      group.add(base);

      const handleMat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.2,
        metalness: 0.05,
        emissive: new THREE.Color(baseColor),
        emissiveIntensity: 0.2
      });
      const handle = new THREE.Mesh(new THREE.SphereGeometry(15, mobile ? 12 : 20, mobile ? 10 : 16), handleMat);
      handle.position.y = 20;
      handle.scale.y = 0.8;
      group.add(handle);
    }
    group.traverse((o) => { o.frustumCulled = false; });
    return group;
  }, [arenaStyle]);

  const applyPreset = useCallback((key: Cam3DPresetKey) => {
    const p = (adaptivePresets as any)[key];
    if (!p) return;
    cam.current.targetAngle = p.angle;
    cam.current.targetDistance = p.distance;
    cam.current.targetHeight = p.height;
    setCurrentPreset(key);
  }, [adaptivePresets]);

  const zoomCam = useCallback((dir: number) => {
    cam.current.targetDistance = Math.max(600, Math.min(2200, cam.current.targetDistance * (dir > 0 ? 0.88 : 1.15)));
  }, []);

  const rotateCam = useCallback((dir: 'left' | 'right' | 'up' | 'down') => {
    if (dir === 'left') cam.current.targetAngle -= 0.35;
    if (dir === 'right') cam.current.targetAngle += 0.35;
    if (dir === 'up') cam.current.targetHeight = Math.min(1800, cam.current.targetHeight + 100);
    if (dir === 'down') cam.current.targetHeight = Math.max(400, cam.current.targetHeight - 100);
  }, []);

  // تلقي بيانات الحالة من السيرفر
  useEffect(() => {
    const handleGameState = (data: any) => {
      if (!data) return;
      const mySide = getMySide();
      if (data.ball) {
        const now = performance.now();
        stateRef.current.ballTarget.x = data.ball.x;
        stateRef.current.ballTarget.y = data.ball.y;
        stateRef.current.ballTarget.vx = data.ball.vx;
        stateRef.current.ballTarget.vy = data.ball.vy;
        const buf = ballBufferRef.current;
        buf.push({ x: data.ball.x, y: data.ball.y, vx: data.ball.vx, vy: data.ball.vy, t: now });
        while (buf.length > 15) buf.shift();
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
        if (data.countdown > 0) ballBufferRef.current = [];
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

  // جهوزية اللاعبين في نمط الأصدقاء
  useEffect(() => {
    if (!isFriendsMode) return;
    const handlePlayerReady = (data: any) => {
      const playerId = data.playerId || data.id || data.socketId;
      if (playerId && !readyPlayers.includes(playerId)) {
        setReadyPlayers(prev => [...prev, playerId]);
      }
    };
    const handleAllReady = () => {
      setLocalReady(true);
      localReadyRef.current = true;
      stateRef.current.countdown = 3;
      stateRef.current.countdownStart = performance.now();
      setCountdown(3);
    };
    socket.on('player-ready', handlePlayerReady);
    socket.on('all-players-ready', handleAllReady);
    socket.on('game-started', handleAllReady);
    return () => {
      socket.off('player-ready', handlePlayerReady);
      socket.off('all-players-ready', handleAllReady);
      socket.off('game-started', handleAllReady);
    };
  }, [readyPlayers, humanCount, isFriendsMode]);

  useEffect(() => {
    if (isFriendsMode && readyPlayers.length >= humanCount && humanCount > 1) {
      if (isHost) {
        socket.emit('all-players-ready', { roomCode });
        socket.emit('game-started', { roomCode });
      }
      if (!localReadyRef.current) {
        setLocalReady(true);
        localReadyRef.current = true;
      }
    }
  }, [readyPlayers, isHost, isFriendsMode, humanCount, roomCode]);

  // تحكم لمس المضارب بدون lag مع إزاحة لمسية ذكية كي لا تغطي اليد المضرب
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let dragging = false;

    const getIntersect = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      if (!threeRef.current?.camera) return null;
      raycaster.setFromCamera(mouse, threeRef.current.camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -10);
      const point = new THREE.Vector3();
      const hit = raycaster.ray.intersectPlane(plane, point);
      return hit ? point : null;   // كان يرجع (0,0,0) عند الفشل
    };

    const handlePointerAction = (cx: number, cy: number) => {
      const pt = getIntersect(cx, cy);
      if (!pt) return;
      const mySide = getMySide();
      const clamped = safeClampPaddle(pt.x, pt.z, mySide, world.w, world.h);

      // تحديث فوري ومباشر للمضرب للاعب
      stateRef.current.paddles[mySide].x = clamped.x;
      stateRef.current.paddles[mySide].z = clamped.y;
      stateRef.current.targetPaddles[mySide].x = clamped.x;
      stateRef.current.targetPaddles[mySide].z = clamped.y;

      if (threeRef.current?.paddles?.[mySide]) {
        threeRef.current.paddles[mySide].position.set(clamped.x, 14, clamped.y);
      }

      if (stateRef.current.serving.active) {
        stateRef.current.serving.requested = true;
      }

      // إرسال السرعة والإحداثيات فوراً للسيرفر
      socket.sendPaddleTarget(clamped.x, clamped.y);
      if (isHost && !isOfflineMode && performance.now() - lastBallEmitRef.current > 30) {
        socket.emit('paddle-move', { side: mySide, x: clamped.x, y: clamped.y });
        lastBallEmitRef.current = performance.now();
      }
    };

    const onPointerDown = (e: PointerEvent | TouchEvent) => {
      dragging = true;
      const cx = (e as TouchEvent).touches ? (e as TouchEvent).touches[0].clientX : (e as PointerEvent).clientX;
      const cy = (e as TouchEvent).touches ? (e as TouchEvent).touches[0].clientY : (e as PointerEvent).clientY;
      handlePointerAction(cx, cy);
    };

    const onPointerMove = (e: PointerEvent | TouchEvent) => {
      if (!dragging) return;
      const cx = (e as TouchEvent).touches ? (e as TouchEvent).touches[0].clientX : (e as PointerEvent).clientX;
      const cy = (e as TouchEvent).touches ? (e as TouchEvent).touches[0].clientY : (e as PointerEvent).clientY;
      handlePointerAction(cx, cy);
    };

    const onPointerUp = () => { dragging = false; };

    el.addEventListener('pointerdown', onPointerDown as any);
    el.addEventListener('pointermove', onPointerMove as any);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('touchstart', onPointerDown as any, { passive: false });
    el.addEventListener('touchmove', onPointerMove as any, { passive: false });
    el.addEventListener('touchend', onPointerUp);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown as any);
      el.removeEventListener('pointermove', onPointerMove as any);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('touchstart', onPointerDown as any);
      el.removeEventListener('touchmove', onPointerMove as any);
      el.removeEventListener('touchend', onPointerUp);
    };
  }, [world.w, world.h, getMySide, isHost, isOfflineMode]);

  // إعداد وضبط WebGL الفوري لمنع مشكلة الشاشة البيضاء في الجوال
  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;

    // تنظيف سياق سابق
    if (threeRef.current?.renderer) {
      try {
        threeRef.current.renderer.dispose();
        threeRef.current.renderer.forceContextLoss();
        if (mount.contains(threeRef.current.renderer.domElement)) {
          mount.removeChild(threeRef.current.renderer.domElement);
        }
      } catch {}
    }

    const mobile = isMobileDevice();
    const rect = mount.getBoundingClientRect();
    const initW = Math.max(300, Math.floor(rect.width || mount.clientWidth || window.innerWidth));
    const initH = Math.max(300, Math.floor(rect.height || mount.clientHeight || (window.innerHeight - 140)));

    const scene = new THREE.Scene();
    setup3DArenaLighting(scene, world.w, world.h);

    const fov = initW < 768 ? 58 : 48;
    const camera = new THREE.PerspectiveCamera(fov, initW / initH, 10, 5000);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !mobile,
        powerPreference: mobile ? 'low-power' : 'high-performance',
        alpha: false,
        stencil: false,
        depth: true,
        logarithmicDepthBuffer: false,
        failIfMajorPerformanceCaveat: false,
      });
    } catch (e: any) {
      setWebglError('فشل إنشاء WebGL: ' + (e?.message || ''));
      return;
    }

    renderer.setPixelRatio(mobile ? 1.0 : Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(initW, initH, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = mobile ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    // تثبيت الكانفاس بوضعية مطلقة تغطي المساحة بدقة
    const canvasEl = renderer.domElement;
    canvasEl.style.position = 'absolute';
    canvasEl.style.inset = '0';
    canvasEl.style.width = '100%';
    canvasEl.style.height = '100%';
    canvasEl.style.display = 'block';
    canvasEl.style.touchAction = 'none';
    mount.appendChild(canvasEl);

    // سطح الطاولة
    const tableGroup = new THREE.Group();
    const surfaceTexture = createAirHockeySurface(world.w, world.h, renderer);
    const tableMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: surfaceTexture || undefined,
      metalness: 0.02,
      roughness: 0.08
    });
    const table = new THREE.Mesh(new THREE.BoxGeometry(world.w, 12, world.h), tableMaterial);
    table.position.set(world.w / 2, 6, world.h / 2);
    tableGroup.add(table);
    scene.add(tableGroup);

    // إطار الساحة
    const frame = createArenaFrame(world.w, world.h, arenaStyle, renderer);
    scene.add(frame);

    // القرص (الكرة)
    const puckGroup = new THREE.Group();
    const isWhiteArena = arenaStyle === 'classic';
    const puckMat = new THREE.MeshStandardMaterial({
      color: isWhiteArena ? '#111111' : '#ffffff',
      roughness: isWhiteArena ? 0.35 : 0.12,
      metalness: 0.15,
      emissive: isWhiteArena ? '#000000' : '#00e5ff',
      emissiveIntensity: isWhiteArena ? 0 : 1.3,
    });
    const cylSegs = mobile ? 20 : 36;
    const puckBase = new THREE.Mesh(new THREE.CylinderGeometry(17, 17, 13, cylSegs), puckMat);
    puckBase.position.y = 6;
    puckGroup.add(puckBase);

    if (!isWhiteArena) {
      const ringMat = new THREE.MeshBasicMaterial({ color: '#00e5ff' });
      const ring = new THREE.Mesh(new THREE.RingGeometry(6, 14, 16), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 12.6;
      puckGroup.add(ring);
    }

    puckGroup.position.set(world.w / 2, 14, world.h / 2);
    scene.add(puckGroup);

    // المضارب
    const paddles: Record<string, THREE.Group> = {};
    const COLORS_FALLBACK = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];
    const ensureCount = Math.max(2, players.length, settings.players || 2);
    const sidesNeeded = ensureCount === 2 ? (['bottom', 'top'] as Player['side'][]) : (['bottom', 'top', 'right', 'left'] as Player['side'][]);
    sidesNeeded.forEach((side, idx) => {
      const existing = players.find(p => p.side === side);
      const color = existing?.color || COLORS_FALLBACK[idx] || '#ffcf5a';
      const g = createHatPaddle(color);
      const dp = defaultPaddlePos(side, world.w, world.h);
      g.position.set(dp.x, 14, dp.z);
      scene.add(g);
      paddles[side] = g;
    });

    const hitGroup = new THREE.Group();
    scene.add(hitGroup);

    threeRef.current = { scene, camera, renderer, ball: puckGroup, paddles, hitGroup, surfaceTexture, tableMaterial };
    lastDimsRef.current = { w: initW, h: initH };

    // تحديث فوري للحجم
    const updateSize = () => {
      if (!mountRef.current || !threeRef.current) return;
      const curRect = mountRef.current.getBoundingClientRect();
      const nw = Math.floor(curRect.width || mountRef.current.clientWidth || window.innerWidth);
      const nh = Math.floor(curRect.height || mountRef.current.clientHeight || (window.innerHeight - 140));
      if (nw <= 0 || nh <= 0) return;
      if (lastDimsRef.current.w === nw && lastDimsRef.current.h === nh) return;
      lastDimsRef.current = { w: nw, h: nh };
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh, false);
    };

    const ro = new ResizeObserver(() => updateSize());
    ro.observe(mount);

    requestAnimationFrame(updateSize);
    const t1 = setTimeout(updateSize, 60);
    const t2 = setTimeout(updateSize, 250);

    window.addEventListener('resize', updateSize);
    window.addEventListener('orientationchange', updateSize);

    return () => {
      ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('orientationchange', updateSize);
      try {
        renderer.dispose();
        renderer.forceContextLoss();
        surfaceTexture?.dispose();
        tableMaterial.dispose();
      } catch {}
      if (mount.contains(canvasEl)) mount.removeChild(canvasEl);
      threeRef.current = null;
    };
  }, [world.w, world.h, playersKey, arenaStyle, createHatPaddle]);

  // حلقة الرسوميات وحسابات الفيزياء
  useEffect(() => {
    const state = stateRef.current;
    const needPlayers = Math.max(2, players.length, settings.players || 2);
    const sidesForCount: Player['side'][] = needPlayers === 2 ? ['bottom', 'top'] : ['bottom', 'top', 'right', 'left'];
    const activeSide = (side: Player['side']) => sidesForCount.includes(side);

    const PADDLE_RADIUS_LOCAL = 36;
    const BALL_RADIUS_LOCAL = 15;
    const HIT_DIST = PADDLE_RADIUS_LOCAL + BALL_RADIUS_LOCAL;
    const MIN_SPEED = 5.0;
    const MAX_SPEED = 18;
    const WALL_BOUNCE_DAMP = 0.95;

    const tick = (now: number) => {
      const rawDelta = (now - state.last) / 16.67;
      const delta = Math.min(rawDelta, 2.5);
      state.last = now;

      if (threeRef.current && mountRef.current) {
        // تحديث أبعاد الكانفاس في كل إطار لمنع الشاشة البيضاء في الجوال
        const curW = mountRef.current.clientWidth;
        const curH = mountRef.current.clientHeight;
        if (curW > 0 && curH > 0 && (lastDimsRef.current.w !== curW || lastDimsRef.current.h !== curH)) {
          lastDimsRef.current = { w: curW, h: curH };
          threeRef.current.camera.aspect = curW / curH;
          threeRef.current.camera.updateProjectionMatrix();
          threeRef.current.renderer.setSize(curW, curH, false);
        }

        const { paddles, camera, hitGroup } = threeRef.current;
        const c = cam.current as any;
        c.angle += (c.targetAngle - c.angle) * 0.12;
        c.distance += (c.targetDistance - c.distance) * 0.12;
        c.height += (c.targetHeight - c.height) * 0.12;

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

        // تحريك المضارب
        const mySide = getMySide();
        Object.keys(paddles).forEach((side) => {
          const s = side as Player['side'];
          if (!activeSide(s)) return;
          const target = state.targetPaddles[s];
          const current = state.paddles[s];
          const mesh = paddles[s];

          // حماية من NaN: إعادة المضرب لموضعه الافتراضي
          if (!Number.isFinite(current.x) || !Number.isFinite(current.z)) {
            const d = defaultPaddlePos(s, world.w, world.h);
            current.x = d.x; current.z = d.z;
            target.x = d.x; target.z = d.z;
          }

          if (s === mySide) {
            // اللاعب المحلي: استجابة فورية بدون أي تأخير
            if (mesh) mesh.position.set(current.x, 14, current.z);
          } else {
            // الخصوم: تنعيم سلس جداً
            current.x += (target.x - current.x) * 0.4;
            current.z += (target.z - current.z) * 0.4;
            if (mesh) mesh.position.set(current.x, 14, current.z);
          }
        });

        // تأثيرات الجزيئات والنجوم
        for (let i = hitEffectsRef.current.length - 1; i >= 0; i--) {
          const eff = hitEffectsRef.current[i];
          eff.mesh.position.x += eff.vel.x * delta * 0.6;
          eff.mesh.position.y += eff.vel.y * delta * 0.6;
          eff.mesh.position.z += eff.vel.z * delta * 0.6;
          eff.vel.y -= 0.3 * delta;
          eff.life -= eff.decay * delta;
          if (eff.mesh.material) eff.mesh.material.opacity = eff.life;
          if (eff.life <= 0) {
            hitGroup.remove(eff.mesh);
            hitEffectsRef.current.splice(i, 1);
          }
        }

        // حركة وحسابات الكرة أثناء اللعب
        if (localReadyRef.current && !pausedRef.current && !gameEndedRef.current) {
          if (state.countdown > 0) {
            const elapsed = (now - state.countdownStart) / 1000;
            if (elapsed >= 1) {
              state.countdown -= 1;
              state.countdownStart = now;
              setCountdown(state.countdown);
              if (state.countdown === 0) {
                const angle = (Math.random() - 0.5) * 0.8;
                const initSpeed = getInitialSpeed();
                if (state.countdownSide === 'top') {
                  state.ball.vx = Math.sin(angle) * initSpeed;
                  state.ball.vy = Math.abs(Math.cos(angle) * initSpeed) + 2;
                } else if (state.countdownSide === 'bottom') {
                  state.ball.vx = Math.sin(angle) * initSpeed;
                  state.ball.vy = -Math.abs(Math.cos(angle) * initSpeed) - 2;
                } else if (state.countdownSide === 'left') {
                  state.ball.vx = Math.abs(initSpeed) + 2;
                  state.ball.vy = Math.sin(angle) * initSpeed;
                } else if (state.countdownSide === 'right') {
                  state.ball.vx = -Math.abs(initSpeed) - 2;
                  state.ball.vy = Math.sin(angle) * initSpeed;
                } else {
                  const randAngle = Math.random() * Math.PI * 2;
                  state.ball.vx = Math.cos(randAngle) * initSpeed;
                  state.ball.vy = Math.sin(randAngle) * initSpeed;
                }
                state.ballTarget.vx = state.ball.vx;
                state.ballTarget.vy = state.ball.vy;
                if (isHost && !isOfflineMode) {
                  socket.emit('game-state', { ball: { x: state.ball.x, y: state.ball.y, vx: state.ball.vx, vy: state.ball.vy }, countdown: 0 });
                }
              }
            }
            state.ball.x = world.w / 2;
            state.ball.y = world.h / 2;
            state.ballTarget.x = state.ball.x;
            state.ballTarget.y = state.ball.y;
          }

          // حساب سرعات المضارب لتوليد القوة (مع قصّ السرعة)
          (['top', 'bottom', 'right', 'left'] as Player['side'][]).forEach(side => {
            if (!activeSide(side)) return;
            const prev = state.lastPaddles[side];
            const curr = state.paddles[side];
            const d = delta || 1;
            const cl = (v: number) => Math.max(-MAX_PADDLE_V, Math.min(MAX_PADDLE_V, v));
            state.paddleVel[side].vx = cl((curr.x - prev.x) / d);
            state.paddleVel[side].vy = cl((curr.z - prev.z) / d);
            prev.x = curr.x;
            prev.z = curr.z;
          });

          // رمية البداية (الإرسال)
          if (state.serving.active) {
            const servingSide = state.serving.side;
            const servingPaddle = state.paddles[servingSide];
            if (servingPaddle) {
              if (servingSide === 'bottom') { state.ball.x = servingPaddle.x; state.ball.y = servingPaddle.z - 55; }
              else if (servingSide === 'top') { state.ball.x = servingPaddle.x; state.ball.y = servingPaddle.z + 55; }
              else if (servingSide === 'left') { state.ball.x = servingPaddle.x + 55; state.ball.y = servingPaddle.z; }
              else { state.ball.x = servingPaddle.x - 55; state.ball.y = servingPaddle.z; }
              state.ballTarget.x = state.ball.x; state.ballTarget.y = state.ball.y;
            }
            if (state.serving.requested) {
              state.serving.active = false;
              const spd = getInitialSpeed() + 2;
              if (servingSide === 'bottom') { state.ball.vx = (Math.random() - 0.5) * spd; state.ball.vy = -Math.abs(spd) - 1; }
              else if (servingSide === 'top') { state.ball.vx = (Math.random() - 0.5) * spd; state.ball.vy = Math.abs(spd) + 1; }
              else if (servingSide === 'left') { state.ball.vx = Math.abs(spd) + 1; state.ball.vy = (Math.random() - 0.5) * spd; }
              else { state.ball.vx = -Math.abs(spd) - 1; state.ball.vy = (Math.random() - 0.5) * spd; }
            }
          }

          // حركة الكرة
          if (state.countdown === 0 && !state.serving.active) {
            if (isOfflineMode || isHost) {
              const goalHalfW = (world.w * 0.68) / 2 - BALL_RADIUS_LOCAL;
              const sideGoalHalfW = (world.h * 0.58) / 2 - BALL_RADIUS_LOCAL;
              const leftBound = BALL_RADIUS_LOCAL;
              const rightBound = world.w - BALL_RADIUS_LOCAL;
              const topBound = BALL_RADIUS_LOCAL;
              const bottomBound = world.h - BALL_RADIUS_LOCAL;

              const clampBallSpeed = () => {
                const sp = Math.hypot(state.ball.vx, state.ball.vy);
                if (!Number.isFinite(sp) || !Number.isFinite(state.ball.x) || !Number.isFinite(state.ball.y)) {
                  state.ball.x = world.w / 2; state.ball.y = world.h / 2;
                  state.ball.vx = MIN_SPEED; state.ball.vy = MIN_SPEED;
                  return;
                }
                if (sp < MIN_SPEED) {
                  const a = sp === 0 ? Math.random() * Math.PI * 2 : Math.atan2(state.ball.vy, state.ball.vx);
                  state.ball.vx = Math.cos(a) * MIN_SPEED; state.ball.vy = Math.sin(a) * MIN_SPEED;
                } else if (sp > MAX_SPEED) {
                  const k = MAX_SPEED / sp;
                  state.ball.vx *= k; state.ball.vy *= k;
                }
              };

              const scoreGoal = (scorerSide: Player['side'], restartSide: Player['side'], fx: number, fz: number) => {
                const scorer = players.find(p => p.side === scorerSide) || players[0];
                if (scorer) { onGoal(scorer); playGoalSound3D(); createGoalStars3D(fx, fz); }
                state.ball.x = world.w / 2; state.ball.y = world.h / 2; state.ball.vx = 0; state.ball.vy = 0;
                state.ballTarget.x = state.ball.x; state.ballTarget.y = state.ball.y;
                state.countdown = 3; state.countdownStart = now; state.countdownSide = restartSide;
                setCountdown(3); setCountdownSide(restartSide);
                return true;
              };

              clampBallSpeed();
              // تقسيم الحركة إلى خطوات صغيرة حتى لا تعبر الكرة الجدران أو المرمى بقفزة واحدة
              const steps = Math.min(16, Math.max(1, Math.ceil((Math.hypot(state.ball.vx, state.ball.vy) * delta) / 8)));
              const sd = delta / steps;
              let scored = false;

              for (let i = 0; i < steps && !scored; i++) {
                state.ball.x += state.ball.vx * sd;
                state.ball.y += state.ball.vy * sd;

                // ارتداد الجدران
                if (state.ball.x < leftBound && (needPlayers < 4 || Math.abs(state.ball.y - world.h / 2) > sideGoalHalfW)) {
                  state.ball.x = leftBound; state.ball.vx = Math.abs(state.ball.vx) * WALL_BOUNCE_DAMP;
                }
                if (state.ball.x > rightBound && (needPlayers < 4 || Math.abs(state.ball.y - world.h / 2) > sideGoalHalfW)) {
                  state.ball.x = rightBound; state.ball.vx = -Math.abs(state.ball.vx) * WALL_BOUNCE_DAMP;
                }
                if (state.ball.y < topBound && Math.abs(state.ball.x - world.w / 2) > goalHalfW) {
                  state.ball.y = topBound; state.ball.vy = Math.abs(state.ball.vy) * WALL_BOUNCE_DAMP;
                }
                if (state.ball.y > bottomBound && Math.abs(state.ball.x - world.w / 2) > goalHalfW) {
                  state.ball.y = bottomBound; state.ball.vy = -Math.abs(state.ball.vy) * WALL_BOUNCE_DAMP;
                }

                // تصادم المضارب
                (['top', 'bottom', 'left', 'right'] as Player['side'][]).forEach(side => {
                  if (!activeSide(side)) return;
                  const pad = state.paddles[side];
                  const dx = state.ball.x - pad.x;
                  const dy = state.ball.y - pad.z;
                  const dist = Math.hypot(dx, dy) || 0.0001;
                  if (dist >= HIT_DIST) return;

                  const nx = dx / dist, ny = dy / dist;
                  state.ball.x += nx * (HIT_DIST - dist);
                  state.ball.y += ny * (HIT_DIST - dist);

                  const pv = state.paddleVel[side];
                  const dot = (state.ball.vx - pv.vx) * nx + (state.ball.vy - pv.vy) * ny;
                  if (dot < 0) {           // الكرة تقترب فعلاً من المضرب
                    state.ball.vx -= 2 * dot * nx;
                    state.ball.vy -= 2 * dot * ny;
                    state.ball.vx += pv.vx * 0.4 + nx * 2.0;
                    state.ball.vy += pv.vy * 0.4 + ny * 2.0;
                    clampBallSpeed();
                    state.rally++;
                    setRally(state.rally);
                    playHitSound3D(Math.min(1, Math.hypot(state.ball.vx, state.ball.vy) / MAX_SPEED));
                    shakeRef.current.intensity = Math.min(8, Math.hypot(state.ball.vx, state.ball.vy) * 0.4);
                  }
                });

                clampBallSpeed();

                // الأهداف: لا تُحتسب إلا إذا عبر مركز الكرة خط المرمى فعلاً داخل الفتحة
                const inTopBottomGap = Math.abs(state.ball.x - world.w / 2) <= goalHalfW;
                const inSideGap = Math.abs(state.ball.y - world.h / 2) <= sideGoalHalfW;
                if (state.ball.y < -BALL_RADIUS_LOCAL && inTopBottomGap) {
                  scored = scoreGoal('bottom', 'top', state.ball.x, 0);
                } else if (state.ball.y > world.h + BALL_RADIUS_LOCAL && inTopBottomGap) {
                  scored = scoreGoal('top', 'bottom', state.ball.x, world.h);
                } else if (needPlayers >= 4 && state.ball.x < -BALL_RADIUS_LOCAL && inSideGap) {
                  scored = scoreGoal('right', 'left', 0, state.ball.y);
                } else if (needPlayers >= 4 && state.ball.x > world.w + BALL_RADIUS_LOCAL && inSideGap) {
                  scored = scoreGoal('left', 'right', world.w, state.ball.y);
                }
              }

              if (isHost && !isOfflineMode && performance.now() - lastBallEmitRef.current > 45) {
                const ms = getMySide();
                socket.emit('game-state', {
                  ball: { x: state.ball.x, y: state.ball.y, vx: state.ball.vx, vy: state.ball.vy },
                  paddles: { [ms]: { x: state.paddles[ms].x, y: state.paddles[ms].z } }
                });
                lastBallEmitRef.current = performance.now();
              }
            } else {
              // غير المضيف: استيفاء من بيانات السيرفر
              const buf = ballBufferRef.current;
              const renderTime = now - RENDER_DELAY_MS;
              if (buf.length >= 2) {
                let i = buf.length - 1;
                while (i > 0 && buf[i - 1].t > renderTime) i--;
                const b = buf[i];
                const a = buf[Math.max(0, i - 1)];
                if (a.t !== b.t && renderTime >= a.t) {
                  const span = b.t - a.t;
                  const tRatio = span > 0 ? Math.max(0, Math.min(1, (renderTime - a.t) / span)) : 1;
                  state.ball.x = a.x + (b.x - a.x) * tRatio;
                  state.ball.y = a.y + (b.y - a.y) * tRatio;
                  state.ball.vx = b.vx; state.ball.vy = b.vy;
                } else {
                  state.ball.x += state.ball.vx * delta; state.ball.y += state.ball.vy * delta;
                }
              } else {
                state.ball.x += state.ball.vx * delta; state.ball.y += state.ball.vy * delta;
              }
            }

            // ذكاء اصطناعي سلس للكمبيوتر عند اللعب أوفلاين
            if (isOfflineMode || isVsComputer) {
              (['top', 'bottom', 'left', 'right'] as Player['side'][]).forEach(side => {
                if (!activeSide(side)) return;
                const p = players.find(pl => pl.side === side);
                if (!p || p.socketId === socket.id || (!p.computer && !isVsComputer)) return;

                const pad = state.targetPaddles[side];
                const diff = 0.12 + settings.ballSpeed * 0.015;
                if (side === 'top' || side === 'bottom') {
                  pad.x += (state.ball.x - pad.x) * diff;
                } else {
                  pad.z += (state.ball.y - pad.z) * diff;
                }
                const clamped = safeClampPaddle(pad.x, pad.z, side, world.w, world.h);
                pad.x = clamped.x; pad.z = clamped.y;
              });
            }
          }
        }

        // تحديث موضع الكرة 3D
        if (threeRef.current?.ball) {
          threeRef.current.ball.position.set(state.ball.x, 14, state.ball.y);
        }

        try {
          threeRef.current.renderer.render(threeRef.current.scene, threeRef.current.camera);
        } catch {}
      }

      // الجدولة خارج الـ if حتى لا تتوقف حلقة الرسم أبداً
      frameIdRef.current = requestAnimationFrame(tick);
    };

    frameIdRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameIdRef.current);
  }, [players, settings, world.w, world.h, isHost, isOfflineMode, isVsComputer, getInitialSpeed, onGoal, getMySide, soundEnabled]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const getNameForSide = (side: Player['side']) => {
    return players.find(p => p.side === side)?.name || side;
  };

  const handleExit = () => {
    if (confirm(isAr ? 'هل تريد الخروج من اللعبة؟' : 'Exit game?')) onExit();
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const myScore = useMemo(() => {
    const me = players.find(p => p.socketId === socket.id) || players[0];
    return me ? (scores[me.id] ?? 0) : 0;
  }, [scores, players]);

  const opponentScore = useMemo(() => {
    const me = players.find(p => p.socketId === socket.id) || players[0];
    const others = players.filter(p => p.id !== me?.id);
    return others.reduce((s, p) => s + (scores[p.id] ?? 0), 0);
  }, [scores, players]);

  useEffect(() => {
    if (settings.mode === 'time') {
      const iv = setInterval(() => {
        if (paused || !localReady) return;
        setTimeLeft((t: number) => {
          if (t <= 1) { onTimeUp(); return 0; }
          return t - 1;
        });
      }, 1000);
      return () => clearInterval(iv);
    }
  }, [settings.mode, paused, localReady, onTimeUp]);

  if (webglError) {
    return (
      <main style={{ width: '100%', height: '100dvh', display: 'grid', placeItems: 'center', background: '#0a0a0a', color: '#fff' }}>
        <div style={{ textAlign: 'center', padding: 20 }}>
          <h2>⚠️ تنبيه الرسوميات</h2>
          <p>{webglError}</p>
          <button onClick={() => { setWebglError(null); window.location.reload(); }} style={{ marginTop: 12, padding: '10px 20px', borderRadius: 8, background: '#00e5ff', color: '#000', fontWeight: 900, border: 'none', cursor: 'pointer' }}>إعادة المحاولة</button>
        </div>
      </main>
    );
  }

  return (
    <main style={{
      width: '100%',
      height: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      background: '#0a0a0a',
      color: '#ffffff',
      overflow: 'hidden',
      position: 'relative'
    }}>
      {/* نافذة استعادة إعدادات الكاميرا المخزنة */}
      {showRestoreModal && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
        }}>
          <div style={{
            background: '#1a1e26', border: '1.5px solid rgba(255,207,90,0.3)',
            borderRadius: '16px', padding: '20px', maxWidth: '340px', width: '100%',
            boxShadow: '0 12px 40px rgba(0,0,0,0.8)', textAlign: 'center'
          }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 900, color: '#ffcf5a' }}>
              🎥 {isAr ? 'زاوية كاميرا محفوظة' : 'Saved Camera Settings'}
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
              {isAr ? 'هل تريد استعادة زاوية الكاميرا التي قمت بضبطها وحفظها سابقاً؟' : 'Restore your previously saved camera angle?'}
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={restoreCamera} style={{
                flex: 1, padding: '10px', borderRadius: '10px',
                background: '#00e5ff', color: '#000', fontWeight: 900, fontSize: '13px', border: 'none', cursor: 'pointer'
              }}>
                {isAr ? 'نعم، استعادة' : 'Restore'}
              </button>
              <button onClick={() => setShowRestoreModal(false)} style={{
                flex: 1, padding: '10px', borderRadius: '10px',
                background: 'rgba(255,255,255,0.1)', color: '#fff', fontWeight: 700, fontSize: '13px',
                border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer'
              }}>
                {isAr ? 'الافتراضية' : 'Default'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* تنبيه نجاح حفظ الكاميرا */}
      {showSaveSuccess && (
        <div style={{
          position: 'absolute', top: '70px', left: '50%', transform: 'translateX(-50%)',
          background: '#00e5ff', color: '#000', padding: '8px 18px', borderRadius: '999px',
          fontWeight: 900, fontSize: '12px', zIndex: 120, boxShadow: '0 4px 16px rgba(0,229,255,0.5)'
        }}>
          ✓ {isAr ? 'تم حفظ زاوية الكاميرا بنجاح!' : 'Camera angle saved!'}
        </div>
      )}

      {/* شريط الرأس والأهداف */}
      {!hideUI && (
        <>
          <header style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px',
            margin: '6px 8px',
            height: '44px',
            background: 'linear-gradient(90deg, #2a2a2a 0%, #1a1a1a 100%)',
            borderRadius: '10px',
            border: '1px solid #333',
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 20,
            position: 'relative',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '24px', height: '18px', background: '#0a0a0a', borderRadius: '4px',
                border: '1.5px solid #00e5ff', display: 'grid', placeItems: 'center'
              }}>
                <div style={{ width: '12px', height: '3px', background: '#00e5ff', borderRadius: '1px' }} />
              </div>
              <span style={{ color: '#fff', fontWeight: 900, fontSize: '13px', letterSpacing: 0.5 }}>3D AIR HOCKEY</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '9px', fontWeight: 700 }}>SCORE</span>
                <span style={{ color: '#fff', fontWeight: 900, fontSize: '16px', fontVariantNumeric: 'tabular-nums' }}>
                  {myScore} — {opponentScore}
                </span>
              </div>
              <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.1)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '9px', fontWeight: 700 }}>TIME</span>
                <span style={{ color: '#fff', fontWeight: 900, fontSize: '16px', fontVariantNumeric: 'tabular-nums' }}>
                  {settings.mode === 'time' ? formatTime(timeLeft) : '∞'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <span style={{ color: '#ff2d2d', fontSize: '10px' }}>•</span>
                <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '10px' }}>Rally {rally}</span>
              </div>
              {settings.seriesType === 'series' && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  background: 'rgba(255,207,90,0.12)', border: '1px solid rgba(255,207,90,0.25)',
                  padding: '2px 8px', borderRadius: '12px'
                }}>
                  <span style={{ color: '#ffcf5a', fontSize: '10px', fontWeight: 900 }}>R{currentRound}/{settings.seriesRounds}</span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <button onClick={() => setSoundEnabled(v => !v)} title="صوت" style={{
                background: 'rgba(255,255,255,0.08)', color: soundEnabled ? '#00e5ff' : 'rgba(255,255,255,0.4)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                padding: '4px 6px', fontSize: '11px', cursor: 'pointer'
              }}>
                {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
              </button>
              <button onClick={toggleFullScreen} title="شاشة كاملة" style={{
                background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                padding: '4px 6px', fontSize: '11px', cursor: 'pointer'
              }}>
                <Maximize2 size={13} />
              </button>
              <button onClick={() => setShowCamMenu(v => !v)} style={{
                background: showCamMenu ? '#00e5ff' : 'rgba(255,255,255,0.08)',
                color: showCamMenu ? '#000' : 'rgba(255,255,255,0.8)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                padding: '4px 8px', fontSize: '11px', fontWeight: 800, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '4px'
              }}>
                <Camera size={12} /> {showCamMenu ? 'إغلاق' : 'كاميرا'}
              </button>
              <button onClick={onPause} style={{
                background: paused ? '#ff2d2d' : 'rgba(255,255,255,0.08)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                padding: '4px 8px', fontSize: '11px', fontWeight: 800, cursor: 'pointer'
              }}>
                {paused ? <Play size={12} /> : <Pause size={12} />}
              </button>
            </div>
          </header>

          <div style={{ display: 'flex', gap: '6px', padding: '0 8px 6px 8px', overflowX: 'auto', flexShrink: 0 }}>
            {(() => {
              const COLORS_FB = ['#ffcf5a', '#ff6b8b', '#61e7c2', '#9b8cff'];
              const SIDES_FB: Player['side'][] = ['bottom', 'top', 'right', 'left'];
              const need = Math.max(2, players.length, settings.players || 2);
              const sides = need === 2 ? SIDES_FB.slice(0, 2) : SIDES_FB.slice(0, 4);
              return sides.map((side, idx) => {
                const p = players.find((pl: any) => pl.side === side) || { id: String(idx), name: side === 'top' ? 'سامي' : side === 'right' ? 'ليان' : side === 'left' ? 'كريم' : 'نورا', color: COLORS_FB[idx], side };
                const isMe = side === mySideForCam;
                return (
                  <div key={p.id + side} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    background: isMe ? '#16222f' : '#141414',
                    border: `1.5px solid ${p.color}`,
                    borderRadius: '10px', padding: '4px 10px', minWidth: '75px', flexShrink: 0
                  }}>
                    <strong style={{ color: p.color, fontSize: '15px', fontWeight: 900 }}>{scores[p.id] ?? 0}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ background: p.color, width: '6px', height: '6px', borderRadius: '50%', display: 'inline-block' }} />
                      <span style={{ color: '#fff', fontSize: '11px', fontWeight: 700 }}>{p.name}{isMe ? ' (انت)' : ''}</span>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </>
      )}

      {/* منطقة الكانفاس الثلاثي الأبعاد */}
      <div
        ref={mountRef}
        style={{
          width: 'calc(100% - 16px)',
          flex: '1 1 0',
          minHeight: '260px',
          borderRadius: '14px',
          overflow: 'hidden',
          position: 'relative',
          touchAction: 'none',
          margin: '0 8px 6px 8px',
          border: '2px solid #1a1a1a',
          background: '#0a0a0a',
          boxSizing: 'border-box'
        }}
      >
        <button onClick={handleExit} style={{
          position: 'absolute', top: 10, left: 10, zIndex: 30,
          background: 'rgba(255,45,45,0.85)', color: 'white', border: 'none',
          padding: '6px 10px', borderRadius: 6, fontSize: '11px', fontWeight: 800,
          display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer'
        }}>
          <ArrowLeft size={12} /> EXIT
        </button>

        {/* زر إخفاء/إظهار الواجهة */}
        <button onClick={() => setHideUI(v => !v)} style={{
          position: 'absolute', top: 10, left: 85, zIndex: 30,
          background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)',
          padding: '6px 10px', borderRadius: 6, fontSize: '11px', fontWeight: 800,
          display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer'
        }}>
          {hideUI ? <Eye size={12} /> : <EyeOff size={12} />} {hideUI ? 'UI' : 'إخفاء'}
        </button>

        {/* تنبيه رمية الإرسال */}
        {localReady && stateRef.current?.serving?.active && (
          <div style={{ position: 'absolute', left: '50%', bottom: '15%', transform: 'translateX(-50%)', zIndex: 25, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <button onClick={() => { stateRef.current.serving.requested = true; }} style={{
              background: '#00e5ff', color: '#000', fontWeight: 900, fontSize: 14,
              padding: '10px 24px', borderRadius: 999, border: 'none', cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(0,229,255,0.4)'
            }}>
              ▶ المس لضرب الكرة
            </button>
          </div>
        )}

        {/* العد التنازلي عند بدء اللعب أو بعد الأهداف */}
        {localReady && countdown > 0 && (
          <div style={{ position: 'absolute', inset: 0, background: countdownSide ? 'rgba(0,0,0,0.75)' : 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 22, gap: '16px', pointerEvents: 'none' }}>
            <span style={{ fontSize: '96px', fontWeight: 900, color: '#ff2828', lineHeight: 1, textShadow: '0 0 30px rgba(255,40,40,0.8)' }}>{countdown}</span>
            {countdownSide && (
              <span style={{
                fontSize: '15px', fontWeight: 900, color: '#fff',
                background: '#ff2828', padding: '8px 20px', borderRadius: 999,
                boxShadow: '0 4px 16px rgba(255,40,40,0.5)'
              }}>
                ⚽ {(() => {
                  const opp: any = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
                  const scorerSide = opp[countdownSide] || countdownSide;
                  const name = getNameForSide(scorerSide as Player['side']);
                  return name ? `${name} سجل هدف!` : 'هدف!';
                })()}
              </span>
            )}
          </div>
        )}

        {/* نافذة الإيقاف المؤقت */}
        {paused && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 35, gap: '12px' }}>
            <span style={{ fontSize: '36px', fontWeight: 900, color: '#fff' }}>⏸️ {isAr ? 'متوقف مؤقتاً' : 'PAUSED'}</span>
            <button onClick={onPause} style={{ padding: '10px 24px', borderRadius: '999px', background: '#00e5ff', color: '#000', fontWeight: 900, border: 'none', cursor: 'pointer' }}>{isAr ? 'متابعة' : 'Resume'}</button>
          </div>
        )}

        {/* شاشة الاحتفال بالفائز بالجولة أو السلسلة */}
        {celebrating && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.82)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            zIndex: 45, gap: '14px', backdropFilter: 'blur(8px)'
          }}>
            <div style={{ fontSize: '52px', fontWeight: 900, color: '#ffcf5a', textShadow: '0 0 25px rgba(255,207,90,0.8)' }}>
              🏆 {celebrating.name} {isAr ? 'فاز بالجولة!' : 'wins the round!'}
            </div>
            <div style={{ fontSize: '18px', color: '#fff', background: '#1c222c', border: '1px solid rgba(255,255,255,0.2)', padding: '6px 20px', borderRadius: '999px' }}>
              {isAr ? 'الجولة' : 'Round'} {currentRound} / {settings.seriesRounds || 3}
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              {players.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#111', border: `1.5px solid ${p.color}`, padding: '6px 14px', borderRadius: '999px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.color }} />
                  <span style={{ color: '#fff', fontSize: '13px' }}>{p.name}</span>
                  <strong style={{ color: '#ffcf5a', fontSize: '15px' }}>{(seriesWins[p.id] ?? 0)}</strong>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* شاشة الاستعداد للبدء */}
        {!localReady && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,10,10,0.88)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 40, gap: 14 }}>
            <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 22, margin: 0 }}>{isAr ? 'مستعد للمباراة؟' : 'Ready to Play?'}</h2>
            <button onClick={() => {
              setLocalReady(true); localReadyRef.current = true;
              stateRef.current.serving.active = (settings as any).start === 'paddle';
              stateRef.current.serving.startTime = performance.now();
              stateRef.current.countdown = 0; setCountdown(0);
              if (isFriendsMode) {
                socket.emit('player-ready', { roomCode, playerId: socket.id });
              } else {
                stateRef.current.countdown = 3; stateRef.current.countdownStart = performance.now(); setCountdown(3);
              }
            }} style={{
              padding: '12px 32px', borderRadius: 999, background: '#00e5ff', color: '#000',
              fontWeight: 900, fontSize: 16, border: 'none', cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(0,229,255,0.4)'
            }}>
              {isAr ? 'ابدأ اللعب الآن' : 'START NOW'}
            </button>
            {isFriendsMode && <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{readyPlayers.length}/{humanCount} جاهز</span>}
          </div>
        )}

        {/* قائمة الكاميرا وزوايا الرؤية الكاملة وحفظ الإعدادات */}
        {showCamMenu && (
          <div style={{
            position: 'absolute', top: 10, right: 10, zIndex: 50,
            background: 'rgba(20,20,24,0.96)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 14,
            padding: '12px', width: 230, boxShadow: '0 12px 36px rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ color: '#fff', fontWeight: 900, fontSize: '11px', letterSpacing: 0.5 }}>CAMERA CONTROLS</span>
              <button onClick={() => setShowCamMenu(false)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}><X size={14} /></button>
            </div>

            {/* أزرار التحريك اليدوي والتقريب */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button onClick={() => rotateCam('left')} style={btnStyle}><RotateCcw size={11} /> LEFT</button>
              <button onClick={() => rotateCam('right')} style={btnStyle}><RotateCw size={11} /> RIGHT</button>
              <button onClick={() => rotateCam('up')} style={btnStyle}><ArrowUp size={11} /> UP</button>
              <button onClick={() => rotateCam('down')} style={btnStyle}><ArrowDown size={11} /> DOWN</button>
              <button onClick={() => zoomCam(1)} style={btnStyle}><ZoomIn size={11} /> ZOOM +</button>
              <button onClick={() => zoomCam(-1)} style={btnStyle}><ZoomOut size={11} /> ZOOM -</button>
            </div>

            {/* الزوايا المسبقة (Presets) */}
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9, fontWeight: 800 }}>PRESETS</span>
              <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
                <button onClick={() => applyPreset('bottom')} style={{ ...presetBtnStyle, background: currentPreset === 'bottom' ? '#00e5ff' : '#1e90ff' }}>
                  <span style={{ fontSize: 10, fontWeight: 900, color: '#000' }}>Bot</span>
                </button>
                <button onClick={() => applyPreset('topPlayer')} style={{ ...presetBtnStyle, background: currentPreset === 'topPlayer' ? '#00e5ff' : '#ff7a7a' }}>
                  <span style={{ fontSize: 10, fontWeight: 900, color: '#000' }}>Enm</span>
                </button>
                <button onClick={() => applyPreset('top')} style={{ ...presetBtnStyle, background: currentPreset === 'top' ? '#00e5ff' : '#ffb86b' }}>
                  <span style={{ fontSize: 10, fontWeight: 900, color: '#000' }}>Top</span>
                </button>
                <button onClick={() => applyPreset('iso')} style={{ ...presetBtnStyle, background: currentPreset === 'iso' ? '#00e5ff' : '#a8e6a0' }}>
                  <span style={{ fontSize: 10, fontWeight: 900, color: '#000' }}>Iso</span>
                </button>
                <button onClick={() => applyPreset('sideLeft')} style={{ ...presetBtnStyle, background: currentPreset === 'sideLeft' ? '#00e5ff' : '#ffd166' }}>
                  <span style={{ fontSize: 9, fontWeight: 900, color: '#000' }}>L</span>
                </button>
                <button onClick={() => applyPreset('sideRight')} style={{ ...presetBtnStyle, background: currentPreset === 'sideRight' ? '#00e5ff' : '#ffd166' }}>
                  <span style={{ fontSize: 9, fontWeight: 900, color: '#000' }}>R</span>
                </button>
              </div>
            </div>

            {/* أزرار الحفظ والإعادة */}
            <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
              <button onClick={saveCameraSettings} style={{
                flex: 1, background: '#00e5ff', color: '#000', border: 'none', borderRadius: 8,
                padding: '6px', fontSize: '10px', fontWeight: 900, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4
              }}>
                <Save size={11} /> {isAr ? 'حفظ الزاوية' : 'SAVE'}
              </button>
              <button onClick={resetCameraToDefault} style={{
                flex: 1, background: 'rgba(255,207,90,0.15)', color: '#ffcf5a', border: '1px solid rgba(255,207,90,0.3)',
                borderRadius: 8, padding: '6px', fontSize: '10px', fontWeight: 900, cursor: 'pointer'
              }}>
                {isAr ? 'افتراضي' : 'DEFAULT'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* الشريط السفلي */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '4px 12px', background: '#0a0a0a', borderTop: '1px solid #1a1a1a',
        fontSize: '10px', color: 'rgba(255,255,255,0.4)', flexShrink: 0
      }}>
        <span>3D PERSPECTIVE • {currentPreset.toUpperCase()}</span>
        <span>{isMobileCheck ? 'المس وحرك مضربك مباشرة' : 'DRAG MOUSE TO MOVE PADDLE'}</span>
      </div>
    </main>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  color: '#fff',
  borderRadius: 6,
  padding: '6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: '10px'
};

const presetBtnStyle: React.CSSProperties = {
  width: 36,
  height: 32,
  flexShrink: 0,
  border: 'none',
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer'
};