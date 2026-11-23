# Gravity.io

You start as a small asteroid. You absorb stardust, rocks, comets and smaller players to grow. Anything heavier than you pulls you toward it with gravity, and if it reaches you, it absorbs you.

The game runs in the browser with plain HTML5 canvas and JavaScript. It needs no build step and has no dependencies.

## Play

Open `index.html` in a browser. The scripts are classic `<script>` tags, so the game works straight from the file system. To serve it over HTTP instead:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

It is a static site, so GitHub Pages or any other static host works too.

| Input | Action |
| --- | --- |
| Mouse or WASD / arrow keys | Steer (with the mouse, the farther the cursor, the faster you go) |
| Space or left click (hold) | Boost: faster, but burns mass and leaves a debris trail |
| E, Shift or right click | Gravity surge: stronger, longer pull for 2.6 s, recharges in 14 s |
| Esc or P | Pause |
| M | Sound on or off |
| Touch | Drag anywhere to steer. The on-screen buttons boost and surge |

## How it works

**Gravity.** Every body pulls lighter bodies toward it. The pull follows an inverse square, fades out at 4.5 radii, and is capped at 2,300 units. Heavier forms pull harder. Gravity also vacuums stardust toward you, so larger bodies feed faster.

**Absorbing.** You can absorb any body at least 20% lighter than you once its center crosses your surface. Bodies closer in size bounce off each other and chip off debris.

**Point of no return.** Around every predator the game draws two red rings. The dashed one is the edge of its gravity. Inside the solid one, its pull beats your normal thrust, and only a boost gets you out.

**Evolution.** Your form changes as your mass grows. Each form looks different and pulls harder:

| Form | Mass | Perk |
| --- | --- | --- |
| Asteroid | start (10) | none |
| Moon | 35 | heavy enough to absorb comets |
| Rocky Planet | 100 | gravity +8% |
| Ocean World | 250 | gravity +15% |
| Gas Giant | 600 | gravity +25%, wider pull |
| Star | 1,400 | gravity +40% |
| Black Hole | 3,000 | gravity +80%, but Hawking radiation drains it faster |

**Decay.** Above 150 mass you slowly lose mass, and the rate climbs with the square of your size. A giant has to keep eating to stay a giant, which stops any single body from running away with the game.

### The system

- **Spacetime grid.** The background grid bends toward every mass, so you can see gravity wells before you reach them.
- **Asteroid belt.** A ring of rocks worth 4 to 8 mass each, a good feeding ground early on.
- **Nebulae.** Bots can't see you inside a nebula from more than about 300 units away, but nebulae slow you down. Extra stardust forms inside them.
- **Wormholes.** Two linked pairs. Bodies up to 400 mass fly in and come out across the system with a speed boost. Bots use them to escape.
- **Comets.** Fast, worth 18 to 30 mass, and bent by gravity as they cross the system.
- **Supernovae.** Every 60 to 95 seconds a star starts collapsing. You get a 5-second warning on screen and on the minimap. When it blows, anything inside the red ring loses 18% of its mass, and a shockwave pushes everything outward. It leaves stardust and a pulsar worth 45 mass.

### Bots

20 bots with names, personalities (aggression, caution, reaction time) and the same physics as you. They flee anything that can eat them, boosting when it gets close. They hunt prey they can catch, and give up on prey that keeps escaping. They use gravity surge on prey and head for wormholes when chased. When there is nothing to hunt, they forage for stardust and comets.

## Project layout

```
index.html        page, HUD and menu markup
css/style.css     all styling
js/config.js      every tuning constant, the evolution ladder, bot names
js/util.js        math, RNG and formatting helpers
js/entities.js    Body (players and bots), food, spatial grid
js/world.js       the simulation: gravity, absorption, collisions, food, events
js/ai.js          bot brains
js/textures.js    procedural planet, star and sprite textures
js/renderer.js    canvas rendering
js/audio.js       synthesized sound effects (WebAudio, no audio files)
js/input.js       mouse, keyboard and touch
js/hud.js         stats, leaderboard, minimap, feed, menu and death screens
js/game.js        state machine, loop, camera, event handling
tools/simulate.js headless balance simulation
```

The simulation in `world.js` does not use the DOM. You can run it without a browser to check balance after changing `config.js`:

```sh
node tools/simulate.js 600   # simulate 10 minutes of bot-only play
```

It prints the leaderboard every 30 seconds and counts every event at the end.
