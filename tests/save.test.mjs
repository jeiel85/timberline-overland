// A save from an older build, a damaged one or a hand-edited one must load
// into something the game can run with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSave, serializeSave, SAVE_VERSION } from '../src/save.js';

const allowed = {
  langs: ['ko', 'en'],
  qualities: ['high', 'medium', 'low'],
  times: ['morning', 'noon', 'golden', 'night'],
  weathers: ['clear', 'mist', 'snow'],
  cams: ['chase', 'hood', 'drone'],
  placeIds: ['cabin', 'tarn', 'mine'],
  half: 500,
};

test('nothing stored, or garbage, gives an empty save', () => {
  for (const text of [null, '', 'not json', '[]', '42', 'null', '"x"']) {
    const s = parseSave(text, allowed);
    assert.equal(s.journal, null, text);
    assert.equal(s.pos, null, text);
    assert.deepEqual(Object.values(s.settings), [null, null, null, null, null, null], text);
  }
});

test('a v0.1.0 save without a version still loads', () => {
  const old = JSON.stringify({
    settings: { lang: 'en', quality: 'low', muted: true, time: 'night', weather: 'snow', cam: 'drone' },
    journal: { found: ['cabin'], time: 61.5, distance: 900, recoveries: 2, maxTilt: 31, completedAt: null },
    pos: { x: 10, z: -20, heading: 1.2 },
  });
  const s = parseSave(old, allowed);
  assert.equal(s.version, 1);
  assert.deepEqual(s.settings, { lang: 'en', quality: 'low', muted: true, time: 'night', weather: 'snow', cam: 'drone' });
  assert.deepEqual(s.journal.found, ['cabin']);
  assert.equal(s.journal.recoveries, 2);
  assert.deepEqual(s.pos, { x: 10, z: -20, heading: 1.2 });
});

test('unknown presets and wrong types fall back instead of breaking the boot', () => {
  const s = parseSave(JSON.stringify({
    settings: { lang: 'fr', quality: 'ultra', muted: 'yes', time: 'dusk', weather: 7, cam: null },
  }), allowed);
  assert.deepEqual(Object.values(s.settings), [null, null, null, null, null, null]);
});

test('journal fields are cleaned up', () => {
  const s = parseSave(JSON.stringify({
    journal: { found: ['cabin', 'cabin', 'atlantis', 5], time: -3, distance: 'far', recoveries: 1.5, maxTilt: 999, completedAt: 40 },
  }), allowed);
  assert.deepEqual(s.journal.found, ['cabin']);
  assert.equal(s.journal.time, 0);
  assert.equal(s.journal.distance, 0);
  assert.equal(s.journal.recoveries, 0);
  assert.equal(s.journal.maxTilt, 180);
  assert.equal(s.journal.completedAt, null, 'not complete with one place found');
});

test('a position off the map or not a number is dropped', () => {
  for (const pos of [{ x: 9000, z: 0 }, { x: 'a', z: 0 }, { x: 0 }, [1, 2], { x: NaN, z: 1 }]) {
    assert.equal(parseSave(JSON.stringify({ pos }), allowed).pos, null, JSON.stringify(pos));
  }
  assert.equal(parseSave(JSON.stringify({ pos: { x: 1, z: 2 } }), allowed).pos.heading, 0);
  // Anything inside the edge walls is a place the car could have stood.
  assert.deepEqual(parseSave(JSON.stringify({ pos: { x: 499.9, z: -499.9, heading: 2 } }), allowed).pos, { x: 499.9, z: -499.9, heading: 2 });
});

test('serialize writes the current version and round-trips', () => {
  const data = {
    settings: { lang: 'ko', quality: 'high', muted: false, time: 'golden', weather: 'clear', cam: 'chase' },
    journal: { found: ['tarn', 'mine'], time: 10, distance: 5, recoveries: 0, maxTilt: 12, completedAt: null },
    pos: { x: 3, z: 4, heading: 0.5 },
  };
  const text = serializeSave(data);
  assert.equal(JSON.parse(text).version, SAVE_VERSION);
  const back = parseSave(text, allowed);
  assert.deepEqual(back.settings, data.settings);
  assert.deepEqual(back.journal, data.journal);
  assert.deepEqual(back.pos, data.pos);
});
