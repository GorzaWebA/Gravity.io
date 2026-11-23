'use strict';

/* All sound is synthesized with WebAudio, so the game ships with no audio files. */
class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = !!storageGet('gravity.muted', false);
    this.lastPlay = {};
    this.boostGain = null;
  }

  /* Browsers only allow audio after a user gesture, so this is called from the Play button. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this._startAmbient();
    this._startBoostLoop();
  }

  toggleMute() {
    this.muted = !this.muted;
    storageSet('gravity.muted', this.muted);
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  _startAmbient() {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 2;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.05;
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    for (const [f, type] of [[55, 'sawtooth'], [82.4, 'sawtooth'], [110.3, 'triangle']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = rand(-8, 8);
      o.connect(filter);
      o.start();
    }
    filter.connect(gain);
    gain.connect(this.master);
    lfo.start();
  }

  _startBoostLoop() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.8;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    src.connect(filter);
    filter.connect(this.boostGain);
    this.boostGain.connect(this.master);
    src.start();
  }

  setBoost(on) {
    if (!this.boostGain) return;
    this.boostGain.gain.setTargetAtTime(on ? 0.09 : 0, this.ctx.currentTime, on ? 0.04 : 0.12);
  }

  _throttle(name, ms) {
    const now = performance.now();
    if (this.lastPlay[name] && now - this.lastPlay[name] < ms) return false;
    this.lastPlay[name] = now;
    return true;
  }

  _tone(type, f0, f1, dur, vol, delay = 0) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noise(dur, vol, freq, type = 'lowpass', delay = 0) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.25), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /* `vol` lets far-away events play quieter. */
  play(name, vol = 1) {
    if (!this.ctx || this.muted || vol <= 0.02) return;
    switch (name) {
      case 'dust':
        if (!this._throttle(name, 45)) return;
        this._tone('sine', rand(700, 1100), rand(1200, 1600), 0.07, 0.05 * vol);
        break;
      case 'rock':
        if (!this._throttle(name, 60)) return;
        this._tone('triangle', 320, 140, 0.14, 0.12 * vol);
        break;
      case 'absorb':
        this._tone('sine', 240, 50, 0.5, 0.35 * vol);
        this._noise(0.35, 0.18 * vol, 1400);
        break;
      case 'bigEat':
        this._tone('triangle', 520, 1040, 0.25, 0.18 * vol);
        this._tone('sine', 780, 1560, 0.3, 0.12 * vol, 0.06);
        break;
      case 'tierUp':
        [0, 4, 7, 12, 16].forEach((st, i) => this._tone('triangle', 330 * Math.pow(2, st / 12), 330 * Math.pow(2, st / 12) * 1.01, 0.5, 0.14, i * 0.08));
        break;
      case 'tierDown':
        this._tone('sine', 300, 150, 0.6, 0.15);
        break;
      case 'surge':
        this._tone('sine', 110, 38, 1.1, 0.4 * vol);
        this._noise(0.9, 0.12 * vol, 500);
        break;
      case 'collide':
        if (!this._throttle(name, 120)) return;
        this._noise(0.18, 0.3 * vol, 2200);
        this._tone('square', 140, 60, 0.12, 0.06 * vol);
        break;
      case 'warn':
        this._tone('square', 880, 880, 0.12, 0.07);
        this._tone('square', 660, 660, 0.12, 0.07, 0.18);
        break;
      case 'supernova':
        this._noise(2.4, 0.6 * vol, 3200);
        this._tone('sine', 70, 28, 2, 0.5 * vol);
        break;
      case 'wormhole':
        this._tone('sine', 200, 1400, 0.45, 0.16);
        this._tone('triangle', 300, 2000, 0.45, 0.08, 0.04);
        break;
      case 'death':
        this._tone('sawtooth', 320, 40, 1.4, 0.2);
        this._noise(1.2, 0.2, 900);
        break;
    }
  }
}
