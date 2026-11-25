#!/usr/bin/env node
'use strict';

/*
 * Headless balance check: runs the simulation (no rendering) for a few minutes of game time
 * and prints how the bot ecosystem evolves. Usage: node tools/simulate.js [seconds]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'js');
const files = ['config.js', 'util.js', 'entities.js', 'ai.js', 'world.js'];
const ctx = vm.createContext({ console, window: {} }); // own Math: sharing the outer realm's is ~5x slower
for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
vm.runInContext('globalThis.World = World; globalThis.CONFIG = CONFIG; globalThis.TIERS = TIERS;', ctx);

const seconds = Number(process.argv[2] || 300);
const world = new ctx.World();
const counts = {};
const t0 = Date.now();
let maxMass = 0;
let maxTierSeen = 0;

for (let step = 0; step < seconds * 60; step++) {
  world.step(ctx.CONFIG.STEP);
  for (const e of world.events) counts[e.type] = (counts[e.type] || 0) + 1;
  world.events.length = 0;
  for (const b of world.bodies) {
    maxMass = Math.max(maxMass, b.mass);
    maxTierSeen = Math.max(maxTierSeen, b.tier);
  }
  if (step % (60 * 30) === 0) {
    const top = world.ranked.slice(0, 5).map((b) => `${b.name}:${Math.round(b.mass)}`).join('  ');
    const total = world.bodies.reduce((s, b) => s + b.mass, 0);
    console.log(`t=${String(Math.round(world.time)).padStart(4)}s bodies=${world.bodies.length} food=${world.food.length} ` +
      `dust=${world.counts.dust} totalBodyMass=${Math.round(total)} | ${top}`);
  }
}

const ms = Date.now() - t0;
console.log(`\nsimulated ${seconds}s in ${ms}ms (${((seconds * 60) / (ms / 1000)).toFixed(0)} steps/s)`);
console.log('events:', counts);
console.log(`heaviest body seen: ${Math.round(maxMass)} (${ctx.TIERS[maxTierSeen].name})`);
