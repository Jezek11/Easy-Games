export const CELL_SIZE = 4.0;
export const WALL_HEIGHT = 3.5;
export const WALL_THICKNESS = 0.24;
export const FLOOR_THICKNESS = 0.22;
export const RAMP_THICKNESS = 0.22;
export const SLOPE_LEN = Math.hypot(CELL_SIZE, WALL_HEIGHT);
export const SLOPE_ANGLE = Math.atan2(WALL_HEIGHT, CELL_SIZE);

export const ARENA_HALF_GRID = 10; // -10 .. +9 => 80m x 80m
export const ARENA_HALF_SIZE = ARENA_HALF_GRID * CELL_SIZE; // 40m
export const ARENA_PLAY_LIMIT = ARENA_HALF_SIZE - 0.8;
export const BR_HALF_GRID = 18; // -18 .. +17 => 144m x 144m Battle Royale island
export const BR_HALF_SIZE = BR_HALF_GRID * CELL_SIZE; // 72m
export const FALL_DEATH_Y = -6.5;
export const MAX_BUILD_LEVEL = 12;

export const PLAYER_RADIUS = 0.45;
export const PLAYER_HEIGHT = 1.85;
export const PLAYER_CROUCH_HEIGHT = 1.25;
export const PLAYER_EYE_STAND = 1.58;
export const PLAYER_EYE_CROUCH = 1.02;

export const GRAVITY = 28.0;
export const JUMP_SPEED = 11.2;
export const WALK_SPEED = 7.4;
export const SPRINT_SPEED = 10.6;
export const CROUCH_SPEED = 4.5;

export const MAPS = {
  skybox: {
    id: 'skybox',
    name: 'Sky Drop Box',
    subtitle: 'Spawn in an elevated box • Boost Pad drop'
  },
  vramp: {
    id: 'vramp',
    name: '1v1 V-Ramp',
    subtitle: 'Start on V-Ramp behind iron wall • 3-2-1 countdown'
  },
  br: {
    id: 'br',
    name: 'Fortress Island',
    subtitle: '16 Fighters • Shrinking Storm • Bots vs Bots'
  }
};

export const BR_BOT_NAMES = [
  'Nova_AI', 'Vortex', 'Kestrel', 'BlitzBot', 'Shadow_7',
  'ApexCore', 'Pulse', 'Titan', 'Rook', 'Lynx',
  'Striker', 'Phantom', 'Bolt', 'Echo', 'Cobalt'
];

export const BR_PRESETS = {
  casual: {
    id: 'casual',
    label: 'Casual',
    desc: 'Relaxed island lobby (mostly Easy & Medium bots).',
    tiers: ['easy', 'easy', 'medium', 'medium', 'hard']
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    desc: 'Classic BR mix — bots duel each other up to Hard endgame.',
    tiers: ['easy', 'medium', 'medium', 'hard', 'hard']
  },
  sweaty: {
    id: 'sweaty',
    label: 'Sweaty',
    desc: 'Competitive endgame — aggressive builders & sharp aim.',
    tiers: ['medium', 'hard', 'hard', 'extreme']
  }
};

export const QUALITY_PRESETS = {
  low: {
    key: 'low',
    label: 'Low',
    shortLabel: 'LOW',
    desc: '0.75× rozlišení • Bez textur, stínů, oblohy, mlhy a efektů • Max FPS',
    pixelRatio: 0.75,
    pixelRatioCap: 0.75,
    shadows: false,
    shadowMapSize: 256,
    shadowMapType: 'basic',
    materialTier: 'basic',
    skybox: false,
    lights: false,
    toneMapping: false,
    particles: false,
    tracers: false,
    muzzleFlash: false,
    particleScale: 0,
    fog: false,
    fogDensity: 0,
    decorations: false,
    far: 150,
    antialias: false
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    shortLabel: 'MED',
    desc: '1.0× rozlišení • 512px stíny • Textury + obloha + mlha • Vyvážené',
    pixelRatio: 1.0,
    pixelRatioCap: 1.0,
    shadows: true,
    shadowMapSize: 512,
    shadowMapType: 'basic',
    materialTier: 'lambert',
    skybox: true,
    lights: true,
    toneMapping: true,
    particles: true,
    tracers: true,
    muzzleFlash: true,
    particleScale: 0.45,
    fog: true,
    fogDensity: 0.0034,
    decorations: true,
    far: 350,
    antialias: false
  },
  high: {
    key: 'high',
    label: 'High',
    shortLabel: 'HIGH',
    desc: 'Plné rozlišení + AA • 2048px měkké stíny • PBR odlesky + plné efekty',
    pixelRatio: 'auto',
    pixelRatioCap: 2.0,
    shadows: true,
    shadowMapSize: 2048,
    shadowMapType: 'pcfsoft',
    materialTier: 'standard',
    skybox: true,
    lights: true,
    toneMapping: true,
    particles: true,
    tracers: true,
    muzzleFlash: true,
    particleScale: 1.0,
    fog: true,
    fogDensity: 0.0024,
    decorations: true,
    far: 800,
    antialias: true
  }
};

export const WEAPONS = [
  {
    slot: 0,
    id: 'shotgun',
    name: 'Pump Shotgun',
    shortName: 'Pump',
    damage: 15,
    pellets: 8,
    headshotMult: 1.45,
    spread: 0.068,
    adsSpread: 0.042,
    cooldown: 0.92,
    range: 32,
    falloffStart: 8,
    magSize: 5,
    reloadTime: 1.55,
    buildDamage: 95,
    auto: false,
    tracerColor: 0xffd166
  },
  {
    slot: 1,
    id: 'ar',
    name: 'Assault Rifle',
    shortName: 'AR',
    damage: 24,
    pellets: 1,
    headshotMult: 1.5,
    spread: 0.015,
    adsSpread: 0.0035,
    cooldown: 0.12,
    range: 95,
    falloffStart: 38,
    magSize: 30,
    reloadTime: 1.7,
    buildDamage: 32,
    auto: true,
    tracerColor: 0x72efdd
  },
  {
    slot: 2,
    id: 'pickaxe',
    name: 'Pickaxe',
    shortName: 'Pickaxe',
    damage: 25,
    pellets: 1,
    headshotMult: 1.2,
    spread: 0,
    adsSpread: 0,
    cooldown: 0.42,
    range: 3.6,
    falloffStart: 3.6,
    magSize: Infinity,
    reloadTime: 0,
    buildDamage: 85,
    auto: true,
    tracerColor: 0xffffff
  }
];

export const BUILD_TYPES = {
  WALL: 'wall',
  FLOOR: 'floor',
  RAMP: 'ramp'
};

export const BUILD_MATERIALS = {
  wood: {
    id: 'wood',
    name: 'Dřevo',
    hp: 150,
    color: 0xd9954c,
    darkColor: 0x8b5d2f,
    lineColor: 0x6b431d
  },
  brick: {
    id: 'brick',
    name: 'Cihla',
    hp: 220,
    color: 0xc8563c,
    darkColor: 0x7d382a,
    lineColor: 0xd4b6a6
  },
  metal: {
    id: 'metal',
    name: 'Kov',
    hp: 300,
    color: 0x7ea1c0,
    darkColor: 0x4b5c6e,
    lineColor: 0xb5c6d6
  }
};

export const PLAYER_SKINS = [
  { id: 'cyan', name: 'Cyber modrá', primary: 0x00d2ff, secondary: 0x162447, visor: 0x9ef0ff },
  { id: 'crimson', name: 'Karmínová', primary: 0xff3b5c, secondary: 0x261523, visor: 0xffc2cd },
  { id: 'emerald', name: 'Smaragdová', primary: 0x10e88a, secondary: 0x112b24, visor: 0xa7ffd8 },
  { id: 'gold', name: 'Zlatá', primary: 0xffb703, secondary: 0x292012, visor: 0xfff3b0 },
  { id: 'violet', name: 'Fialová', primary: 0xa855f7, secondary: 0x1e1433, visor: 0xe9d5ff },
  { id: 'orange', name: 'Oranžová', primary: 0xff6b2b, secondary: 0x2c1610, visor: 0xffd5bd }
];

// Progressive 4-tier bot skill curve (gradual building & aiming progression)
export const BOT_DIFFICULTIES = {
  easy: {
    id: 'easy',
    label: 'Lehký',
    shortLabel: 'Lehký',
    aimJitter: 0.145,
    reactionSec: 0.60,
    fireRateMult: 0.52,
    buildChance: 0.22,
    rampRate: 0.22,
    buildCooldown: 1.15,
    maxBuildHeight: 2,
    moveSpeedMult: 0.72
  },
  medium: {
    id: 'medium',
    label: 'Střední',
    shortLabel: 'Střední',
    aimJitter: 0.085,
    reactionSec: 0.36,
    fireRateMult: 0.76,
    buildChance: 0.50,
    rampRate: 0.48,
    buildCooldown: 0.68,
    maxBuildHeight: 4,
    moveSpeedMult: 0.86
  },
  hard: {
    id: 'hard',
    label: 'Těžký',
    shortLabel: 'Těžký',
    aimJitter: 0.042,
    reactionSec: 0.20,
    fireRateMult: 0.96,
    buildChance: 0.78,
    rampRate: 0.78,
    buildCooldown: 0.40,
    maxBuildHeight: 7,
    moveSpeedMult: 0.98
  },
  extreme: {
    id: 'extreme',
    label: 'Extrém',
    shortLabel: 'Extrém',
    aimJitter: 0.018,
    reactionSec: 0.10,
    fireRateMult: 1.12,
    buildChance: 0.95,
    rampRate: 1.0,
    buildCooldown: 0.24,
    maxBuildHeight: 11,
    moveSpeedMult: 1.06
  }
};

export const RESET_BUTTON_POSITIONS = [
  { x: -12, z: 0, label: 'WEST' },
  { x: 12, z: 0, label: 'EAST' }
];
