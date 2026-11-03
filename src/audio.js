// Synthesised sound: engine, tyres on the ground, wind, water, suspension
// thumps and the discovery chime. No audio files.

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.level = 0.8;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const master = (this.master = ctx.createGain());
    master.gain.value = this.muted ? 0 : this.level;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w;
      d[i] = w * 0.6 + b * 2.5;
    }
    this.noiseBuf = noise;
    const loop = (filterType, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(master);
      src.start();
      return { f, g };
    };

    // Engine: two detuned oscillators through a soft clipper and a lowpass.
    const e1 = ctx.createOscillator();
    e1.type = 'sawtooth';
    const e2 = ctx.createOscillator();
    e2.type = 'square';
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    const eLow = ctx.createBiquadFilter();
    eLow.type = 'lowpass';
    eLow.Q.value = 2.5;
    const eGain = ctx.createGain();
    eGain.gain.value = 0;
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    const gs = ctx.createGain(); gs.gain.value = 0.6;
    e1.connect(g1).connect(shaper);
    e2.connect(g2).connect(shaper);
    sub.connect(gs).connect(eLow);
    shaper.connect(eLow).connect(eGain).connect(master);
    e1.start(); e2.start(); sub.start();
    this.engine = { e1, e2, sub, eLow, eGain };

    this.tyres = loop('bandpass', 900, 0.7);
    this.wind = loop('lowpass', 420, 0.4);
    this.water = loop('bandpass', 1500, 0.6);
    this.intake = loop('bandpass', 2400, 1.2);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.level, this.ctx.currentTime, 0.05);
  }

  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (param, v, tc = 0.06) => param.setTargetAtTime(v, t, tc);
    const f = (s.rpm / 60) * 1.5;
    const E = this.engine;
    set(E.e1.frequency, f);
    set(E.e2.frequency, f * 0.5 * 1.01);
    set(E.sub.frequency, f * 0.5);
    set(E.eLow.frequency, 260 + s.throttle * 1300 + s.rpm * 0.12);
    set(E.eGain.gain, s.active ? 0.09 + s.throttle * 0.1 + Math.min(0.06, s.rpm / 70000) : 0.04);
    set(this.intake.f.frequency, 1200 + s.rpm * 0.6);
    set(this.intake.g.gain, s.active ? s.throttle * 0.035 : 0);
    const roll = Math.min(1, Math.abs(s.speed) / 18);
    set(this.tyres.f.frequency, 500 + s.grit * 1600 + roll * 500);
    set(this.tyres.g.gain, s.active ? roll * (0.05 + s.grit * 0.12) + s.slip * 0.1 : 0);
    set(this.wind.g.gain, 0.02 + s.wind * 0.04 + roll * 0.05 + Math.max(0, s.altitude - 100) * 0.0005, 0.3);
    set(this.wind.f.frequency, 300 + s.wind * 300 + roll * 400, 0.3);
    set(this.water.g.gain, s.active ? Math.min(0.25, s.splash * 0.25) : 0, 0.08);
  }

  thump(strength) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 160;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(0.5, strength * 0.35), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.3);
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
      g.gain.linearRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 1.2);
    });
  }

  click() {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }
}
