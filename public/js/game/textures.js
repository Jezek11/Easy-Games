import * as THREE from 'three';
import { ARENA_HALF_GRID } from './constants.js';

const floorCache = { value: null };
const buildCache = new Map();
let muzzleFlashTexCache = null;

function makeRand(seedInit = 1337) {
  let seed = seedInit;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function finalizeTexture(canvas, {
  srgb = true,
  repeatX = 1,
  repeatY = 1,
  wrap = THREE.RepeatWrapping,
  mipmaps = true,
  anisotropy = 4
} = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  if (repeatX !== 1 || repeatY !== 1) {
    tex.repeat.set(repeatX, repeatY);
  }
  tex.generateMipmaps = mipmaps;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates seamless 512x512 procedural albedo, bump, and roughness maps
 * for the modern sci-fi / tactical training floor.
 */
export function getArenaFloorTextures() {
  if (floorCache.value) return floorCache.value;
  if (typeof document === 'undefined') {
    return { map: null, bumpMap: null, roughnessMap: null };
  }

  const size = 512;
  const half = size / 2;
  const rand = makeRand(9187);

  // 1. Albedo Canvas
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = size;
  mapCanvas.height = size;
  const ctx = mapCanvas.getContext('2d');

  // 2. Bump Canvas
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d');

  // 3. Roughness Canvas (darker = shinier sun specular reflections, lighter = matte)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d');

  // Base slate-blue gradient
  const baseGrad = ctx.createLinearGradient(0, 0, size, size);
  baseGrad.addColorStop(0, '#3a5474');
  baseGrad.addColorStop(0.5, '#446286');
  baseGrad.addColorStop(1, '#4d6d93');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, size, size);

  bctx.fillStyle = '#dcdcdc';
  bctx.fillRect(0, 0, size, size);

  rctx.fillStyle = '#5a5a5a';
  rctx.fillRect(0, 0, size, size);

  // 2x2 interlocking beveled sub-panels
  const subPads = [
    { x: 0, y: 0, tint: 'rgba(255,255,255,0.06)', tread: true, rough: '#6a6a6a' },
    { x: half, y: 0, tint: 'rgba(15,28,48,0.08)', tread: false, rough: '#4c4c4c' },
    { x: 0, y: half, tint: 'rgba(15,28,48,0.08)', tread: false, rough: '#4c4c4c' },
    { x: half, y: half, tint: 'rgba(255,255,255,0.06)', tread: true, rough: '#6a6a6a' }
  ];

  for (const p of subPads) {
    // Panel fill tint
    ctx.fillStyle = p.tint;
    ctx.fillRect(p.x + 10, p.y + 10, half - 20, half - 20);

    // Roughness per quadrant
    rctx.fillStyle = p.rough;
    rctx.fillRect(p.x + 10, p.y + 10, half - 20, half - 20);

    // Raised inner tile plate in bump
    bctx.fillStyle = '#e8e8e8';
    bctx.fillRect(p.x + 10, p.y + 10, half - 20, half - 20);

    // Subtle specular bevel highlight (top & left edge of panel)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(p.x + 8, p.y + 8, half - 16, 4);
    ctx.fillRect(p.x + 8, p.y + 8, 4, half - 16);

    bctx.fillStyle = '#a8a8a8';
    bctx.strokeStyle = '#a8a8a8';
    bctx.lineWidth = 4;
    bctx.strokeRect(p.x + 8, p.y + 8, half - 16, half - 16);

    // Shadow bevel (bottom & right edge)
    ctx.fillStyle = 'rgba(12, 22, 38, 0.28)';
    ctx.fillRect(p.x + 8, p.y + half - 12, half - 16, 4);
    ctx.fillRect(p.x + half - 12, p.y + 8, 4, half - 16);

    // Anti-slip diagonal tread ribs in alternating quadrants
    if (p.tread) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x + 26, p.y + 26, half - 52, half - 52);
      ctx.clip();

      bctx.save();
      bctx.beginPath();
      bctx.rect(p.x + 26, p.y + 26, half - 52, half - 52);
      bctx.clip();

      rctx.save();
      rctx.beginPath();
      rctx.rect(p.x + 26, p.y + 26, half - 52, half - 52);
      rctx.clip();

      for (let d = -half; d < half * 2; d += 22) {
        ctx.strokeStyle = 'rgba(210, 234, 255, 0.14)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(p.x + d, p.y + 24);
        ctx.lineTo(p.x + d + 64, p.y + 88);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(18, 32, 52, 0.22)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x + d + 3, p.y + 24);
        ctx.lineTo(p.x + d + 67, p.y + 88);
        ctx.stroke();

        bctx.strokeStyle = '#f5f5f5';
        bctx.lineWidth = 5;
        bctx.beginPath();
        bctx.moveTo(p.x + d, p.y + 24);
        bctx.lineTo(p.x + d + 64, p.y + 88);
        bctx.stroke();

        rctx.strokeStyle = '#c4c4c4';
        rctx.lineWidth = 5;
        rctx.beginPath();
        rctx.moveTo(p.x + d, p.y + 24);
        rctx.lineTo(p.x + d + 64, p.y + 88);
        rctx.stroke();
      }
      ctx.restore();
      bctx.restore();
      rctx.restore();
    } else {
      // Smooth polished tech inset frame
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 28, p.y + 28, half - 56, half - 56);
      rctx.fillStyle = '#444444';
      rctx.fillRect(p.x + 30, p.y + 30, half - 60, half - 60);
    }

    // Corner anchor bolts
    const bolts = [
      [p.x + 18, p.y + 18],
      [p.x + half - 18, p.y + 18],
      [p.x + 18, p.y + half - 18],
      [p.x + half - 18, p.y + half - 18]
    ];
    for (const [bx, by] of bolts) {
      ctx.fillStyle = '#24364f';
      ctx.beginPath();
      ctx.arc(bx, by, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#89accf';
      ctx.beginPath();
      ctx.arc(bx - 0.8, by - 0.8, 2.5, 0, Math.PI * 2);
      ctx.fill();

      bctx.fillStyle = '#f8f8f8';
      bctx.beginPath();
      bctx.arc(bx, by, 4, 0, Math.PI * 2);
      bctx.fill();

      rctx.fillStyle = '#404040';
      rctx.beginPath();
      rctx.arc(bx, by, 4, 0, Math.PI * 2);
      rctx.fill();
    }
  }

  // Subtle metallic micro-grain across tile
  for (let i = 0; i < 420; i++) {
    const gx = rand() * size;
    const gy = rand() * size;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(10,18,32,0.045)';
    ctx.fillRect(gx, gy, 3, 2);
  }

  // Center cross recessed seam & outer cell recessed seam
  ctx.fillStyle = '#1f3047';
  ctx.fillRect(half - 3, 0, 6, size);
  ctx.fillRect(0, half - 3, size, 6);
  ctx.strokeStyle = '#19283d';
  ctx.lineWidth = 8;
  ctx.strokeRect(0, 0, size, size);

  bctx.fillStyle = '#222222';
  bctx.fillRect(half - 3, 0, 6, size);
  bctx.fillRect(0, half - 3, size, 6);
  bctx.strokeStyle = '#1c1c1c';
  bctx.lineWidth = 8;
  bctx.strokeRect(0, 0, size, size);

  rctx.fillStyle = '#d4d4d4';
  rctx.fillRect(half - 3, 0, 6, size);
  rctx.fillRect(0, half - 3, size, 6);
  rctx.strokeStyle = '#d8d8d8';
  rctx.lineWidth = 8;
  rctx.strokeRect(0, 0, size, size);

  // Crisp cyan tactical corner L-brackets & center hairline diamond
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
  ctx.lineWidth = 3;
  const arm = 30;
  const pad = 16;
  ctx.beginPath();
  // TL
  ctx.moveTo(pad, pad + arm); ctx.lineTo(pad, pad); ctx.lineTo(pad + arm, pad);
  // TR
  ctx.moveTo(size - pad - arm, pad); ctx.lineTo(size - pad, pad); ctx.lineTo(size - pad, pad + arm);
  // BL
  ctx.moveTo(pad, size - pad - arm); ctx.lineTo(pad, size - pad); ctx.lineTo(pad + arm, size - pad);
  // BR
  ctx.moveTo(size - pad - arm, size - pad); ctx.lineTo(size - pad, size - pad); ctx.lineTo(size - pad, size - pad - arm);
  ctx.stroke();

  // Center tactical diamond accent
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.34)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(half, half - 18);
  ctx.lineTo(half + 18, half);
  ctx.lineTo(half, half + 18);
  ctx.lineTo(half - 18, half);
  ctx.closePath();
  ctx.stroke();

  const repeat = ARENA_HALF_GRID * 2;
  floorCache.value = {
    map: finalizeTexture(mapCanvas, { srgb: true, repeatX: repeat, repeatY: repeat }),
    bumpMap: finalizeTexture(bumpCanvas, { srgb: false, repeatX: repeat, repeatY: repeat }),
    roughnessMap: finalizeTexture(roughCanvas, { srgb: false, repeatX: repeat, repeatY: repeat })
  };
  return floorCache.value;
}

/**
 * Generates procedural Canvas textures (map, bumpMap, and optional roughnessMap)
 * for stylized building materials: 'wood', 'brick', 'metal'.
 */
export function getBuildMaterialTextures(matId = 'wood') {
  const key = matId === 'brick' ? 'brick' : (matId === 'metal' ? 'metal' : 'wood');
  if (buildCache.has(key)) return buildCache.get(key);
  if (typeof document === 'undefined') {
    return { map: null, bumpMap: null, roughnessMap: null };
  }

  const size = 256;
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = size;
  mapCanvas.height = size;
  const ctx = mapCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d');

  let roughCanvas = null;
  let rctx = null;

  if (key === 'wood') {
    const rand = makeRand(2049);
    const planks = ['#d9954c', '#c9813a', '#e2a158', '#be7732'];
    const plankH = size / 4;

    bctx.fillStyle = '#c8c8c8';
    bctx.fillRect(0, 0, size, size);

    for (let p = 0; p < 4; p++) {
      const y = p * plankH;
      ctx.fillStyle = planks[p];
      ctx.fillRect(0, y, size, plankH);

      // Sunlit upper highlight & subtle lower shadow per plank
      ctx.fillStyle = 'rgba(255, 240, 210, 0.22)';
      ctx.fillRect(0, y + 3, size, 5);
      ctx.fillStyle = 'rgba(90, 48, 16, 0.24)';
      ctx.fillRect(0, y + plankH - 6, size, 4);

      // Organic wood grain curves
      for (let g = 0; g < 7; g++) {
        const gy = y + 10 + g * 7.5 + (rand() - 0.5) * 3;
        ctx.strokeStyle = g % 2 === 0 ? 'rgba(115, 62, 20, 0.28)' : 'rgba(255, 224, 178, 0.18)';
        ctx.lineWidth = 1.6 + rand() * 1.4;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        const wave = (rand() - 0.5) * 10;
        ctx.bezierCurveTo(size * 0.33, gy + wave, size * 0.66, gy - wave, size, gy + (rand() - 0.5) * 4);
        ctx.stroke();

        bctx.strokeStyle = g % 2 === 0 ? '#9e9e9e' : '#dcdcdc';
        bctx.lineWidth = 1.5;
        bctx.beginPath();
        bctx.moveTo(0, gy);
        bctx.bezierCurveTo(size * 0.33, gy + wave, size * 0.66, gy - wave, size, gy);
        bctx.stroke();
      }

      // Wood knot oval
      const kx = 44 + ((p * 67 + 29) % (size - 88));
      const ky = y + plankH * 0.52;
      ctx.strokeStyle = 'rgba(98, 52, 16, 0.42)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(kx, ky, 12, 5, 0.08, 0, Math.PI * 2);
      ctx.stroke();

      // Plank gap shadow
      ctx.fillStyle = '#6b3d16';
      ctx.fillRect(0, y + plankH - 3, size, 3);
      bctx.fillStyle = '#202020';
      bctx.fillRect(0, y + plankH - 3, size, 3);
    }

    // Iconic Fortnite diagonal timber brace + sturdy perimeter frame
    ctx.save();
    ctx.strokeStyle = '#9d6229';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(14, size - 14);
    ctx.lineTo(size - 14, 14);
    ctx.stroke();

    ctx.strokeStyle = '#d3914a';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(14, size - 14);
    ctx.lineTo(size - 14, 14);
    ctx.stroke();
    ctx.restore();

    bctx.strokeStyle = '#ededed';
    bctx.lineWidth = 20;
    bctx.beginPath();
    bctx.moveTo(14, size - 14);
    bctx.lineTo(size - 14, 14);
    bctx.stroke();

    // Outer frame border
    ctx.strokeStyle = '#78471c';
    ctx.lineWidth = 16;
    ctx.strokeRect(8, 8, size - 16, size - 16);
    ctx.strokeStyle = '#b47335';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, size - 20, size - 20);

    bctx.strokeStyle = '#f2f2f2';
    bctx.lineWidth = 14;
    bctx.strokeRect(7, 7, size - 14, size - 14);

    // Iron nail heads along frame corners & brace
    const nails = [
      [14, 14], [size - 14, 14], [14, size - 14], [size - 14, size - 14],
      [size * 0.5, 12], [size * 0.5, size - 12], [12, size * 0.5], [size - 12, size * 0.5],
      [34, size - 34], [size - 34, 34]
    ];
    for (const [nx, ny] of nails) {
      ctx.fillStyle = '#2d241e';
      ctx.beginPath();
      ctx.arc(nx, ny, 3.6, 0, Math.PI * 2);
      ctx.fill();
      bctx.fillStyle = '#ffffff';
      bctx.beginPath();
      bctx.arc(nx, ny, 3.4, 0, Math.PI * 2);
      bctx.fill();
    }
  } else if (key === 'brick') {
    const rand = makeRand(4093);
    // Warm sandstone mortar background
    ctx.fillStyle = '#dfd2c0';
    ctx.fillRect(0, 0, size, size);

    // Deep recessed mortar in bump
    bctx.fillStyle = '#242424';
    bctx.fillRect(0, 0, size, size);

    const tones = ['#c8563c', '#b84a32', '#d96b4d', '#a9432d', '#cf7248'];
    const rows = 4;
    const rowH = size / rows;
    const brickW = size / 2;

    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const offset = (r % 2) * (brickW * 0.5);
      for (let c = -1; c <= 2; c++) {
        const x = c * brickW + offset;
        const bx = x + 4;
        const by = y + 4;
        const bw = brickW - 8;
        const bh = rowH - 8;

        ctx.fillStyle = tones[(r * 3 + c + 7) % tones.length];
        ctx.fillRect(bx, by, bw, bh);

        // Top sunlit highlight & shaded lower lip
        ctx.fillStyle = 'rgba(255, 232, 210, 0.24)';
        ctx.fillRect(bx, by, bw, 5);
        ctx.fillStyle = 'rgba(72, 22, 12, 0.28)';
        ctx.fillRect(bx, by + bh - 5, bw, 5);

        // Bumpy raised brick surface
        const bumpTone = 196 + ((r * 13 + c * 29) & 31);
        bctx.fillStyle = `rgb(${bumpTone}, ${bumpTone}, ${bumpTone})`;
        bctx.fillRect(bx, by, bw, bh);
        bctx.fillStyle = '#ededed';
        bctx.fillRect(bx + 2, by + 2, bw - 4, 4);
      }
    }

    // Subtle stone speckles for stylized masonry character
    for (let i = 0; i < 240; i++) {
      const sx = rand() * size;
      const sy = rand() * size;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 240, 225, 0.14)' : 'rgba(65, 22, 12, 0.16)';
      ctx.fillRect(sx, sy, 3 + rand() * 3, 2 + rand() * 2);
      bctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(90,90,90,0.2)';
      bctx.fillRect(sx, sy, 3, 3);
    }

    // Dark masonry border edge
    ctx.strokeStyle = '#6c2d1f';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, size - 10, size - 10);
    bctx.strokeStyle = '#dcdcdc';
    bctx.lineWidth = 8;
    bctx.strokeRect(4, 4, size - 8, size - 8);
  } else {
    // 'metal': Stylized steel-blue bolted industrial armor plates
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#95b7d4');
    grad.addColorStop(0.5, '#7ea1c0');
    grad.addColorStop(1, '#678aa9');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    bctx.fillStyle = '#cbcbcb';
    bctx.fillRect(0, 0, size, size);

    roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    rctx = roughCanvas.getContext('2d');
    rctx.fillStyle = '#4c4c4c';
    rctx.fillRect(0, 0, size, size);

    // Brushed diagonal metallic sheen streaks
    for (let i = -size; i < size * 2; i += 28) {
      ctx.strokeStyle = i % 56 === 0 ? 'rgba(255, 255, 255, 0.13)' : 'rgba(28, 44, 62, 0.11)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + size * 0.55, size);
      ctx.stroke();

      rctx.strokeStyle = i % 56 === 0 ? '#383838' : '#646464';
      rctx.lineWidth = 8;
      rctx.beginPath();
      rctx.moveTo(i, 0);
      rctx.lineTo(i + size * 0.55, size);
      rctx.stroke();
    }

    // 2x2 Quadrant plate bevels & subtle diamond tread dots
    const half = size / 2;
    for (let qx = 0; qx < 2; qx++) {
      for (let qy = 0; qy < 2; qy++) {
        const px = qx * half;
        const py = qy * half;

        // Top-left bevel highlight
        ctx.fillStyle = 'rgba(235, 248, 255, 0.25)';
        ctx.fillRect(px + 10, py + 10, half - 20, 4);
        ctx.fillRect(px + 10, py + 10, 4, half - 20);

        // Diamond-plate grip dots in center of each plate
        for (let dx = 36; dx <= half - 36; dx += 20) {
          for (let dy = 36; dy <= half - 36; dy += 20) {
            ctx.fillStyle = 'rgba(240, 249, 255, 0.20)';
            ctx.fillRect(px + dx - 2, py + dy - 1, 5, 2);
            bctx.fillStyle = '#f2f2f2';
            bctx.fillRect(px + dx - 2, py + dy - 1, 5, 2);
          }
        }

        // Corner rivets
        const rivets = [
          [px + 20, py + 20],
          [px + half - 20, py + 20],
          [px + 20, py + half - 20],
          [px + half - 20, py + half - 20]
        ];
        for (const [rx, ry] of rivets) {
          ctx.fillStyle = '#2c3d50';
          ctx.beginPath();
          ctx.arc(rx, ry, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#c5dcf0';
          ctx.beginPath();
          ctx.arc(rx - 1, ry - 1, 2.5, 0, Math.PI * 2);
          ctx.fill();

          bctx.fillStyle = '#ffffff';
          bctx.beginPath();
          bctx.arc(rx, ry, 4.2, 0, Math.PI * 2);
          bctx.fill();

          rctx.fillStyle = '#303030';
          rctx.beginPath();
          rctx.arc(rx, ry, 4.2, 0, Math.PI * 2);
          rctx.fill();
        }
      }
    }

    // Dark recessed cross-seams & reinforced outer steel border
    ctx.fillStyle = '#314256';
    ctx.fillRect(half - 3, 0, 6, size);
    ctx.fillRect(0, half - 3, size, 6);
    ctx.strokeStyle = '#3a4d63';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, size - 14, size - 14);

    // Subtle cyan specular accent line inside frame
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(16, 16, size - 32, size - 32);

    bctx.fillStyle = '#222222';
    bctx.fillRect(half - 3, 0, 6, size);
    bctx.fillRect(0, half - 3, size, 6);
    bctx.strokeStyle = '#e8e8e8';
    bctx.lineWidth = 12;
    bctx.strokeRect(6, 6, size - 12, size - 12);

    rctx.fillStyle = '#c8c8c8';
    rctx.fillRect(half - 3, 0, 6, size);
    rctx.fillRect(0, half - 3, size, 6);
  }

  const result = {
    map: finalizeTexture(mapCanvas, { srgb: true }),
    bumpMap: finalizeTexture(bumpCanvas, { srgb: false }),
    roughnessMap: roughCanvas ? finalizeTexture(roughCanvas, { srgb: false }) : null
  };
  buildCache.set(key, result);
  return result;
}

/**
 * Generates an in-memory additive starburst muzzle flash CanvasTexture.
 */
export function getMuzzleFlashTexture() {
  if (muzzleFlashTexCache) return muzzleFlashTexCache;
  if (typeof document === 'undefined') return null;

  const size = 128;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);

  // Soft outer amber glow
  const glow = ctx.createRadialGradient(half, half, 2, half, half, half * 0.92);
  glow.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  glow.addColorStop(0.22, 'rgba(255, 224, 102, 0.95)');
  glow.addColorStop(0.55, 'rgba(255, 123, 0, 0.52)');
  glow.addColorStop(1, 'rgba(255, 90, 0, 0.0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(half, half, half * 0.92, 0, Math.PI * 2);
  ctx.fill();

  // 6 sharp stylized rays
  const rays = 6;
  for (let i = 0; i < rays; i++) {
    const ang = (i / rays) * Math.PI * 2;
    const len = i % 2 === 0 ? half * 0.94 : half * 0.72;
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(ang);
    const rGrad = ctx.createLinearGradient(0, 0, len, 0);
    rGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    rGrad.addColorStop(0.45, 'rgba(255, 212, 82, 0.75)');
    rGrad.addColorStop(1, 'rgba(255, 123, 0, 0.0)');
    ctx.fillStyle = rGrad;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Hot white core
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(half, half, 12, 0, Math.PI * 2);
  ctx.fill();

  muzzleFlashTexCache = finalizeTexture(canvas, {
    srgb: true,
    wrap: THREE.ClampToEdgeWrapping,
    mipmaps: false,
    anisotropy: 1
  });
  return muzzleFlashTexCache;
}
