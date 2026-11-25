import * as THREE from 'three';
import {
  CS2_BOT_NAMES_CT,
  CS2_BOT_NAMES_T,
  CS2_ECONOMY,
  CS2_HIT_MULT,
  CS2_MODES,
  CS2_MOVE,
  CS2_SOURCE_SCALE,
  CS2_WEAPONS
} from './constants.js';
import { CS2TextureManager } from './textures.js';
import { cs2Audio } from './audio.js';
import { CS2MovementController } from './movement.js';
import { SandstormMap } from './mapSandstorm.js';
import { createTacticalAgentRig } from './characterRig.js';
import { CS2Effects } from './effects.js';
import { CS2WeaponSystem } from './weapons.js';
import { CS2BotManager } from './botAI.js';
import { cs2Network } from './networkCS2.js';
import { DEFAULT_KEYBINDS, storage } from '../../js/storage.js';
import { t } from '../../js/i18n.js';

export class CounterShoot2Game {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.cb = callbacks;
    this.disposed = false;
    this.running = false;
    this.rafId = 0;
    this.lastFrameTime = 0;

    const settings = storage.get();
    this.quality = settings.quality || 'medium';
    this.sensitivity = Number(settings.sensitivity || 1.0);
    this.keybinds = settings.keybinds || DEFAULT_KEYBINDS;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.08, 280);
    this.camera.rotation.order = 'YXZ';

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.quality === 'high',
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false
    });
    this.renderer.autoClear = false;

    this.textureMgr = new CS2TextureManager();
    this.map = new SandstormMap(this.scene, this.textureMgr);
    this.effects = new CS2Effects(this.scene, this.textureMgr);
    this.weapons = new CS2WeaponSystem(this.textureMgr);
    this.movement = new CS2MovementController();
    this.botManager = new CS2BotManager();

    // World C4 planted & dropped meshes
    const c4Geo = new THREE.BoxGeometry(0.28, 0.14, 0.36);
    const c4Mat = new THREE.MeshBasicMaterial({ color: 0x3b3328 });
    this.c4WorldMesh = new THREE.Mesh(c4Geo, c4Mat);
    this.c4WorldMesh.visible = false;
    this.scene.add(this.c4WorldMesh);

    const ledGeo = new THREE.BoxGeometry(0.08, 0.04, 0.08);
    this.c4LedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    this.c4LedMesh = new THREE.Mesh(ledGeo, this.c4LedMat);
    this.c4LedMesh.position.set(0, 0.09, 0);
    this.c4WorldMesh.add(this.c4LedMesh);

    const dropMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    this.c4DropMesh = new THREE.Mesh(c4Geo, dropMat);
    this.c4DropMesh.visible = false;
    this.scene.add(this.c4DropMesh);

    this._worldGeoDispose = [c4Geo, ledGeo];
    this._worldMatDispose = [c4Mat, this.c4LedMat, dropMat];

    // Match & Player state
    this.modeId = 'competitive';
    this.modeCfg = CS2_MODES.competitive;
    this.playType = 'bot'; // 'bot' | 'training' | 'online'
    this.botDifficulty = 'medium';
    this.localTeam = 'ct';
    this.room = null;
    this.isHost = true;

    this.paused = false;
    this.buyMenuOpen = false;
    this.scoreboardOpen = false;
    this.pointerLocked = false;

    this.yaw = 0;
    this.pitch = 0;
    this.prevSlot = 1;
    this.input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      walk: false,
      crouch: false,
      fire: false,
      interact: false
    };

    this.localPlayer = {
      id: 'local',
      name: settings.playerName || 'Operator',
      team: 'ct',
      isBot: false,
      isLocal: true,
      alive: true,
      hp: 100,
      armor: 0,
      hasHelmet: false,
      money: 800,
      kills: 0,
      deaths: 0,
      hasBomb: false,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false,
      weaponId: 'pistol',
      rig: null
    };

    this.bots = [];
    this.peers = new Map(); // socketId -> entity
    this.allEntities = [];
    this.droppedBomb = { active: false, x: 0, y: 0, z: 0 };

    this.roundState = {
      phase: 'FREEZE', // FREEZE | LIVE | BOMB_PLANTED | ROUND_END | MATCH_END
      timeLeft: 10,
      roundNum: 1,
      ctScore: 0,
      tScore: 0,
      ctLossStreak: 0,
      tLossStreak: 0,
      halftimeDone: false,
      winnerTeam: null
    };

    this.bombState = {
      planted: false,
      site: 'A',
      x: 0, y: 0, z: 0,
      timeLeft: 40,
      beepAccum: 0,
      ledTimer: 0,
      plantProgress: 0,
      defuseProgress: 0,
      plantTickStep: 0,
      plantingSite: null
    };

    this.spectateTargetId = null;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fps = 60;
    this._frameMs = 16.7;
    this._hudSyncTimer = 0;
    this._netSyncTimer = 0;
    this._hostSyncTimer = 0;
    this._damageFlashCooldown = 0;
    this._trainingRespawnTimer = 0;
    this._networkUnsubs = [];

    this._raycaster = new THREE.Raycaster();
    this._camDir = new THREE.Vector3();
    this._camOrigin = new THREE.Vector3();

    this.applyQuality(this.quality);
    this._bindEvents();
    this._unsubStorage = storage.subscribe((s) => this._onStorageUpdate(s));
    this._bindNetworkEvents();
  }

  _onStorageUpdate(s) {
    if (this.disposed) return;
    this.sensitivity = Number(s.sensitivity || 1.0);
    this.keybinds = s.keybinds || DEFAULT_KEYBINDS;
    if (s.playerName) this.localPlayer.name = s.playerName;
    if (s.quality && s.quality !== this.quality) {
      this.applyQuality(s.quality);
    }
  }

  applyQuality(quality) {
    const q = quality === 'low' ? 'low' : (quality === 'high' ? 'high' : 'medium');
    this.quality = q;

    const pr = q === 'low' ? 0.75 : (q === 'medium' ? 1.0 : Math.min(2.0, window.devicePixelRatio || 1));
    this.renderer.setPixelRatio(pr);
    this.renderer.toneMapping = q === 'high' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.04;

    this.map.applyQuality(q, this.renderer);
    this.effects.applyQuality(q);
    this.weapons.applyQuality(q);
    for (const ent of this.allEntities) {
      ent.rig?.applyQuality(q);
    }
    this.resize();
  }

  resize() {
    if (this.disposed) return;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w <= 0 || h <= 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.weapons.resize(w / h);
  }

  _bindEvents() {
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    this._onPointerLockChange = () => {
      const wasLocked = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (wasLocked && !this.pointerLocked && this.running && !this.paused && !this.buyMenuOpen && this.roundState.phase !== 'MATCH_END') {
        this.setPaused(true);
      } else if (this.pointerLocked && this.paused) {
        this.setPaused(false);
      }
      this._pushHud();
    };
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    this._onMouseMove = (e) => {
      if (!this.running || !this.pointerLocked || this.paused || this.buyMenuOpen) return;
      const def = this.weapons.getActiveWeaponDef();
      let sensMult = 1.0;
      if (this.weapons.scopeZoom === 1) sensMult = def.scopeSens1 || 0.5;
      else if (this.weapons.scopeZoom === 2) sensMult = def.scopeSens2 || 0.24;

      const dx = Math.max(-140, Math.min(140, e.movementX || 0));
      const dy = Math.max(-140, Math.min(140, e.movementY || 0));
      const radPerPx = 0.0022 * this.sensitivity * sensMult;
      this.yaw -= dx * radPerPx;
      this.pitch -= dy * radPerPx;
      const limit = Math.PI * 0.49;
      if (this.pitch > limit) this.pitch = limit;
      if (this.pitch < -limit) this.pitch = -limit;
    };
    document.addEventListener('mousemove', this._onMouseMove);

    this._onMouseDown = (e) => {
      if (!this.running || this.paused || this.buyMenuOpen) return;
      if (!this.pointerLocked) {
        if (e.target === this.canvas) {
          this.requestLock();
        }
        return;
      }

      if (!this.localPlayer.alive) {
        if (e.button === 0) this._cycleSpectate(1);
        return;
      }

      if (e.button === 0) {
        this.input.fire = true;
        if (this.weapons.getActiveWeaponId() !== 'c4') {
          this._tryLocalFire(false);
        }
      } else if (e.button === 2) {
        const wId = this.weapons.getActiveWeaponId();
        const def = this.weapons.getActiveWeaponDef();
        if (def.hasScope) {
          const z = this.weapons.toggleScope();
          cs2Audio.playScopeToggle(z);
          this._updateCameraFov();
          this._pushHud();
        } else if (wId === 'knife') {
          this._tryLocalFire(true);
        }
      }
    };
    window.addEventListener('mousedown', this._onMouseDown);

    this._onMouseUp = (e) => {
      if (e.button === 0) {
        this.input.fire = false;
      }
    };
    window.addEventListener('mouseup', this._onMouseUp);

    this._onWheel = (e) => {
      if (!this.running || this.paused || this.buyMenuOpen || !this.pointerLocked) return;
      // MouseWheelDown triggers Bunny Hop jump buffer cleanly!
      if (e.deltaY > 0 && this.localPlayer.alive) {
        this.movement.queueJump();
      }
    };
    window.addEventListener('wheel', this._onWheel, { passive: true });

    this._onContextMenu = (e) => {
      if (this.running) e.preventDefault();
    };
    this.canvas.addEventListener('contextmenu', this._onContextMenu);

    this._onKeyDown = (e) => {
      if (!this.running) return;
      const kb = this.keybinds || DEFAULT_KEYBINDS;

      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.buyMenuOpen) {
          this.setBuyMenuOpen(false);
          this.requestLock();
        } else {
          this.setPaused(!this.paused);
        }
        return;
      }

      if (e.code === 'Tab') {
        e.preventDefault();
        this.scoreboardOpen = true;
        this.cb.onScoreboardChange?.(true, this._buildScoreboardData());
        return;
      }

      if (e.code === 'KeyB') {
        e.preventDefault();
        if (!this.paused && this.roundState.phase !== 'MATCH_END') {
          const next = !this.buyMenuOpen;
          this.setBuyMenuOpen(next);
          if (!next) this.requestLock();
        }
        return;
      }

      // Buy menu 1-7 numeric hotkeys
      if (this.buyMenuOpen) {
        const keyMap = {
          Digit1: 'pistol',
          Digit2: 'deagle',
          Digit3: 'm4a1',
          Digit4: 'ak47',
          Digit5: 'awp',
          Digit6: 'kevlar',
          Digit7: 'helmet'
        };
        if (keyMap[e.code]) {
          e.preventDefault();
          this.buyItem(keyMap[e.code]);
        }
        return;
      }

      if (this.paused) return;

      if (e.code === kb.moveForward || e.code === 'KeyW') this.input.forward = true;
      else if (e.code === kb.moveBackward || e.code === 'KeyS') this.input.backward = true;
      else if (e.code === kb.moveLeft || e.code === 'KeyA') this.input.left = true;
      else if (e.code === kb.moveRight || e.code === 'KeyD') this.input.right = true;
      else if (e.code === kb.sprint || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.input.walk = true;
      else if (e.code === kb.crouch || e.code === 'ControlLeft' || e.code === 'ControlRight') this.input.crouch = true;
      else if (e.code === kb.interact || e.code === 'KeyE') this.input.interact = true;
      else if ((e.code === kb.jump || e.code === 'Space') && !e.repeat) {
        e.preventDefault();
        if (this.localPlayer.alive) {
          this.movement.queueJump();
        } else {
          this._cycleSpectate(1);
        }
      } else if (e.code === kb.reload || e.code === 'KeyR') {
        if (this.localPlayer.alive && this.weapons.startReload()) {
          cs2Audio.playReloadStart(this.weapons.getActiveWeaponId());
          this._updateCameraFov();
          this._pushHud();
        }
      } else if (e.code === kb.slot1 || e.code === 'Digit1') {
        this._switchSlot(0);
      } else if (e.code === kb.slot2 || e.code === 'Digit2') {
        this._switchSlot(1);
      } else if (e.code === kb.slot3 || e.code === 'Digit3') {
        this._switchSlot(2);
      } else if (e.code === 'Digit4') {
        this._switchSlot(3);
      } else if (e.code === 'KeyQ') {
        const cur = this.weapons.activeSlot;
        if (this.weapons.slots[this.prevSlot] && this.prevSlot !== cur) {
          this._switchSlot(this.prevSlot);
        } else {
          this._switchSlot(cur === 0 ? 1 : (this.weapons.slots[0] ? 0 : 2));
        }
      } else if (this.playType === 'training' && (e.code === kb.respawn || e.code === 'KeyT')) {
        this._respawnEntity(this.localPlayer);
      }
    };
    window.addEventListener('keydown', this._onKeyDown);

    this._onKeyUp = (e) => {
      if (!this.running) return;
      const kb = this.keybinds || DEFAULT_KEYBINDS;

      if (e.code === 'Tab') {
        this.scoreboardOpen = false;
        this.cb.onScoreboardChange?.(false, null);
        return;
      }

      if (e.code === kb.moveForward || e.code === 'KeyW') this.input.forward = false;
      else if (e.code === kb.moveBackward || e.code === 'KeyS') this.input.backward = false;
      else if (e.code === kb.moveLeft || e.code === 'KeyA') this.input.left = false;
      else if (e.code === kb.moveRight || e.code === 'KeyD') this.input.right = false;
      else if (e.code === kb.sprint || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.input.walk = false;
      else if (e.code === kb.crouch || e.code === 'ControlLeft' || e.code === 'ControlRight') this.input.crouch = false;
      else if (e.code === kb.interact || e.code === 'KeyE') this.input.interact = false;
    };
    window.addEventListener('keyup', this._onKeyUp);
  }

  _bindNetworkEvents() {
    this._networkUnsubs.push(
      cs2Network.on('cs2_peer_state', (data) => {
        if (!this.running || this.playType !== 'online' || !data?.id) return;
        const peer = this.peers.get(data.id);
        if (!peer) return;
        peer.x = data.x;
        peer.y = data.y;
        peer.z = data.z;
        peer.yaw = data.yaw;
        peer.pitch = data.pitch;
        peer.crouch = Boolean(data.crouch);
        peer.weaponId = data.weaponId || 'pistol';
        peer.hp = data.hp;
        peer.alive = Boolean(data.alive);
        if (peer.rig) {
          peer.rig.root.position.set(peer.x, peer.y, peer.z);
          peer.rig.root.rotation.y = peer.yaw;
          peer.rig.setCrouch(peer.crouch);
          peer.rig.setWeapon(peer.weaponId);
          peer.rig.setAlive(peer.alive);
          peer.rig.update(0.05, (data.speed || 0) / CS2_SOURCE_SCALE, peer.pitch);
        }
      }),
      cs2Network.on('cs2_peer_shoot', (data) => {
        if (!this.running || this.playType !== 'online' || !data) return;
        const dist = Math.hypot(data.ox - this.localPlayer.x, data.oz - this.localPlayer.z);
        cs2Audio.playWeaponFire(data.weaponId, dist);
        this.effects.spawnTracer(data.ox, data.oy, data.oz, data.hx, data.hy, data.hz);
        if (data.hitWall) {
          this.effects.spawnBulletHole(data.hx, data.hy, data.hz, data.nx, data.ny, data.nz);
          this.effects.spawnSparks(data.hx, data.hy, data.hz, 3, 0xffd166, 4.5);
        }
      }),
      cs2Network.on('cs2_hit_event', (data) => {
        if (!this.running || this.playType !== 'online' || !data) return;
        const target = this.allEntities.find((e) => e.id === data.targetId);
        const attacker = this.allEntities.find((e) => e.id === data.attackerId);
        if (!target || !target.alive) return;
        this._applyDamage(attacker, target, data.damage, data.hitZone, data.weaponId, true);
      }),
      cs2Network.on('cs2_bomb_event', (data) => {
        if (!this.running || this.playType !== 'online' || !data) return;
        if (data.type === 'planted' && !this.bombState.planted) {
          this._executeBombPlant(null, data.site, data.x, data.y, data.z, true);
        } else if (data.type === 'defused' && this.bombState.planted) {
          this._executeBombDefuse(null, true);
        }
      }),
      cs2Network.on('cs2_player_left', (data) => {
        if (!this.running || this.playType !== 'online' || !data?.id) return;
        const peer = this.peers.get(data.id);
        if (peer) {
          if (peer.rig) {
            this.scene.remove(peer.rig.root);
            peer.rig.dispose();
          }
          this.peers.delete(data.id);
          this._rebuildEntityList();
        }
      }),
      cs2Network.on('cs2_host_sync', (data) => {
        if (!this.running || this.playType !== 'online' || this.isHost || !data) return;
        const roundChanged = data.roundNum !== this.roundState.roundNum;
        if (data.halftimeDone && !this.roundState.halftimeDone) {
          this._performHalftimeSwap();
        }
        this.roundState.phase = data.phase;
        this.roundState.timeLeft = data.timeLeft;
        this.roundState.roundNum = data.roundNum;
        this.roundState.ctScore = data.ctScore;
        this.roundState.tScore = data.tScore;
        if (roundChanged) {
          this._startRound(false);
        }
        if (typeof data.bombTime === 'number') {
          this.bombState.timeLeft = data.bombTime;
        }
        if (Array.isArray(data.bots)) {
          for (const bSnap of data.bots) {
            const b = this.bots.find((x) => x.id === bSnap.id);
            if (!b) continue;
            b.x = bSnap.x;
            b.y = bSnap.y;
            b.z = bSnap.z;
            b.yaw = bSnap.yaw;
            b.crouch = bSnap.crouch;
            b.weaponId = bSnap.weaponId;
            b.hp = bSnap.hp;
            b.alive = bSnap.alive;
            if (b.rig) {
              b.rig.root.position.set(b.x, b.y, b.z);
              b.rig.root.rotation.y = b.yaw;
              b.rig.setCrouch(b.crouch);
              b.rig.setWeapon(b.weaponId);
              b.rig.setAlive(b.alive);
            }
          }
        }
      })
    );
  }

  _switchSlot(slotIdx) {
    if (!this.localPlayer.alive) return;
    if (!this.weapons.slots[slotIdx]) return;
    if (this.weapons.activeSlot !== slotIdx) {
      this.prevSlot = this.weapons.activeSlot;
      this.weapons.selectSlot(slotIdx);
      this.localPlayer.weaponId = this.weapons.getActiveWeaponId();
      this._updateCameraFov();
      this._pushHud();
    }
  }

  _updateCameraFov() {
    const def = this.weapons.getActiveWeaponDef();
    let targetFov = 78;
    if (this.weapons.scopeZoom === 1) targetFov = def.scopeFov1 || 40;
    else if (this.weapons.scopeZoom === 2) targetFov = def.scopeFov2 || 16;
    if (this.camera.fov !== targetFov) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }
  }

  requestLock() {
    if (!this.running || this.paused || this.buyMenuOpen) return;
    if (document.pointerLockElement !== this.canvas) {
      try {
        const res = this.canvas.requestPointerLock?.();
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
      } catch {
        // Ignore pointer lock rejection when document is unfocused
      }
    }
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) {
      this.buyMenuOpen = false;
      this.cb.onBuyMenuChange?.(false, this._getBuyState());
      this._clearInputs();
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock?.();
      }
    }
    this.cb.onPauseChange?.(this.paused);
  }

  setBuyMenuOpen(open) {
    if (open && !this.canBuyNow()) {
      this.cb.onBanner?.(t('cs2_buy_expired'), 'warn');
      cs2Audio.playBuyDenied();
      return;
    }
    this.buyMenuOpen = Boolean(open);
    if (this.buyMenuOpen) {
      this._clearInputs();
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock?.();
      }
    }
    this.cb.onBuyMenuChange?.(this.buyMenuOpen, this._getBuyState());
  }

  _clearInputs() {
    for (const k of Object.keys(this.input)) {
      this.input[k] = false;
    }
  }

  canBuyNow() {
    if (!this.localPlayer.alive) return false;
    if (this.playType === 'training' || this.modeCfg.buyAnywhere) return true;
    if (this.roundState.phase === 'FREEZE') return true;
    // Allow buying within first 20s of live round if close to spawn
    const elapsed = this.modeCfg.liveTime - this.roundState.timeLeft;
    if (this.roundState.phase === 'LIVE' && elapsed <= 20) {
      const spawns = this.map.getSpawns(this.modeId, this.localPlayer.team);
      const sp = spawns[0];
      if (sp && Math.hypot(this.localPlayer.x - sp.x, this.localPlayer.z - sp.z) <= 10.5) {
        return true;
      }
    }
    return false;
  }

  _getBuyState() {
    return {
      money: this.localPlayer.money,
      armor: this.localPlayer.armor,
      hasHelmet: this.localPlayer.hasHelmet,
      primaryId: this.weapons.slots[0],
      secondaryId: this.weapons.slots[1],
      canBuy: this.canBuyNow()
    };
  }

  buyItem(itemId) {
    if (!this.canBuyNow()) {
      cs2Audio.playBuyDenied();
      return false;
    }

    if (itemId === 'kevlar') {
      if (this.localPlayer.armor >= 100) {
        cs2Audio.playBuyDenied();
        return false;
      }
      if (this.localPlayer.money < CS2_ECONOMY.KEVLAR_PRICE) {
        cs2Audio.playBuyDenied();
        return false;
      }
      this.localPlayer.money -= CS2_ECONOMY.KEVLAR_PRICE;
      this.localPlayer.armor = 100;
      cs2Audio.playBuyItem();
      this.cb.onBuyMenuChange?.(this.buyMenuOpen, this._getBuyState());
      this._pushHud();
      return true;
    }

    if (itemId === 'helmet') {
      if (this.localPlayer.hasHelmet && this.localPlayer.armor >= 100) {
        cs2Audio.playBuyDenied();
        return false;
      }
      const price = this.localPlayer.armor >= 100
        ? CS2_ECONOMY.HELMET_UPGRADE_PRICE
        : CS2_ECONOMY.HELMET_PRICE;
      if (this.localPlayer.money < price) {
        cs2Audio.playBuyDenied();
        return false;
      }
      this.localPlayer.money -= price;
      this.localPlayer.armor = 100;
      this.localPlayer.hasHelmet = true;
      cs2Audio.playBuyItem();
      this.cb.onBuyMenuChange?.(this.buyMenuOpen, this._getBuyState());
      this._pushHud();
      return true;
    }

    const wDef = CS2_WEAPONS[itemId];
    if (!wDef || wDef.price <= 0) return false;
    if (this.localPlayer.money < wDef.price) {
      cs2Audio.playBuyDenied();
      return false;
    }
    this.localPlayer.money -= wDef.price;
    this.weapons.equipBoughtWeapon(itemId);
    this.localPlayer.weaponId = this.weapons.getActiveWeaponId();
    this._updateCameraFov();
    cs2Audio.playBuyItem();
    this.cb.onBuyMenuChange?.(this.buyMenuOpen, this._getBuyState());
    this._pushHud();
    return true;
  }

  startMatch(opts = {}) {
    this.modeId = opts.mode === 'wingman' ? 'wingman' : (opts.mode === 'training' ? 'training' : 'competitive');
    this.modeCfg = CS2_MODES[this.modeId] || CS2_MODES.competitive;
    this.playType = opts.playType === 'online' ? 'online' : (this.modeId === 'training' ? 'training' : 'bot');
    this.botDifficulty = opts.difficulty || 'medium';
    this.localTeam = opts.team === 't' ? 't' : 'ct';
    this.room = opts.room || null;
    this.isHost = this.playType !== 'online' || cs2Network.isHost();

    this.map.setMode(this.modeId);
    this.applyQuality(storage.get().quality || 'medium');

    this._clearEntities();

    this.localPlayer.id = this.playType === 'online' ? (cs2Network.getSocketId() || 'local') : 'local';
    this.localPlayer.name = storage.get().playerName || 'Operator';
    this.localPlayer.team = this.localTeam;
    this.localPlayer.money = this.modeCfg.startMoney;
    this.localPlayer.kills = 0;
    this.localPlayer.deaths = 0;
    this.localPlayer.armor = this.modeId === 'training' ? 100 : 0;
    this.localPlayer.hasHelmet = this.modeId === 'training';
    this.weapons.resetInventory(this.localTeam, false);

    // Spawn online peers if any
    const roomPlayers = Array.isArray(this.room?.players) ? this.room.players : [];
    const myId = this.localPlayer.id;
    const meInRoom = roomPlayers.find((rp) => rp.id === myId);
    if (meInRoom) {
      this.localTeam = meInRoom.team === 't' ? 't' : 'ct';
      this.localPlayer.team = this.localTeam;
    }
    let ctPlayers = this.localTeam === 'ct' ? 1 : 0;
    let tPlayers = this.localTeam === 't' ? 1 : 0;

    for (const rp of roomPlayers) {
      if (rp.id === myId) {
        continue;
      }
      const pTeam = rp.team === 't' ? 't' : 'ct';
      if (pTeam === 'ct') ctPlayers++;
      else tPlayers++;

      const rig = createTacticalAgentRig(rp.id, pTeam, this.quality);
      this.scene.add(rig.root);
      const peerEnt = {
        id: rp.id,
        name: rp.name || 'Friend',
        team: pTeam,
        isBot: false,
        isLocal: false,
        alive: true,
        hp: 100,
        armor: 0,
        hasHelmet: false,
        money: this.modeCfg.startMoney,
        kills: 0,
        deaths: 0,
        hasBomb: false,
        x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false,
        weaponId: 'pistol',
        rig
      };
      this.peers.set(rp.id, peerEnt);
    }

    // Fill remaining slots with AI bots (if bot/training or fillBots enabled)
    const shouldFillBots = this.playType !== 'online' || this.room?.fillBots !== false;
    if (shouldFillBots) {
      const cap = this.modeCfg.teamSize;
      const needCT = Math.max(0, cap - ctPlayers);
      const needT = Math.max(0, cap - tPlayers);

      for (let i = 0; i < needCT; i++) {
        this._spawnBotRecord(`bot_ct_${i}`, CS2_BOT_NAMES_CT[i % CS2_BOT_NAMES_CT.length], 'ct', i);
      }
      for (let i = 0; i < needT; i++) {
        this._spawnBotRecord(`bot_t_${i}`, CS2_BOT_NAMES_T[i % CS2_BOT_NAMES_T.length], 't', i);
      }
    }

    this._rebuildEntityList();

    this.roundState = {
      phase: 'FREEZE',
      timeLeft: this.modeCfg.freezeTime,
      roundNum: 1,
      ctScore: 0,
      tScore: 0,
      ctLossStreak: 0,
      tLossStreak: 0,
      halftimeDone: false,
      winnerTeam: null
    };

    this._startRound(true);

    this.running = true;
    this.paused = false;
    this.buyMenuOpen = false;
    this.lastFrameTime = performance.now();
    this.resize();
    this.rafId = requestAnimationFrame((now) => this._loop(now));
    this.cb.onBanner?.(t('cs2_banner_freeze'), 'info');
  }

  _spawnBotRecord(id, name, team, slotIndex) {
    const rig = createTacticalAgentRig(id, team, this.quality);
    this.scene.add(rig.root);
    this.bots.push({
      id,
      name,
      team,
      slotIndex,
      isBot: true,
      isLocal: false,
      alive: true,
      hp: 100,
      armor: this.modeId === 'training' ? 100 : 0,
      hasHelmet: this.modeId === 'training',
      money: this.modeCfg.startMoney,
      kills: 0,
      deaths: 0,
      hasBomb: false,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false,
      weaponId: 'pistol',
      primaryId: null,
      secondaryId: 'pistol',
      mag: 12,
      reserve: 36,
      cooldown: 0,
      reloading: false,
      reloadTimer: 0,
      rig,
      ai: null
    });
  }

  _rebuildEntityList() {
    this.allEntities = [this.localPlayer, ...this.peers.values(), ...this.bots];
  }

  _clearEntities() {
    for (const b of this.bots) {
      if (b.rig) {
        this.scene.remove(b.rig.root);
        b.rig.dispose();
      }
    }
    for (const p of this.peers.values()) {
      if (p.rig) {
        this.scene.remove(p.rig.root);
        p.rig.dispose();
      }
    }
    this.bots.length = 0;
    this.peers.clear();
    this.allEntities.length = 0;
  }

  _startRound(isFirstRound = false) {
    this.effects.clearRound();
    this.c4WorldMesh.visible = false;
    this.c4DropMesh.visible = false;
    this.droppedBomb.active = false;
    this.spectateTargetId = null;

    this.bombState = {
      planted: false,
      site: 'A',
      x: 0, y: 0, z: 0,
      timeLeft: this.modeCfg.bombTimer,
      beepAccum: 0,
      ledTimer: 0,
      plantProgress: 0,
      defuseProgress: 0,
      plantTickStep: 0,
      plantingSite: null
    };

    this.roundState.phase = 'FREEZE';
    this.roundState.timeLeft = this.modeCfg.freezeTime;

    const ctSpawns = this.map.getSpawns(this.modeId, 'ct');
    const tSpawns = this.map.getSpawns(this.modeId, 't');
    let ctIdx = 0;
    let tIdx = 0;

    // Assign C4 carrier (prefer local human if T, else first T)
    let c4Assigned = false;
    const tEntities = this.allEntities.filter((e) => e.team === 't');
    for (const ent of this.allEntities) ent.hasBomb = false;
    if (this.modeId !== 'training' && tEntities.length > 0) {
      const carrier = tEntities.find((e) => e.isLocal) || tEntities[0];
      carrier.hasBomb = true;
      c4Assigned = true;
    }

    for (const ent of this.allEntities) {
      const pool = ent.team === 'ct' ? ctSpawns : tSpawns;
      const idx = ent.team === 'ct' ? ctIdx++ : tIdx++;
      const sp = pool[idx % pool.length];

      // Preserve guns if survived previous round (unless first round or post-halftime)
      const keepLoadout = !isFirstRound && ent.alive && !this._justSwappedHalftime;
      ent.alive = true;
      ent.hp = 100;
      ent.crouch = false;
      ent.x = sp.x;
      ent.y = sp.y;
      ent.z = sp.z;
      ent.yaw = sp.yaw;
      ent.pitch = 0;

      if (ent.isLocal) {
        this.movement.reset(sp);
        this.yaw = sp.yaw;
        this.pitch = 0;
        if (!keepLoadout) {
          this.weapons.resetInventory(ent.team, ent.hasBomb);
          ent.armor = this.modeId === 'training' ? 100 : 0;
          ent.hasHelmet = this.modeId === 'training';
        } else {
          this.weapons.refillAmmo();
          this.weapons.setHasC4(ent.hasBomb);
          this.weapons.clearScope();
        }
        ent.weaponId = this.weapons.getActiveWeaponId();
      } else if (ent.isBot) {
        if (!keepLoadout) {
          ent.primaryId = null;
          ent.secondaryId = 'pistol';
          ent.armor = this.modeId === 'training' ? 100 : 0;
          ent.hasHelmet = this.modeId === 'training';
        }
        ent.reloading = false;
        ent.cooldown = 0;
        this.botManager.buyForBot(ent, this.modeId);
        ent.rig.root.position.set(ent.x, ent.y, ent.z);
        ent.rig.root.rotation.y = ent.yaw;
        ent.rig.setAlive(true);
        ent.rig.setCrouch(false);
        ent.rig.setWeapon(ent.weaponId);
        ent.rig.setHasBomb(ent.hasBomb);
      } else {
        ent.rig?.root.position.set(ent.x, ent.y, ent.z);
        ent.rig?.setAlive(true);
      }
    }
    this._justSwappedHalftime = false;
    this.botManager.assignRoundPlans(this.bots, this.modeId);
    this._updateCameraFov();
    this._pushHud();
    if (this.buyMenuOpen) {
      this.cb.onBuyMenuChange?.(true, this._getBuyState());
    }
    if (!c4Assigned && this.modeId !== 'training') {
      // No T players present
    }
  }

  _respawnEntity(ent) {
    const pool = this.map.getSpawns(this.modeId, ent.team);
    const sp = pool[Math.floor(Math.random() * pool.length)];
    ent.alive = true;
    ent.hp = 100;
    ent.armor = 100;
    ent.hasHelmet = true;
    ent.x = sp.x;
    ent.y = sp.y;
    ent.z = sp.z;
    ent.yaw = sp.yaw;
    ent.pitch = 0;
    if (ent.isLocal) {
      this.movement.reset(sp);
      this.yaw = sp.yaw;
      this.pitch = 0;
      this.weapons.refillAmmo();
      this.weapons.clearScope();
    } else if (ent.rig) {
      ent.rig.root.position.set(ent.x, ent.y, ent.z);
      ent.rig.setAlive(true);
      ent.rig.setCrouch(false);
    }
  }

  _getEnemyHitboxesForTeam(attackerTeam) {
    const list = [];
    for (let i = 0; i < this.allEntities.length; i++) {
      const e = this.allEntities[i];
      if (!e.alive || e.team === attackerTeam || !e.rig) continue;
      for (let h = 0; h < e.rig.hitboxes.length; h++) {
        list.push(e.rig.hitboxes[h]);
      }
    }
    return list;
  }

  _tryLocalFire(isHeavyKnife = false) {
    const frozen = this.roundState.phase === 'FREEZE' || this.roundState.phase === 'MATCH_END';
    if (!this.weapons.canFire(frozen)) {
      if (!frozen && this.weapons.cooldown <= 0 && !this.weapons.reloading) {
        const info = this.weapons.getAmmoInfo();
        if (info.mag === 0) {
          cs2Audio.playDryFire();
          if (this.weapons.startReload()) {
            cs2Audio.playReloadStart(this.weapons.getActiveWeaponId());
          }
        }
      }
      return;
    }

    const shot = this.weapons.consumeShot(this.movement, isHeavyKnife);
    if (!shot) return;

    cs2Audio.playWeaponFire(shot.weaponId, 0);
    this._updateCameraFov();

    const origin = this._camOrigin.copy(this.camera.position);
    this.camera.getWorldDirection(this._camDir);

    const wallMeshes = this.map.getRaycastMeshes(this.modeId);
    const enemyHitboxes = this._getEnemyHitboxesForTeam(this.localPlayer.team);

    const hit = this.weapons.castShotRay(
      origin,
      this._camDir,
      shot.spreadRad,
      shot.sprayYawRad,
      shot.sprayPitchRad,
      shot.range,
      wallMeshes,
      enemyHitboxes
    );

    if (shot.weaponId !== 'knife') {
      const muzzleStart = origin.clone().addScaledVector(this._camDir, 0.55);
      muzzleStart.y -= 0.08;
      this.effects.spawnTracer(muzzleStart.x, muzzleStart.y, muzzleStart.z, hit.point.x, hit.point.y, hit.point.z);
    }

    if (hit.type === 'wall') {
      if (shot.weaponId === 'knife') {
        cs2Audio.playKnifeHit(false);
      } else {
        this.effects.spawnBulletHole(hit.point.x, hit.point.y, hit.point.z, hit.normal.x, hit.normal.y, hit.normal.z);
      }
      this.effects.spawnSparks(hit.point.x, hit.point.y, hit.point.z, 4, 0xffd166, 4.8);
    } else if (hit.type === 'entity') {
      const target = this.allEntities.find((e) => e.id === hit.entityId);
      if (target && target.alive) {
        const mult = CS2_HIT_MULT[hit.hitZone] || 1.0;
        const rawDmg = shot.damage * mult;
        const isHeadshot = hit.hitZone === 'head';
        if (shot.weaponId === 'knife') {
          cs2Audio.playKnifeHit(isHeadshot);
        }
        this.effects.spawnSparks(hit.point.x, hit.point.y, hit.point.z, isHeadshot ? 7 : 4, isHeadshot ? 0xfacc15 : 0xef4444, 5.5);

        if (this.playType === 'online' && !target.isBot) {
          cs2Network.sendHit({
            attackerId: this.localPlayer.id,
            targetId: target.id,
            damage: rawDmg,
            hitZone: hit.hitZone,
            weaponId: shot.weaponId
          });
        } else {
          this._applyDamage(this.localPlayer, target, rawDmg, hit.hitZone, shot.weaponId, false);
        }
      }
    }

    if (this.playType === 'online' && shot.weaponId !== 'knife') {
      cs2Network.sendShoot({
        weaponId: shot.weaponId,
        ox: origin.x, oy: origin.y - 0.1, oz: origin.z,
        hx: hit.point.x, hy: hit.point.y, hz: hit.point.z,
        hitWall: hit.type === 'wall',
        nx: hit.normal?.x || 0, ny: hit.normal?.y || 1, nz: hit.normal?.z || 0
      });
    }

    if (shot.autoReloadNeeded) {
      if (this.weapons.startReload()) {
        cs2Audio.playReloadStart(shot.weaponId);
      }
    }
    this._pushHud();
  }

  _handleBotShoot(bot, target, profile) {
    const wDef = CS2_WEAPONS[bot.weaponId] || CS2_WEAPONS.pistol;
    const eyeY = bot.y + (bot.crouch ? CS2_MOVE.EYE_CROUCH : CS2_MOVE.EYE_STAND);
    const origin = new THREE.Vector3(bot.x, eyeY, bot.z);

    const targetAimY = target.y + (target.crouch ? 1.02 : 1.44);
    const aimPoint = new THREE.Vector3(target.x, targetAimY, target.z);
    const dir = aimPoint.sub(origin).normalize();

    const distToLocal = Math.hypot(bot.x - this.localPlayer.x, bot.z - this.localPlayer.z);
    cs2Audio.playWeaponFire(bot.weaponId, distToLocal);
    this.effects.spawnWorldMuzzleFlash(
      bot.x - Math.sin(bot.yaw) * 0.65,
      eyeY - 0.12,
      bot.z - Math.cos(bot.yaw) * 0.65,
      this.camera
    );

    // Bot jitter + hit check
    const jitter = profile.aimJitter;
    dir.x += (Math.random() - 0.5) * jitter;
    dir.y += (Math.random() - 0.5) * jitter * 0.7;
    dir.z += (Math.random() - 0.5) * jitter;
    dir.normalize();

    const wallMeshes = this.map.getRaycastMeshes(this.modeId);
    this._raycaster.set(origin, dir);
    this._raycaster.near = 0.1;
    this._raycaster.far = wDef.range;
    const wallHits = this._raycaster.intersectObjects(wallMeshes, false);
    const wallHit = wallHits.length > 0 ? wallHits[0] : null;
    const maxDist = wallHit ? wallHit.distance : wDef.range;

    let hitPoint = origin.clone().addScaledVector(dir, maxDist);

    if (target.isLocal && target.alive) {
      // Test ray-cylinder distance against local player
      const toLocal = new THREE.Vector3(target.x - origin.x, 0, target.z - origin.z);
      const flatDir = new THREE.Vector3(dir.x, 0, dir.z);
      const flatLen = flatDir.length();
      if (flatLen > 0.01) {
        flatDir.multiplyScalar(1 / flatLen);
        const proj = toLocal.dot(flatDir);
        const targetDist = Math.hypot(target.x - origin.x, target.z - origin.z);
        if (proj > 0 && targetDist <= maxDist) {
          const perp = Math.hypot(toLocal.x - flatDir.x * proj, toLocal.z - flatDir.z * proj);
          const rayYAtTarget = origin.y + dir.y * (proj / flatLen);
          const h = target.crouch ? CS2_MOVE.CROUCH_HEIGHT : CS2_MOVE.STAND_HEIGHT;
          if (perp <= 0.36 && rayYAtTarget >= target.y && rayYAtTarget <= target.y + h + 0.08) {
            const isHs = rayYAtTarget >= target.y + h - 0.32 || Math.random() < profile.headshotBias * 0.35;
            const zone = isHs ? 'head' : (rayYAtTarget < target.y + 0.75 ? 'legs' : 'body');
            const mult = CS2_HIT_MULT[zone];
            hitPoint.set(target.x, rayYAtTarget, target.z);
            this._applyDamage(bot, target, wDef.damage * mult, zone, bot.weaponId, false);
            this.effects.spawnTracer(origin.x, origin.y - 0.1, origin.z, hitPoint.x, hitPoint.y, hitPoint.z);
            return;
          }
        }
      }
    } else if (!target.isLocal && target.rig) {
      const hits = this._raycaster.intersectObjects(target.rig.hitboxes, false);
      if (hits.length > 0 && hits[0].distance <= maxDist) {
        const zone = hits[0].object.userData.hitZone || 'body';
        const mult = CS2_HIT_MULT[zone];
        hitPoint.copy(hits[0].point);
        this._applyDamage(bot, target, wDef.damage * mult, zone, bot.weaponId, false);
        this.effects.spawnTracer(origin.x, origin.y - 0.1, origin.z, hitPoint.x, hitPoint.y, hitPoint.z);
        return;
      }
    }

    this.effects.spawnTracer(origin.x, origin.y - 0.1, origin.z, hitPoint.x, hitPoint.y, hitPoint.z);
    if (wallHit && wallHit.face) {
      const n = wallHit.face.normal.clone().transformDirection(wallHit.object.matrixWorld);
      this.effects.spawnBulletHole(hitPoint.x, hitPoint.y, hitPoint.z, n.x, n.y, n.z);
    }
  }

  _applyDamage(attacker, target, rawDmg, hitZone, weaponId, fromNetwork = false) {
    if (!target || !target.alive) return;
    const wDef = CS2_WEAPONS[weaponId] || CS2_WEAPONS.ak47;
    const armorPen = wDef.armorPen ?? 0.75;

    let finalDmg = rawDmg;
    const armoredZone = hitZone === 'body' || (hitZone === 'head' && target.hasHelmet);
    if (target.armor > 0 && armoredZone) {
      finalDmg = rawDmg * armorPen;
      const armorDrain = Math.max(1, Math.round(rawDmg * (1 - armorPen) * 0.65));
      target.armor = Math.max(0, target.armor - armorDrain);
    }

    const dmgInt = Math.max(1, Math.round(finalDmg));
    target.hp = Math.max(0, target.hp - dmgInt);
    const killed = target.hp <= 0;
    const isHeadshot = hitZone === 'head';

    if (attacker?.isLocal) {
      cs2Audio.playHitFeedback(isHeadshot, killed);
      this.cb.onHitMarker?.(dmgInt, isHeadshot);
    }

    if (target.isLocal) {
      if (this._damageFlashCooldown <= 0) {
        cs2Audio.playTookDamage(isHeadshot);
        this.cb.onDamageFlash?.();
        this._damageFlashCooldown = 0.08;
      }
    }

    if (killed) {
      target.alive = false;
      target.deaths += 1;
      if (attacker && attacker.id !== target.id) {
        attacker.kills += 1;
        const reward = wDef.killReward || CS2_ECONOMY.KILL_REWARD_DEFAULT;
        attacker.money = Math.min(CS2_ECONOMY.MAX_MONEY, attacker.money + reward);
      }

      if (target.hasBomb && !this.bombState.planted && this.modeId !== 'training') {
        target.hasBomb = false;
        this.droppedBomb = { active: true, x: target.x, y: target.y + 0.08, z: target.z };
        this.c4DropMesh.position.set(this.droppedBomb.x, this.droppedBomb.y, this.droppedBomb.z);
        this.c4DropMesh.visible = true;
        if (target.isLocal) this.weapons.setHasC4(false);
      }

      if (target.rig) {
        target.rig.setAlive(false);
        target.rig.setHasBomb(false);
      }

      if (target.isLocal) {
        this.weapons.clearScope();
        this._updateCameraFov();
        this.buyMenuOpen = false;
        this.cb.onBuyMenuChange?.(false, this._getBuyState());
        this._cycleSpectate(1);
      }

      this.cb.onKillfeed?.({
        killer: attacker ? attacker.name : 'World',
        killerTeam: attacker ? attacker.team : 'ct',
        victim: target.name,
        victimTeam: target.team,
        weapon: wDef.shortName,
        headshot: isHeadshot
      });

      if (this.playType === 'training' && target.isBot) {
        setTimeout(() => {
          if (!this.disposed && this.running) this._respawnEntity(target);
        }, 1800);
      } else if (this.playType === 'training' && target.isLocal) {
        this._trainingRespawnTimer = 1.6;
      } else if (this.isHost) {
        this._checkRoundElimination();
      }
    }

    this._pushHud();
  }

  _checkRoundElimination() {
    if (this.roundState.phase !== 'LIVE' && this.roundState.phase !== 'BOMB_PLANTED') return;
    if (this.modeId === 'training') return;

    const ctAlive = this.allEntities.some((e) => e.team === 'ct' && e.alive);
    const tAlive = this.allEntities.some((e) => e.team === 't' && e.alive);

    if (!ctAlive && !tAlive) {
      this._endRound(this.bombState.planted ? 't' : 'ct', 'elim');
    } else if (!ctAlive) {
      this._endRound('t', 'elim');
    } else if (!tAlive && !this.bombState.planted) {
      // CTs win immediately if all Ts die BEFORE bomb is planted
      this._endRound('ct', 'elim');
    }
  }

  _executeBombPlant(planter, site, x, y, z, fromNet = false) {
    if (this.bombState.planted || this.roundState.phase !== 'LIVE') return;
    this.bombState.planted = true;
    this.bombState.site = site;
    this.bombState.x = x;
    this.bombState.y = y + 0.07;
    this.bombState.z = z;
    this.bombState.timeLeft = this.modeCfg.bombTimer;
    this.bombState.beepAccum = 0;
    this.bombState.plantProgress = 0;

    this.c4DropMesh.visible = false;
    this.droppedBomb.active = false;
    this.c4WorldMesh.position.set(this.bombState.x, this.bombState.y, this.bombState.z);
    this.c4WorldMesh.visible = true;

    for (const e of this.allEntities) e.hasBomb = false;
    this.weapons.setHasC4(false);
    if (planter) {
      planter.money = Math.min(CS2_ECONOMY.MAX_MONEY, planter.money + CS2_ECONOMY.PLANT_REWARD);
    }

    this.roundState.phase = 'BOMB_PLANTED';
    this.roundState.timeLeft = this.modeCfg.bombTimer;

    cs2Audio.playC4Planted();
    this.cb.onBanner?.(t('cs2_banner_planted', { site }), 'warn');

    if (!fromNet && this.playType === 'online') {
      cs2Network.sendBombEvent({ type: 'planted', site, x, y, z });
    }
    this._pushHud();
  }

  _executeBombDefuse(defuser, fromNet = false) {
    if (!this.bombState.planted || this.roundState.phase !== 'BOMB_PLANTED') return;
    this.bombState.planted = false;
    this.c4WorldMesh.visible = false;
    if (defuser) {
      defuser.money = Math.min(CS2_ECONOMY.MAX_MONEY, defuser.money + CS2_ECONOMY.DEFUSE_REWARD);
    }
    cs2Audio.playC4Defused();
    if (!fromNet && this.playType === 'online') {
      cs2Network.sendBombEvent({ type: 'defused' });
    }
    this._endRound('ct', 'defused');
  }

  _endRound(winnerTeam, reason) {
    if (this.roundState.phase === 'ROUND_END' || this.roundState.phase === 'MATCH_END') return;
    this.roundState.phase = 'ROUND_END';
    this.roundState.timeLeft = this.modeCfg.roundEndTime;

    if (winnerTeam === 'ct') {
      this.roundState.ctScore += 1;
      this.roundState.ctLossStreak = 0;
      this.roundState.tLossStreak = Math.min(CS2_ECONOMY.LOSS_MAX_BONUS, this.roundState.tLossStreak + 1);
    } else {
      this.roundState.tScore += 1;
      this.roundState.tLossStreak = 0;
      this.roundState.ctLossStreak = Math.min(CS2_ECONOMY.LOSS_MAX_BONUS, this.roundState.ctLossStreak + 1);
    }

    // Award economy payouts
    const winReward = reason === 'detonated' || reason === 'defused'
      ? CS2_ECONOMY.WIN_OBJ_REWARD
      : CS2_ECONOMY.WIN_ELIM_REWARD;

    for (const ent of this.allEntities) {
      if (ent.team === winnerTeam) {
        ent.money = Math.min(CS2_ECONOMY.MAX_MONEY, ent.money + winReward);
      } else {
        const streak = ent.team === 'ct' ? this.roundState.ctLossStreak : this.roundState.tLossStreak;
        const lossPay = CS2_ECONOMY.LOSS_BASE + (streak - 1) * CS2_ECONOMY.LOSS_STEP;
        ent.money = Math.min(CS2_ECONOMY.MAX_MONEY, ent.money + Math.max(CS2_ECONOMY.LOSS_BASE, lossPay));
      }
    }

    const localWon = winnerTeam === this.localPlayer.team;
    cs2Audio.playRoundWin(localWon);

    const bannerKey = winnerTeam === 'ct' ? 'cs2_banner_ct_win' : 'cs2_banner_t_win';
    this.cb.onBanner?.(t(bannerKey), winnerTeam === 'ct' ? 'info' : 'warn');

    // Check match victory
    const targetWins = this.modeCfg.winsTarget;
    if (this.roundState.ctScore >= targetWins || this.roundState.tScore >= targetWins) {
      this.roundState.phase = 'MATCH_END';
      this.roundState.winnerTeam = this.roundState.ctScore >= targetWins ? 'ct' : 't';
      this.cb.onMatchEnd?.({
        winnerTeam: this.roundState.winnerTeam,
        ctScore: this.roundState.ctScore,
        tScore: this.roundState.tScore,
        localWon: this.roundState.winnerTeam === this.localPlayer.team,
        scoreboard: this._buildScoreboardData()
      });
    }
    this._pushHud();
  }

  _performHalftimeSwap() {
    this.roundState.halftimeDone = true;
    this._justSwappedHalftime = true;
    const tmpScore = this.roundState.ctScore;
    this.roundState.ctScore = this.roundState.tScore;
    this.roundState.tScore = tmpScore;
    this.roundState.ctLossStreak = 0;
    this.roundState.tLossStreak = 0;

    for (const ent of this.allEntities) {
      ent.team = ent.team === 'ct' ? 't' : 'ct';
      ent.money = this.modeCfg.startMoney;
      if (ent.rig) {
        this.scene.remove(ent.rig.root);
        ent.rig.dispose();
        ent.rig = createTacticalAgentRig(ent.id, ent.team, this.quality);
        this.scene.add(ent.rig.root);
      }
    }
    this.localTeam = this.localPlayer.team;
    this.cb.onBanner?.(t('cs2_banner_halftime'), 'info');
  }

  _cycleSpectate(step = 1) {
    const aliveTeammates = this.allEntities.filter((e) => !e.isLocal && e.team === this.localPlayer.team && e.alive);
    if (aliveTeammates.length === 0) {
      const anyAlive = this.allEntities.filter((e) => !e.isLocal && e.alive);
      if (anyAlive.length === 0) {
        this.spectateTargetId = null;
        return;
      }
      this.spectateTargetId = anyAlive[0].id;
      return;
    }
    const idx = aliveTeammates.findIndex((e) => e.id === this.spectateTargetId);
    const nextIdx = (idx + step + aliveTeammates.length) % aliveTeammates.length;
    this.spectateTargetId = aliveTeammates[nextIdx].id;
  }

  _updateLocalObjective(dt) {
    if (!this.localPlayer.alive || this.modeId === 'training') {
      this.bombState.plantProgress = 0;
      this.bombState.defuseProgress = 0;
      return;
    }

    // Auto-pickup dropped C4 for Attackers
    if (this.droppedBomb.active && this.localPlayer.team === 't' && !this.bombState.planted) {
      const d = Math.hypot(this.localPlayer.x - this.droppedBomb.x, this.localPlayer.z - this.droppedBomb.z);
      if (d <= 1.65 && Math.abs(this.localPlayer.y - this.droppedBomb.y) <= 1.2) {
        this.droppedBomb.active = false;
        this.c4DropMesh.visible = false;
        this.localPlayer.hasBomb = true;
        this.weapons.setHasC4(true);
        this.cb.onBanner?.(t('cs2_banner_bomb_pickup'), 'info');
      }
    }

    // Plant C4 (T holding E or LMB with C4 inside site)
    const activeW = this.weapons.getActiveWeaponId();
    const wantsPlant = this.localPlayer.team === 't' &&
      this.localPlayer.hasBomb &&
      !this.bombState.planted &&
      this.roundState.phase === 'LIVE' &&
      (this.input.interact || (activeW === 'c4' && this.input.fire));

    if (wantsPlant) {
      const zones = this.map.getPlantZones(this.modeId);
      const inZone = zones.find((z) =>
        this.localPlayer.x >= z.minX && this.localPlayer.x <= z.maxX &&
        this.localPlayer.z >= z.minZ && this.localPlayer.z <= z.maxZ
      );
      if (inZone && this.movement.grounded) {
        if (activeW !== 'c4') this.weapons.selectSlot(3);
        this.bombState.plantingSite = inZone.site;
        const prevStep = Math.floor(this.bombState.plantProgress / 0.45);
        this.bombState.plantProgress += dt;
        const curStep = Math.floor(this.bombState.plantProgress / 0.45);
        if (curStep > prevStep) {
          cs2Audio.playC4PlantTick(curStep);
        }
        if (this.bombState.plantProgress >= this.modeCfg.plantTime) {
          this._executeBombPlant(
            this.localPlayer,
            inZone.site,
            this.localPlayer.x,
            this.localPlayer.y,
            this.localPlayer.z,
            false
          );
        }
      } else {
        this.bombState.plantProgress = 0;
        this.bombState.plantingSite = null;
      }
    } else {
      this.bombState.plantProgress = 0;
      this.bombState.plantingSite = null;
    }

    // Defuse C4 (CT holding E within 2.35m of planted C4)
    const wantsDefuse = this.localPlayer.team === 'ct' &&
      this.bombState.planted &&
      this.roundState.phase === 'BOMB_PLANTED' &&
      this.input.interact;

    if (wantsDefuse) {
      const dist = Math.hypot(this.localPlayer.x - this.bombState.x, this.localPlayer.z - this.bombState.z);
      if (dist <= 2.35 && Math.abs(this.localPlayer.y - this.bombState.y) <= 1.5) {
        if (this.bombState.defuseProgress === 0) {
          cs2Audio.playC4DefuseStart();
        }
        this.bombState.defuseProgress += dt;
        if (this.bombState.defuseProgress >= this.modeCfg.defuseTime) {
          this._executeBombDefuse(this.localPlayer, false);
        }
      } else {
        this.bombState.defuseProgress = 0;
      }
    } else {
      this.bombState.defuseProgress = 0;
    }
  }

  _updateRoundAndBombTimers(dt) {
    if (this.roundState.phase === 'MATCH_END') return;

    if (this.roundState.phase === 'FREEZE') {
      this.roundState.timeLeft -= dt;
      if (this.roundState.timeLeft <= 0) {
        this.roundState.phase = 'LIVE';
        this.roundState.timeLeft = this.modeCfg.liveTime;
        cs2Audio.playRoundStart();
        this.cb.onBanner?.(t('cs2_banner_live'), 'info');
      }
    } else if (this.roundState.phase === 'LIVE') {
      this.roundState.timeLeft -= dt;
      if (this.roundState.timeLeft <= 0) {
        if (this.modeId === 'training') {
          this.roundState.timeLeft = this.modeCfg.liveTime;
        } else {
          // Time expired before plant -> CT wins round
          this._endRound('ct', 'time');
        }
      }
    } else if (this.roundState.phase === 'BOMB_PLANTED') {
      this.bombState.timeLeft -= dt;
      this.roundState.timeLeft = Math.max(0, this.bombState.timeLeft);

      // Accelerating 40s C4 beep cadence (1.0s -> 0.11s)
      const ratio = Math.max(0, Math.min(1, this.bombState.timeLeft / this.modeCfg.bombTimer));
      const beepInterval = 0.11 + ratio * 0.89;
      this.bombState.beepAccum += dt;
      if (this.bombState.beepAccum >= beepInterval) {
        this.bombState.beepAccum = 0;
        const dist = Math.hypot(this.localPlayer.x - this.bombState.x, this.localPlayer.z - this.bombState.z);
        cs2Audio.playC4Beep(this.bombState.timeLeft, dist);
        this.bombState.ledTimer = 0.08;
      }
      if (this.bombState.ledTimer > 0) {
        this.bombState.ledTimer -= dt;
        this.c4LedMesh.visible = true;
      } else {
        this.c4LedMesh.visible = false;
      }

      if (this.bombState.timeLeft <= 0) {
        this.bombState.planted = false;
        this.c4WorldMesh.visible = false;
        cs2Audio.playC4Explosion();
        // Detonation blast damages anyone nearby
        for (const ent of this.allEntities) {
          if (!ent.alive) continue;
          const d = Math.hypot(ent.x - this.bombState.x, ent.z - this.bombState.z);
          if (d < 22) {
            ent.hp = 0;
            ent.alive = false;
            ent.rig?.setAlive(false);
          }
        }
        this._endRound('t', 'detonated');
      }
    } else if (this.roundState.phase === 'ROUND_END') {
      this.roundState.timeLeft -= dt;
      if (this.roundState.timeLeft <= 0) {
        this.roundState.roundNum += 1;
        const totalPlayed = this.roundState.ctScore + this.roundState.tScore;
        if (!this.roundState.halftimeDone && totalPlayed >= this.modeCfg.halfRound) {
          this._performHalftimeSwap();
        }
        this._startRound(false);
      }
    }
  }

  _loop(now) {
    if (!this.running || this.disposed) return;
    this.rafId = requestAnimationFrame((ts) => this._loop(ts));

    const rawDt = (now - this.lastFrameTime) * 0.001;
    this.lastFrameTime = now;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));

    this._fpsAccum += rawDt;
    this._fpsFrames += 1;
    if (this._fpsAccum >= 0.4) {
      this._fps = Math.round(this._fpsFrames / this._fpsAccum);
      this._frameMs = (this._fpsAccum / this._fpsFrames) * 1000;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }

    if (this._damageFlashCooldown > 0) {
      this._damageFlashCooldown = Math.max(0, this._damageFlashCooldown - dt);
    }

    const colliders = this.map.getColliders(this.modeId);
    const wallMeshes = this.map.getRaycastMeshes(this.modeId);

    // 1. Local Player Movement & Weapons
    if (this.localPlayer.alive) {
      const frozen = this.roundState.phase === 'FREEZE' || this.roundState.phase === 'MATCH_END';
      const activeInput = (this.paused || this.buyMenuOpen)
        ? { forward: false, backward: false, left: false, right: false, walk: false, crouch: false }
        : this.input;

      this.movement.step(dt, activeInput, this.yaw, this.weapons.getMaxMoveSpeedU(), colliders, frozen);
      this.localPlayer.x = this.movement.pos.x;
      this.localPlayer.y = this.movement.pos.y;
      this.localPlayer.z = this.movement.pos.z;
      this.localPlayer.crouch = this.movement.crouching;
      this.localPlayer.yaw = this.yaw;
      this.localPlayer.pitch = this.pitch;

      if (this.movement.justStepped) {
        cs2Audio.playFootstep(0);
      }
      if (this.movement.justLanded) {
        cs2Audio.playLand(this.movement.lastLandSpeedU);
      }

      // Auto fire for full-auto rifles
      if (this.input.fire && !this.paused && !this.buyMenuOpen && this.pointerLocked) {
        const def = this.weapons.getActiveWeaponDef();
        if (def.auto) {
          this._tryLocalFire(false);
        }
      }

      const wUpdate = this.weapons.update(dt, this.movement.getHorizSpeedU(), this.movement.grounded);
      if (wUpdate.reloadCompleted) {
        cs2Audio.playReloadDone(this.weapons.getActiveWeaponId());
      }

      // Position First-Person Camera
      this.camera.position.set(
        this.localPlayer.x,
        this.localPlayer.y + this.movement.eyeHeight,
        this.localPlayer.z
      );
      this.camera.rotation.y = this.yaw + this.weapons.recoilPunchYaw;
      this.camera.rotation.x = Math.max(-1.54, Math.min(1.54, this.pitch + this.weapons.recoilPunchPitch));

      this._updateLocalObjective(dt);
    } else {
      // Training respawn or Spectate living teammate
      if (this.playType === 'training' && this._trainingRespawnTimer > 0) {
        this._trainingRespawnTimer -= dt;
        if (this._trainingRespawnTimer <= 0) {
          this._respawnEntity(this.localPlayer);
        }
      }
      const spec = this.allEntities.find((e) => e.id === this.spectateTargetId && e.alive);
      if (spec) {
        const eyeY = spec.y + (spec.crouch ? 1.14 : 1.62);
        const backX = Math.sin(spec.yaw) * 2.4;
        const backZ = Math.cos(spec.yaw) * 2.4;
        this.camera.position.set(spec.x + backX, eyeY + 0.45, spec.z + backZ);
        this.camera.lookAt(spec.x, eyeY, spec.z);
      }
    }

    // 2. AI Bots (Host or Local Solo/Bot modes)
    if (this.isHost && this.bots.length > 0) {
      this.botManager.update(dt, {
        bots: this.bots,
        allEntities: this.allEntities,
        map: this.map,
        modeId: this.modeId,
        difficultyId: this.botDifficulty,
        roundState: this.roundState,
        bombState: this.bombState,
        wallMeshes,
        colliders,
        onBotShoot: (bot, target, profile) => this._handleBotShoot(bot, target, profile),
        onBotPlanted: (bot, site, bx, by, bz) => this._executeBombPlant(bot, site, bx, by, bz, false),
        onBotDefused: (bot) => this._executeBombDefuse(bot, false)
      });
    }

    // 3. Round & Bomb Timers
    if (this.isHost) {
      this._updateRoundAndBombTimers(dt);
    }

    // 4. Online State Sync
    if (this.playType === 'online') {
      this._netSyncTimer += dt;
      if (this._netSyncTimer >= 0.05) {
        this._netSyncTimer = 0;
        cs2Network.sendPlayerState({
          x: this.localPlayer.x,
          y: this.localPlayer.y,
          z: this.localPlayer.z,
          yaw: this.yaw,
          pitch: this.pitch,
          crouch: this.localPlayer.crouch,
          weaponId: this.weapons.getActiveWeaponId(),
          hp: this.localPlayer.hp,
          alive: this.localPlayer.alive,
          team: this.localPlayer.team,
          speed: this.movement.getHorizSpeedU()
        });
      }
      if (this.isHost) {
        this._hostSyncTimer += dt;
        if (this._hostSyncTimer >= 0.1) {
          this._hostSyncTimer = 0;
          cs2Network.sendHostSync({
            phase: this.roundState.phase,
            timeLeft: this.roundState.timeLeft,
            roundNum: this.roundState.roundNum,
            ctScore: this.roundState.ctScore,
            tScore: this.roundState.tScore,
            halftimeDone: this.roundState.halftimeDone,
            bombTime: this.bombState.planted ? this.bombState.timeLeft : null,
            bots: this.bots.map((b) => ({
              id: b.id, x: b.x, y: b.y, z: b.z, yaw: b.yaw,
              crouch: b.crouch, weaponId: b.weaponId, hp: b.hp, alive: b.alive
            }))
          });
        }
      }
    }

    // 5. Effects Pool Update
    this.effects.update(dt);

    // 6. Render World + Viewmodel Overlay
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.localPlayer.alive && this.weapons.scopeZoom === 0) {
      this.renderer.clearDepth();
      this.renderer.render(this.weapons.vmScene, this.weapons.vmCamera);
    }

    // 7. Throttled HUD Update (~20 Hz)
    this._hudSyncTimer += dt;
    if (this._hudSyncTimer >= 0.05) {
      this._hudSyncTimer = 0;
      this._pushHud();
    }
  }

  _buildScoreboardData() {
    const sortFn = (a, b) => (b.kills - a.kills) || (a.deaths - b.deaths);
    const ct = this.allEntities.filter((e) => e.team === 'ct').sort(sortFn);
    const tList = this.allEntities.filter((e) => e.team === 't').sort(sortFn);
    return {
      modeId: this.modeId,
      roundNum: this.roundState.roundNum,
      ctScore: this.roundState.ctScore,
      tScore: this.roundState.tScore,
      ct,
      t: tList
    };
  }

  _pushHud() {
    const ammo = this.weapons.getAmmoInfo();
    const wDef = this.weapons.getActiveWeaponDef();
    const spreadRad = this.localPlayer.alive ? this.weapons.computeSpreadRad(this.movement) : 0.04;
    const chGapPx = Math.max(3, Math.min(34, Math.round(3 + spreadRad * 260)));

    const ctAlive = this.allEntities.filter((e) => e.team === 'ct').map((e) => e.alive);
    const tAlive = this.allEntities.filter((e) => e.team === 't').map((e) => e.alive);

    let objHint = null;
    if (this.localPlayer.alive && this.modeId !== 'training') {
      if (this.bombState.planted && this.localPlayer.team === 'ct') {
        const d = Math.hypot(this.localPlayer.x - this.bombState.x, this.localPlayer.z - this.bombState.z);
        if (d <= 2.35) objHint = { type: 'defuse_hint', site: this.bombState.site };
      } else if (!this.bombState.planted && this.localPlayer.team === 't' && this.localPlayer.hasBomb) {
        const zones = this.map.getPlantZones(this.modeId);
        const z = zones.find((zn) =>
          this.localPlayer.x >= zn.minX && this.localPlayer.x <= zn.maxX &&
          this.localPlayer.z >= zn.minZ && this.localPlayer.z <= zn.maxZ
        );
        if (z) objHint = { type: 'plant_hint', site: z.site };
      }
    }

    const spec = !this.localPlayer.alive
      ? this.allEntities.find((e) => e.id === this.spectateTargetId && e.alive)
      : null;

    this.cb.onHudUpdate?.({
      fps: this._fps,
      frameMs: this._frameMs,
      quality: this.quality,
      modeId: this.modeId,
      playType: this.playType,
      roomCode: this.room?.code || null,
      phase: this.roundState.phase,
      timeLeft: Math.max(0, this.roundState.timeLeft),
      roundNum: this.roundState.roundNum,
      ctScore: this.roundState.ctScore,
      tScore: this.roundState.tScore,
      ctAlive,
      tAlive,
      bombPlanted: this.bombState.planted,
      bombSite: this.bombState.site,
      bombTime: this.bombState.timeLeft,
      plantProgress: this.bombState.plantProgress / this.modeCfg.plantTime,
      defuseProgress: this.bombState.defuseProgress / this.modeCfg.defuseTime,
      objHint,
      localTeam: this.localPlayer.team,
      alive: this.localPlayer.alive,
      spectatingName: spec?.name || null,
      hp: this.localPlayer.hp,
      armor: this.localPlayer.armor,
      hasHelmet: this.localPlayer.hasHelmet,
      money: this.localPlayer.money,
      hasBomb: this.localPlayer.hasBomb,
      activeSlot: this.weapons.activeSlot,
      slots: this.weapons.slots,
      weaponId: wDef.id,
      weaponName: wDef.shortName,
      ammoMag: ammo.mag,
      ammoReserve: ammo.reserve,
      magSize: ammo.magSize,
      reloading: this.weapons.reloading,
      reloadProgress: this.weapons.reloading ? 1 - this.weapons.reloadTimer / Math.max(0.1, this.weapons.reloadDuration) : 0,
      reloadLeft: this.weapons.reloadTimer,
      scopeZoom: this.weapons.scopeZoom,
      chGapPx,
      speedU: Math.round(this.movement.getHorizSpeedU()),
      accurate: this.movement.isAccurateSpeed(),
      canBuy: this.canBuyNow(),
      pointerLocked: this.pointerLocked,
      paused: this.paused,
      buyMenuOpen: this.buyMenuOpen
    });

    if (this.scoreboardOpen) {
      this.cb.onScoreboardChange?.(true, this._buildScoreboardData());
    }
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this._clearInputs();
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();

    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    document.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);

    this._unsubStorage?.();
    for (const unsub of this._networkUnsubs) unsub?.();
    this._networkUnsubs.length = 0;

    this._clearEntities();
    this.scene.remove(this.c4WorldMesh);
    this.scene.remove(this.c4DropMesh);
    for (const g of this._worldGeoDispose) g.dispose();
    for (const m of this._worldMatDispose) m.dispose();
    this._worldGeoDispose.length = 0;
    this._worldMatDispose.length = 0;

    this.effects.dispose();
    this.map.dispose();
    this.weapons.dispose();
    this.textureMgr.dispose();
    this.renderer.dispose();
  }
}
