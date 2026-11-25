import * as THREE from 'three';
import { getStructureGeo, onStructuresLoaded } from './structureAssets.js';
import { getBuildMaterialTextures } from './textures.js';
import { isCustomModelEnabled } from './modelLoader.js';
import {
  ARENA_HALF_GRID,
  BUILD_MATERIALS,
  BUILD_TYPES,
  CELL_SIZE,
  FLOOR_THICKNESS,
  MAX_BUILD_LEVEL,
  RAMP_THICKNESS,
  SLOPE_ANGLE,
  SLOPE_LEN,
  WALL_HEIGHT,
  WALL_THICKNESS
} from './constants.js';
import { isBuildSupported } from './physics.js';

const MAX_FULL_PER_MAT = 280;
const MAX_TILES_PER_MAT = 260;
const PART_KEYS = ['wallFull', 'wallTile', 'floorFull', 'floorTile', 'rampFull', 'rampHalf'];
const MAX_RECYCLED_RECORDS = 600;

function easeOutBuild(t) {
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  const c1 = 1.05;
  const c3 = c1 + 1;
  const u = t - 1;
  return Math.min(1.035, 1 + c3 * u * u * u + c1 * u * u);
}

export function makeBuildKey(type, gx, gy, gz, dir = 0) {
  if (type === BUILD_TYPES.WALL) return `w:${gx}:${gy}:${gz}:${dir}`;
  if (type === BUILD_TYPES.FLOOR) return `f:${gx}:${gy}:${gz}`;
  return `r:${gx}:${gy}:${gz}`;
}

export function getDefaultMask(type) {
  if (type === BUILD_TYPES.WALL) return 0x1ff; // 9 bits
  if (type === BUILD_TYPES.FLOOR) return 0xf;  // 4 bits
  return 0x3; // 2 bits (left/right half ramp)
}

export function getBuildWorldCenter(build, outVec) {
  if (build.type === BUILD_TYPES.WALL) {
    if (build.dir === 0) {
      outVec.set((build.gx + 0.5) * CELL_SIZE, (build.gy + 0.5) * WALL_HEIGHT, build.gz * CELL_SIZE);
    } else {
      outVec.set(build.gx * CELL_SIZE, (build.gy + 0.5) * WALL_HEIGHT, (build.gz + 0.5) * CELL_SIZE);
    }
  } else if (build.type === BUILD_TYPES.FLOOR) {
    const y = build.gy === 0 ? 0.08 : build.gy * WALL_HEIGHT;
    outVec.set((build.gx + 0.5) * CELL_SIZE, y, (build.gz + 0.5) * CELL_SIZE);
  } else {
    outVec.set((build.gx + 0.5) * CELL_SIZE, (build.gy + 0.5) * WALL_HEIGHT, (build.gz + 0.5) * CELL_SIZE);
  }
  return outVec;
}

export class BuildingSystem {
  _applyBlenderStructures() {
    if (!isCustomModelEnabled('structures')) return;
    const prefixMap = { wood: 'Wood', brick: 'Brick', metal: 'Metal' };
    const slotSuffix = {
      wallFull: 'Wall_%_Full',
      wallTile: 'Wall_%_Tile',
      floorFull: 'Floor_%_Full',
      floorTile: 'Floor_%_Tile',
      rampFull: 'Ramp_%_Full',
      rampHalf: 'Ramp_%_Half'
    };
    let swappedAny = false;
    for (const [matId, bucket] of Object.entries(this.buckets)) {
      const prefix = prefixMap[matId];
      if (!prefix) continue;
      let allReady = true;
      const geos = {};
      for (const [slot, pat] of Object.entries(slotSuffix)) {
        const g = getStructureGeo(pat.replace('%', prefix));
        if (!g || !g.attributes?.color) {
          allReady = false;
          break;
        }
        geos[slot] = g;
      }
      if (!allReady) continue;
      for (let k = 0; k < PART_KEYS.length; k++) {
        const slot = PART_KEYS[k];
        bucket[slot].geometry = geos[slot];
      }
      bucket.mats.medium.map = null;
      bucket.mats.medium.vertexColors = true;
      bucket.mats.medium.needsUpdate = true;
      bucket.mats.high.map = null;
      bucket.mats.high.bumpMap = null;
      bucket.mats.high.roughnessMap = null;
      bucket.mats.high.vertexColors = true;
      bucket.mats.high.needsUpdate = true;
      swappedAny = true;
    }
    if (swappedAny) {
      this._customStructActive = true;
      this.setQuality(this._qualityKey);
      this.dirty = true;
    }
  }

  constructor(scene, pools) {
    this.scene = scene;
    this.pools = pools;
    this.builds = new Map(); // key -> BuildRecord
    this._buildList = [];
    this.spatialGrid = new Map(); // packed cellKey -> BuildRecord[]
    this._cellArrayPool = [];
    this.animatingKeys = new Set();
    this._recordPool = [];
    this._customStructActive = false;
    this._qualityKey = 'medium';
    this.dirty = false;
    this._structBasicMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });

    // Blueprint dirty-skip cache
    this._bpVisible = false;
    this._bpKey = '';
    this._bpRot = -1;
    this._bpCanPlace = true;

    // Reusable math scratch objects (zero GC)
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._blueprintColor = new THREE.Color(0x5ce1ff);
    this._pulseColor = new THREE.Color(0xffffff);
    this._tmpVec = new THREE.Vector3();
    this._offsetVec = new THREE.Vector3();
    this._placementScratch = { type: '', gx: 0, gy: 0, gz: 0, dir: 0, rot: 0, key: '' };

    // Shared geometries
    this.geos = {
      wallFull: new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, WALL_THICKNESS),
      wallTile: new THREE.BoxGeometry(CELL_SIZE / 3, WALL_HEIGHT / 3, WALL_THICKNESS),
      floorFull: new THREE.BoxGeometry(CELL_SIZE, FLOOR_THICKNESS, CELL_SIZE),
      floorTile: new THREE.BoxGeometry(CELL_SIZE / 2, FLOOR_THICKNESS, CELL_SIZE / 2),
      rampFull: new THREE.BoxGeometry(CELL_SIZE, RAMP_THICKNESS, SLOPE_LEN),
      rampHalf: new THREE.BoxGeometry(CELL_SIZE / 2, RAMP_THICKNESS, SLOPE_LEN)
    };

    // InstancedMesh buckets per material (wood / brick / metal) with 3-tier quality materials
    this.buckets = {};
    this._bucketEntries = [];
    this._bucketLookup = {};
    for (const matId of Object.keys(BUILD_MATERIALS)) {
      const matDef = BUILD_MATERIALS[matId];
      const textures = getBuildMaterialTextures(matId);
      const mats = {
        low: new THREE.MeshBasicMaterial({ color: matDef.color }),
        medium: new THREE.MeshLambertMaterial({ color: 0xffffff, map: textures.map }),
        high: new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: textures.map,
          bumpMap: textures.bumpMap,
          bumpScale: matId === 'brick' ? 0.055 : 0.04,
          roughnessMap: textures.roughnessMap || null,
          roughness: matId === 'metal' ? 0.55 : (matId === 'brick' ? 0.88 : 0.82),
          metalness: matId === 'metal' ? 0.52 : 0.02
        })
      };
      const sharedMat = mats.medium;

      const makeMesh = (geo, maxCount) => {
        const im = new THREE.InstancedMesh(geo, sharedMat, maxCount);
        im.frustumCulled = true;
        im.castShadow = true;
        im.receiveShadow = true;
        im.setColorAt(0, new THREE.Color(0xffffff));
        im.count = 0;
        im.visible = false;
        this.scene.add(im);
        return im;
      };

      const bucket = {
        material: sharedMat,
        mats,
        texture: textures.map,
        wallFull: makeMesh(this.geos.wallFull, MAX_FULL_PER_MAT),
        wallTile: makeMesh(this.geos.wallTile, MAX_TILES_PER_MAT),
        floorFull: makeMesh(this.geos.floorFull, MAX_FULL_PER_MAT),
        floorTile: makeMesh(this.geos.floorTile, MAX_TILES_PER_MAT),
        rampFull: makeMesh(this.geos.rampFull, MAX_FULL_PER_MAT),
        rampHalf: makeMesh(this.geos.rampHalf, MAX_FULL_PER_MAT)
      };
      this.buckets[matId] = bucket;
      const entry = {
        matId,
        bucket,
        counts: {
          wallFull: 0,
          wallTile: 0,
          floorFull: 0,
          floorTile: 0,
          rampFull: 0,
          rampHalf: 0
        }
      };
      this._bucketEntries.push(entry);
      this._bucketLookup[matId] = entry;
    }

    this._unsubStructures = onStructuresLoaded(() => this._applyBlenderStructures());

    // Transparent blue blueprint preview
    this.blueprintMatValid = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
    });
    this.blueprintMatInvalid = new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
    });
    this.blueprintEdgeMat = new THREE.LineBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.9
    });

    this.blueprintGroup = new THREE.Group();
    this.blueprintMeshes = {
      [BUILD_TYPES.WALL]: this._makeBlueprintMesh(this.geos.wallFull),
      [BUILD_TYPES.FLOOR]: this._makeBlueprintMesh(this.geos.floorFull),
      [BUILD_TYPES.RAMP]: this._makeBlueprintMesh(this.geos.rampFull)
    };
    for (const m of Object.values(this.blueprintMeshes)) {
      m.visible = false;
      this.blueprintGroup.add(m);
    }
    this.blueprintGroup.visible = false;
    this.scene.add(this.blueprintGroup);

    // Edit Mode 3D overlay tile group (up to 9 tiles)
    this.editOverlayGroup = new THREE.Group();
    this.editOverlayGroup.visible = false;
    this.editOverlayGroup.renderOrder = 10;
    this.editTiles = [];
    this.editTileMats = {
      kept: new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
      cut: new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
      hover: new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.72, depthWrite: false, depthTest: false, side: THREE.DoubleSide })
    };
    const editTileGeo = new THREE.PlaneGeometry(1, 1);
    const borderMat = new THREE.LineBasicMaterial({ color: 0xe0f2fe, depthTest: false });
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(editTileGeo, this.editTileMats.kept);
      m.renderOrder = 10;
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(editTileGeo),
        borderMat
      );
      border.renderOrder = 11;
      m.add(border);
      m.visible = false;
      this.editOverlayGroup.add(m);
      this.editTiles.push(m);
    }
    this.scene.add(this.editOverlayGroup);
  }

  _makeBlueprintMesh(geo) {
    const mesh = new THREE.Mesh(geo, this.blueprintMatValid);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.blueprintEdgeMat);
    mesh.add(edges);
    return mesh;
  }

  setQuality(qualityKey) {
    const tier = qualityKey === 'low' ? 'low' : (qualityKey === 'high' ? 'high' : 'medium');
    this._qualityKey = tier;
    const shadows = qualityKey !== 'low';
    for (let i = 0; i < this._bucketEntries.length; i++) {
      const b = this._bucketEntries[i].bucket;
      if (this._customStructActive) {
        b.material = tier === 'low' ? this._structBasicMat : b.mats[tier];
      } else {
        b.material = b.mats[tier];
      }
      for (let k = 0; k < PART_KEYS.length; k++) {
        const m = b[PART_KEYS[k]];
        m.material = b.material;
        m.castShadow = shadows;
        m.receiveShadow = shadows;
      }
      b.material.needsUpdate = true;
    }
  }

  _cellKey(gx, gz) {
    return ((gx + 64) & 0xff) | (((gz + 64) & 0xff) << 8);
  }

  _gridAdd(cellKey, record) {
    let arr = this.spatialGrid.get(cellKey);
    if (!arr) {
      arr = this._cellArrayPool.length > 0 ? this._cellArrayPool.pop() : [];
      this.spatialGrid.set(cellKey, arr);
    }
    arr.push(record);
  }

  _gridRemove(cellKey, record) {
    const arr = this.spatialGrid.get(cellKey);
    if (!arr) return;
    const idx = arr.indexOf(record);
    if (idx !== -1) {
      const last = arr.pop();
      if (idx < arr.length) arr[idx] = last;
    }
    if (arr.length === 0) {
      this.spatialGrid.delete(cellKey);
      if (this._cellArrayPool.length < 256) this._cellArrayPool.push(arr);
    }
  }

  _indexBuild(record) {
    record._listIdx = this._buildList.length;
    record._visitId = 0;
    this._buildList.push(record);
    this._gridAdd(this._cellKey(record.gx, record.gz), record);
    if (record.type === BUILD_TYPES.WALL) {
      if (record.dir === 0) {
        this._gridAdd(this._cellKey(record.gx, record.gz - 1), record);
      } else {
        this._gridAdd(this._cellKey(record.gx - 1, record.gz), record);
      }
    }
  }

  _unindexBuild(record) {
    const idx = record._listIdx;
    if (idx >= 0 && idx < this._buildList.length && this._buildList[idx] === record) {
      const last = this._buildList.pop();
      if (idx < this._buildList.length) {
        this._buildList[idx] = last;
        last._listIdx = idx;
      }
    }
    record._listIdx = -1;
    this._gridRemove(this._cellKey(record.gx, record.gz), record);
    if (record.type === BUILD_TYPES.WALL) {
      if (record.dir === 0) {
        this._gridRemove(this._cellKey(record.gx, record.gz - 1), record);
      } else {
        this._gridRemove(this._cellKey(record.gx - 1, record.gz), record);
      }
    }
  }

  setShadowsEnabled(enabled) {
    for (let i = 0; i < this._bucketEntries.length; i++) {
      const b = this._bucketEntries[i].bucket;
      for (let k = 0; k < PART_KEYS.length; k++) {
        const m = b[PART_KEYS[k]];
        m.castShadow = enabled;
        m.receiveShadow = enabled;
      }
    }
  }

  computePlacement(playerPos, yaw, pitch, buildType, halfGrid = ARENA_HALF_GRID, out = null) {
    const res = out || this._placementScratch;
    const cosPitch = Math.cos(pitch);
    const lookX = -Math.sin(yaw) * cosPitch;
    const lookY = Math.sin(pitch);
    const lookZ = -Math.cos(yaw) * cosPitch;

    const eyeY = playerPos.y + 1.5;

    if (buildType === BUILD_TYPES.WALL) {
      // Snap wall to the front edge of the cell
      const reach = 2.05;
      const tx = playerPos.x + lookX * reach;
      const tz = playerPos.z + lookZ * reach;
      const ty = eyeY + lookY * 2.4;

      const gy = Math.max(0, Math.min(MAX_BUILD_LEVEL - 1, Math.floor(ty / WALL_HEIGHT)));

      let gx, gz, dir;
      if (Math.abs(lookZ) >= Math.abs(lookX)) {
        dir = 0; // Runs along X at z = gz * CELL_SIZE
        gx = Math.floor(tx / CELL_SIZE);
        gz = Math.round(tz / CELL_SIZE);
        gx = Math.max(-halfGrid, Math.min(halfGrid - 1, gx));
        gz = Math.max(-halfGrid, Math.min(halfGrid, gz));
      } else {
        dir = 1; // Runs along Z at x = gx * CELL_SIZE
        gx = Math.round(tx / CELL_SIZE);
        gz = Math.floor(tz / CELL_SIZE);
        gx = Math.max(-halfGrid, Math.min(halfGrid, gx));
        gz = Math.max(-halfGrid, Math.min(halfGrid - 1, gz));
      }

      res.type = BUILD_TYPES.WALL;
      res.gx = gx;
      res.gy = gy;
      res.gz = gz;
      res.dir = dir;
      res.rot = 0;
      res.key = makeBuildKey(BUILD_TYPES.WALL, gx, gy, gz, dir);
      return res;
    }

    if (buildType === BUILD_TYPES.FLOOR) {
      const tx = playerPos.x + lookX * 2.1;
      const tz = playerPos.z + lookZ * 2.1;
      const gx = Math.max(-halfGrid, Math.min(halfGrid - 1, Math.floor(tx / CELL_SIZE)));
      const gz = Math.max(-halfGrid, Math.min(halfGrid - 1, Math.floor(tz / CELL_SIZE)));

      let gy;
      if (lookY > 0.38) {
        gy = Math.min(MAX_BUILD_LEVEL - 1, Math.floor((playerPos.y + 1.4) / WALL_HEIGHT) + 1);
      } else if (lookY < -0.25) {
        gy = Math.max(0, Math.round(playerPos.y / WALL_HEIGHT));
      } else {
        gy = Math.max(0, Math.min(MAX_BUILD_LEVEL - 1, Math.round((playerPos.y + lookY * 2.2) / WALL_HEIGHT)));
      }

      res.type = BUILD_TYPES.FLOOR;
      res.gx = gx;
      res.gy = gy;
      res.gz = gz;
      res.dir = 0;
      res.rot = 0;
      res.key = makeBuildKey(BUILD_TYPES.FLOOR, gx, gy, gz, 0);
      return res;
    }

    // Ramp
    const tx = playerPos.x + lookX * 2.4;
    const tz = playerPos.z + lookZ * 2.4;
    const gx = Math.max(-halfGrid, Math.min(halfGrid - 1, Math.floor(tx / CELL_SIZE)));
    const gz = Math.max(-halfGrid, Math.min(halfGrid - 1, Math.floor(tz / CELL_SIZE)));
    const gy = Math.max(0, Math.min(MAX_BUILD_LEVEL - 1, Math.floor((playerPos.y + 0.55 + lookY * 2.0) / WALL_HEIGHT)));

    let rot = 0;
    if (Math.abs(lookZ) >= Math.abs(lookX)) {
      rot = lookZ < 0 ? 0 : 2;
    } else {
      rot = lookX > 0 ? 1 : 3;
    }

    res.type = BUILD_TYPES.RAMP;
    res.gx = gx;
    res.gy = gy;
    res.gz = gz;
    res.dir = 0;
    res.rot = rot;
    res.key = makeBuildKey(BUILD_TYPES.RAMP, gx, gy, gz, 0);
    return res;
  }

  canPlaceBuild(placement, mapState = null) {
    if (!placement || this.builds.has(placement.key)) return false;
    return isBuildSupported(placement, this.builds, mapState);
  }

  updateBlueprint(placement, visible, canPlace = true) {
    if (!visible || !placement) {
      if (this._bpVisible) {
        this._bpVisible = false;
        this._bpKey = '';
        this.blueprintGroup.visible = false;
      }
      return;
    }

    const valid = canPlace && !this.builds.has(placement.key);
    if (this._bpVisible && this._bpKey === placement.key && this._bpRot === placement.rot && this._bpCanPlace === valid) {
      return;
    }
    this._bpVisible = true;
    this._bpKey = placement.key;
    this._bpRot = placement.rot;
    this._bpCanPlace = valid;

    this.blueprintGroup.visible = true;
    const mat = valid ? this.blueprintMatValid : this.blueprintMatInvalid;

    const wallMesh = this.blueprintMeshes[BUILD_TYPES.WALL];
    const floorMesh = this.blueprintMeshes[BUILD_TYPES.FLOOR];
    const rampMesh = this.blueprintMeshes[BUILD_TYPES.RAMP];
    wallMesh.visible = placement.type === BUILD_TYPES.WALL;
    floorMesh.visible = placement.type === BUILD_TYPES.FLOOR;
    rampMesh.visible = placement.type === BUILD_TYPES.RAMP;
    if (wallMesh.visible) wallMesh.material = mat;
    else if (floorMesh.visible) floorMesh.material = mat;
    else if (rampMesh.visible) rampMesh.material = mat;

    getBuildWorldCenter(placement, this._tmpVec);
    this.blueprintGroup.position.copy(this._tmpVec);
    this.blueprintGroup.rotation.set(0, 0, 0);
    this.blueprintGroup.rotation.order = 'YXZ';

    if (placement.type === BUILD_TYPES.WALL) {
      this.blueprintGroup.rotation.y = placement.dir === 1 ? Math.PI * 0.5 : 0;
    } else if (placement.type === BUILD_TYPES.RAMP) {
      this.blueprintGroup.rotation.x = SLOPE_ANGLE;
      this.blueprintGroup.rotation.y = -placement.rot * (Math.PI * 0.5);
    }
  }

  placeBuild(data, playSoundFn = null, instant = false) {
    if (!data || !data.key || this.builds.has(data.key)) return null;

    const matInfo = BUILD_MATERIALS[data.mat] || BUILD_MATERIALS.wood;
    const maxHp = data.maxHp || matInfo.hp;
    const skipAnim = instant || this._qualityKey === 'low';
    const record = this._recordPool.length > 0 ? this._recordPool.pop() : {};
    record.id = data.id || data.key;
    record.key = data.key;
    record.type = data.type;
    record.mat = BUILD_MATERIALS[data.mat] ? data.mat : 'wood';
    record.gx = data.gx;
    record.gy = data.gy;
    record.gz = data.gz;
    record.dir = data.dir || 0;
    record.rot = data.rot || 0;
    record.mask = typeof data.mask === 'number' ? data.mask : getDefaultMask(data.type);
    record.hp = typeof data.hp === 'number' ? data.hp : maxHp;
    record.maxHp = maxHp;
    record.ownerId = data.ownerId || 'local';
    record.animProgress = skipAnim ? 1 : 0;
    record.hitPulse = 0;

    this.builds.set(record.key, record);
    this._indexBuild(record);
    if (!skipAnim) {
      this.animatingKeys.add(record.key);
      if (this.pools) {
        getBuildWorldCenter(record, this._tmpVec);
        this.pools.spawnBuildPlaceBurst(this._tmpVec.x, this._tmpVec.y, this._tmpVec.z, matInfo.color);
      }
    }
    this.dirty = true;

    if (playSoundFn) {
      playSoundFn(record.mat);
    }
    return record;
  }

  editBuild(key, newMask, newRot = null) {
    const b = this.builds.get(key);
    if (!b) return false;
    b.mask = newMask;
    if (typeof newRot === 'number') b.rot = newRot;
    this.dirty = true;
    return true;
  }

  setBuildHp(key, hp) {
    const b = this.builds.get(key);
    if (!b) return;
    b.hp = hp;
    if (b.hp <= 0) {
      this.removeBuild(key, true);
    } else {
      if (this._qualityKey !== 'low') {
        b.hitPulse = 1.0;
        this.animatingKeys.add(key);
      }
      this.dirty = true;
    }
  }

  damageBuild(key, damage) {
    const b = this.builds.get(key);
    if (!b) return { destroyed: false };
    b.hp -= damage;
    if (b.hp <= 0) {
      this.removeBuild(key, true);
      return { destroyed: true, build: b };
    }
    if (this._qualityKey !== 'low') {
      b.hitPulse = 1.0;
      this.animatingKeys.add(key);
    }
    this.dirty = true;
    return { destroyed: false, build: b, hp: b.hp };
  }

  removeBuild(key, withParticles = true) {
    const b = this.builds.get(key);
    if (!b) return false;
    this.builds.delete(key);
    this._unindexBuild(b);
    this.animatingKeys.delete(key);
    this.dirty = true;

    if (withParticles && this.pools) {
      getBuildWorldCenter(b, this._tmpVec);
      const matColor = (BUILD_MATERIALS[b.mat] || BUILD_MATERIALS.wood).color;
      this.pools.spawnBuildChunks(this._tmpVec.x, this._tmpVec.y, this._tmpVec.z, matColor, 10);
    }
    if (this._recordPool.length < MAX_RECYCLED_RECORDS) {
      this._recordPool.push(b);
    }
    return true;
  }

  clearAll(withBurst = true) {
    let burstCount = 0;
    for (let i = 0; i < this._buildList.length; i++) {
      const b = this._buildList[i];
      if (withBurst && this.pools && burstCount <= 24) {
        getBuildWorldCenter(b, this._tmpVec);
        const matColor = (BUILD_MATERIALS[b.mat] || BUILD_MATERIALS.wood).color;
        this.pools.spawnBuildChunks(this._tmpVec.x, this._tmpVec.y, this._tmpVec.z, matColor, 4);
        burstCount++;
      }
      b._listIdx = -1;
      if (this._recordPool.length < MAX_RECYCLED_RECORDS) {
        this._recordPool.push(b);
      }
    }
    this._buildList.length = 0;
    for (const arr of this.spatialGrid.values()) {
      arr.length = 0;
      if (this._cellArrayPool.length < 256) this._cellArrayPool.push(arr);
    }
    this.spatialGrid.clear();
    this.builds.clear();
    this.animatingKeys.clear();
    this.dirty = true;
    this.hideEditOverlay();
    this.rebuildInstances();
  }

  update(dt) {
    if (this.animatingKeys.size === 0) return;
    for (const key of this.animatingKeys) {
      const b = this.builds.get(key);
      if (!b) {
        this.animatingKeys.delete(key);
        continue;
      }
      if (b.animProgress < 1) {
        b.animProgress = Math.min(1, b.animProgress + dt / 0.22);
      }
      if (b.hitPulse > 0) {
        b.hitPulse = Math.max(0, b.hitPulse - dt / 0.12);
      }
      if (b.animProgress >= 1 && b.hitPulse <= 0) {
        this.animatingKeys.delete(key);
      }
    }
    this.dirty = true;
  }

  showEditOverlay(build, draftMask, hoverIndex = -1) {
    if (!build) {
      this.hideEditOverlay();
      return;
    }
    this.editOverlayGroup.visible = true;
    for (const m of this.editTiles) m.visible = false;

    getBuildWorldCenter(build, this._tmpVec);
    this.editOverlayGroup.position.copy(this._tmpVec);
    this.editOverlayGroup.rotation.set(0, 0, 0);
    this.editOverlayGroup.rotation.order = 'YXZ';

    if (build.type === BUILD_TYPES.WALL) {
      this.editOverlayGroup.rotation.y = build.dir === 1 ? Math.PI * 0.5 : 0;
      const tw = (CELL_SIZE / 3) * 0.9;
      const th = (WALL_HEIGHT / 3) * 0.9;
      for (let i = 0; i < 9; i++) {
        const row = (i / 3) | 0;
        const col = i % 3;
        const tile = this.editTiles[i];
        tile.visible = true;
        tile.position.set((col - 1) * (CELL_SIZE / 3), (1 - row) * (WALL_HEIGHT / 3), 0.16);
        tile.rotation.set(0, 0, 0);
        tile.scale.set(tw, th, 1);
        const kept = (draftMask & (1 << i)) !== 0;
        tile.material = i === hoverIndex ? this.editTileMats.hover : (kept ? this.editTileMats.kept : this.editTileMats.cut);
      }
    } else if (build.type === BUILD_TYPES.FLOOR) {
      const ts = (CELL_SIZE / 2) * 0.9;
      for (let i = 0; i < 4; i++) {
        const rx = i % 2;
        const rz = (i / 2) | 0;
        const tile = this.editTiles[i];
        tile.visible = true;
        tile.position.set((rx - 0.5) * (CELL_SIZE / 2), 0.16, (rz - 0.5) * (CELL_SIZE / 2));
        tile.rotation.set(-Math.PI / 2, 0, 0);
        tile.scale.set(ts, ts, 1);
        const kept = (draftMask & (1 << i)) !== 0;
        tile.material = i === hoverIndex ? this.editTileMats.hover : (kept ? this.editTileMats.kept : this.editTileMats.cut);
      }
    } else if (build.type === BUILD_TYPES.RAMP) {
      this.editOverlayGroup.rotation.x = SLOPE_ANGLE;
      this.editOverlayGroup.rotation.y = -build.rot * (Math.PI * 0.5);
      const tw = (CELL_SIZE / 2) * 0.9;
      const tl = SLOPE_LEN * 0.92;
      for (let i = 0; i < 2; i++) {
        const tile = this.editTiles[i];
        tile.visible = true;
        tile.position.set((i - 0.5) * (CELL_SIZE / 2), 0.16, 0);
        tile.rotation.set(-Math.PI / 2, 0, 0);
        tile.scale.set(tw, tl, 1);
        const kept = (draftMask & (1 << i)) !== 0;
        tile.material = i === hoverIndex ? this.editTileMats.hover : (kept ? this.editTileMats.kept : this.editTileMats.cut);
      }
    }
  }

  hideEditOverlay() {
    this.editOverlayGroup.visible = false;
  }

  getEditHoverTile(build, rayOrigin, rayDir) {
    // Intersect ray with the build's local plane to find which edit tile (0..8 / 0..3 / 0..1) is aimed at
    if (!build) return -1;
    getBuildWorldCenter(build, this._tmpVec);

    if (build.type === BUILD_TYPES.WALL) {
      let t = -1;
      let hitX = 0;
      let hitY = 0;
      if (build.dir === 0) {
        if (Math.abs(rayDir.z) < 1e-4) return -1;
        t = (this._tmpVec.z - rayOrigin.z) / rayDir.z;
        if (t <= 0 || t > 8) return -1;
        hitX = rayOrigin.x + rayDir.x * t - this._tmpVec.x;
        hitY = rayOrigin.y + rayDir.y * t - this._tmpVec.y;
      } else {
        if (Math.abs(rayDir.x) < 1e-4) return -1;
        t = (this._tmpVec.x - rayOrigin.x) / rayDir.x;
        if (t <= 0 || t > 8) return -1;
        // Rotated +90 around Y -> local X maps to world -Z
        hitX = -(rayOrigin.z + rayDir.z * t - this._tmpVec.z);
        hitY = rayOrigin.y + rayDir.y * t - this._tmpVec.y;
      }
      if (Math.abs(hitX) > CELL_SIZE * 0.5 || Math.abs(hitY) > WALL_HEIGHT * 0.5) return -1;
      const col = Math.max(0, Math.min(2, Math.floor((hitX + CELL_SIZE * 0.5) / (CELL_SIZE / 3))));
      const row = Math.max(0, Math.min(2, Math.floor((WALL_HEIGHT * 0.5 - hitY) / (WALL_HEIGHT / 3))));
      return row * 3 + col;
    }

    if (build.type === BUILD_TYPES.FLOOR) {
      if (Math.abs(rayDir.y) < 1e-4) return -1;
      const t = (this._tmpVec.y - rayOrigin.y) / rayDir.y;
      if (t <= 0 || t > 8) return -1;
      const hx = rayOrigin.x + rayDir.x * t - this._tmpVec.x;
      const hz = rayOrigin.z + rayDir.z * t - this._tmpVec.z;
      if (Math.abs(hx) > CELL_SIZE * 0.5 || Math.abs(hz) > CELL_SIZE * 0.5) return -1;
      const rx = hx >= 0 ? 1 : 0;
      const rz = hz >= 0 ? 1 : 0;
      return rz * 2 + rx;
    }

    if (build.type === BUILD_TYPES.RAMP) {
      // Intersect mid-plane y = centerY and pick left vs right side in ramp local space
      const t = (this._tmpVec.y - rayOrigin.y) / (Math.abs(rayDir.y) > 0.15 ? rayDir.y : -0.5);
      const clampedT = Math.max(0.5, Math.min(5, t));
      const wx = rayOrigin.x + rayDir.x * clampedT - this._tmpVec.x;
      const wz = rayOrigin.z + rayDir.z * clampedT - this._tmpVec.z;
      const ry = -build.rot * (Math.PI * 0.5);
      const localX = wx * Math.cos(ry) - wz * Math.sin(ry);
      return localX >= 0 ? 1 : 0;
    }

    return -1;
  }

  rebuildInstances() {
    if (!this.dirty) return;
    this.dirty = false;

    for (let i = 0; i < this._bucketEntries.length; i++) {
      const c = this._bucketEntries[i].counts;
      c.wallFull = 0;
      c.wallTile = 0;
      c.floorFull = 0;
      c.floorTile = 0;
      c.rampFull = 0;
      c.rampHalf = 0;
    }

    for (let bi = 0; bi < this._buildList.length; bi++) {
      const b = this._buildList[bi];
      const entry = this._bucketLookup[b.mat] || this._bucketLookup.wood;
      const bucket = entry.bucket;
      const c = entry.counts;
      const matInfo = BUILD_MATERIALS[b.mat] || BUILD_MATERIALS.wood;

      const animP = typeof b.animProgress === 'number' ? b.animProgress : 1;
      const hitP = typeof b.hitPulse === 'number' ? b.hitPulse : 0;
      const eased = animP < 1 ? easeOutBuild(animP) : 1.0;
      const pulseScale = hitP > 0 ? (1 - hitP * 0.035) : 1.0;

      // Subtle health tint + blueprint placement shimmer + hit pulse flash
      const hpRatio = Math.max(0.25, b.hp / b.maxHp);
      this._color.setRGB(1, 0.35 + 0.65 * hpRatio, 0.35 + 0.65 * hpRatio);
      if (animP < 0.55) {
        const bpMix = 1 - animP / 0.55;
        this._color.lerp(this._blueprintColor, bpMix * 0.72);
      }
      if (hitP > 0) {
        this._color.lerp(this._pulseColor, hitP * 0.45);
      }
      getBuildWorldCenter(b, this._tmpVec);

      if (b.type === BUILD_TYPES.WALL) {
        const yaw = b.dir === 1 ? Math.PI * 0.5 : 0;
        const sy = (0.12 + 0.88 * eased) * pulseScale;
        const sx = (0.86 + 0.14 * Math.min(1, eased)) * pulseScale;
        const sz = pulseScale;

        if (b.mask === 0x1ff && c.wallFull < MAX_FULL_PER_MAT) {
          this._dummy.position.set(
            this._tmpVec.x,
            this._tmpVec.y - WALL_HEIGHT * 0.5 * (1 - sy),
            this._tmpVec.z
          );
          this._dummy.rotation.set(0, yaw, 0);
          this._dummy.scale.set(sx, sy, sz);
          this._dummy.updateMatrix();
          bucket.wallFull.setMatrixAt(c.wallFull, this._dummy.matrix);
          bucket.wallFull.setColorAt(c.wallFull, this._color);
          c.wallFull++;
        } else {
          const tileH = WALL_HEIGHT / 3;
          for (let i = 0; i < 9; i++) {
            if ((b.mask & (1 << i)) === 0) continue;
            if (c.wallTile >= MAX_TILES_PER_MAT) break;
            const row = (i / 3) | 0;
            const col = i % 3;
            const localX = (col - 1) * (CELL_SIZE / 3);
            const localY = (1 - row) * tileH;

            const wx = this._tmpVec.x + (b.dir === 0 ? localX : 0);
            const wz = this._tmpVec.z + (b.dir === 1 ? -localX : 0);
            this._dummy.position.set(wx, this._tmpVec.y + localY - tileH * 0.5 * (1 - sy), wz);
            this._dummy.rotation.set(0, yaw, 0);
            this._dummy.scale.set(sx, sy, sz);
            this._dummy.updateMatrix();
            bucket.wallTile.setMatrixAt(c.wallTile, this._dummy.matrix);
            bucket.wallTile.setColorAt(c.wallTile, this._color);
            c.wallTile++;
          }
        }
      } else if (b.type === BUILD_TYPES.FLOOR) {
        const sxz = (0.18 + 0.82 * eased) * pulseScale;
        const sy = (0.5 + 0.5 * Math.min(1, eased)) * pulseScale;

        if (b.mask === 0xf && c.floorFull < MAX_FULL_PER_MAT) {
          this._dummy.position.copy(this._tmpVec);
          this._dummy.rotation.set(0, 0, 0);
          this._dummy.scale.set(sxz, sy, sxz);
          this._dummy.updateMatrix();
          bucket.floorFull.setMatrixAt(c.floorFull, this._dummy.matrix);
          bucket.floorFull.setColorAt(c.floorFull, this._color);
          c.floorFull++;
        } else {
          for (let i = 0; i < 4; i++) {
            if ((b.mask & (1 << i)) === 0) continue;
            if (c.floorTile >= MAX_TILES_PER_MAT) break;
            const rx = i % 2;
            const rz = (i / 2) | 0;
            this._dummy.position.set(
              this._tmpVec.x + (rx - 0.5) * (CELL_SIZE / 2),
              this._tmpVec.y,
              this._tmpVec.z + (rz - 0.5) * (CELL_SIZE / 2)
            );
            this._dummy.rotation.set(0, 0, 0);
            this._dummy.scale.set(sxz, sy, sxz);
            this._dummy.updateMatrix();
            bucket.floorTile.setMatrixAt(c.floorTile, this._dummy.matrix);
            bucket.floorTile.setColorAt(c.floorTile, this._color);
            c.floorTile++;
          }
        }
      } else if (b.type === BUILD_TYPES.RAMP) {
        this._dummy.rotation.order = 'YXZ';
        const ry = -b.rot * (Math.PI * 0.5);
        const sz = (0.15 + 0.85 * eased) * pulseScale;
        const sy = (0.35 + 0.65 * Math.min(1, eased)) * pulseScale;
        const sx = pulseScale;
        this._dummy.rotation.set(SLOPE_ANGLE, ry, 0, 'YXZ');
        this._offsetVec.set(0, 0, SLOPE_LEN * 0.5 * (1 - sz)).applyEuler(this._dummy.rotation);

        if (b.mask === 0x3 && c.rampFull < MAX_FULL_PER_MAT) {
          this._dummy.position.copy(this._tmpVec).add(this._offsetVec);
          this._dummy.scale.set(sx, sy, sz);
          this._dummy.updateMatrix();
          bucket.rampFull.setMatrixAt(c.rampFull, this._dummy.matrix);
          bucket.rampFull.setColorAt(c.rampFull, this._color);
          c.rampFull++;
        } else {
          for (let i = 0; i < 2; i++) {
            if ((b.mask & (1 << i)) === 0) continue;
            if (c.rampHalf >= MAX_FULL_PER_MAT) break;
            const localX = (i - 0.5) * (CELL_SIZE / 2);
            const wx = this._tmpVec.x + localX * Math.cos(ry) + this._offsetVec.x;
            const wy = this._tmpVec.y + this._offsetVec.y;
            const wz = this._tmpVec.z - localX * Math.sin(ry) + this._offsetVec.z;
            this._dummy.position.set(wx, wy, wz);
            this._dummy.scale.set(sx, sy, sz);
            this._dummy.updateMatrix();
            bucket.rampHalf.setMatrixAt(c.rampHalf, this._dummy.matrix);
            bucket.rampHalf.setColorAt(c.rampHalf, this._color);
            c.rampHalf++;
          }
        }
      }

      // Keep matInfo reference clean
      void matInfo;
    }

    for (let i = 0; i < this._bucketEntries.length; i++) {
      const entry = this._bucketEntries[i];
      const bucket = entry.bucket;
      const c = entry.counts;
      for (let k = 0; k < PART_KEYS.length; k++) {
        const part = PART_KEYS[k];
        const mesh = bucket[part];
        const count = c[part];
        const prevCount = mesh.userData._prevCount ?? -1;
        if (count !== prevCount) {
          mesh.count = count;
          mesh.visible = count > 0;
          mesh.userData._prevCount = count;
        }
        if (count > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingSphere();
          mesh.frustumCulled = true;
        }
      }
    }
  }

  dispose() {
    if (this._unsubStructures) this._unsubStructures();
    this.clearAll(false);
    this._recordPool.length = 0;
    this._cellArrayPool.length = 0;
    this._structBasicMat.dispose();
    for (let i = 0; i < this._bucketEntries.length; i++) {
      const b = this._bucketEntries[i].bucket;
      for (let k = 0; k < PART_KEYS.length; k++) {
        const m = b[PART_KEYS[k]];
        this.scene.remove(m);
      }
      b.mats.low.dispose();
      b.mats.medium.dispose();
      b.mats.high.dispose();
    }
    for (const g of Object.values(this.geos)) g.dispose();
    this.scene.remove(this.blueprintGroup);
    this.scene.remove(this.editOverlayGroup);
    this.blueprintMatValid.dispose();
    this.blueprintMatInvalid.dispose();
    this.blueprintEdgeMat.dispose();
    this.editTileMats.kept.dispose();
    this.editTileMats.cut.dispose();
    this.editTileMats.hover.dispose();
  }
}
