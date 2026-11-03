// Differential and engine behaviour that the crawling gameplay relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAxle, distribute, driveForce, RANGES } from '../src/drivetrain.js';

test('an open axle with one wheel in the air puts down no force', () => {
  const r = splitAxle(8000, 0, 5000, false);
  assert.equal(r.left + r.right, 0);
  assert.ok(r.spinL && !r.spinR);
});

test('a locked axle sends the force to the wheel that grips', () => {
  const r = splitAxle(8000, 0, 5000, true);
  assert.equal(r.left, 0);
  assert.equal(r.right, 5000);
  assert.ok(r.spinL && r.spinR, 'demand above total grip spins both');
});

test('with grip to spare open and locked axles behave the same', () => {
  const a = splitAxle(3000, 4000, 4000, false);
  const b = splitAxle(3000, 4000, 4000, true);
  assert.deepEqual([a.left, a.right], [1500, 1500]);
  assert.deepEqual([b.left, b.right], [1500, 1500]);
  assert.ok(!a.spinL && !a.spinR);
});

test('cross-axle articulation: open diffs stall, locked diffs climb', () => {
  // Front-left and rear-right unloaded, the classic diagonal.
  const caps = [0, 6000, 6000, 0];
  const open = distribute(10000, caps, false);
  const locked = distribute(10000, caps, true);
  const sum = (f) => f.forces.reduce((s, v) => s + v, 0);
  assert.equal(sum(open), 0);
  assert.equal(sum(locked), 10000);
});

test('the locked centre moves torque to the axle that has grip', () => {
  const r = distribute(10000, [0, 0, 6000, 6000], false);
  assert.equal(r.forces[2] + r.forces[3], 10000);
});

test('reverse force keeps its sign', () => {
  const r = distribute(-4000, [5000, 5000, 5000, 5000], false);
  assert.ok(r.forces.every((f) => f === -1000));
});

test('low range doubles the pull and caps the speed', () => {
  assert.ok(driveForce('low', 1, 1) > driveForce('high', 1, 1) * 2);
  assert.equal(driveForce('low', RANGES.low.top, 1), 0);
  assert.ok(driveForce('high', RANGES.low.top, 1) > 0);
  assert.equal(driveForce('high', 5, 0), 0);
});

// --- automatic gearbox (engine speed for the sound and the gauges) ---
import { Gearbox, ENGINE } from '../src/drivetrain.js';

const omegaAt = (v) => v / 0.43;
const run = (gb, seconds, fn) => {
  for (let t = 0; t < seconds; t += 1 / 120) fn(gb, t);
  return gb;
};

test('idles at a standstill and holds near stall speed on full throttle', () => {
  const idle = run(new Gearbox(), 2, (g) => g.update(1 / 120, 0, 0, 'high', false));
  assert.ok(Math.abs(idle.rpm - ENGINE.idle) < 1);
  const stall = run(new Gearbox(), 2, (g) => g.update(1 / 120, 0, 1, 'high', false));
  assert.ok(Math.abs(stall.rpm - ENGINE.stall) < 5, `rpm ${stall.rpm}`);
});

test('pulls up through the gears without passing the redline', () => {
  let maxRpm = 0;
  const gears = [];
  const gb = run(new Gearbox(), 30, (g, t) => {
    g.update(1 / 120, omegaAt(t * 0.9), 1, 'high', false);
    maxRpm = Math.max(maxRpm, g.rpm);
    if (gears[gears.length - 1] !== g.gear) gears.push(g.gear);
  });
  assert.deepEqual(gears, [1, 2, 3, 4, 5]);
  assert.ok(maxRpm <= ENGINE.redline, `max ${maxRpm}`);
  assert.equal(gb.gear, 5);
});

test('cruising at a shift point does not hunt between gears', () => {
  const gb = new Gearbox();
  run(gb, 10, (g) => g.update(1 / 120, omegaAt(9), 0.5, 'high', false));
  const before = gb.shifts;
  run(gb, 20, (g, t) => g.update(1 / 120, omegaAt(9 + Math.sin(t * 3) * 0.3), 0.5, 'high', false));
  assert.ok(gb.shifts - before <= 1, `${gb.shifts - before} shifts`);
});

test('low range reaches its top speed below the limiter', () => {
  const gb = run(new Gearbox(), 10, (g) => g.update(1 / 120, omegaAt(9.5), 1, 'low', false));
  assert.ok(gb.gear <= 4, `gear ${gb.gear}`);
  assert.ok(!gb.limiter && gb.rpm < ENGINE.redline, `rpm ${gb.rpm}`);
});

test('a high-range cruise at top speed sits in top gear at diesel revs', () => {
  const gb = run(new Gearbox(), 20, (g) => g.update(1 / 120, omegaAt(26), 0.4, 'high', false));
  assert.equal(gb.gear, 5);
  assert.ok(gb.rpm > 2000 && gb.rpm < 2800, `rpm ${gb.rpm}`);
});

test('a spinning wheel flares the revs and hits the limiter', () => {
  const gb = run(new Gearbox(), 3, (g) => g.update(1 / 120, 80, 1, 'low', false));
  assert.ok(gb.limiter);
  assert.ok(gb.rpm <= ENGINE.redline);
});

test('reverse uses a single gear', () => {
  const gb = run(new Gearbox(), 5, (g) => g.update(1 / 120, -omegaAt(3), 1, 'high', true));
  assert.equal(gb.gear, 1);
  assert.ok(gb.rpm > ENGINE.idle);
});
