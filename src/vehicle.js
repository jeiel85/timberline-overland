// The expedition 4x4: a Rapier rigid body for the chassis, with our own
// ray-sampled wheels, long-travel suspension, tyre friction and drivetrain.

import * as THREE from 'three';
import { distribute, driveForce, engineState, RANGES } from './drivetrain.js';

export const MASS = 2150;
export const WHEEL_R = 0.43;
export const WHEELBASE = 2.76;
export const TRACK = 1.64;
const COM = { x: 0, y: 0.18, z: 0.05 };
const INERTIA = { x: 3900, y: 4300, z: 1500 };
const SUSP = { rest: 0.42, minLen: 0.06, k: 34000, cBump: 2600, cRebound: 3800, bumpK: 240000, arb: 7000 };
const BRAKE = 26000;
const DRAG = 0.9;
// Ray sample angles around the lower half of the tyre, in the wheel plane.
const SAMPLES = [-0.95, -0.5, 0, 0.5, 0.95];
const RAY_LIFT = 0.3;

export const SURFACES = {
  dirt: { mu: 0.95, roll: 0.018 },
  gravel: { mu: 0.82, roll: 0.022 },
  grass: { mu: 0.78, roll: 0.03 },
  rock: { mu: 1.05, roll: 0.015 },
  scree: { mu: 0.64, roll: 0.045 },
  snow: { mu: 0.52, roll: 0.05 },
  mud: { mu: 0.58, roll: 0.07 },
  water: { mu: 0.66, roll: 0.06 },
  wood: { mu: 0.85, roll: 0.02 },
};

// Chassis-local attach points: forward is +z, left is +x.
const LAYOUT = [
  { x: TRACK / 2, z: WHEELBASE / 2, front: true, left: true },
  { x: -TRACK / 2, z: WHEELBASE / 2, front: true, left: false },
  { x: TRACK / 2, z: -WHEELBASE / 2, front: false, left: true },
  { x: -TRACK / 2, z: -WHEELBASE / 2, front: false, left: false },
];
const ATTACH_Y = 0.05;

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _f = new THREE.Vector3();
const _s = new THREE.Vector3();
const _imp = new THREE.Vector3();

export class Vehicle {
  constructor(RAPIER, world, { surfaceAt, colliderKind, waterAt }) {
    this.R = RAPIER;
    this.world = world;
    this.surfaceAt = surfaceAt;
    this.colliderKind = colliderKind;
    this.waterAt = waterAt;

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setAdditionalMassProperties(MASS, COM, INERTIA, { x: 0, y: 0, z: 0, w: 1 })
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0.02)
      .setAngularDamping(0.25);
    this.body = world.createRigidBody(desc);
    const lower = RAPIER.ColliderDesc.roundCuboid(0.84, 0.42, 2.05, 0.1).setTranslation(0, 0.27, 0.05);
    const cabin = RAPIER.ColliderDesc.roundCuboid(0.8, 0.36, 1.32, 0.08).setTranslation(0, 1.17, -0.45);
    for (const c of [lower, cabin]) {
      c.setDensity(0).setFriction(0.55).setRestitution(0.05);
      world.createCollider(c, this.body);
    }

    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.wheels = LAYOUT.map((l) => ({
      ...l,
      attach: new THREE.Vector3(l.x, ATTACH_Y, l.z),
      len: SUSP.rest,
      prevLen: SUSP.rest,
      contact: false,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      hub: new THREE.Vector3(),
      fwd: new THREE.Vector3(),
      load: 0,
      spring: 0,
      steer: 0,
      omega: 0,
      angle: 0,
      spinning: false,
      sliding: false,
      surface: 'dirt',
      vf: 0,
      inWater: false,
    }));

    this.steer = 0;
    this.range = 'high';
    this.diffLock = false;
    this.handbrake = false;
    this.throttle = 0;
    this.brake = 0;
    this.drive = 0;
    this.speed = 0;
    this.rpm = 800;
    this.gear = 1;
    this.dir = 1;
    this.flipTime = 0;
    this.submerged = 0;
    this.impact = 0;
    this.events = [];

    this.q = new THREE.Quaternion();
    this.pos = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.fwd = new THREE.Vector3();
    this.left = new THREE.Vector3();
    this.vel = new THREE.Vector3();
  }

  /** Place the car upright at (x, y, z) facing compass `heading` (0 = north). */
  reset(x, y, z, heading) {
    const yaw = Math.PI - heading;
    const b = this.body;
    b.setTranslation({ x, y: y + 0.95, z }, true);
    b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) {
      w.len = w.prevLen = SUSP.rest;
      w.omega = 0;
    }
    this.steer = 0;
    this.flipTime = 0;
    this.readState();
  }

  readState() {
    const b = this.body;
    const t = b.translation();
    const r = b.rotation();
    this.pos.set(t.x, t.y, t.z);
    this.q.set(r.x, r.y, r.z, r.w);
    this.up.set(0, 1, 0).applyQuaternion(this.q);
    this.fwd.set(0, 0, 1).applyQuaternion(this.q);
    this.left.set(1, 0, 0).applyQuaternion(this.q);
    const v = b.linvel();
    this.vel.set(v.x, v.y, v.z);
    this.speed = this.vel.dot(this.fwd);
  }

  get heading() {
    return Math.atan2(this.fwd.x, -this.fwd.z);
  }
  get pitch() {
    return Math.asin(THREE.MathUtils.clamp(this.fwd.y, -1, 1));
  }
  get roll() {
    return Math.asin(THREE.MathUtils.clamp(this.left.y, -1, 1));
  }

  toggleRange() {
    this.range = this.range === 'high' ? 'low' : 'high';
    return this.range;
  }

  /** One fixed physics substep: wheel forces go in as impulses before world.step(). */
  step(dt, input) {
    this.readState();
    const b = this.body;
    const { up, fwd, pos } = this;
    const speed = this.speed;
    const absSpeed = Math.abs(speed);

    // --- driver intent -------------------------------------------------------
    this.handbrake = input.handbrake;
    let drive = 0;
    let brake = 0;
    if (input.throttle > 0.02) {
      if (speed < -0.8) brake = input.throttle;
      else { drive = input.throttle; this.dir = 1; }
    }
    if (input.brake > 0.02) {
      if (speed > 0.8) brake = Math.max(brake, input.brake);
      else if (input.throttle <= 0.02) { drive = -input.brake; this.dir = -1; }
    }
    // Smooth the pedals so crawling on a keyboard is possible.
    const rate = this.range === 'low' ? 1.6 : 3;
    this.drive += THREE.MathUtils.clamp(drive - this.drive, -rate * 2 * dt, rate * dt);
    if (Math.sign(this.drive) !== Math.sign(drive) && drive !== 0) this.drive = 0;
    this.brake = brake;
    if (this.diffLock && absSpeed > 11) { this.diffLock = false; this.events.push('lockOff'); }

    // --- steering with Ackermann ---------------------------------------------------
    const maxSteer = 0.62 / (1 + (speed * speed) / 320);
    const target = -input.steer * maxSteer;
    this.steer += THREE.MathUtils.clamp(target - this.steer, -2.4 * dt, 2.4 * dt);
    const d = this.steer;
    let inner = d, outer = d;
    if (Math.abs(d) > 1e-4) {
      const Rt = WHEELBASE / Math.tan(Math.abs(d));
      inner = Math.sign(d) * Math.atan(WHEELBASE / (Rt - TRACK / 2));
      outer = Math.sign(d) * Math.atan(WHEELBASE / (Rt + TRACK / 2));
    }
    // d < 0 turns right (towards -x): the right wheel is the inner one.
    for (const w of this.wheels) {
      w.steer = !w.front ? 0 : (d < 0) === !w.left ? inner : outer;
    }

    // --- suspension: sample the ground under each tyre ------------------------------
    const ray = this.ray;
    let totalLoad = 0;
    for (const w of this.wheels) {
      const attach = _p.copy(w.attach).applyQuaternion(this.q).add(pos);
      w.fwd.copy(fwd).applyAxisAngle(up, w.steer);
      let best = SUSP.rest;
      let hit = null;
      let hitAngle = 0;
      for (const a of SAMPLES) {
        const off = WHEEL_R * Math.sin(a);
        ray.origin.x = attach.x + w.fwd.x * off + up.x * RAY_LIFT;
        ray.origin.y = attach.y + w.fwd.y * off + up.y * RAY_LIFT;
        ray.origin.z = attach.z + w.fwd.z * off + up.z * RAY_LIFT;
        ray.dir.x = -up.x; ray.dir.y = -up.y; ray.dir.z = -up.z;
        const reach = RAY_LIFT + SUSP.rest + WHEEL_R * Math.cos(a);
        const h = this.world.castRayAndGetNormal(ray, reach, true, undefined, undefined, undefined, b);
        if (!h) continue;
        const len = h.timeOfImpact - RAY_LIFT - WHEEL_R * Math.cos(a);
        if (len < best) {
          best = len;
          hitAngle = a;
          hit = h;
          w.point.set(ray.origin.x - up.x * h.timeOfImpact, ray.origin.y - up.y * h.timeOfImpact, ray.origin.z - up.z * h.timeOfImpact);
          w.normal.set(h.normal.x, h.normal.y, h.normal.z);
        }
      }
      w.prevLen = w.len;
      if (!hit) {
        w.contact = false;
        w.len = Math.min(SUSP.rest, w.len + 1.5 * dt);
        w.spring = 0;
        w.load = 0;
        w.hub.copy(attach).addScaledVector(up, -w.len);
        continue;
      }
      w.contact = true;
      w.len = Math.max(best, SUSP.minLen * 0.5);
      w.hub.copy(attach).addScaledVector(up, -Math.max(best, SUSP.minLen));
      if (hitAngle !== 0) w.normal.copy(w.hub).sub(w.point).normalize();
      if (w.normal.dot(up) < 0.25) w.normal.addScaledVector(up, 0.25).normalize();
      const comp = SUSP.rest - best;
      const compVel = (w.prevLen - w.len) / dt;
      let F = SUSP.k * comp + (compVel > 0 ? SUSP.cBump : SUSP.cRebound) * compVel;
      if (best < SUSP.minLen) F += SUSP.bumpK * (SUSP.minLen - best);
      w.spring = Math.max(0, F);
      w.compVel = compVel;
      const kind = this.colliderKind(hit.collider);
      w.surface = kind === 'terrain' ? this.surfaceAt(w.point.x, w.point.z) : kind;
      const water = this.waterAt(w.point.x, w.point.z);
      w.inWater = water > w.point.y + 0.05;
      if (w.inWater && w.surface !== 'rock') w.surface = 'water';
    }
    // Anti-roll bars move load between the wheels of an axle.
    for (const [l, r] of [[0, 1], [2, 3]]) {
      const L = this.wheels[l], Rw = this.wheels[r];
      if (!L.contact || !Rw.contact) continue;
      const dF = SUSP.arb * ((SUSP.rest - L.len) - (SUSP.rest - Rw.len));
      L.spring = Math.max(0, L.spring + dF);
      Rw.spring = Math.max(0, Rw.spring - dF);
    }
    for (const w of this.wheels) {
      if (!w.contact) continue;
      w.load = Math.min(w.spring / Math.max(w.normal.dot(up), 0.35), 60000);
      totalLoad += w.load;
    }

    // --- tyre forces -------------------------------------------------------------
    const caps = [0, 0, 0, 0];
    const lat = [0, 0, 0, 0];
    const meff = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.contact || w.load <= 0) continue;
      const surf = SURFACES[w.surface] || SURFACES.dirt;
      _n.copy(w.normal);
      _f.copy(w.fwd).addScaledVector(_n, -_n.dot(w.fwd)).normalize();
      _s.crossVectors(_n, _f);
      const vp = b.velocityAtPoint(w.point);
      _v.set(vp.x, vp.y, vp.z);
      w.vf = _v.dot(_f);
      const vs = _v.dot(_s);
      let mu = surf.mu;
      if (this.handbrake && !w.front) mu *= 0.55;
      meff[i] = MASS * (w.load / Math.max(totalLoad, 1));
      const Jmax = mu * w.load * dt;
      let Js = -vs * meff[i] * 0.85;
      w.sliding = Math.abs(Js) > Jmax;
      if (w.sliding) Js = Math.sign(Js) * Jmax * 0.92;
      lat[i] = Js;
      caps[i] = Math.sqrt(Math.max(0, Jmax * Jmax - Js * Js)) / dt;
      w.mu = mu;
      w.roll = surf.roll;
    }

    const R = RANGES[this.range];
    const tractive = Math.sign(this.drive) * driveForce(this.range, speed, Math.abs(this.drive), this.drive < 0);
    const { forces, spin } = distribute(tractive, caps, this.diffLock);
    const coasting = Math.abs(this.drive) < 0.02;

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.spinning = false;
      if (!w.contact || w.load <= 0) {
        // Free wheels: driven ones spin up under throttle, the rest coast down.
        const target = !coasting ? Math.sign(this.drive) * 28 : w.omega * 0.98;
        w.omega += (target - w.omega) * Math.min(1, dt * (coasting ? 1 : 3));
        if (this.brake > 0 || (this.handbrake && !w.front)) w.omega *= 0.8;
        continue;
      }
      _n.copy(w.normal);
      _f.copy(w.fwd).addScaledVector(_n, -_n.dot(w.fwd)).normalize();
      _s.crossVectors(_n, _f);

      // Brakes, rolling resistance, engine braking and the stand-still hold all
      // work by cancelling the tyre's rolling speed, up to their force limit.
      let hold = w.roll * w.load;
      hold += this.brake * BRAKE * (w.front ? 0.3 : 0.2);
      if (this.handbrake && !w.front) hold += 9000;
      if (coasting) hold += R.engineBrake / 4 + (Math.abs(speed) < 0.6 ? 2600 : 0);
      const Jstop = -w.vf * meff[i];
      const Jb = THREE.MathUtils.clamp(Jstop, -hold * dt, hold * dt);
      let Jf = forces[i] * dt + Jb;
      const capJ = caps[i] * dt;
      if (Math.abs(Jf) > capJ) Jf = Math.sign(Jf) * capJ;

      const locked = (this.brake > 0.5 || (this.handbrake && !w.front)) && Math.abs(Jstop) > hold * dt && Math.abs(w.vf) > 1;
      w.spinning = spin[i] && !coasting;
      let omegaT = w.vf / WHEEL_R;
      if (w.spinning) omegaT += Math.sign(this.drive) * 14;
      if (locked) omegaT = 0;
      w.omega += (omegaT - w.omega) * Math.min(1, dt * 18);

      // Normal force along the contact normal through the hub; friction at a
      // point raised towards the centre of mass to tame the roll moment.
      _imp.copy(_n).multiplyScalar(w.load * dt);
      b.applyImpulseAtPoint(_imp, w.hub, true);
      _imp.copy(_f).multiplyScalar(Jf).addScaledVector(_s, lat[i]);
      _p.copy(w.point).addScaledVector(up, 0.35);
      b.applyImpulseAtPoint(_imp, _p, true);
    }

    // --- air and water ------------------------------------------------------------
    const v = this.vel;
    const vmag = v.length();
    _imp.copy(v).multiplyScalar(-DRAG * vmag * dt);
    const water = this.waterAt(pos.x, pos.z);
    this.submerged = Math.max(0, water - (pos.y - 0.35));
    if (this.submerged > 0) {
      const depth = Math.min(this.submerged, 1.6);
      _imp.addScaledVector(v, -900 * depth * dt);
      _imp.y += 6500 * depth * dt;
    }
    b.applyImpulse(_imp, true);

    for (const w of this.wheels) w.angle += w.omega * dt;
    const e = engineState(this.range, speed, Math.abs(this.drive));
    this.rpm += (e.rpm - this.rpm) * Math.min(1, dt * 8);
    this.gear = e.gear;
    if (this.up.y < 0.25) this.flipTime += dt;
    else this.flipTime = Math.max(0, this.flipTime - dt * 2);
  }

  /** Wheel hub positions in chassis-local space, for the model. */
  localHub(i, out) {
    const w = this.wheels[i];
    return out.set(w.attach.x, ATTACH_Y - w.len, w.attach.z);
  }

  get groundedCount() {
    return this.wheels.reduce((n, w) => n + (w.contact ? 1 : 0), 0);
  }
}
