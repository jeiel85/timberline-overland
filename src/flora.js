// Instanced trees, boulders, pebbles, grass, flowers and trail marker posts.
// Everything is binned into tiles so off-screen tiles are culled.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise2D, mulberry32 } from './noise.js';
import { TREE } from './scatter.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

function colored(geo, color) {
  const g = geo.index ? geo : geo;
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function spruceGeometry(layers, foliage, slim) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 2.4, 6);
  trunk.translate(0, 1.2, 0);
  parts.push(colored(trunk, '#5b4331'));
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const r = (2.5 - t * 1.9) * slim;
    const h = 3.6 - t * 1.1;
    const cone = new THREE.ConeGeometry(r, h, 7, 1);
    cone.translate(0, 1.6 + i * 1.75 + h / 2, 0);
    cone.rotateY(i * 0.7);
    _c.set(foliage).multiplyScalar(0.86 + t * 0.28);
    parts.push(colored(cone, _c.getHex()));
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

function snagGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.08, 0.24, 8.5, 5);
  trunk.translate(0, 4.25, 0);
  parts.push(colored(trunk, '#8b8178'));
  const rand = mulberry32(4);
  for (let i = 0; i < 5; i++) {
    const b = new THREE.CylinderGeometry(0.03, 0.06, 1.4, 4);
    b.translate(0, 0.7, 0);
    b.rotateZ(1.1 + rand() * 0.4);
    b.rotateY(rand() * 6.28);
    b.translate(0, 3 + i * 1.0, 0);
    parts.push(colored(b, '#7b726a'));
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

/** A lumpy boulder: geometry for rendering and its vertices for a convex hull. */
export function rockShape(seed) {
  const noise = makeNoise2D(seed * 31 + 7);
  let geo = new THREE.IcosahedronGeometry(1, 1);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise(v.x * 1.3 + v.y * 0.7, v.z * 1.3 - v.y * 0.5);
    v.multiplyScalar(1 + 0.22 * n);
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.4;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return { geometry: geo, hull: new Float32Array(p.array) };
}

function grassTuftGeometry() {
  const rand = mulberry32(11);
  const pos = [];
  const col = [];
  const nor = [];
  for (let b = 0; b < 6; b++) {
    const a = (b / 6) * Math.PI * 2 + rand() * 0.6;
    const bx = Math.cos(a) * 0.07, bz = Math.sin(a) * 0.07;
    const w = 0.05 + rand() * 0.03;
    const h = 0.38 + rand() * 0.26;
    const lean = 0.1 + rand() * 0.12;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + Math.cos(a) * lean, h, bz + Math.sin(a) * lean);
    col.push(0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 1.15, 1.15, 1.0);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

function postGeometry() {
  const post = new THREE.BoxGeometry(0.13, 1.25, 0.13);
  post.translate(0, 0.62, 0);
  const band = new THREE.BoxGeometry(0.15, 0.22, 0.15);
  band.translate(0, 1.12, 0);
  return mergeGeometries([colored(post, '#6e5440').toNonIndexed(), colored(band, '#ff7a2e').toNonIndexed()]);
}

// Shared by every material that should not hide the car from the camera.
const focusU = { value: new THREE.Vector3() };

/**
 * Dither away what sits right in front of the camera or on the line of sight
 * to the car, so trees and boulders never fill the view.
 */
function nearFade(mat, near = 2.5, far = 7.5) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFocus = focusU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
vec4 fadeW = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
fadeW = instanceMatrix * fadeW;
#endif
vFadeW = (modelMatrix * fadeW).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeW;\nuniform vec3 uFocus;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
vec3 sightAB = uFocus - cameraPosition;
float sightT = clamp(dot(vFadeW - cameraPosition, sightAB) / max(dot(sightAB, sightAB), 1e-3), 0.0, 1.0);
float sightK = sightT < 0.9 ? smoothstep(1.4, 3.6, distance(vFadeW, cameraPosition + sightAB * sightT)) : 1.0;
float fadeK = min(smoothstep(${near.toFixed(1)}, ${far.toFixed(1)}, distance(vFadeW, cameraPosition)), sightK);
if (fadeK < 1.0) {
  vec2 cell = floor(mod(gl_FragCoord.xy, 4.0));
  float bayer = mod(cell.x * 2.0 + cell.y * 3.0, 4.0) / 4.0 + mod(cell.y, 2.0) * 0.125;
  if (bayer > fadeK) discard;
}`);
  };
  return mat;
}

function windMaterial(base, uniforms) {
  const mat = new THREE.MeshStandardMaterial(base);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
float sway = sin(uTime * 1.8 + ip.x * 0.31 + ip.z * 0.23) * 0.6 + sin(uTime * 3.3 + ip.x * 1.3) * 0.25;
transformed.x += sway * uWind * position.y * position.y * 0.55;
transformed.z += sway * uWind * position.y * 0.18;`);
  };
  return mat;
}

/**
 * items: array of anything; place(item, matrix, color) fills one instance and
 * returns false to skip it. One InstancedMesh per tile.
 */
function tiled(group, items, tileSize, geometry, material, place, opts = {}) {
  const bins = new Map();
  for (const it of items) {
    const x = it.x ?? it[0], z = it.z ?? it[2];
    const key = `${Math.floor(x / tileSize)},${Math.floor(z / tileSize)}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(it);
  }
  const meshes = [];
  for (const [key, list] of bins) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    let n = 0;
    for (const it of list) {
      _c.set(1, 1, 1);
      if (place(it, _m, _c) === false) continue;
      mesh.setMatrixAt(n, _m);
      mesh.setColorAt(n, _c);
      n++;
    }
    mesh.count = n;
    mesh.castShadow = !!opts.castShadow;
    mesh.receiveShadow = !!opts.receiveShadow;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    const [tx, tz] = key.split(',').map(Number);
    mesh.userData.center = new THREE.Vector3((tx + 0.5) * tileSize, 0, (tz + 0.5) * tileSize);
    group.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

function compose(x, y, z, sx, sy, sz, rotY, rotX = 0, rotZ = 0) {
  _p.set(x, y, z);
  _q.setFromEuler(_e.set(rotX, rotY, rotZ));
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}

export function buildFlora(T, S, scene) {
  const group = new THREE.Group();
  scene.add(group);
  const windU = { uTime: { value: 0 }, uWind: { value: 0.5 } };

  // --- trees ------------------------------------------------------------------
  const treeMat = nearFade(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 }), 3, 9);
  const geos = {
    [TREE.SPRUCE]: spruceGeometry(4, '#2f5a33', 1),
    [TREE.LARCH]: spruceGeometry(4, '#d7a538', 0.82),
    [TREE.SNAG]: snagGeometry(),
  };
  const spruceTints = [new THREE.Color('#ffffff'), new THREE.Color('#c9e0cf'), new THREE.Color('#e6efc9')];
  const larchTints = [new THREE.Color('#ffffff'), new THREE.Color('#ffd9a0'), new THREE.Color('#f2f0b0')];
  for (const type of [TREE.SPRUCE, TREE.LARCH, TREE.SNAG]) {
    const list = S.trees.filter((t) => t.type === type);
    tiled(group, list, 128, geos[type], treeMat, (t, m, c) => {
      compose(t.x, t.y, t.z, t.s, t.s * (0.9 + t.tint * 0.25), t.s, t.rot);
      const tints = type === TREE.LARCH ? larchTints : spruceTints;
      c.copy(tints[0]).lerp(tints[1 + Math.floor(t.tint * 2)], t.tint);
    }, { castShadow: true, receiveShadow: true });
  }

  // --- boulders -------------------------------------------------------------------
  const shapes = [0, 1, 2, 3].map((i) => rockShape(i + 1));
  const rockMat = nearFade(new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.95 }), 1.5, 4);
  for (let k = 0; k < shapes.length; k++) {
    const list = S.boulders.filter((b) => b.shape === k);
    tiled(group, list, 128, shapes[k].geometry, rockMat, (b, m, c) => {
      compose(b.x, b.y, b.z, b.sx, b.sy, b.sz, b.rot);
      c.set(b.y > 110 ? '#a7a6a3' : '#8f8b84').multiplyScalar(0.8 + b.tint * 0.35);
    }, { castShadow: true, receiveShadow: true });
  }

  // --- pebbles --------------------------------------------------------------------
  const pebbleGeo = new THREE.IcosahedronGeometry(1, 0);
  tiled(group, S.pebbles, 128, pebbleGeo, rockMat, (p, m, c) => {
    compose(p.x, p.y, p.z, p.s, p.s * 0.55, p.s * 0.8, p.rot);
    c.set('#8d8a85').multiplyScalar(0.75 + (p.rot % 1) * 0.4);
  }, { receiveShadow: true });

  // --- grass and flowers (Float32Array: x, y, z, s, rot, tint) --------------------
  const toItems = (arr) => {
    const out = [];
    for (let i = 0; i < arr.length; i += 6) out.push([arr[i], arr[i + 1], arr[i + 2], arr[i + 3], arr[i + 4], arr[i + 5]]);
    return out;
  };
  const grassMat = windMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }, windU);
  const lush = new THREE.Color('#57752a'), dry = new THREE.Color('#a19647'), alpine = new THREE.Color('#857a52');
  const grassTiles = tiled(group, toItems(S.grass), 64, grassTuftGeometry(), grassMat, (g, m, c) => {
    compose(g[0], g[1] - 0.03, g[2], g[3], g[3] * (0.8 + g[5] * 0.5), g[3], g[4]);
    c.copy(lush).lerp(dry, Math.min(1, g[5] * 0.6 + Math.max(0, g[1] - 40) / 140)).lerp(alpine, Math.max(0, (g[1] - 95) / 50));
  });
  const flowerGeo = new THREE.OctahedronGeometry(0.06, 0);
  flowerGeo.translate(0, 0.32, 0);
  const flowerMat = windMaterial({ roughness: 0.7 }, windU);
  const petals = ['#f6d33c', '#ffffff', '#b07fe6', '#ee5c4a', '#6fa9ee', '#f59ad0'].map((h) => new THREE.Color(h));
  const flowerTiles = tiled(group, toItems(S.flowers), 64, flowerGeo, flowerMat, (f, m, c) => {
    compose(f[0], f[1], f[2], f[3], f[3] * (0.8 + f[5]), f[3], f[4]);
    c.copy(petals[Math.floor(f[5] * petals.length) % petals.length]);
  });

  // --- trail marker posts -------------------------------------------------------
  const posts = [];
  for (const t of T.trails) {
    let side = 1;
    for (let i = 12; i < t.xs.length - 6; i += 30) {
      const j = Math.min(i + 1, t.xs.length - 1);
      const tx = t.xs[j] - t.xs[i - 1], tz = t.zs[j] - t.zs[i - 1];
      const tl = Math.hypot(tx, tz) || 1;
      const off = (t.width + 1.1) * side;
      const x = t.xs[i] - (tz / tl) * off, z = t.zs[i] + (tx / tl) * off;
      if (T.lakeD(x, z) < 1.02) continue;
      posts.push({ x, y: T.heightAt(x, z) - 0.05, z, rot: Math.atan2(tx, tz) });
      side = -side;
    }
  }
  tiled(group, posts, 128, postGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), (p) => {
    compose(p.x, p.y, p.z, 1, 1, 1, p.rot, 0.04, 0);
  }, { castShadow: true });

  const grassAndFlowers = [...grassTiles, ...flowerTiles];
  let drawDist = 150;
  return {
    group,
    rockShapes: shapes.map((s) => s.hull),
    setGrassDistance(d) { drawDist = d; },
    update(time, wind, camPos, focus) {
      focusU.value.copy(focus);
      windU.uTime.value = time;
      windU.uWind.value = wind;
      for (const m of grassAndFlowers) {
        const c = m.userData.center;
        const dx = c.x - camPos.x, dz = c.z - camPos.z;
        m.visible = dx * dx + dz * dz < drawDist * drawDist;
      }
    },
  };
}
