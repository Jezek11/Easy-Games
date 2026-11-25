import * as THREE from 'three';
import { CS2_MOVE, CS2_WEAPONS } from './constants.js';

function makeVmMat(hex, quality, roughness = 0.55, metalness = 0.25) {
  const basic = new THREE.MeshBasicMaterial({ color: hex });
  const lambert = new THREE.MeshLambertMaterial({ color: hex });
  const standard = new THREE.MeshStandardMaterial({ color: hex, roughness, metalness });
  return {
    basic,
    lambert,
    standard,
    get(q) {
      return q === 'low' ? basic : (q === 'high' ? standard : lambert);
    },
    dispose() {
      basic.dispose();
      lambert.dispose();
      standard.dispose();
    }
  };
}

export class CS2WeaponSystem {
  constructor(textureMgr) {
    this.textureMgr = textureMgr;
    this.quality = 'medium';

    // Dedicated Viewmodel Scene & Camera (renders on top of world with clearDepth)
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.04, 8);
    this.vmHemi = new THREE.HemisphereLight(0xfff4dc, 0x3b495e, 1.35);
    this.vmDir = new THREE.DirectionalLight(0xfff3d8, 1.85);
    this.vmDir.position.set(1.5, 2.8, 2.2);
    this.vmScene.add(this.vmHemi);
    this.vmScene.add(this.vmDir);

    this.vmRoot = new THREE.Group();
    this.vmScene.add(this.vmRoot);

    this._vmGeoms = [];
    this._vmMats = [];
    this._vmMeshPairs = [];
    this._models = {};

    this._buildViewmodels();

    // Muzzle flash sprite on viewmodel
    const flashGeo = new THREE.PlaneGeometry(0.24, 0.24);
    const flashMat = new THREE.MeshBasicMaterial({
      map: textureMgr.getMuzzleFlashTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this._vmGeoms.push(flashGeo);
    this._vmMats.push(flashMat);
    this.vmFlash = new THREE.Mesh(flashGeo, flashMat);
    this.vmFlash.position.set(0.20, -0.15, -0.82);
    this.vmFlash.visible = false;
    this.vmScene.add(this.vmFlash);

    // Inventory & Weapon State
    this.slots = [null, 'pistol', 'knife', null]; // [0: Primary, 1: Secondary, 2: Knife, 3: C4]
    this.ammoState = {};
    this.activeSlot = 1;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 1.5;
    this.scopeZoom = 0; // 0 = hip, 1 = 40deg, 2 = 16deg

    // Recoil & Spray tracking
    this.shotIndex = 0;
    this.recoilDecayTimer = 0;
    this.recoilPunchPitch = 0;
    this.recoilPunchYaw = 0;

    // Viewmodel animation state
    this.bobPhase = 0;
    this.kickZ = 0;
    this.slashAnim = 0;
    this.equipAnim = 1;
    this.vmFlashTimer = 0;

    this._raycaster = new THREE.Raycaster();
    this._tmpDir = new THREE.Vector3();

    this.resetInventory('ct', false);
  }

  _addPart(parent, w, h, d, x, y, z, matTier, rx = 0, ry = 0, rz = 0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    this._vmGeoms.push(geo);
    const mesh = new THREE.Mesh(geo, matTier.get(this.quality));
    mesh.position.set(x, y, z);
    if (rx || ry || rz) mesh.rotation.set(rx, ry, rz);
    this._vmMeshPairs.push({ mesh, matTier });
    parent.add(mesh);
    return mesh;
  }

  _buildViewmodels() {
    const steel = makeVmMat(0x272d36, this.quality, 0.42, 0.65);
    const darkMetal = makeVmMat(0x161a20, this.quality, 0.38, 0.72);
    const chrome = makeVmMat(0xcbd5e1, this.quality, 0.22, 0.88);
    const wood = makeVmMat(0x8a5128, this.quality, 0.75, 0.05);
    const olive = makeVmMat(0x4a662b, this.quality, 0.72, 0.12);
    const accentCyan = makeVmMat(0x38bdf8, this.quality, 0.4, 0.3);
    const glove = makeVmMat(0x2b303a, this.quality, 0.85, 0.04);
    const c4Body = makeVmMat(0x9f8b70, this.quality, 0.8, 0.06);
    const c4Red = makeVmMat(0xef4444, this.quality, 0.35, 0.15);
    this._vmMats.push(steel, darkMetal, chrome, wood, olive, accentCyan, glove, c4Body, c4Red);

    // 1. AK-47
    const ak = new THREE.Group();
    this._addPart(ak, 0.056, 0.075, 0.42, 0, 0, -0.10, steel);
    this._addPart(ak, 0.048, 0.055, 0.20, 0, -0.015, 0.19, wood); // stock
    this._addPart(ak, 0.046, 0.052, 0.22, 0, 0.002, -0.36, wood); // handguard
    this._addPart(ak, 0.024, 0.024, 0.26, 0, 0.012, -0.58, darkMetal); // barrel
    this._addPart(ak, 0.036, 0.13, 0.055, 0, -0.09, -0.18, darkMetal, 0.24, 0, 0); // curved mag
    this._addPart(ak, 0.04, 0.09, 0.04, 0, -0.07, 0.05, wood, -0.25, 0, 0); // grip
    this._addPart(ak, 0.068, 0.07, 0.16, 0.02, -0.08, 0.09, glove);
    this._models.ak47 = ak;
    this.vmRoot.add(ak);

    // 2. M4A1 Tactical Carbine
    const m4 = new THREE.Group();
    this._addPart(m4, 0.054, 0.076, 0.40, 0, 0, -0.10, darkMetal);
    this._addPart(m4, 0.046, 0.056, 0.20, 0, -0.012, 0.18, steel);
    this._addPart(m4, 0.052, 0.056, 0.22, 0, 0.006, -0.35, steel); // quad rail
    this._addPart(m4, 0.032, 0.032, 0.24, 0, 0.012, -0.56, darkMetal); // suppressor
    this._addPart(m4, 0.040, 0.030, 0.09, 0, 0.052, -0.10, accentCyan); // holo sight housing
    this._addPart(m4, 0.034, 0.12, 0.05, 0, -0.09, -0.18, steel, 0.08, 0, 0);
    this._addPart(m4, 0.068, 0.07, 0.16, 0.02, -0.08, 0.09, glove);
    this._models.m4a1 = m4;
    this.vmRoot.add(m4);

    // 3. AWP Sniper
    const awp = new THREE.Group();
    this._addPart(awp, 0.058, 0.082, 0.56, 0, -0.01, -0.14, olive);
    this._addPart(awp, 0.026, 0.026, 0.44, 0, 0.016, -0.56, darkMetal); // long barrel
    this._addPart(awp, 0.042, 0.042, 0.26, 0, 0.068, -0.14, darkMetal); // scope tube
    this._addPart(awp, 0.052, 0.052, 0.06, 0, 0.068, -0.26, steel); // scope bell
    this._addPart(awp, 0.044, 0.07, 0.16, 0, -0.02, 0.18, olive); // stock
    this._addPart(awp, 0.068, 0.07, 0.16, 0.02, -0.08, 0.09, glove);
    this._models.awp = awp;
    this.vmRoot.add(awp);

    // 4. Base Tactical Pistol (USP-9)
    const pistol = new THREE.Group();
    this._addPart(pistol, 0.040, 0.046, 0.22, 0, 0.01, -0.12, darkMetal);
    this._addPart(pistol, 0.030, 0.030, 0.14, 0, 0.012, -0.28, steel); // compact suppressor
    this._addPart(pistol, 0.036, 0.10, 0.048, 0, -0.05, -0.04, steel, -0.2, 0, 0);
    this._addPart(pistol, 0.065, 0.07, 0.13, 0.01, -0.07, 0.04, glove);
    this._models.pistol = pistol;
    this.vmRoot.add(pistol);

    // 5. Heavy Pistol (Deagle)
    const deagle = new THREE.Group();
    this._addPart(deagle, 0.046, 0.056, 0.28, 0, 0.012, -0.15, chrome);
    this._addPart(deagle, 0.040, 0.022, 0.26, 0, -0.018, -0.14, darkMetal);
    this._addPart(deagle, 0.040, 0.11, 0.054, 0, -0.055, -0.04, darkMetal, -0.22, 0, 0);
    this._addPart(deagle, 0.065, 0.07, 0.13, 0.01, -0.07, 0.04, glove);
    this._models.deagle = deagle;
    this.vmRoot.add(deagle);

    // 6. Combat Knife
    const knife = new THREE.Group();
    this._addPart(knife, 0.032, 0.032, 0.14, 0, -0.02, -0.04, darkMetal, 0.15, 0.2, 0); // handle
    this._addPart(knife, 0.012, 0.038, 0.22, 0.02, 0.01, -0.19, chrome, 0.15, 0.2, 0); // blade
    this._addPart(knife, 0.024, 0.044, 0.018, 0.01, -0.01, -0.10, accentCyan, 0.15, 0.2, 0);
    this._addPart(knife, 0.064, 0.068, 0.13, 0.01, -0.05, 0.05, glove);
    this._models.knife = knife;
    this.vmRoot.add(knife);

    // 7. Bomb C4
    const c4 = new THREE.Group();
    this._addPart(c4, 0.15, 0.09, 0.19, -0.04, -0.03, -0.12, c4Body, -0.25, -0.2, 0);
    this._addPart(c4, 0.09, 0.02, 0.06, -0.04, 0.015, -0.16, darkMetal, -0.25, -0.2, 0); // keypad
    this._addPart(c4, 0.05, 0.022, 0.03, -0.04, 0.02, -0.10, c4Red, -0.25, -0.2, 0); // LED screen
    this._addPart(c4, 0.07, 0.07, 0.14, 0.04, -0.07, 0.04, glove);
    this._models.c4 = c4;
    this.vmRoot.add(c4);
  }

  applyQuality(quality) {
    this.quality = quality === 'low' ? 'low' : (quality === 'high' ? 'high' : 'medium');
    for (const pair of this._vmMeshPairs) {
      pair.mesh.material = pair.matTier.get(this.quality);
    }
    this.vmHemi.visible = this.quality !== 'low';
    this.vmDir.visible = this.quality !== 'low';
    if (this.quality === 'low') {
      this.vmFlash.visible = false;
    }
  }

  resetInventory(team, hasC4 = false) {
    this.slots = [null, 'pistol', 'knife', hasC4 && team === 't' ? 'c4' : null];
    this.ammoState = {};
    this._initAmmoForWeapon('pistol');
    this.activeSlot = 1;
    this.reloading = false;
    this.reloadTimer = 0;
    this.scopeZoom = 0;
    this.shotIndex = 0;
    this.recoilPunchPitch = 0;
    this.recoilPunchYaw = 0;
    this.equipAnim = 1;
    this._syncVisibleModel();
  }

  setHasC4(hasC4) {
    this.slots[3] = hasC4 ? 'c4' : null;
    if (!hasC4 && this.activeSlot === 3) {
      this.selectSlot(this.slots[0] ? 0 : 1);
    }
  }

  _initAmmoForWeapon(wId) {
    const def = CS2_WEAPONS[wId];
    if (!def || !Number.isFinite(def.magSize)) return;
    this.ammoState[wId] = {
      mag: def.magSize,
      reserve: def.reserveAmmo
    };
  }

  equipBoughtWeapon(wId) {
    const def = CS2_WEAPONS[wId];
    if (!def) return false;
    this.slots[def.slot] = wId;
    this._initAmmoForWeapon(wId);
    this.selectSlot(def.slot);
    return true;
  }

  refillAmmo() {
    for (const wId of this.slots) {
      if (wId) this._initAmmoForWeapon(wId);
    }
  }

  getActiveWeaponId() {
    return this.slots[this.activeSlot] || this.slots[1] || 'knife';
  }

  getActiveWeaponDef() {
    return CS2_WEAPONS[this.getActiveWeaponId()] || CS2_WEAPONS.knife;
  }

  getAmmoInfo() {
    const wId = this.getActiveWeaponId();
    const def = this.getActiveWeaponDef();
    if (!Number.isFinite(def.magSize)) {
      return { mag: Infinity, reserve: 0, magSize: Infinity };
    }
    const st = this.ammoState[wId] || { mag: def.magSize, reserve: def.reserveAmmo };
    return { mag: st.mag, reserve: st.reserve, magSize: def.magSize };
  }

  getMaxMoveSpeedU() {
    const def = this.getActiveWeaponDef();
    if (this.scopeZoom > 0 && def.hasScope) {
      return def.scopedMoveSpeedU;
    }
    return def.moveSpeedU;
  }

  selectSlot(slotIdx) {
    if (slotIdx < 0 || slotIdx > 3) return false;
    const wId = this.slots[slotIdx];
    if (!wId) return false;
    if (this.activeSlot === slotIdx) return false;
    this.activeSlot = slotIdx;
    this.reloading = false;
    this.reloadTimer = 0;
    this.scopeZoom = 0;
    this.shotIndex = 0;
    this.equipAnim = 1;
    this.cooldown = Math.max(this.cooldown, 0.22);
    this._syncVisibleModel();
    return true;
  }

  _syncVisibleModel() {
    const activeId = this.getActiveWeaponId();
    for (const [id, group] of Object.entries(this._models)) {
      group.visible = id === activeId && this.scopeZoom === 0;
    }
  }

  toggleScope() {
    const def = this.getActiveWeaponDef();
    if (!def.hasScope || this.reloading) return 0;
    this.scopeZoom = (this.scopeZoom + 1) % 3;
    this._syncVisibleModel();
    return this.scopeZoom;
  }

  clearScope() {
    if (this.scopeZoom !== 0) {
      this.scopeZoom = 0;
      this._syncVisibleModel();
    }
  }

  startReload() {
    if (this.reloading) return false;
    const wId = this.getActiveWeaponId();
    const def = this.getActiveWeaponDef();
    if (!Number.isFinite(def.magSize)) return false;
    const st = this.ammoState[wId];
    if (!st || st.mag >= def.magSize || st.reserve <= 0) return false;

    this.reloading = true;
    this.reloadDuration = def.reloadTime;
    this.reloadTimer = def.reloadTime;
    this.clearScope();
    return true;
  }

  _finishReload() {
    const wId = this.getActiveWeaponId();
    const def = this.getActiveWeaponDef();
    const st = this.ammoState[wId];
    if (st && Number.isFinite(def.magSize)) {
      const need = def.magSize - st.mag;
      const take = Math.min(need, st.reserve);
      st.mag += take;
      st.reserve -= take;
    }
    this.reloading = false;
    this.reloadTimer = 0;
  }

  computeSpreadRad(movement) {
    const def = this.getActiveWeaponDef();
    let spread = (this.scopeZoom > 0 && def.scopedSpread !== undefined)
      ? def.scopedSpread
      : def.baseSpread;

    if (movement.crouching) {
      spread *= def.crouchMult;
    }

    if (!movement.grounded) {
      spread += def.airInacc;
    } else {
      const spd = movement.getHorizSpeedU();
      if (spd > CS2_MOVE.ACCURATE_SPEED_U) {
        const ratio = Math.min(1.4, (spd - CS2_MOVE.ACCURATE_SPEED_U) / 210);
        spread += def.moveInacc * ratio * (movement.crouching ? 0.5 : 1.0);
      }
    }
    return spread;
  }

  getSprayAnglesRad() {
    const def = this.getActiveWeaponDef();
    const pat = def.sprayPattern || [[0, 0]];
    const idx = Math.min(this.shotIndex, pat.length - 1);
    const [yawDeg, pitchDeg] = pat[idx];
    const deg2rad = Math.PI / 180;
    return {
      yawRad: yawDeg * deg2rad,
      pitchRad: pitchDeg * deg2rad
    };
  }

  canFire(frozen) {
    if (frozen || this.reloading || this.cooldown > 0) return false;
    const wId = this.getActiveWeaponId();
    if (wId === 'c4') return false;
    const def = this.getActiveWeaponDef();
    if (!Number.isFinite(def.magSize)) return true;
    const st = this.ammoState[wId];
    return Boolean(st && st.mag > 0);
  }

  consumeShot(movement, isHeavyKnife = false) {
    const wId = this.getActiveWeaponId();
    const def = this.getActiveWeaponDef();

    if (wId === 'knife') {
      this.cooldown = isHeavyKnife ? def.heavyFireRate : def.fireRate;
      this.slashAnim = 1;
      return {
        weaponId: wId,
        damage: isHeavyKnife ? def.heavyDamage : def.damage,
        armorPen: def.armorPen,
        range: def.range,
        spreadRad: 0,
        sprayYawRad: 0,
        sprayPitchRad: 0
      };
    }

    const st = this.ammoState[wId];
    if (!st || st.mag <= 0) return null;
    st.mag -= 1;

    const spreadRad = this.computeSpreadRad(movement);
    const { yawRad, pitchRad } = this.getSprayAnglesRad();

    this.cooldown = def.fireRate;
    this.shotIndex += 1;
    this.recoilDecayTimer = def.recoilResetSec;
    this.kickZ = 1.0;

    // Camera recoil kick + brief unscope for AWP bolt pull
    this.recoilPunchPitch += def.cameraKickPitch;
    this.recoilPunchYaw += (Math.random() - 0.5) * 2 * def.cameraKickYaw;

    if (this.quality !== 'low' && this.scopeZoom === 0) {
      this.vmFlash.visible = true;
      this.vmFlash.rotation.z = Math.random() * Math.PI * 2;
      this.vmFlashTimer = 0.04;
    }

    if (def.hasScope && this.scopeZoom > 0) {
      this.clearScope();
    }

    return {
      weaponId: wId,
      damage: def.damage,
      armorPen: def.armorPen,
      range: def.range,
      spreadRad,
      sprayYawRad: yawRad,
      sprayPitchRad: pitchRad,
      autoReloadNeeded: st.mag === 0 && st.reserve > 0
    };
  }

  castShotRay(origin, baseDir, spreadRad, sprayYawRad, sprayPitchRad, range, wallMeshes, enemyHitboxes) {
    // Apply deterministic spray pattern + dynamic spread cone
    const rx = (Math.random() - 0.5) * 2 * spreadRad;
    const ry = (Math.random() - 0.5) * 2 * spreadRad;
    const totalYaw = -sprayYawRad + rx;
    const totalPitch = sprayPitchRad + ry;

    const dir = this._tmpDir.copy(baseDir);
    if (totalYaw !== 0 || totalPitch !== 0) {
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      dir.addScaledVector(right, Math.tan(totalYaw));
      dir.addScaledVector(up, Math.tan(totalPitch));
      dir.normalize();
    }

    this._raycaster.set(origin, dir);
    this._raycaster.near = 0.05;
    this._raycaster.far = range;

    // 1. Check wall/map occlusion
    const wallHits = this._raycaster.intersectObjects(wallMeshes, false);
    const wallHit = wallHits.length > 0 ? wallHits[0] : null;
    const maxDist = wallHit ? wallHit.distance : range;

    // 2. Check enemy hitbox meshes closer than wall
    let entityHit = null;
    if (enemyHitboxes.length > 0) {
      const hits = this._raycaster.intersectObjects(enemyHitboxes, false);
      for (let i = 0; i < hits.length; i++) {
        if (hits[i].distance <= maxDist) {
          entityHit = hits[i];
          break;
        }
      }
    }

    if (entityHit) {
      return {
        type: 'entity',
        entityId: entityHit.object.userData.entityId,
        hitZone: entityHit.object.userData.hitZone || 'body',
        point: entityHit.point.clone(),
        dir: dir.clone(),
        distance: entityHit.distance
      };
    }

    if (wallHit) {
      const normal = wallHit.face
        ? wallHit.face.normal.clone().transformDirection(wallHit.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0);
      return {
        type: 'wall',
        point: wallHit.point.clone(),
        normal,
        dir: dir.clone(),
        distance: wallHit.distance
      };
    }

    return {
      type: 'miss',
      point: origin.clone().addScaledVector(dir, range),
      dir: dir.clone(),
      distance: range
    };
  }

  update(dt, horizSpeedU, grounded) {
    let reloadCompleted = false;
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
    }

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this._finishReload();
        reloadCompleted = true;
      }
    }

    if (this.recoilDecayTimer > 0) {
      this.recoilDecayTimer -= dt;
      if (this.recoilDecayTimer <= 0) {
        this.shotIndex = 0;
      }
    }

    // Smooth camera recoil return
    const decay = Math.exp(-dt * 12);
    this.recoilPunchPitch *= decay;
    this.recoilPunchYaw *= decay;

    if (this.vmFlashTimer > 0) {
      this.vmFlashTimer -= dt;
      if (this.vmFlashTimer <= 0) {
        this.vmFlash.visible = false;
      }
    }

    // Viewmodel bob, kick, equip & reload animation
    if (grounded && horizSpeedU > 35) {
      this.bobPhase += dt * Math.min(12, horizSpeedU * 0.042);
    } else {
      this.bobPhase += dt * 1.4;
    }
    this.kickZ = Math.max(0, this.kickZ - dt * 8.5);
    this.slashAnim = Math.max(0, this.slashAnim - dt * 3.8);
    this.equipAnim = Math.max(0, this.equipAnim - dt * 5.2);

    const bobAmp = grounded && horizSpeedU > 35 ? Math.min(0.014, horizSpeedU * 0.000055) : 0.002;
    const bx = Math.cos(this.bobPhase) * bobAmp;
    const by = Math.abs(Math.sin(this.bobPhase)) * bobAmp * 1.1;

    const reloadTilt = this.reloading
      ? Math.sin((1 - this.reloadTimer / Math.max(0.2, this.reloadDuration)) * Math.PI) * 0.45
      : 0;
    const slashSwing = this.slashAnim > 0 ? Math.sin(this.slashAnim * Math.PI) : 0;

    this.vmRoot.position.set(
      0.20 + bx - slashSwing * 0.14,
      -0.21 - by - this.equipAnim * 0.16 - reloadTilt * 0.12,
      -0.36 + this.kickZ * 0.045 - slashSwing * 0.10
    );
    this.vmRoot.rotation.set(
      this.kickZ * 0.09 - reloadTilt * 0.55 - slashSwing * 0.35,
      slashSwing * 0.55,
      -reloadTilt * 0.35
    );

    return { reloadCompleted };
  }

  resize(aspect) {
    this.vmCamera.aspect = aspect;
    this.vmCamera.updateProjectionMatrix();
  }

  dispose() {
    this.vmScene.remove(this.vmHemi);
    this.vmScene.remove(this.vmDir);
    this.vmScene.remove(this.vmRoot);
    this.vmScene.remove(this.vmFlash);
    for (const g of this._vmGeoms) g.dispose();
    for (const m of this._vmMats) m.dispose();
    this._vmGeoms.length = 0;
    this._vmMats.length = 0;
    this._vmMeshPairs.length = 0;
  }
}
