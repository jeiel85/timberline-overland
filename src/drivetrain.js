// Engine, transfer case and differentials. Pure functions so the tests can
// check the crawling behaviour without a physics engine.

// Two transfer-case ranges. Forces are total tractive force at the tyres (N).
export const RANGES = {
  high: { peak: 9800, power: 135000, top: 26, reverseTop: 7, engineBrake: 900, gears: 5 },
  low: { peak: 22000, power: 105000, top: 9.5, reverseTop: 4.2, engineBrake: 9000, gears: 2 },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Tractive force the engine can deliver at speed `v` (m/s) for a throttle in [0, 1]. */
export function driveForce(range, v, throttle, reverse = false) {
  const R = RANGES[range];
  const top = reverse ? R.reverseTop : R.top;
  const speed = Math.abs(v);
  let f = Math.min(R.peak, R.power / Math.max(speed, 0.1));
  f *= clamp((top - speed) / (top * 0.12), 0, 1);
  return f * clamp(throttle, 0, 1);
}

/**
 * Share an axle's demanded force between its left and right wheel.
 * caps are the friction forces each tyre can still put down (N, >= 0).
 * An open differential gives both wheels the same torque, so the wheel with
 * less grip sets the limit; a locked one lets the gripping wheel take it all.
 */
export function splitAxle(force, capL, capR, locked) {
  const s = Math.sign(force);
  const f = Math.abs(force);
  if (locked) {
    let l = f / 2;
    let r = f / 2;
    if (l > capL) { r += l - capL; l = capL; }
    if (r > capR) { l = Math.min(capL, l + (r - capR)); r = capR; }
    const spin = f > capL + capR + 1e-6;
    return { left: s * l, right: s * r, spinL: spin, spinR: spin };
  }
  const each = Math.min(f / 2, capL, capR);
  return { left: s * each, right: s * each, spinL: f / 2 > capL + 1e-6, spinR: f / 2 > capR + 1e-6 };
}

const axleCapacity = (capL, capR, locked) => (locked ? capL + capR : 2 * Math.min(capL, capR));

/**
 * Part-time 4WD: the centre is always locked, so torque the front axle cannot
 * use goes to the rear and vice versa. caps/forces are ordered FL, FR, RL, RR.
 */
export function distribute(force, caps, diffLock) {
  const f = Math.abs(force);
  const s = Math.sign(force);
  const capF = axleCapacity(caps[0], caps[1], diffLock);
  const capR = axleCapacity(caps[2], caps[3], diffLock);
  let front = f / 2;
  let rear = f / 2;
  if (front > capF) { rear += front - capF; front = capF; }
  if (rear > capR) { front = Math.min(capF, front + (rear - capR)); rear = capR; }
  // Whatever neither axle can take still reaches the wheels and spins them.
  const left = f - front - rear;
  if (left > 1e-6) { front += left / 2; rear += left / 2; }
  const a = splitAxle(s * front, caps[0], caps[1], diffLock);
  const b = splitAxle(s * rear, caps[2], caps[3], diffLock);
  return {
    forces: [a.left, a.right, b.left, b.right],
    spin: [a.spinL, a.spinR, b.spinL, b.spinR],
  };
}

// --- automatic gearbox -------------------------------------------------------
// Drives the engine speed for the sound and the gauges; the tractive force
// above does not depend on it.

// Chosen so a full-throttle run shifts at about 23, 40, 61 and 85 km/h and
// cruises near 2,400 rpm at the 94 km/h top speed.
const H_RATIOS = [5.2, 3.0, 1.95, 1.4, 1.0];
const FINAL_DRIVE = 4.1;
const LOW_RANGE = 2.6;
const REVERSE = 4.6;
const LOW_TOP_GEAR = 4;
export const ENGINE = { idle: 760, stall: 2100, redline: 4200 };

const lerp = (a, b, t) => a + (b - a) * t;

export class Gearbox {
  constructor() {
    this.gear = 1;
    this.rpm = ENGINE.idle;
    this.limiter = false;
    this.shiftTimer = 0;
    this.cooldown = 0;
    this.shifts = 0;
  }

  get shifting() {
    return this.shiftTimer > 0;
  }

  ratio(gear, range, reverse) {
    return (reverse ? REVERSE : H_RATIOS[gear - 1]) * FINAL_DRIVE * (range === 'low' ? LOW_RANGE : 1);
  }

  /**
   * wheelOmega: mean wheel speed (rad/s, any sign) — spinning or airborne
   * wheels flare the revs just as they would on a real car.
   */
  update(dt, wheelOmega, throttle, range, reverse) {
    const wheelRpm = (Math.abs(wheelOmega) * 60) / (2 * Math.PI);
    const top = range === 'low' ? LOW_TOP_GEAR : H_RATIOS.length;
    if (reverse) this.gear = 1;
    else {
      if (this.gear > top) this.gear = top;
      this.cooldown -= dt;
      const locked = wheelRpm * this.ratio(this.gear, range, false);
      const up = lerp(1700, 3000, throttle);
      const down = lerp(1000, 1500, throttle);
      if (this.cooldown <= 0 && locked > up && this.gear < top) this.shift(1, 0.22);
      else if (this.cooldown <= 0 && locked < down && this.gear > 1) this.shift(-1, 0.16);
    }
    const locked = wheelRpm * this.ratio(this.gear, range, reverse);
    // The torque converter slips at low road speed, so the engine runs ahead
    // of the wheels: at a standstill full throttle holds it near stall speed.
    const slip = clamp(1 - locked / 1600, 0, 1);
    const converter = ENGINE.idle + throttle * (ENGINE.stall - ENGINE.idle);
    let target = Math.max(ENGINE.idle, lerp(locked, converter, slip));
    this.limiter = target > ENGINE.redline;
    target = Math.min(target, ENGINE.redline);
    const rate = this.shifting ? 7000 : target > this.rpm ? 3200 : 2200;
    this.rpm += clamp(target - this.rpm, -rate * dt, rate * dt);
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    return this;
  }

  shift(step, time) {
    this.gear += step;
    this.shiftTimer = time;
    this.cooldown = 0.7;
    this.shifts++;
  }
}
