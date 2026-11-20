import * as THREE from 'three';
import {
  BOT_DIFFICULTIES,
  BUILD_MATERIALS,
  BUILD_TYPES,
  JUMP_SPEED,
  PLAYER_EYE_STAND,
  SPRINT_SPEED,
  WALL_HEIGHT,
  WEAPONS
} from './constants.js';
import { getDefaultMask } from './buildings.js';
import { isInsideSpawnBox, raycastArena, stepPlayerPhysics } from './physics.js';
import { createCharacterRig } from './playerMesh.js';

const _botHit = {
  hit: false, hitType: null, dist: 100,
  x: 0, y: 0, z: 0, buildKey: null, playerId: null, isHeadshot: false
};

export class SmartBot {
  constructor(scene, difficulty = 'medium', skinId = 'crimson', buildMat = 'wood') {
    this.id = 'bot';
    this.difficulty = BOT_DIFFICULTIES[difficulty] || BOT_DIFFICULTIES.medium;
    this.name = `Bot (${this.difficulty.shortLabel})`;
    this.skinId = skinId;
    this.buildMat = buildMat;

    this.pos = new THREE.Vector3(0, 0, -12);
    this.vel = new THREE.Vector3(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.grounded = true;
    this.crouch = false;
    this.jumpSpeed = JUMP_SPEED;
    this.skyBoostTimer = 0;

    this.hp = 100;
    this.shield = 100;
    this.alive = true;
    this.kills = 0;
    this.weaponSlot = 1;
    this.swingPhase = 0;

    // AI timers
    this.fireCooldown = 0.5;
    this.buildCooldown = 0.4;
    this.strafeDir = 1;
    this.strafeTimer = 1.4;
    this.defendTimer = 0;
    this.rampTimer = 0;
    this.wantJump = false;
    this.respawnTimer = 0;
    this.time = 0;

    this.rig = createCharacterRig(this.skinId, true, true);
    this.rig.root.position.copy(this.pos);
    this.rig.setWeapon(this.weaponSlot, false);
    scene.add(this.rig.root);
  }

  setDifficulty(diffId) {
    this.difficulty = BOT_DIFFICULTIES[diffId] || BOT_DIFFICULTIES.medium;
    this.name = `Bot (${this.difficulty.shortLabel})`;
  }

  setBuildMat(matId) {
    if (BUILD_MATERIALS[matId]) this.buildMat = matId;
  }

  setShadowsEnabled(enabled) {
    this.rig.root.traverse((obj) => {
      if (obj.isMesh) obj.castShadow = enabled;
    });
  }

  resetForRound(spawn = { x: 0, y: 0, z: -12, yaw: Math.PI }) {
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.vel.set(0, 0, 0);
    this.yaw = typeof spawn.yaw === 'number' ? spawn.yaw : Math.PI;
    this.pitch = 0;
    this.skyBoostTimer = 0;
    this.hp = 100;
    this.shield = 100;
    this.alive = true;
    this.defendTimer = 0;
    this.rampTimer = 0;
    this.fireCooldown = 0.45;
    this.buildCooldown = 0.35;
    this.respawnTimer = 0;
    this.rig.root.visible = true;
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
  }

  notifyShotAt() {
    if (!this.alive) return;
    if (Math.random() < this.difficulty.buildChance) {
      this.defendTimer = 0.65;
    }
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    let rem = amount;
    if (this.shield > 0) {
      const absorb = Math.min(this.shield, rem);
      this.shield -= absorb;
      rem -= absorb;
    }
    if (rem > 0) {
      this.hp = Math.max(0, this.hp - rem);
    }
    this.notifyShotAt();
    if (this.hp <= 0) {
      this.alive = false;
      this.respawnTimer = 2.2;
      this.rig.root.visible = false;
      return true;
    }
    return false;
  }

  _tryPlaceBuild(type, buildingSystem, audio, mapState = null) {
    if (this.buildCooldown > 0) return false;
    const maxHeightMeters = (this.difficulty.maxBuildHeight || 4) * WALL_HEIGHT;
    if (type === BUILD_TYPES.RAMP && this.pos.y >= maxHeightMeters) return false;

    const placement = buildingSystem.computePlacement(this.pos, this.yaw, this.pitch, type);
    if (!buildingSystem.canPlaceBuild(placement, mapState)) return false;

    const matInfo = BUILD_MATERIALS[this.buildMat] || BUILD_MATERIALS.wood;
    const placed = buildingSystem.placeBuild({
      ...placement,
      mat: this.buildMat,
      hp: matInfo.hp,
      maxHp: matInfo.hp,
      mask: getDefaultMask(type),
      ownerId: this.id
    });

    if (placed) {
      this.buildCooldown = this.difficulty.buildCooldown || 0.65;
      if (audio) audio.playBuildPlace(this.buildMat);
      return true;
    }
    return false;
  }

  update(
    dt,
    playerState,
    buildingSystem,
    pools,
    audio,
    onHitLocalPlayer,
    onRespawned,
    camPos = null,
    mapState = null,
    countdownActive = false,
    botSpawn = null,
    autoRespawn = true
  ) {
    this.time += dt;

    if (!this.alive) {
      if (autoRespawn) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) {
          this.resetForRound(botSpawn || { x: 0, y: 0, z: -12, yaw: Math.PI });
          if (onRespawned) onRespawned();
        }
      }
      return;
    }

    // Wait cleanly behind countdown barrier
    if (countdownActive) {
      this.rig.root.position.copy(this.pos);
      this.rig.root.rotation.y = this.yaw;
      this.rig.animate(this.time, 0, false, 0, 0, false, this.weaponSlot);
      this.rig.updateHealthBar(this.hp, this.shield, camPos);
      return;
    }

    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.buildCooldown > 0) this.buildCooldown -= dt;
    if (this.swingPhase > 0) this.swingPhase = Math.max(0, this.swingPhase - dt * 3.5);
    if (this.defendTimer > 0) this.defendTimer -= dt;
    if (this.rampTimer > 0) this.rampTimer -= dt;

    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = 0.85 + Math.random() * 1.3;
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }

    // Check Boost Pads if on elevated Sky Box
    if (mapState && mapState.boostPads && this.skyBoostTimer <= 0.1) {
      for (let i = 0; i < mapState.boostPads.length; i++) {
        const pad = mapState.boostPads[i];
        if (
          this.pos.x >= pad.minX && this.pos.x <= pad.maxX &&
          this.pos.y >= pad.minY && this.pos.y <= pad.maxY &&
          this.pos.z >= pad.minZ && this.pos.z <= pad.maxZ
        ) {
          this.vel.x = pad.vx;
          this.vel.y = pad.vy;
          this.vel.z = pad.vz;
          this.skyBoostTimer = 1.9;
          this.grounded = false;
          if (pools) pools.spawnSparks(this.pos.x, this.pos.y + 0.5, this.pos.z, 6, 0x22d3ee);
          break;
        }
      }
    }

    // Block building/shooting inside Spawn Box and head straight onto Boost Pad
    const inSkyBox = isInsideSpawnBox(this.pos, mapState?.mapId);
    const playerProtected = isInsideSpawnBox(playerState.pos, mapState?.mapId);
    const isFallingFromSky = mapState && mapState.mapId === 'skybox' && !this.grounded && this.skyBoostTimer > 0;

    const dx = playerState.pos.x - this.pos.x;
    const dy = (playerState.pos.y + 1.1) - (this.pos.y + PLAYER_EYE_STAND);
    const dz = playerState.pos.z - this.pos.z;
    const horizDist = Math.hypot(dx, dz) || 0.01;
    const totalDist = Math.hypot(dx, dy, dz) || 0.01;

    let desiredYaw = Math.atan2(-dx, -dz);
    let desiredPitch = Math.max(-0.85, Math.min(0.85, Math.atan2(dy, horizDist)));

    if (inSkyBox) {
      // Face toward the North Boost Pad at (0, -42.85)
      desiredYaw = Math.atan2(-(-this.pos.x), -(-42.85 - this.pos.z));
      desiredPitch = -0.15;
    }

    let yawDiff = desiredYaw - this.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    const turnSpeed = 7.5 + this.difficulty.rampRate * 6;
    this.yaw += Math.max(-turnSpeed * dt, Math.min(turnSpeed * dt, yawDiff));
    this.pitch += (desiredPitch - this.pitch) * Math.min(1, dt * 8);

    this.weaponSlot = horizDist < 8.5 ? 0 : 1;
    this.rig.setWeapon(this.weaponSlot, this.defendTimer > 0 || this.rampTimer > 0);

    const eyeX = this.pos.x;
    const eyeY = this.pos.y + PLAYER_EYE_STAND;
    const eyeZ = this.pos.z;
    const dirX = dx / totalDist;
    const dirY = dy / totalDist;
    const dirZ = dz / totalDist;

    const playerTargets = (playerState.alive && !playerProtected)
      ? [{ id: 'local', pos: playerState.pos, crouch: playerState.crouch, alive: true }]
      : [];

    raycastArena(eyeX, eyeY, eyeZ, dirX, dirY, dirZ, totalDist + 2, buildingSystem, playerTargets, _botHit, mapState);
    const hasLOS = _botHit.hit && _botHit.hitType === 'player';

    // Progressive Tactical Building (disabled in Spawn Box / while sky-dropping)
    if (!inSkyBox && !isFallingFromSky) {
      // 1. Defensive wall when damaged
      if (this.defendTimer > 0 && this.buildCooldown <= 0) {
        const savedPitch = this.pitch;
        this.pitch = 0.04;
        const builtWall = this._tryPlaceBuild(BUILD_TYPES.WALL, buildingSystem, audio, mapState);
        this.pitch = savedPitch;
        if (builtWall) {
          this.defendTimer = 0;
          if (Math.random() < this.difficulty.rampRate) {
            this.rampTimer = 1.0 + this.difficulty.rampRate * 0.8;
          }
        }
      }

      // 2. Ramp up gradually depending on difficulty tier
      const playerHigher = playerState.pos.y > this.pos.y + 1.2;
      const blockedByBuild = _botHit.hit && _botHit.hitType === 'build' && _botHit.dist < 6.5;
      const wantClimb = playerHigher || blockedByBuild || this.rampTimer > 0 || (this.difficulty.rampRate >= 0.75 && horizDist > 7 && this.pos.y < 10);

      if (wantClimb && this.buildCooldown <= 0) {
        if (Math.random() < this.difficulty.rampRate * 0.85) {
          const savedPitch = this.pitch;
          this.pitch = 0.14;
          const placedRamp = this._tryPlaceBuild(BUILD_TYPES.RAMP, buildingSystem, audio, mapState);
          // Extreme & Hard bots occasionally reinforce with wall/floor while cranking
          if (placedRamp && this.difficulty.rampRate >= 0.78 && Math.random() < 0.45) {
            this.pitch = -0.3;
            this.buildCooldown = 0; // Chain floor/wall on high tiers
            this._tryPlaceBuild(this.pos.y > 4 ? BUILD_TYPES.FLOOR : BUILD_TYPES.WALL, buildingSystem, audio, mapState);
          }
          this.pitch = savedPitch;
        }
      }
    }

    // Movement vector
    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    let forwardInput = 0;
    let strafeInput = 0;
    if (inSkyBox) {
      forwardInput = 1.0;
      strafeInput = 0;
    } else {
      if (horizDist > 12 || this.rampTimer > 0 || playerState.pos.y > this.pos.y + 1.2) {
        forwardInput = 0.92;
      } else if (horizDist < 4.5) {
        forwardInput = -0.45;
      } else {
        forwardInput = 0.25;
      }
      strafeInput = this.strafeDir * (horizDist < 16 ? 0.75 : 0.35);
    }

    const moveSpeed = SPRINT_SPEED * this.difficulty.moveSpeedMult;
    const moveLen = Math.hypot(forwardInput, strafeInput) || 1;
    let moveX = ((fwdX * forwardInput + rightX * strafeInput) / moveLen) * moveSpeed;
    let moveZ = ((fwdZ * forwardInput + rightZ * strafeInput) / moveLen) * moveSpeed;

    // Soft open-edge awareness on main arena floor so bot steers inward near void drop
    if (!inSkyBox && !isFallingFromSky && this.pos.y >= -0.25) {
      if (this.pos.x > 36.0 && moveX > 0) moveX = -moveSpeed * 0.65;
      else if (this.pos.x < -36.0 && moveX < 0) moveX = moveSpeed * 0.65;
      if (this.pos.z > 36.0 && moveZ > 0) moveZ = -moveSpeed * 0.65;
      else if (this.pos.z < -36.0 && moveZ < 0) moveZ = moveSpeed * 0.65;
    }

    this.wantJump = !inSkyBox && this.grounded && ((horizDist < 9 && Math.random() < 0.025) || (_botHit.hit && _botHit.hitType === 'build' && _botHit.dist < 5 && Math.random() < 0.06));

    stepPlayerPhysics(this, moveX, moveZ, this.wantJump, false, dt, buildingSystem, mapState);

    // Shooting (disabled while either combatant is inside a Spawn Box)
    if (!inSkyBox && !playerProtected && playerState.alive && this.fireCooldown <= 0) {
      const canShootPlayer = hasLOS;
      const shouldBreakBuild = !hasLOS && _botHit.hit && _botHit.hitType === 'build' && _botHit.dist < 14;

      if (canShootPlayer || shouldBreakBuild) {
        const w = WEAPONS[this.weaponSlot];
        const jitter = this.difficulty.aimJitter;
        const muzzleX = eyeX + rightX * 0.32;
        const muzzleY = eyeY - 0.14;
        const muzzleZ = eyeZ + rightZ * 0.32;

        const pellets = w.pellets;
        let totalPlayerDmg = 0;
        let anyHead = false;
        let hitX = 0, hitY = 0, hitZ = 0;

        for (let p = 0; p < pellets; p++) {
          let sdx = dirX + (Math.random() - 0.5) * (w.spread + jitter) * 2;
          let sdy = dirY + (Math.random() - 0.5) * (w.spread + jitter) * 2;
          let sdz = dirZ + (Math.random() - 0.5) * (w.spread + jitter) * 2;
          const slen = Math.hypot(sdx, sdy, sdz) || 1;
          sdx /= slen;
          sdy /= slen;
          sdz /= slen;

          raycastArena(eyeX, eyeY, eyeZ, sdx, sdy, sdz, w.range, buildingSystem, playerTargets, _botHit, mapState);

          if (pools) {
            pools.spawnTracer(muzzleX, muzzleY, muzzleZ, _botHit.x, _botHit.y, _botHit.z, w.tracerColor);
            if (_botHit.hit) {
              pools.spawnSparks(_botHit.x, _botHit.y, _botHit.z, 3, _botHit.hitType === 'player' ? 0xff4d6d : 0xfacc15);
            }
          }

          if (_botHit.hit && _botHit.hitType === 'player') {
            let dmg = w.damage;
            if (_botHit.dist > w.falloffStart) {
              const t = Math.min(1, (_botHit.dist - w.falloffStart) / Math.max(1, w.range - w.falloffStart));
              dmg *= (1 - 0.45 * t);
            }
            if (_botHit.isHeadshot) {
              dmg *= w.headshotMult;
              anyHead = true;
            }
            totalPlayerDmg += dmg;
            hitX = _botHit.x;
            hitY = _botHit.y;
            hitZ = _botHit.z;
          } else if (_botHit.hit && _botHit.hitType === 'build' && _botHit.buildKey) {
            const res = buildingSystem.damageBuild(_botHit.buildKey, Math.round(w.buildDamage / pellets));
            if (res.destroyed && audio) audio.playBuildBreak();
          }
        }

        if (audio) {
          const atten = Math.max(0.15, 1 - totalDist / 50);
          if (w.id === 'shotgun') audio.playShotgun(atten);
          else audio.playAR(atten);
        }

        if (totalPlayerDmg > 0 && onHitLocalPlayer) {
          onHitLocalPlayer(Math.round(totalPlayerDmg), anyHead, hitX, hitY, hitZ);
        }

        this.swingPhase = 1.0;
        this.fireCooldown = (w.cooldown / this.difficulty.fireRateMult) + Math.random() * this.difficulty.reactionSec * 0.4;
      }
    }

    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    const hSpeed = Math.hypot(moveX, moveZ);
    this.rig.animate(this.time, hSpeed, false, this.pitch, this.swingPhase, false, this.weaponSlot);
    this.rig.updateHealthBar(this.hp, this.shield, camPos);
  }

  dispose(scene) {
    scene.remove(this.rig.root);
    this.rig.dispose();
  }
}
