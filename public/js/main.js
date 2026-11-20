import {
  BOT_DIFFICULTIES,
  BR_HALF_SIZE,
  BR_PRESETS,
  BUILD_MATERIALS,
  PLAYER_SKINS,
  QUALITY_PRESETS
} from './game/constants.js';
import { storage } from './storage.js';
import { audio } from './audio.js';
import { network } from './network.js';
import { initPortal } from './portal.js';
import { Lobby3DPreview } from './lobby3d.js';
import { ArenaGame } from './game/arena.js';

// Views
const views = {
  portal: document.getElementById('portal-view'),
  lobby: document.getElementById('lobby-view'),
  game: document.getElementById('game-view')
};

// Toast helper
const toastContainer = document.getElementById('toast-container');
function showToast(msg, duration = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// Quality & Mute global synchronization
const SVG_SOUND_ON = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
const SVG_SOUND_OFF = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

const qualityButtons = document.querySelectorAll('.q-btn');
const qualityDescEl = document.getElementById('portal-quality-desc');
const portalMuteBtn = document.getElementById('portal-mute-btn');
const lobbyMuteBtn = document.getElementById('lobby-mute-btn');
const pauseMuteBtn = document.getElementById('pause-mute-btn');
const portalCallsignNameEl = document.getElementById('portal-callsign-name');
const portalSkinDotEl = document.getElementById('portal-skin-dot');
const lobbyLockerSummaryEl = document.getElementById('lobby-locker-summary');

function syncGlobalControlsUI(state) {
  qualityButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.quality === state.quality);
  });
  const qInfo = QUALITY_PRESETS[state.quality] || QUALITY_PRESETS.medium;
  if (qualityDescEl) {
    qualityDescEl.textContent = `${qInfo.label} graphics • ${qInfo.desc}`;
  }

  const skin = PLAYER_SKINS.find((s) => s.id === state.skinId) || PLAYER_SKINS[0];
  const mat = BUILD_MATERIALS[state.buildMat] || BUILD_MATERIALS.wood;
  if (portalCallsignNameEl) portalCallsignNameEl.textContent = state.playerName || 'Player';
  if (portalSkinDotEl) {
    portalSkinDotEl.style.background = `#${skin.primary.toString(16).padStart(6, '0')}`;
  }
  if (lobbyLockerSummaryEl) {
    lobbyLockerSummaryEl.textContent = `${skin.name} • ${mat.name}`;
  }

  const muted = Boolean(state.muted);
  if (portalMuteBtn) portalMuteBtn.innerHTML = muted ? SVG_SOUND_OFF : SVG_SOUND_ON;
  if (lobbyMuteBtn) lobbyMuteBtn.innerHTML = muted ? SVG_SOUND_OFF : SVG_SOUND_ON;
  if (pauseMuteBtn) pauseMuteBtn.textContent = muted ? 'Muted' : 'On';
}

qualityButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playUiClick();
    storage.update({ quality: btn.dataset.quality });
  });
});

function toggleMute() {
  const nextMuted = !storage.get().muted;
  storage.update({ muted: nextMuted });
  if (!nextMuted) audio.playUiClick();
}
portalMuteBtn?.addEventListener('click', toggleMute);
lobbyMuteBtn?.addEventListener('click', toggleMute);
pauseMuteBtn?.addEventListener('click', toggleMute);

// Lazy init 3D instances
let lobby3D = null;
let arenaGame = null;
let currentView = 'portal';

function switchView(name) {
  currentView = name;
  for (const [key, el] of Object.entries(views)) {
    el.classList.toggle('active', key === name);
  }

  if (name === 'lobby') {
    if (!lobby3D) {
      lobby3D = new Lobby3DPreview(document.getElementById('lobby-canvas'));
    }
    lobby3D.start();
    requestAnimationFrame(() => lobby3D.resize());
  } else if (lobby3D) {
    lobby3D.stop();
  }
}

// ================= 1. PORTAL INIT =================
initPortal(document.getElementById('games-grid'), {
  onLaunchBuildRoyale: () => switchView('lobby'),
  onToast: showToast
});

document.getElementById('hero-play-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  switchView('lobby');
});

document.getElementById('portal-callsign-pill')?.addEventListener('click', () => {
  audio.playUiClick();
  switchView('lobby');
});

// ================= 2. LOBBY INIT =================
document.getElementById('lobby-back-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  cancelMatchmakingUI();
  controlsModal?.classList.add('hidden');
  switchView('portal');
});

// Controls reference modal
const controlsModal = document.getElementById('controls-modal');
document.getElementById('controls-open-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  controlsModal?.classList.remove('hidden');
});
document.getElementById('controls-close-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  controlsModal?.classList.add('hidden');
});
controlsModal?.addEventListener('click', (e) => {
  if (e.target === controlsModal) {
    controlsModal.classList.add('hidden');
  }
});

// Nickname
const nameInput = document.getElementById('player-name-input');
if (nameInput) {
  nameInput.value = storage.get().playerName;
  nameInput.addEventListener('input', () => {
    const cleaned = nameInput.value.trim().slice(0, 18) || 'Player';
    storage.update({ playerName: cleaned });
  });
}

// Cosmetics Pickers
const skinPickerEl = document.getElementById('skin-picker');
const matPickerEl = document.getElementById('material-picker');

function renderCosmetics(state) {
  if (skinPickerEl) {
    skinPickerEl.innerHTML = '';
    for (const skin of PLAYER_SKINS) {
      const btn = document.createElement('button');
      btn.className = `skin-btn ${state.skinId === skin.id ? 'active' : ''}`;
      btn.title = skin.name;
      const pHex = `#${skin.primary.toString(16).padStart(6, '0')}`;
      const sHex = `#${skin.secondary.toString(16).padStart(6, '0')}`;
      const vHex = `#${skin.visor.toString(16).padStart(6, '0')}`;
      btn.innerHTML = `
        <span class="skin-swatch" style="background:linear-gradient(135deg, ${pHex} 55%, ${sHex} 100%)">
          <span class="skin-visor-accent" style="background:${vHex}"></span>
        </span>
      `;
      btn.addEventListener('click', () => {
        audio.playUiClick();
        storage.update({ skinId: skin.id });
      });
      skinPickerEl.appendChild(btn);
    }
  }

  if (matPickerEl) {
    matPickerEl.innerHTML = '';
    for (const mat of Object.values(BUILD_MATERIALS)) {
      const btn = document.createElement('button');
      btn.className = `mat-btn ${state.buildMat === mat.id ? 'active' : ''}`;
      const hexStr = `#${mat.color.toString(16).padStart(6, '0')}`;
      const pct = Math.round((mat.hp / 300) * 100);
      btn.innerHTML = `
        <span class="mat-swatch" style="background:${hexStr}"></span>
        <span>${mat.name}</span>
        <span class="mat-hp-bar"><span style="width:${pct}%;background:${hexStr}"></span></span>
      `;
      btn.addEventListener('click', () => {
        audio.playUiClick();
        storage.update({ buildMat: mat.id });
      });
      matPickerEl.appendChild(btn);
    }
  }
}

// Interactive 3D Pose Preview in Lobby
const poseButtons = document.querySelectorAll('.pose-picker .pose-btn');
poseButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playUiClick();
    poseButtons.forEach((b) => b.classList.toggle('active', b === btn));
    if (!lobby3D) return;
    const pose = btn.dataset.pose;
    if (pose === 'ar') lobby3D.setPreviewPose(1, false);
    else if (pose === 'pickaxe') lobby3D.setPreviewPose(2, false);
    else if (pose === 'build') lobby3D.setPreviewPose(0, true);
    else lobby3D.setPreviewPose(0, false);
  });
});

// Lobby Mode Switcher (1v1 Build Fight vs Battle Royale)
const mode1v1Card = document.getElementById('mode-1v1-card');
const modeBrCard = document.getElementById('mode-br-card');
const lobby1v1Panel = document.getElementById('lobby-1v1-panel');
const lobbyBrPanel = document.getElementById('lobby-br-panel');
let lobbyMode = '1v1';

function selectLobbyMode(m) {
  lobbyMode = m === 'br' ? 'br' : '1v1';
  mode1v1Card?.classList.toggle('active', lobbyMode === '1v1');
  modeBrCard?.classList.toggle('active', lobbyMode === 'br');
  lobby1v1Panel?.classList.toggle('hidden', lobbyMode !== '1v1');
  lobbyBrPanel?.classList.toggle('hidden', lobbyMode !== 'br');
}

mode1v1Card?.addEventListener('click', () => {
  audio.playUiClick();
  selectLobbyMode('1v1');
});

modeBrCard?.addEventListener('click', () => {
  audio.playUiClick();
  selectLobbyMode('br');
});

// Battle Royale Preset Selector
let selectedBrPreset = 'balanced';
const brDiffBtns = document.querySelectorAll('#br-diff-picker .diff-btn');
const brPresetDescEl = document.getElementById('br-preset-desc');
brDiffBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playUiClick();
    selectedBrPreset = BR_PRESETS[btn.dataset.br] ? btn.dataset.br : 'balanced';
    brDiffBtns.forEach((b) => b.classList.toggle('active', b === btn));
    if (brPresetDescEl) {
      brPresetDescEl.textContent = (BR_PRESETS[selectedBrPreset] || BR_PRESETS.balanced).desc;
    }
  });
});

// Lobby mode tabs (Solo | Bot | Friend | Random)
const playTabs = document.querySelectorAll('#lobby-play-tabs .play-tab');
const tabPanels = document.querySelectorAll('.tab-panel[data-panel]');
function selectPlayTab(tabId) {
  playTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tabId));
  tabPanels.forEach((p) => p.classList.toggle('active', p.dataset.panel === tabId));
}
playTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    audio.playUiClick();
    selectPlayTab(tab.dataset.tab);
  });
});

// Selected Map & Bot Difficulty
let selectedMapId = 'skybox';
const mapBtns = document.querySelectorAll('#map-picker .map-btn');
mapBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playUiClick();
    selectedMapId = btn.dataset.map === 'vramp' ? 'vramp' : 'skybox';
    mapBtns.forEach((b) => b.classList.toggle('active', b === btn));
  });
});

const BOT_DESCRIPTIONS = {
  easy: 'Slower reactions, basic cover (max 2 stories).',
  medium: 'Balanced AI duel up to 4 stories (7–0 changes level in-game).',
  hard: 'Fast vertical cranking (up to 7 stories) & active cover.',
  extreme: 'Instant floor-ramp cranking (up to 11 stories) & sharp aim.'
};

let selectedBotDiff = 'medium';
const diffBtns = document.querySelectorAll('#bot-diff-picker .diff-btn');
const pauseDiffBtns = document.querySelectorAll('#pause-bot-diff-picker .diff-btn');
const botProfileDescEl = document.getElementById('bot-profile-desc');

function syncBotDifficultyButtons(diff) {
  selectedBotDiff = BOT_DIFFICULTIES[diff] ? diff : 'medium';
  diffBtns.forEach((b) => b.classList.toggle('active', b.dataset.diff === selectedBotDiff));
  pauseDiffBtns.forEach((b) => b.classList.toggle('active', b.dataset.diff === selectedBotDiff));
  if (botProfileDescEl) {
    botProfileDescEl.textContent = BOT_DESCRIPTIONS[selectedBotDiff] || BOT_DESCRIPTIONS.medium;
  }
}

diffBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playUiClick();
    syncBotDifficultyButtons(btn.dataset.diff);
  });
});

pauseDiffBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playUiClick();
    syncBotDifficultyButtons(btn.dataset.diff);
    if (arenaGame && arenaGame.mode === 'bot') {
      arenaGame.setBotDifficulty(btn.dataset.diff);
    }
  });
});

// ================= 3. ARENA LAUNCHER & HUD =================
const hudEls = {
  fps: document.getElementById('hud-fps'),
  ping: document.getElementById('hud-ping'),
  modeBadge: document.getElementById('hud-mode-badge'),
  mapBadge: document.getElementById('hud-map-badge'),
  roomBadge: document.getElementById('hud-room-badge'),
  copyInviteBtn: document.getElementById('hud-copy-invite'),
  myName: document.getElementById('sb-my-name'),
  myKills: document.getElementById('sb-my-kills'),
  oppKills: document.getElementById('sb-opp-kills'),
  oppName: document.getElementById('sb-opp-name'),
  oppBars: document.getElementById('opp-bars'),
  oppShieldFill: document.getElementById('opp-shield-fill'),
  oppHpFill: document.getElementById('opp-hp-fill'),
  oppShieldVal: document.getElementById('opp-shield-val'),
  oppHpVal: document.getElementById('opp-hp-val'),
  banner: document.getElementById('hud-banner'),
  crosshair: document.getElementById('crosshair'),
  hitmarker: document.getElementById('hitmarker'),
  dmgPopup: document.getElementById('dmg-popup'),
  editHint: document.getElementById('edit-hint'),
  lockHint: document.getElementById('lock-hint'),
  countdown: document.getElementById('countdown-display'),
  boxProtectHint: document.getElementById('box-protect-hint'),
  boostHint: document.getElementById('boost-hint'),
  hudBotKeys: document.getElementById('hud-bot-keys'),
  pauseBotRow: document.getElementById('pause-bot-row'),
  myShieldTrail: document.getElementById('my-shield-trail'),
  myShieldFill: document.getElementById('my-shield-fill'),
  myShieldVal: document.getElementById('my-shield-val'),
  myHpTrail: document.getElementById('my-hp-trail'),
  myHpFill: document.getElementById('my-hp-fill'),
  myHpVal: document.getElementById('my-hp-val'),
  ammoText: document.getElementById('ammo-text'),
  reloadBadge: document.getElementById('reload-badge'),
  matDot: document.getElementById('hud-mat-dot'),
  matText: document.getElementById('hud-mat-text'),
  matBadge: document.getElementById('hud-mat-badge'),
  damageVignette: document.getElementById('damage-vignette'),
  pauseOverlay: document.getElementById('pause-overlay'),
  // BR & 1v1 visibility toggles
  scoreboard1v1: document.getElementById('scoreboard-1v1'),
  resetNote1v1: document.getElementById('hud-1v1-reset-note'),
  brHudTop: document.getElementById('br-hud-top'),
  brAliveVal: document.getElementById('br-alive-val'),
  brElimsVal: document.getElementById('br-elims-val'),
  brStormPill: document.getElementById('br-storm-pill'),
  brStormState: document.getElementById('br-storm-state'),
  brStormTimer: document.getElementById('br-storm-timer'),
  brStormWarning: document.getElementById('br-storm-warning'),
  brKillFeed: document.getElementById('br-killfeed'),
  brMinimapWrap: document.getElementById('br-minimap-wrap'),
  brMinimap: document.getElementById('br-minimap'),
  brPhaseNote: document.getElementById('br-phase-note'),
  brEndOverlay: document.getElementById('br-end-overlay'),
  brEndCard: document.getElementById('br-end-card'),
  brEndPlace: document.getElementById('br-end-place'),
  brEndTitle: document.getElementById('br-end-title'),
  brEndSub: document.getElementById('br-end-sub'),
  brEndKills: document.getElementById('br-end-kills'),
  brEndTime: document.getElementById('br-end-time')
};

const minimapCtx = hudEls.brMinimap ? hudEls.brMinimap.getContext('2d') : null;
let lastKillFeedKey = '';

function formatClockSec(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem < 10 ? '0' : ''}${rem}`;
}

function drawBrMinimap(br) {
  if (!minimapCtx || !br) return;
  const ctx = minimapCtx;
  const size = 136;
  const half = size * 0.5;
  const scale = (size - 12) / (BR_HALF_SIZE * 2);
  const toX = (wx) => half + wx * scale;
  const toY = (wz) => half + wz * scale;

  ctx.fillStyle = '#0c7aa8';
  ctx.fillRect(0, 0, size, size);

  // Island footprint
  const iLeft = toX(-BR_HALF_SIZE);
  const iSize = BR_HALF_SIZE * 2 * scale;
  ctx.fillStyle = '#43a84a';
  ctx.fillRect(iLeft, iLeft, iSize, iSize);
  ctx.strokeStyle = '#f4d898';
  ctx.lineWidth = 1.6;
  ctx.strokeRect(iLeft, iLeft, iSize, iSize);

  // Grid crosshairs
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(half, iLeft);
  ctx.lineTo(half, iLeft + iSize);
  ctx.moveTo(iLeft, half);
  ctx.lineTo(iLeft + iSize, half);
  ctx.stroke();

  // POI blocks
  if (br.pois) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < br.pois.length; i++) {
      const p = br.pois[i];
      ctx.fillRect(toX(p.x) - 2.5, toY(p.z) - 2.5, 5, 5);
    }
  }

  // Active loot orbs
  if (br.lootOrbs) {
    for (let i = 0; i < br.lootOrbs.length; i++) {
      const o = br.lootOrbs[i];
      if (!o.active) continue;
      ctx.fillStyle = o.kind === 'siphon' ? '#facc15' : '#38bdf8';
      ctx.fillRect(toX(o.x) - 1, toY(o.z) - 1, 2.2, 2.2);
    }
  }

  // Storm purple overlay outside storm radius (even-odd winding)
  const st = br.storm;
  const sx = toX(st.cx);
  const sy = toY(st.cz);
  const sr = Math.max(2, st.radius * scale);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.arc(sx, sy, sr, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(168, 85, 247, 0.32)';
  ctx.fill('evenodd');
  ctx.restore();

  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.stroke();

  // Next Safe Zone ring (white dashed)
  if (st.state !== 'done') {
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(toX(st.nextCx), toY(st.nextCz), Math.max(2, st.nextRadius * scale), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Local player directional arrow
  const px = toX(br.playerX);
  const py = toY(br.playerZ);
  const dx = -Math.sin(br.playerYaw);
  const dy = -Math.cos(br.playerYaw);
  const ang = Math.atan2(dy, dx);

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(ang);
  ctx.fillStyle = '#ef4444';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(5.8, 0);
  ctx.lineTo(-4.2, -3.7);
  ctx.lineTo(-2.3, 0);
  ctx.lineTo(-4.2, 3.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

let bannerTimer = 0;
let hitmarkerTimer = 0;
let dmgPopupTimer = 0;
let vignetteTimer = 0;
let lastCdShown = '';

function ensureArena() {
  if (arenaGame) return arenaGame;
  arenaGame = new ArenaGame(document.getElementById('arena-canvas'), {
    onPauseChange: (paused) => {
      hudEls.pauseOverlay.classList.toggle('hidden', !paused);
    },
    onBrMatchEnd: (summary) => {
      if (!hudEls.brEndOverlay) return;
      hudEls.brEndOverlay.classList.remove('hidden');
      hudEls.brEndCard?.classList.toggle('victory', Boolean(summary.victory));
      if (hudEls.brEndPlace) hudEls.brEndPlace.textContent = `#${summary.placement} / ${summary.total}`;
      if (hudEls.brEndTitle) hudEls.brEndTitle.textContent = summary.victory ? 'VICTORY ROYALE' : 'ELIMINATED';
      if (hudEls.brEndSub) {
        hudEls.brEndSub.textContent = summary.victory
          ? 'Last fighter standing on Fortress Island!'
          : `Eliminated by ${summary.killerName || 'Opponent'}`;
      }
      if (hudEls.brEndKills) hudEls.brEndKills.textContent = String(summary.kills || 0);
      if (hudEls.brEndTime) hudEls.brEndTime.textContent = formatClockSec(summary.survivalSec || 0);
    },
    onDamageFlash: () => {
      hudEls.damageVignette.classList.add('flash');
      clearTimeout(vignetteTimer);
      vignetteTimer = setTimeout(() => hudEls.damageVignette.classList.remove('flash'), 170);
    },
    onHitMarker: (dmg, isHeadshot, shieldHit = false) => {
      hudEls.hitmarker.classList.remove('hidden');
      hudEls.hitmarker.classList.toggle('headshot', Boolean(isHeadshot));
      clearTimeout(hitmarkerTimer);
      hitmarkerTimer = setTimeout(() => hudEls.hitmarker.classList.add('hidden'), 140);

      hudEls.dmgPopup.textContent = `${dmg}${isHeadshot ? '!' : ''}`;
      hudEls.dmgPopup.className = 'dmg-popup';
      if (isHeadshot) hudEls.dmgPopup.classList.add('headshot');
      else if (shieldHit) hudEls.dmgPopup.classList.add('shield');
      // Retrigger pop drift animation cleanly
      void hudEls.dmgPopup.offsetWidth;
      hudEls.dmgPopup.classList.add('pop');
      clearTimeout(dmgPopupTimer);
      dmgPopupTimer = setTimeout(() => hudEls.dmgPopup.classList.add('hidden'), 460);
    },
    onBanner: (text, tone = 'info') => {
      hudEls.banner.textContent = text;
      hudEls.banner.className = `hud-banner ${tone}`;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => hudEls.banner.classList.add('hidden'), 2400);
    },
    onHudUpdate: (data) => {
      // FPS & Ping telemetry
      hudEls.fps.textContent = `${data.fps} FPS`;
      hudEls.fps.className = `t-seg ${data.fps >= 50 ? 'good' : (data.fps >= 30 ? 'warn' : 'bad')}`;

      if (data.mode === 'online') {
        hudEls.ping.textContent = `${data.ping} ms`;
        hudEls.ping.className = `t-seg ${data.ping <= 65 ? 'good' : (data.ping <= 130 ? 'warn' : 'bad')}`;
      } else {
        hudEls.ping.textContent = 'Offline';
        hudEls.ping.className = 't-seg';
      }

      const isBR = data.mode === 'br';
      const modeText = isBR ? 'BATTLE ROYALE' : (data.mode === 'solo' ? 'SOLO' : (data.mode === 'bot' ? 'VS BOT' : 'ONLINE'));
      hudEls.modeBadge.textContent = modeText;
      if (hudEls.mapBadge) {
        hudEls.mapBadge.textContent = isBR ? 'ISLAND' : (data.mapId === 'vramp' ? '1v1 V-RAMP' : 'SKY DROP');
      }

      if (data.mode === 'online' && data.roomCode) {
        hudEls.roomBadge.textContent = `#${data.roomCode}`;
        hudEls.roomBadge.classList.remove('hidden');
        hudEls.copyInviteBtn.classList.remove('hidden');
      } else {
        hudEls.roomBadge.classList.add('hidden');
        hudEls.copyInviteBtn.classList.add('hidden');
      }

      // Toggle 1v1 vs Battle Royale HUD elements cleanly
      hudEls.scoreboard1v1?.classList.toggle('hidden', isBR);
      hudEls.oppBars?.classList.toggle('hidden', isBR);
      hudEls.resetNote1v1?.classList.toggle('hidden', isBR);
      hudEls.brHudTop?.classList.toggle('hidden', !isBR);
      hudEls.brMinimapWrap?.classList.toggle('hidden', !isBR);
      hudEls.brKillFeed?.classList.toggle('hidden', !isBR);

      if (isBR && data.br) {
        if (hudEls.brAliveVal) hudEls.brAliveVal.textContent = String(data.br.aliveCount);
        if (hudEls.brElimsVal) hudEls.brElimsVal.textContent = String(data.kills);
        const st = data.br.storm;
        if (hudEls.brStormState) {
          hudEls.brStormState.textContent = st.state === 'shrink' ? 'SHRINK' : (st.state === 'done' ? 'FINAL' : 'SAFE');
        }
        if (hudEls.brStormTimer) {
          hudEls.brStormTimer.textContent = st.state === 'done' ? '0:00' : formatClockSec(st.timer);
        }
        hudEls.brStormPill?.classList.toggle('shrinking', st.state === 'shrink');
        hudEls.brStormWarning?.classList.toggle('hidden', !st.playerInStorm);
        if (hudEls.brPhaseNote) {
          hudEls.brPhaseNote.textContent = `PHASE ${st.phase} • ${st.dps}/s`;
        }
        if (hudEls.brKillFeed) {
          const kfKey = data.br.killFeed.map((k) => k.text).join('|');
          if (kfKey !== lastKillFeedKey) {
            lastKillFeedKey = kfKey;
            hudEls.brKillFeed.innerHTML = '';
            for (let i = 0; i < data.br.killFeed.length; i++) {
              const item = data.br.killFeed[i];
              const row = document.createElement('div');
              row.className = `kf-row ${item.isPlayerKill ? 'mine' : ''}`;
              row.textContent = item.text;
              hudEls.brKillFeed.appendChild(row);
            }
          }
        }
        drawBrMinimap(data.br);
      } else {
        hudEls.brStormWarning?.classList.add('hidden');
        hudEls.myName.textContent = storage.get().playerName;
        hudEls.myKills.textContent = data.kills;
        hudEls.oppName.textContent = data.opponent.name;
        hudEls.oppKills.textContent = data.opponent.kills;
        hudEls.oppShieldFill.style.width = `${Math.max(0, Math.min(100, data.opponent.shield))}%`;
        hudEls.oppHpFill.style.width = `${Math.max(0, Math.min(100, data.opponent.hp))}%`;
        if (hudEls.oppShieldVal) hudEls.oppShieldVal.textContent = Math.max(0, data.opponent.shield);
        if (hudEls.oppHpVal) hudEls.oppHpVal.textContent = Math.max(0, data.opponent.hp);
      }

      // Player HP & Shield with delayed damage drain trails
      const shieldPct = `${Math.max(0, Math.min(100, data.shield))}%`;
      const hpPct = `${Math.max(0, Math.min(100, data.hp))}%`;
      hudEls.myShieldVal.textContent = data.shield;
      hudEls.myShieldFill.style.width = shieldPct;
      if (hudEls.myShieldTrail) hudEls.myShieldTrail.style.width = shieldPct;
      hudEls.myHpVal.textContent = data.hp;
      hudEls.myHpFill.style.width = hpPct;
      if (hudEls.myHpTrail) hudEls.myHpTrail.style.width = hpPct;
      hudEls.myHpFill.classList.toggle('low-hp', data.hp <= 35);

      // Ammo & Reload
      hudEls.ammoText.textContent = Number.isFinite(data.magSize) ? `${data.ammo} / ${data.magSize}` : '∞';
      hudEls.reloadBadge.classList.toggle('hidden', !data.reloading);

      // Reticle, Countdown pop, Box Protection, Boost & Edit
      hudEls.crosshair.classList.toggle('build-mode', Boolean(data.buildType || data.editActive));
      hudEls.crosshair.classList.toggle('shotgun', !data.buildType && !data.editActive && data.weaponSlot === 0);
      hudEls.crosshair.classList.toggle('ads', Boolean(data.isADS));
      hudEls.editHint.classList.toggle('hidden', !data.editActive);
      const brDone = Boolean(data.br && data.br.finished);
      hudEls.lockHint.classList.toggle('hidden', Boolean(data.pointerLocked || data.paused || brDone));

      if (hudEls.countdown) {
        const cdText = data.countdownText || (data.countdown > 0 ? String(data.countdown) : '');
        hudEls.countdown.classList.toggle('hidden', !cdText);
        if (cdText) {
          if (cdText !== lastCdShown) {
            lastCdShown = cdText;
            hudEls.countdown.textContent = cdText;
            hudEls.countdown.classList.toggle('go', cdText === 'START!');
            hudEls.countdown.classList.remove('pop');
            void hudEls.countdown.offsetWidth;
            hudEls.countdown.classList.add('pop');
          }
        } else {
          lastCdShown = '';
        }
      }
      if (hudEls.boxProtectHint) {
        const isGlidingBR = Boolean(data.br && data.br.gliding);
        if (isGlidingBR) {
          hudEls.boxProtectHint.textContent = 'Air Drop — steer with WASD, hold SPACE to dive';
        } else {
          hudEls.boxProtectHint.textContent = 'Spawn Box — shooting & building locked, jump on the Boost Pad';
        }
        hudEls.boxProtectHint.classList.toggle('hidden', !((data.inSpawnBox || isGlidingBR) && data.alive));
      }
      if (hudEls.boostHint) {
        hudEls.boostHint.classList.toggle('hidden', !data.canAirBoost);
      }
      if (hudEls.hudBotKeys) {
        hudEls.hudBotKeys.classList.toggle('hidden', data.mode !== 'bot');
      }
      if (hudEls.pauseBotRow) {
        hudEls.pauseBotRow.classList.toggle('hidden', data.mode !== 'bot');
      }
      if (data.mode === 'bot' && data.botDifficulty) {
        syncBotDifficultyButtons(data.botDifficulty);
      }

      // Slots highlight
      document.querySelectorAll('.slot-card[data-wslot]').forEach((el) => {
        const slot = Number(el.dataset.wslot);
        el.classList.toggle('active', !data.buildType && !data.editActive && slot === data.weaponSlot);
      });
      document.querySelectorAll('.slot-card[data-bslot]').forEach((el) => {
        el.classList.toggle('active', el.dataset.bslot === data.buildType);
      });

      const matInfo = BUILD_MATERIALS[data.buildMat] || BUILD_MATERIALS.wood;
      if (hudEls.matText) hudEls.matText.textContent = matInfo.name;
      if (hudEls.matDot) {
        hudEls.matDot.style.background = `#${matInfo.color.toString(16).padStart(6, '0')}`;
      }
    }
  });
  return arenaGame;
}

function launchArena(opts) {
  cancelMatchmakingUI();
  controlsModal?.classList.add('hidden');
  switchView('game');
  hudEls.pauseOverlay.classList.add('hidden');
  hudEls.brEndOverlay?.classList.add('hidden');
  lastKillFeedKey = '';
  if (hudEls.brKillFeed) hudEls.brKillFeed.innerHTML = '';
  const game = ensureArena();
  game.startSession(opts);
}

// Quick Launch from Portal Showcase
document.getElementById('hero-quick-br-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  launchArena({ mode: 'br', mapId: 'br', brPreset: selectedBrPreset });
});

document.getElementById('hero-quick-solo-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  launchArena({ mode: 'solo', mapId: selectedMapId });
});

document.getElementById('hero-quick-bot-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  launchArena({ mode: 'bot', mapId: selectedMapId, difficulty: selectedBotDiff });
});

// 0. Battle Royale (16 Fighters)
document.getElementById('btn-play-br')?.addEventListener('click', () => {
  audio.playUiClick();
  launchArena({ mode: 'br', mapId: 'br', brPreset: selectedBrPreset });
});

// 1. Solo Training
document.getElementById('btn-play-solo')?.addEventListener('click', () => {
  audio.playUiClick();
  launchArena({ mode: 'solo', mapId: selectedMapId });
});

// 2. AI Bot
function startBotMatch() {
  launchArena({ mode: 'bot', mapId: selectedMapId, difficulty: selectedBotDiff });
}
document.getElementById('btn-play-bot')?.addEventListener('click', () => {
  audio.playUiClick();
  startBotMatch();
});

// 3. Invite Friend (Private Room)
let createdRoomData = null;
const createdRoomBox = document.getElementById('created-room-box');
const createdRoomCodeEl = document.getElementById('created-room-code');
const joinRoomInput = document.getElementById('join-room-input');
const roomErrorEl = document.getElementById('room-error-msg');

function getProfilePayload() {
  const s = storage.get();
  return { name: s.playerName, skinId: s.skinId, buildMat: s.buildMat, mapId: selectedMapId };
}

function getInviteUrl(code) {
  return `${window.location.origin}/?room=${code}`;
}

async function copyInviteLink(code) {
  const url = getInviteUrl(code);
  try {
    await navigator.clipboard.writeText(url);
    showToast(`Invite link copied: ${url}`);
  } catch {
    showToast(`Code: #${code} (${url})`);
  }
}

document.getElementById('btn-create-room')?.addEventListener('click', async () => {
  audio.playUiClick();
  roomErrorEl.classList.add('hidden');
  const res = await network.createPrivateRoom(getProfilePayload());
  if (!res.ok) {
    roomErrorEl.textContent = res.error || 'Failed to create room.';
    roomErrorEl.classList.remove('hidden');
    return;
  }
  createdRoomData = res;
  createdRoomCodeEl.textContent = `#${res.code}`;
  createdRoomBox.classList.remove('hidden');
  showToast(`Room #${res.code} created.`);
});

document.getElementById('btn-copy-room-link')?.addEventListener('click', () => {
  audio.playUiClick();
  if (createdRoomData?.code) copyInviteLink(createdRoomData.code);
});

hudEls.copyInviteBtn?.addEventListener('click', () => {
  if (network.roomCode) copyInviteLink(network.roomCode);
});

document.getElementById('btn-enter-private')?.addEventListener('click', () => {
  audio.playUiClick();
  if (!createdRoomData) return;
  launchArena({
    mode: 'online',
    mapId: createdRoomData.mapId || selectedMapId,
    matchBuildMat: createdRoomData.matchBuildMat,
    slot: createdRoomData.slot,
    roomCode: createdRoomData.code,
    players: createdRoomData.players,
    existingBuilds: createdRoomData.builds || []
  });
});

async function joinRoomByCode(rawCode) {
  roomErrorEl.classList.add('hidden');
  const code = String(rawCode || '').trim().replace(/^#/, '').toUpperCase();
  if (!code) {
    roomErrorEl.textContent = 'Enter a 4-character room code.';
    roomErrorEl.classList.remove('hidden');
    return;
  }
  const res = await network.joinPrivateRoom(code, getProfilePayload());
  if (!res.ok) {
    roomErrorEl.textContent = res.error || 'Room not found.';
    roomErrorEl.classList.remove('hidden');
    return;
  }
  launchArena({
    mode: 'online',
    mapId: res.mapId || 'skybox',
    matchBuildMat: res.matchBuildMat,
    slot: res.slot,
    roomCode: res.code,
    players: res.players,
    existingBuilds: res.builds || []
  });
}

document.getElementById('btn-join-room')?.addEventListener('click', () => {
  audio.playUiClick();
  joinRoomByCode(joinRoomInput.value);
});

joinRoomInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoomByCode(joinRoomInput.value);
});

// 4. Random Matchmaking (10-second timeout -> offer Bot)
const mmBox = document.getElementById('mm-status-box');
const mmStatusText = document.getElementById('mm-status-text');
const mmFallback = document.getElementById('mm-fallback');
let mmTimer = null;
let mmRemaining = 10;
let mmSearching = false;

function cancelMatchmakingUI() {
  if (mmTimer) {
    clearInterval(mmTimer);
    mmTimer = null;
  }
  if (mmSearching) {
    mmSearching = false;
    network.cancelMatchmaking();
  }
  mmBox?.classList.add('hidden');
  mmFallback?.classList.add('hidden');
}

async function startMatchmaking() {
  cancelMatchmakingUI();
  mmSearching = true;
  mmRemaining = 10;
  mmBox.classList.remove('hidden');
  mmFallback.classList.add('hidden');
  mmStatusText.textContent = `Searching for opponent... (${mmRemaining}s)`;

  const res = await network.joinMatchmaking(getProfilePayload());
  if (!res.ok) {
    cancelMatchmakingUI();
    showToast(res.error || 'Online matchmaking is unavailable.');
    return;
  }
  if (res.matched) return;

  mmTimer = setInterval(() => {
    mmRemaining -= 1;
    if (mmRemaining > 0) {
      mmStatusText.textContent = `Searching for opponent... (${mmRemaining}s)`;
    } else {
      clearInterval(mmTimer);
      mmTimer = null;
      mmStatusText.textContent = 'No opponent found yet (still in queue)...';
      mmFallback.classList.remove('hidden');
    }
  }, 1000);
}

document.getElementById('btn-matchmaking')?.addEventListener('click', () => {
  audio.playUiClick();
  startMatchmaking();
});

document.getElementById('btn-mm-cancel')?.addEventListener('click', () => {
  audio.playUiClick();
  cancelMatchmakingUI();
});

document.getElementById('btn-mm-bot')?.addEventListener('click', () => {
  audio.playUiClick();
  cancelMatchmakingUI();
  startBotMatch();
});

document.getElementById('btn-mm-retry')?.addEventListener('click', () => {
  audio.playUiClick();
  startMatchmaking();
});

network.on('match_found', (data) => {
  if (currentView !== 'lobby') return;
  mmSearching = false;
  if (mmTimer) {
    clearInterval(mmTimer);
    mmTimer = null;
  }
  mmBox.classList.add('hidden');
  showToast('Opponent found!');
  launchArena({
    mode: 'online',
    mapId: data.mapId || selectedMapId,
    matchBuildMat: data.matchBuildMat,
    slot: data.slot,
    roomCode: data.code,
    players: data.players || [],
    existingBuilds: []
  });
});

// ================= 4. PAUSE MENU CONTROLS =================
const sensSlider = document.getElementById('sens-slider');
const sensVal = document.getElementById('sens-val');
if (sensSlider && sensVal) {
  const curSens = storage.get().sensitivity || 1.0;
  sensSlider.value = String(curSens);
  sensVal.textContent = `${curSens.toFixed(1)}x`;
  sensSlider.addEventListener('input', () => {
    const val = parseFloat(sensSlider.value);
    sensVal.textContent = `${val.toFixed(1)}x`;
    storage.update({ sensitivity: val });
  });
}

document.getElementById('hud-pause-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  if (arenaGame) arenaGame.setPaused(true);
});

document.getElementById('btn-resume-game')?.addEventListener('click', () => {
  audio.playUiClick();
  if (arenaGame) {
    arenaGame.setPaused(false);
    arenaGame.requestLock();
  }
});

document.getElementById('btn-leave-arena')?.addEventListener('click', () => {
  audio.playUiClick();
  if (arenaGame) arenaGame.stopSession();
  network.leaveRoom();
  createdRoomData = null;
  createdRoomBox?.classList.add('hidden');
  hudEls.brEndOverlay?.classList.add('hidden');
  switchView('lobby');
});

document.getElementById('btn-br-again')?.addEventListener('click', () => {
  audio.playUiClick();
  launchArena({ mode: 'br', mapId: 'br', brPreset: selectedBrPreset });
});

document.getElementById('btn-br-lobby')?.addEventListener('click', () => {
  audio.playUiClick();
  if (arenaGame) arenaGame.stopSession();
  hudEls.brEndOverlay?.classList.add('hidden');
  selectLobbyMode('br');
  switchView('lobby');
});

// ================= 5. NETWORK STATS & URL ROOM INVITE =================
const portalOnlineEl = document.getElementById('portal-online-count');
network.on('portal_stats', (stats) => {
  if (!portalOnlineEl || !stats) return;
  const n = stats.online || 1;
  portalOnlineEl.textContent = `${n} online`;
});

network.connect();

// Initial render of UI state
const initialState = storage.get();
syncGlobalControlsUI(initialState);
renderCosmetics(initialState);
syncBotDifficultyButtons(selectedBotDiff);
storage.subscribe((next) => {
  syncGlobalControlsUI(next);
  renderCosmetics(next);
});

// Check URL ?room=XXXX invite link
const params = new URLSearchParams(window.location.search);
const urlRoom = params.get('room');
if (urlRoom) {
  switchView('lobby');
  selectPlayTab('friend');
  if (joinRoomInput) joinRoomInput.value = urlRoom.toUpperCase();
  showToast(`Invite to room #${urlRoom.toUpperCase()}`);
  setTimeout(() => joinRoomByCode(urlRoom), 450);
}
