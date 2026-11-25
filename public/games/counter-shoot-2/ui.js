import { CS2_BUY_ITEMS, CS2_ECONOMY, CS2_MODES, CS2_WEAPONS } from './constants.js';
import { CounterShoot2Game } from './engine.js';
import { cs2Audio } from './audio.js';
import { cs2Network } from './networkCS2.js';
import { QUALITY_PRESETS } from '../../js/game/constants.js';
import { getQualityDesc, normalizeLang, t } from '../../js/i18n.js';
import { storage } from '../../js/storage.js';

export function initCounterShoot2UI({ switchView, openSettingsModal, showToast, copyTextSafe }) {
  const els = {
    lobbyBackBtn: document.getElementById('cs2-lobby-back-btn'),
    lobbySettingsBtn: document.getElementById('cs2-lobby-settings-btn'),
    modeSummary: document.getElementById('cs2-mode-summary'),
    modeBtns: document.querySelectorAll('#cs2-mode-picker .cs2-seg-btn'),
    playBtns: document.querySelectorAll('#cs2-playtype-picker .cs2-seg-btn'),
    teamBtns: document.querySelectorAll('#cs2-team-picker .cs2-seg-btn'),
    diffBtns: document.querySelectorAll('#cs2-diff-picker .diff-btn'),
    botConfig: document.getElementById('cs2-bot-config'),
    friendsBox: document.getElementById('cs2-friends-box'),
    btnCreateRoom: document.getElementById('cs2-btn-create-room'),
    joinInput: document.getElementById('cs2-join-input'),
    btnJoinRoom: document.getElementById('cs2-btn-join-room'),
    roomError: document.getElementById('cs2-room-error'),
    roomPanel: document.getElementById('cs2-room-panel'),
    roomCodeBtn: document.getElementById('cs2-room-code-btn'),
    roomRoster: document.getElementById('cs2-room-roster'),
    btnSwitchTeam: document.getElementById('cs2-btn-switch-team'),
    fillBotsChk: document.getElementById('cs2-fill-bots-chk'),
    btnLeaveRoom: document.getElementById('cs2-btn-leave-room'),
    btnPlay: document.getElementById('cs2-btn-play'),

    canvas: document.getElementById('cs2-canvas'),
    damageVignette: document.getElementById('cs2-damage-vignette'),
    fps: document.getElementById('cs2-hud-fps'),
    ms: document.getElementById('cs2-hud-ms'),
    qualityBadge: document.getElementById('cs2-hud-quality'),
    velChip: document.getElementById('cs2-hud-vel'),
    roomCopy: document.getElementById('cs2-hud-room-copy'),

    ctAlive: document.getElementById('cs2-ct-alive'),
    tAlive: document.getElementById('cs2-t-alive'),
    ctScore: document.getElementById('cs2-ct-score'),
    tScore: document.getElementById('cs2-t-score'),
    timer: document.getElementById('cs2-timer'),
    phaseTag: document.getElementById('cs2-phase-tag'),
    banner: document.getElementById('cs2-banner'),
    btnBuyHint: document.getElementById('cs2-btn-buy-hint'),
    btnPause: document.getElementById('cs2-btn-pause'),
    killfeed: document.getElementById('cs2-killfeed'),

    sniperScope: document.getElementById('cs2-sniper-scope'),
    scopeZoomVal: document.getElementById('cs2-scope-zoom-val'),
    crosshair: document.getElementById('cs2-crosshair'),
    hitmarker: document.getElementById('cs2-hitmarker'),
    dmgPopup: document.getElementById('cs2-dmg-popup'),
    actionBar: document.getElementById('cs2-action-bar'),
    actionLabel: document.getElementById('cs2-action-label'),
    actionTime: document.getElementById('cs2-action-time'),
    actionFill: document.getElementById('cs2-action-fill'),
    objHint: document.getElementById('cs2-obj-hint'),
    specBar: document.getElementById('cs2-spec-bar'),
    lockHint: document.getElementById('cs2-lock-hint'),

    hpVal: document.getElementById('cs2-hp-val'),
    hpFill: document.getElementById('cs2-hp-fill'),
    armorVal: document.getElementById('cs2-armor-val'),
    armorFill: document.getElementById('cs2-armor-fill'),
    helmetBadge: document.getElementById('cs2-helmet-badge'),
    moneyVal: document.getElementById('cs2-money-val'),
    buyPill: document.getElementById('cs2-buy-pill'),
    ammoMag: document.getElementById('cs2-ammo-mag'),
    ammoRes: document.getElementById('cs2-ammo-res'),
    ammoWpn: document.getElementById('cs2-ammo-wpn'),
    slots: [
      document.getElementById('cs2-slot-0'),
      document.getElementById('cs2-slot-1'),
      document.getElementById('cs2-slot-2'),
      document.getElementById('cs2-slot-3')
    ],

    buyModal: document.getElementById('cs2-buy-modal'),
    buyMoney: document.getElementById('cs2-buy-money'),
    buyClose: document.getElementById('cs2-buy-close'),
    buyGrid: document.getElementById('cs2-buy-grid'),

    scoreboard: document.getElementById('cs2-scoreboard'),
    sbTitle: document.getElementById('cs2-sb-title'),
    sbCtBody: document.getElementById('cs2-sb-ct-body'),
    sbTBody: document.getElementById('cs2-sb-t-body'),

    matchEndOverlay: document.getElementById('cs2-matchend-overlay'),
    matchEndTitle: document.getElementById('cs2-matchend-title'),
    matchEndScore: document.getElementById('cs2-matchend-score'),
    btnPlayAgain: document.getElementById('cs2-btn-play-again'),
    btnMatchEndLobby: document.getElementById('cs2-btn-matchend-lobby'),
    btnMatchEndPortal: document.getElementById('cs2-btn-matchend-portal'),

    pauseOverlay: document.getElementById('cs2-pause-overlay'),
    btnResume: document.getElementById('cs2-btn-resume'),
    pauseQualityDesc: document.getElementById('cs2-pause-quality-desc'),
    sensSlider: document.getElementById('cs2-sens-slider'),
    sensVal: document.getElementById('cs2-sens-val'),
    btnPauseSettings: document.getElementById('cs2-btn-pause-settings'),
    btnLeaveLobby: document.getElementById('cs2-btn-leave-lobby'),
    btnExitPortal: document.getElementById('cs2-btn-exit-portal')
  };

  let selectedMode = 'competitive'; // 'wingman' | 'competitive' | 'training'
  let selectedPlayType = 'bot'; // 'bot' | 'online'
  let selectedTeam = 'ct'; // 'ct' | 't'
  let selectedDiff = 'medium';
  let activeRoom = null;
  let cs2Game = null;
  let bannerTimer = 0;
  let hitmarkerTimer = 0;
  let dmgTimer = 0;
  let vigTimer = 0;

  function destroyGame() {
    if (cs2Game) {
      cs2Game.dispose();
      cs2Game = null;
    }
    els.pauseOverlay?.classList.add('hidden');
    els.buyModal?.classList.add('hidden');
    els.scoreboard?.classList.add('hidden');
    els.matchEndOverlay?.classList.add('hidden');
    els.sniperScope?.classList.add('hidden');
    els.banner?.classList.add('hidden');
    if (els.killfeed) els.killfeed.textContent = '';
  }

  function leaveOnlineRoom() {
    if (activeRoom) {
      cs2Network.leaveRoom();
      activeRoom = null;
      renderRoomUI();
    }
  }

  function updateLobbyTexts() {
    const lang = normalizeLang(storage.get().lang);
    const key = selectedMode === 'wingman'
      ? 'cs2_mode_wingman_desc'
      : (selectedMode === 'training' ? 'cs2_mode_training_desc' : 'cs2_mode_comp_desc');
    if (els.modeSummary) els.modeSummary.textContent = t(key, null, lang);
    if (els.pauseQualityDesc) {
      els.pauseQualityDesc.textContent = getQualityDesc(storage.get().quality || 'medium', lang);
    }
    const sens = Number(storage.get().sensitivity || 1.0);
    if (els.sensSlider) els.sensSlider.value = String(sens);
    if (els.sensVal) els.sensVal.textContent = sens.toFixed(2);
  }

  function syncModeButtons(mode) {
    selectedMode = mode;
    els.modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.cs2Mode === mode));

    const isTraining = mode === 'training';
    if (isTraining && selectedPlayType === 'online') {
      syncPlayType('bot');
    }
    els.playBtns.forEach((b) => {
      if (b.dataset.cs2Play === 'online') {
        b.disabled = isTraining;
      }
    });
    updateLobbyTexts();

    if (activeRoom && cs2Network.isHost() && (mode === 'wingman' || mode === 'competitive')) {
      cs2Network.setSettings({ mode });
    }
  }

  function syncPlayType(play) {
    selectedPlayType = play;
    if (play !== 'online') {
      leaveOnlineRoom();
    }
    els.playBtns.forEach((b) => b.classList.toggle('active', b.dataset.cs2Play === play));
    els.friendsBox?.classList.toggle('hidden', play !== 'online');
    updateLobbyTexts();
    updatePlayCTA();
  }

  function syncTeam(team) {
    selectedTeam = team === 't' ? 't' : 'ct';
    els.teamBtns.forEach((b) => b.classList.toggle('active', b.dataset.cs2Team === selectedTeam));
  }

  function syncDiff(diff) {
    selectedDiff = diff;
    els.diffBtns.forEach((b) => b.classList.toggle('active', b.dataset.cs2Diff === diff));
    if (activeRoom && cs2Network.isHost()) {
      cs2Network.setSettings({ botDifficulty: diff });
    }
  }

  function updatePlayCTA() {
    if (!els.btnPlay) return;
    if (selectedPlayType === 'online' && activeRoom) {
      const isHost = activeRoom.leaderId === cs2Network.getSocketId();
      els.btnPlay.disabled = !isHost;
      els.btnPlay.textContent = isHost ? t('btn_start_party') : t('btn_waiting_leader');
    } else {
      els.btnPlay.disabled = false;
      els.btnPlay.textContent = t('btn_play');
    }
  }

  function renderRoomUI() {
    const inRoom = Boolean(activeRoom);
    els.roomPanel?.classList.toggle('hidden', !inRoom);
    updatePlayCTA();
    if (!inRoom) {
      if (els.roomRoster) els.roomRoster.textContent = '';
      return;
    }

    if (activeRoom.mode && activeRoom.mode !== selectedMode && selectedMode !== 'training') {
      selectedMode = activeRoom.mode;
      els.modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.cs2Mode === selectedMode));
      updateLobbyTexts();
    }
    if (els.fillBotsChk) {
      els.fillBotsChk.checked = activeRoom.fillBots !== false;
      els.fillBotsChk.disabled = activeRoom.leaderId !== cs2Network.getSocketId();
    }
    if (els.roomCodeBtn) {
      els.roomCodeBtn.textContent = `#${activeRoom.code}`;
    }

    if (els.roomRoster) {
      els.roomRoster.textContent = '';
      const myId = cs2Network.getSocketId();
      for (const p of activeRoom.players || []) {
        const row = document.createElement('div');
        row.className = 'cs2-roster-row';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `${p.name}${p.id === myId ? ` (${t('party_you_tag')})` : ''}${p.id === activeRoom.leaderId ? ' ★' : ''}`;
        const tag = document.createElement('span');
        tag.className = `cs2-team-tag ${p.team}`;
        tag.textContent = p.team.toUpperCase();
        row.append(nameSpan, tag);
        els.roomRoster.appendChild(row);
      }
    }
  }

  function renderBuyMenu(buyState) {
    if (!els.buyMoney || !els.buyGrid) return;
    els.buyMoney.textContent = `$${buyState.money}`;
    els.buyGrid.textContent = '';

    for (const item of CS2_BUY_ITEMS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cs2-buy-item';

      let title = '';
      let desc = '';
      let price = item.price;
      let owned = false;

      if (item.type === 'weapon') {
        const w = CS2_WEAPONS[item.id];
        title = t(w.nameKey);
        desc = item.id === 'awp'
          ? t('cs2_buy_awp_desc')
          : (item.id === 'ak47'
            ? t('cs2_buy_ak_desc')
            : (item.id === 'm4a1'
              ? t('cs2_buy_m4_desc')
              : (item.id === 'deagle' ? t('cs2_buy_deagle_desc') : t('cs2_buy_pistol_desc'))));
        owned = buyState.primaryId === item.id || buyState.secondaryId === item.id;
      } else if (item.id === 'kevlar') {
        title = t('cs2_buy_kevlar');
        desc = t('cs2_buy_kevlar_desc');
        owned = buyState.armor >= 100;
      } else {
        title = t('cs2_buy_helmet');
        desc = t('cs2_buy_helmet_desc');
        price = buyState.armor >= 100 && !buyState.hasHelmet ? CS2_ECONOMY.HELMET_UPGRADE_PRICE : CS2_ECONOMY.HELMET_PRICE;
        owned = buyState.hasHelmet && buyState.armor >= 100;
      }

      if (owned) btn.classList.add('owned');
      btn.disabled = !buyState.canBuy || buyState.money < price || owned;

      const top = document.createElement('div');
      top.className = 'cs2-buy-item-top';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = `[${item.key}] ${title}`;
      const priceSpan = document.createElement('span');
      priceSpan.className = 'cs2-buy-price tabular';
      priceSpan.textContent = owned ? t('cs2_owned') : `$${price}`;
      top.append(nameSpan, priceSpan);

      const descEl = document.createElement('div');
      descEl.className = 'cs2-buy-desc';
      descEl.textContent = desc;

      btn.append(top, descEl);
      btn.addEventListener('click', () => {
        cs2Game?.buyItem(item.id);
      });
      els.buyGrid.appendChild(btn);
    }
  }

  function renderScoreboard(data) {
    if (!data || !els.sbCtBody || !els.sbTBody) return;
    if (els.sbTitle) {
      els.sbTitle.textContent = `SANDSTORM · ${data.modeId.toUpperCase()} · CT ${data.ctScore} : ${data.tScore} T`;
    }
    const fillRows = (tbody, list) => {
      tbody.textContent = '';
      for (const p of list) {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = `${p.name}${p.isBot ? ' [BOT]' : ''}`;
        const tdK = document.createElement('td');
        tdK.className = 'tabular';
        tdK.textContent = String(p.kills);
        const tdD = document.createElement('td');
        tdD.className = 'tabular';
        tdD.textContent = String(p.deaths);
        const tdS = document.createElement('td');
        tdS.textContent = p.alive ? `$${p.money}` : 'DEAD';
        tr.append(tdName, tdK, tdD, tdS);
        tbody.appendChild(tr);
      }
    };
    fillRows(els.sbCtBody, data.ct);
    fillRows(els.sbTBody, data.t);
  }

  function renderAlivePips(container, states, team) {
    if (!container) return;
    if (container.childElementCount !== states.length) {
      container.textContent = '';
      for (let i = 0; i < states.length; i++) {
        const pip = document.createElement('span');
        pip.className = `cs2-alive-pip ${team}`;
        container.appendChild(pip);
      }
    }
    for (let i = 0; i < states.length; i++) {
      container.children[i].classList.toggle('alive', Boolean(states[i]));
    }
  }

  function launchMatch(opts) {
    destroyGame();
    switchView('cs2-game');
    cs2Game = new CounterShoot2Game(els.canvas, {
      onPauseChange: (paused) => {
        els.pauseOverlay?.classList.toggle('hidden', !paused);
        if (paused) updateLobbyTexts();
      },
      onBuyMenuChange: (open, buyState) => {
        els.buyModal?.classList.toggle('hidden', !open);
        if (open && buyState) renderBuyMenu(buyState);
      },
      onScoreboardChange: (open, data) => {
        els.scoreboard?.classList.toggle('hidden', !open);
        if (open && data) renderScoreboard(data);
      },
      onDamageFlash: () => {
        els.damageVignette?.classList.add('flash');
        clearTimeout(vigTimer);
        vigTimer = setTimeout(() => els.damageVignette?.classList.remove('flash'), 160);
      },
      onHitMarker: (dmg, isHs) => {
        if (els.hitmarker) {
          els.hitmarker.classList.remove('hidden');
          els.hitmarker.classList.toggle('headshot', Boolean(isHs));
          clearTimeout(hitmarkerTimer);
          hitmarkerTimer = setTimeout(() => els.hitmarker?.classList.add('hidden'), 130);
        }
        if (els.dmgPopup) {
          els.dmgPopup.textContent = `${dmg}${isHs ? '!' : ''}`;
          els.dmgPopup.className = `dmg-popup${isHs ? ' headshot' : ''}`;
          void els.dmgPopup.offsetWidth;
          els.dmgPopup.classList.add('pop');
          clearTimeout(dmgTimer);
          dmgTimer = setTimeout(() => els.dmgPopup?.classList.add('hidden'), 420);
        }
      },
      onBanner: (text, tone = 'info') => {
        if (!els.banner) return;
        els.banner.textContent = text;
        els.banner.className = `hud-banner ${tone}`;
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => els.banner?.classList.add('hidden'), 2400);
      },
      onKillfeed: (ev) => {
        if (!els.killfeed) return;
        const row = document.createElement('div');
        row.className = 'cs2-kf-row';
        row.innerHTML = `<span class="${ev.killerTeam}">${ev.killer}</span><span class="wpn">[${ev.weapon}]</span>${ev.headshot ? '<span class="hs">HS</span>' : ''}<span class="${ev.victimTeam}">${ev.victim}</span>`;
        els.killfeed.prepend(row);
        while (els.killfeed.childElementCount > 5) {
          els.killfeed.lastElementChild?.remove();
        }
        setTimeout(() => row.remove(), 5500);
      },
      onMatchEnd: (res) => {
        els.matchEndOverlay?.classList.remove('hidden');
        if (document.pointerLockElement === els.canvas) {
          document.exitPointerLock?.();
        }
        if (els.matchEndTitle) {
          els.matchEndTitle.textContent = res.localWon ? t('cs2_match_victory') : t('cs2_match_defeat');
        }
        if (els.matchEndScore) {
          els.matchEndScore.textContent = `CT ${res.ctScore} — ${res.tScore} T`;
        }
      },
      onHudUpdate: (d) => {
        if (els.fps) els.fps.textContent = `${d.fps} FPS`;
        if (els.ms) els.ms.textContent = `${d.frameMs.toFixed(1)} ms`;
        if (els.qualityBadge) els.qualityBadge.textContent = (QUALITY_PRESETS[d.quality] || QUALITY_PRESETS.medium).shortLabel;
        if (els.velChip) {
          els.velChip.textContent = `${d.speedU} u/s${d.accurate ? ' · 100%' : ''}`;
          els.velChip.classList.toggle('accurate', Boolean(d.accurate));
        }
        if (els.roomCopy) {
          els.roomCopy.classList.toggle('hidden', !d.roomCode);
          if (d.roomCode) els.roomCopy.textContent = `#${d.roomCode}`;
        }

        renderAlivePips(els.ctAlive, d.ctAlive, 'ct');
        renderAlivePips(els.tAlive, d.tAlive, 't');
        if (els.ctScore) els.ctScore.textContent = String(d.ctScore);
        if (els.tScore) els.tScore.textContent = String(d.tScore);

        if (els.timer) {
          if (d.bombPlanted) {
            els.timer.textContent = `C4 ${d.bombTime.toFixed(1)}s`;
            els.timer.classList.add('planted');
          } else {
            const sec = Math.ceil(d.timeLeft);
            const mm = Math.floor(sec / 60);
            const ss = String(sec % 60).padStart(2, '0');
            els.timer.textContent = `${mm}:${ss}`;
            els.timer.classList.remove('planted');
          }
        }
        if (els.phaseTag) {
          els.phaseTag.textContent = d.bombPlanted
            ? t('cs2_phase_bomb', { site: d.bombSite })
            : (d.phase === 'FREEZE' ? t('cs2_phase_freeze') : `${t('round_num', { num: d.roundNum })}`);
        }

        if (els.sniperScope) {
          const scoped = d.alive && d.scopeZoom > 0 && !d.paused && !d.buyMenuOpen;
          els.sniperScope.classList.toggle('hidden', !scoped);
          els.sniperScope.dataset.zoom = String(d.scopeZoom);
          if (els.scopeZoomVal) els.scopeZoomVal.textContent = d.scopeZoom >= 2 ? '6.0×' : '2.5×';
          els.crosshair?.classList.toggle('hidden', scoped || !d.alive);
        }
        if (els.crosshair) {
          els.crosshair.style.setProperty('--ch-gap', `${d.chGapPx}px`);
        }

        const showReload = d.reloading && d.alive;
        const showPlant = d.plantProgress > 0 && d.alive;
        const showDefuse = d.defuseProgress > 0 && d.alive;
        if (els.actionBar) {
          const active = showReload || showPlant || showDefuse;
          els.actionBar.classList.toggle('hidden', !active);
          if (active) {
            const pct = showPlant ? d.plantProgress : (showDefuse ? d.defuseProgress : d.reloadProgress);
            if (els.actionLabel) {
              els.actionLabel.textContent = showPlant ? t('cs2_planting') : (showDefuse ? t('cs2_defusing') : t('hud_reloading'));
            }
            if (els.actionTime) {
              els.actionTime.textContent = showReload ? `${Math.max(0, d.reloadLeft).toFixed(1)}s` : `${Math.round(pct * 100)}%`;
            }
            if (els.actionFill) {
              els.actionFill.style.width = `${Math.max(0, Math.min(100, pct * 100)).toFixed(1)}%`;
            }
          }
        }

        if (els.objHint) {
          if (d.objHint && !showPlant && !showDefuse) {
            els.objHint.textContent = d.objHint.type === 'plant_hint'
              ? t('cs2_hint_plant', { site: d.objHint.site })
              : t('cs2_hint_defuse');
            els.objHint.classList.remove('hidden');
          } else {
            els.objHint.classList.add('hidden');
          }
        }

        if (els.specBar) {
          const showSpec = !d.alive && Boolean(d.spectatingName);
          els.specBar.classList.toggle('hidden', !showSpec);
          if (showSpec) els.specBar.textContent = t('cs2_spectating', { name: d.spectatingName });
        }

        if (els.lockHint) {
          els.lockHint.classList.toggle('hidden', d.pointerLocked || d.paused || d.buyMenuOpen || d.phase === 'MATCH_END');
        }

        if (els.hpVal) {
          els.hpVal.textContent = String(d.hp);
          els.hpVal.classList.toggle('low', d.hp <= 30);
        }
        if (els.hpFill) els.hpFill.style.width = `${Math.max(0, Math.min(100, d.hp))}%`;
        if (els.armorVal) els.armorVal.textContent = String(d.armor);
        if (els.armorFill) els.armorFill.style.width = `${Math.max(0, Math.min(100, d.armor))}%`;
        if (els.helmetBadge) els.helmetBadge.textContent = d.hasHelmet ? t('cs2_vest_helmet') : t('cs2_vest');

        if (els.moneyVal) els.moneyVal.textContent = `$${d.money}`;
        if (els.buyPill) els.buyPill.classList.toggle('hidden', !d.canBuy);
        if (els.ammoMag) els.ammoMag.textContent = Number.isFinite(d.magSize) ? String(d.ammoMag) : '∞';
        if (els.ammoRes) els.ammoRes.textContent = Number.isFinite(d.magSize) ? `/ ${d.ammoReserve}` : '';
        if (els.ammoWpn) els.ammoWpn.textContent = d.weaponName;

        for (let i = 0; i < 4; i++) {
          const sEl = els.slots[i];
          if (!sEl) continue;
          const wId = d.slots[i];
          sEl.classList.toggle('active', d.activeSlot === i);
          sEl.classList.toggle('empty', !wId);
          const nameSpan = sEl.querySelector('.s-name');
          if (nameSpan) {
            nameSpan.textContent = wId ? (CS2_WEAPONS[wId]?.shortName || wId) : '—';
          }
        }
      }
    });

    cs2Game.startMatch(opts);
  }

  // Lobby event bindings
  els.lobbyBackBtn?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    leaveOnlineRoom();
    switchView('portal');
  });

  els.lobbySettingsBtn?.addEventListener('click', () => openSettingsModal());

  els.modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      cs2Audio.playUiClick();
      syncModeButtons(btn.dataset.cs2Mode || 'competitive');
    });
  });

  els.playBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      cs2Audio.playUiClick();
      syncPlayType(btn.dataset.cs2Play || 'bot');
    });
  });

  els.teamBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      cs2Audio.playUiClick();
      syncTeam(btn.dataset.cs2Team || 'ct');
    });
  });

  els.diffBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      cs2Audio.playUiClick();
      syncDiff(btn.dataset.cs2Diff || 'medium');
    });
  });

  els.btnCreateRoom?.addEventListener('click', async () => {
    cs2Audio.playUiClick();
    els.roomError?.classList.add('hidden');
    const mode = selectedMode === 'wingman' ? 'wingman' : 'competitive';
    const res = await cs2Network.createRoom({
      name: storage.get().playerName,
      mode,
      team: selectedTeam,
      botDifficulty: selectedDiff,
      fillBots: els.fillBotsChk ? els.fillBotsChk.checked : true
    });
    if (!res.ok) {
      if (els.roomError) {
        els.roomError.textContent = res.error;
        els.roomError.classList.remove('hidden');
      }
      return;
    }
    activeRoom = res.room;
    renderRoomUI();
    const url = `${window.location.origin}/?cs2room=${activeRoom.code}`;
    await copyTextSafe(url);
    showToast(t('room_code_toast', { code: activeRoom.code }));
  });

  async function joinRoomByCode(raw) {
    els.roomError?.classList.add('hidden');
    const code = String(raw || '').trim().replace(/^#/, '').toUpperCase();
    if (!code) {
      if (els.roomError) {
        els.roomError.textContent = t('room_enter_code');
        els.roomError.classList.remove('hidden');
      }
      return;
    }
    const res = await cs2Network.joinRoom(code, {
      name: storage.get().playerName,
      team: selectedTeam
    });
    if (!res.ok) {
      if (els.roomError) {
        els.roomError.textContent = res.error;
        els.roomError.classList.remove('hidden');
      }
      return;
    }
    activeRoom = res.room;
    syncPlayType('online');
    renderRoomUI();
    if (els.joinInput) els.joinInput.value = '';
    showToast(t('party_joined_toast', { code: activeRoom.code }));
  }

  els.btnJoinRoom?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    joinRoomByCode(els.joinInput?.value);
  });

  els.joinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoomByCode(els.joinInput.value);
  });

  els.roomCodeBtn?.addEventListener('click', async () => {
    if (!activeRoom?.code) return;
    cs2Audio.playUiClick();
    const ok = await copyTextSafe(`${window.location.origin}/?cs2room=${activeRoom.code}`);
    showToast(ok ? t('copied') : t('room_code_toast', { code: activeRoom.code }));
  });

  els.btnSwitchTeam?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    if (activeRoom) cs2Network.switchTeam();
  });

  els.fillBotsChk?.addEventListener('change', () => {
    if (activeRoom && cs2Network.isHost()) {
      cs2Network.setSettings({ fillBots: els.fillBotsChk.checked });
    }
  });

  els.btnLeaveRoom?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    leaveOnlineRoom();
  });

  els.btnPlay?.addEventListener('click', async () => {
    cs2Audio.playUiClick();
    if (selectedPlayType === 'online') {
      if (!activeRoom) {
        showToast(t('cs2_create_or_join_first'));
        return;
      }
      if (!cs2Network.isHost()) return;
      await cs2Network.startMatch({
        mode: selectedMode === 'wingman' ? 'wingman' : 'competitive',
        fillBots: els.fillBotsChk ? els.fillBotsChk.checked : true,
        botDifficulty: selectedDiff
      });
      return;
    }

    launchMatch({
      mode: selectedMode,
      playType: selectedMode === 'training' ? 'training' : 'bot',
      team: selectedTeam,
      difficulty: selectedDiff
    });
  });

  cs2Network.on('cs2_room_update', (room) => {
    activeRoom = room;
    renderRoomUI();
  });

  cs2Network.on('cs2_match_started', (room) => {
    activeRoom = room;
    launchMatch({
      mode: room.mode,
      playType: 'online',
      team: selectedTeam,
      difficulty: room.botDifficulty || selectedDiff,
      room
    });
  });

  // In-game button & pause handlers
  els.btnBuyHint?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    cs2Game?.setBuyMenuOpen(true);
  });

  els.btnPause?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    cs2Game?.setPaused(true);
  });

  els.buyClose?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    cs2Game?.setBuyMenuOpen(false);
    cs2Game?.requestLock();
  });

  els.btnResume?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    if (cs2Game) {
      cs2Game.setPaused(false);
      cs2Game.requestLock();
    }
  });

  els.sensSlider?.addEventListener('input', () => {
    const val = parseFloat(els.sensSlider.value);
    if (Number.isFinite(val)) {
      storage.update({ sensitivity: val });
      if (els.sensVal) els.sensVal.textContent = val.toFixed(2);
    }
  });

  els.btnPauseSettings?.addEventListener('click', () => openSettingsModal());

  els.btnLeaveLobby?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    destroyGame();
    if (activeRoom && cs2Network.isHost()) cs2Network.returnToLobby();
    switchView('cs2-lobby');
  });

  els.btnExitPortal?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    destroyGame();
    leaveOnlineRoom();
    switchView('portal');
  });

  els.btnPlayAgain?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    els.matchEndOverlay?.classList.add('hidden');
    launchMatch({
      mode: selectedMode,
      playType: selectedPlayType === 'online' && activeRoom ? 'online' : (selectedMode === 'training' ? 'training' : 'bot'),
      team: selectedTeam,
      difficulty: selectedDiff,
      room: activeRoom
    });
  });

  els.btnMatchEndLobby?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    destroyGame();
    if (activeRoom && cs2Network.isHost()) cs2Network.returnToLobby();
    switchView('cs2-lobby');
  });

  els.btnMatchEndPortal?.addEventListener('click', () => {
    cs2Audio.playUiClick();
    destroyGame();
    leaveOnlineRoom();
    switchView('portal');
  });

  els.roomCopy?.addEventListener('click', async () => {
    if (!activeRoom?.code) return;
    cs2Audio.playUiClick();
    const ok = await copyTextSafe(`${window.location.origin}/?cs2room=${activeRoom.code}`);
    showToast(ok ? t('copied') : t('room_code_toast', { code: activeRoom.code }));
  });

  storage.subscribe(() => updateLobbyTexts());

  syncModeButtons('competitive');
  syncPlayType('bot');
  syncTeam('ct');
  syncDiff('medium');

  return {
    destroyGame,
    leaveOnlineRoom,
    joinRoomFromUrl(code) {
      switchView('cs2-lobby');
      syncPlayType('online');
      if (els.joinInput) els.joinInput.value = String(code).toUpperCase();
      setTimeout(() => joinRoomByCode(code), 450);
    },
    refreshTranslations() {
      updateLobbyTexts();
      updatePlayCTA();
      renderRoomUI();
    }
  };
}
