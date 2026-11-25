import { CS2_MOVE, CS2_SOURCE_SCALE } from './constants.js';

export class CS2MovementController {
  constructor() {
    this.pos = { x: 0, y: 0, z: 0 };
    // Velocity stored in Source units/sec (divide by CS2_SOURCE_SCALE for m/s)
    this.velU = { x: 0, y: 0, z: 0 };
    this.grounded = true;
    this.crouching = false;
    this.walking = false;
    this.eyeHeight = CS2_MOVE.EYE_STAND;
    this.currentHeight = CS2_MOVE.STAND_HEIGHT;

    this.jumpBuffer = 0;
    this.landGraceTimer = 0;
    this.stepDistAccum = 0;
    this.lastLandSpeedU = 0;
    this.justLanded = false;
    this.justJumped = false;
    this.justStepped = false;
  }

  reset(spawn) {
    this.pos.x = spawn.x;
    this.pos.y = spawn.y;
    this.pos.z = spawn.z;
    this.velU.x = 0;
    this.velU.y = 0;
    this.velU.z = 0;
    this.grounded = true;
    this.crouching = false;
    this.walking = false;
    this.eyeHeight = CS2_MOVE.EYE_STAND;
    this.currentHeight = CS2_MOVE.STAND_HEIGHT;
    this.jumpBuffer = 0;
    this.landGraceTimer = 0;
    this.stepDistAccum = 0;
    this.justLanded = false;
    this.justJumped = false;
    this.justStepped = false;
  }

  queueJump() {
    this.jumpBuffer = CS2_MOVE.JUMP_BUFFER_WINDOW;
  }

  getHorizSpeedU() {
    return Math.hypot(this.velU.x, this.velU.z);
  }

  isAccurateSpeed() {
    return this.grounded && this.getHorizSpeedU() <= CS2_MOVE.ACCURATE_SPEED_U;
  }

  _canStand(colliders) {
    const r = CS2_MOVE.PLAYER_RADIUS - 0.01;
    const minX = this.pos.x - r;
    const maxX = this.pos.x + r;
    const minZ = this.pos.z - r;
    const maxZ = this.pos.z + r;
    const minY = this.pos.y + 0.05;
    const maxY = this.pos.y + CS2_MOVE.STAND_HEIGHT;

    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (maxX > b.minX && minX < b.maxX && maxZ > b.minZ && minZ < b.maxZ && maxY > b.minY && minY < b.maxY) {
        return false;
      }
    }
    return true;
  }

  _applyFriction(dt) {
    const speed = Math.hypot(this.velU.x, this.velU.z);
    if (speed < 0.1) {
      this.velU.x = 0;
      this.velU.z = 0;
      return;
    }
    const control = speed < CS2_MOVE.SV_STOPSPEED ? CS2_MOVE.SV_STOPSPEED : speed;
    const drop = control * CS2_MOVE.SV_FRICTION * dt;
    let newSpeed = speed - drop;
    if (newSpeed < 0) newSpeed = 0;
    if (newSpeed !== speed) {
      const ratio = newSpeed / speed;
      this.velU.x *= ratio;
      this.velU.z *= ratio;
    }
  }

  _accelerate(wishDirX, wishDirZ, wishSpeed, accel, dt) {
    const currentSpeed = this.velU.x * wishDirX + this.velU.z * wishDirZ;
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed <= 0) return;

    let accelSpeed = accel * wishSpeed * dt;
    if (accelSpeed > addSpeed) accelSpeed = addSpeed;

    this.velU.x += accelSpeed * wishDirX;
    this.velU.z += accelSpeed * wishDirZ;
  }

  _airAccelerate(wishDirX, wishDirZ, wishSpeed, accel, dt) {
    let wishspd = wishSpeed;
    if (wishspd > CS2_MOVE.SV_AIR_WISHCAP) {
      wishspd = CS2_MOVE.SV_AIR_WISHCAP;
    }
    const currentSpeed = this.velU.x * wishDirX + this.velU.z * wishDirZ;
    const addSpeed = wishspd - currentSpeed;
    if (addSpeed <= 0) return;

    let accelSpeed = accel * wishSpeed * dt * 0.15;
    if (accelSpeed > addSpeed) accelSpeed = addSpeed;

    this.velU.x += accelSpeed * wishDirX;
    this.velU.z += accelSpeed * wishDirZ;

    // Cap max bhop velocity cleanly so air-strafing feels authentic without runaway glitches
    const spd = Math.hypot(this.velU.x, this.velU.z);
    if (spd > CS2_MOVE.BHOP_MAX_SPEED_U) {
      const scale = CS2_MOVE.BHOP_MAX_SPEED_U / spd;
      this.velU.x *= scale;
      this.velU.z *= scale;
    }
  }

  _overlapsHoriz(x, y, z, height, colliders) {
    const r = CS2_MOVE.PLAYER_RADIUS;
    const minX = x - r;
    const maxX = x + r;
    const minZ = z - r;
    const maxZ = z + r;
    const minY = y + 0.04;
    const maxY = y + height - 0.02;

    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (maxX > b.minX && minX < b.maxX && maxZ > b.minZ && minZ < b.maxZ && maxY > b.minY && minY < b.maxY) {
        return b;
      }
    }
    return null;
  }

  _tryMoveHorizontal(dx, dz, height, colliders) {
    // Move X with step-up support
    let nextX = this.pos.x + dx;
    let hitX = this._overlapsHoriz(nextX, this.pos.y, this.pos.z, height, colliders);
    if (hitX) {
      const stepY = hitX.maxY;
      if (this.grounded && stepY > this.pos.y && stepY - this.pos.y <= CS2_MOVE.STEP_HEIGHT) {
        if (!this._overlapsHoriz(nextX, stepY, this.pos.z, height, colliders)) {
          this.pos.y = stepY;
          this.pos.x = nextX;
        } else {
          this.velU.x = 0;
        }
      } else {
        if (dx > 0) {
          this.pos.x = hitX.minX - CS2_MOVE.PLAYER_RADIUS - 0.001;
        } else if (dx < 0) {
          this.pos.x = hitX.maxX + CS2_MOVE.PLAYER_RADIUS + 0.001;
        }
        this.velU.x = 0;
      }
    } else {
      this.pos.x = nextX;
    }

    // Move Z with step-up support
    let nextZ = this.pos.z + dz;
    let hitZ = this._overlapsHoriz(this.pos.x, this.pos.y, nextZ, height, colliders);
    if (hitZ) {
      const stepY = hitZ.maxY;
      if (this.grounded && stepY > this.pos.y && stepY - this.pos.y <= CS2_MOVE.STEP_HEIGHT) {
        if (!this._overlapsHoriz(this.pos.x, stepY, nextZ, height, colliders)) {
          this.pos.y = stepY;
          this.pos.z = nextZ;
        } else {
          this.velU.z = 0;
        }
      } else {
        if (dz > 0) {
          this.pos.z = hitZ.minZ - CS2_MOVE.PLAYER_RADIUS - 0.001;
        } else if (dz < 0) {
          this.pos.z = hitZ.maxZ + CS2_MOVE.PLAYER_RADIUS + 0.001;
        }
        this.velU.z = 0;
      }
    } else {
      this.pos.z = nextZ;
    }
  }

  _tryMoveVertical(dy, height, colliders) {
    const r = CS2_MOVE.PLAYER_RADIUS - 0.01;
    const minX = this.pos.x - r;
    const maxX = this.pos.x + r;
    const minZ = this.pos.z - r;
    const maxZ = this.pos.z + r;

    let nextY = this.pos.y + dy;
    let landed = false;

    if (dy <= 0) {
      // Swept floor test
      let highestFloor = 0; // ground plane y = 0
      const footNow = this.pos.y + 0.03;
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i];
        if (maxX > b.minX && minX < b.maxX && maxZ > b.minZ && minZ < b.maxZ) {
          if (b.maxY <= footNow && b.maxY > highestFloor) {
            highestFloor = b.maxY;
          }
        }
      }
      if (nextY <= highestFloor) {
        nextY = highestFloor;
        landed = true;
      }
    } else {
      // Rising ceiling test
      const headNext = nextY + height;
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i];
        if (maxX > b.minX && minX < b.maxX && maxZ > b.minZ && minZ < b.maxZ) {
          if (b.minY >= this.pos.y + height - 0.05 && headNext > b.minY) {
            nextY = b.minY - height - 0.001;
            this.velU.y = 0;
            break;
          }
        }
      }
    }

    this.pos.y = nextY;
    if (landed) {
      if (!this.grounded && this.velU.y < -160) {
        this.lastLandSpeedU = Math.abs(this.velU.y);
        this.justLanded = true;
      }
      this.velU.y = 0;
      this.grounded = true;
    } else {
      // Check if still standing on floor within snap tolerance
      if (this.grounded && dy <= 0) {
        let supportY = 0;
        for (let i = 0; i < colliders.length; i++) {
          const b = colliders[i];
          if (maxX > b.minX && minX < b.maxX && maxZ > b.minZ && minZ < b.maxZ) {
            if (b.maxY <= this.pos.y + 0.06 && b.maxY > supportY) {
              supportY = b.maxY;
            }
          }
        }
        if (this.pos.y - supportY <= 0.06) {
          this.pos.y = supportY;
          this.grounded = true;
          this.velU.y = 0;
        } else {
          this.grounded = false;
        }
      } else {
        this.grounded = false;
      }
    }
  }

  step(dt, input, yaw, maxWeaponSpeedU, colliders, frozen = false) {
    this.justLanded = false;
    this.justJumped = false;
    this.justStepped = false;

    if (this.jumpBuffer > 0) this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.landGraceTimer > 0) this.landGraceTimer = Math.max(0, this.landGraceTimer - dt);

    // Handle crouch state & smooth camera eye height
    const wantsCrouch = Boolean(input.crouch);
    if (wantsCrouch) {
      this.crouching = true;
    } else if (this.crouching && this._canStand(colliders)) {
      this.crouching = false;
    }
    this.currentHeight = this.crouching ? CS2_MOVE.CROUCH_HEIGHT : CS2_MOVE.STAND_HEIGHT;
    const targetEye = this.crouching ? CS2_MOVE.EYE_CROUCH : CS2_MOVE.EYE_STAND;
    const eyeLerp = Math.min(1, dt * 15);
    this.eyeHeight += (targetEye - this.eyeHeight) * eyeLerp;

    if (frozen) {
      this.velU.x = 0;
      this.velU.z = 0;
      this.velU.y = 0;
      this.walking = false;
      return;
    }

    this.walking = Boolean(input.walk) && !this.crouching;

    // Camera-aligned XZ movement basis (yaw=0 looks along -Z)
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    const fMove = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    const sMove = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    let wishX = fwdX * fMove + rightX * sMove;
    let wishZ = fwdZ * fMove + rightZ * sMove;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0.001) {
      wishX /= wishLen;
      wishZ /= wishLen;
    } else {
      wishX = 0;
      wishZ = 0;
    }

    let maxSpeedU = maxWeaponSpeedU;
    if (this.crouching) {
      maxSpeedU *= CS2_MOVE.CROUCH_MULT;
    } else if (this.walking) {
      maxSpeedU *= CS2_MOVE.WALK_MULT;
    }

    const wishSpeed = wishLen > 0.001 ? maxSpeedU : 0;

    // Trigger Jump / Bunny Hop before ground friction if buffered!
    let didBhopThisTick = false;
    if (this.grounded && this.jumpBuffer > 0) {
      const curSpd = Math.hypot(this.velU.x, this.velU.z);
      if (curSpd >= 195) {
        const boosted = Math.min(CS2_MOVE.BHOP_MAX_SPEED_U, curSpd * CS2_MOVE.BHOP_SPEED_BOOST);
        const factor = boosted / curSpd;
        this.velU.x *= factor;
        this.velU.z *= factor;
      }
      this.velU.y = CS2_MOVE.JUMP_SPEED_U;
      this.grounded = false;
      this.jumpBuffer = 0;
      this.landGraceTimer = 0;
      this.justJumped = true;
      didBhopThisTick = true;
    }

    if (this.grounded) {
      // Skip friction during brief landing bhop window so timed wheel/space hops keep speed
      if (this.landGraceTimer <= 0) {
        this._applyFriction(dt);
      }

      if (wishSpeed > 0) {
        const dot = this.velU.x * wishX + this.velU.z * wishZ;
        // Counter-strafing: pressing opposing movement direction brakes sharply
        const accel = dot < -8 ? CS2_MOVE.SV_COUNTER_STRAFE_ACCEL : CS2_MOVE.SV_ACCELERATE;
        this._accelerate(wishX, wishZ, wishSpeed, accel, dt);

        // Enforce ground speed cap
        const curSpd = Math.hypot(this.velU.x, this.velU.z);
        if (curSpd > maxSpeedU && this.landGraceTimer <= 0) {
          const cap = maxSpeedU / curSpd;
          this.velU.x *= cap;
          this.velU.z *= cap;
        }
      }
    } else {
      // Air-strafing & gravity
      if (!didBhopThisTick) {
        this.velU.y -= CS2_MOVE.GRAVITY_U * dt;
      } else {
        this.velU.y -= CS2_MOVE.GRAVITY_U * dt * 0.5;
      }
      if (wishSpeed > 0) {
        this._airAccelerate(wishX, wishZ, maxWeaponSpeedU, CS2_MOVE.SV_AIRACCELERATE, dt);
      }
    }

    const prevX = this.pos.x;
    const prevZ = this.pos.z;
    const wasGrounded = this.grounded;

    const dx = (this.velU.x / CS2_SOURCE_SCALE) * dt;
    const dz = (this.velU.z / CS2_SOURCE_SCALE) * dt;
    const dy = (this.velU.y / CS2_SOURCE_SCALE) * dt;

    this._tryMoveHorizontal(dx, dz, this.currentHeight, colliders);
    this._tryMoveVertical(dy, this.currentHeight, colliders);

    if (!wasGrounded && this.grounded) {
      this.landGraceTimer = CS2_MOVE.BHOP_LAND_GRACE;
    }

    // Footstep cadence (silent when Shift-walking or crouching)
    if (this.grounded && !this.walking && !this.crouching) {
      const moved = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
      if (this.getHorizSpeedU() > 95) {
        this.stepDistAccum += moved;
        if (this.stepDistAccum >= 2.15) {
          this.stepDistAccum = 0;
          this.justStepped = true;
        }
      } else {
        this.stepDistAccum = 0;
      }
    } else {
      this.stepDistAccum = 0;
    }
  }
}
