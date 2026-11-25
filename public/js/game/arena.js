import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ARENA_HALF_GRID,
  ARENA_HALF_SIZE,
  BOT_DIFFICULTIES,
  BUILD_MATERIALS,
  BUILD_TYPES,
  CELL_SIZE,
  CROUCH_SPEED,
  EMOTES,
  FALL_DEATH_Y,
  JUMP_SPEED,
  PLAYER_EYE_CROUCH,
  PLAYER_EYE_STAND,
  QUALITY_PRESETS,
  RESET_BUTTON_POSITIONS,
  SPRINT_SPEED,
  WALK_SPEED,
  WEAPONS,
  WEAPON_CATALOG
} from './constants.js';
import { BuildingSystem, getDefaultMask } from './buildings.js';
import { ArenaMapManager } from './maps.js';
import { BattleRoyaleController } from './brMode.js';
import { EffectPools } from './pools.js';
import { isInsideSpawnBox, isPlayerProtected, raycastArena, stepPlayerPhysics } from './physics.js';
import { createCharacterRig } from './playerMesh.js';
import { STRUCT_VERTEX_MAT, getStructureGeo, onStructuresLoaded } from './structureAssets.js';
import { getArenaFloorTextures } from './textures.js';
import { WeaponController } from './weapons.js';
import { SmartBot } from './bot.js';
import { getBotDiffLabel, getMaterialName, t } from '../i18n.js';
import { DEFAULT_KEYBINDS, storage } from '../storage.js';
import { audio } from '../audio.js';
import { network } from '../network.js';

function lerpAngle(current, target, k) {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * k;
}

const SKY_SUN_DIR = new THREE.Vector3(34, 48, 26).normalize();

function createSkyDomeMesh() {
  // Stylized Fortnite-inspired Skybox with warm orange/peach sun horizon & azure zenith
  const group = new THREE.Group();

  const geo = new THREE.SphereGeometry(1, 24, 16);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    uniforms: {
      uSunDir: { value: SKY_SUN_DIR.clone() }
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
        vec3 dir = normalize(vDir);
        float h = dir.y;
        float sunDot = dot(dir, normalize(uSunDir));
        float sunAlign = clamp(sunDot * 0.5 + 0.5, 0.0, 1.0);

        vec3 cZenith = vec3(0.086, 0.384, 0.800);       // #1662cc deep azure
        vec3 cMid = vec3(0.306, 0.718, 1.000);          // #4eb7ff vibrant mid-sky
        vec3 cHorizonCool = vec3(0.725, 0.902, 1.000);  // #b9e6ff light-blue horizon
        vec3 cHorizonWarm = vec3(1.000, 0.678, 0.400);  // #ffad66 warm golden-orange horizon
        vec3 cNadir = vec3(0.345, 0.596, 0.776);        // #5898c6 misty sea-blue below

        vec3 horizonCol = mix(cHorizonCool, cHorizonWarm, pow(sunAlign, 1.8));
        vec3 skyCol;
        if (h >= 0.0) {
          vec3 lowToMid = mix(horizonCol, cMid, smoothstep(0.0, 0.34, h));
          skyCol = mix(lowToMid, cZenith, smoothstep(0.30, 0.92, h));
        } else {
          skyCol = mix(horizonCol, cNadir, smoothstep(0.0, 0.36, -h));
        }

        // Subtle warm atmospheric bloom around sun
        float sunGlow = pow(max(sunDot, 0.0), 14.0) * 0.36;
        skyCol += vec3(1.0, 0.85, 0.58) * sunGlow;

        gl_FragColor = vec4(clamp(skyCol, 0.0, 1.0), 1.0);
      }
    `
  });
  const dome = new THREE.Mesh(geo, domeMat);
  dome.renderOrder = -3;
  group.add(dome);

  // Stylized Golden Sun Disc + Soft Halo aligned with directional light
  const sunPos = SKY_SUN_DIR.clone().multiplyScalar(0.92);
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.048, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff5c0, fog: false, depthWrite: false })
  );
  sunDisc.position.copy(sunPos);
  sunDisc.lookAt(0, 0, 0);
  sunDisc.renderOrder = -2;
  group.add(sunDisc);

  const sunHalo = new THREE.Mesh(
    new THREE.RingGeometry(0.048, 0.11, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffc875,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      fog: false,
      depthWrite: false
    })
  );
  sunHalo.position.copy(sunPos).multiplyScalar(0.995);
  sunHalo.lookAt(0, 0, 0);
  sunHalo.renderOrder = -2;
  group.add(sunHalo);

  // 1-draw-call InstancedMesh of faceted fluffy low-poly cloud puffs around horizon
  const puffGeo = new THREE.IcosahedronGeometry(1, 1);
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthWrite: false });
  const clusterCount = 14;
  const puffsPerCluster = 4;
  const totalPuffs = clusterCount * puffsPerCluster;
  const cloudMesh = new THREE.InstancedMesh(puffGeo, cloudMat, totalPuffs);
  cloudMesh.renderOrder = -1;

  const dummy = new THREE.Object3D();
  const cColor = new THREE.Color();
  const puffOffsets = [
    [0, 0, 0, 0.11, 0.036, 0.055],
    [-0.075, -0.008, 0.01, 0.072, 0.028, 0.045],
    [0.08, -0.01, -0.01, 0.068, 0.026, 0.045],
    [0.015, 0.022, 0.005, 0.065, 0.032, 0.045]
  ];

  let idx = 0;
  for (let i = 0; i < clusterCount; i++) {
    const ang = (i / clusterCount) * Math.PI * 2 + (i % 2) * 0.14;
    const elev = 0.09 + (i % 3) * 0.058;
    const rad = 0.87;
    const cx = Math.cos(ang) * rad;
    const cz = Math.sin(ang) * rad;
    const clusterFacing = Math.atan2(-cx, -cz);
    const sunProx = Math.max(0, Math.cos(ang - Math.atan2(SKY_SUN_DIR.z, SKY_SUN_DIR.x)));

    for (let p = 0; p < puffsPerCluster; p++) {
      const [ox, oy, oz, sx, sy, sz] = puffOffsets[p];
      const cosF = Math.cos(clusterFacing);
      const sinF = Math.sin(clusterFacing);
      dummy.position.set(
        cx + ox * cosF + oz * sinF,
        elev + oy,
        cz - ox * sinF + oz * cosF
      );
      dummy.rotation.set(0, clusterFacing, 0);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      cloudMesh.setMatrixAt(idx, dummy.matrix);

      // Warm peach-ivory tint near sun, crisp ivory-blue away from sun
      cColor.setRGB(
        0.97 + 0.03 * sunProx,
        0.94 + 0.03 * (1 - sunProx * 0.4),
        0.92 + 0.07 * (1 - sunProx)
      );
      cloudMesh.setColorAt(idx, cColor);
      idx++;
    }
  }
  cloudMesh.instanceMatrix.needsUpdate = true;
  if (cloudMesh.instanceColor) cloudMesh.instanceColor.needsUpdate = true;
  group.add(cloudMesh);

  return group;
}

function buildVertexColoredSceneryGeo(parts) {
  const prepared = [];
  const mat4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const tmpColor = new THREE.Color();

  for (const part of parts) {
    const {
      geo,
      x = 0, y = 0, z = 0,
      rx = 0, ry = 0, rz = 0,
      sx = 1, sy = 1, sz = 1,
      colorFn
    } = part;
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    if (!g.attributes.normal) g.computeVertexNormals();

    pos.set(x, y, z);
    euler.set(rx, ry, rz);
    quat.setFromEuler(euler);
    scale.set(sx, sy, sz);
    mat4.compose(pos, quat, scale);
    g.applyMatrix4(mat4);

    const pAttr = g.attributes.position;
    const colors = new Float32Array(pAttr.count * 3);
    for (let i = 0; i < pAttr.count; i++) {
      colorFn(pAttr.getX(i), pAttr.getY(i), pAttr.getZ(i), tmpColor);
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    prepared.push(g);
  }
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  if (merged) merged.computeBoundingSphere();
  return merged;
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

    // Scene & Camera (vibrant sunlit daylight atmosphere with exponential distance haze)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xd2e6f5);
    const q = QUALITY_PRESETS[storage.get().quality] || QUALITY_PRESETS.medium;
    this._fogExp2 = new THREE.FogExp2(0xd9e8f4, q.fogDensity);
    this.scene.fog = q.fog ? this._fogExp2 : null;
    this.currentQuality = q.key;
    this._rendererAA = Boolean(q.antialias);

    this.camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.15, q.far);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this._rendererAA,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.type = q.shadowMapType === 'pcfsoft' ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
    this.renderer.toneMapping = q.toneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    // Warm sunlit HemisphereLight (golden sky above, cool blue ground bounce) + DirectionalLight with 1024px soft shadows
    this.hemiLight = new THREE.HemisphereLight(0xffe7bd, 0x5882bd, 1.35);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff1cf, 2.05);
    this.dirLight.position.set(34, 48, 26);
    this.dirLight.shadow.camera.left = -46;
    this.dirLight.shadow.camera.right = 46;
    this.dirLight.shadow.camera.top = 46;
    this.dirLight.shadow.camera.bottom = -46;
    this.dirLight.shadow.camera.near = 5;
    this.dirLight.shadow.camera.far = 155;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.035;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // Reusable local muzzle flash light spike (zero overhead when idle)
    this.muzzleLight = new THREE.PointLight(0xffbe55, 0, 8.0);
    this.muzzleLightTimer = 0;
    this.scene.add(this.muzzleLight);

    // Core systems
    this.pools = new EffectPools(this.scene);
    this.buildings = new BuildingSystem(this.scene, this.pools);
    this.mapManager = new ArenaMapManager(this.scene);
    this.br = new BattleRoyaleController(this.scene);
    this.weapons = new WeaponController();

    // Stylized Skybox, Distant Horizon Mountains/Islands & Static Arena Platform
    this.skyDome = createSkyDomeMesh();
    this.skyDome.matrixAutoUpdate = false;
    this.skyDome.updateMatrix();
    this.scene.add(this.skyDome);

    this.sceneryGroup = new THREE.Group();
    this.sceneryGroup.matrixAutoUpdate = false;
    this.scene.add(this.sceneryGroup);
    this._buildDistantScenery();

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
      name: 'Terč',
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
      name: t('hud_opp'),
      skinId: 'crimson',
      buildMat: 'brick',
      pos: new THREE.Vector3(0, 0, -12),
      targetPos: new THREE.Vector3(0, 0, -12),
      targetVx: 0,
      targetVz: 0,
      lastUpdateTime: 0,
      yaw: Math.PI,
      targetYaw: Math.PI,
      pitch: 0,
      targetPitch: 0,
      crouch: false,
      slot: 0,
      weaponId: 'shotgun',
      buildMode: null,
      swingPhase: 0,
      reloading: false,
      reloadProgress: 0,
      emote: null,
      emoteTime: 0,
      emoteYaw: Math.PI,
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
    this.lastUnlockTime = 0;

    // Timers & metrics
    this.time = 0;
    this.lastTs = 0;
    this.netSyncAccum = 0;
    this.hudAccum = 0;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.currentFps = 60;
    this.currentFrameMs = 16.7;
    this.resetCooldown = 0;
    this.respawnKeyCooldown = 0;
    this.crosshairRecoil = 0;
    this.lastCrosshairGap = -1;
    this.sniperScopeLevel = 0;
    this._wasReloadHud = false;
    this.activeEmote = null;
    this.emoteTime = 0;
    this.emoteWheelOpen = false;
    audio.stopEmoteMusic();
    this.emoteCursorX = 0;
    this.emoteCursorY = 0;
    this.hoveredEmoteId = null;
    if (this.ui.onEmoteWheelChange) this.ui.onEmoteWheelChange(false, null, 0, 0);
    this.activeEmote = null;
    this.emoteTime = 0;
    this.emoteDuration = 8.0;
    this.emoteYaw = 0;
    this.emoteWheelOpen = false;
    this.emoteKeyDownTs = 0;
    this.emoteCursorX = 0;
    this.emoteCursorY = 0;
    this.hoveredEmoteId = null;
    this._boundLoop = (ts) => this._loop(ts);
    this._lowFallbackMats = new Map();

    // Reusable vectors & zero-GC scratch payloads
    this._camOrigin = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._eyeOrigin = new THREE.Vector3();
    this._muzzleOrigin = new THREE.Vector3();
    this._tmpVec = new THREE.Vector3();

    this._hudOpp = { name: '', hp: 100, shield: 100, kills: 0 };
    this._hudBrStorm = {
      phase: 1,
      state: 'wait',
      timer: 0,
      cx: 0,
      cz: 0,
      radius: 82,
      nextCx: 0,
      nextCz: 0,
      nextRadius: 48,
      dps: 1.5,
      playerInStorm: false
    };
    this._hudBr = {
      aliveCount: 16,
      totalFighters: 16,
      finished: false,
      gliding: false,
      storm: this._hudBrStorm,
      killFeed: null,
      playerX: 0,
      playerZ: 0,
      playerYaw: 0,
      pois: null,
      lootOrbs: null,
      bots: null
    };
    this._hudPayload = {
      mode: 'solo',
      mapId: 'skybox',
      botDifficulty: 'medium',
      localSlot: 0,
      roomCode: null,
      hp: 100,
      shield: 100,
      kills: 0,
      alive: true,
      weaponSlot: 0,
      activeWeaponId: 'shotgun',
      slotWeaponIds: ['shotgun', 'ar', 'pickaxe'],
      ammo: 5,
      magSize: 5,
      reloading: false,
      reloadProgress: 0,
      reloadRemaining: 0,
      buildType: null,
      buildMat: 'wood',
      editActive: false,
      isADS: false,
      sniperZoom: 0,
      countdown: 0,
      countdownText: '',
      roundState: 'solo',
      crosshairSpread: 4,
      inSpawnBox: false,
      nearbyPickup: null,
      canAirBoost: false,
      skyBoosting: false,
      opponent: this._hudOpp,
      br: null,
      fps: 60,
      frameMs: 16.7,
      quality: this.currentQuality,
      ping: 0,
      pointerLocked: false,
      paused: false,
      emoteWheelOpen: false,
      activeEmote: null
    };
    this._netStatePayload = {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      vx: 0,
      vz: 0,
      crouch: false,
      slot: 0,
      weaponId: 'shotgun',
      buildMode: null,
      swing: 0,
      reloading: false,
      reloadProgress: 0,
      emote: null,
      emoteYaw: 0
    };
    this._shootFxOrigin = [0, 0, 0];
    this._shootFxEnd = [0, 0, 0];
    this._shootFxPayload = { weapon: '', origin: this._shootFxOrigin, end: this._shootFxEnd };
    this._singleTarget = { id: '', pos: null, crouch: false, alive: true };
    this._fireTargets = [];
    this._localBuildData = {
      type: '',
      gx: 0,
      gy: 0,
      gz: 0,
      dir: 0,
      rot: 0,
      key: '',
      id: '',
      mat: 'wood',
      hp: 150,
      maxHp: 150,
      mask: 0,
      ownerId: 'local'
    };
    this._playBuildSound = (m) => audio.playBuildPlace(m);
    this._onBrBotKilled = (victim) => {
      this.localPlayer.kills += 1;
      this.localPlayer.shield = Math.min(100, this.localPlayer.shield + 25);
      audio.playEliminate();
      if (this.ui.onBanner) {
        this.ui.onBanner(`Eliminated ${victim.name}! (+25 Shield Siphon)`, 'success');
      }
    };
    this._fireOpts = {
      camOrigin: this._camOrigin,
      camDir: this._camDir,
      muzzleOrigin: this._muzzleOrigin,
      eyeOrigin: this._eyeOrigin,
      isADS: false,
      buildingSystem: this.buildings,
      mapState: this.mapManager,
      targets: this._fireTargets,
      audio,
      onVisualShot: (sx, sy, sz, ex, ey, ez, color, hit, hitType, buildKey, isHeadshot, playerId, isMelee) => {
        if (!isMelee) {
          this.pools.spawnTracer(sx, sy, sz, ex, ey, ez, color);
        }
        if (hit) {
          if (hitType === 'build') {
            const hitBuild = buildKey ? this.buildings.builds.get(buildKey) : null;
            this.pools.spawnBuildImpact(ex, ey, ez, hitBuild ? hitBuild.mat : 'wood', isMelee ? 1.25 : 1.0);
          } else if (hitType === 'player') {
            let hadShield = false;
            if (this.mode === 'br') {
              const bBot = this.br._findBotById(playerId);
              hadShield = (bBot?.shield || 0) > 0;
            } else if (this.mode === 'bot') {
              hadShield = this.bot.shield > 0;
            } else if (this.mode === 'solo') {
              hadShield = this.dummyTarget.shield > 0;
            } else if (this.mode === 'online') {
              hadShield = this.onlineOpponent.shield > 0;
            }
            this.pools.spawnPlayerImpact(ex, ey, ez, hadShield, Boolean(isHeadshot));
          } else {
            this.pools.spawnSparks(ex, ey, ez, 4, 0xfff3b0, 5.5);
          }
        }
      },
      onHitBuild: (buildKey, dmg) => {
        if (this.mode === 'online') {
          network.sendBuildDamage({ key: buildKey, damage: dmg });
        }
        const res = this.buildings.damageBuild(buildKey, dmg);
        if (res.destroyed) audio.playBuildBreak();
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
            this._onBrBotKilled
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
            if (this.ui.onBanner) this.ui.onBanner(t('banner_elim_bot', { name: this.bot.name }), 'success');
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
            if (this.ui.onBanner) this.ui.onBanner(t('banner_elim_target'), 'success');
            if (this.mapId === 'vramp') {
              this.roundRestartTimer = 1.4;
            }
          }
        } else if (this.mode === 'online') {
          network.sendPlayerHit({ targetId, damage: dmg, weapon: weaponId, isHeadshot });
        }
        this._pushHudState();
      }
    };
    this._brUpdateCtx = {
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
    };
    this._onBotHitLocal = (dmg, isHeadshot) => {
      if (!this.localPlayer.alive || this._isLocalProtected()) return;
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
        if (this.ui.onBanner) {
          this.ui.onBanner(t('banner_bot_elim_you', { hs: isHeadshot ? ' (Headshot)' : '' }), 'danger');
        }
        if (this.mapId === 'vramp') {
          this.roundRestartTimer = 1.4;
        }
      }
      this._pushHudState();
    };
    this._onBotRespawned = () => this._pushHudState();

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

  _buildDistantScenery() {
    // Low-poly distant mountain silhouettes, floating islands & foliage (3 static draw calls, zero collision)
    const mountainParts = [];
    const cone6 = new THREE.ConeGeometry(1, 1, 6);
    const cone5 = new THREE.ConeGeometry(1, 1, 5);
    const cyl7 = new THREE.CylinderGeometry(0.85, 1.0, 1, 7);

    let seed = 7331;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const cSand = new THREE.Color(0xc4a46b);
    const cLush = new THREE.Color(0x3e8c6f);
    const cRock = new THREE.Color(0x557596);
    const cSnow = new THREE.Color(0xe6f2ff);

    // 1. Ring of 22 multi-peak distant mountains & island ridges around arena
    for (let i = 0; i < 22; i++) {
      const ang = (i / 22) * Math.PI * 2 + (rand() - 0.5) * 0.14;
      const dist = 94 + rand() * 64;
      const h = 24 + rand() * 34;
      const rad = 14 + rand() * 14;
      const baseY = -22;
      const px = Math.cos(ang) * dist;
      const pz = Math.sin(ang) * dist;
      const hasSnow = h > 38;

      const addPeak = (ox, oz, ph, pr, ry) => {
        const yMin = baseY;
        const yMax = baseY + ph;
        mountainParts.push({
          geo: (i % 2 === 0 ? cone6 : cone5),
          x: px + ox,
          y: baseY + ph * 0.5,
          z: pz + oz,
          ry,
          sx: pr,
          sy: ph,
          sz: pr * (0.85 + rand() * 0.3),
          colorFn: (_vx, vy, _vz, out) => {
            const t = Math.max(0, Math.min(1, (vy - yMin) / Math.max(1, yMax - yMin)));
            if (t < 0.22) {
              out.copy(cSand).lerp(cLush, t / 0.22);
            } else if (t < 0.68) {
              out.copy(cLush).lerp(cRock, (t - 0.22) / 0.46);
            } else if (hasSnow) {
              out.copy(cRock).lerp(cSnow, Math.min(1, (t - 0.68) / 0.22));
            } else {
              out.copy(cRock);
            }
          }
        });
      };

      addPeak(0, 0, h, rad, rand() * Math.PI);
      // Secondary shoulder peak for rich mountain ridge silhouette
      const sideAng = ang + (rand() > 0.5 ? 0.8 : -0.8);
      addPeak(
        Math.cos(sideAng) * rad * 0.62,
        Math.sin(sideAng) * rad * 0.62,
        h * (0.58 + rand() * 0.22),
        rad * 0.72,
        rand() * Math.PI
      );
    }

    const mountainsGeo = buildVertexColoredSceneryGeo(mountainParts);
    const sceneryMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const mountainsMesh = new THREE.Mesh(mountainsGeo, sceneryMat);
    mountainsMesh.matrixAutoUpdate = false;
    mountainsMesh.updateMatrix();
    this.sceneryGroup.add(mountainsMesh);

    // 2. 7 Floating Stylized Fortnite-style Rock Islets + Low-Poly Pines
    const isletParts = [];
    const cUnderRock = new THREE.Color(0x526b88);
    const cGrassTop = new THREE.Color(0x47b557);
    const cTrunk = new THREE.Color(0x7c502b);
    const cPineDark = new THREE.Color(0x2b8a4e);
    const cPineBright = new THREE.Color(0x3cb363);

    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2 + 0.38;
      const dist = 78 + (i % 3) * 18 + rand() * 8;
      const iy = -2 + (i % 4) * 5.5;
      const ir = 6.5 + (i % 3) * 2.2;
      const ix = Math.cos(ang) * dist;
      const iz = Math.sin(ang) * dist;

      // Inverted tapering rock bottom
      isletParts.push({
        geo: cone6,
        x: ix,
        y: iy - ir * 0.65,
        z: iz,
        rx: Math.PI,
        ry: rand() * Math.PI,
        sx: ir,
        sy: ir * 1.3,
        sz: ir * 0.92,
        colorFn: (_vx, vy, _vz, out) => {
          const depth = Math.max(0, Math.min(1, (iy - vy) / (ir * 1.3)));
          out.copy(cUnderRock).offsetHSL(0, 0, -depth * 0.08);
        }
      });

      // Lush grassy plateau disc
      isletParts.push({
        geo: cyl7,
        x: ix,
        y: iy + 0.45,
        z: iz,
        ry: rand() * Math.PI,
        sx: ir * 1.04,
        sy: 0.95,
        sz: ir * 0.96,
        colorFn: (_vx, vy, _vz, out) => {
          out.copy(vy > iy + 0.35 ? cGrassTop : cSand);
        }
      });

      // 2-3 Stylized Pine Trees on top of each floating islet
      const treeCount = 2 + (i % 2);
      for (let t = 0; t < treeCount; t++) {
        const tang = ang + t * 2.1;
        const trad = ir * 0.38;
        const tx = ix + Math.cos(tang) * trad;
        const tz = iz + Math.sin(tang) * trad;
        const th = 2.6 + (t % 2) * 1.0;

        isletParts.push({
          geo: cyl7,
          x: tx,
          y: iy + 1.4,
          z: tz,
          sx: 0.28,
          sy: 1.2,
          sz: 0.28,
          colorFn: (_vx, _vy, _vz, out) => out.copy(cTrunk)
        });
        isletParts.push({
          geo: cone6,
          x: tx,
          y: iy + 2.5,
          z: tz,
          ry: t * 0.9,
          sx: 1.35,
          sy: th * 0.72,
          sz: 1.35,
          colorFn: (_vx, _vy, _vz, out) => out.copy(cPineDark)
        });
        isletParts.push({
          geo: cone6,
          x: tx,
          y: iy + 3.45,
          z: tz,
          ry: t * 0.9 + 0.5,
          sx: 0.98,
          sy: th * 0.62,
          sz: 0.98,
          colorFn: (_vx, _vy, _vz, out) => out.copy(cPineBright)
        });
      }
    }

    const isletsGeo = buildVertexColoredSceneryGeo(isletParts);
    const isletsMesh = new THREE.Mesh(isletsGeo, sceneryMat);
    isletsMesh.matrixAutoUpdate = false;
    isletsMesh.updateMatrix();
    this.sceneryGroup.add(isletsMesh);

    // 3. Distant sunlit sea/mist circle below 1v1 void (hidden during BR mode)
    this.distantOcean1v1 = new THREE.Mesh(
      new THREE.CircleGeometry(360, 28),
      new THREE.MeshBasicMaterial({ color: 0x52a8d8 })
    );
    this.distantOcean1v1.rotation.x = -Math.PI / 2;
    this.distantOcean1v1.position.y = -22;
    this.distantOcean1v1.matrixAutoUpdate = false;
    this.distantOcean1v1.updateMatrix();
    this.sceneryGroup.add(this.distantOcean1v1);

    cone6.dispose();
    cone5.dispose();
    cyl7.dispose();
  }

  _buildStaticArena() {
    // 1. Open-Edge Arena Platform (80x80m, NO perimeter walls so players can fall off into void)
    const floorTextures = getArenaFloorTextures();
    const floorGeo = new THREE.PlaneGeometry(ARENA_HALF_SIZE * 2, ARENA_HALF_SIZE * 2);
    this.floorMats = {
      low: new THREE.MeshBasicMaterial({ color: 0x456385 }),
      medium: new THREE.MeshLambertMaterial({ color: 0xffffff, map: floorTextures.map }),
      high: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: floorTextures.map,
        bumpMap: floorTextures.bumpMap,
        bumpScale: 0.045,
        roughnessMap: floorTextures.roughnessMap,
        roughness: 0.72,
        metalness: 0.22
      })
    };
    this.arenaFloor = new THREE.Mesh(floorGeo, this.floorMats.medium);
    this.arenaFloor.rotation.x = -Math.PI / 2;
    this.arenaFloor.receiveShadow = true;
    this.arenaFloor.matrixAutoUpdate = false;
    this.arenaFloor.updateMatrix();
    this.arena1v1Group.add(this.arenaFloor);

    // Solid steel-slate under-slab & coral flush edge trim marking drop-off boundary
    this.underSlabMats = {
      low: new THREE.MeshBasicMaterial({ color: 0x2c4059 }),
      medium: new THREE.MeshLambertMaterial({ color: 0x2c4059 }),
      high: new THREE.MeshStandardMaterial({ color: 0x2c4059, roughness: 0.78, metalness: 0.15 })
    };
    this.underSlab = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_HALF_SIZE * 2, 0.7, ARENA_HALF_SIZE * 2),
      this.underSlabMats.medium
    );
    this.underSlab.position.set(0, -0.36, 0);
    this.underSlab.matrixAutoUpdate = false;
    this.underSlab.updateMatrix();
    this.arena1v1Group.add(this.underSlab);

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

    // Subtle corner glow markers flush on platform edge
    const cornerGeo = new THREE.BoxGeometry(0.55, 0.14, 0.55);
    const cornerMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    for (const cx of [-ARENA_HALF_SIZE + 0.2, ARENA_HALF_SIZE - 0.2]) {
      for (const cz of [-ARENA_HALF_SIZE + 0.2, ARENA_HALF_SIZE - 0.2]) {
        const cm = new THREE.Mesh(cornerGeo, cornerMat);
        cm.position.set(cx, 0.05, cz);
        cm.matrixAutoUpdate = false;
        cm.updateMatrix();
        this.arena1v1Group.add(cm);
      }
    }

    // 2. Central Arena Divider Line
    const centerLine = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF_SIZE * 2, 0.32),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55 })
    );
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.y = 0.015;
    centerLine.matrixAutoUpdate = false;
    centerLine.updateMatrix();
    this.arena1v1Group.add(centerLine);

    // 3. Physical Reset Arény Buttons (West & East inner zone — ONLY way to manually reset map)
    const pedGeo = new THREE.BoxGeometry(1.3, 1.35, 1.3);
    this.pedMats = {
      low: new THREE.MeshBasicMaterial({ color: 0x334155 }),
      medium: new THREE.MeshLambertMaterial({ color: 0x334155 }),
      high: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65, metalness: 0.22 })
    };
    this._structBasicMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    this._pedCustomStruct = false;
    this._btnCustomStruct = false;
    const btnGeo = new THREE.CylinderGeometry(0.46, 0.54, 0.36, 10);
    const btnMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
    const signGeo = new THREE.PlaneGeometry(1.75, 0.88);
    const signMat = new THREE.MeshBasicMaterial({ map: createResetSignTexture(), side: THREE.DoubleSide });
    const beaconGeo = new THREE.RingGeometry(0.9, 1.15, 14);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e, side: THREE.DoubleSide });

    this.pedMeshes = [];
    for (const rb of RESET_BUTTON_POSITIONS) {
      const grp = new THREE.Group();
      grp.position.set(rb.x, 0, rb.z);
      grp.matrixAutoUpdate = false;
      grp.updateMatrix();

      const ped = new THREE.Mesh(pedGeo, this.pedMats.medium);
      ped.position.y = 0.675;
      ped.matrixAutoUpdate = false;
      ped.updateMatrix();
      grp.add(ped);
      this.pedMeshes.push(ped);

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
        this._pedCustomStruct = true;
        const mat = this.currentQuality === 'low' ? this._structBasicMat : STRUCT_VERTEX_MAT;
        for (const ped of this.pedMeshes) {
          ped.geometry = pedGeoLoaded;
          ped.material = mat;
          ped.updateMatrix();
        }
      }
      const btnGeoLoaded = getStructureGeo('Reset_Button');
      if (btnGeoLoaded && btnGeoLoaded.attributes?.color) {
        this._btnCustomStruct = true;
        const mat = this.currentQuality === 'low' ? this._structBasicMat : STRUCT_VERTEX_MAT;
        for (const btn of this.resetBtnMeshes) {
          btn.geometry = btnGeoLoaded;
          btn.material = mat;
        }
      }
    });
  }

  _recreateRendererIfNeeded(wantAntialias) {
    const targetAA = Boolean(wantAntialias);
    if (targetAA === this._rendererAA) return false;

    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    if (this.dirLight.shadow.map) {
      this.dirLight.shadow.map.dispose();
      this.dirLight.shadow.map = null;
    }

    const oldCanvas = this.canvas;
    if (this.onContextMenu) {
      oldCanvas.removeEventListener('contextmenu', this.onContextMenu);
    }
    const newCanvas = document.createElement('canvas');
    newCanvas.id = oldCanvas.id || 'arena-canvas';
    newCanvas.className = oldCanvas.className;
    if (oldCanvas.parentElement) {
      oldCanvas.parentElement.insertBefore(newCanvas, oldCanvas);
    }
    oldCanvas.remove();
    this.canvas = newCanvas;
    if (this.onContextMenu) {
      this.canvas.addEventListener('contextmenu', this.onContextMenu);
    }

    this.renderer.dispose();
    this.renderer.forceContextLoss?.();

    this._rendererAA = targetAA;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: targetAA,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMappingExposure = 1.08;
    return true;
  }

  _getLowBasicFallbackMat(origMat) {
    if (!origMat || origMat.isMeshBasicMaterial || origMat.isShaderMaterial) return origMat;
    let basic = this._lowFallbackMats.get(origMat.uuid);
    if (!basic) {
      basic = new THREE.MeshBasicMaterial({
        color: origMat.color ? origMat.color.getHex() : 0xffffff,
        vertexColors: Boolean(origMat.vertexColors),
        transparent: Boolean(origMat.transparent),
        opacity: typeof origMat.opacity === 'number' ? origMat.opacity : 1,
        side: origMat.side ?? THREE.FrontSide
      });
      this._lowFallbackMats.set(origMat.uuid, basic);
    }
    return basic;
  }

  applyQuality(qualityKey) {
    const q = QUALITY_PRESETS[qualityKey] || QUALITY_PRESETS.medium;
    const tier = q.key;
    const isLow = tier === 'low';
    this.currentQuality = tier;

    const recreated = this._recreateRendererIfNeeded(q.antialias);
    const dpr = q.pixelRatio === 'auto' ? Math.min(q.pixelRatioCap, window.devicePixelRatio || 1) : q.pixelRatio;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = q.toneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    const targetShadowType = q.shadowMapType === 'pcfsoft' ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
    const shadowsChanged = this.renderer.shadowMap.enabled !== q.shadows;
    const shadowTypeChanged = this.renderer.shadowMap.type !== targetShadowType;
    const fogChanged = Boolean(this.scene.fog) !== Boolean(q.fog);
    const lightsChanged = this.dirLight.visible !== Boolean(q.lights);

    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = targetShadowType;
    this.renderer.shadowMap.needsUpdate = true;

    this.dirLight.castShadow = q.shadows;
    if (!q.shadows) {
      if (this.dirLight.shadow.map) {
        this.dirLight.shadow.map.dispose();
        this.dirLight.shadow.map = null;
      }
    } else if (this.dirLight.shadow.mapSize.width !== q.shadowMapSize || shadowTypeChanged || recreated) {
      this.dirLight.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      if (this.dirLight.shadow.map) {
        this.dirLight.shadow.map.dispose();
        this.dirLight.shadow.map = null;
      }
    }

    this.hemiLight.visible = Boolean(q.lights);
    this.dirLight.visible = Boolean(q.lights);
    this.muzzleLight.visible = tier === 'high';
    if (tier !== 'high') {
      this.muzzleLight.intensity = 0;
      this.muzzleLightTimer = 0;
    }

    this.camera.far = q.far;
    this.camera.updateProjectionMatrix();

    this.skyDome.visible = Boolean(q.skybox);
    this.scene.background.setHex(q.skybox ? 0xd2e6f5 : 0x87ceeb);
    if (q.skybox) {
      this.skyDome.scale.setScalar(q.far * 0.88);
      this.skyDome.updateMatrix();
    }

    this._fogExp2.density = q.fogDensity * (this.mode === 'br' ? 0.72 : 1.0);
    this.scene.fog = q.fog ? this._fogExp2 : null;
    this.sceneryGroup.visible = Boolean(q.decorations);

    this.arenaFloor.material = this.floorMats[tier];
    this.arenaFloor.receiveShadow = q.shadows;
    this.arenaFloor.material.needsUpdate = true;
    this.underSlab.material = this.underSlabMats[tier];
    this.underSlab.material.needsUpdate = true;

    for (let i = 0; i < this.pedMeshes.length; i++) {
      const ped = this.pedMeshes[i];
      ped.material = this._pedCustomStruct ? (isLow ? this._structBasicMat : STRUCT_VERTEX_MAT) : this.pedMats[tier];
      ped.material.needsUpdate = true;
    }
    if (this._btnCustomStruct) {
      for (let i = 0; i < this.resetBtnMeshes.length; i++) {
        this.resetBtnMeshes[i].material = isLow ? this._structBasicMat : STRUCT_VERTEX_MAT;
        this.resetBtnMeshes[i].material.needsUpdate = true;
      }
    }

    this.pools.setEffectsEnabled(q.particles, q.tracers);
    this.pools.setParticleScale(q.particleScale);
    this.buildings.setQuality(tier);
    this.mapManager.setQuality(tier);
    this.localRig.setQualityTier(tier);
    this.dummyTarget.rig.setQualityTier(tier);
    this.onlineOpponent.rig.setQualityTier(tier);
    this.bot.setQuality(tier);
    this.br.setQuality(tier);

    const needMatRecompile = recreated || shadowsChanged || shadowTypeChanged || fogChanged || lightsChanged;
    this.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (!q.shadows) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
      if (isLow) {
        if (!o.userData._origHiMat && o.parent !== this.sceneryGroup) {
          if (Array.isArray(o.material)) {
            if (o.material.some((m) => m && !m.isMeshBasicMaterial && !m.isShaderMaterial)) {
              o.userData._origHiMat = o.material;
              o.material = o.material.map((m) => this._getLowBasicFallbackMat(m));
            }
          } else if (!o.material.isMeshBasicMaterial && !o.material.isShaderMaterial) {
            o.userData._origHiMat = o.material;
            o.material = this._getLowBasicFallbackMat(o.material);
          }
        }
      } else if (o.userData._origHiMat) {
        o.material = o.userData._origHiMat;
        delete o.userData._origHiMat;
      }
      if (needMatRecompile) {
        if (Array.isArray(o.material)) {
          for (let i = 0; i < o.material.length; i++) {
            if (o.material[i]) o.material[i].needsUpdate = true;
          }
        } else {
          o.material.needsUpdate = true;
        }
      }
    });

    if (this.running) {
      this.renderer.render(this.scene, this.camera);
      this._pushHudState();
    }
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
      const wasLocked = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (this.pointerLocked) {
        this.fallbackAim = false;
      } else if (wasLocked) {
        this.lastUnlockTime = performance.now();
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
      if (!this.running) return;
      if (performance.now() - this.lastUnlockTime >= 1600) {
        this.fallbackAim = true;
      }
      this._pushHudState();
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

      if (this.emoteWheelOpen) {
        this.emoteCursorX += dx * 0.85;
        this.emoteCursorY += dy * 0.85;
        const dist = Math.hypot(this.emoteCursorX, this.emoteCursorY);
        if (dist > 105) {
          const s = 105 / dist;
          this.emoteCursorX *= s;
          this.emoteCursorY *= s;
        }
        this.hoveredEmoteId = this._getEmoteFromCoords(this.emoteCursorX, this.emoteCursorY);
        if (this.ui.onEmoteWheelMove) {
          this.ui.onEmoteWheelMove(this.hoveredEmoteId, this.emoteCursorX, this.emoteCursorY);
        }
        return;
      }

      const isADS = this._isADS();
      const activeW = this.weapons.getWeapon();
      let adsMult = 1.0;
      if (isADS) {
        adsMult = (activeW.id === 'sniper' && this.sniperScopeLevel >= 2)
          ? (activeW.adsSensMult2 || 0.22)
          : (activeW.adsSensMult || 0.72);
      }
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
      if (this.emoteWheelOpen) {
        if (e.target !== this.canvas && e.target.closest?.('#emote-wheel, #hud-emote-btn')) {
          return;
        }
        if (e.button === 0) {
          this.closeEmoteWheel(true);
        } else if (e.button === 2) {
          this.closeEmoteWheel(false);
        }
        return;
      }
      if (!this.pointerLocked && !this.fallbackAim) {
        if (!this.paused && e.target === this.canvas) {
          this.requestLock();
          // Also allow seamless fallback aim if browser blocks pointer lock after click
          if (e.button === 2) {
            if (!this.editState.active && !this.activeBuildType && this.weapons.getWeapon().id === 'sniper') {
              this._toggleSniperScope();
            } else {
              this.mouseDownRight = true;
              this._pushHudState();
            }
          }
        }
        return;
      }
      if (this.paused || e.target !== this.canvas) return;
      if (this.activeEmote) {
        this.cancelEmote();
      }
      if (e.button === 1 || e.button === 3 || e.button === 4) {
        e.preventDefault();
        const mouseCode = e.button === 1 ? 'Mouse3' : (e.button === 3 ? 'Mouse4' : 'Mouse5');
        this.keys.add(mouseCode);
        this._triggerKeybindAction(mouseCode, false);
        return;
      }
      if (e.button === 0) {
        this.mouseDownLeft = true;
        this._handlePrimaryAction(true);
      } else if (e.button === 2) {
        if (this.editState.active) {
          this.mouseDownRight = true;
          this._resetCurrentEdit();
        } else if (this.activeBuildType) {
          this.mouseDownRight = true;
          if (this.mode === 'online' && this.localSlot !== 0) {
            if (this.ui.onBanner) this.ui.onBanner(t('banner_host_mat_only'), 'info');
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
        } else if (this.weapons.getWeapon().id === 'sniper') {
          this.mouseDownRight = false;
          this._toggleSniperScope();
        } else {
          this.mouseDownRight = true;
          this._pushHudState();
        }
      }
    };
    window.addEventListener('mousedown', this.onMouseDown);

    this.onAuxClick = (e) => {
      if (this.running && (e.button === 1 || e.button === 3 || e.button === 4)) {
        e.preventDefault();
      }
    };
    window.addEventListener('auxclick', this.onAuxClick);

    this.onMouseUp = (e) => {
      if (e.button === 0) this.mouseDownLeft = false;
      if (e.button === 2) {
        this.mouseDownRight = false;
        if (this.running) this._pushHudState();
      }
      if (e.button === 1 || e.button === 3 || e.button === 4) {
        const mouseCode = e.button === 1 ? 'Mouse3' : (e.button === 3 ? 'Mouse4' : 'Mouse5');
        this.keys.delete(mouseCode);
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
        if (this.emoteWheelOpen) {
          this.closeEmoteWheel(false);
          return;
        }
        if (this.editState.active) {
          this.editState.active = false;
          this.editState.buildKey = null;
          this.buildings.hideEditOverlay();
          this._pushHudState();
          return;
        }
        if (performance.now() - this.lastUnlockTime < 140) {
          return;
        }
        if (this.paused) {
          this.setPaused(false);
          this.requestLock();
          this._pushHudState();
        } else if (!this.pointerLocked) {
          this.setPaused(true);
          this._pushHudState();
        }
        return;
      }

      if (this.paused) return;

      if (code === 'Tab' || code === 'Space') {
        e.preventDefault();
      }

      this._triggerKeybindAction(code, e.repeat);
    };
    window.addEventListener('keydown', this.onKeyDown);

    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
      const kb = this._getKeybinds();
      if (e.code === kb.emote && this.emoteWheelOpen) {
        const heldMs = performance.now() - this.emoteKeyDownTs;
        if (heldMs >= 220 && this.emoteKeyDownTs > 0) {
          this.closeEmoteWheel(Boolean(this.hoveredEmoteId));
        }
      }
    };
    window.addEventListener('keyup', this.onKeyUp);

    this.onWheel = (e) => {
      if (!this.running || !this.pointerLocked || this.paused || this.emoteWheelOpen) return;
      if (this.activeEmote) this.cancelEmote();
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

  _getKeybinds() {
    return storage.get().keybinds || DEFAULT_KEYBINDS;
  }

  _isBindDown(bindCode) {
    if (!bindCode) return false;
    if (this.keys.has(bindCode)) return true;
    if (bindCode === 'ShiftLeft' && this.keys.has('ShiftRight')) return true;
    if (bindCode === 'ControlLeft' && this.keys.has('ControlRight')) return true;
    return false;
  }

  _triggerKeybindAction(code, isRepeat = false) {
    if (!code || this.paused) return;
    const kb = this._getKeybinds();

    if (code === kb.emote && !isRepeat) {
      if (this.emoteWheelOpen) {
        this.closeEmoteWheel(false);
      } else {
        this.openEmoteWheel(true);
      }
      return;
    }

    if (this.emoteWheelOpen) {
      if ((code === 'Digit1' || code === kb.slot1) && EMOTES[0]) { this.triggerEmote(EMOTES[0].id); return; }
      if ((code === 'Digit2' || code === kb.slot2) && EMOTES[1]) { this.triggerEmote(EMOTES[1].id); return; }
      if ((code === 'Digit3' || code === kb.slot3) && EMOTES[2]) { this.triggerEmote(EMOTES[2].id); return; }
    }

    if (code === kb.slot1) this._selectWeapon(0);
    else if (code === kb.slot2) this._selectWeapon(1);
    else if (code === kb.slot3) this._selectWeapon(2);
    else if (code === 'Digit7' && this.mode === 'bot') this.setBotDifficulty('easy');
    else if (code === 'Digit8' && this.mode === 'bot') this.setBotDifficulty('medium');
    else if (code === 'Digit9' && this.mode === 'bot') this.setBotDifficulty('hard');
    else if (code === 'Digit0' && this.mode === 'bot') this.setBotDifficulty('extreme');
    else if (code === kb.buildWall) this._toggleBuildType(BUILD_TYPES.WALL);
    else if (code === kb.buildFloor) this._toggleBuildType(BUILD_TYPES.FLOOR);
    else if (code === kb.buildRamp) this._toggleBuildType(BUILD_TYPES.RAMP);
    else if (code === kb.buildToggle) this._toggleBuildMode();
    else if (code === kb.edit) this._handleEditKey();
    else if (code === kb.reload && !isRepeat) {
      if (this.localPlayer.alive && !this.activeBuildType && !this.editState.active && !this.activeEmote) {
        if (this.weapons.startReload(audio)) {
          this.sniperScopeLevel = 0;
          this._pushHudState();
        }
      }
    } else if (code === kb.respawn && !isRepeat) {
      this.triggerLocalRespawn();
    } else if (code === kb.interact) {
      if (!this._tryPickupNearbyWeapon()) {
        this._checkNearbyResetButton();
      }
    } else if (code === kb.jump) {
      if (this.activeEmote) this.cancelEmote();
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
      this.onlineOpponent.targetVx = state.vx || 0;
      this.onlineOpponent.targetVz = state.vz || 0;
      this.onlineOpponent.lastUpdateTime = this.time;
      this.onlineOpponent.targetYaw = state.yaw;
      this.onlineOpponent.targetPitch = state.pitch;
      this.onlineOpponent.crouch = Boolean(state.crouch);
      this.onlineOpponent.slot = state.slot || 0;
      this.onlineOpponent.weaponId = state.weaponId || null;
      this.onlineOpponent.buildMode = state.buildMode || null;
      this.onlineOpponent.reloading = Boolean(state.reloading);
      this.onlineOpponent.reloadProgress = Number(state.reloadProgress) || 0;
      const nextEmote = state.emote || null;
      if (nextEmote !== this.onlineOpponent.emote) {
        this.onlineOpponent.emote = nextEmote;
        this.onlineOpponent.emoteTime = 0;
        if (!this.activeEmote) {
          if (nextEmote) {
            const dist = this.localPlayer.pos.distanceTo(this.onlineOpponent.pos);
            if (dist < 36) {
              audio.playEmoteStart(nextEmote, Math.max(0.18, 1 - dist / 36));
            }
          } else {
            audio.stopEmoteMusic();
          }
        }
      }
      if (typeof state.emoteYaw === 'number') {
        this.onlineOpponent.emoteYaw = state.emoteYaw;
      }
      if (state.swing > this.onlineOpponent.swingPhase) {
        this.onlineOpponent.swingPhase = state.swing;
      }
      this.onlineOpponent.speed = Math.hypot(state.vx || 0, state.vz || 0);
      this.onlineOpponent.rig.setWeapon(this.onlineOpponent.slot, Boolean(this.onlineOpponent.buildMode), this.onlineOpponent.weaponId);
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
      const w = WEAPON_CATALOG[data.weapon] || WEAPONS[1];
      if (w.id !== 'pickaxe') {
        this.onlineOpponent.rig.triggerMuzzleFlash(w.slot, w.id);
        this.pools.spawnTracer(ox, oy, oz, ex, ey, ez, w.tracerColor);
        this.pools.spawnSparks(ex, ey, ez, 5, 0xfacc15, 6.2);
        this.pools.spawnImpactFlash(ex, ey, ez, 0xfff3b0, 0.85);
      }
      const dist = this.localPlayer.pos.distanceTo(this.onlineOpponent.pos);
      const atten = Math.max(0.12, 1 - dist / 55);
      if (w.id === 'shotgun') audio.playShotgun(atten);
      else if (w.id === 'smg') audio.playSMG(atten);
      else if (w.id === 'ar') audio.playAR(atten);
      else if (w.id === 'sniper') audio.playSniper(atten);
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
          ? (victimIsMe ? t('banner_fell_you_opp') : t('banner_fell_opp', { name: this.onlineOpponent.name }))
          : (victimIsMe ? t('banner_you_eliminated') : t('banner_elim_bot', { name: this.onlineOpponent.name }));
        this.ui.onBanner(msg, victimIsMe ? 'danger' : 'success');
      }
      this._pushHudState();
    });

    network.on('match_material_update', (data) => {
      if (this.mode !== 'online' || !data?.buildMat) return;
      this.matchBuildMat = data.buildMat;
      this.localPlayer.buildMat = data.buildMat;
      if (this.ui.onBanner) {
        this.ui.onBanner(t('banner_mat_changed', { mat: getMaterialName(data.buildMat) }), 'info');
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
      this._applyLocalArenaReset(data?.byName || t('default_player_fallback'));
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
      this._applyLocalArenaReset(null, t('banner_next_round'));
    };
    network.on('vramp_next_round', handleOnlineRoundRestart);
    network.on('round_restart', handleOnlineRoundRestart);

    network.on('player_joined', (data) => {
      if (this.mode !== 'online' || !data?.player) return;
      this._applyOnlineOpponentRecord(data.player);
      if (this.ui.onBanner) {
        this.ui.onBanner(t('banner_opp_joined', { name: this.onlineOpponent.name }), 'info');
      }
      this._pushHudState();
    });

    network.on('opponent_left', (data) => {
      if (this.mode !== 'online') return;
      this.onlineOpponent.id = null;
      this.onlineOpponent.name = t('round_waiting');
      this.onlineOpponent.rig.root.visible = false;
      this.onlineOpponent.alive = false;
      if (this.ui.onBanner) {
        this.ui.onBanner(t('banner_opp_left', { name: data?.name || t('hud_opp') }), 'warning');
      }
      this._pushHudState();
    });
  }

  _applyOnlineOpponentRecord(rec) {
    this.onlineOpponent.id = rec.id;
    this.onlineOpponent.name = rec.name || t('hud_opp');
    this.onlineOpponent.skinId = rec.skinId || 'crimson';
    this.onlineOpponent.buildMat = this.matchBuildMat || rec.buildMat || 'wood';
    this.onlineOpponent.hp = typeof rec.hp === 'number' ? rec.hp : 100;
    this.onlineOpponent.shield = typeof rec.shield === 'number' ? rec.shield : 100;
    this.onlineOpponent.kills = rec.kills || 0;
    this.onlineOpponent.alive = rec.alive !== false;
    const sp = this.mapManager.spawnPoints[rec.slot === 0 ? 0 : 1] || this.mapManager.spawnPoints[1];
    this.onlineOpponent.pos.set(sp.x, sp.y, sp.z);
    this.onlineOpponent.targetPos.set(sp.x, sp.y, sp.z);
    this.onlineOpponent.targetVx = 0;
    this.onlineOpponent.targetVz = 0;
    this.onlineOpponent.lastUpdateTime = this.time;
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
    this.crosshairRecoil = 0;
    this.lastCrosshairGap = -1;
    this.sniperScopeLevel = 0;
    this._wasReloadHud = false;
    this.activeEmote = null;
    this.emoteTime = 0;
    this.emoteWheelOpen = false;
    audio.stopEmoteMusic();
    this.emoteCursorX = 0;
    this.emoteCursorY = 0;
    this.hoveredEmoteId = null;
    if (this.ui.onEmoteWheelChange) this.ui.onEmoteWheelChange(false, null, 0, 0);

    this.mapManager.loadMap(this.mapId);
    this.buildings.clearAll(false);
    this.pools.clearAll();
    this.weapons.resetDefaultLoadout();
    this.weapons.slot = 0;
    this.activeBuildType = null;
    this.editState.active = false;
    this.buildings.hideEditOverlay();
    this.keys.clear();
    this.mouseDownLeft = false;
    this.mouseDownRight = false;

    const isBR = this.mode === 'br';
    this.arena1v1Group.visible = !isBR;
    this.resetButtonsGroup.visible = !isBR;
    if (this.distantOcean1v1) this.distantOcean1v1.visible = !isBR;
    this.sceneryGroup.scale.setScalar(isBR ? 1.52 : 1.0);
    this.sceneryGroup.updateMatrix();
    this.hemiLight.groundColor.setHex(isBR ? 0x4d8c7a : 0x5882bd);
    if (!isBR) {
      this.dirLight.target.position.set(0, 0, 0);
      this.dirLight.target.updateMatrixWorld();
      this.dirLight.position.set(34, 48, 26);
    }
    this.muzzleLight.intensity = 0;
    this.muzzleLightTimer = 0;
    const s = storage.get();
    const activeQ = QUALITY_PRESETS[s.quality] || QUALITY_PRESETS.medium;
    this._fogExp2.density = activeQ.fogDensity * (isBR ? 0.72 : 1.0);
    this.scene.fog = activeQ.fog ? this._fogExp2 : null;
    this.moveVel.x = 0;
    this.moveVel.z = 0;

    const sharedMat = (mode === 'online' && matchBuildMat) ? matchBuildMat : s.buildMat;
    this.matchBuildMat = sharedMat;
    this.localPlayer.name = s.playerName;
    this.localPlayer.skinId = s.skinId;
    this.localPlayer.buildMat = sharedMat;
    this.localPlayer.kills = 0;
    this.localRig.setSkin(s.skinId);
    this.localRig.setWeapon(0, false, this.weapons.getWeapon(0).id);

    if (isBR) {
      const dropSpawn = this.br.startMatch(this.mapManager, brPreset || 'balanced', activeQ.shadows, activeQ.key);
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
        this.onlineOpponent.name = t('round_waiting');
        this.onlineOpponent.rig.root.visible = false;
      }
      for (const b of existingBuilds) {
        this.buildings.placeBuild(b, null, true);
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
      this.rafId = requestAnimationFrame(this._boundLoop);
    }
  }

  releaseSessionResources() {
    this.buildings.clearAll(false);
    this.pools.clearAll();
    this.mapManager.unloadMap();
    this.br.setActive(false);
    this.dummyTarget.rig.root.visible = false;
    this.bot.rig.root.visible = false;
    this.onlineOpponent.rig.root.visible = false;
    this.muzzleLight.intensity = 0;
    this.muzzleLightTimer = 0;
    if (this.dirLight.shadow.map) {
      this.dirLight.shadow.map.dispose();
      this.dirLight.shadow.map = null;
    }
  }

  stopSession() {
    this.running = false;
    this.paused = false;
    this.mouseDownLeft = false;
    this.mouseDownRight = false;
    this.sniperScopeLevel = 0;
    this._wasReloadHud = false;
    if (this.ui.onReloadProgress) this.ui.onReloadProgress(false, 0, 0);
    this.localRig.root.visible = true;
    this.activeEmote = null;
    this.emoteTime = 0;
    this.emoteWheelOpen = false;
    audio.stopEmoteMusic();
    if (this.ui.onEmoteWheelChange) this.ui.onEmoteWheelChange(false, null, 0, 0);
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.releaseSessionResources();
  }

  dispose() {
    this.stopSession();
    if (this.unsubStorage) this.unsubStorage();
    if (this._unsubResetStructures) this._unsubResetStructures();

    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('auxclick', this.onAuxClick);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('wheel', this.onWheel);

    this.buildings.dispose();
    this.mapManager.dispose();
    this.pools.dispose();
    this.br.dispose();
    this.bot.dispose(this.scene);
    this.localRig.dispose();
    this.dummyTarget.rig.dispose();
    this.onlineOpponent.rig.dispose();

    const disposeGroup = (grp) => {
      if (!grp) return;
      grp.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i];
          if (!m || m === STRUCT_VERTEX_MAT || m === this._structBasicMat) continue;
          if (m.map && m.map === this.floorMats?.medium?.map) continue;
          m.dispose?.();
        }
      });
    };
    disposeGroup(this.skyDome);
    disposeGroup(this.sceneryGroup);
    disposeGroup(this.arena1v1Group);
    disposeGroup(this.resetButtonsGroup);

    if (this.floorMats) Object.values(this.floorMats).forEach((m) => m.dispose());
    if (this.underSlabMats) Object.values(this.underSlabMats).forEach((m) => m.dispose());
    if (this.pedMats) Object.values(this.pedMats).forEach((m) => m.dispose());
    this._structBasicMat?.dispose();
    for (const m of this._lowFallbackMats.values()) m.dispose();
    this._lowFallbackMats.clear();

    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }

  requestLock() {
    if (!this.running) return;
    this.lastPointerX = null;
    this.lastPointerY = null;
    this.fallbackAim = false;
    if (document.pointerLockElement !== this.canvas && this.canvas.requestPointerLock) {
      try {
        const res = this.canvas.requestPointerLock();
        if (res && typeof res.catch === 'function') {
          res.catch(() => {
            if (performance.now() - this.lastUnlockTime >= 1600) {
              this.fallbackAim = true;
            }
            this._pushHudState();
          });
        }
      } catch {
        if (performance.now() - this.lastUnlockTime >= 1600) {
          this.fallbackAim = true;
        }
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
      this.sniperScopeLevel = 0;
      this.closeEmoteWheel(false);
      this.cancelEmote();
      audio.stopEmoteMusic();
    }
    if (this.ui.onPauseChange) this.ui.onPauseChange(paused);
  }

  _respawnLocal(spawn = null) {
    this.activeEmote = null;
    this.emoteTime = 0;
    this.sniperScopeLevel = 0;
    this._wasReloadHud = false;
    if (this.ui.onReloadProgress) this.ui.onReloadProgress(false, 0, 0);
    this.closeEmoteWheel(false);
    audio.stopEmoteMusic();
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
      this.ui.onBanner(t('banner_bot_diff', { diff: getBotDiffLabel(diffId) }), 'info');
    }
    this._pushHudState();
  }

  _getEmoteFromCoords(dx, dy) {
    if (Math.hypot(dx, dy) < 18) return null;
    const deg = Math.atan2(dy, dx) * (180 / Math.PI);
    if (deg >= -150 && deg < -30) return EMOTES[0]?.id || 'take_l';
    if (deg >= -30 && deg < 90) return EMOTES[1]?.id || 'floss';
    return EMOTES[2]?.id || 'gg';
  }

  openEmoteWheel(fromKey = false) {
    if (!this.running || this.paused || !this.localPlayer.alive || this.editState.active || this.countdownTimer > 0) return;
    if (this.mode === 'br' && this.br.gliding) return;
    if (this.emoteWheelOpen) return;
    this.sniperScopeLevel = 0;
    this.emoteWheelOpen = true;
    this.emoteKeyDownTs = fromKey ? performance.now() : 0;
    this.emoteCursorX = 0;
    this.emoteCursorY = 0;
    this.hoveredEmoteId = null;
    this.mouseDownLeft = false;
    this.mouseDownRight = false;
    if (this.ui.onEmoteWheelChange) this.ui.onEmoteWheelChange(true, null, 0, 0);
    this._pushHudState();
  }

  closeEmoteWheel(triggerSelected = false) {
    if (!this.emoteWheelOpen) return;
    const chosen = triggerSelected ? this.hoveredEmoteId : null;
    this.emoteWheelOpen = false;
    this.emoteCursorX = 0;
    this.emoteCursorY = 0;
    this.hoveredEmoteId = null;
    if (chosen) {
      this.triggerEmote(chosen);
      return;
    }
    if (this.ui.onEmoteWheelChange) this.ui.onEmoteWheelChange(false, null, 0, 0);
    this._pushHudState();
  }

  triggerEmote(emoteId) {
    const def = EMOTES.find((e) => e.id === emoteId);
    if (!def || !this.running || this.paused || !this.localPlayer.alive || this.countdownTimer > 0) return;
    this.activeBuildType = null;
    if (this.editState.active) {
      this.editState.active = false;
      this.buildings.hideEditOverlay();
    }
    this.activeEmote = def.id;
    this.emoteTime = 0;
    this.emoteDuration = def.duration || 8.0;
    this.emoteYaw = this.localPlayer.yaw;
    if (this.emoteWheelOpen) {
      this.emoteWheelOpen = false;
      this.emoteCursorX = 0;
      this.emoteCursorY = 0;
      this.hoveredEmoteId = null;
    }
    if (this.ui.onEmoteWheelChange) this.ui.onEmoteWheelChange(false, null, 0, 0);
    audio.playEmoteStart(def.id);
    this._pushHudState();
  }

  cancelEmote() {
    if (!this.activeEmote) return;
    this.activeEmote = null;
    this.emoteTime = 0;
    audio.stopEmoteMusic();
    this.localRig.setWeapon(this.weapons.slot, Boolean(this.activeBuildType), this.weapons.getWeapon().id);
    this._pushHudState();
  }

  _getLocalCombatTargets() {
    if (this.mode === 'br') {
      return this.br.getCombatTargets(false, this.localPlayer);
    }
    const targets = this._fireTargets;
    targets.length = 0;
    if (this.mode === 'bot' && this.bot.alive && !isPlayerProtected(this.bot.pos, this.mapId)) {
      this._singleTarget.id = 'bot';
      this._singleTarget.pos = this.bot.pos;
      this._singleTarget.crouch = this.bot.crouch;
      this._singleTarget.alive = true;
      targets.push(this._singleTarget);
    } else if (this.mode === 'solo' && this.dummyTarget.alive && !isPlayerProtected(this.dummyTarget.pos, this.mapId)) {
      this._singleTarget.id = 'dummy';
      this._singleTarget.pos = this.dummyTarget.pos;
      this._singleTarget.crouch = false;
      this._singleTarget.alive = true;
      targets.push(this._singleTarget);
    } else if (this.mode === 'online' && this.onlineOpponent.alive && this.onlineOpponent.id && !isPlayerProtected(this.onlineOpponent.pos, this.mapId)) {
      this._singleTarget.id = this.onlineOpponent.id;
      this._singleTarget.pos = this.onlineOpponent.pos;
      this._singleTarget.crouch = this.onlineOpponent.crouch;
      this._singleTarget.alive = true;
      targets.push(this._singleTarget);
    }
    return targets;
  }

  _toggleSniperScope() {
    if (!this.localPlayer.alive || this.paused || this.emoteWheelOpen || this.editState.active || this.activeBuildType) return false;
    const w = this.weapons.getWeapon();
    if (w.id !== 'sniper' || this.weapons.reloading || this.countdownTimer > 0) return false;
    this.cancelEmote();

    const prevLevel = this.sniperScopeLevel;
    const nextLevel = (prevLevel + 1) % 3;
    const eyeH = this.localPlayer.crouch ? PLAYER_EYE_CROUCH : PLAYER_EYE_STAND;
    const eyeY = this.camState.smoothPosY + eyeH + this.camState.landDip;

    if (prevLevel === 0 && nextLevel === 1) {
      // Align scoped eye-ray onto the exact 3D point under the 3P hipfire crosshair
      this._computeCameraRay();
      const eyeDepth =
        (this.localPlayer.pos.x - this._camOrigin.x) * this._camDir.x +
        (eyeY - this._camOrigin.y) * this._camDir.y +
        (this.localPlayer.pos.z - this._camOrigin.z) * this._camDir.z;
      const startT = Math.max(0.2, eyeDepth - 0.15);
      raycastArena(
        this._camOrigin.x + this._camDir.x * startT,
        this._camOrigin.y + this._camDir.y * startT,
        this._camOrigin.z + this._camDir.z * startT,
        this._camDir.x, this._camDir.y, this._camDir.z,
        w.range || 165,
        this.buildings,
        this._getLocalCombatTargets(),
        _camRayHit,
        this.mapManager
      );
      const dx = _camRayHit.x - this.localPlayer.pos.x;
      const dy = _camRayHit.y - eyeY;
      const dz = _camRayHit.z - this.localPlayer.pos.z;
      const horiz = Math.hypot(dx, dz) || 1e-6;
      const scopedYaw = Math.atan2(-dx, -dz);
      const scopedPitch = Math.max(-1.38, Math.min(1.38, Math.atan2(dy, horiz)));

      this.camState.targetYaw = scopedYaw;
      this.camState.renderYaw = scopedYaw;
      this.camState.targetPitch = scopedPitch;
      this.camState.renderPitch = scopedPitch;
      this.localPlayer.yaw = scopedYaw;
      this.localPlayer.pitch = scopedPitch;
      this.camState.right = 0;
      this.camState.up = this.camState.landDip;
      this.camState.dist = 0.02;
      this.camState.actualDist = 0.02;
    } else if (prevLevel > 0 && nextLevel === 0) {
      // Keep 3P hipfire crosshair centered on the point the scope was aiming at
      this._computeCameraRay();
      raycastArena(
        this._camOrigin.x, this._camOrigin.y, this._camOrigin.z,
        this._camDir.x, this._camDir.y, this._camDir.z,
        w.range || 165,
        this.buildings,
        this._getLocalCombatTargets(),
        _camRayHit,
        this.mapManager
      );
      let uy = this.camState.renderYaw;
      for (let i = 0; i < 2; i++) {
        const px = this.localPlayer.pos.x + Math.cos(uy) * 0.88;
        const pz = this.localPlayer.pos.z - Math.sin(uy) * 0.88;
        uy = Math.atan2(-(_camRayHit.x - px), -(_camRayHit.z - pz));
      }
      const px = this.localPlayer.pos.x + Math.cos(uy) * 0.88;
      const pz = this.localPlayer.pos.z - Math.sin(uy) * 0.88;
      const py = eyeY + 0.25;
      const horiz = Math.hypot(_camRayHit.x - px, _camRayHit.z - pz) || 1e-6;
      const upitch = Math.max(-1.38, Math.min(1.38, Math.atan2(_camRayHit.y - py, horiz)));

      this.camState.targetYaw = uy;
      this.camState.renderYaw = uy;
      this.camState.targetPitch = upitch;
      this.camState.renderPitch = upitch;
      this.localPlayer.yaw = uy;
      this.localPlayer.pitch = upitch;
    }

    this.sniperScopeLevel = nextLevel;
    audio.playScopeToggle(this.sniperScopeLevel);
    this._pushHudState();
    return true;
  }

  _selectWeapon(slot) {
    this.cancelEmote();
    this.sniperScopeLevel = 0;
    this.activeBuildType = null;
    if (this.editState.active) {
      this.editState.active = false;
      this.buildings.hideEditOverlay();
    }
    this.weapons.switchSlot(slot);
    this.localRig.setWeapon(slot, false, this.weapons.getWeapon(slot).id);
    this._pushHudState();
  }

  _toggleBuildType(type, forceOn = false) {
    this.cancelEmote();
    this.sniperScopeLevel = 0;
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
    this.localRig.setWeapon(this.weapons.slot, Boolean(this.activeBuildType), this.weapons.getWeapon().id);
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
    this.cancelEmote();
    this.sniperScopeLevel = 0;

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
        if (this.ui.onBanner) this.ui.onBanner(t('banner_edit_own_only'), 'warning');
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
    const w = this.weapons.getWeapon();
    if (!isInitialClick && !w.auto) return;
    this._fireLocalWeapon();
  }

  _isLocalInSpawnBox() {
    return isInsideSpawnBox(this.localPlayer.pos, this.mapId);
  }

  _isLocalProtected() {
    return isPlayerProtected(this.localPlayer.pos, this.mapId);
  }

  _getNearbyWeaponPickup() {
    if (this.mapId !== 'skybox' || !this.mapManager.weaponPickups || !this.localPlayer.alive) return null;
    if (this.localPlayer.pos.y < 12.6) return null;
    let bestId = null;
    let bestDistSq = 2.35 * 2.35;
    const px = this.localPlayer.pos.x;
    const pz = this.localPlayer.pos.z;
    for (let i = 0; i < this.mapManager.weaponPickups.length; i++) {
      const p = this.mapManager.weaponPickups[i];
      const dSq = (px - p.x) * (px - p.x) + (pz - p.z) * (pz - p.z);
      if (dSq <= bestDistSq) {
        bestDistSq = dSq;
        bestId = p.id;
      }
    }
    return bestId;
  }

  _tryPickupNearbyWeapon() {
    const weaponId = this._getNearbyWeaponPickup();
    if (!weaponId) return false;
    this.sniperScopeLevel = 0;
    this.activeBuildType = null;
    if (this.editState.active) {
      this.editState.active = false;
      this.buildings.hideEditOverlay();
    }
    const res = this.weapons.equipWeapon(weaponId);
    if (!res.changed) return false;
    this.localRig.setWeapon(res.slot, false, res.weapon.id);
    audio.playWeaponPickup();
    if (this.ui.onBanner) {
      this.ui.onBanner(t('banner_weapon_equipped', { weapon: res.weapon.name, slot: res.slot + 1 }), 'info');
    }
    this._pushHudState();
    return true;
  }

  _isLocalDropLocked() {
    return this.mode === 'br' && this.localPlayer.gliding && this.localPlayer.pos.y > 4.5;
  }

  _tryPlaceLocalBuild() {
    if (this.countdownTimer > 0) return;
    if (this._isLocalProtected() || this._isLocalDropLocked()) return;
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

    const rec = this._localBuildData;
    rec.type = placement.type;
    rec.gx = placement.gx;
    rec.gy = placement.gy;
    rec.gz = placement.gz;
    rec.dir = placement.dir;
    rec.rot = placement.rot;
    rec.key = placement.key;
    rec.id = placement.key;
    rec.mat = matId;
    rec.hp = matInfo.hp;
    rec.maxHp = matInfo.hp;
    rec.mask = getDefaultMask(placement.type);
    rec.ownerId = ownerId;

    const placed = this.buildings.placeBuild(rec, this._playBuildSound);
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
    if (this.countdownTimer > 0 || this._isLocalProtected() || this._isLocalDropLocked()) return;
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
    const activeW = this.weapons.getWeapon();
    if (this.weapons.slot !== 2) {
      this.localRig.root.position.copy(this.localPlayer.pos);
      this.localRig.root.rotation.y = this.localPlayer.yaw;
      this.localRig.getMuzzleWorldPosition(this._tmpVec, this.weapons.slot, activeW.id);
      if (this._tmpVec.distanceToSquared(this._eyeOrigin) <= 4.0) {
        this._muzzleOrigin.copy(this._tmpVec);
      }
    }

    const targets = this._getLocalCombatTargets();

    this._fireOpts.isADS = this._isADS();
    this._fireOpts.targets = targets;
    const result = this.weapons.tryFire(this._fireOpts);

    if (result && result.fired) {
      if (result.weaponId === 'sniper') {
        this.sniperScopeLevel = 0;
      }
      this.crosshairRecoil = result.weaponId === 'sniper' ? 1.15 : (result.weaponId === 'shotgun' ? 1.0 : (result.weaponId === 'ar' ? 0.55 : (result.weaponId === 'smg' ? 0.42 : 0.3)));
      if (result.weaponId !== 'pickaxe') {
        this.localRig.triggerMuzzleFlash(this.weapons.slot, result.weaponId);
        if (this.currentQuality === 'high') {
          this.muzzleLight.position.copy(this._muzzleOrigin);
          this.muzzleLight.intensity = 3.2;
          this.muzzleLightTimer = 0.065;
        }
      }
      if (this.mode === 'online') {
        this._shootFxOrigin[0] = this._muzzleOrigin.x;
        this._shootFxOrigin[1] = this._muzzleOrigin.y;
        this._shootFxOrigin[2] = this._muzzleOrigin.z;
        this._shootFxEnd[0] = result.endX;
        this._shootFxEnd[1] = result.endY;
        this._shootFxEnd[2] = result.endZ;
        this._shootFxPayload.weapon = result.weaponId;
        network.sendShootFx(this._shootFxPayload);
      }
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

  triggerLocalRespawn() {
    if (this.respawnKeyCooldown > 0 || this.countdownTimer > 0 || this.roundRestartTimer > 0) return;

    if (this.mode === 'br') {
      if (!this.localPlayer.alive || this.br.finished) return;
      const limit = (this.mapManager.halfSize || 72) - 4.0;
      const safeX = Math.max(-limit, Math.min(limit, this.localPlayer.pos.x));
      const safeZ = Math.max(-limit, Math.min(limit, this.localPlayer.pos.z));
      this.localPlayer.pos.set(safeX, Math.max(0.5, this.localPlayer.pos.y + 3.5), safeZ);
      this.localPlayer.vel.set(0, 0, 0);
      this.moveVel.x = 0;
      this.moveVel.z = 0;
      this.localPlayer.coyoteTimer = 0;
      this.localPlayer.jumpBufferTimer = 0;
      this.localPlayer.gliding = false;
      this.localPlayer.diving = false;
      this.activeBuildType = null;
      this.editState.active = false;
      this.editState.buildKey = null;
      this.buildings.hideEditOverlay();
      this.activeEmote = null;
      this.emoteTime = 0;
      this.closeEmoteWheel(false);
      audio.stopEmoteMusic();
      this.localRig.setWeapon(this.weapons.slot, false);
    } else if (this.mode === 'online') {
      if (!this.localPlayer.alive) return;
      const savedHp = this.localPlayer.hp;
      const savedShield = this.localPlayer.shield;
      this.activeBuildType = null;
      this.editState.active = false;
      this.editState.buildKey = null;
      this.buildings.hideEditOverlay();
      const mySpawn = this.mapManager.spawnPoints[this.localSlot === 0 ? 0 : 1] || this.mapManager.spawnPoints[0];
      this._respawnLocal(mySpawn);
      this.localPlayer.hp = savedHp;
      this.localPlayer.shield = savedShield;
      this.localRig.setWeapon(this.weapons.slot, false);
    } else {
      this.activeBuildType = null;
      this.editState.active = false;
      this.editState.buildKey = null;
      this.buildings.hideEditOverlay();
      this._respawnLocal(this.mapManager.spawnPoints[0]);
      this.localRig.setWeapon(this.weapons.slot, false);
    }

    this.respawnKeyCooldown = 1.5;
    audio.playBoostPad();
    if (this.ui.onBanner) this.ui.onBanner(t('banner_respawned'), 'info');
    this._pushHudState();
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
      this.ui.onBanner(customBanner || t('banner_arena_reset', { name: byName }), 'info');
    }
    this._pushHudState();
  }

  _isADS() {
    if (
      this.activeBuildType ||
      this.editState.active ||
      this.activeEmote ||
      this.emoteWheelOpen ||
      this.paused ||
      this.weapons.slot === 2
    ) {
      return false;
    }
    const w = this.weapons.getWeapon();
    if (w.id === 'sniper') {
      return this.sniperScopeLevel > 0 && !this.weapons.reloading;
    }
    return this.mouseDownRight;
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
    const isEmoting = Boolean(this.activeEmote);
    const activeW = this.weapons.getWeapon();
    const isSniper = activeW.id === 'sniper';
    const isSniperScoped = isADS && isSniper && this.sniperScopeLevel > 0;
    const isAR = activeW.id === 'ar';
    const kb = this._getKeybinds();
    const isSprinting = !isADS && !isEmoting && this._isBindDown(kb.sprint) && this._isBindDown(kb.moveForward) && !this.localPlayer.crouch;
    const isBoosting = this.localPlayer.skyBoostTimer > 0 || this.localPlayer.diving;

    // Smooth camera rotation tracking (filters polling micro-stutter while keeping instant aim lock)
    const rotK = dt > 0 ? (1 - Math.exp(-38 * dt)) : 1;
    this.camState.renderYaw = lerpAngle(this.camState.renderYaw, this.camState.targetYaw, rotK);
    this.camState.renderPitch += (this.camState.targetPitch - this.camState.renderPitch) * rotK;
    this.localPlayer.yaw = this.camState.renderYaw;
    this.localPlayer.pitch = this.camState.renderPitch;

    const pitchUp = Math.max(0, this.camState.renderPitch);
    const pitchDown = Math.max(0, -this.camState.renderPitch);

    let targetFov = isEmoting ? 78 : (isBoosting ? 86 : (isSprinting ? 82 : 76));
    if (isADS) {
      if (isSniper) {
        targetFov = this.sniperScopeLevel >= 2 ? (activeW.adsFov2 || 17) : (activeW.adsFov || 38);
      } else {
        targetFov = activeW.adsFov || 58;
      }
    }
    const targetDist = isSniperScoped
      ? 0.02
      : (isADS ? (isSniper ? 1.15 : (isAR ? 1.38 : 1.72)) : (isEmoting ? 3.75 : Math.max(2.35, 3.12 - pitchUp * 0.52)));
    const targetRight = isSniperScoped
      ? 0
      : (isADS ? (isSniper ? 0.55 : (isAR ? 0.62 : 0.66)) : (isEmoting ? 0.24 : 0.88));
    const targetUp = isSniperScoped
      ? this.camState.landDip
      : ((isADS ? (isAR ? 0.14 : 0.16) : (isEmoting ? 0.16 : 0.25 + pitchDown * 0.22)) + this.camState.landDip);
    const targetEyeH = this.localPlayer.crouch ? PLAYER_EYE_CROUCH : PLAYER_EYE_STAND;

    const strafeTarget = 0;

    if (dt <= 0) {
      this.camState.dist = targetDist;
      this.camState.right = targetRight;
      this.camState.up = targetUp;
      this.camState.eyeH = targetEyeH;
      this.camState.fov = targetFov;
      this.camState.strafeOffset = strafeTarget;
      this.camState.smoothPosY = this.localPlayer.pos.y;
    } else {
      const k = 1 - Math.exp(-(isSniperScoped ? 30 : 16) * dt);
      const fovK = 1 - Math.exp(-(isSniper ? 30 : 16) * dt);
      this.camState.dist += (targetDist - this.camState.dist) * k;
      this.camState.right += (targetRight - this.camState.right) * k;
      this.camState.up += (targetUp - this.camState.up) * k;
      this.camState.eyeH += (targetEyeH - this.camState.eyeH) * k;
      this.camState.fov += (targetFov - this.camState.fov) * fovK;
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

  _computeCrosshairGap() {
    if (this.activeBuildType || this.editState.active) return 4;
    const w = this.weapons.getWeapon();
    let base = w.id === 'shotgun' ? 8 : (w.id === 'sniper' ? (this._isADS() ? 2 : 12) : (w.id === 'smg' ? 6 : (w.id === 'ar' ? 4 : 3)));
    if (this._isADS()) base *= 0.55;
    const horizSpeed = Math.hypot(this.moveVel.x, this.moveVel.z);
    const moveBoost = horizSpeed * 0.42;
    const airBoost = this.localPlayer.grounded ? 0 : 3;
    const recoilBoost = this.crosshairRecoil * 6.5;
    return Math.max(2, Math.min(18, Math.round(base + moveBoost + airBoost + recoilBoost)));
  }

  _pushHudState() {
    if (!this.ui.onHudUpdate) return;
    const opp = this._hudOpp;
    if (this.mode === 'bot') {
      opp.name = this.bot.name;
      opp.hp = Math.ceil(this.bot.hp);
      opp.shield = Math.ceil(this.bot.shield);
      opp.kills = this.bot.kills;
    } else if (this.mode === 'online') {
      opp.name = this.onlineOpponent.name;
      opp.hp = Math.ceil(this.onlineOpponent.hp);
      opp.shield = Math.ceil(this.onlineOpponent.shield);
      opp.kills = this.onlineOpponent.kills;
    } else {
      opp.name = t('hud_target');
      opp.hp = Math.ceil(this.dummyTarget.hp);
      opp.shield = Math.ceil(this.dummyTarget.shield);
      opp.kills = this.dummyTarget.kills || 0;
    }

    const activeWeapon = this.weapons.getWeapon();
    const cdNum = this.countdownTimer > 0 ? Math.min(3, Math.ceil(this.countdownTimer / 0.65)) : 0;
    const cdText = cdNum > 0 ? String(cdNum) : (this.startBannerTimer > 0 ? t('hud_go') : '');
    const roundState = this.countdownTimer > 0
      ? 'countdown'
      : this.roundRestartTimer > 0
        ? 'restarting'
        : (this.mode === 'online' && !this.onlineOpponent.id)
          ? 'waiting'
          : this.mode === 'solo'
            ? 'solo'
            : 'active';

    let brHud = null;
    if (this.mode === 'br' && this.br.active) {
      const st = this.br.storm;
      const pDist = Math.hypot(this.localPlayer.pos.x - st.cx, this.localPlayer.pos.z - st.cz);
      const stHud = this._hudBrStorm;
      stHud.phase = st.phase + 1;
      stHud.state = st.state;
      stHud.timer = Math.max(0, Math.ceil(st.timer));
      stHud.cx = st.cx;
      stHud.cz = st.cz;
      stHud.radius = st.radius;
      stHud.nextCx = st.nextCx;
      stHud.nextCz = st.nextCz;
      stHud.nextRadius = st.nextRadius;
      stHud.dps = st.dps;
      stHud.playerInStorm = this.localPlayer.alive && pDist > st.radius;

      brHud = this._hudBr;
      brHud.aliveCount = this.br.getAliveCount(this.localPlayer);
      brHud.totalFighters = this.br.totalFighters;
      brHud.finished = this.br.finished;
      brHud.gliding = this._isLocalDropLocked();
      brHud.killFeed = this.br.killFeed;
      brHud.playerX = this.localPlayer.pos.x;
      brHud.playerZ = this.localPlayer.pos.z;
      brHud.playerYaw = this.localPlayer.yaw;
      brHud.pois = this.mapManager.poiMarkers;
      brHud.lootOrbs = this.br.orbs;
      brHud.bots = this.br.bots;
    }

    const p = this._hudPayload;
    p.mode = this.mode;
    p.mapId = this.mapId;
    p.botDifficulty = this.botDifficulty;
    p.localSlot = this.localSlot;
    p.roomCode = this.roomCode;
    p.hp = Math.ceil(this.localPlayer.hp);
    p.shield = Math.ceil(this.localPlayer.shield);
    p.kills = this.localPlayer.kills;
    p.alive = this.localPlayer.alive;
    p.weaponSlot = this.weapons.slot;
    p.activeWeaponId = activeWeapon.id;
    p.slotWeaponIds[0] = this.weapons.loadout[0].id;
    p.slotWeaponIds[1] = this.weapons.loadout[1].id;
    p.slotWeaponIds[2] = this.weapons.loadout[2].id;
    p.ammo = this.weapons.ammo[this.weapons.slot];
    p.magSize = activeWeapon.magSize;
    p.reloading = this.weapons.reloading;
    p.reloadProgress = this.weapons.getReloadProgress();
    p.reloadRemaining = this.weapons.reloading ? Math.max(0, this.weapons.reloadTimer) : 0;
    p.buildType = this.activeBuildType;
    p.buildMat = this.matchBuildMat || this.localPlayer.buildMat;
    p.editActive = this.editState.active;
    p.isADS = this._isADS();
    p.sniperZoom = (activeWeapon.id === 'sniper' && p.isADS) ? this.sniperScopeLevel : 0;
    p.countdown = cdNum;
    p.countdownText = cdText;
    p.roundState = roundState;
    p.crosshairSpread = this._computeCrosshairGap();
    p.inSpawnBox = this._isLocalInSpawnBox();
    p.nearbyPickup = this._getNearbyWeaponPickup();
    p.canAirBoost = this.mapId === 'skybox' && !this.localPlayer.grounded && this.localPlayer.pos.y > 4.0 && this.localPlayer.canAirBoost;
    p.skyBoosting = this.localPlayer.skyBoostTimer > 0;
    p.opponent = opp;
    p.br = brHud;
    p.fps = this.currentFps;
    p.frameMs = this.currentFrameMs;
    p.quality = this.currentQuality;
    p.ping = this.mode === 'online' ? network.pingMs : 0;
    p.pointerLocked = this.pointerLocked || this.fallbackAim;
    p.paused = this.paused;
    p.emoteWheelOpen = this.emoteWheelOpen;
    p.activeEmote = this.activeEmote;

    this.ui.onHudUpdate(p);
  }

  _loop(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._boundLoop);

    const rawDt = (now - this.lastTs) / 1000;
    this.lastTs = now;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.time += dt;

    // Live FPS & Frame Time (ms) counter updated every 250ms
    this.fpsAccum += rawDt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.25) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccum);
      this.currentFrameMs = Math.round((this.fpsAccum / this.fpsFrames) * 10000) / 10;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (this.resetCooldown > 0) this.resetCooldown -= dt;
    if (this.respawnKeyCooldown > 0) this.respawnKeyCooldown -= dt;
    if (this.buildCooldown > 0) this.buildCooldown -= dt;
    if (this.crosshairRecoil > 0) this.crosshairRecoil = Math.max(0, this.crosshairRecoil - dt * 6.5);

    // V-Ramp START! banner hide timer + automatic round restart after elimination
    if (this.startBannerTimer > 0 && !this.paused) {
      this.startBannerTimer = Math.max(0, this.startBannerTimer - dt);
      if (this.startBannerTimer === 0) this._pushHudState();
    }

    if (this.roundRestartTimer > 0 && !this.paused) {
      this.roundRestartTimer -= dt;
      if (this.roundRestartTimer <= 0) {
        this.roundRestartTimer = 0;
        this._applyLocalArenaReset(null, t('banner_next_round'));
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
        if (this.ui.onBanner) this.ui.onBanner(t('hud_go'), 'success');
        this._pushHudState();
      }
    }

    this.mapManager.update(this.time);

    // Local player update
    let moveX = 0;
    let moveZ = 0;
    let strafeInput = 0;
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

      const kb = this._getKeybinds();
      const countdownLock = this.mapId === 'vramp' && this.countdownTimer > 0;
      const f = countdownLock ? 0 : ((this._isBindDown(kb.moveForward) ? 1 : 0) - (this._isBindDown(kb.moveBackward) ? 1 : 0));
      const r = countdownLock ? 0 : ((this._isBindDown(kb.moveRight) ? 1 : 0) - (this._isBindDown(kb.moveLeft) ? 1 : 0));
      strafeInput = r;
      this.localPlayer.crouch = !countdownLock && !this.localPlayer.gliding && this._isBindDown(kb.crouch);
      this.localPlayer.diving = this.localPlayer.gliding && this._isBindDown(kb.jump);
      const sprint = !countdownLock && this._isBindDown(kb.sprint) && !this.localPlayer.crouch && f > 0;
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
      const wantJump = !countdownLock && this._isBindDown(kb.jump);
      if (this.activeEmote) {
        if (f !== 0 || r !== 0 || wantJump || this.localPlayer.crouch || !this.localPlayer.grounded) {
          this.cancelEmote();
        } else {
          this.emoteTime += dt;
          if (this.emoteTime >= this.emoteDuration) {
            this.cancelEmote();
          }
        }
      }
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
            if (this.ui.onBanner) this.ui.onBanner(t('banner_fell_you_opp'), 'danger');
          } else {
            if (this.mode === 'bot') this.bot.kills += 1;
            else this.dummyTarget.kills += 1;
            this.roundRestartTimer = 0.9;
            if (this.ui.onBanner) {
              this.ui.onBanner(
                this.mode === 'bot' ? t('banner_fell_you_bot') : t('banner_fell_solo'),
                'danger'
              );
            }
          }
          this._pushHudState();
        }
      } else if (this.mouseDownLeft && (this.pointerLocked || this.fallbackAim) && this.countdownTimer <= 0) {
        if (this.activeBuildType) {
          this._tryPlaceLocalBuild();
        } else if (!this.editState.active && this.weapons.getWeapon().auto) {
          this._fireLocalWeapon();
        }
      }

      // Weapon pickup proximity prompt polling in Skybox
      if (this.mapId === 'skybox') {
        const pickup = this._getNearbyWeaponPickup();
        if (pickup !== this._lastPickupHud) {
          this._lastPickupHud = pickup;
          this._pushHudState();
        }
      }
    } else if (!this.localPlayer.alive && this.mode !== 'online' && this.mode !== 'br' && this.mapId !== 'vramp' && this.roundRestartTimer <= 0) {
      this.localPlayer.respawnTimer -= dt;
      if (this.localPlayer.respawnTimer <= 0) {
        this._respawnLocal(this.mapManager.spawnPoints[0]);
        this._pushHudState();
      }
    }

    if (this.weapons.update(dt, audio)) {
      this._pushHudState();
    }

    // Update Camera first so renderYaw/renderPitch stay 100% synced, then character rig
    this._updateCamera(dt);

    const isSniperScoped = this.weapons.getWeapon().id === 'sniper' && this._isADS() && this.sniperScopeLevel > 0;
    this.localRig.root.visible = this.localPlayer.alive && !isSniperScoped;

    // Smooth per-frame reload progress bar update (only while reloading or transitioning off)
    const reloadUiActive = this.localPlayer.alive && this.weapons.reloading;
    if (reloadUiActive || this._wasReloadHud) {
      this._wasReloadHud = reloadUiActive;
      if (this.ui.onReloadProgress) {
        this.ui.onReloadProgress(
          reloadUiActive,
          this.weapons.getReloadProgress(),
          this.weapons.reloadTimer
        );
      }
    }

    // Update local character rig (locked 1:1 to camera renderYaw or emoteYaw while emoting)
    this.localRig.root.position.copy(this.localPlayer.pos);
    this.localRig.root.rotation.y = this.activeEmote ? this.emoteYaw : this.localPlayer.yaw;
    this.localRig.animate(
      this.time,
      Math.hypot(moveX, moveZ),
      this.localPlayer.crouch,
      this.localPlayer.pitch,
      this.weapons.swingPhase,
      Boolean(this.activeBuildType || this.editState.active),
      this.weapons.slot,
      this._isADS(),
      strafeInput,
      this.localPlayer.grounded,
      this.activeEmote,
      this.emoteTime,
      this.weapons.getReloadProgress()
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
      const canPlace = !this._isLocalProtected() && !this._isLocalDropLocked() && this.buildings.canPlaceBuild(placement, this.mapManager);
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
        this.br.update(dt, this.time, this._brUpdateCtx);
      }
    } else if (this.mode === 'bot') {
      this.bot.update(
        dt,
        this.localPlayer,
        this.buildings,
        this.pools,
        audio,
        this._onBotHitLocal,
        this._onBotRespawned,
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
        if (this.ui.onBanner) this.ui.onBanner(t('banner_fell_bot'), 'success');
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
      // Smoothly dead-reckon & interpolate opponent position/aim
      const opp = this.onlineOpponent;
      if (opp.alive && opp.id) {
        const lead = Math.min(0.08, Math.max(0, this.time - opp.lastUpdateTime));
        this._tmpVec.set(
          opp.targetPos.x + opp.targetVx * lead,
          opp.targetPos.y,
          opp.targetPos.z + opp.targetVz * lead
        );
        const alpha = Math.min(1, 1 - Math.exp(-18 * dt));
        opp.pos.lerp(this._tmpVec, alpha);
        let dyaw = opp.targetYaw - opp.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        opp.yaw += dyaw * alpha;
        opp.pitch += (opp.targetPitch - opp.pitch) * alpha;
        if (opp.swingPhase > 0) opp.swingPhase = Math.max(0, opp.swingPhase - dt * 3.5);
        opp.emoteTime = opp.emote ? (opp.emoteTime + dt) : 0;
        if (opp.reloading) {
          opp.reloadProgress = Math.min(1, opp.reloadProgress + dt / 1.55);
        } else {
          opp.reloadProgress = 0;
        }

        opp.rig.root.position.copy(opp.pos);
        opp.rig.root.rotation.y = opp.emote ? opp.emoteYaw : opp.yaw;
        opp.rig.animate(
          this.time,
          opp.speed,
          opp.crouch,
          opp.pitch,
          opp.swingPhase,
          Boolean(opp.buildMode),
          opp.slot,
          false,
          0,
          true,
          opp.emote,
          opp.emoteTime,
          opp.reloading ? opp.reloadProgress : 0
        );
        opp.rig.updateHealthBar(opp.hp, opp.shield, this.camera.position);
      }

      this.netSyncAccum += dt;
      if (this.localPlayer.alive && this.netSyncAccum >= 0.04) { // 25 Hz clean state sync
        this.netSyncAccum = 0;
        const np = this._netStatePayload;
        np.x = this.localPlayer.pos.x;
        np.y = this.localPlayer.pos.y;
        np.z = this.localPlayer.pos.z;
        np.yaw = this.localPlayer.yaw;
        np.pitch = this.localPlayer.pitch;
        np.vx = moveX;
        np.vz = moveZ;
        np.crouch = this.localPlayer.crouch;
        np.slot = this.weapons.slot;
        np.weaponId = this.weapons.getWeapon().id;
        np.buildMode = this.activeBuildType;
        np.swing = this.weapons.swingPhase;
        np.reloading = this.weapons.reloading;
        np.reloadProgress = this.weapons.getReloadProgress();
        np.emote = this.activeEmote;
        np.emoteYaw = this.activeEmote ? this.emoteYaw : this.localPlayer.yaw;
        network.sendPlayerState(np);
      }
    }

    // Pulse reset button caps without per-frame closures (1v1 only)
    if (this.mode !== 'br') {
      for (let i = 0; i < this.resetBtnMeshes.length; i++) {
        this.resetBtnMeshes[i].position.y = 1.48 + Math.sin(this.time * 4 + i) * 0.05;
      }
    }

    // Muzzle flash PointLight decay
    if (this.muzzleLightTimer > 0) {
      this.muzzleLightTimer = Math.max(0, this.muzzleLightTimer - dt);
      this.muzzleLight.intensity = this.muzzleLightTimer > 0 ? 3.2 * (this.muzzleLightTimer / 0.065) : 0;
    }

    // Keep shadow frustum centered near player in 144m Battle Royale mode (texel-snapped in 2m steps)
    if (this.mode === 'br' && this.dirLight.castShadow) {
      const sx = Math.round(this.localPlayer.pos.x / 2) * 2;
      const sz = Math.round(this.localPlayer.pos.z / 2) * 2;
      this.dirLight.target.position.set(sx, 0, sz);
      this.dirLight.target.updateMatrixWorld();
      this.dirLight.position.set(sx + 34, 48, sz + 26);
    }

    // Animate build placements, rebuild InstancedMeshes if dirty & update Object Pools
    this.buildings.update(dt);
    this.buildings.rebuildInstances();
    this.pools.update(dt);

    // Dynamic crosshair spread (updates DOM only when quantized integer px changes)
    const chGap = this._computeCrosshairGap();
    if (chGap !== this.lastCrosshairGap) {
      this.lastCrosshairGap = chGap;
      if (this.ui.onCrosshairUpdate) this.ui.onCrosshairUpdate(chGap);
    }

    // Periodic HUD refresh (reload timer, FPS, ping)
    this.hudAccum += dt;
    if (this.hudAccum >= 0.12) {
      this.hudAccum = 0;
      this._pushHudState();
    }

    // Keep Sky Dome centered on camera when skybox is enabled
    if (this.skyDome.visible) {
      this.skyDome.position.copy(this.camera.position);
      this.skyDome.updateMatrix();
    }

    this.renderer.render(this.scene, this.camera);
  }
}
