// Expedition log bookkeeping and save round-trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Journal, formatTime } from '../src/journal.js';
import { LANDMARKS } from '../src/layout.js';

test('places are found inside their radius only', () => {
  const j = new Journal(LANDMARKS);
  const cabin = LANDMARKS.find((l) => l.id === 'cabin');
  assert.equal(j.check(cabin.x + cabin.r + 1, cabin.z), null);
  assert.equal(j.check(cabin.x + cabin.r - 1, cabin.z)?.id, 'cabin');
  assert.equal(j.check(cabin.x, cabin.z), null, 'only reported once');
  assert.equal(j.count, 1);
});

test('base camp does not count towards the log', () => {
  const j = new Journal(LANDMARKS);
  const camp = LANDMARKS.find((l) => l.id === 'basecamp');
  assert.equal(j.check(camp.x, camp.z), null);
  assert.equal(j.total, 8);
});

test('next follows the route and completion stops the clock', () => {
  const j = new Journal(LANDMARKS);
  assert.equal(j.next.id, 'cabin');
  for (const l of LANDMARKS.filter((x) => x.counted)) {
    j.tick(10, 5, 3);
    j.check(l.x, l.z);
  }
  assert.ok(j.complete);
  assert.equal(j.next, null);
  assert.equal(j.completedAt, 80);
  j.tick(10, 5, 40);
  assert.equal(j.time, 80);
  assert.equal(j.distance, 45);
  assert.equal(j.maxTilt, 40);
});

test('a saved journal restores and ignores unknown ids', () => {
  const j = new Journal(LANDMARKS);
  j.check(LANDMARKS[2].x, LANDMARKS[2].z);
  j.recoveries = 3;
  const saved = JSON.parse(JSON.stringify(j));
  saved.found.push('atlantis');
  const k = new Journal(LANDMARKS, saved);
  assert.deepEqual([...k.found], [LANDMARKS[2].id]);
  assert.equal(k.recoveries, 3);
});

test('times format as m:ss or h:mm:ss', () => {
  assert.equal(formatTime(75), '1:15');
  assert.equal(formatTime(3725), '1:02:05');
});
