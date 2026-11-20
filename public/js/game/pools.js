import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_SPARKS = 48;
const MAX_CHUNKS = 64;

export class EffectPools {
  constructor(scene) {
    this.scene = scene;
    this.particleScale = 1.0;
    this._hasActive = false;

    // Reusable scratch objects (zero per-frame allocations)
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
    this._dir = new THREE.Vector3();
    this._mid = new THREE.Vector3();
    this._quat = new THREE.Quaternion();

    // 1. Pooled bullet tracers (1 draw call)
    const tracerGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 4, 1, true);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    this.tracerMesh = new THREE.InstancedMesh(tracerGeo, tracerMat, MAX_TRACERS);
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.setColorAt(0, this._color.setHex(0xffffff));
    this.tracerMesh.count = 0;
    this.scene.add(this.tracerMesh);

    this.tracers = new Array(MAX_TRACERS).fill(null).map(() => ({
      active: false,
      life: 0,
      maxLife: 0.09,
      mx: 0, my: 0, mz: 0,
      len: 1,
      qx: 0, qy: 0, qz: 0, qw: 1,
      hex: 0xffd166
    }));
    this.tracerCursor = 0;

    // 2. Pooled impact sparks (1 draw call)
    const sparkGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.setColorAt(0, this._color.setHex(0xffffff));
    this.sparkMesh.count = 0;
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

    // 3. Pooled build destruction chunks (1 draw call, cheap BasicMaterial)
    const chunkGeo = new THREE.BoxGeometry(0.45, 0.32, 0.18);
    const chunkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.chunkMesh = new THREE.InstancedMesh(chunkGeo, chunkMat, MAX_CHUNKS);
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.setColorAt(0, this._color.setHex(0xffffff));
    this.chunkMesh.count = 0;
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

  setParticleScale(scale) {
    this.particleScale = Math.max(0.2, Math.min(1.0, scale));
  }

  spawnTracer(startX, startY, startZ, endX, endY, endZ, hex = 0xffd166) {
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS;

    this._dir.set(endX - startX, endY - startY, endZ - startZ);
    const dist = this._dir.length();
    if (dist < 0.05) return;

    this._dir.multiplyScalar(1 / dist);
    this._quat.setFromUnitVectors(this._up, this._dir);

    t.active = true;
    t.life = 0.085;
    t.maxLife = 0.085;
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

  spawnBuildChunks(cx, cy, cz, hex = 0xc99356, count = 10) {
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
    for (let i = 0; i < MAX_CHUNKS; i++) this.chunks[i].active = false;
    this.tracerMesh.count = 0;
    this.sparkMesh.count = 0;
    this.chunkMesh.count = 0;
    this._hasActive = false;
  }

  update(dt) {
    if (!this._hasActive) return;
    // 1. Update tracers
    let tCount = 0;
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
    if (tCount > 0) {
      this.tracerMesh.instanceMatrix.needsUpdate = true;
      if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;
    }

    // 2. Update sparks
    let sCount = 0;
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
      this._dummy.rotation.set(0, 0, 0);
      this._dummy.scale.set(sc, sc, sc);
      this._dummy.updateMatrix();
      this.sparkMesh.setMatrixAt(sCount, this._dummy.matrix);
      this.sparkMesh.setColorAt(sCount, this._color.setHex(s.hex));
      sCount++;
    }
    this.sparkMesh.count = sCount;
    if (sCount > 0) {
      this.sparkMesh.instanceMatrix.needsUpdate = true;
      if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
    }

    // 3. Update chunks
    let cCount = 0;
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
    if (cCount > 0) {
      this.chunkMesh.instanceMatrix.needsUpdate = true;
      if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;
    }
    this._hasActive = (tCount + sCount + cCount) > 0;
  }
}
