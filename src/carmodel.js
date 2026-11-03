// The expedition wagon, built from primitives: boxy body, cream roof, roof rack
// with gear, snorkel, bull bar, long-travel wheels. Forward is +z, left is +x.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WHEEL_R } from './vehicle.js';

const PAINT = '#c4532d';

function part(geo, material, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function tyreGeometry() {
  const pts = [];
  const r = WHEEL_R, w = 0.33;
  // Rounded tyre profile, revolved around the axle.
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    pts.push(new THREE.Vector2(r - 0.07 + Math.sin(a) * 0.07, -w / 2 + (1 - Math.cos(a)) * (w / 2)));
  }
  pts.unshift(new THREE.Vector2(r * 0.62, -w / 2));
  pts.push(new THREE.Vector2(r * 0.62, w / 2));
  const tyre = new THREE.LatheGeometry(pts, 28);
  tyre.rotateZ(Math.PI / 2);
  const blocks = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const b = new THREE.BoxGeometry(0.11, 0.05, 0.12);
      b.translate(side * 0.075 + (i % 2 ? 0.02 : -0.02), r - 0.005, 0);
      b.rotateX(a);
      blocks.push(b.toNonIndexed());
    }
  }
  const t = tyre.toNonIndexed();
  t.deleteAttribute('uv');
  for (const b of blocks) b.deleteAttribute('uv');
  return mergeGeometries([t, ...blocks]);
}

function rimGeometry() {
  const disc = new THREE.CylinderGeometry(WHEEL_R * 0.6, WHEEL_R * 0.6, 0.2, 16);
  disc.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.07, 0.09, 0.26, 8);
  hub.rotateZ(Math.PI / 2);
  const parts = [disc.toNonIndexed(), hub.toNonIndexed()];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.BoxGeometry(0.05, WHEEL_R * 0.5, 0.06);
    s.translate(0.11, WHEEL_R * 0.25, 0);
    s.rotateX((i / 6) * Math.PI * 2);
    parts.push(s.toNonIndexed());
  }
  for (const p of parts) p.deleteAttribute('uv');
  return mergeGeometries(parts);
}

export function buildCarModel() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshStandardMaterial({ color: PAINT, roughness: 0.42, metalness: 0.15 });
  const cream = new THREE.MeshStandardMaterial({ color: '#efe4cc', roughness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: '#1d1e20', roughness: 0.75 });
  const steel = new THREE.MeshStandardMaterial({ color: '#2b2d30', roughness: 0.45, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#2a3a44', roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.82 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d7d9dc', roughness: 0.2, metalness: 0.9 });
  const headMat = new THREE.MeshStandardMaterial({ color: '#fdf6e3', emissive: '#fff1c9', emissiveIntensity: 0.2, roughness: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: '#8a1410', emissive: '#ff2a1a', emissiveIntensity: 0.3, roughness: 0.3 });
  const amber = new THREE.MeshStandardMaterial({ color: '#f0a020', emissive: '#f08a10', emissiveIntensity: 0.2 });

  // --- body shell ------------------------------------------------------------
  body.add(part(new RoundedBoxGeometry(1.86, 0.78, 4.28, 3, 0.08), paint, 0, 0.32, 0.02));
  body.add(part(new RoundedBoxGeometry(1.8, 0.86, 2.75, 3, 0.07), cream, 0, 1.11, -0.5));
  body.add(part(new RoundedBoxGeometry(1.74, 0.12, 1.25, 2, 0.05), paint, 0, 0.75, 1.35));
  body.add(part(new THREE.BoxGeometry(0.5, 0.1, 0.9), black, 0, 0.82, 1.35));
  // pillars in body colour
  for (const x of [-0.86, 0.86]) {
    for (const z of [0.82, -0.05, -1.86]) body.add(part(new THREE.BoxGeometry(0.1, 0.72, 0.14), paint, x, 1.06, z));
  }
  // windows
  body.add(part(new THREE.BoxGeometry(1.62, 0.6, 0.04), glass, 0, 1.1, 0.86, -0.08));
  for (const x of [-0.905, 0.905]) {
    body.add(part(new THREE.BoxGeometry(0.03, 0.56, 0.78), glass, x, 1.12, 0.41));
    body.add(part(new THREE.BoxGeometry(0.03, 0.56, 1.66), glass, x, 1.12, -0.95));
  }
  body.add(part(new THREE.BoxGeometry(1.5, 0.52, 0.04), glass, 0, 1.15, -1.885));
  // grille, bumpers, bull bar
  body.add(part(new THREE.BoxGeometry(1.5, 0.42, 0.06), black, 0, 0.42, 2.17));
  for (let i = 0; i < 5; i++) body.add(part(new THREE.BoxGeometry(0.06, 0.34, 0.03), steel, -0.36 + i * 0.18, 0.42, 2.2));
  body.add(part(new THREE.BoxGeometry(1.96, 0.24, 0.26), steel, 0, 0.03, 2.22));
  body.add(part(new THREE.BoxGeometry(1.92, 0.22, 0.22), steel, 0, 0.02, -2.2));
  const tube = new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8);
  for (const x of [-0.55, 0.55]) body.add(part(tube, steel, x, 0.42, 2.38));
  body.add(part(new THREE.CylinderGeometry(0.035, 0.035, 1.14, 8), steel, 0, 0.78, 2.38, 0, 0, Math.PI / 2));
  body.add(part(new THREE.BoxGeometry(0.42, 0.14, 0.16), black, 0, 0.12, 2.36));
  // headlights and indicators
  const headGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.06, 18);
  for (const x of [-0.58, 0.58]) {
    body.add(part(headGeo, headMat, x, 0.45, 2.205, Math.PI / 2));
    body.add(part(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 18), chrome, x, 0.45, 2.19, Math.PI / 2));
    body.add(part(new THREE.BoxGeometry(0.12, 0.06, 0.03), amber, x * 1.38, 0.38, 2.19));
  }
  // light bar on the roof
  body.add(part(new THREE.BoxGeometry(1.1, 0.1, 0.12), black, 0, 1.72, 0.66));
  for (let i = 0; i < 4; i++) body.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10), headMat, -0.39 + i * 0.26, 1.72, 0.73, Math.PI / 2));
  // tail lights
  for (const x of [-0.82, 0.82]) body.add(part(new THREE.BoxGeometry(0.14, 0.3, 0.04), tailMat, x, 0.48, -2.17));
  // fender flares and rock sliders
  for (const x of [-0.95, 0.95]) {
    for (const z of [1.38, -1.38]) body.add(part(new RoundedBoxGeometry(0.16, 0.16, 1.15, 2, 0.05), black, x, 0.52, z));
    body.add(part(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8), steel, x * 1.0, -0.1, 0, Math.PI / 2));
  }
  // snorkel up the right A-pillar
  body.add(part(new THREE.CylinderGeometry(0.06, 0.06, 1.25, 10), black, -0.98, 0.98, 0.95));
  body.add(part(new THREE.BoxGeometry(0.16, 0.14, 0.22), black, -0.98, 1.64, 1.0));
  // mirrors
  for (const x of [-1.0, 1.0]) body.add(part(new THREE.BoxGeometry(0.06, 0.18, 0.14), black, x, 1.02, 0.86));
  // spare wheel on the tailgate
  const tyreGeo = tyreGeometry();
  const rimGeo = rimGeometry();
  const tyreMat = new THREE.MeshStandardMaterial({ color: '#232323', roughness: 0.92, flatShading: true });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#c2c6c9', roughness: 0.35, metalness: 0.7 });
  const spare = new THREE.Group();
  spare.add(new THREE.Mesh(tyreGeo, tyreMat), new THREE.Mesh(rimGeo, rimMat));
  spare.rotation.y = Math.PI / 2;
  spare.position.set(0, 0.95, -2.36);
  spare.traverse((o) => { o.castShadow = true; });
  body.add(spare);
  // ladder
  for (const x of [0.62, 0.9]) body.add(part(new THREE.BoxGeometry(0.03, 1.2, 0.03), steel, x, 1.05, -1.92));

  // --- roof rack and cargo ------------------------------------------------------------
  const rackY = 1.62;
  for (const x of [-0.82, 0.82]) body.add(part(new THREE.BoxGeometry(0.05, 0.05, 2.7), steel, x, rackY, -0.45));
  for (let z = -1.75; z <= 0.85; z += 0.43) body.add(part(new THREE.BoxGeometry(1.68, 0.04, 0.05), steel, 0, rackY - 0.02, z));
  const wood = new THREE.MeshStandardMaterial({ color: '#a77a4a', roughness: 0.8 });
  body.add(part(new RoundedBoxGeometry(0.75, 0.38, 0.6, 2, 0.04), wood, 0.35, rackY + 0.21, -1.25));
  body.add(part(new RoundedBoxGeometry(0.62, 0.32, 0.5, 2, 0.04), new THREE.MeshStandardMaterial({ color: '#4c6a3a', roughness: 0.7 }), -0.4, rackY + 0.18, -1.3));
  const can = new RoundedBoxGeometry(0.16, 0.42, 0.32, 2, 0.03);
  body.add(part(can, new THREE.MeshStandardMaterial({ color: '#3f5a2e', roughness: 0.6 }), -0.68, rackY + 0.23, -0.4));
  body.add(part(can, new THREE.MeshStandardMaterial({ color: '#b02a22', roughness: 0.5 }), -0.48, rackY + 0.23, -0.4));
  body.add(part(new THREE.CylinderGeometry(0.17, 0.17, 1.4, 12), new THREE.MeshStandardMaterial({ color: '#2f5f73', roughness: 0.8 }), 0.2, rackY + 0.19, -0.3, 0, 0, Math.PI / 2));
  const boards = new THREE.MeshStandardMaterial({ color: '#f2b324', roughness: 0.6 });
  body.add(part(new THREE.BoxGeometry(0.34, 0.06, 1.2), boards, 0.55, rackY + 0.05, 0.4));
  body.add(part(new THREE.BoxGeometry(0.34, 0.06, 1.2), boards, -0.15, rackY + 0.05, 0.4));
  body.add(part(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), new THREE.MeshStandardMaterial({ color: '#d2a050' }), -0.55, rackY + 0.08, 0.35, Math.PI / 2));

  // --- under-body (axles, diffs) and wheels -------------------------------------------
  const under = new THREE.Group();
  root.add(under);
  for (const z of [1.38, -1.38]) {
    under.add(part(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8), steel, 0, 0, z, 0, 0, Math.PI / 2));
    under.add(part(new THREE.SphereGeometry(0.17, 10, 8), steel, 0.12, 0, z));
  }
  const wheels = [];
  const layout = [[0.82, 1.38], [-0.82, 1.38], [0.82, -1.38], [-0.82, -1.38]];
  for (const [x] of layout) {
    const steer = new THREE.Group();
    const spin = new THREE.Group();
    const t = new THREE.Mesh(tyreGeo, tyreMat);
    const r = new THREE.Mesh(rimGeo, rimMat);
    r.position.x = x > 0 ? 0.05 : -0.05;
    t.castShadow = r.castShadow = true;
    spin.add(t, r);
    steer.add(spin);
    root.add(steer);
    wheels.push({ steer, spin });
  }

  // Dust and mud build up on the paint as you drive.
  const clean = new THREE.Color(PAINT);
  const dirty = new THREE.Color('#7d5a3f');
  const creamClean = new THREE.Color('#efe4cc');
  const creamDirty = new THREE.Color('#a68d70');

  return {
    root,
    body,
    under,
    wheels,
    lights: { headMat, tailMat },
    setDirt(d) {
      paint.color.copy(clean).lerp(dirty, d * 0.55);
      cream.color.copy(creamClean).lerp(creamDirty, d * 0.5);
    },
  };
}
