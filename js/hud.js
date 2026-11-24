'use strict';

/* DOM overlay: stats, leaderboard, minimap, event feed, banners, and the menu/death/pause screens. */
class Hud {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), tier: $('hud-tier'), rank: $('hud-rank'), mass: $('hud-mass'), bar: $('hud-bar'), next: $('hud-next'),
      board: $('hud-board'), feed: $('feed'), banner: $('banner'), boost: $('ab-boost'), surge: $('ab-surge'),
      surgeCd: $('ab-surge-cd'), touchSurge: $('btn-surge'), menu: $('menu'), death: $('death'), pause: $('pause'),
      nameInput: $('name-input'), hueList: $('hue-list'), ladder: $('ladder'), best: $('best-line'),
      deathTitle: $('death-title'), deathSub: $('death-sub'), deathStats: $('death-stats'), deathRecord: $('death-record'),
      mute: $('btn-mute'), pauseBtn: $('btn-pause'), touchBoost: $('btn-boost'), hint: $('hint'),
    };
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.ladderIcons = [];
    this.hueIcons = [];
    this._boardT = 0;
    this._miniT = 0;
    this._bannerTimer = null;
    this._last = {};
    this.massShown = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = this.mini.clientWidth || 172;
    this.mini.width = Math.round(size * dpr);
    this.mini.height = Math.round(size * dpr);
    this.miniSize = size;
    this.miniDpr = dpr;
  }

  /* ---------- menu ---------- */

  initMenu(prefs, best) {
    const { el } = this;
    el.nameInput.value = prefs.name || '';

    el.hueList.innerHTML = '';
    this.hueIcons = [];
    PLAYER_HUES.forEach((hue, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hue-btn';
      btn.setAttribute('aria-label', `Surface color ${i + 1}`);
      btn.setAttribute('aria-pressed', String(hue === prefs.hue));
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 80;
      btn.appendChild(c);
      btn.addEventListener('click', () => {
        this.game.setHue(hue);
        el.hueList.querySelectorAll('.hue-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
      });
      el.hueList.appendChild(btn);
      this.hueIcons.push({ canvas: c, hue });
    });

    el.ladder.innerHTML = '';
    this.ladderIcons = [];
    TIERS.forEach((tier, i) => {
      const li = document.createElement('li');
      const c = document.createElement('canvas');
      c.width = 104;
      c.height = 104;
      const text = document.createElement('div');
      text.innerHTML = `<div class="l-name">${tier.name}</div><div class="l-perk">${tier.perk}</div>`;
      const min = document.createElement('div');
      min.className = 'l-min';
      min.textContent = i === 0 ? 'start' : formatMass(tier.min);
      li.append(c, text, min);
      el.ladder.appendChild(li);
      this.ladderIcons.push({ canvas: c, tier: i });
    });

    this.setBest(best);
  }

  setBest(best) {
    if (!best) return;
    const name = TIERS[best.tier].name;
    this.el.best.innerHTML = `Best run: <b>${formatMass(best.mass)}</b> mass as ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${escapeHtml(name)}, ` +
      `survived <b>${formatTime(best.time)}</b>.`;
  }

  nameValue() {
    return this.el.nameInput.value.trim();
  }

  updateMenu(t, hue) {
    const r = this.game.renderer;
    for (const icon of this.ladderIcons) r.drawIcon(icon.canvas, icon.tier, hue, t);
    for (const icon of this.hueIcons) r.drawIcon(icon.canvas, 2, icon.hue, t);
  }

  setScreen(state) {
    const { el } = this;
    el.menu.hidden = state !== 'menu';
    el.hud.hidden = state === 'menu';
    el.pause.hidden = state !== 'paused';
    el.pauseBtn.hidden = state !== 'playing';
    document.body.classList.toggle('in-game', state !== 'menu');
    if (state === 'playing') this.resize();
    if (state !== 'playing') this.el.hint.classList.remove('show');
    if (state !== 'dead') el.death.hidden = true;
    if (state === 'menu') {
      el.feed.innerHTML = '';
      // Focusing the name field on a phone would pop the keyboard up over the menu
      if (!document.body.classList.contains('touch')) setTimeout(() => el.nameInput.focus({ preventScroll: true }), 50);
    }
  }

  setMuted(muted) {
    this.el.mute.classList.toggle('muted', muted);
    this.el.mute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  }

  /* ---------- in-game ---------- */

  reset() {
    this.el.feed.innerHTML = '';
    this.el.banner.className = 'banner';
    this._last = {};
    this.massShown = CONFIG.START_MASS;
  }

  feed(html, kind = '') {
    const line = document.createElement('div');
    line.className = `feed-line ${kind}`;
    line.innerHTML = html;
    this.el.feed.appendChild(line);
    while (this.el.feed.children.length > 6) this.el.feed.firstChild.remove();
    setTimeout(() => line.remove(), 6100);
  }

  hint(text, seconds) {
    const h = this.el.hint;
    h.textContent = text;
    h.classList.add('show');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => h.classList.remove('show'), seconds * 1000);
  }

  banner(eyebrow, title, sub, kind = '') {
    const b = this.el.banner;
    b.className = 'banner';
    b.innerHTML = `<div class="b-eyebrow">${eyebrow}</div><div class="b-title">${title}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    void b.offsetWidth; // restart the animation
    b.className = `banner show ${kind}`;
  }

  _set(key, el, value) {
    if (this._last[key] !== value) {
      this._last[key] = value;
      el.textContent = value;
    }
  }

  update(dt, world, player, state) {
    if (state === 'menu' || !player) return;
    const { el } = this;
    const p = player;

    this.massShown += (p.mass - this.massShown) * Math.min(1, dt * 10);
    this._set('mass', el.mass, formatMass(this.massShown));
    this._set('tier', el.tier, TIERS[p.tier].name);
    const rank = p.alive ? `#${p.rank}<span class="of"> of ${world.bodies.length}</span>` : '—';
    if (this._last.rank !== rank) {
      this._last.rank = rank;
      el.rank.innerHTML = rank;
    }
    const cur = TIERS[p.tier], next = TIERS[p.tier + 1];
    const frac = next ? clamp((p.mass - cur.min) / (next.min - cur.min), 0, 1) : 1;
    const w = `${(frac * 100).toFixed(1)}%`;
    if (this._last.bar !== w) {
      this._last.bar = w;
      el.bar.style.width = w;
    }
    this._set('next', el.next, next ? `${next.name} at ${formatMass(next.min)}` : 'Nothing in the system is heavier');

    el.boost.classList.toggle('active', p.boosting);
    el.boost.classList.toggle('disabled', p.mass <= CONFIG.BOOST_MIN_MASS);
    const cd = p.surgeCd > 0 ? p.surgeCd / CONFIG.SURGE_COOLDOWN : 0;
    el.surge.style.setProperty('--cd', cd.toFixed(3));
    el.surge.classList.toggle('active', p.surgeT > 0);
    el.surge.classList.toggle('ready', p.surgeCd <= 0);
    this._set('surgeCd', el.surgeCd, p.surgeT > 0 ? 'pulling' : p.surgeCd > 0 ? `${Math.ceil(p.surgeCd)}s` : 'ready');
    el.touchSurge.classList.toggle('cooling', p.surgeCd > 0);
    el.touchSurge.style.setProperty('--cd', cd.toFixed(3));
    el.touchBoost.classList.toggle('active', p.boosting);

    this._boardT -= dt;
    if (this._boardT <= 0) {
      this._boardT = 0.25;
      this._drawBoard(world, p);
    }
    this._miniT -= dt;
    if (this._miniT <= 0) {
      this._miniT = 1 / 12;
      this._drawMinimap(world, p);
    }
  }

  _drawBoard(world, p) {
    const rows = world.ranked.slice(0, 8);
    let html = '';
    const row = (b) => {
      let cls = '';
      if (b === p) cls = 'you';
      else if (p.alive && b.canEat(p)) cls = 'threat';
      else if (p.alive && p.canEat(b)) cls = 'prey';
      return `<li class="${cls}"><span class="pos">${b.rank}</span><span class="dot" style="background:${hsl(b.hue, 70, 62)}"></span>` +
        `<span class="who">${escapeHtml(b.name)}</span><span class="m">${formatMass(b.mass)}</span></li>`;
    };
    for (const b of rows) html += row(b);
    if (p.alive && p.rank > rows.length) html += `<li class="gap">···</li>${row(p)}`;
    if (this._last.board !== html) {
      this._last.board = html;
      this.el.board.innerHTML = html;
    }
  }

  _drawMinimap(world, p) {
    const g = this.mctx, S = this.miniSize, dpr = this.miniDpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const c = S / 2, sc = (S / 2 - 3) / world.R;

    g.fillStyle = 'rgba(9,12,28,0.72)';
    g.beginPath();
    g.arc(c, c, S / 2 - 1, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(150,172,255,0.22)';
    g.lineWidth = 1;
    g.stroke();

    g.strokeStyle = 'rgba(200,170,140,0.12)';
    g.lineWidth = Math.max(2, CONFIG.BELT_WIDTH * 2 * sc);
    g.beginPath();
    g.arc(c, c, world.R * CONFIG.BELT_RADIUS * sc, 0, TAU);
    g.stroke();

    for (const n of world.nebulae) {
      g.fillStyle = hsl(n.hue, 70, 55, 0.16);
      g.beginPath();
      g.arc(c + n.x * sc, c + n.y * sc, n.r * 0.8 * sc, 0, TAU);
      g.fill();
    }

    for (const w of world.wormholes) {
      g.strokeStyle = hsl(w.hue, 90, 70, 0.9);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(c + w.x * sc, c + w.y * sc, 3, 0, TAU);
      g.stroke();
    }

    for (const f of world.comets) {
      g.fillStyle = 'rgba(190,240,255,0.9)';
      g.fillRect(c + f.x * sc - 1, c + f.y * sc - 1, 2, 2);
    }

    const blink = Math.sin(performance.now() / 120) > 0;
    for (const sn of world.supernovae) {
      g.fillStyle = blink ? 'rgba(255,120,100,1)' : 'rgba(255,200,150,0.6)';
      g.beginPath();
      g.arc(c + sn.x * sc, c + sn.y * sc, 4, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(255,110,130,0.5)';
      g.beginPath();
      g.arc(c + sn.x * sc, c + sn.y * sc, CONFIG.SUPERNOVA_BLAST * sc, 0, TAU);
      g.stroke();
    }

    for (const b of world.bodies) {
      if (b === p) continue;
      if (b.inNebula && p.alive && Math.hypot(b.x - p.x, b.y - p.y) > 600) continue;
      let color = 'rgba(200,208,235,0.65)';
      if (p.alive && b.canEat(p)) color = 'rgba(255,111,134,0.95)';
      else if (p.alive && p.canEat(b)) color = 'rgba(128,240,200,0.9)';
      g.fillStyle = color;
      g.beginPath();
      g.arc(c + b.x * sc, c + b.y * sc, Math.max(1.6, b.r * sc), 0, TAU);
      g.fill();
    }

    if (p.alive) {
      const view = this.game.viewSize();
      g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.lineWidth = 1;
      g.strokeRect(c + (p.x - view.w / 2) * sc, c + (p.y - view.h / 2) * sc, view.w * sc, view.h * sc);
      g.fillStyle = '#ffc47e';
      g.beginPath();
      g.arc(c + p.x * sc, c + p.y * sc, Math.max(2.6, p.r * sc), 0, TAU);
      g.fill();
      g.strokeStyle = '#fff';
      g.stroke();
    }
  }

  /* ---------- death ---------- */

  showDeath(info) {
    const { el } = this;
    el.deathTitle.textContent = `${info.killer} pulled you in`;
    const a = (word) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word.toLowerCase()}`;
    const sub = `${a(info.killerTier)} of ${formatMass(info.killerMass)} mass. You peaked as ${a(info.peakTier)}.`;
    el.deathSub.textContent = sub.charAt(0).toUpperCase() + sub.slice(1);
    const stats = [
      ['Survived', formatTime(info.time)],
      ['Peak mass', formatMass(info.peakMass)],
      ['Best rank', info.bestRank < 999 ? `#${info.bestRank}` : '—'],
      ['Bodies absorbed', String(info.bodies)],
      ['Stardust', formatMass(info.dust)],
      ['Comets & pulsars', String(info.comets)],
    ];
    el.deathStats.innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    el.deathRecord.hidden = !info.record;
    el.death.hidden = false;
    if (!document.body.classList.contains('touch')) {
      setTimeout(() => document.getElementById('btn-again').focus({ preventScroll: true }), 50);
    }
  }
}
