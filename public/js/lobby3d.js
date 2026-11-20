import * as THREE from 'three';
import { STRUCT_VERTEX_MAT, getStructureGeo, onStructuresLoaded } from './game/structureAssets.js';
import { BUILD_MATERIALS, QUALITY_PRESETS } from './game/constants.js';
import { createCharacterRig } from './game/playerMesh.js';
import { storage } from './storage.js';

export class Lobby3DPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.running = false;
    this.rafId = 0;
    this.userYaw = Math.PI * 0.92; // Facing camera slightly angled
    this.dragging = false;
    this.lastX = 0;
    this.time = 0;
    this.lastTs = 0;
    this.poseSlot = 0;
    this.poseBuild = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 40);
    this.camera.position.set(0.08, 1.45, 4.8);
    this.camera.lookAt(0.08, 0.98, 0);

    const q = QUALITY_PRESETS[storage.get().quality] || QUALITY_PRESETS.medium;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: q.antialias,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(q.pixelRatioCap, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Black/Charcoal minimalist studio lighting
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.45);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 1.85);
    dir.position.set(2.5, 4.5, 3.5);
    this.scene.add(dir);

    // Dual-tier obsidian black pedestal + electric blue outer ring & crimson red inner ring
    const lowerBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.36, 1.48, 0.14, 12),
      new THREE.MeshLambertMaterial({ color: 0x0b0d14 })
    );
    lowerBase.position.y = -0.22;
    lowerBase.matrixAutoUpdate = false;
    lowerBase.updateMatrix();
    this.scene.add(lowerBase);

    const pedGeo = new THREE.CylinderGeometry(1.14, 1.28, 0.16, 12);
    const pedMat = new THREE.MeshLambertMaterial({ color: 0x161a24 });
    const pedestal = new THREE.Mesh(pedGeo, pedMat);
    pedestal.position.y = -0.08;
    pedestal.matrixAutoUpdate = false;
    pedestal.updateMatrix();
    this.scene.add(pedestal);

    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(1.22, 1.27, 16),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, side: THREE.DoubleSide })
    );
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.y = -0.14;
    outerRing.matrixAutoUpdate = false;
    outerRing.updateMatrix();
    this.scene.add(outerRing);

    const ringGeo = new THREE.RingGeometry(1.02, 1.10, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.01;
    this.ring.matrixAutoUpdate = false;
    this.ring.updateMatrix();
    this.scene.add(this.ring);

    // Small sample build cube beside character to preview Wood / Brick / Metal
    const matInfo = BUILD_MATERIALS[storage.get().buildMat] || BUILD_MATERIALS.wood;
    this.sampleMat = new THREE.MeshLambertMaterial({ color: matInfo.color });
    this._sampleFallbackGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    this.sampleBlock = new THREE.Mesh(this._sampleFallbackGeo, this.sampleMat);
    this.sampleBlock.position.set(-0.92, 0.28, -0.2);
    this.sampleBlock.rotation.y = 0.4;
    this.scene.add(this.sampleBlock);
    this._currentSampleMatId = storage.get().buildMat || 'wood';
    this._unsubStructures = onStructuresLoaded(() => this._syncSampleStructure(this._currentSampleMatId));

    // Character rig
    this.rig = createCharacterRig(storage.get().skinId, false);
    this.rig.setWeapon(0, false);
    this.rig.root.rotation.y = this.userYaw;
    this.scene.add(this.rig.root);

    this.bindEvents();
    this.unsubscribe = storage.subscribe((state) => this.applySettings(state));
  }

  bindEvents() {
    this.onPointerDown = (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
    };
    this.onPointerMove = (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.userYaw += dx * 0.012;
    };
    this.onPointerUp = () => {
      this.dragging = false;
    };
    this.onResize = () => {
      if (this.running) this.resize();
    };

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
  }

  _syncSampleStructure(matId) {
    this._currentSampleMatId = matId || 'wood';
    const prefixMap = { wood: 'Wood', brick: 'Brick', metal: 'Metal' };
    const prefix = prefixMap[this._currentSampleMatId] || 'Wood';
    const geo = getStructureGeo(`Wall_${prefix}_Full`);
    if (geo && geo.attributes?.color) {
      this.sampleBlock.geometry = geo;
      this.sampleBlock.material = STRUCT_VERTEX_MAT;
      this.sampleBlock.scale.setScalar(0.17);
      this.sampleBlock.position.set(-0.98, 0.34, -0.18);
    } else {
      const matInfo = BUILD_MATERIALS[this._currentSampleMatId] || BUILD_MATERIALS.wood;
      this.sampleBlock.geometry = this._sampleFallbackGeo;
      this.sampleBlock.material = this.sampleMat;
      this.sampleMat.color.setHex(matInfo.color);
      this.sampleBlock.scale.setScalar(1.0);
      this.sampleBlock.position.set(-0.92, 0.28, -0.2);
    }
  }

  applySettings(state) {
    const q = QUALITY_PRESETS[state.quality] || QUALITY_PRESETS.medium;
    this.renderer.setPixelRatio(Math.min(q.pixelRatioCap, window.devicePixelRatio || 1));
    this.rig.setSkin(state.skinId);
    this._syncSampleStructure(state.buildMat);
    this.resize();
  }

  resize() {
    if (!this.canvas || !this.canvas.parentElement) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(240, Math.floor(rect.width));
    const h = Math.max(260, Math.floor(rect.height));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  setPreviewPose(slot = 0, buildMode = false) {
    this.poseSlot = Number(slot) || 0;
    this.poseBuild = Boolean(buildMode);
    this.rig.setWeapon(this.poseSlot, this.poseBuild);
    this.rig.animate(this.time, 0, false, Math.sin(this.time * 1.4) * 0.06, 0, this.poseBuild, this.poseSlot);
    if (this.running) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    this.resize();
    const tick = (now) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      const elapsed = now - this.lastTs;
      // Throttle idle lobby rotation to ~30 FPS so UI clicks and old PCs stay snappy
      if (!this.dragging && elapsed < 32) return;
      const dt = Math.min(0.08, elapsed / 1000);
      this.lastTs = now;
      this.time += dt;

      if (!this.dragging) {
        this.userYaw += dt * 0.25;
      }
      this.rig.root.rotation.y = this.userYaw;
      this.rig.animate(this.time, 0, false, Math.sin(this.time * 1.4) * 0.06, 0, this.poseBuild, this.poseSlot);
      this.sampleBlock.rotation.y += dt * 0.7;
      this.renderer.render(this.scene, this.camera);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }
}
