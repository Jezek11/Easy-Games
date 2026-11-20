import { WEAPONS } from './constants.js';
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
    this.slot = 0; // 0: Shotgun, 1: AR, 2: Pickaxe
    this.ammo = [WEAPONS[0].magSize, WEAPONS[1].magSize, Infinity];
    this.cooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.swingPhase = 0;
    this.lastDamageTime = 0;

    // Reusable per-shot aggregation buffers (zero GC)
    this._playerDamages = new Map();
    this._buildDamages = new Map();
    this._dmgPool = Array.from({ length: 16 }, () => ({ dmg: 0, headshot: false, x: 0, y: 0, z: 0 }));
    this._fireResult = { fired: false, weaponId: '', endX: 0, endY: 0, endZ: 0 };
  }

  resetAll() {
    this.ammo[0] = WEAPONS[0].magSize;
    this.ammo[1] = WEAPONS[1].magSize;
    this.ammo[2] = Infinity;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.swingPhase = 0;
  }

  switchSlot(newSlot) {
    if (newSlot < 0 || newSlot >= WEAPONS.length) return;
    if (this.slot === newSlot) return;
    this.slot = newSlot;
    this.reloading = false;
    this.reloadTimer = 0;
    // Brief equip pullout delay
    this.cooldown = Math.min(this.cooldown, 0.12);
  }

  startReload() {
    const w = WEAPONS[this.slot];
    if (!isFinite(w.magSize)) return false;
    if (this.reloading || this.ammo[this.slot] >= w.magSize) return false;
    this.reloading = true;
    this.reloadTimer = w.reloadTime;
    return true;
  }

  update(dt) {
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
    }
    if (this.swingPhase > 0) {
      this.swingPhase = Math.max(0, this.swingPhase - dt * 3.5);
    }
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        this.reloadTimer = 0;
        this.ammo[this.slot] = WEAPONS[this.slot].magSize;
      }
    }
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
    const w = WEAPONS[this.slot];
    if (this.cooldown > 0 || this.reloading) return false;

    if (isFinite(w.magSize) && this.ammo[this.slot] <= 0) {
      this.startReload();
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
      else if (w.id === 'ar') audio.playAR(1.0);
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
      this.startReload();
    }

    this._fireResult.fired = true;
    this._fireResult.weaponId = w.id;
    this._fireResult.endX = firstEndX;
    this._fireResult.endY = firstEndY;
    this._fireResult.endZ = firstEndZ;
    return this._fireResult;
  }
}
