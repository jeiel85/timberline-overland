// Samples the terrain around the mine, the hut and the tarn dock into
// terrain.json, in each site's local frame (three.js axes, metres, heights
// relative to the landmark) for the Blender blockout scripts beside it.
// Run: node tools/blender/sample.mjs
import fs from 'node:fs';
import { generateTerrain } from '../../src/terrain.js';

const T = generateTerrain();
const L = Object.fromEntries(T.landmarks.map((l) => [l.id, l]));
// The site yaws used in src/props.js.
const yaws = {
  mine: -Math.PI / 2,
  hut: Math.PI * 0.35,
  tarn: Math.atan2(T.lake.x - L.tarn.x, T.lake.z - L.tarn.z),
};
const R = 24, step = 1, n = (2 * R) / step + 1;
const out = { waterY: T.waterY };
for (const [id, yaw] of Object.entries(yaws)) {
  const l = L[id], c = Math.cos(yaw), s = Math.sin(yaw);
  const h = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const lx = -R + i * step, lz = -R + j * step;
      h.push(+(T.heightAt(l.x + lx * c + lz * s, l.z - lx * s + lz * c) - l.y).toFixed(3));
    }
  }
  out[id] = { yaw, R, step, n, h, waterLocal: T.waterY - l.y };
}
fs.writeFileSync(new URL('terrain.json', import.meta.url), JSON.stringify(out));
console.log('wrote tools/blender/terrain.json');
