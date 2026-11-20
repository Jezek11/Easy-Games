import * as THREE from 'three';

const MAX_TRACERS = 32;
const MAX_SPARKS = 80;
const MAX_SPLINTERS = 96;
const MAX_FLASHES = 24;
const MAX_CHUNKS = 64;

const BUILD_IMPACT_PALETTES = {
  wood: [0xd9954c, 0xb87330, 0xf2c17d],
  brick: [0xc8563c, 0xa13f29, 0xdfd2c0],
  metal: [0x7ea1c0, 0x475569, 0xbae6fd]
};

const SHIELD_SHARDS_PALETTE = [0x38bdf8, 0x7dd3fc, 0xe0f2fe];

export class EffectPools {
  constructor(scene) {
    this.scene = scene;
    this.particleScale = 1.0;
    this.particlesEnabled = true;
    this.tracersEnabled = true;
    this._hasActive = false;

    // Reusable scratch objects (zero per-frame allocations)
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
    this._dir = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._placePalette = [0xd9954c, 0x7dd3fc];

    // 1. Pooled bullet tracers (1 draw call, additive luminous streak)
    const tracerGeo = new THREE.CylinderGeometry(0.022, 0.012, 1, 5, 1, true);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });
    this.tracerMesh = new THREE.InstancedMesh(tracerGeo, tracerMat, MAX_TRACERS);
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.setColorAt(0, this._color.setHex(0xffffff));
    this.tracerMesh.count = 0;
    this.tracerMesh.visible = false;
    this.scene.add(this.tracerMesh);

    this.tracers = new Array(MAX_TRACERS).fill(null).map(() => ({
      active: false,
      life: 0,
      maxLife: 0.095,
      mx: 0, my: 0, mz: 0,
      len: 1,
      qx: 0, qy: 0, qz: 0, qw: 1,
      hex: 0xffd166
    }));
    this.tracerCursor = 0;

    // 2. Pooled stretched additive sparks (1 draw call)
    const sparkGeo = new THREE.OctahedronGeometry(0.075, 0);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.setColorAt(0, this._color.setHex(0xffffff));
    this.sparkMesh.count = 0;
    this.sparkMesh.visible = false;
    this.scene.add(this.sparkMesh);

    this.sparks = new Array(MAX_SPARKS).fill(null).map(() => ({
      active: false,
      life: 0,
      maxLife: 0.28,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      scale: 1,
      hex: 0xffd166
    }));
    this.sparkCursor = 0;

    // 3. Pooled splinters / material chips (1 draw call)
    const splinterGeo = new THREE.BoxGeometry(0.06, 0.24, 0.04);
    const splinterMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.splinterMesh = new THREE.InstancedMesh(splinterGeo, splinterMat, MAX_SPLINTERS);
    this.splinterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splinterMesh.frustumCulled = false;
    this.splinterMesh.setColorAt(0, this._color.setHex(0xffffff));
    this.splinterMesh.count = 0;
    this.splinterMesh.visible = false;
    this.scene.add(this.splinterMesh);

    this.splinters = new Array(MAX_SPLINTERS).fill(null).map(() => ({
      active: false,
      life: 0,
      maxLife: 0.48,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      rx: 0, ry: 0, rz: 0,
      vrx: 0, vry: 0, vrz: 0,
      scale: 1,
      hex: 0xd9954c
    }));
    this.splinterCursor = 0;

    // 4. Pooled impact flashes (1 draw call)
    const flashGeo = new THREE.IcosahedronGeometry(0.2, 0);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.flashMesh = new THREE.InstancedMesh(flashGeo, flashMat, MAX_FLASHES);
    this.flashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flashMesh.frustumCulled = false;
    this.flashMesh.setColorAt(0, this._color.setHex(0xffffff));
    this.flashMesh.count = 0;
    this.flashMesh.visible = false;
    this.scene.add(this.flashMesh);

    this.flashes = new Array(MAX_FLASHES).fill(null).map(() => ({
      active: false,
      life: 0,
      maxLife: 0.1,
      x: 0, y: 0, z: 0,
      scale: 1,
      hex: 0xfff3b0
    }));
    this.flashCursor = 0;

    // 5. Pooled build destruction chunks (1 draw call)
    const chunkGeo = new THREE.BoxGeometry(0.45, 0.32, 0.18);
    const chunkMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.chunkMesh = new THREE.InstancedMesh(chunkGeo, chunkMat, MAX_CHUNKS);
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.setColorAt(0, this._color.setHex(0xffffff));
    this.chunkMesh.count = 0;
    this.chunkMesh.visible = false;
    this.scene.add(this.chunkMesh);

    this.chunks = new Array(MAX_CHUNKS).fill(null).map(() => ({
      active: false,
      life: 0,
      maxLife: 0.75,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      rx: 0, ry: 0, rz: 0,
      vrx: 0, vry: 0,
      hex: 0xc99356
    }));
    this.chunkCursor = 0;
  }

  setEffectsEnabled(particlesOn, tracersOn) {
    this.particlesEnabled = Boolean(particlesOn);
    this.tracersEnabled = Boolean(tracersOn);
    if (!this.particlesEnabled && !this.tracersEnabled) {
      this.clearAll();
      return;
    }
    if (!this.tracersEnabled) {
      for (let i = 0; i < MAX_TRACERS; i++) this.tracers[i].active = false;
      this.tracerMesh.count = 0;
      this.tracerMesh.visible = false;
    }
    if (!this.particlesEnabled) {
      for (let i = 0; i < MAX_SPARKS; i++) this.sparks[i].active = false;
      for (let i = 0; i < MAX_SPLINTERS; i++) this.splinters[i].active = false;
      for (let i = 0; i < MAX_FLASHES; i++) this.flashes[i].active = false;
      for (let i = 0; i < MAX_CHUNKS; i++) this.chunks[i].active = false;
      this.sparkMesh.count = 0;
      this.sparkMesh.visible = false;
      this.splinterMesh.count = 0;
      this.splinterMesh.visible = false;
      this.flashMesh.count = 0;
      this.flashMesh.visible = false;
      this.chunkMesh.count = 0;
      this.chunkMesh.visible = false;
    }
  }

  setParticleScale(scale) {
    this.particleScale = Math.max(0, Math.min(1.0, scale));
  }

  spawnTracer(startX, startY, startZ, endX, endY, endZ, hex = 0xffd166) {
    if (!this.tracersEnabled) return;
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS;

    this._dir.set(endX - startX, endY - startY, endZ - startZ);
    const dist = this._dir.length();
    if (dist < 0.05) return;

    this._dir.multiplyScalar(1 / dist);
    this._quat.setFromUnitVectors(this._up, this._dir);

    t.active = true;
    t.life = 0.095;
    t.maxLife = 0.095;
    t.mx = (startX + endX) * 0.5;
    t.my = (startY + endY) * 0.5;
    t.mz = (startZ + endZ) * 0.5;
    t.len = dist;
    t.qx = this._quat.x;
    t.qy = this._quat.y;
    t.qz = this._quat.z;
    t.qw = this._quat.w;
    t.hex = hex;
    this._hasActive = true;
  }

  spawnSparks(x, y, z, count = 6, hex = 0xffd166, speed = 5.5) {
    if (!this.particlesEnabled || this.particleScale <= 0) return;
    const actualCount = Math.max(1, Math.round(count * this.particleScale));
    for (let i = 0; i < actualCount; i++) {
      const s = this.sparks[this.sparkCursor];
      this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS;
      s.active = true;
      s.maxLife = 0.22 + Math.random() * 0.14;
      s.life = s.maxLife;
      s.x = x;
      s.y = y;
      s.z = z;
      s.vx = (Math.random() - 0.5) * speed * 2;
      s.vy = Math.random() * speed * 1.2 + 1.2;
      s.vz = (Math.random() - 0.5) * speed * 2;
      s.scale = 0.8 + Math.random() * 0.7;
      s.hex = hex;
    }
    this._hasActive = true;
  }

  spawnSplinters(x, y, z, count = 6, hexPalette = null, speed = 6.0) {
    if (!this.particlesEnabled || this.particleScale <= 0) return;
    const isArr = Array.isArray(hexPalette) && hexPalette.length > 0;
    const pLen = isArr ? hexPalette.length : 1;
    const fallbackHex = typeof hexPalette === 'number' ? hexPalette : 0xd9954c;
    const actualCount = Math.max(1, Math.round(count * this.particleScale));
    for (let i = 0; i < actualCount; i++) {
      const sp = this.splinters[this.splinterCursor];
      this.splinterCursor = (this.splinterCursor + 1) % MAX_SPLINTERS;
      sp.active = true;
      sp.maxLife = 0.36 + Math.random() * 0.24;
      sp.life = sp.maxLife;
      sp.x = x + (Math.random() - 0.5) * 0.18;
      sp.y = y + (Math.random() - 0.5) * 0.18;
      sp.z = z + (Math.random() - 0.5) * 0.18;
      sp.vx = (Math.random() - 0.5) * speed * 2.1;
      sp.vy = 1.6 + Math.random() * speed * 0.95;
      sp.vz = (Math.random() - 0.5) * speed * 2.1;
      sp.rx = Math.random() * Math.PI * 2;
      sp.ry = Math.random() * Math.PI * 2;
      sp.rz = Math.random() * Math.PI * 2;
      sp.vrx = (Math.random() - 0.5) * 16;
      sp.vry = (Math.random() - 0.5) * 16;
      sp.vrz = (Math.random() - 0.5) * 16;
      sp.scale = 0.75 + Math.random() * 0.7;
      sp.hex = isArr ? hexPalette[i % pLen] : fallbackHex;
    }
    this._hasActive = true;
  }

  spawnImpactFlash(x, y, z, hex = 0xfff3b0, scale = 1.0) {
    if (!this.particlesEnabled || this.particleScale <= 0) return;
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % MAX_FLASHES;
    f.active = true;
    f.maxLife = 0.1;
    f.life = f.maxLife;
    f.x = x;
    f.y = y;
    f.z = z;
    f.scale = scale;
    f.hex = hex;
    this._hasActive = true;
  }

  spawnBuildImpact(x, y, z, matId = 'wood', intensity = 1.0) {
    if (!this.particlesEnabled || this.particleScale <= 0) return;
    const k = matId === 'brick' ? 'brick' : (matId === 'metal' ? 'metal' : 'wood');
    const palette = BUILD_IMPACT_PALETTES[k];

    if (k === 'metal') {
      this.spawnSparks(x, y, z, Math.round(6 * intensity), 0xfff3b0, 7.2);
      this.spawnSparks(x, y, z, Math.round(3 * intensity), 0x7dd3fc, 6.2);
      this.spawnSplinters(x, y, z, Math.round(4 * intensity), palette, 5.4);
      this.spawnImpactFlash(x, y, z, 0xfff3b0, 1.15 * intensity);
    } else if (k === 'brick') {
      this.spawnSplinters(x, y, z, Math.round(6 * intensity), palette, 5.8);
      this.spawnSparks(x, y, z, Math.round(3 * intensity), 0xfdba74, 4.4);
      this.spawnImpactFlash(x, y, z, 0xffedd5, 0.75 * intensity);
    } else {
      this.spawnSplinters(x, y, z, Math.round(6 * intensity), palette, 6.0);
      this.spawnSparks(x, y, z, Math.round(3 * intensity), 0xfde68a, 4.2);
      this.spawnImpactFlash(x, y, z, 0xfef3c7, 0.72 * intensity);
    }
  }

  spawnPlayerImpact(x, y, z, hadShield = false, isHeadshot = false) {
    if (!this.particlesEnabled || this.particleScale <= 0) return;
    if (hadShield) {
      this.spawnSplinters(x, y, z, isHeadshot ? 7 : 5, SHIELD_SHARDS_PALETTE, 6.6);
      this.spawnSparks(x, y, z, isHeadshot ? 8 : 6, 0x38bdf8, 6.8);
      this.spawnImpactFlash(x, y, z, 0x7dd3fc, isHeadshot ? 1.45 : 1.1);
    } else {
      this.spawnSparks(x, y, z, isHeadshot ? 9 : 6, 0xff4d6d, 6.4);
      this.spawnSparks(x, y, z, isHeadshot ? 6 : 3, 0xfacc15, 7.2);
      this.spawnImpactFlash(x, y, z, isHeadshot ? 0xfef08a : 0xff4d6d, isHeadshot ? 1.4 : 1.0);
    }
  }

  spawnBuildPlaceBurst(cx, cy, cz, matColor = 0xd9954c) {
    if (!this.particlesEnabled || this.particleScale <= 0) return;
    this.spawnSparks(cx, cy, cz, 5, 0x38bdf8, 4.4);
    this._placePalette[0] = matColor;
    this._placePalette[1] = 0x7dd3fc;
    this.spawnSplinters(cx, cy, cz, 3, this._placePalette, 3.8);
  }

  spawnBuildChunks(cx, cy, cz, hex = 0xc99356, count = 10) {
    if (!this.particlesEnabled || this.particleScale <= 0) return;
    const actualCount = Math.max(2, Math.round(count * this.particleScale));
    for (let i = 0; i < actualCount; i++) {
      const c = this.chunks[this.chunkCursor];
      this.chunkCursor = (this.chunkCursor + 1) % MAX_CHUNKS;
      c.active = true;
      c.maxLife = 0.55 + Math.random() * 0.35;
      c.life = c.maxLife;
      c.x = cx + (Math.random() - 0.5) * 2.2;
      c.y = cy + (Math.random() - 0.5) * 1.6;
      c.z = cz + (Math.random() - 0.5) * 2.2;
      c.vx = (Math.random() - 0.5) * 7.5;
      c.vy = 2.0 + Math.random() * 5.0;
      c.vz = (Math.random() - 0.5) * 7.5;
      c.rx = Math.random() * Math.PI;
      c.ry = Math.random() * Math.PI;
      c.rz = Math.random() * Math.PI;
      c.vrx = (Math.random() - 0.5) * 9;
      c.vry = (Math.random() - 0.5) * 9;
      c.hex = hex;
    }
    this._hasActive = true;
  }

  clearAll() {
    for (let i = 0; i < MAX_TRACERS; i++) this.tracers[i].active = false;
    for (let i = 0; i < MAX_SPARKS; i++) this.sparks[i].active = false;
    for (let i = 0; i < MAX_SPLINTERS; i++) this.splinters[i].active = false;
    for (let i = 0; i < MAX_FLASHES; i++) this.flashes[i].active = false;
    for (let i = 0; i < MAX_CHUNKS; i++) this.chunks[i].active = false;
    this.tracerMesh.count = 0;
    this.tracerMesh.visible = false;
    this.sparkMesh.count = 0;
    this.sparkMesh.visible = false;
    this.splinterMesh.count = 0;
    this.splinterMesh.visible = false;
    this.flashMesh.count = 0;
    this.flashMesh.visible = false;
    this.chunkMesh.count = 0;
    this.chunkMesh.visible = false;
    this._hasActive = false;
  }

  update(dt) {
    if (!this._hasActive) return;
    if (!this.particlesEnabled && !this.tracersEnabled) {
      this.clearAll();
      return;
    }

    // 1. Update tracers
    let tCount = 0;
    if (this.tracersEnabled) {
      for (let i = 0; i < MAX_TRACERS; i++) {
        const t = this.tracers[i];
        if (!t.active) continue;
        t.life -= dt;
        if (t.life <= 0) {
          t.active = false;
          continue;
        }
        const w = Math.max(0.25, t.life / t.maxLife);
        this._dummy.position.set(t.mx, t.my, t.mz);
        this._dummy.quaternion.set(t.qx, t.qy, t.qz, t.qw);
        this._dummy.scale.set(w, t.len, w);
        this._dummy.updateMatrix();
        this.tracerMesh.setMatrixAt(tCount, this._dummy.matrix);
        this.tracerMesh.setColorAt(tCount, this._color.setHex(t.hex));
        tCount++;
      }
      this.tracerMesh.count = tCount;
      this.tracerMesh.visible = tCount > 0;
      if (tCount > 0) {
        this.tracerMesh.instanceMatrix.needsUpdate = true;
        if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;
      }
    }

    // 2. Update stretched luminous sparks
    let sCount = 0;
    let spCount = 0;
    let fCount = 0;
    let cCount = 0;
    if (this.particlesEnabled) {
      for (let i = 0; i < MAX_SPARKS; i++) {
        const s = this.sparks[i];
        if (!s.active) continue;
        s.life -= dt;
        if (s.life <= 0) {
          s.active = false;
          continue;
        }
        s.vy -= 18 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
        const sc = s.scale * (s.life / s.maxLife);
        this._dummy.position.set(s.x, s.y, s.z);
        this._dir.set(s.vx, s.vy, s.vz);
        const vLen = this._dir.length();
        if (vLen > 0.05) {
          this._dir.multiplyScalar(1 / vLen);
          this._dummy.quaternion.setFromUnitVectors(this._up, this._dir);
        } else {
          this._dummy.quaternion.identity();
        }
        this._dummy.scale.set(sc * 0.75, sc * 2.6, sc * 0.75);
        this._dummy.updateMatrix();
        this.sparkMesh.setMatrixAt(sCount, this._dummy.matrix);
        this.sparkMesh.setColorAt(sCount, this._color.setHex(s.hex));
        sCount++;
      }
      this.sparkMesh.count = sCount;
      this.sparkMesh.visible = sCount > 0;
      if (sCount > 0) {
        this.sparkMesh.instanceMatrix.needsUpdate = true;
        if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
      }

      // 3. Update splinters / material chips
      for (let i = 0; i < MAX_SPLINTERS; i++) {
        const sp = this.splinters[i];
        if (!sp.active) continue;
        sp.life -= dt;
        if (sp.life <= 0) {
          sp.active = false;
          continue;
        }
        sp.vy -= 22 * dt;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.z += sp.vz * dt;
        if (sp.y < 0.06) {
          sp.y = 0.06;
          sp.vy = Math.abs(sp.vy) * 0.35;
          sp.vx *= 0.7;
          sp.vz *= 0.7;
        }
        sp.rx += sp.vrx * dt;
        sp.ry += sp.vry * dt;
        sp.rz += sp.vrz * dt;
        const sc = sp.scale * Math.min(1, (sp.life / sp.maxLife) * 1.6);
        this._dummy.position.set(sp.x, sp.y, sp.z);
        this._dummy.rotation.set(sp.rx, sp.ry, sp.rz);
        this._dummy.scale.set(sc, sc, sc);
        this._dummy.updateMatrix();
        this.splinterMesh.setMatrixAt(spCount, this._dummy.matrix);
        this.splinterMesh.setColorAt(spCount, this._color.setHex(sp.hex));
        spCount++;
      }
      this.splinterMesh.count = spCount;
      this.splinterMesh.visible = spCount > 0;
      if (spCount > 0) {
        this.splinterMesh.instanceMatrix.needsUpdate = true;
        if (this.splinterMesh.instanceColor) this.splinterMesh.instanceColor.needsUpdate = true;
      }

      // 4. Update impact flashes
      for (let i = 0; i < MAX_FLASHES; i++) {
        const f = this.flashes[i];
        if (!f.active) continue;
        f.life -= dt;
        if (f.life <= 0) {
          f.active = false;
          continue;
        }
        const p = 1 - f.life / f.maxLife;
        const sc = f.scale * (0.45 + p * 1.45) * (1 - p * 0.55);
        this._dummy.position.set(f.x, f.y, f.z);
        this._dummy.quaternion.identity();
        this._dummy.scale.set(sc, sc, sc);
        this._dummy.updateMatrix();
        this.flashMesh.setMatrixAt(fCount, this._dummy.matrix);
        this.flashMesh.setColorAt(fCount, this._color.setHex(f.hex));
        fCount++;
      }
      this.flashMesh.count = fCount;
      this.flashMesh.visible = fCount > 0;
      if (fCount > 0) {
        this.flashMesh.instanceMatrix.needsUpdate = true;
        if (this.flashMesh.instanceColor) this.flashMesh.instanceColor.needsUpdate = true;
      }

      // 5. Update build destruction chunks
      for (let i = 0; i < MAX_CHUNKS; i++) {
        const c = this.chunks[i];
        if (!c.active) continue;
        c.life -= dt;
        if (c.life <= 0) {
          c.active = false;
          continue;
        }
        c.vy -= 22 * dt;
        c.x += c.vx * dt;
        c.y = Math.max(0.15, c.y + c.vy * dt);
        c.z += c.vz * dt;
        c.rx += c.vrx * dt;
        c.ry += c.vry * dt;
        const sc = Math.min(1, (c.life / c.maxLife) * 1.4);
        this._dummy.position.set(c.x, c.y, c.z);
        this._dummy.rotation.set(c.rx, c.ry, c.rz);
        this._dummy.scale.set(sc, sc, sc);
        this._dummy.updateMatrix();
        this.chunkMesh.setMatrixAt(cCount, this._dummy.matrix);
        this.chunkMesh.setColorAt(cCount, this._color.setHex(c.hex));
        cCount++;
      }
      this.chunkMesh.count = cCount;
      this.chunkMesh.visible = cCount > 0;
      if (cCount > 0) {
        this.chunkMesh.instanceMatrix.needsUpdate = true;
        if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;
      }
    }

    this._hasActive = (tCount + sCount + spCount + fCount + cCount) > 0;
  }

  dispose() {
    this.clearAll();
    const meshes = [this.tracerMesh, this.sparkMesh, this.splinterMesh, this.flashMesh, this.chunkMesh];
    for (const m of meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
