'use strict';

/*
 * Gravity.io — tuning constants.
 * Every number that affects balance lives here so the game can be tuned in one place.
 * Distances are world units (≈ pixels at zoom 1), times are seconds.
 */
const CONFIG = {
  WORLD_RADIUS: 5600,
  STEP: 1 / 60,                // fixed physics step
  MAX_STEPS_PER_FRAME: 5,

  // Size
  RADIUS_K: 6,                 // radius = RADIUS_K * sqrt(mass)
  START_MASS: 10,
  MIN_MASS: 9,
  EAT_RATIO: 1.2,              // you must be 20% heavier to absorb another body

  // Movement
  SPEED_BASE: 330,
  SPEED_EXP: -0.15,            // heavier bodies are slower
  DRAG: 2.6,
  BOOST_MUL: 1.9,
  BOOST_COST_FRAC: 0.025,      // fraction of mass burned per second while boosting
  BOOST_COST_FLAT: 0.7,
  BOOST_MIN_MASS: 12,
  NEBULA_DRAG: 1.4,            // nebulae slow you down but hide you

  // Gravity
  G: 46000,
  GRAV_RANGE: 4.5,             // gravity reaches this many radii...
  GRAV_RANGE_MAX: 2300,        // ...but never further than this
  FOOD_PULL_RANGE: 1.1,        // dust gets vacuumed from this many radii past the surface
  FOOD_PULL_ACCEL: 2600,
  SURGE_DURATION: 2.6,
  SURGE_COOLDOWN: 14,
  SURGE_STRENGTH: 2.2,
  SURGE_RANGE: 1.6,

  // Mass decay keeps giants from snowballing forever
  DECAY_START: 150,
  DECAY_RATE: 0.0022,
  DECAY_SOFTCAP: 3200,         // decay grows with the square of mass / this
  MASS_CEILING: 6000,          // past this, decay climbs steeply so no one owns the map

  // Food
  DUST_COUNT: 4400,
  DUST_RESPAWN_PER_SEC: 160,
  ROCK_COUNT: 320,
  COMET_MAX: 6,
  COMET_INTERVAL: [5, 10],
  BELT_RADII: [0.36, 0.7],     // two asteroid belts, as fractions of the world radius
  BELT_WIDTH: 260,

  // Bots
  BOT_COUNT: 55,
  SPAWN_SHIELD: 3,

  // World events
  SUPERNOVA_FIRST: 30,
  SUPERNOVA_INTERVAL: [45, 75],
  SUPERNOVA_WARNING: 5,
  SUPERNOVA_BLAST: 1150,       // shockwave reach
  SUPERNOVA_CORE: 280,         // anything this close when it blows loses mass
  WORMHOLE_PAIRS: 3,
  WORMHOLE_RADIUS: 60,
  WORMHOLE_MAX_MASS: 400,
  NEBULA_COUNT: 8,
};

/* Evolution ladder. `grav` and `range` multiply gravity strength and reach. */
const TIERS = [
  { key: 'asteroid',  name: 'Asteroid',     min: 0,    grav: 1.0,  range: 1.0,  decay: 1.0, perk: 'Absorb stardust and smaller rocks to grow.' },
  { key: 'moon',      name: 'Moon',         min: 35,   grav: 1.0,  range: 1.0,  decay: 1.0, perk: 'Comets are now within reach.' },
  { key: 'rocky',     name: 'Rocky Planet', min: 100,  grav: 1.08, range: 1.05, decay: 1.0, perk: 'Gravity +8%.' },
  { key: 'ocean',     name: 'Ocean World',  min: 250,  grav: 1.15, range: 1.1,  decay: 1.0, perk: 'Gravity +15%. Wormholes close to you at 400 mass.' },
  { key: 'gas',       name: 'Gas Giant',    min: 600,  grav: 1.25, range: 1.15, decay: 1.0, perk: 'Gravity +25% with a wider pull.' },
  { key: 'star',      name: 'Star',         min: 1400, grav: 1.4,  range: 1.25, decay: 1.1, perk: 'Gravity +40%. You light up the system.' },
  { key: 'blackhole', name: 'Black Hole',   min: 3000, grav: 1.8,  range: 1.4,  decay: 1.35, perk: 'Gravity +80%. Hawking radiation drains you faster.' },
];

const FOOD_DUST = 0;
const FOOD_ROCK = 1;
const FOOD_COMET = 2;
const FOOD_DEBRIS = 3;
const FOOD_REMNANT = 4;

/* The art direction's fixed colours. css/style.css mirrors these as custom properties. */
const COLORS = {
  ink: '#090b18',        // the void
  plate: '#141833',      // UI plates
  bone: '#f1ead9',       // text, stardust, highlights
  boneDim: '#a3a1b8',
  ember: '#ff7849',      // the brand accent
  threat: '#ff5468',     // can eat you
  prey: '#6fe0a6',       // you can eat it
  fabric: 'rgba(98,114,210,0.22)', // the spacetime grid
};

/* Stardust: mostly bone, some sand, a little ember. [hue, saturation, lightness] */
const DUST_COLORS = [
  [44, 45, 90],
  [40, 72, 70],
  [18, 95, 64],
];

/* Every body colour in the game comes from these eight hues (players and bots alike). */
const BODY_HUES = [200, 164, 88, 36, 14, 334, 276, 232];
const PLAYER_HUES = BODY_HUES;

/* Rival bodies are named after real moons and minor planets. */
const BOT_NAMES = [
  'Io', 'Europa', 'Ganymede', 'Callisto', 'Titan', 'Rhea', 'Iapetus', 'Dione', 'Tethys', 'Enceladus',
  'Mimas', 'Hyperion', 'Phoebe', 'Miranda', 'Ariel', 'Umbriel', 'Titania', 'Oberon', 'Triton', 'Nereid',
  'Proteus', 'Charon', 'Nix', 'Hydra', 'Kerberos', 'Styx', 'Phobos', 'Deimos', 'Ceres', 'Vesta',
  'Pallas', 'Hygiea', 'Eris', 'Sedna', 'Haumea', 'Makemake', 'Quaoar', 'Orcus', 'Varuna', 'Ixion',
  'Salacia', 'Dysnomia', 'Arrokoth', 'Larissa', 'Galatea', 'Amalthea', 'Himalia', 'Pandora',
  'Metis', 'Adrastea', 'Thebe', 'Leda', 'Elara', 'Lysithea', 'Carme', 'Ananke', 'Sinope', 'Pasiphae',
  'Janus', 'Epimetheus', 'Helene', 'Telesto', 'Calypso', 'Atlas', 'Prometheus', 'Pan', 'Daphnis', 'Ymir',
  'Tarvos', 'Kiviuq', 'Ijiraq', 'Cordelia', 'Ophelia', 'Bianca', 'Cressida', 'Desdemona', 'Juliet', 'Portia',
  'Rosalind', 'Belinda', 'Puck', 'Sycorax', 'Caliban', 'Prospero', 'Setebos', 'Naiad', 'Thalassa', 'Despina',
  'Halimede', 'Neso', 'Psamathe', 'Astraea', 'Hebe', 'Iris', 'Flora', 'Weywot', 'Vanth', 'Actaea',
];
