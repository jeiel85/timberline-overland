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
