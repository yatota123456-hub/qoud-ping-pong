import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Pause, Play, X, RotateCcw, Camera, Eye, EyeOff, ZoomIn, ZoomOut, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, RotateCw, Video, Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ================= الأنواع المشتركة =================
type Player = { id: number | string; name: string; color: string; side: 'top' | 'right' | 'bottom' | 'left'; computer: boolean; socketId?: string };
type Settings = any;
type Scores = Record<string | number, number>;

// ================= إنشاء نسيج واقعي لسطح الطاولة (فتحات الهواء) =================
function createAirHockeySurface(worldW: number, worldH: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // لون السطح الأبيض اللامع
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // رسم فتحات الهواء السوداء الصغيرة
  ctx.fillStyle = '#0a0a0a';
  const spacingX = canvas.width / (worldW / 24);
  const spacingY = canvas.height / (worldH / 24);

  for (let y = spacingY / 2; y < canvas.height; y += spacingY) {
    for (let x = spacingX / 2; x < canvas.width; x += spacingX) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 16;
  return tex;
}

// ================= إعداد إضاءة وحواف الساحة =================
function setup3DArenaLighting(scene: THREE.Scene, worldWidth: number, worldHeight: number) {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  const neonColors = [0x00e5ff, 0xffcf5a, 0xbf5af2, 0xff4081];
  const cornerPositions = [
    { x: 0, z: 0 },
    { x: worldWidth, z: worldHeight },
    { x: 0, z: worldHeight },
    { x: worldWidth, z: 0 },
  ];

  cornerPositions.forEach((pos, idx) => {
    // تقريب الأضواء للسطح لزيادة قوة الانعكاسات
    const pointLight = new THREE.PointLight(neonColors[idx % 4], 2.2, Math.max(worldWidth, worldHeight) * 1.5);
    pointLight.position.set(pos.x, 30, pos.z);
    scene.add(pointLight);

    const bulbMesh = new THREE.Mesh(
      new THREE.SphereGeometry(6, 16, 16),
      new THREE.MeshBasicMaterial({ color: neonColors[idx % 4] })
    );
    bulbMesh.position.set(pos.x, 20, pos.z);
    scene.add(bulbMesh);
  });

  const railThickness = 12;
  const railHeight = 16;
  const tableY = 12;

  const createRailMaterial = (colorHex: number) => new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 2.5,
    roughness: 0.1,
  });

  const rails = [
    { w: worldWidth + 20, h: railHeight, d: railThickness, x: worldWidth / 2, z: -railThickness / 2, mat: createRailMaterial(0x00e5ff) },
    { w: worldWidth + 20, h: railHeight, d: railThickness, x: worldWidth / 2, z: worldHeight + railThickness / 2, mat: createRailMaterial(0xffcf5a) },
    { w: railThickness, h: railHeight, d: worldHeight, x: -railThickness / 2, z: worldHeight / 2, mat: createRailMaterial(0xbf5af2) },
    { w: railThickness, h: railHeight, d: worldHeight, x: worldWidth + railThickness / 2, z: worldHeight / 2, mat: createRailMaterial(0xff4081) },
  ];

  rails.forEach((r) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.d), r.mat);
    mesh.position.set(r.x, tableY + railHeight / 2, r.z);
    scene.add(mesh);
  });
}

function getArenaWorld(count: number, size: any = 'medium') {
  const ARENA_SCALES: any = { small: 0.8, medium: 1.0, large: 1.25, xlarge: 1.5 };
  const RECT = { w: 800, h: 1250 };
  const SQUARE = { w: 1200, h: 1200 };
  const base = count === 4? SQUARE : RECT;
  const sc = ARENA_SCALES[size] || 1;
  return { w: base.w * sc, h: base.h * sc };
}

// ================= بريسيتات الكاميرا الجديدة (اضافة بدون حذف) =================
const CAM_PRESETS_3D = {
  top: { angle: 0, distance: 400, height: 1600, name: 'من الأعلى', nameEn: 'Top View' },
  bottom: { angle: Math.PI, distance: 500, height: 650, name: 'خلفك', nameEn: 'Behind You' },
  topPlayer: { angle: 0, distance: 500, height: 650, name: 'خلف الخصم', nameEn: 'Behind Enemy' },
  iso: { angle: 0.6, distance: 1150, height: 950, name: 'مائل', nameEn: 'Isometric' },
  sideLeft: { angle: -Math.PI/2, distance: 1000, height: 500, name: 'يسار', nameEn: 'Left' },
  sideRight: { angle: Math.PI/2, distance: 1000, height: 500, name: 'يمين', nameEn: 'Right' },
} as const;
type Cam3DPresetKey = keyof typeof CAM_PRESETS_3D;

// ================= المكون الرئيسي 3D =================
export function GameScreen3D({ roomCode, isHost, players, settings, scores, lastGoal, paused, onGoal, onTimeUp, onPause, onExit }: { roomCode: string; isHost: boolean; players: Player[]; settings: Settings; scores: Scores; lastGoal: string | null; paused: boolean; onGoal: (p: Player) => void; onTimeUp: () => void; onPause: () => void; onExit: () => void; }) {
  const { i18n } = useTranslation();
  const mountRef = useRef<HTMLDivElement>(null);
  const [timeLeft, setTimeLeft] = useState(settings.mode === 'time'? settings.duration : 0);
  const [rally, setRally] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const pausedRef = useRef(paused);
  const gameEndedRef = useRef(false);
  pausedRef.current = paused;

  const world = useMemo(() => getArenaWorld(players.length, settings.arenaSize), [players.length, settings.arenaSize]);
  const initialCam = useMemo(() => {
    const camDist = players.length === 4? 1150 : 1350;
    return { angle: 0, targetAngle: 0, distance: camDist, targetDistance: camDist, height: 950, targetHeight: 950, targetX: world.w / 2, targetZ: world.h / 2, lookX: world.w / 2, lookZ: world.h / 2 };
  }, [world, players.length]);

  const cam = useRef({...initialCam });
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

  // === حالات جديدة للكاميرا (اضافة) ===
  const [showCamMenu, setShowCamMenu] = useState(false);
  const [hideUI, setHideUI] = useState(false);
  const [currentPreset, setCurrentPreset] = useState<Cam3DPresetKey>('iso');
  const isAr = i18n.language?.startsWith('ar');

  const getInitialSpeed = useCallback(() => 6 + settings.ballSpeed * 0.5, [settings.ballSpeed]);

  const createHatPaddle = useCallback((color: string) => {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.15,
      metalness: 0.25,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.45
    });

    const base = new THREE.Mesh(new THREE.TorusGeometry(24, 7, 16, 32), mat);
    base.rotation.x = Math.PI / 2;
    base.position.y = 7;
    group.add(base);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(18, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.position.y = 14;
    group.add(dome);

    return group;
  }, []);

  const resetCamera = useCallback(() => { cam.current = {...initialCam }; setCurrentPreset('iso'); }, [initialCam]);

  // === دوال تحكم كاميرا جديدة (اضافة بدون حذف) ===
  const applyPreset = useCallback((key: Cam3DPresetKey) => {
    const p = CAM_PRESETS_3D[key];
    cam.current.targetAngle = p.angle;
    cam.current.targetDistance = p.distance;
    cam.current.targetHeight = p.height;
    setCurrentPreset(key);
  }, []);

  const zoomCam = useCallback((dir: number) => {
    cam.current.targetDistance = Math.max(300, Math.min(2000, cam.current.targetDistance * (dir > 0? 0.85 : 1.18)));
  }, []);

  const rotateCam = useCallback((dir: 'left' | 'right' | 'up' | 'down') => {
    if (dir === 'left') cam.current.targetAngle -= 0.4;
    if (dir === 'right') cam.current.targetAngle += 0.4;
    if (dir === 'up') cam.current.targetHeight = Math.min(1800, cam.current.targetHeight + 120);
    if (dir === 'down') cam.current.targetHeight = Math.max(250, cam.current.targetHeight - 120);
  }, []);

  // تحريك المضرب بنظام Pointer المتقدم لدعم اللمس المتعدد (إصبعين) وسلاسة الاستجابة
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const mouse = new THREE.Vector2();

    const handlePointerMove = (e: PointerEvent) => {
      // تجاهل اللمسات الإضافية (الإصبع الثاني) لتفادي تشتت المضرب
      if (!e.isPrimary ||!threeRef.current) return;

      const rect = el.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, threeRef.current.camera);
      const target = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, target)) {
        const clampedX = Math.max(45, Math.min(world.w - 45, target.x));
        stateRef.current.paddles.bottom = clampedX;
      }
    };

    el.addEventListener('pointerdown', handlePointerMove);
    el.addEventListener('pointermove', handlePointerMove);
    return () => {
      el.removeEventListener('pointerdown', handlePointerMove);
      el.removeEventListener('pointermove', handlePointerMove);
    };
  }, [world.w]);

  // إنشاء المشهد 3D بالانعكاسات الواقعية
  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');
    scene.fog = new THREE.Fog('#000000', 1100, 2800);

    setup3DArenaLighting(scene, world.w, world.h);

    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(200, 900, 300);
    dir.castShadow = true;
    scene.add(dir);

    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 10, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    // الطاولة بمادة MeshPhysicalMaterial لمحاكاة الأكريليك اللامع والانعكاسات
    const tableGroup = new THREE.Group();
    const surfaceTexture = createAirHockeySurface(world.w, world.h);
    const tableMaterial = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      map: surfaceTexture || undefined,
      metalness: 0.1,
      roughness: 0.1,
      clearcoat: 1.0, // طبقة زجاجية لامعة عاكسة للضوء
      clearcoatRoughness: 0.05,
    });

    const table = new THREE.Mesh(new THREE.BoxGeometry(world.w, 18, world.h), tableMaterial);
    table.position.set(world.w / 2, 9, world.h / 2);
    table.receiveShadow = true;
    tableGroup.add(table);
    scene.add(tableGroup);

    // الكرة
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(12, 32, 32),
      new THREE.MeshStandardMaterial({ color: '#ff1a2e', emissive: '#ff0011', emissiveIntensity: 0.85, roughness: 0.2, metalness: 0.3 })
    );
    ball.castShadow = true;
    ball.position.y = 23;
    scene.add(ball);

    // المضارب
    const paddles: Record<string, THREE.Group> = {};
    players.forEach(p => {
      const g = createHatPaddle(p.color);
      scene.add(g);
      paddles[p.side] = g;
    });

    threeRef.current = { scene, camera, renderer, ball, paddles };

    const ro = new ResizeObserver(() => {
      if (!mountRef.current ||!threeRef.current) return;
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    });
    ro.observe(mount);

    return () => {
      if (renderer.domElement.parentElement) {
        mount.removeChild(renderer.domElement);
      }
      renderer.dispose();
      ro.disconnect();
    };
  }, [world.w, world.h, players, createHatPaddle]);

  // حلقة اللعبة وفيزياء الارتداد المصححة
  useEffect(() => {
    let frame = 0;
    const state = stateRef.current;
    const playerForSide = (side: Player['side']) => players.find(p => p.side === side)?? players[0];

    const launchBall = () => {
      const spd = getInitialSpeed();
      const dirY = Math.random() > 0.5? 1 : -1;
      const ang = (Math.random() - 0.5) * 0.8;
      state.ball.vx = Math.sin(ang) * spd;
      state.ball.vy = Math.cos(ang) * spd * dirY;
    };
    launchBall();

    const tick = (now: number) => {
      const delta = Math.min((now - state.last) / 16.67, 2);
      state.last = now;

      if (!pausedRef.current &&!gameEndedRef.current) {
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
          // حركة ذكاء المضرب العلوي
          const topSpeed = 5 * delta;
          if (state.paddles.top < state.ball.x - 12) state.paddles.top += topSpeed;
          else if (state.paddles.top > state.ball.x + 12) state.paddles.top -= topSpeed;
          state.paddles.top = Math.max(45, Math.min(world.w - 45, state.paddles.top));

          // تحديث موقع الكرة
          state.ball.x += state.ball.vx * delta;
          state.ball.y += state.ball.vy * delta;

          const r = 12; // نصف قطر الكرة
          const paddleRadius = 24; // نصف قطر المضرب الدائري

          // 1. ارتداد الجدران الجانبية (يمين ويسار) بدقة وبدون اختراق
          if (state.ball.x - r <= 0) {
            state.ball.x = r + 1;
            state.ball.vx = Math.abs(state.ball.vx);
          } else if (state.ball.x + r >= world.w) {
            state.ball.x = world.w - r - 1;
            state.ball.vx = -Math.abs(state.ball.vx);
          }

          // 2. تصادم المضرب السفلي (بنظام الدائرة الحقيقية)
          const botP = state.paddles.bottom;
          const paddleYBot = world.h - 52;
          const distBot = Math.hypot(state.ball.x - botP, state.ball.y - paddleYBot);

          if (distBot < r + paddleRadius && state.ball.vy > 0) {
            const nx = (state.ball.x - botP) / distBot;
            const ny = (state.ball.y - paddleYBot) / distBot;

            // طرد الكرة خارج المضرب لمنعها من العبور
            state.ball.x = botP + nx * (r + paddleRadius + 1);
            state.ball.y = paddleYBot + ny * (r + paddleRadius + 1);

            state.ball.vy = -Math.abs(state.ball.vy);
            state.ball.vx += nx * 3.5;
            state.rally++;
          }

          // 3. تصادم المضرب العلوي
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

          // 4. احتساب الأهداف وارتداد الجدار الخلفي
          const GOAL_W = 280;
          const GX1 = (world.w - GOAL_W) / 2, GX2 = GX1 + GOAL_W;
          const inGoal = (x: number) => x >= GX1 && x <= GX2;

          let missed: Player | undefined;
          if (state.ball.y - r <= 0) {
            if (inGoal(state.ball.x)) {
              missed = playerForSide('top');
            } else {
              state.ball.y = r + 1;
              state.ball.vy = Math.abs(state.ball.vy);
            }
          } else if (state.ball.y + r >= world.h) {
            if (inGoal(state.ball.x)) {
              missed = playerForSide('bottom');
            } else {
              state.ball.y = world.h - r - 1;
              state.ball.vy = -Math.abs(state.ball.vy);
            }
          }

          if (missed) {
            onGoal(missed);
            state.countdown = 3;
            state.countdownStart = now;
            setCountdown(3);
            state.ball.x = world.w / 2;
            state.ball.y = world.h / 2;
            launchBall();
          }
          setRally(state.rally);
        }
      }

      if (threeRef.current) {
        const { ball, paddles, camera, renderer, scene } = threeRef.current;
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

        renderer.render(scene, camera);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [players, settings, onGoal, onTimeUp, world, getInitialSpeed]);

  function formatTime(s: number) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

  return (
    <main className="game-shell" style={{ background: '#000', display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      {/* زر اظهار اذا مخفي (اضافة) */}
      {hideUI && (
        <button onClick={()=>setHideUI(false)} style={{ position:'absolute', top:16, right:16, zIndex:30, background:'#00e5ff', color:'#000', borderRadius:999, padding:'8px 14px', fontWeight:900, display:'flex', gap:6, alignItems:'center', border:'none', cursor:'pointer' }}>
          <Eye size={16}/> {isAr? 'اظهار':'Show'}
        </button>
      )}

      {!hideUI && (
      <header className="game-topbar" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 24px', alignItems: 'center', zIndex: 10 }}>
        <div className="brand" style={{ color: '#fff', fontWeight: 'bold' }}>QOUD 3D</div>
        <div className="match-meta" style={{ color: '#fff' }}><b>{settings.mode === 'time'? formatTime(timeLeft) : '∞'}</b> | Rally: {rally}</div>
        <div className="game-actions" style={{ display: 'flex', gap: '6px' }}>
          <button className="game-icon" onClick={()=>setShowCamMenu(v=>!v)} style={{ background: showCamMenu? '#00e5ff':'#111', color: showCamMenu? '#000':'#fff', borderRadius:10, padding:'8px 10px', border:'1px solid #333', display:'flex', alignItems:'center', gap:4 }}>
            <Camera size={16}/> {isAr? 'كاميرا':'Cam'}
          </button>
          <button className="game-icon" onClick={onPause}>{paused? <Play size={18} /> : <Pause size={18} />}</button>
          <button className="game-icon" onClick={resetCamera} style={{ background: '#ffcf5a', color: '#000' }}><RotateCcw size={16} /></button>
          <button className="game-icon" onClick={onExit}><X size={18} /></button>
        </div>
      </header>
      )}
      <div ref={mountRef} style={{ width: '100%', flex: 1, borderRadius: '22px', overflow: 'hidden', position: 'relative', touchAction: 'none' }}>
        {countdown > 0 && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}><span style={{ fontSize: '120px', fontWeight: 900, color: '#ff2233' }}>{countdown}</span></div>}

        {/* قائمة الكاميرا الجديدة (اضافة) */}
        {showCamMenu &&!hideUI && (
          <div style={{
            position:'absolute', top:12, right:12, zIndex:20,
            background:'rgba(10,10,10,0.94)', backdropFilter:'blur(14px)',
            border:'1px solid #222', borderRadius:16, padding:14, width:300,
            color:'#fff', display:'flex', flexDirection:'column', gap:12
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <b style={{ display:'flex', gap:6, alignItems:'center' }}><Video size={16}/> {isAr? 'تحكم الكاميرا':'Camera'}</b>
              <button onClick={()=>setShowCamMenu(false)} style={{ background:'#222', borderRadius:8, padding:4, border:'none', color:'#fff' }}><X size={14}/></button>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {(Object.keys(CAM_PRESETS_3D) as Cam3DPresetKey[]).map(k=>(
                <button key={k} onClick={()=>applyPreset(k)}
                  style={{
                    padding:'10px 8px', borderRadius:10, fontWeight:800, fontSize:12,
                    border: currentPreset===k? '2px solid #00e5ff':'1px solid #333',
                    background: currentPreset===k? '#111':'#0a0a0a',
                    color: currentPreset===k? '#00e5ff':'#aaa', cursor:'pointer'
                  }}>
                  {isAr? CAM_PRESETS_3D[k].name : CAM_PRESETS_3D[k].nameEn}
                </button>
              ))}
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, justifyItems:'center' }}>
              <div/>
              <button onClick={()=>rotateCam('up')} style={btnStyle}><ArrowUp size={18}/></button>
              <div/>
              <button onClick={()=>rotateCam('left')} style={btnStyle}><ArrowLeft size={18}/></button>
              <button onClick={resetCamera} style={{...btnStyle, background:'#ff4081', color:'#fff'}}><Maximize2 size={16}/></button>
              <button onClick={()=>rotateCam('right')} style={btnStyle}><ArrowRight size={18}/></button>
              <div/>
              <button onClick={()=>rotateCam('down')} style={btnStyle}><ArrowDown size={18}/></button>
              <div/>
            </div>

            <div style={{ display:'flex', gap:8 }}>
              <button onClick={()=>zoomCam(1)} style={{ flex:1,...btnStyle }}><ZoomIn size={18}/> {isAr? 'قرب':'In'}</button>
              <button onClick={()=>zoomCam(-1)} style={{ flex:1,...btnStyle }}><ZoomOut size={18}/> {isAr? 'بعد':'Out'}</button>
            </div>

            <div style={{ display:'flex', gap:8 }}>
              <button onClick={()=>rotateCam('left')} style={{ flex:1,...btnStyle }}><RotateCcw size={16}/> {isAr? 'يسار':'Left'}</button>
              <button onClick={()=>rotateCam('right')} style={{ flex:1,...btnStyle }}><RotateCw size={16}/> {isAr? 'يمين':'Right'}</button>
            </div>

            <button onClick={()=>{ setHideUI(true); setShowCamMenu(false); }} style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:10, borderRadius:10, background:'#111', border:'1px solid #333', color:'#888', cursor:'pointer' }}>
              <EyeOff size={16}/> {isAr? 'اخفاء كل الازرار':'Hide All UI'}
            </button>

            <small style={{ opacity:0.5, fontSize:10, textAlign:'center' }}>
              {isAr? 'التحكم بالماوس: اسحب للتدوير' : 'Drag table to move paddle'}
            </small>
          </div>
        )}
      </div>
    </main>
  );
}

const btnStyle: React.CSSProperties = {
  background:'#1a1a1a', border:'1px solid #2a2a2a', color:'#fff',
  borderRadius:10, padding:'10px', display:'flex', alignItems:'center', justifyContent:'center', gap:6,
  fontWeight:700, cursor:'pointer'
};