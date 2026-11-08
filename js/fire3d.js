/**
 * 救火挑戰 · Three.js FPS corridor with fire ZONES
 * Correct → spray + extinguish current zone → walk to next zone
 * Wrong → flare, stay. Procedural PBR-ish materials + RoomEnvironment IBL.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const ZONE_COUNT = 5;
const ZONE_SPACING = 4.4;
const FIRST_FIRE_Z = -3.6;
const VIEW_DIST = 3.9; // camera sits this far behind a fire zone

const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
const LOW = isTouch || (navigator.hardwareConcurrency || 8) <= 4;

let renderer, scene, camera, clock, pmrem;
let root, hoseGroup;
let zones = [];
let zoneIndex = 0;
let sprayPts, sprayData, waterTex, flameTex, smokeTex, steamTex;
let hoseKick = 0;
let sprayT = 0, flareT = 0;
let walking = false, walkFrom = 0, walkTo = 0, walkT = 0, walkDur = 1.35;
let busy = false;
let animating = false;
let hostEl = null;
let resizeObs = null;
let hemi, keyLight;
let steamPts = null, steamData = null;
let jetMesh = null;

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

/** Procedural wood albedo + matching normal (approx) */
function woodMaps() {
  const albedo = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#7a5535';
    g.fillRect(0, 0, w, h);
    const plank = 64;
    for (let y = 0; y < h; y += plank) {
      const shade = 0.82 + Math.random() * 0.22;
      const r = Math.floor(145 * shade), gg = Math.floor(98 * shade), b = Math.floor(58 * shade);
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(0, y, w, plank - 3);
      // seam
      g.fillStyle = 'rgba(35,18,8,0.55)';
      g.fillRect(0, y + plank - 3, w, 3);
      // knots
      if (Math.random() > 0.55) {
        const kx = 40 + Math.random() * (w - 80);
        const ky = y + 12 + Math.random() * (plank - 24);
        const kg = g.createRadialGradient(kx, ky, 1, kx, ky, 14);
        kg.addColorStop(0, 'rgba(90,50,20,0.55)');
        kg.addColorStop(1, 'rgba(90,50,20,0)');
        g.fillStyle = kg;
        g.beginPath(); g.ellipse(kx, ky, 16, 9, Math.random(), 0, Math.PI * 2); g.fill();
      }
      // grain lines
      g.strokeStyle = 'rgba(55,30,12,0.18)';
      g.lineWidth = 1.2;
      for (let i = 0; i < 14; i++) {
        g.beginPath();
        const yy = y + 5 + Math.random() * (plank - 10);
        g.moveTo(0, yy);
        for (let x = 0; x <= w; x += 24) g.lineTo(x, yy + Math.sin(x * 0.035 + i + y) * 2.2);
        g.stroke();
      }
      // nail dots
      g.fillStyle = 'rgba(30,20,10,0.35)';
      for (let x = 30; x < w; x += 160) {
        g.beginPath(); g.arc(x, y + plank / 2, 1.5, 0, Math.PI * 2); g.fill();
      }
    }
  });
  const normal = canvasTex(512, 512, (g, w, h) => {
    // flat-ish blue normal with plank groove dips
    g.fillStyle = '#8080ff';
    g.fillRect(0, 0, w, h);
    const plank = 32;
    for (let y = 0; y < h; y += plank) {
      g.fillStyle = '#6060e8';
      g.fillRect(0, y + plank - 2, w, 2);
      g.fillStyle = '#9898ff';
      g.fillRect(0, y, w, 1);
    }
  }, false);
  const rough = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#b0b0b0';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2000; i++) {
      const v = 140 + Math.random() * 80;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, false);
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  albedo.repeat.set(3, 12);
  normal.repeat.set(3, 12);
  rough.repeat.set(3, 12);
  return { albedo, normal, rough };
}

function wallMaps() {
  const albedo = canvasTex(512, 512, (g, w, h) => {
    // plaster upper
    g.fillStyle = '#f0e4cf';
    g.fillRect(0, 0, w, h * 0.62);
    for (let i = 0; i < 1200; i++) {
      g.fillStyle = `rgba(170,140,100,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * w, Math.random() * h * 0.62, 3, 3);
    }
    // chair rail
    g.fillStyle = '#5d4037';
    g.fillRect(0, h * 0.60, w, h * 0.04);
    g.fillStyle = '#8d6e63';
    g.fillRect(0, h * 0.60, w, 3);
    // wainscot
    g.fillStyle = '#ebe0c8';
    g.fillRect(0, h * 0.64, w, h * 0.36);
    g.strokeStyle = 'rgba(60,35,20,0.4)';
    g.lineWidth = 3;
    const panels = 2;
    for (let p = 0; p < panels; p++) {
      const x = 16 + p * (w / panels);
      g.strokeRect(x, h * 0.68, w / panels - 32, h * 0.26);
      g.strokeRect(x + 8, h * 0.70, w / panels - 48, h * 0.22);
    }
  });
  const normal = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8888ff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#7070ee';
    g.fillRect(0, h * 0.60, w, h * 0.04);
    g.strokeStyle = '#6060e0';
    g.lineWidth = 2;
    g.strokeRect(20, h * 0.68, w / 2 - 40, h * 0.26);
    g.strokeRect(w / 2 + 20, h * 0.68, w / 2 - 40, h * 0.26);
  }, false);
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  albedo.repeat.set(4, 1);
  normal.repeat.set(4, 1);
  return { albedo, normal };
}

function ceilingMap() {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e6dcc8';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.04)';
    for (let x = 0; x < w; x += 64) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 8);
  return t;
}

function makeFlameTex() {
  return canvasTex(128, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const layers = [
      [0.5, 0.78, w * 0.48, ['rgba(255,255,230,1)', 'rgba(255,200,60,0.95)', 'rgba(255,90,10,0.7)', 'rgba(180,20,0,0)']],
      [0.42, 0.7, w * 0.36, ['rgba(255,255,200,0.9)', 'rgba(255,160,40,0.75)', 'rgba(220,40,0,0)']],
      [0.58, 0.72, w * 0.34, ['rgba(255,255,210,0.85)', 'rgba(255,140,30,0.7)', 'rgba(200,30,0,0)']]
    ];
    layers.forEach(([cx, cy, rad, cols]) => {
      const grd = g.createRadialGradient(w * cx, h * cy, 2, w * cx, h * 0.4, rad);
      cols.forEach((c, i) => grd.addColorStop(i / (cols.length - 1), c));
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(w * cx, h * 0.06);
      g.bezierCurveTo(w * (cx + 0.28), h * 0.3, w * (cx + 0.38), h * 0.55, w * (cx + 0.2), h * 0.9);
      g.bezierCurveTo(w * cx, h * 0.98, w * (cx - 0.2), h * 0.9, w * (cx - 0.2), h * 0.9);
      g.bezierCurveTo(w * (cx - 0.38), h * 0.55, w * (cx - 0.28), h * 0.3, w * cx, h * 0.06);
      g.fill();
    });
  }, false);
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
    g.fillStyle = '#43a047';
    g.beginPath();
    g.moveTo(0, h * 0.72);
    g.quadraticCurveTo(w * 0.4, h * 0.55, w, h * 0.7);
    g.lineTo(w, h); g.lineTo(0, h); g.fill();
  });
}

function rubberHoseTex() {
  return canvasTex(128, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#7f1010');
    grd.addColorStop(0.35, '#e53935');
    grd.addColorStop(0.5, '#ff6659');
    grd.addColorStop(0.65, '#c62828');
    grd.addColorStop(1, '#6d0b0b');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < h; y += 10) g.fillRect(0, y, w, 3);
  });
}

function metalTex() {
  return canvasTex(128, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#fafafa');
    grd.addColorStop(0.4, '#90a4ae');
    grd.addColorStop(0.7, '#eceff1');
    grd.addColorStop(1, '#607d8b');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(w * 0.2, 0, 8, h);
  });
}

function std(color, rough = 0.6, metal = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}

function zoneZ(i) {
  return FIRST_FIRE_Z - i * ZONE_SPACING;
}

function camZForZone(i) {
  return zoneZ(i) + VIEW_DIST;
}

function buildCorridor() {
  root = new THREE.Group();
  scene.add(root);

  const wood = woodMaps();
  const floorMat = new THREE.MeshStandardMaterial({
    map: wood.albedo,
    normalMap: wood.normal,
    roughnessMap: wood.rough,
    roughness: 0.72,
    metalness: 0.04,
    normalScale: new THREE.Vector2(0.7, 0.7)
  });
  const corridorLen = ZONE_COUNT * ZONE_SPACING + 10;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.4, corridorLen), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -corridorLen / 2 + 1.5);
  floor.receiveShadow = true;
  root.add(floor);

  const walls = wallMaps();
  const wallMat = new THREE.MeshStandardMaterial({
    map: walls.albedo,
    normalMap: walls.normal,
    roughness: 0.88,
    metalness: 0,
    normalScale: new THREE.Vector2(0.45, 0.45)
  });
  const wallH = 3.3;
  const left = new THREE.Mesh(new THREE.PlaneGeometry(corridorLen, wallH), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-2.2, wallH / 2, -corridorLen / 2 + 1.5);
  left.receiveShadow = true;
  root.add(left);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(corridorLen, wallH), wallMat.clone());
  right.rotation.y = -Math.PI / 2;
  right.position.set(2.2, wallH / 2, -corridorLen / 2 + 1.5);
  right.receiveShadow = true;
  root.add(right);

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, corridorLen),
    new THREE.MeshStandardMaterial({ map: ceilingMap(), roughness: 0.92, metalness: 0 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, wallH, -corridorLen / 2 + 1.5);
  root.add(ceil);

  // Ceiling fixtures + lights along corridor
  for (let i = 0; i < ZONE_COUNT + 3; i++) {
    const z = 0.5 - i * (ZONE_SPACING * 0.85);
    const fixture = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.08, 0.7),
      std(0xf5f5f5, 0.35, 0.15, { emissive: 0xfff8e7, emissiveIntensity: 1.4 })
    );
    fixture.position.set(0, wallH - 0.05, z);
    root.add(fixture);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.04, 0.78), std(0x455a64, 0.5, 0.4));
    rim.position.set(0, wallH - 0.02, z);
    root.add(rim);
    const pl = new THREE.PointLight(0xfff2dd, LOW ? 3.5 : 5.5, 9, 1.5);
    pl.position.set(0, wallH - 0.25, z);
    root.add(pl);
  }

  // End wall + door
  const endZ = zoneZ(ZONE_COUNT - 1) - 4.5;
  const endWall = new THREE.Mesh(new THREE.PlaneGeometry(4.4, wallH), std(0xe8dcc0, 0.9, 0));
  endWall.position.set(0, wallH / 2, endZ);
  root.add(endWall);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.25, 0.1), std(0x5d4037, 0.65, 0.05));
  door.position.set(0, 1.12, endZ + 0.06);
  door.castShadow = true;
  root.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 14), std(0xd4af37, 0.28, 0.9));
  knob.position.set(0.48, 1.05, endZ + 0.12);
  root.add(knob);
  const exit = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 0.58),
    new THREE.MeshStandardMaterial({
      map: exitSignTex(), emissive: 0x2e7d32, emissiveIntensity: 1.2, roughness: 0.4, metalness: 0.1
    })
  );
  exit.position.set(0, 2.7, endZ + 0.08);
  root.add(exit);
    const exitPl = new THREE.PointLight(0x81c784, 3.5, 8, 1.5);
  exitPl.position.set(0, 2.6, endZ + 0.6);
  root.add(exitPl);

  // Pictures + extinguisher props along walls
  for (let i = 0; i < ZONE_COUNT; i++) {
    const z = zoneZ(i) + 1.6;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.7, 0.05), std(0x4e342e, 0.55, 0.05));
    frame.position.set(-2.15, 2.0, z);
    frame.rotation.y = Math.PI / 2;
    root.add(frame);
    const pic = new THREE.Mesh(
      new THREE.PlaneGeometry(0.84, 0.58),
      new THREE.MeshStandardMaterial({ map: pictureTex(), roughness: 0.45 })
    );
    pic.position.set(-2.12, 2.0, z);
    pic.rotation.y = Math.PI / 2;
    root.add(pic);

    // red extinguisher on right wall
    const ext = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.55, 14), std(0xc62828, 0.4, 0.2));
    tank.castShadow = true;
    ext.add(tank);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.08, 10), std(0x37474f, 0.35, 0.7));
    cap.position.y = 0.32;
    ext.add(cap);
    const hoseBit = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), std(0x212121, 0.5, 0.3));
    hoseBit.rotation.z = 0.8;
    hoseBit.position.set(0.1, 0.28, 0);
    ext.add(hoseBit);
    ext.position.set(2.05, 0.4, z - 0.8);
    root.add(ext);
  }

  // skirting
  const boardMat = std(0x4e342e, 0.65, 0.05);
  for (const x of [-2.18, 2.18]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, corridorLen), boardMat);
    b.position.set(x, 0.07, -corridorLen / 2 + 1.5);
    root.add(b);
  }
}

function buildZone(i) {
  const z = zoneZ(i);
  const group = new THREE.Group();
  group.position.set(0, 0, z);
  root.add(group);

  const flames = [];
  const count = LOW ? 8 : 12;
  for (let n = 0; n < count; n++) {
    const mat = new THREE.SpriteMaterial({
      map: flameTex, transparent: true, depthWrite: false,
      blending: THREE.NormalBlending, opacity: 1
    });
    const spr = new THREE.Sprite(mat);
    const x = (n / (count - 1) - 0.5) * 3.3;
    const s = 1.25 + Math.random() * 0.8;
    spr.scale.set(s * 0.95, s * 1.6, 1);
    spr.position.set(x, s * 0.65, (Math.random() - 0.5) * 0.7);
    spr.userData = { baseY: spr.position.y, baseS: s, phase: Math.random() * 6.28, speed: 3.5 + Math.random() * 4 };
    spr.renderOrder = 3;
    group.add(spr);
    flames.push(spr);
  }
  for (let n = 0; n < 5; n++) {
    const mat = new THREE.SpriteMaterial({
      map: flameTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.85
    });
    const spr = new THREE.Sprite(mat);
    const s = 0.75 + Math.random() * 0.4;
    spr.scale.set(s * 0.85, s * 1.35, 1);
    spr.position.set((n / 4 - 0.5) * 2.6, s * 0.5, -0.55 - Math.random() * 0.35);
    spr.userData = { baseY: spr.position.y, baseS: s, phase: Math.random() * 6, speed: 4 + Math.random() * 3 };
    spr.renderOrder = 3;
    group.add(spr);
    flames.push(spr);
  }

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 1.8),
    new THREE.MeshBasicMaterial({
      color: 0xff5722, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.03;
  glow.name = 'glow';
  group.add(glow);

  // charred floor mark
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(1.3, 24),
    new THREE.MeshStandardMaterial({ color: 0x1a0c06, roughness: 0.95, metalness: 0, transparent: true, opacity: 0.55 })
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.015;
  group.add(scorch);

  const light = new THREE.PointLight(0xff6a00, 12, 11, 1.25);
  light.position.set(0, 1.3, 0);
  if (!LOW && i === 0) {
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -0.01;
  }
  group.add(light);

  const flare = new THREE.PointLight(0xff1744, 0, 12, 1.1);
  flare.position.set(0, 1.5, 0);
  group.add(flare);

  // local smoke
  const sn = LOW ? 28 : 45;
  const spos = new Float32Array(sn * 3);
  const svel = [];
  for (let k = 0; k < sn; k++) {
    spos[k * 3] = (Math.random() - 0.5) * 2.8;
    spos[k * 3 + 1] = Math.random() * 1.8;
    spos[k * 3 + 2] = (Math.random() - 0.5) * 1.0;
    svel.push({ vx: (Math.random() - 0.5) * 0.12, vy: 0.4 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.08, life: Math.random() });
  }
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
  const smoke = new THREE.Points(sgeo, new THREE.PointsMaterial({
    map: smokeTex, size: LOW ? 0.5 : 0.65, transparent: true, depthWrite: false,
    opacity: 0.5, sizeAttenuation: true
  }));
  smoke.position.y = 0.15;
  group.add(smoke);

  const zone = { i, z, group, flames, glow, light, flare, smoke, spos, svel, sn, alive: true, extinguishT: 0 };
  zones.push(zone);
  return zone;
}

function buildHose() {
  hoseGroup = new THREE.Group();
  camera.add(hoseGroup);
  // Lower + tip pitched up so players see hose body + nozzle from above (not barrel-on circle)
  hoseGroup.position.set(0.05, -0.32, -0.45);
  hoseGroup.rotation.set(-0.55, 0.08, 0.05);
  hoseGroup.scale.setScalar(1.45);

  const hoseMap = rubberHoseTex();
  const hoseMat = new THREE.MeshStandardMaterial({
    map: hoseMap, roughness: 0.48, metalness: 0.08, color: 0xffffff
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.7, 24), hoseMat);
  body.rotation.x = Math.PI / 2.3;
  body.position.set(0, 0.05, 0.22);
  body.castShadow = true;
  hoseGroup.add(body);
  for (let i = 0; i < 7; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.015, 8, 22), std(0x8b0000, 0.4, 0.25));
    ring.position.set(0, 0.05 + i * 0.01, 0.0 + i * 0.09);
    ring.rotation.x = Math.PI / 2.3;
    hoseGroup.add(ring);
  }

  const metalMap = metalTex();
  const nozzleMat = new THREE.MeshStandardMaterial({
    map: metalMap, roughness: 0.22, metalness: 0.92, envMapIntensity: 1.2
  });
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.22, 22), nozzleMat);
  nozzle.rotation.x = Math.PI / 2.1;
  nozzle.position.set(0, 0.16, -0.16);
  hoseGroup.add(nozzle);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.012, 8, 20), std(0xffc107, 0.28, 0.88));
  band.rotation.x = Math.PI / 2.1;
  band.position.set(0, 0.17, -0.08);
  hoseGroup.add(band);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.048, 0.12, 20), std(0xffd54f, 0.25, 0.9));
  tip.rotation.x = Math.PI / 2.1;
  tip.position.set(0, 0.2, -0.3);
  hoseGroup.add(tip);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), new THREE.MeshBasicMaterial({ color: 0x050505 }));
  hole.position.set(0, 0.22, -0.36);
  hole.lookAt(0, 0.4, -1.5);
  hoseGroup.add(hole);

  // water jet mesh (shown during spray)
  jetMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.055, 1.2, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x81d4fa, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    })
  );
  jetMesh.rotation.x = Math.PI / 2.05;
  jetMesh.position.set(0, 0.35, -1.05);
  jetMesh.visible = false;
  hoseGroup.add(jetMesh);

  function glove(side) {
    const g = new THREE.Group();
    const y1 = std(0xfbc02d, 0.5, 0.04);
    const y2 = std(0xf9a825, 0.5, 0.04);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.11, 0.26), y2);
    palm.castShadow = true;
    g.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.09, 4, 8), y1);
      f.position.set(-0.07 + i * 0.045, 0.035, -0.18);
      f.rotation.x = 0.6;
      g.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.075, 4, 8), y1);
    thumb.position.set(side * 0.13, 0.025, -0.02);
    thumb.rotation.z = side * 0.95;
    thumb.rotation.x = 0.35;
    g.add(thumb);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.11, 14), std(0x1565c0, 0.45, 0.12));
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0, 0.18);
    g.add(cuff);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.014, 8, 16), std(0x0d47a1, 0.4, 0.2));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 0, 0.13);
    g.add(rim);
    g.position.set(side * 0.22, 0.06, 0.26);
    g.rotation.set(0.55, side * 0.38, side * 0.22);
    return g;
  }
  hoseGroup.add(glove(-1));
  hoseGroup.add(glove(1));
}

function buildSpray() {
  waterTex = softDot([
    [0, 'rgba(220,245,255,1)'],
    [0.3, 'rgba(120,210,255,0.85)'],
    [1, 'rgba(40,140,255,0)']
  ]);
  const n = LOW ? 140 : 220;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sprayPts = new THREE.Points(geo, new THREE.PointsMaterial({
    map: waterTex, size: 0.16, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0.95, sizeAttenuation: true
  }));
  sprayPts.visible = false;
  camera.add(sprayPts);
  sprayPts.position.set(0, -0.15, -0.35);
  sprayData = { pos, vel: Array.from({ length: n }, () => new THREE.Vector3()), n, alive: false };

  // steam puff for extinguish
  steamTex = softDot([
    [0, 'rgba(230,240,255,0.7)'],
    [0.45, 'rgba(180,200,220,0.3)'],
    [1, 'rgba(150,160,180,0)']
  ]);
  const sn = LOW ? 50 : 80;
  const spos = new Float32Array(sn * 3);
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
  steamPts = new THREE.Points(sgeo, new THREE.PointsMaterial({
    map: steamTex, size: 0.28, transparent: true, depthWrite: false, opacity: 0, sizeAttenuation: true,
    blending: THREE.NormalBlending
  }));
  steamPts.visible = false;
  root.add(steamPts);
  steamData = { pos: spos, vel: Array.from({ length: sn }, () => new THREE.Vector3()), n: sn, t: 0 };
}

function startSprayParticles() {
  sprayT = 0.85;
  hoseKick = 0.12;
  sprayPts.visible = true;
  sprayData.alive = true;
  const { pos, vel, n } = sprayData;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 0.04;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 0.03;
    pos[i * 3 + 2] = 0;
    vel[i].set((Math.random() - 0.5) * 0.45, 0.5 + Math.random() * 0.7, -3.5 - Math.random() * 2.5);
  }
  sprayPts.geometry.attributes.position.needsUpdate = true;
  if (jetMesh) {
    jetMesh.visible = true;
    jetMesh.material.opacity = 0.55;
  }
}

function startSteam(zone) {
  steamPts.visible = true;
  steamPts.position.set(0, 0.4, zone.z);
  steamPts.material.opacity = 0.75;
  steamData.t = 1.1;
  const { pos, vel, n } = steamData;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 2.5;
    pos[i * 3 + 1] = Math.random() * 0.4;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
    vel[i].set((Math.random() - 0.5) * 0.3, 0.8 + Math.random() * 1.1, (Math.random() - 0.5) * 0.25);
  }
  steamPts.geometry.attributes.position.needsUpdate = true;
}

function extinguishZone(zone) {
  zone.alive = false;
  zone.extinguishT = 0.9;
  startSteam(zone);
  zone.flames.forEach((f) => { f.visible = false; });
  zone.glow.material.opacity = 0;
  zone.light.intensity = 0;
  zone.smoke.visible = false;
}

function remainingFires() {
  return zones.filter((z) => z.alive).length;
}

function applyCameraToZone(i, instant = true) {
  const z = camZForZone(Math.min(i, ZONE_COUNT - 1));
  if (instant) {
    camera.position.set(0, 1.48, z);
    camera.lookAt(0, 1.1, zoneZ(Math.min(i, ZONE_COUNT - 1)));
  }
  return z;
}

function beginWalk(toIndex) {
  walking = true;
  walkFrom = camera.position.z;
  walkTo = camZForZone(toIndex);
  walkT = 0;
  walkDur = 1.35;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Correct answer sequence: spray → extinguish current → walk to next (if any)
 * Resolves when ready for next question UI.
 */
export function playCorrect() {
  if (!zones.length) return Promise.resolve({ remaining: 0, walked: false, won: false, error: 'no-zones' });
  if (busy) return Promise.resolve({ remaining: remainingFires(), walked: false, won: remainingFires() === 0 });
  busy = true;
  const zone = zones[zoneIndex];
  return new Promise((resolve) => {
    startSprayParticles();
    // hit fire after short delay
    setTimeout(() => {
      if (zone && zone.alive) extinguishZone(zone);
    }, 380);

    const afterSpray = () => {
      const left = remainingFires();
      if (left === 0) {
        busy = false;
        // cool fog
        if (scene.fog) { scene.fog.color.set(0x4fc3f7); scene.fog.density = 0.018; }
        resolve({ remaining: 0, walked: false, won: true });
        return;
      }
      // advance to next alive zone (should be zoneIndex+1)
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
        }, 50);
      } else {
        busy = false;
        resolve({ remaining: left, walked: false, won: left === 0 });
      }
    };
    setTimeout(afterSpray, 900);
  });
}

export function playWrong() {
  const zone = zones[zoneIndex];
  if (!zone || !zone.alive) return;
  flareT = 0.5;
  hoseKick = -0.08;
  zone.flare.intensity = 20;
  zone.group.scale.setScalar(1.18);
}

export function getZoneIndex() { return zoneIndex; }
export function getRemaining() { return remainingFires(); }
export function isBusy() { return busy || walking; }

function tick(dt) {
  const t = clock.elapsedTime;

  if (hoseGroup) {
    hoseGroup.rotation.x = -0.55 + Math.sin(t * 1.7) * 0.02 + hoseKick;
    hoseGroup.rotation.z = 0.05 + Math.sin(t * 1.2) * 0.015;
    hoseGroup.position.y = -0.32 + Math.sin(t * 2.3) * 0.01;
    if (walking) {
      hoseGroup.rotation.x += Math.sin(t * 14) * 0.015;
      hoseGroup.position.y += Math.abs(Math.sin(walkT / walkDur * Math.PI)) * 0.02;
    }
  }
  hoseKick *= Math.max(0, 1 - dt * 8);

  // animate alive zones
  zones.forEach((zone) => {
    if (!zone.alive) {
      if (zone.extinguishT > 0) {
        zone.extinguishT -= dt;
        zone.group.scale.setScalar(Math.max(0.01, zone.extinguishT / 0.9));
      }
      return;
    }
    zone.flames.forEach((ch) => {
      const u = ch.userData;
      const wob = Math.sin(t * u.speed + u.phase);
      ch.position.y = u.baseY + wob * 0.1;
      const sc = u.baseS * (1 + wob * 0.1);
      ch.scale.set(sc * 0.95, sc * 1.6, 1);
      ch.material.opacity = 0.78 + wob * 0.2;
    });
    const pulse = 0.85 + Math.sin(t * 9 + zone.i) * 0.15;
    zone.light.intensity = 10 * pulse;
    zone.light.position.x = Math.sin(t * 3 + zone.i) * 0.2;
    // smoke
    const { spos, svel, sn } = zone;
    for (let i = 0; i < sn; i++) {
      spos[i * 3] += svel[i].vx * dt;
      spos[i * 3 + 1] += svel[i].vy * dt;
      spos[i * 3 + 2] += svel[i].vz * dt;
      if (spos[i * 3 + 1] > 2.6) {
        spos[i * 3] = (Math.random() - 0.5) * 2.8;
        spos[i * 3 + 1] = 0.1;
        spos[i * 3 + 2] = (Math.random() - 0.5) * 1.0;
      }
    }
    zone.smoke.geometry.attributes.position.needsUpdate = true;
  });

  if (flareT > 0) {
    flareT -= dt;
    const zone = zones[zoneIndex];
    if (zone && zone.alive) {
      zone.flare.intensity = Math.max(0, 20 * (flareT / 0.5));
      const pulse = 1 + Math.sin(t * 40) * 0.1;
      zone.group.scale.setScalar(1.05 * pulse);
      if (flareT <= 0) zone.group.scale.setScalar(1);
    }
  }

  // spray particles
  if (sprayData && sprayData.alive) {
    sprayT -= dt;
    const { pos, vel, n } = sprayData;
    for (let i = 0; i < n; i++) {
      vel[i].y -= 5 * dt;
      pos[i * 3] += vel[i].x * dt;
      pos[i * 3 + 1] += vel[i].y * dt;
      pos[i * 3 + 2] += vel[i].z * dt;
    }
    sprayPts.geometry.attributes.position.needsUpdate = true;
    sprayPts.material.opacity = Math.max(0, sprayT / 0.85);
    if (jetMesh) jetMesh.material.opacity = Math.max(0, 0.55 * (sprayT / 0.85));
    if (sprayT <= 0) {
      sprayData.alive = false;
      sprayPts.visible = false;
      if (jetMesh) { jetMesh.visible = false; jetMesh.material.opacity = 0; }
    }
  }

  // steam
  if (steamData && steamData.t > 0) {
    steamData.t -= dt;
    const { pos, vel, n } = steamData;
    for (let i = 0; i < n; i++) {
      pos[i * 3] += vel[i].x * dt;
      pos[i * 3 + 1] += vel[i].y * dt;
      pos[i * 3 + 2] += vel[i].z * dt;
    }
    steamPts.geometry.attributes.position.needsUpdate = true;
    steamPts.material.opacity = Math.max(0, steamData.t / 1.1 * 0.7);
    if (steamData.t <= 0) steamPts.visible = false;
  }

  // walk
  if (walking) {
    walkT += dt;
    const u = Math.min(1, walkT / walkDur);
    const e = easeInOut(u);
    camera.position.z = walkFrom + (walkTo - walkFrom) * e;
    camera.position.y = 1.48 + Math.sin(e * Math.PI) * 0.04;
    camera.position.x = Math.sin(e * Math.PI * 2) * 0.03;
    const lookZ = zoneZ(zoneIndex);
    camera.lookAt(0, 1.05 + (1 - e) * 0.1, lookZ);
    if (u >= 1) {
      walking = false;
      camera.position.set(0, 1.48, walkTo);
      camera.lookAt(0, 1.1, zoneZ(zoneIndex));
    }
  } else if (!busy) {
    camera.position.y = 1.48 + Math.sin(t * 1.8) * 0.012;
    camera.rotation.z = Math.sin(t * 1.15) * 0.004;
  }

  // fog denser near fire
  if (scene.fog && remainingFires() > 0) {
    scene.fog.density = 0.02 + remainingFires() * 0.004;
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

  renderer = new THREE.WebGLRenderer({ antialias: !LOW, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW ? 1.5 : 2));
  renderer.setSize(hostEl.clientWidth || 640, hostEl.clientHeight || 360, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = !LOW;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  hostEl.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a1a12);
  scene.fog = new THREE.FogExp2(0x3a2218, 0.028);

  camera = new THREE.PerspectiveCamera(60, 1, 0.05, 80);
  scene.add(camera);

  pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;

  hemi = new THREE.HemisphereLight(0xffe8c8, 0x3e2723, 0.7);
  scene.add(hemi);
  keyLight = new THREE.DirectionalLight(0xfff5e6, 1.4);
  keyLight.position.set(3, 7, 4);
  keyLight.castShadow = !LOW;
  if (!LOW) {
    keyLight.shadow.mapSize.set(1024, 1024);
    const c = keyLight.shadow.camera;
    c.near = 0.5; c.far = 40; c.left = -8; c.right = 8; c.top = 8; c.bottom = -8;
  }
  scene.add(keyLight);

  flameTex = makeFlameTex();
  smokeTex = softDot([
    [0, 'rgba(70,70,70,0.55)'],
    [0.4, 'rgba(50,50,50,0.25)'],
    [1, 'rgba(30,30,30,0)']
  ]);

  buildCorridor();
  for (let i = 0; i < ZONE_COUNT; i++) buildZone(i);
  buildHose();
  buildSpray();

  applyCameraToZone(0, true);
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

/** @deprecated meter sync — remaining zones */
export function setFireLevel(level) {
  // keep alive first `level` zones from the end? Better: ignore during zone mode
  // used only as fallback — prefer getRemaining()
}

export function spray() { startSprayParticles(); }
export function flare() { playWrong(); }
export function win() {
  zones.forEach((z) => { if (z.alive) extinguishZone(z); });
  if (scene.fog) { scene.fog.color.set(0x4fc3f7); scene.fog.density = 0.018; }
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
  sprayPts = sprayData = steamPts = steamData = jetMesh = null;
  hostEl = null;
}

export default {
  init, dispose, playCorrect, playWrong, getZoneIndex, getRemaining, isBusy,
  setFireLevel, spray, flare, win, resetWin, ZONE_COUNT
};
