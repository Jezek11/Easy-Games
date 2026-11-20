import * as THREE from 'three';
import { PLAYER_SKINS } from './constants.js';

// Fallback low-poly box geometries (used synchronously until Blender fighter.glb resolves)
const GEOS = {
  torso: new THREE.BoxGeometry(0.54, 0.62, 0.32),
  chestArmor: new THREE.BoxGeometry(0.56, 0.24, 0.34),
  belt: new THREE.BoxGeometry(0.56, 0.08, 0.34),
  pack: new THREE.BoxGeometry(0.36, 0.42, 0.14),
  packStripe: new THREE.BoxGeometry(0.12, 0.32, 0.04),
  head: new THREE.BoxGeometry(0.42, 0.42, 0.42),
  visor: new THREE.BoxGeometry(0.34, 0.14, 0.06),
  arm: new THREE.BoxGeometry(0.18, 0.56, 0.18),
  leg: new THREE.BoxGeometry(0.22, 0.68, 0.22),
  blobShadow: new THREE.CircleGeometry(0.46, 8),
  arBody: new THREE.BoxGeometry(0.1, 0.14, 0.68),
  arBarrel: new THREE.BoxGeometry(0.05, 0.05, 0.28),
  shotgunBody: new THREE.BoxGeometry(0.12, 0.15, 0.6),
  shotgunPump: new THREE.BoxGeometry(0.13, 0.09, 0.22),
  pickHandle: new THREE.BoxGeometry(0.06, 0.72, 0.06),
  pickHead: new THREE.BoxGeometry(0.46, 0.09, 0.09),
  blueprintPad: new THREE.BoxGeometry(0.26, 0.04, 0.34),
  empty: new THREE.BufferGeometry()
};

// Shared dark weapon materials (zero PBR overhead)
const WEAPON_MATS = {
  darkMetal: new THREE.MeshLambertMaterial({ color: 0x262c36 }),
  gunAccent: new THREE.MeshLambertMaterial({ color: 0x566275 }),
  woodGrip: new THREE.MeshLambertMaterial({ color: 0x8d5b34 }),
  pickTip: new THREE.MeshLambertMaterial({ color: 0x00d2ff }),
  blueprintGlow: new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 }),
  hbBg: new THREE.MeshBasicMaterial({ color: 0x090d16, transparent: true, opacity: 0.78, side: THREE.DoubleSide }),
  hbShield: new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide }),
  hbHp: new THREE.MeshBasicMaterial({ color: 0x4ade80, side: THREE.DoubleSide }),
  blobShadow: new THREE.MeshBasicMaterial({ color: 0x04060b, transparent: true, opacity: 0.34, depthWrite: false })
};

const HB_BG_GEO = new THREE.PlaneGeometry(1.06, 0.24);
const HB_BAR_GEO = new THREE.PlaneGeometry(0.98, 0.08);

// Cached Blender GLB geometries & active rig upgrade subscribers
let BLENDER_GEOS = null;
let fighterLoadPromise = null;
const PENDING_UPGRADES = new Set();

export function preloadFighterAssets() {
  if (fighterLoadPromise) return fighterLoadPromise;
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    fighterLoadPromise = Promise.resolve(null);
    return fighterLoadPromise;
  }

  fighterLoadPromise = import('three/addons/loaders/GLTFLoader.js')
    .then(({ GLTFLoader }) => new Promise((resolve) => {
      const loader = new GLTFLoader();
      loader.load(
        '/assets/models/fighter.glb',
        (gltf) => {
          const map = {};
          gltf.scene.traverse((obj) => {
            if (obj.isMesh && obj.geometry && obj.name) {
              map[obj.name] = obj.geometry;
            }
          });
          if (map.Torso_Primary && map.Head_Primary) {
            BLENDER_GEOS = map;
            for (const fn of PENDING_UPGRADES) fn(map);
            PENDING_UPGRADES.clear();
          }
          resolve(BLENDER_GEOS);
        },
        undefined,
        () => resolve(null)
      );
    }))
    .catch(() => null);

  return fighterLoadPromise;
}

// Kick off background fetch immediately in browser sessions
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  preloadFighterAssets();
}

export function getSkinById(skinId) {
  return PLAYER_SKINS.find((s) => s.id === skinId) || PLAYER_SKINS[0];
}

// Share compiled WebGL shader programs & materials across all rigs with the same skin
const SKIN_MAT_CACHE = new Map();
function getSharedSkinMaterials(skinId) {
  const skin = getSkinById(skinId);
  let cached = SKIN_MAT_CACHE.get(skin.id);
  if (!cached) {
    cached = {
      primary: new THREE.MeshLambertMaterial({ color: skin.primary }),
      secondary: new THREE.MeshLambertMaterial({ color: skin.secondary }),
      visor: new THREE.MeshBasicMaterial({ color: skin.visor })
    };
    SKIN_MAT_CACHE.set(skin.id, cached);
  }
  return cached;
}

export function createCharacterRig(skinId = 'cyan', castShadow = true, withHealthBar = false, lightweight = false) {
  const initialMats = getSharedSkinMaterials(skinId);
  const primaryMat = initialMats.primary;
  const secondaryMat = initialMats.secondary;
  const visorMat = initialMats.visor;

  const root = new THREE.Group();
  if (!lightweight) {
    const blobShadow = new THREE.Mesh(GEOS.blobShadow, WEAPON_MATS.blobShadow);
    blobShadow.rotation.x = -Math.PI / 2;
    blobShadow.position.y = 0.02;
    root.add(blobShadow);
  }

  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  // Legs (pivot at hip y = 0.68)
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.14, 0.68, 0);
  const leftLegMesh = new THREE.Mesh(GEOS.leg, secondaryMat);
  leftLegMesh.position.y = -0.34;
  leftLegMesh.castShadow = castShadow;
  leftLegPivot.add(leftLegMesh);
  const leftBootMesh = new THREE.Mesh(GEOS.empty, primaryMat);
  leftBootMesh.castShadow = castShadow;
  leftBootMesh.visible = false;
  leftLegPivot.add(leftBootMesh);
  bodyPivot.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.14, 0.68, 0);
  const rightLegMesh = new THREE.Mesh(GEOS.leg, secondaryMat);
  rightLegMesh.position.y = -0.34;
  rightLegMesh.castShadow = castShadow;
  rightLegPivot.add(rightLegMesh);
  const rightBootMesh = new THREE.Mesh(GEOS.empty, primaryMat);
  rightBootMesh.castShadow = castShadow;
  rightBootMesh.visible = false;
  rightLegPivot.add(rightBootMesh);
  bodyPivot.add(rightLegPivot);

  // Upper body group (pivot at hip y = 0.68; crouch lowers to 0.42)
  const upperBody = new THREE.Group();
  upperBody.position.set(0, 0.68, 0);
  bodyPivot.add(upperBody);

  const torso = new THREE.Mesh(GEOS.torso, primaryMat);
  torso.position.y = 0.34;
  torso.castShadow = castShadow;
  upperBody.add(torso);

  let chestArmor = null;
  let belt = null;
  let backpack = null;
  let packStripe = null;
  if (!lightweight) {
    chestArmor = new THREE.Mesh(GEOS.chestArmor, secondaryMat);
    chestArmor.position.y = 0.45;
    chestArmor.castShadow = castShadow;
    upperBody.add(chestArmor);

    belt = new THREE.Mesh(GEOS.belt, WEAPON_MATS.darkMetal);
    belt.position.y = 0.08;
    upperBody.add(belt);

    backpack = new THREE.Mesh(GEOS.pack, secondaryMat);
    backpack.position.set(0, 0.36, 0.21);
    backpack.castShadow = castShadow;
    upperBody.add(backpack);

    packStripe = new THREE.Mesh(GEOS.packStripe, visorMat);
    packStripe.position.set(0, 0.36, 0.285);
    upperBody.add(packStripe);
  }

  // Head + Helmet + Visor (faces -Z)
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.72, 0);
  const headMesh = new THREE.Mesh(GEOS.head, primaryMat);
  headMesh.position.y = 0.21;
  headMesh.castShadow = castShadow;
  headPivot.add(headMesh);

  let helmetTrimMesh = null;
  if (!lightweight) {
    helmetTrimMesh = new THREE.Mesh(GEOS.empty, secondaryMat);
    helmetTrimMesh.castShadow = castShadow;
    helmetTrimMesh.visible = false;
    headPivot.add(helmetTrimMesh);
  }

  const visorMesh = new THREE.Mesh(GEOS.visor, visorMat);
  visorMesh.position.set(0, 0.23, -0.205);
  headPivot.add(visorMesh);
  upperBody.add(headPivot);

  // Left arm (shoulder pivot)
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.37, 0.6, 0);
  const leftArmMesh = new THREE.Mesh(GEOS.arm, secondaryMat);
  leftArmMesh.position.y = -0.24;
  leftArmMesh.castShadow = castShadow;
  leftArmPivot.add(leftArmMesh);
  const leftArmArmorMesh = new THREE.Mesh(GEOS.empty, primaryMat);
  leftArmArmorMesh.castShadow = castShadow;
  leftArmArmorMesh.visible = false;
  leftArmPivot.add(leftArmArmorMesh);
  upperBody.add(leftArmPivot);

  // Right arm + weapon mount (shoulder pivot)
  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.37, 0.6, 0);
  const rightArmMesh = new THREE.Mesh(GEOS.arm, secondaryMat);
  rightArmMesh.position.y = -0.24;
  rightArmMesh.castShadow = castShadow;
  rightArmPivot.add(rightArmMesh);
  const rightArmArmorMesh = new THREE.Mesh(GEOS.empty, primaryMat);
  rightArmArmorMesh.castShadow = castShadow;
  rightArmArmorMesh.visible = false;
  rightArmPivot.add(rightArmArmorMesh);

  const handMount = new THREE.Group();
  handMount.position.set(0, -0.46, -0.06);
  rightArmPivot.add(handMount);

  // Shotgun
  const shotgunGroup = new THREE.Group();
  shotgunGroup.rotation.x = -Math.PI * 0.46;
  const sgBody = new THREE.Mesh(GEOS.shotgunBody, WEAPON_MATS.darkMetal);
  sgBody.position.z = -0.26;
  const sgPump = new THREE.Mesh(GEOS.shotgunPump, WEAPON_MATS.woodGrip);
  sgPump.position.set(0, -0.04, -0.38);
  const sgAccent = new THREE.Mesh(GEOS.empty, WEAPON_MATS.gunAccent);
  sgAccent.visible = false;
  shotgunGroup.add(sgBody, sgPump, sgAccent);
  handMount.add(shotgunGroup);

  // Assault Rifle
  const arGroup = new THREE.Group();
  arGroup.rotation.x = -Math.PI * 0.46;
  const arBody = new THREE.Mesh(GEOS.arBody, WEAPON_MATS.darkMetal);
  arBody.position.z = -0.28;
  const arBarrel = new THREE.Mesh(GEOS.arBarrel, WEAPON_MATS.gunAccent);
  arBarrel.position.set(0, 0.02, -0.66);
  const arOptic = new THREE.Mesh(GEOS.empty, WEAPON_MATS.pickTip);
  arOptic.visible = false;
  arGroup.add(arBody, arBarrel, arOptic);
  handMount.add(arGroup);

  // Pickaxe
  const pickaxeGroup = new THREE.Group();
  const pkHandle = new THREE.Mesh(GEOS.pickHandle, WEAPON_MATS.woodGrip);
  pkHandle.rotation.x = -Math.PI * 0.52;
  pkHandle.position.set(0, 0.04, -0.24);
  const pkHead = new THREE.Mesh(GEOS.pickHead, WEAPON_MATS.pickTip);
  pkHead.position.set(0, 0.08, -0.52);
  pickaxeGroup.add(pkHandle, pkHead);
  handMount.add(pickaxeGroup);

  // Blueprint Pad
  const blueprintGroup = new THREE.Group();
  blueprintGroup.rotation.x = -Math.PI * 0.35;
  const bpPad = new THREE.Mesh(GEOS.blueprintPad, WEAPON_MATS.blueprintGlow);
  bpPad.position.set(0, 0.02, -0.22);
  blueprintGroup.add(bpPad);
  handMount.add(blueprintGroup);

  upperBody.add(rightArmPivot);

  function applyBlenderGeometries(bMap) {
    if (!bMap) return;
    // Character meshes exported directly around joint origin (0,0,0) in Blender
    torso.geometry = bMap.Torso_Primary;
    torso.position.set(0, 0, 0);

    headMesh.geometry = bMap.Head_Primary;
    headMesh.position.set(0, 0, 0);

    visorMesh.geometry = bMap.Visor_Emissive;
    visorMesh.position.set(0, 0, 0);

    leftLegMesh.geometry = bMap.LegL_Secondary;
    leftLegMesh.position.set(0, 0, 0);
    leftBootMesh.geometry = bMap.BootL_Primary;
    leftBootMesh.position.set(0, 0, 0);
    leftBootMesh.visible = true;

    rightLegMesh.geometry = bMap.LegR_Secondary;
    rightLegMesh.position.set(0, 0, 0);
    rightBootMesh.geometry = bMap.BootR_Primary;
    rightBootMesh.position.set(0, 0, 0);
    rightBootMesh.visible = true;

    leftArmPivot.position.set(-0.38, 0.60, 0);
    leftArmMesh.geometry = bMap.ArmL_Secondary;
    leftArmMesh.position.set(0, 0, 0);
    leftArmArmorMesh.geometry = bMap.ArmL_Primary;
    leftArmArmorMesh.position.set(0, 0, 0);
    leftArmArmorMesh.visible = true;

    rightArmPivot.position.set(0.38, 0.60, 0);
    rightArmMesh.geometry = bMap.ArmR_Secondary;
    rightArmMesh.position.set(0, 0, 0);
    rightArmArmorMesh.geometry = bMap.ArmR_Primary;
    rightArmArmorMesh.position.set(0, 0, 0);
    rightArmArmorMesh.visible = true;

    if (!lightweight) {
      if (chestArmor) {
        chestArmor.geometry = bMap.Armor_Secondary;
        chestArmor.position.set(0, 0, 0);
      }
      if (belt) belt.visible = false;
      if (backpack) {
        backpack.geometry = bMap.Pack_Secondary;
        backpack.position.set(0, 0, 0);
      }
      if (packStripe) {
        packStripe.geometry = bMap.Pack_Visor;
        packStripe.position.set(0, 0, 0);
      }
      if (helmetTrimMesh) {
        helmetTrimMesh.geometry = bMap.Helmet_Secondary;
        helmetTrimMesh.position.set(0, 0, 0);
        helmetTrimMesh.visible = true;
      }
    }

    // Weapons exported relative to hand grip (0,0,0), pointing -Z forward
    sgBody.geometry = bMap.Weapon_Shotgun_Dark;
    sgBody.position.set(0, 0, 0);
    sgPump.geometry = bMap.Weapon_Shotgun_Wood;
    sgPump.position.set(0, 0, 0);
    sgAccent.geometry = bMap.Weapon_Shotgun_Accent;
    sgAccent.position.set(0, 0, 0);
    sgAccent.visible = true;

    arBody.geometry = bMap.Weapon_AR_Dark;
    arBody.position.set(0, 0, 0);
    arBarrel.geometry = bMap.Weapon_AR_Accent;
    arBarrel.position.set(0, 0, 0);
    arOptic.geometry = bMap.Weapon_AR_Tip;
    arOptic.position.set(0, 0, 0);
    arOptic.visible = true;

    pickaxeGroup.rotation.x = -Math.PI * 0.38;
    pkHandle.geometry = bMap.Weapon_Pickaxe_Handle;
    pkHandle.rotation.set(0, 0, 0);
    pkHandle.position.set(0, 0, 0);
    pkHead.geometry = bMap.Weapon_Pickaxe_Tip;
    pkHead.position.set(0, 0, 0);

    bpPad.geometry = bMap.Weapon_Blueprint;
    bpPad.position.set(0, 0, 0);
  }

  if (BLENDER_GEOS) {
    applyBlenderGeometries(BLENDER_GEOS);
  } else {
    PENDING_UPGRADES.add(applyBlenderGeometries);
  }

  function setSkin(newSkinId) {
    const mats = getSharedSkinMaterials(newSkinId);
    torso.material = mats.primary;
    headMesh.material = mats.primary;
    leftBootMesh.material = mats.primary;
    rightBootMesh.material = mats.primary;
    leftArmArmorMesh.material = mats.primary;
    rightArmArmorMesh.material = mats.primary;

    if (chestArmor) chestArmor.material = mats.secondary;
    if (backpack) backpack.material = mats.secondary;
    if (helmetTrimMesh) helmetTrimMesh.material = mats.secondary;
    leftLegMesh.material = mats.secondary;
    rightLegMesh.material = mats.secondary;
    leftArmMesh.material = mats.secondary;
    rightArmMesh.material = mats.secondary;

    if (packStripe) packStripe.material = mats.visor;
    visorMesh.material = mats.visor;
  }

  function setWeapon(slot, buildModeActive = false) {
    shotgunGroup.visible = !buildModeActive && slot === 0;
    arGroup.visible = !buildModeActive && slot === 1;
    pickaxeGroup.visible = !buildModeActive && slot === 2;
    blueprintGroup.visible = Boolean(buildModeActive);
  }

  function animate(time, speed, crouch, pitch, swingPhase, isBuildMode, weaponSlot) {
    // Crouch drop
    const targetUpperY = crouch ? 0.42 : 0.68;
    upperBody.position.y += (targetUpperY - upperBody.position.y) * 0.25;
    leftLegPivot.rotation.x = crouch ? 0.45 : 0;
    rightLegPivot.rotation.x = crouch ? -0.35 : 0;

    // Walk/run stride
    const moveFactor = Math.min(1, speed / 9);
    const stride = moveFactor * Math.sin(time * 11) * 0.65;
    if (!crouch) {
      leftLegPivot.rotation.x = stride;
      rightLegPivot.rotation.x = -stride;
    } else {
      leftLegPivot.rotation.x += stride * 0.45;
      rightLegPivot.rotation.x -= stride * 0.45;
    }

    leftArmPivot.rotation.x = -stride * 0.7;

    // Aiming pitch on head and right arm
    headPivot.rotation.x = Math.max(-0.8, Math.min(0.8, pitch));

    if (isBuildMode) {
      rightArmPivot.rotation.x = 1.05 + pitch * 0.6;
      leftArmPivot.rotation.x = 0.65;
    } else if (weaponSlot === 2) {
      // Pickaxe swing
      const swing = swingPhase > 0 ? Math.sin(swingPhase * Math.PI) * 1.45 : 0;
      rightArmPivot.rotation.x = 0.75 + pitch * 0.5 - swing;
    } else {
      // Gun aim pose
      const recoil = swingPhase > 0 ? Math.sin(swingPhase * Math.PI) * 0.22 : 0;
      rightArmPivot.rotation.x = Math.PI * 0.46 + pitch * 0.85 + recoil;
    }
  }

  // Optional lightweight 3D floating health + shield bar (zero text allocs)
  let hbGroup = null;
  let hbShieldFill = null;
  let hbHpFill = null;
  if (withHealthBar) {
    hbGroup = new THREE.Group();
    hbGroup.position.set(0, 2.22, 0);
    const bg = new THREE.Mesh(HB_BG_GEO, WEAPON_MATS.hbBg);
    hbShieldFill = new THREE.Mesh(HB_BAR_GEO, WEAPON_MATS.hbShield);
    hbShieldFill.position.set(0, 0.055, 0.004);
    hbHpFill = new THREE.Mesh(HB_BAR_GEO, WEAPON_MATS.hbHp);
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
    PENDING_UPGRADES.delete(applyBlenderGeometries);
  }

  setWeapon(0, false);

  return {
    root,
    headPivot,
    setSkin,
    setWeapon,
    animate,
    updateHealthBar,
    dispose
  };
}
