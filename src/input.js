// Keyboard, gamepad and on-screen touch controls merged into one driver input.

const ACTION_KEYS = {
  KeyL: 'range',
  KeyX: 'lock',
  KeyC: 'cam',
  KeyR: 'recover',
  KeyH: 'lights',
  KeyT: 'time',
  KeyG: 'weather',
  KeyF: 'photo',
  KeyM: 'map',
  Tab: 'map',
  KeyP: 'pause',
  Escape: 'pause',
  KeyV: 'sound',
  Slash: 'help',
  F1: 'help',
};
const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'F1']);
// Standard gamepad mapping: button index → action.
const PAD_ACTIONS = { 1: 'cam', 2: 'lock', 3: 'range', 4: 'lights', 5: 'recover', 8: 'map', 9: 'pause' };

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = [];
    this.touch = { gas: 0, brake: 0, left: 0, right: 0, hb: 0 };
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.handbrake = false;
    this.padPrev = [];
    this.usingPad = false;
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (BLOCK.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat && ACTION_KEYS[e.code]) {
        let a = ACTION_KEYS[e.code];
        if (a === 'recover' && e.shiftKey) a = 'recoverTrail';
        this.pressed.push(a);
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      for (const k of Object.keys(this.touch)) this.touch[k] = 0;
    });
  }

  /** Hold buttons ([data-touch]) and tap buttons ([data-action]) on the touch overlay. */
  bindTouch(root) {
    for (const el of root.querySelectorAll('[data-touch]')) {
      const k = el.dataset.touch;
      const on = (e) => { e.preventDefault(); this.touch[k] = 1; el.classList.add('on'); el.setPointerCapture?.(e.pointerId); };
      const off = () => { this.touch[k] = 0; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
    }
    for (const el of root.querySelectorAll('[data-action]')) {
      let timer = 0;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // A long press on recover goes back to the trail.
        if (el.dataset.action === 'recover') timer = setTimeout(() => { timer = 0; this.pressed.push('recoverTrail'); }, 650);
        else this.pressed.push(el.dataset.action);
      });
      el.addEventListener('pointerup', () => {
        if (timer) { clearTimeout(timer); timer = 0; this.pressed.push('recover'); }
      });
    }
  }

  consume() {
    const list = this.pressed;
    this.pressed = [];
    return list;
  }

  poll(dt) {
    const k = this.keys;
    const kb = (a, b) => (k.has(a) || k.has(b) ? 1 : 0);
    let throttle = kb('KeyW', 'ArrowUp');
    let brake = kb('KeyS', 'ArrowDown');
    let steerTarget = kb('KeyD', 'ArrowRight') - kb('KeyA', 'ArrowLeft');
    let hb = k.has('Space');

    throttle = Math.max(throttle, this.touch.gas);
    brake = Math.max(brake, this.touch.brake);
    steerTarget += this.touch.right - this.touch.left;
    hb = hb || !!this.touch.hb;

    // Digital steering eases in, and snaps back faster than it turns.
    const back = Math.sign(steerTarget) !== Math.sign(this.steer) || steerTarget === 0;
    const rate = back ? 5 : 2.6;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, steerTarget - this.steer));

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    if (pad) {
      const b = pad.buttons;
      const val = (i) => (b[i] ? (typeof b[i] === 'object' ? b[i].value : b[i]) : 0);
      const rt = val(7), lt = val(6);
      const ax = Math.abs(pad.axes[0]) > 0.12 ? pad.axes[0] : 0;
      if (rt > 0.05 || lt > 0.05 || ax !== 0) this.usingPad = true;
      if (this.usingPad) {
        throttle = Math.max(throttle, rt);
        brake = Math.max(brake, lt);
        if (ax !== 0) this.steer = Math.sign(ax) * Math.pow(Math.abs(ax), 1.4);
        hb = hb || val(0) > 0.5;
      }
      for (const [i, action] of Object.entries(PAD_ACTIONS)) {
        const down = val(+i) > 0.5;
        if (down && !this.padPrev[i]) this.pressed.push(action);
        this.padPrev[i] = down;
      }
    }

    this.throttle = this.enabled ? throttle : 0;
    this.brake = this.enabled ? brake : 0;
    this.handbrake = this.enabled && hb;
    if (!this.enabled) this.steer = 0;
    this.steer = Math.max(-1, Math.min(1, this.steer));
  }
}
