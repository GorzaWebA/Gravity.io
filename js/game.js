'use strict';

/* Ties everything together: state machine (menu / playing / paused / dead), loop, camera, events → sound & HUD. */
class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas);
    this.input = new Input(this.canvas);
    this.sfx = new Sfx();
    this.hud = new Hud(this);
    this.cam = { x: 0, y: 0, zoom: 0.3, sx: 0, sy: 0, shake: 0 };
    this.state = 'menu';
    this.world = new World({ attract: true });
    this.player = null;
    this.killer = null;
    this.prefs = { name: storageGet('gravity.name', ''), hue: storageGet('gravity.hue', PLAYER_HUES[0]) };
    if (!PLAYER_HUES.includes(this.prefs.hue)) this.prefs.hue = PLAYER_HUES[0];
    this.best = storageGet('gravity.best', null);
    this.flash = 0;
    this.danger = 0;
    this.acc = 0;
    this.time = 0;
    this.deathTimer = 0;
    this.attract = { target: null, timer: 0 };
    this.last = performance.now();

    this.hud.initMenu(this.prefs, this.best);
    this.hud.setMuted(this.sfx.muted);
    this.hud.setScreen('menu');
    this._bindUi();

    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.hud.resize();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.setPaused(true);
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  _bindUi() {
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
    document.getElementById('start-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.start();
    });
    on('btn-again', () => this.start());
    on('btn-menu', () => this.toMenu());
    on('btn-resume', () => this.setPaused(false));
    on('btn-quit', () => this.toMenu());
    on('btn-pause', () => this.setPaused(true));
    on('btn-mute', () => this.toggleMute());
  }

  setHue(hue) {
    this.prefs.hue = hue;
    storageSet('gravity.hue', hue);
  }

  toggleMute() {
    this.sfx.unlock();
    this.hud.setMuted(this.sfx.toggleMute());
  }

  /* ---------- state changes ---------- */

  start() {
    // Enter can arrive both as a key press and as the form's submit event
    const now = performance.now();
    if (now - (this._lastStart || -1e9) < 500) return;
    this._lastStart = now;
    const name = (this.hud.nameValue() || 'Unnamed rock').slice(0, 16);
    this.prefs.name = name === 'Unnamed rock' ? '' : name;
    storageSet('gravity.name', this.prefs.name);
    this.sfx.unlock();
    this.world = new World();
    this.player = this.world.spawnPlayer(name, this.prefs.hue);
    this.killer = null;
    this.cam.x = this.player.x;
    this.cam.y = this.player.y;
    this.cam.zoom = this.zoomFor(this.player);
    this.danger = 0;
    this.flash = 0;
    this.acc = 0;
    this.state = 'playing';
    this.hud.reset();
    this.hud.setScreen('playing');
    this.hud.banner('You are an', 'Asteroid', TIERS[0].perk, '');
    this.hud.feed(`<b>${escapeHtml(name)}</b> entered the system.`, 'you');
    this.canvas.focus?.();
  }

  toMenu() {
    this.state = 'menu';
    this.player = null;
    this.killer = null;
    this.world = new World({ attract: true });
    this.attract.target = null;
    this.sfx.setBoost(false);
    this.hud.setScreen('menu');
    this.hud.setBest(this.best);
  }

  setPaused(paused) {
    if (paused && this.state === 'playing') {
      this.state = 'paused';
      this.sfx.setBoost(false);
      this.hud.setScreen('paused');
    } else if (!paused && this.state === 'paused') {
      this.state = 'playing';
      this.last = performance.now();
      this.hud.setScreen('playing');
    }
  }

  onPlayerDeath(killer) {
    const p = this.player;
    this.state = 'dead';
    this.killer = killer;
    this.deathTimer = 1.5;
    this.cam.shake += 16;
    this.sfx.play('death');
    this.sfx.setBoost(false);
    this.hud.setScreen('dead');

    const s = p.stats;
    const time = this.world.time - s.born;
    const record = !this.best || s.peakMass > this.best.mass;
    if (record) {
      this.best = { mass: Math.round(s.peakMass), tier: s.peakTier, time };
      storageSet('gravity.best', this.best);
    }
    this.deathInfo = {
      killer: killer.name, killerTier: TIERS[killer.tier].name, killerMass: killer.mass,
      time, peakMass: s.peakMass, peakTier: TIERS[s.peakTier].name, bodies: s.bodies,
      dust: s.dust, comets: s.comets, bestRank: s.bestRank, record,
    };
    this.hud.feed(`<b>${escapeHtml(killer.name)}</b> absorbed you.`, 'warn');
  }

  onKey(code) {
    if (code === 'KeyM') this.toggleMute();
    else if (code === 'Escape' || code === 'KeyP') {
      if (this.state === 'playing') this.setPaused(true);
      else if (this.state === 'paused') this.setPaused(false);
    } else if (code === 'Enter') {
      if (this.state === 'menu') this.start();
      else if (this.state === 'dead' && this.deathTimer <= 0) this.start();
    }
  }

  /* ---------- loop ---------- */

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;

    for (const key of this.input.takePresses()) this.onKey(key);

    if (this.state !== 'paused') {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= CONFIG.STEP && steps < CONFIG.MAX_STEPS_PER_FRAME) {
        this.applyInput();
        this.world.step(CONFIG.STEP);
        this.handleEvents();
        this.acc -= CONFIG.STEP;
        steps++;
      }
      if (steps >= CONFIG.MAX_STEPS_PER_FRAME) this.acc = 0;
    }

    if (this.state === 'dead' && this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.hud.showDeath(this.deathInfo);
    }

    this.updateCamera(dt);
    const p = this.player;
    const alive = this.state === 'playing' && p && p.alive;
    this.danger += ((alive ? clamp((p.danger - 0.3) / 0.7, 0, 1.2) : 0) - this.danger) * Math.min(1, dt * 6);
    this.renderer.render(this.world, this.cam, {
      time: this.world.time,
      focus: this.state === 'menu' ? null : p,
      danger: this.danger,
      flash: this.flash,
    });
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.sfx.setBoost(alive && p.boosting);
    this.hud.update(dt, this.world, p, this.state);
    if (this.state === 'menu') this.hud.updateMenu(this.time, this.prefs.hue);

    requestAnimationFrame((t) => this.frame(t));
  }

  applyInput() {
    const p = this.player;
    if (!p || !p.alive || this.state !== 'playing') return;
    const inp = this.input;
    const k = inp.keyDir();
    let dx = 0, dy = 0, throttle = 0;
    if (k.x || k.y) {
      const l = Math.hypot(k.x, k.y);
      dx = k.x / l;
      dy = k.y / l;
      throttle = 1;
    } else if (inp.pointerActive) {
      const z = this.cam.zoom;
      const sx = (p.x - this.cam.x) * z + this.renderer.w / 2;
      const sy = (p.y - this.cam.y) * z + this.renderer.h / 2;
      const vx = inp.mx - sx, vy = inp.my - sy;
      const l = Math.hypot(vx, vy);
      const dead = Math.max(6, p.drawR * z * 0.2);
      if (l > dead) {
        dx = vx / l;
        dy = vy / l;
        throttle = clamp((l - dead) / (80 + p.drawR * z * 0.6), 0, 1);
      }
    }
    p.input.dx = dx;
    p.input.dy = dy;
    p.input.throttle = throttle;
    p.input.boost = inp.boostHeld;
    if (inp.consumeSurge()) p.input.surge = true;
  }

  zoomFor(b) {
    const scale = clamp(Math.min(this.renderer.w, this.renderer.h) / 850, 0.62, 1.5);
    return clamp(Math.pow(24 / b.drawR, 0.55), 0.09, 1.15) * scale;
  }

  viewSize() {
    return { w: this.renderer.w / this.cam.zoom, h: this.renderer.h / this.cam.zoom };
  }

  updateCamera(dt) {
    const cam = this.cam;
    let target = null, zoomMul = 1, follow = 7;
    if ((this.state === 'playing' || this.state === 'paused') && this.player && this.player.alive) {
      target = this.player;
      if (target.surgeT > 0) zoomMul = 0.88;
    } else if (this.state === 'dead') {
      target = this.killer && this.killer.alive ? this.killer : null;
      follow = 2.5;
    } else if (this.state === 'menu') {
      const a = this.attract;
      a.timer -= dt;
      if (!a.target || !a.target.alive || a.timer <= 0) {
        const pool = this.world.ranked.slice(0, 8);
        a.target = pool.length ? pick(pool) : null;
        a.timer = rand(12, 18);
      }
      target = a.target;
      zoomMul = 0.7;
      follow = 0.8;
    }
    if (target) {
      const k = 1 - Math.exp(-dt * follow);
      cam.x += (target.x - cam.x) * k;
      cam.y += (target.y - cam.y) * k;
      const zt = this.zoomFor(target) * zoomMul;
      cam.zoom += (zt - cam.zoom) * (1 - Math.exp(-dt * 2.5));
    }
    cam.shake = Math.min(30, cam.shake) * Math.exp(-dt * 7);
    cam.sx = (Math.random() - 0.5) * 2 * cam.shake;
    cam.sy = (Math.random() - 0.5) * 2 * cam.shake;
  }

  /* Volume for an event at (x, y), fading with distance from the camera. */
  _vol(x, y, range = 2600) {
    return clamp(1 - Math.hypot(x - this.cam.x, y - this.cam.y) / range, 0, 1);
  }

  handleEvents() {
    const w = this.world, p = this.player;
    if (this.state === 'menu') {
      w.events.length = 0;
      return;
    }
    const esc = escapeHtml;
    for (const e of w.events) {
      switch (e.type) {
        case 'absorb': {
          if (e.victim === p) {
            this.onPlayerDeath(e.eater);
          } else if (e.eater === p) {
            this.sfx.play('absorb', 1);
            this.cam.shake += 5 + Math.min(12, e.gain / 25);
            w.floatText(p.x, p.y - p.r, `+${formatMass(e.gain)}`, '#80f0c8', 22);
            this.hud.feed(`You absorbed <b>${esc(e.victim.name)}</b> <span class="gain">+${formatMass(e.gain)}</span>`, 'you');
          } else {
            const vol = this._vol(e.eater.x, e.eater.y);
            this.sfx.play('absorb', vol * 0.5);
            if (e.victim.mass > 40 || e.eater.rank <= 3 || vol > 0.3) {
              this.hud.feed(`<b>${esc(e.eater.name)}</b> absorbed <b>${esc(e.victim.name)}</b>`);
            }
          }
          break;
        }
        case 'eat':
          if (e.food.type === FOOD_ROCK) {
            this.sfx.play('rock');
            w.floatText(e.food.x, e.food.y, `+${Math.round(e.food.mass)}`, '#ffd9b0', 13);
          } else {
            this.sfx.play('dust');
          }
          break;
        case 'eatBig': {
          const what = e.food.type === FOOD_COMET ? 'a comet' : 'the pulsar';
          if (e.body === p) {
            this.sfx.play('bigEat');
            w.floatText(p.x, p.y - p.r, `+${Math.round(e.food.mass)}`, '#9cd8ff', 20);
            this.hud.feed(`You caught ${what} <span class="gain">+${Math.round(e.food.mass)}</span>`, 'big');
          } else if (e.food.type === FOOD_REMNANT) {
            this.hud.feed(`<b>${esc(e.body.name)}</b> claimed the pulsar.`, 'big');
          }
          break;
        }
        case 'tier': {
          const tier = TIERS[e.to];
          if (e.body === p) {
            if (e.to > e.from) {
              this.sfx.play('tierUp');
              this.hud.banner('Evolved into', tier.name, tier.perk);
              this.hud.feed(`You became a <b>${tier.name}</b>.`, 'you');
              this.flash = Math.max(this.flash, 0.18);
            } else {
              this.sfx.play('tierDown');
              this.hud.banner('Lost mass', tier.name, 'Eat to climb back up.', 'down');
            }
          } else if (e.to > e.from && e.to >= 5) {
            const verb = tier.key === 'blackhole' ? 'collapsed into a' : 'ignited into a';
            this.hud.feed(`<b>${esc(e.body.name)}</b> ${verb} <b>${tier.name}</b>.`, 'warn');
          }
          break;
        }
        case 'surge':
          if (e.body === p) this.sfx.play('surge', 1);
          else this.sfx.play('surge', this._vol(e.body.x, e.body.y, 1600) * 0.6);
          break;
        case 'collide':
          if (e.a === p || e.b === p) {
            this.cam.shake += 6;
            this.sfx.play('collide', 1);
          }
          break;
        case 'supernovaWarning':
          this.sfx.play('warn');
          this.hud.banner('Warning', 'Supernova', 'A star is collapsing. Stay outside the red ring.', 'warn');
          this.hud.feed('A star is about to go supernova.', 'warn');
          break;
        case 'supernova': {
          const d = Math.hypot(e.x - this.cam.x, e.y - this.cam.y);
          this.sfx.play('supernova', clamp(1 - d / 4000, 0.15, 1));
          this.flash = Math.max(this.flash, 0.75 * clamp(1 - d / 1800, 0, 1));
          this.cam.shake += 22 * clamp(1 - d / 2200, 0, 1);
          break;
        }
        case 'supernovaHit':
          if (e.body === p) {
            w.floatText(p.x, p.y - p.r, `−${formatMass(e.loss)}`, '#ff8d9c', 22);
            this.hud.feed(`Caught in the blast <span class="loss">−${formatMass(e.loss)}</span>`, 'warn');
          }
          break;
        case 'shock':
          if (e.body === p) this.cam.shake += 10 * e.power;
          break;
        case 'wormhole':
          if (e.body === p) {
            this.sfx.play('wormhole');
            this.cam.x = p.x;
            this.cam.y = p.y;
            this.flash = Math.max(this.flash, 0.3);
          }
          break;
      }
    }
    w.events.length = 0;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
