// Timberline Overland — boot, game states, the fixed-step loop and UI wiring.

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { generateTerrain } from './terrain.js';
import { scatter } from './scatter.js';
import { buildWorld, TIMES, WEATHERS } from './world.js';
import { buildFlora } from './flora.js';
import { buildProps, ALT_OFFSET } from './props.js';
import { buildPhysics } from './physics.js';
import { Vehicle } from './vehicle.js';
import { buildCarModel } from './carmodel.js';
import { CameraRig } from './camera.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Spray, Snowfall } from './fx.js';
import { Journal, formatTime } from './journal.js';
import { setLang, getLang, t, applyLang, detectLang, landmarkName } from './i18n.js';
import { SPAWN } from './layout.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'timberline-overland.v1';
const QUALITY = {
  high: { dpr: 2, shadow: 2048, grass: 150, aa: true },
  medium: { dpr: 1.25, shadow: 1024, grass: 105, aa: true },
  low: { dpr: 0.85, shadow: 0, grass: 60, aa: false },
};
const SPRAY_COLORS = {
  dirt: new THREE.Color('#b39876'),
  gravel: new THREE.Color('#c2b6a3'),
  grass: new THREE.Color('#8a7a55'),
  scree: new THREE.Color('#bdb6aa'),
  snow: new THREE.Color('#f3f6fb'),
  mud: new THREE.Color('#5d4932'),
  water: new THREE.Color('#e3edf1'),
};
const DIRT_RATE = { dirt: 0.004, gravel: 0.003, grass: 0.001, scree: 0.003, snow: -0.002, mud: 0.02, water: -0.006, rock: 0, wood: 0 };

// Saved progress and settings. Storage can be unavailable (private windows,
// blocked site data); the game then simply keeps progress for this session.
function loadSave() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY)) || {};
  } catch {
    return {};
  }
}
function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Not persisted; see loadSave().
  }
}

const saved = loadSave();
const settings = {
  lang: saved.settings?.lang || detectLang(),
  quality: saved.settings?.quality || (matchMedia('(pointer: coarse)').matches ? 'medium' : 'high'),
  muted: !!saved.settings?.muted,
  time: saved.settings?.time || 'golden',
  weather: saved.settings?.weather || 'clear',
  cam: saved.settings?.cam || 'chase',
};
setLang(settings.lang);
applyLang();

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
function loading(key, frac) {
  $('load-step').textContent = t(key);
  $('load-fill').style.transform = `scaleX(${frac})`;
}

async function boot() {
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
  loading('load.terrain', 0.1);
  await nextFrame();
  const T = generateTerrain();
  loading('load.forest', 0.35);
  await nextFrame();
  const S = scatter(T);

  const Q = QUALITY[settings.quality];
  const renderer = new THREE.WebGLRenderer({ antialias: Q.aa, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = Q.shadow > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 6000);
  const world = buildWorld(T, scene);
  if (Q.shadow) world.setShadowSize(Q.shadow);
  const flora = buildFlora(T, S, scene);
  flora.setGrassDistance(Q.grass);
  const props = buildProps(T, scene);

  loading('load.physics', 0.65);
  await nextFrame();
  await RAPIER.init();
  const phys = buildPhysics(RAPIER, T, S, flora.rockShapes, props.colliders);
  const waterAt = (x, z) => (T.lakeD(x, z) < 1.25 ? T.waterY : -Infinity);
  const car = new Vehicle(RAPIER, phys.world, { surfaceAt: T.surfaceAt, colliderKind: phys.colliderKind, waterAt });
  const model = buildCarModel();
  scene.add(model.root);

  const heads = [0.62, -0.62].map((x) => {
    const s = new THREE.SpotLight('#fff1d6', 0, 80, 0.52, 0.55, 1.4);
    s.position.set(x, 0.5, 2.2);
    s.target.position.set(x * 2, -1.2, 18);
    model.root.add(s, s.target);
    return s;
  });

  const spray = new Spray(scene);
  const snow = new Snowfall(scene);
  const rig = new CameraRig(camera, T.heightAt);
  rig.mode = settings.cam;
  const input = new Input();
  input.bindTouch($('touch'));
  const sound = new Sound();
  sound.muted = settings.muted;
  let journal = new Journal(T.landmarks, saved.journal);
  const hud = new Hud(T, S, journal);

  // --- game state -----------------------------------------------------------------
  let state = 'title';
  let lights = false;
  let dirt = 0;
  let time = 0;
  let acc = 0;
  let saveTimer = 0;
  let safeTimer = 0;
  let lastSafe = null;
  let spinTime = 0;
  let stuckTime = 0;
  let floodTime = 0;
  let fordShown = -99;
  let driveTime = 0;
  let touchedControls = false;
  let filter = 'natural';
  let perfFrames = 0;
  let perfTime = 0;
  let downgraded = false;
  const prevPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function placeCar(x, z, heading) {
    const y = phys.groundY(x, z, T.heightAt(x, z) + 30, car.body);
    car.reset(x, y, z, heading);
    prevPos.copy(car.pos);
    rig.snap = true;
  }

  function spawn(fromSave) {
    const p = fromSave && saved.pos;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) placeCar(p.x, p.z, p.heading || 0);
    else placeCar(SPAWN.x, SPAWN.z, SPAWN.heading);
  }
  spawn(true);

  world.setPreset(settings.time, settings.weather, true);
  snow.target = settings.weather === 'snow' ? 0.9 : 0;

  function persist() {
    writeSave({
      settings,
      journal: journal.toJSON(),
      pos: lastSafe || saved.pos || null,
    });
  }

  function setSettings(patch) {
    Object.assign(settings, patch);
    persist();
  }

  // --- overlays -----------------------------------------------------------------------
  const overlays = ['title', 'pause', 'mapview', 'help', 'done'];
  function show(id) {
    for (const o of overlays) $(o).classList.toggle('hidden', o !== id);
  }
  function setState(s) {
    state = s;
    const driving = s === 'drive';
    $('hud').classList.toggle('hidden', !(driving || s === 'paused' || s === 'map' || s === 'help'));
    $('photo').classList.toggle('hidden', s !== 'photo');
    input.enabled = driving;
    document.body.classList.toggle('driving', driving);
    renderer.domElement.style.filter = s === 'photo' ? cssFilter(filter) : '';
    $('postcard-frame').classList.toggle('hidden', !(s === 'photo' && filter === 'postcard'));
    if (s === 'title') show('title');
    else if (s === 'paused') show('pause');
    else if (s === 'map') { show('mapview'); hud.drawMap($('map-canvas'), car); }
    else if (s === 'help') show('help');
    else if (s === 'done') show('done');
    else show(null);
  }

  function refreshTitle() {
    const has = journal.count > 0 || !!saved.pos;
    $('btn-continue').classList.toggle('hidden', !has);
    $('btn-new').classList.toggle('hidden', !has);
    $('btn-start').classList.toggle('hidden', has);
    $('title-progress').textContent = has ? `${t('hud.log')} · ${journal.count} / ${journal.total}` : '';
    $('quality').value = settings.quality;
    for (const b of document.querySelectorAll('[data-lang]')) b.classList.toggle('on', b.dataset.lang === getLang());
  }

  function startDriving() {
    sound.start();
    sound.setMuted(settings.muted);
    updateSoundButton();
    setState('drive');
  }

  $('btn-start').onclick = () => startDriving();
  $('btn-continue').onclick = () => startDriving();
  $('btn-new').onclick = () => {
    journal = new Journal(T.landmarks, null);
    hud.journal = journal;
    hud.buildLogDots();
    hud.refreshText();
    saved.pos = null;
    lastSafe = null;
    dirt = 0;
    car.range = 'high';
    car.diffLock = false;
    placeCar(SPAWN.x, SPAWN.z, SPAWN.heading);
    persist();
    startDriving();
  };
  $('btn-title-help').onclick = () => { $('help-back').dataset.back = 'title'; show('help'); };
  $('btn-resume').onclick = () => setState('drive');
  $('btn-pause-help').onclick = () => { $('help-back').dataset.back = 'pause'; setState('help'); };
  $('btn-to-title').onclick = () => { persist(); refreshTitle(); setState('title'); };
  $('help-back').onclick = () => {
    if ($('help-back').dataset.back === 'title') show('title');
    else setState($('help-back').dataset.back === 'pause' ? 'paused' : 'drive');
  };
  $('map-close').onclick = () => setState('drive');
  $('btn-free').onclick = () => setState('drive');
  $('quality').onchange = (e) => applyQuality(e.target.value);
  for (const b of document.querySelectorAll('[data-lang]')) {
    b.onclick = () => {
      setLang(b.dataset.lang);
      setSettings({ lang: b.dataset.lang });
      applyLang();
      hud.refreshText();
      refreshTitle();
    };
  }
  for (const b of document.querySelectorAll('#toolbar [data-act]')) {
    b.onclick = () => {
      input.pressed.push(b.dataset.act);
      b.blur();
    };
  }
  for (const b of document.querySelectorAll('[data-filter]')) {
    b.onclick = () => {
      filter = b.dataset.filter;
      for (const o of document.querySelectorAll('[data-filter]')) o.classList.toggle('on', o === b);
      renderer.domElement.style.filter = cssFilter(filter);
      $('postcard-frame').classList.toggle('hidden', filter !== 'postcard');
    };
  }
  $('photo-shot').onclick = () => capturePhoto();
  $('photo-exit').onclick = () => setState('drive');

  function cssFilter(f) {
    return { natural: '', film: 'contrast(1.08) saturate(1.12) sepia(0.2) brightness(1.03)', mono: 'grayscale(1) contrast(1.18)', postcard: 'saturate(1.22) contrast(1.06)' }[f] || '';
  }

  function applyQuality(q) {
    const P = QUALITY[q];
    setSettings({ quality: q });
    renderer.setPixelRatio(Math.min(devicePixelRatio, P.dpr));
    renderer.setSize(innerWidth, innerHeight);
    const wantShadows = P.shadow > 0;
    if (wantShadows !== renderer.shadowMap.enabled) {
      renderer.shadowMap.enabled = wantShadows;
      scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
      });
    }
    if (wantShadows) world.setShadowSize(P.shadow);
    flora.setGrassDistance(P.grass);
    onResize();
  }

  function updateSoundButton() {
    $('tb-sound').classList.toggle('off', settings.muted);
  }

  // --- actions -------------------------------------------------------------------------
  function rightCar(toTrail) {
    let x = car.pos.x, z = car.pos.z, heading = car.heading;
    const n = T.normalAt(x, z);
    const deep = waterAt(x, z) > T.heightAt(x, z) + 0.6;
    if (toTrail || n[1] < 0.8 || deep) {
      const p = T.nearestTrailPoint(x, z);
      x = p.x; z = p.z; heading = p.heading;
      hud.toast(t('toast.recoverTrail'));
    } else {
      hud.toast(t('toast.recover'));
    }
    placeCar(x, z, heading);
    journal.recoveries++;
  }

  function handle(action) {
    if (action === 'pause') {
      if (state === 'drive') setState('paused');
      else if (state === 'paused' || state === 'map' || state === 'photo') setState('drive');
      else if (state === 'help') $('help-back').click();
      return;
    }
    if (action === 'map') {
      if (state === 'drive') setState('map');
      else if (state === 'map') setState('drive');
      return;
    }
    if (action === 'help') {
      if (state === 'drive' || state === 'paused') { $('help-back').dataset.back = 'drive'; setState('help'); }
      else if (state === 'help') $('help-back').click();
      return;
    }
    if (action === 'photo') {
      if (state === 'drive') {
        rig.photo.yaw = rig.yaw + Math.PI * 0.8;
        setState('photo');
      } else if (state === 'photo') setState('drive');
      return;
    }
    if (action === 'sound') {
      setSettings({ muted: !settings.muted });
      sound.setMuted(settings.muted);
      updateSoundButton();
      return;
    }
    if (state !== 'drive') return;
    switch (action) {
      case 'range':
        hud.toast(t(car.toggleRange() === 'low' ? 'toast.low' : 'toast.high'));
        break;
      case 'lock':
        car.diffLock = !car.diffLock;
        hud.toast(t(car.diffLock ? 'toast.lockOn' : 'toast.lockOff'));
        break;
      case 'cam':
        hud.toast(t(`cam.${rig.cycle()}`));
        setSettings({ cam: rig.mode });
        break;
      case 'recover':
        rightCar(false);
        break;
      case 'recoverTrail':
        rightCar(true);
        break;
      case 'lights':
        lights = !lights;
        hud.toast(`${t('toast.lights')} ${lights ? 'ON' : 'OFF'}`);
        break;
      case 'time': {
        const next = TIMES[(TIMES.indexOf(world.time) + 1) % TIMES.length];
        world.setPreset(next, world.weather);
        lights = next === 'night';
        setSettings({ time: next });
        hud.toast(t(`time.${next}`));
        break;
      }
      case 'weather': {
        const next = WEATHERS[(WEATHERS.indexOf(world.weather) + 1) % WEATHERS.length];
        world.setPreset(world.time, next);
        snow.target = next === 'snow' ? 0.9 : 0;
        setSettings({ weather: next });
        hud.toast(t(`weather.${next}`));
        break;
      }
      default:
        break;
    }
    if (action !== 'cam') touchedControls = true;
  }
  lights = settings.time === 'night';

  function capturePhoto() {
    renderer.render(scene, camera);
    const src = renderer.domElement;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d');
    g.filter = cssFilter(filter) || 'none';
    g.drawImage(src, 0, 0);
    g.filter = 'none';
    if (filter === 'postcard') {
      const b = Math.round(c.width * 0.022);
      g.lineWidth = b * 2;
      g.strokeStyle = '#f7f0e1';
      g.strokeRect(0, 0, c.width, c.height);
      const nearest = T.landmarks.reduce((a, l) => (Math.hypot(l.x - car.pos.x, l.z - car.pos.z) < Math.hypot(a.x - car.pos.x, a.z - car.pos.z) ? l : a));
      const fs = Math.round(c.height * 0.045);
      g.font = `800 ${fs}px "Archivo", "Noto Sans KR", sans-serif`;
      g.fillStyle = 'rgba(255,250,240,0.95)';
      g.shadowColor = 'rgba(0,0,0,0.45)';
      g.shadowBlur = fs * 0.4;
      g.fillText(`Greetings from ${landmarkName(nearest.id)}`, b * 2.2, c.height - b * 2.6 - fs * 0.6);
      g.font = `600 ${Math.round(fs * 0.48)}px "JetBrains Mono", monospace`;
      g.fillText(`TIMBERLINE OVERLAND · ${Math.round(car.pos.y + ALT_OFFSET)} m`, b * 2.2, c.height - b * 2.2);
    }
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `timberline-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      hud.toast(t('toast.photo'));
    }, 'image/png');
  }

  // --- pointer look-around / photo orbit ------------------------------------------------
  let dragId = null, lastX = 0, lastY = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('touch') && state === 'drive') return;
    dragId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    rig.dragging = true;
  });
  addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId) return;
    rig.drag(e.clientX - lastX, e.clientY - lastY, state === 'photo');
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const endDrag = (e) => { if (e.pointerId === dragId) { dragId = null; rig.dragging = false; } };
  addEventListener('pointerup', endDrag);
  addEventListener('pointercancel', endDrag);
  renderer.domElement.addEventListener('wheel', (e) => { if (state === 'photo') { e.preventDefault(); rig.zoom(e.deltaY); } }, { passive: false });

  function onResize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    const hpx = innerHeight * renderer.getPixelRatio();
    spray.setScale(hpx, camera.fov);
    snow.setScale(hpx, camera.fov);
  }
  addEventListener('resize', onResize);
  onResize();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'drive') setState('paused');
  });

  // --- per-frame helpers ---------------------------------------------------------------
  const light = new THREE.Color();
  const hemiLight = new THREE.Color();
  function emitSpray(dt) {
    for (const w of car.wheels) {
      if (!w.contact) continue;
      const v = Math.abs(w.vf);
      const spin = w.spinning ? 1 : 0;
      const col = SPRAY_COLORS[w.surface];
      if (!col) continue;
      const heavy = w.surface === 'water' || w.surface === 'mud';
      let rate = (v > 2 ? v * (heavy ? 3 : 1.4) : 0) + spin * 26 + (w.sliding ? 14 : 0);
      if (w.surface === 'grass' && !spin && !w.sliding) rate *= 0.15;
      let n = rate * dt;
      while (n > 0) {
        if (n < 1 && Math.random() > n) break;
        n -= 1;
        const back = heavy ? 1.6 : 0.9;
        spray.emit(
          w.point.x + (Math.random() - 0.5) * 0.3, w.point.y + 0.12, w.point.z + (Math.random() - 0.5) * 0.3,
          -w.fwd.x * (w.vf * 0.25 + spin * 3) * back + (Math.random() - 0.5) * 1.5,
          (heavy ? 2.2 : 0.8) + Math.random() * (heavy ? 2.5 : 1.2),
          -w.fwd.z * (w.vf * 0.25 + spin * 3) * back + (Math.random() - 0.5) * 1.5,
          heavy ? 0.09 + Math.random() * 0.08 : 0.5 + Math.random() * 0.6,
          col,
          heavy ? 0.8 + Math.random() * 0.4 : 1.4 + Math.random() * 1.2,
          heavy,
        );
      }
    }
  }

  function updateModel() {
    model.root.position.copy(car.pos);
    model.root.quaternion.copy(car.q);
    car.wheels.forEach((w, i) => {
      const wm = model.wheels[i];
      car.localHub(i, wm.steer.position);
      wm.steer.rotation.y = w.steer;
      wm.spin.rotation.x = w.angle;
    });
    const night = world.state.night;
    const on = lights || night > 0.5;
    for (const h of heads) h.intensity = on ? 70 : 0;
    model.lights.headMat.emissiveIntensity = on ? 3 : 0.15;
    model.lights.tailMat.emissiveIntensity = car.brake > 0.1 ? 3 : on ? 1.2 : 0.25;
  }

  function hints(dt) {
    if (state !== 'drive') return;
    const spinningNow = car.wheels.some((w) => w.spinning) && Math.abs(car.speed) < 1.2;
    spinTime = spinningNow ? spinTime + dt : Math.max(0, spinTime - dt);
    stuckTime = input.throttle + input.brake > 0.5 && Math.abs(car.speed) < 0.4 ? stuckTime + dt : 0;
    let key = '';
    if (car.flipTime > 1.2) key = 'hint.flip';
    else if (spinTime > 1.0 && !(car.range === 'low' && car.diffLock)) key = 'hint.spin';
    else if (Math.abs(car.roll) > 0.52) key = 'hint.tilt';
    else if (stuckTime > 6) key = 'hint.stuck';
    else if (driveTime < 30 && !touchedControls && journal.count === 0) key = 'hint.drive';
    hud.hint(key);
  }

  function gameplay(dt) {
    const travelled = tmp.copy(car.pos).sub(prevPos).setY(0).length();
    prevPos.copy(car.pos);
    const tilt = Math.max(Math.abs(car.pitch), Math.abs(car.roll)) * (180 / Math.PI);
    journal.tick(dt, travelled < 5 ? travelled : 0, car.groundedCount >= 2 ? tilt : 0);
    driveTime += dt;

    const found = journal.check(car.pos.x, car.pos.z);
    if (found) {
      hud.discovery(found);
      sound.chime();
      persist();
      if (journal.complete) setTimeout(() => {
        $('done-time').textContent = formatTime(journal.completedAt ?? journal.time);
        $('done-dist').textContent = `${(journal.distance / 1000).toFixed(2)} km`;
        $('done-tilt').textContent = `${Math.round(journal.maxTilt)}°`;
        $('done-recover').textContent = String(journal.recoveries);
        if (state === 'drive') setState('done');
      }, 2600);
    }

    for (const e of car.events.splice(0)) if (e === 'lockOff') hud.toast(t('toast.lockAuto'));

    if (car.wheels.some((w) => w.inWater) && Math.abs(car.speed) > 0.5 && time - fordShown > 25) {
      fordShown = time;
      hud.toast(t('toast.ford'));
    }
    floodTime = car.submerged > 1.15 ? floodTime + dt : 0;
    if (floodTime > 1.2) {
      floodTime = 0;
      hud.toast(t('toast.flooded'), 'warn');
      rightCar(true);
    }

    safeTimer += dt;
    if (safeTimer > 1) {
      safeTimer = 0;
      if (car.up.y > 0.88 && car.groundedCount === 4 && car.submerged <= 0 && Math.abs(car.speed) < 14) {
        lastSafe = { x: car.pos.x, z: car.pos.z, heading: car.heading };
      }
    }
    saveTimer += dt;
    if (saveTimer > 5) { saveTimer = 0; persist(); }

    const grounded = car.wheels.filter((w) => w.contact);
    if (grounded.length) {
      const rate = grounded.reduce((s, w) => s + (DIRT_RATE[w.surface] ?? 0), 0) / grounded.length;
      dirt = Math.min(1, Math.max(0, dirt + rate * dt * Math.min(1, Math.abs(car.speed) / 4 + (car.wheels.some((w) => w.spinning) ? 1 : 0))));
      model.setDirt(dirt);
    }
    for (const w of car.wheels) {
      if (w.contact && w.compVel > 1.6) sound.thump(w.compVel - 1.4);
    }

    // Quietly step quality down once if the first seconds run slowly.
    if (!downgraded && driveTime > 2 && driveTime < 10) {
      perfFrames++;
      perfTime += dt;
      if (perfFrames > 180 && perfTime / perfFrames > 1 / 34 && settings.quality !== 'low') {
        downgraded = true;
        applyQuality(settings.quality === 'high' ? 'medium' : 'low');
      }
    }
  }

  // --- loop --------------------------------------------------------------------------------
  const DT = 1 / 120;
  let last = performance.now();
  refreshTitle();
  setState('title');
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), 700);

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt;
    input.poll(dt);
    for (const a of input.consume()) handle(a);

    const simulate = state === 'drive' || state === 'title' || state === 'done';
    if (simulate) {
      acc += dt;
      let steps = 0;
      while (acc >= DT && steps < 8) {
        car.step(DT, input);
        phys.world.step();
        acc -= DT;
        steps++;
      }
      if (steps === 8) acc = 0;
    }
    car.readState();
    updateModel();
    rig.update(dt, car, state === 'title' ? 'title' : state === 'photo' ? 'photo' : 'drive');
    world.sky.position.copy(camera.position);
    world.update(dt, time, car.pos);
    const ws = world.state;
    flora.update(time, ws.wind * (0.7 + 0.3 * Math.sin(time * 0.3)), camera.position, tmp.copy(car.pos).addScaledVector(car.up, 1));
    props.update(time, ws.night);
    light.copy(ws.sunColor).multiplyScalar(ws.sunI / 4).add(hemiLight.copy(ws.hemiSky).multiplyScalar(ws.hemiI * 0.45));
    if (state === 'drive') emitSpray(dt);
    spray.update(state === 'photo' || state === 'paused' ? 0 : dt, light);
    snow.update(dt, time, camera.position, light);
    renderer.toneMappingExposure = ws.exposure;

    renderer.render(scene, camera);

    if (state === 'drive') {
      gameplay(dt);
      hints(dt);
    }
    if (state !== 'title' && state !== 'photo') hud.update(car, camera, innerWidth, innerHeight);
    const splash = car.wheels.reduce((s, w) => s + (w.inWater ? Math.abs(w.vf) : 0), 0) / 12;
    const grit = car.wheels.reduce((s, w) => s + (w.contact ? ({ gravel: 1, scree: 1, dirt: 0.7, rock: 0.5, snow: 0.2, grass: 0.3, mud: 0.4 }[w.surface] ?? 0.4) : 0), 0) / 4;
    sound.update({
      active: state === 'drive' || state === 'done',
      rpm: car.rpm,
      throttle: Math.abs(car.drive),
      speed: car.speed,
      grit,
      slip: car.wheels.some((w) => w.spinning || w.sliding) ? 1 : 0,
      wind: ws.wind,
      altitude: car.pos.y,
      splash,
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ?debug exposes the game objects on window for poking at from the console.
  if (new URLSearchParams(location.search).has('debug')) {
    window.__timberline = { T, S, car, phys, world, rig, journal: () => journal, scene, renderer, camera, input };
  }
}

boot().catch((err) => {
  console.error(err);
  const el = $('load-step');
  if (el) el.textContent = `${t('load.fail')} (${err.message})`;
});
