import { WEAPON_CATALOG } from './constants.js';
import { raycastArena } from './physics.js';

// Reusable scratch hit struct
const _camHit = {
  hit: false, hitType: null, dist: 100,
  x: 0, y: 0, z: 0, buildKey: null, playerId: null, isHeadshot: false
};
const _shotHit = {
  hit: false, hitType: null, dist: 100,
  x: 0, y: 0, z: 0, buildKey: null, playerId: null, isHeadshot: false
};

export class WeaponController {
  constructor() {
    this.slot = 0; // 0: Primary Weapon Slot 1, 1: Secondary Weapon Slot 2, 2: Pickaxe
    this.loadout = [
      WEAPON_CATALOG.shotgun,
      WEAPON_CATALOG.ar,
      WEAPON_CATALOG.pickaxe
    ];
    this.ammo = [this.loadout[0].magSize, this.loadout[1].magSize, Infinity];
    this.cooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
    this.swingPhase = 0;
    this.lastDamageTime = 0;

    // Reusable per-shot aggregation buffers (zero GC)
    this._playerDamages = new Map();
    this._buildDamages = new Map();
    this._dmgPool = Array.from({ length: 16 }, () => ({ dmg: 0, headshot: false, x: 0, y: 0, z: 0 }));
    this._fireResult = { fired: false, weaponId: '', endX: 0, endY: 0, endZ: 0 };
  }

  getWeapon(slot = this.slot) {
    return this.loadout[slot] || this.loadout[0] || WEAPON_CATALOG.shotgun;
  }

  hasWeapon(weaponId) {
    return (this.loadout[0]?.id === weaponId ? 0 : (this.loadout[1]?.id === weaponId ? 1 : -1));
  }

  equipWeapon(weaponId) {
    const def = WEAPON_CATALOG[weaponId];
    if (!def || weaponId === 'pickaxe') return { changed: false, slot: this.slot, weapon: this.getWeapon() };

    // If player already holds this gun in slot 0 or 1, just switch to it & top off mag
    const existingSlot = this.hasWeapon(weaponId);
    if (existingSlot !== -1) {
      this.ammo[existingSlot] = def.magSize;
      this.slot = existingSlot;
      this.reloading = false;
      this.reloadTimer = 0;
      this.reloadDuration = 0;
      this.cooldown = 0;
      return { changed: true, slot: existingSlot, weapon: def, alreadyOwned: true };
    }

    // Replace active firearm slot (0 or 1); if holding pickaxe, replace slot 0
    const targetSlot = this.slot === 1 ? 1 : 0;
    this.loadout[targetSlot] = def;
    this.ammo[targetSlot] = def.magSize;
    this.slot = targetSlot;
    this.reloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
    this.cooldown = 0;
    return { changed: true, slot: targetSlot, weapon: def, alreadyOwned: false };
  }

  resetDefaultLoadout() {
    this.loadout[0] = WEAPON_CATALOG.shotgun;
    this.loadout[1] = WEAPON_CATALOG.ar;
    this.loadout[2] = WEAPON_CATALOG.pickaxe;
    this.resetAll();
  }

  resetAll() {
    this.ammo[0] = this.loadout[0].magSize;
    this.ammo[1] = this.loadout[1].magSize;
    this.ammo[2] = Infinity;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
    this.swingPhase = 0;
  }

  switchSlot(newSlot) {
    if (newSlot < 0 || newSlot >= this.loadout.length) return;
    if (this.slot === newSlot) return;
    this.slot = newSlot;
    this.reloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 0;
    // Brief equip pullout delay
    this.cooldown = Math.min(this.cooldown, 0.12);
  }

  getReloadProgress() {
    if (!this.reloading || this.reloadDuration <= 0) return 0;
    return Math.max(0, Math.min(1, 1 - this.reloadTimer / this.reloadDuration));
  }

  startReload(audio = null) {
    const w = this.getWeapon();
    if (!isFinite(w.magSize) || w.reloadTime <= 0) return false;
    if (this.reloading || this.ammo[this.slot] >= w.magSize) return false;
    this.reloading = true;
    this.reloadDuration = w.reloadTime;
    this.reloadTimer = w.reloadTime;
    if (audio && typeof audio.playReloadStart === 'function') {
      audio.playReloadStart(w.id);
    }
    return true;
  }

  update(dt, audio = null) {
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
    }
    if (this.swingPhase > 0) {
      this.swingPhase = Math.max(0, this.swingPhase - dt * 3.5);
    }
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const w = this.getWeapon();
        this.reloading = false;
        this.reloadTimer = 0;
        this.reloadDuration = 0;
        this.ammo[this.slot] = w.magSize;
        if (audio && typeof audio.playReloadDone === 'function') {
          audio.playReloadDone(w.id);
        }
        return true;
      }
    }
    return false;
  }

  tryFire({
    camOrigin,
    camDir,
    muzzleOrigin,
    eyeOrigin,
    isADS,
    buildingSystem,
    mapState = null,
    targets,
    onHitPlayer,
    onHitBuild,
    onHitResetButton,
    onVisualShot,
    audio
  }) {
    const w = this.getWeapon();
    if (this.cooldown > 0 || this.reloading) return false;

    if (isFinite(w.magSize) && this.ammo[this.slot] <= 0) {
      this.startReload(audio);
      return false;
    }

    if (isFinite(w.magSize)) {
      this.ammo[this.slot] -= 1;
    }
    this.cooldown = w.cooldown;
    this.swingPhase = 1.0;

    // Play local weapon sound
    if (audio) {
      if (w.id === 'shotgun') audio.playShotgun(1.0);
      else if (w.id === 'smg') audio.playSMG(1.0);
      else if (w.id === 'ar') audio.playAR(1.0);
      else if (w.id === 'sniper') audio.playSniper(1.0);
      else audio.playPickaxeSwing();
    }

    // Start crosshair ray at the player's forward depth plane (never behind player, never skipping close targets)
    const eyeDepth =
      (eyeOrigin.x - camOrigin.x) * camDir.x +
      (eyeOrigin.y - camOrigin.y) * camDir.y +
      (eyeOrigin.z - camOrigin.z) * camDir.z;
    const camStartT = Math.max(0.2, eyeDepth - 0.15);

    raycastArena(
      camOrigin.x + camDir.x * camStartT,
      camOrigin.y + camDir.y * camStartT,
      camOrigin.z + camDir.z * camStartT,
      camDir.x, camDir.y, camDir.z,
      w.range + 4,
      buildingSystem,
      targets,
      _camHit,
      mapState
    );

    // Shoulder-aligned shot origin (inside PLAYER_RADIUS so never clips into walls, matches OTS perspective)
    const shotOx = eyeOrigin.x * 0.35 + muzzleOrigin.x * 0.65;
    const shotOy = eyeOrigin.y * 0.7 + muzzleOrigin.y * 0.3;
    const shotOz = eyeOrigin.z * 0.35 + muzzleOrigin.z * 0.65;

    const aimX = _camHit.x - shotOx;
    const aimY = _camHit.y - shotOy;
    const aimZ = _camHit.z - shotOz;
    const aimLen = Math.hypot(aimX, aimY, aimZ) || 1;
    const baseDx = aimX / aimLen;
    const baseDy = aimY / aimLen;
    const baseDz = aimZ / aimLen;

    const spread = isADS ? w.adsSpread : w.spread;

    // Aggregate per-target damage across pellets (zero GC)
    const playerDamages = this._playerDamages;
    const buildDamages = this._buildDamages;
    playerDamages.clear();
    buildDamages.clear();
    let dmgPoolIdx = 0;
    let anyHeadshot = false;
    let firstEndX = muzzleOrigin.x + baseDx * w.range;
    let firstEndY = muzzleOrigin.y + baseDy * w.range;
    let firstEndZ = muzzleOrigin.z + baseDz * w.range;

    for (let p = 0; p < w.pellets; p++) {
      let dx = baseDx;
      let dy = baseDy;
      let dz = baseDz;

      if (spread > 0) {
        dx += (Math.random() - 0.5) * spread * 2;
        dy += (Math.random() - 0.5) * spread * 2;
        dz += (Math.random() - 0.5) * spread * 2;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len;
        dy /= len;
        dz /= len;
      }

      raycastArena(
        shotOx, shotOy, shotOz,
        dx, dy, dz,
        w.range,
        buildingSystem,
        targets,
        _shotHit,
        mapState
      );

      if (p === 0) {
        firstEndX = _shotHit.x;
        firstEndY = _shotHit.y;
        firstEndZ = _shotHit.z;
      }

      if (onVisualShot && (w.id !== 'pickaxe' || _shotHit.hit)) {
        onVisualShot(
          muzzleOrigin.x, muzzleOrigin.y, muzzleOrigin.z,
          _shotHit.x, _shotHit.y, _shotHit.z,
          w.tracerColor,
          _shotHit.hit,
          _shotHit.hitType,
          _shotHit.buildKey,
          _shotHit.isHeadshot,
          _shotHit.playerId,
          w.id === 'pickaxe'
        );
      }

      if (!_shotHit.hit) continue;

      if (_shotHit.hitType === 'player' && _shotHit.playerId) {
        // Distance falloff
        let dmg = w.damage;
        if (_shotHit.dist > w.falloffStart) {
          const t = Math.min(1, (_shotHit.dist - w.falloffStart) / Math.max(1, w.range - w.falloffStart));
          dmg *= (1 - 0.45 * t);
        }
        if (_shotHit.isHeadshot) {
          dmg *= w.headshotMult;
          anyHeadshot = true;
        }
        let prev = playerDamages.get(_shotHit.playerId);
        if (!prev) {
          prev = this._dmgPool[dmgPoolIdx < this._dmgPool.length ? dmgPoolIdx++ : 0];
          prev.dmg = 0;
          prev.headshot = false;
          prev.x = _shotHit.x;
          prev.y = _shotHit.y;
          prev.z = _shotHit.z;
          playerDamages.set(_shotHit.playerId, prev);
        }
        prev.dmg += dmg;
        prev.headshot = prev.headshot || _shotHit.isHeadshot;
      } else if (_shotHit.hitType === 'build' && _shotHit.buildKey) {
        const perPelletBuildDmg = w.buildDamage / w.pellets;
        buildDamages.set(_shotHit.buildKey, (buildDamages.get(_shotHit.buildKey) || 0) + perPelletBuildDmg);
        if (w.id === 'pickaxe' && audio) {
          audio.playPickaxeHit();
        }
      }
    }

    for (const [buildKey, dmg] of buildDamages.entries()) {
      if (onHitBuild) onHitBuild(buildKey, Math.round(dmg));
    }

    for (const [playerId, info] of playerDamages.entries()) {
      if (onHitPlayer) onHitPlayer(playerId, Math.round(info.dmg), info.headshot, w.id, info.x, info.y, info.z);
    }

    if (audio && playerDamages.size > 0) {
      audio.playHitmarker(anyHeadshot);
    }

    // Auto-reload if empty
    if (isFinite(w.magSize) && this.ammo[this.slot] <= 0) {
      this.startReload(audio);
    }

    this._fireResult.fired = true;
    this._fireResult.weaponId = w.id;
    this._fireResult.endX = firstEndX;
    this._fireResult.endY = firstEndY;
    this._fireResult.endZ = firstEndZ;
    return this._fireResult;
  }
}
