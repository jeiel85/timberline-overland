// Landmark set-pieces: base camp, the ranger cabin, the dock on the tarn, the
// old mine, signs and cairns, the snowline hut and the summit beacon.
// Each one also reports box colliders (world space) for the physics world.

import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export const ALT_OFFSET = 2140;

const mats = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  return mats.get(key);
}

function signTexture(lines, { w = 512, h = 256, bg = '#5b3d26', fg = '#f6ead2', accent = '#ff8a3d' } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 3;
  for (let y = 18; y < h; y += 26) { g.beginPath(); g.moveTo(0, y + Math.sin(y) * 2); g.lineTo(w, y); g.stroke(); }
  g.strokeStyle = fg;
  g.lineWidth = 8;
  g.strokeRect(12, 12, w - 24, h - 24);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const step = (h - 40) / lines.length;
  lines.forEach((ln, i) => {
    const big = i === 0;
    g.fillStyle = big ? fg : accent;
    g.font = `${big ? 800 : 700} ${big ? Math.min(64, step * 0.62) : Math.min(40, step * 0.5)}px "Archivo Narrow", "Noto Sans KR", sans-serif`;
    g.fillText(ln, w / 2, 20 + step * (i + 0.5));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function logTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const rand = mulberry32(3);
  for (let i = 0; i < 8; i++) {
    const y = i * 32;
    const grad = g.createLinearGradient(0, y, 0, y + 32);
    grad.addColorStop(0, '#4d3422');
    grad.addColorStop(0.25, '#8a6141');
    grad.addColorStop(0.6, '#7a5236');
    grad.addColorStop(1, '#3a2617');
    g.fillStyle = grad;
    g.fillRect(0, y, 256, 32);
    g.fillStyle = 'rgba(40,25,15,0.35)';
    for (let k = 0; k < 6; k++) g.fillRect(rand() * 256, y + 8 + rand() * 16, 20 + rand() * 50, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A landmark group in local space (+z faces visitors) that records colliders. */
class Site {
  constructor(x, y, z, yaw) {
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.colliders = [];
    this.glows = [];
    this.flames = [];
    this.blinkers = [];
  }

  add(geo, material, x, y, z, { rx = 0, ry = 0, rz = 0, shadow = true, collide = null } = {}) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = shadow;
    m.receiveShadow = true;
    this.group.add(m);
    if (collide) this.collide(x + (collide.dx || 0), y + (collide.dy || 0), z + (collide.dz || 0), collide.hx, collide.hy, collide.hz, ry, collide.kind);
    return m;
  }

  box(w, h, d, color, x, y, z, opts = {}) {
    const m = typeof color === 'string' ? mat(color) : color;
    const col = opts.collide === true ? { hx: w / 2, hy: h / 2, hz: d / 2 } : opts.collide;
    return this.add(new THREE.BoxGeometry(w, h, d), m, x, y, z, { ...opts, collide: col });
  }

  cyl(r1, r2, h, color, x, y, z, opts = {}) {
    const m = typeof color === 'string' ? mat(color) : color;
    return this.add(new THREE.CylinderGeometry(r1, r2, h, opts.segs || 10), m, x, y, z, opts);
  }

  collide(lx, ly, lz, hx, hy, hz, ry = 0, kind = 'wood') {
    const g = this.group;
    const c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y);
    this.colliders.push({
      x: g.position.x + lx * c + lz * s,
      y: g.position.y + ly,
      z: g.position.z - lx * s + lz * c,
      hx, hy, hz, rot: g.rotation.y + ry, kind,
    });
  }

  sign(lines, x, z, ry = 0, opts = {}) {
    const w = opts.w || 2.2, h = opts.h || 1.1, post = opts.post || 1.5;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    const postGeo = new THREE.BoxGeometry(0.14, post + h, 0.14);
    for (const px of [-w / 2 + 0.15, w / 2 - 0.15]) {
      const m = new THREE.Mesh(postGeo, mat('#5c412b'));
      m.position.set(px, (post + h) / 2, 0);
      m.castShadow = true;
      g.add(m);
    }
    const face = new THREE.MeshStandardMaterial({ map: signTexture(lines, opts.tex), roughness: 0.8 });
    const edge = mat('#4a3220');
    const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), [edge, edge, edge, edge, face, edge]);
    board.position.set(0, post + h / 2, 0.08);
    board.castShadow = true;
    g.add(board);
    this.group.add(g);
    this.collide(x, (post + h) / 2, z, w / 2, (post + h) / 2, 0.12, ry);
  }

  cairn(x, z, size = 1, seed = 1) {
    const rand = mulberry32(seed);
    let y = 0;
    for (let i = 0; i < 6; i++) {
      const r = (0.75 - i * 0.1) * size;
      const g = new THREE.IcosahedronGeometry(r, 0);
      const m = this.add(g, mat('#9a968f', { flatShading: true }), x + (rand() - 0.5) * 0.1, y + r * 0.55, z, { ry: rand() * 6 });
      m.scale.y = 0.6;
      y += r * 1.05;
    }
    this.collide(x, y / 2, z, 0.75 * size, y / 2, 0.75 * size, 0, 'rock');
  }

  glow(mesh) { this.glows.push(mesh); return mesh; }
}

function windowPane(site, x, y, z, w, h, ry = 0) {
  const m = new THREE.MeshStandardMaterial({ color: '#28323a', emissive: '#ffb45e', emissiveIntensity: 0, roughness: 0.3 });
  const pane = site.add(new THREE.BoxGeometry(w, h, 0.06), m, x, y, z, { ry, shadow: false });
  site.glow(pane);
  site.box(w + 0.16, 0.1, 0.12, '#e8dcc2', x, y - h / 2 - 0.02, z, { ry, shadow: false });
  return pane;
}

// ---------------------------------------------------------------------------

function baseCamp(l, T) {
  const s = new Site(l.x, l.y, l.z, Math.PI * 0.85);
  const dome = (x, z, color, r = 1.5) => {
    const g = new THREE.SphereGeometry(r, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    const m = s.add(g, mat(color, { roughness: 0.7 }), x, 0, z, { collide: { hx: r * 0.9, hy: 0.5, hz: r * 0.9, dy: 0.5 } });
    m.scale.y = 0.72;
    s.box(0.7, 0.75, 0.06, '#2a2420', x, 0.38, z + r * 0.93, { shadow: false });
  };
  dome(-6, 2, '#e5652e');
  dome(-2.5, 5.5, '#5b7c3c', 1.3);
  dome(-8.5, 6.5, '#e8c547', 1.2);
  // fire ring
  const rand = mulberry32(8);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const st = s.add(new THREE.IcosahedronGeometry(0.2, 0), mat('#7d7a74', { flatShading: true }), 2.5 + Math.cos(a) * 0.75, 0.1, 3 + Math.sin(a) * 0.75, { ry: rand() * 6 });
    st.scale.y = 0.6;
  }
  s.cyl(0.08, 0.08, 1.1, '#4a3221', 2.5, 0.15, 3, { rz: Math.PI / 2, ry: 0.5 });
  s.cyl(0.08, 0.08, 1.1, '#4a3221', 2.5, 0.2, 3, { rz: Math.PI / 2, ry: -0.6 });
  const flameMat = new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ff7a1f', emissiveIntensity: 2.5, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 3; i++) {
    const f = s.add(new THREE.ConeGeometry(0.22 - i * 0.04, 0.7 - i * 0.12, 6), flameMat, 2.5 + (i - 1) * 0.12, 0.5, 3 + (i % 2) * 0.1, { shadow: false });
    s.flames.push(f);
  }
  const fire = new THREE.PointLight('#ff9a4a', 0, 18, 1.6);
  fire.position.set(2.5, 1.2, 3);
  s.group.add(fire);
  s.fireLight = fire;
  // log benches and a table
  s.cyl(0.22, 0.22, 2.2, '#6a4a30', 2.5, 0.22, 5.2, { rz: Math.PI / 2, collide: { hx: 1.1, hy: 0.22, hz: 0.25 } });
  s.cyl(0.22, 0.22, 2.2, '#6a4a30', 4.9, 0.22, 3.1, { rz: Math.PI / 2, ry: Math.PI / 2, collide: { hx: 0.25, hy: 0.22, hz: 1.1 } });
  s.box(1.8, 0.08, 0.9, '#8a6545', 6, 0.8, 7, { collide: { hx: 0.9, hy: 0.4, hz: 0.45, dy: -0.4 } });
  for (const [dx, dz] of [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]]) s.box(0.07, 0.8, 0.07, '#5a4030', 6 + dx, 0.4, 7 + dz);
  s.box(0.5, 0.35, 0.35, '#3f6fb5', 6.3, 1.0, 7);
  // flag
  s.cyl(0.05, 0.06, 6, '#d9d9d9', -11, 3, 0, { collide: { hx: 0.1, hy: 3, hz: 0.1 } });
  const pennant = s.add(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.8, 0), new THREE.Vector3(1.6, -0.4, 0)]), new THREE.MeshStandardMaterial({ color: '#ff6b2c', side: THREE.DoubleSide }), -10.95, 5.9, 0, { shadow: false });
  pennant.geometry.computeVertexNormals();
  s.sign(['TIMBERLINE TRAIL', 'TRAILHEAD · 4x4 ONLY', `ELEV ${Math.round(l.y + ALT_OFFSET).toLocaleString('en-US')} m`], -2, -9, 0, { w: 2.8, h: 1.4 });
  return s;
}

function rangerCabin(l) {
  const s = new Site(l.x, l.y, l.z, Math.PI / 2);
  const logs = logTexture();
  const wallTex = logs.clone();
  wallTex.repeat.set(2, 1.4);
  wallTex.needsUpdate = true;
  const wall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
  s.add(new THREE.BoxGeometry(7, 3.2, 5.4), wall, 0, 1.6, -1, { collide: { hx: 3.5, hy: 1.6, hz: 2.7 } });
  // gable roof
  const roof = mat('#7e2f22', { roughness: 0.6 });
  s.box(7.8, 0.14, 3.5, roof, 0, 4.17, -2.35, { rx: -0.6 });
  s.box(7.8, 0.14, 3.5, roof, 0, 4.17, 0.35, { rx: 0.6 });
  const gable = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2.7, 0, 0), new THREE.Vector3(2.7, 0, 0), new THREE.Vector3(0, 1.85, 0)]);
  gable.computeVertexNormals();
  for (const x of [-3.5, 3.5]) {
    const gm = s.add(gable, new THREE.MeshStandardMaterial({ map: logs, side: THREE.DoubleSide, roughness: 0.9 }), x, 3.2, -1, { ry: Math.PI / 2 });
    gm.castShadow = true;
  }
  s.box(0.8, 2.2, 0.8, '#8c877f', 2.4, 4.3, -2.2);
  // porch
  s.box(7.4, 0.2, 2.2, '#8a6545', 0, 0.25, 2.8, { collide: { hx: 3.7, hy: 0.25, hz: 1.1 } });
  for (const x of [-3.4, 3.4]) s.box(0.18, 2.7, 0.18, '#5b3f29', x, 1.6, 3.7);
  s.box(7.6, 0.12, 2.6, roof, 0, 3.0, 2.85, { rx: 0.18 });
  s.box(1.1, 2.1, 0.08, '#4a2e1c', 0, 1.35, 1.72);
  windowPane(s, -2, 1.9, 1.74, 1.2, 0.9);
  windowPane(s, 2, 1.9, 1.74, 1.2, 0.9);
  windowPane(s, -3.53, 1.9, -1, 1.1, 0.8, Math.PI / 2);
  // woodpile
  for (let i = 0; i < 9; i++) s.cyl(0.13, 0.13, 1.2, '#7b5a3a', -4.3, 0.15 + (i % 3) * 0.26, -2.8 + Math.floor(i / 3) * 0.28, { rx: Math.PI / 2, segs: 7 });
  s.sign(['RANGER STATION', 'TIMBERLINE DISTRICT'], 5.6, 4.5, -0.3, { w: 2.2, h: 0.9, post: 1.2 });
  return s;
}

function tarnDock(l, T) {
  const L = T.lake;
  const yaw = Math.atan2(L.x - l.x, L.z - l.z);
  const s = new Site(l.x, l.y, l.z, yaw);
  const deckY = T.waterY + 0.45 - l.y;
  const len = 16;
  s.box(2.8, 0.18, len, '#8d6a48', 0, deckY, len / 2 + 1, { collide: { hx: 1.4, hy: 0.25, hz: len / 2 } });
  for (let z = 2; z <= len; z += 3) for (const x of [-1.3, 1.3]) s.cyl(0.12, 0.12, 3, '#5a4030', x, deckY - 1.4, z);
  s.box(2.8, 0.18, 1.6, '#8d6a48', 0, deckY * 0.5, 0.3, { rx: -0.25 });
  // canoe on the shore
  const hull = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const canoe = s.add(hull, mat('#c9452f', { roughness: 0.5, side: THREE.DoubleSide }), -4, 0.35, -1, { ry: 0.3, rz: Math.PI, collide: { hx: 0.5, hy: 0.35, hz: 2.2 } });
  canoe.scale.set(0.45, 0.35, 2.4);
  s.box(1.8, 0.1, 0.45, '#7a5a3c', 3.6, 0.5, -1.5, { collide: { hx: 0.9, hy: 0.25, hz: 0.25, dy: -0.25 } });
  for (const x of [2.9, 4.3]) s.box(0.1, 0.5, 0.4, '#5a4030', x, 0.25, -1.5);
  s.sign(['GLACIER TARN', 'NO SWIMMING · 2°C'], -3, -4, 0.4, { w: 2, h: 0.9, post: 1.1, tex: { bg: '#2f4d57' } });
  return s;
}

function oldMine(l) {
  const s = new Site(l.x, l.y, l.z, -Math.PI / 2);
  s.box(3.4, 4, 9, '#0b0a09', 0, 1.6, -6.5, { collide: { hx: 1.7, hy: 2, hz: 4.5 } });
  s.box(0.4, 3.6, 0.4, '#5b4129', -1.5, 1.8, -2.1, { collide: true });
  s.box(0.4, 3.6, 0.4, '#5b4129', 1.5, 1.8, -2.1, { collide: true });
  s.box(4, 0.45, 0.5, '#5b4129', 0, 3.7, -2.1);
  s.box(5.6, 1.6, 1.2, '#8a7f72', 0, 4.6, -2.6, { shadow: true });
  for (let z = -2; z < 10; z += 1.1) s.box(1.6, 0.1, 0.24, '#5a4430', 0, 0.05, z, { shadow: false });
  for (const x of [-0.55, 0.55]) s.box(0.08, 0.1, 12, '#6c5a4e', x, 0.14, 4, { shadow: false });
  const cart = mat('#7a4a2a', { roughness: 0.6, metalness: 0.3 });
  s.box(1.3, 0.9, 1.9, cart, 0, 0.85, 5, { collide: { hx: 0.7, hy: 0.6, hz: 1.0, dy: -0.15 } });
  for (const [x, z] of [[-0.6, 4.4], [0.6, 4.4], [-0.6, 5.6], [0.6, 5.6]]) s.cyl(0.24, 0.24, 0.1, '#2f2a26', x, 0.3, z, { rz: Math.PI / 2 });
  s.box(1.1, 0.2, 1.6, '#6e6a63', 0, 1.25, 5);
  const pile = s.add(new THREE.ConeGeometry(3.5, 2.6, 9), mat('#8b857a', { flatShading: true }), 5.5, 1.1, 3, { collide: { hx: 2.3, hy: 1.2, hz: 2.3 } });
  pile.scale.z = 0.8;
  s.sign(['OLD MINE', 'DANGER · KEEP OUT'], -3.4, 3.5, 0.5, { w: 2.1, h: 0.9, post: 1.1, tex: { bg: '#3d2c22', accent: '#ffcf3d' } });
  return s;
}

function larchGrove(l) {
  const s = new Site(l.x, l.y, l.z, 0.4);
  s.sign(['LARCH GROVE', 'GOLD IN SEPTEMBER'], 0, 0, 0, { w: 2.1, h: 0.9, post: 1.1 });
  s.cyl(0.25, 0.25, 2.4, '#6a4a30', 0, 0.3, 3, { rz: Math.PI / 2, collide: { hx: 1.2, hy: 0.3, hz: 0.3 } });
  return s;
}

function boulderGully(l) {
  const s = new Site(l.x, l.y, l.z, 0.6);
  s.cairn(5.5, 0, 1.1, 21);
  s.sign(['BOULDER GULLY', 'LOW RANGE · LOCK DIFFS'], 6, 3, -0.4, { w: 2.4, h: 1, post: 1.1, tex: { bg: '#5e2a1e', accent: '#ffd23f' } });
  return s;
}

function snowlineHut(l) {
  const s = new Site(l.x, l.y, l.z, Math.PI * 0.35);
  const stone = mat('#8f8a82', { flatShading: true, roughness: 1 });
  s.box(6, 2.8, 4.6, stone, 0, 1.4, 0, { collide: true });
  const roof = mat('#3f4c5c', { roughness: 0.45, metalness: 0.4 });
  s.box(6.8, 0.15, 5.6, roof, 0, 3.15, 0, { rx: 0.18 });
  s.box(1, 2, 0.1, '#c2402c', 1.2, 1, 2.33);
  windowPane(s, -1.4, 1.7, 2.33, 1, 0.8);
  s.box(2.2, 0.06, 1.2, '#1d2c44', -1, 3.5, -0.6, { rx: 0.5, shadow: false });
  s.cyl(0.04, 0.05, 4, '#bfc4c9', 2.6, 4.5, -1.8, { segs: 6 });
  s.box(2, 0.1, 0.45, '#7a5a3c', -1.4, 0.48, 3.2, { collide: { hx: 1, hy: 0.25, hz: 0.25, dy: -0.25 } });
  s.sign([`SNOWLINE HUT`, `ELEV ${Math.round(l.y + ALT_OFFSET).toLocaleString('en-US')} m`], 4.6, 3.2, -0.3, { w: 2, h: 0.9, post: 1.1 });
  return s;
}

function eagleCol(l) {
  const s = new Site(l.x, l.y, l.z, Math.PI);
  s.cairn(0, -4, 1.6, 9);
  s.sign(['EAGLE COL', `ELEV ${Math.round(l.y + ALT_OFFSET).toLocaleString('en-US')} m`, '↗ SUMMIT BEACON'], 5, -2, -0.25, { w: 2.6, h: 1.4, post: 1.2 });
  s.cyl(0.05, 0.06, 5, '#cfcfcf', -5, 2.5, -2, { collide: { hx: 0.1, hy: 2.5, hz: 0.1 } });
  const sock = s.add(new THREE.CylinderGeometry(0.28, 0.12, 1.6, 10, 1, true), new THREE.MeshStandardMaterial({ color: '#ff6a2a', side: THREE.DoubleSide }), -4.25, 4.75, -2, { rz: Math.PI / 2 + 0.25, shadow: false });
  s.windsock = sock;
  return s;
}

function summitBeacon(l) {
  const s = new Site(l.x, l.y, l.z, 0);
  const steel = mat('#c9ccd0', { metalness: 0.6, roughness: 0.4 });
  const H = 13;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = s.add(new THREE.BoxGeometry(0.12, H, 0.12), steel, x * 0.6, H / 2, z * 0.6, { rx: -z * 0.07, rz: x * 0.07 });
    leg.castShadow = true;
  }
  for (let y = 1.5; y < H; y += 2) {
    const w = 2.2 * (1 - y / H) + 0.6;
    for (const r of [0, Math.PI / 2]) s.box(w, 0.07, 0.07, steel, 0, y, 0, { ry: r, shadow: false });
  }
  s.collide(0, H / 2, 0, 1.2, H / 2, 1.2, 0, 'rock');
  const light = new THREE.MeshStandardMaterial({ color: '#ff3b2f', emissive: '#ff2a1f', emissiveIntensity: 3 });
  const bulb = s.add(new THREE.SphereGeometry(0.22, 12, 8), light, 0, H + 0.2, 0, { shadow: false });
  s.blinkers.push(bulb);
  s.box(1.6, 1.4, 1.2, '#dfe2e4', 2.6, 0.7, 1.4, { collide: true });
  s.box(1.8, 0.06, 1.1, '#1d2c44', -2.4, 1.1, 1.8, { rx: -0.6, shadow: false });
  s.box(0.08, 1, 0.08, '#888', -2.4, 0.5, 1.4);
  s.cairn(-2, -3, 0.8, 4);
  return s;
}

const BUILDERS = {
  basecamp: baseCamp,
  cabin: rangerCabin,
  tarn: tarnDock,
  mine: oldMine,
  larch: larchGrove,
  gully: boulderGully,
  hut: snowlineHut,
  col: eagleCol,
  beacon: summitBeacon,
};

export function buildProps(T, scene) {
  const sites = [];
  const colliders = [];
  for (const l of T.landmarks) {
    const site = BUILDERS[l.id](l, T);
    scene.add(site.group);
    sites.push(site);
    colliders.push(...site.colliders);
  }
  const glows = sites.flatMap((s) => s.glows);
  const flames = sites.flatMap((s) => s.flames);
  const blinkers = sites.flatMap((s) => s.blinkers);
  const fire = sites.find((s) => s.fireLight)?.fireLight;
  const sock = sites.find((s) => s.windsock)?.windsock;
  return {
    colliders,
    update(time, night) {
      for (const g of glows) g.material.emissiveIntensity = night * 1.6;
      flames.forEach((f, i) => {
        const k = 0.75 + 0.25 * Math.sin(time * (9 + i * 3) + i) * Math.sin(time * 5.3 + i);
        f.scale.set(k, 0.8 + 0.35 * k, k);
      });
      if (fire) fire.intensity = night * (14 + 4 * Math.sin(time * 13) * Math.sin(time * 7.7));
      for (const b of blinkers) b.material.emissiveIntensity = (Math.sin(time * 3.2) > 0.2 ? 4 : 0.2) * (0.4 + night * 0.6);
      if (sock) sock.rotation.y = Math.sin(time * 0.7) * 0.25;
    },
  };
}
