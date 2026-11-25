import * as THREE from 'three';

function createRng(seedInit = 4242) {
  let seed = seedInit >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function makeCanvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

export class CS2TextureManager {
  constructor() {
    this._textures = [];
    this._sets = new Map();
    this._bulletHoleTex = null;
    this._muzzleFlashTex = null;
  }

  _registerTex(canvas, {
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
    this._textures.push(tex);
    return tex;
  }

  getMaterialSet(kind, repeatX = 1, repeatY = 1) {
    const key = `${kind}:${repeatX}:${repeatY}`;
    if (this._sets.has(key)) return this._sets.get(key);

    let set;
    switch (kind) {
      case 'sandstone':
        set = this._buildSandstone(repeatX, repeatY);
        break;
      case 'plaster':
        set = this._buildPlaster(repeatX, repeatY);
        break;
      case 'crate':
        set = this._buildCrate(repeatX, repeatY);
        break;
      case 'cobble':
        set = this._buildCobble(repeatX, repeatY);
        break;
      case 'sand':
        set = this._buildSand(repeatX, repeatY);
        break;
      case 'metalDoor':
        set = this._buildMetalDoor(repeatX, repeatY);
        break;
      case 'woodTrim':
        set = this._buildWoodTrim(repeatX, repeatY);
        break;
      case 'barrier':
        set = this._buildBarrier(repeatX, repeatY);
        break;
      case 'siteA':
        set = this._buildSiteStencil('A', '#f59e0b', repeatX, repeatY);
        break;
      case 'siteB':
        set = this._buildSiteStencil('B', '#ef4444', repeatX, repeatY);
        break;
      default:
        set = this._buildSandstone(repeatX, repeatY);
    }
    this._sets.set(key, set);
    return set;
  }

  _buildSandstone(repeatX, repeatY) {
    const size = 256;
    const rand = createRng(1013);
    const mapC = makeCanvas(size);
    const bumpC = makeCanvas(size);
    const ctx = mapC.getContext('2d');
    const bctx = bumpC.getContext('2d');

    ctx.fillStyle = '#b99f77';
    ctx.fillRect(0, 0, size, size);
    bctx.fillStyle = '#383838';
    bctx.fillRect(0, 0, size, size);

    const rows = 4;
    const rowH = size / rows;
    const blockTones = ['#d8c096', '#cfb386', '#dfc9a0', '#c7aa7c', '#d5bc8f'];

    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const offset = (r % 2) * 64;
      const cols = 2;
      const blockW = size / cols;
      for (let c = -1; c <= cols; c++) {
        const x = c * blockW + offset;
        const bx = x + 3;
        const by = y + 3;
        const bw = blockW - 6;
        const bh = rowH - 6;

        ctx.fillStyle = blockTones[(r * 5 + c + 8) % blockTones.length];
        ctx.fillRect(bx, by, bw, bh);

        // Top sunlit bevel & bottom shadow bevel
        ctx.fillStyle = 'rgba(255, 245, 224, 0.25)';
        ctx.fillRect(bx, by, bw, 4);
        ctx.fillStyle = 'rgba(92, 68, 38, 0.26)';
        ctx.fillRect(bx, by + bh - 4, bw, 4);

        bctx.fillStyle = '#cfcfcf';
        bctx.fillRect(bx, by, bw, bh);
        bctx.fillStyle = '#ececec';
        bctx.fillRect(bx + 2, by + 2, bw - 4, 4);
      }
    }

    // Sandstone mineral grain & weathering pits
    for (let i = 0; i < 650; i++) {
      const gx = rand() * size;
      const gy = rand() * size;
      const w = 1 + rand() * 3;
      const h = 1 + rand() * 2;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 246, 225, 0.16)' : 'rgba(105, 78, 44, 0.16)';
      ctx.fillRect(gx, gy, w, h);
      bctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(65,65,65,0.18)';
      bctx.fillRect(gx, gy, w, h);
    }

    return {
      map: this._registerTex(mapC, { srgb: true, repeatX, repeatY }),
      bumpMap: this._registerTex(bumpC, { srgb: false, repeatX, repeatY }),
      roughnessMap: null
    };
  }

  _buildPlaster(repeatX, repeatY) {
    const size = 256;
    const rand = createRng(2029);
    const mapC = makeCanvas(size);
    const bumpC = makeCanvas(size);
    const ctx = mapC.getContext('2d');
    const bctx = bumpC.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#ebe0cc');
    grad.addColorStop(0.7, '#dfd1b6');
    grad.addColorStop(1, '#cbb795');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    bctx.fillStyle = '#b4b4b4';
    bctx.fillRect(0, 0, size, size);

    // Subtle plaster mottling
    for (let i = 0; i < 420; i++) {
      const px = rand() * size;
      const py = rand() * size;
      const rad = 2 + rand() * 8;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 250, 240, 0.08)' : 'rgba(140, 114, 78, 0.08)';
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();

      bctx.fillStyle = i % 2 === 0 ? 'rgba(215, 215, 215, 0.15)' : 'rgba(140, 140, 140, 0.15)';
      bctx.fillRect(px, py, 3, 3);
    }

    // Decorative terracotta dado line at bottom edge
    ctx.fillStyle = 'rgba(162, 92, 56, 0.35)';
    ctx.fillRect(0, size - 22, size, 8);

    // Fine hairline stucco cracks
    ctx.strokeStyle = 'rgba(110, 86, 58, 0.25)';
    ctx.lineWidth = 1.2;
    bctx.strokeStyle = '#606060';
    bctx.lineWidth = 1.4;
    for (let k = 0; k < 4; k++) {
      let cx = 24 + rand() * (size - 48);
      let cy = 24 + rand() * (size - 64);
      ctx.beginPath();
      bctx.beginPath();
      ctx.moveTo(cx, cy);
      bctx.moveTo(cx, cy);
      for (let s = 0; s < 5; s++) {
        cx += (rand() - 0.5) * 26;
        cy += 8 + rand() * 14;
        ctx.lineTo(cx, cy);
        bctx.lineTo(cx, cy);
      }
      ctx.stroke();
      bctx.stroke();
    }

    return {
      map: this._registerTex(mapC, { srgb: true, repeatX, repeatY }),
      bumpMap: this._registerTex(bumpC, { srgb: false, repeatX, repeatY }),
      roughnessMap: null
    };
  }

  _buildCrate(repeatX, repeatY) {
    const size = 256;
    const rand = createRng(3311);
    const mapC = makeCanvas(size);
    const bumpC = makeCanvas(size);
    const ctx = mapC.getContext('2d');
    const bctx = bumpC.getContext('2d');

    ctx.fillStyle = '#9e6b3b';
    ctx.fillRect(0, 0, size, size);
    bctx.fillStyle = '#bcbcbc';
    bctx.fillRect(0, 0, size, size);

    // Horizontal planks
    const planks = 5;
    const pH = size / planks;
    const plankPalette = ['#ad7642', '#9b6735', '#b7804a', '#956131', '#aa733f'];
    for (let i = 0; i < planks; i++) {
      const y = i * pH;
      ctx.fillStyle = plankPalette[i % plankPalette.length];
      ctx.fillRect(0, y + 2, size, pH - 4);

      for (let g = 0; g < 6; g++) {
        const gy = y + 6 + g * 7;
        ctx.strokeStyle = g % 2 === 0 ? 'rgba(72, 41, 15, 0.25)' : 'rgba(235, 195, 145, 0.16)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(size, gy + (rand() - 0.5) * 3);
        ctx.stroke();
      }
      ctx.fillStyle = '#5b3716';
      ctx.fillRect(0, y + pH - 3, size, 3);
      bctx.fillStyle = '#2c2c2c';
      bctx.fillRect(0, y + pH - 3, size, 3);
    }

    // Diagonal brace
    ctx.strokeStyle = '#7c4e24';
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.moveTo(16, size - 16);
    ctx.lineTo(size - 16, 16);
    ctx.stroke();

    ctx.strokeStyle = '#b9824c';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(16, size - 16);
    ctx.lineTo(size - 16, 16);
    ctx.stroke();

    bctx.strokeStyle = '#e5e5e5';
    bctx.lineWidth = 22;
    bctx.beginPath();
    bctx.moveTo(16, size - 16);
    bctx.lineTo(size - 16, 16);
    bctx.stroke();

    // Outer wooden border frame
    ctx.strokeStyle = '#6f441e';
    ctx.lineWidth = 22;
    ctx.strokeRect(11, 11, size - 22, size - 22);
    ctx.strokeStyle = '#a46e3b';
    ctx.lineWidth = 12;
    ctx.strokeRect(11, 11, size - 22, size - 22);

    bctx.strokeStyle = '#ededed';
    bctx.lineWidth = 20;
    bctx.strokeRect(10, 10, size - 20, size - 20);

    // Metal corner brackets + rivets
    ctx.fillStyle = '#334155';
    const corners = [
      [0, 0], [size - 30, 0], [0, size - 30], [size - 30, size - 30]
    ];
    for (const [cx, cy] of corners) {
      ctx.fillRect(cx, cy, 30, 30);
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath();
      ctx.arc(cx + 15, cy + 15, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#334155';
    }

    // Stencil mark
    ctx.fillStyle = 'rgba(30, 22, 14, 0.45)';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('CS-02', 42, 52);

    return {
      map: this._registerTex(mapC, { srgb: true, repeatX, repeatY }),
      bumpMap: this._registerTex(bumpC, { srgb: false, repeatX, repeatY }),
      roughnessMap: null
    };
  }

  _buildCobble(repeatX, repeatY) {
    const size = 256;
    const rand = createRng(4409);
    const mapC = makeCanvas(size);
    const bumpC = makeCanvas(size);
    const ctx = mapC.getContext('2d');
    const bctx = bumpC.getContext('2d');

    ctx.fillStyle = '#8b7d69';
    ctx.fillRect(0, 0, size, size);
    bctx.fillStyle = '#2d2d2d';
    bctx.fillRect(0, 0, size, size);

    const grid = 4;
    const tile = size / grid;
    const stoneColors = ['#b4a48b', '#a8977e', '#beb098', '#9f8f76', '#b7a890'];

    for (let r = 0; r < grid; r++) {
      const offset = (r % 2) * (tile * 0.5);
      for (let c = -1; c <= grid; c++) {
        const x = c * tile + offset + 3;
        const y = r * tile + 3;
        const w = tile - 6;
        const h = tile - 6;
        ctx.fillStyle = stoneColors[(r * 7 + c * 3 + 10) % stoneColors.length];
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,248,232,0.18)';
        ctx.fillRect(x, y, w, 3);
        ctx.fillStyle = 'rgba(40,32,24,0.22)';
        ctx.fillRect(x, y + h - 3, w, 3);

        const bVal = 178 + ((r * 19 + c * 31) & 31);
        bctx.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
        bctx.fillRect(x, y, w, h);
      }
    }

    for (let i = 0; i < 400; i++) {
      const sx = rand() * size;
      const sy = rand() * size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(30,25,20,0.12)';
      ctx.fillRect(sx, sy, 2, 2);
    }

    return {
      map: this._registerTex(mapC, { srgb: true, repeatX, repeatY }),
      bumpMap: this._registerTex(bumpC, { srgb: false, repeatX, repeatY }),
      roughnessMap: null
    };
  }

  _buildSand(repeatX, repeatY) {
    const size = 256;
    const rand = createRng(5501);
    const mapC = makeCanvas(size);
    const bumpC = makeCanvas(size);
    const ctx = mapC.getContext('2d');
    const bctx = bumpC.getContext('2d');

    ctx.fillStyle = '#ccb389';
    ctx.fillRect(0, 0, size, size);
    bctx.fillStyle = '#999999';
    bctx.fillRect(0, 0, size, size);

    // Gentle wind-swept sand ripples
    for (let y = 0; y < size; y += 16) {
      ctx.fillStyle = 'rgba(245, 224, 184, 0.14)';
      ctx.fillRect(0, y, size, 5);
      ctx.fillStyle = 'rgba(138, 108, 68, 0.12)';
      ctx.fillRect(0, y + 6, size, 4);
      bctx.fillStyle = '#b8b8b8';
      bctx.fillRect(0, y, size, 6);
    }

    for (let i = 0; i < 900; i++) {
      const px = rand() * size;
      const py = rand() * size;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(255,244,216,0.18)' : 'rgba(118,88,52,0.16)';
      ctx.fillRect(px, py, 2, 2);
      bctx.fillStyle = i % 2 === 0 ? '#c8c8c8' : '#707070';
      bctx.fillRect(px, py, 2, 2);
    }

    return {
      map: this._registerTex(mapC, { srgb: true, repeatX, repeatY }),
      bumpMap: this._registerTex(bumpC, { srgb: false, repeatX, repeatY }),
      roughnessMap: null
    };
  }

  _buildMetalDoor(repeatX, repeatY) {
    const size = 256;
    const mapC = makeCanvas(size);
    const bumpC = makeCanvas(size);
    const roughC = makeCanvas(size);
    const ctx = mapC.getContext('2d');
    const bctx = bumpC.getContext('2d');
    const rctx = roughC.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#5a6878');
    grad.addColorStop(0.5, '#475361');
    grad.addColorStop(1, '#394450');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    bctx.fillStyle = '#9a9a9a';
    bctx.fillRect(0, 0, size, size);
    rctx.fillStyle = '#626262';
    rctx.fillRect(0, 0, size, size);

    // Double door center seam + reinforced ribs
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(size / 2 - 3, 0, 6, size);
    bctx.fillStyle = '#242424';
    bctx.fillRect(size / 2 - 3, 0, 6, size);

    for (const px of [12, size / 2 + 12]) {
      const pw = size / 2 - 24;
      ctx.strokeStyle = '#6d7c8e';
      ctx.lineWidth = 4;
      ctx.strokeRect(px, 16, pw, size - 32);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(px + 8, 28, pw - 16, size * 0.36);
      ctx.fillRect(px + 8, size * 0.56, pw - 16, size * 0.32);

      bctx.strokeStyle = '#e0e0e0';
      bctx.lineWidth = 4;
      bctx.strokeRect(px, 16, pw, size - 32);

      // Rivets
      for (let ry = 24; ry <= size - 24; ry += 34) {
        for (const rx of [px + 6, px + pw - 6]) {
          ctx.fillStyle = '#94a3b8';
          ctx.beginPath();
          ctx.arc(rx, ry, 2.8, 0, Math.PI * 2);
          ctx.fill();
          bctx.fillStyle = '#ffffff';
          bctx.beginPath();
          bctx.arc(rx, ry, 2.8, 0, Math.PI * 2);
          bctx.fill();
          rctx.fillStyle = '#363636';
          rctx.beginPath();
          rctx.arc(rx, ry, 2.8, 0, Math.PI * 2);
          rctx.fill();
        }
      }
    }

    // Subtle rust streak near base
    ctx.fillStyle = 'rgba(138, 68, 32, 0.25)';
    ctx.fillRect(0, size - 28, size, 28);

    return {
      map: this._registerTex(mapC, { srgb: true, repeatX, repeatY }),
      bumpMap: this._registerTex(bumpC, { srgb: false, repeatX, repeatY }),
      roughnessMap: this._registerTex(roughC, { srgb: false, repeatX, repeatY })
    };
  }

  _buildWoodTrim(repeatX, repeatY) {
    const size = 256;
    const mapC = makeCanvas(size);
    const bumpC = makeCanvas(size);
    const ctx = mapC.getContext('2d');
    const bctx = bumpC.getContext('2d');

    ctx.fillStyle = '#7b5230';
    ctx.fillRect(0, 0, size, size);
    bctx.fillStyle = '#a8a8a8';
    bctx.fillRect(0, 0, size, size);

    for (let y = 0; y < size; y += 32) {
      ctx.fillStyle = y % 64 === 0 ? '#855a36' : '#6f4828';
      ctx.fillRect(0, y, size, 30);
      ctx.fillStyle = '#472d16';
      ctx.fillRect(0, y + 30, size, 2);
      bctx.fillStyle = '#404040';
      bctx.fillRect(0, y + 30, size, 2);
    }

    return {
      map: this._registerTex(mapC, { srgb: true, repeatX, repeatY }),
      bumpMap: this._registerTex(bumpC, { srgb: false, repeatX, repeatY }),
      roughnessMap: null
    };
  }

  _buildBarrier(repeatX, repeatY) {
    const size = 256;
    const mapC = makeCanvas(size);
    const ctx = mapC.getContext('2d');

    ctx.fillStyle = '#272a30';
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.fillStyle = '#d97706';
    for (let x = -size; x < size * 2; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, size);
      ctx.lineTo(x + 24, size);
      ctx.lineTo(x + 24 + size, 0);
      ctx.lineTo(x + size, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(15, 17, 21, 0.78)';
    ctx.fillRect(0, size * 0.34, size, size * 0.32);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WINGMAN LOCKED', size / 2, size / 2);

    return {
      map: this._registerTex(mapC, { srgb: true, repeatX, repeatY }),
      bumpMap: null,
      roughnessMap: null
    };
  }

  _buildSiteStencil(letter, accentHex, repeatX, repeatY) {
    const size = 256;
    const mapC = makeCanvas(size);
    const ctx = mapC.getContext('2d');

    ctx.fillStyle = '#bfa67e';
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = accentHex;
    ctx.lineWidth = 14;
    ctx.strokeRect(16, 16, size - 32, size - 32);

    ctx.fillStyle = 'rgba(15, 17, 21, 0.25)';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 72, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = accentHex;
    ctx.font = '900 124px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, size / 2, size / 2 + 6);

    return {
      map: this._registerTex(mapC, { srgb: true, repeatX, repeatY, wrap: THREE.ClampToEdgeWrapping }),
      bumpMap: null,
      roughnessMap: null
    };
  }

  getBulletHoleTexture() {
    if (this._bulletHoleTex) return this._bulletHoleTex;
    const size = 64;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 28);
    grad.addColorStop(0, 'rgba(12, 12, 14, 0.96)');
    grad.addColorStop(0.32, 'rgba(28, 24, 20, 0.86)');
    grad.addColorStop(0.65, 'rgba(80, 68, 52, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#070708';
    ctx.beginPath();
    ctx.arc(32, 32, 9, 0, Math.PI * 2);
    ctx.fill();

    this._bulletHoleTex = this._registerTex(c, {
      srgb: true,
      wrap: THREE.ClampToEdgeWrapping,
      mipmaps: false,
      anisotropy: 1
    });
    return this._bulletHoleTex;
  }

  getMuzzleFlashTexture() {
    if (this._muzzleFlashTex) return this._muzzleFlashTex;
    const size = 128;
    const half = size / 2;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    const glow = ctx.createRadialGradient(half, half, 2, half, half, half * 0.9);
    glow.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    glow.addColorStop(0.24, 'rgba(255, 215, 110, 0.92)');
    glow.addColorStop(0.6, 'rgba(255, 120, 20, 0.42)');
    glow.addColorStop(1, 'rgba(255, 80, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(half, half, half * 0.9, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const len = i % 2 === 0 ? half * 0.92 : half * 0.68;
      ctx.save();
      ctx.translate(half, half);
      ctx.rotate(ang);
      ctx.fillStyle = 'rgba(255, 238, 168, 0.8)';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    this._muzzleFlashTex = this._registerTex(c, {
      srgb: true,
      wrap: THREE.ClampToEdgeWrapping,
      mipmaps: false,
      anisotropy: 1
    });
    return this._muzzleFlashTex;
  }

  dispose() {
    for (const tex of this._textures) {
      tex.dispose();
    }
    this._textures.length = 0;
    this._sets.clear();
    this._bulletHoleTex = null;
    this._muzzleFlashTex = null;
  }
}
