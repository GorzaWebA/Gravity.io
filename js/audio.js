'use strict';

/*
 * Gravity.io sound design. Everything is synthesized at runtime; no audio files.
 *
 * The rules, the sonic twin of the art rules in textures.js:
 *  - One key. Every pitched sound is in D major pentatonic (D E F# A B), so nothing ever
 *    clashes with the music or with anything else, and a run of pickups plays a tune.
 *  - Toys in a big room. Pickups are glassy FM "mallets"; mass is soft sub-bass; whooshes are
 *    filtered noise. Everything shares one generated reverb, so it all sits in the same space.
 *  - The music grows with you. Each form unlocks another layer, a black hole turns the harmony
 *    minor and adds a heartbeat, and being absorbed sinks the music under water.
 *  - Danger is audible. Being pulled muffles the music and fades in a low pulse.
 *  - Sounds sit where they happen: panned by screen position and quieter with distance.
 */
const PENTA = [0, 2, 4, 7, 9];
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const penta = (step, base = 62) => base + PENTA[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5);

/* Dmaj9 – Bm9 – Gmaj7#11 – A6/9, and for black holes the relative minor: Bm9 – Gmaj7 – Em9 – F#m7 */
const CHORDS = {
  bright: [[50, 57, 61, 64, 66], [47, 54, 57, 61, 62], [43, 50, 54, 59, 61], [45, 52, 59, 61, 66]],
  dark: [[47, 54, 57, 61, 62], [43, 50, 54, 59, 62], [40, 47, 50, 54, 55], [42, 49, 54, 57, 61]],
};
const TEMPO = 76;

/* The sound engine works on any AudioContext, including an OfflineAudioContext (for rendering previews). */
class SoundEngine {
  constructor(ctx) {
    this.ctx = ctx;
    const c = ctx;
    this.master = this._gain(0.85);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    const limit = c.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.1;
    this.master.connect(comp);
    comp.connect(limit);
    limit.connect(c.destination);

    this.sfx = this._gain(0.9, this.master);
    this.ui = this._gain(0.6, this.master);

    this.musicIn = this._gain(1);
    this.musicFilter = c.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 16000;
    this.musicFilter.Q.value = 0.7;
    this.musicOut = this._gain(0.5, this.master);
    this.musicIn.connect(this.musicFilter);
    this.musicFilter.connect(this.musicOut);

    this.verbIn = this._gain(1);
    const verb = c.createConvolver();
    verb.buffer = this._impulse(2.8);
    this.verbOut = this._gain(0.32, this.master);
    this.verbIn.connect(verb);
    verb.connect(this.verbOut);

    // dotted-eighth echo for the music box
    this.delayIn = this._gain(1);
    const dl = c.createDelay(2);
    dl.delayTime.value = (60 / TEMPO) * 0.75;
    const dlf = c.createBiquadFilter();
    dlf.type = 'lowpass';
    dlf.frequency.value = 2600;
    const fb = this._gain(0.36);
    this.delayIn.connect(dl);
    dl.connect(dlf);
    dlf.connect(fb);
    fb.connect(dl);
    dlf.connect(this._gain(0.32, this.musicIn));

    this.noiseBuf = this._noiseBuffer(2);
    this._initLoops();
    this.music = new MusicBox(this);
    this.musicEnabled = true;
    this.duckUntil = 0;
    this.boosting = false;
    this.targets = {};
  }

  /* ---------- plumbing ---------- */

  _gain(v, dest) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  /* Exponentially decaying, slightly darkened noise: a big soft room. */
  _impulse(sec) {
    const c = this.ctx, sr = c.sampleRate, n = Math.floor(sr * sec), pre = Math.floor(sr * 0.012);
    const buf = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0;
      for (let i = pre; i < n; i++) {
        const x = (Math.random() * 2 - 1) * Math.pow(1 - (i - pre) / (n - pre), 3.2);
        y += 0.4 * (x - y);
        d[i] = y;
      }
    }
    return buf;
  }

  _noiseBuffer(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* Output strip for one sound: level, pan, reverb send, echo send. */
  _voice(t, { bus, pan = 0, send = 0, vol = 1, echo = 0 } = {}) {
    const c = this.ctx;
    const g = this._gain(vol);
    let node = g;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.setValueAtTime(clamp(pan, -1, 1), t);
      g.connect(p);
      node = p;
    }
    node.connect(bus || this.sfx);
    if (send) node.connect(this._gain(send, this.verbIn));
    if (echo) node.connect(this._gain(echo, this.delayIn));
    return g;
  }

  _env(param, t, peak, attack, dur) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
  }

  /* Continuous voices: the boost thruster and the danger pulse. Silent until needed. */
  _initLoops() {
    const c = this.ctx;
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 720;
    bp.Q.value = 0.8;
    this.boostGain = this._gain(0, this.sfx);
    n.connect(bp);
    bp.connect(this.boostGain);
    const rum = c.createOscillator();
    rum.type = 'sawtooth';
    rum.frequency.value = midiHz(33);
    const rlp = c.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 170;
    this.rumbleGain = this._gain(0, this.sfx);
    rum.connect(rlp);
    rlp.connect(this.rumbleGain);
    n.start();
    rum.start();

    this.dangerGain = this._gain(0, this.sfx);
    const trem = this._gain(0.5, this.dangerGain);
    this.lfo = c.createOscillator();
    this.lfo.frequency.value = 2;
    this.lfo.connect(this._gain(0.5, trem.gain));
    for (const [m, v] of [[38, 0.6], [45, 0.3]]) {
      const o = c.createOscillator();
      o.frequency.value = midiHz(m);
      o.connect(this._gain(v, trem));
      o.start();
    }
    this.lfo.start();
  }

  _target(key, param, value, now, tau) {
    const last = this.targets[key];
    if (last === undefined || Math.abs(last - value) > Math.abs(value) * 0.03 + 0.002) {
      param.setTargetAtTime(value, now, tau);
      this.targets[key] = value;
    }
  }

  /* Called every frame: music layers, danger, muffling, ducking. */
  update(now, state, tier, danger) {
    const inGame = state === 'playing' || state === 'paused';
    this.music.level = inGame ? [1, 1, 2, 2, 3, 4, 5][tier] : 0;
    this.music.dark = inGame && tier === 6;
    this.music.update(now);
    const d = clamp(danger, 0, 1);
    let f = 16000, tau = 0.25;
    if (state === 'playing') f = 16000 * Math.pow(650 / 16000, Math.pow(d, 0.8));
    else if (state === 'paused') f = 700;
    else if (state === 'dead') {
      f = 300;
      tau = 0.5;
    }
    this._target('filter', this.musicFilter.frequency, f, now, tau);
    const duck = now < this.duckUntil ? 0.3 : 1;
    const level = this.musicEnabled ? (state === 'paused' ? 0.26 : 0.5) : 0;
    this._target('music', this.musicOut.gain, level * duck, now, 0.35);
    this._target('danger', this.dangerGain.gain, state === 'playing' ? d * 0.16 : 0, now, 0.2);
    this._target('lfo', this.lfo.frequency, 1.5 + d * 5, now, 0.3);
  }

  /* ---------- instruments ---------- */

  /* Glassy FM mallet: the voice of everything you pick up. */
  mallet(t, midi, { vel = 0.2, dur = 0.8, ratio = 3.5, index = 1.8, bus, pan, send = 0.3, echo = 0 } = {}) {
    const c = this.ctx, f = midiHz(midi);
    const out = this._voice(t, { bus, pan, send, vol: vel, echo });
    const car = c.createOscillator();
    car.frequency.value = f;
    const mod = c.createOscillator();
    mod.frequency.value = f * ratio;
    const depth = c.createGain();
    depth.gain.setValueAtTime(f * index, t);
    depth.gain.exponentialRampToValueAtTime(f * 0.02 + 0.01, t + 0.2);
    mod.connect(depth);
    depth.connect(car.frequency);
    const env = c.createGain();
    this._env(env.gain, t, 1, 0.004, dur);
    car.connect(env);
    env.connect(out);
    const sp = c.createOscillator();
    sp.frequency.value = f * 2;
    const se = c.createGain();
    this._env(se.gain, t, 0.22, 0.003, dur * 0.35);
    sp.connect(se);
    se.connect(out);
    for (const o of [car, mod, sp]) {
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /* Soft detuned pad for chords. */
  pad(t, midis, dur, { vel = 0.04, bright = 0.4, bus, send = 0.5 } = {}) {
    const c = this.ctx;
    const out = this._voice(t, { bus: bus || this.musicIn, send, vol: 1 });
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300 + bright * 2200;
    lp.Q.value = 0.5;
    lp.connect(out);
    const att = Math.min(1.4, dur * 0.3), rel = Math.min(1.8, dur * 0.4);
    for (const m of midis) {
      const env = c.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(vel, t + att);
      env.gain.setValueAtTime(vel, t + dur - rel);
      env.gain.linearRampToValueAtTime(0.0001, t + dur);
      env.connect(lp);
      for (const [type, det, v] of [['triangle', -6, 1], ['sawtooth', 7, 0.35]]) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = midiHz(m);
        o.detune.value = det;
        const g = this._gain(v, env);
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  bass(t, midi, dur, vel) {
    const c = this.ctx;
    const out = this._voice(t, { bus: this.musicIn, vol: vel, send: 0.08 });
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.connect(out);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.45, t + dur * 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(lp);
    for (const [type, v] of [['sine', 1], ['triangle', 0.35]]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = midiHz(midi);
      o.connect(this._gain(v, env));
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /* Filtered noise with a moving filter: whooshes, slurps, blasts. */
  noise(t, dur, { type = 'bandpass', f0 = 1000, f1 = 1000, q = 1, vel = 0.2, attack = 0.005, bus, pan, send = 0 } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const env = c.createGain();
    this._env(env.gain, t, 1, Math.min(attack, dur * 0.95), dur);
    const out = this._voice(t, { bus, pan, send, vol: vel });
    src.connect(f);
    f.connect(env);
    env.connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /* A falling sine: the sound of mass. */
  thump(t, f0, f1, dur, vel, { bus, pan, send = 0.15 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    const env = c.createGain();
    this._env(env.gain, t, 1, 0.006, dur);
    o.connect(env);
    env.connect(this._voice(t, { bus, pan, send, vol: vel }));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  glide(t, f0, f1, dur, vel, { type = 'sine', vibrato = 0, lp = 0, bus, pan, send = 0.3 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (vibrato) {
      const v = c.createOscillator();
      v.frequency.value = 9;
      const vd = this._gain(vibrato);
      v.connect(vd);
      vd.connect(o.frequency);
      v.start(t);
      v.stop(t + dur + 0.05);
    }
    const env = c.createGain();
    this._env(env.gain, t, 1, 0.02, dur);
    let node = o;
    if (lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      o.connect(f);
      node = f;
    }
    node.connect(env);
    env.connect(this._voice(t, { bus, pan, send, vol: vel }));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /* ---------- the game's sounds ---------- */

  /* Stardust: chained pickups climb the scale, so a clean sweep plays a run. */
  dust(t, step, o) {
    this.mallet(t, penta(step % 10, 74), { vel: 0.24 * o.vol, dur: 0.45, ratio: 3.5, index: 1.8, pan: o.pan, send: 0.22 });
  }

  rock(t, o) {
    this.mallet(t, penta(randInt(0, 2), 57), { vel: 0.24 * o.vol, dur: 0.32, ratio: 1.41, index: 3, pan: o.pan, send: 0.12 });
    this.noise(t, 0.035, { type: 'highpass', f0: 3200, f1: 2000, vel: 0.07 * o.vol, pan: o.pan });
  }

  bigEat(t) {
    [74, 81, 86].forEach((m, i) => this.mallet(t + i * 0.07, m, { vel: 0.18, dur: 1.2, send: 0.45, echo: 0.2 }));
    this.noise(t, 0.6, { type: 'highpass', f0: 6000, f1: 9000, vel: 0.05, attack: 0.1, send: 0.4 });
  }

  /* A gulp: a sub drop and a slurp, plus (when it's you) a stab on the music's current chord. */
  absorb(t, o) {
    const s = clamp(Math.log10((o.size || 10) + 1) / 3.5, 0, 1), v = o.vol;
    this.thump(t, 170 - s * 90, 38, 0.35 + s * 0.6, 0.55 * v, { pan: o.pan });
    this.noise(t, 0.28 + s * 0.3, { type: 'bandpass', f0: 2400, f1: 260, q: 2.5, vel: 0.22 * v, attack: 0.02, pan: o.pan, send: 0.2 });
    if (o.mine) {
      const chord = this.music.chord();
      this.mallet(t + 0.05, chord[0] + 24, { vel: 0.13, dur: 1.4, ratio: 2, index: 1.2, send: 0.5 });
      this.mallet(t + 0.05, chord[2] + 12, { vel: 0.1, dur: 1.4, ratio: 2, index: 1.2, send: 0.5 });
    }
  }

  death(t) {
    this.glide(t, 330, 42, 1.9, 0.22, { type: 'sawtooth', lp: 1200, send: 0.5 });
    this.thump(t, 120, 28, 2.4, 0.5, { send: 0.3 });
    this.noise(t, 2.2, { type: 'lowpass', f0: 4000, f1: 80, vel: 0.22, attack: 0.05, send: 0.4 });
  }

  /* Each form gets its own fanfare: longer and from a different step of the scale. */
  tierUp(t, tier) {
    if (tier === 6) {
      this.thump(t, 90, 28, 2.6, 0.5, { send: 0.4 });
      this.noise(t, 2.4, { type: 'lowpass', f0: 1600, f1: 60, vel: 0.16, attack: 0.4, send: 0.6 });
      for (let i = 0; i < 5; i++) this.mallet(t + i * 0.17, penta(9 - i * 2, 50), { vel: 0.16, dur: 1.9, ratio: 2.4, index: 1, send: 0.6 });
      return;
    }
    const n = 4 + Math.min(tier, 4);
    for (let i = 0; i < n; i++) {
      this.mallet(t + i * 0.075, penta(i * 2 + tier, 62), { vel: 0.16, dur: 1.4, send: 0.45, echo: 0.12, pan: (i / n - 0.5) * 0.6 });
    }
    this.pad(t, this.music.chord().map((m) => m + 12), 2.4, { vel: 0.045, bright: 0.9, bus: this.sfx, send: 0.6 });
    this.thump(t, 110, 50, 0.6, 0.28);
    if (tier === 5) this.noise(t, 1.3, { type: 'highpass', f0: 5000, f1: 9000, vel: 0.06, attack: 0.3, send: 0.5 });
  }

  tierDown(t) {
    this.mallet(t, 69, { vel: 0.15, dur: 0.6, send: 0.3 });
    this.mallet(t + 0.15, 64, { vel: 0.13, dur: 0.9, send: 0.35 });
  }

  setBoost(on, t) {
    if (on === this.boosting) return;
    this.boosting = on;
    if (on) {
      this.noise(t, 0.16, { type: 'highpass', f0: 600, f1: 3200, vel: 0.12 });
      this.boostGain.gain.setTargetAtTime(0.1, t, 0.05);
      this.rumbleGain.gain.setTargetAtTime(0.08, t, 0.05);
    } else {
      this.boostGain.gain.setTargetAtTime(0, t, 0.12);
      this.rumbleGain.gain.setTargetAtTime(0, t, 0.15);
    }
  }

  /* Surge: a reversed swell (the inhale), then the boom. */
  surge(t, o) {
    const v = o.vol;
    this.noise(t, 0.42, { type: 'bandpass', f0: 250, f1: 2600, q: 1.2, vel: 0.28 * v, attack: 0.38, pan: o.pan, send: 0.2 });
    this.thump(t + 0.4, 95, 32, 1.1, 0.6 * v, { pan: o.pan, send: 0.3 });
    this.mallet(t + 0.4, 50, { vel: 0.12 * v, dur: 1.6, ratio: 0.5, index: 2, pan: o.pan, send: 0.5 });
  }

  collide(t, o) {
    this.mallet(t, penta(randInt(0, 3), 50), { vel: 0.22 * o.vol, dur: 0.25, ratio: 1, index: 4, pan: o.pan, send: 0.1 });
    this.noise(t, 0.06, { type: 'lowpass', f0: 2500, f1: 400, vel: 0.18 * o.vol, pan: o.pan });
  }

  /* Supernova warning: ticks that speed up across the five-second countdown. */
  warn(t, o) {
    const offsets = [0, 1, 1.85, 2.6, 3.25, 3.8, 4.25, 4.6, 4.85];
    offsets.forEach((off, i) => {
      this.mallet(t + off, i >= 6 ? 86 : 81, { vel: (0.1 + i * 0.012) * o.vol, dur: 0.5, ratio: 5, index: 1, pan: o.pan, send: 0.5 });
    });
  }

  supernova(t, o) {
    const v = o.vol;
    this.noise(t, 3.2, { type: 'lowpass', f0: 7000, f1: 120, vel: 0.5 * v, attack: 0.01, send: 0.7, pan: o.pan });
    this.thump(t, 80, 22, 2.6, 0.9 * v);
    for (const m of [74, 78, 81, 83]) this.mallet(t + 0.05, m, { vel: 0.08 * v, dur: 3.5, ratio: 7, index: 0.6, send: 0.8, pan: rand(-0.5, 0.5) });
    this.duckUntil = t + 2.2;
  }

  shock(t, o) {
    this.noise(t, 0.6, { type: 'bandpass', f0: 300, f1: 1800, q: 0.8, vel: 0.24 * o.vol, attack: 0.25, send: 0.3 });
  }

  wormhole(t) {
    this.glide(t, 180, 1400, 0.5, 0.14, { vibrato: 30, send: 0.4 });
    this.noise(t, 0.5, { type: 'bandpass', f0: 400, f1: 5000, vel: 0.12, attack: 0.4, send: 0.3 });
    this.mallet(t + 0.5, 86, { vel: 0.18, dur: 0.8, send: 0.5 });
    this.thump(t + 0.5, 140, 60, 0.25, 0.3);
  }

  /* Becoming the heaviest body in the system */
  crown(t) {
    [62, 69, 74, 78, 81].forEach((m, i) => this.mallet(t + i * 0.09, m, { vel: 0.16, dur: 1.6, send: 0.5, echo: 0.15 }));
    this.pad(t, this.music.chord().map((m) => m + 12), 2.8, { vel: 0.05, bright: 1, bus: this.sfx, send: 0.6 });
  }

  click(t) {
    this.mallet(t, 81, { vel: 0.06, dur: 0.09, ratio: 1.5, index: 1, bus: this.ui });
  }

  /* Each colour swatch is a note of the scale. */
  hue(t, i) {
    this.mallet(t, penta(i + 5, 62), { vel: 0.14, dur: 0.7, index: 1.4, bus: this.ui, send: 0.35 });
  }

  launch(t) {
    this.noise(t, 0.45, { type: 'bandpass', f0: 300, f1: 3000, vel: 0.14, attack: 0.3, bus: this.ui, send: 0.3 });
    [74, 81, 86].forEach((m, i) => this.mallet(t + 0.3 + i * 0.08, m, { vel: 0.14, dur: 1, bus: this.ui, send: 0.45 }));
  }
}

/*
 * Generative score, scheduled a beat ahead on the audio clock.
 * Layers by level: 0 menu (pads, sparse music box) · 1 adds more melody · 2 bass ·
 * 3 eighth-note arpeggio · 4 high bells · 5 black hole: minor, low, with a heartbeat.
 */
class MusicBox {
  constructor(engine) {
    this.e = engine;
    this.beat = 60 / TEMPO;
    this.next = -1;
    this.i = 0;
    this.level = 0;
    this.dark = false;
    this.melody = 5;
  }

  chord(i = this.i) {
    return CHORDS[this.dark ? 'dark' : 'bright'][Math.floor(Math.floor(i / 4) / 2) % 4];
  }

  update(now) {
    if (this.next < 0 || this.next < now - 1) this.next = now + 0.1; // first call, or back from a stall
    while (this.next < now + 0.3) {
      if (this.e.musicEnabled) this._beat(this.i, this.next);
      this.next += this.beat;
      this.i++;
    }
  }

  _beat(i, t) {
    const e = this.e, b = this.beat, bar = Math.floor(i / 4), k = i % 4, L = this.level;
    const chord = this.chord(i);
    if (k === 0 && bar % 2 === 0) e.pad(t, chord, b * 8 + 0.6, { vel: 0.04, bright: this.dark ? 0.15 : Math.min(0.85, 0.2 + L * 0.12) });

    const p = [0.28, 0.42, 0.5, 0.55, 0.62, 0.4][L];
    if (Math.random() < p) {
      this.melody = clamp(this.melody + randInt(-2, 2), 2, 11);
      const off = Math.random() < 0.3 ? b / 2 : 0;
      e.mallet(t + off, penta(this.melody, this.dark ? 50 : 62), {
        vel: 0.075, dur: 1.6, index: 1.3, bus: e.musicIn, send: 0.4, echo: 0.3, pan: rand(-0.45, 0.45),
      });
    }
    if ((L >= 2 || this.dark) && (k === 0 || k === 2)) {
      let m = chord[0];
      while (m > 49) m -= 12;
      while (m < 38) m += 12;
      e.bass(t, m, b * 1.7, 0.14);
    }
    if (L >= 3 && !this.dark) {
      for (const h of [0, 1]) {
        e.mallet(t + h * b * 0.5, chord[1 + ((k * 2 + h) % 4)] + 12, { vel: 0.03, dur: 0.5, ratio: 2, index: 0.8, bus: e.musicIn, send: 0.3, pan: h ? 0.3 : -0.3 });
      }
    }
    if (L >= 4 && !this.dark && k === 0) {
      e.mallet(t, chord[chord.length - 1] + 24, { vel: 0.04, dur: 2.5, ratio: 5.01, index: 1, bus: e.musicIn, send: 0.6 });
    }
    if (this.dark && k === 0) {
      e.thump(t, 75, 42, 0.5, 0.2, { bus: e.musicIn, send: 0.1 });
      e.thump(t + 0.28, 70, 40, 0.45, 0.14, { bus: e.musicIn, send: 0.1 });
    }
  }
}

/* The game-facing wrapper: owns the AudioContext, mute and music settings, throttling, chains. */
class Sfx {
  constructor() {
    this.ctx = null;
    this.engine = null;
    this.muted = !!storageGet('gravity.muted', false);
    this.musicOn = storageGet('gravity.music', true) !== false;
    this.lastPlay = {};
    this.chain = 0;
    this.lastChain = 0;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }

  /* Browsers only allow audio after a user gesture; the game calls this on the first one. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.engine = new SoundEngine(this.ctx);
    } catch (e) {
      this.ctx = null;
      this.engine = null;
      return;
    }
    this.engine.musicEnabled = this.musicOn;
    this.engine.master.gain.value = this.muted ? 0 : 0.85;
  }

  toggleMute() {
    this.muted = !this.muted;
    storageSet('gravity.muted', this.muted);
    if (this.engine) this.engine.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    storageSet('gravity.music', this.musicOn);
    if (this.engine) this.engine.musicEnabled = this.musicOn;
    return this.musicOn;
  }

  update(state, tier, danger) {
    if (this.engine && this.ctx.state === 'running') this.engine.update(this.ctx.currentTime, state, tier, danger);
  }

  setBoost(on) {
    if (this.engine) this.engine.setBoost(on, this.ctx.currentTime);
  }

  _throttle(name, ms) {
    const now = performance.now();
    if (this.lastPlay[name] && now - this.lastPlay[name] < ms) return false;
    this.lastPlay[name] = now;
    return true;
  }

  /* play(name, { vol, pan, ...extra }); vol fades far-away events, pan places them left or right. */
  play(name, opts = {}) {
    if (!this.engine || this.muted) return;
    if (typeof opts === 'number') opts = { vol: opts };
    const o = Object.assign({ vol: 1, pan: 0 }, opts);
    if (o.vol <= 0.02) return;
    const e = this.engine, t = this.ctx.currentTime + 0.01;
    switch (name) {
      case 'dust': {
        if (!this._throttle(name, 45)) return;
        const now = performance.now();
        this.chain = now - this.lastChain < 450 ? this.chain + 1 : 0;
        this.lastChain = now;
        e.dust(t, this.chain, o);
        break;
      }
      case 'rock':
        if (this._throttle(name, 60)) e.rock(t, o);
        break;
      case 'collide':
        if (this._throttle(name, 120)) e.collide(t, o);
        break;
      case 'shock':
        if (this._throttle(name, 300)) e.shock(t, o);
        break;
      case 'click':
        if (this._throttle(name, 40)) e.click(t);
        break;
      case 'tierUp':
        e.tierUp(t, o.tier || 0);
        break;
      case 'hue':
        e.hue(t, o.i || 0);
        break;
      case 'bigEat': case 'absorb': case 'death': case 'tierDown': case 'surge': case 'warn':
      case 'supernova': case 'wormhole': case 'crown': case 'launch':
        e[name](t, o);
        break;
    }
  }
}
