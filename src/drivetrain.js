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

/** Engine speed and the automatic's gear, for the sound and the gauges. */
export function engineState(range, v, throttle) {
  const R = RANGES[range];
  const ratio = clamp(Math.abs(v) / R.top, 0, 1);
  const g = Math.min(R.gears, 1 + Math.floor(ratio * R.gears));
  const within = ratio * R.gears - (g - 1);
  const driven = 1300 + within * 3200;
  const idle = 820 + throttle * 1400;
  const rpm = Math.max(idle, Math.abs(v) < 0.3 ? 0 : driven);
  return { rpm: clamp(rpm, 750, 4800), gear: g };
}
