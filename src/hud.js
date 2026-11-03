// Heads-up display: instrument cluster, inclinometer, wheel status, compass
// ribbon, heading-up topo minimap, expedition log, world markers and toasts.

import * as THREE from 'three';
import { t, landmarkName, landmarkDesc } from './i18n.js';
import { ALT_OFFSET } from './props.js';
import { TREE } from './scatter.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;

/** A paper topographic map of the valley, rendered once. */
export function renderTopo(T, S, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const m = T.SIZE / size;
  const L = [-0.55, 0.62, -0.56];
  const ramp = [
    [0, [168, 190, 128]], [30, [184, 196, 138]], [70, [204, 196, 146]], [110, [206, 190, 160]],
    [150, [196, 188, 178]], [230, [226, 222, 216]], [400, [244, 243, 240]],
  ];
  const colorAt = (y) => {
    for (let i = 1; i < ramp.length; i++) {
      if (y <= ramp[i][0]) {
        const a = ramp[i - 1], b = ramp[i];
        const k = (y - a[0]) / (b[0] - a[0]);
        return a[1].map((v, j) => v + (b[1][j] - v) * k);
      }
    }
    return ramp[ramp.length - 1][1];
  };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = -T.HALF + (px + 0.5) * m, z = -T.HALF + (py + 0.5) * m;
      const y = T.heightAt(x, z);
      const n = T.normalAt(x, z);
      const shade = 0.72 + 0.42 * Math.max(-0.3, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
      let col = colorAt(y);
      const snow = T.sampleMat(2, x, z), rock = T.sampleMat(1, x, z);
      if (rock > 0.5) col = col.map((v) => v * 0.9);
      if (snow > 0.5) col = [245, 246, 248];
      if (T.lakeD(x, z) < 1.2 && y < T.waterY) {
        const d = Math.min(1, (T.waterY - y) / 5);
        col = [118 - d * 50, 178 - d * 40, 190 - d * 20];
      }
      const yR = T.heightAt(x + m, z), yD = T.heightAt(x, z + m);
      const c10 = Math.floor(y / 10) !== Math.floor(yR / 10) || Math.floor(y / 10) !== Math.floor(yD / 10);
      const c50 = Math.floor(y / 50) !== Math.floor(yR / 50) || Math.floor(y / 50) !== Math.floor(yD / 50);
      const i = (py * size + px) * 4;
      let r = col[0] * shade, gg = col[1] * shade, b = col[2] * shade;
      if (c10) { r *= 0.86; gg *= 0.8; b *= 0.74; }
      if (c50) { r *= 0.75; gg *= 0.66; b *= 0.58; }
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const toPx = (v) => (v + T.HALF) / m;
  g.fillStyle = 'rgba(52, 92, 50, 0.5)';
  for (const tr of S.trees) {
    g.beginPath();
    g.arc(toPx(tr.x), toPx(tr.z), tr.type === TREE.LARCH ? 1.1 : 1.3, 0, TAU);
    g.fillStyle = tr.type === TREE.LARCH ? 'rgba(196, 150, 40, 0.65)' : 'rgba(46, 86, 46, 0.55)';
    g.fill();
  }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const tr of T.trails) {
    g.beginPath();
    for (let i = 0; i < tr.xs.length; i += 2) {
      const X = toPx(tr.xs[i]), Y = toPx(tr.zs[i]);
      if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
    }
    g.strokeStyle = 'rgba(255, 245, 225, 0.85)';
    g.lineWidth = 3.4;
    g.setLineDash([]);
    g.stroke();
    g.strokeStyle = '#8a3a16';
    g.lineWidth = 1.6;
    g.setLineDash([5, 3]);
    g.stroke();
  }
  g.setLineDash([]);
  return c;
}

export class Hud {
  constructor(T, S, journal) {
    this.T = T;
    this.journal = journal;
    this.topo = renderTopo(T, S, 512);
    this.mini = $('minimap-canvas').getContext('2d');
    this.compass = $('compass-canvas').getContext('2d');
    this.incl = $('incl-canvas').getContext('2d');
    this.wheelsCtx = $('wheels-canvas').getContext('2d');
    this.markers = new Map();
    this.toastQueue = [];
    this.hintKey = '';
    this.lastLog = '';
    this._v = new THREE.Vector3();
    for (const l of T.landmarks) {
      if (!l.counted) continue;
      const el = document.createElement('div');
      el.className = 'marker';
      el.innerHTML = '<i></i><b></b><span></span>';
      $('markers').appendChild(el);
      this.markers.set(l.id, el);
    }
    this.buildLogDots();
  }

  buildLogDots() {
    const dots = $('log-dots');
    dots.innerHTML = '';
    for (const l of this.journal.places) {
      const d = document.createElement('i');
      d.dataset.id = l.id;
      dots.appendChild(d);
    }
  }

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);
  }

  discovery(l) {
    const el = $('discovery');
    el.querySelector('b').textContent = landmarkName(l.id);
    el.querySelector('p').textContent = landmarkDesc(l.id);
    el.querySelector('small').textContent = `${t('toast.found')} · ${this.journal.count} / ${this.journal.total}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  hint(key) {
    if (key === this.hintKey) return;
    this.hintKey = key;
    const el = $('hint');
    el.textContent = key ? t(key) : '';
    el.classList.toggle('show', !!key);
  }

  refreshText() {
    this.lastLog = '';
    this.hintKey = '';
  }

  update(car, camera, w, h) {
    const T = this.T;
    // --- cluster ------------------------------------------------------------------
    const kmh = Math.abs(car.speed) * 3.6;
    $('speed').textContent = String(Math.round(kmh)).padStart(2, '0');
    $('range').textContent = car.range === 'low' ? 'L' : 'H';
    $('range').classList.toggle('low', car.range === 'low');
    $('gear').textContent = car.dir < 0 && Math.abs(car.drive) > 0.01 ? 'R' : car.speed < -0.5 ? 'R' : Math.abs(car.speed) < 0.3 && Math.abs(car.drive) < 0.02 ? 'N' : `D${car.gear}`;
    $('lock').classList.toggle('on', car.diffLock);
    const surf = car.wheels.find((wh) => wh.contact)?.surface;
    $('surface').textContent = surf ? t(`surface.${surf}`) : '—';
    $('elev').textContent = `${Math.round(car.pos.y + ALT_OFFSET).toLocaleString('en-US')} m`;
    $('rpm-bar').style.transform = `scaleX(${Math.min(1, (car.rpm - 700) / 4100).toFixed(3)})`;

    this.drawIncl(car);
    this.drawWheels(car);
    this.drawCompass(car);
    this.drawMini(car);
    this.updateLog(car);
    this.updateMarkers(car, camera, w, h);
  }

  drawIncl(car) {
    const g = this.incl;
    const W = g.canvas.width, H = g.canvas.height;
    g.clearRect(0, 0, W, H);
    const pitch = car.pitch, roll = car.roll;
    const dial = (cx, label, angle, drawCar) => {
      const r = H * 0.36;
      const cy = H * 0.44;
      const deg = Math.abs(angle * 180 / Math.PI);
      const warn = deg > 32 ? '#e0452b' : deg > 22 ? '#e89a2c' : '#2c2a26';
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(44,42,38,0.25)';
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
      for (let a = -60; a <= 60; a += 15) {
        const rad = (a * Math.PI) / 180 - Math.PI / 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r);
        g.lineTo(cx + Math.cos(rad) * (r - (a % 30 ? 4 : 7)), cy + Math.sin(rad) * (r - (a % 30 ? 4 : 7)));
        g.strokeStyle = Math.abs(a) >= 30 ? '#d2532e' : 'rgba(44,42,38,0.55)';
        g.stroke();
      }
      g.beginPath();
      g.moveTo(cx - r * 0.9, cy + 0.5);
      g.lineTo(cx + r * 0.9, cy + 0.5);
      g.strokeStyle = 'rgba(44,42,38,0.2)';
      g.stroke();
      g.save();
      g.translate(cx, cy);
      g.rotate(-angle);
      g.fillStyle = warn;
      drawCar(g, r);
      g.restore();
      g.fillStyle = '#2c2a26';
      g.font = '700 13px "JetBrains Mono", monospace';
      g.textAlign = 'center';
      g.fillText(`${Math.round(deg)}°`, cx, H - 6);
      g.font = '600 9px "Archivo", sans-serif';
      g.fillStyle = 'rgba(44,42,38,0.6)';
      g.fillText(label, cx, cy - r - 4 > 8 ? cy - r - 4 : 9);
    };
    dial(W * 0.27, t('hud.pitch').toUpperCase(), pitch, (c, r) => {
      // side view, nose to the right
      c.fillRect(-r * 0.62, -r * 0.18, r * 1.24, r * 0.26);
      c.fillRect(-r * 0.5, -r * 0.44, r * 0.66, r * 0.28);
      c.beginPath(); c.arc(-r * 0.38, r * 0.1, r * 0.15, 0, TAU); c.arc(r * 0.4, r * 0.1, r * 0.15, 0, TAU); c.fill();
    });
    dial(W * 0.73, t('hud.roll').toUpperCase(), -roll, (c, r) => {
      // rear view
      c.fillRect(-r * 0.5, -r * 0.2, r, r * 0.3);
      c.fillRect(-r * 0.4, -r * 0.5, r * 0.8, r * 0.3);
      c.fillRect(-r * 0.62, r * 0.02, r * 0.22, r * 0.3);
      c.fillRect(r * 0.4, r * 0.02, r * 0.22, r * 0.3);
    });
  }

  drawWheels(car) {
    const g = this.wheelsCtx;
    const W = g.canvas.width, H = g.canvas.height;
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    g.strokeStyle = 'rgba(44,42,38,0.55)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(cx - 13, cy - 27, 26, 54, 6);
    g.stroke();
    // left is +x in car space; draw from above with the nose up, so left is on the left
    const spots = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    car.wheels.forEach((wh, i) => {
      const [sx, sy] = spots[i];
      const x = cx + sx * 19, y = cy + sy * 19;
      let col = '#9b978f';
      if (wh.contact) col = wh.spinning || wh.sliding ? '#e3742c' : '#4f8a45';
      g.fillStyle = col;
      g.beginPath();
      g.roundRect(x - 4.5, y - 8, 9, 16, 2.5);
      g.fill();
      const comp = wh.contact ? Math.max(0, Math.min(1, (0.42 - wh.len) / 0.36)) : 0;
      const bx = x + sx * 10;
      g.fillStyle = 'rgba(44,42,38,0.15)';
      g.fillRect(bx - 1.5, y - 8, 3, 16);
      g.fillStyle = comp > 0.85 ? '#d2532e' : '#2c2a26';
      g.fillRect(bx - 1.5, y + 8 - 16 * comp, 3, 16 * comp);
    });
  }

  drawCompass(car) {
    const g = this.compass;
    const W = g.canvas.width, H = g.canvas.height;
    g.clearRect(0, 0, W, H);
    const heading = car.heading;
    const span = Math.PI * 0.75;
    const px = (a) => {
      let d = a - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      return W / 2 + (d / span) * W;
    };
    g.textAlign = 'center';
    for (let deg = 0; deg < 360; deg += 5) {
      const a = (deg * Math.PI) / 180;
      const x = px(a);
      if (x < 0 || x > W) continue;
      const major = deg % 45 === 0;
      g.fillStyle = 'rgba(255,250,240,0.85)';
      g.fillRect(x - 0.5, H - (major ? 12 : deg % 15 === 0 ? 8 : 5), 1, major ? 12 : deg % 15 === 0 ? 8 : 5);
      if (major) {
        const lbl = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][deg / 45];
        g.font = `${deg % 90 === 0 ? 800 : 600} ${deg % 90 === 0 ? 14 : 11}px "Archivo", sans-serif`;
        g.fillStyle = deg === 0 ? '#ff8a4c' : '#fffaf0';
        g.fillText(lbl, x, H - 16);
      }
    }
    const next = this.journal.next;
    for (const l of this.journal.places) {
      const a = Math.atan2(l.x - car.pos.x, -(l.z - car.pos.z));
      const x = px(a);
      if (x < 6 || x > W - 6) continue;
      const found = this.journal.found.has(l.id);
      g.save();
      g.translate(x, 7);
      g.rotate(Math.PI / 4);
      g.fillStyle = l === next ? '#ff7a2e' : found ? 'rgba(255,255,255,0.35)' : 'rgba(255,250,240,0.9)';
      g.fillRect(-4, -4, 8, 8);
      g.restore();
    }
    g.fillStyle = '#ff7a2e';
    g.beginPath();
    g.moveTo(W / 2 - 5, H);
    g.lineTo(W / 2 + 5, H);
    g.lineTo(W / 2, H - 7);
    g.fill();
    $('heading-deg').textContent = `${String(Math.round(((heading * 180) / Math.PI + 360) % 360)).padStart(3, '0')}°`;
  }

  drawMini(car) {
    const g = this.mini;
    const W = g.canvas.width;
    const R = W / 2;
    const T = this.T;
    const metres = 170;
    const k = R / metres;
    const topoScale = this.topo.width / T.SIZE;
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 1, 0, TAU);
    g.clip();
    g.fillStyle = '#d8d0bd';
    g.fillRect(0, 0, W, W);
    g.translate(R, R);
    g.rotate(-car.heading);
    g.scale(k / topoScale, k / topoScale);
    g.drawImage(this.topo, -(car.pos.x + T.HALF) * topoScale, -(car.pos.z + T.HALF) * topoScale);
    g.restore();

    // landmarks
    const next = this.journal.next;
    for (const l of this.journal.places) {
      const dx = l.x - car.pos.x, dz = l.z - car.pos.z;
      const c = Math.cos(-car.heading), s = Math.sin(-car.heading);
      let x = (dx * c - dz * s) * k, y = (dx * s + dz * c) * k;
      const d = Math.hypot(x, y);
      const edge = d > R - 9;
      if (edge) { x *= (R - 9) / d; y *= (R - 9) / d; }
      const found = this.journal.found.has(l.id);
      if (edge && l !== next) continue;
      g.save();
      g.translate(R + x, R + y);
      g.rotate(Math.PI / 4);
      g.fillStyle = l === next ? '#ff6a1f' : found ? '#3d6b3a' : '#fffaf0';
      g.strokeStyle = '#2c2a26';
      g.lineWidth = 1.5;
      g.fillRect(-4.5, -4.5, 9, 9);
      g.strokeRect(-4.5, -4.5, 9, 9);
      g.restore();
    }
    // player
    g.fillStyle = '#ff6a1f';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(R, R - 9);
    g.lineTo(R + 6.5, R + 7);
    g.lineTo(R, R + 3.5);
    g.lineTo(R - 6.5, R + 7);
    g.closePath();
    g.stroke();
    g.fill();
    // north marker on the rim
    const na = -car.heading - Math.PI / 2;
    g.fillStyle = '#2c2a26';
    g.font = '800 11px "Archivo", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.beginPath();
    g.arc(R + Math.cos(na) * (R - 10), R + Math.sin(na) * (R - 10), 8, 0, TAU);
    g.fill();
    g.fillStyle = '#fffaf0';
    g.fillText('N', R + Math.cos(na) * (R - 10), R + Math.sin(na) * (R - 10) + 0.5);
  }

  updateLog(car) {
    const j = this.journal;
    const next = j.next;
    $('log-count').textContent = `${j.count} / ${j.total}`;
    $('log-fill').style.transform = `scaleX(${(j.count / j.total).toFixed(3)})`;
    const key = `${next ? next.id : 'done'}|${j.count}`;
    if (key !== this.lastLog) {
      this.lastLog = key;
      $('log-label').textContent = next ? t('hud.next') : t('hud.complete');
      $('log-name').textContent = next ? landmarkName(next.id) : t('hud.completeSub');
      $('log-desc').textContent = next ? landmarkDesc(next.id) : '';
      for (const d of $('log-dots').children) d.classList.toggle('on', j.found.has(d.dataset.id));
    }
    if (next) {
      const dx = next.x - car.pos.x, dz = next.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      $('log-dist').textContent = dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`;
      const bearing = Math.atan2(dx, -dz) - car.heading;
      $('log-arrow').style.transform = `rotate(${bearing}rad)`;
      $('log-nav').classList.remove('hidden');
    } else {
      $('log-nav').classList.add('hidden');
    }
  }

  updateMarkers(car, camera, w, h) {
    const next = this.journal.next;
    for (const l of this.journal.places) {
      const el = this.markers.get(l.id);
      const dist = Math.hypot(l.x - car.pos.x, l.z - car.pos.z);
      const found = this.journal.found.has(l.id);
      const show = l === next || (dist < 260 && dist > 12);
      const v = this._v.set(l.x, l.y + 6, l.z).project(camera);
      if (!show || v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.classList.toggle('next', l === next);
      el.classList.toggle('found', found);
      const sx = Math.min(w - 64, Math.max(64, ((v.x + 1) / 2) * w));
      const sy = Math.min(h - 40, Math.max(70, ((1 - v.y) / 2) * h));
      el.style.transform = `translate(${sx}px, ${sy}px)`;
      el.querySelector('b').textContent = landmarkName(l.id);
      el.querySelector('span').textContent = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
    }
  }

  /** The full-screen topo map. */
  drawMap(canvas, car) {
    const g = canvas.getContext('2d');
    const S = canvas.width;
    const T = this.T;
    g.drawImage(this.topo, 0, 0, S, S);
    const toPx = (v) => ((v + T.HALF) / T.SIZE) * S;
    const next = this.journal.next;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    for (const l of T.landmarks) {
      const x = toPx(l.x), y = toPx(l.z);
      const found = !l.counted || this.journal.found.has(l.id);
      g.save();
      g.translate(x, y);
      g.rotate(Math.PI / 4);
      g.fillStyle = l === next ? '#ff6a1f' : found ? '#3d6b3a' : '#fffaf0';
      g.strokeStyle = '#2c2a26';
      g.lineWidth = 2;
      g.fillRect(-6, -6, 12, 12);
      g.strokeRect(-6, -6, 12, 12);
      g.restore();
      g.font = `700 ${Math.round(S / 50)}px "Archivo", "Noto Sans KR", sans-serif`;
      const label = found || l === next ? landmarkName(l.id) : '?';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(255,250,240,0.9)';
      g.strokeText(label, x + 12, y);
      g.fillStyle = '#2c2a26';
      g.fillText(label, x + 12, y);
    }
    const x = toPx(car.pos.x), y = toPx(car.pos.z);
    g.save();
    g.translate(x, y);
    g.rotate(car.heading);
    g.fillStyle = '#ff6a1f';
    g.strokeStyle = '#fff';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(0, -13);
    g.lineTo(9, 10);
    g.lineTo(0, 5);
    g.lineTo(-9, 10);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
  }
}
