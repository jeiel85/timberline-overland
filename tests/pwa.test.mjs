// The installable app: the service worker must precache everything the game
// boots from, and the manifest must point at real icons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const exists = (p) => fs.existsSync(new URL(p, root));

const sw = read('sw.js');
const precache = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
const html = read('index.html');
const importMap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;

test('every module in src/ is precached', () => {
  for (const f of fs.readdirSync(new URL('src/', root)).filter((n) => n.endsWith('.js'))) {
    assert.ok(precache.includes(`./src/${f}`), `src/${f} missing from sw.js PRECACHE`);
  }
});

test('every precached local file exists', () => {
  for (const p of precache.filter((u) => u.startsWith('./') && u !== './')) assert.ok(exists(p.slice(2)), p);
});

test('the CDN modules match the import map and the addons in use', () => {
  assert.ok(precache.includes(importMap.three));
  assert.ok(precache.includes(importMap['@dimforge/rapier3d-compat']));
  const addons = new Set();
  for (const f of fs.readdirSync(new URL('src/', root)).filter((n) => n.endsWith('.js'))) {
    for (const m of read(`src/${f}`).matchAll(/from 'three\/addons\/([^']+)'/g)) addons.add(m[1]);
  }
  assert.ok(addons.size > 0);
  for (const a of addons) assert.ok(precache.includes(importMap['three/addons/'] + a), `addon ${a}`);
});

function pngSize(p) {
  const b = fs.readFileSync(new URL(p, root));
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${p} is not a PNG`);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

test('the manifest is installable and its icons are real', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color']) assert.ok(m[k], k);
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.equal(pngSize(i.src), i.sizes, i.src);
  for (const s of m.screenshots || []) assert.ok(exists(s.src), s.src);
  assert.equal(pngSize('icons/apple-touch-icon.png'), '180x180');
});

test('the page links the manifest and registers the worker', () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest"/);
  assert.match(read('src/main.js'), /serviceWorker\.register\('sw\.js'\)/);
});
