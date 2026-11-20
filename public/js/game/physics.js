import {
  ARENA_HALF_GRID,
  ARENA_HALF_SIZE,
  BUILD_TYPES,
  CELL_SIZE,
  FLOOR_THICKNESS,
  GRAVITY,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  RAMP_THICKNESS,
  RESET_BUTTON_POSITIONS,
  SLOPE_ANGLE,
  SLOPE_LEN,
  WALL_HEIGHT,
  WALL_THICKNESS
} from './constants.js';

// Precomputed trig for slope local raycast
const COS_SLOPE = Math.cos(-SLOPE_ANGLE);
const SIN_SLOPE = Math.sin(-SLOPE_ANGLE);

// Scratch vector for zero-GC helpers
const _center = { x: 0, y: 0, z: 0 };

function getCenterInline(b) {
  if (b.type === BUILD_TYPES.WALL) {
    if (b.dir === 0) {
      _center.x = (b.gx + 0.5) * CELL_SIZE;
      _center.y = (b.gy + 0.5) * WALL_HEIGHT;
      _center.z = b.gz * CELL_SIZE;
    } else {
      _center.x = b.gx * CELL_SIZE;
      _center.y = (b.gy + 0.5) * WALL_HEIGHT;
      _center.z = (b.gz + 0.5) * CELL_SIZE;
    }
  } else if (b.type === BUILD_TYPES.FLOOR) {
    _center.x = (b.gx + 0.5) * CELL_SIZE;
    _center.y = b.gy === 0 ? 0.08 : b.gy * WALL_HEIGHT;
    _center.z = (b.gz + 0.5) * CELL_SIZE;
  } else {
    _center.x = (b.gx + 0.5) * CELL_SIZE;
    _center.y = (b.gy + 0.5) * WALL_HEIGHT;
    _center.z = (b.gz + 0.5) * CELL_SIZE;
  }
  return _center;
}

function getRampSurfaceY(b, px, pz) {
  const x0 = b.gx * CELL_SIZE;
  const z0 = b.gz * CELL_SIZE;
  const u = (px - x0) / CELL_SIZE;
  const v = (pz - z0) / CELL_SIZE;

  const pad = 0.08;
  if (u < -pad || u > 1 + pad || v < -pad || v > 1 + pad) return -999;

  let t = 0;
  let side = 0.5;
  if (b.rot === 0) {
    t = 1 - v;
    side = u;
  } else if (b.rot === 1) {
    t = u;
    side = v;
  } else if (b.rot === 2) {
    t = v;
    side = 1 - u;
  } else {
    t = 1 - u;
    side = 1 - v;
  }

  // Check half-ramp mask (bit 0 = side < 0.5, bit 1 = side >= 0.5)
  if (b.mask !== 0x3) {
    const bit = side < 0.5 ? 1 : 2;
    if ((b.mask & bit) === 0) return -999;
  }

  const clampedT = Math.max(0, Math.min(1, t));
  return b.gy * WALL_HEIGHT + clampedT * WALL_HEIGHT + RAMP_THICKNESS * 0.5;
}

function resolveCircleVsBoxXZ(pos, radius, minX, maxX, minZ, maxZ) {
  const closestX = Math.max(minX, Math.min(pos.x, maxX));
  const closestZ = Math.max(minZ, Math.min(pos.z, maxZ));
  const dx = pos.x - closestX;
  const dz = pos.z - closestZ;
  const distSq = dx * dx + dz * dz;
  if (distSq >= radius * radius) return;

  if (distSq > 1e-6) {
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    pos.x += (dx / dist) * push;
    pos.z += (dz / dist) * push;
  } else {
    // Center is inside box; push out along shortest axis
    const overlapLeft = Math.abs(pos.x - minX);
    const overlapRight = Math.abs(maxX - pos.x);
    const overlapBack = Math.abs(pos.z - minZ);
    const overlapFront = Math.abs(maxZ - pos.z);
    const m = Math.min(overlapLeft, overlapRight, overlapBack, overlapFront);
    if (m === overlapLeft) pos.x = minX - radius;
    else if (m === overlapRight) pos.x = maxX + radius;
    else if (m === overlapBack) pos.z = minZ - radius;
    else pos.z = maxZ + radius;
  }
}

function resolveHorizontalCollisions(pos, playerH, builds, mapState = null) {
  const r = PLAYER_RADIUS;
  const floorHalf = mapState?.halfSize || ARENA_HALF_SIZE;

  // Open-edge arena: no perimeter walls; keep sanity world cap far in the void
  if (pos.x < -140) pos.x = -140;
  if (pos.x > 140) pos.x = 140;
  if (pos.z < -140) pos.z = -140;
  if (pos.z > 140) pos.z = 140;

  // Prevent falling players from clipping horizontally into the side of the platform slab
  if (pos.y < -0.12 && pos.y > -1.0) {
    resolveCircleVsBoxXZ(pos, r, -floorHalf, floorHalf, -floorHalf, floorHalf);
  }

  // Physical Reset Button pedestals (1.2m x 1.2m base at edges — disabled in Battle Royale)
  if (!mapState?.disableResetButtons) {
    for (let i = 0; i < RESET_BUTTON_POSITIONS.length; i++) {
      const rb = RESET_BUTTON_POSITIONS[i];
      if (pos.y < 1.9) {
        resolveCircleVsBoxXZ(pos, r, rb.x - 0.65, rb.x + 0.65, rb.z - 0.65, rb.z + 0.65);
      }
    }
  }

  // Static map boxes (Sky Spawn Box deck & glass rails)
  if (mapState) {
    const boxes = mapState.staticBoxes;
    if (boxes) {
      for (let i = 0; i < boxes.length; i++) {
        const bx = boxes[i];
        if (pos.y + playerH <= bx.minY + 0.05 || pos.y >= bx.maxY - 0.35) continue;
        resolveCircleVsBoxXZ(pos, r, bx.minX, bx.maxX, bx.minZ, bx.maxZ);
      }
    }
    if (mapState.barrierActive && mapState.barrierBoxes) {
      const bb = mapState.barrierBoxes;
      for (let i = 0; i < bb.length; i++) {
        const bx = bb[i];
        if (pos.y + playerH <= bx.minY + 0.05 || pos.y >= bx.maxY - 0.35) continue;
        resolveCircleVsBoxXZ(pos, r, bx.minX, bx.maxX, bx.minZ, bx.maxZ);
      }
    }
  }

  // Buildings
  for (const b of builds.values()) {
    if (b.type === BUILD_TYPES.WALL) {
      const c = getCenterInline(b);
      const wallMinY = c.y - WALL_HEIGHT * 0.5;
      const wallMaxY = c.y + WALL_HEIGHT * 0.5;
      if (pos.y + playerH <= wallMinY + 0.05 || pos.y >= wallMaxY - 0.35) continue;

      if (b.mask === 0x1ff) {
        const hx = b.dir === 0 ? CELL_SIZE * 0.5 : WALL_THICKNESS * 0.5;
        const hz = b.dir === 0 ? WALL_THICKNESS * 0.5 : CELL_SIZE * 0.5;
        resolveCircleVsBoxXZ(pos, r, c.x - hx, c.x + hx, c.z - hz, c.z + hz);
      } else {
        const tw = CELL_SIZE / 3;
        const th = WALL_HEIGHT / 3;
        for (let i = 0; i < 9; i++) {
          if ((b.mask & (1 << i)) === 0) continue;
          const row = (i / 3) | 0;
          const col = i % 3;
          const tileY = c.y + (1 - row) * th;
          if (pos.y + playerH <= tileY - th * 0.5 + 0.05 || pos.y >= tileY + th * 0.5 - 0.28) continue;

          const localX = (col - 1) * tw;
          const tx = c.x + (b.dir === 0 ? localX : 0);
          const tz = c.z + (b.dir === 1 ? -localX : 0);
          const hx = b.dir === 0 ? tw * 0.5 : WALL_THICKNESS * 0.5;
          const hz = b.dir === 0 ? WALL_THICKNESS * 0.5 : tw * 0.5;
          resolveCircleVsBoxXZ(pos, r, tx - hx, tx + hx, tz - hz, tz + hz);
        }
      }
    }
  }
}

export function stepPlayerPhysics(state, inputMoveX, inputMoveZ, wantJump, crouch, dt, buildingSystem, mapState = null) {
  const builds = buildingSystem.builds;
  const playerH = crouch ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
  const prevY = state.pos.y;
  const prevX = state.pos.x;
  const prevZ = state.pos.z;

  // Apply boost horizontal velocity + input movement
  const totalVx = inputMoveX + (state.vel.x || 0);
  const totalVz = inputMoveZ + (state.vel.z || 0);

  state.pos.x += totalVx * dt;
  resolveHorizontalCollisions(state.pos, playerH, builds, mapState);

  state.pos.z += totalVz * dt;
  resolveHorizontalCollisions(state.pos, playerH, builds, mapState);

  // Decay horizontal air boost drag
  if (state.vel.x || state.vel.z) {
    const dragRate = state.grounded ? 8.0 : (state.skyBoostTimer > 0 ? 0.18 : 1.25);
    const drag = Math.exp(-dragRate * dt);
    state.vel.x *= drag;
    state.vel.z *= drag;
    if (Math.abs(state.vel.x) < 0.08) state.vel.x = 0;
    if (Math.abs(state.vel.z) < 0.08) state.vel.z = 0;
  }

  // Coyote time (110ms) + jump buffer (130ms) for responsive ledge jumps
  if (state.jumpBufferTimer > 0) {
    state.jumpBufferTimer = Math.max(0, state.jumpBufferTimer - dt);
  }
  const canCoyoteJump = (state.coyoteTimer > 0) && !state.gliding && !(state.skyBoostTimer > 0);
  if ((wantJump || state.jumpBufferTimer > 0) && (state.grounded || canCoyoteJump)) {
    state.vel.y = state.jumpSpeed;
    state.grounded = false;
    state.coyoteTimer = 0;
    state.jumpBufferTimer = 0;
  }

  // Fast sky-boost arc drop (no floaty moon-gravity)
  if (state.skyBoostTimer > 0) {
    state.skyBoostTimer = Math.max(0, state.skyBoostTimer - dt);
  }
  const gravScale = state.skyBoostTimer > 0 && state.vel.y < 2.0 ? 0.95 : 1.0;

  // Gravity & vertical step (plus smooth Battle Royale Air Drop glider descent)
  if (state.gliding) {
    const targetFall = state.diving ? -14.5 : -5.6;
    state.vel.y += (targetFall - state.vel.y) * Math.min(1, dt * 6);
  } else {
    state.vel.y -= GRAVITY * gravScale * dt;
  }
  state.pos.y += state.vel.y * dt;

  const floorHalf = mapState?.halfSize || ARENA_HALF_SIZE;
  const rPad = PLAYER_RADIUS * 0.7;
  const onArenaFloor = Math.abs(state.pos.x) <= floorHalf + rPad && Math.abs(state.pos.z) <= floorHalf + rPad;
  let supportY = (onArenaFloor && prevY >= -0.45) ? 0 : -999; // Open-edge floor inside arena/island
  let ceilingY = 999;

  // Check Reset Button tops
  if (!mapState?.disableResetButtons) {
    for (let i = 0; i < RESET_BUTTON_POSITIONS.length; i++) {
      const rb = RESET_BUTTON_POSITIONS[i];
      if (Math.abs(state.pos.x - rb.x) < 0.75 && Math.abs(state.pos.z - rb.z) < 0.75) {
        if (prevY >= 1.55) supportY = Math.max(supportY, 1.85);
      }
    }
  }

  // Check Static Map Boxes & Static V-Ramps
  if (mapState) {
    if (mapState.staticBoxes) {
      for (let i = 0; i < mapState.staticBoxes.length; i++) {
        const bx = mapState.staticBoxes[i];
        if (
          state.pos.x >= bx.minX - rPad && state.pos.x <= bx.maxX + rPad &&
          state.pos.z >= bx.minZ - rPad && state.pos.z <= bx.maxZ + rPad
        ) {
          if (prevY >= bx.maxY - 0.45 && state.pos.y <= bx.maxY + 0.05 && state.vel.y <= 0) {
            supportY = Math.max(supportY, bx.maxY);
          } else if (prevY + playerH <= bx.minY + 0.25 && state.pos.y + playerH > bx.minY && state.vel.y > 0) {
            ceilingY = Math.min(ceilingY, bx.minY);
          }
        }
      }
    }
    if (mapState.staticRamps) {
      for (let i = 0; i < mapState.staticRamps.length; i++) {
        const sr = mapState.staticRamps[i];
        const rampY = getRampSurfaceY(sr, state.pos.x, state.pos.z);
        if (rampY > -500) {
          if (prevY >= rampY - 0.85 && state.pos.y <= rampY + 0.35 && state.vel.y <= 6) {
            supportY = Math.max(supportY, rampY);
          } else if (prevY < rampY - 0.85 && state.pos.y + playerH > rampY - 0.35) {
            // Wedge underside check
            state.pos.x = prevX;
            state.pos.z = prevZ;
          }
        }
      }
    }
  }

  // Check Floors, Ramps, and Wall tops
  for (const b of builds.values()) {
    if (b.type === BUILD_TYPES.FLOOR) {
      const c = getCenterInline(b);
      const topY = c.y + FLOOR_THICKNESS * 0.5;
      const botY = c.y - FLOOR_THICKNESS * 0.5;

      if (b.mask === 0xf) {
        if (
          state.pos.x >= c.x - CELL_SIZE * 0.5 - rPad &&
          state.pos.x <= c.x + CELL_SIZE * 0.5 + rPad &&
          state.pos.z >= c.z - CELL_SIZE * 0.5 - rPad &&
          state.pos.z <= c.z + CELL_SIZE * 0.5 + rPad
        ) {
          if (prevY >= topY - 0.45 && state.pos.y <= topY + 0.05 && state.vel.y <= 0) {
            supportY = Math.max(supportY, topY);
          } else if (prevY + playerH <= botY + 0.25 && state.pos.y + playerH > botY && state.vel.y > 0) {
            ceilingY = Math.min(ceilingY, botY);
          }
        }
      } else {
        const half = CELL_SIZE * 0.5;
        for (let i = 0; i < 4; i++) {
          if ((b.mask & (1 << i)) === 0) continue;
          const rx = i % 2;
          const rz = (i / 2) | 0;
          const tx = c.x + (rx - 0.5) * half;
          const tz = c.z + (rz - 0.5) * half;
          if (
            state.pos.x >= tx - half * 0.5 - rPad &&
            state.pos.x <= tx + half * 0.5 + rPad &&
            state.pos.z >= tz - half * 0.5 - rPad &&
            state.pos.z <= tz + half * 0.5 + rPad
          ) {
            if (prevY >= topY - 0.45 && state.pos.y <= topY + 0.05 && state.vel.y <= 0) {
              supportY = Math.max(supportY, topY);
            } else if (prevY + playerH <= botY + 0.25 && state.pos.y + playerH > botY && state.vel.y > 0) {
              ceilingY = Math.min(ceilingY, botY);
            }
          }
        }
      }
    } else if (b.type === BUILD_TYPES.RAMP) {
      const rampY = getRampSurfaceY(b, state.pos.x, state.pos.z);
      if (rampY > -500) {
        if (prevY >= rampY - 0.85 && state.pos.y <= rampY + 0.35 && state.vel.y <= 6) {
          supportY = Math.max(supportY, rampY);
        } else if (prevY + playerH <= rampY - 0.25 && state.pos.y + playerH > rampY - 0.45 && state.vel.y > 0) {
          ceilingY = Math.min(ceilingY, rampY - 0.45);
        } else if (prevY < rampY - 0.85 && state.pos.y + playerH > rampY - 0.35) {
          state.pos.x = prevX;
          state.pos.z = prevZ;
        }
      }
    } else if (b.type === BUILD_TYPES.WALL) {
      const c = getCenterInline(b);
      const wallTop = c.y + WALL_HEIGHT * 0.5;
      const hx = (b.dir === 0 ? CELL_SIZE * 0.5 : WALL_THICKNESS * 0.5) + rPad;
      const hz = (b.dir === 0 ? WALL_THICKNESS * 0.5 : CELL_SIZE * 0.5) + rPad;
      if (Math.abs(state.pos.x - c.x) <= hx && Math.abs(state.pos.z - c.z) <= hz) {
        if (prevY >= wallTop - 0.35 && state.pos.y <= wallTop + 0.05 && state.vel.y <= 0) {
          // Verify there is an active top row tile at this X/Z if edited
          if (b.mask === 0x1ff || (b.mask & 0b000000111) !== 0) {
            supportY = Math.max(supportY, wallTop);
          }
        }
      }
    }
  }

  if (state.pos.y + playerH > ceilingY) {
    state.pos.y = ceilingY - playerH;
    if (state.vel.y > 0) state.vel.y = 0;
  }

  if (state.pos.y <= supportY) {
    state.pos.y = supportY;
    if (state.vel.y < 0) state.vel.y = 0;
    state.grounded = true;
    state.coyoteTimer = 0.11;
    state.gliding = false;
    state.skyBoostTimer = 0;
    if (state.vel.x || state.vel.z) {
      state.vel.x = 0;
      state.vel.z = 0;
    }
  } else {
    state.grounded = false;
    state.coyoteTimer = Math.max(0, (state.coyoteTimer || 0) - dt);
  }
}

// Fast zero-allocation analytical Ray-AABB intersection
function intersectRayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, maxDist) {
  let tmin = 0;
  let tmax = maxDist;

  // X
  if (Math.abs(dx) < 1e-8) {
    if (ox < minX || ox > maxX) return -1;
  } else {
    const invD = 1 / dx;
    let t1 = (minX - ox) * invD;
    let t2 = (maxX - ox) * invD;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  // Y
  if (Math.abs(dy) < 1e-8) {
    if (oy < minY || oy > maxY) return -1;
  } else {
    const invD = 1 / dy;
    let t1 = (minY - oy) * invD;
    let t2 = (maxY - oy) * invD;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  // Z
  if (Math.abs(dz) < 1e-8) {
    if (oz < minZ || oz > maxZ) return -1;
  } else {
    const invD = 1 / dz;
    let t1 = (minZ - oz) * invD;
    let t2 = (maxZ - oz) * invD;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  return tmin > 0.01 ? tmin : -1;
}

export function raycastArena(ox, oy, oz, dx, dy, dz, maxDist, buildingSystem, targets = null, outHit = null, mapState = null) {
  const hit = outHit || {
    hit: false,
    hitType: null, // 'player' | 'build' | 'reset_button' | 'world'
    dist: maxDist,
    x: ox + dx * maxDist,
    y: oy + dy * maxDist,
    z: oz + dz * maxDist,
    buildKey: null,
    playerId: null,
    isHeadshot: false
  };

  hit.hit = false;
  hit.hitType = null;
  hit.dist = maxDist;
  hit.buildKey = null;
  hit.playerId = null;
  hit.isHeadshot = false;

  // 1. Open-edge arena/island ground platform y = 0
  const floorHalf = mapState?.halfSize || ARENA_HALF_SIZE;
  if (dy < -1e-5 && oy > 0) {
    const tg = -oy / dy;
    if (tg > 0 && tg < hit.dist) {
      const hx = ox + dx * tg;
      const hz = oz + dz * tg;
      if (Math.abs(hx) <= floorHalf && Math.abs(hz) <= floorHalf) {
        hit.hit = true;
        hit.hitType = 'world';
        hit.dist = tg;
      }
    }
  }

  // 3. Physical Reset Buttons (solid cover to gunfire — triggered strictly by pressing [E] nearby)
  if (!mapState?.disableResetButtons) {
    for (let i = 0; i < RESET_BUTTON_POSITIONS.length; i++) {
      const rb = RESET_BUTTON_POSITIONS[i];
      const t = intersectRayAABB(
        ox, oy, oz, dx, dy, dz,
        rb.x - 0.85, 0, rb.z - 0.85,
        rb.x + 0.85, 2.5, rb.z + 0.85,
        hit.dist
      );
      if (t > 0 && t < hit.dist) {
        hit.hit = true;
        hit.hitType = 'world';
        hit.dist = t;
      }
    }
  }

  // 3b. Static map boxes, V-ramps & countdown barrier
  if (mapState) {
    if (mapState.staticBoxes) {
      for (let i = 0; i < mapState.staticBoxes.length; i++) {
        const bx = mapState.staticBoxes[i];
        const t = intersectRayAABB(
          ox, oy, oz, dx, dy, dz,
          bx.minX, bx.minY, bx.minZ,
          bx.maxX, bx.maxY, bx.maxZ,
          hit.dist
        );
        if (t > 0 && t < hit.dist) {
          hit.hit = true;
          hit.hitType = 'world';
          hit.dist = t;
        }
      }
    }
    if (mapState.barrierActive && mapState.barrierBoxes) {
      for (let i = 0; i < mapState.barrierBoxes.length; i++) {
        const bx = mapState.barrierBoxes[i];
        const t = intersectRayAABB(
          ox, oy, oz, dx, dy, dz,
          bx.minX, bx.minY, bx.minZ,
          bx.maxX, bx.maxY, bx.maxZ,
          hit.dist
        );
        if (t > 0 && t < hit.dist) {
          hit.hit = true;
          hit.hitType = 'world';
          hit.dist = t;
        }
      }
    }
    if (mapState.staticRamps) {
      const halfT = RAMP_THICKNESS * 0.5;
      const halfL = SLOPE_LEN * 0.5;
      for (let i = 0; i < mapState.staticRamps.length; i++) {
        const sr = mapState.staticRamps[i];
        const cx = (sr.gx + 0.5) * CELL_SIZE;
        const cy = (sr.gy + 0.5) * WALL_HEIGHT;
        const cz = (sr.gz + 0.5) * CELL_SIZE;
        const relX = ox - cx;
        const relY = oy - cy;
        const relZ = oz - cz;
        const invRy = sr.rot * (Math.PI * 0.5);
        const rcy = Math.cos(invRy);
        const rsy = Math.sin(invRy);
        const ox1 = relX * rcy + relZ * rsy;
        const oz1 = -relX * rsy + relZ * rcy;
        const dx1 = dx * rcy + dz * rsy;
        const dz1 = -dx * rsy + dz * rcy;
        const loy = relY * COS_SLOPE - oz1 * SIN_SLOPE;
        const loz = relY * SIN_SLOPE + oz1 * COS_SLOPE;
        const ldy = dy * COS_SLOPE - dz1 * SIN_SLOPE;
        const ldz = dy * SIN_SLOPE + dz1 * COS_SLOPE;
        const t = intersectRayAABB(
          ox1, loy, loz, dx1, ldy, ldz,
          -CELL_SIZE * 0.5, -halfT, -halfL,
          CELL_SIZE * 0.5, halfT, halfL,
          hit.dist
        );
        if (t > 0 && t < hit.dist) {
          hit.hit = true;
          hit.hitType = 'world';
          hit.dist = t;
        }
      }
    }
  }

  // 4. Buildings (Instanced meshes represented via analytical boxes & oriented slabs)
  for (const b of buildingSystem.builds.values()) {
    const c = getCenterInline(b);
    // Conservative line-to-sphere broadphase reject (max cell radius ~3.35m => R^2 = 12.96)
    const vx = c.x - ox;
    const vy = c.y - oy;
    const vz = c.z - oz;
    const proj = vx * dx + vy * dy + vz * dz;
    if (proj < -3.6 || proj - 3.6 > hit.dist) continue;
    if (vx * vx + vy * vy + vz * vz - proj * proj > 12.96) continue;

    if (b.type === BUILD_TYPES.WALL) {
      if (b.mask === 0x1ff) {
        const hx = b.dir === 0 ? CELL_SIZE * 0.5 : WALL_THICKNESS * 0.5;
        const hz = b.dir === 0 ? WALL_THICKNESS * 0.5 : CELL_SIZE * 0.5;
        const t = intersectRayAABB(
          ox, oy, oz, dx, dy, dz,
          c.x - hx, c.y - WALL_HEIGHT * 0.5, c.z - hz,
          c.x + hx, c.y + WALL_HEIGHT * 0.5, c.z + hz,
          hit.dist
        );
        if (t > 0 && t < hit.dist) {
          hit.hit = true;
          hit.hitType = 'build';
          hit.dist = t;
          hit.buildKey = b.key;
        }
      } else {
        const tw = CELL_SIZE / 3;
        const th = WALL_HEIGHT / 3;
        for (let i = 0; i < 9; i++) {
          if ((b.mask & (1 << i)) === 0) continue;
          const row = (i / 3) | 0;
          const col = i % 3;
          const localX = (col - 1) * tw;
          const tx = c.x + (b.dir === 0 ? localX : 0);
          const ty = c.y + (1 - row) * th;
          const tz = c.z + (b.dir === 1 ? -localX : 0);
          const hx = b.dir === 0 ? tw * 0.5 : WALL_THICKNESS * 0.5;
          const hz = b.dir === 0 ? WALL_THICKNESS * 0.5 : tw * 0.5;
          const t = intersectRayAABB(
            ox, oy, oz, dx, dy, dz,
            tx - hx, ty - th * 0.5, tz - hz,
            tx + hx, ty + th * 0.5, tz + hz,
            hit.dist
          );
          if (t > 0 && t < hit.dist) {
            hit.hit = true;
            hit.hitType = 'build';
            hit.dist = t;
            hit.buildKey = b.key;
          }
        }
      }
    } else if (b.type === BUILD_TYPES.FLOOR) {
      if (b.mask === 0xf) {
        const t = intersectRayAABB(
          ox, oy, oz, dx, dy, dz,
          c.x - CELL_SIZE * 0.5, c.y - FLOOR_THICKNESS * 0.5, c.z - CELL_SIZE * 0.5,
          c.x + CELL_SIZE * 0.5, c.y + FLOOR_THICKNESS * 0.5, c.z + CELL_SIZE * 0.5,
          hit.dist
        );
        if (t > 0 && t < hit.dist) {
          hit.hit = true;
          hit.hitType = 'build';
          hit.dist = t;
          hit.buildKey = b.key;
        }
      } else {
        const half = CELL_SIZE * 0.5;
        for (let i = 0; i < 4; i++) {
          if ((b.mask & (1 << i)) === 0) continue;
          const rx = i % 2;
          const rz = (i / 2) | 0;
          const tx = c.x + (rx - 0.5) * half;
          const tz = c.z + (rz - 0.5) * half;
          const t = intersectRayAABB(
            ox, oy, oz, dx, dy, dz,
            tx - half * 0.5, c.y - FLOOR_THICKNESS * 0.5, tz - half * 0.5,
            tx + half * 0.5, c.y + FLOOR_THICKNESS * 0.5, tz + half * 0.5,
            hit.dist
          );
          if (t > 0 && t < hit.dist) {
            hit.hit = true;
            hit.hitType = 'build';
            hit.dist = t;
            hit.buildKey = b.key;
          }
        }
      }
    } else if (b.type === BUILD_TYPES.RAMP) {
      // Transform ray into ramp local space (inverse Y rot then inverse X slope)
      const relX = ox - c.x;
      const relY = oy - c.y;
      const relZ = oz - c.z;
      const invRy = b.rot * (Math.PI * 0.5);
      const cy = Math.cos(invRy);
      const sy = Math.sin(invRy);

      const ox1 = relX * cy + relZ * sy;
      const oy1 = relY;
      const oz1 = -relX * sy + relZ * cy;

      const dx1 = dx * cy + dz * sy;
      const dy1 = dy;
      const dz1 = -dx * sy + dz * cy;

      // Inverse X rotation (-SLOPE_ANGLE)
      const loy = oy1 * COS_SLOPE - oz1 * SIN_SLOPE;
      const loz = oy1 * SIN_SLOPE + oz1 * COS_SLOPE;
      const ldy = dy1 * COS_SLOPE - dz1 * SIN_SLOPE;
      const ldz = dy1 * SIN_SLOPE + dz1 * COS_SLOPE;

      const halfT = RAMP_THICKNESS * 0.5;
      const halfL = SLOPE_LEN * 0.5;

      if (b.mask === 0x3) {
        const t = intersectRayAABB(
          ox1, loy, loz, dx1, ldy, ldz,
          -CELL_SIZE * 0.5, -halfT, -halfL,
          CELL_SIZE * 0.5, halfT, halfL,
          hit.dist
        );
        if (t > 0 && t < hit.dist) {
          hit.hit = true;
          hit.hitType = 'build';
          hit.dist = t;
          hit.buildKey = b.key;
        }
      } else {
        for (let i = 0; i < 2; i++) {
          if ((b.mask & (1 << i)) === 0) continue;
          const xCenter = (i - 0.5) * (CELL_SIZE * 0.5);
          const t = intersectRayAABB(
            ox1, loy, loz, dx1, ldy, ldz,
            xCenter - CELL_SIZE * 0.25, -halfT, -halfL,
            xCenter + CELL_SIZE * 0.25, halfT, halfL,
            hit.dist
          );
          if (t > 0 && t < hit.dist) {
            hit.hit = true;
            hit.hitType = 'build';
            hit.dist = t;
            hit.buildKey = b.key;
          }
        }
      }
    }
  }

  // 5. Opponent / Bot targets (Head + Body AABBs matching visual low-poly mesh)
  if (targets) {
    for (let i = 0; i < targets.length; i++) {
      const tgt = targets[i];
      if (!tgt || tgt.alive === false) continue;
      const tx = tgt.pos.x;
      const ty = tgt.pos.y;
      const tz = tgt.pos.z;
      const bodyTop = tgt.crouch ? ty + 0.96 : ty + 1.40;
      const headTop = tgt.crouch ? ty + 1.40 : ty + 1.86;

      // Headbox check
      const th = intersectRayAABB(
        ox, oy, oz, dx, dy, dz,
        tx - 0.28, bodyTop, tz - 0.28,
        tx + 0.28, headTop, tz + 0.28,
        hit.dist
      );
      if (th > 0 && th < hit.dist) {
        hit.hit = true;
        hit.hitType = 'player';
        hit.dist = th;
        hit.playerId = tgt.id;
        hit.isHeadshot = true;
        hit.buildKey = null;
      }

      // Bodybox check
      const tb = intersectRayAABB(
        ox, oy, oz, dx, dy, dz,
        tx - 0.44, ty, tz - 0.44,
        tx + 0.44, bodyTop, tz + 0.44,
        hit.dist
      );
      if (tb > 0 && tb < hit.dist) {
        hit.hit = true;
        hit.hitType = 'player';
        hit.dist = tb;
        hit.playerId = tgt.id;
        hit.isHeadshot = false;
        hit.buildKey = null;
      }
    }
  }

  hit.x = ox + dx * hit.dist;
  hit.y = oy + dy * hit.dist;
  hit.z = oz + dz * hit.dist;
  return hit;
}

export function isInsideSpawnBox(pos, mapId) {
  if (mapId !== 'skybox' || !pos) return false;
  return (
    pos.y >= 11.8 &&
    Math.abs(pos.x) <= 5.0 &&
    Math.abs(pos.z) >= 41.0 &&
    Math.abs(pos.z) <= 51.0
  );
}

export function isBuildSupported(build, buildsMap, mapState = null) {
  if (!build) return false;
  const { type, gx, gy, gz, dir = 0, rot = 0 } = build;

  // Level 0 anchored directly onto Arena Floor (80x80m)
  if (gy === 0) return true;

  const has = (k) => Boolean(buildsMap && buildsMap.has(k));
  const staticRamps = mapState && mapState.staticRamps ? mapState.staticRamps : null;

  const getRampAt = (rx, ry, rz) => {
    if (buildsMap) {
      const b = buildsMap.get(`r:${rx}:${ry}:${rz}`);
      if (b) return b;
    }
    if (staticRamps) {
      for (let i = 0; i < staticRamps.length; i++) {
        const sr = staticRamps[i];
        if (sr.gx === rx && sr.gy === ry && sr.gz === rz) return sr;
      }
    }
    return null;
  };

  if (type === BUILD_TYPES.WALL) {
    if (dir === 0) {
      // Adjacent walls
      if (
        has(`w:${gx}:${gy - 1}:${gz}:0`) ||
        has(`w:${gx}:${gy + 1}:${gz}:0`) ||
        has(`w:${gx - 1}:${gy}:${gz}:0`) ||
        has(`w:${gx + 1}:${gy}:${gz}:0`) ||
        has(`w:${gx}:${gy}:${gz}:1`) ||
        has(`w:${gx}:${gy}:${gz - 1}:1`) ||
        has(`w:${gx + 1}:${gy}:${gz}:1`) ||
        has(`w:${gx + 1}:${gy}:${gz - 1}:1`)
      ) return true;

      // Adjacent floors along bottom/top Z border
      if (
        has(`f:${gx}:${gy}:${gz}`) ||
        has(`f:${gx}:${gy}:${gz - 1}`) ||
        has(`f:${gx}:${gy + 1}:${gz}`) ||
        has(`f:${gx}:${gy + 1}:${gz - 1}`)
      ) return true;

      // Connected ramps at same level, or high edge from below, or low edge from above
      if (getRampAt(gx, gy, gz) || getRampAt(gx, gy, gz - 1)) return true;
      const rBelowSouth = getRampAt(gx, gy - 1, gz);
      if (rBelowSouth && rBelowSouth.rot === 0) return true;
      const rBelowNorth = getRampAt(gx, gy - 1, gz - 1);
      if (rBelowNorth && rBelowNorth.rot === 2) return true;
      const rAboveSouth = getRampAt(gx, gy + 1, gz);
      if (rAboveSouth && rAboveSouth.rot !== 0) return true;
      const rAboveNorth = getRampAt(gx, gy + 1, gz - 1);
      if (rAboveNorth && rAboveNorth.rot !== 2) return true;
      return false;
    }

    // dir === 1 (along Z at x = gx * CELL_SIZE)
    if (
      has(`w:${gx}:${gy - 1}:${gz}:1`) ||
      has(`w:${gx}:${gy + 1}:${gz}:1`) ||
      has(`w:${gx}:${gy}:${gz - 1}:1`) ||
      has(`w:${gx}:${gy}:${gz + 1}:1`) ||
      has(`w:${gx}:${gy}:${gz}:0`) ||
      has(`w:${gx - 1}:${gy}:${gz}:0`) ||
      has(`w:${gx}:${gy}:${gz + 1}:0`) ||
      has(`w:${gx - 1}:${gy}:${gz + 1}:0`)
    ) return true;

    if (
      has(`f:${gx}:${gy}:${gz}`) ||
      has(`f:${gx - 1}:${gy}:${gz}`) ||
      has(`f:${gx}:${gy + 1}:${gz}`) ||
      has(`f:${gx - 1}:${gy + 1}:${gz}`)
    ) return true;

    if (getRampAt(gx, gy, gz) || getRampAt(gx - 1, gy, gz)) return true;
    const rBelowEast = getRampAt(gx, gy - 1, gz);
    if (rBelowEast && rBelowEast.rot === 3) return true;
    const rBelowWest = getRampAt(gx - 1, gy - 1, gz);
    if (rBelowWest && rBelowWest.rot === 1) return true;
    const rAboveEast = getRampAt(gx, gy + 1, gz);
    if (rAboveEast && rAboveEast.rot !== 3) return true;
    const rAboveWest = getRampAt(gx - 1, gy + 1, gz);
    if (rAboveWest && rAboveWest.rot !== 1) return true;
    return false;
  }

  if (type === BUILD_TYPES.FLOOR) {
    // Cardinal neighbor floors
    if (
      has(`f:${gx - 1}:${gy}:${gz}`) ||
      has(`f:${gx + 1}:${gy}:${gz}`) ||
      has(`f:${gx}:${gy}:${gz - 1}`) ||
      has(`f:${gx}:${gy}:${gz + 1}`)
    ) return true;

    // Walls on all 4 edges (below or above)
    if (
      has(`w:${gx}:${gy - 1}:${gz}:0`) || has(`w:${gx}:${gy}:${gz}:0`) ||
      has(`w:${gx}:${gy - 1}:${gz + 1}:0`) || has(`w:${gx}:${gy}:${gz + 1}:0`) ||
      has(`w:${gx}:${gy - 1}:${gz}:1`) || has(`w:${gx}:${gy}:${gz}:1`) ||
      has(`w:${gx + 1}:${gy - 1}:${gz}:1`) || has(`w:${gx + 1}:${gy}:${gz}:1`)
    ) return true;

    // Ramps inside or rising/touching this floor
    if (getRampAt(gx, gy, gz) || getRampAt(gx, gy - 1, gz)) return true;
    const rBNorth = getRampAt(gx, gy - 1, gz - 1);
    if (rBNorth && rBNorth.rot === 2) return true;
    const rBSouth = getRampAt(gx, gy - 1, gz + 1);
    if (rBSouth && rBSouth.rot === 0) return true;
    const rBWest = getRampAt(gx - 1, gy - 1, gz);
    if (rBWest && rBWest.rot === 1) return true;
    const rBEast = getRampAt(gx + 1, gy - 1, gz);
    if (rBEast && rBEast.rot === 3) return true;

    const rSNorth = getRampAt(gx, gy, gz - 1);
    if (rSNorth && rSNorth.rot !== 2) return true;
    const rSSouth = getRampAt(gx, gy, gz + 1);
    if (rSSouth && rSSouth.rot !== 0) return true;
    const rSWest = getRampAt(gx - 1, gy, gz);
    if (rSWest && rSWest.rot !== 1) return true;
    const rSEast = getRampAt(gx + 1, gy, gz);
    if (rSEast && rSEast.rot !== 3) return true;
    return false;
  }

  // BUILD_TYPES.RAMP
  const hx = rot === 1 ? 1 : (rot === 3 ? -1 : 0);
  const hz = rot === 2 ? 1 : (rot === 0 ? -1 : 0);

  // Connected floor in same cell or cardinal edges
  if (has(`f:${gx}:${gy}:${gz}`) || has(`f:${gx}:${gy + 1}:${gz}`)) return true;
  if (has(`f:${gx + hx}:${gy + 1}:${gz + hz}`)) return true;
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let i = 0; i < 4; i++) {
    const [ox, oz] = dirs[i];
    if (ox === hx && oz === hz) continue;
    if (has(`f:${gx + ox}:${gy}:${gz + oz}`)) return true;
  }

  // Same-level perimeter walls + wall under low edge + wall above high edge
  if (
    has(`w:${gx}:${gy}:${gz}:0`) ||
    has(`w:${gx}:${gy}:${gz + 1}:0`) ||
    has(`w:${gx}:${gy}:${gz}:1`) ||
    has(`w:${gx + 1}:${gy}:${gz}:1`)
  ) return true;

  if (rot === 0 && (has(`w:${gx}:${gy - 1}:${gz + 1}:0`) || has(`w:${gx}:${gy + 1}:${gz}:0`))) return true;
  if (rot === 1 && (has(`w:${gx}:${gy - 1}:${gz}:1`) || has(`w:${gx + 1}:${gy + 1}:${gz}:1`))) return true;
  if (rot === 2 && (has(`w:${gx}:${gy - 1}:${gz}:0`) || has(`w:${gx}:${gy + 1}:${gz + 1}:0`))) return true;
  if (rot === 3 && (has(`w:${gx + 1}:${gy - 1}:${gz}:1`) || has(`w:${gx}:${gy + 1}:${gz}:1`))) return true;

  // Chained continuation ramps (below into low edge, above out of high edge) or side-by-side ramps
  const rPrev = getRampAt(gx - hx, gy - 1, gz - hz);
  if (rPrev && rPrev.rot === rot) return true;
  const rNext = getRampAt(gx + hx, gy + 1, gz + hz);
  if (rNext && rNext.rot === rot) return true;

  if (
    getRampAt(gx - 1, gy, gz) ||
    getRampAt(gx + 1, gy, gz) ||
    getRampAt(gx, gy, gz - 1) ||
    getRampAt(gx, gy, gz + 1)
  ) return true;

  void ARENA_HALF_GRID;
  return false;
}
