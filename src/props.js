// Landmark set-pieces: base camp, the ranger cabin, the dock on the tarn, the
// old mine, signs and cairns, the snowline hut and the summit beacon.
// Each one also reports colliders (world space boxes or convex hulls) for the
// physics world. The mine, the hut and the dock were blocked out in Blender on
// the real terrain first (see DECISIONS.md); what ships is only this code.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';
import { rockShape } from './flora.js';

export const ALT_OFFSET = 2140;

const mats = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  return mats.get(key);
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

function lampMat() {
  return new THREE.MeshStandardMaterial({ color: '#ffd59a', emissive: '#ffb45e', emissiveIntensity: 0, roughness: 0.4 });
}

/** Coursed rubble stone with mortar joints; tiles in both directions. */
function stoneTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const rand = mulberry32(17);
  g.fillStyle = '#5f5a53';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) {
    let x = rand() * 40;
    const end = x + 256;
    while (x < end) {
      const w = Math.min(34 + rand() * 46, end - x - 3);
      const v = 150 + rand() * 60;
      const warm = rand() * 16;
      for (const ox of [x, x - 256]) {
        g.fillStyle = `rgb(${v + warm | 0},${v + warm * 0.5 | 0},${v - warm * 0.3 | 0})`;
        g.fillRect(ox + 2, y + 2, w - 1, 28);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(ox + 2, y + 2, w - 1, 4);
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.fillRect(ox + 2, y + 25, w - 1, 5);
      }
      x += w + 3;
    }
  }
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.08)';
    g.fillRect(rand() * 256, rand() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Box-projected UVs in site space, so masonry keeps one scale across parts. */
function boxMapUV(geo, size) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ax >= ay && ax >= az ? [p.getZ(i), p.getY(i)] : ay >= az ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u / size;
    uv[i * 2 + 1] = v / size;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Primitives that share one material, merged into a single mesh (one draw call). */
class Batch {
  constructor(site) {
    this.site = site;
    this.geos = [];
  }

  /** parent: an extra Matrix4 applied after the part's own placement. collide: a box, or 'hull'. */
  add(geo, x, y, z, { rx = 0, ry = 0, rz = 0, parent = null, collide = null } = {}) {
    _m4.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), ONE);
    if (parent) _m4.premultiply(parent);
    geo.applyMatrix4(_m4);
    this.geos.push(geo);
    if (collide === 'hull') this.site.collideHull(geo.attributes.position.array, 'wood');
    else if (collide) this.site.collide(x + (collide.dx || 0), y + (collide.dy || 0), z + (collide.dz || 0), collide.hx, collide.hy, collide.hz, ry, collide.kind);
    return this;
  }

  box(w, h, d, x, y, z, opts = {}) {
    const collide = opts.collide === true ? { hx: w / 2, hy: h / 2, hz: d / 2 } : opts.collide;
    return this.add(new THREE.BoxGeometry(w, h, d), x, y, z, { ...opts, collide });
  }

  cyl(r1, r2, h, x, y, z, opts = {}) {
    return this.add(new THREE.CylinderGeometry(r1, r2, h, opts.segs || 10), x, y, z, opts);
  }

  /** uvScale: metres per texture tile for box-projected UVs. */
  build(material, { shadow = true, uvScale = 0, parent = this.site.group } = {}) {
    const geo = mergeGeometries(this.geos.map((g) => (g.index ? g.toNonIndexed() : g)));
    if (uvScale) boxMapUV(geo, uvScale);
    const m = new THREE.Mesh(geo, material);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
}

let rockShapes = null;

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
    const font = (px) => `${big ? 800 : 700} ${px}px "Archivo Narrow", "Noto Sans KR", sans-serif`;
    const size = big ? Math.min(64, step * 0.62) : Math.min(40, step * 0.5);
    g.font = font(size);
    // Whatever font the browser falls back to, keep the line inside the frame.
    const room = w - 64, width = g.measureText(ln).width;
    if (width > room) g.font = font(size * (room / width));
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
  constructor(x, y, z, yaw, T) {
    this.T = T;
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.group.updateMatrix();
    this.colliders = [];
    this.glows = [];
    this.flames = [];
    this.blinkers = [];
  }

  /** Terrain height under a local point, relative to the site origin. */
  ground(lx, lz) {
    _v.set(lx, 0, lz).applyMatrix4(this.group.matrix);
    return this.T.heightAt(_v.x, _v.z) - this.group.position.y;
  }

  batch() { return new Batch(this); }

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

  /** A convex-hull collider around points (x, y, z triples) in local space. */
  collideHull(points, kind = 'rock') {
    // Rapier cannot hull fewer than four points; a heap that ends up buried has no collider.
    if (points.length < 12) return;
    const out = new Float32Array(points.length);
    for (let i = 0; i < points.length; i += 3) _v.fromArray(points, i).applyMatrix4(this.group.matrix).toArray(out, i);
    this.colliders.push({ hull: out, kind });
  }

  /** Boulders like the valley's own: [x, z, size, squash] resting on the ground, one mesh. */
  rocks(list, color, { seed = 1, collide = true } = {}) {
    rockShapes ||= [5, 6, 7].map((k) => rockShape(k));
    const rand = mulberry32(seed);
    const b = this.batch();
    for (const [x, z, size, squash = 0.8] of list) {
      const shape = rockShapes[Math.floor(rand() * rockShapes.length)];
      _m4.compose(_v.set(x, this.ground(x, z) + size * 0.15, z), _q.setFromEuler(_e.set(0, rand() * 6.28, 0)), _s.set(size, size * squash, size));
      const geo = shape.geometry.clone().applyMatrix4(_m4);
      b.geos.push(geo);
      if (collide) {
        const hull = shape.hull.slice();
        for (let i = 0; i < hull.length; i += 3) _v.fromArray(hull, i).applyMatrix4(_m4).toArray(hull, i);
        this.collideHull(hull);
      }
    }
    return b.build(mat(color, { flatShading: true, roughness: 0.95 }));
  }

  sign(lines, x, z, ry = 0, opts = {}) {
    const w = opts.w || 2.2, h = opts.h || 1.1, post = opts.post || 1.5;
    const g = new THREE.Group();
    const y0 = this.ground(x, z);
    g.position.set(x, y0, z);
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
    this.collide(x, y0 + (post + h) / 2, z, w / 2, (post + h) / 2, 0.12, ry);
  }

  cairn(x, z, size = 1, seed = 1) {
    const rand = mulberry32(seed);
    const y0 = this.ground(x, z);
    let y = 0;
    for (let i = 0; i < 6; i++) {
      const r = (0.75 - i * 0.1) * size;
      const g = new THREE.IcosahedronGeometry(r, 0);
      const m = this.add(g, mat('#9a968f', { flatShading: true }), x + (rand() - 0.5) * 0.1, y0 + y + r * 0.55, z, { ry: rand() * 6 });
      m.scale.y = 0.6;
      y += r * 1.05;
    }
    this.collide(x, y0 + y / 2, z, 0.75 * size, y / 2, 0.75 * size, 0, 'rock');
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
  const s = new Site(l.x, l.y, l.z, Math.PI * 0.85, T);
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

function rangerCabin(l, T) {
  const s = new Site(l.x, l.y, l.z, Math.PI / 2, T);
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

/**
 * An open canoe hull along z, gunwale at y = 0: the beam narrows to the stems
 * and the sheer rises toward them. inside: the inner skin, facing inward.
 */
function canoeGeometry(inside, { length = 4.6, beam = 0.84, depth = 0.36, rise = 0.2 } = {}) {
  const NU = 24, NV = 8;
  const pos = [];
  for (let i = 0; i <= NU; i++) {
    const u = -1 + (2 * i) / NU;
    const w = (beam / 2) * Math.max(0, 1 - Math.abs(u) ** 2.2) ** 0.6 * (inside ? 0.94 : 1);
    const d = depth * (1 - 0.3 * u * u);
    const top = rise * u ** 4 + (inside ? 0.025 : 0);
    for (let j = 0; j <= NV; j++) {
      const p = (Math.PI * j) / NV;
      pos.push(-w * Math.cos(p), top - d * Math.sin(p) ** 0.7, (u * length) / 2 * (inside ? 0.985 : 1));
    }
  }
  const idx = [];
  for (let i = 0; i < NU; i++) {
    for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j, b = a + NV + 1;
      if (inside) idx.push(a, b, b + 1, a, b + 1, a + 1);
      else idx.push(a + 1, b + 1, b, a + 1, b, a);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function tarnDock(l, T) {
  const L = T.lake;
  const yaw = Math.atan2(L.x - l.x, L.z - l.z);
  const s = new Site(l.x, l.y, l.z, yaw, T);
  // A plank pier from the shore pad out over the water, with a T head.
  const Z0 = 6, Z1 = 21.6, HEAD = 3;
  const deck = Math.max(s.ground(0, Z0) + 0.24, T.waterY - l.y + 0.8);
  const rand = mulberry32(7);
  const planks = s.batch();
  for (let z = Z0; z < Z1 + HEAD; z += 0.31) {
    const w = (z >= Z1 ? 5.2 : 2.4) + (rand() - 0.5) * 0.08;
    planks.box(w, 0.06, 0.27, (rand() - 0.5) * 0.05, deck - 0.03 + (rand() - 0.5) * 0.012, z + 0.14, { ry: (rand() - 0.5) * 0.02 });
  }
  const ramp = 1.3;
  planks.box(2.4, 0.06, Math.hypot(deck, ramp), 0, deck / 2 - 0.03, Z0 - ramp / 2, { rx: -Math.atan2(deck, ramp), collide: 'hull' });
  planks.build(mat('#8d6a48'));
  s.collide(0, deck - 0.15, (Z0 + Z1) / 2, 1.2, 0.15, (Z1 - Z0) / 2);
  s.collide(0, deck - 0.15, Z1 + HEAD / 2, 2.6, 0.15, HEAD / 2);
  const beams = s.batch();
  for (const sx of [-1, 1]) {
    beams.box(0.16, 0.24, Z1 + HEAD - Z0, sx * 0.95, deck - 0.18, (Z0 + Z1 + HEAD) / 2);
    beams.box(0.12, 0.12, Z1 - 13, sx * 1.14, deck + 0.06, (13 + Z1) / 2, { collide: true });
  }
  for (const z of [Z1 + 0.1, Z1 + HEAD - 0.1]) beams.box(5.2, 0.24, 0.16, 0, deck - 0.18, z);
  beams.box(2.8, 0.25, 0.3, 0, s.ground(0, Z0 + 0.1), Z0 + 0.1);
  beams.box(0.1, 1.5, 0.1, 2.45, deck + 0.75, Z1 + 0.15);
  beams.build(mat('#5a4030'));
  // Pilings down to the lake bed; at the head corners they stand proud as mooring posts.
  const piles = s.batch();
  const spots = [];
  for (let z = 8; z < Z1; z += 2.4) spots.push([-1.05, z, 0], [1.05, z, 0]);
  for (const z of [Z1 + 0.15, Z1 + HEAD - 0.15]) spots.push([-2.45, z, 0.55], [2.45, z, 0.55]);
  for (const [x, z, proud] of spots) {
    const g = s.ground(x, z) - 0.3, top = deck + proud;
    piles.cyl(0.11, 0.12, top - g, x, (top + g) / 2, z, { segs: 8, collide: proud ? { hx: 0.12, hy: proud / 2, hz: 0.12, dy: (top - g - proud) / 2 } : null });
  }
  piles.build(mat('#4d3626'));
  const ladder = s.batch();
  for (const sx of [-1, 1]) ladder.box(0.06, 1.4, 0.06, sx * 0.25, deck - 0.5, Z1 + HEAD + 0.08);
  for (let k = 0; k < 4; k++) ladder.box(0.5, 0.04, 0.04, 0, deck - 0.05 - k * 0.3, Z1 + HEAD + 0.08);
  ladder.build(mat('#9aa3ad', { metalness: 0.5, roughness: 0.4 }));
  s.glow(s.add(new THREE.BoxGeometry(0.2, 0.28, 0.2), lampMat(), 2.45, deck + 1.62, Z1 + 0.15, { shadow: false }));
  // A canoe pulled up on the shore, right side up, paddle inside.
  const canoe = new THREE.Group();
  canoe.position.set(-4.2, s.ground(-4.2, 8.6) + 0.38, 8.6);
  canoe.rotation.set(0, 0.35, 0.04);
  for (const inside of [false, true]) {
    const m = new THREE.Mesh(canoeGeometry(inside), mat(inside ? '#b88a55' : '#c9452f', { roughness: inside ? 0.8 : 0.5 }));
    m.castShadow = !inside;
    m.receiveShadow = true;
    canoe.add(m);
  }
  const thwarts = s.batch();
  for (const u of [-0.5, 0, 0.5]) {
    const w = 0.84 * (1 - Math.abs(u) ** 2.2) ** 0.6;
    thwarts.box(w, 0.04, u ? 0.2 : 0.07, 0, u ? -0.06 : 0, u * 2.3);
  }
  thwarts.box(0.06, 0.03, 1.3, 0.1, -0.02, -0.6, { ry: 0.15 });
  thwarts.build(mat('#a77a4a'), { parent: canoe });
  s.group.add(canoe);
  s.collide(-4.2, canoe.position.y - 0.18, 8.6, 0.45, 0.2, 2.3, 0.35);
  s.box(1.8, 0.1, 0.45, '#7a5a3c', 3.6, 0.5, -1.5, { collide: { hx: 0.9, hy: 0.25, hz: 0.25, dy: -0.25 } });
  for (const x of [2.9, 4.3]) s.box(0.1, 0.5, 0.4, '#5a4030', x, 0.25, -1.5);
  s.sign(['GLACIER TARN', 'NO SWIMMING · 2°C'], -3, -4, 0.4, { w: 2, h: 0.9, post: 1.1, tex: { bg: '#2f4d57' } });
  return s;
}

/**
 * A waste-rock heap tipped onto a slope: a mound whose depth above the ground
 * tapers to nothing at its rim, stretched downhill like a talus fan. Its rim
 * always meets the terrain, however the slope falls away. Returns the mesh
 * geometry and the points of its exposed part (for a hull collider).
 */
function heapGeometry(s, cx, cz, depth, radius, seed) {
  const RINGS = 12, SEGS = 22;
  const rand = mulberry32(seed);
  const downhill = Math.atan2(s.ground(cx - 1, cz) - s.ground(cx + 1, cz), s.ground(cx, cz - 1) - s.ground(cx, cz + 1));
  const g0 = s.ground(cx, cz);
  const pos = [cx, g0 + depth, cz];
  const exposed = [cx, g0 + depth, cz, cx, g0, cz];
  for (let k = 1; k <= RINGS; k++) {
    const t = k / RINGS;
    for (let j = 0; j < SEGS; j++) {
      const a = ((j + (rand() - 0.5) * 0.4) / SEGS) * Math.PI * 2;
      const reach = radius * (1 + 0.5 * Math.max(0, Math.cos(a - downhill)));
      const r = reach * t * (1 + (k < RINGS ? (rand() - 0.5) * 0.12 : 0));
      const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      const g = s.ground(x, z);
      const y = k < RINGS ? g + depth * (1 - t) ** 1.5 + (rand() - 0.5) * 0.16 : g - 0.15;
      pos.push(x, y, z);
      if (y > g + 0.05) exposed.push(x, y, z, x, g, z);
    }
  }
  const idx = [];
  for (let j = 0; j < SEGS; j++) idx.push(0, 1 + j, 1 + ((j + 1) % SEGS));
  for (let k = 1; k < RINGS; k++) {
    const a = 1 + (k - 1) * SEGS, b = a + SEGS;
    for (let j = 0; j < SEGS; j++) {
      const n = (j + 1) % SEGS;
      idx.push(a + j, b + n, a + n, a + j, b + j, b + n);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, exposed };
}

function oldMine(l, T) {
  const s = new Site(l.x, l.y, l.z, -Math.PI / 2, T);
  // The site sits on the slope between the trail's end (below, +z) and a bench
  // cut into the hillside (above, -z). The adit opens at the back of the bench;
  // its track runs out over a trestle and tips onto a waste heap.
  const PX = 2.5, FZ = -7.6;
  const FY = s.ground(PX, FZ + 0.3);
  const timber = s.batch();

  // Portal: a battered stone headwall, a timber set and a lagged mouth.
  const stone = s.batch();
  for (const sx of [-1, 1]) stone.box(2, 3.6, 0.9, PX + sx * 2.5, FY + 1.5, FZ - 0.6, { rx: -0.12 });
  stone.box(4.9, 1.5, 0.9, PX, FY + 3.85, FZ - 0.95, { rx: -0.12 });
  stone.build(new THREE.MeshStandardMaterial({ map: stoneTexture(), color: '#ddd6cb', roughness: 0.95 }), { uvScale: 2.4 });
  s.collide(PX, FY + 1.8, FZ - 0.8, 3.5, 1.8, 0.6, 0, 'rock');
  for (const sx of [-1, 1]) timber.box(0.32, 2.95, 0.32, PX + sx * 1.36, FY + 1.47, FZ + 0.12, { rz: -sx * 0.035 });
  timber.box(3.5, 0.38, 0.42, PX, FY + 3.08, FZ + 0.12);
  // The hillside rises into the opening, so the darkness hangs just behind the set.
  const lagging = s.batch();
  for (const sx of [-1, 1]) lagging.box(0.08, 2.85, 0.45, PX + sx * 1.3, FY + 1.42, FZ - 0.22);
  lagging.box(2.7, 0.1, 0.45, PX, FY + 2.85, FZ - 0.22);
  lagging.build(mat('#2a1f17'), { shadow: false });
  s.box(2.7, 2.9, 0.1, '#0b0a09', PX, FY + 1.45, FZ - 0.42, { shadow: false });
  s.glow(s.add(new THREE.BoxGeometry(0.18, 0.28, 0.18), lampMat(), PX + 1, FY + 2.7, FZ + 0.42, { shadow: false }));
  // Rubble that ties the headwall into the hillside.
  s.rocks([[-1.9, -7.8, 1.7, 0.96], [6.9, -7.6, 1.9, 1.04], [0.6, -9.5, 1.6], [4.6, -9.4, 1.8, 0.88], [-1.2, -8.9, 1.3], [6.4, -8.8, 1.4]], '#8f8b84', { seed: 30 });

  // Track: a ballast bed across the bench, then a trestle over the drop.
  s.box(2, 1.2, 4.4, '#8d8273', PX, FY - 0.6, -5.4, { collide: { hx: 1, hy: 0.6, hz: 2.2, kind: 'gravel' } });
  for (let z = FZ - 1.6; z < 1.5; z += 0.75) timber.box(1.7, 0.1, 0.22, PX, FY + 0.05, z);
  const rails = s.batch();
  for (const sx of [-1, 1]) rails.box(0.07, 0.1, 11, PX + sx * 0.5, FY + 0.15, -4);
  rails.build(mat('#6c5a4e', { metalness: 0.4, roughness: 0.5 }));
  for (const sx of [-1, 1]) timber.box(0.25, 0.35, 4.9, PX + sx * 0.6, FY - 0.18, -0.75);
  s.collide(PX, FY - 0.15, -0.75, 0.85, 0.2, 2.45);
  const top = FY - 0.35;
  for (const zb of [-2.2, -0.4, 1.4]) {
    const gl = s.ground(PX - 0.85, zb) - 0.2, gr = s.ground(PX + 0.85, zb) - 0.2;
    for (const [sx, g] of [[-1, gl], [1, gr]]) timber.box(0.24, top - g, 0.24, PX + sx * 0.85, (top + g) / 2, zb);
    timber.box(2.1, 0.25, 0.28, PX, FY - 0.48, zb);
    const lo = Math.max(gl, gr) + 0.3, h = top - 0.2 - lo;
    if (h > 0.6) {
      const a = Math.atan2(h, 1.7), len = Math.hypot(h, 1.7);
      for (const sd of [-1, 1]) timber.box(0.1, len, 0.08, PX, lo + h / 2, zb + sd * 0.07, { rz: sd * (Math.PI / 2 - a) });
    }
    const g = Math.min(gl, gr);
    s.collide(PX, (top + g) / 2, zb, 0.97, (top - g) / 2, 0.14);
  }
  timber.box(1.6, 0.3, 0.3, PX, FY + 0.35, 1.62, { collide: true });
  for (const sx of [-1, 1]) timber.box(0.2, 0.7, 0.2, PX + sx * 0.7, FY + 0.15, 1.62);
  // The ore chute off the end, turned toward the heap.
  const turn = 0.75, tilt = 0.7;
  const chute = new THREE.Matrix4().compose(
    _v.set(PX + Math.sin(turn) * 1.1, FY - 0.35 - Math.sin(tilt) * 1.1, 1.75 + Math.cos(turn) * 1.1),
    _q.setFromEuler(new THREE.Euler(tilt, turn, 0, 'YXZ')),
    ONE,
  );
  timber.box(0.9, 0.06, 2.6, 0, 0, 0, { parent: chute });
  for (const sx of [-1, 1]) timber.box(0.06, 0.35, 2.6, sx * 0.45, 0.17, 0, { parent: chute });
  // A stack of mine props waiting on the bench.
  const pile = new THREE.Matrix4().compose(_v.set(-0.4, s.ground(-0.4, -5.6), -5.6), _q.setFromEuler(_e.set(0, 0.25, 0)), ONE);
  for (let i = 0; i < 5; i++) timber.box(0.22, 0.22, 3.2, -0.26 + (i % 3) * 0.26 + (i >= 3 ? 0.13 : 0), 0.11 + (i >= 3 ? 0.22 : 0), 0, { parent: pile });
  s.collide(-0.4, s.ground(-0.4, -5.6) + 0.22, -5.6, 0.45, 0.22, 1.6, 0.25);
  timber.build(mat('#5b4129'));

  // An ore car on the trestle.
  const CZ = -0.9;
  const steel = s.batch();
  for (const sx of [-1, 1]) for (const dz of [-0.45, 0.45]) steel.cyl(0.2, 0.2, 0.1, PX + sx * 0.5, FY + 0.42, CZ + dz, { rz: Math.PI / 2, segs: 12 });
  steel.box(1.2, 0.18, 1.5, PX, FY + 0.62, CZ);
  steel.cyl(1.42 / Math.SQRT2, 1.38 / Math.SQRT2, 0.08, PX, FY + 1.43, CZ, { ry: Math.PI / 4, segs: 4 });
  steel.build(mat('#3a3330', { metalness: 0.5, roughness: 0.55, flatShading: true }));
  s.add(new THREE.CylinderGeometry(1.35 / Math.SQRT2, 1 / Math.SQRT2, 0.75, 4), mat('#7a4a2a', { roughness: 0.6, metalness: 0.3, flatShading: true }), PX, FY + 1.085, CZ, { ry: Math.PI / 4 });
  s.box(1.2, 0.05, 1.2, '#4a4642', PX, FY + 1.36, CZ, { shadow: false });
  s.collide(PX, FY + 0.9, CZ, 0.7, 0.55, 0.78);

  // The waste heap under the chute, with a few big lumps rolled to its foot.
  _v.set(0, 0, 1.3).applyMatrix4(chute);
  const heap = heapGeometry(s, _v.x + 0.3, _v.z + 0.3, 1.7, 2.5, 5);
  s.add(heap.geo, mat('#93887a', { flatShading: true, roughness: 1 }), 0, 0, 0);
  s.collideHull(heap.exposed, 'scree');
  s.rocks([[4.4, 5.2, 0.55, 0.7], [7, 4.2, 0.7, 0.7], [5.8, 6.2, 0.45, 0.7], [3.5, 3.6, 0.4, 0.7]], '#9a9286', { seed: 50, collide: false });
  s.sign(['OLD MINE', 'DANGER · KEEP OUT'], -3.4, 3.5, 0.5, { w: 2.1, h: 0.9, post: 1.1, tex: { bg: '#3d2c22', accent: '#ffcf3d' } });
  return s;
}

function larchGrove(l, T) {
  const s = new Site(l.x, l.y, l.z, 0.4, T);
  s.sign(['LARCH GROVE', 'GOLD IN SEPTEMBER'], 0, 0, 0, { w: 2.1, h: 0.9, post: 1.1 });
  s.cyl(0.25, 0.25, 2.4, '#6a4a30', 0, s.ground(0, 3) + 0.22, 3, { rz: Math.PI / 2, collide: { hx: 1.2, hy: 0.3, hz: 0.3 } });
  return s;
}

function boulderGully(l, T) {
  const s = new Site(l.x, l.y, l.z, 0.6, T);
  s.cairn(5.5, 0, 1.1, 21);
  s.sign(['BOULDER GULLY', 'LOW RANGE · LOCK DIFFS'], 6, 3, -0.4, { w: 2.4, h: 1, post: 1.1, tex: { bg: '#5e2a1e', accent: '#ffd23f' } });
  return s;
}

function snowlineHut(l, T) {
  const s = new Site(l.x, l.y, l.z, Math.PI * 0.35, T);
  // A stone refuge: gable roof with the ridge along x, snow held at the eave.
  const W = 6, D = 4.6, E = 2.6, R = 4.1;
  const tex = stoneTexture();
  const walls = s.batch();
  const profile = new THREE.Shape([[-D / 2, 0], [D / 2, 0], [D / 2, E], [0, R], [-D / 2, E]].map(([x, y]) => new THREE.Vector2(x, y)));
  walls.add(new THREE.ExtrudeGeometry(profile, { depth: W, bevelEnabled: false }), -W / 2, 0, 0, { ry: Math.PI / 2 });
  walls.box(0.7, 1.9, 0.7, -1.8, R - 0.05, -0.9);
  walls.build(new THREE.MeshStandardMaterial({ map: tex, color: '#d3cdc4', roughness: 0.95 }), { uvScale: 2.4 });
  s.collide(0, 1.4, 0, W / 2 + 0.15, 1.4, D / 2 + 0.15, 0, 'rock');
  const plinth = s.batch().box(W + 0.3, 0.4, D + 0.3, 0, 0.1, 0).box(0.9, 0.1, 0.9, -1.8, R + 0.95, -0.9);
  plinth.build(new THREE.MeshStandardMaterial({ map: tex, color: '#8c867e', roughness: 1 }), { uvScale: 2.4 });
  const quoins = s.batch();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const long = k % 2 === 0;
        quoins.box(long ? 0.62 : 0.34, 0.4, long ? 0.34 : 0.62, sx * (W / 2 - (long ? 0.29 : 0.15) + 0.03), 0.42 + k * 0.42, sz * (D / 2 - (long ? 0.15 : 0.29) + 0.03));
      }
    }
  }
  quoins.build(mat('#b9b2a6', { roughness: 0.95 }));
  // Each roof slab hangs from the ridge and runs out past the eave.
  const th = Math.atan2(R - E, D / 2), L = Math.hypot(D / 2, R - E) + 0.5, t = 0.16;
  const along = (sz, k, off) => [R - Math.sin(th) * k + Math.cos(th) * off, sz * (Math.cos(th) * k + Math.sin(th) * off)];
  const roof = s.batch(), snow = s.batch(), steel = s.batch();
  for (const sz of [-1, 1]) {
    const [y, z] = along(sz, L / 2, t / 2);
    roof.box(W + 0.8, t, L, 0, y, z, { rx: sz * th });
    if (sz < 0) {
      const [sy, szz] = along(sz, L / 2 + 0.15, t / 2 + 0.15);
      snow.box(W + 0.6, 0.14, L - 0.5, 0, sy, szz, { rx: sz * th });
    } else {
      const [sy, szz] = along(sz, L * 0.8, t + 0.08);
      snow.box(W + 0.6, 0.16, L * 0.26, 0, sy, szz, { rx: sz * th });
      const [gy, gz] = along(sz, L * 0.93, t + 0.18);
      steel.cyl(0.035, 0.035, W + 0.4, 0, gy, gz, { rz: Math.PI / 2, segs: 6 });
    }
  }
  roof.box(W + 0.9, 0.14, 0.42, 0, R + 0.16, 0);
  roof.box(1.7, 0.08, 0.9, 1.2, 2.72, D / 2 + 0.42, { rx: 0.3 });
  roof.build(mat('#3f4c5c', { roughness: 0.45, metalness: 0.4 }));
  snow.build(mat('#f2f5f8', { roughness: 0.6 }));
  const [py, pz] = along(1, L * 0.35, t + 0.04);
  s.box(1.5, 0.05, 1, '#1d2c44', -1.4, py, pz, { rx: th, shadow: false });
  // Antenna mast on the east gable.
  steel.cyl(0.04, 0.05, 4.6, W / 2 + 0.25, 3, -1.5, { segs: 6 });
  for (let k = 0; k < 2; k++) steel.box(0.04, 0.04, 0.9, W / 2 + 0.25, 4.4 + k * 0.6, -1.5);
  steel.build(mat('#9aa3ad', { metalness: 0.5, roughness: 0.4 }));
  // Door, shuttered window, a bench under it and firewood by the west wall.
  const red = s.batch().box(1, 2, 0.08, 1.2, 1.2, D / 2 + 0.03);
  for (const sx of [-1, 1]) red.box(0.5, 0.86, 0.05, -1.4 + sx * 0.78, 1.7, D / 2 + 0.06);
  red.build(mat('#c2402c'));
  const wood = s.batch();
  for (const sx of [-1, 1]) wood.box(0.12, 2.15, 0.12, 1.2 + sx * 0.56, 1.27, D / 2 + 0.04);
  wood.box(1.3, 0.14, 0.14, 1.2, 2.35, D / 2 + 0.04);
  wood.box(2, 0.08, 0.42, -1.4, 0.48, D / 2 + 0.55, { collide: { hx: 1, hy: 0.25, hz: 0.25, dy: -0.25 } });
  for (const sx of [-1, 1]) wood.box(0.1, 0.44, 0.36, -1.4 + sx * 0.8, 0.22, D / 2 + 0.55);
  wood.build(mat('#6e5238'));
  windowPane(s, -1.4, 1.7, D / 2 + 0.02, 1, 0.8);
  windowPane(s, W / 2 + 0.02, 3.15, 0, 0.6, 0.5, Math.PI / 2);
  const logs = s.batch();
  for (let i = 0; i < 9; i++) logs.cyl(0.12, 0.12, 1, -W / 2 - 0.2 - Math.floor(i / 3) * 0.26, 0.14 + (i % 3) * 0.24, -1.2, { rx: Math.PI / 2, segs: 7 });
  logs.build(mat('#7b5a3a'));
  s.collide(-W / 2 - 0.46, 0.4, -1.2, 0.4, 0.4, 0.5);
  s.rocks([[-4.2, 2.6, 0.9], [4.4, -2.9, 1.1], [-4.4, -2.2, 0.7]], '#8f8b84', { seed: 70 });
  s.sign([`SNOWLINE HUT`, `ELEV ${Math.round(l.y + ALT_OFFSET).toLocaleString('en-US')} m`], 4.6, 3.2, -0.3, { w: 2, h: 0.9, post: 1.1 });
  return s;
}

function eagleCol(l, T) {
  const s = new Site(l.x, l.y, l.z, Math.PI, T);
  s.cairn(0, -4, 1.6, 9);
  s.sign(['EAGLE COL', `ELEV ${Math.round(l.y + ALT_OFFSET).toLocaleString('en-US')} m`, '↗ SUMMIT BEACON'], 5, -2, -0.25, { w: 2.6, h: 1.4, post: 1.2 });
  s.cyl(0.05, 0.06, 5, '#cfcfcf', -5, 2.5, -2, { collide: { hx: 0.1, hy: 2.5, hz: 0.1 } });
  const sock = s.add(new THREE.CylinderGeometry(0.28, 0.12, 1.6, 10, 1, true), new THREE.MeshStandardMaterial({ color: '#ff6a2a', side: THREE.DoubleSide }), -4.25, 4.75, -2, { rz: Math.PI / 2 + 0.25, shadow: false });
  s.windsock = sock;
  return s;
}

function summitBeacon(l, T) {
  const s = new Site(l.x, l.y, l.z, 0, T);
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
