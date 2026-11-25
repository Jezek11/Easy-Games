import * as THREE from 'three';
import {
  CS2_BOT_PROFILES,
  CS2_ECONOMY,
  CS2_MOVE,
  CS2_SOURCE_SCALE,
  CS2_WEAPONS
} from './constants.js';

const AI_TICK_SEC = 0.1; // 10 Hz AI decision rate

function bfsPath(waypoints, startId, goalId) {
  if (!startId || !goalId || startId === goalId) return goalId ? [goalId] : [];
  const wpMap = new Map(waypoints.map((w) => [w.id, w]));
  if (!wpMap.has(startId) || !wpMap.has(goalId)) return [];

  const queue = [startId];
  const parent = new Map([[startId, null]]);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === goalId) {
      const path = [];
      let p = goalId;
      while (p !== null) {
        path.push(p);
        p = parent.get(p);
      }
      path.reverse();
      return path;
    }
    const node = wpMap.get(cur);
    if (!node) continue;
    for (const nextId of node.links) {
      if (!wpMap.has(nextId) || parent.has(nextId)) continue;
      parent.set(nextId, cur);
      queue.push(nextId);
    }
  }
  return [goalId];
}

function findNearestWaypoint(waypoints, x, y, z) {
  let best = waypoints[0] || null;
  let bestD = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const w = waypoints[i];
    const dy = (w.y - y) * 1.8;
    const d = (w.x - x) ** 2 + dy * dy + (w.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

export class CS2BotManager {
  constructor() {
    this._aiAccum = 0;
    this._raycaster = new THREE.Raycaster();
    this._vOrigin = new THREE.Vector3();
    this._vTarget = new THREE.Vector3();
    this._vDir = new THREE.Vector3();
  }

  buyForBot(bot, modeId) {
    if (modeId === 'training') {
      bot.weaponId = bot.team === 't' ? 'ak47' : 'm4a1';
      bot.primaryId = bot.weaponId;
      bot.secondaryId = 'pistol';
      bot.armor = 100;
      bot.hasHelmet = true;
      return;
    }

    // Buy primary rifle or sniper if affordable
    const primaryChoice = bot.team === 't'
      ? (Math.random() < 0.16 && bot.money >= 5750 ? 'awp' : 'ak47')
      : (Math.random() < 0.16 && bot.money >= 6150 ? 'awp' : 'm4a1');
    const pDef = CS2_WEAPONS[primaryChoice];

    if (!bot.primaryId && bot.money >= pDef.price) {
      bot.money -= pDef.price;
      bot.primaryId = primaryChoice;
      bot.weaponId = primaryChoice;
    } else if (!bot.primaryId && bot.money >= 700 && bot.secondaryId !== 'deagle' && Math.random() < 0.55) {
      bot.money -= CS2_WEAPONS.deagle.price;
      bot.secondaryId = 'deagle';
      bot.weaponId = 'deagle';
    }

    // Armor + Helmet
    if (!bot.hasHelmet && bot.money >= CS2_ECONOMY.HELMET_PRICE) {
      bot.money -= CS2_ECONOMY.HELMET_PRICE;
      bot.armor = 100;
      bot.hasHelmet = true;
    } else if (bot.armor < 60 && bot.money >= CS2_ECONOMY.KEVLAR_PRICE) {
      bot.money -= CS2_ECONOMY.KEVLAR_PRICE;
      bot.armor = 100;
    }

    bot.weaponId = bot.primaryId || bot.secondaryId || 'pistol';
    const activeDef = CS2_WEAPONS[bot.weaponId] || CS2_WEAPONS.pistol;
    bot.mag = Number.isFinite(activeDef.magSize) ? activeDef.magSize : 30;
    bot.reserve = activeDef.reserveAmmo || 60;
  }

  assignRoundPlans(bots, modeId) {
    const tSite = modeId === 'wingman' ? 'A' : (Math.random() < 0.55 ? 'A' : 'B');
    const ctHoldPool = modeId === 'wingman'
      ? ['a_site_center', 'a_plat_edge', 'ct_mid_win', 'a_ct_arch']
      : ['a_site_center', 'a_plat_edge', 'ct_mid_win', 'b_site_center', 'b_site_east'];

    let ctIdx = 0;
    for (const bot of bots) {
      bot.ai = {
        goalWpId: null,
        path: [],
        pathIdx: 0,
        targetEntityId: null,
        seenTime: 0,
        burstLeft: 0,
        burstPauseTimer: 0,
        strafeSign: Math.random() < 0.5 ? -1 : 1,
        strafeTimer: 0,
        holdTimer: 0,
        stuckTimer: 0,
        lastCheckX: bot.x,
        lastCheckZ: bot.z,
        tSite,
        ctPost: ctHoldPool[ctIdx % ctHoldPool.length],
        planting: false,
        defusing: false,
        plantProgress: 0,
        defuseProgress: 0
      };
      if (bot.team === 'ct') ctIdx++;
    }
  }

  _hasLineOfSight(ax, ay, az, bx, by, bz, wallMeshes) {
    this._vOrigin.set(ax, ay, az);
    this._vTarget.set(bx, by, bz);
    this._vDir.subVectors(this._vTarget, this._vOrigin);
    const dist = this._vDir.length();
    if (dist < 0.05 || dist > 95) return false;
    this._vDir.multiplyScalar(1 / dist);

    this._raycaster.set(this._vOrigin, this._vDir);
    this._raycaster.near = 0.1;
    this._raycaster.far = dist - 0.12;
    const hits = this._raycaster.intersectObjects(wallMeshes, false);
    return hits.length === 0;
  }

  _pickGoalWaypoint(bot, roundState, bombState, modeId, waypoints) {
    const ai = bot.ai;
    if (modeId === 'training') {
      // Practice bots hold strategic spots around Mid / A / B
      if (!ai.goalWpId || ai.holdTimer <= 0) {
        const idx = Math.floor(Math.random() * waypoints.length);
        ai.goalWpId = waypoints[idx].id;
        ai.holdTimer = 7 + Math.random() * 6;
        const cur = findNearestWaypoint(waypoints, bot.x, bot.y, bot.z);
        ai.path = bfsPath(waypoints, cur?.id, ai.goalWpId);
        ai.pathIdx = 0;
      }
      return;
    }

    let desiredWp = ai.ctPost;
    if (bot.team === 't') {
      if (bombState.planted) {
        const postCovers = bombState.site === 'B'
          ? ['b_site_center', 'b_site_east', 'b_apps_top']
          : ['a_site_center', 'a_plat_edge', 'a_site_entry'];
        desiredWp = postCovers[bot.slotIndex % postCovers.length];
      } else {
        const siteWps = ai.tSite === 'B'
          ? (bot.hasBomb ? ['b_site_center'] : ['b_site_center', 'b_site_east', 'b_alley_mid'])
          : (bot.hasBomb ? ['a_site_center'] : ['a_site_center', 'a_plat_edge', 'a_conn']);
        desiredWp = siteWps[bot.slotIndex % siteWps.length];
      }
    } else {
      if (bombState.planted) {
        desiredWp = bombState.site === 'B' ? 'b_site_center' : 'a_site_center';
      } else {
        desiredWp = ai.ctPost;
      }
    }

    if (desiredWp !== ai.goalWpId || ai.path.length === 0) {
      ai.goalWpId = desiredWp;
      const cur = findNearestWaypoint(waypoints, bot.x, bot.y, bot.z);
      ai.path = bfsPath(waypoints, cur?.id, desiredWp);
      ai.pathIdx = 0;
    }
  }

  _resolveBotCollision(bot, dx, dz, colliders) {
    const r = CS2_MOVE.PLAYER_RADIUS;
    const h = bot.crouch ? CS2_MOVE.CROUCH_HEIGHT : CS2_MOVE.STAND_HEIGHT;

    const testOverlap = (tx, ty, tz) => {
      const minX = tx - r;
      const maxX = tx + r;
      const minZ = tz - r;
      const maxZ = tz + r;
      const minY = ty + 0.05;
      const maxY = ty + h - 0.02;
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i];
        if (maxX > b.minX && minX < b.maxX && maxZ > b.minZ && minZ < b.maxZ && maxY > b.minY && minY < b.maxY) {
          return b;
        }
      }
      return null;
    };

    const nx = bot.x + dx;
    const hitX = testOverlap(nx, bot.y, bot.z);
    if (hitX) {
      if (hitX.maxY > bot.y && hitX.maxY - bot.y <= CS2_MOVE.STEP_HEIGHT && !testOverlap(nx, hitX.maxY, bot.z)) {
        bot.y = hitX.maxY;
        bot.x = nx;
      }
    } else {
      bot.x = nx;
    }

    const nz = bot.z + dz;
    const hitZ = testOverlap(bot.x, bot.y, nz);
    if (hitZ) {
      if (hitZ.maxY > bot.y && hitZ.maxY - bot.y <= CS2_MOVE.STEP_HEIGHT && !testOverlap(bot.x, hitZ.maxY, nz)) {
        bot.y = hitZ.maxY;
        bot.z = nz;
      }
    } else {
      bot.z = nz;
    }

    // Floor support under bot
    let supportY = 0;
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (bot.x + r > b.minX && bot.x - r < b.maxX && bot.z + r > b.minZ && bot.z - r < b.maxZ) {
        if (b.maxY <= bot.y + 0.12 && b.maxY > supportY) {
          supportY = b.maxY;
        }
      }
    }
    if (bot.y > supportY) {
      bot.y = Math.max(supportY, bot.y - 0.12);
    } else {
      bot.y = supportY;
    }
  }

  update(dt, {
    bots,
    allEntities,
    map,
    modeId,
    difficultyId,
    roundState,
    bombState,
    wallMeshes,
    colliders,
    onBotShoot,
    onBotBombProgress,
    onBotPlanted,
    onBotDefused
  }) {
    if (!bots || bots.length === 0) return;

    const frozen = roundState.phase === 'FREEZE' || roundState.phase === 'MATCH_END';
    const profile = CS2_BOT_PROFILES[difficultyId] || CS2_BOT_PROFILES.medium;
    const waypoints = map.getWaypoints(modeId);

    this._aiAccum += dt;
    const runAiTick = this._aiAccum >= AI_TICK_SEC;
    if (runAiTick) {
      this._aiAccum %= AI_TICK_SEC;
    }

    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      if (!bot.alive) continue;
      const ai = bot.ai;
      if (!ai) continue;

      if (bot.cooldown > 0) bot.cooldown = Math.max(0, bot.cooldown - dt);
      if (bot.reloading) {
        bot.reloadTimer -= dt;
        if (bot.reloadTimer <= 0) {
          const def = CS2_WEAPONS[bot.weaponId] || CS2_WEAPONS.pistol;
          bot.mag = Number.isFinite(def.magSize) ? def.magSize : 30;
          bot.reloading = false;
        }
      }

      if (frozen) {
        bot.rig?.update(dt, 0, bot.pitch);
        continue;
      }

      // 1. 10 Hz AI decision tick: visibility, pathfinding, plant/defuse triggers
      if (runAiTick) {
        ai.holdTimer = Math.max(0, ai.holdTimer - AI_TICK_SEC);
        ai.burstPauseTimer = Math.max(0, ai.burstPauseTimer - AI_TICK_SEC);
        ai.strafeTimer -= AI_TICK_SEC;
        if (ai.strafeTimer <= 0) {
          ai.strafeSign = -ai.strafeSign;
          ai.strafeTimer = 0.6 + Math.random() * 0.9;
        }

        // Find closest visible enemy
        let bestEnemy = null;
        let bestDist = Infinity;
        const eyeY = bot.y + (bot.crouch ? CS2_MOVE.EYE_CROUCH : CS2_MOVE.EYE_STAND);
        for (let j = 0; j < allEntities.length; j++) {
          const other = allEntities[j];
          if (!other.alive || other.team === bot.team) continue;
          const distSq = (other.x - bot.x) ** 2 + (other.z - bot.z) ** 2;
          if (distSq > bestDist) continue;
          const targetEyeY = other.y + (other.crouch ? 1.05 : 1.48);
          if (this._hasLineOfSight(bot.x, eyeY, bot.z, other.x, targetEyeY, other.z, wallMeshes)) {
            bestDist = distSq;
            bestEnemy = other;
          }
        }

        if (bestEnemy) {
          if (ai.targetEntityId !== bestEnemy.id) {
            ai.targetEntityId = bestEnemy.id;
            ai.seenTime = 0;
          } else {
            ai.seenTime += AI_TICK_SEC;
          }
        } else {
          ai.targetEntityId = null;
          ai.seenTime = 0;
          ai.burstLeft = 0;
        }

        this._pickGoalWaypoint(bot, roundState, bombState, modeId, waypoints);

        // Anti-stuck check
        ai.stuckTimer += AI_TICK_SEC;
        if (ai.stuckTimer >= 1.2) {
          const moved = Math.hypot(bot.x - ai.lastCheckX, bot.z - ai.lastCheckZ);
          ai.lastCheckX = bot.x;
          ai.lastCheckZ = bot.z;
          ai.stuckTimer = 0;
          if (moved < 0.35 && !ai.targetEntityId && !ai.planting && !ai.defusing) {
            const nearest = findNearestWaypoint(waypoints, bot.x, bot.y, bot.z);
            if (nearest && ai.goalWpId) {
              ai.path = bfsPath(waypoints, nearest.id, ai.goalWpId);
              ai.pathIdx = ai.path.length > 1 ? 1 : 0;
            }
          }
        }
      }

      // 2. Plant / Defuse Objective Execution
      ai.planting = false;
      ai.defusing = false;
      if (modeId !== 'training' && roundState.phase === 'LIVE' && bot.team === 't' && bot.hasBomb && !bombState.planted && !ai.targetEntityId) {
        const zones = map.getPlantZones(modeId);
        for (const z of zones) {
          if (bot.x >= z.minX && bot.x <= z.maxX && bot.z >= z.minZ && bot.z <= z.maxZ) {
            ai.planting = true;
            bot.crouch = true;
            ai.plantProgress += dt;
            if (onBotBombProgress) onBotBombProgress(bot, 'plant', ai.plantProgress);
            if (ai.plantProgress >= (modeId === 'wingman' ? 3.2 : 3.2)) {
              ai.planting = false;
              ai.plantProgress = 0;
              bot.crouch = false;
              onBotPlanted?.(bot, z.site, bot.x, bot.y, bot.z);
            }
            break;
          }
        }
        if (!ai.planting) ai.plantProgress = 0;
      } else if (modeId !== 'training' && roundState.phase === 'BOMB_PLANTED' && bot.team === 'ct' && !ai.targetEntityId) {
        const distToBomb = Math.hypot(bot.x - bombState.x, bot.z - bombState.z);
        if (distToBomb <= 2.35 && Math.abs(bot.y - bombState.y) < 1.5) {
          ai.defusing = true;
          bot.crouch = true;
          ai.defuseProgress += dt;
          if (onBotBombProgress) onBotBombProgress(bot, 'defuse', ai.defuseProgress);
          if (ai.defuseProgress >= 5.0) {
            ai.defusing = false;
            ai.defuseProgress = 0;
            bot.crouch = false;
            onBotDefused?.(bot);
          }
        } else {
          ai.defuseProgress = 0;
        }
      }

      // 3. Smooth Frame Movement & Combat
      const targetEnemy = ai.targetEntityId
        ? allEntities.find((e) => e.id === ai.targetEntityId && e.alive)
        : null;

      let moveSpeedMps = 0;
      const wDef = CS2_WEAPONS[bot.weaponId] || CS2_WEAPONS.pistol;
      const maxMps = (wDef.moveSpeedU / CS2_SOURCE_SCALE) * profile.speedMult;

      if (ai.planting || ai.defusing) {
        // Hold still while planting or defusing
        moveSpeedMps = 0;
      } else if (targetEnemy) {
        // Face target smoothly
        const tx = targetEnemy.x - bot.x;
        const tz = targetEnemy.z - bot.z;
        const dist = Math.max(0.01, Math.hypot(tx, tz));
        const desiredYaw = Math.atan2(-tx, -tz);
        const eyeY = bot.y + CS2_MOVE.EYE_STAND;
        const aimY = targetEnemy.y + (targetEnemy.crouch ? 1.02 : 1.44);
        const desiredPitch = Math.atan2(aimY - eyeY, dist);

        let diffYaw = (desiredYaw - bot.yaw) % (Math.PI * 2);
        if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
        if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
        bot.yaw += diffYaw * Math.min(1, dt * 11);
        bot.pitch += (desiredPitch - bot.pitch) * Math.min(1, dt * 11);

        // Counter-strafe / micro-peek stop when shooting
        const readyToShoot = ai.seenTime >= profile.reactionSec;
        if (readyToShoot && !bot.reloading && bot.cooldown <= 0 && ai.burstPauseTimer <= 0) {
          if (bot.mag <= 0) {
            bot.reloading = true;
            bot.reloadTimer = wDef.reloadTime || 2.0;
          } else {
            // Stop briefly to fire accurately
            bot.mag -= 1;
            bot.cooldown = wDef.fireRate * (difficultyId === 'easy' ? 1.35 : 1.08);
            ai.burstLeft = ai.burstLeft > 0 ? ai.burstLeft - 1 : profile.burstLen - 1;
            if (ai.burstLeft <= 0 && wDef.auto) {
              ai.burstPauseTimer = profile.burstPause;
            }
            onBotShoot?.(bot, targetEnemy, profile);
          }
        } else if (dist > 7.5 && !readyToShoot) {
          // Strafe slightly while acquiring target
          const sx = Math.cos(bot.yaw) * ai.strafeSign;
          const sz = -Math.sin(bot.yaw) * ai.strafeSign;
          const step = maxMps * 0.55 * dt;
          this._resolveBotCollision(bot, sx * step, sz * step, colliders);
          moveSpeedMps = maxMps * 0.55;
        }
        bot.crouch = dist > 18 && readyToShoot && difficultyId !== 'easy';
      } else {
        bot.crouch = false;
        // Follow waypoint path or move toward planted bomb
        let destX = bot.x;
        let destZ = bot.z;
        let hasDest = false;

        if (bombState.planted && bot.team === 'ct' && Math.hypot(bot.x - bombState.x, bot.z - bombState.z) < 9) {
          destX = bombState.x;
          destZ = bombState.z;
          hasDest = true;
        } else if (ai.path && ai.pathIdx < ai.path.length) {
          const wp = map.getWaypointById(ai.path[ai.pathIdx]);
          if (wp) {
            const d = Math.hypot(wp.x - bot.x, wp.z - bot.z);
            if (d < 1.15) {
              ai.pathIdx++;
            }
            const curWp = map.getWaypointById(ai.path[Math.min(ai.pathIdx, ai.path.length - 1)]);
            if (curWp) {
              destX = curWp.x;
              destZ = curWp.z;
              hasDest = Math.hypot(destX - bot.x, destZ - bot.z) > 0.75;
            }
          }
        }

        if (hasDest) {
          const dx = destX - bot.x;
          const dz = destZ - bot.z;
          const dist = Math.hypot(dx, dz);
          const dirX = dx / dist;
          const dirZ = dz / dist;
          const desiredYaw = Math.atan2(-dirX, -dirZ);
          let diffYaw = (desiredYaw - bot.yaw) % (Math.PI * 2);
          if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
          if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
          bot.yaw += diffYaw * Math.min(1, dt * 8);
          bot.pitch *= 0.85;

          const step = maxMps * dt;
          this._resolveBotCollision(bot, dirX * step, dirZ * step, colliders);
          moveSpeedMps = maxMps;
        }
      }

      if (bot.rig) {
        bot.rig.root.position.set(bot.x, bot.y, bot.z);
        bot.rig.root.rotation.y = bot.yaw;
        bot.rig.setCrouch(bot.crouch);
        bot.rig.setWeapon(bot.weaponId);
        bot.rig.setHasBomb(bot.hasBomb);
        bot.rig.update(dt, moveSpeedMps, bot.pitch);
      }
    }
  }
}
