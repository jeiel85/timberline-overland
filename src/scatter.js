// Where trees, boulders, trail rocks, grass and flowers go. Pure data so the
// renderer and the physics world agree on every collider.

import { makeNoise2D, fbm, mulberry32, smoothstep } from './noise.js';
import { GULLY } from './layout.js';

const TREE_SPRUCE = 0;
const TREE_LARCH = 1;
const TREE_SNAG = 2;
export const TREE = { SPRUCE: TREE_SPRUCE, LARCH: TREE_LARCH, SNAG: TREE_SNAG };

export function scatter(T, seed = 99) {
  const rand = mulberry32(seed);
  const nForest = makeNoise2D(seed + 1);
  const nMeadow = makeNoise2D(seed + 2);
  const { HALF, landmarks } = T;
  const larch = landmarks.find((l) => l.id === 'larch');

  const nearPad = (x, z, extra) => landmarks.some((l) => Math.hypot(x - l.x, z - l.z) < Math.max(l.pad, 6) + extra);
  const inLake = (x, z, margin) => T.lakeD(x, z) < 1 + margin;

  // --- trees ---------------------------------------------------------------
  const trees = [];
  const TC = 5.5;
  for (let z = -HALF + 4; z < HALF - 4; z += TC) {
    for (let x = -HALF + 4; x < HALF - 4; x += TC) {
      const px = x + (rand() - 0.5) * TC * 0.9;
      const pz = z + (rand() - 0.5) * TC * 0.9;
      const y = T.heightAt(px, pz);
      const ny = T.normalAt(px, pz)[1];
      if (ny < 0.82) continue;
      const treeline = 92 + 14 * nForest(px / 70, pz / 70);
      if (y > treeline) continue;
      if (T.trailDistAt(px, pz) < 5.5 || inLake(px, pz, 0.12) || nearPad(px, pz, 5)) continue;
      const dLarch = Math.hypot(px - larch.x, pz - larch.z);
      let density = smoothstep(-0.2, 0.35, fbm(nForest, px / 170, pz / 170, 3)) * (1 - smoothstep(treeline - 25, treeline, y));
      if (dLarch < 55) density = Math.max(density, 0.85 * (1 - smoothstep(35, 55, dLarch)));
      if (rand() > density) continue;
      let type = TREE_SPRUCE;
      const larchChance = dLarch < 55 ? 0.85 : 0.08 + 0.4 * smoothstep(35, 80, y);
      if (rand() < larchChance) type = TREE_LARCH;
      if (rand() < 0.025) type = TREE_SNAG;
      const s = 0.7 + rand() * 0.7 - smoothstep(60, 100, y) * 0.2;
      trees.push({ x: px, y: y - 0.15, z: pz, s, rot: rand() * Math.PI * 2, type, tint: rand() });
    }
  }

  // --- boulders --------------------------------------------------------------
  const boulders = [];
  const BC = 8;
  for (let z = -HALF + 6; z < HALF - 6; z += BC) {
    for (let x = -HALF + 6; x < HALF - 6; x += BC) {
      const px = x + (rand() - 0.5) * BC;
      const pz = z + (rand() - 0.5) * BC;
      const n = T.normalAt(px, pz);
      const ny = n[1];
      if (ny < 0.6) continue;
      const y = T.heightAt(px, pz);
      // Talus collects on moderate slopes under the walls; meadows stay mostly clear.
      const p = 0.03 + 0.5 * smoothstep(0.95, 0.8, ny) * (1 - smoothstep(0.7, 0.62, ny)) + 0.08 * smoothstep(90, 140, y);
      if (rand() > p) continue;
      const size = 0.6 + 2.6 * Math.pow(rand(), 2.6);
      if (T.trailDistAt(px, pz) < 4 + size || inLake(px, pz, 0.05) || nearPad(px, pz, 3 + size)) continue;
      boulders.push({ x: px, y: y - size * 0.3, z: pz, sx: size * (0.8 + rand() * 0.5), sy: size * (0.55 + rand() * 0.35), sz: size * (0.8 + rand() * 0.5), rot: rand() * Math.PI * 2, shape: Math.floor(rand() * 4), tint: rand() });
    }
  }

  // --- the boulder gully: rocks on the trail to crawl over -------------------
  const main = T.trails.find((t) => t.id === 'main');
  for (let i = 0; i < main.xs.length; i += 2) {
    const x = main.xs[i], z = main.zs[i];
    if (z < GULLY.zMin || z > GULLY.zMax) continue;
    const j = Math.min(i + 1, main.xs.length - 1);
    const tx = main.xs[j] - main.xs[Math.max(i - 1, 0)], tz = main.zs[j] - main.zs[Math.max(i - 1, 0)];
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    // Flanking boulders make the walls of the gully.
    for (const side of [-1, 1]) {
      if (rand() < 0.55) {
        const off = side * (4.2 + rand() * 3);
        const size = 1.1 + rand() * 1.6;
        const bx = x + nx * off, bz = z + nz * off;
        boulders.push({ x: bx, y: T.heightAt(bx, bz) - size * 0.35, z: bz, sx: size, sy: size * 0.75, sz: size * 1.1, rot: rand() * 6.28, shape: Math.floor(rand() * 4), tint: rand() });
      }
    }
    for (let r = rand() < 0.35 ? 2 : 1; r > 0; r--) {
      if (rand() > 0.85) continue;
      const off = (rand() - 0.5) * 4.8;
      const size = 0.45 + rand() * 0.4;
      const bx = x + nx * off, bz = z + nz * off;
      // At most ~0.4 m of each trail rock stands proud of the ground.
      const exposed = Math.min(0.4, size * 0.55);
      boulders.push({ x: bx, y: T.heightAt(bx, bz) + exposed - size * 0.55, z: bz, sx: size * 1.2, sy: size * 0.55, sz: size, rot: rand() * 6.28, shape: Math.floor(rand() * 4), tint: rand(), trail: true });
    }
  }

  // --- pebbles (decor only) ----------------------------------------------------
  const pebbles = [];
  for (let k = 0; k < 4200; k++) {
    const px = (rand() - 0.5) * (2 * HALF - 20);
    const pz = (rand() - 0.5) * (2 * HALF - 20);
    const scree = T.sampleMat(3, px, pz);
    const tw = T.sampleMat(0, px, pz);
    if (rand() > 0.15 + scree * 0.8 + tw * 0.4 || inLake(px, pz, 0)) continue;
    pebbles.push({ x: px, y: T.heightAt(px, pz), z: pz, s: 0.08 + Math.pow(rand(), 2) * 0.3, rot: rand() * 6.28 });
  }

  // --- grass tufts and flowers (x, y, z, scale, rotation, tint) ---------------
  const grass = [];
  const flowers = [];
  const GC = 1.7;
  for (let z = -HALF + 2; z < HALF - 2; z += GC) {
    for (let x = -HALF + 2; x < HALF - 2; x += GC) {
      const px = x + (rand() - 0.5) * GC;
      const pz = z + (rand() - 0.5) * GC;
      const meadow = fbm(nMeadow, px / 60, pz / 60, 2);
      if (rand() > 0.5 + meadow * 0.3) continue;
      const y = T.heightAt(px, pz);
      if (y > 135) continue;
      const tw = T.sampleMat(0, px, pz), rock = T.sampleMat(1, px, pz), snow = T.sampleMat(2, px, pz), scree = T.sampleMat(3, px, pz);
      if (rock > 0.3 || snow > 0.25 || scree > 0.45 || inLake(px, pz, -0.02)) continue;
      // Grass lines the trail edges and the strip between the ruts, not the ruts themselves.
      if (tw > 0.35) {
        const sd = Math.abs(lateralAt(T, px, pz));
        if (sd > 0.35 && tw > 0.7) continue;
      }
      const s = 0.7 + rand() * 0.6 - smoothstep(90, 130, y) * 0.35;
      grass.push(px, y, pz, s, rand() * 6.28, rand());
      if (rand() < 0.07 + Math.max(0, meadow) * 0.12 && y < 120) flowers.push(px + 0.3, y, pz - 0.2, 0.8 + rand() * 0.5, rand() * 6.28, rand());
    }
  }

  return { trees, boulders, pebbles, grass: new Float32Array(grass), flowers: new Float32Array(flowers) };
}

function lateralAt(T, x, z) {
  const fx = (x + T.HALF) / T.CELL, fz = (z + T.HALF) / T.CELL;
  const ix = Math.min(Math.round(fx), T.N), iz = Math.min(Math.round(fz), T.N);
  return T.trailSd[iz * T.VN + ix];
}
