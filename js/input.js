'use strict';

/* Radius (px) of the on-screen joystick. A thumb this far from where it landed is full throttle. */
const JOY_RADIUS = 56;
const JOY_DEADZONE = 7;

/*
 * Mouse, keyboard and touch. Steering is resolved by the Game (it needs the camera);
 * this class only records what the player is doing.
 *
 * Touch uses a floating joystick: wherever a thumb lands on the playing field becomes the
 * stick's centre, so the thumb never covers your own body. Boost and surge are buttons.
 */
class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.mx = window.innerWidth / 2;
    this.my = window.innerHeight / 2;
    this.pointerActive = false;
    this.keys = new Set();
    this.mouseBoost = false;
    this.touchBoost = false;
    this.touchMode = false;
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.joyEl = document.getElementById('joystick');
    this.knobEl = this.joyEl ? this.joyEl.firstElementChild : null;
    this._surge = false;
    this._presses = [];

    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) this._setTouch(true);
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this._setTouch(true);
    }, true);

    canvas.addEventListener('pointermove', (e) => this._onMove(e));
    canvas.addEventListener('pointerdown', (e) => this._onDown(e));
    window.addEventListener('pointerup', (e) => this._onUp(e));
    window.addEventListener('pointercancel', (e) => this._onUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.releaseAll());

    // Safari: stop pinch-zoom from hijacking the game while playing
    const inGame = () => document.body.classList.contains('in-game');
    for (const type of ['gesturestart', 'gesturechange']) {
      document.addEventListener(type, (e) => {
        if (inGame()) e.preventDefault();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (this._typing(e)) {
        if (e.code === 'Enter') this._presses.push('Enter');
        return;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        this._presses.push(e.code);
        if (e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this._surge = true;
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    const hold = (id, on, off) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.classList.add('pressed');
        on();
      });
      const up = () => {
        el.classList.remove('pressed');
        off();
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold('btn-boost', () => (this.touchBoost = true), () => (this.touchBoost = false));
    hold('btn-surge', () => (this._surge = true), () => {});
  }

  _typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  _setTouch(on) {
    if (this.touchMode === on) return;
    this.touchMode = on;
    document.body.classList.toggle('touch', on);
  }

  /* Drop every held control (window lost focus, game paused, player died). */
  releaseAll() {
    this.keys.clear();
    this.mouseBoost = false;
    this.touchBoost = false;
    this._endJoy();
    for (const id of ['btn-boost', 'btn-surge']) document.getElementById(id)?.classList.remove('pressed');
  }

  _onMove(e) {
    if (e.pointerType === 'touch') {
      if (e.pointerId !== this.joy.id) return;
      const j = this.joy;
      j.x = e.clientX;
      j.y = e.clientY;
      // Floating stick: if the thumb runs past the rim, drag the centre along behind it
      const dx = j.x - j.ox, dy = j.y - j.oy, len = Math.hypot(dx, dy);
      if (len > JOY_RADIUS) {
        j.ox = j.x - (dx / len) * JOY_RADIUS;
        j.oy = j.y - (dy / len) * JOY_RADIUS;
      }
      this._drawJoy();
      return;
    }
    this._setTouch(false);
    this.mx = e.clientX;
    this.my = e.clientY;
    this.pointerActive = true;
  }

  _onDown(e) {
    if (e.pointerType === 'touch') {
      this._setTouch(true);
      if (this.joy.id === null) {
        const j = this.joy;
        j.id = e.pointerId;
        j.ox = j.x = e.clientX;
        j.oy = j.y = e.clientY;
        this._drawJoy();
      }
      return;
    }
    this._setTouch(false);
    this.mx = e.clientX;
    this.my = e.clientY;
    this.pointerActive = true;
    if (e.button === 0) this.mouseBoost = true;
    if (e.button === 2) this._surge = true;
  }

  _onUp(e) {
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.joy.id) this._endJoy();
      return;
    }
    if (e.button === 0) this.mouseBoost = false;
  }

  _endJoy() {
    this.joy.id = null;
    if (this.joyEl) this.joyEl.classList.remove('on');
  }

  _drawJoy() {
    if (!this.joyEl) return;
    const j = this.joy;
    this.joyEl.classList.add('on');
    this.joyEl.style.transform = `translate(${j.ox}px, ${j.oy}px)`;
    if (this.knobEl) this.knobEl.style.transform = `translate(${j.x - j.ox}px, ${j.y - j.oy}px)`;
  }

  /* Direction and throttle from the joystick, or null when no thumb is on it. */
  joyVector() {
    const j = this.joy;
    if (j.id === null) return null;
    const dx = j.x - j.ox, dy = j.y - j.oy, len = Math.hypot(dx, dy);
    if (len < JOY_DEADZONE) return { dx: 0, dy: 0, throttle: 0 };
    return { dx: dx / len, dy: dy / len, throttle: clamp((len - JOY_DEADZONE) / (JOY_RADIUS - JOY_DEADZONE), 0, 1) };
  }

  get boostHeld() {
    return this.keys.has('Space') || this.mouseBoost || this.touchBoost;
  }

  /* WASD / arrow keys, if any are held. */
  keyDir() {
    let x = 0, y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    return { x, y };
  }

  consumeSurge() {
    const s = this._surge;
    this._surge = false;
    return s;
  }

  /* Edge-triggered key presses since the last frame. */
  takePresses() {
    const p = this._presses;
    this._presses = [];
    return p;
  }
}
