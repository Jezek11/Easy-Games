import {
  BOT_DIFFICULTIES,
  BUILD_MATERIALS,
  EMOTES,
  PLAYER_SKINS,
  QUALITY_PRESETS,
  WEAPON_CATALOG
} from './game/constants.js';
import { storage } from './storage.js';
import { audio } from './audio.js';
import { network } from './network.js';
import { initPortal } from './portal.js';
import {
  applyTranslations,
  getMaterialName,
  getQualityDesc,
  getSkinName,
  normalizeLang,
  t
} from './i18n.js';
import { Lobby3DPreview } from './lobby3d.js';
import { ArenaGame } from './game/arena.js';

// ================= VIEWS & TOAST =================
const views = {
  portal: document.getElementById('portal-view'),
  lobby: document.getElementById('lobby-view'),
  game: document.getElementById('game-view')
};

const toastContainer = document.getElementById('toast-container');
function showToast(msg, duration = 2400) {
  if (!toastContainer) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

async function copyTextSafe(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ================= GLOBAL SETTINGS SYNC =================
const langButtons = document.querySelectorAll('.lang-btn');
const qualityButtons = document.querySelectorAll('.q-btn');
const pauseQualityDesc = document.getElementById('pause-quality-desc');
const settingsQualityDesc = document.getElementById('settings-quality-desc');
const sensSlider = document.getElementById('sens-slider');
const sensVal = document.getElementById('sens-val');
const settingsSensSlider = document.getElementById('settings-sens-slider');
const settingsSensVal = document.getElementById('settings-sens-val');
const settingsMuteBtn = document.getElementById('settings-mute-btn');
const nameInput = document.getElementById('player-name-input');

function syncGlobalControlsUI(state) {
  const lang = normalizeLang(state.lang);
  applyTranslations(lang);
  langButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  qualityButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.quality === state.quality);
  });
  const qDesc = getQualityDesc(state.quality, lang);
  if (pauseQualityDesc) pauseQualityDesc.textContent = qDesc;
  if (settingsQualityDesc) settingsQualityDesc.textContent = qDesc;

  const sens = Number(state.sensitivity || 1.0);
  const sensText = sens.toFixed(1);
  if (sensSlider) sensSlider.value = String(sens);
  if (sensVal) sensVal.textContent = sensText;
  if (settingsSensSlider) settingsSensSlider.value = String(sens);
  if (settingsSensVal) settingsSensVal.textContent = sensText;

  if (settingsMuteBtn) {
    settingsMuteBtn.textContent = t(state.muted ? 'mute_muted' : 'mute_on', null, lang);
  }
  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = state.playerName || '';
  }
}

langButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playUiClick();
    storage.update({ lang: normalizeLang(btn.dataset.lang) });
  });
});

qualityButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playUiClick();
    storage.update({ quality: btn.dataset.quality });
  });
});

function bindSensSlider(sliderEl) {
  if (!sliderEl) return;
  sliderEl.addEventListener('input', () => {
    const val = parseFloat(sliderEl.value);
    if (Number.isFinite(val)) {
      storage.update({ sensitivity: val });
    }
  });
}
bindSensSlider(sensSlider);
bindSensSlider(settingsSensSlider);

settingsMuteBtn?.addEventListener('click', () => {
  const nextMuted = !storage.get().muted;
  storage.update({ muted: nextMuted });
  if (!nextMuted) audio.playUiClick();
});

if (nameInput) {
  nameInput.value = storage.get().playerName;
  nameInput.addEventListener('input', () => {
    const cleaned = nameInput.value.trim().slice(0, 18) || t('default_player_fallback');
    storage.update({ playerName: cleaned });
  });
}

// Settings modal (shared by Portal & Lobby gear icon)
const settingsModal = document.getElementById('settings-modal');
function openSettingsModal() {
  audio.playUiClick();
  settingsModal?.classList.remove('hidden');
}
function closeSettingsModal() {
  settingsModal?.classList.add('hidden');
}

document.getElementById('portal-settings-btn')?.addEventListener('click', openSettingsModal);
document.getElementById('lobby-settings-btn')?.addEventListener('click', openSettingsModal);
document.getElementById('settings-close-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  closeSettingsModal();
});
settingsModal?.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettingsModal();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && currentView !== 'game' && settingsModal && !settingsModal.classList.contains('hidden')) {
    closeSettingsModal();
  }
});

// ================= VIEW SWITCHING =================
let lobby3D = null;
let arenaGame = null;
let currentView = 'portal';

function switchView(name) {
  currentView = name;
  closeSettingsModal();
  for (const [key, el] of Object.entries(views)) {
    el?.classList.toggle('active', key === name);
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
const portalGridEl = document.getElementById('games-grid');
function renderPortalCards(lang = null) {
  initPortal(portalGridEl, {
    onLaunchBuildRoyale: () => switchView('lobby')
  }, lang);
}
renderPortalCards(storage.get().lang);

// ================= 2. LOBBY INIT =================
document.getElementById('lobby-back-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  cancelMatchmakingUI();
  switchView('portal');
});

const skinPickerEl = document.getElementById('skin-picker');
const matPickerEl = document.getElementById('material-picker');

function renderCosmetics(state) {
  const lang = normalizeLang(state.lang);
  if (skinPickerEl) {
    skinPickerEl.innerHTML = '';
    for (const skin of PLAYER_SKINS) {
      const skinLabel = getSkinName(skin.id, lang);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `skin-btn ${state.skinId === skin.id ? 'active' : ''}`;
      btn.title = skinLabel;
      btn.setAttribute('aria-label', skinLabel);
      const pHex = `#${skin.primary.toString(16).padStart(6, '0')}`;
      const sHex = `#${skin.secondary.toString(16).padStart(6, '0')}`;
      btn.innerHTML = `<span class="skin-swatch" style="background:linear-gradient(135deg, ${pHex} 55%, ${sHex} 100%)"></span>`;
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
      btn.type = 'button';
      btn.className = `mat-btn ${state.buildMat === mat.id ? 'active' : ''}`;
      const hexStr = `#${mat.color.toString(16).padStart(6, '0')}`;
      btn.innerHTML = `<span class="mat-swatch" style="background:${hexStr}"></span><span>${getMaterialName(mat.id, lang)}</span>`;
      btn.addEventListener('click', () => {
        audio.playUiClick();
        storage.update({ buildMat: mat.id });
      });
      matPickerEl.appendChild(btn);
    }
  }
}

// Lobby state: 2-click flow
let selectedMapId = 'skybox';
let selectedPlayMode = 'solo'; // 'solo' | 'bot' | 'friend' | 'random'
let selectedBotDiff = 'medium';

const mapBtns = document.querySelectorAll('#map-picker .map-seg');
const modeOptionBtns = document.querySelectorAll('.mode-option[data-play-mode]');
const botDiffPickerEl = document.getElementById('bot-diff-picker');
const diffBtns = document.querySelectorAll('#bot-diff-picker .diff-btn');
const friendJoinRow = document.getElementById('friend-join-row');
const inviteStatusBadge = document.getElementById('invite-status-badge');
const joinRoomInput = document.getElementById('join-room-input');
const roomErrorEl = document.getElementById('room-error-msg');
const lobbyPlayBtn = document.getElementById('btn-lobby-play');

let createdRoomData = null;
let inviteCopiedTimer = 0;

function resetInviteBadge() {
  clearTimeout(inviteCopiedTimer);
  if (!inviteStatusBadge) return;
  inviteStatusBadge.classList.add('hidden');
  inviteStatusBadge.classList.remove('copied');
  inviteStatusBadge.textContent = '';
}

function showInviteBadgeCopied(code) {
  if (!inviteStatusBadge) return;
  clearTimeout(inviteCopiedTimer);
  inviteStatusBadge.textContent = t('copied');
  inviteStatusBadge.classList.remove('hidden');
  inviteStatusBadge.classList.add('copied');
  inviteCopiedTimer = setTimeout(() => {
    if (createdRoomData?.code === code) {
      inviteStatusBadge.classList.remove('copied');
      inviteStatusBadge.textContent = `#${code}`;
    } else {
      resetInviteBadge();
    }
  }, 2200);
}

function updateLobbyPlayLabel() {
  if (!lobbyPlayBtn) return;
  if (selectedPlayMode === 'random') {
    lobbyPlayBtn.textContent = mmSearching ? t('btn_cancel_search') : t('btn_play');
  } else {
    lobbyPlayBtn.textContent = t('btn_play');
  }
}

function selectPlayMode(mode) {
  selectedPlayMode = mode;
  if (mode !== 'random') {
    cancelMatchmakingUI();
  }
  modeOptionBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.playMode === mode);
  });
  botDiffPickerEl?.classList.toggle('hidden', mode !== 'bot');
  friendJoinRow?.classList.toggle('hidden', mode !== 'friend');
  updateLobbyPlayLabel();
}

mapBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playUiClick();
    const nextMap = btn.dataset.map === 'vramp' ? 'vramp' : 'skybox';
    if (nextMap !== selectedMapId && createdRoomData) {
      network.leaveRoom();
      createdRoomData = null;
      resetInviteBadge();
    }
    selectedMapId = nextMap;
    mapBtns.forEach((b) => b.classList.toggle('active', b === btn));
  });
});

function syncBotDifficultyButtons(diff) {
  selectedBotDiff = BOT_DIFFICULTIES[diff] ? diff : 'medium';
  diffBtns.forEach((b) => b.classList.toggle('active', b.dataset.diff === selectedBotDiff));
}

diffBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playUiClick();
    syncBotDifficultyButtons(btn.dataset.diff);
  });
});

function getProfilePayload() {
  const s = storage.get();
  return { name: s.playerName, skinId: s.skinId, buildMat: s.buildMat, mapId: selectedMapId };
}

function getInviteUrl(code) {
  return `${window.location.origin}/?room=${code}`;
}

async function createAndCopyInvite() {
  roomErrorEl?.classList.add('hidden');
  if (!createdRoomData) {
    const res = await network.createPrivateRoom(getProfilePayload());
    if (!res.ok) {
      if (roomErrorEl) {
        roomErrorEl.textContent = res.error || t('room_create_fail');
        roomErrorEl.classList.remove('hidden');
      }
      return null;
    }
    createdRoomData = res;
  }
  const url = getInviteUrl(createdRoomData.code);
  const copied = await copyTextSafe(url);
  showInviteBadgeCopied(createdRoomData.code);
  if (!copied) {
    showToast(t('room_code_toast', { code: createdRoomData.code }));
  }
  return createdRoomData;
}

modeOptionBtns.forEach((btn) => {
  btn.addEventListener('click', async () => {
    audio.playUiClick();
    const mode = btn.dataset.playMode || 'solo';
    selectPlayMode(mode);
    if (mode === 'friend') {
      await createAndCopyInvite();
    }
  });
});

async function joinRoomByCode(rawCode) {
  roomErrorEl?.classList.add('hidden');
  const code = String(rawCode || '').trim().replace(/^#/, '').toUpperCase();
  if (!code) {
    if (roomErrorEl) {
      roomErrorEl.textContent = t('room_enter_code');
      roomErrorEl.classList.remove('hidden');
    }
    return;
  }
  if (createdRoomData) {
    network.leaveRoom();
    createdRoomData = null;
    resetInviteBadge();
  }
  const res = await network.joinPrivateRoom(code, getProfilePayload());
  if (!res.ok) {
    if (roomErrorEl) {
      roomErrorEl.textContent = res.error || t('room_not_found');
      roomErrorEl.classList.remove('hidden');
    }
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
  joinRoomByCode(joinRoomInput?.value);
});

joinRoomInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoomByCode(joinRoomInput.value);
});

// Matchmaking (Random opponent with 10s bot fallback)
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
  updateLobbyPlayLabel();
}

async function startMatchmaking() {
  cancelMatchmakingUI();
  mmSearching = true;
  mmRemaining = 10;
  mmBox?.classList.remove('hidden');
  mmFallback?.classList.add('hidden');
  if (mmStatusText) mmStatusText.textContent = t('mm_searching', { sec: mmRemaining });
  updateLobbyPlayLabel();

  const res = await network.joinMatchmaking(getProfilePayload());
  if (!res.ok) {
    cancelMatchmakingUI();
    showToast(res.error || t('mm_unavailable'));
    return;
  }
  if (res.matched) return;

  mmTimer = setInterval(() => {
    mmRemaining -= 1;
    if (mmRemaining > 0) {
      if (mmStatusText) mmStatusText.textContent = t('mm_searching', { sec: mmRemaining });
    } else {
      clearInterval(mmTimer);
      mmTimer = null;
      if (mmStatusText) mmStatusText.textContent = t('mm_not_found');
      mmFallback?.classList.remove('hidden');
    }
  }, 1000);
}

document.getElementById('btn-mm-cancel')?.addEventListener('click', () => {
  audio.playUiClick();
  cancelMatchmakingUI();
});

document.getElementById('btn-mm-bot')?.addEventListener('click', () => {
  audio.playUiClick();
  cancelMatchmakingUI();
  launchArena({ mode: 'bot', mapId: selectedMapId, difficulty: selectedBotDiff });
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
  mmBox?.classList.add('hidden');
  updateLobbyPlayLabel();
  showToast(t('mm_found'));
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

// Primary bottom-right HRÁT CTA
lobbyPlayBtn?.addEventListener('click', async () => {
  audio.playUiClick();
  if (selectedPlayMode === 'solo') {
    launchArena({ mode: 'solo', mapId: selectedMapId });
  } else if (selectedPlayMode === 'bot') {
    launchArena({ mode: 'bot', mapId: selectedMapId, difficulty: selectedBotDiff });
  } else if (selectedPlayMode === 'friend') {
    const typedCode = joinRoomInput?.value.trim();
    if (typedCode) {
      await joinRoomByCode(typedCode);
      return;
    }
    const room = createdRoomData || (await createAndCopyInvite());
    if (!room) return;
    launchArena({
      mode: 'online',
      mapId: room.mapId || selectedMapId,
      matchBuildMat: room.matchBuildMat,
      slot: room.slot,
      roomCode: room.code,
      players: room.players,
      existingBuilds: room.builds || []
    });
  } else if (selectedPlayMode === 'random') {
    if (mmSearching) {
      cancelMatchmakingUI();
    } else {
      startMatchmaking();
    }
  }
});

// ================= 3. ARENA HUD & PAUSE =================
const hudEls = {
  fps: document.getElementById('hud-fps'),
  frameTime: document.getElementById('hud-frametime'),
  qualityBadge: document.getElementById('hud-quality-badge'),
  ping: document.getElementById('hud-ping'),
  roomCopy: document.getElementById('hud-room-copy'),
  myKills: document.getElementById('sb-my-kills'),
  oppKills: document.getElementById('sb-opp-kills'),
  oppName: document.getElementById('sb-opp-name'),
  roundStatus: document.getElementById('hud-round-status'),
  banner: document.getElementById('hud-banner'),
  sniperScope: document.getElementById('sniper-scope'),
  scopeZoomBadge: document.getElementById('scope-zoom-badge'),
  crosshair: document.getElementById('crosshair'),
  reloadHud: document.getElementById('reload-hud'),
  reloadBarFill: document.getElementById('reload-bar-fill'),
  reloadTimeVal: document.getElementById('reload-time-val'),
  hitmarker: document.getElementById('hitmarker'),
  dmgPopup: document.getElementById('dmg-popup'),
  editHint: document.getElementById('edit-hint'),
  lockHint: document.getElementById('lock-hint'),
  countdown: document.getElementById('countdown-display'),
  boxProtectHint: document.getElementById('box-protect-hint'),
  boostHint: document.getElementById('boost-hint'),
  pickupHint: document.getElementById('pickup-hint'),
  slot0Icon: document.getElementById('slot-0-icon'),
  slot0Name: document.getElementById('slot-0-name'),
  slot1Icon: document.getElementById('slot-1-icon'),
  slot1Name: document.getElementById('slot-1-name'),
  myShieldTrail: document.getElementById('my-shield-trail'),
  myShieldFill: document.getElementById('my-shield-fill'),
  myShieldVal: document.getElementById('my-shield-val'),
  myHpTrail: document.getElementById('my-hp-trail'),
  myHpFill: document.getElementById('my-hp-fill'),
  myHpVal: document.getElementById('my-hp-val'),
  ammoCard: document.getElementById('ammo-card'),
  ammoCaliberIcon: document.getElementById('ammo-caliber-icon'),
  ammoCurrent: document.getElementById('ammo-current'),
  ammoSlash: document.getElementById('ammo-slash'),
  ammoMax: document.getElementById('ammo-max'),
  ammoWeaponTag: document.getElementById('ammo-weapon-tag'),
  ammoStatePill: document.getElementById('ammo-state-pill'),
  ammoPips: document.getElementById('ammo-pips'),
  ammoBarFill: document.getElementById('ammo-bar-fill'),
  matDot: document.getElementById('hud-mat-dot'),
  matText: document.getElementById('hud-mat-text'),
  damageVignette: document.getElementById('damage-vignette'),
  pauseOverlay: document.getElementById('pause-overlay'),
  emoteWheel: document.getElementById('emote-wheel'),
  emoteCenterLabel: document.getElementById('emote-center-label'),
  emoteCursorDot: document.getElementById('emote-cursor-dot'),
  emoteBtn: document.getElementById('hud-emote-btn')
};

const WEAPON_SVGS = {
  shotgun: '<svg viewBox="0 0 36 16" width="26" height="12" fill="currentColor" aria-hidden="true"><path d="M2 7h22v3H2zm22 1h10v2H24zM6 10h6v4H8z"/></svg>',
  smg: '<svg viewBox="0 0 36 16" width="26" height="12" fill="currentColor" aria-hidden="true"><path d="M4 6h18v3.5H4zm18 1.2h9v1.4h-9zM9 9.5h3.5v4.5H9zm7.5 0h2.8v5h-2.8z"/></svg>',
  ar: '<svg viewBox="0 0 36 16" width="26" height="12" fill="currentColor" aria-hidden="true"><path d="M2 6h21v3H2zm21 1h11v1.5H23zM12 9h4v5h-3zm-7 0h4v4H5z"/></svg>',
  sniper: '<svg viewBox="0 0 38 16" width="28" height="12" fill="currentColor" aria-hidden="true"><path d="M2 7.2h18v2.6H2zm18 .8h16v1.2H20zM9 4.5h9v1.8H9zM7 9.8h4.5v3.5H7z"/></svg>'
};

const WEAPON_ACCENT_HEX = {
  shotgun: '#f59e0b',
  smg: '#10e88a',
  ar: '#00d2ff',
  sniper: '#fb7185',
  pickaxe: '#cbd5e1'
};

const CALIBER_SVGS = {
  shotgun: '<svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="4.5" height="11" rx="1"/><rect x="4" y="14.5" width="4.5" height="2.5" rx="0.5" opacity="0.65"/><rect x="11.5" y="3" width="4.5" height="11" rx="1"/><rect x="11.5" y="14.5" width="4.5" height="2.5" rx="0.5" opacity="0.65"/></svg>',
  smg: '<svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M5.5 6.5C5.5 4.3 7 3 7 3s1.5 1.3 1.5 3.5V16h-3V6.5zm6 0C11.5 4.3 13 3 13 3s1.5 1.3 1.5 3.5V16h-3V6.5z"/></svg>',
  ar: '<svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M4.5 7.2L6.2 2.5l1.7 4.7V17H4.5V7.2zm4.8 0L11 2.5l1.7 4.7V17H9.3V7.2zm4.8 0l1.7-4.7 1.7 4.7V17h-3.4V7.2z"/></svg>',
  sniper: '<svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8.5 5.5L10 1.5l1.5 4v11.5h-3V5.5zm-.8 12h4.6v1.4H7.7z"/></svg>',
  pickaxe: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7.2 13.5c-2.2 0-3.7-1.5-3.7-3.5s1.5-3.5 3.7-3.5c2 0 3.6 3.5 5.6 3.5 2.2 0 3.7-1.5 3.7-3.5 0-2-1.5-3.5-3.7-3.5-2 0-3.6 3.5-5.6 3.5z" transform="translate(0 2)"/></svg>'
};

let ammoPipEls = [];
let ammoPopTimer = 0;

const weaponSlotEls = document.querySelectorAll('.slot-card[data-wslot]');
const buildSlotEls = document.querySelectorAll('.slot-card[data-bslot]');
const emoteSliceEls = document.querySelectorAll('.emote-slice[data-emote]');
const emoteItemEls = document.querySelectorAll('.emote-item[data-emote]');

function updateEmoteWheelUI(hoveredId, dx = 0, dy = 0) {
  emoteSliceEls.forEach((el) => el.classList.toggle('active', el.dataset.emote === hoveredId));
  emoteItemEls.forEach((el) => el.classList.toggle('active', el.dataset.emote === hoveredId));
  if (hudEls.emoteCenterLabel) {
    const def = hoveredId ? EMOTES.find((e) => e.id === hoveredId) : null;
    hudEls.emoteCenterLabel.textContent = def ? t(def.i18nKey) : t('emote_hub');
  }
  if (hudEls.emoteCursorDot) {
    const moved = Math.hypot(dx, dy) > 4;
    hudEls.emoteCursorDot.classList.toggle('visible', moved);
    hudEls.emoteCursorDot.style.transform = `translate(${(dx * 0.32).toFixed(1)}px, ${(dy * 0.32).toFixed(1)}px)`;
  }
}

let bannerTimer = 0;
let hitmarkerTimer = 0;
let dmgPopupTimer = 0;
let vignetteTimer = 0;
let hudRoomCopyTimer = 0;
let lastCdShown = '';
let lastGapShown = -1;
const lastHud = {
  fps: -1,
  fpsCls: '',
  frameMs: '',
  frameCls: '',
  qualityBadge: '',
  ping: '',
  pingCls: '',
  showRoom: null,
  roomCode: '',
  kills: -1,
  oppKills: -1,
  oppLabel: '',
  roundStatus: '',
  shield: -1,
  hp: -1,
  ammo: -1,
  magSize: -1,
  activeWeaponId: '',
  pipWeaponId: '',
  pipMagSize: -1,
  reloading: null,
  ammoStateKey: '',
  buildMat: '',
  weaponSlot: -1,
  slot0Id: '',
  slot1Id: '',
  sniperScope: 0,
  buildType: '__init__',
  editActive: null,
  lockVisible: null,
  emoteActive: null,
  boxVisible: null,
  pickupId: null,
  pickupReplaceSlot: -1,
  boostVisible: null
};

function getRoundStatusText(data) {
  if (data.roundState === 'countdown') return t('round_countdown');
  if (data.roundState === 'restarting') return t('round_restarting');
  if (data.roundState === 'waiting') return t('round_waiting');
  if (data.mode === 'solo') return t('round_training');
  const roundNum = (data.kills || 0) + (data.opponent?.kills || 0) + 1;
  return t('round_num', { num: roundNum });
}

function ensureArena() {
  if (arenaGame) return arenaGame;
  arenaGame = new ArenaGame(document.getElementById('arena-canvas'), {
    onPauseChange: (paused) => {
      hudEls.pauseOverlay?.classList.toggle('hidden', !paused);
    },
    onEmoteWheelChange: (open, hoveredId, dx = 0, dy = 0) => {
      hudEls.emoteWheel?.classList.toggle('hidden', !open);
      hudEls.crosshair?.classList.toggle('hidden', Boolean(open || lastHud.sniperScope > 0));
      const emoteBtnActive = Boolean(open || arenaGame?.activeEmote);
      lastHud.emoteActive = emoteBtnActive;
      hudEls.emoteBtn?.classList.toggle('active', emoteBtnActive);
      if (open) {
        updateEmoteWheelUI(hoveredId, dx, dy);
      }
    },
    onReloadProgress: (reloading, progress = 0, remainingSec = 0) => {
      hudEls.reloadHud?.classList.toggle('hidden', !reloading);
      hudEls.ammoCard?.classList.toggle('is-reloading', Boolean(reloading));
      if (reloading) {
        const clamped = Math.max(0, Math.min(1, progress));
        if (hudEls.reloadBarFill) {
          hudEls.reloadBarFill.style.transform = `scaleX(${clamped.toFixed(3)})`;
        }
        if (hudEls.ammoBarFill) {
          hudEls.ammoBarFill.style.transform = `scaleX(${clamped.toFixed(3)})`;
        }
        if (hudEls.reloadTimeVal) {
          hudEls.reloadTimeVal.textContent = `${Math.max(0, remainingSec).toFixed(1)}s`;
        }
      } else if (Number.isFinite(lastHud.magSize) && lastHud.magSize > 0 && hudEls.ammoBarFill) {
        const ratio = Math.max(0, Math.min(1, lastHud.ammo / lastHud.magSize));
        hudEls.ammoBarFill.style.transform = `scaleX(${ratio.toFixed(3)})`;
      }
    },
    onEmoteWheelMove: (hoveredId, dx = 0, dy = 0) => {
      updateEmoteWheelUI(hoveredId, dx, dy);
    },
    onCrosshairUpdate: (gapPx) => {
      if (hudEls.crosshair && gapPx !== lastGapShown) {
        lastGapShown = gapPx;
        hudEls.crosshair.style.setProperty('--ch-gap', `${gapPx}px`);
      }
    },
    onDamageFlash: () => {
      hudEls.damageVignette?.classList.add('flash');
      clearTimeout(vignetteTimer);
      vignetteTimer = setTimeout(() => hudEls.damageVignette?.classList.remove('flash'), 160);
    },
    onHitMarker: (dmg, isHeadshot, shieldHit = false) => {
      if (hudEls.hitmarker) {
        hudEls.hitmarker.classList.remove('hidden');
        hudEls.hitmarker.classList.toggle('headshot', Boolean(isHeadshot));
      }
      if (hudEls.crosshair) {
        hudEls.crosshair.classList.add('hit');
        hudEls.crosshair.classList.toggle('headshot', Boolean(isHeadshot));
      }
      clearTimeout(hitmarkerTimer);
      hitmarkerTimer = setTimeout(() => {
        hudEls.hitmarker?.classList.add('hidden');
        hudEls.crosshair?.classList.remove('hit', 'headshot');
      }, 140);

      if (hudEls.dmgPopup) {
        hudEls.dmgPopup.textContent = `${dmg}${isHeadshot ? '!' : ''}`;
        hudEls.dmgPopup.className = 'dmg-popup';
        if (isHeadshot) hudEls.dmgPopup.classList.add('headshot');
        else if (shieldHit) hudEls.dmgPopup.classList.add('shield');
        void hudEls.dmgPopup.offsetWidth;
        hudEls.dmgPopup.classList.add('pop');
        clearTimeout(dmgPopupTimer);
        dmgPopupTimer = setTimeout(() => hudEls.dmgPopup?.classList.add('hidden'), 440);
      }
    },
    onBanner: (text, tone = 'info') => {
      if (!hudEls.banner) return;
      hudEls.banner.textContent = text;
      hudEls.banner.className = `hud-banner ${tone}`;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => hudEls.banner?.classList.add('hidden'), 2200);
    },
    onHudUpdate: (data) => {
      // Top-left FPS, Frame Time (ms), Quality badge & Ping (dirty-checked)
      if (hudEls.fps && data.fps !== lastHud.fps) {
        lastHud.fps = data.fps;
        hudEls.fps.textContent = `${data.fps} FPS`;
        const fCls = data.fps >= 50 ? 'good' : (data.fps >= 30 ? 'warn' : 'bad');
        if (fCls !== lastHud.fpsCls) {
          lastHud.fpsCls = fCls;
          hudEls.fps.className = `t-seg ${fCls}`;
        }
      }
      if (hudEls.frameTime && typeof data.frameMs === 'number') {
        const msText = `${data.frameMs.toFixed(1)} ms`;
        if (msText !== lastHud.frameMs) {
          lastHud.frameMs = msText;
          hudEls.frameTime.textContent = msText;
          const mCls = data.frameMs <= 18 ? 'good' : (data.frameMs <= 33 ? 'warn' : 'bad');
          if (mCls !== lastHud.frameCls) {
            lastHud.frameCls = mCls;
            hudEls.frameTime.className = `t-seg ${mCls}`;
          }
        }
      }
      if (hudEls.qualityBadge) {
        const qBadge = (QUALITY_PRESETS[data.quality] || QUALITY_PRESETS.medium).shortLabel;
        if (qBadge !== lastHud.qualityBadge) {
          lastHud.qualityBadge = qBadge;
          hudEls.qualityBadge.textContent = qBadge;
        }
      }
      if (hudEls.ping) {
        const pText = data.mode === 'online' ? `${data.ping} ms` : 'Offline';
        const pCls = data.mode === 'online' ? (data.ping <= 65 ? 'good' : (data.ping <= 130 ? 'warn' : 'bad')) : '';
        if (pText !== lastHud.ping) {
          lastHud.ping = pText;
          hudEls.ping.textContent = pText;
        }
        if (pCls !== lastHud.pingCls) {
          lastHud.pingCls = pCls;
          hudEls.ping.className = pCls ? `t-seg ${pCls}` : 't-seg';
        }
      }
      if (hudEls.roomCopy) {
        const showRoom = data.mode === 'online' && Boolean(data.roomCode);
        if (showRoom !== lastHud.showRoom) {
          lastHud.showRoom = showRoom;
          hudEls.roomCopy.classList.toggle('hidden', !showRoom);
        }
        if (showRoom && !hudRoomCopyTimer && data.roomCode !== lastHud.roomCode) {
          lastHud.roomCode = data.roomCode;
          hudEls.roomCopy.textContent = `#${data.roomCode}`;
        }
      }

      // Top-center scoreboard & round state
      const myK = data.kills ?? 0;
      if (hudEls.myKills && myK !== lastHud.kills) {
        lastHud.kills = myK;
        hudEls.myKills.textContent = String(myK);
      }
      const oppK = data.opponent?.kills ?? 0;
      if (hudEls.oppKills && oppK !== lastHud.oppKills) {
        lastHud.oppKills = oppK;
        hudEls.oppKills.textContent = String(oppK);
      }
      if (hudEls.oppName) {
        const oppLabel = data.mode === 'solo' ? t('hud_target') : (data.opponent?.name || t('hud_opp'));
        if (oppLabel !== lastHud.oppLabel) {
          lastHud.oppLabel = oppLabel;
          hudEls.oppName.textContent = oppLabel;
        }
      }
      if (hudEls.roundStatus) {
        const rsText = getRoundStatusText(data);
        if (rsText !== lastHud.roundStatus) {
          lastHud.roundStatus = rsText;
          hudEls.roundStatus.textContent = rsText;
        }
      }

      // Bottom-left stacked Shield + Health bars
      if (data.shield !== lastHud.shield) {
        lastHud.shield = data.shield;
        const shieldPct = `${Math.max(0, Math.min(100, data.shield))}%`;
        if (hudEls.myShieldVal) hudEls.myShieldVal.textContent = String(data.shield);
        if (hudEls.myShieldFill) hudEls.myShieldFill.style.width = shieldPct;
        if (hudEls.myShieldTrail) hudEls.myShieldTrail.style.width = shieldPct;
      }
      if (data.hp !== lastHud.hp) {
        lastHud.hp = data.hp;
        const hpPct = `${Math.max(0, Math.min(100, data.hp))}%`;
        if (hudEls.myHpVal) hudEls.myHpVal.textContent = String(data.hp);
        if (hudEls.myHpFill) {
          hudEls.myHpFill.style.width = hpPct;
          hudEls.myHpFill.classList.toggle('low-hp', data.hp <= 35);
        }
        if (hudEls.myHpTrail) hudEls.myHpTrail.style.width = hpPct;
      }

      // Bottom-right graphic Ammo Card, pips, reload prompt & material
      const wId = data.activeWeaponId || 'shotgun';
      const magSize = data.magSize;
      const finiteMag = Number.isFinite(magSize) && magSize > 0;
      const ammoVal = finiteMag ? Math.max(0, Number(data.ammo) || 0) : Infinity;

      if (wId !== lastHud.pipWeaponId || magSize !== lastHud.pipMagSize) {
        lastHud.pipWeaponId = wId;
        lastHud.pipMagSize = magSize;
        if (hudEls.ammoCard) {
          hudEls.ammoCard.style.setProperty('--ammo-accent', WEAPON_ACCENT_HEX[wId] || '#00d2ff');
          hudEls.ammoCard.classList.toggle('is-melee', !finiteMag);
        }
        if (hudEls.ammoCaliberIcon) {
          hudEls.ammoCaliberIcon.innerHTML = CALIBER_SVGS[wId] || CALIBER_SVGS.ar;
        }
        if (hudEls.ammoWeaponTag) {
          const wDef = WEAPON_CATALOG[wId];
          hudEls.ammoWeaponTag.textContent = wDef ? wDef.shortName : wId;
        }
        if (hudEls.ammoMax) {
          hudEls.ammoMax.textContent = finiteMag ? String(magSize) : '';
        }
        if (hudEls.ammoPips) {
          hudEls.ammoPips.textContent = '';
          ammoPipEls = [];
          if (finiteMag) {
            const frag = document.createDocumentFragment();
            const typeCls = wId === 'shotgun' ? 'type-shotgun' : (wId === 'sniper' ? 'type-sniper' : 'type-rifle');
            for (let i = 0; i < magSize; i++) {
              const pip = document.createElement('span');
              pip.className = `ammo-pip ${typeCls}`;
              frag.appendChild(pip);
              ammoPipEls.push(pip);
            }
            hudEls.ammoPips.appendChild(frag);
          }
        }
      }

      if (
        ammoVal !== lastHud.ammo ||
        magSize !== lastHud.magSize ||
        wId !== lastHud.activeWeaponId ||
        data.reloading !== lastHud.reloading
      ) {
        const firedSameWeapon = (
          wId === lastHud.activeWeaponId &&
          finiteMag &&
          lastHud.ammo > ammoVal &&
          lastHud.ammo >= 0
        );
        lastHud.ammo = ammoVal;
        lastHud.magSize = magSize;
        lastHud.activeWeaponId = wId;
        lastHud.reloading = data.reloading;

        if (hudEls.ammoCurrent) {
          hudEls.ammoCurrent.textContent = finiteMag ? String(ammoVal) : '∞';
          if (firedSameWeapon) {
            hudEls.ammoCurrent.classList.add('shot-pop');
            clearTimeout(ammoPopTimer);
            ammoPopTimer = setTimeout(() => hudEls.ammoCurrent?.classList.remove('shot-pop'), 95);
          }
        }

        if (finiteMag) {
          for (let i = 0; i < ammoPipEls.length; i++) {
            ammoPipEls[i].classList.toggle('spent', i >= ammoVal);
          }
        }

        const isEmpty = finiteMag && ammoVal <= 0;
        const isLow = finiteMag && ammoVal > 0 && (magSize <= 5 ? ammoVal <= 1 : ammoVal / magSize <= 0.25);
        if (hudEls.ammoCard) {
          hudEls.ammoCard.classList.toggle('is-empty', Boolean(isEmpty && !data.reloading));
          hudEls.ammoCard.classList.toggle('is-low', Boolean(isLow && !data.reloading));
          hudEls.ammoCard.classList.toggle('is-reloading', Boolean(data.reloading));
        }

        if (hudEls.ammoBarFill && finiteMag && !data.reloading) {
          const ratio = Math.max(0, Math.min(1, ammoVal / magSize));
          hudEls.ammoBarFill.style.transform = `scaleX(${ratio.toFixed(3)})`;
        }

        const stateKey = data.reloading
          ? 'reloading'
          : (finiteMag && ammoVal < magSize ? (isEmpty || isLow ? 'urgent' : 'reload') : 'none');
        if (stateKey !== lastHud.ammoStateKey && hudEls.ammoStatePill) {
          lastHud.ammoStateKey = stateKey;
          if (stateKey === 'none') {
            hudEls.ammoStatePill.classList.add('hidden');
            hudEls.ammoStatePill.classList.remove('urgent', 'reloading');
          } else {
            hudEls.ammoStatePill.classList.remove('hidden', 'urgent', 'reloading');
            if (stateKey === 'reloading') {
              hudEls.ammoStatePill.classList.add('reloading');
              hudEls.ammoStatePill.textContent = t('hud_reloading');
            } else {
              if (stateKey === 'urgent') hudEls.ammoStatePill.classList.add('urgent');
              hudEls.ammoStatePill.textContent = t('hud_reload_key');
            }
          }
        }
      }

      if (data.buildMat !== lastHud.buildMat) {
        lastHud.buildMat = data.buildMat;
        const matInfo = BUILD_MATERIALS[data.buildMat] || BUILD_MATERIALS.wood;
        if (hudEls.matText) hudEls.matText.textContent = getMaterialName(matInfo.id);
        if (hudEls.matDot) {
          hudEls.matDot.style.background = `#${matInfo.color.toString(16).padStart(6, '0')}`;
        }
      }

      if (data.weaponSlot !== lastHud.weaponSlot || data.buildType !== lastHud.buildType || data.editActive !== lastHud.editActive) {
        lastHud.weaponSlot = data.weaponSlot;
        lastHud.buildType = data.buildType;
        lastHud.editActive = data.editActive;
        weaponSlotEls.forEach((el) => {
          const slot = Number(el.dataset.wslot);
          el.classList.toggle('active', !data.buildType && !data.editActive && slot === data.weaponSlot);
        });
        buildSlotEls.forEach((el) => {
          el.classList.toggle('active', el.dataset.bslot === data.buildType);
        });
        hudEls.crosshair?.classList.toggle('build-mode', Boolean(data.buildType || data.editActive));
        hudEls.editHint?.classList.toggle('hidden', !data.editActive);
      }

      // Center crosshair & contextual prompts
      if (hudEls.crosshair && typeof data.crosshairSpread === 'number' && data.crosshairSpread !== lastGapShown) {
        lastGapShown = data.crosshairSpread;
        hudEls.crosshair.style.setProperty('--ch-gap', `${data.crosshairSpread}px`);
      }

      if (data.slotWeaponIds) {
        const s0 = data.slotWeaponIds[0] || 'shotgun';
        const s1 = data.slotWeaponIds[1] || 'ar';
        if (s0 !== lastHud.slot0Id) {
          lastHud.slot0Id = s0;
          const w0 = WEAPON_CATALOG[s0] || WEAPON_CATALOG.shotgun;
          if (hudEls.slot0Icon) hudEls.slot0Icon.innerHTML = WEAPON_SVGS[s0] || WEAPON_SVGS.shotgun;
          if (hudEls.slot0Name) hudEls.slot0Name.textContent = w0.shortName;
          weaponSlotEls[0]?.setAttribute('title', t(`weapon_${s0}`));
        }
        if (s1 !== lastHud.slot1Id) {
          lastHud.slot1Id = s1;
          const w1 = WEAPON_CATALOG[s1] || WEAPON_CATALOG.ar;
          if (hudEls.slot1Icon) hudEls.slot1Icon.innerHTML = WEAPON_SVGS[s1] || WEAPON_SVGS.ar;
          if (hudEls.slot1Name) hudEls.slot1Name.textContent = w1.shortName;
          weaponSlotEls[1]?.setAttribute('title', t(`weapon_${s1}`));
        }
      }

      const scopeZoom = (data.activeWeaponId === 'sniper' && data.sniperZoom > 0 && !data.buildType && !data.editActive && !data.emoteWheelOpen) ? data.sniperZoom : 0;
      if (scopeZoom !== lastHud.sniperScope) {
        lastHud.sniperScope = scopeZoom;
        hudEls.sniperScope?.classList.toggle('hidden', scopeZoom <= 0);
        if (scopeZoom > 0 && hudEls.sniperScope) {
          hudEls.sniperScope.dataset.zoom = String(scopeZoom);
          if (hudEls.scopeZoomBadge) {
            hudEls.scopeZoomBadge.textContent = scopeZoom >= 2 ? '4.0×' : '2.0×';
          }
        }
        hudEls.crosshair?.classList.toggle('hidden', Boolean(scopeZoom > 0 || data.emoteWheelOpen));
      }

      const showLock = !(data.pointerLocked || data.paused || data.emoteWheelOpen);
      if (showLock !== lastHud.lockVisible) {
        lastHud.lockVisible = showLock;
        hudEls.lockHint?.classList.toggle('hidden', !showLock);
      }
      const emoteActive = Boolean(data.activeEmote || data.emoteWheelOpen);
      if (emoteActive !== lastHud.emoteActive) {
        lastHud.emoteActive = emoteActive;
        hudEls.emoteBtn?.classList.toggle('active', emoteActive);
      }
      const showBox = Boolean(data.inSpawnBox && data.alive);
      if (showBox !== lastHud.boxVisible) {
        lastHud.boxVisible = showBox;
        hudEls.boxProtectHint?.classList.toggle('hidden', !showBox);
      }
      const showBoost = Boolean(data.canAirBoost);
      if (showBoost !== lastHud.boostVisible) {
        lastHud.boostVisible = showBoost;
        hudEls.boostHint?.classList.toggle('hidden', !showBoost);
      }
      const pickupId = data.nearbyPickup || null;
      const replaceSlotNum = (data.weaponSlot === 1 ? 1 : 0) + 1;
      if (pickupId !== lastHud.pickupId || (pickupId && replaceSlotNum !== lastHud.pickupReplaceSlot)) {
        lastHud.pickupId = pickupId;
        lastHud.pickupReplaceSlot = replaceSlotNum;
        if (hudEls.pickupHint) {
          if (pickupId && WEAPON_CATALOG[pickupId]) {
            hudEls.pickupHint.textContent = t('hud_pickup_prompt', {
              weapon: t(`weapon_${pickupId}`),
              slot: replaceSlotNum
            });
            hudEls.pickupHint.classList.remove('hidden');
          } else {
            hudEls.pickupHint.classList.add('hidden');
          }
        }
      }

      if (hudEls.countdown) {
        const cdText = data.countdownText || (data.countdown > 0 ? String(data.countdown) : '');
        hudEls.countdown.classList.toggle('hidden', !cdText);
        if (cdText) {
          if (cdText !== lastCdShown) {
            lastCdShown = cdText;
            hudEls.countdown.textContent = cdText;
            hudEls.countdown.classList.toggle('go', cdText === 'START!' || cdText === 'GO!');
            hudEls.countdown.classList.remove('pop');
            void hudEls.countdown.offsetWidth;
            hudEls.countdown.classList.add('pop');
          }
        } else {
          lastCdShown = '';
        }
      }
    }
  });
  return arenaGame;
}

function launchArena(opts) {
  cancelMatchmakingUI();
  if (opts.mode !== 'online' && createdRoomData) {
    network.leaveRoom();
    createdRoomData = null;
    resetInviteBadge();
  }
  lastGapShown = -1;
  lastCdShown = '';
  lastHud.kills = -1;
  lastHud.oppKills = -1;
  lastHud.oppLabel = '';
  lastHud.roundStatus = '';
  lastHud.shield = -1;
  lastHud.hp = -1;
  lastHud.ammo = -1;
  lastHud.magSize = -1;
  lastHud.activeWeaponId = '';
  lastHud.pipWeaponId = '';
  lastHud.pipMagSize = -1;
  lastHud.reloading = null;
  lastHud.ammoStateKey = '';
  lastHud.buildMat = '';
  lastHud.weaponSlot = -1;
  lastHud.slot0Id = '';
  lastHud.slot1Id = '';
  lastHud.sniperScope = 0;
  lastHud.buildType = '__init__';
  lastHud.editActive = null;
  lastHud.lockVisible = null;
  lastHud.emoteActive = null;
  lastHud.boxVisible = null;
  lastHud.pickupId = null;
  lastHud.boostVisible = null;
  lastHud.showRoom = null;
  lastHud.roomCode = '';
  switchView('game');
  hudEls.pauseOverlay?.classList.add('hidden');
  hudEls.emoteWheel?.classList.add('hidden');
  hudEls.sniperScope?.classList.add('hidden');
  hudEls.reloadHud?.classList.add('hidden');
  hudEls.crosshair?.classList.remove('hidden');
  hudEls.banner?.classList.add('hidden');
  const game = ensureArena();
  game.startSession(opts);
}

// HUD top-left invite copy & top-right action triggers
hudEls.roomCopy?.addEventListener('click', async () => {
  if (!network.roomCode) return;
  audio.playUiClick();
  await copyTextSafe(getInviteUrl(network.roomCode));
  clearTimeout(hudRoomCopyTimer);
  hudEls.roomCopy.textContent = t('copied');
  hudRoomCopyTimer = setTimeout(() => {
    hudRoomCopyTimer = 0;
    if (hudEls.roomCopy && network.roomCode) {
      hudEls.roomCopy.textContent = `#${network.roomCode}`;
    }
  }, 1800);
});

document.getElementById('hud-respawn-trigger')?.addEventListener('click', () => {
  audio.playUiClick();
  if (arenaGame) arenaGame.triggerLocalRespawn();
});

document.getElementById('hud-pause-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  if (arenaGame) arenaGame.setPaused(true);
});

hudEls.emoteBtn?.addEventListener('click', () => {
  audio.playUiClick();
  hudEls.emoteBtn.blur();
  if (!arenaGame) return;
  if (arenaGame.emoteWheelOpen) {
    arenaGame.closeEmoteWheel(false);
  } else {
    arenaGame.openEmoteWheel(false);
  }
});

emoteSliceEls.forEach((sliceEl) => {
  sliceEl.addEventListener('pointerenter', () => {
    if (!arenaGame || !arenaGame.emoteWheelOpen) return;
    const id = sliceEl.dataset.emote || null;
    arenaGame.hoveredEmoteId = id;
    updateEmoteWheelUI(id, 0, 0);
  });
  sliceEl.addEventListener('click', () => {
    if (!arenaGame) return;
    const id = sliceEl.dataset.emote;
    if (id) arenaGame.triggerEmote(id);
  });
});

// Pause overlay actions
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
  resetInviteBadge();
  switchView('lobby');
});

// ================= 4. BOOTSTRAP & URL INVITE =================
network.connect();

const initialState = storage.get();
let lastSkinRendered = initialState.skinId;
let lastBuildMatRendered = initialState.buildMat;
let lastLangRendered = normalizeLang(initialState.lang);
syncGlobalControlsUI(initialState);
renderCosmetics(initialState);
syncBotDifficultyButtons(selectedBotDiff);
selectPlayMode('solo');

storage.subscribe((next) => {
  const nextLang = normalizeLang(next.lang);
  syncGlobalControlsUI(next);
  if (nextLang !== lastLangRendered) {
    lastLangRendered = nextLang;
    renderPortalCards(nextLang);
    renderCosmetics(next);
    updateLobbyPlayLabel();
    if (mmSearching && mmStatusText) {
      mmStatusText.textContent = mmRemaining > 0
        ? t('mm_searching', { sec: mmRemaining }, nextLang)
        : t('mm_not_found', null, nextLang);
    }
    lastHud.oppLabel = '';
    lastHud.roundStatus = '';
    lastHud.buildMat = '';
    lastHud.slot0Id = '';
    lastHud.slot1Id = '';
    lastHud.ammoStateKey = '';
    lastHud.ammo = -1;
    lastHud.pickupId = '__refresh__';
    arenaGame?._pushHudState?.();
  } else if (next.skinId !== lastSkinRendered || next.buildMat !== lastBuildMatRendered) {
    renderCosmetics(next);
  }
  lastSkinRendered = next.skinId;
  lastBuildMatRendered = next.buildMat;
});

const params = new URLSearchParams(window.location.search);
const urlRoom = params.get('room');
if (urlRoom) {
  switchView('lobby');
  selectPlayMode('friend');
  if (joinRoomInput) joinRoomInput.value = urlRoom.toUpperCase();
  showToast(t('room_invite_toast', { code: urlRoom.toUpperCase() }));
  setTimeout(() => joinRoomByCode(urlRoom), 450);
}
