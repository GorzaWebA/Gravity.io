'use strict';

/*
 * The simulation. Knows nothing about the DOM or canvas, so it can also run headless
 * (see tools/simulate.js). Things the presentation layer cares about are pushed to
 * `events` and drained by the Game after every step.
 */
class World {
  constructor({ attract = false, botCount = CONFIG.BOT_COUNT } = {}) {
    this.R = CONFIG.WORLD_RADIUS;
    this.time = 0;
    this.attract = attract;
    this.bodies = [];
    this.food = [];
    this.comets = [];
    this.events = [];
    this.fx = { particles: [], ghosts: [], texts: [], shockwaves: [] };
    this.supernovae = [];
    this.nebulae = [];
    this.wormholes = [];
    this.grid = new FoodGrid(this.R, 160);
    this.player = null;
    this.ranked = [];
    this.respawnQueue = [];
    this.counts = { dust: 0, rock: 0, comet: 0, debris: 0 };
    this.nextComet = rand(3, 6);
    this.nextSupernova = attract ? 12 : CONFIG.SUPERNOVA_FIRST;
    this.rankTimer = 0;
    this._dustCarry = 0;
    this._tmp = [];

    this._genNebulae();
    this._genWormholes();
    this._seedFood();
    this._seedBots(botCount);
    this._rank();
  }

  emit(type, data) {
    this.events.push(Object.assign({ type }, data));
  }

  /* ---------- generation ---------- */

  _genNebulae() {
    const hues = [285, 205, 335, 170, 22, 245];
    for (let i = 0; i < CONFIG.NEBULA_COUNT; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const p = randomInDisk(this.R * 0.78);
        if (this.nebulae.every((n) => Math.hypot(n.x - p.x, n.y - p.y) > 1600)) {
          this.nebulae.push({ id: i, x: p.x, y: p.y, r: rand(480, 720), hue: hues[i % hues.length], seed: randInt(1, 1e9) });
          break;
        }
      }
    }
  }

  _genWormholes() {
    const hues = [278, 172, 320, 200];
    const base = rand(0, TAU);
    for (let i = 0; i < CONFIG.WORMHOLE_PAIRS; i++) {
      const a = base + (i * Math.PI) / CONFIG.WORMHOLE_PAIRS + rand(-0.3, 0.3);
      const b = a + Math.PI + rand(-0.5, 0.5);
      const ra = this.R * rand(0.45, 0.8), rb = this.R * rand(0.45, 0.8);
      const hue = hues[i % hues.length];
      const w1 = { id: i * 2, x: Math.cos(a) * ra, y: Math.sin(a) * ra, r: CONFIG.WORMHOLE_RADIUS, hue, spin: rand(0, TAU), partner: null };
      const w2 = { id: i * 2 + 1, x: Math.cos(b) * rb, y: Math.sin(b) * rb, r: CONFIG.WORMHOLE_RADIUS, hue, spin: rand(0, TAU), partner: w1 };
      w1.partner = w2;
      this.wormholes.push(w1, w2);
    }
  }

  _seedFood() {
    for (let i = 0; i < CONFIG.DUST_COUNT; i++) this._spawnDust();
    for (let i = 0; i < CONFIG.ROCK_COUNT; i++) this._spawnRock(false);
  }

  _seedBots(n) {
    for (let i = 0; i < n; i++) {
      let m;
      if (i < 2) m = rand(450, 900);
      else if (i < 6) m = rand(110, 300);
      else if (i < 12) m = rand(28, 80);
      else m = rand(10, 22);
      this._spawnBot(m);
    }
  }

  _spawnDust() {
    let p;
    if (this.nebulae.length && Math.random() < 0.3) {
      const n = pick(this.nebulae);
      const q = randomInDisk(n.r * 0.85);
      p = { x: n.x + q.x, y: n.y + q.y };
    } else {
      p = randomInDisk(this.R * 0.97);
    }
    this.food.push(makeFood(FOOD_DUST, p.x, p.y));
  }

  _spawnRock(avoidBodies) {
    let p;
    for (let tries = 0; tries < 6; tries++) {
      if (Math.random() < 0.6) {
        const a = rand(0, TAU);
        const rr = this.R * CONFIG.BELT_RADIUS + rand(-1, 1) * CONFIG.BELT_WIDTH;
        p = { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
      } else {
        p = randomInDisk(this.R * 0.95);
      }
      if (!avoidBodies || this.bodies.every((b) => Math.hypot(b.x - p.x, b.y - p.y) > b.r + 220)) break;
    }
    const f = makeFood(FOOD_ROCK, p.x, p.y);
    f.vx = rand(-8, 8);
    f.vy = rand(-8, 8);
    this.food.push(f);
  }

  _freeName() {
    const used = new Set(this.bodies.filter((b) => b.alive).map((b) => b.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    return free.length ? pick(free) : `${pick(BOT_NAMES)}-${randInt(2, 99)}`;
  }

  _spawnBot(mass) {
    const p = this.findSafeSpot(mass);
    const b = new Body({ name: this._freeName(), mass, x: p.x, y: p.y, hue: 15 + 30 * randInt(0, 11) });
    b.brain = new BotBrain(b);
    b.stats.born = this.time;
    b.shield = 1.5;
    this.bodies.push(b);
    return b;
  }

  /* Pick the spawn point that is farthest from anything that could eat a body of `mass`. */
  findSafeSpot(mass) {
    const r = massToRadius(mass);
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const p = randomInDisk(this.R * 0.85);
      let score = Infinity;
      for (const b of this.bodies) {
        if (!b.alive) continue;
        const d = Math.hypot(b.x - p.x, b.y - p.y) - b.r - r;
        const need = b.mass > mass * 1.1 ? b.gravRange() + 350 : 120;
        score = Math.min(score, d - need);
      }
      for (const sn of this.supernovae) {
        score = Math.min(score, Math.hypot(sn.x - p.x, sn.y - p.y) - CONFIG.SUPERNOVA_BLAST * 0.6);
      }
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
      if (score > 500) break;
    }
    return best;
  }

  spawnPlayer(name, hue) {
    const p = this.findSafeSpot(CONFIG.START_MASS);
    const b = new Body({ name, mass: CONFIG.START_MASS, x: p.x, y: p.y, hue, isPlayer: true });
    b.stats.born = this.time;
    this.bodies.push(b);
    this.player = b;
    this._rank();
    return b;
  }

  nebulaAt(x, y) {
    for (const n of this.nebulae) {
      const dx = x - n.x, dy = y - n.y;
      if (dx * dx + dy * dy < n.r * n.r * 0.64) return n;
    }
    return null;
  }

  addFood(f) {
    this.food.push(f);
  }

  /* ---------- main step ---------- */

  step(dt) {
    this.time += dt;
    const bodies = this.bodies;

    for (const b of bodies) if (b.alive && b.brain) b.brain.think(this, dt);

    for (const b of bodies) {
      b.ax = 0;
      b.ay = 0;
      b.danger = 0;
      if (b.shield > 0) b.shield -= dt;
      if (b.collCd > 0) b.collCd -= dt;
      if (b.wormCd > 0) b.wormCd -= dt;
      if (b.flash > 0) b.flash -= dt * 2.5;
      if (b.surgeT > 0) b.surgeT -= dt;
      if (b.surgeCd > 0) b.surgeCd -= dt;
      if (b.input.surge) {
        b.input.surge = false;
        if (b.surgeCd <= 0) {
          b.surgeT = CONFIG.SURGE_DURATION;
          b.surgeCd = CONFIG.SURGE_COOLDOWN;
          this.emit('surge', { body: b });
        }
      }
      b.inNebula = this.nebulaAt(b.x, b.y) !== null;
    }

    this._gravity();
    this._wormholePull();
    for (const b of bodies) if (b.alive) this._move(b, dt);
    this._contacts();
    this._food(dt);
    this._wormholes();
    this._worldEvents(dt);
    this._shockwaves(dt);

    for (const b of bodies) {
      if (!b.alive) continue;
      if (b.mass > CONFIG.DECAY_START) {
        const excess = b.mass - CONFIG.DECAY_START;
        const soft = b.mass / CONFIG.DECAY_SOFTCAP;
        b.setMass(b.mass - excess * CONFIG.DECAY_RATE * (1 + soft * soft) * TIERS[b.tier].decay * dt);
      }
      this._checkTier(b);
      b.drawR += (b.r - b.drawR) * Math.min(1, dt * 8);
      b.spin = (b.spin + b.spinSpeed * dt) % 1;
    }

    let w = 0;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.alive) bodies[w++] = b;
      else if (b.brain) this.respawnQueue.push(rand(2, 5));
    }
    bodies.length = w;

    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      this.respawnQueue[i] -= dt;
      if (this.respawnQueue[i] <= 0) {
        this.respawnQueue.splice(i, 1);
        this._spawnBot(rand(10, 24));
      }
    }

    let deficit = CONFIG.DUST_COUNT - this.counts.dust;
    if (deficit > 0) {
      this._dustCarry += CONFIG.DUST_RESPAWN_PER_SEC * dt;
      while (this._dustCarry >= 1 && deficit-- > 0) {
        this._dustCarry -= 1;
        this._spawnDust();
      }
    } else {
      this._dustCarry = 0;
    }
    if (this.counts.rock < CONFIG.ROCK_COUNT && Math.random() < dt * 4) this._spawnRock(true);

    this.rankTimer -= dt;
    if (this.rankTimer <= 0) {
      this.rankTimer = 0.25;
      this._rank();
    }

    this._updateFx(dt);
  }

  _rank() {
    const sorted = this.bodies.filter((b) => b.alive).sort((a, b) => b.mass - a.mass);
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i];
      b.rank = i + 1;
      if (b.rank < b.stats.bestRank) b.stats.bestRank = b.rank;
    }
    this.ranked = sorted;
  }

  /* Bigger bodies pull smaller ones. Pull fades out at the edge of the gravity range. */
  _gravity() {
    const bs = this.bodies, n = bs.length;
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = bs[j];
        if (!b.alive) continue;
        let big = a, small = b;
        if (b.mass > a.mass) {
          big = b;
          small = a;
        }
        const ratio = big.mass / small.mass;
        if (ratio < 1.03) continue;
        const dx = big.x - small.x, dy = big.y - small.y;
        const d2 = dx * dx + dy * dy;
        const range = big.gravRange() + small.r;
        if (d2 > range * range) continue;
        const d = Math.sqrt(d2) || 0.001;
        const dEff = Math.max(d, big.r * 0.75);
        let g = (CONFIG.G * big.gravMul() * big.mass) / (dEff * dEff);
        g *= smoothstep(range, range * 0.7, d);
        g *= clamp((ratio - 1) / (CONFIG.EAT_RATIO - 1), 0.3, 1);
        if (small.shield > 0) g *= 0.35;
        const nx = dx / d, ny = dy / d;
        small.ax += nx * g;
        small.ay += ny * g;
        const back = g * (small.mass / big.mass) * 0.5;
        big.ax -= nx * back;
        big.ay -= ny * back;
        if (big.canEat(small)) {
          small.danger = Math.max(small.danger, g / (maxSpeedFor(small.mass) * CONFIG.DRAG));
        }
      }
    }
  }

  _wormholePull() {
    for (const b of this.bodies) {
      if (!b.alive || b.wormCd > 0 || b.mass > CONFIG.WORMHOLE_MAX_MASS) continue;
      for (const w of this.wormholes) {
        const dx = w.x - b.x, dy = w.y - b.y;
        const reach = w.r * 3.2;
        const d2 = dx * dx + dy * dy;
        if (d2 > reach * reach) continue;
        const d = Math.sqrt(d2) || 1;
        const f = 260 * (1 - d / reach);
        b.ax += (dx / d) * f;
        b.ay += (dy / d) * f;
      }
    }
  }

  _move(b, dt) {
    const inp = b.input;
    const throttle = clamp(inp.throttle, 0, 1);
    let maxS = maxSpeedFor(b.mass);
    const boosting = inp.boost && throttle > 0.05 && b.mass > CONFIG.BOOST_MIN_MASS;
    if (boosting) {
      maxS *= CONFIG.BOOST_MUL;
      const cost = (b.mass * CONFIG.BOOST_COST_FRAC + CONFIG.BOOST_COST_FLAT) * dt;
      b.setMass(b.mass - cost);
      b.boostAcc += cost;
      const chunk = Math.max(0.8, b.mass * 0.004);
      while (b.boostAcc >= chunk) {
        b.boostAcc -= chunk;
        const ang = Math.atan2(-inp.dy, -inp.dx) + rand(-0.45, 0.45);
        const c = Math.cos(ang), s = Math.sin(ang), sp = rand(120, 240);
        this.addFood(makeFood(FOOD_DEBRIS, b.x + c * (b.r + 4), b.y + s * (b.r + 4), {
          vx: b.vx * 0.4 + c * sp, vy: b.vy * 0.4 + s * sp, mass: chunk, owner: b, ownerT: 0.9, hue: b.hue,
        }));
      }
      if (Math.random() < 0.8) {
        const a = Math.atan2(-inp.dy, -inp.dx) + rand(-0.3, 0.3);
        this.particle(b.x + Math.cos(a) * b.r * 0.9, b.y + Math.sin(a) * b.r * 0.9,
          Math.cos(a) * rand(60, 160) + b.vx * 0.3, Math.sin(a) * rand(60, 160) + b.vy * 0.3,
          rand(0.35, 0.6), b.r * 0.22 + 3, b.hue, 70, 3);
      }
    }
    b.boosting = boosting;
    const accel = maxS * CONFIG.DRAG * throttle;
    b.vx += (inp.dx * accel + b.ax) * dt;
    b.vy += (inp.dy * accel + b.ay) * dt;
    const damp = Math.exp(-CONFIG.DRAG * (b.inNebula ? CONFIG.NEBULA_DRAG : 1) * dt);
    b.vx *= damp;
    b.vy *= damp;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    const d = Math.hypot(b.x, b.y), lim = this.R - b.r;
    if (d > lim) {
      const nx = b.x / d, ny = b.y / d;
      b.x = nx * lim;
      b.y = ny * lim;
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) {
        b.vx -= vn * nx * 1.5;
        b.vy -= vn * ny * 1.5;
      }
    }
  }

  /* Overlapping bodies: the heavier one absorbs if it is 20% bigger, otherwise they bounce and chip. */
  _contacts() {
    const bs = this.bodies, n = bs.length;
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = bs[j];
        if (!b.alive || !a.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const rs = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rs * rs) continue;
        const d = Math.sqrt(d2) || 0.01;
        let big = a, small = b;
        if (b.mass > a.mass) {
          big = b;
          small = a;
        }
        if (big.canEat(small) && small.shield <= 0) {
          if (d < big.r - small.r * 0.25) this._absorb(big, small);
          continue;
        }
        const nx = dx / d, ny = dy / d;
        const overlap = rs - d, tm = a.mass + b.mass;
        a.x -= nx * overlap * (b.mass / tm);
        a.y -= ny * overlap * (b.mass / tm);
        b.x += nx * overlap * (a.mass / tm);
        b.y += ny * overlap * (a.mass / tm);
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const jImp = (-(1 + 0.6) * rv) / (1 / a.mass + 1 / b.mass);
          a.vx -= (jImp / a.mass) * nx;
          a.vy -= (jImp / a.mass) * ny;
          b.vx += (jImp / b.mass) * nx;
          b.vy += (jImp / b.mass) * ny;
          if (-rv > 110 && a.collCd <= 0 && b.collCd <= 0) {
            const frac = clamp(-rv / 1200, 0.015, 0.05);
            const normal = Math.atan2(ny, nx);
            this._shed(a, a.mass * frac, normal, true);
            this._shed(b, b.mass * frac, normal + Math.PI, true);
            a.collCd = b.collCd = 0.5;
            const cx = a.x + nx * a.r, cy = a.y + ny * a.r;
            this.burst(cx, cy, 14, (a.hue + b.hue) / 2, 220, 4, 0.5, 80);
            this.emit('collide', { a, b, x: cx, y: cy, power: -rv });
          }
        }
      }
    }
  }

  _absorb(big, small) {
    small.alive = false;
    small.killedBy = big;
    big.setMass(big.mass + small.mass);
    big.stats.bodies++;
    big.flash = 1;
    this.fx.ghosts.push({ body: small, target: big, x0: small.x, y0: small.y, t: 0, dur: 0.4 });
    this.burst(small.x, small.y, 22, small.hue, 240, 5, 0.7, 70);
    this.emit('absorb', { eater: big, victim: small, gain: small.mass });
  }

  /*
   * Knock mass off a body as debris. `ang` is the direction the material leaves in;
   * `sideways` sprays it perpendicular to that (used for glancing collisions).
   */
  _shed(b, amount, ang, sideways = false) {
    if (amount <= 0) return;
    b.setMass(b.mass - amount);
    const n = clamp(Math.round(amount / 1.5), 2, 14);
    const each = amount / n;
    for (let i = 0; i < n; i++) {
      let a = ang + rand(-1, 1);
      if (sideways) a = ang + (Math.random() < 0.5 ? -1 : 1) * Math.PI * 0.5 + rand(-0.6, 0.6);
      const c = Math.cos(a), s = Math.sin(a), sp = rand(140, 320);
      this.addFood(makeFood(FOOD_DEBRIS, b.x + c * (b.r + 6), b.y + s * (b.r + 6), {
        vx: b.vx + c * sp, vy: b.vy + s * sp, mass: each, owner: b, ownerT: 0.7, hue: b.hue,
      }));
    }
  }

  _food(dt) {
    const grid = this.grid, food = this.food, tmp = this._tmp;
    grid.clear();
    for (let i = 0; i < food.length; i++) if (food[i].alive) grid.insert(food[i]);

    for (const b of this.bodies) {
      if (!b.alive) continue;
      const surge = b.surgeT > 0;
      const range = b.r * (1 + CONFIG.FOOD_PULL_RANGE * TIERS[b.tier].range * (surge ? CONFIG.SURGE_RANGE : 1)) + 40;
      const pull = CONFIG.FOOD_PULL_ACCEL * (surge ? 1.6 : 1);
      const span = range - b.r;
      tmp.length = 0;
      grid.queryInto(b.x, b.y, range, tmp);
      for (let i = 0; i < tmp.length; i++) {
        const f = tmp[i];
        if (!f.alive) continue;
        if (f.ownerT > 0 && f.owner === b) continue;
        if (b.mass < f.mass * CONFIG.EAT_RATIO) continue;
        const dx = b.x - f.x, dy = b.y - f.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > range * range) continue;
        const d = Math.sqrt(d2) || 0.01;
        if (d < b.r + f.r * 0.3) {
          this._eat(b, f);
          continue;
        }
        const t = clamp(1 - (d - b.r) / span, 0, 1);
        const acc = ((220 + pull * t * t) * dt) / d;
        f.vx += dx * acc;
        f.vy += dy * acc;
        f.pulled = true;
      }
    }

    const counts = this.counts;
    counts.dust = counts.rock = counts.comet = counts.debris = 0;
    this.comets.length = 0;
    const R = this.R;
    let w = 0;
    for (let i = 0; i < food.length; i++) {
      const f = food[i];
      if (!f.alive) continue;
      f.age += dt;
      if (f.ownerT > 0) f.ownerT -= dt;
      if (f.type === FOOD_COMET) {
        this._cometGravity(f, dt);
        if (f.age > 80 || f.x * f.x + f.y * f.y > (R + 500) * (R + 500)) {
          f.alive = false;
          continue;
        }
        if (Math.random() < 0.7) {
          this.particle(f.x, f.y, -f.vx * 0.15 + rand(-20, 20), -f.vy * 0.15 + rand(-20, 20), rand(0.6, 1.1), f.r * 0.7, f.hue, 82, 1);
        }
      } else {
        if (f.type === FOOD_DEBRIS && f.age > 60) {
          f.alive = false;
          continue;
        }
        const sp2 = f.vx * f.vx + f.vy * f.vy;
        if (f.pulled || sp2 > 144) {
          const damp = Math.exp(-f.drag * dt * (f.pulled ? 1.4 : 1));
          f.vx *= damp;
          f.vy *= damp;
        }
      }
      f.pulled = false;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.rotSpeed * dt;
      if (f.type !== FOOD_COMET) {
        const d2 = f.x * f.x + f.y * f.y, lim = R - f.r;
        if (d2 > lim * lim) {
          const d = Math.sqrt(d2), nx = f.x / d, ny = f.y / d;
          f.x = nx * lim;
          f.y = ny * lim;
          const vn = f.vx * nx + f.vy * ny;
          if (vn > 0) {
            f.vx -= 2 * vn * nx;
            f.vy -= 2 * vn * ny;
          }
        }
      }
      switch (f.type) {
        case FOOD_DUST: counts.dust++; break;
        case FOOD_ROCK: counts.rock++; break;
        case FOOD_COMET: counts.comet++; this.comets.push(f); break;
        case FOOD_DEBRIS: counts.debris++; break;
      }
      food[w++] = f;
    }
    food.length = w;
  }

  _eat(b, f) {
    f.alive = false;
    b.setMass(b.mass + f.mass);
    if (f.type === FOOD_COMET || f.type === FOOD_REMNANT) {
      b.stats.comets++;
      this.burst(f.x, f.y, 26, f.hue, 260, 6, 0.8, 80);
      this.emit('eatBig', { body: b, food: f });
    } else {
      b.stats.dust += f.mass;
      if (f.type === FOOD_ROCK) this.burst(f.x, f.y, 5, 30, 90, 3, 0.4, 60);
      if (b.isPlayer) this.emit('eat', { body: b, food: f });
    }
  }

  _cometGravity(f, dt) {
    for (const b of this.bodies) {
      if (!b.alive || b.mass < f.mass) continue;
      const dx = b.x - f.x, dy = b.y - f.y;
      const d2 = dx * dx + dy * dy;
      const range = b.gravRange();
      if (d2 > range * range) continue;
      const d = Math.sqrt(d2) || 1;
      const dEff = Math.max(d, b.r);
      const g = (CONFIG.G * 0.5 * b.gravMul() * b.mass) / (dEff * dEff);
      f.vx += (dx / d) * g * dt;
      f.vy += (dy / d) * g * dt;
    }
  }

  _wormholes() {
    for (const w of this.wormholes) w.spin += CONFIG.STEP * 1.4;
    for (const b of this.bodies) {
      if (!b.alive || b.wormCd > 0 || b.mass > CONFIG.WORMHOLE_MAX_MASS) continue;
      for (const w of this.wormholes) {
        const dx = b.x - w.x, dy = b.y - w.y;
        if (dx * dx + dy * dy < w.r * w.r * 0.36) {
          this._teleport(b, w);
          break;
        }
      }
    }
  }

  _teleport(b, w) {
    const out = w.partner;
    let sp = Math.hypot(b.vx, b.vy);
    let nx, ny;
    if (sp > 1) {
      nx = b.vx / sp;
      ny = b.vy / sp;
    } else {
      const a = rand(0, TAU);
      nx = Math.cos(a);
      ny = Math.sin(a);
    }
    this.burst(b.x, b.y, 18, w.hue, 260, 4, 0.6, 75);
    b.x = out.x + nx * (out.r * 0.9 + b.r);
    b.y = out.y + ny * (out.r * 0.9 + b.r);
    sp = Math.max(sp * 1.2, maxSpeedFor(b.mass) * 1.3);
    b.vx = nx * sp;
    b.vy = ny * sp;
    b.wormCd = 2.5;
    this.burst(b.x, b.y, 18, out.hue, 260, 4, 0.6, 75);
    this.emit('wormhole', { body: b, from: w, to: out });
  }

  _worldEvents(dt) {
    this.nextComet -= dt;
    if (this.nextComet <= 0) {
      this.nextComet = rand(CONFIG.COMET_INTERVAL[0], CONFIG.COMET_INTERVAL[1]);
      if (this.counts.comet < CONFIG.COMET_MAX) this._spawnComet();
    }

    this.nextSupernova -= dt;
    if (this.nextSupernova <= 0) {
      this.nextSupernova = rand(CONFIG.SUPERNOVA_INTERVAL[0], CONFIG.SUPERNOVA_INTERVAL[1]);
      this._startSupernova();
    }
    for (const sn of this.supernovae) {
      sn.t -= dt;
      if (sn.t <= 0 && !sn.done) {
        sn.done = true;
        this._explode(sn);
      }
    }
    if (this.supernovae.length && this.supernovae.some((s) => s.done)) {
      this.supernovae = this.supernovae.filter((s) => !s.done);
    }
  }

  _spawnComet() {
    const a = rand(0, TAU);
    const sx = Math.cos(a) * (this.R + 300), sy = Math.sin(a) * (this.R + 300);
    const t = randomInDisk(this.R * 0.5);
    const dx = t.x - sx, dy = t.y - sy, d = Math.hypot(dx, dy);
    const sp = rand(240, 320);
    const f = makeFood(FOOD_COMET, sx, sy, { vx: (dx / d) * sp, vy: (dy / d) * sp, hue: pick([188, 172, 205]) });
    this.addFood(f);
    this.emit('comet', { food: f });
  }

  _startSupernova() {
    let p = null;
    for (let i = 0; i < 25 && !p; i++) {
      const c = randomInDisk(this.R * 0.8);
      const pl = this.player;
      if (pl && pl.alive && Math.hypot(c.x - pl.x, c.y - pl.y) < 450 + pl.r) continue;
      p = c;
    }
    if (!p) p = randomInDisk(this.R * 0.8);
    const sn = { x: p.x, y: p.y, t: CONFIG.SUPERNOVA_WARNING, dur: CONFIG.SUPERNOVA_WARNING, hue: pick([205, 28, 330, 48]), done: false };
    this.supernovae.push(sn);
    this.emit('supernovaWarning', { sn });
  }

  _explode(sn) {
    this.fx.shockwaves.push({ x: sn.x, y: sn.y, r: 0, prev: 0, max: CONFIG.SUPERNOVA_BLAST, speed: 1150, hue: sn.hue, hit: new Set() });
    for (const b of this.bodies) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - sn.x, b.y - sn.y);
      if (d < CONFIG.SUPERNOVA_CORE + b.r) {
        const loss = b.mass * 0.18;
        this._shed(b, loss, Math.atan2(b.y - sn.y, b.x - sn.x));
        b.flash = 1;
        this.emit('supernovaHit', { body: b, loss });
      }
    }
    for (let i = 0; i < 120; i++) {
      const a = rand(0, TAU), sp = rand(200, 820), off = rand(0, 40);
      this.addFood(makeFood(FOOD_DEBRIS, sn.x + Math.cos(a) * off, sn.y + Math.sin(a) * off, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, mass: rand(1.2, 3.4), hue: sn.hue + rand(-25, 25),
      }));
    }
    this.addFood(makeFood(FOOD_REMNANT, sn.x, sn.y, { hue: sn.hue }));
    this.burst(sn.x, sn.y, 140, sn.hue, 900, 9, 1.4, 78);
    this.emit('supernova', { x: sn.x, y: sn.y, sn });
  }

  _shockwaves(dt) {
    const list = this.fx.shockwaves;
    if (!list.length) return;
    const tmp = this._tmp;
    for (const sw of list) {
      sw.prev = sw.r;
      sw.r += sw.speed * dt;
      if (sw.r >= sw.max) {
        sw.dead = true;
        continue;
      }
      const k = 1 - sw.r / sw.max;
      for (const b of this.bodies) {
        if (!b.alive || sw.hit.has(b.id)) continue;
        const dx = b.x - sw.x, dy = b.y - sw.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d - b.r <= sw.r) {
          sw.hit.add(b.id);
          const push = 750 * k * k * clamp(Math.pow(20 / b.mass, 0.3), 0.2, 1.3);
          b.vx += (dx / d) * push;
          b.vy += (dy / d) * push;
          this.emit('shock', { body: b, power: k });
        }
      }
      tmp.length = 0;
      this.grid.queryInto(sw.x, sw.y, sw.r, tmp);
      const push = 420 * k;
      for (let i = 0; i < tmp.length; i++) {
        const f = tmp[i];
        if (!f.alive || f.type === FOOD_COMET) continue;
        const dx = f.x - sw.x, dy = f.y - sw.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d > sw.prev && d <= sw.r) {
          f.vx += (dx / d) * push;
          f.vy += (dy / d) * push;
        }
      }
    }
    this.fx.shockwaves = list.filter((s) => !s.dead);
  }

  _checkTier(b) {
    let t = b.tier;
    while (t + 1 < TIERS.length && b.mass >= TIERS[t + 1].min) t++;
    while (t > 0 && b.mass < TIERS[t].min * 0.93) t--;
    if (t !== b.tier) {
      const from = b.tier;
      b.tier = t;
      if (t > b.stats.peakTier) b.stats.peakTier = t;
      this.emit('tier', { body: b, from, to: t });
    }
  }

  /* ---------- visual effects (simulated here so they share world time) ---------- */

  particle(x, y, vx, vy, life, size, hue, light = 65, drag = 2) {
    const ps = this.fx.particles;
    if (ps.length > 900) return;
    ps.push({ x, y, vx, vy, life, max: life, size, hue, light, drag });
  }

  burst(x, y, n, hue, speed, size, life, light = 70) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(0.2, 1) * speed;
      this.particle(x, y, Math.cos(a) * s, Math.sin(a) * s, life * rand(0.6, 1.2), size * rand(0.5, 1.2), hue + rand(-15, 15), light, 2.2);
    }
  }

  floatText(x, y, text, color, size = 16) {
    if (this.fx.texts.length > 30) this.fx.texts.shift();
    this.fx.texts.push({ x, y, text, color, size, life: 1.3, max: 1.3, rise: 0 });
  }

  _updateFx(dt) {
    const ps = this.fx.particles;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ps[w++] = p;
    }
    ps.length = w;

    const gs = this.fx.ghosts;
    w = 0;
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i];
      g.t += dt;
      if (g.t < g.dur) gs[w++] = g;
    }
    gs.length = w;

    const ts = this.fx.texts;
    w = 0;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      t.life -= dt;
      t.rise += 38 * dt;
      if (t.life > 0) ts[w++] = t;
    }
    ts.length = w;
  }
}
