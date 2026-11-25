export const CS2_SOURCE_SCALE = 36.0; // 250 u/s ≈ 6.94 m/s

export const CS2_MODES = {
  wingman: {
    id: 'wingman',
    teamSize: 2,
    winsTarget: 9,
    halfRound: 8,
    maxRounds: 16,
    freezeTime: 10,
    liveTime: 90,
    bombTimer: 40,
    plantTime: 3.2,
    defuseTime: 5.0,
    roundEndTime: 4.2,
    sites: ['A'],
    startMoney: 800,
    buyAnywhere: false
  },
  competitive: {
    id: 'competitive',
    teamSize: 5,
    winsTarget: 13,
    halfRound: 12,
    maxRounds: 24,
    freezeTime: 10,
    liveTime: 115,
    bombTimer: 40,
    plantTime: 3.2,
    defuseTime: 5.0,
    roundEndTime: 4.5,
    sites: ['A', 'B'],
    startMoney: 800,
    buyAnywhere: false
  },
  training: {
    id: 'training',
    teamSize: 5,
    winsTarget: 99,
    halfRound: 99,
    maxRounds: 198,
    freezeTime: 2,
    liveTime: 600,
    bombTimer: 40,
    plantTime: 2.4,
    defuseTime: 3.5,
    roundEndTime: 3.0,
    sites: ['A', 'B'],
    startMoney: 16000,
    buyAnywhere: true
  }
};

export const CS2_MOVE = {
  GRAVITY_U: 800.0,
  JUMP_SPEED_U: 302.0,
  SV_FRICTION: 5.2,
  SV_STOPSPEED: 80.0,
  SV_ACCELERATE: 5.5,
  SV_COUNTER_STRAFE_ACCEL: 14.5,
  SV_AIRACCELERATE: 120.0,
  SV_AIR_WISHCAP: 32.0,
  BHOP_MAX_SPEED_U: 350.0,
  BHOP_SPEED_BOOST: 1.045,
  BHOP_LAND_GRACE: 0.085,
  JUMP_BUFFER_WINDOW: 0.12,
  ACCURATE_SPEED_U: 38.0,
  WALK_MULT: 0.52,
  CROUCH_MULT: 0.34,
  PLAYER_RADIUS: 0.38,
  STAND_HEIGHT: 1.80,
  CROUCH_HEIGHT: 1.32,
  EYE_STAND: 1.62,
  EYE_CROUCH: 1.14,
  STEP_HEIGHT: 0.42
};

export const CS2_ECONOMY = {
  START_MONEY: 800,
  MAX_MONEY: 16000,
  KILL_REWARD_DEFAULT: 300,
  KILL_REWARD_AWP: 100,
  KILL_REWARD_KNIFE: 1500,
  PLANT_REWARD: 300,
  DEFUSE_REWARD: 300,
  WIN_ELIM_REWARD: 3250,
  WIN_OBJ_REWARD: 3500,
  LOSS_BASE: 1400,
  LOSS_STEP: 500,
  LOSS_MAX_BONUS: 4,
  KEVLAR_PRICE: 650,
  HELMET_PRICE: 1000,
  HELMET_UPGRADE_PRICE: 350
};

export const CS2_HIT_MULT = {
  head: 4.0,
  body: 1.0,
  legs: 0.75
};

// Spray pattern offsets in degrees: [yawOffsetDeg, pitchKickDeg] per bullet index
const AK47_PATTERN = [
  [0.0, 0.45], [0.05, 0.92], [-0.08, 1.55], [0.14, 2.25], [-0.18, 2.95],
  [0.32, 3.55], [0.75, 4.05], [1.25, 4.45], [1.55, 4.65], [0.85, 4.80],
  [-0.35, 4.90], [-1.45, 4.95], [-2.25, 5.05], [-2.55, 5.10], [-1.65, 5.15],
  [-0.45, 5.20], [0.85, 5.25], [1.95, 5.30], [2.45, 5.32], [1.75, 5.35],
  [0.45, 5.35], [-0.95, 5.35], [-1.85, 5.35], [-1.25, 5.38], [0.25, 5.40],
  [1.35, 5.40], [2.05, 5.42], [1.10, 5.42], [-0.40, 5.42], [-1.20, 5.42]
];

const M4A1_PATTERN = [
  [0.0, 0.30], [0.04, 0.62], [-0.05, 1.05], [0.10, 1.52], [-0.12, 2.02],
  [0.24, 2.48], [0.55, 2.85], [0.92, 3.10], [1.10, 3.25], [0.52, 3.35],
  [-0.25, 3.42], [-0.95, 3.48], [-1.48, 3.54], [-1.65, 3.58], [-1.05, 3.62],
  [-0.25, 3.65], [0.65, 3.68], [1.35, 3.70], [1.60, 3.72], [1.02, 3.74],
  [0.20, 3.75], [-0.65, 3.75], [-1.25, 3.76], [-0.75, 3.76], [0.15, 3.76]
];

const PISTOL_PATTERN = [
  [0.0, 0.35], [0.08, 0.68], [-0.10, 1.02], [0.15, 1.32], [-0.18, 1.55],
  [0.22, 1.72], [-0.25, 1.85], [0.25, 1.95], [-0.20, 2.02], [0.18, 2.08],
  [-0.15, 2.12], [0.12, 2.15]
];

const DEAGLE_PATTERN = [
  [0.0, 1.65], [0.35, 2.95], [-0.45, 4.10], [0.60, 4.95], [-0.55, 5.45],
  [0.45, 5.80], [-0.40, 6.00]
];

export const CS2_WEAPONS = {
  ak47: {
    id: 'ak47',
    slot: 0, // primary
    category: 'rifle',
    nameKey: 'cs2_w_ak47',
    shortName: 'AK-47',
    price: 2700,
    team: 'both',
    damage: 36,
    armorPen: 0.775, // 36 * 4 * 0.775 = 111.6 dmg -> 1-tap headshot through helmet!
    range: 180,
    fireRate: 0.10, // 600 RPM
    magSize: 30,
    reserveAmmo: 90,
    reloadTime: 2.4,
    moveSpeedU: 215,
    scopedMoveSpeedU: 215,
    baseSpread: 0.0014,
    moveInacc: 0.052,
    airInacc: 0.11,
    crouchMult: 0.62,
    recoilResetSec: 0.38,
    cameraKickPitch: 0.015,
    cameraKickYaw: 0.004,
    auto: true,
    hasScope: false,
    killReward: 300,
    sprayPattern: AK47_PATTERN,
    color: 0xd97706
  },
  m4a1: {
    id: 'm4a1',
    slot: 0,
    category: 'rifle',
    nameKey: 'cs2_w_m4a1',
    shortName: 'M4A1',
    price: 3100,
    team: 'both',
    damage: 32,
    armorPen: 0.72, // 32 * 4 * 0.72 = 92.1 dmg vs helmet; 128 unarmored
    range: 180,
    fireRate: 0.09, // 666 RPM
    magSize: 25,
    reserveAmmo: 75,
    reloadTime: 2.2,
    moveSpeedU: 225,
    scopedMoveSpeedU: 225,
    baseSpread: 0.0008,
    moveInacc: 0.042,
    airInacc: 0.095,
    crouchMult: 0.58,
    recoilResetSec: 0.32,
    cameraKickPitch: 0.0095,
    cameraKickYaw: 0.0025,
    auto: true,
    hasScope: false,
    killReward: 300,
    sprayPattern: M4A1_PATTERN,
    color: 0x38bdf8
  },
  awp: {
    id: 'awp',
    slot: 0,
    category: 'sniper',
    nameKey: 'cs2_w_awp',
    shortName: 'AWP',
    price: 4750,
    team: 'both',
    damage: 115,
    armorPen: 0.975, // 112 dmg body -> 1 shot to body = kill!
    range: 240,
    fireRate: 1.45,
    magSize: 5,
    reserveAmmo: 25,
    reloadTime: 3.1,
    moveSpeedU: 200,
    scopedMoveSpeedU: 100,
    baseSpread: 0.058, // hip-fire inaccurate
    scopedSpread: 0.0002, // pinpoint when scoped & still
    moveInacc: 0.085,
    airInacc: 0.18,
    crouchMult: 0.55,
    recoilResetSec: 0.7,
    cameraKickPitch: 0.036,
    cameraKickYaw: 0.006,
    auto: false,
    hasScope: true,
    scopeFov1: 40,
    scopeFov2: 16,
    scopeSens1: 0.52,
    scopeSens2: 0.24,
    killReward: 100,
    sprayPattern: [[0, 2.2]],
    color: 0x4d7c0f
  },
  pistol: {
    id: 'pistol',
    slot: 1, // secondary
    category: 'pistol',
    nameKey: 'cs2_w_pistol',
    shortName: 'USP-9',
    price: 200,
    team: 'both',
    damage: 28,
    armorPen: 0.55, // 28 * 4 = 112 unarmored, ~62 vs helmet
    range: 120,
    fireRate: 0.17,
    magSize: 12,
    reserveAmmo: 36,
    reloadTime: 1.8,
    moveSpeedU: 240,
    scopedMoveSpeedU: 240,
    baseSpread: 0.0022,
    moveInacc: 0.024,
    airInacc: 0.07,
    crouchMult: 0.65,
    recoilResetSec: 0.25,
    cameraKickPitch: 0.007,
    cameraKickYaw: 0.002,
    auto: false,
    hasScope: false,
    killReward: 300,
    sprayPattern: PISTOL_PATTERN,
    color: 0x94a3b8
  },
  deagle: {
    id: 'deagle',
    slot: 1,
    category: 'pistol',
    nameKey: 'cs2_w_deagle',
    shortName: 'Deagle',
    price: 700,
    team: 'both',
    damage: 54,
    armorPen: 0.93, // 54 * 4 * 0.93 = 200 dmg -> 1-tap headshot at range!
    range: 150,
    fireRate: 0.28,
    magSize: 7,
    reserveAmmo: 35,
    reloadTime: 2.1,
    moveSpeedU: 230,
    scopedMoveSpeedU: 230,
    baseSpread: 0.0018,
    moveInacc: 0.048,
    airInacc: 0.12,
    crouchMult: 0.60,
    recoilResetSec: 0.46,
    cameraKickPitch: 0.024,
    cameraKickYaw: 0.005,
    auto: false,
    hasScope: false,
    killReward: 300,
    sprayPattern: DEAGLE_PATTERN,
    color: 0xe2e8f0
  },
  knife: {
    id: 'knife',
    slot: 2,
    category: 'melee',
    nameKey: 'cs2_w_knife',
    shortName: 'Knife',
    price: 0,
    team: 'both',
    damage: 42,
    heavyDamage: 85,
    armorPen: 0.85,
    range: 2.4,
    fireRate: 0.42,
    heavyFireRate: 0.72,
    magSize: Infinity,
    reserveAmmo: 0,
    reloadTime: 0,
    moveSpeedU: 250,
    scopedMoveSpeedU: 250,
    baseSpread: 0,
    moveInacc: 0,
    airInacc: 0,
    crouchMult: 1,
    recoilResetSec: 0.1,
    cameraKickPitch: 0,
    cameraKickYaw: 0,
    auto: true,
    hasScope: false,
    killReward: 1500,
    sprayPattern: [[0, 0]],
    color: 0xcbd5e1
  },
  c4: {
    id: 'c4',
    slot: 3,
    category: 'c4',
    nameKey: 'cs2_w_c4',
    shortName: 'C4',
    price: 0,
    team: 't',
    damage: 0,
    armorPen: 0,
    range: 0,
    fireRate: 0.5,
    magSize: Infinity,
    reserveAmmo: 0,
    reloadTime: 0,
    moveSpeedU: 240,
    scopedMoveSpeedU: 240,
    baseSpread: 0,
    moveInacc: 0,
    airInacc: 0,
    crouchMult: 1,
    recoilResetSec: 0.1,
    cameraKickPitch: 0,
    cameraKickYaw: 0,
    auto: false,
    hasScope: false,
    killReward: 0,
    sprayPattern: [[0, 0]],
    color: 0xef4444
  }
};

export const CS2_BUY_ITEMS = [
  { key: '1', type: 'weapon', id: 'pistol', price: 200, slot: 1 },
  { key: '2', type: 'weapon', id: 'deagle', price: 700, slot: 1 },
  { key: '3', type: 'weapon', id: 'm4a1', price: 3100, slot: 0 },
  { key: '4', type: 'weapon', id: 'ak47', price: 2700, slot: 0 },
  { key: '5', type: 'weapon', id: 'awp', price: 4750, slot: 0 },
  { key: '6', type: 'armor', id: 'kevlar', price: 650 },
  { key: '7', type: 'armor', id: 'helmet', price: 1000 }
];

export const CS2_BOT_PROFILES = {
  easy: {
    id: 'easy',
    reactionSec: 0.55,
    aimJitter: 0.085,
    headshotBias: 0.08,
    burstLen: 2,
    burstPause: 0.42,
    speedMult: 0.84
  },
  medium: {
    id: 'medium',
    reactionSec: 0.34,
    aimJitter: 0.048,
    headshotBias: 0.18,
    burstLen: 4,
    burstPause: 0.28,
    speedMult: 0.94
  },
  hard: {
    id: 'hard',
    reactionSec: 0.19,
    aimJitter: 0.025,
    headshotBias: 0.32,
    burstLen: 5,
    burstPause: 0.18,
    speedMult: 1.0
  },
  extreme: {
    id: 'extreme',
    reactionSec: 0.11,
    aimJitter: 0.013,
    headshotBias: 0.48,
    burstLen: 6,
    burstPause: 0.12,
    speedMult: 1.04
  }
};

export const CS2_BOT_NAMES_CT = ['Vanguard', 'Kestrel', 'Falcon', 'Rook', 'Sentinel', 'Cobalt', 'Ward'];
export const CS2_BOT_NAMES_T = ['Dune', 'Mirage', 'Jackal', 'Cobra', 'Viper', 'Nomad', 'Sirocco'];
