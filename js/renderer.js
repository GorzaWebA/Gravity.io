'use strict';

/*
 * Canvas rendering in the toy-solar-system style described in textures.js.
 * World layers: void + stars, nebulae (soft), spacetime grid, wormholes, food, bodies, effects.
 * Screen layers: labels, floating numbers, off-screen markers. Vignettes are CSS overlays.
 */
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.maxDpr = 2;
    this.dpr = 1;
    this.w = 1;
    this.h = 1;
    this.tex = new TextureBank();
    this.starLayers = [this._makeStars(1100, 220, 0.03, 0.9), this._makeStars(800, 90, 0.08, 1.4)];
    this.starDot = this.tex._makeDot('#ffffff');
    this.nebulaSprites = new Map();
    this._warpSrc = [];
    this._sorted = [];
    this._dangerShown = -1;
    this.dangerEl = document.getElementById('danger');
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  render(world, cam, opts) {
    const ctx = this.ctx, dpr = this.dpr, w = this.w, h = this.h, z = cam.zoom, t = opts.time;
    const focus = opts.focus;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(0, 0, w, h);
    this._drawStars(cam);

    const ox = w / 2 - cam.x * z + cam.sx, oy = h / 2 - cam.y * z + cam.sy;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    const pad = 60 / z;
    const view = { l: cam.x - w / 2 / z - pad, r: cam.x + w / 2 / z + pad, t: cam.y - h / 2 / z - pad, b: cam.y + h / 2 / z + pad };

    this._drawNebulae(world, view);
    this._drawGrid(world, view, z);
    this._drawBoundary(world, view, z);
    this._drawWormholes(world, view, z, t, focus);
    this._drawFood(world, view, z, t);
    this._drawSupernovae(world, z, t);
    this._drawGhosts(world, t);
    this._drawBodies(world, view, z, t, focus);
    this._drawParticles(world, view, z);
    this._drawShockwaves(world, z);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toScreen = (x, y) => ({ x: (x - cam.x) * z + w / 2 + cam.sx, y: (y - cam.y) * z + h / 2 + cam.sy });
    if (opts.labels !== false) {
      this._drawLabels(world, z, focus, toScreen);
      this._drawTexts(world, toScreen);
    }
    this._drawIndicators(world, toScreen, t, z);
    this._drawDanger(opts.danger || 0, t);
    if (opts.flash > 0) {
      ctx.fillStyle = `rgba(241,234,217,${Math.min(0.8, opts.flash)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /* Text with the UI's hard drop shadow (down-right, away from the light). */
  _shadowText(text, x, y, color, off = 2) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(9,11,24,0.9)';
    ctx.fillText(text, x + off * 0.6, y + off);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /* ---------- background ---------- */

  _makeStars(size, count, parallax, maxSize) {
    const stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({ x: Math.random() * size, y: Math.random() * size, s: 0.8 + maxSize * Math.pow(Math.random(), 3), a: rand(0.25, 0.75) });
    }
    return { size, stars, parallax };
  }

  _drawStars(cam) {
    const ctx = this.ctx, w = this.w, h = this.h;
    for (const layer of this.starLayers) {
      const S = layer.size;
      let ox = (-cam.x * layer.parallax) % S, oy = (-cam.y * layer.parallax) % S;
      if (ox > 0) ox -= S;
      if (oy > 0) oy -= S;
      for (let tx = ox; tx < w; tx += S) {
        for (let ty = oy; ty < h; ty += S) {
          for (const st of layer.stars) {
            const x = tx + st.x, y = ty + st.y;
            if (x < -4 || x > w + 4 || y < -4 || y > h + 4) continue;
            ctx.globalAlpha = st.a;
            ctx.drawImage(this.starDot, x - st.s / 2, y - st.s / 2, st.s, st.s);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  _nebulaSprite(n) {
    let c = this.nebulaSprites.get(n.id);
    if (c) return c;
    const S = 512;
    c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const R = mulberry32(n.seed);
    for (let i = 0; i < 9; i++) {
      const a = R() * TAU, d = R() * S * 0.22;
      const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
      const r = S * (0.18 + R() * 0.16);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const hue = n.hue + (R() - 0.5) * 30;
      grd.addColorStop(0, hsl(hue, 45, 46, 0.16));
      grd.addColorStop(0.6, hsl(hue, 45, 40, 0.07));
      grd.addColorStop(1, hsl(hue, 45, 36, 0));
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    this.nebulaSprites.set(n.id, c);
    return c;
  }

  _drawNebulae(world, view) {
    const ctx = this.ctx;
    for (const n of world.nebulae) {
      const s = n.r * 1.35;
      if (n.x + s < view.l || n.x - s > view.r || n.y + s < view.t || n.y - s > view.b) continue;
      ctx.drawImage(this._nebulaSprite(n), n.x - s, n.y - s, s * 2, s * 2);
    }
  }

  /* The signature effect: a spacetime grid that sags toward everything with mass. */
  _drawGrid(world, view, z) {
    const ctx = this.ctx, src = this._warpSrc;
    src.length = 0;
    for (const b of world.bodies) {
      const reach = b.drawR * 7;
      if (b.x + reach < view.l || b.x - reach > view.r || b.y + reach < view.t || b.y - reach > view.b) continue;
      const A = Math.min(0.8, 0.42 * TIERS[b.tier].grav * (b.surgeT > 0 ? 1.5 : 1));
      src.push({ x: b.x, y: b.y, R2: (b.drawR * 1.5) ** 2, A, cut2: reach * reach });
    }
    for (const w of world.wormholes) src.push({ x: w.x, y: w.y, R2: (w.r * 1.8) ** 2, A: 0.62, cut2: (w.r * 8) ** 2 });
    for (const sn of world.supernovae) {
      const k = 1 - sn.t / sn.dur;
      src.push({ x: sn.x, y: sn.y, R2: (100 + 220 * k) ** 2, A: 0.25 + 0.5 * k, cut2: 1000 * 1000 });
    }

    let S = 100;
    while (S * z < 46) S *= 2;
    const step = Math.max(S / 6, 9 / z);
    const n = src.length;
    const warp = (x, y, first) => {
      let dx = 0, dy = 0;
      for (let i = 0; i < n; i++) {
        const s = src[i];
        const ex = s.x - x, ey = s.y - y;
        const d2 = ex * ex + ey * ey;
        if (d2 > s.cut2) continue;
        const f = (s.A * s.R2) / (d2 + s.R2);
        dx += ex * f;
        dy += ey * f;
      }
      if (first) ctx.moveTo(x + dx, y + dy);
      else ctx.lineTo(x + dx, y + dy);
    };

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, world.R, 0, TAU);
    ctx.clip();
    ctx.beginPath();
    const x0 = Math.floor(view.l / S) * S, y0 = Math.floor(view.t / S) * S;
    for (let x = x0; x <= view.r; x += S) {
      if (n === 0) {
        ctx.moveTo(x, view.t);
        ctx.lineTo(x, view.b);
        continue;
      }
      let first = true;
      for (let y = view.t; y <= view.b + step; y += step) {
        warp(x, y, first);
        first = false;
      }
    }
    for (let y = y0; y <= view.b; y += S) {
      if (n === 0) {
        ctx.moveTo(view.l, y);
        ctx.lineTo(view.r, y);
        continue;
      }
      let first = true;
      for (let x = view.l; x <= view.r + step; x += step) {
        warp(x, y, first);
        first = false;
      }
    }
    ctx.strokeStyle = COLORS.fabric;
    ctx.lineWidth = 1.2 / z;
    ctx.stroke();
    ctx.restore();
  }

  _drawBoundary(world, view, z) {
    const ctx = this.ctx, R = world.R;
    const cx = (view.l + view.r) / 2, cy = (view.t + view.b) / 2;
    const half = Math.hypot(view.r - view.l, view.b - view.t) / 2;
    if (Math.hypot(cx, cy) + half < R) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.l, view.t, view.r - view.l, view.b - view.t);
    ctx.arc(0, 0, R, 0, TAU, true);
    ctx.fillStyle = 'rgba(4,5,12,0.7)';
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.strokeStyle = 'rgba(255,84,104,0.55)';
    ctx.lineWidth = 3 / z;
    ctx.setLineDash([2 / z, 12 / z]);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  /* Wormholes: concentric rings drawn in the grid's line language, slowly turning. */
  _drawWormholes(world, view, z, t, focus) {
    const ctx = this.ctx;
    for (const wh of world.wormholes) {
      const s = wh.r * 2;
      if (wh.x + s < view.l || wh.x - s > view.r || wh.y + s < view.t || wh.y - s > view.b) continue;
      const sealed = focus && focus.mass > CONFIG.WORMHOLE_MAX_MASS;
      ctx.save();
      ctx.translate(wh.x, wh.y);
      ctx.globalAlpha = sealed ? 0.35 : 1;
      for (let k = 0; k < 6; k++) {
        const rad = wh.r * (1.5 - k * 0.2);
        ctx.strokeStyle = tone(wh.hue, 1, k % 2 ? 'light' : 'base', 0.35 + k * 0.11);
        ctx.lineWidth = wh.r * 0.07;
        ctx.beginPath();
        ctx.ellipse(0, 0, rad, rad * 0.9, wh.spin * (0.4 + k * 0.25) * (k % 2 ? -1 : 1), 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(0, 0, wh.r * 0.42, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ---------- food ---------- */

  _drawFood(world, view, z, t) {
    const ctx = this.ctx, food = world.food, minS = 2.4 / z;
    for (let i = 0; i < food.length; i++) {
      const f = food[i];
      if (f.x < view.l || f.x > view.r || f.y < view.t || f.y > view.b) continue;
      if (f.type === FOOD_DUST) {
        const s = Math.max(f.r * 2.2, minS);
        ctx.drawImage(this.tex.dust[f.color], f.x - s / 2, f.y - s / 2, s, s);
      } else if (f.type === FOOD_DEBRIS) {
        const s = Math.max(f.r * 2, minS);
        ctx.drawImage(this.tex.dot(f.hue, 72), f.x - s / 2, f.y - s / 2, s, s);
      }
    }
    for (let i = 0; i < food.length; i++) {
      const f = food[i];
      if (f.type === FOOD_DUST || f.type === FOOD_DEBRIS) continue;
      const m = f.type === FOOD_COMET ? 400 : 40;
      if (f.x < view.l - m || f.x > view.r + m || f.y < view.t - m || f.y > view.b + m) continue;
      if (f.type === FOOD_ROCK) {
        const s = f.r * 1.15;
        ctx.drawImage(this.tex.rocks[f.sprite], f.x - s, f.y - s, s * 2, s * 2);
      } else if (f.type === FOOD_COMET) {
        this._drawComet(f);
      } else if (f.type === FOOD_REMNANT) {
        this._drawRemnant(f, t);
      }
    }
  }

  _drawComet(f) {
    const ctx = this.ctx;
    const sp = Math.hypot(f.vx, f.vy) || 1;
    const nx = f.vx / sp, ny = f.vy / sp;
    const L = 150 + f.mass * 7;
    const tail = (len, wd, color) => {
      const tx = f.x - nx * len, ty = f.y - ny * len;
      const grd = ctx.createLinearGradient(f.x, f.y, tx, ty);
      grd.addColorStop(0, color(1));
      grd.addColorStop(1, color(0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(f.x - ny * wd, f.y + nx * wd);
      ctx.lineTo(tx, ty);
      ctx.lineTo(f.x + ny * wd, f.y - nx * wd);
      ctx.closePath();
      ctx.fill();
    };
    tail(L, f.r * 1.3, (a) => tone(f.hue, 1, 'light', a * 0.35));
    tail(L * 0.55, f.r * 0.7, (a) => `rgba(241,234,217,${a * 0.75})`);
    steppedHalo(ctx, f.x, f.y, f.r * 0.8, tone(f.hue, 1, 'light'));
    ctx.fillStyle = COLORS.bone;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r * 0.6, 0, TAU);
    ctx.fill();
  }

  _drawRemnant(f, t) {
    const ctx = this.ctx;
    const pulse = 0.8 + 0.2 * Math.sin(t * 9 + f.rot);
    steppedHalo(ctx, f.x, f.y, f.r * 1.4 * pulse, tone(f.hue, 1, 'light'), 1.4);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    ctx.fillStyle = 'rgba(241,234,217,0.55)';
    for (const dir of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(-3.5, 0);
      ctx.lineTo(0, 120 * dir);
      ctx.lineTo(3.5, 0);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = COLORS.bone;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r * 0.5, 0, TAU);
    ctx.fill();
  }

  /* ---------- bodies ---------- */

  _drawGhosts(world, t) {
    const ctx = this.ctx;
    for (const g of world.fx.ghosts) {
      const p = g.t / g.dur, e = p * p;
      const r = g.body.drawR * (1 - p);
      if (r < 0.5) continue;
      ctx.globalAlpha = 1 - p * 0.4;
      this.drawBody(ctx, g.body, lerp(g.x0, g.target.x, e), lerp(g.y0, g.target.y, e), r, t);
    }
    ctx.globalAlpha = 1;
  }

  _drawBodies(world, view, z, t, focus) {
    const ctx = this.ctx, list = this._sorted;
    list.length = 0;
    for (const b of world.bodies) {
      const m = b.drawR * 3 + (b.surgeT > 0 ? b.gravRange() : 0);
      if (b.x + m < view.l || b.x - m > view.r || b.y + m < view.t || b.y - m > view.b) continue;
      list.push(b);
    }
    list.sort((a, b) => a.mass - b.mass);

    if (focus && focus.alive) this._drawFocusFields(world, focus, z, t);

    for (const b of list) {
      const r = b.drawR;
      if (b.surgeT > 0) this._drawSurge(b, z, t);
      this.drawBody(ctx, b, b.x, b.y, r, t);

      if (focus && focus.alive && b !== focus) {
        let color = null;
        if (b.canEat(focus)) color = COLORS.threat;
        else if (focus.canEat(b)) color = COLORS.prey;
        if (color) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5 / z;
          ctx.beginPath();
          ctx.arc(b.x, b.y, r + 5 / z, 0, TAU);
          ctx.stroke();
        }
      }
      if (b.shield > 0) {
        const a = Math.min(1, b.shield);
        ctx.fillStyle = `rgba(241,234,217,${0.06 * a})`;
        ctx.strokeStyle = `rgba(241,234,217,${(0.35 + 0.2 * Math.sin(t * 8)) * a})`;
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r + 9 / z, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
      if (b.flash > 0) {
        ctx.fillStyle = `rgba(241,234,217,${Math.min(1, b.flash) * 0.35})`;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, TAU);
        ctx.fill();
      }
    }
  }

  _dotted(z, color, width = 2.5) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width / z;
    ctx.lineCap = 'round';
    ctx.setLineDash([0.01, 11 / z]);
  }

  /*
   * Around the player: its own reach (dotted), and for each nearby predator the dotted
   * edge of its pull plus a solid "point of no return" ring, inside which only a boost escapes.
   */
  _drawFocusFields(world, focus, z, t) {
    const ctx = this.ctx;
    const accel = maxSpeedFor(focus.mass) * CONFIG.DRAG;
    const pulling = [];
    for (const b of world.bodies) {
      if (b === focus || !b.canEat(focus)) continue;
      const d = Math.hypot(b.x - focus.x, b.y - focus.y);
      const range = b.gravRange();
      if (d < range + focus.r) pulling.push({ b, d, range });
    }
    pulling.sort((a, c) => a.d - c.d);
    for (const { b, d, range } of pulling.slice(0, 2)) {
      const near = clamp(1 - (d - b.r) / (range - b.r), 0, 1);
      this._dotted(z, `rgba(255,84,104,${0.25 + 0.35 * near})`, 3);
      ctx.beginPath();
      ctx.arc(b.x, b.y, range, 0, TAU);
      ctx.stroke();
      const capture = Math.sqrt((CONFIG.G * b.gravMul() * b.mass) / accel);
      if (capture > b.r * 1.05) {
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(255,84,104,${0.4 + 0.4 * near})`;
        ctx.lineWidth = 2.5 / z;
        ctx.beginPath();
        ctx.arc(b.x, b.y, capture, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
  }

  _drawSurge(b, z, t) {
    const ctx = this.ctx, r = b.drawR, range = b.gravRange();
    const k = Math.min(1, (b.surgeT / CONFIG.SURGE_DURATION) * 3);
    ctx.lineWidth = Math.max(2.5 / z, r * 0.05);
    for (let i = 0; i < 4; i++) {
      const p = (t * 0.9 + i / 4) % 1;
      ctx.strokeStyle = tone(b.hue, 1, 'light', 0.5 * p * k);
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + (range - r) * (1 - p), 0, TAU);
      ctx.stroke();
    }
  }

  /* Draw any body at any size into any context (also used for menu icons). */
  drawBody(ctx, b, x, y, r, t) {
    const key = TIERS[b.tier].key;
    if (key === 'blackhole') this._drawBlackHole(ctx, b, x, y, r, t);
    else if (key === 'star') this._drawStar(ctx, b, x, y, r, t);
    else this._drawPlanet(ctx, b, x, y, r, key);
  }

  _drawPlanet(ctx, b, x, y, r, key) {
    const tex = this.tex.surface(key, b.hue, b.variant);
    if (key === 'gas' && b.hasRings) this._drawRings(ctx, b, x, y, r, false);
    if (key === 'ocean' || key === 'rocky') {
      // a thin flat atmosphere band rather than a glow
      ctx.strokeStyle = tone(b.hue, 1, 'light', key === 'ocean' ? 0.32 : 0.2);
      ctx.lineWidth = r * 0.09;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.05, 0, TAU);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    if (key === 'asteroid') {
      const n = b.shape.length;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + b.tilt, rr = r * b.shape[i];
        if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, r, 0, TAU);
    }
    ctx.clip();
    ctx.rotate(b.tilt * 0.5);
    const W = r * 4.4;
    const u = b.spin * W;
    ctx.drawImage(tex, -r * 1.1 - u, -r * 1.1, W, r * 2.2);
    ctx.drawImage(tex, -r * 1.1 - u + W, -r * 1.1, W, r * 2.2);
    if (key === 'ocean') {
      const cl = this.tex.clouds[b.variant % 3];
      const u2 = ((b.spin * 1.6) % 1) * W;
      ctx.drawImage(cl, -r * 1.1 - u2, -r * 1.1, W, r * 2.2);
      ctx.drawImage(cl, -r * 1.1 - u2 + W, -r * 1.1, W, r * 2.2);
    }
    ctx.rotate(-b.tilt * 0.5);
    celShade(ctx, 0, 0, r);
    ctx.restore();
    if (key === 'gas' && b.hasRings) this._drawRings(ctx, b, x, y, r, true);
  }

  _halfArc(ctx, rad, front) {
    ctx.beginPath();
    if (front) ctx.arc(0, 0, rad, 0, Math.PI);
    else ctx.arc(0, 0, rad, Math.PI, TAU);
  }

  _drawRings(ctx, b, x, y, r, front) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.tilt * 0.8 + 0.3);
    ctx.scale(1, 0.3);
    const bands = [[1.42, 0.16, 'light', 0.85], [1.72, 0.26, 'base', 0.75], [2.02, 0.1, 'light', 0.6]];
    for (const [m, wd, level, a] of bands) {
      ctx.strokeStyle = tone(b.hue + 18, 0.5, level, a);
      ctx.lineWidth = r * wd;
      this._halfArc(ctx, r * m, front);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawStar(ctx, b, x, y, r, t) {
    const h = starHue(b.hue), sat = h === 52 ? 45 : 95;
    const pulse = 1 + Math.sin(t * 2.2 + b.id) * 0.025;
    steppedHalo(ctx, x, y, r * pulse, hsl(h, sat, 72), 0.8);
    // slowly turning flat rays
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 0.08 + b.id);
    ctx.fillStyle = hsl(h, sat, 80, 0.3);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, len = r * (i % 2 ? 1.32 : 1.5), wd = 0.09;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - wd) * r, Math.sin(a - wd) * r);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.lineTo(Math.cos(a + wd) * r, Math.sin(a + wd) * r);
      ctx.fill();
    }
    ctx.restore();

    const tex = this.tex.surface('star', h, b.variant);
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();
    const W = r * 4, u = b.spin * W;
    ctx.drawImage(tex, -r - u, -r, W, r * 2);
    ctx.drawImage(tex, -r - u + W, -r, W, r * 2);
    ctx.fillStyle = hsl(h, sat, 90, 0.45);
    ctx.beginPath();
    ctx.arc(LIGHT.x * r * 0.18, LIGHT.y * r * 0.18, r * 0.62, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = hsl(h, sat * 0.9, 58, 0.7);
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.965, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  _drawDisk(ctx, b, x, y, r, rot, front) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.tilt * 0.4);
    ctx.scale(1, 0.3);
    const bands = [
      [2.25, 0.16, tone(b.hue, 1, 'base', 0.55)],
      [1.95, 0.3, 'hsla(14,88%,46%,0.85)'],
      [1.6, 0.34, 'hsla(26,96%,58%,0.95)'],
      [1.27, 0.26, 'hsla(42,100%,72%,1)'],
    ];
    for (const [m, wd, color] of bands) {
      ctx.strokeStyle = color;
      ctx.lineWidth = r * wd;
      this._halfArc(ctx, r * m, front);
      ctx.stroke();
    }
    ctx.strokeStyle = COLORS.bone;
    ctx.lineWidth = r * 0.07;
    this._halfArc(ctx, r * 1.08, front);
    ctx.stroke();
    // dark gaps sliding round the disk show it spinning
    ctx.strokeStyle = 'rgba(9,11,24,0.35)';
    ctx.lineWidth = r * 0.05;
    for (let k = 0; k < 3; k++) {
      const rad = r * (1.45 + k * 0.28), a0 = rot * (1.6 - k * 0.3) + k * 2.1;
      ctx.beginPath();
      ctx.arc(0, 0, rad, a0, a0 + 0.9);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawBlackHole(ctx, b, x, y, r, t) {
    const rot = t * 0.9 + b.id;
    steppedHalo(ctx, x, y, r * 1.1, 'hsl(30,100%,66%)', 0.7);
    this._drawDisk(ctx, b, x, y, r, rot, false);
    // the far side of the disk, lensed up and over the hole
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.tilt * 0.4);
    ctx.strokeStyle = 'hsl(26,96%,58%)';
    ctx.lineWidth = r * 0.18;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.2, r * 1.15, 0, Math.PI * 1.04, Math.PI * 1.96);
    ctx.stroke();
    ctx.strokeStyle = 'hsl(42,100%,74%)';
    ctx.lineWidth = r * 0.07;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.96, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = COLORS.bone;
    ctx.lineWidth = Math.max(r * 0.035, 1);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.975, 0, TAU);
    ctx.stroke();
    this._drawDisk(ctx, b, x, y, r, rot, true);
  }

  /* ---------- effects ---------- */

  _drawParticles(world, view, z) {
    const ctx = this.ctx, ps = world.fx.particles, minS = 1.6 / z;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.x < view.l || p.x > view.r || p.y < view.t || p.y > view.b) continue;
      const a = p.life / p.max;
      ctx.globalAlpha = Math.min(1, a * 1.4);
      const s = Math.max(p.size * (0.35 + a * 0.65), minS);
      ctx.drawImage(this.tex.dot(p.hue, Math.min(86, p.light + 4)), p.x - s, p.y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
  }

  _drawSupernovae(world, z, t) {
    const ctx = this.ctx;
    for (const sn of world.supernovae) {
      const k = 1 - sn.t / sn.dur;
      const pulse = 0.5 + 0.5 * Math.sin(t * (6 + k * 20));
      const r = (34 + k * 90) * (0.9 + pulse * 0.2);
      steppedHalo(ctx, sn.x, sn.y, r, hsl(sn.hue, 95, 70), 1 + k);
      ctx.fillStyle = hsl(sn.hue, 100, 72);
      ctx.beginPath();
      ctx.arc(sn.x, sn.y, r * 0.55, 0, TAU);
      ctx.fill();
      ctx.fillStyle = COLORS.bone;
      ctx.beginPath();
      ctx.arc(sn.x, sn.y, r * 0.3, 0, TAU);
      ctx.fill();
      this._dotted(z, `rgba(255,84,104,${0.45 + 0.45 * pulse})`, 4);
      ctx.beginPath();
      ctx.arc(sn.x, sn.y, CONFIG.SUPERNOVA_CORE, 0, TAU);
      ctx.stroke();
      this._dotted(z, 'rgba(241,234,217,0.16)', 2.5);
      ctx.beginPath();
      ctx.arc(sn.x, sn.y, CONFIG.SUPERNOVA_BLAST, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
    }
  }

  _drawShockwaves(world, z) {
    const ctx = this.ctx;
    for (const sw of world.fx.shockwaves) {
      const k = sw.r / sw.max;
      ctx.strokeStyle = hsl(sw.hue, 90, 72, 0.22 * (1 - k));
      ctx.lineWidth = 70 * (1 - k) + 8;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.r, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = `rgba(241,234,217,${0.85 * (1 - k)})`;
      ctx.lineWidth = 3 / z;
      ctx.stroke();
    }
  }

  /* ---------- screen-space overlays ---------- */

  _drawLabels(world, z, focus, toScreen) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of this._sorted) {
      const sr = b.drawR * z;
      if (sr < 5) continue;
      const p = toScreen(b.x, b.y);
      const fs = clamp(sr * 0.3, 11, 18);
      let color = COLORS.bone;
      if (b === focus) color = COLORS.ember;
      else if (focus && focus.alive) {
        if (b.canEat(focus)) color = COLORS.threat;
        else if (focus.canEat(b)) color = COLORS.prey;
      }
      const key = TIERS[b.tier].key;
      const extra = key === 'blackhole' ? sr * 0.45 : key === 'gas' && b.hasRings ? sr * 0.25 : key === 'star' ? sr * 0.4 : 0;
      const ly = p.y + sr + extra + fs * 0.9 + 4;
      ctx.font = `800 ${fs}px Manrope, system-ui, sans-serif`;
      this._shadowText(b.name, p.x, ly, color);
      const ms = Math.max(10, fs * 0.78);
      ctx.font = `700 ${ms}px Manrope, system-ui, sans-serif`;
      this._shadowText(formatMass(b.mass), p.x, ly + fs * 0.55 + ms * 0.62, 'rgba(241,234,217,0.62)', 1.5);
    }

    ctx.font = '700 11px Manrope, system-ui, sans-serif';
    for (const wh of world.wormholes) {
      const p = toScreen(wh.x, wh.y);
      if (p.x < -50 || p.x > this.w + 50 || p.y < -50 || p.y > this.h + 50) continue;
      const sealed = focus && focus.mass > CONFIG.WORMHOLE_MAX_MASS;
      const txt = sealed ? 'Wormhole · sealed' : `Wormhole · up to ${CONFIG.WORMHOLE_MAX_MASS}`;
      this._shadowText(txt, p.x, p.y + wh.r * 1.5 * z + 16, tone(wh.hue, 1, 'light', sealed ? 0.45 : 0.95), 1.5);
    }
  }

  _drawTexts(world, toScreen) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const tx of world.fx.texts) {
      const p = toScreen(tx.x, tx.y);
      ctx.globalAlpha = Math.min(1, (tx.life / tx.max) * 2);
      ctx.font = `800 ${tx.size}px Unbounded, Manrope, system-ui, sans-serif`;
      this._shadowText(tx.text, p.x, p.y - tx.rise, tx.color, 3);
    }
    ctx.globalAlpha = 1;
  }

  _drawIndicators(world, toScreen, t, z) {
    const ctx = this.ctx, w = this.w, h = this.h;
    for (const sn of world.supernovae) {
      const p = toScreen(sn.x, sn.y);
      const secs = Math.ceil(sn.t);
      const inside = p.x > 30 && p.x < w - 30 && p.y > 30 && p.y < h - 30;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (inside) {
        // Below the danger ring, so it never collides with the warning banner at the top
        const below = p.y + CONFIG.SUPERNOVA_CORE * z + 24;
        const ly = below < h - 120 ? below : Math.max(24, p.y - CONFIG.SUPERNOVA_CORE * z - 20);
        ctx.font = '800 15px Unbounded, Manrope, system-ui, sans-serif';
        this._shadowText(`Supernova in ${secs}`, p.x, ly, COLORS.threat);
        continue;
      }
      const cx = w / 2, cy = h / 2;
      const ang = Math.atan2(p.y - cy, p.x - cx);
      const m = 70;
      const sx = Math.cos(ang), sy = Math.sin(ang);
      const k = Math.min((w / 2 - m) / Math.abs(sx || 1e-6), (h / 2 - m) / Math.abs(sy || 1e-6));
      const ex = cx + sx * k, ey = cy + sy * k;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.fillStyle = 'rgba(9,11,24,0.9)';
      ctx.beginPath();
      ctx.moveTo(18, 3);
      ctx.lineTo(-4, -7);
      ctx.lineTo(-4, 13);
      ctx.fill();
      ctx.fillStyle = COLORS.threat;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-6, -10);
      ctx.lineTo(-6, 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.font = '800 13px Unbounded, Manrope, system-ui, sans-serif';
      this._shadowText(String(secs), ex - sx * 30, ey - sy * 26, COLORS.threat);
    }
  }

  /* The danger vignette is a CSS overlay; only its opacity changes here. */
  _drawDanger(danger, t) {
    if (!this.dangerEl) return;
    const a = danger > 0.08 ? clamp(danger, 0, 1.2) * (0.75 + 0.25 * Math.sin(t * 9)) : 0;
    const q = Math.round(a * 50) / 50;
    if (q !== this._dangerShown) {
      this._dangerShown = q;
      this.dangerEl.style.opacity = String(Math.min(1, q));
    }
  }

  /* Small standalone render of a tier, for the menu. */
  drawIcon(canvas, tier, hue, t) {
    const g = canvas.getContext('2d');
    const size = canvas.width;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, size, size);
    if (!canvas._fake) {
      canvas._fake = {
        id: tier + 3, hue, variant: 1, spin: Math.random(), tilt: -0.25, hasRings: true,
        shape: makeRockShape(13, 0.22, mulberry32(tier * 13 + 5)), tier, drawR: 1,
      };
    }
    const fake = canvas._fake;
    fake.hue = hue;
    fake.spin = (fake.spin + 0.0009) % 1;
    const key = TIERS[tier].key;
    const r = size * (key === 'blackhole' ? 0.19 : key === 'gas' ? 0.21 : key === 'star' ? 0.28 : 0.36);
    this.drawBody(g, fake, size / 2, size / 2, r, t);
  }
}
