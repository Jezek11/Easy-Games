import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Custom .GLB Model Configuration & Toggle
 * ----------------------------------------
 * Place your custom `.glb` files into `/public/assets/models/`:
 *   - character.glb
 *   - shotgun.glb
 *   - ar.glb
 *   - pickaxe.glb
 *   - structures.glb (optional)
 *
 * Flip `MODEL_CONFIG.useCustomModels = true` (or call `setUseCustomModels(true)`)
 * to activate your custom `.glb` models instead of the built-in stylized meshes.
 */
export const MODEL_CONFIG = {
  useCustomModels: false,
  useCustomCharacter: true,
  useCustomWeapons: true,
  useCustomStructures: false,
  basePath: '/assets/models/',
  files: {
    character: 'character.glb',
    shotgun: 'shotgun.glb',
    ar: 'ar.glb',
    pickaxe: 'pickaxe.glb',
    structures: 'structures.glb'
  },
  transforms: {
    character: { targetHeight: 1.85, pos: [0, 0, 0], rot: [0, Math.PI, 0], scale: 1.0 },
    shotgun: { targetLength: 0.78, pos: [0, 0.02, -0.28], rot: [0, 0, 0], scale: 1.0 },
    ar: { targetLength: 0.86, pos: [0, 0.02, -0.32], rot: [0, 0, 0], scale: 1.0 },
    pickaxe: { targetLength: 0.78, pos: [0, 0.14, -0.24], rot: [-Math.PI * 0.42, 0, 0], scale: 1.0 }
  }
};

const loaderInstance = typeof window !== 'undefined' ? new GLTFLoader() : null;
const assetPromises = new Map();
const modeSubscribers = new Set();

export function isCustomModelEnabled(category) {
  if (!MODEL_CONFIG.useCustomModels) return false;
  if (category === 'character') return Boolean(MODEL_CONFIG.useCustomCharacter);
  if (category === 'weapons') return Boolean(MODEL_CONFIG.useCustomWeapons);
  if (category === 'structures') return Boolean(MODEL_CONFIG.useCustomStructures);
  return false;
}

export function setUseCustomModels(enabled) {
  MODEL_CONFIG.useCustomModels = Boolean(enabled);
  for (const cb of modeSubscribers) {
    try {
      cb(MODEL_CONFIG.useCustomModels);
    } catch (err) {
      console.warn('Model mode subscriber error:', err);
    }
  }
}

export function onModelModeChanged(cb) {
  if (typeof cb !== 'function') return () => {};
  modeSubscribers.add(cb);
  return () => modeSubscribers.delete(cb);
}

/**
 * Loads and caches a custom GLB model from `/assets/models/`.
 * Resolves to null cleanly if unavailable or missing so built-in meshes remain active.
 */
export function loadCustomModel(key) {
  if (typeof window === 'undefined' || !loaderInstance) {
    return Promise.resolve(null);
  }
  const filename = MODEL_CONFIG.files[key];
  if (!filename) return Promise.resolve(null);

  if (assetPromises.has(key)) {
    return assetPromises.get(key);
  }

  const url = `${MODEL_CONFIG.basePath}${filename}`;
  const promise = new Promise((resolve) => {
    loaderInstance.load(
      url,
      (gltf) => {
        const scene = gltf?.scene;
        if (!scene) {
          resolve(null);
          return;
        }
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        const size = new THREE.Vector3();
        box.getSize(size);

        let hasNamedParts = false;
        scene.traverse((obj) => {
          if (obj.isMesh && obj.name && (obj.name.startsWith('Torso_') || obj.name.startsWith('Weapon_'))) {
            hasNamedParts = true;
          }
        });

        resolve({
          key,
          scene,
          animations: Array.isArray(gltf.animations) ? gltf.animations : [],
          box,
          size,
          hasNamedParts
        });
      },
      undefined,
      (err) => {
        console.warn(`[modelLoader] Could not load ${url}, using built-in model fallback:`, err?.message || err);
        resolve(null);
      }
    );
  });

  assetPromises.set(key, promise);
  return promise;
}

function findHandSocket(root) {
  const candidates = ['WeaponSocket', 'RightHand', 'Hand_R', 'hand_r', 'mixamorigRightHand', 'Bip01_R_Hand'];
  let found = null;
  root.traverse((obj) => {
    if (found || !obj.name) return;
    if (candidates.some((c) => obj.name.toLowerCase().includes(c.toLowerCase()))) {
      found = obj;
    }
  });
  return found;
}

/**
 * Instantiates a cloned, height-normalized custom character GLB with optional AnimationMixer.
 */
export function instantiateCustomCharacter(asset, castShadow = true) {
  if (!asset || !asset.scene) return null;
  const cfg = MODEL_CONFIG.transforms.character;
  const clone = cloneSkinned(asset.scene);

  const wrapper = new THREE.Group();
  const rawHeight = Math.max(0.05, asset.size.y || 1.85);
  const autoScale = (cfg.targetHeight / rawHeight) * (cfg.scale || 1.0);

  clone.scale.setScalar(autoScale);
  clone.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
  clone.position.set(
    cfg.pos[0],
    cfg.pos[1] - asset.box.min.y * autoScale,
    cfg.pos[2]
  );

  clone.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = castShadow;
      obj.receiveShadow = true;
    }
  });

  wrapper.add(clone);

  let mixer = null;
  const actions = {};
  if (asset.animations && asset.animations.length > 0) {
    mixer = new THREE.AnimationMixer(clone);
    for (const clip of asset.animations) {
      const lower = (clip.name || '').toLowerCase();
      const action = mixer.clipAction(clip);
      if (lower.includes('run') || lower.includes('sprint')) actions.run = action;
      else if (lower.includes('walk')) actions.walk = action;
      else if (lower.includes('idle')) actions.idle = action;
    }
    if (!actions.idle) {
      actions.idle = mixer.clipAction(asset.animations[0]);
    }
    if (actions.idle) {
      actions.idle.play();
    }
  }

  return {
    root: wrapper,
    model: clone,
    handSocket: findHandSocket(clone),
    mixer,
    actions
  };
}

/**
 * Instantiates a cloned, length-normalized custom weapon GLB positioned at hand grip.
 */
export function instantiateCustomWeapon(key, asset, castShadow = true) {
  if (!asset || !asset.scene) return null;
  const cfg = MODEL_CONFIG.transforms[key] || { targetLength: 0.78, pos: [0, 0, -0.25], rot: [0, 0, 0], scale: 1.0 };
  const clone = asset.scene.clone(true);

  const longest = Math.max(0.05, asset.size.x, asset.size.y, asset.size.z);
  const autoScale = (cfg.targetLength / longest) * (cfg.scale || 1.0);

  clone.scale.setScalar(autoScale);
  clone.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
  clone.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);

  clone.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = castShadow;
      obj.receiveShadow = true;
    }
  });

  return clone;
}

if (typeof window !== 'undefined') {
  window.XGAMES_MODELS = {
    config: MODEL_CONFIG,
    setUseCustomModels
  };
}
