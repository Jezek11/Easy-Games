import * as THREE from 'three';
import {
  BOT_DIFFICULTIES,
  BR_BOT_NAMES,
  BR_HALF_GRID,
  BR_HALF_SIZE,
  BR_PRESETS,
  BUILD_MATERIALS,
  BUILD_TYPES,
  FALL_DEATH_Y,
  JUMP_SPEED,
  PLAYER_EYE_STAND,
  PLAYER_SKINS,
  SPRINT_SPEED,
  WALL_HEIGHT,
  WEAPONS
} from './constants.js';
import { getDefaultMask } from './buildings.js';
import { raycastArena, stepPlayerPhysics } from './physics.js';
import { createCharacterRig } from './playerMesh.js';

const MAX_LOOT_ORBS = 32;

const STORM_PHASES = [
  { wait: 10, shrink: 16, radius: 48, dps: 1.5 },
  { wait: 8, shrink: 15, radius: 27, dps: 3.5 },
  { wait: 7, shrink: 14, radius: 12, dps: 6.5 },
  { wait: 6, shrink: 14, radius: 3.0, dps: 11.0 }
];

const _losHit = {
  hit: false, hitType: null, dist: 100,
  x: 0, y: 0, z: 0, buildKey: null, playerId: null, isHeadshot: false
};
const _shotHit = {
  hit: false, hitType: null, dist: 100,
  x: 0, y: 0, z: 0, buildKey: null, playerId: null, isHeadshot: false
};
const _brMuzzle = new THREE.Vector3();

export class BattleRoyaleController {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.presetKey = 'balanced';
    this.matchTime = 0;
    this.finished = false;
    this.totalFighters = 16;

    // 1. Visual 3D Storm Wall (single draw call cylinder, kept 34m tall to minimize transparent fill overdraw on iGPUs)
    const stormGeo = new THREE.CylinderGeometry(1, 1, 34, 24, 1, true);
    const stormMat = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false
    });
    this.stormMesh = new THREE.Mesh(stormGeo, stormMat);
    this.stormMesh.position.y = 16;
    this.stormMesh.visible = false;
    this.scene.add(this.stormMesh);

    // 2. Pooled 3D Loot Orbs (2 InstancedMesh draw calls total)
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();

    const orbGeo = new THREE.OctahedronGeometry(0.42, 0);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.orbMesh = new THREE.InstancedMesh(orbGeo, orbMat, MAX_LOOT_ORBS);
    this.orbMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.orbMesh.frustumCulled = false;
    this.orbMesh.setColorAt(0, this._color.setHex(0x22d3ee));
    this.orbMesh.count = 0;
    this.orbMesh.visible = false;
    this.scene.add(this.orbMesh);

    const ringGeo = new THREE.RingGeometry(0.45, 0.72, 12);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    this.orbRingMesh = new THREE.InstancedMesh(ringGeo, ringMat, MAX_LOOT_ORBS);
    this.orbRingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.orbRingMesh.frustumCulled = false;
    this.orbRingMesh.setColorAt(0, this._color.setHex(0x22d3ee));
    this.orbRingMesh.count = 0;
    this.orbRingMesh.visible = false;
    this.scene.add(this.orbRingMesh);

    this.orbs = [];
    for (let i = 0; i < MAX_LOOT_ORBS; i++) {
      this.orbs.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        kind: 'chest', // 'chest' (respawns) | 'siphon' (dropped by elimination)
        respawnTimer: 0
      });
    }

    // 3. 15 Free-For-All Bots (created lazily once when BR first launches)
    this.bots = [];
    this.killFeed = [];
    this.scanCursor = 0;
    this.frameTick = 0;
    this._targetsScratch = [];
    this._localTargetRef = { id: 'local', pos: null, crouch: false, alive: true };
    this._botTargetRefs = [];
    this._targetScratch = { id: '', pos: null, crouch: false, alive: true };
    this._hitEntities = new Map();
    this._hitEntryPool = Array.from({ length: 16 }, () => ({ dmg: 0, head: false }));
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
      ownerId: ''
    };
    this._dmgResult = { eliminated: false, hadShield: false };
    this._botStepCtx = {
      localPlayer: null,
      buildingSystem: null,
      mapManager: null,
      pools: null,
      audio: null,
      camPos: null,
      onDamagePlayer: null
    };

    // Storm state
    this.storm = {
      phase: 0,
      state: 'wait', // 'wait' | 'shrink' | 'done'
      timer: 10,
      cx: 0,
      cz: 0,
      radius: 82,
      startCx: 0,
      startCz: 0,
      startRadius: 82,
      nextCx: 0,
      nextCz: 0,
      nextRadius: 48,
      dps: 1.5
    };
    this.playerStormAccum = 0;
  }

  _ensureBots(shadowsEnabled) {
    if (this.bots.length > 0) return;
    const matKeys = Object.keys(BUILD_MATERIALS);
    for (let i = 0; i < BR_BOT_NAMES.length; i++) {
      const skin = PLAYER_SKINS[(i + 1) % PLAYER_SKINS.length];
      const rig = createCharacterRig(skin.id, shadowsEnabled, true, true);
      rig.root.visible = false;
      this.scene.add(rig.root);

      const botObj = {
        id: `br_bot_${i}`,
        idx: i,
        name: BR_BOT_NAMES[i],
        skinId: skin.id,
        buildMat: matKeys[i % matKeys.length],
        difficulty: BOT_DIFFICULTIES.medium,
        pos: new THREE.Vector3(0, 0, 0),
        vel: new THREE.Vector3(0, 0, 0),
        yaw: 0,
        pitch: 0,
        grounded: false,
        gliding: true,
        diving: false,
        jumpSpeed: JUMP_SPEED,
        skyBoostTimer: 0,
        hp: 100,
        shield: 50,
        alive: true,
        kills: 0,
        weaponSlot: 1,
        swingPhase: 0,
        fireCooldown: 0.5,
        buildCooldown: 0.4,
        buildsPlaced: 0,
        strafeDir: i % 2 === 0 ? 1 : -1,
        strafeTimer: 1.0,
        defendTimer: 0,
        wantJump: false,
        scanTimer: (i % 5) * 0.02,
        targetId: null,
        lastAttackerId: null,
        hasLOS: false,
        stormAccum: 0,
        dropGoalX: 0,
        dropGoalZ: 0,
        rig
      };
      this.bots.push(botObj);
      this._botTargetRefs.push({ id: botObj.id, pos: botObj.pos, crouch: false, alive: true });
    }
  }

  setQuality(qualityKey) {
    for (let i = 0; i < this.bots.length; i++) {
      this.bots[i].rig.setQualityTier(qualityKey);
    }
  }

  setShadowsEnabled(enabled) {
    for (let i = 0; i < this.bots.length; i++) {
      this.bots[i].rig.root.traverse((obj) => {
        if (obj.isMesh) obj.castShadow = enabled;
      });
    }
  }

  setActive(isActive) {
    this.active = Boolean(isActive);
    this.stormMesh.visible = this.active;
    this.orbMesh.visible = this.active;
    this.orbRingMesh.visible = this.active;
    if (!this.active) {
      for (let i = 0; i < this.bots.length; i++) {
        this.bots[i].rig.root.visible = false;
        this.bots[i].alive = false;
      }
    }
  }

  startMatch(mapManager, presetKey = 'balanced', shadowsEnabled = false, qualityKey = 'medium') {
    this._ensureBots(shadowsEnabled);
    this.setQuality(qualityKey);
    this.presetKey = BR_PRESETS[presetKey] ? presetKey : 'balanced';
    const preset = BR_PRESETS[this.presetKey];

    this.active = true;
    this.finished = false;
    this.matchTime = 0;
    this.killFeed = [];
    this.playerStormAccum = 0;
    this.stormMesh.visible = true;
    this.orbMesh.visible = true;
    this.orbRingMesh.visible = true;

    // Reset Loot Orbs from mapManager.lootSpawns
    for (let i = 0; i < MAX_LOOT_ORBS; i++) {
      this.orbs[i].active = false;
      this.orbs[i].respawnTimer = 0;
    }
    const lootList = mapManager.lootSpawns || [];
    for (let i = 0; i < lootList.length && i < MAX_LOOT_ORBS - 12; i++) {
      const lp = lootList[i];
      this.orbs[i].active = true;
      this.orbs[i].x = lp.x;
      this.orbs[i].y = lp.y;
      this.orbs[i].z = lp.z;
      this.orbs[i].kind = 'chest';
      this.orbs[i].respawnTimer = 0;
    }

    // Initialize Storm Circle centered cleanly inside island bounds
    const p0 = STORM_PHASES[0];
    const nextAngle = Math.random() * Math.PI * 2;
    const nextOffset = 10 + Math.random() * 14;
    this.storm = {
      phase: 0,
      state: 'wait',
      timer: p0.wait,
      cx: 0,
      cz: 0,
      radius: 82,
      startCx: 0,
      startCz: 0,
      startRadius: 82,
      nextCx: Math.cos(nextAngle) * nextOffset,
      nextCz: Math.sin(nextAngle) * nextOffset,
      nextRadius: p0.radius,
      dps: p0.dps
    };
    this._syncStormVisual();

    // Spawn 15 AI Bots around high-altitude Battle Drop ring
    const n = this.bots.length;
    for (let i = 0; i < n; i++) {
      const b = this.bots[i];
      const tierId = preset.tiers[(i + Math.floor(Math.random() * preset.tiers.length)) % preset.tiers.length];
      b.difficulty = BOT_DIFFICULTIES[tierId] || BOT_DIFFICULTIES.medium;

      const angle = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const dist = 36 + Math.random() * 26;
      const sx = Math.cos(angle) * dist;
      const sz = Math.sin(angle) * dist;

      b.pos.set(sx, 24 + (i % 4) * 2.5, sz);
      b.vel.set(0, -3.5, 0);
      b.yaw = Math.atan2(sx, sz);
      b.pitch = -0.18;
      b.grounded = false;
      b.gliding = true;
      b.diving = false;
      b.skyBoostTimer = 0;
      b.hp = 100;
      b.shield = 50;
      b.alive = true;
      b.kills = 0;
      b.weaponSlot = 1;
      b.swingPhase = 0;
      b.fireCooldown = 1.2 + Math.random() * 0.8;
      b.buildCooldown = 0.4;
      b.buildsPlaced = 0;
      b.defendTimer = 0;
      b.targetId = null;
      b.lastAttackerId = null;
      b.hasLOS = false;
      b.stormAccum = 0;
      b.scanTimer = (i % 4) * 0.05;

      // Pick landing goal near random POI or outer ring
      const pois = mapManager.poiMarkers || [];
      if (pois.length > 0 && Math.random() < 0.72) {
        const poi = pois[(i + ((Math.random() * 3) | 0)) % pois.length];
        b.dropGoalX = poi.x + (Math.random() - 0.5) * 16;
        b.dropGoalZ = poi.z + (Math.random() - 0.5) * 16;
      } else {
        b.dropGoalX = Math.cos(angle) * (20 + Math.random() * 32);
        b.dropGoalZ = Math.sin(angle) * (20 + Math.random() * 32);
      }

      b.rig.root.position.copy(b.pos);
      b.rig.root.rotation.y = b.yaw;
      b.rig.root.visible = true;
      b.rig.setWeapon(1, false);
    }

    // Return local player Air Drop spawn over island center-perimeter looking toward Hub
    const pAngle = Math.random() * Math.PI * 2;
    const pDist = 18;
    const px = Math.cos(pAngle) * pDist;
    const pz = Math.sin(pAngle) * pDist;
    return {
      x: px,
      y: 30,
      z: pz,
      yaw: Math.atan2(px, pz) // Face toward (0,0) center
    };
  }

  _syncStormVisual() {
    this.stormMesh.position.set(this.storm.cx, 16, this.storm.cz);
    this.stormMesh.scale.set(this.storm.radius, 1, this.storm.radius);
  }

  _pushKillFeed(text, isPlayerKill = false) {
    this.killFeed.unshift({ text, isPlayerKill, life: 5.5 });
    if (this.killFeed.length > 4) this.killFeed.length = 4;
  }

  spawnSiphonOrb(x, y, z) {
    for (let i = 0; i < MAX_LOOT_ORBS; i++) {
      if (!this.orbs[i].active && this.orbs[i].kind !== 'chest') {
        const o = this.orbs[i];
        o.active = true;
        o.x = x;
        o.y = Math.max(0, y);
        o.z = z;
        o.kind = 'siphon';
        o.respawnTimer = 0;
        return;
      }
    }
    // Reuse any inactive slot
    for (let i = 0; i < MAX_LOOT_ORBS; i++) {
      if (!this.orbs[i].active && this.orbs[i].respawnTimer <= 0) {
        const o = this.orbs[i];
        o.active = true;
        o.x = x;
        o.y = Math.max(0, y);
        o.z = z;
        o.kind = 'siphon';
        return;
      }
    }
  }

  _tryPickupLoot(entity, isLocalPlayer, pools, audio, onBanner) {
    for (let i = 0; i < MAX_LOOT_ORBS; i++) {
      const o = this.orbs[i];
      if (!o.active) continue;
      if (Math.abs(entity.pos.y - o.y) > 2.2) continue;
      const dx = entity.pos.x - o.x;
      const dz = entity.pos.z - o.z;
      if (dx * dx + dz * dz <= 4.4) {
        const needsHealing = entity.shield < 100 || entity.hp < 100;
        if (!isLocalPlayer && !needsHealing) continue;

        o.active = false;
        o.respawnTimer = o.kind === 'chest' ? 28.0 : 0;

        if (entity.shield < 100) {
          entity.shield = Math.min(100, entity.shield + 45);
        } else {
          entity.hp = Math.min(100, entity.hp + 30);
        }
        if (entity.hp < 100 && o.kind === 'siphon') {
          entity.hp = Math.min(100, entity.hp + 20);
        }

        if (pools) {
          pools.spawnSparks(o.x, o.y + 0.7, o.z, 6, o.kind === 'siphon' ? 0xd9f94e : 0x22d3ee, 4.5);
        }
        if (isLocalPlayer) {
          if (audio) audio.playLootPickup();
          if (onBanner) onBanner('+45 SHIELD & AMMO REFILLED', 'info');
        }
        return true;
      }
    }
    return false;
  }

  getCombatTargets(includeLocalPlayer, localPlayer, excludeId = null, out = null) {
    const arr = out || this._targetsScratch;
    arr.length = 0;
    if (includeLocalPlayer && localPlayer.alive && !localPlayer.gliding && localPlayer.pos.y < 14 && excludeId !== 'local') {
      this._localTargetRef.pos = localPlayer.pos;
      this._localTargetRef.crouch = Boolean(localPlayer.crouch);
      arr.push(this._localTargetRef);
    }
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (!b.alive || b.id === excludeId || b.gliding || b.pos.y >= 14) continue;
      const ref = this._botTargetRefs[i];
      ref.pos = b.pos;
      ref.crouch = Boolean(b.crouch);
      arr.push(ref);
    }
    return arr;
  }

  _findBotById(botId) {
    for (let i = 0; i < this.bots.length; i++) {
      if (this.bots[i].id === botId) return this.bots[i];
    }
    return null;
  }

  getAliveCount(localPlayer) {
    let count = localPlayer.alive ? 1 : 0;
    for (let i = 0; i < this.bots.length; i++) {
      if (this.bots[i].alive) count++;
    }
    return count;
  }

  damageBot(botId, dmg, attackerId, attackerName, buildingSystem, pools, audio, onKill) {
    const victim = this._findBotById(botId);
    if (!victim || !victim.alive) return false;

    const hadShield = victim.shield > 0;
    let rem = dmg;
    if (victim.shield > 0) {
      const abs = Math.min(victim.shield, rem);
      victim.shield -= abs;
      rem -= abs;
    }
    if (rem > 0) {
      victim.hp = Math.max(0, victim.hp - rem);
    }

    victim.lastAttackerId = attackerId;
    if (Math.random() < victim.difficulty.buildChance) {
      victim.defendTimer = 0.65;
    }

    this._dmgResult.hadShield = hadShield;
    if (victim.hp <= 0) {
      victim.alive = false;
      victim.rig.root.visible = false;
      this.spawnSiphonOrb(victim.pos.x, victim.pos.y, victim.pos.z);
      if (pools) {
        pools.spawnSparks(victim.pos.x, victim.pos.y + 1.0, victim.pos.z, 10, 0xf43f5e, 6.5);
      }
      if (onKill) onKill(victim, attackerName);
      this._pushKillFeed(`${attackerName} eliminated ${victim.name}`, attackerId === 'local');
      this._dmgResult.eliminated = true;
      return this._dmgResult;
    }

    this._dmgResult.eliminated = false;
    return this._dmgResult;
  }

  update(dt, time, {
    localPlayer,
    buildingSystem,
    mapManager,
    pools,
    audio,
    camPos,
    onDamagePlayer,
    onBanner,
    onPlayerLooted,
    onMatchEnd
  }) {
    if (!this.active) return;
    this.matchTime += dt;

    // 1. Decay kill feed items
    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      this.killFeed[i].life -= dt;
      if (this.killFeed[i].life <= 0) {
        this.killFeed.splice(i, 1);
      }
    }

    // 2. Update Storm Circle progression
    const st = this.storm;
    if (st.state === 'wait') {
      st.timer -= dt;
      if (st.timer <= 0) {
        st.state = 'shrink';
        const phaseCfg = STORM_PHASES[st.phase] || STORM_PHASES[STORM_PHASES.length - 1];
        st.timer = phaseCfg.shrink;
        st.startCx = st.cx;
        st.startCz = st.cz;
        st.startRadius = st.radius;
        st.dps = phaseCfg.dps;
        if (onBanner) onBanner(`Storm Shrinking (Phase ${st.phase + 1})!`, 'warning');
      }
    } else if (st.state === 'shrink') {
      st.timer -= dt;
      const phaseCfg = STORM_PHASES[st.phase] || STORM_PHASES[STORM_PHASES.length - 1];
      const frac = Math.max(0, Math.min(1, 1 - st.timer / phaseCfg.shrink));
      st.cx = st.startCx + (st.nextCx - st.startCx) * frac;
      st.cz = st.startCz + (st.nextCz - st.startCz) * frac;
      st.radius = st.startRadius + (st.nextRadius - st.startRadius) * frac;
      this._syncStormVisual();

      if (st.timer <= 0) {
        if (st.phase + 1 < STORM_PHASES.length) {
          st.phase += 1;
          st.state = 'wait';
          const nextCfg = STORM_PHASES[st.phase];
          st.timer = nextCfg.wait;
          st.nextRadius = nextCfg.radius;
          const maxShift = Math.max(2, st.radius - nextCfg.radius - 2);
          const ang = Math.random() * Math.PI * 2;
          const dist = Math.random() * maxShift * 0.65;
          st.nextCx = Math.max(-36, Math.min(36, st.cx + Math.cos(ang) * dist));
          st.nextCz = Math.max(-36, Math.min(36, st.cz + Math.sin(ang) * dist));
        } else {
          st.state = 'done';
          st.timer = 0;
        }
      }
    }

    // Apply Storm Damage to Local Player if outside stormRadius
    if (localPlayer.alive && !this.finished) {
      const pDist = Math.hypot(localPlayer.pos.x - st.cx, localPlayer.pos.z - st.cz);
      if (pDist > st.radius) {
        this.playerStormAccum += st.dps * dt;
        if (this.playerStormAccum >= 1.0) {
          const tickDmg = Math.floor(this.playerStormAccum);
          this.playerStormAccum -= tickDmg;
          localPlayer.hp = Math.max(0, localPlayer.hp - tickDmg);
          if (audio) audio.playTakeDamage();
          if (localPlayer.hp <= 0) {
            onDamagePlayer(0, false, 'The Storm', true);
          }
        }
      } else {
        this.playerStormAccum = 0;
      }

      if (this._tryPickupLoot(localPlayer, true, pools, audio, onBanner) && onPlayerLooted) {
        onPlayerLooted();
      }
    }

    // 3. Update & render Pooled Loot Orbs (2 InstancedMesh draw calls)
    let orbCount = 0;
    for (let i = 0; i < MAX_LOOT_ORBS; i++) {
      const o = this.orbs[i];
      if (!o.active) {
        if (o.kind === 'chest' && o.respawnTimer > 0) {
          o.respawnTimer -= dt;
          if (o.respawnTimer <= 0) o.active = true;
        }
        continue;
      }

      const bob = Math.sin(time * 3.2 + i) * 0.14;
      this._dummy.position.set(o.x, o.y + 0.85 + bob, o.z);
      this._dummy.rotation.set(0, time * 2.1 + i, 0.35);
      this._dummy.scale.set(1, 1, 1);
      this._dummy.updateMatrix();
      this.orbMesh.setMatrixAt(orbCount, this._dummy.matrix);
      this.orbMesh.setColorAt(orbCount, this._color.setHex(o.kind === 'siphon' ? 0xd9f94e : 0x22d3ee));

      this._dummy.position.set(o.x, o.y + 0.05, o.z);
      this._dummy.rotation.set(0, -time * 1.6, 0);
      this._dummy.scale.set(1, 1, 1);
      this._dummy.updateMatrix();
      this.orbRingMesh.setMatrixAt(orbCount, this._dummy.matrix);
      this.orbRingMesh.setColorAt(orbCount, this._color.setHex(o.kind === 'siphon' ? 0xd9f94e : 0x22d3ee));
      orbCount++;
    }
    this.orbMesh.count = orbCount;
    this.orbRingMesh.count = orbCount;
    this.orbMesh.visible = orbCount > 0;
    this.orbRingMesh.visible = orbCount > 0;
    if (orbCount > 0) {
      this.orbMesh.instanceMatrix.needsUpdate = true;
      if (this.orbMesh.instanceColor) this.orbMesh.instanceColor.needsUpdate = true;
      this.orbRingMesh.instanceMatrix.needsUpdate = true;
      if (this.orbRingMesh.instanceColor) this.orbRingMesh.instanceColor.needsUpdate = true;
    }

    // 4. Update all 15 Free-For-All Bots (distance LOD & staggered far updates for 60 FPS)
    this.frameTick += 1;
    const stepCtx = this._botStepCtx;
    stepCtx.localPlayer = localPlayer;
    stepCtx.buildingSystem = buildingSystem;
    stepCtx.mapManager = mapManager;
    stepCtx.pools = pools;
    stepCtx.audio = audio;
    stepCtx.camPos = camPos;
    stepCtx.onDamagePlayer = onDamagePlayer;

    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (!b.alive) continue;

      const dSq = camPos
        ? ((b.pos.x - camPos.x) * (b.pos.x - camPos.x) + (b.pos.z - camPos.z) * (b.pos.z - camPos.z))
        : 0;
      const isFar = dSq > 1225; // > 35m away
      if (isFar && ((this.frameTick + i) & 1) !== 0) {
        continue;
      }
      const stepDt = isFar ? Math.min(0.08, dt * 2) : dt;

      this._updateSingleBot(b, stepDt, time, stepCtx);
    }

    // 5. Check Victory Royale condition cleanly
    if (!this.finished && localPlayer.alive && this.getAliveCount(localPlayer) === 1) {
      this.finished = true;
      if (audio) audio.playVictoryRoyale();
      if (onMatchEnd) {
        onMatchEnd({
          victory: true,
          placement: 1,
          total: this.totalFighters,
          kills: localPlayer.kills,
          killerName: null,
          survivalSec: Math.round(this.matchTime)
        });
      }
    }
  }

  _findBotTarget(bot, localPlayer) {
    let bestEntity = null;
    let bestScore = Infinity;

    // Brief 4.5s landing grace for local player so dropping isn't an instant ambush
    if (this.matchTime >= 4.5 && localPlayer.alive && !localPlayer.gliding && localPlayer.pos.y < 14) {
      const d = bot.pos.distanceTo(localPlayer.pos);
      if (d < 46) {
        let score = d;
        if (bot.lastAttackerId === 'local') score -= 12;
        if (score < bestScore) {
          bestScore = score;
          this._targetScratch.id = 'local';
          this._targetScratch.pos = localPlayer.pos;
          this._targetScratch.crouch = Boolean(localPlayer.crouch);
          this._targetScratch.alive = true;
          bestEntity = this._targetScratch;
        }
      }
    }

    for (let j = 0; j < this.bots.length; j++) {
      const other = this.bots[j];
      if (!other.alive || other.id === bot.id || other.gliding || other.pos.y >= 14) continue;
      const d = bot.pos.distanceTo(other.pos);
      if (d < 52) {
        let score = d;
        if (bot.lastAttackerId === other.id) score -= 12;
        if (score < bestScore) {
          bestScore = score;
          bestEntity = this._botTargetRefs[j];
          bestEntity.pos = other.pos;
          bestEntity.crouch = Boolean(other.crouch);
        }
      }
    }

    return bestEntity;
  }

  _findNearestLootOrb(bot) {
    let bestOrb = null;
    let bestDistSq = 18 * 18;
    for (let i = 0; i < MAX_LOOT_ORBS; i++) {
      const o = this.orbs[i];
      if (!o.active) continue;
      const dx = o.x - bot.pos.x;
      const dz = o.z - bot.pos.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestOrb = o;
      }
    }
    return bestOrb;
  }

  _tryBotPlaceBuild(bot, type, buildingSystem, mapManager, audio, camPos) {
    if (bot.buildCooldown > 0 || bot.buildsPlaced >= 12) return false;
    const maxHeight = Math.min(4, bot.difficulty.maxBuildHeight || 3) * WALL_HEIGHT;
    if (type === BUILD_TYPES.RAMP && bot.pos.y >= maxHeight) return false;

    const placement = buildingSystem.computePlacement(bot.pos, bot.yaw, bot.pitch, type, BR_HALF_GRID, this._placementScratch);
    if (!buildingSystem.canPlaceBuild(placement, mapManager)) return false;

    const matInfo = BUILD_MATERIALS[bot.buildMat] || BUILD_MATERIALS.wood;
    const bd = this._buildDataScratch;
    bd.id = placement.key;
    bd.key = placement.key;
    bd.type = placement.type;
    bd.gx = placement.gx;
    bd.gy = placement.gy;
    bd.gz = placement.gz;
    bd.dir = placement.dir;
    bd.rot = placement.rot;
    bd.mat = bot.buildMat;
    bd.hp = matInfo.hp;
    bd.maxHp = matInfo.hp;
    bd.mask = getDefaultMask(type);
    bd.ownerId = bot.id;
    const placed = buildingSystem.placeBuild(bd);

    if (placed) {
      bot.buildsPlaced += 1;
      bot.buildCooldown = Math.max(0.45, bot.difficulty.buildCooldown || 0.7);
      if (audio && camPos && bot.pos.distanceTo(camPos) < 42) {
        audio.playBuildPlace(bot.buildMat);
      }
      return true;
    }
    return false;
  }

  _updateSingleBot(b, dt, time, { localPlayer, buildingSystem, mapManager, pools, audio, camPos, onDamagePlayer }) {
    if (b.fireCooldown > 0) b.fireCooldown -= dt;
    if (b.buildCooldown > 0) b.buildCooldown -= dt;
    if (b.defendTimer > 0) b.defendTimer -= dt;
    if (b.swingPhase > 0) b.swingPhase = Math.max(0, b.swingPhase - dt * 3.5);

    b.strafeTimer -= dt;
    if (b.strafeTimer <= 0) {
      b.strafeTimer = 0.8 + Math.random() * 1.4;
      b.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }

    // 1. Air Drop Glider Steering
    if (b.gliding) {
      const dxDrop = b.dropGoalX - b.pos.x;
      const dzDrop = b.dropGoalZ - b.pos.z;
      const distDrop = Math.hypot(dxDrop, dzDrop) || 1;
      b.yaw = Math.atan2(-dxDrop, -dzDrop);
      b.pitch = -0.22;
      b.diving = b.pos.y > 10 && distDrop < 18;

      const glideSpeed = 12.0;
      const mx = distDrop > 2 ? (dxDrop / distDrop) * glideSpeed : 0;
      const mz = distDrop > 2 ? (dzDrop / distDrop) * glideSpeed : 0;
      stepPlayerPhysics(b, mx, mz, false, false, dt, buildingSystem, mapManager);

      b.rig.root.position.copy(b.pos);
      b.rig.root.rotation.y = b.yaw;
      b.rig.animate(time, glideSpeed, false, b.pitch, 0, false, b.weaponSlot);
      b.rig.updateHealthBar(b.hp, b.shield, camPos, 1156);
      return;
    }

    // 2. Staggered 10 Hz Target & LOS Scan (at most 2-3 bots scan per frame)
    b.scanTimer -= dt;
    let target = null;
    if (b.scanTimer <= 0) {
      b.scanTimer = 0.1 + Math.random() * 0.03;
      target = this._findBotTarget(b, localPlayer);
      b.targetId = target ? target.id : null;

      if (target) {
        const dx = target.pos.x - b.pos.x;
        const dy = (target.pos.y + 1.1) - (b.pos.y + PLAYER_EYE_STAND);
        const dz = target.pos.z - b.pos.z;
        const tLen = Math.hypot(dx, dy, dz) || 0.01;
        const allTargets = this.getCombatTargets(true, localPlayer, b.id, this._targetsScratch);
        raycastArena(
          b.pos.x, b.pos.y + PLAYER_EYE_STAND, b.pos.z,
          dx / tLen, dy / tLen, dz / tLen,
          Math.min(54, tLen + 2),
          buildingSystem,
          allTargets,
          _losHit,
          mapManager
        );
        b.hasLOS = _losHit.hit && _losHit.hitType === 'player' && _losHit.playerId === target.id;
      } else {
        b.hasLOS = false;
      }
    } else if (b.targetId) {
      if (b.targetId === 'local' && localPlayer.alive) {
        this._targetScratch.id = 'local';
        this._targetScratch.pos = localPlayer.pos;
        this._targetScratch.crouch = Boolean(localPlayer.crouch);
        this._targetScratch.alive = true;
        target = this._targetScratch;
      } else {
        const tb = this._findBotById(b.targetId);
        if (tb && tb.alive) target = tb;
      }
    }

    // 3. Storm awareness & Movement Steering
    const distFromSafe = Math.hypot(b.pos.x - this.storm.nextCx, b.pos.z - this.storm.nextCz);
    const inStorm = Math.hypot(b.pos.x - this.storm.cx, b.pos.z - this.storm.cz) > this.storm.radius * 0.92;
    const mustRotate = inStorm || distFromSafe > Math.max(8, this.storm.nextRadius * 0.95);

    let desiredYaw = b.yaw;
    let desiredPitch = 0;
    let forwardInput = 0.7;
    let strafeInput = 0;
    let horizDist = 99;

    if (target && !inStorm) {
      const dx = target.pos.x - b.pos.x;
      const dy = (target.pos.y + 1.1) - (b.pos.y + PLAYER_EYE_STAND);
      const dz = target.pos.z - b.pos.z;
      horizDist = Math.hypot(dx, dz) || 0.01;
      desiredYaw = Math.atan2(-dx, -dz);
      desiredPitch = Math.max(-0.85, Math.min(0.85, Math.atan2(dy, horizDist)));

      b.weaponSlot = horizDist < 9.5 ? 0 : 1;
      b.rig.setWeapon(b.weaponSlot, b.defendTimer > 0);

      if (horizDist > 16) forwardInput = 0.95;
      else if (horizDist < 5.0) forwardInput = -0.45;
      else forwardInput = 0.25;
      strafeInput = b.strafeDir * 0.72;
    } else {
      // Rotate inward toward Safe Zone or nearby Loot Orb
      let goalX = this.storm.nextCx + (Math.sin(b.idx * 1.7 + time * 0.15) * Math.min(18, this.storm.nextRadius * 0.45));
      let goalZ = this.storm.nextCz + (Math.cos(b.idx * 2.3 + time * 0.15) * Math.min(18, this.storm.nextRadius * 0.45));
      if (!mustRotate && (b.shield < 85 || b.hp < 90)) {
        const orb = this._findNearestLootOrb(b);
        if (orb) {
          goalX = orb.x;
          goalZ = orb.z;
        }
      }
      const gdx = goalX - b.pos.x;
      const gdz = goalZ - b.pos.z;
      desiredYaw = Math.atan2(-gdx, -gdz);
      desiredPitch = 0;
      forwardInput = 0.9;
      strafeInput = 0;
      b.weaponSlot = 1;
      b.rig.setWeapon(1, false);
    }

    let yawDiff = desiredYaw - b.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    const turnSpeed = 7.0 + b.difficulty.rampRate * 5.0;
    b.yaw += Math.max(-turnSpeed * dt, Math.min(turnSpeed * dt, yawDiff));
    b.pitch += (desiredPitch - b.pitch) * Math.min(1, dt * 8);

    // 4. Defensive Wall / Occasional Ramp when under fire
    if (b.defendTimer > 0 && b.buildCooldown <= 0) {
      const savedP = b.pitch;
      b.pitch = 0.05;
      if (this._tryBotPlaceBuild(b, BUILD_TYPES.WALL, buildingSystem, mapManager, audio, camPos)) {
        b.defendTimer = 0;
        if (Math.random() < b.difficulty.rampRate * 0.65) {
          b.pitch = 0.14;
          this._tryBotPlaceBuild(b, BUILD_TYPES.RAMP, buildingSystem, mapManager, audio, camPos);
        }
      }
      b.pitch = savedP;
    }

    // 5. Move + Keep Safely Inside Island Perimeter (don't blindly walk off ocean edges)
    const fwdX = -Math.sin(b.yaw);
    const fwdZ = -Math.cos(b.yaw);
    const rightX = Math.cos(b.yaw);
    const rightZ = -Math.sin(b.yaw);
    const moveSpeed = SPRINT_SPEED * (b.difficulty.moveSpeedMult || 0.85);
    const mLen = Math.hypot(forwardInput, strafeInput) || 1;
    let moveX = ((fwdX * forwardInput + rightX * strafeInput) / mLen) * moveSpeed;
    let moveZ = ((fwdZ * forwardInput + rightZ * strafeInput) / mLen) * moveSpeed;

    const edgeSafe = BR_HALF_SIZE - 4.0;
    if (b.pos.x > edgeSafe && moveX > 0) moveX = -moveSpeed * 0.7;
    else if (b.pos.x < -edgeSafe && moveX < 0) moveX = moveSpeed * 0.7;
    if (b.pos.z > edgeSafe && moveZ > 0) moveZ = -moveSpeed * 0.7;
    else if (b.pos.z < -edgeSafe && moveZ < 0) moveZ = moveSpeed * 0.7;

    b.wantJump = b.grounded && Math.random() < 0.015;
    stepPlayerPhysics(b, moveX, moveZ, b.wantJump, false, dt, buildingSystem, mapManager);

    // Pickup loot orbs + check Storm / Ocean hazards
    this._tryPickupLoot(b, false, pools, audio, null);

    if (b.pos.y <= FALL_DEATH_Y) {
      b.alive = false;
      b.hp = 0;
      b.rig.root.visible = false;
      this._pushKillFeed(`${b.name} fell into the ocean`);
      return;
    }

    const stormDist = Math.hypot(b.pos.x - this.storm.cx, b.pos.z - this.storm.cz);
    if (stormDist > this.storm.radius) {
      b.stormAccum += this.storm.dps * dt;
      if (b.stormAccum >= 1.0) {
        const sDmg = Math.floor(b.stormAccum);
        b.stormAccum -= sDmg;
        b.hp -= sDmg;
        if (b.hp <= 0) {
          b.hp = 0;
          b.alive = false;
          b.rig.root.visible = false;
          this.spawnSiphonOrb(b.pos.x, b.pos.y, b.pos.z);
          this._pushKillFeed(`${b.name} eliminated by Storm`);
          return;
        }
      }
    } else {
      b.stormAccum = 0;
    }

    // 6. Combat Shooting against target (another Bot OR Local Player!)
    if (target && b.hasLOS && b.fireCooldown <= 0 && !mustRotate) {
      const w = WEAPONS[b.weaponSlot];
      const jitter = b.difficulty.aimJitter * 1.15;
      const eyeX = b.pos.x;
      const eyeY = b.pos.y + PLAYER_EYE_STAND;
      const eyeZ = b.pos.z;

      const tdx = target.pos.x - eyeX;
      const tdy = (target.pos.y + 1.1) - eyeY;
      const tdz = target.pos.z - eyeZ;
      const tLen = Math.hypot(tdx, tdy, tdz) || 1;
      const baseDx = tdx / tLen;
      const baseDy = tdy / tLen;
      const baseDz = tdz / tLen;

      let muzzleX = eyeX + rightX * 0.32;
      let muzzleY = eyeY - 0.14;
      let muzzleZ = eyeZ + rightZ * 0.32;
      const nearCam = camPos ? b.pos.distanceTo(camPos) : 99;
      const showFx = nearCam < 62;
      if (showFx) {
        b.rig.setWeapon(b.weaponSlot, false);
        b.rig.root.position.copy(b.pos);
        b.rig.root.rotation.y = b.yaw;
        b.rig.triggerMuzzleFlash(b.weaponSlot);
        b.rig.getMuzzleWorldPosition(_brMuzzle, b.weaponSlot);
        if ((_brMuzzle.x - eyeX) ** 2 + (_brMuzzle.y - eyeY) ** 2 + (_brMuzzle.z - eyeZ) ** 2 <= 4.0) {
          muzzleX = _brMuzzle.x;
          muzzleY = _brMuzzle.y;
          muzzleZ = _brMuzzle.z;
        }
      }

      const allTargets = this.getCombatTargets(true, localPlayer, b.id, this._targetsScratch);
      const hitEntities = this._hitEntities;
      hitEntities.clear();
      let hitPoolIdx = 0;

      for (let p = 0; p < w.pellets; p++) {
        let sdx = baseDx + (Math.random() - 0.5) * (w.spread + jitter) * 2;
        let sdy = baseDy + (Math.random() - 0.5) * (w.spread + jitter) * 2;
        let sdz = baseDz + (Math.random() - 0.5) * (w.spread + jitter) * 2;
        const slen = Math.hypot(sdx, sdy, sdz) || 1;
        sdx /= slen;
        sdy /= slen;
        sdz /= slen;

        raycastArena(eyeX, eyeY, eyeZ, sdx, sdy, sdz, w.range, buildingSystem, allTargets, _shotHit, mapManager);

        if (showFx && pools) {
          pools.spawnTracer(muzzleX, muzzleY, muzzleZ, _shotHit.x, _shotHit.y, _shotHit.z, w.tracerColor);
          if (_shotHit.hit) {
            if (_shotHit.hitType === 'build') {
              const hitB = _shotHit.buildKey ? buildingSystem.builds.get(_shotHit.buildKey) : null;
              pools.spawnBuildImpact(_shotHit.x, _shotHit.y, _shotHit.z, hitB ? hitB.mat : 'wood', 0.75);
            } else if (_shotHit.hitType === 'player') {
              const hitBot = _shotHit.playerId === 'local' ? null : this._findBotById(_shotHit.playerId);
              const hadShield = _shotHit.playerId === 'local'
                ? localPlayer.shield > 0
                : (hitBot ? hitBot.shield > 0 : false);
              pools.spawnPlayerImpact(_shotHit.x, _shotHit.y, _shotHit.z, hadShield, _shotHit.isHeadshot);
            } else {
              pools.spawnSparks(_shotHit.x, _shotHit.y, _shotHit.z, 2, 0xfff3b0);
            }
          }
        }

        if (_shotHit.hit && _shotHit.hitType === 'player' && _shotHit.playerId) {
          let dmg = w.damage * 0.85; // Balanced TTK in multi-bot skirmishes
          if (_shotHit.dist > w.falloffStart) {
            const ft = Math.min(1, (_shotHit.dist - w.falloffStart) / Math.max(1, w.range - w.falloffStart));
            dmg *= (1 - 0.45 * ft);
          }
          if (_shotHit.isHeadshot) dmg *= w.headshotMult;
          let prev = hitEntities.get(_shotHit.playerId);
          if (!prev) {
            prev = this._hitEntryPool[hitPoolIdx < this._hitEntryPool.length ? hitPoolIdx++ : 0];
            prev.dmg = 0;
            prev.head = false;
            hitEntities.set(_shotHit.playerId, prev);
          }
          prev.dmg += dmg;
          prev.head = prev.head || _shotHit.isHeadshot;
        } else if (_shotHit.hit && _shotHit.hitType === 'build' && _shotHit.buildKey) {
          const res = buildingSystem.damageBuild(_shotHit.buildKey, Math.round(w.buildDamage / w.pellets));
          if (res.destroyed && showFx && audio) audio.playBuildBreak();
        }
      }

      if (showFx && audio) {
        const atten = Math.max(0.08, 1 - nearCam / 58);
        if (w.id === 'shotgun') audio.playShotgun(atten * 0.75);
        else audio.playAR(atten * 0.7);
      }

      for (const [tid, info] of hitEntities.entries()) {
        const roundedDmg = Math.max(1, Math.round(info.dmg));
        if (tid === 'local') {
          if (onDamagePlayer) onDamagePlayer(roundedDmg, info.head, b.name, false);
        } else {
          const res = this.damageBot(tid, roundedDmg, b.id, b.name, buildingSystem, pools, audio, null);
          if (res && res.eliminated) {
            b.kills += 1;
            b.shield = Math.min(100, b.shield + 25);
            if (showFx && audio) audio.playEliminate();
          }
        }
      }

      b.swingPhase = 1.0;
      b.fireCooldown = (w.cooldown / b.difficulty.fireRateMult) * 1.15 + Math.random() * b.difficulty.reactionSec * 0.5;
    }

    b.rig.root.position.copy(b.pos);
    b.rig.root.rotation.y = b.yaw;
    const hSpeed = Math.hypot(moveX, moveZ);
    b.rig.animate(time, hSpeed, false, b.pitch, b.swingPhase, false, b.weaponSlot, false, 0, b.grounded);
    b.rig.updateHealthBar(b.hp, b.shield, camPos, 1156);
  }

  dispose() {
    this.setActive(false);
    this.scene.remove(this.stormMesh);
    this.stormMesh.geometry.dispose();
    this.stormMesh.material.dispose();
    this.scene.remove(this.orbMesh);
    this.orbMesh.geometry.dispose();
    this.orbMesh.material.dispose();
    this.scene.remove(this.orbRingMesh);
    this.orbRingMesh.geometry.dispose();
    this.orbRingMesh.material.dispose();
    for (let i = 0; i < this.bots.length; i++) {
      this.scene.remove(this.bots[i].rig.root);
      this.bots[i].rig.dispose();
    }
    this.bots.length = 0;
    this._botTargetRefs.length = 0;
  }
}
