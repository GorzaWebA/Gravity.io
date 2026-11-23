'use strict';

/*
 * Bot brain: re-evaluates every ~0.1–0.3 s (its "reaction time") and in between keeps steering
 * at its current target. Priorities: escape anything that can eat it > hunt smaller bodies > forage.
 */
class BotBrain {
  constructor(body) {
    this.body = body;
    this.aggr = rand(0.45, 1.0);
    this.caution = rand(0.75, 1.3);
    this.reaction = rand(0.1, 0.28);
    this.timer = rand(0, 0.3);
    this.wander = rand(0, TAU);
    this.state = 'forage';
    this.target = null;
    this.tx = body.x;
    this.ty = body.y;
    this.boost = false;
    this.wantSurge = false;
    this.ignore = new Map();
    this.huntStart = 0;
    this.huntBest = Infinity;
    this._tmp = [];
  }

  _ignored(o, now) {
    const until = this.ignore.get(o.id);
    if (until === undefined) return false;
    if (until < now) {
      this.ignore.delete(o.id);
      return false;
    }
    return true;
  }

  think(world, dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.reaction * rand(0.8, 1.25);
      this._decide(world);
    }
    this._steer();
  }

  _decide(world) {
    const b = this.body;
    let fx = 0, fy = 0, danger = 0;
    let prey = null, preyScore = 0;
    const sense = 650 + b.r * 4;

    for (const o of world.bodies) {
      if (o === b || !o.alive) continue;
      const dx = o.x - b.x, dy = o.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const hidden = o.inNebula && d > 300 + o.r + b.r;
      if (o.mass >= b.mass * 1.12) {
        const reach = o.gravRange() * 1.1 + b.r + 140 * this.caution + (o.surgeCd <= 0 ? o.r : 0);
        if (d < reach && !(hidden && d > o.r * 2.5)) {
          const closeness = clamp(1 - (d - o.r) / Math.max(1, reach - o.r), 0, 1);
          const w = closeness * (o.canEat(b) ? 1 : 0.3);
          fx -= (dx / d) * w;
          fy -= (dy / d) * w;
          danger = Math.max(danger, w);
        }
      } else if (b.canEat(o) && o.shield <= 0 && !hidden && d < sense && !this._ignored(o, world.time)) {
        // Only chase what gravity can help us catch, or what is worth a long chase
        const reachable = d < b.gravRange() * 1.5 + 150 || o.mass > b.mass * 0.4;
        if (!reachable || o.mass < b.mass * 0.03) continue;
        const s = (o.mass / (d + 200)) * this.aggr;
        if (s > preyScore) {
          preyScore = s;
          prey = o;
        }
      }
    }

    // Stay off the edge of the system
    const dc = Math.hypot(b.x, b.y);
    const edge = world.R * 0.82;
    if (dc > edge) {
      const w = ((dc - edge) / (world.R - edge)) * 1.2;
      fx -= (b.x / dc) * w;
      fy -= (b.y / dc) * w;
    }

    // Get away from stars about to blow
    for (const sn of world.supernovae) {
      const dx = sn.x - b.x, dy = sn.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < CONFIG.SUPERNOVA_CORE + b.r + 450) {
        fx -= (dx / d) * 1.5;
        fy -= (dy / d) * 1.5;
        danger = Math.max(danger, 0.6);
      }
    }

    this.boost = false;
    this.wantSurge = false;

    if (danger > 0.12 / this.caution) {
      this.state = 'flee';
      this.target = null;
      let len = Math.hypot(fx, fy) || 1;
      let dirX = fx / len, dirY = fy / len;
      // A wormhole roughly in the escape direction is a great way out
      if (b.mass <= CONFIG.WORMHOLE_MAX_MASS && b.wormCd <= 0) {
        for (const w of world.wormholes) {
          const wx = w.x - b.x, wy = w.y - b.y;
          const wd = Math.hypot(wx, wy) || 1;
          if (wd < 520 && (wx / wd) * dirX + (wy / wd) * dirY > 0.2) {
            dirX = wx / wd;
            dirY = wy / wd;
            len = wd;
            break;
          }
        }
      }
      this.tx = b.x + dirX * 400;
      this.ty = b.y + dirY * 400;
      this.boost = danger > 0.5 && b.mass > CONFIG.BOOST_MIN_MASS + 4 && Math.random() < 0.85;
      return;
    }

    if (prey) {
      const d = Math.hypot(prey.x - b.x, prey.y - b.y);
      if (this.state !== 'hunt' || this.target !== prey) {
        this.huntStart = world.time;
        this.huntBest = d;
      }
      // Give up on prey that keeps its distance
      if (d < this.huntBest - 40) {
        this.huntBest = d;
        this.huntStart = world.time;
      } else if (world.time - this.huntStart > 5) {
        this.ignore.set(prey.id, world.time + 8);
      }
      this.state = 'hunt';
      this.target = prey;
      this.boost = d < b.r * 2.2 + prey.r + 60 && b.mass > 30 && Math.random() < this.aggr * 0.6;
      this.wantSurge = b.surgeCd <= 0 && d < b.gravRange() * 1.3 && d > b.r && prey.mass > b.mass * 0.12 && Math.random() < this.aggr;
      return;
    }

    this.state = 'forage';
    const t = this.target;
    const stale = !t || !t.alive || t.kind !== 'food' || Math.hypot(t.x - b.x, t.y - b.y) > 700 + b.r;
    if (stale || Math.random() < 0.15) this.target = this._findFood(world);
    if (!this.target) {
      this.wander += rand(-0.7, 0.7);
      if (dc > world.R * 0.6) this.wander = Math.atan2(-b.y, -b.x) + rand(-0.8, 0.8);
      this.tx = b.x + Math.cos(this.wander) * 400;
      this.ty = b.y + Math.sin(this.wander) * 400;
    }
  }

  _findFood(world) {
    const b = this.body;
    let best = null, bestS = 0;

    for (const c of world.comets) {
      if (b.mass < c.mass * CONFIG.EAT_RATIO) continue;
      const d = Math.hypot(c.x - b.x, c.y - b.y);
      if (d < 1100) {
        const s = (c.mass * 3) / (d + 40);
        if (s > bestS) {
          bestS = s;
          best = c;
        }
      }
    }

    const tmp = this._tmp;
    tmp.length = 0;
    world.grid.queryInto(b.x, b.y, 380 + b.r * 2, tmp);
    for (let i = 0; i < tmp.length; i++) {
      const f = tmp[i];
      if (!f.alive || b.mass < f.mass * CONFIG.EAT_RATIO) continue;
      if (f.owner === b && f.ownerT > 0) continue;
      const d = Math.hypot(f.x - b.x, f.y - b.y);
      let s = (f.mass + 0.5) / (d + 40);
      if (f.type === FOOD_REMNANT) s *= 3;
      s *= rand(0.85, 1.15);
      if (s > bestS) {
        bestS = s;
        best = f;
      }
    }
    return best;
  }

  _steer() {
    const b = this.body;
    let tx = this.tx, ty = this.ty;
    const t = this.target;
    if (t && t.alive) {
      if (this.state === 'hunt') {
        const d = Math.hypot(t.x - b.x, t.y - b.y);
        const lead = clamp(d / (b.maxSpeed() + 1), 0, 1) * 0.6;
        tx = t.x + t.vx * lead;
        ty = t.y + t.vy * lead;
      } else {
        tx = t.x;
        ty = t.y;
      }
    } else if (t) {
      this.target = null;
      this.timer = 0;
    }
    const dx = tx - b.x, dy = ty - b.y;
    const d = Math.hypot(dx, dy);
    if (d > 3) {
      b.input.dx = dx / d;
      b.input.dy = dy / d;
      b.input.throttle = 1;
    } else {
      b.input.throttle = 0;
    }
    b.input.boost = this.boost;
    if (this.wantSurge) {
      b.input.surge = true;
      this.wantSurge = false;
    }
  }
}
