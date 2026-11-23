'use strict';

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.tex = new TextureBank();
    this.dpr = 1;
    this.w = 1;
    this.h = 1;
    this.backdrop = this._makeBackdrop(1024);
    this.starSprites = [this._makeStarSprite(false), this._makeStarSprite(true)];
    this.starLayers = [this._makeStars(1100, 320, 1.0, 0.03), this._makeStars(900, 160, 1.5, 0.08), this._makeStars(760, 50, 2.2, 0.18)];
    this.vignetteEl = document.getElementById('vignette');
    this.dangerEl = document.getElementById('danger');
    this.nebulaSprites = new Map();
    this._warpSrc = [];
    this._sorted = [];
    this._dangerShown = -1;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  /* ---------- frame ---------- */

  render(world, cam, opts) {
    const ctx = this.ctx, dpr = this.dpr, w = this.w, h = this.h, z = cam.zoom, t = opts.time;
    const focus = opts.focus;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this._drawStars(cam);

    const ox = w / 2 - cam.x * z + cam.sx, oy = h / 2 - cam.y * z + cam.sy;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    const pad = 60 / z;
    const view = { l: cam.x - w / 2 / z - pad, r: cam.x + w / 2 / z + pad, t: cam.y - h / 2 / z - pad, b: cam.y + h / 2 / z + pad };

    this._drawNebulae(world, view);
    this._drawGrid(world, view, z);
    this._drawBoundary(world, view, z);
    this._drawWormholes(world, view, z, focus);
    this._drawFood(world, view, z, t);
    this._drawSupernovae(world, z, t);
    this._drawGhosts(world, t);
    this._drawBodies(world, view, z, t, focus);
    this._drawParticles(world, view);
    this._drawShockwaves(world, z);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toScreen = (x, y) => ({ x: (x - cam.x) * z + w / 2 + cam.sx, y: (y - cam.y) * z + h / 2 + cam.sy });
    this._drawLabels(world, z, focus, toScreen);
    this._drawTexts(world, toScreen);
    this._drawIndicators(world, toScreen, t);
    this._drawVignette(opts.danger || 0, t);
    if (opts.flash > 0) {
      ctx.fillStyle = `rgba(255,248,235,${Math.min(0.85, opts.flash)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /* ---------- background ---------- */

  /* Opaque, tileable deep-space backdrop with faint haze. Drawn first, so it doubles as the clear. */
  _makeBackdrop(size) {
    const c = makeCanvas(size, size);
    c.logicalSize = size;
    const g = c.getContext('2d');
    g.fillStyle = '#04050c';
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x = Math.random() * size, y = Math.random() * size, r = rand(160, 380);
      const hue = pick([225, 255, 290, 200, 330]);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const X = x + ox * size, Y = y + oy * size;
          const grd = g.createRadialGradient(X, Y, 0, X, Y, r);
          grd.addColorStop(0, hsl(hue, 60, 45, 0.07));
          grd.addColorStop(1, hsl(hue, 60, 30, 0));
          g.fillStyle = grd;
          g.fillRect(X - r, Y - r, r * 2, r * 2);
        }
      }
    }
    return c;
  }

  _makeStarSprite(warm) {
    const c = makeCanvas(32, 32), g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    const col = warm ? '255,214,170' : '215,228,255';
    grd.addColorStop(0, `rgba(${col},1)`);
    grd.addColorStop(0.12, `rgba(${col},0.9)`);
    grd.addColorStop(0.3, `rgba(${col},0.18)`);
    grd.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    return c;
  }

  /* Stars are drawn one by one rather than as full-screen layers: far cheaper to rasterize. */
  _makeStars(size, count, maxSize, parallax) {
    const stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * size,
        y: Math.random() * size,
        s: (0.35 + maxSize * Math.pow(Math.random(), 3)) * 5,
        warm: Math.random() < 0.18 ? 1 : 0,
        a: rand(0.35, 1),
      });
    }
    return { size, stars, parallax };
  }

  _drawStars(cam) {
    const ctx = this.ctx, w = this.w, h = this.h;
    const bd = this.backdrop, B = bd.logicalSize;
    let bx = (-cam.x * 0.015) % B, by = (-cam.y * 0.015) % B;
    if (bx > 0) bx -= B;
    if (by > 0) by -= B;
    for (let x = bx; x < w; x += B) for (let y = by; y < h; y += B) ctx.drawImage(bd, x, y, B, B);

    ctx.globalCompositeOperation = 'lighter';
    for (const layer of this.starLayers) {
      const S = layer.size;
      let ox = (-cam.x * layer.parallax) % S, oy = (-cam.y * layer.parallax) % S;
      if (ox > 0) ox -= S;
      if (oy > 0) oy -= S;
      for (let tx = ox; tx < w; tx += S) {
        for (let ty = oy; ty < h; ty += S) {
          for (const st of layer.stars) {
            const x = tx + st.x, y = ty + st.y;
            if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;
            ctx.globalAlpha = st.a;
            ctx.drawImage(this.starSprites[st.warm], x - st.s / 2, y - st.s / 2, st.s, st.s);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  _nebulaSprite(n) {
    let c = this.nebulaSprites.get(n.id);
    if (c) return c;
    const S = 512;
    c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const R = mulberry32(n.seed);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 28; i++) {
      const a = R() * TAU, d = R() * S * 0.26;
      const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
      const r = S * (0.1 + R() * 0.2);
      const hue = n.hue + (R() - 0.5) * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, hsl(hue, 75, 55, 0.11));
      grd.addColorStop(1, hsl(hue, 75, 40, 0));
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 45; i++) {
      const a = R() * TAU, d = R() * S * 0.33;
      const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
      const r = 1 + R() * 3;
      const grd = g.createRadialGradient(x, y, 0, x, y, r * 4);
      grd.addColorStop(0, 'rgba(255,255,255,0.5)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
    }
    this.nebulaSprites.set(n.id, c);
    return c;
  }

  _drawNebulae(world, view) {
    const ctx = this.ctx;
    for (const n of world.nebulae) {
      const s = n.r * 1.35;
      if (n.x + s < view.l || n.x - s > view.r || n.y + s < view.t || n.y - s > view.b) continue;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(this._nebulaSprite(n), n.x - s, n.y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
  }

  /* The signature effect: a spacetime grid that sags toward everything with mass. */
  _drawGrid(world, view, z) {
    const ctx = this.ctx, src = this._warpSrc;
    src.length = 0;
    for (const b of world.bodies) {
      const reach = b.drawR * 7;
      if (b.x + reach < view.l || b.x - reach > view.r || b.y + reach < view.t || b.y - reach > view.b) continue;
      const A = Math.min(0.8, 0.4 * TIERS[b.tier].grav * (b.surgeT > 0 ? 1.5 : 1));
      src.push({ x: b.x, y: b.y, R2: (b.drawR * 1.5) ** 2, A, cut2: reach * reach });
    }
    for (const w of world.wormholes) src.push({ x: w.x, y: w.y, R2: (w.r * 1.7) ** 2, A: 0.55, cut2: (w.r * 7) ** 2 });
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
    ctx.strokeStyle = 'rgba(118,146,255,0.11)';
    ctx.lineWidth = 1 / z;
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
    ctx.fillStyle = 'rgba(1,1,6,0.6)';
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.strokeStyle = 'rgba(255,120,150,0.07)';
    ctx.lineWidth = 50 / z;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,140,165,0.4)';
    ctx.lineWidth = 2 / z;
    ctx.stroke();
    ctx.restore();
  }

  _drawWormholes(world, view, z, focus) {
    const ctx = this.ctx;
    for (const wh of world.wormholes) {
      const s = wh.r * 3;
      if (wh.x + s < view.l || wh.x - s > view.r || wh.y + s < view.t || wh.y - s > view.b) continue;
      const sealed = focus && focus.mass > CONFIG.WORMHOLE_MAX_MASS;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = sealed ? 0.25 : 0.6;
      ctx.drawImage(this.tex.glow(wh.hue, 85, 58), wh.x - s, wh.y - s, s * 2, s * 2);
      ctx.save();
      ctx.translate(wh.x, wh.y);
      ctx.rotate(-wh.spin);
      ctx.globalAlpha = sealed ? 0.35 : 1;
      const sp = wh.r * 1.5;
      ctx.drawImage(this.tex.spiral(wh.hue), -sp, -sp, sp * 2, sp * 2);
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const grd = ctx.createRadialGradient(wh.x, wh.y, 0, wh.x, wh.y, wh.r * 0.7);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(0.6, 'rgba(0,0,0,0.85)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(wh.x, wh.y, wh.r * 0.7, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = hsl(wh.hue, 90, 72, sealed ? 0.25 : 0.7);
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.arc(wh.x, wh.y, wh.r * 0.6, 0, TAU);
      ctx.stroke();
    }
  }

  /* ---------- food ---------- */

  _drawFood(world, view, z, t) {
    const ctx = this.ctx, food = world.food, minS = 2.6 / z;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < food.length; i++) {
      const f = food[i];
      if (f.x < view.l || f.x > view.r || f.y < view.t || f.y > view.b) continue;
      if (f.type === FOOD_DUST) {
        const s = Math.max(f.r * 5, minS);
        ctx.drawImage(this.tex.dust[f.color], f.x - s / 2, f.y - s / 2, s, s);
      } else if (f.type === FOOD_DEBRIS) {
        const s = Math.max(f.r * 4.2, minS);
        ctx.drawImage(this.tex.glow(f.hue, 92, 62), f.x - s / 2, f.y - s / 2, s, s);
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    for (let i = 0; i < food.length; i++) {
      const f = food[i];
      if (f.type === FOOD_DUST || f.type === FOOD_DEBRIS) continue;
      const m = f.type === FOOD_COMET ? 400 : 40;
      if (f.x < view.l - m || f.x > view.r + m || f.y < view.t - m || f.y > view.b + m) continue;
      if (f.type === FOOD_ROCK) {
        const s = f.r * 1.2;
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.drawImage(this.tex.rocks[f.sprite], -s, -s, s * 2, s * 2);
        ctx.restore();
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
    const L = 150 + f.mass * 7, wd = f.r * 1.25;
    const tx = f.x - nx * L, ty = f.y - ny * L;
    const grd = ctx.createLinearGradient(f.x, f.y, tx, ty);
    grd.addColorStop(0, hsl(f.hue, 90, 82, 0.6));
    grd.addColorStop(1, hsl(f.hue, 90, 60, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(f.x - ny * wd, f.y + nx * wd);
    ctx.lineTo(tx, ty);
    ctx.lineTo(f.x + ny * wd, f.y - nx * wd);
    ctx.closePath();
    ctx.fill();
    const s = f.r * 5;
    ctx.drawImage(this.tex.glow(f.hue, 90, 75), f.x - s / 2, f.y - s / 2, s, s);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#f4fbff';
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r * 0.55, 0, TAU);
    ctx.fill();
  }

  _drawRemnant(f, t) {
    const ctx = this.ctx;
    const pulse = 0.75 + 0.25 * Math.sin(t * 9 + f.rot);
    ctx.globalCompositeOperation = 'lighter';
    let s = f.r * 7 * pulse;
    ctx.drawImage(this.tex.glow(f.hue, 95, 65), f.x - s / 2, f.y - s / 2, s, s);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    const L = 110;
    for (const dir of [1, -1]) {
      const grd = ctx.createLinearGradient(0, 0, 0, L * dir);
      grd.addColorStop(0, hsl(f.hue, 90, 85, 0.65));
      grd.addColorStop(1, hsl(f.hue, 90, 60, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(0, L * dir);
      ctx.lineTo(4, 0);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r * 0.45, 0, TAU);
    ctx.fill();
  }

  /* ---------- bodies ---------- */

  _drawGhosts(world, t) {
    const ctx = this.ctx;
    for (const g of world.fx.ghosts) {
      const p = g.t / g.dur, e = p * p;
      const r = g.body.drawR * (1 - p);
      if (r < 0.5) continue;
      ctx.globalAlpha = 1 - p * 0.5;
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
        if (b.canEat(focus)) color = 'rgba(255,92,116,0.75)';
        else if (focus.canEat(b)) color = 'rgba(110,240,196,0.6)';
        if (color) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2 / z;
          ctx.beginPath();
          ctx.arc(b.x, b.y, r + 4 / z, 0, TAU);
          ctx.stroke();
        }
      }
      if (b.shield > 0) {
        const a = Math.min(1, b.shield) * (0.45 + 0.25 * Math.sin(t * 10));
        ctx.strokeStyle = `rgba(150,225,255,${a})`;
        ctx.lineWidth = 2.5 / z;
        ctx.setLineDash([8 / z, 6 / z]);
        ctx.lineDashOffset = -t * 30 / z;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r + 8 / z, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (b.flash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, b.flash) * 0.55;
        const s = r * 2.6;
        ctx.drawImage(this.tex.glow(b.hue, 60, 85), b.x - s, b.y - s, s * 2, s * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  /*
   * Around the player: its own gravity reach, and for each nearby predator the
   * dashed edge of its pull plus a solid "point of no return" ring — inside it,
   * normal thrust can no longer beat that body's gravity.
   */
  _drawFocusFields(world, focus, z, t) {
    const ctx = this.ctx;
    ctx.setLineDash([10 / z, 12 / z]);
    ctx.lineWidth = 1.5 / z;
    ctx.strokeStyle = hsl(focus.hue, 80, 75, 0.14);
    ctx.beginPath();
    ctx.arc(focus.x, focus.y, focus.gravRange(), 0, TAU);
    ctx.stroke();

    const accel = maxSpeedFor(focus.mass) * CONFIG.DRAG;
    for (const b of world.bodies) {
      if (b === focus || !b.canEat(focus)) continue;
      const range = b.gravRange();
      const d = Math.hypot(b.x - focus.x, b.y - focus.y);
      if (d > range * 1.5 + focus.r) continue;
      const near = clamp(1 - (d - range) / (range * 0.5), 0, 1);
      ctx.setLineDash([10 / z, 12 / z]);
      ctx.lineDashOffset = t * 20 / z;
      ctx.strokeStyle = `rgba(255,96,120,${0.12 + 0.2 * near})`;
      ctx.lineWidth = 1.5 / z;
      ctx.beginPath();
      ctx.arc(b.x, b.y, range, 0, TAU);
      ctx.stroke();
      const capture = Math.sqrt((CONFIG.G * b.gravMul() * b.mass) / accel);
      if (capture > b.r * 1.05) {
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(255,80,105,${0.25 + 0.35 * near})`;
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        ctx.arc(b.x, b.y, capture, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  _drawSurge(b, z, t) {
    const ctx = this.ctx, r = b.drawR, range = b.gravRange();
    const k = Math.min(1, (b.surgeT / CONFIG.SURGE_DURATION) * 3);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(2 / z, r * 0.05);
    for (let i = 0; i < 4; i++) {
      const p = (t * 0.9 + i / 4) % 1;
      ctx.strokeStyle = hsl(b.hue, 90, 72, 0.4 * p * k);
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + (range - r) * (1 - p), 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
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
    const baseAlpha = ctx.globalAlpha;
    if (key === 'rocky' || key === 'ocean' || key === 'gas') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = baseAlpha * (key === 'rocky' ? 0.3 : 0.45);
      const s = r * 1.45;
      ctx.drawImage(this.tex.glow(key === 'ocean' ? b.hue + 10 : b.hue, 80, 60), x - s, y - s, s * 2, s * 2);
      ctx.globalAlpha = baseAlpha;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (key === 'gas' && b.hasRings) this._drawRings(ctx, b, x, y, r, false);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.tilt);
    ctx.beginPath();
    if (key === 'asteroid') {
      const n = b.shape.length;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, rr = r * b.shape[i];
        if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, r, 0, TAU);
    }
    ctx.clip();
    const W = r * 4;
    const u = b.spin * W;
    ctx.drawImage(tex, -r - u, -r, W, r * 2);
    ctx.drawImage(tex, -r - u + W, -r, W, r * 2);
    if (key === 'ocean') {
      const cl = this.tex.clouds[b.variant % 3];
      const u2 = ((b.spin * 1.7) % 1) * W;
      ctx.drawImage(cl, -r - u2, -r, W, r * 2);
      ctx.drawImage(cl, -r - u2 + W, -r, W, r * 2);
    }
    ctx.rotate(-b.tilt);
    ctx.drawImage(this.tex.shade, -r, -r, r * 2, r * 2);
    ctx.restore();

    if (key === 'gas' && b.hasRings) this._drawRings(ctx, b, x, y, r, true);
  }

  _halfAnnulus(ctx, inner, outer, front) {
    ctx.beginPath();
    if (front) {
      ctx.arc(0, 0, outer, 0, Math.PI);
      ctx.arc(0, 0, inner, Math.PI, 0, true);
    } else {
      ctx.arc(0, 0, outer, Math.PI, TAU);
      ctx.arc(0, 0, inner, TAU, Math.PI, true);
    }
    ctx.closePath();
  }

  _drawRings(ctx, b, x, y, r, front) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.tilt * 0.8 + 0.3);
    ctx.scale(1, 0.3);
    const inner = r * 1.3, outer = r * 2.15;
    this._halfAnnulus(ctx, inner, outer, front);
    const grd = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
    grd.addColorStop(0, hsl(b.hue + 20, 30, 70, 0));
    grd.addColorStop(0.1, hsl(b.hue + 20, 35, 74, 0.6));
    grd.addColorStop(0.35, hsl(b.hue + 10, 30, 58, 0.35));
    grd.addColorStop(0.45, hsl(b.hue, 20, 30, 0.06));
    grd.addColorStop(0.55, hsl(b.hue + 15, 35, 70, 0.5));
    grd.addColorStop(0.85, hsl(b.hue + 25, 30, 62, 0.25));
    grd.addColorStop(1, hsl(b.hue + 25, 30, 60, 0));
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.restore();
  }

  _drawStar(ctx, b, x, y, r, t) {
    const fl = 1 + Math.sin(t * 2.7 + b.id) * 0.035 + Math.sin(t * 6.1 + b.id * 3) * 0.02;
    const baseAlpha = ctx.globalAlpha;
    const gl = this.tex.glow(b.hue, 95, 62);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = baseAlpha * 0.4;
    let s = r * 3.2 * fl;
    ctx.drawImage(gl, x - s, y - s, s * 2, s * 2);
    ctx.globalAlpha = baseAlpha * 0.75;
    s = r * 1.7 * fl;
    ctx.drawImage(gl, x - s, y - s, s * 2, s * 2);
    ctx.globalAlpha = baseAlpha;
    ctx.globalCompositeOperation = 'source-over';

    const tex = this.tex.surface('star', b.hue, b.variant);
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();
    const W = r * 4, u = b.spin * W;
    ctx.drawImage(tex, -r - u, -r, W, r * 2);
    ctx.drawImage(tex, -r - u + W, -r, W, r * 2);
    ctx.drawImage(this.tex.starShade, -r, -r, r * 2, r * 2);
    ctx.restore();
  }

  _drawDisk(ctx, b, x, y, r, rot, front) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.tilt * 0.4);
    ctx.scale(1, 0.28);
    const inner = r * 1.02, outer = r * 2.5;
    this._halfAnnulus(ctx, inner, outer, front);
    const grd = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
    grd.addColorStop(0, hsl(b.hue + 25, 100, 92, 0.95));
    grd.addColorStop(0.15, hsl(b.hue + 10, 100, 66, 0.85));
    grd.addColorStop(0.5, hsl(b.hue, 95, 48, 0.4));
    grd.addColorStop(1, hsl(b.hue - 10, 90, 35, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.clip();
    ctx.lineWidth = r * 0.06;
    for (let k = 0; k < 6; k++) {
      const rr = inner + (outer - inner) * (0.08 + k * 0.13);
      const a0 = rot * (1.7 - k * 0.2) + k * 1.7;
      ctx.strokeStyle = hsl(b.hue + 15, 100, 82, 0.25);
      ctx.beginPath();
      ctx.arc(0, 0, rr, a0, a0 + 1.3);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  _drawBlackHole(ctx, b, x, y, r, t) {
    const rot = t * 0.9 + b.id;
    const baseAlpha = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = baseAlpha * 0.35;
    const s = r * 3.6;
    ctx.drawImage(this.tex.glow(b.hue, 90, 55), x - s, y - s, s * 2, s * 2);
    ctx.globalAlpha = baseAlpha;
    ctx.globalCompositeOperation = 'source-over';

    this._drawDisk(ctx, b, x, y, r, rot, false);

    // the far side of the disk, lensed up and over the hole
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.tilt * 0.4);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = r * 0.22;
    ctx.strokeStyle = hsl(b.hue, 95, 60, 0.5);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.2, r * 1.14, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.stroke();
    ctx.lineWidth = r * 0.07;
    ctx.strokeStyle = hsl(b.hue + 20, 100, 86, 0.7);
    ctx.stroke();
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.95, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hsl(b.hue + 20, 100, 82, 0.9);
    ctx.lineWidth = Math.max(r * 0.035, 1);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.97, 0, TAU);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    this._drawDisk(ctx, b, x, y, r, rot, true);
  }

  /* ---------- effects ---------- */

  _drawParticles(world, view) {
    const ctx = this.ctx, ps = world.fx.particles;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.x < view.l || p.x > view.r || p.y < view.t || p.y > view.b) continue;
      const a = p.life / p.max;
      ctx.globalAlpha = a;
      const s = p.size * (0.5 + a * 0.8);
      ctx.drawImage(this.tex.glow(p.hue, 90, p.light), p.x - s, p.y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  _drawSupernovae(world, z, t) {
    const ctx = this.ctx;
    for (const sn of world.supernovae) {
      const k = 1 - sn.t / sn.dur;
      const pulse = 0.5 + 0.5 * Math.sin(t * (6 + k * 20));
      ctx.globalCompositeOperation = 'lighter';
      const s = (70 + k * 240) * (0.85 + pulse * 0.3);
      ctx.globalAlpha = 0.55 + 0.45 * k;
      ctx.drawImage(this.tex.glow(sn.hue, 95, 65), sn.x - s, sn.y - s, s * 2, s * 2);
      ctx.globalAlpha = 1;
      const c = s * 0.35;
      ctx.drawImage(this.tex.glow(sn.hue, 30, 90), sn.x - c, sn.y - c, c * 2, c * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash([18 / z, 14 / z]);
      ctx.strokeStyle = `rgba(255,96,120,${0.3 + 0.45 * pulse})`;
      ctx.lineWidth = 3 / z;
      ctx.beginPath();
      ctx.arc(sn.x, sn.y, CONFIG.SUPERNOVA_CORE, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,210,170,0.10)';
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.arc(sn.x, sn.y, CONFIG.SUPERNOVA_BLAST, 0, TAU);
      ctx.stroke();
    }
  }

  _drawShockwaves(world, z) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const sw of world.fx.shockwaves) {
      const k = sw.r / sw.max;
      ctx.strokeStyle = hsl(sw.hue, 90, 70, 0.35 * (1 - k));
      ctx.lineWidth = 70 * (1 - k) + 8;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.r, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,250,240,${0.8 * (1 - k)})`;
      ctx.lineWidth = 3 / z;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- screen-space overlays ---------- */

  _drawLabels(world, z, focus, toScreen) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const b of this._sorted) {
      const sr = b.drawR * z;
      if (sr < 5) continue;
      const p = toScreen(b.x, b.y);
      const fs = clamp(sr * 0.3, 11, 19);
      let color = '#e9ecf8';
      if (b === focus) color = '#ffc98a';
      else if (focus && focus.alive) {
        if (b.canEat(focus)) color = '#ff8d9c';
        else if (focus.canEat(b)) color = '#80f0c8';
      }
      const extra = TIERS[b.tier].key === 'blackhole' ? sr * 0.45 : TIERS[b.tier].key === 'gas' && b.hasRings ? sr * 0.25 : 0;
      const ly = p.y + sr + extra + fs * 0.9 + 2;
      ctx.font = `700 ${fs}px Manrope, system-ui, sans-serif`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(3,4,12,0.8)';
      ctx.strokeText(b.name, p.x, ly);
      ctx.fillStyle = color;
      ctx.fillText(b.name, p.x, ly);
      const ms = Math.max(10, fs * 0.72);
      ctx.font = `500 ${ms}px "JetBrains Mono", ui-monospace, monospace`;
      const my = ly + fs * 0.5 + ms * 0.7;
      ctx.strokeText(formatMass(b.mass), p.x, my);
      ctx.fillStyle = 'rgba(214,220,245,0.7)';
      ctx.fillText(formatMass(b.mass), p.x, my);
    }

    ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
    for (const wh of world.wormholes) {
      const p = toScreen(wh.x, wh.y);
      if (p.x < -50 || p.x > this.w + 50 || p.y < -50 || p.y > this.h + 50) continue;
      const sealed = focus && focus.mass > CONFIG.WORMHOLE_MAX_MASS;
      const y = p.y + wh.r * z + 16;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(3,4,12,0.8)';
      const txt = sealed ? 'WORMHOLE · SEALED' : `WORMHOLE · ≤${CONFIG.WORMHOLE_MAX_MASS}`;
      ctx.strokeText(txt, p.x, y);
      ctx.fillStyle = hsl(wh.hue, 80, 78, sealed ? 0.4 : 0.85);
      ctx.fillText(txt, p.x, y);
    }
  }

  _drawTexts(world, toScreen) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const tx of world.fx.texts) {
      const p = toScreen(tx.x, tx.y);
      const a = Math.min(1, (tx.life / tx.max) * 2);
      ctx.globalAlpha = a;
      ctx.font = `800 ${tx.size}px Unbounded, Manrope, system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(3,4,12,0.85)';
      ctx.strokeText(tx.text, p.x, p.y - tx.rise);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.text, p.x, p.y - tx.rise);
    }
    ctx.globalAlpha = 1;
  }

  _drawIndicators(world, toScreen, t) {
    const ctx = this.ctx, w = this.w, h = this.h;
    for (const sn of world.supernovae) {
      const p = toScreen(sn.x, sn.y);
      const secs = Math.ceil(sn.t);
      const pulse = 0.6 + 0.4 * Math.sin(t * 10);
      const inside = p.x > 30 && p.x < w - 30 && p.y > 30 && p.y < h - 30;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (inside) {
        ctx.font = '800 15px Unbounded, Manrope, system-ui, sans-serif';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(3,4,12,0.85)';
        ctx.strokeText(`SUPERNOVA ${secs}`, p.x, p.y - 40);
        ctx.fillStyle = `rgba(255,190,140,${pulse})`;
        ctx.fillText(`SUPERNOVA ${secs}`, p.x, p.y - 40);
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
      ctx.fillStyle = `rgba(255,150,110,${pulse})`;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-6, -10);
      ctx.lineTo(-6, 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.font = '800 13px Unbounded, Manrope, system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(3,4,12,0.85)';
      const lx = ex - sx * 30, ly = ey - sy * 26;
      ctx.strokeText(String(secs), lx, ly);
      ctx.fillStyle = '#ffd2b0';
      ctx.fillText(String(secs), lx, ly);
    }
  }

  /* The vignettes are CSS overlays (cheap for the compositor); only the danger opacity changes. */
  _drawVignette(danger, t) {
    if (!this.dangerEl) return;
    const a = danger > 0.08 ? clamp(danger, 0, 1.2) * (0.75 + 0.25 * Math.sin(t * 9)) : 0;
    const q = Math.round(a * 50) / 50;
    if (q !== this._dangerShown) {
      this._dangerShown = q;
      this.dangerEl.style.opacity = String(Math.min(1, q));
    }
  }

  /* Small standalone render of a tier, for the menu's evolution ladder. */
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
    const r = size * (key === 'blackhole' ? 0.2 : key === 'gas' ? 0.22 : key === 'star' ? 0.24 : 0.34);
    this.drawBody(g, fake, size / 2, size / 2, r, t);
  }
}
