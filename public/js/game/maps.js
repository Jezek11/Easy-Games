import * as THREE from 'three';
import {
  ARENA_HALF_GRID,
  ARENA_HALF_SIZE,
  BR_HALF_GRID,
  BR_HALF_SIZE,
  CELL_SIZE,
  RAMP_THICKNESS,
  SLOPE_ANGLE,
  SLOPE_LEN,
  WALL_HEIGHT
} from './constants.js';
import {
  STRUCT_VERTEX_MAT,
  getStructureGeo,
  getStructureSize,
  onStructuresLoaded
} from './structureAssets.js';

function createBRGroundTexture() {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#48a845';
  ctx.fillRect(0, 0, size, size);

  // Deterministic pseudo-random helper so texture wraps seamlessly across tile edges
  let seed = 4219;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const drawWrapped = (x, y, fn) => {
    for (let ox = -size; ox <= size; ox += size) {
      for (let oy = -size; oy <= size; oy += size) {
        fn(x + ox, y + oy);
      }
    }
  };

  // Soft sunlit & shaded grass meadow patches
  const patchColors = ['rgba(109, 212, 99, 0.28)', 'rgba(94, 199, 86, 0.24)', 'rgba(54, 140, 58, 0.25)'];
  for (let i = 0; i < 120; i++) {
    const px = rand() * size;
    const py = rand() * size;
    const pr = 10 + rand() * 24;
    ctx.fillStyle = patchColors[i % patchColors.length];
    drawWrapped(px, py, (wx, wy) => {
      if (wx < -pr || wx > size + pr || wy < -pr || wy > size + pr) return;
      ctx.beginPath();
      ctx.arc(wx, wy, pr, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Stylized grass blade tufts
  const bladeColors = ['#7fe062', '#64cb54', '#2f7d34', '#95eb73'];
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const gx = rand() * size;
    const gy = rand() * size;
    const len = 4 + rand() * 5;
    const tilt = (rand() - 0.5) * 4.5;
    ctx.strokeStyle = bladeColors[i % bladeColors.length];
    drawWrapped(gx, gy, (wx, wy) => {
      if (wx < -8 || wx > size + 8 || wy < -8 || wy > size + 8) return;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + tilt, wy - len);
      ctx.stroke();
    });
  }

  // Tiny wildflower accents
  const flowerColors = ['#fef08a', '#ffffff', '#bae6fd'];
  for (let i = 0; i < 24; i++) {
    const fx = rand() * size;
    const fy = rand() * size;
    ctx.fillStyle = flowerColors[i % flowerColors.length];
    drawWrapped(fx, fy, (wx, wy) => {
      if (wx < -4 || wx > size + 4 || wy < -4 || wy > size + 4) return;
      ctx.fillRect(wx - 1, wy - 1, 2.5, 2.5);
    });
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(BR_HALF_GRID * 1.5, BR_HALF_GRID * 1.5);
  return tex;
}

function createOceanTexture() {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0ea5e9';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
  for (let y = 8; y < size; y += 22) {
    for (let x = (y % 44 === 8 ? 6 : 20); x < size; x += 38) {
      ctx.fillRect(x, y, 22, 5);
    }
  }
  ctx.fillStyle = 'rgba(224, 242, 254, 0.35)';
  for (let y = 16; y < size; y += 30) {
    for (let x = (y % 60 === 16 ? 12 : 28); x < size; x += 48) {
      ctx.fillRect(x, y, 14, 2.5);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 18);
  return tex;
}

function createIronBarrierTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 64, 64);
  grad.addColorStop(0, '#94a8bd');
  grad.addColorStop(1, '#5d7186');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 60, 60);

  ctx.fillStyle = '#475569';
  ctx.fillRect(30, 4, 4, 56);
  ctx.fillRect(4, 30, 56, 4);

  ctx.fillStyle = '#d9f94e';
  for (let x = 4; x < 60; x += 12) {
    ctx.fillRect(x, 6, 6, 3);
    ctx.fillRect(x, 55, 6, 3);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

export class ArenaMapManager {
  constructor(scene) {
    this.scene = scene;
    this.mapId = 'skybox';
    this.halfSize = ARENA_HALF_SIZE;
    this.halfGrid = ARENA_HALF_GRID;
    this.disableResetButtons = false;
    this.barrierActive = false;

    this.group = new THREE.Group();
    this.barrierGroup = new THREE.Group();
    this.boostPadMeshes = [];
    this.scene.add(this.group);
    this.scene.add(this.barrierGroup);

    // Collision descriptors consumed by physics.js
    this.staticBoxes = [];
    this.staticRamps = [];
    this.barrierBoxes = [];
    this.boostPads = [];
    this.poiMarkers = [];
    this.lootSpawns = [];
    this.spawnPoints = [
      { x: 0, y: 0, z: 12, yaw: 0 },
      { x: 0, y: 0, z: -12, yaw: Math.PI }
    ];

    this.brGroundTex = createBRGroundTexture();
    this.oceanTex = createOceanTexture();
    this.ironTex = createIronBarrierTexture();

    this.matTiers = {
      low: {
        deck: new THREE.MeshBasicMaterial({ color: 0x3a5278 }),
        deckTop: new THREE.MeshBasicMaterial({ color: 0x4b6a96 }),
        brFloor: new THREE.MeshBasicMaterial({ color: 0x48a845 }),
        brSandstone: new THREE.MeshBasicMaterial({ color: 0xc29b67 }),
        brBeachTrim: new THREE.MeshBasicMaterial({ color: 0xf4d898 }),
        brPlaza: new THREE.MeshBasicMaterial({ color: 0xdbe4ef }),
        oceanMat: new THREE.MeshBasicMaterial({ color: 0x0ea5e9 }),
        brStone: new THREE.MeshBasicMaterial({ color: 0x6b7c93 }),
        brWall: new THREE.MeshBasicMaterial({ color: 0x4f647d }),
        brCrate: new THREE.MeshBasicMaterial({ color: 0xb98249 }),
        glass: new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
        trimCyan: new THREE.MeshBasicMaterial({ color: 0x3b82f6 }),
        trimVolt: new THREE.MeshBasicMaterial({ color: 0xef4444 }),
        boostCore: new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
        vRampBase: new THREE.MeshBasicMaterial({ color: 0x3a5278 }),
        ironWall: new THREE.MeshBasicMaterial({ color: 0x7f94aa }),
        gateGlass: new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
        landingRing: new THREE.MeshBasicMaterial({ color: 0xd9f94e, side: THREE.DoubleSide })
      },
      medium: {
        deck: new THREE.MeshLambertMaterial({ color: 0x3a5278 }),
        deckTop: new THREE.MeshLambertMaterial({ color: 0x4b6a96 }),
        brFloor: new THREE.MeshLambertMaterial({ color: 0xffffff, map: this.brGroundTex }),
        brSandstone: new THREE.MeshLambertMaterial({ color: 0xc29b67 }),
        brBeachTrim: new THREE.MeshLambertMaterial({ color: 0xf4d898 }),
        brPlaza: new THREE.MeshLambertMaterial({ color: 0xdbe4ef }),
        oceanMat: new THREE.MeshBasicMaterial({ map: this.oceanTex, color: 0xffffff }),
        brStone: new THREE.MeshLambertMaterial({ color: 0x6b7c93 }),
        brWall: new THREE.MeshLambertMaterial({ color: 0x4f647d }),
        brCrate: new THREE.MeshLambertMaterial({ color: 0xb98249 }),
        glass: new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
        trimCyan: new THREE.MeshBasicMaterial({ color: 0x3b82f6 }),
        trimVolt: new THREE.MeshBasicMaterial({ color: 0xef4444 }),
        boostCore: new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
        vRampBase: new THREE.MeshLambertMaterial({ color: 0x3a5278 }),
        ironWall: new THREE.MeshLambertMaterial({ color: 0xffffff, map: this.ironTex }),
        gateGlass: new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
        landingRing: new THREE.MeshBasicMaterial({ color: 0xd9f94e, side: THREE.DoubleSide })
      },
      high: {
        deck: new THREE.MeshStandardMaterial({ color: 0x3a5278, roughness: 0.52, metalness: 0.25 }),
        deckTop: new THREE.MeshStandardMaterial({ color: 0x4b6a96, roughness: 0.45, metalness: 0.3 }),
        brFloor: new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.brGroundTex, roughness: 0.88, metalness: 0.02 }),
        brSandstone: new THREE.MeshStandardMaterial({ color: 0xc29b67, roughness: 0.9, metalness: 0.02 }),
        brBeachTrim: new THREE.MeshStandardMaterial({ color: 0xf4d898, roughness: 0.86, metalness: 0.02 }),
        brPlaza: new THREE.MeshStandardMaterial({ color: 0xdbe4ef, roughness: 0.6, metalness: 0.12 }),
        oceanMat: new THREE.MeshBasicMaterial({ map: this.oceanTex, color: 0xffffff }),
        brStone: new THREE.MeshStandardMaterial({ color: 0x6b7c93, roughness: 0.78, metalness: 0.1 }),
        brWall: new THREE.MeshStandardMaterial({ color: 0x4f647d, roughness: 0.58, metalness: 0.28 }),
        brCrate: new THREE.MeshStandardMaterial({ color: 0xb98249, roughness: 0.8, metalness: 0.04 }),
        glass: new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
        trimCyan: new THREE.MeshBasicMaterial({ color: 0x3b82f6 }),
        trimVolt: new THREE.MeshBasicMaterial({ color: 0xef4444 }),
        boostCore: new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
        vRampBase: new THREE.MeshStandardMaterial({ color: 0x3a5278, roughness: 0.52, metalness: 0.25 }),
        ironWall: new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.ironTex, roughness: 0.48, metalness: 0.55 }),
        gateGlass: new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
        landingRing: new THREE.MeshBasicMaterial({ color: 0xd9f94e, side: THREE.DoubleSide })
      }
    };

    this._matToKey = new Map();
    for (const tier of Object.values(this.matTiers)) {
      for (const [key, mat] of Object.entries(tier)) {
        this._matToKey.set(mat, key);
      }
    }
    this._currentQuality = 'medium';
    this.mats = this.matTiers.medium;
    this._structBasicMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  }

  _bindStructureMesh(mesh, structName, w, h, d, rotateIfDeep = false) {
    if (!structName) return;
    if (!this._structBindings) this._structBindings = [];
    const entry = { mesh, structName, w, h, d, rotateIfDeep };
    this._structBindings.push(entry);
    this._applyStructureBinding(entry);
  }

  _applyStructureBinding(entry) {
    const geo = getStructureGeo(entry.structName);
    const nativeSize = getStructureSize(entry.structName);
    if (!geo || !nativeSize || !geo.attributes?.color) return false;
    const { mesh, w, h, d, rotateIfDeep } = entry;
    mesh.geometry = geo;
    mesh.material = STRUCT_VERTEX_MAT;
    if (w != null && h != null && d != null) {
      if (rotateIfDeep && d > w * 1.35) {
        mesh.rotation.y = Math.PI * 0.5;
        mesh.scale.set(
          d / Math.max(0.01, nativeSize.x),
          h / Math.max(0.01, nativeSize.y),
          w / Math.max(0.01, nativeSize.z)
        );
      } else {
        mesh.scale.set(
          w / Math.max(0.01, nativeSize.x),
          h / Math.max(0.01, nativeSize.y),
          d / Math.max(0.01, nativeSize.z)
        );
      }
    }
    mesh.updateMatrix();
    return true;
  }

  _applyBlenderStructures() {
    if (!this._structBindings) return;
    for (const entry of this._structBindings) {
      this._applyStructureBinding(entry);
    }
  }

  loadMap(mapId) {
    this.mapId = mapId === 'vramp' ? 'vramp' : (mapId === 'br' ? 'br' : 'skybox');
    this.halfSize = this.mapId === 'br' ? BR_HALF_SIZE : ARENA_HALF_SIZE;
    this.halfGrid = this.mapId === 'br' ? BR_HALF_GRID : ARENA_HALF_GRID;
    this.disableResetButtons = this.mapId === 'br';
    this._structBindings = [];
    if (!this._structSub) {
      this._structSub = onStructuresLoaded(() => this._applyBlenderStructures());
    }

    this._clearGroup(this.group);
    this._clearGroup(this.barrierGroup);
    this.staticBoxes = [];
    this.staticRamps = [];
    this.barrierBoxes = [];
    this.boostPads = [];
    this.boostPadMeshes = [];
    this.poiMarkers = [];
    this.lootSpawns = [];
    this.barrierActive = false;

    if (this.mapId === 'skybox') {
      this._buildSkyBoxMap();
    } else if (this.mapId === 'vramp') {
      this._buildVRampMap();
    } else {
      this._buildBRIslandMap();
    }
    this.setQuality(this._currentQuality);
  }

  unloadMap() {
    this._clearGroup(this.group);
    this._clearGroup(this.barrierGroup);
    this.staticBoxes = [];
    this.staticRamps = [];
    this.barrierBoxes = [];
    this.boostPads = [];
    this.boostPadMeshes = [];
    this.poiMarkers = [];
    this.lootSpawns = [];
    this._structBindings = [];
    this.barrierActive = false;
  }

  _clearGroup(grp) {
    while (grp.children.length > 0) {
      const child = grp.children[0];
      grp.remove(child);
      if (child.geometry && !child.userData.sharedGeo) {
        child.geometry.dispose();
      }
    }
  }

  _addStaticBox(x, y, z, w, h, d, mat, castShadow = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);

    let structName = null;
    let rotateIfDeep = false;
    if (mat === this.mats.deck) {
      structName = 'SkyPod_Deck';
    } else if (mat === this.mats.brCrate) {
      structName = 'POI_Crate_Unit';
    } else if (mat === this.mats.brStone) {
      if (w >= 7.0 && d >= 7.0) {
        structName = h < 1.5 ? 'POI_Hub_Plinth' : 'POI_Fort_Deck';
      } else {
        structName = 'POI_Cover_Unit';
        rotateIfDeep = true;
      }
    } else if (mat === this.mats.brWall) {
      if (Math.abs(w - d) < 0.25 && w <= 2.4 && h >= 2.5) {
        structName = 'POI_Pillar';
      } else {
        structName = 'POI_Wall_Unit';
        rotateIfDeep = true;
      }
    }
    if (structName) {
      this._bindStructureMesh(mesh, structName, w, h, d, rotateIfDeep);
    }

    this.staticBoxes.push({
      minX: x - w * 0.5,
      minY: y - h * 0.5,
      minZ: z - d * 0.5,
      maxX: x + w * 0.5,
      maxY: y + h * 0.5,
      maxZ: z + d * 0.5
    });
    return mesh;
  }

  _buildSkyBoxMap() {
    // Elevated Spawn Boxes placed just OUTSIDE the arena walls (z = +-46, y = 13)
    // Boost Pad throws player fast right over the perimeter wall straight to arena center (0, 0, 0)
    const boxY = 13.0;

    const buildPod = (centerZ, dirSign) => {
      // Floor deck (8.4m x 0.45m x 8.4m) -> top at y = 13.0
      this._addStaticBox(0, boxY - 0.225, centerZ, 8.4, 0.45, 8.4, this.mats.deckTop, true);

      // Glowing under-frame & cyan rim
      const rim = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.16, 8.6), this.mats.trimCyan);
      rim.position.set(0, boxY - 0.46, centerZ);
      rim.matrixAutoUpdate = false;
      rim.updateMatrix();
      this.group.add(rim);

      // Support pillar down toward void for visual grounding
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 13.0, 2.4), this.mats.deck);
      pillar.position.set(0, boxY * 0.5 - 0.5, centerZ);
      pillar.matrixAutoUpdate = false;
      pillar.updateMatrix();
      this.group.add(pillar);
      this._bindStructureMesh(pillar, 'SkyPod_Pillar', 2.4, 13.0, 2.4, false);

      // Back translucent glass wall
      const backZ = centerZ + dirSign * 4.05;
      this._addStaticBox(0, boxY + 1.5, backZ, 8.2, 3.0, 0.22, this.mats.glass, false);

      // Left & Right side glass rails
      this._addStaticBox(-4.05, boxY + 1.5, centerZ, 0.22, 3.0, 8.2, this.mats.glass, false);
      this._addStaticBox(4.05, boxY + 1.5, centerZ, 0.22, 3.0, 8.2, this.mats.glass, false);

      // Top side accent beams
      const beamL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 8.4), this.mats.trimVolt);
      beamL.position.set(-4.05, boxY + 3.06, centerZ);
      beamL.matrixAutoUpdate = false;
      beamL.updateMatrix();
      const beamR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 8.4), this.mats.trimVolt);
      beamR.position.set(4.05, boxY + 3.06, centerZ);
      beamR.matrixAutoUpdate = false;
      beamR.updateMatrix();
      this.group.add(beamL, beamR);

      // Open front Boost Pad facing arena center -> throws fast toward z = 0
      const padZ = centerZ - dirSign * 3.15;
      const padBase = new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.16, 2.0), this.mats.trimVolt);
      padBase.position.set(0, boxY + 0.06, padZ);
      padBase.matrixAutoUpdate = false;
      padBase.updateMatrix();
      this._bindStructureMesh(padBase, 'SkyPod_BoostPad', 8.0, 0.18, 2.0, false);
      const padGlow = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.2, 1.5), this.mats.boostCore);
      padGlow.position.set(0, boxY + 0.08, padZ);
      this.group.add(padBase, padGlow);
      this.boostPadMeshes.push(padGlow);

      this.boostPads.push({
        minX: -4.0,
        minY: boxY - 0.1,
        minZ: padZ - 1.05,
        maxX: 4.0,
        maxY: boxY + 2.6,
        maxZ: padZ + 1.05,
        vx: 0,
        vy: 7.0,
        vz: -dirSign * 36.5
      });
    };

    buildPod(46.0, 1);   // Player 0 South external Sky Box -> throws toward z = 0
    buildPod(-46.0, -1); // Player 1 / Bot North external Sky Box -> throws toward z = 0

    // Center landing ring marker on the arena floor
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(4.2, 4.7, 28),
      this.mats.landingRing
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    ring.matrixAutoUpdate = false;
    ring.updateMatrix();
    this.group.add(ring);

    this.spawnPoints = [
      { x: 0, y: boxY, z: 47.2, yaw: 0 },
      { x: 0, y: boxY, z: -47.2, yaw: Math.PI }
    ];
  }

  _buildVRampMap() {
    // Pure V-shape (\ /): only the two opposing ramps meeting at z = 0, no extra platforms or cages
    const addVRamp = (gx, gz, rot, trimMat) => {
      this.staticRamps.push({ gx, gy: 0, gz, rot, mask: 0x3 });

      const cx = (gx + 0.5) * CELL_SIZE;
      const cy = 0.5 * WALL_HEIGHT;
      const cz = (gz + 0.5) * CELL_SIZE;
      const ry = -rot * (Math.PI * 0.5);

      const rampMesh = new THREE.Mesh(
        new THREE.BoxGeometry(CELL_SIZE, RAMP_THICKNESS, SLOPE_LEN),
        this.mats.vRampBase
      );
      rampMesh.rotation.order = 'YXZ';
      rampMesh.rotation.set(SLOPE_ANGLE, ry, 0, 'YXZ');
      rampMesh.position.set(cx, cy, cz);
      rampMesh.castShadow = true;
      rampMesh.receiveShadow = true;
      rampMesh.matrixAutoUpdate = false;
      rampMesh.updateMatrix();
      this.group.add(rampMesh);
      this._bindStructureMesh(rampMesh, 'Map_StaticRamp', null, null, null, false);

      for (const sideX of [-CELL_SIZE * 0.48, CELL_SIZE * 0.48]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, 0.28, SLOPE_LEN),
          trimMat
        );
        rail.rotation.order = 'YXZ';
        rail.rotation.set(SLOPE_ANGLE, ry, 0, 'YXZ');
        rail.position.set(cx + sideX, cy + 0.05, cz);
        rail.matrixAutoUpdate = false;
        rail.updateMatrix();
        this.group.add(rail);
      }
    };

    addVRamp(0, 0, 2, this.mats.trimCyan);  // South arm of V (rises toward +Z -> y=3.5 at z=4)
    addVRamp(0, -1, 0, this.mats.trimVolt); // North arm of V (rises toward -Z -> y=3.5 at z=-4)

    // ONLY the Iron dividing wall at z = 0 (zero surrounding glass cages or trapping boxes)
    const wallW = 8.0;
    const wallH = 7.5;
    const wallD = 0.28;
    const ironWall = new THREE.Mesh(new THREE.BoxGeometry(wallW, wallH, wallD), this.mats.ironWall);
    ironWall.position.set(2.0, wallH * 0.5, 0.0);
    ironWall.matrixAutoUpdate = false;
    ironWall.updateMatrix();
    this.barrierGroup.add(ironWall);
    this._bindStructureMesh(ironWall, 'Map_IronBarrier', wallW, wallH, wallD, false);
    this.barrierBoxes.push({
      minX: 2.0 - wallW * 0.5,
      minY: 0,
      minZ: -wallD * 0.5,
      maxX: 2.0 + wallW * 0.5,
      maxY: wallH,
      maxZ: wallD * 0.5
    });

    this.setBarrierVisible(false);

    // Players stand openly on the top outer slopes of the V (no movement/shooting until START)
    this.spawnPoints = [
      { x: 2.0, y: 3.22, z: 3.55, yaw: 0 },       // Faces -Z toward Iron Wall & North opponent
      { x: 2.0, y: 3.22, z: -3.55, yaw: Math.PI } // Faces +Z toward Iron Wall & South opponent
    ];
  }

  _addStaticRamp(gx, gy, gz, rot, trimMat) {
    this.staticRamps.push({ gx, gy, gz, rot, mask: 0x3 });
    const cx = (gx + 0.5) * CELL_SIZE;
    const cy = (gy + 0.5) * WALL_HEIGHT;
    const cz = (gz + 0.5) * CELL_SIZE;
    const ry = -rot * (Math.PI * 0.5);

    const rampMesh = new THREE.Mesh(
      new THREE.BoxGeometry(CELL_SIZE, RAMP_THICKNESS, SLOPE_LEN),
      this.mats.vRampBase
    );
    rampMesh.rotation.order = 'YXZ';
    rampMesh.rotation.set(SLOPE_ANGLE, ry, 0, 'YXZ');
    rampMesh.position.set(cx, cy, cz);
    rampMesh.castShadow = true;
    rampMesh.receiveShadow = true;
    rampMesh.matrixAutoUpdate = false;
    rampMesh.updateMatrix();
    this.group.add(rampMesh);
    this._bindStructureMesh(rampMesh, 'Map_StaticRamp', null, null, null, false);

    if (trimMat) {
      for (const sideX of [-CELL_SIZE * 0.46, CELL_SIZE * 0.46]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, SLOPE_LEN), trimMat);
        rail.rotation.order = 'YXZ';
        rail.rotation.set(SLOPE_ANGLE, ry, 0, 'YXZ');
        rail.position.set(cx + sideX, cy + 0.04, cz);
        rail.matrixAutoUpdate = false;
        rail.updateMatrix();
        this.group.add(rail);
      }
    }
  }

  _buildBRIslandMap() {
    // 144m x 144m lush sunlit grass island surrounded by turquoise ocean & sandy cliffs
    const full = BR_HALF_SIZE * 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(full, full), this.mats.brFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.matrixAutoUpdate = false;
    floor.updateMatrix();
    this.group.add(floor);

    // Decorative turquoise tropical ocean below island (zero collision — ocean edge drop triggers death)
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), this.mats.oceanMat);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -5.5;
    ocean.matrixAutoUpdate = false;
    ocean.updateMatrix();
    this.group.add(ocean);

    // Warm sandstone coastal cliff skirt plunging to ocean
    const underSlab = new THREE.Mesh(new THREE.BoxGeometry(full, 5.5, full), this.mats.brSandstone);
    underSlab.position.set(0, -2.76, 0);
    underSlab.matrixAutoUpdate = false;
    underSlab.updateMatrix();
    this.group.add(underSlab);

    const nsGeo = new THREE.BoxGeometry(full + 1.4, 0.22, 1.4);
    const ewGeo = new THREE.BoxGeometry(1.4, 0.22, full + 1.4);
    for (const s of [-1, 1]) {
      const m1 = new THREE.Mesh(nsGeo, this.mats.brBeachTrim);
      m1.position.set(0, -0.09, s * BR_HALF_SIZE);
      m1.matrixAutoUpdate = false;
      m1.updateMatrix();
      this.group.add(m1);

      const m2 = new THREE.Mesh(ewGeo, this.mats.brBeachTrim);
      m2.position.set(s * BR_HALF_SIZE, -0.09, 0);
      m2.matrixAutoUpdate = false;
      m2.updateMatrix();
      this.group.add(m2);
    }

    // Central Hub paved sunlit plaza courtyard
    const hubPlaza = new THREE.Mesh(new THREE.CircleGeometry(10.5, 24), this.mats.brPlaza);
    hubPlaza.rotation.x = -Math.PI / 2;
    hubPlaza.position.y = 0.02;
    hubPlaza.receiveShadow = true;
    hubPlaza.matrixAutoUpdate = false;
    hubPlaza.updateMatrix();
    this.group.add(hubPlaza);

    // 1. Central Spire (0, 0) — center high-action arena hub
    this._addStaticBox(0, 0.35, 0, 8.0, 0.7, 8.0, this.mats.brStone, true);
    for (const cx of [-6.5, 6.5]) {
      for (const cz of [-6.5, 6.5]) {
        this._addStaticBox(cx, 1.75, cz, 1.8, 3.5, 1.8, this.mats.brWall, true);
      }
    }
    this.poiMarkers.push({ name: 'Hub', x: 0, z: 0 });
    this.lootSpawns.push({ x: 0, y: 0.7, z: 0 }, { x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });

    // 2. NW Watchtower (-34, -36) — elevated deck (z:-40..-32) + flush ramp (z:-32..-28)
    this._addStaticBox(-34, 1.75, -36, 8.0, 3.5, 8.0, this.mats.brStone, true);
    this._addStaticBox(-34, 4.3, -39.6, 7.6, 1.6, 0.4, this.mats.trimVolt, false);
    this._addStaticRamp(-9, 0, -8, 0, this.mats.trimVolt);
    this.poiMarkers.push({ name: 'Tower', x: -34, z: -36 });
    this.lootSpawns.push({ x: -34, y: 3.5, z: -36 }, { x: -38, y: 0, z: -26 });

    // 3. NE Solar Depot (+34, -32) — warehouse walls + loot crates
    this._addStaticBox(34, 1.75, -37.5, 12.0, 3.5, 0.5, this.mats.brWall, true);
    this._addStaticBox(28.25, 1.75, -32, 0.5, 3.5, 10.5, this.mats.brWall, true);
    this._addStaticBox(39.75, 1.75, -32, 0.5, 3.5, 10.5, this.mats.brWall, true);
    this._addStaticBox(33.5, 0.9, -32, 2.0, 1.8, 2.0, this.mats.brCrate, true);
    this._addStaticBox(36.5, 0.65, -30, 1.4, 1.3, 1.4, this.mats.brCrate, true);
    this.poiMarkers.push({ name: 'Depot', x: 34, z: -32 });
    this.lootSpawns.push({ x: 34, y: 0, z: -34 }, { x: 24, y: 0, z: -30 });

    // 4. SW Cyber Bunker (-34, +34) — bunker fort walls + cover crates
    this._addStaticBox(-34, 1.75, 38.5, 10.5, 3.5, 0.5, this.mats.brWall, true);
    this._addStaticBox(-39.0, 1.75, 33.5, 0.5, 3.5, 9.5, this.mats.brWall, true);
    this._addStaticBox(-31.0, 1.0, 31.0, 2.8, 2.0, 2.8, this.mats.brCrate, true);
    this._addStaticBox(-35.5, 0.85, 33.0, 2.0, 1.7, 2.0, this.mats.brStone, true);
    this.poiMarkers.push({ name: 'Bunker', x: -34, z: 34 });
    this.lootSpawns.push({ x: -34, y: 0, z: 35 }, { x: -24, y: 0, z: 36 });

    // 5. SE Volt Ruins (+34, +36) — elevated deck (z:32..40) + flush ramp (z:28..32) + crates
    this._addStaticBox(34, 1.75, 36, 8.0, 3.5, 8.0, this.mats.brStone, true);
    this._addStaticBox(34, 4.3, 39.6, 7.6, 1.6, 0.4, this.mats.trimCyan, false);
    this._addStaticRamp(8, 0, 7, 2, this.mats.trimCyan);
    this._addStaticBox(44, 1.1, 26, 2.4, 2.2, 2.4, this.mats.brCrate, true);
    this.poiMarkers.push({ name: 'Ruins', x: 34, z: 36 });
    this.lootSpawns.push({ x: 34, y: 3.5, z: 36 }, { x: 40, y: 0, z: 22 });

    // Scattered tactical rotation cover stones & extra outer loot orbs
    const laneCover = [
      [-18, 0, -2, 3.4, 2.4, 1.2],
      [18, 0, 2, 3.4, 2.4, 1.2],
      [2, 0, -22, 3.8, 2.2, 1.2],
      [-2, 0, 22, 3.8, 2.2, 1.2],
      [-52, 0, 0, 2.4, 2.8, 2.4],
      [52, 0, 0, 2.4, 2.8, 2.4],
      [0, 0, -52, 2.4, 2.8, 2.4],
      [0, 0, 52, 2.4, 2.8, 2.4]
    ];
    for (const [bx, _by, bz, bw, bh, bd] of laneCover) {
      this._addStaticBox(bx, bh * 0.5, bz, bw, bh, bd, this.mats.brStone, true);
    }

    this.lootSpawns.push(
      { x: -18, y: 0, z: -5 },
      { x: 18, y: 0, z: 5 },
      { x: 0, y: 0, z: -50 },
      { x: 0, y: 0, z: 50 }
    );
  }

  setBarrierVisible(active) {
    this.barrierActive = Boolean(active) && this.mapId === 'vramp';
    this.barrierGroup.visible = this.barrierActive;
  }

  setQuality(qualityKey) {
    const q = qualityKey === 'low' ? 'low' : (qualityKey === 'high' ? 'high' : 'medium');
    this._currentQuality = q;
    const tierMats = this.matTiers[q];
    this.mats = tierMats;
    const enableShadows = q !== 'low';

    const applyToGroup = (grp) => {
      grp.traverse((obj) => {
        if (!obj.isMesh) return;
        if (obj.material === STRUCT_VERTEX_MAT || obj.material === this._structBasicMat) {
          obj.material = q === 'low' ? this._structBasicMat : STRUCT_VERTEX_MAT;
          obj.material.needsUpdate = true;
          obj.castShadow = enableShadows;
          obj.receiveShadow = enableShadows;
          return;
        }
        const key = obj.userData.matKey || this._matToKey.get(obj.material);
        if (key && tierMats[key]) {
          obj.userData.matKey = key;
          obj.material = tierMats[key];
          obj.material.needsUpdate = true;
        }
        obj.castShadow = enableShadows && key !== 'glass' && key !== 'gateGlass' && key !== 'oceanMat' && key !== 'brFloor' && key !== 'brPlaza' && key !== 'landingRing';
        obj.receiveShadow = enableShadows && key !== 'glass' && key !== 'gateGlass';
      });
    };

    applyToGroup(this.group);
    applyToGroup(this.barrierGroup);
  }

  setShadowsEnabled(enabled) {
    this.group.traverse((obj) => {
      if (obj.isMesh) {
        const key = obj.userData.matKey || this._matToKey.get(obj.material);
        obj.castShadow = enabled && key !== 'glass' && key !== 'oceanMat' && key !== 'brFloor' && key !== 'brPlaza' && key !== 'landingRing';
        obj.receiveShadow = enabled && key !== 'glass';
      }
    });
  }

  update(time) {
    for (let i = 0; i < this.boostPadMeshes.length; i++) {
      const m = this.boostPadMeshes[i];
      m.position.y = 13.08 + Math.sin(time * 5 + i) * 0.03;
    }
  }

  dispose() {
    this.unloadMap();
    if (this._structSub) this._structSub();
    if (this.brGroundTex) this.brGroundTex.dispose();
    if (this.oceanTex) this.oceanTex.dispose();
    if (this.ironTex) this.ironTex.dispose();
    this._structBasicMat.dispose();
    for (const mat of this._matToKey.keys()) {
      mat.dispose();
    }
    this._matToKey.clear();
  }
}
