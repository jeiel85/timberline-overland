// Camera rig: chase, bonnet and drone views while driving, a free orbit for the
// photo mode, and a slow cinematic orbit behind the title screen.

import * as THREE from 'three';

export const CAMERA_MODES = ['chase', 'hood', 'drone'];

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();
const _up = new THREE.Vector3();
const _flat = new THREE.Vector3();

export class CameraRig {
  constructor(camera, heightAt) {
    this.camera = camera;
    this.heightAt = heightAt;
    this.mode = 'chase';
    this.yaw = 0;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.dragging = false;
    this.photo = { yaw: 0.6, pitch: 0.25, dist: 8 };
    this.title = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.snap = true;
  }

  cycle() {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    this.snap = true;
    return this.mode;
  }

  /** Pointer drag in chase/drone views looks around the car; in photo mode it orbits. */
  drag(dx, dy, photo) {
    if (photo) {
      this.photo.yaw -= dx * 0.006;
      this.photo.pitch = THREE.MathUtils.clamp(this.photo.pitch + dy * 0.004, -0.15, 1.35);
    } else {
      this.orbitYaw -= dx * 0.005;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.003, -0.25, 0.9);
    }
  }

  zoom(delta) {
    this.photo.dist = THREE.MathUtils.clamp(this.photo.dist * (1 + delta * 0.001), 3.5, 40);
  }

  keepAboveGround(p, clearance) {
    const g = this.heightAt(p.x, p.z) + clearance;
    if (p.y < g) p.y = g;
  }

  update(dt, car, state) {
    const cam = this.camera;
    const k = (rate) => (this.snap ? 1 : 1 - Math.exp(-dt * rate));
    _flat.set(car.fwd.x, 0, car.fwd.z);
    if (_flat.lengthSq() < 1e-4) _flat.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _flat.normalize();
    const carYaw = Math.atan2(_flat.x, _flat.z);
    // Follow the direction of travel when reversing hard, otherwise the nose.
    let dy = carYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * k(3.2);
    if (!this.dragging) {
      this.orbitYaw *= Math.exp(-dt * 1.4);
      this.orbitPitch *= Math.exp(-dt * 1.4);
    }
    let fov = 60;

    if (state === 'title') {
      this.title += dt * 0.07;
      const a = this.title + 2.2;
      _v.set(car.pos.x + Math.sin(a) * 12.5, car.pos.y + 3.8 + Math.sin(this.title * 0.7) * 0.8, car.pos.z + Math.cos(a) * 12.5);
      this.keepAboveGround(_v, 1.5);
      this.pos.copy(_v);
      this.look.copy(car.pos).add(_look.set(0, 0.9, 0));
      cam.up.set(0, 1, 0);
      fov = 50;
    } else if (state === 'photo') {
      const p = this.photo;
      _v.set(Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), Math.cos(p.yaw) * Math.cos(p.pitch)).multiplyScalar(p.dist).add(car.pos);
      _v.y += 1;
      this.keepAboveGround(_v, 0.6);
      this.pos.lerp(_v, k(10));
      this.look.lerp(_look.copy(car.pos).add(_v.set(0, 0.9, 0)), k(10));
      cam.up.set(0, 1, 0);
      fov = 50;
    } else if (this.mode === 'hood') {
      _v.set(0, 1.62, 0.98).applyQuaternion(car.q).add(car.pos);
      this.pos.copy(_v);
      _look.set(0, 1.25, 12).applyQuaternion(car.q).add(car.pos);
      this.look.copy(_look);
      _up.copy(car.up).lerp(_v.set(0, 1, 0), 0.5).normalize();
      cam.up.copy(_up);
      fov = 70;
    } else {
      const drone = this.mode === 'drone';
      const dist = drone ? 15 : 7.6;
      const height = drone ? 6.5 : 2.6;
      const yaw = this.yaw + this.orbitYaw;
      const pitch = this.orbitPitch;
      _v.set(-Math.sin(yaw) * dist * Math.cos(pitch), height + Math.sin(pitch) * dist, -Math.cos(yaw) * dist * Math.cos(pitch)).add(car.pos);
      this.keepAboveGround(_v, 1.3);
      this.pos.lerp(_v, k(drone ? 3 : 7));
      this.keepAboveGround(this.pos, 1.1);
      _look.set(Math.sin(this.yaw) * 2.5, drone ? 0.6 : 1.2, Math.cos(this.yaw) * 2.5).add(car.pos);
      this.look.lerp(_look, k(12));
      cam.up.set(0, 1, 0);
      fov = (drone ? 52 : 60) + Math.min(10, Math.abs(car.speed) * 0.35);
    }
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * k(4);
      cam.updateProjectionMatrix();
    }
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    this.snap = false;
  }
}
