import {
  BOT_DIFFICULTIES,
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
  qualityButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.quality === state.quality);
  });
  const qInfo = QUALITY_PRESETS[state.quality] || QUALITY_PRESETS.medium;
  if (pauseQualityDesc) pauseQualityDesc.textContent = qInfo.desc;
  if (settingsQualityDesc) settingsQualityDesc.textContent = qInfo.desc;

  const sens = Number(state.sensitivity || 1.0);
  const sensText = sens.toFixed(1);
  if (sensSlider) sensSlider.value = String(sens);
  if (sensVal) sensVal.textContent = sensText;
  if (settingsSensSlider) settingsSensSlider.value = String(sens);
  if (settingsSensVal) settingsSensVal.textContent = sensText;

  if (settingsMuteBtn) {
    settingsMuteBtn.textContent = state.muted ? 'Ztlumeno' : 'Zapnuto';
  }
  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = state.playerName || '';
  }
}

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
    const cleaned = nameInput.value.trim().slice(0, 18) || 'Hráč';
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
initPortal(document.getElementById('games-grid'), {
  onLaunchBuildRoyale: () => switchView('lobby')
});

// ================= 2. LOBBY INIT =================
document.getElementById('lobby-back-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  cancelMatchmakingUI();
  switchView('portal');
});

const skinPickerEl = document.getElementById('skin-picker');
const matPickerEl = document.getElementById('material-picker');

function renderCosmetics(state) {
  if (skinPickerEl) {
    skinPickerEl.innerHTML = '';
    for (const skin of PLAYER_SKINS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `skin-btn ${state.skinId === skin.id ? 'active' : ''}`;
      btn.title = skin.name;
      btn.setAttribute('aria-label', skin.name);
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
      btn.innerHTML = `<span class="mat-swatch" style="background:${hexStr}"></span><span>${mat.name}</span>`;
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
  inviteStatusBadge.textContent = 'Zkopírováno!';
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
    lobbyPlayBtn.textContent = mmSearching ? 'ZRUŠIT HLEDÁNÍ' : 'HRÁT';
  } else {
    lobbyPlayBtn.textContent = 'HRÁT';
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
        roomErrorEl.textContent = res.error || 'Nepodařilo se vytvořit místnost.';
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
    showToast(`Kód místnosti: #${createdRoomData.code}`);
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
      roomErrorEl.textContent = 'Zadej 4místný kód místnosti.';
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
      roomErrorEl.textContent = res.error || 'Místnost nenalezena.';
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
  if (mmStatusText) mmStatusText.textContent = `Hledám soupeře… ${mmRemaining}s`;
  updateLobbyPlayLabel();

  const res = await network.joinMatchmaking(getProfilePayload());
  if (!res.ok) {
    cancelMatchmakingUI();
    showToast(res.error || 'Online matchmaking není dostupný.');
    return;
  }
  if (res.matched) return;

  mmTimer = setInterval(() => {
    mmRemaining -= 1;
    if (mmRemaining > 0) {
      if (mmStatusText) mmStatusText.textContent = `Hledám soupeře… ${mmRemaining}s`;
    } else {
      clearInterval(mmTimer);
      mmTimer = null;
      if (mmStatusText) mmStatusText.textContent = 'Soupeř nenalezen';
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
  showToast('Soupeř nalezen!');
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
  crosshair: document.getElementById('crosshair'),
  hitmarker: document.getElementById('hitmarker'),
  dmgPopup: document.getElementById('dmg-popup'),
  editHint: document.getElementById('edit-hint'),
  lockHint: document.getElementById('lock-hint'),
  countdown: document.getElementById('countdown-display'),
  boxProtectHint: document.getElementById('box-protect-hint'),
  boostHint: document.getElementById('boost-hint'),
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
  damageVignette: document.getElementById('damage-vignette'),
  pauseOverlay: document.getElementById('pause-overlay')
};

const weaponSlotEls = document.querySelectorAll('.slot-card[data-wslot]');
const buildSlotEls = document.querySelectorAll('.slot-card[data-bslot]');

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
  ammoText: '',
  reloading: null,
  buildMat: '',
  weaponSlot: -1,
  buildType: '__init__',
  editActive: null,
  lockVisible: null,
  boxVisible: null,
  boostVisible: null
};

function getRoundStatusText(data) {
  if (data.roundState === 'countdown') return 'Odpočet';
  if (data.roundState === 'restarting') return 'Další kolo…';
  if (data.roundState === 'waiting') return 'Čekání na soupeře';
  if (data.mode === 'solo') return 'Trénink';
  const roundNum = (data.kills || 0) + (data.opponent?.kills || 0) + 1;
  return `Kolo ${roundNum}`;
}

function ensureArena() {
  if (arenaGame) return arenaGame;
  arenaGame = new ArenaGame(document.getElementById('arena-canvas'), {
    onPauseChange: (paused) => {
      hudEls.pauseOverlay?.classList.toggle('hidden', !paused);
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
        const oppLabel = data.mode === 'solo' ? 'Terč' : (data.opponent?.name || 'Soupeř');
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

      // Bottom-right ammo, material & active slots
      const ammoStr = Number.isFinite(data.magSize) ? `${data.ammo} / ${data.magSize}` : '∞';
      if (hudEls.ammoText && ammoStr !== lastHud.ammoText) {
        lastHud.ammoText = ammoStr;
        hudEls.ammoText.textContent = ammoStr;
      }
      if (data.reloading !== lastHud.reloading) {
        lastHud.reloading = data.reloading;
        hudEls.reloadBadge?.classList.toggle('hidden', !data.reloading);
      }

      if (data.buildMat !== lastHud.buildMat) {
        lastHud.buildMat = data.buildMat;
        const matInfo = BUILD_MATERIALS[data.buildMat] || BUILD_MATERIALS.wood;
        if (hudEls.matText) hudEls.matText.textContent = matInfo.name;
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

      const showLock = !(data.pointerLocked || data.paused);
      if (showLock !== lastHud.lockVisible) {
        lastHud.lockVisible = showLock;
        hudEls.lockHint?.classList.toggle('hidden', !showLock);
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
  lastHud.ammoText = '';
  lastHud.reloading = null;
  lastHud.buildMat = '';
  lastHud.weaponSlot = -1;
  lastHud.buildType = '__init__';
  lastHud.editActive = null;
  lastHud.lockVisible = null;
  lastHud.boxVisible = null;
  lastHud.boostVisible = null;
  lastHud.showRoom = null;
  lastHud.roomCode = '';
  switchView('game');
  hudEls.pauseOverlay?.classList.add('hidden');
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
  hudEls.roomCopy.textContent = 'Zkopírováno!';
  hudRoomCopyTimer = setTimeout(() => {
    hudRoomCopyTimer = 0;
    if (hudEls.roomCopy && network.roomCode) {
      hudEls.roomCopy.textContent = `#${network.roomCode}`;
    }
  }, 1800);
});

document.getElementById('hud-reset-trigger')?.addEventListener('click', () => {
  audio.playUiClick();
  if (arenaGame) arenaGame.triggerArenaReset();
});

document.getElementById('hud-pause-btn')?.addEventListener('click', () => {
  audio.playUiClick();
  if (arenaGame) arenaGame.setPaused(true);
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
syncGlobalControlsUI(initialState);
renderCosmetics(initialState);
syncBotDifficultyButtons(selectedBotDiff);
selectPlayMode('solo');

storage.subscribe((next) => {
  syncGlobalControlsUI(next);
  if (next.skinId !== lastSkinRendered || next.buildMat !== lastBuildMatRendered) {
    lastSkinRendered = next.skinId;
    lastBuildMatRendered = next.buildMat;
    renderCosmetics(next);
  }
});

const params = new URLSearchParams(window.location.search);
const urlRoom = params.get('room');
if (urlRoom) {
  switchView('lobby');
  selectPlayMode('friend');
  if (joinRoomInput) joinRoomInput.value = urlRoom.toUpperCase();
  showToast(`Pozvánka do místnosti #${urlRoom.toUpperCase()}`);
  setTimeout(() => joinRoomByCode(urlRoom), 450);
}
