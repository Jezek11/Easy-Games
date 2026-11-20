import * as THREE from 'three';

export const STRUCT_VERTEX_MAT = new THREE.MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true
});

let structureCache = null;
let loadPromise = null;
const loadedCallbacks = new Set();

function extractMeshGeometry(node) {
  if (node.isMesh && node.geometry) {
    return node.geometry;
  }
  let found = null;
  node.traverse((child) => {
    if (!found && child.isMesh && child.geometry) {
      found = child.geometry;
    }
  });
  return found;
}

export function preloadStructureAssets() {
  if (structureCache) return Promise.resolve(structureCache);
  if (loadPromise) return loadPromise;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  loadPromise = import('three/addons/loaders/GLTFLoader.js')
    .then(({ GLTFLoader }) => new Promise((resolve) => {
      const loader = new GLTFLoader();
      loader.load(
        '/assets/models/structures.glb?v=struct2',
        (gltf) => {
          const map = new Map();
          gltf.scene.updateMatrixWorld(true);
          for (const child of gltf.scene.children) {
            if (!child.name) continue;
            const geo = extractMeshGeometry(child);
            if (!geo) continue;
            if (!geo.boundingBox) geo.computeBoundingBox();
            const size = new THREE.Vector3();
            geo.boundingBox.getSize(size);
            map.set(child.name, { geometry: geo, size });
          }
          structureCache = map;
          for (const cb of loadedCallbacks) {
            try {
              cb(map);
            } catch (err) {
              console.warn('Structure callback error:', err);
            }
          }
          resolve(map);
        },
        undefined,
        (err) => {
          console.warn('Failed to load structures.glb, keeping fallback geometry:', err);
          resolve(null);
        }
      );
    }))
    .catch((err) => {
      console.warn('GLTFLoader unavailable for structures.glb:', err);
      return null;
    });

  return loadPromise;
}

export function getStructureGeo(name) {
  return structureCache?.get(name)?.geometry || null;
}

export function getStructureSize(name) {
  return structureCache?.get(name)?.size || null;
}

export function getAllStructureGeos() {
  return structureCache;
}

export function onStructuresLoaded(cb) {
  if (typeof cb !== 'function') return () => {};
  loadedCallbacks.add(cb);
  if (structureCache) {
    try {
      cb(structureCache);
    } catch (err) {
      console.warn('Structure callback error:', err);
    }
  } else {
    preloadStructureAssets();
  }
  return () => loadedCallbacks.delete(cb);
}
