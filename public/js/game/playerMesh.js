import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLAYER_SKINS } from './constants.js';
import { getMuzzleFlashTexture } from './textures.js';
import {
  instantiateCustomCharacter,
  instantiateCustomWeapon,
  isCustomModelEnabled,
  loadCustomModel,
  onModelModeChanged
} from './modelLoader.js';

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function buildMergedGeo(parts) {
  const prepared = [];
  for (const part of parts) {
    const [srcGeo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1] = part;
    const g = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
    _pos.set(x, y, z);
    _euler.set(rx, ry, rz);
    _quat.setFromEuler(_euler);
    _scale.set(sx, sy, sz);
    _mat4.compose(_pos, _quat, _scale);
    g.applyMatrix4(_mat4);
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    if (!g.attributes.normal) g.computeVertexNormals();
    prepared.push(g);
  }
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  if (merged) merged.computeBoundingSphere();
  return merged;
}

function buildStylizedGeometries() {
  // Reusable source primitives (disposed after merge)
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl10 = new THREE.CylinderGeometry(1, 1, 1, 10);
  const unitCyl8 = new THREE.CylinderGeometry(1, 1, 1, 8);
  const unitSphere = new THREE.SphereGeometry(1, 10, 8);

  // Character geometries (feet at y = 0, hip at y = 0.70, head top at y = 1.85, facing -Z)
  const thighCap = new THREE.CapsuleGeometry(0.105, 0.20, 4, 8);
  const shinCyl = new THREE.CylinderGeometry(0.088, 0.072, 0.24, 8);
  const legSecondary = buildMergedGeo([
    [thighCap, 0, -0.15, 0, 0, 0, 0, 1, 1, 1.05],
    [shinCyl, 0, -0.40, 0]
  ]);
  thighCap.dispose();
  shinCyl.dispose();

  const legKneeDark = buildMergedGeo([
    [unitBox, 0, -0.30, -0.095, 0.12, 0, 0, 0.135, 0.11, 0.06],
    [unitBox, 0, -0.675, -0.035, 0, 0, 0, 0.175, 0.05, 0.275] // Combat boot sole reaches -0.70
  ]);

  const cuffCyl = new THREE.CylinderGeometry(0.084, 0.088, 0.14, 8);
  const toeCap = new THREE.CapsuleGeometry(0.078, 0.12, 4, 8);
  const bootPrimary = buildMergedGeo([
    [cuffCyl, 0, -0.54, 0],
    [toeCap, 0, -0.62, -0.045, Math.PI * 0.5, 0, 0, 1.05, 1.1, 0.75]
  ]);
  cuffCyl.dispose();
  toeCap.dispose();

  // Torso (primary)
  const torsoCyl = new THREE.CylinderGeometry(0.24, 0.18, 0.46, 10);
  const trapCap = new THREE.CapsuleGeometry(0.14, 0.26, 4, 8);
  const collarCyl = new THREE.CylinderGeometry(0.085, 0.098, 0.10, 10);
  const torsoPrimary = buildMergedGeo([
    [torsoCyl, 0, 0.36, 0, 0, 0, 0, 1.12, 1, 0.66],
    [trapCap, 0, 0.54, 0, 0, 0, Math.PI * 0.5, 1, 1, 0.75],
    [collarCyl, 0, 0.64, 0]
  ]);
  torsoCyl.dispose();
  trapCap.dispose();
  collarCyl.dispose();

  // Chest armor & straps (secondary)
  const chestSecondary = buildMergedGeo([
    [unitBox, 0, 0.44, -0.135, 0.08, 0, 0, 0.38, 0.24, 0.07],
    [unitBox, 0, 0.44, 0.12, -0.04, 0, 0, 0.32, 0.26, 0.06],
    [unitBox, -0.14, 0.59, 0, 0, 0, 0, 0.09, 0.06, 0.26],
    [unitBox, 0.14, 0.59, 0, 0, 0, 0, 0.09, 0.06, 0.26]
  ]);

  // Tactical belt & pouches (dark metal)
  const beltDark = buildMergedGeo([
    [unitCyl10, 0, 0.11, 0, 0, 0, 0, 0.205, 0.09, 0.145],
    [unitBox, 0, 0.11, -0.155, 0, 0, 0, 0.11, 0.085, 0.045],
    [unitBox, -0.23, 0.11, 0, 0, 0, 0, 0.06, 0.10, 0.10],
    [unitBox, 0.23, 0.11, 0, 0, 0, 0, 0.06, 0.10, 0.10]
  ]);

  // Glowing chest emblem (visor)
  const coreHex = new THREE.CylinderGeometry(0.052, 0.035, 0.03, 6);
  const chestEmblemVisor = buildMergedGeo([
    [coreHex, 0, 0.46, -0.175, Math.PI * 0.5, 0, 0]
  ]);
  coreHex.dispose();

  // Backpack (secondary + visor accents)
  const packCapCyl = new THREE.CylinderGeometry(0.11, 0.16, 0.10, 8);
  const nozzleCyl = new THREE.CylinderGeometry(0.042, 0.056, 0.14, 8);
  const packSecondary = buildMergedGeo([
    [unitBox, 0, 0.38, 0.21, 0, 0, 0, 0.32, 0.38, 0.15],
    [packCapCyl, 0, 0.59, 0.20, 0, 0, 0, 1.4, 1, 0.75],
    [nozzleCyl, -0.10, 0.24, 0.26, -0.25, 0, 0],
    [nozzleCyl, 0.10, 0.24, 0.26, -0.25, 0, 0]
  ]);
  packCapCyl.dispose();
  nozzleCyl.dispose();

  const packVisor = buildMergedGeo([
    [unitBox, 0, 0.40, 0.292, 0, 0, 0, 0.075, 0.24, 0.035],
    [unitCyl8, -0.10, 0.17, 0.28, -0.25, 0, 0, 0.045, 0.03, 0.045],
    [unitCyl8, 0.10, 0.17, 0.28, -0.25, 0, 0, 0.045, 0.03, 0.045]
  ]);

  // Head & Helmet (primary cranium + crest + brow hood)
  const headSphere = new THREE.SphereGeometry(0.215, 12, 10);
  const headPrimary = buildMergedGeo([
    [headSphere, 0, 0.25, 0, 0, 0, 0, 0.96, 1.04, 1.04],
    [unitBox, 0, 0.45, 0.01, -0.08, 0, 0, 0.07, 0.06, 0.30],
    [unitBox, 0, 0.335, -0.16, 0.18, 0, 0, 0.32, 0.055, 0.13]
  ]);
  headSphere.dispose();

  // Helmet Secondary (ear-pods, jaw respirator, neck stabilizer)
  const earCyl = new THREE.CylinderGeometry(0.068, 0.056, 0.055, 10);
  const helmetSecondary = buildMergedGeo([
    [earCyl, -0.21, 0.23, 0.01, 0, 0, Math.PI * 0.5],
    [earCyl, 0.21, 0.23, 0.01, 0, 0, -Math.PI * 0.5],
    [unitBox, 0, 0.12, -0.16, -0.15, 0, 0, 0.22, 0.11, 0.12],
    [unitBox, 0, 0.18, 0.19, 0, 0, 0, 0.18, 0.12, 0.07]
  ]);
  earCyl.dispose();

  // Curved Panoramic Visor / Goggles (facing -Z)
  const visorArc = new THREE.CylinderGeometry(0.212, 0.212, 0.102, 12, 1, false, Math.PI * 0.72, Math.PI * 0.56);
  const visorGeo = buildMergedGeo([
    [visorArc, 0, 0.245, -0.012]
  ]);
  visorArc.dispose();

  const rimArc = new THREE.CylinderGeometry(0.215, 0.215, 0.022, 12, 1, false, Math.PI * 0.71, Math.PI * 0.58);
  const goggleFrameDark = buildMergedGeo([
    [rimArc, 0, 0.298, -0.014],
    [rimArc, 0, 0.192, -0.014],
    [unitBox, 0, 0.245, -0.222, 0, 0, 0, 0.035, 0.095, 0.02]
  ]);
  rimArc.dispose();

  // Upper Arms (shoulder pauldron + bicep + elbow)
  const buildUpperArm = (side) => {
    const pauldron = buildMergedGeo([
      [unitSphere, side * 0.018, 0.0, 0, 0, 0, side * -0.15, 0.115, 0.10, 0.115]
    ]);
    const bicep = buildMergedGeo([
      [unitCyl8, 0, -0.14, 0, 0, 0, 0, 0.078, 0.22, 0.078]
    ]);
    const elbow = buildMergedGeo([
      [unitSphere, 0, -0.25, 0.015, 0, 0, 0, 0.075, 0.075, 0.075]
    ]);
    return { pauldron, bicep, elbow };
  };
  const leftUpper = buildUpperArm(-1);
  const rightUpper = buildUpperArm(1);

  // Forearm + Gloved Hand
  const forearmPrimary = buildMergedGeo([
    [unitCyl8, 0, -0.11, 0, 0, 0, 0, 0.076, 0.20, 0.076]
  ]);
  const handDark = buildMergedGeo([
    [unitSphere, 0, -0.225, -0.012, 0, 0, 0, 0.064, 0.072, 0.078]
  ]);

  // =====================================================
  // Detailed Multi-Part 3D Weapons (pointing -Z forward)
  // =====================================================

  // 1. Pump Shotgun
  const sgDark = buildMergedGeo([
    [unitBox, 0, 0.02, -0.18, 0, 0, 0, 0.095, 0.14, 0.34],               // Receiver
    [unitBox, 0, -0.02, 0.08, -0.22, 0, 0, 0.075, 0.12, 0.28],           // Angled stock
    [unitBox, 0, -0.055, 0.21, -0.22, 0, 0, 0.08, 0.145, 0.045],         // Buttpad
    [unitCyl10, 0, 0.068, -0.50, Math.PI * 0.5, 0, 0, 0.026, 0.54, 0.026], // Heavy barrel
    [unitCyl8, 0, 0.015, -0.46, Math.PI * 0.5, 0, 0, 0.022, 0.44, 0.022],  // Tube mag
    [unitBox, 0, 0.04, -0.66, 0, 0, 0, 0.064, 0.09, 0.04]                // Barrel clamp
  ]);
  const sgAccent = buildMergedGeo([
    [unitBox, 0, 0.098, -0.34, 0, 0, 0, 0.058, 0.024, 0.42],             // Top heatshield rail
    [unitBox, -0.054, 0.02, -0.18, 0, 0, 0, 0.024, 0.075, 0.18],         // Side shell carrier
    [unitBox, 0, 0.105, -0.74, 0, 0, 0, 0.024, 0.032, 0.035]             // Front iron sight base
  ]);
  const sgWood = buildMergedGeo([
    [unitCyl10, 0, 0.015, -0.44, Math.PI * 0.5, 0, 0, 0.042, 0.22, 0.042], // Pump fore-end
    [unitCyl10, 0, 0.015, -0.37, Math.PI * 0.5, 0, 0, 0.046, 0.025, 0.046],
    [unitCyl10, 0, 0.015, -0.44, Math.PI * 0.5, 0, 0, 0.046, 0.025, 0.046],
    [unitCyl10, 0, 0.015, -0.51, Math.PI * 0.5, 0, 0, 0.046, 0.025, 0.046],
    [unitBox, 0, -0.07, -0.03, 0.32, 0, 0, 0.058, 0.13, 0.075]           // Pistol grip
  ]);
  const sgSight = buildMergedGeo([
    [unitSphere, 0, 0.125, -0.74, 0, 0, 0, 0.014, 0.014, 0.014]          // Glowing bead
  ]);

  // 2. Assault Rifle
  const arDark = buildMergedGeo([
    [unitBox, 0, 0.025, -0.22, 0, 0, 0, 0.088, 0.135, 0.42],             // Receiver
    [unitBox, 0, 0.01, 0.08, -0.05, 0, 0, 0.064, 0.115, 0.24],           // Stock
    [unitBox, 0, 0.005, 0.20, 0, 0, 0, 0.07, 0.135, 0.04],               // Stock buttpad
    [unitBox, 0, -0.075, -0.04, 0.34, 0, 0, 0.052, 0.13, 0.068],         // Pistol grip
    [unitBox, 0, -0.095, -0.26, -0.24, 0, 0, 0.052, 0.17, 0.082],        // Curved mag upper
    [unitBox, 0, -0.21, -0.29, -0.38, 0, 0, 0.050, 0.12, 0.076]          // Curved mag lower
  ]);
  const arAccent = buildMergedGeo([
    [unitBox, 0, 0.035, -0.52, 0, 0, 0, 0.072, 0.092, 0.28],             // Tactical handguard shroud
    [unitCyl10, 0, 0.045, -0.73, Math.PI * 0.5, 0, 0, 0.020, 0.30, 0.020], // Extended barrel
    [unitCyl8, 0, 0.045, -0.85, Math.PI * 0.5, 0, 0, 0.027, 0.08, 0.027],  // Muzzle brake
    [unitBox, 0, 0.10, -0.26, 0, 0, 0, 0.048, 0.02, 0.36],               // Top Picatinny rail
    [unitBox, 0, 0.13, -0.20, 0, 0, 0, 0.056, 0.052, 0.12]               // Reflex optic frame
  ]);
  const arOptic = buildMergedGeo([
    [unitBox, 0, 0.135, -0.20, 0, 0, 0, 0.038, 0.034, 0.045]             // Holographic optic glow
  ]);

  // 2b. Tactical SMG (compact PDW with shroud & drum/extended stick mag)
  const smgDark = buildMergedGeo([
    [unitBox, 0, 0.02, -0.16, 0, 0, 0, 0.082, 0.125, 0.30],              // Compact receiver
    [unitBox, 0, 0.015, 0.05, 0, 0, 0, 0.052, 0.085, 0.16],              // Folded stub stock
    [unitBox, 0, -0.07, -0.04, 0.30, 0, 0, 0.050, 0.12, 0.064],          // Grip
    [unitBox, 0, -0.105, -0.20, -0.16, 0, 0, 0.044, 0.21, 0.058]         // Slim stick mag
  ]);
  const smgAccent = buildMergedGeo([
    [unitCyl10, 0, 0.035, -0.44, Math.PI * 0.5, 0, 0, 0.032, 0.28, 0.032], // Suppressed shroud
    [unitBox, 0, 0.095, -0.17, 0, 0, 0, 0.042, 0.022, 0.22],             // Top rail
    [unitBox, 0, -0.055, -0.34, 0.15, 0, 0, 0.040, 0.095, 0.048]         // Vertical foregrip
  ]);
  const smgOptic = buildMergedGeo([
    [unitBox, 0, 0.122, -0.15, 0, 0, 0, 0.032, 0.030, 0.045]             // Micro dot sight
  ]);

  // 2c. Bolt Sniper Rifle (long heavy barrel + magnified scope)
  const sniperDark = buildMergedGeo([
    [unitBox, 0, 0.02, -0.22, 0, 0, 0, 0.092, 0.13, 0.46],               // Heavy chassis
    [unitBox, 0, 0.005, 0.12, -0.06, 0, 0, 0.068, 0.13, 0.28],           // Precision buttstock
    [unitBox, 0, -0.07, -0.02, 0.28, 0, 0, 0.052, 0.125, 0.068],         // Grip
    [unitBox, 0, -0.075, -0.22, 0, 0, 0, 0.054, 0.075, 0.12]             // Box mag
  ]);
  const sniperAccent = buildMergedGeo([
    [unitCyl10, 0, 0.048, -0.82, Math.PI * 0.5, 0, 0, 0.022, 0.78, 0.022], // Long precision barrel
    [unitBox, 0, 0.048, -1.20, 0, 0, 0, 0.060, 0.046, 0.085],            // Muzzle brake
    [unitCyl10, 0, 0.135, -0.26, Math.PI * 0.5, 0, 0, 0.032, 0.34, 0.032], // Scope tube
    [unitBox, 0, 0.10, -0.24, 0, 0, 0, 0.034, 0.042, 0.18]               // Scope mount
  ]);
  const sniperLens = buildMergedGeo([
    [unitCyl10, 0, 0.135, -0.44, Math.PI * 0.5, 0, 0, 0.038, 0.035, 0.038] // Scope objective lens
  ]);

  // 3. Pickaxe
  const pkWood = buildMergedGeo([
    [unitCyl10, 0, 0.18, -0.18, -0.58, 0, 0, 0.028, 0.78, 0.028],
    [unitCyl10, 0, -0.10, 0.00, -0.58, 0, 0, 0.036, 0.16, 0.036]
  ]);
  const pkAccent = buildMergedGeo([
    [unitBox, 0, 0.48, -0.38, -0.58, 0, 0, 0.11, 0.10, 0.13],
    [unitCyl8, 0, -0.19, 0.06, -0.58, 0, 0, 0.040, 0.05, 0.040]
  ]);
  const pkSpike = new THREE.CylinderGeometry(0.004, 0.038, 0.14, 6);
  const pkTip = buildMergedGeo([
    [unitBox, 0, 0.51, -0.53, -0.28, 0, 0, 0.045, 0.075, 0.28],
    [pkSpike, 0, 0.45, -0.70, -Math.PI * 0.5 - 0.18, 0, 0],
    [unitBox, 0, 0.54, -0.25, -0.68, 0, 0, 0.042, 0.12, 0.22]
  ]);
  pkSpike.dispose();

  // 4. Holo Blueprint Pad
  const bpPad = buildMergedGeo([
    [unitBox, 0, 0.04, -0.22, -0.35, 0, 0, 0.28, 0.028, 0.36]
  ]);
  const bpFrame = buildMergedGeo([
    [unitBox, 0, 0.04, -0.39, -0.35, 0, 0, 0.30, 0.036, 0.024],
    [unitBox, 0, 0.04, -0.05, -0.35, 0, 0, 0.30, 0.036, 0.024],
    [unitBox, -0.14, 0.04, -0.22, -0.35, 0, 0, 0.024, 0.036, 0.36],
    [unitBox, 0.14, 0.04, -0.22, -0.35, 0, 0, 0.024, 0.036, 0.36]
  ]);

  const blobShadow = new THREE.CircleGeometry(0.48, 12);

  unitBox.dispose();
  unitCyl10.dispose();
  unitCyl8.dispose();
  unitSphere.dispose();

  return {
    legSecondary,
    legKneeDark,
    bootPrimary,
    torsoPrimary,
    chestSecondary,
    beltDark,
    chestEmblemVisor,
    packSecondary,
    packVisor,
    headPrimary,
    helmetSecondary,
    visorGeo,
    goggleFrameDark,
    leftPauldron: leftUpper.pauldron,
    leftBicep: leftUpper.bicep,
    leftElbow: leftUpper.elbow,
    rightPauldron: rightUpper.pauldron,
    rightBicep: rightUpper.bicep,
    rightElbow: rightUpper.elbow,
    forearmPrimary,
    handDark,
    sgDark,
    sgAccent,
    sgWood,
    sgSight,
    arDark,
    arAccent,
    arOptic,
    smgDark,
    smgAccent,
    smgOptic,
    sniperDark,
    sniperAccent,
    sniperLens,
    pkWood,
    pkAccent,
    pkTip,
    bpPad,
    bpFrame,
    blobShadow
  };
}

const GEOS = buildStylizedGeometries();

const WEAPON_MAT_TIERS = {
  basic: {
    darkMetal: new THREE.MeshBasicMaterial({ color: 0x262c36 }),
    gunAccent: new THREE.MeshBasicMaterial({ color: 0x5c6b80 }),
    woodGrip: new THREE.MeshBasicMaterial({ color: 0x9b6234 }),
    pickTip: new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
  },
  lambert: {
    darkMetal: new THREE.MeshLambertMaterial({ color: 0x262c36 }),
    gunAccent: new THREE.MeshLambertMaterial({ color: 0x5c6b80 }),
    woodGrip: new THREE.MeshLambertMaterial({ color: 0x9b6234 }),
    pickTip: new THREE.MeshLambertMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.45 })
  },
  standard: {
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x262c36, roughness: 0.42, metalness: 0.55 }),
    gunAccent: new THREE.MeshStandardMaterial({ color: 0x5c6b80, roughness: 0.35, metalness: 0.65 }),
    woodGrip: new THREE.MeshStandardMaterial({ color: 0x9b6234, roughness: 0.78, metalness: 0.04 }),
    pickTip: new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.55,
      roughness: 0.22,
      metalness: 0.35
    })
  }
};

const WEAPON_SHARED_MATS = {
  sightGlow: new THREE.MeshBasicMaterial({ color: 0xfef08a }),
  blueprintGlow: new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.72 }),
  blueprintFrame: new THREE.MeshBasicMaterial({ color: 0xbae6fd }),
  hbBg: new THREE.MeshBasicMaterial({ color: 0x090d16, transparent: true, opacity: 0.78, side: THREE.DoubleSide }),
  hbShield: new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide }),
  hbHp: new THREE.MeshBasicMaterial({ color: 0x4ade80, side: THREE.DoubleSide }),
  blobShadow: new THREE.MeshBasicMaterial({ color: 0x04060b, transparent: true, opacity: 0.32, depthWrite: false })
};

let muzzleFlashMatCache = null;
function getMuzzleFlashMaterial() {
  if (!muzzleFlashMatCache) {
    muzzleFlashMatCache = new THREE.MeshBasicMaterial({
      map: getMuzzleFlashTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide
    });
  }
  return muzzleFlashMatCache;
}

const MUZZLE_PLANE_FRONT = new THREE.PlaneGeometry(0.42, 0.42);
const MUZZLE_PLANE_LONG = new THREE.PlaneGeometry(0.54, 0.34);
const HB_BG_GEO = new THREE.PlaneGeometry(1.06, 0.24);
const HB_BAR_GEO = new THREE.PlaneGeometry(0.98, 0.08);

const SHOTGUN_MUZZLE_LOCAL = new THREE.Vector3(0, 0.068, -0.78);
const SMG_MUZZLE_LOCAL = new THREE.Vector3(0, 0.035, -0.60);
const AR_MUZZLE_LOCAL = new THREE.Vector3(0, 0.045, -0.89);
const SNIPER_MUZZLE_LOCAL = new THREE.Vector3(0, 0.048, -1.25);

const PICKUP_DARK_MAT = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
const PICKUP_GRIP_MAT = new THREE.MeshBasicMaterial({ color: 0xc87d44 });
const PICKUP_ACCENT_MATS = {
  shotgun: new THREE.MeshBasicMaterial({ color: 0xfbbf24 }),
  smg: new THREE.MeshBasicMaterial({ color: 0x34d399 }),
  ar: new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
  sniper: new THREE.MeshBasicMaterial({ color: 0xfb7185 })
};

export function createWeaponPickupModel(weaponId) {
  const grp = new THREE.Group();
  const darkMat = PICKUP_DARK_MAT;
  const accentMat = PICKUP_ACCENT_MATS[weaponId] || PICKUP_ACCENT_MATS.ar;
  const gripMat = PICKUP_GRIP_MAT;

  if (weaponId === 'shotgun') {
    grp.add(
      new THREE.Mesh(GEOS.sgDark, darkMat),
      new THREE.Mesh(GEOS.sgAccent, accentMat),
      new THREE.Mesh(GEOS.sgWood, gripMat)
    );
    grp.scale.setScalar(1.45);
  } else if (weaponId === 'smg') {
    grp.add(
      new THREE.Mesh(GEOS.smgDark, darkMat),
      new THREE.Mesh(GEOS.smgAccent, accentMat),
      new THREE.Mesh(GEOS.smgOptic, accentMat)
    );
    grp.scale.setScalar(1.45);
  } else if (weaponId === 'sniper') {
    grp.add(
      new THREE.Mesh(GEOS.sniperDark, darkMat),
      new THREE.Mesh(GEOS.sniperAccent, accentMat),
      new THREE.Mesh(GEOS.sniperLens, accentMat)
    );
    grp.scale.setScalar(1.24);
  } else {
    grp.add(
      new THREE.Mesh(GEOS.arDark, darkMat),
      new THREE.Mesh(GEOS.arAccent, accentMat),
      new THREE.Mesh(GEOS.arOptic, accentMat)
    );
    grp.scale.setScalar(1.42);
  }
  grp.rotation.z = 0.22;
  grp.rotation.x = 0.14;
  for (let i = 0; i < grp.children.length; i++) {
    grp.children[i].userData.sharedGeo = true;
  }
  return grp;
}

export function preloadFighterAssets() {
  if (!isCustomModelEnabled('character') && !isCustomModelEnabled('weapons')) {
    return Promise.resolve(null);
  }
  const tasks = [];
  if (isCustomModelEnabled('character')) tasks.push(loadCustomModel('character'));
  if (isCustomModelEnabled('weapons')) {
    tasks.push(loadCustomModel('shotgun'), loadCustomModel('ar'), loadCustomModel('pickaxe'));
  }
  return Promise.all(tasks);
}

export function getSkinById(skinId) {
  return PLAYER_SKINS.find((s) => s.id === skinId) || PLAYER_SKINS[0];
}

// Share compiled WebGL shader programs & materials across all rigs with the same skin + quality tier
const SKIN_MAT_CACHE = new Map();
const CUSTOM_BASIC_CACHE = new Map();
function getLowBasicMaterial(origMat) {
  if (!origMat) return null;
  if (origMat.isMeshBasicMaterial || origMat.isShaderMaterial) return origMat;
  let basic = CUSTOM_BASIC_CACHE.get(origMat.uuid);
  if (!basic) {
    basic = new THREE.MeshBasicMaterial({
      color: origMat.color ? origMat.color.getHex() : 0xffffff,
      vertexColors: Boolean(origMat.vertexColors)
    });
    CUSTOM_BASIC_CACHE.set(origMat.uuid, basic);
  }
  return basic;
}
function getSharedSkinMaterials(skinId, tier = 'standard') {
  const skin = getSkinById(skinId);
  let tiers = SKIN_MAT_CACHE.get(skin.id);
  if (!tiers) {
    tiers = {
      basic: {
        primary: new THREE.MeshBasicMaterial({ color: skin.primary }),
        secondary: new THREE.MeshBasicMaterial({ color: skin.secondary }),
        visor: new THREE.MeshBasicMaterial({ color: skin.visor })
      },
      lambert: {
        primary: new THREE.MeshLambertMaterial({ color: skin.primary }),
        secondary: new THREE.MeshLambertMaterial({ color: skin.secondary }),
        visor: new THREE.MeshLambertMaterial({ color: skin.visor, emissive: skin.visor, emissiveIntensity: 0.55 })
      },
      standard: {
        primary: new THREE.MeshStandardMaterial({
          color: skin.primary,
          roughness: 0.45,
          metalness: 0.12
        }),
        secondary: new THREE.MeshStandardMaterial({
          color: skin.secondary,
          roughness: 0.68,
          metalness: 0.08
        }),
        visor: new THREE.MeshStandardMaterial({
          color: skin.visor,
          emissive: skin.visor,
          emissiveIntensity: 0.65,
          roughness: 0.2,
          metalness: 0.3
        })
      }
    };
    SKIN_MAT_CACHE.set(skin.id, tiers);
  }
  return tiers[tier] || tiers.lambert;
}

export function createCharacterRig(skinId = 'cyan', castShadow = true, withHealthBar = false, lightweight = false) {
  let currentSkinId = skinId;
  let currentQualityTier = castShadow ? 'lambert' : 'basic';
  let muzzleFlashEnabled = true;

  const initialMats = getSharedSkinMaterials(currentSkinId, currentQualityTier);
  const initialWeaponMats = WEAPON_MAT_TIERS[currentQualityTier];
  const primaryMat = initialMats.primary;
  const secondaryMat = initialMats.secondary;
  const visorMat = initialMats.visor;

  const root = new THREE.Group();
  let disposed = false;
  let blobShadow = null;

  if (!lightweight) {
    blobShadow = new THREE.Mesh(GEOS.blobShadow, WEAPON_SHARED_MATS.blobShadow);
    blobShadow.rotation.x = -Math.PI / 2;
    blobShadow.position.y = 0.02;
    root.add(blobShadow);
  }

  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const builtInBodyMeshes = [];
  const shadowMeshes = [];
  const trackBodyMesh = (mesh) => {
    mesh.castShadow = castShadow;
    mesh.receiveShadow = castShadow;
    mesh.frustumCulled = true;
    builtInBodyMeshes.push(mesh);
    shadowMeshes.push(mesh);
    return mesh;
  };

  // Legs (pivot at hip y = 0.70, sole reaches y = 0.00)
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.14, 0.70, 0);
  const leftLegMesh = trackBodyMesh(new THREE.Mesh(GEOS.legSecondary, secondaryMat));
  const leftKneeMesh = trackBodyMesh(new THREE.Mesh(GEOS.legKneeDark, initialWeaponMats.darkMetal));
  const leftBootMesh = trackBodyMesh(new THREE.Mesh(GEOS.bootPrimary, primaryMat));
  leftLegPivot.add(leftLegMesh, leftKneeMesh, leftBootMesh);
  bodyPivot.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.14, 0.70, 0);
  const rightLegMesh = trackBodyMesh(new THREE.Mesh(GEOS.legSecondary, secondaryMat));
  const rightKneeMesh = trackBodyMesh(new THREE.Mesh(GEOS.legKneeDark, initialWeaponMats.darkMetal));
  const rightBootMesh = trackBodyMesh(new THREE.Mesh(GEOS.bootPrimary, primaryMat));
  rightLegPivot.add(rightLegMesh, rightKneeMesh, rightBootMesh);
  bodyPivot.add(rightLegPivot);

  // Upper body group (pivot at hip y = 0.70)
  const upperBody = new THREE.Group();
  upperBody.position.set(0, 0.70, 0);
  bodyPivot.add(upperBody);

  const torso = trackBodyMesh(new THREE.Mesh(GEOS.torsoPrimary, primaryMat));
  const chestArmor = trackBodyMesh(new THREE.Mesh(GEOS.chestSecondary, secondaryMat));
  const belt = trackBodyMesh(new THREE.Mesh(GEOS.beltDark, initialWeaponMats.darkMetal));
  const chestEmblem = trackBodyMesh(new THREE.Mesh(GEOS.chestEmblemVisor, visorMat));
  upperBody.add(torso, chestArmor, belt, chestEmblem);

  let backpack = null;
  let packStripe = null;
  if (!lightweight) {
    backpack = trackBodyMesh(new THREE.Mesh(GEOS.packSecondary, secondaryMat));
    packStripe = trackBodyMesh(new THREE.Mesh(GEOS.packVisor, visorMat));
    upperBody.add(backpack, packStripe);
  }

  // Head + Recon Helmet + Panoramic Visor/Goggles
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.68, 0);
  const headMesh = trackBodyMesh(new THREE.Mesh(GEOS.headPrimary, primaryMat));
  const helmetTrimMesh = trackBodyMesh(new THREE.Mesh(GEOS.helmetSecondary, secondaryMat));
  const visorMesh = trackBodyMesh(new THREE.Mesh(GEOS.visorGeo, visorMat));
  const goggleFrameMesh = trackBodyMesh(new THREE.Mesh(GEOS.goggleFrameDark, initialWeaponMats.darkMetal));
  headPivot.add(headMesh, helmetTrimMesh, visorMesh, goggleFrameMesh);
  upperBody.add(headPivot);

  // Left arm (shoulder + forearm pivot for two-handed grip & natural swing)
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.35, 0.58, 0);
  const leftPauldron = trackBodyMesh(new THREE.Mesh(GEOS.leftPauldron, primaryMat));
  const leftBicep = trackBodyMesh(new THREE.Mesh(GEOS.leftBicep, secondaryMat));
  const leftElbow = trackBodyMesh(new THREE.Mesh(GEOS.leftElbow, initialWeaponMats.darkMetal));
  leftArmPivot.add(leftPauldron, leftBicep, leftElbow);

  const leftForearmPivot = new THREE.Group();
  leftForearmPivot.position.set(0, -0.25, 0);
  const leftForearm = trackBodyMesh(new THREE.Mesh(GEOS.forearmPrimary, primaryMat));
  const leftHand = trackBodyMesh(new THREE.Mesh(GEOS.handDark, initialWeaponMats.darkMetal));
  leftForearmPivot.add(leftForearm, leftHand);
  leftArmPivot.add(leftForearmPivot);
  upperBody.add(leftArmPivot);

  // Right arm (shoulder + forearm + weapon mount)
  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.35, 0.58, 0);
  const rightPauldron = trackBodyMesh(new THREE.Mesh(GEOS.rightPauldron, primaryMat));
  const rightBicep = trackBodyMesh(new THREE.Mesh(GEOS.rightBicep, secondaryMat));
  const rightElbow = trackBodyMesh(new THREE.Mesh(GEOS.rightElbow, initialWeaponMats.darkMetal));
  rightArmPivot.add(rightPauldron, rightBicep, rightElbow);

  const rightForearmPivot = new THREE.Group();
  rightForearmPivot.position.set(0, -0.25, 0);
  const rightForearm = trackBodyMesh(new THREE.Mesh(GEOS.forearmPrimary, primaryMat));
  const rightHand = trackBodyMesh(new THREE.Mesh(GEOS.handDark, initialWeaponMats.darkMetal));
  rightForearmPivot.add(rightForearm, rightHand);
  rightArmPivot.add(rightForearmPivot);

  const handMount = new THREE.Group();
  handMount.position.set(0, -0.22, -0.03);
  rightForearmPivot.add(handMount);

  const weaponMount = new THREE.Group();
  handMount.add(weaponMount);
  upperBody.add(rightArmPivot);

  // Weapons (all oriented cleanly pointing -Z forward)
  const makeWeaponSlotGroup = (builtInMeshes) => {
    const slotGroup = new THREE.Group();
    const builtIn = new THREE.Group();
    for (const m of builtInMeshes) {
      m.castShadow = castShadow;
      m.receiveShadow = castShadow;
      m.frustumCulled = true;
      shadowMeshes.push(m);
      builtIn.add(m);
    }
    const customHolder = new THREE.Group();
    customHolder.visible = false;
    slotGroup.add(builtIn, customHolder);
    slotGroup.userData.builtIn = builtIn;
    slotGroup.userData.customHolder = customHolder;
    return slotGroup;
  };

  // Shotgun
  const sgDarkMesh = new THREE.Mesh(GEOS.sgDark, initialWeaponMats.darkMetal);
  const sgAccentMesh = new THREE.Mesh(GEOS.sgAccent, initialWeaponMats.gunAccent);
  const sgWoodMesh = new THREE.Mesh(GEOS.sgWood, initialWeaponMats.woodGrip);
  const sgSightMesh = new THREE.Mesh(GEOS.sgSight, WEAPON_SHARED_MATS.sightGlow);
  const shotgunGroup = makeWeaponSlotGroup([sgDarkMesh, sgAccentMesh, sgWoodMesh, sgSightMesh]);
  weaponMount.add(shotgunGroup);

  // Assault Rifle
  const arDarkMesh = new THREE.Mesh(GEOS.arDark, initialWeaponMats.darkMetal);
  const arAccentMesh = new THREE.Mesh(GEOS.arAccent, initialWeaponMats.gunAccent);
  const arOpticMesh = new THREE.Mesh(GEOS.arOptic, initialWeaponMats.pickTip);
  const arGroup = makeWeaponSlotGroup([arDarkMesh, arAccentMesh, arOpticMesh]);
  weaponMount.add(arGroup);

  // Tactical SMG
  const smgDarkMesh = new THREE.Mesh(GEOS.smgDark, initialWeaponMats.darkMetal);
  const smgAccentMesh = new THREE.Mesh(GEOS.smgAccent, initialWeaponMats.gunAccent);
  const smgOpticMesh = new THREE.Mesh(GEOS.smgOptic, initialWeaponMats.pickTip);
  const smgGroup = makeWeaponSlotGroup([smgDarkMesh, smgAccentMesh, smgOpticMesh]);
  smgGroup.visible = false;
  weaponMount.add(smgGroup);

  // Bolt Sniper
  const sniperDarkMesh = new THREE.Mesh(GEOS.sniperDark, initialWeaponMats.darkMetal);
  const sniperAccentMesh = new THREE.Mesh(GEOS.sniperAccent, initialWeaponMats.gunAccent);
  const sniperLensMesh = new THREE.Mesh(GEOS.sniperLens, initialWeaponMats.pickTip);
  const sniperGroup = makeWeaponSlotGroup([sniperDarkMesh, sniperAccentMesh, sniperLensMesh]);
  sniperGroup.visible = false;
  weaponMount.add(sniperGroup);

  // Pickaxe
  const pkWoodMesh = new THREE.Mesh(GEOS.pkWood, initialWeaponMats.woodGrip);
  const pkAccentMesh = new THREE.Mesh(GEOS.pkAccent, initialWeaponMats.gunAccent);
  const pkTipMesh = new THREE.Mesh(GEOS.pkTip, initialWeaponMats.pickTip);
  const pickaxeGroup = makeWeaponSlotGroup([pkWoodMesh, pkAccentMesh, pkTipMesh]);
  weaponMount.add(pickaxeGroup);

  // Blueprint Pad
  const blueprintGroup = new THREE.Group();
  blueprintGroup.add(
    new THREE.Mesh(GEOS.bpPad, WEAPON_SHARED_MATS.blueprintGlow),
    new THREE.Mesh(GEOS.bpFrame, WEAPON_SHARED_MATS.blueprintFrame)
  );
  weaponMount.add(blueprintGroup);

  // Tracked material groups for instant quality switching
  const primaryMeshes = [torso, headMesh, leftBootMesh, rightBootMesh, leftPauldron, rightPauldron, leftForearm, rightForearm];
  const secondaryMeshes = [chestArmor, helmetTrimMesh, leftLegMesh, rightLegMesh, leftBicep, rightBicep];
  if (backpack) secondaryMeshes.push(backpack);
  const visorMeshes = [visorMesh, chestEmblem];
  if (packStripe) visorMeshes.push(packStripe);
  const darkMetalMeshes = [leftKneeMesh, rightKneeMesh, belt, goggleFrameMesh, leftElbow, rightElbow, leftHand, rightHand, sgDarkMesh, arDarkMesh, smgDarkMesh, sniperDarkMesh];
  const gunAccentMeshes = [sgAccentMesh, arAccentMesh, smgAccentMesh, sniperAccentMesh, pkAccentMesh];
  const woodGripMeshes = [sgWoodMesh, pkWoodMesh];
  const pickTipMeshes = [arOpticMesh, smgOpticMesh, sniperLensMesh, pkTipMesh];

  // Muzzle Flash Starburst (3 crossed additive planes, hidden until fired)
  const muzzleFlashGroup = new THREE.Group();
  muzzleFlashGroup.visible = false;
  const mfMat = getMuzzleFlashMaterial();
  const mfFront = new THREE.Mesh(MUZZLE_PLANE_FRONT, mfMat);
  const mfCrossA = new THREE.Mesh(MUZZLE_PLANE_LONG, mfMat);
  mfCrossA.rotation.y = Math.PI * 0.5;
  mfCrossA.position.z = -0.18;
  const mfCrossB = new THREE.Mesh(MUZZLE_PLANE_LONG, mfMat);
  mfCrossB.rotation.set(0, Math.PI * 0.5, Math.PI * 0.5);
  mfCrossB.position.z = -0.18;
  muzzleFlashGroup.add(mfFront, mfCrossA, mfCrossB);
  weaponMount.add(muzzleFlashGroup);

  let muzzleFlashTimer = 0;
  let muzzleFlashMax = 0.06;
  let muzzleFlashBaseScale = 1.0;

  // Custom .GLB runtime state
  let customCharInstance = null;
  let activeAnimName = 'idle';
  let customWeaponsLoaded = false;

  const setBuiltInBodyVisible = (visible) => {
    for (const m of builtInBodyMeshes) {
      m.visible = visible;
    }
  };

  const syncCustomCharacterState = () => {
    if (disposed) return;
    const wantChar = isCustomModelEnabled('character');
    if (wantChar) {
      if (customCharInstance) {
        setBuiltInBodyVisible(false);
        customCharInstance.root.visible = true;
        if (customCharInstance.handSocket) {
          customCharInstance.handSocket.add(weaponMount);
        }
      } else {
        loadCustomModel('character').then((asset) => {
          if (disposed || !asset || !isCustomModelEnabled('character')) return;
          if (!customCharInstance) {
            customCharInstance = instantiateCustomCharacter(asset, castShadow);
            if (customCharInstance) {
              bodyPivot.add(customCharInstance.root);
            }
          }
          if (customCharInstance) {
            setBuiltInBodyVisible(false);
            customCharInstance.root.visible = true;
            if (customCharInstance.handSocket) {
              customCharInstance.handSocket.add(weaponMount);
            }
          }
        });
      }
    } else {
      setBuiltInBodyVisible(true);
      if (customCharInstance) {
        customCharInstance.root.visible = false;
      }
      if (weaponMount.parent !== handMount) {
        handMount.add(weaponMount);
      }
    }
  };

  const syncCustomWeaponsState = () => {
    if (disposed) return;
    const wantWeapons = isCustomModelEnabled('weapons');
    const slots = [
      ['shotgun', shotgunGroup],
      ['ar', arGroup],
      ['pickaxe', pickaxeGroup]
    ];

    if (wantWeapons) {
      if (!customWeaponsLoaded) {
        customWeaponsLoaded = true;
        for (const [key, grp] of slots) {
          loadCustomModel(key).then((asset) => {
            if (disposed || !asset || !isCustomModelEnabled('weapons')) return;
            if (grp.userData.customHolder.children.length === 0) {
              const obj = instantiateCustomWeapon(key, asset, castShadow);
              if (obj) grp.userData.customHolder.add(obj);
            }
            if (grp.userData.customHolder.children.length > 0) {
              grp.userData.builtIn.visible = false;
              grp.userData.customHolder.visible = true;
            }
          });
        }
      } else {
        for (const [, grp] of slots) {
          const hasCustom = grp.userData.customHolder.children.length > 0;
          grp.userData.builtIn.visible = !hasCustom;
          grp.userData.customHolder.visible = hasCustom;
        }
      }
    } else {
      for (const [, grp] of slots) {
        grp.userData.builtIn.visible = true;
        grp.userData.customHolder.visible = false;
      }
    }
  };

  syncCustomCharacterState();
  syncCustomWeaponsState();
  const unsubModelMode = onModelModeChanged(() => {
    syncCustomCharacterState();
    syncCustomWeaponsState();
  });

  function applyMaterials() {
    const mats = getSharedSkinMaterials(currentSkinId, currentQualityTier);
    const wMats = WEAPON_MAT_TIERS[currentQualityTier] || WEAPON_MAT_TIERS.lambert;
    for (let i = 0; i < primaryMeshes.length; i++) primaryMeshes[i].material = mats.primary;
    for (let i = 0; i < secondaryMeshes.length; i++) secondaryMeshes[i].material = mats.secondary;
    for (let i = 0; i < visorMeshes.length; i++) visorMeshes[i].material = mats.visor;
    for (let i = 0; i < darkMetalMeshes.length; i++) darkMetalMeshes[i].material = wMats.darkMetal;
    for (let i = 0; i < gunAccentMeshes.length; i++) gunAccentMeshes[i].material = wMats.gunAccent;
    for (let i = 0; i < woodGripMeshes.length; i++) woodGripMeshes[i].material = wMats.woodGrip;
    for (let i = 0; i < pickTipMeshes.length; i++) pickTipMeshes[i].material = wMats.pickTip;
  }

  function setSkin(newSkinId) {
    currentSkinId = newSkinId;
    applyMaterials();
  }

  function setQualityTier(qualityKey) {
    const tier = qualityKey === 'low' ? 'basic' : (qualityKey === 'high' ? 'standard' : 'lambert');
    const isLow = qualityKey === 'low';
    const enableShadows = !isLow;
    muzzleFlashEnabled = !isLow;
    if (blobShadow) {
      blobShadow.visible = !isLow;
    }
    if (!muzzleFlashEnabled) {
      muzzleFlashTimer = 0;
      muzzleFlashGroup.visible = false;
    }
    for (let i = 0; i < shadowMeshes.length; i++) {
      shadowMeshes[i].castShadow = enableShadows;
      shadowMeshes[i].receiveShadow = enableShadows;
    }
    const updateCustomGroup = (grp) => {
      if (!grp) return;
      grp.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = enableShadows;
        o.receiveShadow = enableShadows;
        if (isLow) {
          if (!o.userData._origMat && o.material) {
            o.userData._origMat = o.material;
            o.material = Array.isArray(o.material)
              ? o.material.map(getLowBasicMaterial)
              : getLowBasicMaterial(o.material);
          }
        } else if (o.userData._origMat) {
          o.material = o.userData._origMat;
          delete o.userData._origMat;
        }
      });
    };
    if (customCharInstance) updateCustomGroup(customCharInstance.root);
    updateCustomGroup(shotgunGroup.userData.customHolder);
    updateCustomGroup(arGroup.userData.customHolder);
    updateCustomGroup(pickaxeGroup.userData.customHolder);
    if (currentQualityTier !== tier) {
      currentQualityTier = tier;
      applyMaterials();
    }
  }

  let currentWeaponSlot = 0;
  let currentWeaponId = 'shotgun';
  let currentBuildMode = false;

  function setWeapon(slot, buildModeActive = false, weaponId = null) {
    currentWeaponSlot = slot;
    currentBuildMode = Boolean(buildModeActive);
    const resolvedId = weaponId || (slot === 2 ? 'pickaxe' : (slot === 1 ? 'ar' : 'shotgun'));
    currentWeaponId = resolvedId;
    shotgunGroup.visible = !currentBuildMode && resolvedId === 'shotgun';
    smgGroup.visible = !currentBuildMode && resolvedId === 'smg';
    arGroup.visible = !currentBuildMode && resolvedId === 'ar';
    sniperGroup.visible = !currentBuildMode && resolvedId === 'sniper';
    pickaxeGroup.visible = !currentBuildMode && resolvedId === 'pickaxe';
    blueprintGroup.visible = currentBuildMode;
  }

  function _getMuzzleLocalForId(weaponId, slotFallback) {
    const id = weaponId || (slotFallback === 1 ? 'ar' : 'shotgun');
    if (id === 'shotgun') return SHOTGUN_MUZZLE_LOCAL;
    if (id === 'smg') return SMG_MUZZLE_LOCAL;
    if (id === 'sniper') return SNIPER_MUZZLE_LOCAL;
    return AR_MUZZLE_LOCAL;
  }

  function triggerMuzzleFlash(weaponSlot = currentWeaponSlot, weaponId = null) {
    if (!muzzleFlashEnabled || weaponSlot === 2 || currentBuildMode) return;
    const id = weaponId || currentWeaponId;
    const isShotgun = id === 'shotgun';
    const isSniper = id === 'sniper';
    muzzleFlashGroup.position.copy(_getMuzzleLocalForId(id, weaponSlot));
    muzzleFlashGroup.rotation.z = Math.random() * Math.PI * 2;
    muzzleFlashBaseScale = isSniper ? 1.4 : (isShotgun ? 1.25 : 0.90);
    muzzleFlashMax = isSniper ? 0.08 : (isShotgun ? 0.068 : 0.052);
    muzzleFlashTimer = muzzleFlashMax;
    muzzleFlashGroup.scale.setScalar(muzzleFlashBaseScale);
    muzzleFlashGroup.visible = true;
  }

  function getMuzzleWorldPosition(outVec, weaponSlotOverride = null, weaponIdOverride = null) {
    const slot = weaponSlotOverride !== null ? weaponSlotOverride : currentWeaponSlot;
    const id = weaponIdOverride || (weaponSlotOverride !== null ? null : currentWeaponId);
    outVec.copy(_getMuzzleLocalForId(id, slot));
    weaponMount.updateWorldMatrix(true, false);
    return weaponMount.localToWorld(outVec);
  }

  let lastAnimTime = null;
  let adsBlend = 0;
  let walkPhase = 0;

  function animate(time, speed, crouch, pitch, swingPhase, isBuildMode, weaponSlot, isADS = false, strafe = 0, grounded = true, emoteId = null, emoteTime = 0, reloadProgress = 0) {
    const dt = lastAnimTime !== null ? Math.max(0.001, Math.min(0.05, time - lastAnimTime)) : 0.016;
    lastAnimTime = time;

    // Muzzle flash decay
    if (muzzleFlashTimer > 0) {
      muzzleFlashTimer -= dt;
      if (muzzleFlashTimer <= 0) {
        muzzleFlashTimer = 0;
        muzzleFlashGroup.visible = false;
      } else {
        const ratio = muzzleFlashTimer / muzzleFlashMax;
        muzzleFlashGroup.scale.setScalar(muzzleFlashBaseScale * (0.55 + 0.65 * ratio));
      }
    }

    if (emoteId) {
      weaponMount.visible = false;
      weaponMount.position.set(0, 0, 0);
      weaponMount.rotation.z = 0;
      if (emoteId === 'take_l') {
        const beat = emoteTime * 8.2;
        const hop = Math.abs(Math.sin(beat)) * 0.14;
        const kick = Math.sin(beat);
        bodyPivot.position.set(0, hop, 0);
        bodyPivot.rotation.set(0.11, 0, Math.sin(beat * 0.5) * 0.04);
        upperBody.position.y = 0.70;
        upperBody.rotation.set(0, Math.sin(beat) * 0.16, Math.sin(beat * 0.5) * 0.06);
        headPivot.rotation.set(-0.08, Math.sin(beat) * 0.14, Math.sin(beat * 0.5) * 0.12);

        // Alternating high leg kicks
        leftLegPivot.rotation.set(kick > 0 ? kick * 1.12 : -0.14, 0, -0.06);
        rightLegPivot.rotation.set(kick < 0 ? -kick * 1.12 : -0.14, 0, 0.06);

        // Right arm raised making "L" gesture on forehead; left hand on hip
        rightArmPivot.rotation.set(2.35, 0.16, 0.24);
        rightForearmPivot.rotation.set(1.25, 0, -0.68);
        leftArmPivot.rotation.set(0.18, 0, -0.58);
        leftForearmPivot.rotation.set(0.68, 0, 0.96);
      } else if (emoteId === 'floss') {
        const p = emoteTime * 6.8;
        const sway = Math.sin(p);
        const dbl = Math.abs(Math.sin(p * 2));
        const pass = Math.cos(p) * 0.58;
        bodyPivot.position.set(-sway * 0.09, dbl * 0.035, 0);
        bodyPivot.rotation.set(0, 0, sway * 0.13);
        upperBody.position.y = 0.70;
        upperBody.rotation.set(0, -sway * 0.24, -sway * 0.09);
        headPivot.rotation.set(0.04, sway * 0.14, -sway * 0.08);

        leftLegPivot.rotation.set(dbl * 0.12, 0, -0.14);
        rightLegPivot.rotation.set(dbl * 0.12, 0, 0.14);

        // Parallel swinging arms alternating front/back across waist
        leftArmPivot.rotation.set(pass, sway * 0.3, sway * 0.68 - 0.12);
        leftForearmPivot.rotation.set(0.28, 0, 0);
        rightArmPivot.rotation.set(-pass, sway * 0.3, sway * 0.68 + 0.12);
        rightForearmPivot.rotation.set(0.28, 0, 0);
      } else {
        // 'gg' — friendly raised wave + cheerful hop
        const w = emoteTime * 9.5;
        const hop = Math.abs(Math.sin(emoteTime * 4.75)) * 0.055;
        bodyPivot.position.set(0, hop, 0);
        bodyPivot.rotation.set(0, 0, 0);
        upperBody.position.y = 0.70;
        upperBody.rotation.set(0, -0.18, -0.05);
        headPivot.rotation.set(-0.04, 0.12, Math.sin(emoteTime * 4.75) * 0.08);

        leftLegPivot.rotation.set(0.06, 0, -0.08);
        rightLegPivot.rotation.set(-0.06, 0, 0.08);

        rightArmPivot.rotation.set(0.32, 0, 2.42 + Math.sin(w) * 0.22);
        rightForearmPivot.rotation.set(0.24, 0, -0.32 + Math.sin(w + 0.6) * 0.34);
        leftArmPivot.rotation.set(0.12, 0, -0.26);
        leftForearmPivot.rotation.set(0.36, 0, 0.12);
      }
      return;
    }

    weaponMount.visible = true;
    bodyPivot.position.set(0, 0, 0);

    const adsTarget = (isADS && !isBuildMode && weaponSlot !== 2) ? 1 : 0;
    adsBlend += (adsTarget - adsBlend) * Math.min(1, dt * 16);

    const moveFactor = Math.min(1, speed / 9.2);
    walkPhase += dt * (8.5 + moveFactor * 4.5);
    const stride = moveFactor * Math.sin(walkPhase) * 0.68;
    const bounce = grounded ? Math.abs(Math.sin(walkPhase)) * 0.032 * moveFactor : 0;

    // Crouch & hip bounce
    const targetUpperY = (crouch ? 0.44 : 0.70) + bounce;
    upperBody.position.y += (targetUpperY - upperBody.position.y) * (1 - Math.exp(-16 * dt));

    // Body forward sprint lean (no sideways strafe bank wobble)
    const targetLeanX = crouch ? -0.14 : (-moveFactor * 0.095 - adsBlend * 0.06);
    bodyPivot.rotation.x += (targetLeanX - bodyPivot.rotation.x) * Math.min(1, dt * 12);
    bodyPivot.rotation.z += (0 - bodyPivot.rotation.z) * Math.min(1, dt * 12);

    // Legs
    if (!grounded) {
      leftLegPivot.rotation.set(0.34, 0, 0);
      rightLegPivot.rotation.set(-0.26, 0, 0);
    } else if (!crouch) {
      leftLegPivot.rotation.set(stride, 0, 0);
      rightLegPivot.rotation.set(-stride, 0, 0);
    } else {
      leftLegPivot.rotation.set(0.45 + stride * 0.45, 0, 0);
      rightLegPivot.rotation.set(-0.35 - stride * 0.45, 0, 0);
    }

    // Upper torso breathing & ADS combat shoulder twist (steady during strafe/camera turn)
    const breath = Math.sin(time * 2.4) * 0.012;
    upperBody.rotation.y = adsBlend * 0.22;
    upperBody.rotation.x = breath;
    upperBody.rotation.z = 0;

    // Head aim tracking + ADS cheek-weld tilt
    const clampedPitch = Math.max(-0.85, Math.min(0.85, pitch));
    headPivot.rotation.x = clampedPitch * 0.9;
    headPivot.rotation.y = -adsBlend * 0.16;
    headPivot.rotation.z = -adsBlend * 0.09;

    // Arm & weapon holding poses
    if (isBuildMode) {
      weaponMount.position.set(0, 0, 0);
      rightArmPivot.rotation.set(0.68 + clampedPitch * 0.5, 0.28, 0);
      rightForearmPivot.rotation.set(0.55, 0, 0);
      leftArmPivot.rotation.set(0.75 + clampedPitch * 0.5, -0.38, 0);
      leftForearmPivot.rotation.set(0.55, 0, 0);
      weaponMount.rotation.x = -(rightArmPivot.rotation.x + rightForearmPivot.rotation.x) + clampedPitch * 0.7;
      weaponMount.rotation.y = -0.28;
      weaponMount.rotation.z = 0;
    } else if (weaponSlot === 2) {
      weaponMount.position.set(0, 0, 0);
      // Pickaxe swing
      const swing = swingPhase > 0 ? Math.sin(swingPhase * Math.PI) : 0;
      rightArmPivot.rotation.set(0.55 + clampedPitch * 0.45 - swing * 1.35, 0.05 + swing * 0.35, -swing * 0.25);
      rightForearmPivot.rotation.set(0.32 - swing * 0.25, 0, 0);
      leftArmPivot.rotation.set(-stride * 0.65 + swing * 0.45, -0.08, 0);
      leftForearmPivot.rotation.set(0.35, 0, 0);
      weaponMount.rotation.set(0, 0, 0);
    } else if (reloadProgress > 0.001 && reloadProgress < 0.999) {
      // Tactical 3D reload animation tailored per firearm class
      const u = reloadProgress;
      const env = Math.min(1, u * 5.2, (1 - u) * 5.2);
      const isShotgun = currentWeaponId === 'shotgun';
      const isSniper = currentWeaponId === 'sniper';

      if (isSniper) {
        // Sniper: tilt barrel slightly up with left hand; right arm pulls bolt & cycles chamber
        const boltPull = Math.sin(Math.max(0, Math.min(1, (u - 0.14) / 0.72)) * Math.PI);
        const snap = Math.exp(-Math.pow((u - 0.74) * 14, 2));
        headPivot.rotation.x = clampedPitch * 0.65 - 0.14 * env;
        headPivot.rotation.z = 0.08 * env;
        upperBody.rotation.y = -0.18 * env;

        rightArmPivot.rotation.set(0.54 + clampedPitch * 0.35 + boltPull * 0.48, 0.32 - boltPull * 0.42, 0.18 * env);
        rightForearmPivot.rotation.set(0.76 + boltPull * 0.56, 0, -0.22 * boltPull);

        leftArmPivot.rotation.set(0.92 + clampedPitch * 0.35, -0.44, -0.12);
        leftForearmPivot.rotation.set(0.68, -0.22, 0);

        weaponMount.position.set(0, 0.02 * snap, -0.03 * boltPull);
        weaponMount.rotation.x = -(rightArmPivot.rotation.x + rightForearmPivot.rotation.x) + clampedPitch * 0.65 + 0.34 * env;
        weaponMount.rotation.y = -0.35 * env;
        weaponMount.rotation.z = 0.42 * env;
      } else if (isShotgun) {
        // Shotgun: tilt across torso while left hand pumps & loads shells rhythmically
        const shellPump = Math.sin(Math.max(0, Math.min(1, (u - 0.12) / 0.76)) * Math.PI * 3);
        headPivot.rotation.x = clampedPitch * 0.7 - 0.16 * env;
        upperBody.rotation.y = 0.14 * env;

        rightArmPivot.rotation.set(0.58 + clampedPitch * 0.4, 0.34, 0);
        rightForearmPivot.rotation.set(0.84, 0, 0);

        leftArmPivot.rotation.set(0.62 + clampedPitch * 0.3 + shellPump * 0.34, -0.58, -0.24 * env);
        leftForearmPivot.rotation.set(0.88 - shellPump * 0.42, -0.34, 0);

        weaponMount.position.set(-0.02 * env, 0.025 * Math.abs(shellPump), 0);
        weaponMount.rotation.x = -(rightArmPivot.rotation.x + rightForearmPivot.rotation.x) + clampedPitch * 0.65 + 0.38 * env;
        weaponMount.rotation.y = 0.28 * env;
        weaponMount.rotation.z = -0.56 * env + shellPump * 0.08;
      } else {
        // AR / SMG: cant weapon sideways, left arm swaps magazine from chest pouch and slaps receiver
        const dip = Math.sin(Math.max(0, Math.min(1, (u - 0.08) / 0.56)) * Math.PI);
        const magSnap = Math.exp(-Math.pow((u - 0.68) * 14, 2));
        const rack = Math.sin(Math.max(0, Math.min(1, (u - 0.74) / 0.22)) * Math.PI);
        headPivot.rotation.x = clampedPitch * 0.7 - 0.16 * env;
        upperBody.rotation.y = 0.18 * env;

        rightArmPivot.rotation.set(0.60 + clampedPitch * 0.4 + magSnap * 0.1, 0.36 * env + 0.18, 0);
        rightForearmPivot.rotation.set(0.88 + rack * 0.12, 0, 0);

        leftArmPivot.rotation.set(0.72 - dip * 0.62 + rack * 0.24, -0.52 + dip * 0.36, -0.28 * dip);
        leftForearmPivot.rotation.set(0.76 - dip * 0.42 + magSnap * 0.45 + rack * 0.25, -0.26, 0);

        weaponMount.position.set(0, 0.03 * magSnap, -0.02 * rack);
        weaponMount.rotation.x = -(rightArmPivot.rotation.x + rightForearmPivot.rotation.x) + clampedPitch * 0.7 + 0.28 * env + magSnap * 0.14;
        weaponMount.rotation.y = 0.32 * env;
        weaponMount.rotation.z = -0.62 * env;
      }
    } else {
      weaponMount.position.set(0, 0, 0);
      // Two-handed Shotgun / AR aim pose with recoil kick & ADS tuck
      const recoil = swingPhase > 0 ? Math.sin(swingPhase * Math.PI) * 0.18 : 0;
      const shoulderX = 0.68 + clampedPitch * 0.48 - recoil * 0.75 + adsBlend * 0.12;
      const elbowX = 0.66 + clampedPitch * 0.36 + recoil * 0.55;
      rightArmPivot.rotation.set(shoulderX, 0.24 - adsBlend * 0.06, 0);
      rightForearmPivot.rotation.set(elbowX, 0, 0);

      // Left arm reaches across to cradle the fore-end / pump
      leftArmPivot.rotation.set(0.84 + clampedPitch * 0.45 - recoil * 0.4, -0.48 - adsBlend * 0.08, -0.14);
      leftForearmPivot.rotation.set(0.52 + clampedPitch * 0.32, -0.24, 0);

      // Keep weapon aligned straight forward along aim pitch
      weaponMount.rotation.x = -(shoulderX + elbowX) + clampedPitch * 0.92 + recoil * 0.45;
      weaponMount.rotation.y = -0.24 + adsBlend * 0.06;
      weaponMount.rotation.z = 0;
    }

    // Drive optional custom GLB skeletal animations
    if (customCharInstance && customCharInstance.mixer) {
      customCharInstance.mixer.update(dt);
      let nextClip = 'idle';
      if (speed > 6.5 && customCharInstance.actions.run) nextClip = 'run';
      else if (speed > 0.6 && customCharInstance.actions.walk) nextClip = 'walk';
      if (nextClip !== activeAnimName && customCharInstance.actions[nextClip]) {
        const prev = customCharInstance.actions[activeAnimName];
        const next = customCharInstance.actions[nextClip];
        if (prev) prev.fadeOut(0.15);
        next.reset().fadeIn(0.15).play();
        activeAnimName = nextClip;
      }
    }
  }

  // Optional lightweight 3D floating health + shield bar (zero text allocs)
  let hbGroup = null;
  let hbShieldFill = null;
  let hbHpFill = null;
  if (withHealthBar) {
    hbGroup = new THREE.Group();
    hbGroup.position.set(0, 2.24, 0);
    const bg = new THREE.Mesh(HB_BG_GEO, WEAPON_SHARED_MATS.hbBg);
    hbShieldFill = new THREE.Mesh(HB_BAR_GEO, WEAPON_SHARED_MATS.hbShield);
    hbShieldFill.position.set(0, 0.055, 0.004);
    hbHpFill = new THREE.Mesh(HB_BAR_GEO, WEAPON_SHARED_MATS.hbHp);
    hbHpFill.position.set(0, -0.05, 0.004);
    hbGroup.add(bg, hbShieldFill, hbHpFill);
    root.add(hbGroup);
  }

  function updateHealthBar(hp, shield, camPos, maxDistSq = 99999) {
    if (!hbGroup) return;
    if (camPos && maxDistSq < 90000) {
      const dx = camPos.x - root.position.x;
      const dz = camPos.z - root.position.z;
      if (dx * dx + dz * dz > maxDistSq) {
        hbGroup.visible = false;
        return;
      }
    }
    hbGroup.visible = true;
    const sRatio = Math.max(0, Math.min(1, shield / 100));
    const hRatio = Math.max(0, Math.min(1, hp / 100));

    hbShieldFill.visible = sRatio > 0.005;
    if (hbShieldFill.visible) {
      hbShieldFill.scale.x = sRatio;
      hbShieldFill.position.x = -0.49 + 0.49 * sRatio;
    }

    hbHpFill.visible = hRatio > 0.005;
    if (hbHpFill.visible) {
      hbHpFill.scale.x = hRatio;
      hbHpFill.position.x = -0.49 + 0.49 * hRatio;
    }

    if (camPos) {
      const dx = camPos.x - root.position.x;
      const dz = camPos.z - root.position.z;
      hbGroup.rotation.y = Math.atan2(dx, dz) - root.rotation.y;
    }
  }

  function dispose() {
    disposed = true;
    unsubModelMode();
  }

  setWeapon(0, false);

  return {
    root,
    headPivot,
    setSkin,
    setQualityTier,
    setWeapon,
    animate,
    triggerMuzzleFlash,
    getMuzzleWorldPosition,
    updateHealthBar,
    dispose
  };
}
