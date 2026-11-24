'use strict';

/*
 * Procedural art. Planet surfaces are equirectangular-ish strips (2:1) that the renderer scrolls
 * inside a circular clip, which reads as a rotating sphere once the shading overlay is on top.
 */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

class TextureBank {
  constructor() {
    this.S = 256;
    this.surfaces = new Map();
    this.glows = new Map();
    this.shade = this._makeShade(256);
    this.starShade = this._makeStarShade(256);
    this.clouds = [0, 1, 2].map((i) => this._makeClouds(i));
    this.dust = DUST_COLORS.map(([h, s, l]) => this._makeDot(h, s, l));
    this.rocks = [];
    for (let i = 0; i < 16; i++) this.rocks.push(this._makeRockSprite(i));
    this.spirals = new Map();
  }

  spiral(hue) {
    let c = this.spirals.get(hue);
    if (!c) {
      c = this._makeSpiral(hue);
      this.spirals.set(hue, c);
    }
    return c;
  }

  /* ---------- cached lookups ---------- */

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

  /* Soft round glow in a given colour. Hue is bucketed so the cache stays small. */
  glow(hue, sat = 90, light = 65) {
    const h = Math.round((((hue % 360) + 360) % 360) / 12) * 12;
    const key = `${h}|${sat}|${light}`;
    let c = this.glows.get(key);
    if (!c) {
      c = makeCanvas(64, 64);
      const g = c.getContext('2d');
      // Ends 2px inside the canvas so no faint edge survives upscaling as a visible square
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
      grd.addColorStop(0, hsl(h, sat, Math.min(96, light + 25), 1));
      grd.addColorStop(0.18, hsl(h, sat, light, 0.75));
      grd.addColorStop(0.45, hsl(h, sat, light - 10, 0.22));
      grd.addColorStop(0.75, hsl(h, sat, light - 15, 0.05));
      grd.addColorStop(1, hsl(h, sat, light - 20, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      this.glows.set(key, c);
    }
    return c;
  }

  /* ---------- generators ---------- */

  _makeShade(S) {
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, TAU);
    g.clip();
    const grd = g.createRadialGradient(S * 0.34, S * 0.3, S * 0.02, S * 0.46, S * 0.44, S * 0.66);
    grd.addColorStop(0, 'rgba(255,255,255,0.22)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.0)');
    grd.addColorStop(0.62, 'rgba(2,3,14,0.35)');
    grd.addColorStop(0.85, 'rgba(2,3,14,0.78)');
    grd.addColorStop(1, 'rgba(2,3,14,0.92)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    // faint rim light on the lit side
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(190,210,255,0.10)';
    g.lineWidth = S * 0.025;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - S * 0.012, Math.PI * 0.85, Math.PI * 1.65);
    g.stroke();
    return c;
  }

  _makeStarShade(S) {
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,240,0.55)');
    grd.addColorStop(0.55, 'rgba(255,240,210,0.12)');
    grd.addColorStop(0.9, 'rgba(120,40,0,0.18)');
    grd.addColorStop(1, 'rgba(90,20,0,0.45)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, TAU);
    g.fill();
    return c;
  }

  _makeDot(h, s, l) {
    const c = makeCanvas(32, 32);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, hsl(h, s, 97, 1));
    grd.addColorStop(0.2, hsl(h, s, l, 0.95));
    grd.addColorStop(0.5, hsl(h, s, l - 10, 0.25));
    grd.addColorStop(1, hsl(h, s, l - 20, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    return c;
  }

  _makeRockSprite(i) {
    const S = 64, c = makeCanvas(S, S), g = c.getContext('2d');
    const R = mulberry32(9001 + i * 77);
    const shape = makeRockShape(11, 0.35, R);
    const hue = 20 + R() * 25;
    g.translate(S / 2, S / 2);
    g.beginPath();
    for (let k = 0; k < shape.length; k++) {
      const a = (k / shape.length) * TAU, rr = (S / 2 - 3) * shape[k];
      if (k === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    const grd = g.createRadialGradient(-8, -10, 2, 0, 0, S / 2);
    grd.addColorStop(0, hsl(hue, 14, 62));
    grd.addColorStop(0.6, hsl(hue, 12, 38));
    grd.addColorStop(1, hsl(hue, 14, 20));
    g.fillStyle = grd;
    g.fill();
    g.save();
    g.clip();
    for (let k = 0; k < 6; k++) {
      const x = (R() - 0.5) * S * 0.6, y = (R() - 0.5) * S * 0.6, r = 2 + R() * 5;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.arc(x + r * 0.25, y + r * 0.25, r * 0.8, 0, TAU);
      g.fill();
    }
    g.restore();
    g.strokeStyle = 'rgba(255,230,200,0.18)';
    g.lineWidth = 1.5;
    g.stroke();
    return c;
  }

  _makeClouds(seed) {
    const S = this.S, W = S * 2, H = S;
    const c = makeCanvas(W, H), g = c.getContext('2d');
    const R = mulberry32(777 + seed * 31);
    const wrap = (x, fn) => {
      fn(x);
      if (x < S * 0.6) fn(x + W);
      if (x > W - S * 0.6) fn(x - W);
    };
    for (let i = 0; i < 70; i++) {
      const x = R() * W, y = H * (0.12 + R() * 0.76);
      const rx = 14 + R() * 60, ry = 4 + R() * 10;
      const a = 0.12 + R() * 0.3;
      wrap(x, (X) => {
        g.fillStyle = `rgba(255,255,255,${a})`;
        g.beginPath();
        g.ellipse(X, y, rx, ry, (R() - 0.5) * 0.3, 0, TAU);
        g.fill();
      });
    }
    return c;
  }

  _makeSpiral(hue) {
    const S = 256, c = makeCanvas(S, S), g = c.getContext('2d');
    g.translate(S / 2, S / 2);
    g.globalCompositeOperation = 'lighter';
    for (let arm = 0; arm < 3; arm++) {
      const off = (arm / 3) * TAU;
      for (let i = 0; i < 140; i++) {
        const t = i / 140;
        const r = 8 + t * (S / 2 - 12);
        const a = off + t * 5.2;
        const alpha = (1 - t) * 0.5 + 0.05;
        g.fillStyle = hsl(hue + t * 40, 90, 55 + (1 - t) * 30, alpha * 0.4);
        g.beginPath();
        g.arc(Math.cos(a) * r, Math.sin(a) * r, 2 + (1 - t) * 6, 0, TAU);
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
    const wrap = (x, fn) => {
      fn(x);
      if (x < S * 0.5) fn(x + W);
      if (x > W - S * 0.5) fn(x - W);
    };
    const disc = (x, y, r, color) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    };
    const softBlob = (x, y, r, h, s, l, a) => {
      wrap(x, (X) => {
        const grd = g.createRadialGradient(X, y, 0, X, y, r);
        grd.addColorStop(0, hsl(h, s, l, a));
        grd.addColorStop(1, hsl(h, s, l, 0));
        g.fillStyle = grd;
        g.fillRect(X - r, y - r, r * 2, r * 2);
      });
    };
    const crater = (x, y, r, h, l) => {
      wrap(x, (X) => {
        disc(X, y, r, hsl(h, 8, l - 14, 0.55));
        g.strokeStyle = hsl(h, 8, l + 16, 0.45);
        g.lineWidth = Math.max(1, r * 0.22);
        g.beginPath();
        g.arc(X, y, r * 0.92, Math.PI * 0.05, Math.PI * 0.95);
        g.stroke();
        g.strokeStyle = hsl(h, 8, l - 22, 0.45);
        g.beginPath();
        g.arc(X, y, r * 0.92, Math.PI * 1.05, Math.PI * 1.95);
        g.stroke();
      });
    };
    const continent = (x, y, size, n, color) => {
      let px = x, py = y;
      g.fillStyle = color;
      for (let i = 0; i < n; i++) {
        px += (R() - 0.5) * size * 0.7;
        py += (R() - 0.5) * size * 0.35;
        py = clamp(py, H * 0.12, H * 0.88);
        const r = size * (0.12 + R() * 0.22);
        wrap(px, (X) => {
          g.beginPath();
          g.arc(X, py, r, 0, TAU);
          g.fill();
        });
      }
    };

    switch (tier) {
      case 'asteroid': {
        g.fillStyle = hsl(hue, 10, 32);
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 900; i++) {
          const x = R() * W, y = R() * H;
          disc(x, y, rr(0.8, 3.5), hsl(hue, 8, rr(18, 48), 0.5));
        }
        for (let i = 0; i < 28; i++) crater(R() * W, rr(10, H - 10), rr(5, 22), hue, 32);
        break;
      }
      case 'moon': {
        g.fillStyle = hsl(hue, 7, 60);
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 9; i++) softBlob(R() * W, rr(30, H - 30), rr(30, 80), hue, 8, 40, 0.55);
        for (let i = 0; i < 700; i++) disc(R() * W, R() * H, rr(0.6, 2.2), hsl(hue, 6, rr(45, 75), 0.35));
        for (let i = 0; i < 46; i++) crater(R() * W, rr(8, H - 8), rr(3, 20), hue, 58);
        break;
      }
      case 'rocky': {
        g.fillStyle = hsl(hue, 42, 38);
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 46; i++) softBlob(R() * W, R() * H, rr(18, 70), hue + rr(-20, 20), rr(30, 55), rr(26, 52), 0.7);
        g.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          let x = R() * W, y = rr(30, H - 30);
          g.strokeStyle = hsl(hue, 40, 20, 0.55);
          g.lineWidth = rr(1.5, 3.5);
          g.beginPath();
          g.moveTo(x, y);
          for (let k = 0; k < 9; k++) {
            x += rr(6, 22);
            y += rr(-10, 10);
            g.lineTo(x, y);
          }
          g.stroke();
        }
        for (let i = 0; i < 12; i++) crater(R() * W, rr(20, H - 20), rr(3, 10), hue, 42);
        const cap = g.createLinearGradient(0, 0, 0, H);
        cap.addColorStop(0, 'rgba(245,248,255,0.9)');
        cap.addColorStop(0.09, 'rgba(245,248,255,0)');
        cap.addColorStop(0.91, 'rgba(245,248,255,0)');
        cap.addColorStop(1, 'rgba(245,248,255,0.9)');
        g.fillStyle = cap;
        g.fillRect(0, 0, W, H);
        break;
      }
      case 'ocean': {
        const sea = g.createLinearGradient(0, 0, 0, H);
        sea.addColorStop(0, hsl(hue, 55, 26));
        sea.addColorStop(0.5, hsl(hue, 70, 36));
        sea.addColorStop(1, hsl(hue, 55, 26));
        g.fillStyle = sea;
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 30; i++) softBlob(R() * W, R() * H, rr(20, 60), hue + rr(-10, 10), 70, rr(30, 48), 0.5);
        const landHue = lerp(105, hue, 0.2);
        for (let i = 0; i < 6; i++) {
          const x = R() * W, y = rr(H * 0.2, H * 0.8), size = rr(50, 110);
          continent(x, y, size, 16, hsl(landHue, 32, 22, 0.95));
          continent(x, y, size * 0.85, 12, hsl(landHue + rr(-25, 10), 40, 36));
          continent(x + rr(-10, 10), y, size * 0.5, 8, hsl(42, 38, 52, 0.8));
        }
        const cap = g.createLinearGradient(0, 0, 0, H);
        cap.addColorStop(0, 'rgba(250,252,255,0.95)');
        cap.addColorStop(0.07, 'rgba(250,252,255,0)');
        cap.addColorStop(0.93, 'rgba(250,252,255,0)');
        cap.addColorStop(1, 'rgba(250,252,255,0.95)');
        g.fillStyle = cap;
        g.fillRect(0, 0, W, H);
        break;
      }
      case 'gas': {
        let y = 0;
        while (y < H) {
          const bh = rr(6, 26);
          g.fillStyle = hsl(hue + rr(-28, 28), rr(35, 65), rr(34, 72));
          g.beginPath();
          g.moveTo(0, y);
          const amp = rr(1, 4), freq = randInt(2, 6);
          for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin((x / W) * TAU * freq) * amp);
          for (let x = W; x >= 0; x -= 16) g.lineTo(x, y + bh + 3 + Math.sin((x / W) * TAU * freq + 1) * amp);
          g.closePath();
          g.fill();
          y += bh;
        }
        for (let i = 0; i < 40; i++) {
          const x = R() * W, yy = R() * H;
          wrap(x, (X) => {
            g.fillStyle = hsl(hue + rr(-20, 20), 40, rr(50, 85), 0.18);
            g.beginPath();
            g.ellipse(X, yy, rr(10, 40), rr(1.5, 4), 0, 0, TAU);
            g.fill();
          });
        }
        const sx = R() * W, sy = rr(H * 0.55, H * 0.75);
        wrap(sx, (X) => {
          g.fillStyle = hsl(hue + 18, 70, 38, 0.85);
          g.beginPath();
          g.ellipse(X, sy, 28, 13, 0, 0, TAU);
          g.fill();
          g.strokeStyle = hsl(hue + 25, 60, 70, 0.6);
          g.lineWidth = 3;
          g.stroke();
          g.fillStyle = hsl(hue + 10, 75, 55, 0.7);
          g.beginPath();
          g.ellipse(X - 3, sy - 1, 14, 6, 0, 0, TAU);
          g.fill();
        });
        break;
      }
      case 'star': {
        g.fillStyle = hsl(hue, 95, 62);
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 1400; i++) {
          const x = R() * W, y = R() * H, r = rr(2, 7);
          disc(x, y, r, R() < 0.5 ? hsl(hue + rr(-8, 8), 100, rr(70, 88), 0.35) : hsl(hue - 10, 100, rr(40, 52), 0.25));
        }
        for (let i = 0; i < 5; i++) {
          const x = R() * W, y = rr(H * 0.3, H * 0.7), r = rr(4, 9);
          wrap(x, (X) => {
            disc(X, y, r * 1.8, hsl(hue - 10, 90, 38, 0.45));
            disc(X, y, r, hsl(hue - 15, 80, 18, 0.8));
          });
        }
        break;
      }
      default: {
        g.fillStyle = hsl(hue, 30, 40);
        g.fillRect(0, 0, W, H);
      }
    }
    return c;
  }
}
