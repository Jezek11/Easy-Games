import * as THREE from 'three';
import {
  ARENA_HALF_GRID,
  BOT_DIFFICULTIES,
  BUILD_MATERIALS,
  BUILD_TYPES,
  CELL_SIZE,
  JUMP_SPEED,
  MAX_BUILD_LEVEL,
  PLAYER_EYE_STAND,
  SPRINT_SPEED,
  WALK_SPEED,
  WALL_HEIGHT,
  WEAPONS
} from './constants.js';
import { getDefaultMask, makeBuildKey } from './buildings.js';
import { isBuildSupported, isInsideSpawnBox, isPlayerProtected, raycastArena, stepPlayerPhysics } from './physics.js';
import { createCharacterRig } from './playerMesh.js';

const AI_TICK_INTERVAL = 0.1; // 10 Hz AI decision & raycast scan (100ms)

const _botHit = {
  hit: false, hitType: null, dist: 100,
  x: 0, y: 0, z: 0, buildKey: null, playerId: null, isHeadshot: false
};
const _botMuzzle = new THREE.Vector3();

function dirToHx(rot) {
  return rot === 1 ? 1 : (rot === 3 ? -1 : 0);
}

function dirToHz(rot) {
  return rot === 2 ? 1 : (rot === 0 ? -1 : 0);
}

function dirToYaw(rot) {
  if (rot === 0) return 0;
  if (rot === 1) return -Math.PI * 0.5;
  if (rot === 2) return Math.PI;
  return Math.PI * 0.5;
}

function vecToCardinalRot(dx, dz) {
  if (Math.abs(dz) >= Math.abs(dx)) {
    return dz < 0 ? 0 : 2;
  }
  return dx > 0 ? 1 : 3;
}

function wallOnCellEdge(gx, gy, gz, edgeRot, out) {
  if (edgeRot === 0) {
    out.gx = gx; out.gy = gy; out.gz = gz; out.dir = 0;
  } else if (edgeRot === 2) {
    out.gx = gx; out.gy = gy; out.gz = gz + 1; out.dir = 0;
  } else if (edgeRot === 3) {
    out.gx = gx; out.gy = gy; out.gz = gz; out.dir = 1;
  } else {
    out.gx = gx + 1; out.gy = gy; out.gz = gz; out.dir = 1;
  }
  return out;
}

function rampProgressInCell(px, pz, gx, gz, rot) {
  const u = (px - gx * CELL_SIZE) / CELL_SIZE;
  const v = (pz - gz * CELL_SIZE) / CELL_SIZE;
  if (rot === 0) return 1 - v;
  if (rot === 1) return u;
  if (rot === 2) return v;
  return 1 - u;
}

function getTurboPieceCooldown(diffId) {
  if (diffId === 'extreme') return 0.05;
  if (diffId === 'hard') return 0.08;
  if (diffId === 'medium') return 0.14;
  return 0.22;
}

function getBuildSeqCooldown(diffId) {
  if (diffId === 'extreme') return 1.5;
  if (diffId === 'hard') return 2.2;
  if (diffId === 'medium') return 3.6;
  return 5.5;
}

function hasSupportNear(x, z, curY, buildingSystem, mapState) {
  const gx = Math.floor(x / CELL_SIZE);
  const gz = Math.floor(z / CELL_SIZE);
  const baseGy = Math.max(0, Math.floor((curY + 0.35) / WALL_HEIGHT));
  const builds = buildingSystem && buildingSystem.builds;

  const checkRamp = (r) => {
    const u = (x - r.gx * CELL_SIZE) / CELL_SIZE;
    const v = (z - r.gz * CELL_SIZE) / CELL_SIZE;
    if (u < 0.05 || u > 0.95 || v < 0.05 || v > 0.95) return false;
    const t = r.rot === 0 ? (1 - v) : (r.rot === 1 ? u : (r.rot === 2 ? v : (1 - u)));
    const ry = r.gy * WALL_HEIGHT + t * WALL_HEIGHT + 0.11;
    return ry >= curY - 1.25 && ry <= curY + 1.1;
  };

  if (builds) {
    for (let gy = Math.max(0, baseGy - 1); gy <= baseGy + 1; gy++) {
      const fl = builds.get(`f:${gx}:${gy}:${gz}`);
      if (fl) {
        const fy = (gy === 0 ? 0.08 : gy * WALL_HEIGHT) + 0.11;
        if (fy >= curY - 1.25 && fy <= curY + 1.1) return true;
      }
      const rp = builds.get(`r:${gx}:${gy}:${gz}`);
      if (rp && checkRamp(rp)) return true;
    }
  }
  if (mapState && mapState.staticRamps) {
    for (let i = 0; i < mapState.staticRamps.length; i++) {
      const sr = mapState.staticRamps[i];
      if (sr.gx === gx && sr.gz === gz && checkRamp(sr)) return true;
    }
  }
  if (mapState && mapState.staticBoxes) {
    for (let i = 0; i < mapState.staticBoxes.length; i++) {
      const bx = mapState.staticBoxes[i];
      if (
        x >= bx.minX && x <= bx.maxX &&
        z >= bx.minZ && z <= bx.maxZ &&
        bx.maxY >= curY - 1.25 && bx.maxY <= curY + 1.1
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasWallOnEdge(gx, gy, gz, edgeRot, buildingSystem) {
  if (!buildingSystem || !buildingSystem.builds) return false;
  const w = wallOnCellEdge(gx, gy, gz, edgeRot, _wallEdgeProbe);
  return buildingSystem.builds.has(`w:${w.gx}:${w.gy}:${w.gz}:${w.dir}`);
}
const _wallEdgeProbe = { gx: 0, gy: 0, gz: 0, dir: 0 };

export class SmartBot {
  constructor(scene, difficulty = 'medium', skinId = 'crimson', buildMat = 'wood') {
    this.id = 'bot';
    this.difficulty = BOT_DIFFICULTIES[difficulty] || BOT_DIFFICULTIES.medium;
    this.name = `Bot (${this.difficulty.shortLabel})`;
    this.skinId = skinId;
    this.buildMat = buildMat;

    this.pos = new THREE.Vector3(0, 0, -12);
    this.renderPos = new THREE.Vector3(0, 0, -12);
    this.vel = new THREE.Vector3(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.desiredYaw = Math.PI;
    this.desiredPitch = 0;
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

    // AI state machine & timers (zero GC)
    this.aiState = 'COMBAT'; // 'SKYBOX_DROP' | 'VRAMP_RUN' | 'BUILD_SEQ' | 'DEFEND_COVER' | 'COMBAT'
    this.vrampOpeningPending = true;
    this.openingDamageTaken = 0;
    this.vrampRunTimer = 0;
    this.buildQueue = [];
    this.buildStepTimer = 0;
    this.pieceCooldown = 0;
    this.buildSeqCooldown = 0;
    this.buildVisualTimer = 0;
    this.jumpCooldown = 2.0;
    this.pauseShootTimer = 0;
    this.pauseShootCooldown = 1.6;
    this.stuckTimer = 0;
    this.stuckCheckTimer = 0;
    this.lastCheckX = 0;
    this.lastCheckZ = -12;
    this.coverCell = null;
    this._wallScratch = { gx: 0, gy: 0, gz: 0, dir: 0 };

    this.aiAccum = AI_TICK_INTERVAL;
    this.fireCooldown = 0.5;
    this.buildCooldown = 0.4;
    this.strafeDir = 1;
    this.strafeTimer = 1.6;
    this.defendTimer = 0;
    this.rampTimer = 0;
    this.wantJump = false;
    this.cachedWantJump = false;
    this.hasLOS = false;
    this.blockedByBuild = false;
    this.blockedDist = 99;
    this.cachedInSkyBox = false;
    this.cachedPlayerProtected = false;
    this.moveForwardInput = 0;
    this.moveStrafeInput = 0;
    this.moveVelX = 0;
    this.moveVelZ = 0;
    this.respawnTimer = 0;
    this.time = 0;

    this._playerTargetObj = { id: 'local', pos: null, crouch: false, alive: true };
    this._playerTargets = [this._playerTargetObj];
    this._emptyTargets = [];
    this._placementScratch = { type: '', gx: 0, gy: 0, gz: 0, dir: 0, rot: 0, key: '' };
    this._buildDataScratch = {
      id: '',
      key: '',
      type: '',
      gx: 0,
      gy: 0,
      gz: 0,
      dir: 0,
      rot: 0,
      mat: 'wood',
      hp: 150,
      maxHp: 150,
      mask: 0,
      ownerId: 'bot'
    };

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

  setQuality(qualityKey) {
    this.rig.setQualityTier(qualityKey);
  }

  setShadowsEnabled(enabled) {
    this.rig.root.traverse((obj) => {
      if (obj.isMesh) obj.castShadow = enabled;
    });
  }

  resetForRound(spawn = { x: 0, y: 0, z: -12, yaw: Math.PI }) {
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.renderPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.yaw = typeof spawn.yaw === 'number' ? spawn.yaw : Math.PI;
    this.desiredYaw = this.yaw;
    this.pitch = 0;
    this.desiredPitch = 0;
    this.grounded = true;
    this.skyBoostTimer = 0;
    this.hp = 100;
    this.shield = 100;
    this.alive = true;

    this.aiState = 'COMBAT';
    this.vrampOpeningPending = true;
    this.openingDamageTaken = 0;
    this.vrampRunTimer = 0;
    this.buildQueue.length = 0;
    this.buildStepTimer = 0;
    this.pieceCooldown = 0;
    this.buildSeqCooldown = 0.6;
    this.buildVisualTimer = 0;
    this.jumpCooldown = 2.0;
    this.pauseShootTimer = 0;
    this.pauseShootCooldown = 1.4;
    this.stuckTimer = 0;
    this.stuckCheckTimer = 0;
    this.lastCheckX = spawn.x;
    this.lastCheckZ = spawn.z;
    this.coverCell = null;

    this.aiAccum = AI_TICK_INTERVAL;
    this.defendTimer = 0;
    this.rampTimer = 0;
    this.hasLOS = false;
    this.blockedByBuild = false;
    this.cachedWantJump = false;
    this.moveForwardInput = 0;
    this.moveStrafeInput = 0;
    this.moveVelX = 0;
    this.moveVelZ = 0;
    this.strafeTimer = 1.6 + Math.random() * 1.4;
    this.fireCooldown = 0.45;
    this.buildCooldown = 0.35;
    this.respawnTimer = 0;
    this.rig.root.visible = true;
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.setWeapon(this.weaponSlot, false);
  }

  notifyShotAt() {
    if (!this.alive) return;
    if (this.aiState === 'COMBAT' && Math.random() < this.difficulty.buildChance) {
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
    if (this.aiState === 'VRAMP_RUN') {
      this.openingDamageTaken += amount;
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

  _placeGridBuild(type, gx, gy, gz, dir, rot, buildingSystem, audio, mapState = null, halfGrid = ARENA_HALF_GRID) {
    if (gy < 0 || gy >= MAX_BUILD_LEVEL) return 'blocked';
    if (type === BUILD_TYPES.WALL) {
      if (gx < -halfGrid + 1 || gx > halfGrid - 1 || gz < -halfGrid + 1 || gz > halfGrid - 1) return 'blocked';
    } else {
      if (gx < -halfGrid + 1 || gx > halfGrid - 2 || gz < -halfGrid + 1 || gz > halfGrid - 2) return 'blocked';
    }

    const key = makeBuildKey(type, gx, gy, gz, dir);
    const existing = buildingSystem.builds.get(key);
    if (existing) {
      if (type === BUILD_TYPES.RAMP) {
        return existing.rot === rot ? 'exists' : 'occupied';
      }
      return 'exists';
    }

    const ps = this._placementScratch;
    ps.type = type;
    ps.gx = gx;
    ps.gy = gy;
    ps.gz = gz;
    ps.dir = dir;
    ps.rot = rot;
    ps.key = key;

    if (!buildingSystem.canPlaceBuild(ps, mapState)) {
      return 'unsupported';
    }

    const matInfo = BUILD_MATERIALS[this.buildMat] || BUILD_MATERIALS.wood;
    const bd = this._buildDataScratch;
    bd.id = key;
    bd.key = key;
    bd.type = type;
    bd.gx = gx;
    bd.gy = gy;
    bd.gz = gz;
    bd.dir = dir;
    bd.rot = rot;
    bd.mat = this.buildMat;
    bd.hp = matInfo.hp;
    bd.maxHp = matInfo.hp;
    bd.mask = getDefaultMask(type);
    bd.ownerId = this.id;

    const placed = buildingSystem.placeBuild(bd);
    if (placed) {
      this.pieceCooldown = getTurboPieceCooldown(this.difficulty.id);
      this.buildVisualTimer = 0.28;
      if (audio) audio.playBuildPlace(this.buildMat);
      return 'placed';
    }
    return 'blocked';
  }

  _enqueueVRampBuildOpening() {
    this.buildQueue.length = 0;
    this.buildStepTimer = 0;
    const diffId = this.difficulty.id;
    const turnDir = Math.random() < 0.5 ? 1 : -1;
    const r1 = (2 + turnDir + 4) % 4;
    const hx1 = dirToHx(r1);

    if (diffId === 'easy') {
      this.buildQueue.push(
        { kind: 'ramp', gx: 0, gy: 1, gz: 1, rot: 2 },
        { kind: 'platform', gx: 0, gy: 2, gz: 2, faceRot: 0, floorPlaced: false, wallPlaced: false }
      );
    } else if (diffId === 'medium') {
      this.buildQueue.push(
        { kind: 'ramp', gx: 0, gy: 1, gz: 1, rot: 2 },
        { kind: 'ramp', gx: 0, gy: 2, gz: 2, rot: 2 },
        { kind: 'turn90', gx: 0, gy: 3, gz: 3, fromRot: 2, toRot: r1, floorPlaced: false, wallFrontPlaced: false, wallSidePlaced: false, rampPlaced: false, hopped: false },
        { kind: 'platform', gx: hx1, gy: 4, gz: 3, faceRot: 0, floorPlaced: false, wallPlaced: false }
      );
    } else if (diffId === 'hard') {
      this.buildQueue.push(
        { kind: 'ramp', gx: 0, gy: 1, gz: 1, rot: 2 },
        { kind: 'turn90', gx: 0, gy: 2, gz: 2, fromRot: 2, toRot: r1, floorPlaced: false, wallFrontPlaced: false, wallSidePlaced: false, rampPlaced: false, hopped: false },
        { kind: 'turn90', gx: hx1, gy: 3, gz: 2, fromRot: r1, toRot: 0, floorPlaced: false, wallFrontPlaced: false, wallSidePlaced: false, rampPlaced: false, hopped: false },
        { kind: 'platform', gx: hx1, gy: 4, gz: 1, faceRot: 0, floorPlaced: false, wallPlaced: false }
      );
    } else {
      this.buildQueue.push(
        { kind: 'ramp', gx: 0, gy: 1, gz: 1, rot: 2 },
        { kind: 'turn90', gx: 0, gy: 2, gz: 2, fromRot: 2, toRot: r1, floorPlaced: false, wallFrontPlaced: false, wallSidePlaced: false, rampPlaced: false, hopped: false },
        { kind: 'turn90', gx: hx1, gy: 3, gz: 2, fromRot: r1, toRot: 0, floorPlaced: false, wallFrontPlaced: false, wallSidePlaced: false, rampPlaced: false, hopped: false },
        { kind: 'ramp', gx: hx1, gy: 4, gz: 1, rot: 0 },
        { kind: 'platform', gx: hx1, gy: 5, gz: 0, faceRot: 0, floorPlaced: false, wallPlaced: false }
      );
    }
    this.aiState = 'BUILD_SEQ';
  }

  _tryStartRetakeSequence(playerState, buildingSystem, audio, mapState) {
    const maxHeight = Math.min(MAX_BUILD_LEVEL - 2, this.difficulty.maxBuildHeight || 4);
    const cgx = Math.floor(this.pos.x / CELL_SIZE);
    const cgy = Math.max(0, Math.floor((this.pos.y + 0.35) / WALL_HEIGHT));
    const cgz = Math.floor(this.pos.z / CELL_SIZE);
    if (cgy >= maxHeight) return false;

    const dx = playerState.pos.x - this.pos.x;
    const dz = playerState.pos.z - this.pos.z;
    const primaryRot = vecToCardinalRot(dx, dz);
    const turnDir = Math.random() < 0.5 ? 1 : -1;
    const sideRot = (primaryRot + turnDir + 4) % 4;
    const rot = (this.blockedByBuild && this.blockedDist < 4.2 && Math.random() < 0.5) ? sideRot : primaryRot;

    const hx = dirToHx(rot);
    const hz = dirToHz(rot);

    // Check if current cell already has a ramp or floor we can climb from, else anchor in current cell
    const curRamp = buildingSystem.builds.get(`r:${cgx}:${cgy}:${cgz}`);
    let startGx = cgx;
    let startGy = cgy;
    let startGz = cgz;
    let startRot = rot;

    if (curRamp) {
      startRot = curRamp.rot;
      startGx = cgx + dirToHx(startRot);
      startGy = cgy + 1;
      startGz = cgz + dirToHz(startRot);
    } else {
      // Ensure support at current cell if above ground
      if (cgy > 0 && !buildingSystem.builds.has(`f:${cgx}:${cgy}:${cgz}`)) {
        const res = this._placeGridBuild(BUILD_TYPES.FLOOR, cgx, cgy, cgz, 0, 0, buildingSystem, audio, mapState);
        if (res !== 'placed' && res !== 'exists') return false;
      }
      // If bot is already past low part of current cell, start ramp in the next cell (only if no wall blocks that edge!)
      const prog = rampProgressInCell(this.pos.x, this.pos.z, cgx, cgz, startRot);
      if (prog > 0.35) {
        if (hasWallOnEdge(cgx, cgy, cgz, startRot, buildingSystem)) {
          startRot = sideRot;
          if (hasWallOnEdge(cgx, cgy, cgz, startRot, buildingSystem)) return false;
          startGx = cgx + dirToHx(startRot);
          startGz = cgz + dirToHz(startRot);
        } else {
          startGx = cgx + hx;
          startGz = cgz + hz;
        }
        if (cgy > 0) {
          const bridgeRes = this._placeGridBuild(BUILD_TYPES.FLOOR, startGx, cgy, startGz, 0, 0, buildingSystem, audio, mapState);
          if (bridgeRes !== 'placed' && bridgeRes !== 'exists') return false;
        }
      }
    }

    // Verify start cell isn't occupied by an incompatible ramp
    const testKey = makeBuildKey(BUILD_TYPES.RAMP, startGx, startGy, startGz, 0);
    const existingRamp = buildingSystem.builds.get(testKey);
    if (existingRamp && existingRamp.rot !== startRot) return false;
    if (
      startGx < -ARENA_HALF_GRID + 2 || startGx > ARENA_HALF_GRID - 3 ||
      startGz < -ARENA_HALF_GRID + 2 || startGz > ARENA_HALF_GRID - 3
    ) {
      return false;
    }

    this.buildQueue.length = 0;
    this.buildStepTimer = 0;
    this.buildQueue.push({ kind: 'ramp', gx: startGx, gy: startGy, gz: startGz, rot: startRot });

    const nhx = dirToHx(startRot);
    const nhz = dirToHz(startRot);
    const nextGx = startGx + nhx;
    const nextGy = startGy + 1;
    const nextGz = startGz + nhz;

    if (
      nextGy < maxHeight &&
      nextGx >= -ARENA_HALF_GRID + 2 && nextGx <= ARENA_HALF_GRID - 3 &&
      nextGz >= -ARENA_HALF_GRID + 2 && nextGz <= ARENA_HALF_GRID - 3
    ) {
      if (this.difficulty.rampRate >= 0.72) {
        const r90 = (startRot + turnDir + 4) % 4;
        this.buildQueue.push({
          kind: 'turn90',
          gx: nextGx,
          gy: nextGy,
          gz: nextGz,
          fromRot: startRot,
          toRot: r90,
          floorPlaced: false,
          wallFrontPlaced: false,
          wallSidePlaced: false,
          rampPlaced: false,
          hopped: false
        });
      } else if (this.difficulty.rampRate >= 0.45) {
        this.buildQueue.push({ kind: 'ramp', gx: nextGx, gy: nextGy, gz: nextGz, rot: startRot });
      }
    }

    this.aiState = 'BUILD_SEQ';
    return true;
  }

  _tryStartDefendCover(playerState, buildingSystem, audio, mapState) {
    const cgx = Math.floor(this.pos.x / CELL_SIZE);
    const cgy = Math.max(0, Math.floor((this.pos.y + 0.35) / WALL_HEIGHT));
    const cgz = Math.floor(this.pos.z / CELL_SIZE);
    const dx = playerState.pos.x - this.pos.x;
    const dz = playerState.pos.z - this.pos.z;
    const dir = vecToCardinalRot(dx, dz);

    if (cgy > 0) {
      const fRes = this._placeGridBuild(BUILD_TYPES.FLOOR, cgx, cgy, cgz, 0, 0, buildingSystem, audio, mapState);
      if (fRes === 'unsupported' || fRes === 'blocked') return false;
    }

    const w = wallOnCellEdge(cgx, cgy, cgz, dir, this._wallScratch);
    const wRes = this._placeGridBuild(BUILD_TYPES.WALL, w.gx, w.gy, w.gz, w.dir, 0, buildingSystem, audio, mapState);
    if (wRes === 'unsupported' || wRes === 'blocked') return false;

    const maxHeight = Math.min(MAX_BUILD_LEVEL - 2, this.difficulty.maxBuildHeight || 4);
    const wantRamp = cgy < maxHeight && Math.random() < this.difficulty.rampRate;

    this.coverCell = {
      gx: cgx,
      gy: cgy,
      gz: cgz,
      rot: dir,
      wantRamp,
      rampPlaced: false,
      timer: 0
    };
    this.aiState = 'DEFEND_COVER';
    this.defendTimer = 0;
    return true;
  }

  _stepBuildSequence(dt, playerState, buildingSystem, audio, mapState) {
    if (this.buildQueue.length === 0) {
      this.aiState = 'COMBAT';
      this.buildVisualTimer = 0;
      this.buildSeqCooldown = getBuildSeqCooldown(this.difficulty.id);
      return null;
    }

    this.buildStepTimer += dt;
    if (this.buildStepTimer > 2.4) {
      this.buildQueue.length = 0;
      this.aiState = 'COMBAT';
      this.buildVisualTimer = 0;
      this.buildSeqCooldown = getBuildSeqCooldown(this.difficulty.id);
      return null;
    }

    const step = this.buildQueue[0];
    this.buildVisualTimer = Math.max(this.buildVisualTimer, 0.15);

    if (step.kind === 'ramp') {
      const res = this.pieceCooldown <= 0
        ? this._placeGridBuild(BUILD_TYPES.RAMP, step.gx, step.gy, step.gz, 0, step.rot, buildingSystem, audio, mapState)
        : (buildingSystem.builds.has(makeBuildKey(BUILD_TYPES.RAMP, step.gx, step.gy, step.gz, 0)) ? 'exists' : 'wait');

      if (res === 'occupied' || res === 'unsupported' || res === 'blocked') {
        this.buildQueue.length = 0;
        this.aiState = 'COMBAT';
        this.buildVisualTimer = 0;
        this.buildSeqCooldown = getBuildSeqCooldown(this.difficulty.id);
        return null;
      }

      const hx = dirToHx(step.rot);
      const hz = dirToHz(step.rot);
      const topX = (step.gx + 0.5) * CELL_SIZE + hx * 1.95;
      const topZ = (step.gz + 0.5) * CELL_SIZE + hz * 1.95;

      const prog = rampProgressInCell(this.pos.x, this.pos.z, step.gx, step.gz, step.rot);
      if (prog >= 0.88 && this.pos.y >= (step.gy + 1) * WALL_HEIGHT - 0.42) {
        this.buildQueue.shift();
        this.buildStepTimer = 0;
        if (this.buildQueue.length === 0) {
          this.aiState = 'COMBAT';
          this.buildVisualTimer = 0;
          this.buildSeqCooldown = getBuildSeqCooldown(this.difficulty.id);
          return null;
        }
      }

      return {
        goalX: topX,
        goalZ: topZ,
        yaw: dirToYaw(step.rot),
        pitch: 0.08,
        speed: SPRINT_SPEED * this.difficulty.moveSpeedMult
      };
    }

    if (step.kind === 'turn90') {
      if (!step.floorPlaced && this.pieceCooldown <= 0) {
        const fRes = this._placeGridBuild(BUILD_TYPES.FLOOR, step.gx, step.gy, step.gz, 0, 0, buildingSystem, audio, mapState);
        if (fRes === 'placed' || fRes === 'exists') {
          step.floorPlaced = true;
        } else if (fRes === 'blocked' || fRes === 'unsupported') {
          this.buildQueue.length = 0;
          this.aiState = 'COMBAT';
          this.buildVisualTimer = 0;
          return null;
        }
      }

      if (step.floorPlaced && !step.wallFrontPlaced && this.pieceCooldown <= 0) {
        const wf = wallOnCellEdge(step.gx, step.gy, step.gz, step.fromRot, this._wallScratch);
        const wRes = this._placeGridBuild(BUILD_TYPES.WALL, wf.gx, wf.gy, wf.gz, wf.dir, 0, buildingSystem, audio, mapState);
        if (wRes === 'placed' || wRes === 'exists') step.wallFrontPlaced = true;
      }

      if (step.floorPlaced && step.wallFrontPlaced && !step.wallSidePlaced && this.pieceCooldown <= 0) {
        const outerEdge = (step.toRot + 2) % 4;
        const ws = wallOnCellEdge(step.gx, step.gy, step.gz, outerEdge, this._wallScratch);
        const wRes = this._placeGridBuild(BUILD_TYPES.WALL, ws.gx, ws.gy, ws.gz, ws.dir, 0, buildingSystem, audio, mapState);
        if (wRes === 'placed' || wRes === 'exists') step.wallSidePlaced = true;
      }

      const fhx = dirToHx(step.fromRot);
      const fhz = dirToHz(step.fromRot);
      const nhx = dirToHx(step.toRot);
      const nhz = dirToHz(step.toRot);

      const cellMinX = step.gx * CELL_SIZE;
      const cellMaxX = (step.gx + 1) * CELL_SIZE;
      const cellMinZ = step.gz * CELL_SIZE;
      const cellMaxZ = (step.gz + 1) * CELL_SIZE;
      const insideTurnCell = (
        this.pos.x >= cellMinX + 0.15 && this.pos.x <= cellMaxX - 0.15 &&
        this.pos.z >= cellMinZ + 0.15 && this.pos.z <= cellMaxZ - 0.15 &&
        this.pos.y >= step.gy * WALL_HEIGHT - 0.35
      );

      if (!step.rampPlaced) {
        const entryX = (step.gx + 0.5) * CELL_SIZE - nhx * (CELL_SIZE * 0.28) - fhx * (CELL_SIZE * 0.08);
        const entryZ = (step.gz + 0.5) * CELL_SIZE - nhz * (CELL_SIZE * 0.28) - fhz * (CELL_SIZE * 0.08);

        if (!step.floorPlaced) {
          return {
            goalX: entryX,
            goalZ: entryZ,
            yaw: dirToYaw(step.fromRot),
            pitch: 0.05,
            speed: WALK_SPEED * 0.65
          };
        }

        if (insideTurnCell) {
          const t = rampProgressInCell(this.pos.x, this.pos.z, step.gx, step.gz, step.toRot);
          const rampY = step.gy * WALL_HEIGHT + Math.max(0, Math.min(1, t)) * WALL_HEIGHT + 0.11;

          if (!step.hopped && this.grounded && t <= 0.30) {
            this.cachedWantJump = true;
            step.hopped = true;
          }

          if (this.pieceCooldown <= 0 && this.pos.y >= rampY - 0.72) {
            const rRes = this._placeGridBuild(BUILD_TYPES.RAMP, step.gx, step.gy, step.gz, 0, step.toRot, buildingSystem, audio, mapState);
            if (rRes === 'placed' || rRes === 'exists') {
              step.rampPlaced = true;
            } else if (rRes === 'occupied' || rRes === 'blocked') {
              this.buildQueue.length = 0;
              this.aiState = 'COMBAT';
              this.buildVisualTimer = 0;
              return null;
            }
          }
        }

        const turnYaw = insideTurnCell ? dirToYaw(step.toRot) : dirToYaw(step.fromRot);
        return {
          goalX: entryX,
          goalZ: entryZ,
          yaw: turnYaw,
          pitch: 0.06,
          speed: SPRINT_SPEED * this.difficulty.moveSpeedMult
        };
      }

      // Ramp placed: climb cleanly straight up toRot
      const topX = (step.gx + 0.5) * CELL_SIZE + nhx * 1.95;
      const topZ = (step.gz + 0.5) * CELL_SIZE + nhz * 1.95;
      const prog = rampProgressInCell(this.pos.x, this.pos.z, step.gx, step.gz, step.toRot);
      if (prog >= 0.88 && this.pos.y >= (step.gy + 1) * WALL_HEIGHT - 0.42) {
        this.buildQueue.shift();
        this.buildStepTimer = 0;
        if (this.buildQueue.length === 0) {
          this.aiState = 'COMBAT';
          this.buildVisualTimer = 0;
          this.buildSeqCooldown = getBuildSeqCooldown(this.difficulty.id);
          return null;
        }
      }

      return {
        goalX: topX,
        goalZ: topZ,
        yaw: dirToYaw(step.toRot),
        pitch: 0.08,
        speed: SPRINT_SPEED * this.difficulty.moveSpeedMult
      };
    }

    // 'platform' step: place floor to catch at top of rush/90 without blocking own LOS with a blind front wall
    if (!step.floorPlaced && this.pieceCooldown <= 0) {
      const fRes = this._placeGridBuild(BUILD_TYPES.FLOOR, step.gx, step.gy, step.gz, 0, 0, buildingSystem, audio, mapState);
      if (fRes === 'placed' || fRes === 'exists') step.floorPlaced = true;
    }

    const cx = (step.gx + 0.5) * CELL_SIZE;
    const cz = (step.gz + 0.5) * CELL_SIZE;
    if (
      step.floorPlaced &&
      this.pos.y >= step.gy * WALL_HEIGHT - 0.35 &&
      Math.hypot(cx - this.pos.x, cz - this.pos.z) < 1.35
    ) {
      this.buildQueue.shift();
      this.buildStepTimer = 0;
      if (this.buildQueue.length === 0) {
        this.aiState = 'COMBAT';
        this.buildVisualTimer = 0;
        this.buildSeqCooldown = getBuildSeqCooldown(this.difficulty.id);
        return null;
      }
    }

    return {
      goalX: cx,
      goalZ: cz,
      yaw: dirToYaw(step.faceRot),
      pitch: 0,
      speed: WALK_SPEED * 0.85
    };
  }

  _stepDefendCover(dt, playerState, buildingSystem, audio, mapState) {
    const c = this.coverCell;
    if (!c) {
      this.aiState = 'COMBAT';
      return null;
    }
    c.timer += dt;
    this.buildVisualTimer = Math.max(this.buildVisualTimer, 0.12);

    const dx = playerState.pos.x - this.pos.x;
    const dy = (playerState.pos.y + 1.1) - (this.pos.y + PLAYER_EYE_STAND);
    const dz = playerState.pos.z - this.pos.z;
    const hDist = Math.hypot(dx, dz) || 0.01;
    const aimYaw = Math.atan2(-dx, -dz);
    const aimPitch = Math.max(-0.85, Math.min(0.85, Math.atan2(dy, hDist)));

    if (!c.wantRamp || c.timer > 1.1) {
      this.aiState = 'COMBAT';
      this.coverCell = null;
      this.buildVisualTimer = 0;
      return null;
    }

    const hx = dirToHx(c.rot);
    const hz = dirToHz(c.rot);

    if (!c.rampPlaced) {
      const lowX = (c.gx + 0.5) * CELL_SIZE - hx * (CELL_SIZE * 0.28);
      const lowZ = (c.gz + 0.5) * CELL_SIZE - hz * (CELL_SIZE * 0.28);
      const prog = rampProgressInCell(this.pos.x, this.pos.z, c.gx, c.gz, c.rot);
      const rampY = c.gy * WALL_HEIGHT + Math.max(0, Math.min(1, prog)) * WALL_HEIGHT + 0.11;

      if (prog <= 0.28 && this.pieceCooldown <= 0 && this.pos.y >= rampY - 0.72) {
        const rRes = this._placeGridBuild(BUILD_TYPES.RAMP, c.gx, c.gy, c.gz, 0, c.rot, buildingSystem, audio, mapState);
        if (rRes === 'placed' || rRes === 'exists') {
          c.rampPlaced = true;
        } else {
          this.aiState = 'COMBAT';
          this.coverCell = null;
          this.buildVisualTimer = 0;
          return null;
        }
      }

      return {
        goalX: lowX,
        goalZ: lowZ,
        yaw: aimYaw,
        pitch: aimPitch,
        speed: WALK_SPEED
      };
    }

    // Climb ramp cleanly up to peek position behind top of wall (t ~ 0.68)
    const peekX = (c.gx + 0.5) * CELL_SIZE + hx * (CELL_SIZE * 0.18);
    const peekZ = (c.gz + 0.5) * CELL_SIZE + hz * (CELL_SIZE * 0.18);
    const prog = rampProgressInCell(this.pos.x, this.pos.z, c.gx, c.gz, c.rot);
    if (prog >= 0.66 || c.timer > 0.95) {
      this.aiState = 'COMBAT';
      this.coverCell = null;
      this.buildVisualTimer = 0;
      return null;
    }

    return {
      goalX: peekX,
      goalZ: peekZ,
      yaw: aimYaw,
      pitch: aimPitch,
      speed: SPRINT_SPEED * this.difficulty.moveSpeedMult
    };
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

    // Trigger authentic V-Ramp 1v1 opening when countdown ends
    if (mapState && mapState.mapId === 'vramp' && this.vrampOpeningPending) {
      this.vrampOpeningPending = false;
      this.openingDamageTaken = 0;
      this.vrampRunTimer = 0;
      this.aiState = 'VRAMP_RUN';
    } else if (mapState && mapState.mapId !== 'vramp') {
      this.vrampOpeningPending = false;
    }

    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.buildCooldown > 0) this.buildCooldown -= dt;
    if (this.pieceCooldown > 0) this.pieceCooldown -= dt;
    if (this.buildSeqCooldown > 0) this.buildSeqCooldown -= dt;
    if (this.buildVisualTimer > 0) this.buildVisualTimer = Math.max(0, this.buildVisualTimer - dt);
    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;
    if (this.pauseShootTimer > 0) this.pauseShootTimer = Math.max(0, this.pauseShootTimer - dt);
    if (this.pauseShootCooldown > 0) this.pauseShootCooldown -= dt;
    if (this.swingPhase > 0) this.swingPhase = Math.max(0, this.swingPhase - dt * 3.5);
    if (this.defendTimer > 0) this.defendTimer -= dt;
    if (this.rampTimer > 0) this.rampTimer -= dt;

    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = 1.5 + Math.random() * 1.5;
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

    const dx = playerState.pos.x - this.pos.x;
    const dy = (playerState.pos.y + 1.1) - (this.pos.y + PLAYER_EYE_STAND);
    const dz = playerState.pos.z - this.pos.z;
    const horizDist = Math.hypot(dx, dz) || 0.01;
    const totalDist = Math.hypot(dx, dy, dz) || 0.01;

    this._playerTargetObj.pos = playerState.pos;
    this._playerTargetObj.crouch = Boolean(playerState.crouch);

    const isFallingFromSky = mapState && mapState.mapId === 'skybox' && !this.grounded && this.skyBoostTimer > 0;
    this.cachedInSkyBox = isInsideSpawnBox(this.pos, mapState?.mapId);
    this.cachedPlayerProtected = isPlayerProtected(playerState.pos, mapState?.mapId);
    if (this.cachedInSkyBox) {
      this.aiState = 'SKYBOX_DROP';
    } else if (this.aiState === 'SKYBOX_DROP' && !isFallingFromSky && this.grounded) {
      this.aiState = 'COMBAT';
    }

    let steeringCmd = null;

    // 60+ FPS Steering & Building Execution for structured states
    if (this.aiState === 'VRAMP_RUN') {
      this.vrampRunTimer += dt;
      if (this.openingDamageTaken >= 45) {
        this._tryStartDefendCover(playerState, buildingSystem, audio, mapState);
      } else if (this.vrampRunTimer > 3.2 || this.pos.y < -0.5) {
        this.aiState = 'COMBAT';
      } else {
        // Run cleanly down North arm (right lane x=1.42 so player & bot pass cleanly), then climb South arm centerline
        const goalX = this.pos.z < 1.2 ? 1.42 : 2.0;
        const goalZ = Math.min(4.2, this.pos.z + 2.5);
        const gdx = goalX - this.pos.x;
        const gdz = goalZ - this.pos.z;
        steeringCmd = {
          goalX,
          goalZ,
          yaw: Math.atan2(-gdx, -gdz),
          pitch: this.pos.z < 0 ? -0.15 : 0.08,
          speed: SPRINT_SPEED * Math.max(0.88, this.difficulty.moveSpeedMult)
        };
        if (this.pos.z >= 1.0) this.buildVisualTimer = 0.12;
        if (this.pos.z >= 2.1 && this.pos.y >= 1.6) {
          this._enqueueVRampBuildOpening();
        }
      }
    }

    if (this.aiState === 'BUILD_SEQ') {
      steeringCmd = this._stepBuildSequence(dt, playerState, buildingSystem, audio, mapState);
    } else if (this.aiState === 'DEFEND_COVER') {
      steeringCmd = this._stepDefendCover(dt, playerState, buildingSystem, audio, mapState);
    }

    // 10 Hz AI Perception & Tactical Transitions
    this.aiAccum += dt;
    if (this.aiAccum >= AI_TICK_INTERVAL) {
      this.aiAccum %= AI_TICK_INTERVAL;

      const playerTargets = (playerState.alive && !this.cachedPlayerProtected)
        ? this._playerTargets
        : this._emptyTargets;

      raycastArena(
        this.pos.x,
        this.pos.y + PLAYER_EYE_STAND,
        this.pos.z,
        dx / totalDist,
        dy / totalDist,
        dz / totalDist,
        totalDist + 2,
        buildingSystem,
        playerTargets,
        _botHit,
        mapState
      );
      this.hasLOS = _botHit.hit && _botHit.hitType === 'player';
      this.blockedByBuild = _botHit.hit && _botHit.hitType === 'build';
      this.blockedDist = _botHit.dist;

      if (this.aiState === 'SKYBOX_DROP') {
        const pad = mapState?.boostPads?.[0];
        const padX = pad ? (pad.minX + pad.maxX) * 0.5 : 0;
        const padZ = pad ? (pad.minZ + pad.maxZ) * 0.5 : 39.6;
        this.desiredYaw = Math.atan2(-(padX - this.pos.x), -(padZ - this.pos.z));
        this.desiredPitch = -0.15;
        this.moveForwardInput = 1.0;
        this.moveStrafeInput = 0;
        this.cachedWantJump = false;
      } else if (this.aiState === 'COMBAT') {
        this.desiredYaw = Math.atan2(-dx, -dz);
        this.desiredPitch = Math.max(-0.85, Math.min(0.85, Math.atan2(dy, horizDist)));
        this.weaponSlot = horizDist < 8.5 ? 0 : 1;

        // Tactical defensive wall + ramp peek when fired upon
        if (!isFallingFromSky && this.defendTimer > 0 && this.pieceCooldown <= 0) {
          if (this._tryStartDefendCover(playerState, buildingSystem, audio, mapState)) {
            this.defendTimer = 0;
          }
        }

        // High-ground retake or pushing past blocking builds (only retake if opponent is above or blocking at same/lower height)
        const maxHeightMeters = (this.difficulty.maxBuildHeight || 4) * WALL_HEIGHT;
        const playerHigher = playerState.pos.y > this.pos.y + 2.3;
        const blockedAtSameHeight = this.blockedByBuild && this.blockedDist < 6.0 && this.pos.y <= playerState.pos.y + 1.5;
        if (
          this.aiState === 'COMBAT' &&
          !isFallingFromSky &&
          this.grounded &&
          this.buildSeqCooldown <= 0 &&
          this.pos.y < maxHeightMeters &&
          (playerHigher || (blockedAtSameHeight && Math.random() < this.difficulty.rampRate))
        ) {
          if (this._tryStartRetakeSequence(playerState, buildingSystem, audio, mapState)) {
            this.buildSeqCooldown = getBuildSeqCooldown(this.difficulty.id);
          }
        }

        // Natural, non-spastic combat movement
        if (this.aiState === 'COMBAT') {
          if (this.pos.y > playerState.pos.y + 2.2) {
            // Holding high ground: peek steadily without walking off edge
            this.moveForwardInput = this.hasLOS ? 0.08 : 0.42;
            this.moveStrafeInput = this.strafeDir * 0.25;
          } else if (horizDist > 11.5) {
            // Mid/long range: sprint to close distance, pause briefly for clean AR bursts
            if (this.hasLOS && this.pauseShootTimer <= 0 && this.pauseShootCooldown <= 0) {
              this.pauseShootTimer = 0.55;
              this.pauseShootCooldown = 2.0 + Math.random() * 1.4;
            }
            if (this.hasLOS && this.pauseShootTimer > 0) {
              this.moveForwardInput = 0.1;
              this.moveStrafeInput = this.strafeDir * 0.22;
            } else {
              this.moveForwardInput = 0.88;
              this.moveStrafeInput = this.strafeDir * 0.18;
            }
          } else if (!this.hasLOS && this.blockedByBuild && this.blockedDist < 9.5) {
            // Sidestep around cover smoothly instead of jumping into walls
            this.moveForwardInput = 0.35;
            this.moveStrafeInput = this.strafeDir * 0.62;
          } else {
            // Close range shotgun fight: keep natural spacing with controlled strafe
            if (horizDist > 7.2) this.moveForwardInput = 0.65;
            else if (horizDist < 3.6) this.moveForwardInput = -0.32;
            else this.moveForwardInput = 0.18;
            this.moveStrafeInput = this.strafeDir * 0.42;
          }

          // Rare tactical shotgun peek jump ONLY (no bunny-hopping)
          if (
            this.grounded &&
            horizDist < 7.5 &&
            this.weaponSlot === 0 &&
            this.hasLOS &&
            this.fireCooldown < 0.12 &&
            this.jumpCooldown <= 0 &&
            Math.random() < 0.25
          ) {
            this.cachedWantJump = true;
            this.jumpCooldown = 3.5 + Math.random() * 2.5;
          }
        }
      }
    }

    // Compute desired world movement & aim from either structured maneuver or combat steering
    let targetMoveX = 0;
    let targetMoveZ = 0;

    if (steeringCmd) {
      this.desiredYaw = steeringCmd.yaw;
      this.desiredPitch = steeringCmd.pitch;
      const gdx = steeringCmd.goalX - this.pos.x;
      const gdz = steeringCmd.goalZ - this.pos.z;
      const gLen = Math.hypot(gdx, gdz);
      if (gLen > 0.08) {
        const spd = Math.min(steeringCmd.speed, gLen / Math.max(0.016, dt));
        targetMoveX = (gdx / gLen) * spd;
        targetMoveZ = (gdz / gLen) * spd;
      }
    } else {
      const fwdX = -Math.sin(this.yaw);
      const fwdZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);
      const baseSpeed = (this.pos.y > playerState.pos.y + 2.2)
        ? WALK_SPEED * 0.78
        : SPRINT_SPEED * this.difficulty.moveSpeedMult;
      const moveLen = Math.hypot(this.moveForwardInput, this.moveStrafeInput) || 1;
      targetMoveX = ((fwdX * this.moveForwardInput + rightX * this.moveStrafeInput) / moveLen) * baseSpeed;
      targetMoveZ = ((fwdZ * this.moveForwardInput + rightZ * this.moveStrafeInput) / moveLen) * baseSpeed;

      // High-ground platform edge safety guard so bot doesn't accidentally fall off its own tower
      if (this.aiState === 'COMBAT' && this.grounded && this.pos.y > 2.5) {
        const mMag = Math.hypot(targetMoveX, targetMoveZ);
        if (mMag > 0.1) {
          const dirXMove = targetMoveX / mMag;
          const dirZMove = targetMoveZ / mMag;
          const perpXMove = -dirZMove;
          const perpZMove = dirXMove;
          const okCenter = hasSupportNear(this.pos.x + dirXMove * 0.78, this.pos.z + dirZMove * 0.78, this.pos.y, buildingSystem, mapState);
          const okLeft = hasSupportNear(this.pos.x + dirXMove * 0.55 + perpXMove * 0.35, this.pos.z + dirZMove * 0.55 + perpZMove * 0.35, this.pos.y, buildingSystem, mapState);
          const okRight = hasSupportNear(this.pos.x + dirXMove * 0.55 - perpXMove * 0.35, this.pos.z + dirZMove * 0.55 - perpZMove * 0.35, this.pos.y, buildingSystem, mapState);
          if (!okCenter || !okLeft || !okRight) {
            targetMoveX = 0;
            targetMoveZ = 0;
            this.moveVelX *= 0.25;
            this.moveVelZ *= 0.25;
          }
        }
      }
    }

    // Smooth 60+ FPS rotation & movement interpolation
    let yawDiff = this.desiredYaw - this.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    const turnSpeed = (this.aiState === 'BUILD_SEQ' || this.aiState === 'VRAMP_RUN')
      ? 14.0
      : (7.5 + this.difficulty.rampRate * 6);
    this.yaw += Math.max(-turnSpeed * dt, Math.min(turnSpeed * dt, yawDiff));
    this.pitch += (this.desiredPitch - this.pitch) * Math.min(1, dt * 10);

    if (!this.cachedInSkyBox && !isFallingFromSky && this.pos.y >= -0.25) {
      const moveSpeed = SPRINT_SPEED * this.difficulty.moveSpeedMult;
      if (this.pos.x > 36.0 && targetMoveX > 0) targetMoveX = -moveSpeed * 0.65;
      else if (this.pos.x < -36.0 && targetMoveX < 0) targetMoveX = moveSpeed * 0.65;
      if (this.pos.z > 36.0 && targetMoveZ > 0) targetMoveZ = -moveSpeed * 0.65;
      else if (this.pos.z < -36.0 && targetMoveZ < 0) targetMoveZ = moveSpeed * 0.65;
    }

    const velSmooth = Math.min(1, 1 - Math.exp(-15 * dt));
    this.moveVelX += (targetMoveX - this.moveVelX) * velSmooth;
    this.moveVelZ += (targetMoveZ - this.moveVelZ) * velSmooth;

    // Anti-stuck check (jump only if physically blocked while attempting to move)
    if (Math.hypot(targetMoveX, targetMoveZ) > 2.0 && this.grounded && this.aiState === 'COMBAT') {
      this.stuckCheckTimer += dt;
      if (this.stuckCheckTimer >= 0.3) {
        const moved = Math.hypot(this.pos.x - this.lastCheckX, this.pos.z - this.lastCheckZ);
        this.lastCheckX = this.pos.x;
        this.lastCheckZ = this.pos.z;
        this.stuckCheckTimer = 0;
        if (moved < 0.14) {
          this.stuckTimer += 0.3;
          if (this.stuckTimer >= 0.3 && this.jumpCooldown <= 0) {
            this.cachedWantJump = true;
            this.jumpCooldown = 1.6;
            this.stuckTimer = 0;
          }
        } else {
          this.stuckTimer = 0;
        }
      }
    } else {
      this.stuckTimer = 0;
      this.stuckCheckTimer = 0;
      this.lastCheckX = this.pos.x;
      this.lastCheckZ = this.pos.z;
    }

    this.wantJump = this.cachedWantJump;
    this.cachedWantJump = false;

    stepPlayerPhysics(this, this.moveVelX, this.moveVelZ, this.wantJump, false, dt, buildingSystem, mapState);

    const isBuildVisual = (
      this.buildVisualTimer > 0 ||
      this.aiState === 'BUILD_SEQ' ||
      this.aiState === 'DEFEND_COVER'
    );
    this.rig.setWeapon(this.weaponSlot, isBuildVisual);

    const eyeX = this.pos.x;
    const eyeY = this.pos.y + PLAYER_EYE_STAND;
    const eyeZ = this.pos.z;
    const dirX = dx / totalDist;
    const dirY = dy / totalDist;
    const dirZ = dz / totalDist;
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const playerTargets = (playerState.alive && !this.cachedPlayerProtected) ? this._playerTargets : this._emptyTargets;

    // Shooting (active in COMBAT only; never fires mid-opening run or while placing 90s)
    if (
      this.aiState === 'COMBAT' &&
      !this.cachedInSkyBox &&
      !this.cachedPlayerProtected &&
      playerState.alive &&
      this.fireCooldown <= 0
    ) {
      const canShootPlayer = this.hasLOS;
      const shouldBreakBuild = !this.hasLOS && this.blockedByBuild && this.blockedDist < 14;

      if (canShootPlayer || shouldBreakBuild) {
        const w = WEAPONS[this.weaponSlot];
        const jitter = this.difficulty.aimJitter;
        this.rig.setWeapon(this.weaponSlot, false);
        this.rig.root.position.copy(this.pos);
        this.rig.root.rotation.y = this.yaw;
        this.rig.triggerMuzzleFlash(this.weaponSlot);

        let muzzleX = eyeX + rightX * 0.32;
        let muzzleY = eyeY - 0.14;
        let muzzleZ = eyeZ + rightZ * 0.32;
        this.rig.getMuzzleWorldPosition(_botMuzzle, this.weaponSlot);
        if ((_botMuzzle.x - eyeX) ** 2 + (_botMuzzle.y - eyeY) ** 2 + (_botMuzzle.z - eyeZ) ** 2 <= 4.0) {
          muzzleX = _botMuzzle.x;
          muzzleY = _botMuzzle.y;
          muzzleZ = _botMuzzle.z;
        }

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
              if (_botHit.hitType === 'build') {
                const hitB = _botHit.buildKey ? buildingSystem.builds.get(_botHit.buildKey) : null;
                pools.spawnBuildImpact(_botHit.x, _botHit.y, _botHit.z, hitB ? hitB.mat : 'wood', 0.85);
              } else if (_botHit.hitType === 'player') {
                pools.spawnPlayerImpact(_botHit.x, _botHit.y, _botHit.z, playerState.shield > 0, _botHit.isHeadshot);
              } else {
                pools.spawnSparks(_botHit.x, _botHit.y, _botHit.z, 3, 0xfff3b0);
              }
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

    if (this.renderPos.distanceToSquared(this.pos) > 16) {
      this.renderPos.copy(this.pos);
    } else {
      this.renderPos.lerp(this.pos, Math.min(1, 1 - Math.exp(-22 * dt)));
    }
    this.rig.root.position.copy(this.renderPos);
    this.rig.root.rotation.y = this.yaw;
    const hSpeed = Math.hypot(this.moveVelX, this.moveVelZ);
    this.rig.animate(this.time, hSpeed, false, this.pitch, this.swingPhase, isBuildVisual, this.weaponSlot, false, 0, this.grounded);
    this.rig.updateHealthBar(this.hp, this.shield, camPos);
  }

  dispose(scene) {
    scene.remove(this.rig.root);
    this.rig.dispose();
  }
}
