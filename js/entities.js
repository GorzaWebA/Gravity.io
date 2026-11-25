'use strict';

let NEXT_ENTITY_ID = 1;

/* A celestial body steered by the player or a bot. */
class Body {
  constructor({ name, mass, x, y, hue, isPlayer = false }) {
    this.id = NEXT_ENTITY_ID++;
    this.kind = 'body';
    this.name = name;
    this.isPlayer = isPlayer;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.ax = 0;
    this.ay = 0;
    this.hue = hue;
    this.variant = randInt(0, 3);
    this.mass = mass;
    this.r = massToRadius(mass);
    this.drawR = this.r;
    this.tier = tierIndexForMass(mass);
    this.alive = true;

    // Look
    this.spin = Math.random();
    this.spinSpeed = rand(0.012, 0.03);
    this.tilt = rand(-0.35, 0.35);
    this.hasRings = Math.random() < 0.6;
    this.shape = makeRockShape(13, 0.22);

    // Control + abilities
    this.input = { dx: 0, dy: 0, throttle: 0, boost: false, surge: false };
    this.boosting = false;
    this.boostAcc = 0;
    this.surgeT = 0;
    this.surgeCd = 0;
    this.shield = CONFIG.SPAWN_SHIELD;

    // Bookkeeping
    this.collCd = 0;
    this.wormCd = 0;
    this.inNebula = false;
    this.danger = 0;           // how hard the strongest predator is pulling us (1 = can't out-thrust it)
    this.flash = 0;
    this.rank = 0;
    this.killedBy = null;
    this.brain = null;
    this.stats = { born: 0, bodies: 0, dust: 0, comets: 0, peakMass: mass, peakTier: this.tier, bestRank: 999 };
  }

  setMass(m) {
    this.mass = Math.max(CONFIG.MIN_MASS, m);
    this.r = massToRadius(this.mass);
    if (this.mass > this.stats.peakMass) this.stats.peakMass = this.mass;
  }

  maxSpeed() {
    return maxSpeedFor(this.mass);
  }

  gravRange() {
    const base = Math.min(this.r * CONFIG.GRAV_RANGE * TIERS[this.tier].range, CONFIG.GRAV_RANGE_MAX);
    return base * (this.surgeT > 0 ? CONFIG.SURGE_RANGE : 1);
  }

  gravMul() {
    return TIERS[this.tier].grav * (this.surgeT > 0 ? CONFIG.SURGE_STRENGTH : 1);
  }

  canEat(other) {
    return this.mass >= other.mass * CONFIG.EAT_RATIO;
  }
}

/* Everything that can be absorbed but does not steer: dust, rocks, comets, debris, stellar remnants. */
function makeFood(type, x, y, opts = {}) {
  const f = {
    kind: 'food',
    type,
    x,
    y,
    vx: opts.vx || 0,
    vy: opts.vy || 0,
    alive: true,
    owner: opts.owner || null,
    ownerT: opts.ownerT || 0,
    rot: Math.random() * TAU,
    rotSpeed: rand(-1, 1),
    age: 0,
    pulled: false,
    hue: opts.hue === undefined ? 30 : opts.hue,
  };
  switch (type) {
    case FOOD_DUST:
      f.mass = 1;
      f.r = rand(2.6, 3.8);
      f.color = Math.random() < 0.74 ? 0 : Math.random() < 0.6 ? 1 : 2;
      f.drag = 2.5;
      f.vx = rand(-6, 6);
      f.vy = rand(-6, 6);
      break;
    case FOOD_ROCK:
      f.mass = rand(4, 8);
      f.r = massToRadius(f.mass) * 0.85;
      f.sprite = randInt(0, 15);
      f.drag = 1.2;
      f.rotSpeed = rand(-0.6, 0.6);
      break;
    case FOOD_COMET:
      f.mass = rand(18, 30);
      f.r = massToRadius(f.mass) * 0.55;
      f.drag = 0;
      break;
    case FOOD_DEBRIS:
      f.mass = opts.mass || rand(0.6, 1.4);
      f.r = 2.4 + f.mass * 0.9;
      f.drag = 1.6;
      break;
    case FOOD_REMNANT:
      f.mass = 45;
      f.r = 15;
      f.drag = 2;
      f.rotSpeed = 2.4;
      break;
  }
  return f;
}

/*
 * Uniform grid for fast "what food is near me" queries, rebuilt every step.
 * Built as a counting sort into flat arrays: cells along a row are contiguous in `items`,
 * so a query reads one slice per row instead of visiting thousands of little arrays.
 */
class FoodGrid {
  constructor(worldRadius, cell) {
    this.R = worldRadius + 600;
    this.cell = cell;
    this.n = Math.ceil((this.R * 2) / cell);
    this.start = new Int32Array(this.n * this.n + 1);
    this.cursor = new Int32Array(this.n * this.n + 1);
    this.cellOf = new Int32Array(4096);
    this.items = [];
  }

  _c(v) {
    const c = Math.floor((v + this.R) / this.cell);
    return c < 0 ? 0 : c >= this.n ? this.n - 1 : c;
  }

  build(food) {
    const len = food.length, start = this.start, cells = this.n * this.n;
    if (this.cellOf.length < len) this.cellOf = new Int32Array(len * 2);
    const cellOf = this.cellOf;
    start.fill(0);
    let live = 0;
    for (let i = 0; i < len; i++) {
      const f = food[i];
      if (!f.alive) {
        cellOf[i] = -1;
        continue;
      }
      const c = this._c(f.y) * this.n + this._c(f.x);
      cellOf[i] = c;
      start[c + 1]++;
      live++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const items = this.items, cursor = this.cursor;
    items.length = live;
    cursor.set(start);
    for (let i = 0; i < len; i++) {
      const c = cellOf[i];
      if (c >= 0) items[cursor[c]++] = food[i];
    }
  }

  queryInto(x, y, radius, out) {
    const x0 = this._c(x - radius), x1 = this._c(x + radius);
    const y0 = this._c(y - radius), y1 = this._c(y + radius);
    const start = this.start, items = this.items;
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.n;
      for (let i = start[row + x0], end = start[row + x1 + 1]; i < end; i++) out.push(items[i]);
    }
    return out;
  }
}
