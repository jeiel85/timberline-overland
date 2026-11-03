// Synthesised sound, no audio files. The engine is an AudioWorklet built from
// firing pulses (src/engine-worklet.js); around it: transmission whine, a
// texture per surface under the tyres, wheelspin, body scrapes and impacts,
// roof-rack rattle, wind, a little valley reverb and some wildlife.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ENGINE_URL = new URL('./engine-worklet.js', import.meta.url);

function noiseBuffer(ctx, seconds, brown) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      b = (b + 0.02 * w) / 1.02;
      d[i] = b * 3.5;
    } else d[i] = w;
  }
  return buf;
}

/** Sparse random clicks: stones under a tyre, snow crystals, rack rattle. */
function crackleBuffer(ctx, rate, grain, seconds = 2) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  let t = 0;
  while (t < n) {
    t += Math.max(1, Math.floor((-Math.log(1 - Math.random()) * sr) / rate));
    const a = Math.random() ** 2 * (Math.random() < 0.5 ? -1 : 1);
    const len = Math.floor(grain * sr * (0.4 + Math.random()));
    for (let k = 0; k < len && t + k < n; k++) d[t + k] += a * Math.exp((-4 * k) / len) * (Math.random() * 2 - 1);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < n; i++) d[i] /= peak || 1;
  return buf;
}

/** Bubbles and slosh for wading. */
function waterBuffer(ctx, seconds = 2) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let b = 0; b < seconds * 70; b++) {
    const start = Math.floor(Math.random() * n);
    const f0 = 280 + Math.random() * 1200;
    const len = Math.floor(sr * (0.012 + Math.random() * 0.04));
    const amp = 0.2 + Math.random() * 0.8;
    let ph = 0;
    for (let k = 0; k < len; k++) {
      const i = (start + k) % n;
      ph += (2 * Math.PI * f0 * (1 + (0.7 * k) / len)) / sr;
      d[i] += Math.sin(ph) * amp * Math.exp((-5 * k) / len);
    }
  }
  for (let i = 0; i < n; i++) d[i] = d[i] * 0.35 + (Math.random() * 2 - 1) * 0.08;
  return buf;
}

/** Outdoor space: a soft tail with two slap-back echoes off the valley walls. */
function valleyImpulse(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 1.8);
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.38)) * 0.35;
    for (const [at, g] of [[0.07 + c * 0.013, 0.5], [0.19 - c * 0.02, 0.32], [0.41 + c * 0.03, 0.18]]) {
      const s = Math.floor(at * sr);
      for (let k = 0; k < 600; k++) d[s + k] += (Math.random() * 2 - 1) * g * Math.exp(-k / 120);
    }
  }
  return buf;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.level = 0.85;
    this.engine = null;
    this.ignitionAt = -1;
    this.nextBird = 0;
    this.nextOwl = 0;
    this.lastThump = 0;
    this.lastCrash = 0;
  }

  /** Creates the audio graph; pass an OfflineAudioContext to render offline. */
  async start(context) {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && this.ctx.resume) await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!context && !AC) return;
    const ctx = (this.ctx = context || new AC());
    const master = (this.master = ctx.createGain());
    master.gain.value = this.muted ? 0 : this.level;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    const verb = ctx.createConvolver();
    verb.buffer = valleyImpulse(ctx);
    this.verbIn = ctx.createGain();
    this.verbIn.gain.value = 0.22;
    this.verbIn.connect(verb).connect(master);

    this.white = noiseBuffer(ctx, 2, false);
    this.brown = noiseBuffer(ctx, 2, true);
    const gravel = crackleBuffer(ctx, 900, 0.0009);
    const crunch = crackleBuffer(ctx, 260, 0.006);
    const rattle = crackleBuffer(ctx, 45, 0.0025);
    const water = waterBuffer(ctx);

    const layer = (buffer, type, freq, q, dest = master) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(dest);
      src.start(0, Math.random() * buffer.duration);
      return { src, f, g };
    };

    // --- engine -------------------------------------------------------------
    this.engineTone = ctx.createBiquadFilter();
    this.engineTone.type = 'lowpass';
    this.engineTone.Q.value = 0.8;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineTone.connect(this.engineGain).connect(master);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    this.engineGain.connect(send).connect(this.verbIn);
    this.engine = await this.makeEngine(ctx);
    this.engine.output.connect(this.engineTone);
    this.intake = layer(this.white, 'bandpass', 1800, 1.4);
    this.starter = ctx.createOscillator();
    this.starter.type = 'sawtooth';
    this.starter.frequency.value = 160;
    this.starterGain = ctx.createGain();
    this.starterGain.gain.value = 0;
    this.starter.connect(this.starterGain).connect(this.engineTone);
    this.starter.start();

    // --- driveline and ground ---------------------------------------------------
    this.whine = ctx.createOscillator();
    this.whine.type = 'triangle';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(master);
    this.whine.start();
    this.road = layer(this.brown, 'lowpass', 140, 0.7);
    this.gravel = layer(gravel, 'bandpass', 2000, 0.45);
    this.snowCrunch = layer(crunch, 'bandpass', 1500, 1.1);
    this.grass = layer(this.white, 'bandpass', 3400, 0.6);
    this.water = layer(water, 'bandpass', 900, 0.5);
    this.mud = layer(this.brown, 'lowpass', 420, 7);
    this.spray = layer(gravel, 'bandpass', 2600, 0.8);
    this.scrub = layer(this.white, 'bandpass', 900, 2.6);
    this.scrape = layer(this.white, 'bandpass', 1750, 3.2);
    this.grind = layer(this.brown, 'lowpass', 200, 1.5);
    this.rattle = layer(rattle, 'bandpass', 2800, 1.6);
    this.wind = layer(this.white, 'lowpass', 420, 0.5);

    // --- night insects ------------------------------------------------------------
    this.crickets = ctx.createGain();
    this.crickets.gain.value = 0;
    const chirp = ctx.createGain();
    chirp.gain.value = 0;
    const pulse = ctx.createOscillator();
    pulse.type = 'square';
    pulse.frequency.value = 26;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.5;
    pulse.connect(pulseDepth).connect(chirp.gain);
    for (const hz of [4350, 4720]) {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      o.connect(chirp);
      o.start();
    }
    pulse.start();
    chirp.connect(this.crickets).connect(master);
  }

  async makeEngine(ctx) {
    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        await ctx.audioWorklet.addModule(ENGINE_URL);
        const node = new AudioWorkletNode(ctx, 'timberline-engine', { numberOfInputs: 0, outputChannelCount: [1] });
        return {
          output: node,
          set: (rpm, load, cut, t) => {
            node.parameters.get('rpm').setTargetAtTime(rpm, t, 0.02);
            node.parameters.get('load').setTargetAtTime(load, t, 0.05);
            node.parameters.get('cut').setTargetAtTime(cut, t, 0.01);
          },
        };
      } catch (err) {
        // Worklets can be blocked (old browsers, strict CSP); fall back below.
        console.warn('Engine worklet unavailable, using the simple engine:', err);
      }
    }
    return this.simpleEngine(ctx);
  }

  /** Oscillator engine for browsers without AudioWorklet. */
  simpleEngine(ctx) {
    const out = ctx.createGain();
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    const sub = ctx.createOscillator();
    const g1 = ctx.createGain();
    g1.gain.value = 0.25;
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    saw.connect(g1).connect(out);
    sub.connect(g2).connect(out);
    saw.start();
    sub.start();
    return {
      output: out,
      set: (rpm, load, cut, t) => {
        saw.frequency.setTargetAtTime(Math.max(20, rpm / 20), t, 0.03);
        sub.frequency.setTargetAtTime(Math.max(10, rpm / 40), t, 0.03);
        out.gain.setTargetAtTime((0.2 + 0.4 * load) * (1 - 0.7 * cut), t, 0.03);
      },
    };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.level, this.ctx.currentTime, 0.05);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running' && this.ctx.suspend) this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
  }

  /** Crank the starter and let the engine catch. */
  ignition() {
    if (this.ctx) this.ignitionAt = this.ctx.currentTime;
  }

  /**
   * s: { active, rpm, load, cut, speed, range, view, surfaces: {name: share},
   *      slip, splash, scrape, rattle, wind, altitude, night, birds }
   */
  update(s) {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    const set = (param, v, tc = 0.05) => param.setTargetAtTime(v, t, tc);

    // --- engine, including the start-up sequence -------------------------------
    let { rpm, load, cut } = s;
    let starter = 0;
    const since = this.ignitionAt < 0 ? 99 : t - this.ignitionAt;
    if (since < 0.85) {
      rpm = 180 + 70 * Math.sin(since * 60) ** 2;
      load = 0.4;
      cut = 0.75;
      starter = 1;
    } else if (since < 1.7) {
      const k = (since - 0.85) / 0.85;
      rpm = Math.max(rpm, 1250 - 450 * k);
      load = Math.max(load, 0.35 * (1 - k));
    }
    if (!s.active && since > 1.7) load = 0;
    this.engine.set(rpm, load, cut, t);
    set(this.starter.frequency, 140 + 40 * Math.sin(since * 30));
    set(this.starterGain.gain, starter * 0.09, 0.02);
    const view = s.view === 'hood' ? { tone: 0.55, gain: 0.95, road: 1.25 } : s.view === 'drone' ? { tone: 0.8, gain: 0.55, road: 0.7 } : { tone: 1, gain: 1, road: 1 };
    set(this.engineTone.frequency, (700 + load * 2300 + rpm * 0.55) * view.tone, 0.04);
    set(this.engineGain.gain, (s.active || since < 1.7 ? 0.55 + 0.25 * load : 0.18) * view.gain);
    set(this.intake.f.frequency, 900 + rpm * 0.55);
    set(this.intake.g.gain, s.active ? load * (0.012 + rpm / 260000) : 0);

    // --- driveline whine: louder in low range ------------------------------------
    const v = Math.abs(s.speed);
    const low = s.range === 'low';
    set(this.whine.frequency, Math.max(20, v * (low ? 205 : 79)), 0.05);
    set(this.whineGain.gain, s.active ? Math.min(1, v / 3) * (low ? 0.022 : 0.006) * (0.5 + load) : 0);

    // --- tyres: one texture per surface, weighted by how many wheels are on it ----
    const S = s.surfaces;
    const roll = Math.min(1, v / 18);
    const rough = (S.rock || 0) * 1.2 + (S.dirt || 0) * 0.9 + (S.gravel || 0) * 0.8 + (S.scree || 0) * 1.0 + (S.grass || 0) * 0.45 + (S.snow || 0) * 0.35 + (S.mud || 0) * 0.6 + (S.water || 0) * 0.3 + (S.wood || 0) * 0.9;
    const on = s.active ? 1 : 0;
    set(this.road.f.frequency, 90 + v * 14);
    set(this.road.g.gain, on * roll ** 0.8 * rough * 0.32 * view.road);
    const loose = (S.gravel || 0) + (S.scree || 0) * 1.25 + (S.dirt || 0) * 0.3;
    set(this.gravel.src.playbackRate, 0.6 + Math.min(1.3, v / 12), 0.1);
    set(this.gravel.g.gain, on * loose * Math.min(1, v / 6) * 0.42 * view.road);
    set(this.snowCrunch.src.playbackRate, 0.7 + Math.min(1, v / 14), 0.1);
    set(this.snowCrunch.g.gain, on * (S.snow || 0) * Math.min(1, v / 4) * 0.5 * view.road);
    set(this.grass.g.gain, on * (S.grass || 0) * Math.min(1, v / 9) * 0.07);
    set(this.water.f.frequency, 600 + Math.sin(t * 3.1) * 250 + s.splash * 500);
    set(this.water.g.gain, on * Math.min(1, s.splash) * 0.55);
    set(this.mud.f.frequency, 260 + 200 * (0.5 + 0.5 * Math.sin(t * (4 + v))));
    set(this.mud.g.gain, on * (S.mud || 0) * Math.min(1, v / 4 + s.slip) * 0.3);

    // --- wheelspin: spray on loose ground, scrub on rock -------------------------
    const hard = (S.rock || 0) + (S.wood || 0) + (S.dirt || 0) * 0.5;
    set(this.spray.src.playbackRate, 1.2 + s.slip * 0.6, 0.1);
    set(this.spray.g.gain, on * s.slip * Math.min(1, loose + (S.snow || 0) + (S.mud || 0)) * 0.5, 0.04);
    set(this.scrub.g.gain, on * s.slip * hard * 0.22, 0.04);

    // --- the body on rocks, and the roof rack ------------------------------------------
    set(this.scrape.f.frequency, 1300 + Math.min(1, v / 6) * 1200);
    set(this.scrape.g.gain, on * s.scrape * 0.42, 0.03);
    set(this.grind.g.gain, on * s.scrape * 0.5, 0.03);
    set(this.rattle.src.playbackRate, 0.8 + s.rattle * 1.2, 0.1);
    set(this.rattle.g.gain, on * s.rattle * 0.16, 0.04);

    // --- wind and wildlife ------------------------------------------------------------
    const gust = 0.7 + 0.3 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);
    set(this.wind.f.frequency, 320 + v * 28 + s.wind * 260, 0.3);
    set(this.wind.g.gain, (0.012 + s.wind * 0.03 * gust + roll * 0.06 + Math.max(0, s.altitude - 90) * 0.0004) * (s.view === 'hood' ? 0.6 : 1), 0.3);
    set(this.crickets.gain, s.night && s.altitude < 110 && v < 12 ? 0.006 : 0, 0.8);
    if (s.birds && t > this.nextBird) {
      this.nextBird = t + 2.5 + Math.random() * 6;
      this.birdsong(t + 0.05);
    }
    if (s.night && s.altitude < 100 && t > this.nextOwl) {
      if (this.nextOwl) this.owl(t + 0.05);
      this.nextOwl = t + 14 + Math.random() * 20;
    }
  }

  birdsong(t0) {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain();
    out.gain.value = 0.018 + Math.random() * 0.012;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; out.connect(pan).connect(this.master); } else out.connect(this.master);
    const base = 2300 + Math.random() * 1800;
    const notes = 3 + Math.floor(Math.random() * 4);
    let t = t0;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const dur = 0.05 + Math.random() * 0.09;
      const f = base * (0.85 + Math.random() * 0.4);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (1.15 + Math.random() * 0.35), t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.02);
      t += dur + 0.03 + Math.random() * 0.08;
    }
  }

  owl(t0) {
    const ctx = this.ctx;
    for (const [at, f] of [[0, 390], [0.55, 370], [0.8, 355]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(f, t0 + at);
      o.frequency.linearRampToValueAtTime(f * 0.94, t0 + at + 0.35);
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(0.025, t0 + at + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + at + 0.4);
      o.connect(g).connect(this.verbIn);
      o.connect(g).connect(this.master);
      o.start(t0 + at);
      o.stop(t0 + at + 0.45);
    }
  }

  /** Short noise burst through a filter, for the one-shot effects below. */
  burst(type, freq, q, gain, decay, dest = this.master, at = this.ctx.currentTime) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0008, at + decay);
    src.connect(f).connect(g).connect(dest);
    src.start(at, Math.random() * 1.5);
    src.stop(at + decay + 0.05);
  }

  /** A suspension bump: a low thud, plus a clatter from the rack on big ones. */
  thump(strength) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    if (t - this.lastThump < 0.07) return;
    this.lastThump = t;
    const k = clamp(strength, 0, 1.5);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.32 * k, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.22);
    this.burst('lowpass', 350, 0.7, 0.25 * k, 0.12);
    if (k > 0.6) this.burst('bandpass', 2400 + Math.random() * 900, 4, 0.08 * k, 0.18);
  }

  /** The body hitting a rock or a tree. */
  crash(strength) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    if (t - this.lastCrash < 0.25) return;
    this.lastCrash = t;
    const k = clamp(strength, 0.2, 1);
    this.burst('lowpass', 260, 0.9, 0.7 * k, 0.35);
    this.burst('lowpass', 260, 0.9, 0.25 * k, 0.5, this.verbIn);
    for (const hz of [620, 1330, 2750]) this.burst('bandpass', hz * (0.9 + Math.random() * 0.2), 9, 0.22 * k, 0.25 + Math.random() * 0.2);
  }

  /** Transfer case or locker engaging. */
  clunk(heavy = true) {
    if (!this.ctx || this.muted) return;
    this.burst('bandpass', heavy ? 700 : 1500, 2.5, heavy ? 0.35 : 0.22, heavy ? 0.12 : 0.06);
    this.burst('lowpass', 160, 1, heavy ? 0.3 : 0.12, 0.1);
  }

  chime() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz;
      const g = ctx.createGain();
      const t = t0 + i * 0.11;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      o.connect(g).connect(this.master);
      o.connect(g).connect(this.verbIn);
      o.start(t);
      o.stop(t + 1.2);
    });
  }
}
