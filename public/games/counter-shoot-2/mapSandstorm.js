import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FLAT_COLORS = {
  sand: 0xcab48a,
  cobble: 0xa99a82,
  sandstone: 0xd2b88d,
  plaster: 0xe3d6be,
  crate: 0x9f6b3a,
  metalDoor: 0x4b5866,
  woodTrim: 0x7b5230,
  siteA: 0xd99b26,
  siteB: 0xc94a38,
  barrier: 0xd97706
};

const MAT_CONFIG = {
  sand: { tex: 'sand', tile: 4.0, roughness: 0.94, metalness: 0.02 },
  cobble: { tex: 'cobble', tile: 3.2, roughness: 0.88, metalness: 0.04 },
  sandstone: { tex: 'sandstone', tile: 3.4, roughness: 0.9, metalness: 0.03 },
  plaster: { tex: 'plaster', tile: 4.0, roughness: 0.92, metalness: 0.02 },
  crate: { tex: 'crate', tile: 1.8, roughness: 0.82, metalness: 0.08, stretchesUV: true },
  metalDoor: { tex: 'metalDoor', tile: 3.6, roughness: 0.45, metalness: 0.65 },
  woodTrim: { tex: 'woodTrim', tile: 2.5, roughness: 0.85, metalness: 0.04 },
  siteA: { tex: 'siteA', tile: 1.0, roughness: 0.86, metalness: 0.04, stretchesUV: true },
  siteB: { tex: 'siteB', tile: 1.0, roughness: 0.86, metalness: 0.04, stretchesUV: true },
  barrier: { tex: 'barrier', tile: 3.5, roughness: 0.78, metalness: 0.15 }
};

function createScaledBoxGeometry(w, h, d, cx, cy, cz, tileSize, stretchFull = false) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  if (!stretchFull && tileSize > 0) {
    // Faces order in BoxGeometry: +X (d,h), -X (d,h), +Y (w,d), -Y (w,d), +Z (w,h), -Z (w,h)
    const faceScales = [
      [d / tileSize, h / tileSize],
      [d / tileSize, h / tileSize],
      [w / tileSize, d / tileSize],
      [w / tileSize, d / tileSize],
      [w / tileSize, h / tileSize],
      [w / tileSize, h / tileSize]
    ];
    for (let f = 0; f < 6; f++) {
      const [su, sv] = faceScales[f];
      const base = f * 4;
      for (let v = 0; v < 4; v++) {
        uv.setXY(base + v, uv.getX(base + v) * su, uv.getY(base + v) * sv);
      }
    }
  }
  geo.translate(cx, cy, cz);
  return geo;
}

function createDesertSkyDome(sunDir) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 20, 14);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    uniforms: {
      uSunDir: { value: sunDir.clone().normalize() }
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float sunDot = max(dot(d, uSunDir), 0.0);
        vec3 zenith = vec3(0.18, 0.45, 0.78);
        vec3 midSky = vec3(0.54, 0.74, 0.90);
        vec3 horizon = vec3(0.93, 0.85, 0.72);
        vec3 nadir = vec3(0.75, 0.65, 0.50);

        vec3 col;
        if (h >= 0.0) {
          vec3 low = mix(horizon, midSky, smoothstep(0.0, 0.28, h));
          col = mix(low, zenith, smoothstep(0.24, 0.9, h));
        } else {
          col = mix(horizon, nadir, smoothstep(0.0, 0.35, -h));
        }
        col += vec3(1.0, 0.90, 0.70) * pow(sunDot, 18.0) * 0.45;
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -3;
  group.add(dome);

  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.055, 18),
    new THREE.MeshBasicMaterial({ color: 0xfff7d6, fog: false, depthWrite: false })
  );
  sunDisc.position.copy(sunDir).normalize().multiplyScalar(0.9);
  sunDisc.lookAt(0, 0, 0);
  sunDisc.renderOrder = -2;
  group.add(sunDisc);

  return group;
}

export class SandstormMap {
  constructor(scene, textureMgr) {
    this.scene = scene;
    this.textureMgr = textureMgr;
    this.sunDir = new THREE.Vector3(28, 44, 18).normalize();

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.skyDome = createDesertSkyDome(this.sunDir);
    this.skyDome.scale.setScalar(180);
    this.scene.add(this.skyDome);

    this.hemiLight = new THREE.HemisphereLight(0xfff0d4, 0x8d7452, 1.05);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff3db, 2.05);
    this.dirLight.position.copy(this.sunDir).multiplyScalar(75);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 180;
    const sc = 48;
    this.dirLight.shadow.camera.left = -sc;
    this.dirLight.shadow.camera.right = sc;
    this.dirLight.shadow.camera.top = sc;
    this.dirLight.shadow.camera.bottom = -sc;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    this.baseBoxes = [];
    this.wingmanBarriers = [];
    this.allMeshes = [];
    this.raycastTargets = [];
    this.wingmanRaycastTargets = [];
    this.barrierMesh = null;
    this._materialsByMesh = new Map();
    this._geometries = [];
    this._disposableMaterials = [];

    this._buildGeometryData();
    this._createMeshes();
    this._initWaypoints();
  }

  _addBox(minX, minY, minZ, maxX, maxY, maxZ, matKey, isCollider = true, isWingmanBarrier = false) {
    const entry = {
      minX, minY, minZ, maxX, maxY, maxZ,
      w: maxX - minX,
      h: maxY - minY,
      d: maxZ - minZ,
      cx: (minX + maxX) * 0.5,
      cy: (minY + maxY) * 0.5,
      cz: (minZ + maxZ) * 0.5,
      matKey,
      isCollider
    };
    if (isWingmanBarrier) {
      this.wingmanBarriers.push(entry);
    } else {
      this.baseBoxes.push(entry);
    }
  }

  _addSteps(minX, maxX, startZ, endZ, startY, endY, steps, matKey) {
    const dz = (endZ - startZ) / steps;
    const dy = (endY - startY) / steps;
    for (let i = 0; i < steps; i++) {
      const z0 = startZ + dz * i;
      const z1 = startZ + dz * (i + 1);
      const yTop = startY + dy * (i + 1);
      this._addBox(
        minX,
        startY,
        Math.min(z0, z1),
        maxX,
        yTop,
        Math.max(z0, z1),
        matKey,
        true
      );
    }
  }

  _addStepsX(startX, endX, minZ, maxZ, startY, endY, steps, matKey) {
    const dx = (endX - startX) / steps;
    const dy = (endY - startY) / steps;
    for (let i = 0; i < steps; i++) {
      const x0 = startX + dx * i;
      const x1 = startX + dx * (i + 1);
      const yTop = startY + dy * (i + 1);
      this._addBox(
        Math.min(x0, x1),
        startY,
        minZ,
        Math.max(x0, x1),
        yTop,
        maxZ,
        matKey,
        true
      );
    }
  }

  _buildGeometryData() {
    // 1. Ground Floor (Sand base + Courtyard Cobble paving)
    this._addBox(-43, -1.0, -47, 43, 0, 47, 'sand', false);
    // Cobblestone plazas on A Site, B Site, Mid, T-Spawn & CT-Spawn
    this._addBox(16, -0.02, -24, 41, 0.02, 8, 'cobble', false); // Site A courtyard
    this._addBox(-41, -0.02, -28, -17, 0.02, 6, 'cobble', false); // Site B plaza
    this._addBox(-9, -0.02, -23, 9, 0.02, 31, 'cobble', false); // Mid lane
    this._addBox(-16, -0.02, 31, 16, 0.02, 45, 'cobble', false); // T-Spawn plaza
    this._addBox(-16, -0.02, -45, 16, 0.02, -31, 'cobble', false); // CT-Spawn plaza

    // Painted Bomb-Site Stencil Tiles (flush decorative pads)
    this._addBox(24.5, 0.01, -13.5, 27.5, 0.03, -10.5, 'siteA', false);
    this._addBox(-28.0, 0.01, -12.5, -25.0, 0.03, -9.5, 'siteB', false);

    // 2. Outer Perimeter Walls (height 7.5m)
    this._addBox(-43, 0, -47, 43, 7.5, -45, 'sandstone'); // North behind CT
    this._addBox(-43, 0, 45, 43, 7.5, 47, 'sandstone');   // South behind T
    this._addBox(-43, 0, -45, -41, 7.5, 45, 'sandstone'); // West outer
    this._addBox(41, 0, -45, 43, 7.5, 45, 'sandstone');   // East outer

    // 3. T-Spawn Courtyard Architecture & Cover
    this._addBox(-11.5, 0, 34.5, -7.2, 1.35, 36.2, 'sandstone'); // T-Spawn west cover wall
    this._addBox(7.2, 0, 34.5, 11.5, 1.35, 36.2, 'sandstone');   // T-Spawn east cover wall
    this._addBox(-16, 0, 31, -6, 5.5, 33, 'plaster');          // Arch left pillar framing Top Mid
    this._addBox(6, 0, 31, 16, 5.5, 33, 'plaster');            // Arch right pillar framing Top Mid
    this._addBox(-6, 4.2, 31, 6, 5.5, 33, 'sandstone');        // Arch overhead lintel to Top Mid

    // 4. East Lane Divider (Separating Mid & A Long / A Site)
    // South-East block between Top Mid & A Long
    this._addBox(9, 0, 12, 25, 6.2, 31, 'plaster');
    // North-East block between Mid & A Site (leaves A Connector Z=3..12 and CT-A Z=-31..-22 open)
    this._addBox(9, 0, -22, 17, 6.2, 3, 'sandstone');
    // Connector overhead lintel (gives nice tactical framing at Z=3..12)
    this._addBox(9, 4.1, 3, 17, 6.2, 12, 'plaster');

    // 5. West Lane Divider (Separating Mid & B Alley / B Site)
    // South-West block between Top Mid & B Alley
    this._addBox(-25, 0, 12, -9, 6.2, 31, 'plaster');
    // North-West block between Mid & B Site (leaves Mid->B Short Z=3..12 and CT-B Doors Z=-31..-21 open)
    this._addBox(-17, 0, -22, -9, 6.2, 3, 'sandstone');
    // Mid-to-B Short overhead lintel
    this._addBox(-17, 4.1, 3, -9, 6.2, 12, 'plaster');

    // 6. CT-Spawn & Elevated Mid Window Nest
    // Elevated CT Mid Window floor (y = 2.0m)
    this._addBox(-6, 0, -29, 6, 2.0, -23, 'sandstone');
    // Smooth 6-step staircase from CT-Spawn up to Mid Window
    this._addSteps(-3.5, 3.5, -35, -29, 0, 2.0, 6, 'cobble');
    // Mid Window front pillars, chest-high parapet sill (2.0 -> 2.85), and top header
    this._addBox(-9, 0, -24, -3.0, 6.2, -22.8, 'plaster');
    this._addBox(3.0, 0, -24, 9, 6.2, -22.8, 'plaster');
    this._addBox(-3.0, 2.0, -24, 3.0, 2.85, -22.8, 'sandstone');
    this._addBox(-3.0, 4.9, -24, 3.0, 6.2, -22.8, 'plaster');
    // Side walls enclosing CT Mid Window room
    this._addBox(-9, 0, -31, -6, 6.2, -24, 'plaster');
    this._addBox(6, 0, -31, 9, 6.2, -24, 'plaster');

    // 7. Mid Cover Crates
    this._addBox(-3.8, 0, 11.5, -2.0, 1.35, 13.3, 'crate');
    this._addBox(2.2, 0, -3.5, 4.1, 1.35, -1.6, 'crate');
    this._addBox(2.3, 1.35, -3.3, 3.9, 2.55, -1.8, 'crate'); // double crate in Mid

    // 8. Bomb Site A (East) + A Long + Elevated Platform + Ramps
    // Elevated A Platform (y = 1.2m)
    this._addBox(27, 0, -22, 41, 1.2, -8, 'sandstone');
    // South Ramp up onto A Platform (4 smooth steps)
    this._addSteps(33, 39, -4, -8, 0, 1.2, 4, 'cobble');
    // West Ramp up onto A Platform (4 smooth steps)
    this._addStepsX(23, 27, -20, -15, 0, 1.2, 4, 'cobble');
    // A Site Tactical Cover Crates
    this._addBox(22.2, 0, -10.5, 24.4, 1.4, -8.3, 'crate');       // Lower A Site base crate
    this._addBox(22.4, 1.4, -10.3, 24.2, 2.7, -8.5, 'crate');    // Double stack
    this._addBox(30.5, 1.2, -16.5, 32.3, 2.5, -14.7, 'crate');   // Platform cover crate
    this._addBox(27.5, 0, -1.5, 29.4, 1.35, 0.4, 'crate');       // A Ramp headshot crate
    this._addBox(36.0, 0, 15.0, 38.0, 1.5, 17.0, 'crate');       // A Long corner crate
    this._addBox(26.0, 0, 21.0, 29.5, 1.25, 22.4, 'sandstone');  // A Long pit wall
    // A Site decorative wall awning / upper frame near CT-A
    this._addBox(17, 4.1, -31, 27, 6.2, -29, 'sandstone');

    // 9. Bomb Site B (West) + B Apartments Balcony + Metal Doors
    // B Apartments elevated balcony deck (y = 2.1m)
    this._addBox(-41, 0, -16, -33.5, 2.1, 4, 'plaster');
    // Walkable stairs from T West Alley up to B Apartments
    this._addSteps(-40.5, -34.5, 10, 4, 0, 2.1, 6, 'woodTrim');
    // Balcony wood railing/parapet (leaves open drop-out gap Z = -10..-6)
    this._addBox(-34.2, 2.1, -6, -33.5, 3.05, 4, 'woodTrim');
    this._addBox(-34.2, 2.1, -16, -33.5, 3.05, -10, 'woodTrim');
    // B Apartments back roof/frame overhead
    this._addBox(-41, 4.6, -16, -33.5, 6.2, 4, 'plaster');
    // Ground tunnel arch separating T West Alley from B Site
    this._addBox(-33.5, 0, 4, -29, 4.4, 6, 'sandstone');
    this._addBox(-24, 0, 4, -17, 4.4, 6, 'sandstone');
    this._addBox(-29, 3.6, 4, -24, 5.2, 6, 'sandstone');

    // B Site Pillar & Crates
    this._addBox(-27.2, 0, -15.2, -24.8, 4.6, -12.8, 'sandstone'); // Site B central pillar
    this._addBox(-30.6, 0, -20.2, -28.4, 1.35, -18.0, 'crate');    // Back B crate
    this._addBox(-30.4, 1.35, -20.0, -28.6, 2.55, -18.2, 'crate'); // Double B crate
    this._addBox(-23.2, 0, -10.8, -21.4, 1.25, -9.0, 'crate');     // Front B cover crate
    this._addBox(-35.0, 0, 18.0, -33.0, 1.4, 20.0, 'crate');       // T West Alley cover crate

    // CT to B Metal Double Doors (3.8m doorway at Z = -27.9..-24.1)
    this._addBox(-17.4, 0, -31, -16.6, 5.0, -27.9, 'metalDoor');
    this._addBox(-17.4, 0, -24.1, -16.6, 5.0, -21, 'metalDoor');
    this._addBox(-17.4, 3.8, -27.9, -16.6, 5.0, -24.1, 'metalDoor');
    // CT-Spawn North-West wing wall
    this._addBox(-26, 0, -33, -17, 5.5, -31, 'plaster');

    // 10. Wingman (2v2) Barriers blocking B-side routes cleanly
    // Barrier 1: T-Spawn to B Alley
    this._addBox(-26.5, 0, 31, -24.8, 4.2, 45, 'barrier', true, true);
    // Barrier 2: Mid to B Short
    this._addBox(-17, 0, 3, -15.4, 4.2, 12, 'barrier', true, true);
    // Barrier 3: CT-Spawn to B Metal Doors (covers both CT wing and metal door opening)
    this._addBox(-17.8, 0, -45, -16.2, 4.2, -21, 'barrier', true, true);
  }

  _createMeshes() {
    const groups = new Map();
    for (const b of this.baseBoxes) {
      if (!groups.has(b.matKey)) groups.set(b.matKey, []);
      const cfg = MAT_CONFIG[b.matKey] || MAT_CONFIG.sandstone;
      groups.get(b.matKey).push(
        createScaledBoxGeometry(b.w, b.h, b.d, b.cx, b.cy, b.cz, cfg.tile, Boolean(cfg.stretchFull || cfg.stretchesUV))
      );
    }

    for (const [matKey, geoms] of groups.entries()) {
      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();
      this._geometries.push(merged);

      const mats = this._buildMaterialTiers(matKey);
      const mesh = new THREE.Mesh(merged, mats.medium);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
      this.allMeshes.push(mesh);
      this.raycastTargets.push(mesh);
      this._materialsByMesh.set(mesh, mats);
    }

    if (this.wingmanBarriers.length > 0) {
      const bGeoms = this.wingmanBarriers.map((b) =>
        createScaledBoxGeometry(b.w, b.h, b.d, b.cx, b.cy, b.cz, MAT_CONFIG.barrier.tile, false)
      );
      const mergedBarrier = mergeGeometries(bGeoms, false);
      for (const g of bGeoms) g.dispose();
      this._geometries.push(mergedBarrier);

      const mats = this._buildMaterialTiers('barrier');
      this.barrierMesh = new THREE.Mesh(mergedBarrier, mats.medium);
      this.barrierMesh.visible = false;
      this.barrierMesh.matrixAutoUpdate = false;
      this.barrierMesh.updateMatrix();
      this.root.add(this.barrierMesh);
      this.allMeshes.push(this.barrierMesh);
      this.wingmanRaycastTargets.push(this.barrierMesh);
      this._materialsByMesh.set(this.barrierMesh, mats);
    }
  }

  _buildMaterialTiers(matKey) {
    const cfg = MAT_CONFIG[matKey] || MAT_CONFIG.sandstone;
    const flatHex = FLAT_COLORS[matKey] || 0xd2b88d;
    const texSet = this.textureMgr.getMaterialSet(cfg.tex, 1, 1);

    const low = new THREE.MeshBasicMaterial({ color: flatHex });
    const medium = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      map: texSet.map
    });
    const high = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texSet.map,
      bumpMap: texSet.bumpMap || null,
      bumpScale: texSet.bumpMap ? 0.032 : 0,
      roughnessMap: texSet.roughnessMap || null,
      roughness: cfg.roughness ?? 0.88,
      metalness: cfg.metalness ?? 0.04
    });

    this._disposableMaterials.push(low, medium, high);
    return { low, medium, high };
  }

  setMode(mode) {
    const isWingman = mode === 'wingman';
    if (this.barrierMesh) {
      this.barrierMesh.visible = isWingman;
    }
  }

  applyQuality(quality, renderer) {
    const q = quality === 'low' ? 'low' : (quality === 'high' ? 'high' : 'medium');

    for (const mesh of this.allMeshes) {
      const tiers = this._materialsByMesh.get(mesh);
      if (tiers) {
        mesh.material = tiers[q];
      }
      const isGround = mesh === this.allMeshes[0];
      mesh.castShadow = q !== 'low' && !isGround;
      mesh.receiveShadow = q !== 'low';
    }

    if (q === 'low') {
      this.skyDome.visible = false;
      this.dirLight.visible = false;
      this.dirLight.castShadow = false;
      this.hemiLight.intensity = 1.0;
      this.scene.background = new THREE.Color(0xcab693);
      this.scene.fog = null;
      if (renderer) renderer.shadowMap.enabled = false;
    } else if (q === 'medium') {
      this.skyDome.visible = true;
      this.dirLight.visible = true;
      this.dirLight.castShadow = true;
      this.hemiLight.intensity = 1.05;
      this.scene.background = null;
      this.scene.fog = new THREE.FogExp2(0xe4d1b1, 0.0024);
      if (renderer) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.BasicShadowMap;
      }
      if (this.dirLight.shadow.mapSize.width !== 512) {
        this.dirLight.shadow.mapSize.set(512, 512);
        if (this.dirLight.shadow.map) {
          this.dirLight.shadow.map.dispose();
          this.dirLight.shadow.map = null;
        }
      }
    } else {
      this.skyDome.visible = true;
      this.dirLight.visible = true;
      this.dirLight.castShadow = true;
      this.hemiLight.intensity = 1.05;
      this.scene.background = null;
      this.scene.fog = new THREE.FogExp2(0xe8d6b8, 0.0018);
      if (renderer) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
      if (this.dirLight.shadow.mapSize.width !== 2048) {
        this.dirLight.shadow.mapSize.set(2048, 2048);
        if (this.dirLight.shadow.map) {
          this.dirLight.shadow.map.dispose();
          this.dirLight.shadow.map = null;
        }
      }
    }
  }

  getRaycastMeshes(mode) {
    return mode === 'wingman'
      ? [...this.raycastTargets, ...this.wingmanRaycastTargets]
      : this.raycastTargets;
  }

  getColliders(mode) {
    if (mode === 'wingman') {
      return [...this.baseBoxes.filter((b) => b.isCollider), ...this.wingmanBarriers];
    }
    return this.baseBoxes.filter((b) => b.isCollider);
  }

  getSpawns(mode, team) {
    if (mode === 'wingman') {
      if (team === 't') {
        return [
          { x: 0, y: 0, z: 36.5, yaw: 0 },
          { x: 5.5, y: 0, z: 37.5, yaw: -0.15 }
        ];
      }
      return [
        { x: 18, y: 0, z: -34, yaw: Math.PI },
        { x: 23, y: 0, z: -33, yaw: Math.PI + 0.15 }
      ];
    }
    if (team === 't') {
      return [
        { x: -6, y: 0, z: 40, yaw: 0 },
        { x: -3, y: 0, z: 41.5, yaw: 0 },
        { x: 0, y: 0, z: 39.5, yaw: 0 },
        { x: 3, y: 0, z: 41.5, yaw: 0 },
        { x: 6, y: 0, z: 40, yaw: 0 }
      ];
    }
    return [
      { x: -6, y: 0, z: -40, yaw: Math.PI },
      { x: -3, y: 0, z: -41.5, yaw: Math.PI },
      { x: 0, y: 0, z: -39.5, yaw: Math.PI },
      { x: 3, y: 0, z: -41.5, yaw: Math.PI },
      { x: 6, y: 0, z: -40, yaw: Math.PI }
    ];
  }

  getPlantZones(mode) {
    const zoneA = {
      site: 'A',
      minX: 20.5, maxX: 35.5,
      minY: -0.2, maxY: 2.5,
      minZ: -19.5, maxZ: -5.0,
      defaultPlantPos: { x: 26.0, y: 0.03, z: -12.0 }
    };
    const zoneB = {
      site: 'B',
      minX: -33.0, maxX: -19.5,
      minY: -0.2, maxY: 2.5,
      minZ: -20.0, maxZ: -5.0,
      defaultPlantPos: { x: -26.5, y: 0.03, z: -11.0 }
    };
    return mode === 'wingman' ? [zoneA] : [zoneA, zoneB];
  }

  _initWaypoints() {
    // Connected tactical waypoint graph across Sandstorm (every edge verified obstacle-free)
    this._waypoints = [
      { id: 't_spawn', x: 0, y: 0, z: 39, wingman: true, tags: ['t_spawn'], links: ['t_mid_entry', 't_a_long', 't_b_entry'] },
      { id: 't_mid_entry', x: 0, y: 0, z: 27, wingman: true, tags: ['mid'], links: ['t_spawn', 'mid_south'] },
      { id: 'mid_south', x: 0, y: 0, z: 16, wingman: true, tags: ['mid', 'cover'], links: ['t_mid_entry', 'mid_center'] },
      { id: 'mid_center', x: 0, y: 0, z: 5, wingman: true, tags: ['mid'], links: ['mid_south', 'a_conn', 'b_short', 'mid_north'] },
      { id: 'mid_north', x: -1, y: 0, z: -11, wingman: true, tags: ['mid', 'cover'], links: ['mid_center', 'mid_top_arch'] },
      { id: 'mid_top_arch', x: -4.5, y: 0, z: -20.5, wingman: true, tags: ['mid'], links: ['mid_north', 'ct_mid_arch'] },
      { id: 'ct_mid_arch', x: -12.5, y: 0, z: -26, wingman: true, tags: ['mid'], links: ['mid_top_arch', 'ct_nw_lane', 'b_doors_west'] },
      { id: 'ct_nw_lane', x: -12.5, y: 0, z: -36, wingman: true, tags: ['ct_spawn'], links: ['ct_mid_arch', 'ct_spawn'] },

      { id: 'a_conn', x: 13, y: 0, z: 7, wingman: true, tags: ['conn'], links: ['mid_center', 'a_ramp'] },
      { id: 't_a_long', x: 32, y: 0, z: 36, wingman: true, tags: ['a_long'], links: ['t_spawn', 'a_long_mid'] },
      { id: 'a_long_mid', x: 33, y: 0, z: 17, wingman: true, tags: ['a_long', 'cover'], links: ['t_a_long', 'a_ramp'] },
      { id: 'a_ramp', x: 31.5, y: 0, z: 3.5, wingman: true, tags: ['a_approach'], links: ['a_long_mid', 'a_conn', 'a_site_entry', 'a_plat_ramp_s'] },
      { id: 'a_site_entry', x: 25.5, y: 0, z: -4, wingman: true, tags: ['site_a'], links: ['a_ramp', 'a_site_center'] },
      { id: 'a_site_center', x: 25.5, y: 0, z: -13, wingman: true, tags: ['site_a', 'cover'], links: ['a_site_entry', 'a_ct_arch'] },
      { id: 'a_plat_ramp_s', x: 36, y: 0, z: -3.5, wingman: true, tags: ['site_a'], links: ['a_ramp', 'a_plat_edge'] },
      { id: 'a_plat_ramp_w', x: 21.5, y: 0, z: -17.5, wingman: true, tags: ['site_a'], links: ['a_ct_arch', 'a_site_center', 'a_plat_edge'] },
      { id: 'a_plat_edge', x: 36, y: 1.2, z: -12, wingman: true, tags: ['site_a', 'cover'], links: ['a_plat_ramp_s', 'a_plat_ramp_w'] },
      { id: 'a_ct_arch', x: 21, y: 0, z: -26, wingman: true, tags: ['ct_a'], links: ['a_site_center', 'a_plat_ramp_w', 'ct_spawn'] },

      { id: 'ct_spawn', x: 0, y: 0, z: -39, wingman: true, tags: ['ct_spawn'], links: ['a_ct_arch', 'ct_nw_lane', 'ct_mid_win'] },
      { id: 'ct_mid_win', x: 0, y: 2.0, z: -26, wingman: true, tags: ['mid_win', 'cover'], links: ['ct_spawn'] },

      { id: 't_b_entry', x: -31, y: 0, z: 36, wingman: false, tags: ['b_alley'], links: ['t_spawn', 'b_alley_mid'] },
      { id: 'b_alley_mid', x: -31, y: 0, z: 16, wingman: false, tags: ['b_alley', 'cover'], links: ['t_b_entry', 'b_alley_north'] },
      { id: 'b_alley_north', x: -27, y: 0, z: 8, wingman: false, tags: ['b_alley'], links: ['b_alley_mid', 'b_short', 'b_tunnel', 'b_apps_stairs'] },
      { id: 'b_short', x: -13, y: 0, z: 7, wingman: false, tags: ['b_short'], links: ['mid_center', 'b_alley_north'] },
      { id: 'b_tunnel', x: -26.5, y: 0, z: 2, wingman: false, tags: ['b_approach'], links: ['b_alley_north', 'b_site_center'] },
      { id: 'b_apps_stairs', x: -37.5, y: 0, z: 11, wingman: false, tags: ['b_apps'], links: ['b_alley_north', 'b_apps_top'] },
      { id: 'b_apps_top', x: -37.5, y: 2.1, z: -8, wingman: false, tags: ['b_apps', 'cover'], links: ['b_apps_stairs', 'b_site_center'] },
      { id: 'b_site_center', x: -26.5, y: 0, z: -9, wingman: false, tags: ['site_b', 'cover'], links: ['b_tunnel', 'b_apps_top', 'b_site_east'] },
      { id: 'b_site_east', x: -20, y: 0, z: -14, wingman: false, tags: ['site_b', 'cover'], links: ['b_site_center', 'b_doors_west'] },
      { id: 'b_doors_west', x: -20, y: 0, z: -26, wingman: false, tags: ['ct_b'], links: ['b_site_east', 'ct_mid_arch'] }
    ];
    this._wpById = new Map(this._waypoints.map((w) => [w.id, w]));
  }

  getWaypoints(mode) {
    if (mode === 'wingman') {
      return this._waypoints.filter((w) => w.wingman);
    }
    return this._waypoints;
  }

  getWaypointById(id) {
    return this._wpById.get(id) || null;
  }

  dispose() {
    this.scene.remove(this.root);
    this.scene.remove(this.skyDome);
    this.scene.remove(this.hemiLight);
    this.scene.remove(this.dirLight);

    this.skyDome.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    for (const g of this._geometries) g.dispose();
    for (const m of this._disposableMaterials) m.dispose();
    this._geometries.length = 0;
    this._disposableMaterials.length = 0;
    this._materialsByMesh.clear();
  }
}
