import * as THREE from 'three';

const MAX_DECALS_HIGH = 96;
const MAX_DECALS_MED = 48;
const MAX_TRACERS = 28;
const MAX_SPARKS = 64;

export class CS2Effects {
  constructor(scene, textureMgr) {
    this.scene = scene;
    this.textureMgr = textureMgr;
    this.quality = 'medium';
    this.maxDecals = MAX_DECALS_MED;

    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
    this._zFwd = new THREE.Vector3(0, 0, 1);
    this._dir = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._quat = new THREE.Quaternion();

    // 1. Pooled Bullet Hole Decals (InstancedMesh ring buffer, zero z-fighting)
    const decalGeo = new THREE.PlaneGeometry(0.16, 0.16);
    const decalMat = new THREE.MeshBasicMaterial({
      map: textureMgr.getBulletHoleTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    this.decalMesh = new THREE.InstancedMesh(decalGeo, decalMat, MAX_DECALS_HIGH);
    this.decalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decalMesh.frustumCulled = false;
    this.decalMesh.count = 0;
    this.decalMesh.visible = false;
    this.scene.add(this.decalMesh);
    this._decalCount = 0;
    this._decalCursor = 0;

    // 2. Pooled Bullet Tracers
    const tracerGeo = new THREE.CylinderGeometry(0.016, 0.008, 1, 5, 1, true);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
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
    this._tracers = new Array(MAX_TRACERS).fill(null).map(() => ({
      active: false,
      life: 0,
      maxLife: 0.08,
      mx: 0, my: 0, mz: 0,
      len: 1,
      qx: 0, qy: 0, qz: 0, qw: 1,
      hex: 0xfef08a
    }));
    this._tracerCursor = 0;

    // 3. Pooled Impact Sparks
    const sparkGeo = new THREE.OctahedronGeometry(0.055, 0);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
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
    this._sparks = new Array(MAX_SPARKS).fill(null).map(() => ({
      active: false,
      life: 0,
      maxLife: 0.2,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      scale: 1,
      hex: 0xffd166
    }));
    this._sparkCursor = 0;

    // 4. World-space Muzzle Flash Sprite (for bots & peers)
    const flashGeo = new THREE.PlaneGeometry(0.46, 0.46);
    const flashMat = new THREE.MeshBasicMaterial({
      map: textureMgr.getMuzzleFlashTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    });
    this.worldFlashMesh = new THREE.Mesh(flashGeo, flashMat);
    this.worldFlashMesh.visible = false;
    this.scene.add(this.worldFlashMesh);
    this._worldFlashLife = 0;
  }

  applyQuality(quality) {
    this.quality = quality === 'low' ? 'low' : (quality === 'high' ? 'high' : 'medium');
    if (this.quality === 'low') {
      this.maxDecals = 0;
      this.clearRound();
    } else if (this.quality === 'medium') {
      this.maxDecals = MAX_DECALS_MED;
      if (this._decalCount > this.maxDecals) {
        this._decalCount = this.maxDecals;
        this.decalMesh.count = this._decalCount;
      }
      this._decalCursor %= this.maxDecals;
    } else {
      this.maxDecals = MAX_DECALS_HIGH;
    }
  }

  spawnBulletHole(x, y, z, nx, ny, nz) {
    if (this.quality === 'low' || this.maxDecals <= 0) return;

    this._normal.set(nx, ny, nz).normalize();
    this._quat.setFromUnitVectors(this._zFwd, this._normal);
    // Slight random roll so bullet holes don't look identical
    const roll = new THREE.Quaternion().setFromAxisAngle(this._zFwd, Math.random() * Math.PI * 2);
    this._quat.multiply(roll);

    this._dummy.position.set(
      x + this._normal.x * 0.015,
      y + this._normal.y * 0.015,
      z + this._normal.z * 0.015
    );
    this._dummy.quaternion.copy(this._quat);
    const sc = 0.8 + Math.random() * 0.45;
    this._dummy.scale.set(sc, sc, 1);
    this._dummy.updateMatrix();

    const idx = this._decalCursor;
    this._decalCursor = (this._decalCursor + 1) % this.maxDecals;
    this._decalCount = Math.min(this.maxDecals, this._decalCount + 1);

    this.decalMesh.setMatrixAt(idx, this._dummy.matrix);
    this.decalMesh.count = this._decalCount;
    this.decalMesh.visible = true;
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  spawnTracer(ox, oy, oz, hx, hy, hz, hex = 0xfef08a) {
    if (this.quality === 'low') return;
    this._dir.set(hx - ox, hy - oy, hz - oz);
    const len = this._dir.length();
    if (len < 0.15) return;
    this._dir.multiplyScalar(1 / len);
    this._quat.setFromUnitVectors(this._up, this._dir);

    const t = this._tracers[this._tracerCursor];
    this._tracerCursor = (this._tracerCursor + 1) % MAX_TRACERS;
    t.active = true;
    t.life = 0.075;
    t.maxLife = 0.075;
    t.mx = (ox + hx) * 0.5;
    t.my = (oy + hy) * 0.5;
    t.mz = (oz + hz) * 0.5;
    t.len = len;
    t.qx = this._quat.x;
    t.qy = this._quat.y;
    t.qz = this._quat.z;
    t.qw = this._quat.w;
    t.hex = hex;
  }

  spawnSparks(x, y, z, count = 4, hex = 0xffd166, speed = 5.0) {
    if (this.quality === 'low') return;
    const actual = this.quality === 'medium' ? Math.max(1, Math.round(count * 0.5)) : count;
    for (let i = 0; i < actual; i++) {
      const s = this._sparks[this._sparkCursor];
      this._sparkCursor = (this._sparkCursor + 1) % MAX_SPARKS;
      s.active = true;
      s.maxLife = 0.16 + Math.random() * 0.12;
      s.life = s.maxLife;
      s.x = x;
      s.y = y;
      s.z = z;
      s.vx = (Math.random() - 0.5) * speed * 1.8;
      s.vy = Math.random() * speed * 1.1 + 0.8;
      s.vz = (Math.random() - 0.5) * speed * 1.8;
      s.scale = 0.7 + Math.random() * 0.6;
      s.hex = hex;
    }
  }

  spawnWorldMuzzleFlash(x, y, z, camera) {
    if (this.quality === 'low') return;
    this.worldFlashMesh.position.set(x, y, z);
    if (camera) this.worldFlashMesh.quaternion.copy(camera.quaternion);
    this.worldFlashMesh.rotateZ(Math.random() * Math.PI * 2);
    this.worldFlashMesh.visible = true;
    this._worldFlashLife = 0.045;
  }

  clearRound() {
    this._decalCount = 0;
    this._decalCursor = 0;
    this.decalMesh.count = 0;
    this.decalMesh.visible = false;

    for (let i = 0; i < MAX_TRACERS; i++) this._tracers[i].active = false;
    for (let i = 0; i < MAX_SPARKS; i++) this._sparks[i].active = false;
    this.tracerMesh.count = 0;
    this.tracerMesh.visible = false;
    this.sparkMesh.count = 0;
    this.sparkMesh.visible = false;
    this.worldFlashMesh.visible = false;
    this._worldFlashLife = 0;
  }

  update(dt) {
    if (this._worldFlashLife > 0) {
      this._worldFlashLife -= dt;
      if (this._worldFlashLife <= 0) {
        this.worldFlashMesh.visible = false;
      }
    }

    let tCount = 0;
    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this._tracers[i];
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

    let sCount = 0;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const s = this._sparks[i];
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
      this._dummy.quaternion.identity();
      this._dummy.scale.set(sc, sc * 1.4, sc);
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
  }

  dispose() {
    this.clearRound();
    const list = [this.decalMesh, this.tracerMesh, this.sparkMesh, this.worldFlashMesh];
    for (const m of list) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
