import * as THREE from 'three';
import { STRUCT_VERTEX_MAT, getStructureGeo, onStructuresLoaded } from './game/structureAssets.js';
import { getBuildMaterialTextures } from './game/textures.js';
import { isCustomModelEnabled } from './game/modelLoader.js';
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
    this._currentQuality = storage.get().quality || 'medium';
    this._boundTick = (now) => this._tick(now);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 40);
    this.camera.position.set(0.08, 1.45, 4.8);
    this.camera.lookAt(0.08, 0.98, 0);

    const q = QUALITY_PRESETS[this._currentQuality] || QUALITY_PRESETS.medium;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: q.antialias,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    const dpr = q.pixelRatio === 'auto' ? Math.min(q.pixelRatioCap, window.devicePixelRatio || 1) : q.pixelRatio;
    this.renderer.setPixelRatio(dpr);
    this.renderer.toneMapping = q.toneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Warm sunlit key light + cool sky-blue hemisphere fill matching the arena
    this.hemi = new THREE.HemisphereLight(0xffe7bd, 0x3b5988, 1.35);
    this.scene.add(this.hemi);

    this.dir = new THREE.DirectionalLight(0xfff1cf, 2.0);
    this.dir.position.set(2.5, 4.5, 3.5);
    this.scene.add(this.dir);

    // Dual-tier dark neutral pedestal matching UI design system (#0f1115 / #181b21 / #00d2ff)
    this._lowerBaseMats = {
      low: new THREE.MeshBasicMaterial({ color: 0x0f1115 }),
      medium: new THREE.MeshLambertMaterial({ color: 0x0f1115 }),
      high: new THREE.MeshStandardMaterial({ color: 0x0f1115, roughness: 0.72, metalness: 0.25 })
    };
    this._pedMats = {
      low: new THREE.MeshBasicMaterial({ color: 0x181b21 }),
      medium: new THREE.MeshLambertMaterial({ color: 0x181b21 }),
      high: new THREE.MeshStandardMaterial({ color: 0x181b21, roughness: 0.65, metalness: 0.3 })
    };

    this.mainGroup = new THREE.Group();
    this.scene.add(this.mainGroup);
    this.hasPartyMate = false;
    this.mateGroup = null;
    this.matePedestal = null;
    this.mateLowerBase = null;
    this.mateOuterRing = null;
    this.mateRing = null;
    this.mateRig = null;
    this.mateSkinId = null;

    this.lowerBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.36, 1.48, 0.14, 16),
      this._lowerBaseMats.medium
    );
    this.lowerBase.position.y = -0.22;
    this.lowerBase.matrixAutoUpdate = false;
    this.lowerBase.updateMatrix();
    this.mainGroup.add(this.lowerBase);

    const pedGeo = new THREE.CylinderGeometry(1.14, 1.28, 0.16, 16);
    this.pedestal = new THREE.Mesh(pedGeo, this._pedMats.medium);
    this.pedestal.position.y = -0.08;
    this.pedestal.matrixAutoUpdate = false;
    this.pedestal.updateMatrix();
    this.mainGroup.add(this.pedestal);

    this.outerRing = new THREE.Mesh(
      new THREE.RingGeometry(1.22, 1.26, 24),
      new THREE.MeshBasicMaterial({ color: 0x00d2ff, side: THREE.DoubleSide })
    );
    this.outerRing.rotation.x = -Math.PI / 2;
    this.outerRing.position.y = -0.14;
    this.outerRing.matrixAutoUpdate = false;
    this.outerRing.updateMatrix();
    this.mainGroup.add(this.outerRing);

    const ringGeo = new THREE.RingGeometry(1.03, 1.09, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2a3140, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.01;
    this.ring.matrixAutoUpdate = false;
    this.ring.updateMatrix();
    this.mainGroup.add(this.ring);

    // Small sample build cube beside character to preview procedural Wood / Brick / Metal per tier
    this._sampleMats = {
      low: new THREE.MeshBasicMaterial({ color: BUILD_MATERIALS.wood.color }),
      medium: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      high: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.82,
        metalness: 0.04
      })
    };
    this._structBasicMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    this._sampleFallbackGeo = new THREE.BoxGeometry(0.58, 0.58, 0.58);
    this.sampleBlock = new THREE.Mesh(this._sampleFallbackGeo, this._sampleMats.medium);
    this.sampleBlock.position.set(-0.92, 0.30, -0.2);
    this.sampleBlock.rotation.y = 0.4;
    this.mainGroup.add(this.sampleBlock);
    this._currentSampleMatId = storage.get().buildMat || 'wood';
    this._unsubStructures = onStructuresLoaded(() => this._syncSampleStructure(this._currentSampleMatId, this._currentQuality));

    // Character rig
    this.rig = createCharacterRig(storage.get().skinId, false);
    this.rig.setWeapon(0, false);
    this.rig.root.rotation.y = this.userYaw;
    this.mainGroup.add(this.rig.root);

    this.applySettings(storage.get());
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

  _syncSampleStructure(matId, qualityKey = this._currentQuality) {
    this._currentSampleMatId = matId || 'wood';
    const qKey = qualityKey === 'low' ? 'low' : (qualityKey === 'high' ? 'high' : 'medium');
    const prefixMap = { wood: 'Wood', brick: 'Brick', metal: 'Metal' };
    const prefix = prefixMap[this._currentSampleMatId] || 'Wood';
    const geo = isCustomModelEnabled('structures') ? getStructureGeo(`Wall_${prefix}_Full`) : null;
    if (geo && geo.attributes?.color) {
      this.sampleBlock.geometry = geo;
      this.sampleBlock.material = qKey === 'low' ? this._structBasicMat : STRUCT_VERTEX_MAT;
      this.sampleBlock.material.needsUpdate = true;
      this.sampleBlock.scale.setScalar(0.17);
      this.sampleBlock.position.set(-0.98, 0.34, -0.18);
    } else {
      this.sampleBlock.geometry = this._sampleFallbackGeo;
      if (qKey === 'low') {
        const matDef = BUILD_MATERIALS[this._currentSampleMatId] || BUILD_MATERIALS.wood;
        this._sampleMats.low.color.setHex(matDef.color);
        this.sampleBlock.material = this._sampleMats.low;
      } else if (qKey === 'medium') {
        const textures = getBuildMaterialTextures(this._currentSampleMatId);
        const m = this._sampleMats.medium;
        m.color.setHex(0xffffff);
        m.map = textures.map;
        m.needsUpdate = true;
        this.sampleBlock.material = m;
      } else {
        const textures = getBuildMaterialTextures(this._currentSampleMatId);
        const m = this._sampleMats.high;
        m.color.setHex(0xffffff);
        m.map = textures.map;
        m.bumpMap = textures.bumpMap;
        m.bumpScale = this._currentSampleMatId === 'brick' ? 0.05 : 0.035;
        m.roughnessMap = textures.roughnessMap || null;
        m.roughness = this._currentSampleMatId === 'metal' ? 0.52 : (this._currentSampleMatId === 'brick' ? 0.88 : 0.82);
        m.metalness = this._currentSampleMatId === 'metal' ? 0.52 : 0.02;
        m.needsUpdate = true;
        this.sampleBlock.material = m;
      }
      this.sampleBlock.scale.setScalar(1.0);
      this.sampleBlock.position.set(-0.92, 0.30, -0.2);
    }
  }

  applySettings(state) {
    const q = QUALITY_PRESETS[state.quality] || QUALITY_PRESETS.medium;
    const tier = q.key;
    this._currentQuality = tier;
    const dpr = q.pixelRatio === 'auto' ? Math.min(q.pixelRatioCap, window.devicePixelRatio || 1) : q.pixelRatio;
    this.renderer.setPixelRatio(dpr);
    this.renderer.toneMapping = q.toneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.hemi.visible = Boolean(q.lights);
    this.dir.visible = Boolean(q.lights);
    this.lowerBase.material = this._lowerBaseMats[tier];
    this.lowerBase.material.needsUpdate = true;
    this.pedestal.material = this._pedMats[tier];
    this.pedestal.material.needsUpdate = true;

    this.rig.setSkin(state.skinId);
    this.rig.setQualityTier(tier);
    if (this.mateRig) {
      this.mateRig.setQualityTier(tier);
    }
    if (this.mateLowerBase) {
      this.mateLowerBase.material = this._lowerBaseMats[tier];
      this.mateLowerBase.material.needsUpdate = true;
    }
    if (this.matePedestal) {
      this.matePedestal.material = this._pedMats[tier];
      this.matePedestal.material.needsUpdate = true;
    }
    this._syncSampleStructure(state.buildMat, tier);
    this.resize();
    if (this.running) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  setPartyMate(member) {
    if (!member) {
      this.hasPartyMate = false;
      this.mateSkinId = null;
      this.mainGroup.position.x = 0;
      if (this.mateGroup) this.mateGroup.visible = false;
      this.resize();
      if (this.running) this.renderer.render(this.scene, this.camera);
      return;
    }

    if (!this.mateGroup) {
      this.mateGroup = new THREE.Group();
      this.mateGroup.position.set(-1.26, 0, -0.42);
      const tier = this._currentQuality === 'low' ? 'low' : (this._currentQuality === 'high' ? 'high' : 'medium');

      this.mateLowerBase = new THREE.Mesh(
        new THREE.CylinderGeometry(1.16, 1.26, 0.12, 16),
        this._lowerBaseMats[tier]
      );
      this.mateLowerBase.position.y = -0.22;
      this.mateLowerBase.matrixAutoUpdate = false;
      this.mateLowerBase.updateMatrix();
      this.mateGroup.add(this.mateLowerBase);

      this.matePedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.98, 1.1, 0.14, 16),
        this._pedMats[tier]
      );
      this.matePedestal.position.y = -0.09;
      this.matePedestal.matrixAutoUpdate = false;
      this.matePedestal.updateMatrix();
      this.mateGroup.add(this.matePedestal);

      this.mateOuterRing = new THREE.Mesh(
        new THREE.RingGeometry(1.04, 1.08, 24),
        new THREE.MeshBasicMaterial({ color: 0x00d2ff, side: THREE.DoubleSide })
      );
      this.mateOuterRing.rotation.x = -Math.PI / 2;
      this.mateOuterRing.position.y = -0.15;
      this.mateOuterRing.matrixAutoUpdate = false;
      this.mateOuterRing.updateMatrix();
      this.mateGroup.add(this.mateOuterRing);

      this.mateRing = new THREE.Mesh(
        new THREE.RingGeometry(0.88, 0.94, 24),
        new THREE.MeshBasicMaterial({ color: 0x2a3140, side: THREE.DoubleSide })
      );
      this.mateRing.rotation.x = -Math.PI / 2;
      this.mateRing.position.y = 0.01;
      this.mateRing.matrixAutoUpdate = false;
      this.mateRing.updateMatrix();
      this.mateGroup.add(this.mateRing);

      this.mateRig = createCharacterRig(member.skinId || 'crimson', false);
      this.mateRig.setWeapon(1, false);
      this.mateRig.root.rotation.y = Math.PI * 0.82;
      this.mateRig.setQualityTier(this._currentQuality);
      this.mateGroup.add(this.mateRig.root);
      this.scene.add(this.mateGroup);
    }

    this.hasPartyMate = true;
    this.mainGroup.position.x = 0.42;
    this.mateGroup.visible = true;

    const nextSkin = member.skinId || 'crimson';
    if (nextSkin !== this.mateSkinId) {
      this.mateSkinId = nextSkin;
      this.mateRig.setSkin(nextSkin);
    }

    this.resize();
    if (this.running) this.renderer.render(this.scene, this.camera);
  }

  resize() {
    if (!this.canvas || !this.canvas.parentElement) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(240, Math.floor(rect.width));
    const h = Math.max(260, Math.floor(rect.height));
    const offsetX = window.innerWidth > 960 ? 0.62 : 0;
    const zDist = this.hasPartyMate ? 5.35 : 4.8;
    this.camera.position.set(offsetX, 1.45, zDist);
    this.camera.lookAt(offsetX, 0.95, 0);
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

  _tick(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._boundTick);
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
    if (this.hasPartyMate && this.mateRig) {
      this.mateRig.root.rotation.y = Math.PI * 0.82 + Math.sin(this.time * 0.45) * 0.08;
      this.mateRig.animate(this.time + 1.3, 0, false, Math.sin(this.time * 1.2 + 1) * 0.05, 0, false, 1);
    }
    this.sampleBlock.rotation.y += dt * 0.7;
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    this.resize();
    this.rafId = requestAnimationFrame(this._boundTick);
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  dispose() {
    this.stop();
    if (this.unsubscribe) this.unsubscribe();
    if (this._unsubStructures) this._unsubStructures();
    this.canvas?.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);

    this.lowerBase.geometry.dispose();
    this.pedestal.geometry.dispose();
    this.outerRing.geometry.dispose();
    this.outerRing.material.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    if (this.mateGroup) {
      this.mateLowerBase.geometry.dispose();
      this.matePedestal.geometry.dispose();
      this.mateOuterRing.geometry.dispose();
      this.mateOuterRing.material.dispose();
      this.mateRing.geometry.dispose();
      this.mateRing.material.dispose();
      this.mateRig.dispose();
    }
    this._sampleFallbackGeo.dispose();
    Object.values(this._lowerBaseMats).forEach((m) => m.dispose());
    Object.values(this._pedMats).forEach((m) => m.dispose());
    Object.values(this._sampleMats).forEach((m) => m.dispose());
    this._structBasicMat.dispose();
    this.rig.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
