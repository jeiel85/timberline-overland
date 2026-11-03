// Terrain mesh and material, the tarn, sky dome, distant peaks, lights, and the
// time-of-day / weather presets that tie them together.

import * as THREE from 'three';
import { makeNoise2D, ridged, smoothstep } from './noise.js';

const NOISE_GLSL = /* glsl */ `
float tl_hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tl_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tl_hash(i), tl_hash(i + vec2(1.0, 0.0)), u.x), mix(tl_hash(i + vec2(0.0, 1.0)), tl_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 tl_lin(vec3 c) { return pow(c, vec3(2.2)); }
`;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

function terrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aMat;
attribute vec2 aTrail;
varying vec4 vMat;
varying vec2 vTrail;
varying vec3 vWorldP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vMat = aMat;
vTrail = aTrail;
vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vMat;
varying vec2 vTrail;
varying vec3 vWorldP;
${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `
vec3 wp = vWorldP;
float n1 = tl_noise(wp.xz * 0.045);
float n2 = tl_noise(wp.xz * 0.31);
float n3 = tl_noise(wp.xz * 1.7);
float n4 = tl_noise(wp.xz * 6.3);
float dry = clamp(smoothstep(0.35, 0.78, n1) * 0.7 + smoothstep(40.0, 110.0, wp.y) * 0.45, 0.0, 1.0);
vec3 grass = mix(tl_lin(vec3(0.33, 0.45, 0.15)), tl_lin(vec3(0.6, 0.56, 0.25)), dry);
grass = mix(grass, tl_lin(vec3(0.5, 0.47, 0.32)), smoothstep(92.0, 136.0, wp.y));
grass *= 0.8 + 0.32 * n2 + 0.16 * (n4 - 0.5);
// Bedding planes, warped so they wander instead of ruling straight lines.
float warp = n1 * 9.0 + n2 * 2.5 + tl_noise(wp.xz * 0.011) * 16.0;
float strata = sin(wp.y * 1.15 + warp) * 0.5 + 0.5;
float strata2 = sin(wp.y * 3.7 + warp * 1.7) * 0.5 + 0.5;
vec3 rock = mix(tl_lin(vec3(0.45, 0.44, 0.42)), tl_lin(vec3(0.6, 0.58, 0.54)), 0.25 + 0.5 * strata * (0.55 + 0.45 * n2));
rock = mix(rock, tl_lin(vec3(0.68, 0.63, 0.55)), smoothstep(0.78, 0.97, strata2) * 0.35 * n1);
rock *= 0.8 + 0.32 * n3;
vec3 scree = mix(tl_lin(vec3(0.5, 0.49, 0.46)), tl_lin(vec3(0.66, 0.64, 0.6)), n4) * (0.86 + 0.2 * n2);
vec3 dirt = mix(tl_lin(vec3(0.45, 0.36, 0.26)), tl_lin(vec3(0.56, 0.46, 0.33)), n3);
dirt = mix(dirt, tl_lin(vec3(0.55, 0.53, 0.5)), smoothstep(100.0, 125.0, wp.y) * 0.6);
float sd = abs(vTrail.y);
float rut = smoothstep(0.38, 0.62, sd) * (1.0 - smoothstep(1.02, 1.32, sd));
dirt *= 1.0 - rut * 0.26 * (0.7 + 0.6 * n4);
float crown = (1.0 - smoothstep(0.12, 0.36, sd)) * (1.0 - smoothstep(100.0, 116.0, wp.y));
dirt = mix(dirt, grass * 0.85, crown * 0.55);
vec3 snowC = tl_lin(vec3(0.93, 0.95, 0.99)) * (0.93 + 0.07 * n3);
float rockW = smoothstep(0.35, 0.65, vMat.y + (n3 - 0.5) * 0.35);
float screeW = smoothstep(0.3, 0.7, vMat.w + (n2 - 0.5) * 0.4);
float snowW = smoothstep(0.42, 0.58, vMat.z + (n2 - 0.5) * 0.45 + (n4 - 0.5) * 0.12);
float trailW = smoothstep(0.25, 0.75, vMat.x + (n4 - 0.5) * 0.3);
vec3 col = grass;
col = mix(col, scree, screeW);
col = mix(col, rock, rockW);
col = mix(col, snowC, snowW * (1.0 - rockW * 0.45));
col = mix(col, dirt, trailW);
float wetW = vTrail.x;
col = mix(col, col * vec3(0.52, 0.5, 0.46), wetW * 0.85);
diffuseColor.rgb = col;
float tRough = clamp(mix(0.96, 0.5, snowW * (1.0 - trailW)) - wetW * 0.4, 0.3, 1.0);
`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;');
  };
  return mat;
}

/** Terrain split into tiles so each can be frustum-culled. */
function buildTerrainMeshes(T, tilesPerSide = 8) {
  const mat = terrainMaterial();
  const group = new THREE.Group();
  const cells = T.N / tilesPerSide;
  for (let ty = 0; ty < tilesPerSide; ty++) {
    for (let tx = 0; tx < tilesPerSide; tx++) {
      const vn = cells + 1;
      const pos = new Float32Array(vn * vn * 3);
      const nor = new Float32Array(vn * vn * 3);
      const aMat = new Float32Array(vn * vn * 4);
      const aTrail = new Float32Array(vn * vn * 2);
      let k = 0;
      for (let j = 0; j < vn; j++) {
        for (let i = 0; i < vn; i++, k++) {
          const ix = tx * cells + i, iz = ty * cells + j;
          const g = iz * T.VN + ix;
          pos[k * 3] = -T.HALF + ix * T.CELL;
          pos[k * 3 + 1] = T.heights[g];
          pos[k * 3 + 2] = -T.HALF + iz * T.CELL;
          nor[k * 3] = T.normals[g * 3];
          nor[k * 3 + 1] = T.normals[g * 3 + 1];
          nor[k * 3 + 2] = T.normals[g * 3 + 2];
          for (let c = 0; c < 4; c++) aMat[k * 4 + c] = T.mat[g * 4 + c];
          aTrail[k * 2] = T.wet[g];
          aTrail[k * 2 + 1] = Math.max(-9, Math.min(9, T.trailSd[g]));
        }
      }
      const idx = new Uint32Array(cells * cells * 6);
      let q = 0;
      for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
          const a = j * vn + i, b = a + 1, c = a + vn, d = c + 1;
          idx[q++] = a; idx[q++] = c; idx[q++] = b;
          idx[q++] = b; idx[q++] = c; idx[q++] = d;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('aMat', new THREE.BufferAttribute(aMat, 4));
      geo.setAttribute('aTrail', new THREE.BufferAttribute(aTrail, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}

// ---------------------------------------------------------------------------
// The tarn
// ---------------------------------------------------------------------------

function buildWater(T) {
  const L = T.lake;
  const w = L.rx * 2.5, d = L.rz * 2.5;
  const geo = new THREE.PlaneGeometry(w, d, 96, 72);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const depth = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + L.x, z = p.getZ(i) + L.z;
    depth[i] = T.waterY - T.heightAt(x, z);
  }
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSky: { value: new THREE.Color(0.5, 0.7, 0.9) },
        uZenith: { value: new THREE.Color(0.2, 0.4, 0.8) },
        uShallow: { value: new THREE.Color('#5fb7b0') },
        uDeep: { value: new THREE.Color('#0f4253') },
        uLight: { value: 1 },
      },
    ]),
    vertexShader: /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute float aDepth;
varying float vDepth;
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vDepth = aDepth;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${NOISE_GLSL}
uniform float uTime;
uniform vec3 uSunDir, uSunColor, uSky, uZenith, uShallow, uDeep;
uniform float uLight;
varying float vDepth;
varying vec3 vW;
void main() {
  if (vDepth < -0.05) discard;
  vec2 q = vW.xz;
  float e = 0.35;
  float h0 = tl_noise(q * 0.5 + uTime * 0.25) + 0.5 * tl_noise(q * 1.6 - uTime * 0.4);
  float hx = tl_noise((q + vec2(e, 0.0)) * 0.5 + uTime * 0.25) + 0.5 * tl_noise((q + vec2(e, 0.0)) * 1.6 - uTime * 0.4);
  float hz = tl_noise((q + vec2(0.0, e)) * 0.5 + uTime * 0.25) + 0.5 * tl_noise((q + vec2(0.0, e)) * 1.6 - uTime * 0.4);
  vec3 n = normalize(vec3((h0 - hx) * 0.35, 1.0, (h0 - hz) * 0.35));
  vec3 v = normalize(cameraPosition - vW);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  float dz = clamp(vDepth / 4.5, 0.0, 1.0);
  vec3 body = mix(uShallow, uDeep, sqrt(dz)) * uLight;
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uSky, uZenith, clamp(r.y, 0.0, 1.0));
  vec3 col = mix(body, sky * 0.78, fres * 0.7);
  col += uSunColor * pow(max(dot(r, uSunDir), 0.0), 220.0) * 3.0;
  float foam = smoothstep(0.18, 0.0, vDepth) * (0.6 + 0.4 * tl_noise(q * 3.0 + uTime));
  col = mix(col, vec3(0.9) * uLight, foam * 0.35);
  float alpha = clamp(0.35 + dz * 0.9 + fres * 0.4, 0.0, 0.94) * smoothstep(-0.05, 0.12, vDepth);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(L.x, T.waterY, L.z);
  mesh.renderOrder = 2;
  return mesh;
}

// ---------------------------------------------------------------------------
// Sky dome
// ---------------------------------------------------------------------------

function buildSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uCloudLit: { value: new THREE.Color() },
      uCloudDark: { value: new THREE.Color() },
      uNight: { value: 0 },
      uCloud: { value: 0.4 },
      uFogMix: { value: 0 },
      uFogColor: { value: new THREE.Color() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
${NOISE_GLSL}
uniform vec3 uSun, uZenith, uHorizon, uGround, uSunColor, uCloudLit, uCloudDark, uFogColor;
uniform float uNight, uCloud, uFogMix, uTime;
varying vec3 vDir;
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * tl_noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uGround, smoothstep(0.0, -0.2, h));
  float sd = max(dot(d, uSun), 0.0);
  col += uSunColor * (pow(sd, 1400.0) * 30.0 + pow(sd, 10.0) * 0.28 + pow(sd, 2.5) * 0.08) * (1.0 - uFogMix * 0.7);
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.14) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = fbm(uv);
    float cover = smoothstep(1.0 - uCloud * 0.85, 1.25 - uCloud * 0.85, c + 0.2);
    float shade = fbm(uv * 1.8 + 3.0);
    vec3 cc = mix(uCloudDark, uCloudLit, smoothstep(0.25, 0.75, shade));
    cc += uSunColor * pow(sd, 6.0) * 0.5;
    col = mix(col, cc, cover * smoothstep(0.0, 0.12, h) * 0.92);
  }
  if (uNight > 0.0 && h > 0.0) {
    vec3 sp = d * 380.0;
    float st = tl_hash(floor(sp.xz) + floor(sp.y) * 7.13);
    float tw = 0.7 + 0.3 * sin(uTime * 2.0 + st * 40.0);
    col += vec3(step(0.9965, st) * tw * uNight * smoothstep(0.02, 0.25, h)) * 1.2;
  }
  col = mix(col, uFogColor, uFogMix * (1.0 - smoothstep(0.1, 0.8, h) * 0.5));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// Peaks beyond the valley, for depth
// ---------------------------------------------------------------------------

function buildBackdrop(seed = 5) {
  const nz = makeNoise2D(seed);
  const segs = 220, rings = 8;
  const pos = [];
  const col = [];
  const rock = new THREE.Color('#6d6f77');
  const rockFar = new THREE.Color('#7f8798');
  const snow = new THREE.Color('#f1f4fa');
  const grid = [];
  for (let r = 0; r <= rings; r++) {
    const row = [];
    const t = r / rings;
    const radius = 560 + t * 1300;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      const ridge = ridged(nz, x * 0.0022, z * 0.0022, 5);
      const profile = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.75 + 0.25;
      const y = 180 + ridge * 720 * profile + nz(x * 0.01, z * 0.01) * 25 - t * 60;
      row.push([x, y, z]);
    }
    grid.push(row);
  }
  const c = new THREE.Color();
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const quad = [grid[r][s], grid[r + 1][s], grid[r][s + 1], grid[r + 1][s + 1]];
      for (const tri of [[0, 1, 2], [2, 1, 3]]) {
        const ys = tri.map((i) => quad[i][1]);
        const ymax = Math.max(...ys);
        const v0 = new THREE.Vector3(...quad[tri[0]]), v1 = new THREE.Vector3(...quad[tri[1]]), v2 = new THREE.Vector3(...quad[tri[2]]);
        const n = new THREE.Vector3().subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0)).normalize();
        const steep = Math.abs(n.y);
        c.copy(rock).lerp(rockFar, r / rings);
        if (ymax > 470 + 60 * nz(v0.x * 0.004, v0.z * 0.004) && steep > 0.45) c.copy(snow);
        for (const i of tri) {
          pos.push(...quad[i]);
          col.push(c.r, c.g, c.b);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide }));
  return mesh;
}

// ---------------------------------------------------------------------------
// Time of day and weather
// ---------------------------------------------------------------------------

export const TIMES = ['morning', 'noon', 'golden', 'night'];
export const WEATHERS = ['clear', 'mist', 'snow'];

const TIME_PRESETS = {
  morning: { el: 11, az: 105, zenith: '#5a8ad0', horizon: '#f3cfa8', ground: '#5d564c', sun: '#ffc590', sunI: 2.6, hemiSky: '#b8cbe6', hemiGround: '#5f5242', hemiI: 0.9, cloudLit: '#fff1e2', cloudDark: '#a5a7b5', fog: '#d9d3c8', exposure: 1.0, night: 0 },
  noon: { el: 52, az: 165, zenith: '#3a72c8', horizon: '#bcd5ee', ground: '#5d5a52', sun: '#fff3df', sunI: 3.1, hemiSky: '#bcd6f5', hemiGround: '#62583f', hemiI: 0.95, cloudLit: '#ffffff', cloudDark: '#aab3c2', fog: '#c6d6e6', exposure: 1.0, night: 0 },
  golden: { el: 13, az: 238, zenith: '#46689f', horizon: '#ffb779', ground: '#5a4a3f', sun: '#ff9d5c', sunI: 2.5, hemiSky: '#a9b6d6', hemiGround: '#62493a', hemiI: 0.85, cloudLit: '#ffcf9e', cloudDark: '#8d7f8d', fog: '#e2b996', exposure: 1.05, night: 0 },
  night: { el: 38, az: 215, zenith: '#060c1d', horizon: '#1c2942', ground: '#0b0d12', sun: '#a6b8ff', sunI: 0.55, hemiSky: '#33446b', hemiGround: '#14141a', hemiI: 0.35, cloudLit: '#3a4560', cloudDark: '#141a28', fog: '#151d2e', exposure: 1.25, night: 1 },
};
const WEATHER_PRESETS = {
  clear: { cloud: 0.42, fog: 0.0011, fogMix: 0, light: 1, wind: 0.5 },
  mist: { cloud: 0.85, fog: 0.0068, fogMix: 0.75, light: 0.62, wind: 0.3 },
  snow: { cloud: 0.95, fog: 0.0042, fogMix: 0.55, light: 0.68, wind: 1 },
};

function sunVector(el, az) {
  const e = THREE.MathUtils.degToRad(el), a = THREE.MathUtils.degToRad(az);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

function presetState(timeId, weatherId) {
  const t = TIME_PRESETS[timeId];
  const w = WEATHER_PRESETS[weatherId];
  const fogBase = new THREE.Color(t.fog);
  const fogCol = weatherId === 'clear' ? fogBase : fogBase.clone().lerp(new THREE.Color(t.night ? '#1c2230' : '#c9ccd2'), 0.6);
  return {
    sun: sunVector(t.el, t.az),
    zenith: new THREE.Color(t.zenith), horizon: new THREE.Color(t.horizon), ground: new THREE.Color(t.ground),
    sunColor: new THREE.Color(t.sun), sunI: t.sunI * w.light,
    hemiSky: new THREE.Color(t.hemiSky), hemiGround: new THREE.Color(t.hemiGround), hemiI: t.hemiI * (0.75 + 0.25 * w.light),
    cloudLit: new THREE.Color(t.cloudLit), cloudDark: new THREE.Color(t.cloudDark),
    fogColor: fogCol, fog: w.fog * (t.night ? 0.8 : 1), fogMix: w.fogMix, cloud: w.cloud,
    night: t.night, exposure: t.exposure, wind: w.wind,
  };
}

function lerpState(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    const va = a[k], vb = b[k];
    if (va instanceof THREE.Color) out[k] = va.clone().lerp(vb, t);
    else if (va instanceof THREE.Vector3) out[k] = va.clone().lerp(vb, t).normalize();
    else out[k] = va + (vb - va) * t;
  }
  return out;
}

// ---------------------------------------------------------------------------

export function buildWorld(T, scene) {
  const terrain = buildTerrainMeshes(T);
  scene.add(terrain);
  const water = buildWater(T);
  scene.add(water);
  const sky = buildSky();
  scene.add(sky);
  const backdrop = buildBackdrop();
  scene.add(backdrop);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbcd6f5, 0x62583f, 0.9);
  scene.add(hemi);

  scene.fog = new THREE.FogExp2(0xc6d6e6, 0.0011);

  let timeId = 'golden';
  let weatherId = 'clear';
  let state = presetState(timeId, weatherId);
  let from = state;
  let to = state;
  let blend = 1;

  function apply(s) {
    const u = sky.material.uniforms;
    u.uSun.value.copy(s.sun);
    u.uZenith.value.copy(s.zenith);
    u.uHorizon.value.copy(s.horizon);
    u.uGround.value.copy(s.ground);
    u.uSunColor.value.copy(s.sunColor);
    u.uCloudLit.value.copy(s.cloudLit);
    u.uCloudDark.value.copy(s.cloudDark);
    u.uNight.value = s.night;
    u.uCloud.value = s.cloud;
    u.uFogMix.value = s.fogMix;
    u.uFogColor.value.copy(s.fogColor);
    sun.color.copy(s.sunColor);
    sun.intensity = s.sunI;
    hemi.color.copy(s.hemiSky);
    hemi.groundColor.copy(s.hemiGround);
    hemi.intensity = s.hemiI;
    scene.fog.color.copy(s.fogColor);
    scene.fog.density = s.fog;
    const wu = water.material.uniforms;
    wu.uSunDir.value.copy(s.sun);
    wu.uSunColor.value.copy(s.sunColor).multiplyScalar(s.sunI / 3);
    wu.uSky.value.copy(s.horizon).lerp(s.fogColor, s.fogMix);
    wu.uZenith.value.copy(s.zenith);
    wu.uLight.value = Math.max(0.12, s.sunI / 3);
    state = s;
  }
  apply(state);

  function setPreset(t, w, instant = false) {
    timeId = t;
    weatherId = w;
    from = state;
    to = presetState(t, w);
    blend = instant ? 1 : 0;
    if (instant) apply(to);
  }

  const _snap = new THREE.Vector3();
  function update(dt, time, focus) {
    if (blend < 1) {
      blend = Math.min(1, blend + dt / 1.6);
      apply(lerpState(from, to, smoothstep(0, 1, blend)));
    }
    sky.material.uniforms.uTime.value = time;
    water.material.uniforms.uTime.value = time;
    // Keep the shadow frustum centred on the car, snapped to its texels.
    const texel = 140 / sun.shadow.mapSize.x;
    _snap.copy(focus);
    sun.target.position.set(Math.round(_snap.x / texel) * texel, Math.round(_snap.y / texel) * texel, Math.round(_snap.z / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(state.sun, 260);
    sun.target.updateMatrixWorld();
  }

  return {
    terrain, water, sky, backdrop, sun, hemi,
    get time() { return timeId; },
    get weather() { return weatherId; },
    get state() { return state; },
    setPreset,
    update,
    setShadowSize(size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    },
  };
}
