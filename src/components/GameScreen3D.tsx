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

  // الأهداف - نفس شكل الصورة تماماً: فتح في الأعلى والأسفل - قوس أحمر صغير في الحافة
  // في الصورة: هدف علوي فتحه للأسفل، وهدف سفلي فتحه للأعلى - مثل حرف U مقلوب
  ctx.strokeStyle = '#ff2d2d'; // أحمر مثل الإطار في الصورة
  ctx.lineWidth = 8; // رفيع مثل الصورة - ليس سميك جداً
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  const goalRadius = 360; // حجم مثل الصورة - قوس صغير ليس كبير جداً (في الصورة القوس صغير)
  // هدف علوي - قوس أحمر فتحه للأسفل (مثل الصورة - في الأعلى)
  ctx.beginPath();
  ctx.arc(canvas.width/2, 0, goalRadius, 0, Math.PI, false);
  ctx.stroke();
  // هدف سفلي - قوس أحمر فتحه للأعلى (مثل الصورة - في الأسفل)
  ctx.beginPath();
  ctx.arc(canvas.width/2, canvas.height, goalRadius, Math.PI, Math.PI*2, false);
  ctx.stroke();
  
  // خط داخلي خفيف للتأكيد مثل الصورة (قوس داخلي أرفع)
  ctx.strokeStyle = 'rgba(255, 45, 45, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(canvas.width/2, 0, goalRadius-12, 0, Math.PI, false);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(canvas.width/2, canvas.height, goalRadius-12, Math.PI, Math.PI*2, false);
  ctx.stroke();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  
  // إضافة تعبئة واضحة داخل الأهداف لإبرازها
  ctx.fillStyle = 'rgba(255, 30, 30, 0.14)'; // أوضح من قبل
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

  // خط داخلي إضافي للتأكيد - يجعل الهدف ظاهر أكثر
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(canvas.width/2, 0, goalRadius-10, 0, Math.PI, false);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(canvas.width/2, canvas.height, goalRadius-10, Math.PI, Math.PI*2, false);
  ctx.stroke();

  // أهداف جانبية للـ 4 لاعبين فقط - مربعة فقط إذا مربعة
  const isSquareArena = worldW >= 950 && Math.abs(worldW - worldH) < 150; // مربعة = 4 لاعبين
  if (isSquareArena) {
    const sideGoalRadius = 360; // نفس حجم الأهداف العلوية
    ctx.strokeStyle = '#ff2d2d';
    ctx.lineWidth = 8;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, canvas.height/2, sideGoalRadius, -Math.PI/2, Math.PI/2, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(canvas.width, canvas.height/2, sideGoalRadius, Math.PI/2, -Math.PI/2, false);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
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
  // الأهداف فتح حقيقي في الإطار - مثل الصورة: فتحة في المنتصف أعلى وأسفل - نفس شكل لقطة الشاشة
  const isSquareArena = worldW >= 950 && Math.abs(worldW - worldH) < 150;
  const goalGapW = worldW * 0.60; // مثل الصورة - فتحة سوداء 32% فقط // أكبر من فوق الإطار على كل الساحات - 2 - أكبر
  const goalGapH = worldH * 0.60; // مثل الصورة // أكبر
  
  const bezelPieces: any[] = [];

  // إطار علوي مقسوم لفتحة في المنتصف - فتح مثل الصورة (الأسود في الصورة هو الفتحة)
  const topSideWidth = (worldW - goalGapW) / 2 + bezelThickness;
  const topLeftX = -bezelThickness + topSideWidth/2;
  const topRightX = worldW + bezelThickness - topSideWidth/2;
  bezelPieces.push(
    { w: topSideWidth, d: bezelThickness, x: topLeftX, z: -bezelThickness / 2 },
    { w: topSideWidth, d: bezelThickness, x: topRightX, z: -bezelThickness / 2 }
  );

  // إطار سفلي مقسوم لفتحة في المنتصف
  bezelPieces.push(
    { w: topSideWidth, d: bezelThickness, x: topLeftX, z: worldH + bezelThickness / 2 },
    { w: topSideWidth, d: bezelThickness, x: topRightX, z: worldH + bezelThickness / 2 }
  );

  if (isSquareArena) {
    const sideWidth = (worldH - goalGapH) / 2 + bezelThickness;
    const leftTopZ = -bezelThickness + sideWidth/2;
    const leftBottomZ = worldH + bezelThickness - sideWidth/2;
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
  const goalW = Math.min(360, Math.max(180, worldW * 0.60)); // أكبر من فوق الإطار - 2 - أكبر
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
    const sideGoalW = Math.min(360, Math.max(180, worldH * 0.60));
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
  // الأهداف فتح حقيقي في الإطار - مثل الصورة: فتحة في المنتصف أعلى وأسفل - نفس شكل لقطة الشاشة
  const isSquareArena = worldW >= 950 && Math.abs(worldW - worldH) < 150;
  const goalGapW = worldW * 0.60; // مثل الصورة - فتحة سوداء 32% فقط // أكبر من فوق الإطار على كل الساحات - 2 - أكبر
  const goalGapH = worldH * 0.60; // مثل الصورة // أكبر
  
  const bezelPieces: any[] = [];

  // إطار علوي مقسوم لفتحة في المنتصف - فتح مثل الصورة (الأسود في الصورة هو الفتحة)
  const topSideWidth = (worldW - goalGapW) / 2 + bezelThickness;
  const topLeftX = -bezelThickness + topSideWidth/2;
  const topRightX = worldW + bezelThickness - topSideWidth/2;
  bezelPieces.push(
    { w: topSideWidth, d: bezelThickness, x: topLeftX, z: -bezelThickness / 2 },
    { w: topSideWidth, d: bezelThickness, x: topRightX, z: -bezelThickness / 2 }
  );

  // إطار سفلي مقسوم لفتحة في المنتصف
  bezelPieces.push(
    { w: topSideWidth, d: bezelThickness, x: topLeftX, z: worldH + bezelThickness / 2 },
    { w: topSideWidth, d: bezelThickness, x: topRightX, z: worldH + bezelThickness / 2 }
  );

  if (isSquareArena) {
    const sideWidth = (worldH - goalGapH) / 2 + bezelThickness;
    const leftTopZ = -bezelThickness + sideWidth/2;
    const leftBottomZ = worldH + bezelThickness - sideWidth/2;
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
  const goalW = Math.min(360, Math.max(180, worldW * 0.60)); // فتحة سوداء 32% مثل الصورة // أكبر من فوق الإطار - 2 - أكبر
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
    const sideGoalW = Math.min(360, Math.max(180, worldH * 0.60)); // 32% مثل الصورة
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
  const ARENA_SCALES: any = { small: 0.85, medium: 1.05, large: 1.7, xlarge: 2.2 };
  const RECT = { w: 700, h: 1050 };
  const SQUARE = { w: 1000, h: 1000 };
  // فقط إذا 4 لاعبين يكون مربع، 2 لاعبين يكون مستطيل - تصحيح حسب طلب المستخدم
  const base = count >= 4 ? SQUARE : RECT;
  const sc = ARENA_SCALES[size] || 1;
  return { w: base.w * sc, h: base.h * sc, scale: sc, scaleFactor: 1 };
}

function getAdaptiveCameraPresets(world: {w:number,h:number}, arenaSize: string, isMobile: boolean) {
  const isMobileNow = typeof window !== 'undefined' ? window.innerWidth < 768 : false;
  // إصلاح 1: الساحة متوسطة أمام الكاميرا عند بدء اللعبة - مسافة محسوبة من حجم الساحة لضمان التوسيط
  const maxDim = Math.max(world.w, world.h);
  const PRESET_BY_SIZE: any = {
    small:  { distance: Math.max(980, maxDim * 1.15), height: 680, fov: 52 },
    medium: { distance: Math.max(1180, maxDim * 1.12), height: 760, fov: 50 },
    large:  { distance: Math.max(1680, maxDim * 1.18), height: 1020, fov: 48 },
    xlarge: { distance: Math.max(2080, maxDim * 1.22), height: 1220, fov: 46 },
  };
  const base = PRESET_BY_SIZE[arenaSize] || PRESET_BY_SIZE.medium;
  const mobileBoost = isMobileNow ? 1.22 : 1.0;
  const heightBoost = isMobileNow ? 1.15 : 1.0;
  const distance = base.distance * mobileBoost;
  const height = base.height * heightBoost;
  const basePresets = {
    top: { angle: Math.PI, distance: 420, height: 1350, name: 'من الأعلى', nameEn: 'Top View' },
    bottom: { angle: 0, distance: distance, height: height, name: 'خلفك', nameEn: 'Behind You' },
    topPlayer: { angle: Math.PI, distance: distance*0.58, height: height*0.78, name: 'خلف الخصم', nameEn: 'Behind Enemy' },
    iso: { angle: 0.52, distance: distance * 0.72, height: height * 0.85, name: 'مائل', nameEn: 'Isometric' },
    sideLeft: { angle: -Math.PI / 2, distance: distance*0.72, height: height*0.65, name: 'يسار', nameEn: 'Left' },
    sideRight: { angle: Math.PI / 2, distance: distance*0.72, height: height*0.65, name: 'يمين', nameEn: 'Right' },
  };
  const adapted: any = {};
  for (const k in basePresets) {
    const b: any = (basePresets as any)[k];
    // إصلاح 1: تأكد أن الكاميرا متوسطة تماماً أمام الساحة
    adapted[k] = { ...b, baseDistance: b.distance, baseHeight: b.height, scaleFactor: 1, isMobile: isMobileNow, targetX: world.w / 2, targetZ: world.h / 2, lookX: world.w / 2, lookZ: world.h / 2 };
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
    const savedCam = localStorage.getItem(`qoud_camera_preset_${settings.arenaSize || 'medium'}`);
    if (savedCam) {
      setSavedCamData(savedCam);
      setShowRestoreModal(true);
    }
  }, []);

  const restoreCamera = () => {
    try {
      const saved = localStorage.getItem(`qoud_camera_settings_${settings.arenaSize || 'medium'}`);
      if (saved) {
        const s = JSON.parse(saved);
        cam.current = { ...cam.current, ...s, targetAngle: s.targetAngle ?? s.angle ?? cam.current.angle, targetDistance: s.targetDistance ?? s.distance ?? cam.current.distance, targetHeight: s.targetHeight ?? s.height ?? cam.current.height };
      }
    } catch {}
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

  // تم إرجاع خاصية الانتظار لإصلاح الكاميرا - ضد الكمبيوتر يبدأ بعد 3.5 ثانية
  useEffect(()=>{
    const vsComp = (settings as any).vsComputer || players.some((p:any)=>p.computer);
    if (vsComp && !localReadyRef.current) {
      const timer = setTimeout(() => {
        if (!localReadyRef.current) {
          setLocalReady(true);
          localReadyRef.current = true;
          stateRef.current.countdown = 3;
          stateRef.current.countdownStart = performance.now();
          setCountdown(3);
        }
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [players, (settings as any).vsComputer, localReady]);


  const isMobileCheck = useMemo(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false, []);
  const [serverWorld, setServerWorld] = useState<{w:number,h:number}|null>(null);
  const world = useMemo(() => {
    if (serverWorld && !isOfflineMode) {
      return { w: serverWorld.w, h: serverWorld.h };
    }
    return getArenaWorld(Math.max(players.length, settings.players || 2), settings.arenaSize);
  }, [players.length, settings.players, settings.arenaSize, serverWorld, isOfflineMode]);
  const adaptivePresets = useMemo(() => getAdaptiveCameraPresets(world as any, settings.arenaSize, isMobileCheck), [world.w, world.h, settings.arenaSize, isMobileCheck]);

  const getMySide = useCallback((): Player['side'] => {
    // اللاعب الرئيسي دائماً تحت - حتى في وضع الأصدقاء كل واحد يشوف نفسه تحت في جواله
    const found = players.find((p) => p.socketId === socket.id);
    if (found) {
      // في وضع الأصدقاء، كل لاعب يشوف نفسه تحت - نرجع جانبه الحقيقي للكاميرا
      return found.side as Player['side'];
    }
    // ضد الكمبيوتر أو وضع غير متصل - اللاعب الرئيسي دائماً تحت
    const isVsComputer = (settings as any).vsComputer || players.some((p:any)=>p.computer);
    if (isVsComputer) {
      return 'bottom' as Player['side'];
    }
    return (players[0]?.side?? 'bottom') as Player['side'];
  }, [players, (settings as any).vsComputer]);

    const mySideForCam = getMySide();
  const initialCam = useMemo(() => {
    // كل لاعب يرى نفسه تحت وبقية اللاعبين يرونهم في الأعلى إذا كان 2 لاعبين أصدقاء
    // و 4 أصدقاء من شاشة كل لاعب يلعب من تحت أما في شاشة الأصدقاء يرونهم في الأطراف وفي الأعلى
    // اللاعب الرئيسي دائماً تحت - الكاميرا خلف اللاعب الرئيسي
    // في وضع الأصدقاء 2 و 4: كل جوال يشوف نفسه تحت ويرى أصدقاءه في مواقعهم الصحيحة
    const actualSide = mySideForCam;
    // نختار بريست الكاميرا بحيث يكون جانب اللاعب الرئيسي دائماً في الأسفل
    // 2 لاعبين: bottom يرى نفسه تحت و top فوق، top يرى نفسه تحت و bottom فوق
    // 4 لاعبين: كل واحد يرى نفسه تحت والبقية في الأطراف وفوق
    let sideKey: string;
    if (actualSide === 'top') {
      sideKey = 'topPlayer'; // كاميرا خلف العلوي - أنت تحت (top يظهر تحت)، صديقك bottom يظهر فوق، left/right في الأطراف
    } else if (actualSide === 'left') {
      sideKey = 'sideLeft'; // كاميرا من اليسار - أنت تحت (left يظهر تحت)، الأصدقاء في الأطراف وفوق
    } else if (actualSide === 'right') {
      sideKey = 'sideRight'; // كاميرا من اليمين - أنت تحت (right يظهر تحت)، الأصدقاء في الأطراف وفوق
    } else {
      sideKey = 'bottom'; // كاميرا خلفك - أنت تحت (bottom يظهر تحت)، صديقك top يظهر فوق، left/right في الأطراف
    }
    const preset = (adaptivePresets as any)[sideKey] || (adaptivePresets as any).bottom;
    return {
      angle: preset.angle, targetAngle: preset.angle, distance: preset.distance, targetDistance: preset.distance, height: preset.height, targetHeight: preset.height, targetX: world.w / 2, targetZ: world.h / 2, lookX: world.w / 2, lookZ: world.h / 2, scaleFactor: 1
    };
  }, [world, adaptivePresets, mySideForCam]);

  const cam = useRef({...initialCam, targetX: world.w/2, targetZ: world.h/2, lookX: world.w/2, lookZ: world.h/2 });
  
  // تحديث الكاميرا عند تغير الجانب - كل لاعب يرى نفسه تحت
  // 2 لاعبين: كل واحد يرى نفسه تحت والآخر فوق
  // 4 لاعبين: كل واحد يرى نفسه تحت والبقية في الأطراف وفوق
  useEffect(() => {
    const sideKey = mySideForCam === 'top'? 'topPlayer' : mySideForCam === 'left'? 'sideLeft' : mySideForCam === 'right'? 'sideRight' : 'bottom';
    const preset = (adaptivePresets as any)[sideKey] || (adaptivePresets as any).bottom;
    cam.current.angle = preset.angle;
    cam.current.targetAngle = preset.angle;
    cam.current.distance = preset.distance;
    cam.current.targetDistance = preset.distance;
    cam.current.height = preset.height;
    cam.current.targetHeight = preset.height;
    cam.current.targetX = world.w / 2;
    cam.current.targetZ = world.h / 2;
    cam.current.lookX = world.w / 2;
    cam.current.lookZ = world.h / 2;
  }, [mySideForCam, adaptivePresets]);
  useEffect(() => {
    const saved = localStorage.getItem(`qoud_camera_settings_${settings.arenaSize || 'medium'}`);
    if (saved) {
      try {
        const s = JSON.parse(saved);
        cam.current = { ...cam.current, ...s, targetX: world.w/2, targetZ: world.h/2, lookX: world.w/2, lookZ: world.h/2 };
      } catch {}
    } else {
      // لا حفظ - متوسطة تماماً
      cam.current = { ...initialCam, targetX: world.w/2, targetZ: world.h/2, lookX: world.w/2, lookZ: world.h/2 } as any;
    }
  }, [settings.arenaSize]);

  const saveCameraSettings = useCallback(() => {
    const settings = {
      angle: cam.current.angle,
      distance: cam.current.distance,
      height: cam.current.height,
      targetAngle: cam.current.targetAngle,
      targetDistance: cam.current.targetDistance,
      targetHeight: cam.current.targetHeight,
    };
    localStorage.setItem(`qoud_camera_settings_${settings.arenaSize || 'medium'}`, JSON.stringify(settings));
  }, []);

  const resetCameraToDefault = useCallback(() => {
    cam.current = { ...initialCam };
    localStorage.removeItem(`qoud_camera_settings_${settings.arenaSize || 'medium'}`);
  }, [initialCam]);

  const threeRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext|null>(null);

  const playHitSound3D = (power: number = 0.5) => {
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
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current; if (!ctx) return;
      for (let i=0;i<4;i++) {
        setTimeout(() => {
          try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = 180 + Math.random()*320;
            gain.gain.value = 0.3;
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.9);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(); osc.stop(ctx.currentTime + 0.9);
          } catch {}
        }, i*100);
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
  const createGoalStars3D = (x: number, z: number) => {
    if (!threeRef.current) return;
    const { hitGroup } = threeRef.current;
    for (let i=0;i<24;i++) {
      const starGeo = new THREE.SphereGeometry(3 + Math.random()*2.5, 8, 8);
      const starMat = new THREE.MeshBasicMaterial({
        color: ['#ffcf5a','#ff6b8b','#61e7c2','#00e5ff','#ffffff'][Math.floor(Math.random()*5)],
        transparent: true, opacity: 1
      });
      const star = new THREE.Mesh(starGeo, starMat);
      star.position.set(x + (Math.random()-0.5)*24, 34 + Math.random()*22, z + (Math.random()-0.5)*24);
      const vel = { x: (Math.random()-0.5)*13, y: 5 + Math.random()*9, z: (Math.random()-0.5)*13 };
      hitGroup.add(star);
      hitEffectsRef.current.push({ mesh: star, vel, life: 1, decay: 0.02 + Math.random()*0.016, type: 'star' });
    }
  };


  const hitEffectsRef = useRef<any[]>([]);
  const shakeRef = useRef({ intensity: 0 });
  const lastBallEmitRef = useRef(0);
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
    serving: { active: (settings as any).start === 'paddle', side: 'bottom' as Player['side'], startTime: 0, requested: false }, // إصلاح 4: يبدأ من المضرب إذا اختيار من المضرب
    paddleVel: { top: {vx:0, vy:0}, bottom: {vx:0, vy:0}, left: {vx:0, vy:0}, right: {vx:0, vy:0} } as any
  });

  // إطلاق الكرة من المضرب بالمسافة
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        if (stateRef.current.serving.active) {
          stateRef.current.serving.requested = true;
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const playersKey = useMemo(() => players.map(p => `${p.side}:${p.color}`).join(','), [players]);

  const [showCamMenu, setShowCamMenu] = useState(false);
  const [hideUI, setHideUI] = useState(false);
  const [currentPreset, setCurrentPreset] = useState<Cam3DPresetKey>('bottom');
  const [readyPlayers, setReadyPlayers] = useState<string[]>([]); // طور الأصدقاء فقط - من ضغط ابدأ
  const isAr = i18n.language?.startsWith('ar');

  const getInitialSpeed = useCallback(() => 3 + settings.ballSpeed * 0.2, [settings.ballSpeed]);
  const isOfflineMode =!socket.connected || players.length <= 1 || settings.vsComputer || players.some((p:any)=>p.computer);
  // لا انتظار نهائياً في طور ضد الكمبيوتر - فقط في طور مع الأصدقاء (2 أو 4 لاعبين أصدقاء)
  // نعتمد على زر القائمة نفسه: settings.vsComputer + حقل computer في اللاعبين
  const isVsComputer = settings.vsComputer || players.some((p:any) => p.computer || p.isBot || p.isComputer || p.type === 'bot' || (p.name && (p.name.includes('كمبيوتر') || p.name.toLowerCase().includes('computer') || p.name.toLowerCase().includes('bot') || p.name.toLowerCase().includes('cpu'))));
  const isFriendsMode = !isVsComputer && !!roomCode && players.length > 1; // فقط عندما vsComputer = false وهناك غرفة (مع الأصدقاء) - ضد الكمبيوتر لا يوجد انتظار نهائياً

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
    // إعادة الكاميرا بحيث يكون اللاعب الرئيسي دائماً تحت
    const mySide = getMySide();
    const sideKey = mySide === 'top'? 'topPlayer' : mySide === 'left'? 'sideLeft' : mySide === 'right'? 'sideRight' : 'bottom';
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
    try { localStorage.setItem(`qoud_camera_settings_${settings.arenaSize || 'medium'}`, JSON.stringify({ angle: cam.current.angle, distance: cam.current.distance, height: cam.current.height, targetAngle: cam.current.targetAngle, targetDistance: cam.current.targetDistance, targetHeight: cam.current.targetHeight })); } catch {}
  }, [adaptivePresets]);

  const zoomCam = useCallback((dir: number) => {
    cam.current.targetDistance = Math.max(600, Math.min(2200, cam.current.targetDistance * (dir > 0? 0.88 : 1.15)));
    try { localStorage.setItem(`qoud_camera_settings_${settings.arenaSize || 'medium'}`, JSON.stringify({ angle: cam.current.angle, distance: cam.current.distance, height: cam.current.height, targetAngle: cam.current.targetAngle, targetDistance: cam.current.targetDistance, targetHeight: cam.current.targetHeight })); } catch {}
  }, []);

  const rotateCam = useCallback((dir: 'left' | 'right' | 'up' | 'down') => {
    if (dir === 'left') cam.current.targetAngle -= 0.35;
    if (dir === 'right') cam.current.targetAngle += 0.35;
    if (dir === 'up') cam.current.targetHeight = Math.min(1800, cam.current.targetHeight + 100);
    if (dir === 'down') cam.current.targetHeight = Math.max(400, cam.current.targetHeight - 100);
    try { localStorage.setItem(`qoud_camera_settings_${settings.arenaSize || 'medium'}`, JSON.stringify({ angle: cam.current.angle, distance: cam.current.distance, height: cam.current.height, targetAngle: cam.current.targetAngle, targetDistance: cam.current.targetDistance, targetHeight: cam.current.targetHeight })); } catch {}
  }, []);

  useEffect(() => {
    // إصلاح 1+4: الساحة متوسطة أمام الكاميرا + الحفظ لكل حجم
    const hasSaved = localStorage.getItem(`qoud_camera_settings_${settings.arenaSize || 'medium'}`);
    if (hasSaved) {
      try {
        const s = JSON.parse(hasSaved);
        // تأكد أن lookAt متوسطة دائماً للساحة الحالية - إصلاح 1
        cam.current = { 
          ...cam.current, 
          ...initialCam, 
          ...s, 
          targetAngle: s.targetAngle ?? s.angle ?? initialCam.angle, 
          targetDistance: s.targetDistance ?? s.distance ?? initialCam.distance, 
          targetHeight: s.targetHeight ?? s.height ?? initialCam.height,
          targetX: initialCam.targetX, // دائماً متوسطة
          targetZ: initialCam.targetZ,
          lookX: initialCam.lookX,
          lookZ: initialCam.lookZ
        };
        return;
      } catch {}
    }
    // إذا لا يوجد حفظ لهذا الحجم - متوسطة تماماً أمام الكاميرا
    cam.current = {...initialCam, targetX: world.w/2, targetZ: world.h/2, lookX: world.w/2, lookZ: world.h/2} as any;
  }, [initialCam, settings.arenaSize, world.w, world.h]);

  useEffect(() => {
    const handleGameState = (data: any) => {
      if (!data) return;
      const mySide = getMySide();
      if (data.worldW && data.worldH) {
        if (!serverWorldRef.current || serverWorldRef.current.w !== data.worldW || serverWorldRef.current.h !== data.worldH) {
          serverWorldRef.current = { w: data.worldW, h: data.worldH };
        setServerWorld({ w: data.worldW, h: data.worldH });
        }
      }
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
        if (!isOfflineMode) {
          // الأونلاين (حتى Host): العد من السيرفر فقط - إصلاح جذري
          if (stateRef.current.countdown !== data.countdown) {
            stateRef.current.countdown = data.countdown;
            stateRef.current.countdownStart = performance.now();
            setCountdown(data.countdown);
          }
        } else {
          stateRef.current.countdown = data.countdown;
          setCountdown(data.countdown);
        }
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

  // طور الأصدقاء فقط (مع الأصدقاء) - نظام الجاهزية: لا تبدأ حتى يضغط الكل ابدأ - ضد الكمبيوتر لا يوجد انتظار
  useEffect(() => {
    if (!isFriendsMode) return;
    const handlePlayerReady = (data: any) => {
      const playerId = data.playerId || data.id || data.socketId;
      if (!playerId) return;
      setReadyPlayers(prev => prev.includes(playerId) ? prev : [...prev, playerId]);
    };
    const handleAllReady = () => {
      if (!localReadyRef.current) {
        setLocalReady(true);
        localReadyRef.current = true;
        stateRef.current.countdown = 3;
        stateRef.current.countdownStart = performance.now();
        setCountdown(3);
      }
    };
    socket.on('player-ready', handlePlayerReady);
    socket.on('all-players-ready', handleAllReady);
    socket.on('game-started', handleAllReady);
    return () => {
      socket.off('player-ready', handlePlayerReady);
      socket.off('all-players-ready', handleAllReady);
      socket.off('game-started', handleAllReady);
    };
  }, [isFriendsMode, players.length]);

  useEffect(() => {
    if (isFriendsMode && readyPlayers.length >= players.length && players.length > 1) {
      // عندما يصبح الكل جاهز - ابدأ للكل، ليس فقط للمضيف - إصلاح التعليق
      if (isHost) {
        socket.emit('all-players-ready', { roomCode });
        socket.emit('game-started', { roomCode });
      }
      // أي لاعب يرى الكل جاهز يبدأ فوراً - يمنع التعليق
      if (!localReadyRef.current) {
        setLocalReady(true);
        localReadyRef.current = true;
        stateRef.current.countdown = 3;
        stateRef.current.countdownStart = performance.now();
        setCountdown(3);
      }
    }
  }, [readyPlayers, isHost, isFriendsMode, players.length, roomCode]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const mouse = new THREE.Vector2();
    const clamp = (v:number,mn:number,mx:number)=>Math.max(mn,Math.min(mx,v));
    const handlePointerMove = (e: PointerEvent) => {
      // إصلاح 5: بدء الكرة من المضرب عند الضغط - حتى لو ثابتة
      if (stateRef.current.serving.active) {
        if (e.type === 'pointerdown') {
          stateRef.current.serving.requested = true;
          if (e.cancelable) e.preventDefault();
          return;
        }
      }
      if (!e.isPrimary || !threeRef.current) return;
      if (e.target instanceof HTMLElement && e.target.closest('button')) return;
      hasDraggedRef.current = true;
      if(hintDotRef.current) hintDotRef.current.style.display='none';
      if(hintTextRef.current) hintTextRef.current.style.display='none';
      const mySide = getMySide();
      const isTouch = (e as any).pointerType === 'touch' || (e as any).pointerType === 'pen';
      const OFFSET = isTouch? 195 : 75; // الإصبع أسفل المضرب ولا يغطيه أبدا - إصلاح 7
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
        const isFourPlayers = needCount >= 4; // مربعة فقط لـ 4 لاعبين
        // للـ 4 لاعبين: تقدم قليل جداً (22% و 78%)، للـ 2 لاعبين: تقدم أكبر (38% و 62%)
        const topLimit = isFourPlayers ? world.h * 0.22 : world.h * 0.38;
        const bottomLimit = isFourPlayers ? world.h * 0.78 : world.h * 0.62;
        const leftLimit = isFourPlayers ? world.w * 0.22 : world.w * 0.38;
        const rightLimit = isFourPlayers ? world.w * 0.78 : world.w * 0.62;

        // نقطة التحريك دائماً أسفل المضرب (جنوب الشاشة) بمسافة OFFSET - ليظهر المضرب ولا يغطيه الإصبع
        // لكل لاعب يلعب من تحت - خاصة اللاعب الثاني والـ 4 لاعبين - كل واحد يتحكم من تحت ويرى أصدقاءه في مواقعهم الصحيحة
        if (mySide === 'top') {
          // اللاعب العلوي - كاميرته خلف العلوي - أسفل الشاشة = شمال العالم - المضرب فوق الإصبع بصرياً
          const clampedX = clamp(tx, 45, world.w - 45);
          const clampedZ = clamp(tz + OFFSET, 45, topLimit); // + OFFSET للعلوي ليتحكم من تحت
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
        } else if (mySide === 'bottom') {
          const clampedX = clamp(tx, 45, world.w - 45);
          const clampedZ = clamp(tz - OFFSET, bottomLimit, world.h - 45); // إصبع أسفل المضرب
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
        } else if (mySide === 'left') {
          const clampedX = clamp(tx, leftLimit, leftLimit + 200);
          const clampedZ = clamp(tz - OFFSET, 45, world.h - 45);
          stateRef.current.targetPaddles[mySide].x = clampedX;
          stateRef.current.targetPaddles[mySide].z = clampedZ;
          if (!isOfflineMode) socket.sendPaddleTarget(clampedX, clampedZ);
        } else if (mySide === 'right') {
          const clampedX = clamp(tx, rightLimit - 200, world.w - 45);
          const clampedZ = clamp(tz - OFFSET, 45, world.h - 45);
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
    // إصلاح: الساحة البيضاء الكرة داكنة لا مضيئة - 2
    const isWhiteArena = arenaStyle === 'classic';
    const puckMat = new THREE.MeshStandardMaterial({
      color: isWhiteArena ? '#111111' : '#ffffff',
      roughness: isWhiteArena ? 0.35 : 0.12,
      metalness: isWhiteArena ? 0.15 : 0.15,
      emissive: isWhiteArena ? '#000000' : '#00e5ff',
      emissiveIntensity: isWhiteArena ? 0 : 1.4,
    });
    const puckBase = new THREE.Mesh(new THREE.CylinderGeometry(17, 17, 13, 48), puckMat);
    puckBase.position.y = 6;
    puckGroup.add(puckBase);
    if (!isWhiteArena) {
      const blueRingMat = new THREE.MeshStandardMaterial({
        color: '#00e5ff',
        roughness: 0.08,
        metalness: 0.1,
        emissive: '#00e5ff',
        emissiveIntensity: 1.8
      });
      const blueRing = new THREE.Mesh(new THREE.TorusGeometry(11, 2.4, 16, 48), blueRingMat);
      blueRing.rotation.x = Math.PI / 2;
      blueRing.position.y = 12.5;
      puckGroup.add(blueRing);
      const outerGlowMat = new THREE.MeshBasicMaterial({
        color: '#00e5ff',
        transparent: true,
        opacity: 0.4
      });
      const outerGlow = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 1, 32), outerGlowMat);
      outerGlow.position.y = 1;
      puckGroup.add(outerGlow);
      const puckGlowMat = new THREE.MeshBasicMaterial({
        color: '#00e5ff',
        transparent: true,
        opacity: 0.55
      });
      const puckGlow = new THREE.Mesh(new THREE.CylinderGeometry(32, 32, 1, 32), puckGlowMat);
      puckGlow.position.y = 0.5;
      puckGroup.add(puckGlow);
      const ballLight = new THREE.PointLight(0x00e5ff, 1.5, 220);
      ballLight.position.set(0, 22, 0);
      puckGroup.add(ballLight);
    } else {
      // ساحة بيضاء - حلقة داكنة بسيطة بدون توهج
      const darkRingMat = new THREE.MeshStandardMaterial({
        color: '#222222',
        roughness: 0.5,
        metalness: 0.1,
        emissive: '#000000',
        emissiveIntensity: 0
      });
      const darkRing = new THREE.Mesh(new THREE.TorusGeometry(11, 1.2, 16, 48), darkRingMat);
      darkRing.rotation.x = Math.PI / 2;
      darkRing.position.y = 12.5;
      puckGroup.add(darkRing);
    }
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
    const MIN_SPEED = 6.0; // كان 5.0 - سرعة دنيا أعلى
    const MAX_SPEED = 24; // كان 16 - الآن 24 للسماح بارتداد قوي جداً حسب سرعة المضرب
    const WALL_BOUNCE_DAMP = 0.98; // كان 0.95 - ارتداد أقوى

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
          // === العداد - جذري: الأوفلاين محلي، الأونلاين من السيرفر ===
          if (state.countdown > 0) {
            if (isOfflineMode) {
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
                }
              }
            }
            // ملاحظة: في الأونلاين العد يأتي من السيرفر عبر game-state، لا ننقصه محليا

            // أثناء العد - الكرة ثابتة في الوسط
            state.ball.x = world.w / 2;
            state.ball.y = world.h / 2;
            state.ballTarget.x = state.ball.x;
            state.ballTarget.y = state.ball.y;
            // لا نحرك المضارب أثناء العد؟ نسمح بالتحكم
          }

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

          // === إذا من المضرب - الكرة تتبع المضرب ===
          if (state.serving.active) {
            const servingSide = state.serving.side;
            const servingPaddle = state.paddles[servingSide];
            if (servingPaddle) {
              if (servingSide === 'bottom') { state.ball.x = servingPaddle.x; state.ball.y = servingPaddle.z - 60; }
              else if (servingSide === 'top') { state.ball.x = servingPaddle.x; state.ball.y = servingPaddle.z + 60; }
              else if (servingSide === 'left') { state.ball.x = servingPaddle.x + 60; state.ball.y = servingPaddle.z; }
              else { state.ball.x = servingPaddle.x - 60; state.ball.y = servingPaddle.z; }
              state.ballTarget.x = state.ball.x; state.ballTarget.y = state.ball.y;
            }
            if (state.serving.requested) {
              state.serving.active = false;
              const spd = getInitialSpeed() + 2;
              if (servingSide === 'bottom') { state.ball.vx = (Math.random()-0.5)*spd; state.ball.vy = -Math.abs(spd)-1; }
              else if (servingSide === 'top') { state.ball.vx = (Math.random()-0.5)*spd; state.ball.vy = Math.abs(spd)+1; }
              else if (servingSide === 'left') { state.ball.vx = Math.abs(spd)+1; state.ball.vy = (Math.random()-0.5)*spd; }
              else { state.ball.vx = -Math.abs(spd)-1; state.ball.vy = (Math.random()-0.5)*spd; }
            }
          }

          // تحديث موقع الكرة - فيزياء محلية مستقرة - فقط إذا انتهى العد
          if (state.countdown === 0 && !state.serving.active) {
            // جذري: الأوفلاين فقط يحسب فيزياء، الأونلاين (حتى Host) يأخذ من السيرفر
            if (isOfflineMode) {
            // === AI للكمبيوتر في وضع 3D - نفس طريقة 2D ===
            if (isOfflineMode) {
              const predX = state.ball.x + state.ball.vx * 10;
              const predY = state.ball.y + state.ball.vy * 10;
              const diffMax = settings.difficulty === 'easy' ? 3.0 : settings.difficulty === 'hard' ? 8.0 : 5.0;
              const chase = (cur: number, target: number, deltaVal: number) => {
                const diff = target - cur;
                if (Math.abs(diff) < 1) return cur;
                return cur + Math.max(-diffMax, Math.min(diffMax, diff * 0.14)) * deltaVal;
              };
              (['top','bottom','right','left'] as Player['side'][]).forEach(side => {
                if (!activeSide(side)) return;
                // تحقق هل هذا الجانب كمبيوتر
                const playerForSide = players.find((p:any) => p.side === side);
                const isComputerSide = (isVsComputer && side !== getMySide()) || (playerForSide && playerForSide.computer);
                if (!isComputerSide) return;
                const tp = state.targetPaddles[side];
                // الكمبيوتر يتحرك في كل الجهات - أفقي وعمودي - إصلاح 2
                if (side === 'top') {
                  tp.x = Math.max(60, Math.min(world.w - 60, chase(state.paddles[side].x, predX, delta)));
                  tp.z = Math.max(40, Math.min(220, chase(state.paddles[side].z, predY, delta)));
                } else if (side === 'bottom') {
                  tp.x = Math.max(60, Math.min(world.w - 60, chase(state.paddles[side].x, predX, delta)));
                  tp.z = Math.max(world.h - 220, Math.min(world.h - 40, chase(state.paddles[side].z, predY, delta)));
                } else if (side === 'left') {
                  tp.z = Math.max(60, Math.min(world.h - 60, chase(state.paddles[side].z, predY, delta)));
                  tp.x = Math.max(40, Math.min(220, chase(state.paddles[side].x, predX, delta)));
                } else {
                  tp.z = Math.max(60, Math.min(world.h - 60, chase(state.paddles[side].z, predY, delta)));
                  tp.x = Math.max(world.w - 220, Math.min(world.w - 40, chase(state.paddles[side].x, predX, delta)));
                }
              });
            }

              state.ball.x += state.ball.vx * delta;
              state.ball.y += state.ball.vy * delta;
            } else {
              // أونلاين (2 و 4 لاعبين): السيرفر متحكم وحيد - إصلاح جذري بدون تنبؤ
              // المشكلة السابقة: التنبؤ كان يجعل الكرة تبدو في ملعب آخر
              const dx = state.ballTarget.x - state.ball.x;
              const dy = state.ballTarget.y - state.ball.y;
              const dist = Math.hypot(dx, dy);
              // استخدام أبعاد السيرفر لضمان نفس الساحة للكل - إصلاح الكرة في ملعب آخر
              const currentW = serverWorld?.w || serverWorldRef.current?.w || world.w;
              const currentH = serverWorld?.h || serverWorldRef.current?.h || world.h;
              if (dist > 120) {
                // انتقال فوري إذا بعيدة (بعد هدف)
                state.ball.x = state.ballTarget.x;
                state.ball.y = state.ballTarget.y;
                state.ball.vx = state.ballTarget.vx;
                state.ball.vy = state.ballTarget.vy;
              } else {
                // lerp مباشر بدون تنبؤ - يضمن نفس المكان للكل بدون تأخير
                const LERP_POS = 0.65; // عالي لتساوي فوري بدون تأخير
                const LERP_VEL = 0.6;
                // بدون تنبؤ - نستخدم موقع السيرفر مباشرة
                state.ball.x += (state.ballTarget.x - state.ball.x) * LERP_POS;
                state.ball.y += (state.ballTarget.y - state.ball.y) * LERP_POS;
                state.ball.vx += (state.ballTarget.vx - state.ball.vx) * LERP_VEL;
                state.ball.vy += (state.ballTarget.vy - state.ball.vy) * LERP_VEL;
                // تأكد أن الكرة داخل حدود الساحة
                state.ball.x = Math.max(BALL_RADIUS, Math.min(currentW - BALL_RADIUS, state.ball.x));
                state.ball.y = Math.max(BALL_RADIUS, Math.min(currentH - BALL_RADIUS, state.ball.y));
              }
            }

            // منع الكرة من التعلق - فقط للأوفلاين، الأونلاين السيرفر يحسبه
            if (isOfflineMode) {
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

                        // === التحكم في مساحة الهدف + إصلاح الارتداد من الأطراف (الأرقام 1-4 في الصورة) ===
            // هنا تتحكم في حجم الهدف: 0.20=40% صغير، 0.30=60% متوسط، 0.40=80% كبير
            const goalHalfW = Math.min(340, Math.max(190, world.w * 0.36)); // كان 0.30 - الآن 0.36 ليطابق الصورة - هدف كبير
            const sideGoalHalfW = Math.min(340, Math.max(190, world.h * 0.36)); // هدف كبير
            const BORDER = 28;
            const leftBound = BORDER + BALL_RADIUS;
            const rightBound = world.w - BORDER - BALL_RADIUS;
            const topBound = BORDER + BALL_RADIUS;
            const bottomBound = world.h - BORDER - BALL_RADIUS;
            
            // جدار علوي - مع هامش 12 بكسل لمنع الارتداد من طرف الهدف
            if (state.ball.y <= topBound) {
              const edgeBuffer = 12;
              if (Math.abs(state.ball.x - world.w/2) <= goalHalfW + edgeBuffer && activeSide('top')) {
                // داخل الفتحة + هامش - لا جدار - الكرة تدخل من فوق المساحة السوداء وتختفي
              } else {
                state.ball.y = topBound + 2;
                const minSpeed = Math.max(Math.abs(state.ball.vy), 2.5);
                state.ball.vy = minSpeed;
              }
            }
            // جدار سفلي - مع هامش
            if (state.ball.y >= bottomBound) {
              const edgeBuffer = 12;
              if (Math.abs(state.ball.x - world.w/2) <= goalHalfW + edgeBuffer && activeSide('bottom')) {
              } else {
                state.ball.y = bottomBound - 2;
                const minSpeed = Math.max(Math.abs(state.ball.vy), 2.5);
                state.ball.vy = -minSpeed;
              }
            }
            // جدار يسار - إصلاح الأسهم 1 و 2 - الكرة كانت ترتد من أطراف الأهداف الفارغة
            if (state.ball.x <= leftBound) {
              const edgeBuffer = 12; // يصلح الارتداد عند الأرقام 1 و 2
              if (Math.abs(state.ball.y - world.h/2) <= sideGoalHalfW + edgeBuffer && activeSide('left')) {
                // داخل الفتحة + هامش - لا جدار - تدخل من فوق المساحة السوداء وتختفي
              } else {
                state.ball.x = leftBound + 2;
                const minSpeed = Math.max(Math.abs(state.ball.vx), 2.5);
                state.ball.vx = minSpeed;
              }
            }
            // جدار يمين - إصلاح الأسهم 3 و 4
            if (state.ball.x >= rightBound) {
              const edgeBuffer = 12; // يصلح الارتداد عند الأرقام 3 و 4
              if (Math.abs(state.ball.y - world.h/2) <= sideGoalHalfW + edgeBuffer && activeSide('right')) {
              } else {
                state.ball.x = rightBound - 2;
                const minSpeed = Math.max(Math.abs(state.ball.vx), 2.5);
                state.ball.vx = -minSpeed;
              }
            }

            // تسجيل الأهداف - الكرة تدخل من فوق المساحة السوداء وتختفي
            // === التحكم في مساحة الهدف - تقدر تغير 0.30 لتكبير أو تصغير الهدف ===
            const goalScoredSide = (() => {
              // هدف علوي - الكرة تدخل من فوق المساحة السوداء وتختفي
              if (state.ball.y < 25) { // كان 8 - الآن 25 عشان تختفي من فوق المساحة السوداء
                if (Math.abs(state.ball.x - world.w/2) <= goalHalfW) {
                  state.ball.visible = false;
                  if (threeRef.current?.ball) {
                    threeRef.current.ball.visible = false;
                  }
                  return 'top' as const;
                }
              }
              // هدف سفلي
              if (state.ball.y > world.h - 25) {
                if (Math.abs(state.ball.x - world.w/2) <= goalHalfW) {
                  state.ball.visible = false;
                  if (threeRef.current?.ball) {
                    threeRef.current.ball.visible = false;
                  }
                  return 'bottom' as const;
                }
              }
              // أهداف جانبية للـ 4 لاعبين فقط
              if (needPlayers >= 4) {
                if (state.ball.x < 25) {
                  if (Math.abs(state.ball.y - world.h/2) <= sideGoalHalfW) {
                    state.ball.visible = false;
                    if (threeRef.current?.ball) threeRef.current.ball.visible = false;
                    return 'left' as const;
                  }
                }
                if (state.ball.x > world.w - 25) {
                  if (Math.abs(state.ball.y - world.h/2) <= sideGoalHalfW) {
                    state.ball.visible = false;
                    if (threeRef.current?.ball) threeRef.current.ball.visible = false;
                    return 'right' as const;
                  }
                }
              }
              return null;
            })();

            if (goalScoredSide) {
              // وجد هدف - سجل - إصلاح: العداد بعد كل هدف + منع التسجيل الخاطئ
              const missedPlayer = players.find(p => p.side === goalScoredSide) || { side: goalScoredSide, id: goalScoredSide, name: goalScoredSide } as any;
              
              // === إصلاح التسجيل الخاطئ: تأكد أن الكرة خرجت فعلاً من الفتحة ===
              // نتحقق مرة ثانية أن الكرة ضمن فتحة الهدف الحقيقية (0.18 عرض) وليس مجرد قرب الحافة
              const isValidGoal = (() => {
                if (goalScoredSide === 'top' || goalScoredSide === 'bottom') {
                  return Math.abs(state.ball.x - world.w/2) <= goalHalfW;
                } else {
                  return Math.abs(state.ball.y - world.h/2) <= sideGoalHalfW;
                }
              })();
              
              if (!isValidGoal) {
                // تسجيل خاطئ - أرجع الكرة للداخل ولا تسجل
                if (goalScoredSide === 'top') state.ball.y = BALL_RADIUS + 5;
                if (goalScoredSide === 'bottom') state.ball.y = world.h - BALL_RADIUS - 5;
                if (goalScoredSide === 'left') state.ball.x = BALL_RADIUS + 5;
                if (goalScoredSide === 'right') state.ball.x = world.w - BALL_RADIUS - 5;
                state.ball.vx *= -0.8;
                state.ball.vy *= -0.8;
                return;
              }

              // تسجيل صحيح - أعد الكرة للوسط وابدأ العد 3-2-1
              state.ball.x = world.w / 2;
              state.ball.y = world.h / 2;
              state.ballTarget.x = state.ball.x;
              state.ballTarget.y = state.ball.y;
              state.ball.vx = 0;
              state.ball.vy = 0;
              state.ballTarget.vx = 0;
              state.ballTarget.vy = 0;
              // === إصلاح 4: عند اختيار من المضرب - الكرة تبدأ من المضرب وبالترتيب ===
              if ((settings as any).start === 'paddle') {
                const order: Player['side'][] = (players.length >= 4 ? ['bottom','right','top','left'] : ['bottom','top']) as any;
                let nextSide: Player['side'] = 'bottom';
                if (goalScoredSide) {
                  const lastIdx = order.indexOf(goalScoredSide as any);
                  const nextIdx = (lastIdx + 1) % order.length;
                  nextSide = order[nextIdx] || 'bottom';
                }
                state.serving.active = true;
                state.serving.side = nextSide;
                state.serving.startTime = now;
                state.serving.requested = false;
                // ضع الكرة عند المضرب
                const paddle = state.paddles[nextSide];
                if (paddle) {
                  if (nextSide === 'bottom') { state.ball.x = paddle.x; state.ball.y = paddle.z - 60; }
                  else if (nextSide === 'top') { state.ball.x = paddle.x; state.ball.y = paddle.z + 60; }
                  else if (nextSide === 'left') { state.ball.x = paddle.x + 60; state.ball.y = paddle.z; }
                  else { state.ball.x = paddle.x - 60; state.ball.y = paddle.z; }
                  state.ballTarget.x = state.ball.x; state.ballTarget.y = state.ball.y;
                }
                state.ball.vx = 0; state.ball.vy = 0; state.ballTarget.vx = 0; state.ballTarget.vy = 0;
                try { playGoalSound3D(); createGoalStars3D(state.ball.x, state.ball.y); shakeRef.current.intensity = 20; } catch {}
                state.countdown = 0; setCountdown(0);
                state.countdownSide = null; setCountdownSide('');
                state.rally = 0; setRally(0);
                if (onGoal) { onGoal(missedPlayer as any); }
                if (isHost && !isOfflineMode) { socket.emit('goal-scored', { side: goalScoredSide }); }
                return;
              }
              try { playGoalSound3D(); createGoalStars3D(state.ball.x, state.ball.y); shakeRef.current.intensity = 20; } catch {}
              state.countdown = 3;
              state.countdownStart = now;
              state.countdownSide = goalScoredSide;
              setCountdown(3);
              setCountdownSide(goalScoredSide);
              state.rally = 0;
              setRally(0);
              
              // استدعاء onGoal - اللاعب الذي فشل (دخلت الكرة في مرماه)
              if (onGoal) {
                // @ts-ignore
                onGoal(missedPlayer as any);
              }
              // إرسال للشبكة إذا Host
              if (isHost && !isOfflineMode) {
                socket.emit('goal-scored', { side: goalScoredSide });
                socket.emit('game-state', { ball: { x: state.ball.x, y: state.ball.y, vx: 0, vy: 0 }, countdown: 3, countdownSide: goalScoredSide });
              }
              // لا نكمل باقي الفيزياء هذا الإطار
              return;
            }

            // اصطدام بالمضارب - إصلاح الارتداد المباشر لكل اللاعبين
            (['top','bottom','right','left'] as Player['side'][]).forEach(side => {
              if (!activeSide(side)) return;
              const paddle = state.paddles[side];
              const pVel = state.paddleVel[side];
              
              const dx = state.ball.x - paddle.x;
              const dy = state.ball.y - paddle.z;
              const dist = Math.hypot(dx, dy);
              
              if (dist >= HIT_DIST || dist < 0.5) return;

              // منع الاصطدام من الخلف - فقط من الأمام - يعتمد على الموقع فقط (ليس السرعة) لضمان ارتداد مباشر
              let isFrontHit = false;
              const frontThreshold = 8; // تسامح بسيط
              if (side === 'bottom') {
                // مضرب الأسفل - الأمام هو فوق (الكرة فوق المضرب) - ارتداد مباشر حتى لو الكرة تبتعد والمضرب يدفعها
                isFrontHit = state.ball.y < paddle.z + frontThreshold;
              } else if (side === 'top') {
                isFrontHit = state.ball.y > paddle.z - frontThreshold;
              } else if (side === 'left') {
                isFrontHit = state.ball.x > paddle.x - frontThreshold;
              } else if (side === 'right') {
                isFrontHit = state.ball.x < paddle.x + frontThreshold;
              }
              
              // إذا الكرة خلف المضرب تماماً - ادفعها للخارج فقط (منع الاختراق)
              if (!isFrontHit) {
                const pushFactor = 2.0; // دفع أقوى لمنع الاختراق
                const nx = dx / dist;
                const ny = dy / dist;
                const overlap = HIT_DIST - dist + 3;
                state.ball.x += nx * overlap * pushFactor;
                state.ball.y += ny * overlap * pushFactor;
                return;
              }

              // اصطدام أمامي صحيح - فيزياء محسنة
              const nx = dx / dist;
              const ny = dy / dist;
              
              // إخراج الكرة من التداخل فوراً - منع الـ lag
              const overlap = HIT_DIST - dist + 1;
              state.ball.x += nx * overlap;
              state.ball.y += ny * overlap;

              // === فيزياء محسنة: ارتداد بقوة حسب سرعة واتجاه المضرب - إصلاح مطلوب ===
              const paddleSpeed = Math.hypot(pVel.vx, pVel.vy);
              const paddleSpeedFactor = 0.85; // كان 0.35 - الآن 0.85 لارتداد أقوى
              const ballVelDotNormal = state.ball.vx * nx + state.ball.vy * ny;
              
              // ارتداد مع إضافة سرعة المضرب بقوة كبيرة - الكرة ترتد بقوة حسب اتجاهه وسرعته
              let newVx = state.ball.vx - 2 * ballVelDotNormal * nx + pVel.vx * paddleSpeedFactor;
              let newVy = state.ball.vy - 2 * ballVelDotNormal * ny + pVel.vy * paddleSpeedFactor;

              // تأثير مكان الضرب على المضرب - يغير المسار بقوة أكبر
              const hitOffset = side === 'bottom' || side === 'top' 
                ? (state.ball.x - paddle.x) / PADDLE_RADIUS
                : (state.ball.y - paddle.z) / PADDLE_RADIUS;
              
              if (side === 'bottom' || side === 'top') {
                newVx += hitOffset * 5.5; // كان 3.5 - الآن 5.5
                // إضافة دفع إضافي حسب سرعة المضرب الأفقية
                newVx += pVel.vx * 0.25;
              } else {
                newVy += hitOffset * 5.5;
                newVy += pVel.vy * 0.25;
              }

              // زيادة السرعة بقوة حسب سرعة المضرب - كلما كان المضرب أسرع ارتدت الكرة بقوة أكبر
              const speedBoost = 1.12 + state.rally * 0.03 + paddleSpeed * 0.06;
              let newSpeed = Math.hypot(newVx, newVy) * speedBoost;
              // سرعة إضافية بناء على سرعة المضرب
              newSpeed += paddleSpeed * 0.18;
              newSpeed = Math.min(newSpeed, MAX_SPEED + paddleSpeed * 0.15);
              newSpeed = Math.max(newSpeed, MIN_SPEED + paddleSpeed * 0.05);
              
              const angle = Math.atan2(newVy, newVx);
              // منع الزاوية الأفقية تماماً
              let finalAngle = angle;
              const deg = angle * 180 / Math.PI;
              if (Math.abs(Math.sin(finalAngle)) < 0.25) { // أقل من 14 درجة
                finalAngle += (Math.random() > 0.5 ? 1 : -1) * 0.35; // أضف 20 درجة
              }
              
              state.ball.vx = Math.cos(finalAngle) * newSpeed;
              state.ball.vy = Math.sin(finalAngle) * newSpeed;

              try { playHitSound3D(Math.min(1, state.rally/12)); } catch {}
              state.rally++;
              setRally(state.rally);
              
              // إرسال للشبكة إذا Host
              if (isHost && !isOfflineMode) {
                socket.sendBallState?.(state.ball.x, state.ball.y, state.ball.vx, state.ball.vy);
              }
            });
          }

          // إرسال حالة الكرة للعملاء بانتظام - إصلاح توقف اللعبة
          if (isHost && !isOfflineMode && state.countdown === 0) {
            const nowMs = performance.now();
            if (nowMs - lastBallEmitRef.current > 50) { // كل 50ms
              lastBallEmitRef.current = nowMs;
              try {
                socket.emit('game-state', { 
                  ball: { x: state.ball.x, y: state.ball.y, vx: state.ball.vx, vy: state.ball.vy },
                  rally: state.rally,
                  timeLeft: timeLeft
                });
              } catch {}
            }
          }

            } // نهاية if (isOfflineMode) - الفيزياء للأوفلاين فقط

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

        if (hitEffectsRef.current.length > 0) {
          for (let i=hitEffectsRef.current.length-1;i>=0;i--) {
            const eff = hitEffectsRef.current[i];
            if (eff.type === 'star') {
              eff.mesh.position.x += eff.vel.x;
              eff.mesh.position.y += eff.vel.y;
              eff.mesh.position.z += eff.vel.z;
              eff.vel.y -= 0.28;
              eff.vel.x *= 0.99; eff.vel.z *= 0.99;
              eff.life -= eff.decay;
              eff.mesh.material.opacity = eff.life;
              eff.mesh.scale.setScalar(1 + (1-eff.life)*0.6);
              if (eff.life <=0) { threeRef.current.hitGroup.remove(eff.mesh); hitEffectsRef.current.splice(i,1); }
            }
          }
        }
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

      {/* لا نغطي الساحة - شريط صغير للبدء في الأسفل - ضد الكمبيوتر يبدأ فوراً، مع الأصدقاء ينتظر الكل */}
      {!localReady && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9997, display: 'flex', gap: '12px', alignItems: 'center',
          background: 'rgba(15,15,20,0.88)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.15)', borderRadius: '999px', padding: '10px 18px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)', pointerEvents: 'auto'
        }}>
          <button onClick={()=>{
            if (!isFriendsMode) {
              setLocalReady(true);
              localReadyRef.current = true;
              stateRef.current.countdown = 3;
              stateRef.current.countdownStart = performance.now();
              setCountdown(3);
            } else {
              const myId = socket.id || 'local_' + Math.random().toString(36).slice(2,7);
              if (!readyPlayers.includes(myId)) {
                const newReady = [...readyPlayers, myId];
                setReadyPlayers(newReady);
                if (newReady.length >= players.length) {
                  setLocalReady(true);
                  localReadyRef.current = true;
                  stateRef.current.countdown = 3;
                  stateRef.current.countdownStart = performance.now();
                  setCountdown(3);
                  if (isHost) {
                    socket.emit('all-players-ready', { roomCode });
                    socket.emit('game-started', { roomCode });
                  }
                }
              }
              socket.emit('player-ready', { playerId: myId, roomCode, side: getMySide() });
            }
          }} style={{padding:'10px 22px', borderRadius:'999px', background: isFriendsMode ? '#00e5ff' : '#4CAF50', color: isFriendsMode ? '#000' : '#fff', fontWeight:900, border:'none', cursor:'pointer', boxShadow: isFriendsMode ? '0 4px 12px rgba(0,229,255,0.4)' : '0 4px 12px rgba(76,175,80,0.4)', fontSize:'14px'}}>
            {isFriendsMode ? `▶ جاهز (${readyPlayers.length}/${players.length})` : `▶ ابدأ بـ ${arenaStyle==='classic' ? 'أ' : 'ب'}`}
          </button>
          <div style={{width:'1px', height:'22px', background:'rgba(255,255,255,0.15)'}}/>
          <span style={{color:'rgba(255,255,255,0.6)', fontSize:'11px', whiteSpace:'nowrap'}}>
            {isFriendsMode ? 'مع الأصدقاء: انتظر الكل يضغط ابدأ' : 'اختر الشكل من اليمين ←'}
          </span>
        </div>
      )}

      {/* في طور مع الأصدقاء فقط - شاشة انتظار حتى يصبح الكل جاهز - ضد الكمبيوتر لا يوجد انتظار */}
      {!localReady && isFriendsMode && readyPlayers.length > 0 && readyPlayers.length < players.length && (
        <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', zIndex:9996, background:'rgba(0,0,0,0.88)', backdropFilter:'blur(12px)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:'20px', padding:'24px 32px', display:'flex', flexDirection:'column', alignItems:'center', gap:'12px' }}>
          <div style={{width:'48px', height:'48px', borderRadius:'50%', border:'3px solid rgba(255,255,255,0.2)', borderTopColor:'#00e5ff', animation:'spin 1s linear infinite'}}/>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <span style={{color:'#fff', fontWeight:900, fontSize:'16px'}}>بانتظار الأصدقاء...</span>
          <span style={{color:'rgba(255,255,255,0.6)', fontSize:'13px'}}>{readyPlayers.length} / {players.length} جاهزين - مع الأصدقاء فقط</span>
          <div style={{display:'flex', gap:'8px', marginTop:'8px'}}>
            {players.map(p => {
              const isReady = readyPlayers.includes(p.socketId || p.id) || readyPlayers.includes(p.id);
              return <div key={p.id} style={{width:'36px', height:'36px', borderRadius:'50%', background: isReady ? '#4CAF50' : '#333', border: `2px solid ${p.color}`, display:'grid', placeItems:'center', color:'#fff', fontWeight:900, fontSize:'12px'}}>{isReady ? '✓' : '...'}</div>
            })}
          </div>
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
              <button onClick={()=>setShowCamMenu(v=>!v)} style={{
                background: showCamMenu ? '#00e5ff' : 'rgba(255,255,255,0.08)', 
                color: showCamMenu ? '#000' : 'rgba(255,255,255,0.7)',
                border:'1px solid rgba(255,255,255,0.1)', borderRadius:'6px',
                padding:'6px 10px', fontSize:'11px', fontWeight:800, cursor:'pointer',
                display:'flex', alignItems:'center', gap:'4px'
              }}>
                <Camera size={12}/> {showCamMenu ? 'إخفاء' : 'كاميرا'}
              </button>
              <button onClick={onPause} style={{
                background: paused ? '#ff2d2d' : 'rgba(255,255,255,0.08)', 
                color: paused ? '#fff' : 'rgba(255,255,255,0.7)',
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
        {/* إصلاح 3: اخفي اضغط في مكان لضرب الكرة يظهر فقط عند تأخر اللاعب بالضغط */}
        {localReady && stateRef.current?.serving?.active && (() => {
          const elapsed = performance.now() - (stateRef.current?.serving?.startTime || 0);
          const showHint = elapsed > 2500; // يظهر فقط بعد 2.5 ثانية تأخر
          if (!showHint) return null;
          return (
            <div style={{ position: 'absolute', left: '50%', bottom: '22%', transform: 'translateX(-50%)', zIndex: 25, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, animation: 'fadeIn 0.3s ease' }}>
              <button onClick={()=>{ stateRef.current.serving.requested = true; }} style={{
                background: 'linear-gradient(135deg, #00e5ff 0%, #1e90ff 100%)', color: '#000', fontWeight: 900, fontSize: 16,
                padding: '14px 28px', borderRadius: 999, border: '2px solid #fff', cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(0,229,255,0.5)', animation: 'pulse 1.5s infinite'
              }}>
                ▶ اضغط للبدء
              </button>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 700, background: 'rgba(0,0,0,0.5)', padding: '4px 10px', borderRadius: 999 }}>
                اضغط في أي مكان لضرب الكرة
              </span>
            </div>
          );
        })()}
        {localReady && countdown > 0 && (
          <div style={{ position: 'absolute', inset: 0, background: countdownSide ? 'rgba(0,0,0,0.84)' : 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5, gap: '22px', pointerEvents: 'none' }}>
            <span style={{ fontSize: '132px', fontWeight: 900, color: '#ff2233', lineHeight: 1, textShadow: '0 0 40px rgba(255,34,51,0.9), 0 0 80px rgba(0,0,0,1)' }}>{countdown}</span>
            {countdownSide && (
              <span style={{ 
                fontSize: '17px', fontWeight: 900, color: '#fff', 
                background: 'linear-gradient(135deg, #ff2233 0%, #ff6b6b 100%)', 
                padding: '13px 28px', borderRadius: 999,
                boxShadow: '0 8px 28px rgba(255,34,51,0.65)',
                border: '2px solid rgba(255,255,255,0.32)',
                display: 'flex', alignItems: 'center', gap: '10px'
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
        {paused && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 12, gap: '16px' }}>
            <span style={{ fontSize: '48px', fontWeight: 900, color: '#fff' }}>⏸️ {isAr ? 'متوقف' : 'PAUSED'}</span>
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>{isAr ? 'تم إيقاف اللعبة لكل اللاعبين' : 'Game paused for all players'}</span>
            <button onClick={onPause} style={{ padding: '12px 28px', borderRadius: '999px', background: '#00e5ff', color: '#000', fontWeight: 900, border: 'none', cursor: 'pointer' }}>{isAr ? 'متابعة' : 'Resume'}</button>
          </div>
        )}
        {localReady && lastGoal && countdown === 0 && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(255,34,51,0.9)', color: '#fff', padding: '12px 24px', borderRadius: '12px', fontWeight: 900, zIndex: 6 }}>{isAr? 'هدف!' : 'GOAL!'} {lastGoal}</div>}
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
        {/* إصلاح 3: زر كاميرا عائم للجوال - يظهر دائماً */}
        <button onClick={()=>setShowCamMenu(v=>!v)} style={{
          position: 'absolute', top: 12, right: 12, zIndex: 10006,
          background: showCamMenu ? '#00e5ff' : 'rgba(10,10,12,0.9)', 
          color: showCamMenu ? '#000' : '#fff',
          border: '1.5px solid rgba(255,255,255,0.2)', borderRadius: 12,
          padding: '10px 14px', fontSize: 12, fontWeight: 900,
          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)'
        }}>
          <Camera size={14}/> كاميرا
        </button>

        {/* إصلاح 2: ألغي شكل الساحة عند بدء اللعبة - shape - مخفي */}
        {false && !hideUI && !localReady && (
          <div style={{
            position: 'absolute', right: 12, top: 12, zIndex: 10004,
            background: 'rgba(10,10,12,0.92)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14, padding: '8px', display: 'flex',
            flexDirection: 'column', gap: '6px', alignItems: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.7)', width: 88
          }}>
            <span style={{fontSize:9, fontWeight:900, color:'rgba(255,255,255,0.5)', letterSpacing:1}}>SHAPE</span>
            <div style={{display:'flex', gap:'6px'}}>
              <button onClick={()=>setArenaStyle('classic')} style={{width:36, height:52, borderRadius:8, background: arenaStyle==='classic' ? '#00e5ff' : '#1e1e1e', border: arenaStyle==='classic' ? '2px solid #00e5ff' : '1px solid #333', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer'}}>
                <span style={{fontSize:11, fontWeight:900, color: arenaStyle==='classic' ? '#000' : '#fff'}}>أ</span>
              </button>
              <button onClick={()=>setArenaStyle('modern')} style={{width:36, height:52, borderRadius:8, background: arenaStyle==='modern' ? '#00e5ff' : '#1e1e1e', border: arenaStyle==='modern' ? '2px solid #00e5ff' : '1px solid #333', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer'}}>
                <span style={{fontSize:11, fontWeight:900, color: arenaStyle==='modern' ? '#000' : '#fff'}}>ب</span>
              </button>
            </div>
          </div>
        )}

        {showCamMenu && !hideUI && (
          <div style={{ 
            position: 'absolute', 
            right: 8, 
            top: 12,
            bottom: 12,
            zIndex: 10005, 
            background: 'rgba(10,10,12,0.96)', 
            backdropFilter: 'blur(20px)', 
            WebkitBackdropFilter: 'blur(20px)', 
            border: '1.5px solid rgba(255,255,255,0.12)', 
            borderRadius: 18, 
            padding: '8px 6px',
            width: 76,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0,
            boxShadow: '0 16px 48px rgba(0,0,0,0.9)',
            /* إصلاح 3: أزرار الكاميرا في الجوال تظهر */
            touchAction: 'auto',
            pointerEvents: 'auto',
          }}>
            {/* X في الأعلى مثل الرسمة */}
            <button onClick={()=>setShowCamMenu(false)} style={{
              width:36, height:28, borderRadius:8, background:'#1a1a1a', border:'1.5px solid #333',
              color:'#fff', display:'grid', placeItems:'center', cursor:'pointer', flexShrink:0,
              marginBottom:6, fontWeight:900
            }}>
              <X size={14}/>
            </button>

            {/* عمود الأيقونات بنفس شكل الرسمة - مع scroll إذا زادت */}
            <div style={{
              flex:1, width:'100%', overflowY:'auto', overflowX:'hidden',
              display:'flex', flexDirection:'column', alignItems:'center', gap:6,
              padding:'4px 2px',
              scrollbarWidth:'thin',
              scrollbarColor:'#333 #111',
            }}>
              <style>{`
                div::-webkit-scrollbar { width: 3px; }
                div::-webkit-scrollbar-track { background: #111; border-radius: 2px; }
                div::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
              `}</style>

              {/* Save - سماوي */}
              <button onClick={saveCameraSettings} title="حفظ الكاميرا" style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background:'#00e5ff', border:'2px solid #000', borderRadius:12,
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow:'0 2px 0 #000, 0 4px 12px rgba(0,229,255,0.4)', gap:2
              }}>
                <span style={{fontSize:12, fontWeight:900, color:'#000'}}>Save</span>
              </button>

              {/* Rest / Reset - برتقالي */}
              <button onClick={resetCameraToDefault} title="إعادة ضبط" style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background:'#ff8a3d', border:'2px solid #000', borderRadius:12,
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow:'0 2px 0 #000, 0 4px 12px rgba(255,138,61,0.4)', gap:2
              }}>
                <span style={{fontSize:12, fontWeight:900, color:'#000'}}>Rest</span>
              </button>

              {/* <- Left - أخضر */}
              <button onClick={() => rotateCam('left')} style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background:'#61e7c2', border:'2px solid #000', borderRadius:12,
                display:'grid', placeItems:'center', cursor:'pointer', boxShadow:'0 2px 0 #000, 0 4px 12px rgba(97,231,194,0.4)'
              }}>
                <ArrowLeft size={22} strokeWidth={2.8} color="#000"/>
              </button>

              {/* -> Right - أخضر */}
              <button onClick={() => rotateCam('right')} style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background:'#61e7c2', border:'2px solid #000', borderRadius:12,
                display:'grid', placeItems:'center', cursor:'pointer', boxShadow:'0 2px 0 #000, 0 4px 12px rgba(97,231,194,0.4)'
              }}>
                <ArrowRight size={22} strokeWidth={2.8} color="#000"/>
              </button>

              {/* Up - أصفر ملون */}
              <button onClick={() => rotateCam('up')} style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background:'#ffcf5a', border:'2px solid #000', borderRadius:12,
                display:'grid', placeItems:'center', cursor:'pointer', boxShadow:'0 2px 0 #000, 0 4px 12px rgba(255,207,90,0.5)'
              }}>
                <ArrowUp size={22} strokeWidth={2.8} color="#000"/>
              </button>

              {/* Down - وردي ملون */}
              <button onClick={() => rotateCam('down')} style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background:'#ff6b8b', border:'2px solid #000', borderRadius:12,
                display:'grid', placeItems:'center', cursor:'pointer', boxShadow:'0 2px 0 #000, 0 4px 12px rgba(255,107,139,0.5)'
              }}>
                <ArrowDown size={22} strokeWidth={2.8} color="#000"/>
              </button>

              {/* Zoom+ مع دائرة و Z - بنفسجي */}
              <button onClick={() => zoomCam(1)} style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background:'#9b8cff', border:'2px solid #000', borderRadius:12,
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow:'0 2px 0 #000, 0 4px 12px rgba(155,140,255,0.4)', position:'relative'
              }}>
                <div style={{width:26, height:26, borderRadius:'50%', border:'2px solid #000', display:'grid', placeItems:'center', background:'#fff'}}>
                  <span style={{fontSize:16, fontWeight:900, color:'#000', lineHeight:1}}>+</span>
                </div>
                <span style={{position:'absolute', bottom:4, right:6, fontSize:8, fontWeight:900, color:'#000'}}>Z</span>
              </button>

              {/* Zoom- - بنفسجي */}
              <button onClick={() => zoomCam(-1)} style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background:'#9b8cff', border:'2px solid #000', borderRadius:12,
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow:'0 2px 0 #000, 0 4px 12px rgba(155,140,255,0.4)', position:'relative'
              }}>
                <div style={{width:26, height:26, borderRadius:'50%', border:'2px solid #000', display:'grid', placeItems:'center', background:'#fff'}}>
                  <span style={{fontSize:16, fontWeight:900, color:'#000', lineHeight:1}}>−</span>
                </div>
                <span style={{position:'absolute', bottom:4, right:6, fontSize:8, fontWeight:900, color:'#000'}}>Z</span>
              </button>

              {/* Bot - Bottom - أزرق */}
              <button onClick={() => applyPreset('bottom')} style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background: currentPreset==='bottom' ? '#00e5ff' : '#1e90ff',
                border: '2px solid #000',
                borderRadius:12, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow: currentPreset==='bottom' ? '0 0 14px rgba(0,229,255,0.7), 0 2px 0 #000' : '0 2px 0 #000'
              }}>
                <span style={{fontSize:12, fontWeight:900, color:'#000'}}>Bot</span>
              </button>

              {/* Enm - Enemy / TopPlayer - أحمر فاتح */}
              <button onClick={() => applyPreset('topPlayer')} style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background: currentPreset==='topPlayer' ? '#00e5ff' : '#ff7a7a',
                border: '2px solid #000',
                borderRadius:12, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow: currentPreset==='topPlayer' ? '0 0 14px rgba(0,229,255,0.7), 0 2px 0 #000' : '0 2px 0 #000'
              }}>
                <span style={{fontSize:12, fontWeight:900, color:'#000'}}>Enm</span>
              </button>

              {/* Top - برتقالي فاتح */}
              <button onClick={() => applyPreset('top')} style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background: currentPreset==='top' ? '#00e5ff' : '#ffb86b',
                border: '2px solid #000',
                borderRadius:12, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow: currentPreset==='top' ? '0 0 14px rgba(0,229,255,0.7), 0 2px 0 #000' : '0 2px 0 #000'
              }}>
                <span style={{fontSize:12, fontWeight:900, color:'#000'}}>Top</span>
              </button>

              {/* Bot ثاني - مثل الرسمة - أزرق فاتح */}
              <button onClick={() => applyPreset('bottom')} style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background:'#1e90ff', border:'2px solid #000', borderRadius:12,
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow:'0 2px 0 #000'
              }}>
                <span style={{fontSize:12, fontWeight:900, color:'#fff'}}>Bot</span>
              </button>

              {/* Iso - أخضر مصفر */}
              <button onClick={() => applyPreset('iso')} style={{
                width:64, height:52, minHeight:52, flexShrink:0,
                background: currentPreset==='iso' ? '#00e5ff' : '#a8e6a0',
                border: '2px solid #000',
                borderRadius:12, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow: currentPreset==='iso' ? '0 0 14px rgba(0,229,255,0.7), 0 2px 0 #000' : '0 2px 0 #000'
              }}>
                <span style={{fontSize:12, fontWeight:900, color:'#000'}}>Iso</span>
              </button>

              {/* إضافي: Left / Right للـ 4 لاعبين - ملون */}
              <button onClick={() => applyPreset('sideLeft')} style={{
                width:64, height:48, minHeight:48, flexShrink:0,
                background: currentPreset==='sideLeft' ? '#00e5ff' : '#ffd166',
                border: '2px solid #000',
                borderRadius:12, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow: currentPreset==='sideLeft' ? '0 0 12px rgba(0,229,255,0.6), 0 2px 0 #000' : '0 2px 0 #000'
              }}>
                <span style={{fontSize:10, fontWeight:900, color:'#000'}}>LEFT</span>
              </button>

              <button onClick={() => applyPreset('sideRight')} style={{
                width:64, height:48, minHeight:48, flexShrink:0,
                background: currentPreset==='sideRight' ? '#00e5ff' : '#ffd166',
                border: '2px solid #000',
                borderRadius:12, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow: currentPreset==='sideRight' ? '0 0 12px rgba(0,229,255,0.6), 0 2px 0 #000' : '0 2px 0 #000'
              }}>
                <span style={{fontSize:10, fontWeight:900, color:'#000'}}>RIGHT</span>
              </button>

              {/* Reset */}
              <button onClick={resetCamera} style={{
                width:64, height:40, minHeight:40, flexShrink:0,
                background:'#ff4081', border:'none', borderRadius:10,
                display:'flex', alignItems:'center', justifyContent:'center',
                cursor:'pointer', boxShadow:'0 2px 0 #000', marginTop:4
              }}>
                <span style={{fontSize:10, fontWeight:900, color:'#fff'}}>RESET</span>
              </button>

              {/* Hide UI */}
              <button onClick={() => { setHideUI(true); setShowCamMenu(false); }} style={{
                width:64, height:36, minHeight:36, flexShrink:0,
                background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10,
                display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', gap:3
              }}>
                <EyeOff size={10} color="rgba(255,255,255,0.5)"/>
                <span style={{fontSize:8, color:'rgba(255,255,255,0.5)'}}>HIDE</span>
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
