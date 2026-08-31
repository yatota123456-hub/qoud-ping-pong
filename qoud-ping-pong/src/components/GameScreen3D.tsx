    import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
    import * as THREE from 'three';
    import { Pause, Play, X, RotateCcw } from 'lucide-react';
    import { useTranslation } from 'react-i18next';

    // ================= الأنواع المشتركة =================
    type Player = { id: number | string; name: string; color: string; side: 'top' | 'right' | 'bottom' | 'left'; computer: boolean; socketId?: string };
    type Settings = any;
    type Scores = Record<string | number, number>;

    // ================= الدالة التي طلبت نقلها - كاملة هنا فقط =================
    // دالة إعداد الأضواء والحواف المضيئة داخل Three.js Scene
function setup3DArenaLighting(
  scene: THREE.Scene, 
  worldWidth: number, 
  worldHeight: number
) {
  // 1. إضاءة عامة - مرة واحدة تكفي
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  // 2. أضواء الزوايا - بنفس نظام الطاولة 0 -> w
  const neonColors = [0x00e5ff, 0xff4081, 0xffcf5a, 0x61e7c2];
  const cornerPositions = [
    { x: 0, z: 0 },
    { x: worldWidth, z: 0 },
    { x: worldWidth, z: worldHeight },
    { x: 0, z: worldHeight },
  ];

  cornerPositions.forEach((pos, idx) => {
    const pointLight = new THREE.PointLight(neonColors[idx % 4], 2.8, Math.max(worldWidth, worldHeight) * 1.8);
    pointLight.position.set(pos.x, 80, pos.z);
    scene.add(pointLight);

    const bulbGeo = new THREE.SphereGeometry(12, 16, 16);
    const bulbMat = new THREE.MeshBasicMaterial({ color: neonColors[idx % 4] });
    const bulbMesh = new THREE.Mesh(bulbGeo, bulbMat);
    bulbMesh.position.set(pos.x, 25, pos.z);
    scene.add(bulbMesh);
  });

  // 3. حواف نيون - ترجعها لتضيفها أنت داخل tableGroup
  const borderMaterial = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: 0x00e5ff,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });

  const railThickness = 14;
  const railHeight = 22;

  const rails = [
    { w: worldWidth+40, h: railHeight, d: railThickness, x: worldWidth/2, z: -railThickness/2 },
    { w: worldWidth+40, h: railHeight, d: railThickness, x: worldWidth/2, z: worldHeight+railThickness/2 },
    { w: railThickness, h: railHeight, d: worldHeight, x: -railThickness/2, z: worldHeight/2 },
    { w: railThickness, h: railHeight, d: worldHeight, x: worldWidth+railThickness/2, z: worldHeight/2 },
  ];

  rails.forEach((r) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.d), borderMaterial);
    mesh.position.set(r.x, railHeight/2 + 9, r.z);
    scene.add(mesh);
  });
}

    // ================= مساعدات =================
    function ai(ball: number, paddle: number, difficulty: any) { 
      const f = difficulty==='easy'?0.35:difficulty==='normal'?0.65:0.92; 
      return ball>paddle+16?f:ball<paddle-16?-f:0; 
    }
    function getArenaWorld(count: number, size: any='medium'){ 
      const ARENA_SCALES: any = { small: 0.8, medium: 1.0, large: 1.25, xlarge: 1.5 };
      const RECT = { w: 800, h: 1250 }; const SQUARE = { w: 1200, h: 1200 };
      const base = count===4?SQUARE:RECT; const sc = ARENA_SCALES[size]||1; 
      return {w:base.w*sc, h:base.h*sc}; 
    }
    function Brand(){ return <div className="brand"><span>QOUD</span></div>; }

    // ================= المكون الرئيسي 3D =================
    export function GameScreen3D({ roomCode, isHost, players, settings, scores, lastGoal, paused, onGoal, onTimeUp, onPause, onExit }: { roomCode: string; isHost: boolean; players: Player[]; settings: Settings; scores: Scores; lastGoal: string | null; paused: boolean; onGoal: (p: Player)=>void; onTimeUp: ()=>void; onPause: ()=>void; onExit: ()=>void; }) {
      const { i18n } = useTranslation();
      const isAr = i18n.language?.startsWith('ar') ?? true;
      const mountRef = useRef<HTMLDivElement>(null);
      const [timeLeft, setTimeLeft] = useState(settings.mode === 'time' ? settings.duration : 0);
      const [rally, setRally] = useState(0);
      const [countdown, setCountdown] = useState(0);
      const pausedRef = useRef(paused);
      const gameEndedRef = useRef(false);
      pausedRef.current = paused;

      const world = useMemo(() => getArenaWorld(players.length, settings.arenaSize), [players.length, settings.arenaSize]);
      const initialCam = useMemo(() => {
        const camDist = players.length === 4 ? 1150 : 1350; 
        return { angle: 0.05, targetAngle: 0.05, distance: camDist, targetDistance: camDist, height: 950, targetHeight: 950, targetX: world.w / 2, targetZ: world.h / 2, lookX: world.w / 2, lookZ: world.h / 2 };
      }, [world, players.length]);

      const cam = useRef({ ...initialCam });
      const threeRef = useRef<any>(null);
      const stateRef = useRef({ 
        ball: { x: world.w / 2, y: world.h / 2, vx: 0, vy: 0 }, 
        paddles: { top: world.w / 2, right: world.h / 2, bottom: world.w / 2, left: world.h / 2 }, 
        last: performance.now(), elapsed: 0, rally: 0, 
        countdown: 0, countdownStart: 0, countdownSide: null as Player['side'] | null 
      });

      const getInitialSpeed = useCallback(() => 1.5 + settings.ballSpeed * 0.28, [settings.ballSpeed]);

      const createHatPaddle = useCallback((color: string) => {
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.15, emissive: new THREE.Color(color), emissiveIntensity: 0.32 });
        const base = new THREE.Mesh(new THREE.TorusGeometry(22, 7, 16, 32), mat); 
        base.rotation.x = Math.PI/2; base.position.y = 7; group.add(base);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(18, 32, 16, 0, Math.PI*2, 0, Math.PI/2), mat); 
        dome.position.y = 14; group.add(dome);
        return group;
      }, []);

      const resetCamera = useCallback(() => { cam.current = { ...initialCam }; }, [initialCam]);

      // إعداد المشهد - يتم استدعاء setup3DArenaLighting هنا فقط
      useEffect(() => {
        if (!mountRef.current) return;
        const mount = mountRef.current;

        // 1. إنشاء المشهد
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#000000');
        scene.fog = new THREE.Fog('#000000', 1100, 2800);

        // 2. استدعاء دالة الإضاءة المنقولة
        setup3DArenaLighting(scene, world.w, world.h);

        const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 10, 5000);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        mount.appendChild(renderer.domElement);

     
              dir.position.set(200, 900, 300);
        dir.castShadow = true;
        scene.add(dir);

        const tableGroup = new THREE.Group();
        const table = new THREE.Mesh(new THREE.BoxGeometry(world.w, 18, world.h), new THREE.MeshStandardMaterial({ color: '#f3f5f7', roughness: 0.28 }));
        table.position.set(world.w/2, 9, world.h/2);
        table.receiveShadow = true;
        tableGroup.add(table);
        scene.add(tableGroup);

        const ball = new THREE.Mesh(new THREE.SphereGeometry(10.5, 24, 24), new THREE.MeshStandardMaterial({ color: '#ff1a2e', emissive: '#ff0011', emissiveIntensity: 0.75 }));
        ball.castShadow = true;
        ball.position.y = 23;
        scene.add(ball);

        const paddles: Record<string, THREE.Group> = {};
        players.forEach(p => { 
          const g = createHatPaddle(p.color); 
          scene.add(g); 
          paddles[p.side] = g; 
        });

        threeRef.current = { scene, camera, renderer, ball, paddles };

        const ro = new ResizeObserver(() => {
          if (!mountRef.current || !threeRef.current) return;
          camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
        });
        ro.observe(mount);

        return () => {
          mount.removeChild(renderer.domElement);
          renderer.dispose();
          ro.disconnect();
        };
      }, [world.w, world.h, players, createHatPaddle]);

      // حلقة اللعبة
      useEffect(() => {
        let frame = 0;
        const state = stateRef.current;
        const playerForSide = (side: Player['side']) => players.find(p=>p.side===side) ?? players[0];
        const isActive = (side: Player['side']) => players.some(p=>p.side===side);

        const launchBall = (fromPaddle=false) => {
          const spd = getInitialSpeed() + (settings.speed === 'gradual' ? state.rally * 0.15 : 0);
          const ang = fromPaddle ? (Math.random()-0.5)*Math.PI*0.8 : Math.random()*Math.PI*2;
          state.ball.vx = Math.cos(ang)*spd;
          state.ball.vy = Math.sin(ang)*spd;
        };
        if (settings.start !== 'paddle') launchBall(false);

        const tick = (now: number) => {
          const delta = Math.min((now - state.last)/16.67, 2);
          state.last = now;

          if (!pausedRef.current && !gameEndedRef.current) {
            state.elapsed += delta/60;
            if (settings.mode==='time' && state.elapsed>1) {
              state.elapsed=0;
              setTimeLeft(t=>{ if(t<=1){ gameEndedRef.current=true; onTimeUp(); return 0;} return t-1; });
            }

            if (state.countdown > 0) {
              const e = (now - state.countdownStart)/1000;
              if (e>=3) { state.countdown=0; setCountdown(0); launchBall(false); }
              else { setCountdown(Math.ceil(3-e)); }
            } else {
              state.ball.x += state.ball.vx * delta;
              state.ball.y += state.ball.vy * delta;

              const r = 20;
              if (!isActive('top') && state.ball.y - r < 22) { state.ball.y = 22+r; state.ball.vy = Math.abs(state.ball.vy); }
              if (!isActive('bottom') && state.ball.y + r > world.h-22) { state.ball.y = world.h-22-r; state.ball.vy = -Math.abs(state.ball.vy); }

              // تصادم المضارب
              if (isActive('bottom')) {
                const dx = state.ball.x - state.paddles.bottom;
                if (Math.abs(dx)<50 && state.ball.y>world.h-80 && state.ball.vy>0) {
                  state.ball.vy = -Math.abs(state.ball.vy)-1;
                  state.ball.vx += dx*0.1;
                  state.rally++;
                }
              }

              // هدف
              const GOAL_W = 260;
              const GX1 = (world.w-GOAL_W)/2, GX2=GX1+GOAL_W;
              const inGX = (x:number)=>x>=GX1&&x<=GX2;
              let missed: Player|undefined;
              if (state.ball.y<0 && inGX(state.ball.x)) missed=playerForSide('top');
              if (state.ball.y>world.h && inGX(state.ball.x)) missed=playerForSide('bottom');
              if (missed) {
                onGoal(missed);
                state.countdown=3; state.countdownStart=now; setCountdown(3);
                state.ball.x=world.w/2; state.ball.y=world.h/2; state.ball.vx=0; state.ball.vy=0;
              }
              setRally(state.rally);
            }
          }

          if (threeRef.current) {
            const { ball, paddles, camera, renderer, scene } = threeRef.current;
            const c = cam.current;
            c.angle += (c.targetAngle - c.angle)*0.1;
            const cx = c.lookX + Math.sin(c.angle)*c.distance;
            const cz = c.lookZ + Math.cos(c.angle)*c.distance;
            camera.position.set(cx, c.height, cz);
            camera.lookAt(c.lookX, 0, c.lookZ);
            ball.position.x = state.ball.x;
            ball.position.z = state.ball.y;
            if (paddles['bottom']) paddles['bottom'].position.set(state.paddles.bottom, 12, world.h-52);
            if (paddles['top']) paddles['top'].position.set(state.paddles.top, 12, 52);
            renderer.render(scene, camera);
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
      }, [players, settings, onGoal, onTimeUp, world, getInitialSpeed]);

      function formatTime(s: number) { return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }

      return (
        <main className="game-shell" style={{ background:'#000', display:'flex', flexDirection:'column', height:'100dvh', overflow:'hidden' }}>
          <header className="game-topbar">
            <div className="brand">QOUD</div>
            <div className="match-meta"><b>{settings.mode==='time'?formatTime(timeLeft):'∞'}</b></div>
            <div className="game-actions" style={{display:'flex', gap:'6px'}}>
              <button className="game-icon" onClick={onPause}>{paused?<Play size={18}/>:<Pause size={18}/>}</button>
              <button className="game-icon" onClick={resetCamera} style={{background:'#ffcf5a', color:'#000'}}><RotateCcw size={16}/></button>
              <button className="game-icon" onClick={onExit}><X size={18}/></button>
            </div>
          </header>
          <div ref={mountRef} style={{ width:'100%', flex:1, borderRadius:'22px', overflow:'hidden', position:'relative' }}>
            {countdown>0 && <div style={{position:'absolute', inset:0, background:'rgba(0,0,0,0.72)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:5}}><span style={{fontSize:'120px', fontWeight:900, color:'#ff2233'}}>{countdown}</span></div>}
          </div>
        </main>
      );
    }
