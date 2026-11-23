'use strict';

const TAU = Math.PI * 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/* Small deterministic RNG so procedural textures look the same every time. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function randomInDisk(radius) {
  const a = Math.random() * TAU;
  const r = radius * Math.sqrt(Math.random());
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

function massToRadius(m) {
  return CONFIG.RADIUS_K * Math.sqrt(m);
}

function maxSpeedFor(m) {
  return CONFIG.SPEED_BASE * Math.pow(m, CONFIG.SPEED_EXP);
}

function tierIndexForMass(m) {
  let t = 0;
  while (t + 1 < TIERS.length && m >= TIERS[t + 1].min) t++;
  return t;
}

function hsl(h, s, l, a = 1) {
  return `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;
}

function formatMass(m) {
  return Math.floor(m).toLocaleString('en-US');
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Irregular outline (radius multipliers around a circle) used for rocks and asteroid-tier bodies. */
function makeRockShape(points, roughness, rng = Math.random) {
  const shape = [];
  for (let i = 0; i < points; i++) shape.push(1 - roughness * rng());
  return shape;
}

function storageGet(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* storage unavailable (private mode, sandbox) — the game works without it */
  }
}
