// Procedural alpine valley: base relief, tarn, carved trails, landmark pads and
// per-vertex material weights. Pure module — shared by rendering, physics and tests.

import { makeNoise2D, fbm, ridged, smoothstep, clamp, lerp } from './noise.js';
import { LAKE, KNOLL, TRAILS, LANDMARKS, FORD_DEPTH } from './layout.js';

export const SIZE = 1024;
export const N = 512;
export const CELL = SIZE / N;
export const HALF = SIZE / 2;
export const VN = N + 1;

// Fritsch–Carlson monotone cubic through (xs, ys); xs ascending.
function monotone(xs, ys) {
  const n = xs.length;
  const d = [];
  const m = new Array(n);
  for (let k = 0; k < n - 1; k++) d[k] = (ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
    const a = m[k] / d[k];
    const b = m[k + 1] / d[k];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[k] = t * a * d[k];
      m[k + 1] = t * b * d[k];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0;
    while (x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k];
    const t = (x - xs[k]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
  };
}

// Valley floor elevation from the south meadows (+z) up to the high basin (-z).
const floorAt = monotone(
  [-512, -400, -300, -200, -150, 0, 100, 250, 400, 512],
  [136, 128, 92, 55, 42, 24, 13, 6, 2, 4],
);
const axisX = (z) => 50 * Math.sin(z * 0.006);
function halfWidth(z) {
  if (z > -330) return lerp(150, 230, smoothstep(-200, 250, z));
  return lerp(150, 210, smoothstep(-330, -450, z));
}

function makeBase(seed) {
  const nA = makeNoise2D(seed + 1);
  const nB = makeNoise2D(seed + 2);
  const nC = makeNoise2D(seed + 3);
  const nD = makeNoise2D(seed + 4);
  return (x, z) => {
    const u = Math.abs(x - axisX(z)) / halfWidth(z);
    const uu = u + 0.12 * nA(x * 0.004, z * 0.004);
    let wall = uu > 0.5 ? 260 * Math.pow(uu - 0.5, 1.8) : 0;
    wall = 320 * (1 - Math.exp(-wall / 320));
    const wallMask = smoothstep(0.55, 1.1, u);
    wall += wallMask * (ridged(nB, x * 0.0065, z * 0.0065, 4) - 0.45) * 70 * smoothstep(0.6, 1.6, u);
    if (wall > 3) {
      // Sedimentary ledges: pull part of the wall onto 9 m steps.
      const s = wall / 9;
      const f = s - Math.floor(s);
      const terraced = (Math.floor(s) + smoothstep(0.25, 0.75, f)) * 9;
      wall = lerp(wall, terraced, 0.4 * wallMask);
    }
    const floorMask = 1 - smoothstep(0.35, 0.8, u);
    const bumps = fbm(nC, x / 110, z / 110, 4) * 5 + fbm(nD, x / 28, z / 28, 3) * 0.9;
    let h = floorAt(z) + wall + bumps * (0.35 + 0.65 * floorMask);
    const kd = Math.hypot(x - KNOLL.x, z - KNOLL.z) / KNOLL.r;
    h += KNOLL.h * Math.exp(-kd * kd * 1.6);
    h += 150 * smoothstep(445, 512, z) + 170 * smoothstep(-488, -512, z);
    return h;
  };
}

// Uniform Catmull-Rom through the control points, resampled every `step` metres.
export function sampleSpline(points, step = 1) {
  const xs = [];
  const zs = [];
  const P = (i) => points[clamp(i, 0, points.length - 1)];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(len / (step * 0.5)));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      xs.push(cr(p0[0], p1[0], p2[0], p3[0]));
      zs.push(cr(p0[1], p1[1], p2[1], p3[1]));
    }
  }
  const last = points[points.length - 1];
  xs.push(last[0]);
  zs.push(last[1]);
  // Resample at an even arc-length spacing.
  const ox = [xs[0]];
  const oz = [zs[0]];
  let carry = 0;
  for (let i = 1; i < xs.length; i++) {
    let ax = xs[i - 1], az = zs[i - 1];
    const bx = xs[i], bz = zs[i];
    let seg = Math.hypot(bx - ax, bz - az);
    while (carry + seg >= step) {
      const t = (step - carry) / seg;
      ax += (bx - ax) * t;
      az += (bz - az) * t;
      ox.push(ax);
      oz.push(az);
      seg = Math.hypot(bx - ax, bz - az);
      carry = 0;
    }
    carry += seg;
  }
  if (carry > step * 0.3) { ox.push(last[0]); oz.push(last[1]); }
  return { xs: ox, zs: oz };
}

function smoothProfile(ys, radius, passes) {
  let a = ys.slice();
  for (let p = 0; p < passes; p++) {
    const b = new Array(a.length);
    for (let i = 0; i < a.length; i++) {
      let sum = 0;
      let n = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = i + k;
        if (j < 0 || j >= a.length) continue;
        sum += a[j];
        n++;
      }
      b[i] = sum / n;
    }
    a = b;
  }
  return a;
}

function limitGrade(ys, maxStep) {
  for (let i = 1; i < ys.length; i++) ys[i] = clamp(ys[i], ys[i - 1] - maxStep, ys[i - 1] + maxStep);
  for (let i = ys.length - 2; i >= 0; i--) ys[i] = clamp(ys[i], ys[i + 1] - maxStep, ys[i + 1] + maxStep);
  return ys;
}

export function generateTerrain(seed = 1337) {
  const base = makeBase(seed);
  const total = VN * VN;
  const h = new Float32Array(total);
  const gx = (ix) => -HALF + ix * CELL;
  for (let iz = 0; iz < VN; iz++) {
    const z = gx(iz);
    for (let ix = 0; ix < VN; ix++) h[iz * VN + ix] = base(gx(ix), z);
  }

  // --- the tarn: flatten a basin shelf, then dig the bowl -----------------
  const nShore = makeNoise2D(seed + 9);
  const shelf = base(LAKE.x, LAKE.z);
  const waterY = shelf - 0.6;
  const lakeD = (x, z) => {
    const d = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
    return d * (1 + 0.06 * nShore(x * 0.03, z * 0.03));
  };
  for (let iz = 0; iz < VN; iz++) {
    for (let ix = 0; ix < VN; ix++) {
      const i = iz * VN + ix;
      const d = lakeD(gx(ix), gx(iz));
      if (d > 1.8) continue;
      h[i] = lerp(h[i], shelf, 1 - smoothstep(1.15, 1.75, d));
      h[i] -= LAKE.depth * smoothstep(1.0, 0.25, d);
    }
  }

  const heightAt = (x, z) => {
    const fx = clamp((x + HALF) / CELL, 0, N - 1e-6);
    const fz = clamp((z + HALF) / CELL, 0, N - 1e-6);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const i = iz * VN + ix;
    const a = h[i] + (h[i + 1] - h[i]) * tx;
    const b = h[i + VN] + (h[i + VN + 1] - h[i + VN]) * tx;
    return a + (b - a) * tz;
  };

  // --- landmark pads -----------------------------------------------------
  const landmarks = LANDMARKS.map((l) => ({ ...l, y: 0 }));
  for (const l of landmarks) {
    if (!l.pad) continue;
    const target = heightAt(l.x, l.z);
    const r = Math.ceil((l.pad * 1.6) / CELL);
    const cx = Math.round((l.x + HALF) / CELL), cz = Math.round((l.z + HALF) / CELL);
    for (let iz = Math.max(0, cz - r); iz <= Math.min(N, cz + r); iz++) {
      for (let ix = Math.max(0, cx - r); ix <= Math.min(N, cx + r); ix++) {
        const d = Math.hypot(gx(ix) - l.x, gx(iz) - l.z);
        const w = 1 - smoothstep(l.pad * 0.7, l.pad * 1.6, d);
        if (w <= 0) continue;
        const i = iz * VN + ix;
        h[i] = lerp(h[i], target, w);
      }
    }
  }
  // --- trails ----------------------------------------------------------------
  const trailW = new Float32Array(total);
  const trailSd = new Float32Array(total);
  const trailDist = new Float32Array(total).fill(Infinity);
  const carved = new Float32Array(total);
  const trails = [];
  const FALLOFF = 9;
  for (const def of TRAILS) {
    const { xs, zs } = sampleSpline(def.points, 1);
    const n = xs.length;
    const raw = xs.map((x, i) => heightAt(x, zs[i]));
    // Smooth, but keep the ends on the ground they start from (junctions, pads).
    const ys = smoothProfile(raw, 10, 3).map((y, i) => lerp(raw[i], y, Math.min(1, Math.min(i, n - 1 - i) / 30)));
    limitGrade(ys, def.maxGrade);
    for (let i = 0; i < n; i++) if (lakeD(xs[i], zs[i]) < 1.15) ys[i] = Math.max(ys[i], waterY - FORD_DEPTH);
    limitGrade(ys, def.maxGrade);
    const hw = def.width;
    const R = hw + FALLOFF;
    const dist = new Float32Array(total).fill(Infinity);
    const target = new Float32Array(total);
    const sd = new Float32Array(total);
    const r = Math.ceil(R / CELL);
    for (let k = 0; k < n; k++) {
      const sx = xs[k], sz = zs[k];
      const tx = xs[Math.min(k + 1, n - 1)] - xs[Math.max(k - 1, 0)];
      const tz = zs[Math.min(k + 1, n - 1)] - zs[Math.max(k - 1, 0)];
      const tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl, nz = tx / tl;
      const cx = Math.round((sx + HALF) / CELL), cz = Math.round((sz + HALF) / CELL);
      for (let iz = Math.max(0, cz - r); iz <= Math.min(N, cz + r); iz++) {
        for (let ix = Math.max(0, cx - r); ix <= Math.min(N, cx + r); ix++) {
          const dx = gx(ix) - sx, dz = gx(iz) - sz;
          const d = Math.hypot(dx, dz);
          const i = iz * VN + ix;
          if (d < dist[i]) {
            dist[i] = d;
            target[i] = ys[k];
            sd[i] = dx * nx + dz * nz;
          }
        }
      }
    }
    for (let i = 0; i < total; i++) {
      const d = dist[i];
      if (d > R) continue;
      // Earlier trails keep their bed: a later one only fills what is left.
      const w = d <= hw ? 1 : 1 - smoothstep(hw, R, d);
      const prev = carved[i];
      if (w <= prev) continue;
      h[i] = lerp(h[i], target[i], (w - prev) / (1 - prev + 1e-6));
      carved[i] = w;
      if (d < trailDist[i]) {
        trailDist[i] = d;
        trailSd[i] = sd[i];
      }
      trailW[i] = Math.max(trailW[i], 1 - smoothstep(hw * 0.75, hw + 1.6, d));
    }
    const s = [0];
    for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
    trails.push({ id: def.id, width: hw, xs, zs, ys, raw, s, length: s[n - 1] });
  }

  for (const l of landmarks) l.y = heightAt(l.x, l.z);

  // --- normals and material weights ----------------------------------------
  const normals = new Float32Array(total * 3);
  const mat = new Float32Array(total * 4); // trail, rock, snow, scree
  const wet = new Float32Array(total);
  const nSnow = makeNoise2D(seed + 11);
  const nRock = makeNoise2D(seed + 12);
  for (let iz = 0; iz < VN; iz++) {
    for (let ix = 0; ix < VN; ix++) {
      const i = iz * VN + ix;
      const hl = h[iz * VN + Math.max(ix - 1, 0)];
      const hr = h[iz * VN + Math.min(ix + 1, N)];
      const hu = h[Math.max(iz - 1, 0) * VN + ix];
      const hd = h[Math.min(iz + 1, N) * VN + ix];
      let nx = -(hr - hl) / (2 * CELL);
      let nz = -(hd - hu) / (2 * CELL);
      const inv = 1 / Math.hypot(nx, 1, nz);
      nx *= inv;
      nz *= inv;
      const ny = inv;
      normals[i * 3] = nx;
      normals[i * 3 + 1] = ny;
      normals[i * 3 + 2] = nz;

      const x = gx(ix), z = gx(iz), y = h[i];
      const tw = trailW[i];
      const rn = nRock(x * 0.05, z * 0.05) * 0.04;
      const rock = smoothstep(0.86 + rn, 0.74 + rn, ny);
      const scree = smoothstep(0.97, 0.86, ny) * smoothstep(55, 105, y) + smoothstep(118, 150, y) * 0.6;
      const patches = smoothstep(-0.25, 0.35, nSnow(x / 45, z / 45) + (y - 150) / 60);
      const snow = smoothstep(88, 128, y + 22 * nSnow(x / 90, z / 90)) * smoothstep(0.6, 0.8, ny) * patches;
      mat[i * 4] = tw;
      mat[i * 4 + 1] = rock;
      mat[i * 4 + 2] = clamp(snow, 0, 1);
      mat[i * 4 + 3] = clamp(scree, 0, 1);
      const ld = lakeD(x, z);
      wet[i] = (1 - smoothstep(0.95, 1.18, ld)) * (1 - rock);
    }
  }

  const sample = (arr, stride, off, x, z) => {
    const fx = clamp((x + HALF) / CELL, 0, N - 1e-6);
    const fz = clamp((z + HALF) / CELL, 0, N - 1e-6);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const i = iz * VN + ix;
    const v = (j) => arr[j * stride + off];
    const a = v(i) + (v(i + 1) - v(i)) * tx;
    const b = v(i + VN) + (v(i + VN + 1) - v(i + VN)) * tx;
    return a + (b - a) * tz;
  };

  function normalAt(x, z) {
    return [sample(normals, 3, 0, x, z), sample(normals, 3, 1, x, z), sample(normals, 3, 2, x, z)];
  }

  function surfaceAt(x, z) {
    const y = heightAt(x, z);
    if (y < waterY - 0.05 && lakeD(x, z) < 1.2) return 'water';
    if (sample(mat, 4, 0, x, z) > 0.5) return y > 112 ? 'gravel' : 'dirt';
    if (sample(mat, 4, 2, x, z) > 0.5) return 'snow';
    if (sample(mat, 4, 1, x, z) > 0.5) return 'rock';
    if (sample(mat, 4, 3, x, z) > 0.5) return 'scree';
    if (sample(wet, 1, 0, x, z) > 0.5) return 'mud';
    return 'grass';
  }

  function nearestTrailPoint(x, z) {
    let best = null;
    let bd = Infinity;
    for (const t of trails) {
      for (let i = 0; i < t.xs.length; i += 2) {
        const d = (t.xs[i] - x) ** 2 + (t.zs[i] - z) ** 2;
        if (d < bd) { bd = d; best = { trail: t, i }; }
      }
    }
    const { trail: t, i } = best;
    const j = Math.min(i + 3, t.xs.length - 1), k = Math.max(i - 3, 0);
    return {
      x: t.xs[i], z: t.zs[i], y: heightAt(t.xs[i], t.zs[i]),
      // compass heading (0 = north/-z, clockwise) along the trail
      heading: Math.atan2(t.xs[j] - t.xs[k], -(t.zs[j] - t.zs[k])),
      dist: Math.sqrt(bd), trailId: t.id,
    };
  }

  const trailDistAt = (x, z) => {
    const ix = clamp(Math.round((x + HALF) / CELL), 0, N);
    const iz = clamp(Math.round((z + HALF) / CELL), 0, N);
    return trailDist[iz * VN + ix];
  };

  return {
    N, SIZE, CELL, HALF, VN,
    heights: h, normals, mat, wet, trailSd, trailDist,
    waterY, lake: LAKE, lakeD, trails, landmarks,
    heightAt, normalAt, surfaceAt, nearestTrailPoint, trailDistAt,
    sampleMat: (k, x, z) => sample(mat, 4, k, x, z),
  };
}
