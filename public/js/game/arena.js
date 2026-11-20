import * as THREE from 'three';
import {
  ARENA_HALF_GRID,
  ARENA_HALF_SIZE,
  BOT_DIFFICULTIES,
  BUILD_MATERIALS,
  BUILD_TYPES,
  CELL_SIZE,
  CROUCH_SPEED,
  FALL_DEATH_Y,
  JUMP_SPEED,
  PLAYER_EYE_CROUCH,
  PLAYER_EYE_STAND,
  QUALITY_PRESETS,
  RESET_BUTTON_POSITIONS,
  SPRINT_SPEED,
  WALK_SPEED,
  WEAPONS
} from './constants.js';
import { BuildingSystem, getDefaultMask } from './buildings.js';
import { ArenaMapManager } from './maps.js';
import { BattleRoyaleController } from './brMode.js';
import { EffectPools } from './pools.js';
import { isInsideSpawnBox, raycastArena, stepPlayerPhysics } from './physics.js';
import { createCharacterRig } from './playerMesh.js';
import { STRUCT_VERTEX_MAT, getStructureGeo, onStructuresLoaded } from './structureAssets.js';
import { WeaponController } from './weapons.js';
import { SmartBot } from './bot.js';
import { storage } from '../storage.js';
import { audio } from '../audio.js';
import { network } from '../network.js';

function lerpAngle(current, target, k) {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * k;
}

function createArenaGridTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Crisp sunlit architectural ceramic-stone tactical tile
  const grad = ctx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#d2e0ed');
  grad.addColorStop(1, '#c0d2e4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  // Subtle tile specular highlights & inner bevels
  ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
  ctx.fillRect(4, 4, 120, 120);
  ctx.fillRect(132, 132, 120, 120);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.fillRect(132, 4, 120, 120);
  ctx.fillRect(4, 132, 120, 120);

  // Sub-grid crisp seams
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(64, 0, 128, 256);
  ctx.strokeRect(0, 64, 256, 128);

  // Sky-teal inner court hairline accent
  ctx.strokeStyle = 'rgba(14, 165, 233, 0.26)';
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, 232, 232);

  // Outer cell seam
  ctx.strokeStyle = '#92b0cc';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 252);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(ARENA_HALF_GRID * 2, ARENA_HALF_GRID * 2);
  return tex;
}

function createSkyDomeMesh() {
  // Vibrant tropical sunlit sky dome + golden sun disc + fluffy low-poly clouds
  const group = new THREE.Group();

  const geo = new THREE.SphereGeometry(1, 16, 10);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cTop = new THREE.Color(0x1976d2);
  const cMid = new THREE.Color(0x4db6ff);
  const cHorizon = new THREE.Color(0xc4eeff);
  const cBottom = new THREE.Color(0x38a8d8);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y >= 0.35) {
      tmp.copy(cMid).lerp(cTop, (y - 0.35) / 0.65);
    } else if (y >= 0) {
      tmp.copy(cHorizon).lerp(cMid, y / 0.35);
    } else {
      tmp.copy(cHorizon).lerp(cBottom, Math.min(1, -y * 3.5));
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const dome = new THREE.Mesh(geo, domeMat);
  dome.renderOrder = -2;
  group.add(dome);

  // Stylized Golden Sun aligned with dirLight direction (28, 52, 24)
  const sunDir = new THREE.Vector3(28, 52, 24).normalize().multiplyScalar(0.92);
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.048, 18),
    new THREE.MeshBasicMaterial({ color: 0xfff7cc, fog: false, depthWrite: false })
  );
  sunDisc.position.copy(sunDir);
  sunDisc.lookAt(0, 0, 0);
  sunDisc.renderOrder = -1;
  group.add(sunDisc);

  const sunHalo = new THREE.Mesh(
    new THREE.RingGeometry(0.048, 0.095, 18),
    new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.28, side: THREE.DoubleSide, fog: false, depthWrite: false })
  );
  sunHalo.position.copy(sunDir).multiplyScalar(0.995);
  sunHalo.lookAt(0, 0, 0);
  sunHalo.renderOrder = -1;
  group.add(sunHalo);

  // 12 Lightweight White Cloud Clusters ring visible cleanly above horizon
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthWrite: false });
  const puffGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + (i % 2) * 0.16;
    const elev = 0.14 + (i % 3) * 0.065;
    const rad = 0.88;
    const cg = new THREE.Group();
    cg.position.set(Math.cos(ang) * rad, elev, Math.sin(ang) * rad);
    cg.lookAt(0, elev * 0.6, 0);

    const p1 = new THREE.Mesh(puffGeo, cloudMat);
    p1.scale.set(0.22, 0.052, 0.08);
    cg.add(p1);

    const p2 = new THREE.Mesh(puffGeo, cloudMat);
    p2.position.set(-0.045, 0.024, 0);
    p2.scale.set(0.11, 0.046, 0.065);
    cg.add(p2);

    const p3 = new THREE.Mesh(puffGeo, cloudMat);
    p3.position.set(0.055, 0.018, 0);
    p3.scale.set(0.1, 0.04, 0.06);
    cg.add(p3);

    cg.renderOrder = -1;
    group.add(cg);
  }

  return group;
}

function createResetSignTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#090b10';
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 60);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('RESET ARENA', 64, 28);
  ctx.fillStyle = '#f87171';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText('PRESS [E]', 64, 48);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

const _camRayHit = {
  hit: false, hitType: null, dist: 10,
  x: 0, y: 0, z: 0, buildKey: null, playerId: null, isHeadshot: false
};
const _editRayHit = {
  hit: false, hitType: null, dist: 10,
  x: 0, y: 0, z: 0, buildKey: null, playerId: null, isHeadshot: false
};

export class ArenaGame {
  constructor(canvas, uiCallbacks) {
    this.canvas = canvas;
    this.ui = uiCallbacks || {};
    this.running = false;
    this.rafId = 0;
    this.mode = 'solo'; // 'solo' | 'bot' | 'online'
    this.mapId = 'skybox'; // 'skybox' | 'vramp'
    this.botDifficulty = 'medium';
    this.localSlot = 0;
    this.paused = false;
    this.countdownTimer = 0;
    this.lastCountdownCeil = 0;
    this.startBannerTimer = 0;
    this.roundRestartTimer = 0;

    // Scene & Camera (vibrant sunlit daylight atmosphere)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9be0ff);
    this.scene.fog = new THREE.Fog(0xb5e8ff, 75, 165);

    this.camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.15, 220);

    const q = QUALITY_PRESETS[storage.get().quality] || QUALITY_PRESETS.medium;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: q.antialias,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    // Minimal 2-light setup (vibrant sunlight + grass/arena bounce)
    this.hemiLight = new THREE.HemisphereLight(0xdff5ff, 0x90a8c4, 1.55);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff2d6, 1.85);
    this.dirLight.position.set(28, 52, 24);
    this.dirLight.shadow.camera.left = -42;
    this.dirLight.shadow.camera.right = 42;
    this.dirLight.shadow.camera.top = 42;
    this.dirLight.shadow.camera.bottom = -42;
    this.dirLight.shadow.camera.near = 5;
    this.dirLight.shadow.camera.far = 130;
    this.scene.add(this.dirLight);

    // Core systems
    this.pools = new EffectPools(this.scene);
    this.buildings = new BuildingSystem(this.scene, this.pools);
    this.mapManager = new ArenaMapManager(this.scene);
    this.br = new BattleRoyaleController(this.scene);
    this.weapons = new WeaponController();

    // Clean Sky Dome & Static Open-Edge Arena Platform (no floating islands or perimeter walls)
    this.skyDome = createSkyDomeMesh();
    this.skyDome.matrixAutoUpdate = false;
    this.skyDome.updateMatrix();
    this.scene.add(this.skyDome);
    this.arena1v1Group = new THREE.Group();
    this.scene.add(this.arena1v1Group);
    this.resetButtonsGroup = new THREE.Group();
    this.resetBtnMeshes = [];
    this.scene.add(this.resetButtonsGroup);
    this._buildStaticArena();

    // Local player state
    const s = storage.get();
    this.matchBuildMat = s.buildMat;
    this.localPlayer = {
      id: 'local',
      name: s.playerName,
      skinId: s.skinId,
      buildMat: s.buildMat,
      pos: new THREE.Vector3(0, 0, 12),
      vel: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      pitch: 0,
      grounded: true,
      coyoteTimer: 0,
      jumpBufferTimer: 0,
      gliding: false,
      diving: false,
      crouch: false,
      jumpSpeed: JUMP_SPEED,
      skyBoostTimer: 0,
      canAirBoost: false,
      hp: 100,
      shield: 100,
      alive: true,
      kills: 0,
      respawnTimer: 0
    };
    this.localRig = createCharacterRig(s.skinId, true);
    this.scene.add(this.localRig.root);

    // Build / Edit mode state
    this.activeBuildType = null; // null | 'wall' | 'floor' | 'ramp'
    this.lastBuildType = BUILD_TYPES.WALL;
    this.buildCooldown = 0;
    this.editState = {
      active: false,
      buildKey: null,
      draftMask: 0,
      hoverTile: -1
    };

    // Solo training dummy
    this.dummyTarget = {
      id: 'dummy',
      name: 'Target Dummy',
      pos: new THREE.Vector3(0, 0, -8),
      crouch: false,
      hp: 100,
      shield: 100,
      alive: true,
      kills: 0,
      respawnTimer: 0,
      rig: createCharacterRig('orange', true, true)
    };
    this.dummyTarget.rig.root.position.copy(this.dummyTarget.pos);
    this.dummyTarget.rig.root.rotation.y = Math.PI;
    this.dummyTarget.rig.root.visible = false;
    this.scene.add(this.dummyTarget.rig.root);

    // Bot opponent
    this.bot = new SmartBot(this.scene, 'medium', 'crimson', 'brick');
    this.bot.rig.root.visible = false;

    // Online opponent state
    this.onlineOpponent = {
      id: null,
      name: 'Opponent',
      skinId: 'crimson',
      buildMat: 'brick',
      pos: new THREE.Vector3(0, 0, -12),
      targetPos: new THREE.Vector3(0, 0, -12),
      yaw: Math.PI,
      targetYaw: Math.PI,
      pitch: 0,
      targetPitch: 0,
      crouch: false,
      slot: 0,
      buildMode: null,
      swingPhase: 0,
      hp: 100,
      shield: 100,
      alive: true,
      kills: 0,
      speed: 0,
      rig: createCharacterRig('crimson', true, true)
    };
    this.onlineOpponent.rig.root.visible = false;
    this.scene.add(this.onlineOpponent.rig.root);

    // Smooth Fortnite-style third-person & ADS camera state
    this.camState = {
      dist: 3.12,
      actualDist: 3.12,
      right: 0.88,
      up: 0.25,
      fov: 76,
      eyeH: PLAYER_EYE_STAND,
      targetYaw: 0,
      targetPitch: 0,
      renderYaw: 0,
      renderPitch: 0,
      smoothPosY: 0,
      strafeOffset: 0,
      landDip: 0
    };
    this.moveVel = { x: 0, z: 0 };

    // Input state
    this.keys = new Set();
    this.mouseDownLeft = false;
    this.mouseDownRight = false;
    this.pointerLocked = false;
    this.fallbackAim = false;
    this.lastPointerX = null;
    this.lastPointerY = null;

    // Timers & metrics
    this.time = 0;
    this.lastTs = 0;
    this.netSyncAccum = 0;
    this.hudAccum = 0;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.currentFps = 60;
    this.resetCooldown = 0;

    // Reusable vectors
    this._camOrigin = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._eyeOrigin = new THREE.Vector3();
    this._muzzleOrigin = new THREE.Vector3();
    this._tmpVec = new THREE.Vector3();

    this.applyQuality(storage.get().quality);
    this._bindEvents();
    this._bindNetworkEvents();

    this.unsubStorage = storage.subscribe((state) => {
      this.applyQuality(state.quality);
      this.localPlayer.skinId = state.skinId;
      this.localPlayer.name = state.playerName;
      this.localRig.setSkin(state.skinId);

      // Host (or Solo/Bot player) determines shared building material
      if (this.mode !== 'online' || this.localSlot === 0) {
        this.matchBuildMat = state.buildMat;
        this.localPlayer.buildMat = state.buildMat;
        this.bot.setBuildMat(state.buildMat);
      }

      if (this.mode === 'online') {
        network.sendCosmetics({
          name: state.playerName,
          skinId: state.skinId,
          buildMat: this.localSlot === 0 ? state.buildMat : this.matchBuildMat
        });
      }
    });
  }

  _buildStaticArena() {
    // 1. Open-Edge Arena Platform (80x80m, NO perimeter walls so players can fall off into void)
    const floorTex = createArenaGridTexture();
    const floorGeo = new THREE.PlaneGeometry(ARENA_HALF_SIZE * 2, ARENA_HALF_SIZE * 2);
    const floorMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: floorTex });
    this.arenaFloor = new THREE.Mesh(floorGeo, floorMat);
    this.arenaFloor.rotation.x = -Math.PI / 2;
    this.arenaFloor.receiveShadow = true;
    this.arenaFloor.matrixAutoUpdate = false;
    this.arenaFloor.updateMatrix();
    this.arena1v1Group.add(this.arenaFloor);

    // Solid steel-slate under-slab & coral flush edge trim marking drop-off boundary
    const underSlab = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_HALF_SIZE * 2, 0.7, ARENA_HALF_SIZE * 2),
      new THREE.MeshBasicMaterial({ color: 0x5a7391 })
    );
    underSlab.position.set(0, -0.36, 0);
    underSlab.matrixAutoUpdate = false;
    underSlab.updateMatrix();
    this.arena1v1Group.add(underSlab);

    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const edgeLen = ARENA_HALF_SIZE * 2 + 0.24;
    const nsEdgeGeo = new THREE.BoxGeometry(edgeLen, 0.08, 0.24);
    const ewEdgeGeo = new THREE.BoxGeometry(0.24, 0.08, edgeLen);
    for (const zSign of [-1, 1]) {
      const m = new THREE.Mesh(nsEdgeGeo, edgeMat);
      m.position.set(0, -0.02, zSign * ARENA_HALF_SIZE);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.arena1v1Group.add(m);
    }
    for (const xSign of [-1, 1]) {
      const m = new THREE.Mesh(ewEdgeGeo, edgeMat);
      m.position.set(xSign * ARENA_HALF_SIZE, -0.02, 0);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.arena1v1Group.add(m);
    }

    // 2. Central Arena Divider Line
    const centerLine = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF_SIZE * 2, 0.32),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.5 })
    );
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = 0.015;
    centerLine.matrixAutoUpdate = false;
    centerLine.updateMatrix();
    this.arena1v1Group.add(centerLine);

    // 3. Physical Reset Arény Buttons (West & East inner zone — ONLY way to manually reset map)
    const pedGeo = new THREE.BoxGeometry(1.3, 1.35, 1.3);
    const pedMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
    const btnGeo = new THREE.CylinderGeometry(0.46, 0.54, 0.36, 10);
    const btnMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
    const signGeo = new THREE.PlaneGeometry(1.75, 0.88);
    const signMat = new THREE.MeshBasicMaterial({ map: createResetSignTexture(), side: THREE.DoubleSide });
    const beaconGeo = new THREE.RingGeometry(0.9, 1.15, 14);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e, side: THREE.DoubleSide });

    const pedMeshes = [];
    for (const rb of RESET_BUTTON_POSITIONS) {
      const grp = new THREE.Group();
      grp.position.set(rb.x, 0, rb.z);
      grp.matrixAutoUpdate = false;
      grp.updateMatrix();

      const ped = new THREE.Mesh(pedGeo, pedMat);
      ped.position.y = 0.675;
      ped.matrixAutoUpdate = false;
      ped.updateMatrix();
      grp.add(ped);
      pedMeshes.push(ped);

      const btn = new THREE.Mesh(btnGeo, btnMat);
      btn.position.y = 1.52;
      grp.add(btn);
      this.resetBtnMeshes.push(btn);

      const sign = new THREE.Mesh(signGeo, signMat);
      sign.position.set(0, 2.35, 0);
      sign.rotation.y = rb.x < 0 ? Math.PI / 2 : -Math.PI / 2;
      sign.matrixAutoUpdate = false;
      sign.updateMatrix();
      grp.add(sign);

      const ring = new THREE.Mesh(beaconGeo, beaconMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      ring.matrixAutoUpdate = false;
      ring.updateMatrix();
      grp.add(ring);

      this.resetButtonsGroup.add(grp);
    }

    this._unsubResetStructures = onStructuresLoaded(() => {
      const pedGeoLoaded = getStructureGeo('Reset_Pedestal');
      if (pedGeoLoaded && pedGeoLoaded.attributes?.color) {
        for (const ped of pedMeshes) {
          ped.geometry = pedGeoLoaded;
          ped.material = STRUCT_VERTEX_MAT;
          ped.updateMatrix();
        }
      }
      const btnGeoLoaded = getStructureGeo('Reset_Button');
      if (btnGeoLoaded && btnGeoLoaded.attributes?.color) {
        for (const btn of this.resetBtnMeshes) {
          btn.geometry = btnGeoLoaded;
          btn.material = STRUCT_VERTEX_MAT;
        }
      }
    });
  }

  applyQuality(qualityKey) {
    const q = QUALITY_PRESETS[qualityKey] || QUALITY_PRESETS.medium;
    this.renderer.setPixelRatio(Math.min(q.pixelRatioCap, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = q.shadows;

    this.dirLight.castShadow = q.shadows;
    if (q.shadows) {
      if (this.dirLight.shadow.mapSize.width !== q.shadowMapSize) {
        this.dirLight.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        if (this.dirLight.shadow.map) {
          this.dirLight.shadow.map.dispose();
          this.dirLight.shadow.map = null;
        }
      }
    }

    this.camera.far = q.far;
    this.camera.updateProjectionMatrix();
    this.scene.fog.near = q.fogNear;
    this.scene.fog.far = q.fogFar;
    this.skyDome.scale.setScalar(q.far * 0.85);
    this.skyDome.updateMatrix();

    this.pools.setParticleScale(q.particleScale);
    this.buildings.setShadowsEnabled(q.shadows);
    this.mapManager.setShadowsEnabled(q.shadows);
    this.arenaFloor.receiveShadow = q.shadows;
    this.bot.setShadowsEnabled(q.shadows);
    this.br.setShadowsEnabled(q.shadows);

    const setRigShadow = (rig) => {
      rig.root.traverse((o) => { if (o.isMesh) o.castShadow = q.shadows; });
    };
    setRigShadow(this.localRig);
    setRigShadow(this.onlineOpponent.rig);
    setRigShadow(this.dummyTarget.rig);
  }

  _bindEvents() {
    this.onResize = () => {
      if (!this.running) return;
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    };
    window.addEventListener('resize', this.onResize);

    this.onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (this.pointerLocked) {
        this.fallbackAim = false;
      }
      if (!this.pointerLocked && !this.fallbackAim && this.running && !this.paused && !(this.mode === 'br' && this.br.finished)) {
        this.setPaused(true);
      }
      if (this.pointerLocked && this.paused) {
        this.setPaused(false);
      }
      this._pushHudState();
    };
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    this.onPointerLockError = () => {
      if (this.running) {
        this.fallbackAim = true;
        this._pushHudState();
      }
    };
    document.addEventListener('pointerlockerror', this.onPointerLockError);

    this.onMouseMove = (e) => {
      if (!this.running || this.paused) return;
      if (!this.pointerLocked && !this.fallbackAim) return;
      let dx = e.movementX || 0;
      let dy = e.movementY || 0;
      if (!this.pointerLocked && this.fallbackAim && dx === 0 && dy === 0) {
        if (this.lastPointerX !== null) {
          dx = e.clientX - this.lastPointerX;
          dy = e.clientY - this.lastPointerY;
        }
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
      }
      // Reject abnormal Pointer Lock spike jumps so camera turns stay silky smooth
      dx = Math.max(-140, Math.min(140, dx));
      dy = Math.max(-140, Math.min(140, dy));

      const isADS = this._isADS();
      const adsMult = isADS ? (this.weapons.slot === 1 ? 0.6 : 0.74) : 1.0;
      const sens = 0.0021 * (storage.get().sensitivity || 1.0) * adsMult;
      this.camState.targetYaw -= dx * sens;
      this.camState.targetPitch = Math.max(-1.38, Math.min(1.38, this.camState.targetPitch - dy * sens));
      this.localPlayer.yaw = this.camState.targetYaw;
      this.localPlayer.pitch = this.camState.targetPitch;
    };
    document.addEventListener('mousemove', this.onMouseMove);

    this.onMouseDown = (e) => {
      if (!this.running) return;
      if (this.mode === 'br' && this.br.finished) return;
      if (!this.pointerLocked && !this.fallbackAim) {
        if (!this.paused && e.target === this.canvas) {
          this.requestLock();
          // Also allow seamless fallback aim if browser blocks pointer lock after click
          if (e.button === 2) {
            this.mouseDownRight = true;
            this._pushHudState();
          }
        }
        return;
      }
      if (this.paused || e.target !== this.canvas) return;
      if (e.button === 0) {
        this.mouseDownLeft = true;
        this._handlePrimaryAction(true);
      } else if (e.button === 2) {
        this.mouseDownRight = true;
        if (this.editState.active) {
          this._resetCurrentEdit();
        } else if (this.activeBuildType) {
          if (this.mode === 'online' && this.localSlot !== 0) {
            if (this.ui.onBanner) this.ui.onBanner('Material is set by the room host.', 'info');
          } else {
            const order = ['wood', 'brick', 'metal'];
            const next = order[(order.indexOf(this.matchBuildMat) + 1) % order.length];
            this.matchBuildMat = next;
            this.localPlayer.buildMat = next;
            this.bot.setBuildMat(next);
            storage.update({ buildMat: next });
            audio.playUiClick();
            this._pushHudState();
          }
        } else {
          this._pushHudState();
        }
      }
    };
    window.addEventListener('mousedown', this.onMouseDown);

    this.onMouseUp = (e) => {
      if (e.button === 0) this.mouseDownLeft = false;
      if (e.button === 2) {
        this.mouseDownRight = false;
        if (this.running) this._pushHudState();
      }
    };
    window.addEventListener('mouseup', this.onMouseUp);

    this.onContextMenu = (e) => {
      if (this.running) e.preventDefault();
    };
    this.canvas.addEventListener('contextmenu', this.onContextMenu);

    this.onKeyDown = (e) => {
      if (!this.running) return;
      const code = e.code;
      this.keys.add(code);

      if (code === 'Escape') {
        if (this.editState.active) {
          this.editState.active = false;
          this.editState.buildKey = null;
          this.buildings.hideEditOverlay();
          this._pushHudState();
          return;
        }
        if (!this.pointerLocked) {
          this.setPaused(!this.paused);
          this._pushHudState();
        }
        return;
      }

      if (this.paused) return;

      if (code === 'Digit1') this._selectWeapon(0);
      else if (code === 'Digit2') this._selectWeapon(1);
      else if (code === 'Digit3') this._selectWeapon(2);
      else if (code === 'Digit7' && this.mode === 'bot') this.setBotDifficulty('easy');
      else if (code === 'Digit8' && this.mode === 'bot') this.setBotDifficulty('medium');
      else if (code === 'Digit9' && this.mode === 'bot') this.setBotDifficulty('hard');
      else if (code === 'Digit0' && this.mode === 'bot') this.setBotDifficulty('extreme');
      else if (code === 'KeyQ') this._toggleBuildType(BUILD_TYPES.WALL);
      else if (code === 'KeyC') this._toggleBuildType(BUILD_TYPES.FLOOR);
      else if (code === 'KeyV') this._toggleBuildType(BUILD_TYPES.RAMP);
      else if (code === 'KeyF') this._toggleBuildMode();
      else if (code === 'KeyG') this._handleEditKey();
      else if (code === 'KeyR') {
        if (!this.activeBuildType && !this.editState.active) {
          this.weapons.startReload();
        }
      } else if (code === 'KeyE') {
        this._checkNearbyResetButton();
      } else if (code === 'Space') {
        this.localPlayer.jumpBufferTimer = 0.13;
        // Mid-air Glider / Boost Dive when falling from Sky Drop Box
        if (
          this.mapId === 'skybox' &&
          !this.localPlayer.grounded &&
          this.localPlayer.pos.y > 4.0 &&
          this.localPlayer.canAirBoost
        ) {
          this.localPlayer.canAirBoost = false;
          const yaw = this.localPlayer.yaw;
          this.localPlayer.vel.x = -Math.sin(yaw) * 14.5;
          this.localPlayer.vel.z = -Math.cos(yaw) * 14.5;
          this.localPlayer.vel.y = Math.max(this.localPlayer.vel.y, 2.5);
          this.localPlayer.skyBoostTimer = 1.6;
          this.pools.spawnSparks(this.localPlayer.pos.x, this.localPlayer.pos.y + 0.4, this.localPlayer.pos.z, 8, 0xd9f94e);
          audio.playBoostPad();
          this._pushHudState();
        }
      }
    };
    window.addEventListener('keydown', this.onKeyDown);

    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    window.addEventListener('keyup', this.onKeyUp);

    this.onWheel = (e) => {
      if (!this.running || !this.pointerLocked || this.paused) return;
      if (this.activeBuildType) {
        const order = [BUILD_TYPES.WALL, BUILD_TYPES.FLOOR, BUILD_TYPES.RAMP];
        const idx = (order.indexOf(this.activeBuildType) + (e.deltaY > 0 ? 1 : 2)) % 3;
        this._toggleBuildType(order[idx], true);
      } else {
        const nextSlot = (this.weapons.slot + (e.deltaY > 0 ? 1 : 2)) % 3;
        this._selectWeapon(nextSlot);
      }
    };
    window.addEventListener('wheel', this.onWheel, { passive: true });
  }

  _bindNetworkEvents() {
    network.on('opponent_cosmetics', (data) => {
      if (!data) return;
      this.onlineOpponent.name = data.name || this.onlineOpponent.name;
      this.onlineOpponent.skinId = data.skinId || this.onlineOpponent.skinId;
      this.onlineOpponent.buildMat = data.buildMat || this.onlineOpponent.buildMat;
      this.onlineOpponent.rig.setSkin(this.onlineOpponent.skinId);
      this._pushHudState();
    });

    network.on('opponent_update', (state) => {
      if (this.mode !== 'online' || !state) return;
      this.onlineOpponent.targetPos.set(state.x, state.y, state.z);
      this.onlineOpponent.targetYaw = state.yaw;
      this.onlineOpponent.targetPitch = state.pitch;
      this.onlineOpponent.crouch = Boolean(state.crouch);
      this.onlineOpponent.slot = state.slot || 0;
      this.onlineOpponent.buildMode = state.buildMode || null;
      if (state.swing > this.onlineOpponent.swingPhase) {
        this.onlineOpponent.swingPhase = state.swing;
      }
      this.onlineOpponent.speed = Math.hypot(state.vx || 0, state.vz || 0);
      this.onlineOpponent.rig.setWeapon(this.onlineOpponent.slot, Boolean(this.onlineOpponent.buildMode));
    });

    network.on('build_placed', (record) => {
      if (this.mode !== 'online') return;
      this.buildings.placeBuild(record, (mat) => audio.playBuildPlace(mat));
    });

    network.on('build_edited', (data) => {
      if (this.mode !== 'online' || !data) return;
      this.buildings.editBuild(data.key, data.mask, data.rot);
      audio.playEditConfirm();
    });

    network.on('build_damaged', (data) => {
      if (this.mode !== 'online' || !data) return;
      this.buildings.setBuildHp(data.key, data.hp);
    });

    network.on('build_destroyed', (data) => {
      if (this.mode !== 'online' || !data) return;
      if (this.buildings.removeBuild(data.key, true)) {
        audio.playBuildBreak();
      }
    });

    network.on('opponent_shoot', (data) => {
      if (this.mode !== 'online' || !data) return;
      const [ox, oy, oz] = data.origin || [0, 1, 0];
      const [ex, ey, ez] = data.end || [0, 1, 0];
      const w = WEAPONS.find((item) => item.id === data.weapon) || WEAPONS[1];
      if (w.id !== 'pickaxe') {
        this.pools.spawnTracer(ox, oy, oz, ex, ey, ez, w.tracerColor);
        this.pools.spawnSparks(ex, ey, ez, 3, 0xfacc15);
      }
      const dist = this.localPlayer.pos.distanceTo(this.onlineOpponent.pos);
      const atten = Math.max(0.12, 1 - dist / 55);
      if (w.id === 'shotgun') audio.playShotgun(atten);
      else if (w.id === 'ar') audio.playAR(atten);
      else audio.playPickaxeSwing();
    });

    network.on('health_update', (data) => {
      if (this.mode !== 'online' || !data) return;
      const myId = network.getSocketId();
      if (data.targetId === myId) {
        this.localPlayer.hp = data.hp;
        this.localPlayer.shield = data.shield;
        audio.playTakeDamage();
        if (this.ui.onDamageFlash) this.ui.onDamageFlash();
      } else {
        const hadShield = this.onlineOpponent.shield > 0;
        this.onlineOpponent.hp = data.hp;
        this.onlineOpponent.shield = data.shield;
        if (data.attackerId === myId && this.ui.onHitMarker) {
          this.ui.onHitMarker(data.damage, data.isHeadshot, hadShield);
        }
      }
      this._pushHudState();
    });

    network.on('player_eliminated', (data) => {
      if (this.mode !== 'online' || !data) return;
      const myId = network.getSocketId();
      const victimIsMe = data.victimId === myId;
      if (victimIsMe) {
        this.localPlayer.alive = false;
        this.localRig.root.visible = false;
        this.editState.active = false;
        this.buildings.hideEditOverlay();
      } else {
        this.onlineOpponent.alive = false;
        this.onlineOpponent.rig.root.visible = false;
        audio.playEliminate();
      }

      if (Array.isArray(data.players)) {
        for (const p of data.players) {
          if (p.id === myId) this.localPlayer.kills = p.kills;
          else this.onlineOpponent.kills = p.kills;
        }
      }

      if (this.ui.onBanner) {
        const msg = data.reason === 'fall'
          ? (victimIsMe ? 'You fell off the map! +1 point to opponent.' : `${this.onlineOpponent.name} fell off the map! +1 point!`)
          : (victimIsMe ? 'You were eliminated!' : `Eliminated ${this.onlineOpponent.name}!`);
        this.ui.onBanner(msg, victimIsMe ? 'danger' : 'success');
      }
      this._pushHudState();
    });

    network.on('match_material_update', (data) => {
      if (this.mode !== 'online' || !data?.buildMat) return;
      this.matchBuildMat = data.buildMat;
      this.localPlayer.buildMat = data.buildMat;
      if (this.ui.onBanner) {
        const matName = (BUILD_MATERIALS[data.buildMat] || BUILD_MATERIALS.wood).name;
        this.ui.onBanner(`Shared material: ${matName}`, 'info');
      }
      this._pushHudState();
    });

    network.on('player_respawn', (data) => {
      if (this.mode !== 'online' || !data) return;
      const myId = network.getSocketId();
      const sp = this.mapManager.spawnPoints[data.slot === 0 ? 0 : 1] || this.mapManager.spawnPoints[0];
      if (data.playerId === myId) {
        this._respawnLocal(sp);
      } else {
        this.onlineOpponent.hp = 100;
        this.onlineOpponent.shield = 100;
        this.onlineOpponent.alive = true;
        this.onlineOpponent.pos.set(sp.x, sp.y, sp.z);
        this.onlineOpponent.targetPos.set(sp.x, sp.y, sp.z);
        this.onlineOpponent.yaw = sp.yaw;
        this.onlineOpponent.targetYaw = sp.yaw;
        this.onlineOpponent.rig.root.visible = true;
      }
      this._pushHudState();
    });

    network.on('arena_reset_done', (data) => {
      if (this.mode !== 'online') return;
      if (data?.matchBuildMat) {
        this.matchBuildMat = data.matchBuildMat;
        this.localPlayer.buildMat = data.matchBuildMat;
      }
      this._applyLocalArenaReset(data?.byName || 'Player');
    });

    const handleOnlineRoundRestart = (data) => {
      if (this.mode !== 'online') return;
      if (data?.matchBuildMat) {
        this.matchBuildMat = data.matchBuildMat;
        this.localPlayer.buildMat = data.matchBuildMat;
      }
      if (Array.isArray(data?.players)) {
        const myId = network.getSocketId();
        for (const p of data.players) {
          if (p.id === myId) this.localPlayer.kills = p.kills;
          else this.onlineOpponent.kills = p.kills;
        }
      }
      this._applyLocalArenaReset(null, 'Next Round – Get Ready!');
    };
    network.on('vramp_next_round', handleOnlineRoundRestart);
    network.on('round_restart', handleOnlineRoundRestart);

    network.on('player_joined', (data) => {
      if (this.mode !== 'online' || !data?.player) return;
      this._applyOnlineOpponentRecord(data.player);
      if (this.ui.onBanner) {
        this.ui.onBanner(`${this.onlineOpponent.name} joined the arena!`, 'info');
      }
      this._pushHudState();
    });

    network.on('opponent_left', (data) => {
      if (this.mode !== 'online') return;
      this.onlineOpponent.rig.root.visible = false;
      this.onlineOpponent.alive = false;
      if (this.ui.onBanner) {
        this.ui.onBanner(`${data?.name || 'Opponent'} left the room.`, 'warning');
      }
    });
  }

  _applyOnlineOpponentRecord(rec) {
    this.onlineOpponent.id = rec.id;
    this.onlineOpponent.name = rec.name || 'Opponent';
    this.onlineOpponent.skinId = rec.skinId || 'crimson';
    this.onlineOpponent.buildMat = this.matchBuildMat || rec.buildMat || 'wood';
    this.onlineOpponent.hp = typeof rec.hp === 'number' ? rec.hp : 100;
    this.onlineOpponent.shield = typeof rec.shield === 'number' ? rec.shield : 100;
    this.onlineOpponent.kills = rec.kills || 0;
    this.onlineOpponent.alive = rec.alive !== false;
    const sp = this.mapManager.spawnPoints[rec.slot === 0 ? 0 : 1] || this.mapManager.spawnPoints[1];
    this.onlineOpponent.pos.set(sp.x, sp.y, sp.z);
    this.onlineOpponent.targetPos.set(sp.x, sp.y, sp.z);
    this.onlineOpponent.yaw = sp.yaw;
    this.onlineOpponent.targetYaw = sp.yaw;
    this.onlineOpponent.rig.setSkin(this.onlineOpponent.skinId);
    this.onlineOpponent.rig.root.visible = this.onlineOpponent.alive;
  }

  startSession({
    mode,
    mapId = 'skybox',
    difficulty = 'medium',
    brPreset = 'balanced',
    slot = 0,
    players = [],
    existingBuilds = [],
    roomCode = null,
    matchBuildMat = null
  }) {
    this.mode = mode;
    this.mapId = mode === 'br' ? 'br' : (mapId === 'vramp' ? 'vramp' : 'skybox');
    this.botDifficulty = difficulty;
    this.brPreset = brPreset;
    this.localSlot = slot;
    this.roomCode = roomCode;
    this.roundRestartTimer = 0;
    this.startBannerTimer = 0;

    this.mapManager.loadMap(this.mapId);
    this.buildings.clearAll(false);
    this.pools.clearAll();
    this.weapons.resetAll();
    this.activeBuildType = null;
    this.editState.active = false;
    this.buildings.hideEditOverlay();
    this.keys.clear();
    this.mouseDownLeft = false;
    this.mouseDownRight = false;

    const isBR = this.mode === 'br';
    this.arena1v1Group.visible = !isBR;
    this.resetButtonsGroup.visible = !isBR;
    this.hemiLight.groundColor.setHex(isBR ? 0x6ea862 : 0x90a8c4);
    this.moveVel.x = 0;
    this.moveVel.z = 0;

    const s = storage.get();
    const sharedMat = (mode === 'online' && matchBuildMat) ? matchBuildMat : s.buildMat;
    this.matchBuildMat = sharedMat;
    this.localPlayer.name = s.playerName;
    this.localPlayer.skinId = s.skinId;
    this.localPlayer.buildMat = sharedMat;
    this.localPlayer.kills = 0;
    this.localRig.setSkin(s.skinId);
    this.localRig.setWeapon(0, false);

    if (isBR) {
      const q = QUALITY_PRESETS[s.quality] || QUALITY_PRESETS.medium;
      const dropSpawn = this.br.startMatch(this.mapManager, brPreset || 'balanced', q.shadows);
      this._respawnLocal(dropSpawn);
      this.localPlayer.shield = 50;
      this.localPlayer.gliding = true;
      this.localPlayer.diving = false;
      this.localPlayer.canAirBoost = false;
      if (this.ui.onBanner) {
        this.ui.onBanner('AIR DROP — Steer with WASD, hold SPACE to dive!', 'info');
      }
    } else {
      this.br.setActive(false);
      const mySpawn = this.mapManager.spawnPoints[mode === 'online' ? (slot === 0 ? 0 : 1) : 0];
      this._respawnLocal(mySpawn);
    }

    // Setup opponent / dummy visibility (on V-Ramp dummy stands at opposite end of V)
    const soloDummyPos = this.mapId === 'vramp'
      ? (this.mapManager.spawnPoints[1] || { x: 2.0, y: 3.5, z: -4.85 })
      : { x: 0, y: 0, z: -6 };
    this.dummyTarget.pos.set(soloDummyPos.x, soloDummyPos.y, soloDummyPos.z);
    this.dummyTarget.rig.root.position.copy(this.dummyTarget.pos);
    this.dummyTarget.rig.root.rotation.y = Math.PI;
    this.dummyTarget.rig.root.visible = mode === 'solo';
    this.dummyTarget.alive = mode === 'solo';
    this.dummyTarget.hp = 100;
    this.dummyTarget.shield = 100;
    this.dummyTarget.kills = 0;

    if (mode === 'bot') {
      this.bot.setDifficulty(difficulty);
      this.bot.setBuildMat(sharedMat);
      this.bot.kills = 0;
      this.bot.resetForRound(this.mapManager.spawnPoints[1]);
      this.bot.rig.root.visible = true;
    } else {
      this.bot.rig.root.visible = false;
      this.bot.alive = false;
    }

    if (mode === 'online') {
      const myId = network.getSocketId();
      const opp = players.find((p) => p.id !== myId);
      if (opp) {
        this._applyOnlineOpponentRecord(opp);
      } else {
        this.onlineOpponent.id = null;
        this.onlineOpponent.name = 'Waiting for opponent...';
        this.onlineOpponent.rig.root.visible = false;
      }
      for (const b of existingBuilds) {
        this.buildings.placeBuild(b);
      }
    } else {
      this.onlineOpponent.rig.root.visible = false;
    }

    if (this.mapId === 'vramp') {
      this._startVRampCountdown();
    } else {
      this.countdownTimer = 0;
      this.mapManager.setBarrierVisible(false);
    }

    this.running = true;
    this.paused = false;
    this.lastTs = performance.now();
    this._pushHudState();
    this.requestLock();

    if (!this.rafId) {
      this.rafId = requestAnimationFrame((ts) => this._loop(ts));
    }
  }

  stopSession() {
    this.running = false;
    this.paused = false;
    this.mouseDownLeft = false;
    this.mouseDownRight = false;
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  requestLock() {
    if (!this.running) return;
    if (document.pointerLockElement !== this.canvas && this.canvas.requestPointerLock) {
      try {
        const res = this.canvas.requestPointerLock();
        if (res && typeof res.catch === 'function') {
          res.catch(() => {
            this.fallbackAim = true;
            this._pushHudState();
          });
        }
      } catch {
        this.fallbackAim = true;
        this._pushHudState();
      }
    }
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) {
      this.keys.clear();
      this.mouseDownLeft = false;
      this.mouseDownRight = false;
    }
    if (this.ui.onPauseChange) this.ui.onPauseChange(paused);
  }

  _respawnLocal(spawn = null) {
    const sp = spawn && typeof spawn === 'object'
      ? spawn
      : (this.mapManager.spawnPoints[this.mode === 'online' ? (this.localSlot === 0 ? 0 : 1) : 0] || { x: 0, y: 0, z: 12, yaw: 0 });
    this.localPlayer.pos.set(sp.x, sp.y, sp.z);
    this.localPlayer.vel.set(0, 0, 0);
    this.moveVel.x = 0;
    this.moveVel.z = 0;
    this.localPlayer.yaw = sp.yaw;
    this.localPlayer.pitch = 0;
    this.localPlayer.coyoteTimer = 0;
    this.localPlayer.jumpBufferTimer = 0;
    this.camState.targetYaw = sp.yaw;
    this.camState.renderYaw = sp.yaw;
    this.camState.targetPitch = 0;
    this.camState.renderPitch = 0;
    this.camState.smoothPosY = sp.y;
    this.camState.strafeOffset = 0;
    this.camState.landDip = 0;
    this.localPlayer.hp = 100;
    this.localPlayer.shield = this.mode === 'br' ? 50 : 100;
    this.localPlayer.alive = true;
    this.localPlayer.crouch = false;
    this.localPlayer.gliding = false;
    this.localPlayer.diving = false;
    this.localPlayer.skyBoostTimer = 0;
    this.localPlayer.canAirBoost = this.mapId === 'skybox';
    this.localRig.root.visible = true;
    this.weapons.resetAll();
  }

  _startVRampCountdown() {
    this.countdownTimer = 1.95; // Fast 3, 2, 1 (0.65s each) -> START!
    this.lastCountdownCeil = 4;
    this.startBannerTimer = 0;
    this.mapManager.setBarrierVisible(true);
    this._pushHudState();
  }

  setBotDifficulty(diffId) {
    if (!BOT_DIFFICULTIES[diffId]) return;
    this.botDifficulty = diffId;
    this.bot.setDifficulty(diffId);
    if (this.ui.onBanner) {
      this.ui.onBanner(`Bot difficulty: ${BOT_DIFFICULTIES[diffId].label}`, 'info');
    }
    this._pushHudState();
  }

  _selectWeapon(slot) {
    this.activeBuildType = null;
    if (this.editState.active) {
      this.editState.active = false;
      this.buildings.hideEditOverlay();
    }
    this.weapons.switchSlot(slot);
    this.localRig.setWeapon(slot, false);
    this._pushHudState();
  }

  _toggleBuildType(type, forceOn = false) {
    if (this.editState.active) {
      this.editState.active = false;
      this.buildings.hideEditOverlay();
    }
    if (!forceOn && this.activeBuildType === type) {
      this.activeBuildType = null;
    } else {
      this.activeBuildType = type;
      this.lastBuildType = type;
    }
    this.localRig.setWeapon(this.weapons.slot, Boolean(this.activeBuildType));
    this._pushHudState();
  }

  _toggleBuildMode() {
    if (this.activeBuildType) {
      this._selectWeapon(this.weapons.slot);
    } else {
      this._toggleBuildType(this.lastBuildType || BUILD_TYPES.WALL, true);
    }
  }

  _handleEditKey() {
    if (!this.localPlayer.alive) return;

    if (this.editState.active) {
      // Confirm edit!
      const b = this.buildings.builds.get(this.editState.buildKey);
      if (b && this.editState.draftMask > 0) {
        this.buildings.editBuild(b.key, this.editState.draftMask);
        audio.playEditConfirm();
        if (this.mode === 'online') {
          network.sendBuildEdit({ key: b.key, mask: this.editState.draftMask, rot: b.rot });
        }
      }
      this.editState.active = false;
      this.editState.buildKey = null;
      this.buildings.hideEditOverlay();
      this._pushHudState();
      return;
    }

    // Raycast from camera forward starting right at player's forward depth plane
    this._computeCameraRay();
    const eyeY = this.localPlayer.pos.y + (this.localPlayer.crouch ? PLAYER_EYE_CROUCH : PLAYER_EYE_STAND);
    const eyeDepth =
      (this.localPlayer.pos.x - this._camOrigin.x) * this._camDir.x +
      (eyeY - this._camOrigin.y) * this._camDir.y +
      (this.localPlayer.pos.z - this._camOrigin.z) * this._camDir.z;
    const editStartT = Math.max(0.2, eyeDepth - 0.15);

    raycastArena(
      this._camOrigin.x + this._camDir.x * editStartT,
      this._camOrigin.y + this._camDir.y * editStartT,
      this._camOrigin.z + this._camDir.z * editStartT,
      this._camDir.x, this._camDir.y, this._camDir.z,
      7.2,
      this.buildings,
      null,
      _editRayHit,
      this.mapManager
    );

    if (_editRayHit.hit && _editRayHit.hitType === 'build' && _editRayHit.buildKey) {
      const b = this.buildings.builds.get(_editRayHit.buildKey);
      const myId = this.mode === 'online' ? network.getSocketId() : 'local';
      if (!b || (b.ownerId && b.ownerId !== myId)) {
        if (this.ui.onBanner) this.ui.onBanner('You can only edit your own builds!', 'warning');
        return;
      }
      this.activeBuildType = null;
      this.editState.active = true;
      this.editState.buildKey = b.key;
      this.editState.draftMask = b.mask;
      this.editState.hoverTile = -1;
      audio.playEditOpen();
      this._pushHudState();
    }
  }

  _resetCurrentEdit() {
    if (!this.editState.active || !this.editState.buildKey) return;
    const b = this.buildings.builds.get(this.editState.buildKey);
    if (!b) return;
    const fullMask = getDefaultMask(b.type);
    this.editState.draftMask = fullMask;
    this.buildings.editBuild(b.key, fullMask);
    audio.playEditReset();
    if (this.mode === 'online') {
      network.sendBuildEdit({ key: b.key, mask: fullMask, rot: b.rot });
    }
    this.editState.active = false;
    this.editState.buildKey = null;
    this.buildings.hideEditOverlay();
    this._pushHudState();
  }

  _handlePrimaryAction(isInitialClick) {
    if (!this.localPlayer.alive) return;
    if (this.countdownTimer > 0) return;

    // 1. Edit Mode tile click
    if (this.editState.active) {
      const b = this.buildings.builds.get(this.editState.buildKey);
      if (!b) {
        this.editState.active = false;
        this.buildings.hideEditOverlay();
        return;
      }
      if (this.editState.hoverTile >= 0) {
        const bit = 1 << this.editState.hoverTile;
        const nextMask = this.editState.draftMask ^ bit;
        // Require at least 1 kept tile so structure doesn't vanish completely
        if (nextMask !== 0) {
          this.editState.draftMask = nextMask;
          audio.playUiClick();
        }
      }
      return;
    }

    // 2. Build placement
    if (this.activeBuildType) {
      this._tryPlaceLocalBuild();
      return;
    }

    // 3. Shoot / Pickaxe
    const w = WEAPONS[this.weapons.slot];
    if (!isInitialClick && !w.auto) return;
    this._fireLocalWeapon();
  }

  _isLocalInSpawnBox() {
    return isInsideSpawnBox(this.localPlayer.pos, this.mapId);
  }

  _isLocalDropLocked() {
    return this.mode === 'br' && this.localPlayer.gliding && this.localPlayer.pos.y > 4.5;
  }

  _tryPlaceLocalBuild() {
    if (this.countdownTimer > 0) return;
    if (this._isLocalInSpawnBox() || this._isLocalDropLocked()) return;
    if (this.buildCooldown > 0 || !this.activeBuildType) return;
    const placement = this.buildings.computePlacement(
      this.localPlayer.pos,
      this.localPlayer.yaw,
      this.localPlayer.pitch,
      this.activeBuildType,
      this.mapManager.halfGrid
    );

    if (!this.buildings.canPlaceBuild(placement, this.mapManager)) return;

    const matId = this.matchBuildMat || this.localPlayer.buildMat || 'wood';
    const matInfo = BUILD_MATERIALS[matId] || BUILD_MATERIALS.wood;
    const ownerId = this.mode === 'online' ? (network.getSocketId() || 'local') : 'local';

    const record = {
      ...placement,
      id: placement.key,
      mat: matId,
      hp: matInfo.hp,
      maxHp: matInfo.hp,
      mask: getDefaultMask(placement.type),
      ownerId
    };

    const placed = this.buildings.placeBuild(record, (m) => audio.playBuildPlace(m));
    if (placed) {
      this.buildCooldown = 0.085;
      if (this.mode === 'online') {
        network.sendBuildPlace(placed, (res) => {
          if (res && res.ok === false) {
            this.buildings.removeBuild(placed.key, false);
          }
        });
      }
    }
  }

  _fireLocalWeapon() {
    if (this.countdownTimer > 0 || this._isLocalInSpawnBox() || this._isLocalDropLocked()) return;
    this._computeCameraRay();
    const eyeH = this.localPlayer.crouch ? PLAYER_EYE_CROUCH : PLAYER_EYE_STAND;
    this._eyeOrigin.set(this.localPlayer.pos.x, this.localPlayer.pos.y + eyeH, this.localPlayer.pos.z);

    const rightX = Math.cos(this.localPlayer.yaw);
    const rightZ = -Math.sin(this.localPlayer.yaw);
    this._muzzleOrigin.set(
      this.localPlayer.pos.x + rightX * 0.36,
      this.localPlayer.pos.y + eyeH - 0.14,
      this.localPlayer.pos.z + rightZ * 0.36
    );

    let targets = [];
    if (this.mode === 'br') {
      targets = this.br.getCombatTargets(false, this.localPlayer);
    } else if (this.mode === 'bot' && this.bot.alive && !isInsideSpawnBox(this.bot.pos, this.mapId)) {
      targets.push({ id: 'bot', pos: this.bot.pos, crouch: this.bot.crouch, alive: true });
    } else if (this.mode === 'solo' && this.dummyTarget.alive && !isInsideSpawnBox(this.dummyTarget.pos, this.mapId)) {
      targets.push({ id: 'dummy', pos: this.dummyTarget.pos, crouch: false, alive: true });
    } else if (this.mode === 'online' && this.onlineOpponent.alive && this.onlineOpponent.id && !isInsideSpawnBox(this.onlineOpponent.pos, this.mapId)) {
      targets.push({ id: this.onlineOpponent.id, pos: this.onlineOpponent.pos, crouch: this.onlineOpponent.crouch, alive: true });
    }

    const isADS = this._isADS();

    const result = this.weapons.tryFire({
      camOrigin: this._camOrigin,
      camDir: this._camDir,
      muzzleOrigin: this._muzzleOrigin,
      eyeOrigin: this._eyeOrigin,
      isADS,
      buildingSystem: this.buildings,
      mapState: this.mapManager,
      targets,
      audio,
      onVisualShot: (sx, sy, sz, ex, ey, ez, color, hit, hitType) => {
        this.pools.spawnTracer(sx, sy, sz, ex, ey, ez, color);
        if (hit) {
          this.pools.spawnSparks(ex, ey, ez, hitType === 'player' ? 6 : 4, hitType === 'player' ? 0xff4d6d : 0xfacc15);
        }
      },
      onHitBuild: (buildKey, dmg) => {
        if (this.mode === 'online') {
          network.sendBuildDamage({ key: buildKey, damage: dmg });
          // Optimistically apply visual HP change cleanly
          const res = this.buildings.damageBuild(buildKey, dmg);
          if (res.destroyed) audio.playBuildBreak();
        } else {
          const res = this.buildings.damageBuild(buildKey, dmg);
          if (res.destroyed) audio.playBuildBreak();
        }
      },
      onHitPlayer: (targetId, dmg, isHeadshot, weaponId) => {
        if (this.mode === 'br') {
          const res = this.br.damageBot(
            targetId,
            dmg,
            'local',
            this.localPlayer.name,
            this.buildings,
            this.pools,
            audio,
            (victim) => {
              this.localPlayer.kills += 1;
              this.localPlayer.shield = Math.min(100, this.localPlayer.shield + 25);
              audio.playEliminate();
              if (this.ui.onBanner) {
                this.ui.onBanner(`Eliminated ${victim.name}! (+25 Shield Siphon)`, 'success');
              }
            }
          );
          if (res && this.ui.onHitMarker) {
            this.ui.onHitMarker(dmg, isHeadshot, res.hadShield);
          }
        } else if (this.mode === 'bot' && targetId === 'bot') {
          const hadShield = this.bot.shield > 0;
          if (this.ui.onHitMarker) this.ui.onHitMarker(dmg, isHeadshot, hadShield);
          const elim = this.bot.takeDamage(dmg);
          if (elim) {
            this.localPlayer.kills += 1;
            audio.playEliminate();
            if (this.ui.onBanner) this.ui.onBanner(`Eliminated ${this.bot.name}!`, 'success');
            if (this.mapId === 'vramp') {
              this.roundRestartTimer = 1.4;
            }
          }
        } else if (this.mode === 'solo' && targetId === 'dummy') {
          const hadShield = this.dummyTarget.shield > 0;
          if (this.ui.onHitMarker) this.ui.onHitMarker(dmg, isHeadshot, hadShield);
          let rem = dmg;
          if (this.dummyTarget.shield > 0) {
            const absorb = Math.min(this.dummyTarget.shield, rem);
            this.dummyTarget.shield -= absorb;
            rem -= absorb;
          }
          if (rem > 0) {
            this.dummyTarget.hp = Math.max(0, this.dummyTarget.hp - rem);
          }
          if (this.dummyTarget.hp <= 0) {
            this.dummyTarget.alive = false;
            this.dummyTarget.respawnTimer = 1.6;
            this.dummyTarget.rig.root.visible = false;
            this.localPlayer.kills += 1;
            audio.playEliminate();
            if (this.ui.onBanner) this.ui.onBanner('Target Dummy eliminated!', 'success');
            if (this.mapId === 'vramp') {
              this.roundRestartTimer = 1.4;
            }
          }
        } else if (this.mode === 'online') {
          network.sendPlayerHit({ targetId, damage: dmg, weapon: weaponId, isHeadshot });
        }
        this._pushHudState();
      }
    });

    if (result && result.fired && this.mode === 'online') {
      network.sendShootFx({
        weapon: result.weaponId,
        origin: [this._muzzleOrigin.x, this._muzzleOrigin.y, this._muzzleOrigin.z],
        end: [result.endX, result.endY, result.endZ]
      });
    }
    this._pushHudState();
  }

  _checkNearbyResetButton() {
    if (this.mode === 'br') return;
    for (const rb of RESET_BUTTON_POSITIONS) {
      const d = Math.hypot(this.localPlayer.pos.x - rb.x, this.localPlayer.pos.z - rb.z);
      if (d <= 3.6) {
        this.triggerArenaReset();
        return;
      }
    }
  }

  triggerArenaReset() {
    if (this.mode === 'br' || this.resetCooldown > 0) return;
    this.resetCooldown = 1.0;

    if (this.mode === 'online') {
      network.sendArenaReset();
    } else {
      this._applyLocalArenaReset(this.localPlayer.name);
    }
  }

  _applyLocalArenaReset(byName = 'Player', customBanner = null) {
    this.roundRestartTimer = 0;
    this.buildings.clearAll(true);
    this.editState.active = false;
    this.editState.buildKey = null;
    this.buildings.hideEditOverlay();

    const mySpawn = this.mapManager.spawnPoints[this.mode === 'online' ? (this.localSlot === 0 ? 0 : 1) : 0];
    this._respawnLocal(mySpawn);

    if (this.mode === 'bot') {
      this.bot.resetForRound(this.mapManager.spawnPoints[1]);
    } else if (this.mode === 'solo') {
      const soloDummyPos = this.mapId === 'vramp'
        ? (this.mapManager.spawnPoints[1] || { x: 2.0, y: 3.5, z: -4.85 })
        : { x: 0, y: 0, z: -6 };
      this.dummyTarget.pos.set(soloDummyPos.x, soloDummyPos.y, soloDummyPos.z);
      this.dummyTarget.rig.root.position.copy(this.dummyTarget.pos);
      this.dummyTarget.rig.root.rotation.y = Math.PI;
      this.dummyTarget.hp = 100;
      this.dummyTarget.shield = 100;
      this.dummyTarget.alive = true;
      this.dummyTarget.rig.root.visible = true;
    } else if (this.mode === 'online') {
      const oppSp = this.mapManager.spawnPoints[this.localSlot === 0 ? 1 : 0];
      this.onlineOpponent.hp = 100;
      this.onlineOpponent.shield = 100;
      this.onlineOpponent.alive = true;
      this.onlineOpponent.pos.set(oppSp.x, oppSp.y, oppSp.z);
      this.onlineOpponent.targetPos.set(oppSp.x, oppSp.y, oppSp.z);
      this.onlineOpponent.yaw = oppSp.yaw;
      this.onlineOpponent.targetYaw = oppSp.yaw;
      if (this.onlineOpponent.id) this.onlineOpponent.rig.root.visible = true;
    }

    if (this.mapId === 'vramp') {
      this._startVRampCountdown();
    }

    if (!customBanner) {
      audio.playArenaReset();
    }
    if (this.ui.onBanner) {
      this.ui.onBanner(customBanner || `Arena reset (${byName}) – Next round!`, 'info');
    }
    this._pushHudState();
  }

  _isADS() {
    return (
      this.mouseDownRight &&
      !this.activeBuildType &&
      !this.editState.active &&
      !this.paused &&
      this.weapons.slot !== 2
    );
  }

  _computeCameraRay() {
    this._updateCamera(0);
    this.camera.updateMatrixWorld();
    this.camera.getWorldDirection(this._camDir);
    this._camOrigin.copy(this.camera.position);
  }

  _damageLocalPlayerInBR(dmg, isHeadshot, attackerName, isStorm = false) {
    if (!this.localPlayer.alive || this.br.finished) return;
    if (dmg > 0) {
      let rem = dmg;
      if (!isStorm && this.localPlayer.shield > 0) {
        const abs = Math.min(this.localPlayer.shield, rem);
        this.localPlayer.shield -= abs;
        rem -= abs;
      }
      if (rem > 0) {
        this.localPlayer.hp = Math.max(0, this.localPlayer.hp - rem);
      }
      audio.playTakeDamage();
      if (this.ui.onDamageFlash) this.ui.onDamageFlash();
    }

    if (this.localPlayer.hp <= 0) {
      const placement = this.br.getAliveCount(this.localPlayer);
      this.localPlayer.alive = false;
      this.localPlayer.hp = 0;
      this.localPlayer.shield = 0;
      this.localRig.root.visible = false;
      this.editState.active = false;
      this.buildings.hideEditOverlay();
      this.br.finished = true;
      this.br._pushKillFeed(`${attackerName} eliminated ${this.localPlayer.name}`, false);
      if (this.ui.onBanner) {
        this.ui.onBanner(`Eliminated by ${attackerName}! (#${placement}/${this.br.totalFighters})`, 'danger');
      }
      if (this.ui.onBrMatchEnd) {
        this.ui.onBrMatchEnd({
          victory: false,
          placement,
          total: this.br.totalFighters,
          kills: this.localPlayer.kills,
          killerName: attackerName + (isHeadshot ? ' (Headshot)' : ''),
          survivalSec: Math.round(this.br.matchTime)
        });
      }
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock();
      }
    }
    this._pushHudState();
  }

  _updateCamera(dt) {
    const isADS = this._isADS();
    const isAR = this.weapons.slot === 1;
    const isSprinting = !isADS && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.keys.has('KeyW') && !this.localPlayer.crouch;
    const isBoosting = this.localPlayer.skyBoostTimer > 0 || this.localPlayer.diving;

    // Smooth camera rotation tracking (filters polling micro-stutter while keeping instant aim lock)
    const rotK = dt > 0 ? (1 - Math.exp(-38 * dt)) : 1;
    this.camState.renderYaw = lerpAngle(this.camState.renderYaw, this.camState.targetYaw, rotK);
    this.camState.renderPitch += (this.camState.targetPitch - this.camState.renderPitch) * rotK;
    this.localPlayer.yaw = this.camState.renderYaw;
    this.localPlayer.pitch = this.camState.renderPitch;

    const pitchUp = Math.max(0, this.camState.renderPitch);
    const pitchDown = Math.max(0, -this.camState.renderPitch);

    const targetFov = isADS ? (isAR ? 46 : 58) : (isBoosting ? 86 : (isSprinting ? 82 : 76));
    const targetDist = isADS ? (isAR ? 1.38 : 1.78) : Math.max(2.35, 3.12 - pitchUp * 0.52);
    const targetRight = isADS ? (isAR ? 0.62 : 0.66) : 0.88;
    const targetUp = (isADS ? (isAR ? 0.14 : 0.16) : 0.25 + pitchDown * 0.22) + this.camState.landDip;
    const targetEyeH = this.localPlayer.crouch ? PLAYER_EYE_CROUCH : PLAYER_EYE_STAND;

    const strafeInput = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const strafeTarget = strafeInput * (isADS ? 0.04 : 0.09);

    if (dt <= 0) {
      this.camState.dist = targetDist;
      this.camState.right = targetRight;
      this.camState.up = targetUp;
      this.camState.eyeH = targetEyeH;
      this.camState.fov = targetFov;
      this.camState.strafeOffset = strafeTarget;
      this.camState.smoothPosY = this.localPlayer.pos.y;
    } else {
      const k = 1 - Math.exp(-16 * dt);
      this.camState.dist += (targetDist - this.camState.dist) * k;
      this.camState.right += (targetRight - this.camState.right) * k;
      this.camState.up += (targetUp - this.camState.up) * k;
      this.camState.eyeH += (targetEyeH - this.camState.eyeH) * k;
      this.camState.fov += (targetFov - this.camState.fov) * k;
      this.camState.strafeOffset += (strafeTarget - this.camState.strafeOffset) * (1 - Math.exp(-10 * dt));
      this.camState.landDip *= Math.exp(-14 * dt);

      const yDiff = this.localPlayer.pos.y - this.camState.smoothPosY;
      if (Math.abs(yDiff) > 1.25) {
        this.camState.smoothPosY = this.localPlayer.pos.y;
      } else {
        const yRate = this.localPlayer.grounded ? 24 : 32;
        this.camState.smoothPosY += yDiff * (1 - Math.exp(-yRate * dt));
      }
    }

    if (Math.abs(this.camera.fov - this.camState.fov) > 0.05) {
      this.camera.fov = this.camState.fov;
      this.camera.updateProjectionMatrix();
    }

    const yaw = this.camState.renderYaw;
    const pitch = this.camState.renderPitch;
    const cosP = Math.cos(pitch);
    const fwdX = -Math.sin(yaw) * cosP;
    const fwdY = Math.sin(pitch);
    const fwdZ = -Math.cos(yaw) * cosP;

    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    const pivotX = this.localPlayer.pos.x + rightX * (this.camState.right + this.camState.strafeOffset);
    const pivotY = this.camState.smoothPosY + this.camState.eyeH + this.camState.up;
    const pivotZ = this.localPlayer.pos.z + rightZ * (this.camState.right + this.camState.strafeOffset);

    // Camera collision pull-in check against arena builds/map geometry (fast in, smooth out)
    raycastArena(
      pivotX, pivotY, pivotZ,
      -fwdX, -fwdY, -fwdZ,
      this.camState.dist,
      this.buildings,
      null,
      _camRayHit,
      this.mapManager
    );
    const desiredDist = _camRayHit.hit ? Math.max(0.65, _camRayHit.dist - 0.25) : this.camState.dist;
    if (dt <= 0 || desiredDist < this.camState.actualDist) {
      this.camState.actualDist = desiredDist;
    } else {
      const recK = 1 - Math.exp(-11 * dt);
      this.camState.actualDist += (desiredDist - this.camState.actualDist) * recK;
    }
    const actualDist = this.camState.actualDist;

    this.camera.position.set(
      pivotX - fwdX * actualDist,
      Math.max(this.camState.smoothPosY + 0.35, pivotY - fwdY * actualDist),
      pivotZ - fwdZ * actualDist
    );
    this.camera.lookAt(pivotX + fwdX * 28, pivotY + fwdY * 28, pivotZ + fwdZ * 28);
  }

  _pushHudState() {
    if (!this.ui.onHudUpdate) return;
    const opp = this.mode === 'bot'
      ? { name: this.bot.name, hp: Math.ceil(this.bot.hp), shield: Math.ceil(this.bot.shield), kills: this.bot.kills }
      : this.mode === 'online'
        ? { name: this.onlineOpponent.name, hp: Math.ceil(this.onlineOpponent.hp), shield: Math.ceil(this.onlineOpponent.shield), kills: this.onlineOpponent.kills }
        : { name: 'Target Dummy', hp: Math.ceil(this.dummyTarget.hp), shield: Math.ceil(this.dummyTarget.shield), kills: this.dummyTarget.kills || 0 };

    const activeWeapon = WEAPONS[this.weapons.slot];
    const cdNum = this.countdownTimer > 0 ? Math.min(3, Math.ceil(this.countdownTimer / 0.65)) : 0;
    const cdText = cdNum > 0 ? String(cdNum) : (this.startBannerTimer > 0 ? 'START!' : '');

    let brHud = null;
    if (this.mode === 'br' && this.br.active) {
      const st = this.br.storm;
      const pDist = Math.hypot(this.localPlayer.pos.x - st.cx, this.localPlayer.pos.z - st.cz);
      brHud = {
        aliveCount: this.br.getAliveCount(this.localPlayer),
        totalFighters: this.br.totalFighters,
        finished: this.br.finished,
        gliding: this._isLocalDropLocked(),
        storm: {
          phase: st.phase + 1,
          state: st.state,
          timer: Math.max(0, Math.ceil(st.timer)),
          cx: st.cx,
          cz: st.cz,
          radius: st.radius,
          nextCx: st.nextCx,
          nextCz: st.nextCz,
          nextRadius: st.nextRadius,
          dps: st.dps,
          playerInStorm: this.localPlayer.alive && pDist > st.radius
        },
        killFeed: this.br.killFeed,
        playerX: this.localPlayer.pos.x,
        playerZ: this.localPlayer.pos.z,
        playerYaw: this.localPlayer.yaw,
        pois: this.mapManager.poiMarkers,
        lootOrbs: this.br.orbs,
        bots: this.br.bots
      };
    }

    this.ui.onHudUpdate({
      mode: this.mode,
      mapId: this.mapId,
      botDifficulty: this.botDifficulty,
      localSlot: this.localSlot,
      roomCode: this.roomCode,
      hp: Math.ceil(this.localPlayer.hp),
      shield: Math.ceil(this.localPlayer.shield),
      kills: this.localPlayer.kills,
      alive: this.localPlayer.alive,
      weaponSlot: this.weapons.slot,
      ammo: this.weapons.ammo[this.weapons.slot],
      magSize: activeWeapon.magSize,
      reloading: this.weapons.reloading,
      buildType: this.activeBuildType,
      buildMat: this.matchBuildMat || this.localPlayer.buildMat,
      editActive: this.editState.active,
      isADS: this._isADS(),
      countdown: cdNum,
      countdownText: cdText,
      inSpawnBox: this._isLocalInSpawnBox(),
      canAirBoost: this.mapId === 'skybox' && !this.localPlayer.grounded && this.localPlayer.pos.y > 4.0 && this.localPlayer.canAirBoost,
      skyBoosting: this.localPlayer.skyBoostTimer > 0,
      opponent: opp,
      br: brHud,
      fps: this.currentFps,
      ping: this.mode === 'online' ? network.pingMs : 0,
      pointerLocked: this.pointerLocked || this.fallbackAim,
      paused: this.paused
    });
  }

  _loop(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame((ts) => this._loop(ts));

    const rawDt = (now - this.lastTs) / 1000;
    this.lastTs = now;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.time += dt;

    // FPS counter
    this.fpsAccum += rawDt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.4) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (this.resetCooldown > 0) this.resetCooldown -= dt;
    if (this.buildCooldown > 0) this.buildCooldown -= dt;

    // V-Ramp START! banner hide timer + automatic round restart after elimination
    if (this.startBannerTimer > 0 && !this.paused) {
      this.startBannerTimer = Math.max(0, this.startBannerTimer - dt);
      if (this.startBannerTimer === 0) this._pushHudState();
    }

    if (this.roundRestartTimer > 0 && !this.paused) {
      this.roundRestartTimer -= dt;
      if (this.roundRestartTimer <= 0) {
        this.roundRestartTimer = 0;
        this._applyLocalArenaReset(null, 'Next Round – Get Ready!');
      }
    }

    // V-Ramp Fast 3-2-1-START! Countdown timer (0.65s per step)
    if (this.countdownTimer > 0 && !this.paused) {
      this.countdownTimer -= dt;
      const cVal = Math.min(3, Math.max(0, Math.ceil(this.countdownTimer / 0.65)));
      if (cVal > 0 && cVal < this.lastCountdownCeil) {
        this.lastCountdownCeil = cVal;
        audio.playCountdownTick(false);
        this._pushHudState();
      }
      if (this.countdownTimer <= 0) {
        this.countdownTimer = 0;
        this.startBannerTimer = 0.55;
        this.mapManager.setBarrierVisible(false);
        this.pools.spawnSparks(2.0, 2.5, 0.0, 18, 0x22d3ee, 9.0);
        audio.playCountdownTick(true);
        if (this.ui.onBanner) this.ui.onBanner('START! Iron wall dropped – Fight!', 'success');
        this._pushHudState();
      }
    }

    this.mapManager.update(this.time);

    // Local player update
    let moveX = 0;
    let moveZ = 0;
    if (!this.paused && this.localPlayer.alive) {
      // Smooth optional arrow-key camera turn
      const yawKey = (this.keys.has('ArrowLeft') ? 1 : 0) - (this.keys.has('ArrowRight') ? 1 : 0);
      const pitchKey = (this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('ArrowDown') ? 1 : 0);
      if (yawKey !== 0) {
        this.camState.targetYaw += yawKey * 2.3 * dt;
        this.localPlayer.yaw = this.camState.targetYaw;
      }
      if (pitchKey !== 0) {
        this.camState.targetPitch = Math.max(-1.38, Math.min(1.38, this.camState.targetPitch + pitchKey * 1.6 * dt));
        this.localPlayer.pitch = this.camState.targetPitch;
      }

      const countdownLock = this.mapId === 'vramp' && this.countdownTimer > 0;
      const f = countdownLock ? 0 : ((this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0));
      const r = countdownLock ? 0 : ((this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0));
      this.localPlayer.crouch = !countdownLock && !this.localPlayer.gliding && (this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyX'));
      this.localPlayer.diving = this.localPlayer.gliding && this.keys.has('Space');
      const sprint = !countdownLock && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && !this.localPlayer.crouch && f > 0;
      const speed = this.localPlayer.gliding ? 13.8 : (this.localPlayer.crouch ? CROUCH_SPEED : (sprint ? SPRINT_SPEED : WALK_SPEED));

      let targetX = 0;
      let targetZ = 0;
      if (f !== 0 || r !== 0) {
        const yaw = this.camState.targetYaw;
        const fwdX = -Math.sin(yaw);
        const fwdZ = -Math.cos(yaw);
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);
        const len = Math.hypot(f, r) || 1;
        targetX = ((fwdX * f + rightX * r) / len) * speed;
        targetZ = ((fwdZ * f + rightZ * r) / len) * speed;
      }

      if (countdownLock) {
        this.moveVel.x = 0;
        this.moveVel.z = 0;
      } else {
        const hasInput = targetX !== 0 || targetZ !== 0;
        const accelRate = this.localPlayer.gliding
          ? 7.5
          : (this.localPlayer.grounded ? (hasInput ? 22.0 : 18.0) : (hasInput ? 9.5 : 1.8));
        const mk = 1 - Math.exp(-accelRate * dt);
        this.moveVel.x += (targetX - this.moveVel.x) * mk;
        this.moveVel.z += (targetZ - this.moveVel.z) * mk;
        if (!hasInput && Math.hypot(this.moveVel.x, this.moveVel.z) < 0.08) {
          this.moveVel.x = 0;
          this.moveVel.z = 0;
        }
      }
      moveX = this.moveVel.x;
      moveZ = this.moveVel.z;

      const wasGrounded = this.localPlayer.grounded;
      const prevVelY = this.localPlayer.vel.y;
      const wantJump = !countdownLock && this.keys.has('Space');
      stepPlayerPhysics(
        this.localPlayer,
        moveX,
        moveZ,
        wantJump,
        this.localPlayer.crouch,
        dt,
        this.buildings,
        this.mapManager
      );

      if (!wasGrounded && this.localPlayer.grounded && prevVelY < -6.0) {
        this.camState.landDip = Math.max(-0.16, prevVelY * 0.011);
      }

      // Check Sky Drop Boost Pads
      if (this.mapManager.boostPads && this.localPlayer.skyBoostTimer <= 0.1) {
        for (let i = 0; i < this.mapManager.boostPads.length; i++) {
          const pad = this.mapManager.boostPads[i];
          if (
            this.localPlayer.pos.x >= pad.minX && this.localPlayer.pos.x <= pad.maxX &&
            this.localPlayer.pos.y >= pad.minY && this.localPlayer.pos.y <= pad.maxY &&
            this.localPlayer.pos.z >= pad.minZ && this.localPlayer.pos.z <= pad.maxZ
          ) {
            this.localPlayer.vel.x = pad.vx;
            this.localPlayer.vel.y = pad.vy;
            this.localPlayer.vel.z = pad.vz;
            this.localPlayer.skyBoostTimer = 1.9;
            this.localPlayer.canAirBoost = false;
            this.localPlayer.grounded = false;
            this.pools.spawnSparks(this.localPlayer.pos.x, this.localPlayer.pos.y + 0.4, this.localPlayer.pos.z, 10, 0x22d3ee, 7);
            audio.playBoostPad();
            break;
          }
        }
      }

      // Fall off open arena/island edge
      if (this.localPlayer.pos.y <= FALL_DEATH_Y) {
        if (this.mode === 'br') {
          this._damageLocalPlayerInBR(999, false, 'The Ocean', true);
        } else {
          this.localPlayer.alive = false;
          this.localPlayer.hp = 0;
          this.localPlayer.shield = 0;
          this.localRig.root.visible = false;
          this.editState.active = false;
          this.buildings.hideEditOverlay();
          audio.playTakeDamage();

          if (this.mode === 'online') {
            network.sendPlayerFell();
            if (this.ui.onBanner) this.ui.onBanner('You fell off the map! +1 point to opponent.', 'danger');
          } else {
            if (this.mode === 'bot') this.bot.kills += 1;
            else this.dummyTarget.kills += 1;
            this.roundRestartTimer = 0.9;
            if (this.ui.onBanner) {
              this.ui.onBanner(
                this.mode === 'bot' ? 'You fell off the map! Bot scored – Next round!' : 'You fell off the map! Opponent scored – Next round!',
                'danger'
              );
            }
          }
          this._pushHudState();
        }
      } else if (this.mouseDownLeft && (this.pointerLocked || this.fallbackAim) && this.countdownTimer <= 0) {
        if (this.activeBuildType) {
          this._tryPlaceLocalBuild();
        } else if (!this.editState.active && WEAPONS[this.weapons.slot].auto) {
          this._fireLocalWeapon();
        }
      }
    } else if (!this.localPlayer.alive && this.mode !== 'online' && this.mode !== 'br' && this.mapId !== 'vramp' && this.roundRestartTimer <= 0) {
      this.localPlayer.respawnTimer -= dt;
      if (this.localPlayer.respawnTimer <= 0) {
        this._respawnLocal(this.mapManager.spawnPoints[0]);
        this._pushHudState();
      }
    }

    this.weapons.update(dt);

    // Update Camera first so renderYaw/renderPitch stay 100% synced, then character rig
    this._updateCamera(dt);

    // Update local character rig
    this.localRig.root.position.copy(this.localPlayer.pos);
    if (this._isADS() || this.mouseDownLeft || this.activeBuildType || this.editState.active) {
      this.localRig.root.rotation.y = this.localPlayer.yaw;
    } else {
      this.localRig.root.rotation.y = lerpAngle(
        this.localRig.root.rotation.y,
        this.localPlayer.yaw,
        1 - Math.exp(-26 * dt)
      );
    }
    this.localRig.animate(
      this.time,
      Math.hypot(moveX, moveZ),
      this.localPlayer.crouch,
      this.localPlayer.pitch,
      this.weapons.swingPhase,
      Boolean(this.activeBuildType || this.editState.active),
      this.weapons.slot
    );

    // Update Blueprint Preview or Edit Overlay (red if inside Spawn Box, Air Drop, or disconnected in mid-air)
    if (this.activeBuildType && this.localPlayer.alive && !this.paused && this.countdownTimer <= 0) {
      const placement = this.buildings.computePlacement(
        this.localPlayer.pos,
        this.localPlayer.yaw,
        this.localPlayer.pitch,
        this.activeBuildType,
        this.mapManager.halfGrid
      );
      const canPlace = !this._isLocalInSpawnBox() && !this._isLocalDropLocked() && this.buildings.canPlaceBuild(placement, this.mapManager);
      this.buildings.updateBlueprint(placement, true, canPlace);
    } else {
      this.buildings.updateBlueprint(null, false);
    }

    if (this.editState.active) {
      const b = this.buildings.builds.get(this.editState.buildKey);
      if (!b) {
        this.editState.active = false;
        this.buildings.hideEditOverlay();
      } else {
        this._computeCameraRay();
        this.editState.hoverTile = this.buildings.getEditHoverTile(b, this._camOrigin, this._camDir);
        this.buildings.showEditOverlay(b, this.editState.draftMask, this.editState.hoverTile);
      }
    }

    // Update Mode-Specific Opponents
    if (this.mode === 'br') {
      if (!this.paused) {
        this.br.update(dt, this.time, {
          localPlayer: this.localPlayer,
          buildingSystem: this.buildings,
          mapManager: this.mapManager,
          pools: this.pools,
          audio,
          camPos: this.camera.position,
          onPlayerLooted: () => this.weapons.resetAll(),
          onDamagePlayer: (dmg, isHead, attackerName, isStorm) => {
            this._damageLocalPlayerInBR(dmg, isHead, attackerName, isStorm);
          },
          onBanner: this.ui.onBanner,
          onMatchEnd: (summary) => {
            if (this.ui.onBrMatchEnd) this.ui.onBrMatchEnd(summary);
            if (document.pointerLockElement === this.canvas) {
              document.exitPointerLock();
            }
          }
        });
      }
    } else if (this.mode === 'bot') {
      this.bot.update(
        dt,
        this.localPlayer,
        this.buildings,
        this.pools,
        audio,
        (dmg, isHeadshot) => {
          if (!this.localPlayer.alive || this._isLocalInSpawnBox()) return;
          let rem = dmg;
          if (this.localPlayer.shield > 0) {
            const abs = Math.min(this.localPlayer.shield, rem);
            this.localPlayer.shield -= abs;
            rem -= abs;
          }
          if (rem > 0) this.localPlayer.hp = Math.max(0, this.localPlayer.hp - rem);
          audio.playTakeDamage();
          if (this.ui.onDamageFlash) this.ui.onDamageFlash();
          if (this.localPlayer.hp <= 0) {
            this.localPlayer.alive = false;
            this.localPlayer.respawnTimer = 2.2;
            this.localRig.root.visible = false;
            this.bot.kills += 1;
            if (this.ui.onBanner) this.ui.onBanner(`Bot eliminated you!${isHeadshot ? ' (Headshot)' : ''}`, 'danger');
            if (this.mapId === 'vramp') {
              this.roundRestartTimer = 1.4;
            }
          }
          this._pushHudState();
        },
        () => this._pushHudState(),
        this.camera.position,
        this.mapManager,
        this.countdownTimer > 0,
        this.mapManager.spawnPoints[1],
        this.mapId !== 'vramp' && this.roundRestartTimer <= 0
      );
      if (this.bot.alive && this.bot.pos.y <= FALL_DEATH_Y) {
        this.bot.alive = false;
        this.bot.hp = 0;
        this.bot.shield = 0;
        this.bot.rig.root.visible = false;
        this.localPlayer.kills += 1;
        this.roundRestartTimer = 0.9;
        audio.playEliminate();
        if (this.ui.onBanner) this.ui.onBanner('Bot fell off the map! +1 point – Next round!', 'success');
        this._pushHudState();
      }
    } else if (this.mode === 'solo') {
      if (!this.dummyTarget.alive && this.mapId !== 'vramp') {
        this.dummyTarget.respawnTimer -= dt;
        if (this.dummyTarget.respawnTimer <= 0) {
          this.dummyTarget.alive = true;
          this.dummyTarget.hp = 100;
          this.dummyTarget.shield = 100;
          this.dummyTarget.rig.root.visible = true;
          this._pushHudState();
        }
      } else if (this.dummyTarget.alive) {
        this.dummyTarget.rig.updateHealthBar(this.dummyTarget.hp, this.dummyTarget.shield, this.camera.position);
      }
    } else if (this.mode === 'online') {
      // Smoothly interpolate opponent
      const opp = this.onlineOpponent;
      if (opp.alive && opp.id) {
        const alpha = Math.min(1, dt * 16);
        opp.pos.lerp(opp.targetPos, alpha);
        let dyaw = opp.targetYaw - opp.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        opp.yaw += dyaw * alpha;
        opp.pitch += (opp.targetPitch - opp.pitch) * alpha;
        if (opp.swingPhase > 0) opp.swingPhase = Math.max(0, opp.swingPhase - dt * 3.5);

        opp.rig.root.position.copy(opp.pos);
        opp.rig.root.rotation.y = opp.yaw;
        opp.rig.animate(
          this.time,
          opp.speed,
          opp.crouch,
          opp.pitch,
          opp.swingPhase,
          Boolean(opp.buildMode),
          opp.slot
        );
        opp.rig.updateHealthBar(opp.hp, opp.shield, this.camera.position);
      }

      this.netSyncAccum += dt;
      if (this.localPlayer.alive && this.netSyncAccum >= 0.04) { // 25 Hz clean state sync
        this.netSyncAccum = 0;
        network.sendPlayerState({
          x: this.localPlayer.pos.x,
          y: this.localPlayer.pos.y,
          z: this.localPlayer.pos.z,
          yaw: this.localPlayer.yaw,
          pitch: this.localPlayer.pitch,
          vx: moveX,
          vz: moveZ,
          crouch: this.localPlayer.crouch,
          slot: this.weapons.slot,
          buildMode: this.activeBuildType,
          swing: this.weapons.swingPhase
        });
      }
    }

    // Pulse reset button caps without per-frame closures
    for (let i = 0; i < this.resetBtnMeshes.length; i++) {
      this.resetBtnMeshes[i].position.y = 1.48 + Math.sin(this.time * 4 + i) * 0.05;
    }

    // Rebuild InstancedMeshes only if dirty & update Object Pools
    this.buildings.rebuildInstances();
    this.pools.update(dt);

    // Periodic HUD refresh (reload timer, FPS, ping)
    this.hudAccum += dt;
    if (this.hudAccum >= 0.12) {
      this.hudAccum = 0;
      this._pushHudState();
    }

    // Keep Sky Dome centered on camera so horizon never clips into darker blue at edges
    this.skyDome.position.copy(this.camera.position);
    this.skyDome.updateMatrix();

    this.renderer.render(this.scene, this.camera);
  }
}
