// The valley must stay drivable: trail grades, the ford, landmarks and spawn.
// Run from the repo root: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTerrain } from '../src/terrain.js';
import { TRAILS, SPAWN, FORD_DEPTH } from '../src/layout.js';
import { scatter } from '../src/scatter.js';

const T = generateTerrain();

test('generation is deterministic', () => {
  const again = generateTerrain();
  for (const i of [0, 1234, 99999, 200000, T.heights.length - 1]) assert.equal(again.heights[i], T.heights[i]);
});

for (const def of TRAILS) {
  test(`${def.id} trail stays within its grade along the centreline`, () => {
    const t = T.trails.find((x) => x.id === def.id);
    // Sample every 3 m so bilinear noise between 2 m vertices does not dominate.
    let worst = 0;
    for (let i = 3; i < t.xs.length; i += 3) {
      const ds = Math.hypot(t.xs[i] - t.xs[i - 3], t.zs[i] - t.zs[i - 3]);
      const dy = T.heightAt(t.xs[i], t.zs[i]) - T.heightAt(t.xs[i - 3], t.zs[i - 3]);
      worst = Math.max(worst, Math.abs(dy) / ds);
    }
    assert.ok(worst <= def.maxGrade * 1.25, `steepest ${worst.toFixed(3)} > ${def.maxGrade}`);
  });

  test(`${def.id} trail has no side slope a car would slide off`, () => {
    const t = T.trails.find((x) => x.id === def.id);
    let worst = 0;
    for (let i = 1; i < t.xs.length - 1; i++) {
      const tx = t.xs[i + 1] - t.xs[i - 1], tz = t.zs[i + 1] - t.zs[i - 1];
      const l = Math.hypot(tx, tz);
      const nx = -tz / l, nz = tx / l;
      const side = Math.abs(T.heightAt(t.xs[i] + nx * 1.5, t.zs[i] + nz * 1.5) - T.heightAt(t.xs[i] - nx * 1.5, t.zs[i] - nz * 1.5)) / 3;
      worst = Math.max(worst, side);
    }
    assert.ok(worst < 0.2, `side slope ${worst.toFixed(3)}`);
  });
}

test('the main trail fords the tarn at wading depth', () => {
  const main = T.trails.find((t) => t.id === 'main');
  let wet = 0;
  let deepest = 0;
  for (let i = 0; i < main.xs.length; i++) {
    if (T.lakeD(main.xs[i], main.zs[i]) > 1.2) continue;
    const depth = T.waterY - T.heightAt(main.xs[i], main.zs[i]);
    if (depth > 0) wet++;
    deepest = Math.max(deepest, depth);
  }
  assert.ok(wet > 15 && wet < 120, `ford length ${wet} m`);
  assert.ok(deepest <= FORD_DEPTH + 0.05, `ford depth ${deepest.toFixed(2)} m`);
});

test('every landmark is on dry ground inside the map', () => {
  for (const l of T.landmarks) {
    assert.ok(Math.abs(l.x) < T.HALF - 20 && Math.abs(l.z) < T.HALF - 20, l.id);
    assert.ok(T.surfaceAt(l.x, l.z) !== 'water', `${l.id} is under water`);
  }
  assert.equal(T.landmarks.filter((l) => l.counted).length, 8);
});

test('the spawn point is level dirt on the trail', () => {
  const n = T.normalAt(SPAWN.x, SPAWN.z);
  assert.ok(n[1] > 0.97);
  assert.ok(T.nearestTrailPoint(SPAWN.x, SPAWN.z).dist < 2);
});

test('no boulder or tree blocks the trail outside the gully', () => {
  const S = scatter(T);
  for (const tree of S.trees) assert.ok(T.trailDistAt(tree.x, tree.z) >= 5, `tree at ${tree.x.toFixed(0)},${tree.z.toFixed(0)}`);
  const onTrail = S.boulders.filter((b) => !b.trail && T.trailDistAt(b.x, b.z) < 3);
  assert.equal(onTrail.length, 0);
  // Gully rocks stand at most ~0.4 m proud of the ground.
  for (const b of S.boulders.filter((r) => r.trail)) {
    const top = b.y + b.sy * 1.05;
    assert.ok(top - T.heightAt(b.x, b.z) < 0.5, `gully rock ${(top - T.heightAt(b.x, b.z)).toFixed(2)} m tall`);
  }
});
