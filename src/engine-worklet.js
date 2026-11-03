// AudioWorklet engine: a six-cylinder turbo-diesel built from its firing
// pulses. Each combustion event is a short noisy impulse that rings through
// a few resonators standing in for the exhaust pipe, the silencer and the
// block; diesel knock, the turbo whistle and cycle-to-cycle jitter give it
// life. Runs on the audio thread; parameters come from the game each frame.

const TAU = Math.PI * 2;
const CYLINDERS = 6;

/** Two-pole resonator with roughly unit gain at its centre frequency. */
class Resonator {
  constructor(sr) {
    this.sr = sr;
    this.y1 = 0;
    this.y2 = 0;
    this.set(100, 4);
  }

  set(freq, q) {
    const w = (TAU * freq) / this.sr;
    const r = Math.exp(-w / (2 * q));
    this.a1 = 2 * r * Math.cos(w);
    this.a2 = -r * r;
    this.g = (1 - r) * 2 * Math.sin(w);
  }

  step(x) {
    const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 760, minValue: 0, maxValue: 6000, automationRate: 'k-rate' },
      // 0 = coasting, 1 = full load
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      // fuel cut: limiter, gear shifts, overrun
      { name: 'cut', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const sr = sampleRate;
    this.sr = sr;
    this.seed = 0x9e3779b9;
    this.fp = 0;
    this.threshold = 1;
    this.cyl = 0;
    // Small imbalances between cylinders are what make an engine sound like one.
    this.cylAmp = [1, 0.9, 1.07, 0.95, 1.04, 0.88];
    this.env = 0;
    this.knockEnv = 0;
    this.exhaust = new Resonator(sr);
    this.silencer = new Resonator(sr);
    this.block = new Resonator(sr);
    this.knock = new Resonator(sr);
    this.knock.set(3300, 7);
    this.thump = 0;
    this.dcX = 0;
    this.dcY = 0;
    this.rpm = 760;
    this.load = 0;
    this.cut = 0;
    this.boost = 0;
    this.turboPhase = 0;
  }

  rand() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 2147483648 - 1;
  }

  process(_inputs, outputs, params) {
    const out = outputs[0];
    const L = out && out[0];
    if (!L) return true;
    const sr = this.sr;
    // Ease the controls per block so automation steps never click.
    this.rpm += (params.rpm[0] - this.rpm) * 0.25;
    this.load += (params.load[0] - this.load) * 0.2;
    this.cut += (params.cut[0] - this.cut) * 0.35;
    const rpm = Math.max(0, this.rpm);
    const load = this.load;
    const fuel = 1 - this.cut;
    const revs = Math.min(1, rpm / 4200);

    this.exhaust.set(78 + rpm * 0.013, 3.4);
    this.silencer.set(240 + rpm * 0.05, 2.2);
    this.block.set(950 + rpm * 0.22 + load * 350, 1.4);

    const fireHz = (rpm / 120) * CYLINDERS;
    const inc = fireHz / sr;
    const decay = Math.exp(-1 / (sr * (0.0018 + 0.0042 * (1 - revs))));
    const knockDecay = Math.exp(-1 / (sr * 0.0011));
    const pulse = (0.3 + 0.7 * load) * (0.18 + 0.82 * fuel);
    // Irregular when idling, burbling on the overrun, smooth under load.
    const jitter = 0.06 + 0.22 * (1 - load) * (1 - revs * 0.6) + this.cut * 0.45;
    const lope = 0.01 + 0.045 * Math.max(0, 1 - rpm / 1100);
    const knock = (0.6 * Math.max(0, 1 - rpm / 2600) + 0.25 * load) * (0.3 + 0.7 * fuel);
    const boostTarget = Math.max(0, (rpm - 1300) / 2600) * load * fuel;
    this.boost += (boostTarget - this.boost) * (boostTarget > this.boost ? 0.0035 : 0.012);
    const whistleHz = 1900 + this.boost * 5200;
    const whistle = this.boost * this.boost * 0.05;

    for (let i = 0; i < L.length; i++) {
      this.fp += inc;
      if (this.fp >= this.threshold) {
        this.fp -= this.threshold;
        this.threshold = 1 + this.rand() * lope;
        this.cyl = (this.cyl + 1) % CYLINDERS;
        const miss = this.cut > 0.5 && this.rand() > -0.3 ? 0.2 : 1;
        this.env = pulse * this.cylAmp[this.cyl] * (1 + jitter * this.rand()) * miss;
        this.knockEnv = knock * (0.75 + 0.25 * this.rand());
      }
      const noise = this.rand();
      const ex = this.env * (0.7 + 0.6 * noise);
      this.env *= decay;
      this.thump += (ex - this.thump) * 0.06;
      const kn = this.knock.step(this.knockEnv * noise);
      this.knockEnv *= knockDecay;

      let y = this.exhaust.step(ex) * 1.15
        + this.silencer.step(ex) * 0.6
        + this.block.step(ex * (0.25 + 0.75 * load)) * (0.25 + 0.3 * revs)
        + this.thump * 1.2
        + kn * 0.9;
      this.turboPhase += whistleHz / sr;
      if (this.turboPhase >= 1) this.turboPhase -= 1;
      y += Math.sin(this.turboPhase * TAU) * whistle;

      // DC blocker, then a soft clip so full load saturates instead of clipping.
      const dc = y - this.dcX + 0.996 * this.dcY;
      this.dcX = y;
      this.dcY = dc;
      L[i] = Math.tanh(dc * 2.2) * 0.7;
    }
    for (let c = 1; c < out.length; c++) out[c].set(L);
    return true;
  }
}

registerProcessor('timberline-engine', EngineProcessor);
