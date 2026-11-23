'use strict';

/*
 * Mouse, keyboard and touch. Steering is resolved by the Game (it needs the camera);
 * this class only records what the player is doing.
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
    this.steerId = null;
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
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseBoost = false;
      this.touchBoost = false;
    });

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
        on();
      });
      el.addEventListener('pointerup', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('pointercancel', off);
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

  _onMove(e) {
    if (e.pointerType === 'touch') {
      if (e.pointerId !== this.steerId) return;
    } else {
      this._setTouch(false);
    }
    this.mx = e.clientX;
    this.my = e.clientY;
    this.pointerActive = true;
  }

  _onDown(e) {
    if (e.pointerType === 'touch') {
      this._setTouch(true);
      if (this.steerId === null) {
        this.steerId = e.pointerId;
        this.mx = e.clientX;
        this.my = e.clientY;
        this.pointerActive = true;
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
      if (e.pointerId === this.steerId) {
        this.steerId = null;
        this.pointerActive = false;
      }
      return;
    }
    if (e.button === 0) this.mouseBoost = false;
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
