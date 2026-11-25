import { storage } from './storage.js';

export function normalizeLang(lang) {
  return lang === 'cs' ? 'cs' : 'en';
}

export function getLang() {
  return normalizeLang(storage.get()?.lang);
}

const QUALITY_DESCS = {
  low: {
    en: '0.75× resolution • No textures, shadows, sky, fog or effects • Max FPS',
    cs: '0.75× rozlišení • Bez textur, stínů, oblohy, mlhy a efektů • Max FPS'
  },
  medium: {
    en: '1.0× resolution • 512px shadows • Textures + sky + fog • Balanced',
    cs: '1.0× rozlišení • 512px stíny • Textury + obloha + mlha • Vyvážené'
  },
  high: {
    en: 'Full resolution + AA • 2048px soft shadows • PBR reflections + full effects',
    cs: 'Plné rozlišení + AA • 2048px měkké stíny • PBR odlesky + plné efekty'
  }
};

const MATERIAL_NAMES = {
  wood: { en: 'Wood', cs: 'Dřevo' },
  brick: { en: 'Brick', cs: 'Cihla' },
  metal: { en: 'Metal', cs: 'Kov' }
};

const SKIN_NAMES = {
  cyan: { en: 'Cyber Blue', cs: 'Cyber modrá' },
  crimson: { en: 'Crimson', cs: 'Karmínová' },
  emerald: { en: 'Emerald', cs: 'Smaragdová' },
  gold: { en: 'Gold', cs: 'Zlatá' },
  violet: { en: 'Violet', cs: 'Fialová' },
  orange: { en: 'Orange', cs: 'Oranžová' }
};

const BOT_DIFF_LABELS = {
  easy: { en: 'Easy', cs: 'Lehký' },
  medium: { en: 'Medium', cs: 'Střední' },
  hard: { en: 'Hard', cs: 'Těžký' },
  extreme: { en: 'Extreme', cs: 'Extrém' }
};

const DICT = {
  en: {
    page_title: 'Xgames — SkyBuild',
    aria_graphics: 'Graphics',
    aria_language: 'Language',
    aria_settings: 'Settings',
    aria_close: 'Close',
    aria_cosmetics: 'Character look and build material',
    aria_game_mode: 'Game mode',
    aria_map: 'Map',
    aria_play_mode: 'Match type',
    aria_bot_diff: 'Bot difficulty',
    aria_room_code: 'Room code',
    aria_sens: 'Mouse sensitivity',

    portal_game_status_live: 'Playable',
    portal_game_tagline: '1v1 Build & Aim Arena • Fast Construction, Editing & Gunplay',
    portal_play: 'Play',
    portal_back: '← Portal',

    lobby_mode_1v1: '1v1 Build Fight',
    lobby_mode_br: 'Battle Royale',
    lobby_badge_soon: 'Soon',
    lobby_section_map: 'Select Map',
    lobby_section_match: 'Match Mode',
    map_skybox_name: 'Sky Drop Box',
    map_skybox_sub: '1 Sky Box • 4 Guns (2 Slots)',
    map_vramp_name: '1v1 V-Ramp',
    map_vramp_sub: 'V-Ramp behind iron wall • 3-2-1 countdown',

    play_solo: 'Training',
    play_bot: 'Vs Bot',
    play_friend: 'Party / Invite Friend',
    play_random: 'Random Opponent',
    diff_easy: 'Easy',
    diff_medium: 'Medium',
    diff_hard: 'Hard',
    diff_extreme: 'Extreme',
    friend_code_ph: 'Party code',
    btn_join: 'Join',
    btn_cancel: 'Cancel',
    btn_retry: 'Retry',
    btn_play: 'PLAY',
    btn_start_party: 'START GAME',
    btn_waiting_leader: 'WAITING FOR LEADER…',
    btn_cancel_search: 'CANCEL SEARCH',
    party_title: 'Party',
    party_leader: 'Party Leader',
    party_member: 'Member',
    party_you_tag: 'You',
    party_leave: 'Leave',
    party_kick: 'Kick',
    party_copy_hint: 'Copy party invite',
    party_empty_slot: 'Share code #{code} to invite a friend',
    party_leader_hint: 'You are Party Leader — pick a map and start the game',
    party_member_hint: 'Waiting for Party Leader to start the game…',
    party_joined_toast: 'Joined Party #{code}',
    party_member_joined: '{name} joined the party',
    party_member_left: '{name} left the party',
    party_promoted_leader: 'You are now Party Leader',
    party_kicked_toast: 'You were removed from the party',
    mm_searching: 'Finding opponent… {sec}s',
    mm_not_found: 'Opponent not found',
    mm_unavailable: 'Online matchmaking is unavailable.',
    mm_found: 'Opponent found!',
    room_create_fail: 'Failed to create room.',
    room_code_toast: 'Room code: #{code}',
    room_enter_code: 'Enter the 4-character room code.',
    room_not_found: 'Room not found.',
    room_invite_toast: 'Invite to room #{code}',
    copied: 'Copied!',

    hud_you: 'You',
    hud_opp: 'Opponent',
    hud_target: 'Target',
    hud_offline: 'Offline',
    hud_copy_invite_title: 'Copy invite link',
    hud_respawn_btn: '[{key}] Respawn',
    hud_menu_btn: '[ESC] Menu',
    hud_spawn_zone: 'Sky Armory — [{key}] Pick 2 weapons • Jump on Boost Pad',
    hud_pickup_prompt: '[{key}] Equip {weapon} (Slot {slot})',
    hud_boost: '[{key}] Boost',
    hud_edit_hint: 'Edit: <b>[LMB]</b> Tile · <b>[{key}]</b> Confirm · <b>[RMB]</b> Reset · <b>[ESC]</b> Cancel',
    hud_lock_hint: 'Click to lock cursor',
    hud_shield: 'Shield',
    hud_hp: 'Health',
    hud_reloading: 'Reloading',
    hud_reload_key: '[{key}] Reload',
    hud_scope_rmb: 'RMB Zoom',
    hud_mat_switch_title: '[RMB] Switch material',
    weapon_shotgun: 'Pump Shotgun',
    weapon_smg: 'Tactical SMG',
    weapon_ar: 'Assault Rifle',
    weapon_sniper: 'Bolt Sniper',
    weapon_pickaxe: 'Pickaxe',
    build_wall: 'Wall',
    build_floor: 'Floor',
    build_ramp: 'Ramp',
    round_countdown: 'Countdown',
    round_restarting: 'Next round…',
    round_waiting: 'Waiting for opponent',
    round_training: 'Training',
    round_num: 'Round {num}',
    hud_go: 'GO!',

    pause_title: 'Paused',
    pause_resume: 'Resume Game',
    pause_graphics: 'Graphics',
    pause_sens: 'Mouse Sensitivity',
    pause_settings: 'Keybinds & Settings',
    pause_leave: 'Leave to Lobby',

    settings_title: 'Settings',
    settings_nick: 'Nickname',
    settings_nick_ph: 'Nickname',
    settings_lang: 'Language',
    settings_graphics: 'Graphics',
    settings_sens: 'Mouse Sensitivity',
    settings_sound: 'Sound',
    settings_keybinds: 'Keybinds',
    keybind_reset: 'Reset Defaults',
    keybind_press: 'Press key…',
    keybind_hint: 'Click a key to rebind (Keyboard or Mouse 3/4/5) · ESC cancels',
    keybind_swapped: 'Swapped "{action}" to {key}',
    keybind_reset_done: 'Keybinds reset to defaults',
    kb_group_move: 'Movement',
    kb_group_combat: 'Weapons & Actions',
    kb_group_build: 'Building & Edit',
    kb_moveForward: 'Move Forward',
    kb_moveBackward: 'Move Backward',
    kb_moveLeft: 'Strafe Left',
    kb_moveRight: 'Strafe Right',
    kb_jump: 'Jump / Boost',
    kb_sprint: 'Sprint',
    kb_crouch: 'Crouch',
    kb_slot1: 'Weapon Slot 1',
    kb_slot2: 'Weapon Slot 2',
    kb_slot3: 'Pickaxe',
    kb_reload: 'Reload',
    kb_interact: 'Pick Up / Reset',
    kb_respawn: 'Respawn',
    kb_emote: 'Emotes',
    kb_buildWall: 'Wall',
    kb_buildFloor: 'Floor',
    kb_buildRamp: 'Ramp',
    kb_buildToggle: 'Toggle Build',
    kb_edit: 'Edit Build',
    mute_on: 'On',
    mute_muted: 'Muted',
    default_player_fallback: 'Player',

    banner_elim_bot: 'Eliminated {name}',
    banner_elim_target: 'Target eliminated',
    banner_you_eliminated: 'You were eliminated',
    banner_bot_elim_you: 'Bot eliminated you{hs}',
    banner_host_mat_only: 'Room host sets the build material.',
    banner_fell_you_opp: 'Fell off map! +1 point for opponent',
    banner_fell_you_bot: 'Fell off map! Bot scores',
    banner_fell_solo: 'Fell off map!',
    banner_fell_opp: '{name} fell off the map! +1 point',
    banner_fell_bot: 'Bot fell off the map! +1 point',
    banner_mat_changed: 'Material: {mat}',
    banner_opp_joined: '{name} joined',
    banner_opp_left: '{name} left',
    banner_bot_diff: 'Bot difficulty: {diff}',
    banner_edit_own_only: 'You can only edit your own builds',
    banner_arena_reset: 'Arena reset ({name})',
    banner_respawned: 'Respawned',
    banner_next_round: 'Next round',
    banner_weapon_equipped: '{weapon} equipped in Slot {slot}',

    emote_hub: 'Emotes',
    emote_take_l: 'Take the L',
    emote_floss: 'Floss',
    emote_gg: 'GG Wave',
    emote_slot_title: '[{key}] Emotes'
  },
  cs: {
    page_title: 'Xgames — SkyBuild',
    aria_graphics: 'Grafika',
    aria_language: 'Jazyk',
    aria_settings: 'Nastavení',
    aria_close: 'Zavřít',
    aria_cosmetics: 'Vzhled postavy a materiál',
    aria_game_mode: 'Herní režim',
    aria_map: 'Mapa',
    aria_play_mode: 'Typ hry',
    aria_bot_diff: 'Obtížnost bota',
    aria_room_code: 'Kód místnosti',
    aria_sens: 'Citlivost myši',

    portal_game_status_live: 'Hratelné',
    portal_game_tagline: '1v1 Stavební a střelecká aréna • Rychlé stavění, editace a souboje',
    portal_play: 'Hrát',
    portal_back: '← Portál',

    lobby_mode_1v1: '1v1 Build Fight',
    lobby_mode_br: 'Battle Royale',
    lobby_badge_soon: 'Brzy',
    lobby_section_map: 'Výběr mapy',
    lobby_section_match: 'Typ zápasu',
    map_skybox_name: 'Sky Drop Box',
    map_skybox_sub: '1 Sky Box • 4 zbraně (2 sloty)',
    map_vramp_name: '1v1 V-Ramp',
    map_vramp_sub: 'V-Rampa za železnou zdí • Odpočet 3-2-1',

    play_solo: 'Trénink',
    play_bot: 'Proti Botovi',
    play_friend: 'Party / Pozvat kamaráda',
    play_random: 'Náhodný soupeř',
    diff_easy: 'Lehký',
    diff_medium: 'Střední',
    diff_hard: 'Těžký',
    diff_extreme: 'Extrém',
    friend_code_ph: 'Kód party',
    btn_join: 'Připojit',
    btn_cancel: 'Zrušit',
    btn_retry: 'Znovu',
    btn_play: 'HRÁT',
    btn_start_party: 'SPUSTIT HRU',
    btn_waiting_leader: 'ČEKÁNÍ NA LEADERA…',
    btn_cancel_search: 'ZRUŠIT HLEDÁNÍ',
    party_title: 'Party',
    party_leader: 'Party Leader',
    party_member: 'Člen',
    party_you_tag: 'Ty',
    party_leave: 'Opustit',
    party_kick: 'Vyhodit',
    party_copy_hint: 'Kopírovat pozvánku do party',
    party_empty_slot: 'Sdílej kód #{code} pro pozvání kamaráda',
    party_leader_hint: 'Jsi Party Leader — vyber mapu a spusť hru',
    party_member_hint: 'Čekání, až Party Leader spustí hru…',
    party_joined_toast: 'Připojeno do Party #{code}',
    party_member_joined: '{name} se připojil do party',
    party_member_left: '{name} opustil party',
    party_promoted_leader: 'Nyní jsi Party Leader',
    party_kicked_toast: 'Byl jsi odebrán z party',
    mm_searching: 'Hledám soupeře… {sec}s',
    mm_not_found: 'Soupeř nenalezen',
    mm_unavailable: 'Online matchmaking není dostupný.',
    mm_found: 'Soupeř nalezen!',
    room_create_fail: 'Nepodařilo se vytvořit místnost.',
    room_code_toast: 'Kód místnosti: #{code}',
    room_enter_code: 'Zadej 4místný kód místnosti.',
    room_not_found: 'Místnost nenalezena.',
    room_invite_toast: 'Pozvánka do místnosti #{code}',
    copied: 'Zkopírováno!',

    hud_you: 'Ty',
    hud_opp: 'Soupeř',
    hud_target: 'Terč',
    hud_offline: 'Offline',
    hud_copy_invite_title: 'Kopírovat pozvánku',
    hud_respawn_btn: '[{key}] Respawn',
    hud_menu_btn: '[ESC] Menu',
    hud_spawn_zone: 'Zbrojnice — [{key}] Vyber 2 zbraně • Skoč na Boost Pad',
    hud_pickup_prompt: '[{key}] Vzít {weapon} (Slot {slot})',
    hud_boost: '[{key}] Boost',
    hud_edit_hint: 'Úprava: <b>[LMB]</b> Dlaždice · <b>[{key}]</b> Potvrdit · <b>[RMB]</b> Reset · <b>[ESC]</b> Zrušit',
    hud_lock_hint: 'Kliknutím uzamkneš kurzor',
    hud_shield: 'Štít',
    hud_hp: 'Zdraví',
    hud_reloading: 'Přebíjení',
    hud_reload_key: '[{key}] Přebít',
    hud_scope_rmb: 'RMB Přiblížení',
    hud_mat_switch_title: '[RMB] Změnit materiál',
    weapon_shotgun: 'Brokovnice',
    weapon_smg: 'Taktické SMG',
    weapon_ar: 'Útočná puška',
    weapon_sniper: 'Odstřelovačka',
    weapon_pickaxe: 'Krumpáč',
    build_wall: 'Zeď',
    build_floor: 'Podlaha',
    build_ramp: 'Rampa',
    round_countdown: 'Odpočet',
    round_restarting: 'Další kolo…',
    round_waiting: 'Čekání na soupeře',
    round_training: 'Trénink',
    round_num: 'Kolo {num}',
    hud_go: 'START!',

    pause_title: 'Pauza',
    pause_resume: 'Pokračovat ve hře',
    pause_graphics: 'Grafika',
    pause_sens: 'Citlivost myši',
    pause_settings: 'Ovládání a nastavení',
    pause_leave: 'Odejít do lobby',

    settings_title: 'Nastavení',
    settings_nick: 'Přezdívka',
    settings_nick_ph: 'Přezdívka',
    settings_lang: 'Jazyk',
    settings_graphics: 'Grafika',
    settings_sens: 'Citlivost myši',
    settings_sound: 'Zvuk',
    settings_keybinds: 'Klávesové zkratky',
    keybind_reset: 'Výchozí',
    keybind_press: 'Stiskni klávesu…',
    keybind_hint: 'Klikni na klávesu pro změnu (klávesnice i boční tlačítka myši) · ESC zruší',
    keybind_swapped: 'Prohozeno s „{action}" ({key})',
    keybind_reset_done: 'Klávesy obnoveny na výchozí',
    kb_group_move: 'Pohyb',
    kb_group_combat: 'Zbraně a akce',
    kb_group_build: 'Stavění a editace',
    kb_moveForward: 'Pohyb vpřed',
    kb_moveBackward: 'Pohyb vzad',
    kb_moveLeft: 'Úkrok vlevo',
    kb_moveRight: 'Úkrok vpravo',
    kb_jump: 'Skok / Boost',
    kb_sprint: 'Sprint',
    kb_crouch: 'Přikrčení',
    kb_slot1: 'Zbraň 1',
    kb_slot2: 'Zbraň 2',
    kb_slot3: 'Krumpáč',
    kb_reload: 'Přebití',
    kb_interact: 'Sebrat zbraň / Reset',
    kb_respawn: 'Respawn',
    kb_emote: 'Emoty',
    kb_buildWall: 'Zeď',
    kb_buildFloor: 'Podlaha',
    kb_buildRamp: 'Rampa',
    kb_buildToggle: 'Přepnout stavění',
    kb_edit: 'Upravit stavbu',
    mute_on: 'Zapnuto',
    mute_muted: 'Ztlumeno',
    default_player_fallback: 'Hráč',

    banner_elim_bot: 'Eliminace: {name}',
    banner_elim_target: 'Terč eliminován',
    banner_you_eliminated: 'Byl jsi eliminován',
    banner_bot_elim_you: 'Bot tě eliminoval{hs}',
    banner_host_mat_only: 'Materiál určuje zakladatel místnosti.',
    banner_fell_you_opp: 'Pád z mapy! +1 bod pro soupeře',
    banner_fell_you_bot: 'Pád z mapy! Bot skóruje',
    banner_fell_solo: 'Pád z mapy!',
    banner_fell_opp: '{name} spadl z mapy! +1 bod',
    banner_fell_bot: 'Bot spadl z mapy! +1 bod',
    banner_mat_changed: 'Materiál: {mat}',
    banner_opp_joined: '{name} se připojil',
    banner_opp_left: '{name} odešel',
    banner_bot_diff: 'Obtížnost bota: {diff}',
    banner_edit_own_only: 'Upravovat můžeš jen své stavby',
    banner_arena_reset: 'Reset arény ({name})',
    banner_respawned: 'Respawnuto',
    banner_next_round: 'Další kolo',
    banner_weapon_equipped: '{weapon} ve slotu {slot}',

    emote_hub: 'Emoty',
    emote_take_l: 'Take the L',
    emote_floss: 'Floss',
    emote_gg: 'GG Pozdrav',
    emote_slot_title: '[{key}] Emoty'
  }
};

export function t(key, params = null, langOverride = null) {
  const lang = normalizeLang(langOverride || getLang());
  let str = DICT[lang]?.[key] ?? DICT.en[key] ?? key;
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v ?? ''));
    }
  }
  return str;
}

export function getQualityDesc(qualityKey, langOverride = null) {
  const lang = normalizeLang(langOverride || getLang());
  const entry = QUALITY_DESCS[qualityKey] || QUALITY_DESCS.medium;
  return entry[lang] || entry.en;
}

export function getMaterialName(matId, langOverride = null) {
  const lang = normalizeLang(langOverride || getLang());
  return MATERIAL_NAMES[matId]?.[lang] || MATERIAL_NAMES[matId]?.en || matId;
}

export function getSkinName(skinId, langOverride = null) {
  const lang = normalizeLang(langOverride || getLang());
  return SKIN_NAMES[skinId]?.[lang] || SKIN_NAMES[skinId]?.en || skinId;
}

export function getBotDiffLabel(diffId, langOverride = null) {
  const lang = normalizeLang(langOverride || getLang());
  return BOT_DIFF_LABELS[diffId]?.[lang] || BOT_DIFF_LABELS[diffId]?.en || diffId;
}

export function applyTranslations(langOverride = null) {
  const lang = normalizeLang(langOverride || getLang());
  document.documentElement.lang = lang;
  document.title = t('page_title', null, lang);

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n, null, lang);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml, null, lang);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder, null, lang));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle, null, lang));
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria, null, lang));
  });
}
