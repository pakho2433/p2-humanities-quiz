/**
 * 救火挑戰 · Three.js FPS corridor
 * Procedural wood / fire / smoke / water — no external texture CDN.
 */
import * as THREE from 'three';

const FIRE_MAX = 5;
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
const LOW = isTouch || (navigator.hardwareConcurrency || 8) <= 4;

let renderer, scene, camera, clock;
let root, flameGroup, smokePts, sprayPts;
let fireLight, flareLight, exitLight;
let hoseGroup, viewKick = 0;
let fireLevel = FIRE_MAX;
let sprayT = 0, flareT = 0, won = false;
let animating = false;
let hostEl = null;
let resizeObs = null;
let flameMats = [];
let smokeData, sprayData;
let smokeTex, flameTex, waterTex;

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = LOW ? 2 : 4;
  t.needsUpdate = true;
  return t;
}

function woodFloorTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#8d6540';
    g.fillRect(0, 0, w, h);
    const plank = 48;
    for (let y = 0; y < h; y += plank) {
      const shade = 0.88 + Math.random() * 0.14;
      g.fillStyle = `rgb(${Math.floor(160 * shade)},${Math.floor(110 * shade)},${Math.floor(70 * shade)})`;
      g.fillRect(0, y, w, plank - 2);
      g.fillStyle = 'rgba(60,35,15,0.35)';
      g.fillRect(0, y + plank - 2, w, 2);
      for (let x = (y / plank) % 2 === 0 ? 0 : 120; x < w; x += 180 + Math.random() * 40) {
        g.fillStyle = 'rgba(40,25,10,0.18)';
        g.fillRect(x, y + 4, 2, plank - 8);
      }
      // grain
      g.strokeStyle = 'rgba(70,40,15,0.12)';
      g.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        g.beginPath();
        const yy = y + 6 + Math.random() * (plank - 12);
        g.moveTo(0, yy);
        for (let x = 0; x < w; x += 40) g.lineTo(x, yy + Math.sin(x * 0.04 + i) * 1.5);
        g.stroke();
      }
    }
  });
}

function wallTex() {
  return canvasTex(256, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#f5ebda');
    grd.addColorStop(0.62, '#efe2c8');
    grd.addColorStop(0.62, '#6d4c41');
    grd.addColorStop(0.70, '#5d4037');
    grd.addColorStop(0.70, '#f3e7cf');
    grd.addColorStop(1, '#ebe0c8');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // subtle plaster noise
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(180,150,110,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * w, Math.random() * h * 0.62, 2, 2);
    }
    // wainscot panel lines
    g.strokeStyle = 'rgba(40,25,15,0.35)';
    g.lineWidth = 2;
    g.strokeRect(12, h * 0.72, w - 24, h * 0.22);
    g.beginPath();
    g.moveTo(w / 2, h * 0.72);
    g.lineTo(w / 2, h * 0.94);
    g.stroke();
  });
}

function ceilingTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#e8dcc4';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.04)';
    for (let i = 0; i < 80; i++) g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
  });
}

function makeFlameTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const grd = g.createRadialGradient(w * 0.5, h * 0.72, 2, w * 0.5, h * 0.45, w * 0.45);
    grd.addColorStop(0, 'rgba(255,255,220,1)');
    grd.addColorStop(0.25, 'rgba(255,220,80,0.95)');
    grd.addColorStop(0.55, 'rgba(255,120,20,0.85)');
    grd.addColorStop(0.8, 'rgba(220,30,0,0.45)');
    grd.addColorStop(1, 'rgba(80,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(w * 0.5, h * 0.08);
    g.bezierCurveTo(w * 0.78, h * 0.35, w * 0.9, h * 0.55, w * 0.72, h * 0.85);
    g.bezierCurveTo(w * 0.6, h * 0.98, w * 0.4, h * 0.98, w * 0.28, h * 0.85);
    g.bezierCurveTo(w * 0.1, h * 0.55, w * 0.22, h * 0.35, w * 0.5, h * 0.08);
    g.fill();
  }, false);
}

function softDot(colorStops) {
  return canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    colorStops.forEach(([p, c]) => grd.addColorStop(p, c));
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }, false);
}

function exitSignTex() {
  return canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#1b5e20';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a5d6a7';
    g.lineWidth = 6;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#e8f5e9';
    g.font = 'bold 42px "PingFang TC","Noto Sans TC",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('出口 →', w / 2, h / 2);
  });
}

function pictureTex() {
  return canvasTex(256, 180, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.55);
    sky.addColorStop(0, '#64b5f6');
    sky.addColorStop(1, '#bbdefb');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#66bb6a';
    g.beginPath();
    g.moveTo(0, h * 0.55);
    g.quadraticCurveTo(w * 0.3, h * 0.35, w * 0.55, h * 0.55);
    g.quadraticCurveTo(w * 0.75, h * 0.4, w, h * 0.5);
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.fill();
    g.fillStyle = '#ffeb3b';
    g.beginPath();
    g.arc(w * 0.78, h * 0.22, 18, 0, Math.PI * 2);
    g.fill();
  });
}

function std(color, rough = 0.6, metal = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}

function buildCorridor() {
  root = new THREE.Group();
  scene.add(root);

  const floorMap = woodFloorTex();
  floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping;
  floorMap.repeat.set(4, 10);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 18),
    new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.75, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -7);
  floor.receiveShadow = true;
  root.add(floor);

  const wallMap = wallTex();
  wallMap.wrapS = wallMap.wrapT = THREE.RepeatWrapping;
  wallMap.repeat.set(3, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallMap, roughness: 0.85, metalness: 0 });
  const wallH = 3.2, wallLen = 18, wallY = wallH / 2;
  const left = new THREE.Mesh(new THREE.PlaneGeometry(wallLen, wallH), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-2.1, wallY, -7);
  left.receiveShadow = true;
  root.add(left);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(wallLen, wallH), wallMat.clone());
  right.rotation.y = -Math.PI / 2;
  right.position.set(2.1, wallY, -7);
  right.receiveShadow = true;
  root.add(right);

  const ceilMap = ceilingTex();
  ceilMap.wrapS = ceilMap.wrapT = THREE.RepeatWrapping;
  ceilMap.repeat.set(2, 6);
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 18),
    new THREE.MeshStandardMaterial({ map: ceilMap, roughness: 0.9, metalness: 0 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, wallH, -7);
  root.add(ceil);

  // Recessed ceiling lights
  for (let i = 0; i < 5; i++) {
    const z = -1.5 - i * 3.2;
    const fixture = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.06, 0.55),
      std(0xf5f5f5, 0.4, 0.1, { emissive: 0xfff3e0, emissiveIntensity: 1.2 })
    );
    fixture.position.set(0, wallH - 0.04, z);
    root.add(fixture);
    const pl = new THREE.PointLight(0xfff0dd, LOW ? 4 : 6, 8, 1.6);
    pl.position.set(0, wallH - 0.2, z);
    root.add(pl);
  }

  // End wall + door
  const endWall = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, wallH),
    std(0xe8dcc0, 0.9, 0)
  );
  endWall.position.set(0, wallY, -16);
  root.add(endWall);

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 2.2, 0.08),
    std(0x5d4037, 0.7, 0.05)
  );
  door.position.set(0, 1.1, -15.95);
  door.castShadow = true;
  root.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 12), std(0xd4af37, 0.3, 0.85));
  knob.position.set(0.45, 1.05, -15.9);
  root.add(knob);

  const exit = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.55),
    new THREE.MeshStandardMaterial({
      map: exitSignTex(),
      emissive: 0x2e7d32,
      emissiveIntensity: 1.1,
      roughness: 0.4,
      metalness: 0.15
    })
  );
  exit.position.set(0, 2.65, -15.88);
  root.add(exit);
  exitLight = new THREE.PointLight(0x81c784, 3.2, 7, 1.6);
  exitLight.position.set(0, 2.55, -15.2);
  root.add(exitLight);

  // Picture on left wall
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.75, 0.05), std(0x4e342e, 0.6, 0.05));
  frame.position.set(-2.05, 1.95, -4.2);
  frame.rotation.y = Math.PI / 2;
  root.add(frame);
  const pic = new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 0.64),
    new THREE.MeshStandardMaterial({ map: pictureTex(), roughness: 0.5 })
  );
  pic.position.set(-2.02, 1.95, -4.2);
  pic.rotation.y = Math.PI / 2;
  root.add(pic);

  // Baseboards
  const boardMat = std(0x4e342e, 0.7, 0.05);
  for (const x of [-2.08, 2.08]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 18), boardMat);
    b.position.set(x, 0.06, -7);
    root.add(b);
  }
}

function buildFlames() {
  flameGroup = new THREE.Group();
  flameGroup.position.set(0, 0.02, -3.9);
  root.add(flameGroup);
  flameTex = makeFlameTex();
  flameMats = [];

  const count = LOW ? 9 : 13;
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: flameTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 1
    });
    flameMats.push(mat);
    const spr = new THREE.Sprite(mat);
    const x = (i / (count - 1) - 0.5) * 3.4;
    const s = 1.05 + Math.random() * 0.7;
    spr.scale.set(s * 0.95, s * 1.55, 1);
    spr.position.set(x, s * 0.62, (Math.random() - 0.5) * 0.85);
    spr.userData = { baseY: spr.position.y, baseS: s, phase: Math.random() * Math.PI * 2, speed: 3 + Math.random() * 4 };
    flameGroup.add(spr);
  }

  // Second row of smaller flames for depth
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.SpriteMaterial({
      map: flameTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.85
    });
    const spr = new THREE.Sprite(mat);
    const s = 0.7 + Math.random() * 0.4;
    spr.scale.set(s * 0.8, s * 1.3, 1);
    spr.position.set((i / 5 - 0.5) * 2.8, s * 0.45, -0.55 - Math.random() * 0.4);
    spr.userData = { baseY: spr.position.y, baseS: s, phase: Math.random() * 6, speed: 4 + Math.random() * 3 };
    flameGroup.add(spr);
  }

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 2.0),
    new THREE.MeshBasicMaterial({
      color: 0xff5722, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, 0.03, 0);
  glow.name = 'floorGlow';
  flameGroup.add(glow);

  fireLight = new THREE.PointLight(0xff6a00, 14, 12, 1.2);
  fireLight.position.set(0, 1.35, 0);
  fireLight.castShadow = !LOW;
  if (!LOW) {
    fireLight.shadow.mapSize.set(512, 512);
    fireLight.shadow.bias = -0.01;
  }
  flameGroup.add(fireLight);

  flareLight = new THREE.PointLight(0xff1744, 0, 14, 1.1);
  flareLight.position.set(0, 1.6, 0);
  flameGroup.add(flareLight);
  flameGroup.traverse((o) => { if (o.isSprite) o.renderOrder = 3; });
}

function buildSmoke() {
  smokeTex = softDot([
    [0, 'rgba(80,80,80,0.55)'],
    [0.4, 'rgba(60,60,60,0.25)'],
    [1, 'rgba(40,40,40,0)']
  ]);
  const n = LOW ? 40 : 70;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const vel = [];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 3;
    pos[i * 3 + 1] = Math.random() * 2.2;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
    vel.push({
      vx: (Math.random() - 0.5) * 0.15,
      vy: 0.35 + Math.random() * 0.45,
      vz: (Math.random() - 0.5) * 0.1,
      life: Math.random()
    });
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: smokeTex,
    size: LOW ? 0.55 : 0.7,
    transparent: true,
    depthWrite: false,
    opacity: 0.55,
    sizeAttenuation: true
  });
  smokePts = new THREE.Points(geo, mat);
  smokePts.position.set(0, 0.25, -3.9);
  root.add(smokePts);
  smokeData = { pos, vel, n };
}

function buildSpray() {
  waterTex = softDot([
    [0, 'rgba(200,240,255,1)'],
    [0.35, 'rgba(100,200,255,0.7)'],
    [1, 'rgba(50,150,255,0)']
  ]);
  const n = LOW ? 110 : 180;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: waterTex,
    size: 0.18,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.9,
    sizeAttenuation: true
  });
  sprayPts = new THREE.Points(geo, mat);
  sprayPts.visible = false;
  camera.add(sprayPts);
  sprayPts.position.set(0, -0.25, -0.4);
  sprayData = {
    pos,
    vel: Array.from({ length: n }, () => new THREE.Vector3()),
    n,
    alive: false
  };
}

function buildHose() {
  hoseGroup = new THREE.Group();
  camera.add(hoseGroup);
  // Closer / higher so gloves stay in frame on mobile aspect
  hoseGroup.position.set(0, -0.22, -0.42);
  hoseGroup.scale.setScalar(1.55);

  const hoseMat = std(0xd32f2f, 0.48, 0.12);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.62, 20), hoseMat);
  body.rotation.x = Math.PI / 2.35;
  body.position.set(0, 0.04, 0.2);
  body.castShadow = true;
  hoseGroup.add(body);

  for (let i = 0; i < 6; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.014, 8, 20),
      std(0xb71c1c, 0.45, 0.2)
    );
    ring.position.set(0, 0.04 + i * 0.012, 0.02 + i * 0.085);
    ring.rotation.x = Math.PI / 2.35;
    hoseGroup.add(ring);
  }

  const nozzleMat = std(0xeceff1, 0.22, 0.92);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.075, 0.2, 20), nozzleMat);
  nozzle.rotation.x = Math.PI / 2.15;
  nozzle.position.set(0, 0.14, -0.14);
  hoseGroup.add(nozzle);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.01, 8, 20), std(0xffc107, 0.3, 0.85));
  band.rotation.x = Math.PI / 2.15;
  band.position.set(0, 0.15, -0.08);
  hoseGroup.add(band);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.045, 0.1, 20), std(0xffd54f, 0.28, 0.9));
  tip.rotation.x = Math.PI / 2.15;
  tip.position.set(0, 0.18, -0.26);
  hoseGroup.add(tip);
  const tipHole = new THREE.Mesh(
    new THREE.CircleGeometry(0.022, 16),
    new THREE.MeshBasicMaterial({ color: 0x0a0a0a })
  );
  tipHole.position.set(0, 0.2, -0.31);
  tipHole.lookAt(0, 0.35, -1.2);
  hoseGroup.add(tipHole);

  function glove(side) {
    const g = new THREE.Group();
    const yellow = std(0xfbc02d, 0.55, 0.05);
    const yellow2 = std(0xf9a825, 0.55, 0.05);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.24), yellow2);
    palm.castShadow = true;
    g.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.085, 4, 8), yellow);
      f.position.set(-0.06 + i * 0.04, 0.03, -0.16);
      f.rotation.x = 0.55;
      g.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.07, 4, 8), yellow);
    thumb.position.set(side * 0.12, 0.02, -0.02);
    thumb.rotation.z = side * 0.9;
    thumb.rotation.x = 0.3;
    g.add(thumb);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.1, 14), std(0x1565c0, 0.5, 0.12));
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, -0.01, 0.16);
    g.add(cuff);
    const cuffRim = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 8, 16), std(0x0d47a1, 0.45, 0.15));
    cuffRim.rotation.x = Math.PI / 2;
    cuffRim.position.set(0, -0.01, 0.12);
    g.add(cuffRim);
    g.position.set(side * 0.24, 0.02, 0.3);
    g.rotation.set(0.45, side * 0.45, side * 0.25);
    return g;
  }
  hoseGroup.add(glove(-1));
  hoseGroup.add(glove(1));
}

function applyFireLevel() {
  const t = fireLevel / FIRE_MAX;
  if (flameGroup) {
    flameGroup.visible = fireLevel > 0 && !won;
    flameGroup.scale.setScalar(0.45 + t * 0.7);
    fireLight.intensity = fireLevel > 0 ? 6 + t * 14 : 0;
    const glow = flameGroup.getObjectByName('floorGlow');
    if (glow) glow.material.opacity = 0.12 + t * 0.35;
  }
  if (smokePts) {
    smokePts.material.opacity = fireLevel > 0 ? 0.25 + t * 0.45 : 0;
    smokePts.visible = fireLevel > 0;
  }
  if (scene.fog) {
    scene.fog.density = 0.015 + t * 0.028;
    scene.fog.color.set(fireLevel > 0 ? 0x3a2218 : 0x2a3340);
  }
}

function triggerSpray() {
  sprayT = 0.65;
  viewKick = 0.08;
  if (!sprayData) return;
  sprayPts.visible = true;
  sprayData.alive = true;
  const { pos, vel, n } = sprayData;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 0.05;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 0.04;
    pos[i * 3 + 2] = 0;
    const spread = 0.35;
    vel[i].set(
      (Math.random() - 0.5) * spread,
      0.4 + Math.random() * 0.6,
      -2.8 - Math.random() * 2.2
    );
  }
  sprayPts.geometry.attributes.position.needsUpdate = true;
}

function triggerFlare() {
  flareT = 0.45;
  viewKick = -0.06;
  if (flareLight) flareLight.intensity = 18;
  if (flameGroup) flameGroup.scale.setScalar(1.25);
}

function setWon(v) {
  won = !!v;
  applyFireLevel();
  if (won && fireLight) fireLight.intensity = 0;
  if (won && smokePts) smokePts.visible = false;
  if (won && flameGroup) flameGroup.visible = false;
  if (won && scene.fog) {
    scene.fog.color.set(0x4fc3f7);
    scene.fog.density = 0.02;
  }
}

function tick(dt) {
  const t = clock.elapsedTime;

  // Idle hose sway
  if (hoseGroup) {
    hoseGroup.rotation.x = Math.sin(t * 1.6) * 0.02 + viewKick;
    hoseGroup.rotation.z = Math.sin(t * 1.1) * 0.015;
    hoseGroup.position.y = -0.22 + Math.sin(t * 2.2) * 0.01;
  }
  viewKick *= Math.max(0, 1 - dt * 8);

  // Flame animation
  if (flameGroup && fireLevel > 0 && !won) {
    flameGroup.children.forEach((ch) => {
      if (!ch.isSprite) return;
      const u = ch.userData;
      const wob = Math.sin(t * u.speed + u.phase);
      ch.position.y = u.baseY + wob * 0.08;
      const sc = u.baseS * (1 + wob * 0.08);
      ch.scale.set(sc * 0.85, sc * 1.35, 1);
      ch.material.opacity = 0.75 + wob * 0.2;
    });
    fireLight.intensity = (6 + (fireLevel / FIRE_MAX) * 14) * (0.85 + Math.sin(t * 9) * 0.15);
    fireLight.position.x = Math.sin(t * 3) * 0.15;
  }

  if (flareT > 0) {
    flareT -= dt;
    if (flareLight) flareLight.intensity = Math.max(0, 18 * (flareT / 0.45));
    if (flameGroup && fireLevel > 0) {
      const pulse = 1 + Math.sin(t * 40) * 0.08;
      flameGroup.scale.setScalar((0.45 + (fireLevel / FIRE_MAX) * 0.7) * pulse * (flareT > 0 ? 1.15 : 1));
    }
  }

  // Smoke
  if (smokeData && fireLevel > 0 && !won) {
    const { pos, vel, n } = smokeData;
    for (let i = 0; i < n; i++) {
      pos[i * 3] += vel[i].vx * dt;
      pos[i * 3 + 1] += vel[i].vy * dt;
      pos[i * 3 + 2] += vel[i].vz * dt;
      vel[i].life += dt * 0.25;
      if (pos[i * 3 + 1] > 2.8 || vel[i].life > 1) {
        pos[i * 3] = (Math.random() - 0.5) * 3;
        pos[i * 3 + 1] = 0.1 + Math.random() * 0.3;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 1.0;
        vel[i].life = 0;
      }
    }
    smokePts.geometry.attributes.position.needsUpdate = true;
  }

  // Water spray
  if (sprayData && sprayData.alive) {
    sprayT -= dt;
    const { pos, vel, n } = sprayData;
    for (let i = 0; i < n; i++) {
      vel[i].y -= 4.5 * dt;
      pos[i * 3] += vel[i].x * dt;
      pos[i * 3 + 1] += vel[i].y * dt;
      pos[i * 3 + 2] += vel[i].z * dt;
    }
    sprayPts.geometry.attributes.position.needsUpdate = true;
    sprayPts.material.opacity = Math.max(0, sprayT / 0.65);
    if (sprayT <= 0) {
      sprayData.alive = false;
      sprayPts.visible = false;
    }
  }

  // Subtle camera bob
  if (camera) {
    camera.position.y = 1.48 + Math.sin(t * 1.8) * 0.012;
    camera.rotation.z = Math.sin(t * 1.2) * 0.004;
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

  renderer = new THREE.WebGLRenderer({ antialias: !LOW, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW ? 1.5 : 2));
  renderer.setSize(hostEl.clientWidth || 640, hostEl.clientHeight || 360, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = !LOW;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.borderRadius = '0';
  hostEl.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a1a12);
  scene.fog = new THREE.FogExp2(0x3a2218, 0.035);

  camera = new THREE.PerspectiveCamera(62, 1, 0.05, 60);
  camera.position.set(0, 1.48, 1.0);
  camera.lookAt(0, 1.15, -8);
  scene.add(camera);

  // Lights
  scene.add(new THREE.HemisphereLight(0xffe8c8, 0x3e2723, 0.85));
  const key = new THREE.DirectionalLight(0xfff5e6, 1.6);
  key.position.set(2, 6, 3);
  key.castShadow = !LOW;
  if (!LOW) {
    key.shadow.mapSize.set(1024, 1024);
    const c = key.shadow.camera;
    c.near = 0.5; c.far = 30;
    c.left = -6; c.right = 6; c.top = 6; c.bottom = -6;
  }
  scene.add(key);

  buildCorridor();
  buildFlames();
  buildSmoke();
  buildHose();
  buildSpray();

  fireLevel = FIRE_MAX;
  won = false;
  applyFireLevel();
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

export function setFireLevel(level) {
  fireLevel = Math.max(0, Math.min(FIRE_MAX, level));
  applyFireLevel();
}

export function spray() {
  triggerSpray();
}

export function flare() {
  triggerFlare();
}

export function win() {
  setWon(true);
}

export function resetWin() {
  setWon(false);
}

export function dispose() {
  animating = false;
  if (renderer) {
    renderer.setAnimationLoop(null);
    try { renderer.dispose(); } catch (_) {}
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }
  if (resizeObs) { try { resizeObs.disconnect(); } catch (_) {} resizeObs = null; }
  window.removeEventListener('resize', onResize);
  renderer = scene = camera = root = flameGroup = smokePts = sprayPts = null;
  fireLight = flareLight = exitLight = hoseGroup = null;
  flameMats = [];
  hostEl = null;
}

export default { init, setFireLevel, spray, flare, win, resetWin, dispose };
