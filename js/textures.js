'use strict';

/*
 * Art direction: a toy solar system.
 *  - Anything you can touch is a flat, hard-edged shape lit from the top left (LIGHT).
 *  - Shading is two hard steps (celShade), never a smooth gradient.
 *  - Only light sources glow, and their glow is stepped (steppedHalo).
 *  - Scenery (nebulae) is the one soft thing, so it reads as background.
 *  - Colours come from tone(): five fixed steps of one of the eight BODY_HUES.
 */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/* How saturated each form's surface is: rock is greyish, oceans and gas are vivid. */
const TIER_SAT = { asteroid: 0.3, moon: 0.2, rocky: 0.8, ocean: 1, gas: 0.85, star: 1, blackhole: 1 };

/*
 * Two hard shadow steps on the side away from the light, plus a small flat highlight.
 * Call it inside a clip of the body's outline.
 */
function celShade(g, x, y, r, strength = 1) {
  const steps = [[0.5, 1.08, 0.36], [0.85, 1.17, 0.3]];
  for (const [off, rad, a] of steps) {
    g.fillStyle = `rgba(9,11,24,${a * strength})`;
    g.beginPath();
    g.rect(x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
    g.arc(x + LIGHT.x * r * off, y + LIGHT.y * r * off, r * rad, 0, TAU, true);
    g.fill('evenodd');
  }
  g.fillStyle = `rgba(255,252,240,${0.2 * strength})`;
  g.beginPath();
  g.ellipse(x + LIGHT.x * r * 0.5, y + LIGHT.y * r * 0.5, r * 0.24, r * 0.12, Math.atan2(LIGHT.y, LIGHT.x) + Math.PI / 2, 0, TAU);
  g.fill();
}

/* Glow for light sources: hard-edged rings of falling opacity instead of a blur. */
function steppedHalo(g, x, y, r, color, scale = 1) {
  const steps = [[2.3, 0.06], [1.85, 0.08], [1.45, 0.12]];
  g.fillStyle = color;
  for (const [m, a] of steps) {
    g.globalAlpha = a * scale;
    g.beginPath();
    g.arc(x, y, r * m, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
}

/* A smooth irregular blob through n jittered points (used for continents, maria, patches). */
function blobPath(g, cx, cy, rx, ry, n, jit, R) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 1 - jit + R() * jit * 2;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  g.beginPath();
  const m0 = mid(pts[0], pts[1]);
  g.moveTo(m0[0], m0[1]);
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n], m = mid(p, pts[(i + 1) % n]);
    g.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  g.closePath();
}

class TextureBank {
  constructor() {
    this.S = 256;
    this.surfaces = new Map();
    this.dots = new Map();
    this.clouds = [0, 1, 2].map((i) => this._makeClouds(i));
    this.dust = DUST_COLORS.map(([h, s, l]) => this._makeDot(hsl(h, s, l)));
    this.rocks = [];
    for (let i = 0; i < 16; i++) this.rocks.push(this._makeRockSprite(i));
  }

  surface(tierKey, hue, variant) {
    const key = `${tierKey}|${hue}|${variant}`;
    let tex = this.surfaces.get(key);
    if (!tex) {
      tex = this._makeSurface(tierKey, hue, hashString(key));
      this.surfaces.set(key, tex);
      if (this.surfaces.size > 90) this.surfaces.delete(this.surfaces.keys().next().value);
    }
    return tex;
  }

  /* Flat round dot in a hue (particles, debris). Hue bucketed to keep the cache small. */
  dot(hue, light = 74) {
    const h = Math.round((((hue % 360) + 360) % 360) / 12) * 12;
    const key = `${h}|${light}`;
    let c = this.dots.get(key);
    if (!c) {
      c = this._makeDot(hsl(h, 70, light));
      this.dots.set(key, c);
    }
    return c;
  }

  _makeDot(color) {
    const c = makeCanvas(16, 16), g = c.getContext('2d');
    g.fillStyle = color;
    g.beginPath();
    g.arc(8, 8, 7, 0, TAU);
    g.fill();
    return c;
  }

  _makeRockSprite(i) {
    const S = 64, c = makeCanvas(S, S), g = c.getContext('2d');
    const R = mulberry32(9001 + i * 77);
    const shape = makeRockShape(11, 0.3, R);
    const hue = [28, 34, 210, 20][i % 4];
    const r = S / 2 - 3;
    g.translate(S / 2, S / 2);
    g.beginPath();
    for (let k = 0; k < shape.length; k++) {
      const a = (k / shape.length) * TAU;
      if (k === 0) g.moveTo(Math.cos(a) * r * shape[k], Math.sin(a) * r * shape[k]);
      else g.lineTo(Math.cos(a) * r * shape[k], Math.sin(a) * r * shape[k]);
    }
    g.closePath();
    g.fillStyle = tone(hue, 0.25, 'base');
    g.fill();
    g.save();
    g.clip();
    for (let k = 0; k < 3; k++) {
      const x = (R() - 0.5) * r, y = (R() - 0.5) * r, cr = 3 + R() * 5;
      g.fillStyle = tone(hue, 0.25, 'dark');
      g.beginPath();
      g.arc(x, y, cr, 0, TAU);
      g.fill();
      g.fillStyle = tone(hue, 0.25, 'mid');
      g.beginPath();
      g.arc(x + cr * 0.25, y + cr * 0.25, cr * 0.75, 0, TAU);
      g.fill();
    }
    celShade(g, 0, 0, r);
    g.restore();
    return c;
  }

  _makeClouds(seed) {
    const S = this.S, W = S * 2, H = S;
    const c = makeCanvas(W, H), g = c.getContext('2d');
    const R = mulberry32(777 + seed * 31);
    g.fillStyle = 'rgba(244,240,230,0.9)';
    for (let i = 0; i < 16; i++) {
      const x = R() * W, y = H * (0.15 + R() * 0.7), w = 30 + R() * 80, h = 6 + R() * 8;
      for (const X of [x, x - W, x + W]) {
        g.beginPath();
        g.roundRect(X - w / 2, y - h / 2, w, h, h / 2);
        g.fill();
      }
    }
    return c;
  }

  _makeSurface(tier, hue, seed) {
    const S = this.S, W = S * 2, H = S;
    const c = makeCanvas(W, H), g = c.getContext('2d');
    const R = mulberry32(seed);
    const rr = (a, b) => a + R() * (b - a);
    const k = TIER_SAT[tier] || 1;
    const wrap = (x, fn) => {
      fn(x);
      if (x < S) fn(x + W);
      if (x > W - S) fn(x - W);
    };
    const blob = (x, y, rx, ry, color, n = 11, jit = 0.28) => {
      g.fillStyle = color;
      wrap(x, (X) => {
        blobPath(g, X, y, rx, ry, n, jit, R);
        g.fill();
      });
    };
    const disc = (x, y, r, color) => {
      g.fillStyle = color;
      wrap(x, (X) => {
        g.beginPath();
        g.arc(X, y, r, 0, TAU);
        g.fill();
      });
    };
    // A crater is a dish: its near (top-left) wall is in shadow, its far wall catches the light.
    const crater = (x, y, r, shadowLevel, floorLevel) => {
      disc(x, y, r, tone(hue, k, shadowLevel));
      disc(x + r * 0.24, y + r * 0.24, r * 0.76, tone(hue, k, floorLevel));
    };
    const caps = (color) => {
      g.fillStyle = color;
      for (const top of [true, false]) {
        g.beginPath();
        const y0 = top ? 0 : H, dir = top ? 1 : -1, depth = H * 0.1;
        g.moveTo(0, y0);
        for (let x = 0; x <= W; x += 16) g.lineTo(x, y0 + dir * (depth + Math.sin((x / W) * TAU * 3 + (top ? 0 : 2)) * depth * 0.35));
        g.lineTo(W, y0);
        g.closePath();
        g.fill();
      }
    };

    switch (tier) {
      case 'asteroid': {
        g.fillStyle = tone(hue, k, 'mid');
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 8; i++) blob(R() * W, R() * H, rr(24, 60), rr(18, 40), tone(hue, k, R() < 0.5 ? 'base' : 'dark'));
        for (let i = 0; i < 7; i++) crater(R() * W, rr(30, H - 30), rr(8, 22), 'dark', 'mid');
        break;
      }
      case 'moon': {
        g.fillStyle = tone(hue, k, 'light');
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 4; i++) blob(R() * W, rr(50, H - 50), rr(40, 80), rr(26, 46), tone(hue, k, 'base'), 12, 0.3);
        for (let i = 0; i < 12; i++) crater(R() * W, rr(20, H - 20), rr(5, 20), 'mid', 'light');
        break;
      }
      case 'rocky': {
        g.fillStyle = tone(hue, k, 'base');
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 9; i++) blob(R() * W, rr(30, H - 30), rr(30, 70), rr(16, 34), tone(hue, k, ['mid', 'light', 'dark'][Math.floor(R() * 3)]));
        for (let i = 0; i < 5; i++) crater(R() * W, rr(40, H - 40), rr(4, 9), 'dark', 'base');
        caps(COLORS.bone);
        break;
      }
      case 'ocean': {
        g.fillStyle = tone(hue, k, 'mid');
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 4; i++) blob(R() * W, rr(40, H - 40), rr(40, 90), rr(20, 40), tone(hue, k, 'dark', 0.55));
        const landHue = hue > 60 && hue < 140 ? 36 : 96;
        for (let i = 0; i < 4; i++) {
          const x = R() * W, y = rr(H * 0.25, H * 0.75), rx = rr(40, 75), ry = rr(24, 44);
          blob(x, y, rx * 1.18, ry * 1.22, tone(hue, k, 'base'), 12, 0.22);
          blob(x, y, rx, ry, tone(landHue, 0.7, 'base'), 12, 0.3);
          blob(x + rr(-8, 8), y + rr(-6, 6), rx * 0.45, ry * 0.45, tone(landHue, 0.6, 'mid'), 9, 0.3);
        }
        caps(COLORS.bone);
        break;
      }
      case 'gas': {
        const levels = ['light', 'base', 'mid', 'base', 'light', 'dark', 'base', 'light', 'mid'];
        let y = -6, i = 0;
        const off = Math.floor(R() * levels.length);
        while (y < H) {
          const bh = rr(16, 40);
          g.fillStyle = tone(hue, k, levels[(i + off) % levels.length]);
          const amp = rr(1.5, 5), freq = 2 + Math.floor(R() * 4), ph = rr(0, TAU);
          g.beginPath();
          g.moveTo(0, y);
          for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin((x / W) * TAU * freq + ph) * amp);
          for (let x = W; x >= 0; x -= 16) g.lineTo(x, y + bh + 4 + Math.sin((x / W) * TAU * freq + ph + 1) * amp);
          g.closePath();
          g.fill();
          y += bh;
          i++;
        }
        const sx = R() * W, sy = rr(H * 0.58, H * 0.72);
        g.fillStyle = tone(hue, k, 'dark');
        wrap(sx, (X) => {
          g.beginPath();
          g.ellipse(X, sy, 30, 14, 0, 0, TAU);
          g.fill();
        });
        g.fillStyle = tone(hue + 12, k, 'light');
        wrap(sx, (X) => {
          g.beginPath();
          g.ellipse(X + 3, sy + 2, 18, 7, 0, 0, TAU);
          g.fill();
        });
        break;
      }
      case 'star': {
        g.fillStyle = hsl(hue, 92, 68);
        g.fillRect(0, 0, W, H);
        g.fillStyle = hsl(hue, 100, 82);
        for (let i = 0; i < 14; i++) {
          const x = R() * W, y = rr(20, H - 20), w = rr(30, 90), h = rr(5, 10);
          wrap(x, (X) => {
            g.beginPath();
            g.roundRect(X - w / 2, y - h / 2, w, h, h / 2);
            g.fill();
          });
        }
        for (let i = 0; i < 4; i++) {
          const x = R() * W, y = rr(H * 0.3, H * 0.7), r = rr(5, 10);
          disc(x, y, r * 1.7, hsl(hue - 8, 90, 56));
          disc(x, y, r, hsl(hue - 12, 80, 40));
        }
        break;
      }
      default: {
        g.fillStyle = tone(hue, k, 'base');
        g.fillRect(0, 0, W, H);
      }
    }
    return c;
  }
}
