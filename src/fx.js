// Particles: dust, mud and water thrown up by the tyres, and falling snow.

import * as THREE from 'three';

export class Spray {
  constructor(scene, max = 900) {
    this.max = max;
    this.n = 0;
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max).fill(1e9);
    this.grow = new Float32Array(max);
    this.heavy = new Uint8Array(max);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 500 }, uLight: { value: new THREE.Color(1, 1, 1) } }]),
      vertexShader: /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSize;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mvPosition.z, 0.5);
  // Puffs right in front of the lens fade out instead of filling the screen.
  vAlpha = aAlpha * smoothstep(1.5, 6.0, dist);
  gl_PointSize = min(aSize * uScale / dist, uScale * 0.1);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
      fragmentShader: /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uLight;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float a = vAlpha * smoothstep(0.25, 0.02, d);
  gl_FragColor = vec4(vColor * uLight, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.geo = geo;
  }

  emit(x, y, z, vx, vy, vz, size, color, life, heavy = false) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size[i] = size;
    this.grow[i] = heavy ? 0.3 : size * 1.4;
    this.life[i] = life;
    this.age[i] = 0;
    this.heavy[i] = heavy ? 1 : 0;
  }

  update(dt, light) {
    this.material.uniforms.uLight.value.copy(light);
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      const j = i * 3;
      const drag = this.heavy[i] ? 0.6 : 1.8;
      this.vel[j] *= Math.exp(-drag * dt);
      this.vel[j + 2] *= Math.exp(-drag * dt);
      this.vel[j + 1] += (this.heavy[i] ? -9 : 0.25) * dt;
      if (!this.heavy[i]) this.vel[j + 1] *= Math.exp(-1.2 * dt);
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = (this.heavy[i] ? 0.85 : 0.3) * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    for (const a of ['position', 'aColor', 'aAlpha', 'aSize']) this.geo.attributes[a].needsUpdate = true;
  }

  setScale(viewportHeight, fov) {
    this.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }
}

/** Snowfall in a box that travels with the camera; all motion in the shader. */
export class Snowfall {
  constructor(scene, count = 7000) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * 60;
      pos[i * 3 + 1] = Math.random() * 40;
      pos[i * 3 + 2] = Math.random() * 60;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: 500 }, uOpacity: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: /* glsl */ `
attribute float aSeed;
uniform float uTime, uScale;
uniform vec3 uCam;
varying float vSeed;
void main() {
  vec3 box = vec3(60.0, 40.0, 60.0);
  vec3 p = position + vec3(sin(uTime * 0.6 + aSeed * 30.0) * 1.2 + uTime * 1.6, -uTime * (1.3 + aSeed * 0.8), cos(uTime * 0.5 + aSeed * 20.0) * 1.0);
  p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (0.08 + aSeed * 0.08) * uScale / max(-mv.z, 0.5);
  gl_Position = projectionMatrix * mv;
  vSeed = aSeed;
}`,
      fragmentShader: /* glsl */ `
uniform float uOpacity;
uniform vec3 uLight;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  gl_FragColor = vec4(uLight, uOpacity * smoothstep(0.25, 0.0, d));
}`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    this.target = 0;
  }

  update(dt, time, cam, light) {
    const u = this.material.uniforms;
    u.uOpacity.value += (this.target - u.uOpacity.value) * Math.min(1, dt * 1.5);
    this.points.visible = u.uOpacity.value > 0.01;
    u.uTime.value = time;
    u.uCam.value.copy(cam);
    u.uLight.value.copy(light);
  }

  setScale(viewportHeight, fov) {
    this.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }
}
