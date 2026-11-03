// Render the engine worklet offline (with stand-ins for the AudioWorklet
// globals) and check the signal: bounded, pitched at the firing frequency,
// louder under load, quieter on a fuel cut, with a turbo whistle on boost.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SR = 48000;
let Engine = null;
globalThis.sampleRate = SR;
globalThis.AudioWorkletProcessor = class {};
globalThis.registerProcessor = (name, cls) => { Engine = cls; };
await import('../src/engine-worklet.js');

function render(seconds, { rpm, load = 0, cut = 0 }, engine = new Engine()) {
  const n = Math.round((seconds * SR) / 128);
  const out = new Float32Array(n * 128);
  const params = { rpm: new Float32Array([rpm]), load: new Float32Array([load]), cut: new Float32Array([cut]) };
  for (let b = 0; b < n; b++) {
    const block = new Float32Array(128);
    engine.process([], [[block]], params);
    out.set(block, b * 128);
  }
  return { out, engine };
}

const tail = (x, seconds) => x.subarray(x.length - Math.round(seconds * SR));
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

// Goertzel power at one frequency.
function power(x, freq) {
  const k = (2 * Math.PI * freq) / SR;
  const c = 2 * Math.cos(k);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s = x[i] + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / x.length;
}

test('stays finite and inside full scale', () => {
  for (const p of [{ rpm: 760 }, { rpm: 2400, load: 1 }, { rpm: 4200, load: 1 }, { rpm: 3000, cut: 1 }, { rpm: 0 }]) {
    const { out } = render(1, p);
    for (const v of out) assert.ok(Number.isFinite(v) && Math.abs(v) <= 0.7001, JSON.stringify(p));
  }
});

test('is pitched at the firing frequency', () => {
  for (const rpm of [900, 1800, 3000]) {
    const x = tail(render(1.5, { rpm, load: 0.7 }).out, 1);
    const fire = rpm / 20;
    const on = power(x, fire);
    const off = (power(x, fire * 0.71) + power(x, fire * 1.37)) / 2;
    assert.ok(on > off * 3, `${rpm} rpm: ${on.toExponential(2)} vs ${off.toExponential(2)}`);
  }
});

test('louder under load, quieter on a fuel cut', () => {
  const idle = rms(tail(render(1.5, { rpm: 2400, load: 0 }).out, 1));
  const full = rms(tail(render(1.5, { rpm: 2400, load: 1 }).out, 1));
  const cut = rms(tail(render(1.5, { rpm: 2400, load: 1, cut: 1 }).out, 1));
  assert.ok(full > idle * 1.4, `full ${full} idle ${idle}`);
  assert.ok(cut < full * 0.6, `cut ${cut} full ${full}`);
  assert.ok(idle > 0.01, 'still audible when coasting');
});

test('the turbo spools up and whistles on boost', () => {
  const { out, engine } = render(4, { rpm: 3500, load: 1 });
  assert.ok(engine.boost > 0.7, `boost ${engine.boost}`);
  const x = tail(out, 1);
  const hz = 1900 + engine.boost * 5200;
  assert.ok(power(x, hz) > (power(x, hz * 0.9) + power(x, hz * 1.1)) * 2);
  const idle = render(4, { rpm: 800, load: 0 }).engine;
  assert.ok(idle.boost < 0.01);
});
