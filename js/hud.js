'use strict';

/* DOM overlay: stats, leaderboard, minimap, event feed, banners, and the menu / how-to / death / pause screens. */
class Hud {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), tier: $('hud-tier'), rank: $('hud-rank'), mass: $('hud-mass'), bar: $('hud-bar'), next: $('hud-next'),
      board: $('hud-board'), feed: $('feed'), banner: $('banner'), hint: $('hint'),
      boost: $('btn-boost'), surge: $('btn-surge'), surgeCd: $('ab-surge-cd'),
      menu: $('menu'), howto: $('howto'), death: $('death'), pause: $('pause'),
      nameInput: $('name-input'), hueList: $('hue-list'), ladder: $('ladder'), best: $('best-line'),
      deathTitle: $('death-title'), deathSub: $('death-sub'), deathStats: $('death-stats'), deathSmall: $('death-small'),
      deathRecord: $('death-record'), mute: $('btn-mute'), pauseBtn: $('btn-pause'),
    };
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.ladderIcons = [];
    this.hueIcons = [];
    this._boardT = 0;
    this._miniT = 0;
    this._last = {};
    this.massShown = 0;
    $('btn-howto').addEventListener('click', () => this.setHowto(true));
    $('btn-howto-close').addEventListener('click', () => this.setHowto(false));
    this.el.howto.addEventListener('click', (e) => {
      if (e.target === this.el.howto) this.setHowto(false);
    });
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = this.mini.clientWidth || 168;
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
      btn.setAttribute('aria-label', `Color ${i + 1}`);
      btn.setAttribute('aria-pressed', String(hue === prefs.hue));
      const c = document.createElement('canvas');
      c.width = 88;
      c.height = 88;
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
      li.title = tier.perk;
      const c = document.createElement('canvas');
      c.width = 120;
      c.height = 120;
      const name = document.createElement('span');
      name.className = 't-name';
      name.textContent = tier.name;
      const min = document.createElement('span');
      min.className = 't-min';
      min.textContent = i === 0 ? 'start' : formatMass(tier.min);
      li.append(c, name, min);
      el.ladder.appendChild(li);
      this.ladderIcons.push({ canvas: c, tier: i });
    });

    this.setBest(best);
  }

  setBest(best) {
    if (!best) return;
    const name = TIERS[best.tier].name;
    this.el.best.innerHTML = `Your best: <b>${formatMass(best.mass)}</b> mass, ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${escapeHtml(name.toLowerCase())}, <b>${formatTime(best.time)}</b>`;
    this.el.best.hidden = false;
  }

  nameValue() {
    return this.el.nameInput.value.trim();
  }

  updateMenu(t, hue) {
    const r = this.game.renderer;
    for (const icon of this.ladderIcons) r.drawIcon(icon.canvas, icon.tier, hue, t);
    for (const icon of this.hueIcons) r.drawIcon(icon.canvas, 2, icon.hue, t);
  }

  setHowto(open) {
    this.el.howto.hidden = !open;
    if (open) document.getElementById('btn-howto-close').focus({ preventScroll: true });
    else if (!this.el.menu.hidden) document.getElementById('btn-howto').focus({ preventScroll: true });
  }

  get howtoOpen() {
    return !this.el.howto.hidden;
  }

  setScreen(state) {
    const { el } = this;
    el.menu.hidden = state !== 'menu';
    el.hud.hidden = state === 'menu';
    el.pause.hidden = state !== 'paused';
    el.pauseBtn.hidden = state !== 'playing';
    el.howto.hidden = true;
    document.body.classList.toggle('in-game', state !== 'menu');
    if (state === 'playing') this.resize();
    if (state !== 'playing') el.hint.classList.remove('show');
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
    document.getElementById('tg-sound').setAttribute('aria-pressed', String(!muted));
  }

  setMusic(on) {
    document.getElementById('tg-music').setAttribute('aria-pressed', String(on));
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
    while (this.el.feed.children.length > 5) this.el.feed.firstChild.remove();
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
    b.innerHTML = `${eyebrow ? `<div class="b-eyebrow">${eyebrow}</div>` : ''}<div class="b-title">${title}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    void b.offsetWidth; // restart the animation
    b.className = `banner show ${kind}`;
  }

  _set(key, el, value, html = false) {
    if (this._last[key] !== value) {
      this._last[key] = value;
      if (html) el.innerHTML = value;
      else el.textContent = value;
    }
  }

  update(dt, world, player, state) {
    if (state === 'menu' || !player) return;
    const { el } = this;
    const p = player;

    this.massShown += (p.mass - this.massShown) * Math.min(1, dt * 10);
    this._set('mass', el.mass, formatMass(this.massShown));
    this._set('tier', el.tier, TIERS[p.tier].name);
    this._set('rank', el.rank, p.alive ? `#${p.rank}<span class="of"> of ${world.bodies.length}</span>` : '—', true);
    const cur = TIERS[p.tier], next = TIERS[p.tier + 1];
    const frac = next ? clamp((p.mass - cur.min) / (next.min - cur.min), 0, 1) : 1;
    const w = `${(frac * 100).toFixed(1)}%`;
    if (this._last.bar !== w) {
      this._last.bar = w;
      el.bar.style.width = w;
    }
    this._set('next', el.next, next ? `${next.name} at ${formatMass(next.min)}` : 'Nothing out there is heavier');

    el.boost.classList.toggle('active', p.boosting);
    el.boost.classList.toggle('disabled', p.mass <= CONFIG.BOOST_MIN_MASS);
    const cd = p.surgeCd > 0 && p.surgeT <= 0 ? p.surgeCd / CONFIG.SURGE_COOLDOWN : 0;
    el.surge.style.setProperty('--cd', cd.toFixed(3));
    el.surge.classList.toggle('active', p.surgeT > 0);
    el.surge.classList.toggle('cooling', cd > 0);
    this._set('surgeCd', el.surgeCd, cd > 0 ? String(Math.ceil(p.surgeCd)) : '');

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
      return `<li class="${cls}"><span class="pos">${b.rank}</span><span class="dot" style="background:${tone(b.hue, 1, 'base')}"></span>` +
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
    const c = S / 2, sc = (S / 2 - 8) / world.R;

    g.strokeStyle = 'rgba(241,234,217,0.14)';
    g.lineWidth = 1.5;
    g.setLineDash([1, 5]);
    g.lineCap = 'round';
    g.beginPath();
    g.arc(c, c, world.R * sc, 0, TAU);
    g.stroke();
    g.beginPath();
    g.arc(c, c, world.R * CONFIG.BELT_RADIUS * sc, 0, TAU);
    g.stroke();
    g.setLineDash([]);

    for (const n of world.nebulae) {
      g.fillStyle = hsl(n.hue, 45, 45, 0.22);
      g.beginPath();
      g.arc(c + n.x * sc, c + n.y * sc, n.r * 0.8 * sc, 0, TAU);
      g.fill();
    }
    for (const w of world.wormholes) {
      g.strokeStyle = tone(w.hue, 1, 'light');
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(c + w.x * sc, c + w.y * sc, 3, 0, TAU);
      g.stroke();
    }
    g.fillStyle = COLORS.bone;
    for (const f of world.comets) g.fillRect(c + f.x * sc - 1, c + f.y * sc - 1, 2, 2);

    const blink = Math.sin(performance.now() / 120) > 0;
    for (const sn of world.supernovae) {
      g.fillStyle = blink ? COLORS.threat : COLORS.bone;
      g.beginPath();
      g.arc(c + sn.x * sc, c + sn.y * sc, 3.5, 0, TAU);
      g.fill();
    }

    for (const b of world.bodies) {
      if (b === p) continue;
      if (b.inNebula && p.alive && Math.hypot(b.x - p.x, b.y - p.y) > 600) continue;
      let color = 'rgba(241,234,217,0.55)';
      if (p.alive && b.canEat(p)) color = COLORS.threat;
      else if (p.alive && p.canEat(b)) color = COLORS.prey;
      g.fillStyle = color;
      g.beginPath();
      g.arc(c + b.x * sc, c + b.y * sc, Math.max(1.8, b.r * sc), 0, TAU);
      g.fill();
    }

    if (p.alive) {
      const view = this.game.viewSize();
      g.strokeStyle = 'rgba(241,234,217,0.3)';
      g.lineWidth = 1;
      g.strokeRect(c + (p.x - view.w / 2) * sc, c + (p.y - view.h / 2) * sc, view.w * sc, view.h * sc);
      g.fillStyle = COLORS.ember;
      g.beginPath();
      g.arc(c + p.x * sc, c + p.y * sc, Math.max(3, p.r * sc), 0, TAU);
      g.fill();
    }
  }

  /* ---------- death ---------- */

  showDeath(info) {
    const { el } = this;
    const a = (word) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word.toLowerCase()}`;
    el.deathTitle.textContent = 'Absorbed';
    el.deathSub.innerHTML = `<b>${escapeHtml(info.killer)}</b>, ${a(info.killerTier)} of ${formatMass(info.killerMass)}, pulled you in.`;
    const big = [
      ['survived', formatTime(info.time)],
      ['peak mass', formatMass(info.peakMass)],
      [info.bodies === 1 ? 'body eaten' : 'bodies eaten', String(info.bodies)],
    ];
    el.deathStats.innerHTML = big.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    const bits = [`Peaked as ${a(info.peakTier)}`];
    if (info.bestRank < 999) bits.push(`best rank #${info.bestRank}`);
    bits.push(`${formatMass(info.dust)} stardust`);
    if (info.comets) bits.push(`${info.comets} ${info.comets === 1 ? 'comet or pulsar' : 'comets and pulsars'}`);
    el.deathSmall.textContent = `${bits.join(' · ')}.`;
    el.deathRecord.hidden = !info.record;
    el.death.hidden = false;
    if (!document.body.classList.contains('touch')) {
      setTimeout(() => document.getElementById('btn-again').focus({ preventScroll: true }), 50);
    }
  }
}
