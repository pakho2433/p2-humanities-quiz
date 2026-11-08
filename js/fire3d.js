/**
 * 救火挑戰 · Three.js FPS corridor
 * Organic flame sheets + smoke/embers/steam; correct → spray → extinguish → walk.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const ZONE_COUNT = 5;
const ZONE_SPACING = 4.6;
const FIRST_FIRE_Z = -3.8;
const VIEW_DIST = 4.0;

const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
const LOW = isTouch || (navigator.hardwareConcurrency || 8) <= 4;

let renderer, scene, camera, clock, pmrem;
let root, hoseGroup;
let zones = [];
let zoneIndex = 0;
let sprayPts, sprayData, waterTex, smokeTex, steamTex, emberTex;
let hoseKick = 0;
let sprayT = 0, flareT = 0;
let walking = false, walkFrom = 0, walkTo = 0, walkT = 0, walkDur = 1.15;
let busy = false;
let animating = false;
let hostEl = null;
let resizeObs = null;
let steamPts = null, steamData = null;
let jetMesh = null;
let flameMats = [];

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = LOW ? 2 : 8;
  t.needsUpdate = true;
  return t;
}

function softDot(stops) {
  return canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    stops.forEach(([p, c]) => grd.addColorStop(p, c));
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }, false);
}

/** Organic flame sprite sheet (4 frames) — irregular edges, not a triangle */
let _flameSheet = null;
function flameSheetTex() {
  if (_flameSheet) return _flameSheet;
  const FW = 128, FH = 192, frames = 4;
  const c = document.createElement('canvas');
  c.width = FW * frames; c.height = FH;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  for (let f = 0; f < frames; f++) {
    const ox = f * FW;
    // layered soft blobs rising into tongues
    for (let layer = 0; layer < 18; layer++) {
      const t = layer / 17;
      const cy = FH - 18 - t * (FH - 40) + Math.sin(f * 1.7 + layer) * 6;
      const cx = FW * 0.5 + Math.sin(f * 2.1 + layer * 0.9) * (8 + t * 18);
      const rx = (22 - t * 16) * (0.7 + 0.5 * Math.abs(Math.sin(f + layer * 0.6)));
      const ry = (28 - t * 10) * (0.8 + 0.4 * Math.abs(Math.cos(f * 0.8 + layer)));
      const grd = g.createRadialGradient(ox + cx, cy, 0, ox + cx, cy, Math.max(rx, ry));
      if (t < 0.25) {
        grd.addColorStop(0, 'rgba(255,250,220,0.95)');
        grd.addColorStop(0.45, 'rgba(255,200,60,0.7)');
        grd.addColorStop(1, 'rgba(255,120,0,0)');
      } else if (t < 0.55) {
        grd.addColorStop(0, 'rgba(255,180,40,0.85)');
        grd.addColorStop(0.5, 'rgba(255,90,10,0.55)');
        grd.addColorStop(1, 'rgba(180,20,0,0)');
      } else {
        grd.addColorStop(0, 'rgba(255,90,20,0.7)');
        grd.addColorStop(0.45, 'rgba(200,30,0,0.4)');
        grd.addColorStop(1, 'rgba(40,0,0,0)');
      }
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(ox + cx, cy, rx, ry, Math.sin(f + layer) * 0.4, 0, Math.PI * 2);
      g.fill();
    }
    // base ember pool
    const base = g.createRadialGradient(ox + FW / 2, FH - 10, 2, ox + FW / 2, FH - 10, 40);
    base.addColorStop(0, 'rgba(255,220,120,0.9)');
    base.addColorStop(0.4, 'rgba(255,100,20,0.5)');
    base.addColorStop(1, 'rgba(80,0,0,0)');
    g.fillStyle = base;
    g.beginPath();
    g.ellipse(ox + FW / 2, FH - 8, 38, 16, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  _flameSheet = t;
  return t;
}

function woodMaps() {
  const albedo = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#6e4a2e';
    g.fillRect(0, 0, w, h);
    const plank = 64;
    for (let y = 0; y < h; y += plank) {
      const shade = 0.78 + Math.random() * 0.28;
      const r = Math.floor(138 * shade), gg = Math.floor(92 * shade), b = Math.floor(52 * shade);
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(0, y, w, plank - 3);
      g.fillStyle = 'rgba(28,14,6,0.6)';
      g.fillRect(0, y + plank - 3, w, 3);
      if (Math.random() > 0.5) {
        const kx = 40 + Math.random() * (w - 80);
        const ky = y + 12 + Math.random() * (plank - 24);
        const kg = g.createRadialGradient(kx, ky, 1, kx, ky, 16);
        kg.addColorStop(0, 'rgba(70,38,14,0.65)');
        kg.addColorStop(1, 'rgba(70,38,14,0)');
        g.fillStyle = kg;
        g.beginPath(); g.ellipse(kx, ky, 18, 10, Math.random(), 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(45,24,10,0.22)';
      g.lineWidth = 1.3;
      for (let i = 0; i < 16; i++) {
        g.beginPath();
        const yy = y + 4 + Math.random() * (plank - 8);
        g.moveTo(0, yy);
        for (let x = 0; x <= w; x += 20) g.lineTo(x, yy + Math.sin(x * 0.04 + i + y) * 2.4);
        g.stroke();
      }
    }
  });
  const normal = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#8080ff';
    g.fillRect(0, 0, w, h);
    const plank = 32;
    for (let y = 0; y < h; y += plank) {
      g.fillStyle = '#5a5ae0';
      g.fillRect(0, y + plank - 2, w, 2);
      g.fillStyle = '#9a9aff';
      g.fillRect(0, y, w, 1);
    }
  }, false);
  const rough = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#a8a8a8';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2800; i++) {
      const v = 120 + Math.random() * 100;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, false);
  [albedo, normal, rough].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 14);
  });
  return { albedo, normal, rough };
}

function wallMaps() {
  const albedo = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#efe4d0';
    g.fillRect(0, 0, w, h * 0.62);
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = `rgba(160,130,95,${Math.random() * 0.07})`;
      g.fillRect(Math.random() * w, Math.random() * h * 0.62, 3, 3);
    }
    // soot near floor hint
    const soot = g.createLinearGradient(0, h * 0.5, 0, h * 0.62);
    soot.addColorStop(0, 'rgba(40,20,10,0)');
    soot.addColorStop(1, 'rgba(40,20,10,0.12)');
    g.fillStyle = soot;
    g.fillRect(0, h * 0.5, w, h * 0.12);
    g.fillStyle = '#5d4037';
    g.fillRect(0, h * 0.60, w, h * 0.04);
    g.fillStyle = '#8d6e63';
    g.fillRect(0, h * 0.60, w, 3);
    g.fillStyle = '#ebe0c8';
    g.fillRect(0, h * 0.64, w, h * 0.36);
    g.strokeStyle = 'rgba(60,35,20,0.42)';
    g.lineWidth = 3;
    for (let p = 0; p < 2; p++) {
      const x = 16 + p * (w / 2);
      g.strokeRect(x, h * 0.68, w / 2 - 32, h * 0.26);
      g.strokeRect(x + 8, h * 0.70, w / 2 - 48, h * 0.22);
    }
  });
  const normal = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8888ff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#7070ee';
    g.fillRect(0, h * 0.60, w, h * 0.04);
  }, false);
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  albedo.repeat.set(4, 1);
  normal.repeat.set(4, 1);
  return { albedo, normal };
}

function ceilingMap() {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e8deca';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.045)';
    for (let x = 0; x < w; x += 64) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 10);
  return t;
}

function exitSignTex() {
  return canvasTex(320, 110, (g, w, h) => {
    g.fillStyle = '#1b5e20';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#00e676';
    g.fillRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#1b5e20';
    g.fillRect(12, 12, w - 24, h - 24);
    g.fillStyle = '#e8f5e9';
    g.font = 'bold 48px "PingFang TC","Noto Sans TC",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('出口 →', w / 2, h / 2 + 2);
  });
}

function pictureTex() {
  return canvasTex(320, 220, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.55);
    sky.addColorStop(0, '#42a5f5');
    sky.addColorStop(1, '#bbdefb');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffeb3b';
    g.beginPath(); g.arc(w * 0.78, h * 0.2, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#66bb6a';
    g.beginPath();
    g.moveTo(0, h * 0.58);
    g.quadraticCurveTo(w * 0.25, h * 0.32, w * 0.5, h * 0.55);
    g.quadraticCurveTo(w * 0.72, h * 0.38, w, h * 0.52);
    g.lineTo(w, h); g.lineTo(0, h); g.fill();
  });
}

function rubberHoseTex() {
  return canvasTex(128, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#6a0a0a');
    grd.addColorStop(0.3, '#d32f2f');
    grd.addColorStop(0.5, '#ff5252');
    grd.addColorStop(0.7, '#b71c1c');
    grd.addColorStop(1, '#4a0505');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    for (let y = 0; y < h; y += 9) g.fillRect(0, y, w, 3);
  });
}

function metalTex() {
  return canvasTex(128, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#fafafa');
    grd.addColorStop(0.35, '#90a4ae');
    grd.addColorStop(0.65, '#eceff1');
    grd.addColorStop(1, '#546e7a');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillRect(w * 0.22, 0, 7, h);
  });
}

function leatherTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f9a825';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 180 + Math.random() * 60;
      g.fillStyle = `rgba(${v},${Math.floor(v * 0.7)},20,0.25)`;
      g.fillRect(Math.random() * w, Math.random() * h, 3, 2);
    }
    g.strokeStyle = 'rgba(120,70,0,0.2)';
    for (let y = 0; y < h; y += 8) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + 2); g.stroke();
    }
  });
}

function std(color, rough = 0.6, metal = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}

function zoneZ(i) { return FIRST_FIRE_Z - i * ZONE_SPACING; }
function camZForZone(i) { return zoneZ(i) + VIEW_DIST; }

/** Animated organic flame (sprite-sheet + noise dissolve) */
function createFlameMaterial(seed = 0, mode = 'volume') {
  const sheet = flameSheetTex();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uIntensity: { value: 1 },
      uFlicker: { value: 1 },
      uMap: { value: sheet },
      uMode: { value: mode === 'core' ? 1.0 : (mode === 'tongue' ? 2.0 : 0.0) }
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision mediump float;
      varying vec2 vUv;
      uniform float uTime;
      uniform float uSeed;
      uniform float uIntensity;
      uniform float uFlicker;
      uniform sampler2D uMap;
      uniform float uMode;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i=floor(p); vec2 f=fract(p);
        float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
        vec2 u=f*f*(3.-2.*f);
        return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;
      }
      float fbm(vec2 p){
        float v=0.; float a=.5;
        for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.05; a*=.5; }
        return v;
      }

      void main() {
        // 4-frame sheet along X
        float frame = floor(mod(uTime * 10.0 + uSeed * 3.0, 4.0));
        vec2 uv = vec2((vUv.x + frame) * 0.25, vUv.y);

        // organic warp so edges shimmer
        float t = uTime * 1.8 + uSeed;
        float n = fbm(vec2(vUv.x * 3.5 + uSeed, vUv.y * 2.8 - t));
        float n2 = fbm(vec2(vUv.x * 6.0, vUv.y * 4.0 - t * 1.3) + 2.0);
        uv.x += (n - 0.5) * 0.04;
        uv.y += (n2 - 0.5) * 0.03;

        vec4 tex = texture2D(uMap, uv);
        float a = tex.a * tex.a; // tighten
        // noise dissolve for lively tongues
        a *= smoothstep(0.15, 0.65, n * 0.65 + n2 * 0.5 + (1.0 - vUv.y) * 0.25);
        a *= uIntensity * uFlicker;
        if (uMode > 0.5 && uMode < 1.5) a *= 1.25;
        if (uMode > 1.5) a *= 0.85;

        vec3 col = tex.rgb;
        // push mid tones toward hotter orange
        col = mix(col, vec3(1.0, 0.45, 0.05), 0.25 * (1.0 - vUv.y));
        col *= 1.0 + 0.45 * uFlicker;

        if (a < 0.02) discard;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }
    `
  });
  flameMats.push(mat);
  return mat;
}

function attachInvModel(mesh) {
  // kept for API compatibility; sheet flames don't need inv model
  mesh.onBeforeRender = function () {};
}


function buildCorridor() {
  root = new THREE.Group();
  scene.add(root);

  const wood = woodMaps();
  const floorMat = new THREE.MeshStandardMaterial({
    map: wood.albedo,
    normalMap: wood.normal,
    roughnessMap: wood.rough,
    roughness: 0.7,
    metalness: 0.05,
    normalScale: new THREE.Vector2(0.85, 0.85)
  });
  const corridorLen = ZONE_COUNT * ZONE_SPACING + 12;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.5, corridorLen), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -corridorLen / 2 + 1.8);
  floor.receiveShadow = true;
  root.add(floor);

  const walls = wallMaps();
  const wallMat = new THREE.MeshStandardMaterial({
    map: walls.albedo,
    normalMap: walls.normal,
    roughness: 0.9,
    metalness: 0,
    normalScale: new THREE.Vector2(0.5, 0.5)
  });
  const wallH = 3.35;
  const left = new THREE.Mesh(new THREE.PlaneGeometry(corridorLen, wallH), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-2.25, wallH / 2, -corridorLen / 2 + 1.8);
  left.receiveShadow = true;
  root.add(left);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(corridorLen, wallH), wallMat.clone());
  right.rotation.y = -Math.PI / 2;
  right.position.set(2.25, wallH / 2, -corridorLen / 2 + 1.8);
  right.receiveShadow = true;
  root.add(right);

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, corridorLen),
    new THREE.MeshStandardMaterial({ map: ceilingMap(), roughness: 0.94, metalness: 0 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, wallH, -corridorLen / 2 + 1.8);
  root.add(ceil);

  for (let i = 0; i < ZONE_COUNT + 3; i++) {
    const z = 0.8 - i * (ZONE_SPACING * 0.85);
    const fixture = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.07, 0.72),
      std(0xfafafa, 0.32, 0.18, { emissive: 0xfff3e0, emissiveIntensity: 1.6 })
    );
    fixture.position.set(0, wallH - 0.04, z);
    root.add(fixture);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.035, 0.8), std(0x37474f, 0.45, 0.45));
    rim.position.set(0, wallH - 0.01, z);
    root.add(rim);
    const pl = new THREE.PointLight(0xfff1dc, LOW ? 2.2 : 3.4, 9, 1.6);
    pl.position.set(0, wallH - 0.28, z);
    root.add(pl);
  }

  const endZ = zoneZ(ZONE_COUNT - 1) - 4.8;
  const endWall = new THREE.Mesh(new THREE.PlaneGeometry(4.5, wallH), std(0xe8dcc0, 0.9, 0));
  endWall.position.set(0, wallH / 2, endZ);
  root.add(endWall);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.1), std(0x5d4037, 0.62, 0.05));
  door.position.set(0, 1.15, endZ + 0.06);
  door.castShadow = true;
  root.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 16), std(0xd4af37, 0.25, 0.92));
  knob.position.set(0.5, 1.05, endZ + 0.13);
  root.add(knob);
  const exit = new THREE.Mesh(
    new THREE.PlaneGeometry(1.75, 0.6),
    new THREE.MeshStandardMaterial({
      map: exitSignTex(), emissive: 0x2e7d32, emissiveIntensity: 1.35, roughness: 0.38, metalness: 0.1
    })
  );
  exit.position.set(0, 2.75, endZ + 0.08);
  root.add(exit);
  const exitPl = new THREE.PointLight(0x81c784, 4, 9, 1.4);
  exitPl.position.set(0, 2.65, endZ + 0.7);
  root.add(exitPl);

  for (let i = 0; i < ZONE_COUNT; i++) {
    const z = zoneZ(i) + 1.7;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.72, 0.05), std(0x4e342e, 0.52, 0.05));
    frame.position.set(-2.2, 2.05, z);
    frame.rotation.y = Math.PI / 2;
    root.add(frame);
    const pic = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, 0.6),
      new THREE.MeshStandardMaterial({ map: pictureTex(), roughness: 0.42 })
    );
    pic.position.set(-2.17, 2.05, z);
    pic.rotation.y = Math.PI / 2;
    root.add(pic);

    const ext = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.105, 0.58, 16), std(0xc62828, 0.38, 0.25));
    tank.castShadow = true;
    ext.add(tank);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.052, 0.09, 12), std(0x263238, 0.32, 0.75));
    cap.position.y = 0.34;
    ext.add(cap);
    const hoseBit = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.22, 8), std(0x212121, 0.48, 0.3));
    hoseBit.rotation.z = 0.85;
    hoseBit.position.set(0.11, 0.3, 0);
    ext.add(hoseBit);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.08), std(0xfffde7, 0.6, 0));
    label.position.set(0, 0.05, 0.106);
    ext.add(label);
    ext.position.set(2.08, 0.42, z - 0.85);
    root.add(ext);
  }

  const boardMat = std(0x4e342e, 0.62, 0.05);
  for (const x of [-2.22, 2.22]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, corridorLen), boardMat);
    b.position.set(x, 0.075, -corridorLen / 2 + 1.8);
    root.add(b);
  }
}

function buildZone(i) {
  const z = zoneZ(i);
  const group = new THREE.Group();
  group.position.set(0, 0, z);
  root.add(group);

  const flames = [];
  const sheetCount = LOW ? 7 : 11;
  for (let n = 0; n < sheetCount; n++) {
    const mode = n < 3 ? 'core' : (n % 4 === 0 ? 'tongue' : 'volume');
    const mat = createFlameMaterial(i * 19.7 + n * 5.3 + Math.random(), mode);
    const h = 1.35 + Math.random() * 1.1;
    const w = 0.75 + Math.random() * 0.95;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    // clustered pile, not evenly spaced grid
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * 1.15;
    plane.position.set(Math.cos(ang) * rad, h * 0.42 + Math.random() * 0.15, Math.sin(ang) * rad * 0.55);
    plane.rotation.y = Math.random() * Math.PI; // random facing for volume
    if (Math.random() > 0.5) plane.scale.x *= -1; // mirror variety
    plane.renderOrder = 4 + (mode === 'core' ? 1 : 0);
    plane.userData = {
      baseY: plane.position.y, baseS: 1, phase: Math.random() * 6.28,
      speed: 2.2 + Math.random() * 3.0, mat, vol: false, billboard: false
    };
    group.add(plane);
    flames.push(plane);
  }
  // soft ground bloom discs
  for (let n = 0; n < (LOW ? 2 : 3); n++) {
    const glowSpr = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({
        map: emberTex, color: 0xff6d00,
        transparent: true, opacity: 0.4, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      })
    );
    glowSpr.rotation.x = -Math.PI / 2;
    glowSpr.position.set((n - 1) * 0.7, 0.04, (Math.random() - 0.5) * 0.3);
    glowSpr.renderOrder = 2;
    glowSpr.userData = { baseY: 0.04, baseS: 1, phase: Math.random() * 6, speed: 2, mat: glowSpr.material, vol: false };
    group.add(glowSpr);
    flames.push(glowSpr);
  }
  // floor heat glow
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 2.0),
    new THREE.MeshBasicMaterial({
      color: 0xff7a18, transparent: true, opacity: 0.62,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.025;
  glow.name = 'glow';
  group.add(glow);

  // vertical heat bloom
  const bloom = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 2.4),
    new THREE.MeshBasicMaterial({
      color: 0xff3d00, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    })
  );
  bloom.position.set(0, 1.1, 0.2);
  bloom.name = 'bloom';
  group.add(bloom);

  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(1.45, 28),
    new THREE.MeshStandardMaterial({ color: 0x140804, roughness: 0.96, metalness: 0, transparent: true, opacity: 0.62 })
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.012;
  group.add(scorch);

  // debris / charred wood bits
  for (let d = 0; d < 5; d++) {
    const bit = new THREE.Mesh(
      new THREE.BoxGeometry(0.18 + Math.random() * 0.2, 0.05, 0.1 + Math.random() * 0.15),
      std(0x1a0c06, 0.95, 0)
    );
    bit.position.set((Math.random() - 0.5) * 2.2, 0.03, (Math.random() - 0.5) * 0.8);
    bit.rotation.y = Math.random() * 2;
    group.add(bit);
  }

  const light = new THREE.PointLight(0xff6a1a, 26, 12, 1.05);
  light.position.set(0, 1.35, 0);
  if (!LOW && i === 0) {
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -0.012;
  }
  group.add(light);

  const flare = new THREE.PointLight(0xff1744, 0, 13, 1.05);
  flare.position.set(0, 1.55, 0);
  group.add(flare);

  // smoke
  const sn = LOW ? 28 : 70;
  const spos = new Float32Array(sn * 3);
  const svel = [];
  for (let k = 0; k < sn; k++) {
    spos[k * 3] = (Math.random() - 0.5) * 2.9;
    spos[k * 3 + 1] = Math.random() * 2.4;
    spos[k * 3 + 2] = (Math.random() - 0.5) * 1.2;
    svel.push({
      vx: (Math.random() - 0.5) * 0.18,
      vy: 0.55 + Math.random() * 0.7,
      vz: (Math.random() - 0.5) * 0.12,
      life: Math.random()
    });
  }
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
  const smoke = new THREE.Points(sgeo, new THREE.PointsMaterial({
    map: smokeTex, size: LOW ? 1.1 : 1.45, transparent: true, depthWrite: false,
    opacity: 0.78, sizeAttenuation: true
  }));
  smoke.position.y = 0.35;
  group.add(smoke);

  // embers
  const en = LOW ? 20 : 48;
  const epos = new Float32Array(en * 3);
  const evel = [];
  for (let k = 0; k < en; k++) {
    epos[k * 3] = (Math.random() - 0.5) * 2.4;
    epos[k * 3 + 1] = 0.3 + Math.random() * 1.8;
    epos[k * 3 + 2] = (Math.random() - 0.5) * 0.9;
    evel.push({
      vx: (Math.random() - 0.5) * 0.35,
      vy: 0.85 + Math.random() * 1.4,
      vz: (Math.random() - 0.5) * 0.28
    });
  }
  const egeo = new THREE.BufferGeometry();
  egeo.setAttribute('position', new THREE.BufferAttribute(epos, 3));
  const embers = new THREE.Points(egeo, new THREE.PointsMaterial({
    map: emberTex, size: 0.16, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 1.0, sizeAttenuation: true
  }));
  group.add(embers);

  const zone = {
    i, z, group, flames, glow, bloom, light, flare, smoke, embers,
    spos, svel, sn, epos, evel, en, alive: true, extinguishT: 0
  };
  zones.push(zone);
  return zone;
}

function buildHose() {
  hoseGroup = new THREE.Group();
  camera.add(hoseGroup);
  hoseGroup.position.set(0.28, -0.42, -0.52);
  hoseGroup.rotation.set(-0.32, -0.22, 0.08);
  hoseGroup.scale.setScalar(1.35);

  const hoseMap = rubberHoseTex();
  const hoseMat = new THREE.MeshStandardMaterial({
    map: hoseMap, roughness: 0.38, metalness: 0.1, color: 0xffffff
  });

  // curved-looking hose body (segmented taper)
  for (let s = 0; s < 5; s++) {
    const r0 = 0.078 - s * 0.004;
    const r1 = 0.074 - s * 0.004;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 0.16, 20), hoseMat);
    seg.rotation.x = Math.PI / 2;
    seg.position.set(0, 0.02 + s * 0.004, 0.55 - s * 0.15);
    seg.castShadow = true;
    hoseGroup.add(seg);
  }
  for (let i = 0; i < 11; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.082 - i * 0.0015, 0.011, 8, 22), std(0x8b0000, 0.38, 0.22));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.025, 0.52 - i * 0.065);
    hoseGroup.add(ring);
  }

  const metalMap = metalTex();
  const chrome = new THREE.MeshStandardMaterial({
    map: metalMap, roughness: 0.18, metalness: 0.92, envMapIntensity: 2.2, color: 0xf2f6fa
  });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xffc107, roughness: 0.28, metalness: 0.88, envMapIntensity: 1.8, emissive: 0x3a2800, emissiveIntensity: 0.25
  });

  // coupling collar
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.095, 0.08, 24), chrome);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 0.03, -0.08);
  hoseGroup.add(collar);
  const collarRing = new THREE.Mesh(new THREE.TorusGeometry(0.096, 0.01, 8, 24), brass);
  collarRing.rotation.x = Math.PI / 2;
  collarRing.position.set(0, 0.03, -0.05);
  hoseGroup.add(collarRing);

  // main nozzle body (tapered)
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.082, 0.32, 28), chrome);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.03, -0.28);
  nozzle.castShadow = true;
  hoseGroup.add(nozzle);

  // grip knurl rings
  for (let i = 0; i < 4; i++) {
    const knurl = new THREE.Mesh(new THREE.TorusGeometry(0.07 - i * 0.004, 0.008, 6, 20), std(0xb0bec5, 0.28, 0.9));
    knurl.rotation.x = Math.PI / 2;
    knurl.position.set(0, 0.03, -0.18 - i * 0.04);
    hoseGroup.add(knurl);
  }

  // shutoff lever
  const leverPivot = new THREE.Group();
  leverPivot.position.set(0.07, 0.08, -0.22);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.14), brass);
  lever.position.set(0, 0, -0.04);
  leverPivot.add(lever);
  const leverKnob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 10), brass);
  leverKnob.position.set(0, 0, -0.12);
  leverPivot.add(leverKnob);
  hoseGroup.add(leverPivot);

  // tip / orifice
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.036, 0.1, 22), brass);
  tip.rotation.x = Math.PI / 2;
  tip.position.set(0, 0.03, -0.48);
  hoseGroup.add(tip);
  const tipLip = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 8, 20), chrome);
  tipLip.rotation.x = Math.PI / 2;
  tipLip.position.set(0, 0.03, -0.53);
  hoseGroup.add(tipLip);

  const hole = new THREE.Mesh(
    new THREE.CircleGeometry(0.012, 18),
    new THREE.MeshBasicMaterial({ color: 0x010101 })
  );
  hole.position.set(0, 0.03, -0.535);
  hoseGroup.add(hole);

  // water jet stream
  jetMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.055, 1.7, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xb3e5fc, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    })
  );
  jetMesh.rotation.x = Math.PI / 2;
  jetMesh.position.set(0, 0.06, -1.35);
  jetMesh.visible = false;
  hoseGroup.add(jetMesh);

  const leather = leatherTex();
  function glove(side) {
    const g = new THREE.Group();
    const palmMat = new THREE.MeshStandardMaterial({ map: leather, color: 0xffb300, roughness: 0.5, metalness: 0.04 });
    const fingerMat = new THREE.MeshStandardMaterial({ map: leather, color: 0xffc107, roughness: 0.48, metalness: 0.04 });
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.075, 0.26), palmMat);
    palm.castShadow = true;
    g.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.15, 12), fingerMat);
      f.rotation.x = Math.PI / 2.35;
      f.position.set(-0.075 + i * 0.048, 0.025, -0.18);
      g.add(f);
      const tipF = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), fingerMat);
      tipF.position.set(-0.075 + i * 0.048, 0.04, -0.26);
      g.add(tipF);
    }
    const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.12, 12), fingerMat);
    thumb.rotation.z = side * Math.PI / 2.1;
    thumb.rotation.x = 0.45;
    thumb.position.set(side * 0.13, 0.02, -0.02);
    g.add(thumb);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.12, 16), std(0x1565c0, 0.38, 0.12));
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0, 0.19);
    g.add(cuff);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.014, 8, 18), std(0x0d47a1, 0.32, 0.2));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 0, 0.13);
    g.add(rim);
    g.position.set(side * 0.22, -0.015, 0.4);
    g.rotation.set(0.38, side * 0.22, side * 0.12);
    return g;
  }
  hoseGroup.add(glove(-1));
  hoseGroup.add(glove(1));
}

function buildSpray() {
  waterTex = softDot([
    [0, 'rgba(230,250,255,1)'],
    [0.25, 'rgba(140,220,255,0.9)'],
    [1, 'rgba(40,150,255,0)']
  ]);
  const n = LOW ? 160 : 280;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sprayPts = new THREE.Points(geo, new THREE.PointsMaterial({
    map: waterTex, size: 0.15, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0.95, sizeAttenuation: true
  }));
  sprayPts.visible = false;
  camera.add(sprayPts);
  sprayPts.position.set(0.18, -0.42, -0.9);
  sprayData = { pos, vel: Array.from({ length: n }, () => new THREE.Vector3()), n, alive: false };

  steamTex = softDot([
    [0, 'rgba(235,245,255,0.75)'],
    [0.4, 'rgba(180,200,220,0.32)'],
    [1, 'rgba(150,160,180,0)']
  ]);
  const sn = LOW ? 60 : 100;
  const spos = new Float32Array(sn * 3);
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
  steamPts = new THREE.Points(sgeo, new THREE.PointsMaterial({
    map: steamTex, size: 0.32, transparent: true, depthWrite: false, opacity: 0, sizeAttenuation: true
  }));
  steamPts.visible = false;
  root.add(steamPts);
  steamData = { pos: spos, vel: Array.from({ length: sn }, () => new THREE.Vector3()), n: sn, t: 0 };
}

function startSprayParticles() {
  sprayT = 0.95;
  hoseKick = 0.14;
  sprayPts.visible = true;
  sprayData.alive = true;
  const { pos, vel, n } = sprayData;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 0.05;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 0.04;
    pos[i * 3 + 2] = 0;
    vel[i].set((Math.random() - 0.5) * 0.55, 0.55 + Math.random() * 0.85, -3.8 - Math.random() * 2.8);
  }
  sprayPts.geometry.attributes.position.needsUpdate = true;
  if (jetMesh) {
    jetMesh.visible = true;
    jetMesh.material.opacity = 0.62;
  }
}

function startSteam(zone) {
  steamPts.visible = true;
  steamPts.position.set(0, 0.45, zone.z);
  steamPts.material.opacity = 0.8;
  steamData.t = 1.25;
  const { pos, vel, n } = steamData;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 2.6;
    pos[i * 3 + 1] = Math.random() * 0.5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 1.3;
    vel[i].set((Math.random() - 0.5) * 0.35, 0.9 + Math.random() * 1.2, (Math.random() - 0.5) * 0.3);
  }
  steamPts.geometry.attributes.position.needsUpdate = true;
}

function extinguishZone(zone) {
  zone.alive = false;
  zone.extinguishT = 1.0;
  startSteam(zone);
  zone.flames.forEach((f) => { f.visible = false; });
  zone.glow.material.opacity = 0;
  if (zone.bloom) zone.bloom.material.opacity = 0;
  zone.light.intensity = 0;
  zone.smoke.visible = false;
  if (zone.embers) zone.embers.visible = false;
}

function remainingFires() {
  return zones.filter((z) => z.alive).length;
}

function applyCameraToZone(i) {
  const z = camZForZone(Math.min(i, ZONE_COUNT - 1));
  camera.position.set(0, 1.5, z);
  camera.lookAt(0, 1.15, zoneZ(Math.min(i, ZONE_COUNT - 1)));
  return z;
}

function beginWalk(toIndex) {
  walking = true;
  walkFrom = camera.position.z;
  walkTo = camZForZone(toIndex);
  walkT = 0;
  walkDur = 1.15;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function playCorrect() {
  if (!zones.length) return Promise.resolve({ remaining: 0, walked: false, won: false, error: 'no-zones' });
  if (busy) return Promise.resolve({ remaining: remainingFires(), walked: false, won: remainingFires() === 0 });
  busy = true;
  const zone = zones[zoneIndex];
  return new Promise((resolve) => {
    startSprayParticles();
    setTimeout(() => {
      if (zone && zone.alive) extinguishZone(zone);
    }, 400);

    const afterSpray = () => {
      const left = remainingFires();
      if (left === 0) {
        busy = false;
        if (scene.fog) { scene.fog.color.set(0x4fc3f7); scene.fog.density = 0.016; }
        resolve({ remaining: 0, walked: false, won: true });
        return;
      }
      const next = zoneIndex + 1;
      if (next < ZONE_COUNT) {
        zoneIndex = next;
        beginWalk(zoneIndex);
        const checkWalk = setInterval(() => {
          if (!walking) {
            clearInterval(checkWalk);
            busy = false;
            resolve({ remaining: remainingFires(), walked: true, won: false });
          }
        }, 40);
      } else {
        busy = false;
        resolve({ remaining: left, walked: false, won: left === 0 });
      }
    };
    setTimeout(afterSpray, 1000);
  });
}

export function playWrong() {
  const zone = zones[zoneIndex];
  if (!zone || !zone.alive) return;
  flareT = 0.55;
  hoseKick = -0.09;
  zone.flare.intensity = 24;
  zone.group.scale.setScalar(1.2);
}

export function getZoneIndex() { return zoneIndex; }
export function getRemaining() { return remainingFires(); }
export function isBusy() { return busy || walking; }

function tick(dt) {
  const t = clock.elapsedTime;

  flameMats.forEach((m) => {
    if (!m.uniforms) return;
    if (m.uniforms.uTime) m.uniforms.uTime.value = t;
    if (m.uniforms.uFlicker && m.uniforms.uSeed) {
      m.uniforms.uFlicker.value = 0.88 + Math.sin(t * 11.0 + m.uniforms.uSeed.value) * 0.12;
    }
  });

  if (hoseGroup) {
    hoseGroup.rotation.x = -0.32 + Math.sin(t * 1.7) * 0.018 + hoseKick;
    hoseGroup.rotation.z = 0.08 + Math.sin(t * 1.2) * 0.01;
    hoseGroup.position.y = -0.42 + Math.sin(t * 2.3) * 0.008;
    if (walking) {
      hoseGroup.rotation.x += Math.sin(t * 14) * 0.016;
      hoseGroup.position.y += Math.abs(Math.sin(walkT / walkDur * Math.PI)) * 0.025;
    }
  }
  hoseKick *= Math.max(0, 1 - dt * 8);

  zones.forEach((zone) => {
    if (!zone.alive) {
      if (zone.extinguishT > 0) {
        zone.extinguishT -= dt;
        zone.group.scale.setScalar(Math.max(0.01, zone.extinguishT / 1.0));
      }
      return;
    }
    zone.flames.forEach((ch) => {
      const u = ch.userData;
      const wob = Math.sin(t * u.speed + u.phase);
      ch.position.y = u.baseY + wob * 0.06;
      const sc = u.baseS * (1 + wob * 0.06);
      if (u.vol) ch.scale.set(sc * (1 + wob * 0.04), sc * (1 + wob * 0.1), sc * (1 - wob * 0.03));
      else ch.scale.set(sc * (1 + wob * 0.05), sc * (1.05 + wob * 0.08), 1);
      if (u.billboard && camera) ch.quaternion.copy(camera.quaternion);
      if (u.mat && u.mat.uniforms) {
        if (u.mat.uniforms.uIntensity) u.mat.uniforms.uIntensity.value = 0.9 + wob * 0.15;
        if (u.mat.uniforms.uTime) u.mat.uniforms.uTime.value = t;
      } else if (u.mat && u.mat.opacity != null) {
        u.mat.opacity = 0.35 + wob * 0.12;
      }
    });
    const pulse = 0.82 + Math.sin(t * 10 + zone.i) * 0.18;
    zone.light.intensity = 22 * pulse;
    zone.light.position.x = Math.sin(t * 3.2 + zone.i) * 0.25;
    zone.glow.material.opacity = 0.38 + pulse * 0.18;
    if (zone.bloom) zone.bloom.material.opacity = 0.12 + pulse * 0.1;

    const { spos, svel, sn } = zone;
    for (let i = 0; i < sn; i++) {
      spos[i * 3] += svel[i].vx * dt;
      spos[i * 3 + 1] += svel[i].vy * dt;
      spos[i * 3 + 2] += svel[i].vz * dt;
      if (spos[i * 3 + 1] > 2.8) {
        spos[i * 3] = (Math.random() - 0.5) * 2.9;
        spos[i * 3 + 1] = 0.15;
        spos[i * 3 + 2] = (Math.random() - 0.5) * 1.1;
      }
    }
    zone.smoke.geometry.attributes.position.needsUpdate = true;

    if (zone.embers) {
      const { epos, evel, en } = zone;
      for (let i = 0; i < en; i++) {
        epos[i * 3] += evel[i].vx * dt;
        epos[i * 3 + 1] += evel[i].vy * dt;
        epos[i * 3 + 2] += evel[i].vz * dt;
        if (epos[i * 3 + 1] > 2.6) {
          epos[i * 3] = (Math.random() - 0.5) * 2.4;
          epos[i * 3 + 1] = 0.2;
          epos[i * 3 + 2] = (Math.random() - 0.5) * 0.9;
        }
      }
      zone.embers.geometry.attributes.position.needsUpdate = true;
    }
  });

  if (flareT > 0) {
    flareT -= dt;
    const zone = zones[zoneIndex];
    if (zone && zone.alive) {
      zone.flare.intensity = Math.max(0, 24 * (flareT / 0.55));
      const pulse = 1 + Math.sin(t * 42) * 0.12;
      zone.group.scale.setScalar(1.08 * pulse);
      if (flareT <= 0) zone.group.scale.setScalar(1);
    }
  }

  if (sprayData && sprayData.alive) {
    sprayT -= dt;
    const { pos, vel, n } = sprayData;
    for (let i = 0; i < n; i++) {
      vel[i].y -= 5.5 * dt;
      pos[i * 3] += vel[i].x * dt;
      pos[i * 3 + 1] += vel[i].y * dt;
      pos[i * 3 + 2] += vel[i].z * dt;
    }
    sprayPts.geometry.attributes.position.needsUpdate = true;
    sprayPts.material.opacity = Math.max(0, sprayT / 0.95);
    if (jetMesh) jetMesh.material.opacity = Math.max(0, 0.62 * (sprayT / 0.95));
    if (sprayT <= 0) {
      sprayData.alive = false;
      sprayPts.visible = false;
      if (jetMesh) { jetMesh.visible = false; jetMesh.material.opacity = 0; }
    }
  }

  if (steamData && steamData.t > 0) {
    steamData.t -= dt;
    const { pos, vel, n } = steamData;
    for (let i = 0; i < n; i++) {
      pos[i * 3] += vel[i].x * dt;
      pos[i * 3 + 1] += vel[i].y * dt;
      pos[i * 3 + 2] += vel[i].z * dt;
    }
    steamPts.geometry.attributes.position.needsUpdate = true;
    steamPts.material.opacity = Math.max(0, steamData.t / 1.25 * 0.75);
    if (steamData.t <= 0) steamPts.visible = false;
  }

  if (walking) {
    walkT += dt;
    const u = Math.min(1, walkT / walkDur);
    const e = easeInOut(u);
    camera.position.z = walkFrom + (walkTo - walkFrom) * e;
    camera.position.y = 1.5 + Math.sin(e * Math.PI) * 0.05;
    camera.position.x = Math.sin(e * Math.PI * 2) * 0.035;
    camera.lookAt(0, 1.1 + (1 - e) * 0.12, zoneZ(zoneIndex));
    if (u >= 1) {
      walking = false;
      camera.position.set(0, 1.5, walkTo);
      camera.lookAt(0, 1.15, zoneZ(zoneIndex));
    }
  } else if (!busy) {
    camera.position.y = 1.5 + Math.sin(t * 1.8) * 0.014;
    camera.rotation.z = Math.sin(t * 1.15) * 0.004;
  }

  if (scene.fog && remainingFires() > 0) {
    scene.fog.density = 0.018 + remainingFires() * 0.0035;
  }
}

function loop() {
  if (!animating) return;
  const dt = Math.min(0.05, clock.getDelta());
  tick(dt);
  renderer.render(scene, camera);
}

function onResize() {
  if (!hostEl || !renderer || !camera) return;
  const w = hostEl.clientWidth || 1;
  const h = hostEl.clientHeight || 1;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

export function init(host) {
  dispose();
  hostEl = host;
  hostEl.innerHTML = '';
  clock = new THREE.Clock();
  zones = [];
  zoneIndex = 0;
  busy = false;
  walking = false;
  flameMats = [];

  renderer = new THREE.WebGLRenderer({ antialias: !LOW, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW ? 1.5 : 2));
  renderer.setSize(hostEl.clientWidth || 640, hostEl.clientHeight || 360, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = !LOW;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  hostEl.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a100c);
  scene.fog = new THREE.FogExp2(0x2a1810, 0.032);

  camera = new THREE.PerspectiveCamera(62, 1, 0.05, 80);
  scene.add(camera);

  pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;

  scene.add(new THREE.HemisphereLight(0xffe0c0, 0x2a1810, 0.45));
  const keyLight = new THREE.DirectionalLight(0xffe8d0, 0.85);
  keyLight.position.set(3.5, 8, 4);
  keyLight.castShadow = !LOW;
  if (!LOW) {
    keyLight.shadow.mapSize.set(1024, 1024);
    const c = keyLight.shadow.camera;
    c.near = 0.5; c.far = 45; c.left = -10; c.right = 10; c.top = 10; c.bottom = -10;
  }
  scene.add(keyLight);

  smokeTex = softDot([
    [0, 'rgba(40,40,40,0.85)'],
    [0.35, 'rgba(30,30,30,0.45)'],
    [1, 'rgba(15,15,15,0)']
  ]);
  emberTex = softDot([
    [0, 'rgba(255,220,120,1)'],
    [0.35, 'rgba(255,120,30,0.85)'],
    [1, 'rgba(180,20,0,0)']
  ]);

  buildCorridor();
  for (let i = 0; i < ZONE_COUNT; i++) buildZone(i);
  buildHose();
  buildSpray();

  applyCameraToZone(0);
  onResize();

  if (typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(onResize);
    resizeObs.observe(hostEl);
  } else {
    window.addEventListener('resize', onResize);
  }

  animating = true;
  renderer.setAnimationLoop(loop);
  return true;
}

export function setFireLevel() {}
export function spray() { startSprayParticles(); }
export function flare() { playWrong(); }
export function win() {
  zones.forEach((z) => { if (z.alive) extinguishZone(z); });
  if (scene.fog) { scene.fog.color.set(0x4fc3f7); scene.fog.density = 0.016; }
}
export function resetWin() {}

export function dispose() {
  animating = false;
  busy = false;
  walking = false;
  if (renderer) {
    renderer.setAnimationLoop(null);
    try { renderer.dispose(); } catch (_) {}
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }
  if (pmrem) { try { pmrem.dispose(); } catch (_) {} pmrem = null; }
  if (resizeObs) { try { resizeObs.disconnect(); } catch (_) {} resizeObs = null; }
  window.removeEventListener('resize', onResize);
  renderer = scene = camera = root = hoseGroup = null;
  zones = [];
  flameMats = [];
  sprayPts = sprayData = steamPts = steamData = jetMesh = null;
  hostEl = null;
}

export default {
  init, dispose, playCorrect, playWrong, getZoneIndex, getRemaining, isBusy,
  setFireLevel, spray, flare, win, resetWin, ZONE_COUNT
};
