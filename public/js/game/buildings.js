import * as THREE from 'three';
import { getStructureGeo, onStructuresLoaded } from './structureAssets.js';
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

function createMaterialTexture(matId) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  if (matId === 'wood') {
    const planks = ['#d6a165', '#c99153', '#d0995b', '#c2884b'];
    for (let p = 0; p < 4; p++) {
      const y = p * 16;
      ctx.fillStyle = planks[p];
      ctx.fillRect(0, y, 64, 16);
      ctx.fillStyle = 'rgba(255,245,220,0.16)';
      ctx.fillRect(0, y + 1, 64, 2);
      ctx.fillStyle = '#8b5a2b';
      ctx.fillRect(0, y + 15, 64, 1);
    }
    ctx.strokeStyle = '#734821';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 60, 60);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(4, 60);
    ctx.lineTo(60, 4);
    ctx.stroke();
  } else if (matId === 'brick') {
    ctx.fillStyle = '#8e4537';
    ctx.fillRect(0, 0, 64, 64);
    const tones = ['#c96a53', '#b85a45', '#d0745d', '#a9513e'];
    for (let row = 0; row < 4; row++) {
      const y = row * 16;
      const offset = (row % 2) * 16;
      for (let col = -1; col < 3; col++) {
        const x = col * 32 + offset;
        ctx.fillStyle = tones[(row * 3 + col + 4) % tones.length];
        ctx.fillRect(x + 1, y + 1, 30, 14);
      }
    }
    ctx.strokeStyle = '#622b20';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, 61, 61);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 64, 64);
    grad.addColorStop(0, '#9eb2c7');
    grad.addColorStop(1, '#71869c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = '#435366';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 60, 60);
    ctx.fillStyle = '#536579';
    ctx.fillRect(31, 5, 2, 54);
    ctx.fillRect(5, 31, 54, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
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
      for (const [slot, g] of Object.entries(geos)) {
        bucket[slot].geometry = g;
      }
      bucket.material.map = null;
      bucket.material.vertexColors = true;
      bucket.material.needsUpdate = true;
      swappedAny = true;
    }
    if (swappedAny) this.dirty = true;
  }

  constructor(scene, pools) {
    this.scene = scene;
    this.pools = pools;
    this.builds = new Map(); // key -> BuildRecord
    this.dirty = false;

    // Reusable math scratch objects (zero GC)
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._tmpVec = new THREE.Vector3();

    // Shared geometries
    this.geos = {
      wallFull: new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, WALL_THICKNESS),
      wallTile: new THREE.BoxGeometry(CELL_SIZE / 3, WALL_HEIGHT / 3, WALL_THICKNESS),
      floorFull: new THREE.BoxGeometry(CELL_SIZE, FLOOR_THICKNESS, CELL_SIZE),
      floorTile: new THREE.BoxGeometry(CELL_SIZE / 2, FLOOR_THICKNESS, CELL_SIZE / 2),
      rampFull: new THREE.BoxGeometry(CELL_SIZE, RAMP_THICKNESS, SLOPE_LEN),
      rampHalf: new THREE.BoxGeometry(CELL_SIZE / 2, RAMP_THICKNESS, SLOPE_LEN)
    };

    // InstancedMesh buckets per material (wood / brick / metal)
    this.buckets = {};
    for (const matId of Object.keys(BUILD_MATERIALS)) {
      const tex = createMaterialTexture(matId);
      const sharedMat = new THREE.MeshLambertMaterial({
        color: 0xffffff,
        map: tex
      });

      const makeMesh = (geo, maxCount) => {
        const im = new THREE.InstancedMesh(geo, sharedMat, maxCount);
        im.frustumCulled = false;
        im.castShadow = true;
        im.receiveShadow = true;
        im.setColorAt(0, new THREE.Color(0xffffff));
        im.count = 0;
        this.scene.add(im);
        return im;
      };

      this.buckets[matId] = {
        material: sharedMat,
        texture: tex,
        wallFull: makeMesh(this.geos.wallFull, MAX_FULL_PER_MAT),
        wallTile: makeMesh(this.geos.wallTile, MAX_TILES_PER_MAT),
        floorFull: makeMesh(this.geos.floorFull, MAX_FULL_PER_MAT),
        floorTile: makeMesh(this.geos.floorTile, MAX_TILES_PER_MAT),
        rampFull: makeMesh(this.geos.rampFull, MAX_FULL_PER_MAT),
        rampHalf: makeMesh(this.geos.rampHalf, MAX_FULL_PER_MAT)
      };
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

  setShadowsEnabled(enabled) {
    for (const b of Object.values(this.buckets)) {
      b.wallFull.castShadow = enabled;
      b.wallFull.receiveShadow = enabled;
      b.wallTile.castShadow = enabled;
      b.wallTile.receiveShadow = enabled;
      b.floorFull.castShadow = enabled;
      b.floorFull.receiveShadow = enabled;
      b.floorTile.castShadow = enabled;
      b.floorTile.receiveShadow = enabled;
      b.rampFull.castShadow = enabled;
      b.rampFull.receiveShadow = enabled;
      b.rampHalf.castShadow = enabled;
      b.rampHalf.receiveShadow = enabled;
    }
  }

  computePlacement(playerPos, yaw, pitch, buildType, halfGrid = ARENA_HALF_GRID) {
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

      const key = makeBuildKey(BUILD_TYPES.WALL, gx, gy, gz, dir);
      return { type: BUILD_TYPES.WALL, gx, gy, gz, dir, rot: 0, key };
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

      const key = makeBuildKey(BUILD_TYPES.FLOOR, gx, gy, gz, 0);
      return { type: BUILD_TYPES.FLOOR, gx, gy, gz, dir: 0, rot: 0, key };
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

    const key = makeBuildKey(BUILD_TYPES.RAMP, gx, gy, gz, 0);
    return { type: BUILD_TYPES.RAMP, gx, gy, gz, dir: 0, rot, key };
  }

  canPlaceBuild(placement, mapState = null) {
    if (!placement || this.builds.has(placement.key)) return false;
    return isBuildSupported(placement, this.builds, mapState);
  }

  updateBlueprint(placement, visible, canPlace = true) {
    if (!visible || !placement) {
      this.blueprintGroup.visible = false;
      return;
    }

    this.blueprintGroup.visible = true;
    const valid = canPlace && !this.builds.has(placement.key);
    const mat = valid ? this.blueprintMatValid : this.blueprintMatInvalid;

    for (const [type, mesh] of Object.entries(this.blueprintMeshes)) {
      mesh.visible = type === placement.type;
      if (mesh.visible) mesh.material = mat;
    }

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

  placeBuild(data, playSoundFn = null) {
    if (!data || !data.key || this.builds.has(data.key)) return null;

    const matInfo = BUILD_MATERIALS[data.mat] || BUILD_MATERIALS.wood;
    const maxHp = data.maxHp || matInfo.hp;
    const record = {
      id: data.id || data.key,
      key: data.key,
      type: data.type,
      mat: BUILD_MATERIALS[data.mat] ? data.mat : 'wood',
      gx: data.gx,
      gy: data.gy,
      gz: data.gz,
      dir: data.dir || 0,
      rot: data.rot || 0,
      mask: typeof data.mask === 'number' ? data.mask : getDefaultMask(data.type),
      hp: typeof data.hp === 'number' ? data.hp : maxHp,
      maxHp,
      ownerId: data.ownerId || 'local'
    };

    this.builds.set(record.key, record);
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
    this.dirty = true;
    return { destroyed: false, build: b, hp: b.hp };
  }

  removeBuild(key, withParticles = true) {
    const b = this.builds.get(key);
    if (!b) return false;
    this.builds.delete(key);
    this.dirty = true;

    if (withParticles && this.pools) {
      getBuildWorldCenter(b, this._tmpVec);
      const matColor = (BUILD_MATERIALS[b.mat] || BUILD_MATERIALS.wood).color;
      this.pools.spawnBuildChunks(this._tmpVec.x, this._tmpVec.y, this._tmpVec.z, matColor, 10);
    }
    return true;
  }

  clearAll(withBurst = true) {
    if (withBurst && this.pools) {
      let burstCount = 0;
      for (const b of this.builds.values()) {
        if (burstCount > 24) break; // Cap bursts on massive clear so old PCs never stutter
        getBuildWorldCenter(b, this._tmpVec);
        const matColor = (BUILD_MATERIALS[b.mat] || BUILD_MATERIALS.wood).color;
        this.pools.spawnBuildChunks(this._tmpVec.x, this._tmpVec.y, this._tmpVec.z, matColor, 4);
        burstCount++;
      }
    }
    this.builds.clear();
    this.dirty = true;
    this.hideEditOverlay();
    this.rebuildInstances();
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

    const counters = {};
    for (const matId of Object.keys(this.buckets)) {
      counters[matId] = {
        wallFull: 0,
        wallTile: 0,
        floorFull: 0,
        floorTile: 0,
        rampFull: 0,
        rampHalf: 0
      };
    }

    for (const b of this.builds.values()) {
      const bucket = this.buckets[b.mat] || this.buckets.wood;
      const c = counters[b.mat] || counters.wood;
      const matInfo = BUILD_MATERIALS[b.mat] || BUILD_MATERIALS.wood;

      // Subtle health tint: full HP = white (preserves texture), damaged = shifts slightly warm/dark
      const hpRatio = Math.max(0.25, b.hp / b.maxHp);
      this._color.setRGB(1, 0.35 + 0.65 * hpRatio, 0.35 + 0.65 * hpRatio);
      getBuildWorldCenter(b, this._tmpVec);

      if (b.type === BUILD_TYPES.WALL) {
        const yaw = b.dir === 1 ? Math.PI * 0.5 : 0;
        if (b.mask === 0x1ff && c.wallFull < MAX_FULL_PER_MAT) {
          this._dummy.position.copy(this._tmpVec);
          this._dummy.rotation.set(0, yaw, 0);
          this._dummy.scale.set(1, 1, 1);
          this._dummy.updateMatrix();
          bucket.wallFull.setMatrixAt(c.wallFull, this._dummy.matrix);
          bucket.wallFull.setColorAt(c.wallFull, this._color);
          c.wallFull++;
        } else {
          for (let i = 0; i < 9; i++) {
            if ((b.mask & (1 << i)) === 0) continue;
            if (c.wallTile >= MAX_TILES_PER_MAT) break;
            const row = (i / 3) | 0;
            const col = i % 3;
            const localX = (col - 1) * (CELL_SIZE / 3);
            const localY = (1 - row) * (WALL_HEIGHT / 3);

            const wx = this._tmpVec.x + (b.dir === 0 ? localX : 0);
            const wz = this._tmpVec.z + (b.dir === 1 ? -localX : 0);
            this._dummy.position.set(wx, this._tmpVec.y + localY, wz);
            this._dummy.rotation.set(0, yaw, 0);
            this._dummy.scale.set(1, 1, 1);
            this._dummy.updateMatrix();
            bucket.wallTile.setMatrixAt(c.wallTile, this._dummy.matrix);
            bucket.wallTile.setColorAt(c.wallTile, this._color);
            c.wallTile++;
          }
        }
      } else if (b.type === BUILD_TYPES.FLOOR) {
        if (b.mask === 0xf && c.floorFull < MAX_FULL_PER_MAT) {
          this._dummy.position.copy(this._tmpVec);
          this._dummy.rotation.set(0, 0, 0);
          this._dummy.scale.set(1, 1, 1);
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
            this._dummy.scale.set(1, 1, 1);
            this._dummy.updateMatrix();
            bucket.floorTile.setMatrixAt(c.floorTile, this._dummy.matrix);
            bucket.floorTile.setColorAt(c.floorTile, this._color);
            c.floorTile++;
          }
        }
      } else if (b.type === BUILD_TYPES.RAMP) {
        this._dummy.rotation.order = 'YXZ';
        const ry = -b.rot * (Math.PI * 0.5);
        if (b.mask === 0x3 && c.rampFull < MAX_FULL_PER_MAT) {
          this._dummy.position.copy(this._tmpVec);
          this._dummy.rotation.set(SLOPE_ANGLE, ry, 0, 'YXZ');
          this._dummy.scale.set(1, 1, 1);
          this._dummy.updateMatrix();
          bucket.rampFull.setMatrixAt(c.rampFull, this._dummy.matrix);
          bucket.rampFull.setColorAt(c.rampFull, this._color);
          c.rampFull++;
        } else {
          for (let i = 0; i < 2; i++) {
            if ((b.mask & (1 << i)) === 0) continue;
            if (c.rampHalf >= MAX_FULL_PER_MAT) break;
            const localX = (i - 0.5) * (CELL_SIZE / 2);
            const wx = this._tmpVec.x + localX * Math.cos(ry);
            const wz = this._tmpVec.z - localX * Math.sin(ry);
            this._dummy.position.set(wx, this._tmpVec.y, wz);
            this._dummy.rotation.set(SLOPE_ANGLE, ry, 0, 'YXZ');
            this._dummy.scale.set(1, 1, 1);
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

    for (const [matId, bucket] of Object.entries(this.buckets)) {
      const c = counters[matId];
      for (const part of ['wallFull', 'wallTile', 'floorFull', 'floorTile', 'rampFull', 'rampHalf']) {
        const mesh = bucket[part];
        mesh.count = c[part];
        if (c[part] > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }
}
