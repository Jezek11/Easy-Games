import * as THREE from 'three';

function createTieredMats(hex, quality, roughness = 0.72, metalness = 0.08) {
  const basic = new THREE.MeshBasicMaterial({ color: hex });
  const lambert = new THREE.MeshLambertMaterial({ color: hex });
  const standard = new THREE.MeshStandardMaterial({ color: hex, roughness, metalness });
  return {
    basic,
    lambert,
    standard,
    current(q) {
      return q === 'low' ? basic : (q === 'high' ? standard : lambert);
    },
    dispose() {
      basic.dispose();
      lambert.dispose();
      standard.dispose();
    }
  };
}

export function createTacticalAgentRig(entityId, team = 'ct', quality = 'medium') {
  const root = new THREE.Group();
  const isCT = team === 'ct';

  // Team palettes: CT = navy/slate armor + cyan visor; T = desert tan/charcoal + amber accent
  const primaryHex = isCT ? 0x263954 : 0xa38762;
  const secondaryHex = isCT ? 0x1a2433 : 0x3b332b;
  const vestHex = isCT ? 0x334155 : 0x4b4237;
  const accentHex = isCT ? 0x38bdf8 : 0xf59e0b;
  const skinHex = 0xd6ab8b;
  const gearHex = isCT ? 0x1e293b : 0xb45309;
  const gunDarkHex = 0x22272e;
  const gunAccentHex = 0x7a5534;

  const mats = {
    primary: createTieredMats(primaryHex, quality, 0.78, 0.06),
    secondary: createTieredMats(secondaryHex, quality, 0.82, 0.05),
    vest: createTieredMats(vestHex, quality, 0.7, 0.14),
    accent: createTieredMats(accentHex, quality, 0.45, 0.25),
    skin: createTieredMats(skinHex, quality, 0.88, 0.02),
    gear: createTieredMats(gearHex, quality, 0.6, 0.22),
    gunDark: createTieredMats(gunDarkHex, quality, 0.42, 0.55),
    gunAccent: createTieredMats(gunAccentHex, quality, 0.72, 0.08),
    c4: createTieredMats(0xef4444, quality, 0.4, 0.2)
  };

  const geometries = [];
  const meshMatPairs = [];
  const hitboxes = [];

  function addPart(parent, geo, matTier, x, y, z, hitZone = null) {
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, matTier.current(quality));
    mesh.position.set(x, y, z);
    mesh.castShadow = quality !== 'low';
    mesh.receiveShadow = quality !== 'low';
    if (hitZone) {
      mesh.userData = { entityId, hitZone, team };
      hitboxes.push(mesh);
    }
    meshMatPairs.push({ mesh, matTier });
    parent.add(mesh);
    return mesh;
  }

  // Body pivot for smooth crouching & death fall
  const bodyRoot = new THREE.Group();
  root.add(bodyRoot);

  // Legs + Pelvis (Legs hitbox: 0.75x)
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.12, 0.74, 0);
  bodyRoot.add(leftLegPivot);
  addPart(leftLegPivot, new THREE.BoxGeometry(0.18, 0.72, 0.22), mats.secondary, 0, -0.36, 0, 'legs');

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.12, 0.74, 0);
  bodyRoot.add(rightLegPivot);
  addPart(rightLegPivot, new THREE.BoxGeometry(0.18, 0.72, 0.22), mats.secondary, 0, -0.36, 0, 'legs');

  addPart(bodyRoot, new THREE.BoxGeometry(0.42, 0.18, 0.26), mats.secondary, 0, 0.80, 0, 'legs');

  // Upper Body group (shifts smoothly on crouch)
  const upperGroup = new THREE.Group();
  upperGroup.position.set(0, 0.88, 0);
  bodyRoot.add(upperGroup);

  // Torso + Tactical Armor Vest (Body hitbox: 1.0x)
  addPart(upperGroup, new THREE.BoxGeometry(0.46, 0.56, 0.28), mats.primary, 0, 0.28, 0, 'body');
  addPart(upperGroup, new THREE.BoxGeometry(0.49, 0.38, 0.31), mats.vest, 0, 0.30, 0, 'body');
  // Team shoulder/chest stripe
  addPart(upperGroup, new THREE.BoxGeometry(0.50, 0.06, 0.32), mats.accent, 0, 0.47, 0, null);

  // C4 Backpack indicator (visible when carrying C4)
  const c4Pack = addPart(upperGroup, new THREE.BoxGeometry(0.24, 0.26, 0.12), mats.c4, 0, 0.32, 0.19, null);
  c4Pack.visible = false;

  // Head + Tactical Helmet / Bandana (Head hitbox: 4.0x)
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.58, 0);
  upperGroup.add(headPivot);

  addPart(headPivot, new THREE.BoxGeometry(0.28, 0.28, 0.28), mats.skin, 0, 0.16, 0, 'head');
  if (isCT) {
    // CT Tactical Helmet + Glowing Cyan Visor
    addPart(headPivot, new THREE.BoxGeometry(0.32, 0.16, 0.32), mats.gear, 0, 0.24, 0, 'head');
    addPart(headPivot, new THREE.BoxGeometry(0.26, 0.07, 0.05), mats.accent, 0, 0.17, -0.15, 'head');
  } else {
    // T Headwrap / Balaclava Bandana
    addPart(headPivot, new THREE.BoxGeometry(0.30, 0.11, 0.30), mats.gear, 0, 0.25, 0, 'head');
    addPart(headPivot, new THREE.BoxGeometry(0.29, 0.10, 0.29), mats.secondary, 0, 0.10, -0.01, 'head');
  }

  // Arms + Weapon Mount
  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.30, 0.48, 0);
  upperGroup.add(rightArmPivot);
  addPart(rightArmPivot, new THREE.BoxGeometry(0.14, 0.44, 0.16), mats.primary, 0, -0.18, -0.14, 'body');
  rightArmPivot.rotation.x = 1.05;

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.28, 0.48, 0);
  upperGroup.add(leftArmPivot);
  addPart(leftArmPivot, new THREE.BoxGeometry(0.13, 0.44, 0.15), mats.primary, 0.06, -0.18, -0.18, 'body');
  leftArmPivot.rotation.x = 1.05;

  // Held 3D Weapon Silhouette attached to right hand
  const gunGroup = new THREE.Group();
  gunGroup.position.set(-0.04, -0.34, -0.28);
  gunGroup.rotation.x = -1.05;
  rightArmPivot.add(gunGroup);

  const rifleBody = addPart(gunGroup, new THREE.BoxGeometry(0.07, 0.11, 0.56), mats.gunDark, 0, 0, -0.18, null);
  const rifleStock = addPart(gunGroup, new THREE.BoxGeometry(0.06, 0.10, 0.20), mats.gunAccent, 0, -0.02, 0.16, null);
  const rifleBarrel = addPart(gunGroup, new THREE.BoxGeometry(0.035, 0.035, 0.34), mats.gunDark, 0, 0.02, -0.58, null);
  const sniperScope = addPart(gunGroup, new THREE.BoxGeometry(0.04, 0.045, 0.22), mats.gunDark, 0, 0.09, -0.18, null);
  const knifeBlade = addPart(gunGroup, new THREE.BoxGeometry(0.025, 0.05, 0.28), mats.accent, 0, 0, -0.16, null);
  const c4Box = addPart(gunGroup, new THREE.BoxGeometry(0.16, 0.10, 0.20), mats.c4, 0, -0.02, -0.10, null);

  let currentWeaponId = 'ak47';
  let isCrouching = false;
  let isAlive = true;
  let walkPhase = 0;
  let deathAnim = 0;

  function setWeapon(wId) {
    currentWeaponId = wId;
    const isKnife = wId === 'knife';
    const isC4 = wId === 'c4';
    const isPistol = wId === 'pistol' || wId === 'deagle';
    const isAwp = wId === 'awp';

    rifleBody.visible = !isKnife && !isC4;
    rifleStock.visible = !isKnife && !isC4 && !isPistol;
    rifleBarrel.visible = !isKnife && !isC4 && !isPistol;
    sniperScope.visible = isAwp;
    knifeBlade.visible = isKnife;
    c4Box.visible = isC4;

    if (isPistol) {
      rifleBody.scale.set(0.85, 0.85, 0.42);
      rifleBody.position.set(0, 0, -0.06);
    } else if (isAwp) {
      rifleBody.scale.set(1.0, 1.0, 1.1);
      rifleBody.position.set(0, 0, -0.18);
      rifleBarrel.scale.set(1.0, 1.0, 1.35);
    } else {
      rifleBody.scale.set(1, 1, 1);
      rifleBody.position.set(0, 0, -0.18);
      rifleBarrel.scale.set(1, 1, 1);
    }
  }

  function setCrouch(crouch) {
    if (isCrouching === Boolean(crouch)) return;
    isCrouching = Boolean(crouch);
    if (isCrouching) {
      leftLegPivot.scale.y = 0.62;
      rightLegPivot.scale.y = 0.62;
      leftLegPivot.position.y = 0.46;
      rightLegPivot.position.y = 0.46;
      upperGroup.position.y = 0.50;
    } else {
      leftLegPivot.scale.y = 1.0;
      rightLegPivot.scale.y = 1.0;
      leftLegPivot.position.y = 0.74;
      rightLegPivot.position.y = 0.74;
      upperGroup.position.y = 0.88;
    }
  }

  function setAlive(alive) {
    isAlive = Boolean(alive);
    if (isAlive) {
      deathAnim = 0;
      bodyRoot.rotation.x = 0;
      bodyRoot.position.y = 0;
      root.visible = true;
    }
  }

  function setHasBomb(has) {
    c4Pack.visible = Boolean(has) && currentWeaponId !== 'c4';
  }

  function update(dt, speedMps = 0, pitch = 0) {
    if (!isAlive) {
      if (deathAnim < 1) {
        deathAnim = Math.min(1, deathAnim + dt * 5.0);
        bodyRoot.rotation.x = -deathAnim * (Math.PI * 0.47);
        bodyRoot.position.y = deathAnim * 0.16;
      }
      return;
    }
    headPivot.rotation.x = Math.max(-0.55, Math.min(0.55, pitch * 0.6));
    if (speedMps > 0.35) {
      walkPhase += dt * Math.min(13, speedMps * 2.1);
      const swing = Math.sin(walkPhase) * (isCrouching ? 0.28 : 0.52);
      leftLegPivot.rotation.x = swing;
      rightLegPivot.rotation.x = -swing;
    } else {
      leftLegPivot.rotation.x *= 0.8;
      rightLegPivot.rotation.x *= 0.8;
    }
  }

  function applyQuality(q) {
    const tier = q === 'low' ? 'low' : (q === 'high' ? 'high' : 'medium');
    for (const pair of meshMatPairs) {
      pair.mesh.material = pair.matTier.current(tier);
      pair.mesh.castShadow = tier !== 'low';
      pair.mesh.receiveShadow = tier !== 'low';
    }
  }

  function dispose() {
    for (const g of geometries) g.dispose();
    for (const m of Object.values(mats)) m.dispose();
    geometries.length = 0;
    meshMatPairs.length = 0;
    hitboxes.length = 0;
  }

  setWeapon('ak47');

  return {
    root,
    hitboxes,
    setWeapon,
    setCrouch,
    setAlive,
    setHasBomb,
    update,
    applyQuality,
    dispose
  };
}
