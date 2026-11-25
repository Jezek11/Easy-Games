const STORAGE_KEY = 'buildroyale_portal_settings_v1';

export const MIN_SENSITIVITY = 0.1;
export const MAX_SENSITIVITY = 6.0;

export const DEFAULT_KEYBINDS = {
  moveForward: 'KeyW',
  moveBackward: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  crouch: 'ControlLeft',
  slot1: 'Digit1',
  slot2: 'Digit2',
  slot3: 'Digit3',
  buildWall: 'KeyQ',
  buildFloor: 'KeyC',
  buildRamp: 'KeyV',
  buildToggle: 'KeyF',
  edit: 'KeyG',
  reload: 'KeyR',
  interact: 'KeyE',
  respawn: 'KeyT',
  emote: 'KeyB'
};

export const KEYBIND_GROUPS = [
  {
    id: 'move',
    titleKey: 'kb_group_move',
    actions: ['moveForward', 'moveBackward', 'moveLeft', 'moveRight', 'jump', 'sprint', 'crouch']
  },
  {
    id: 'combat',
    titleKey: 'kb_group_combat',
    actions: ['slot1', 'slot2', 'slot3', 'reload', 'interact', 'respawn', 'emote']
  },
  {
    id: 'build',
    titleKey: 'kb_group_build',
    actions: ['buildWall', 'buildFloor', 'buildRamp', 'buildToggle', 'edit']
  }
];

const KEY_LABEL_MAP = {
  Space: 'SPACE',
  ShiftLeft: 'L-SHIFT',
  ShiftRight: 'R-SHIFT',
  ControlLeft: 'L-CTRL',
  ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT',
  AltRight: 'R-ALT',
  Tab: 'TAB',
  CapsLock: 'CAPS',
  Enter: 'ENTER',
  Backspace: 'BKSP',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Mouse3: 'MOUSE 3',
  Mouse4: 'MOUSE 4',
  Mouse5: 'MOUSE 5'
};

const KEY_SHORT_MAP = {
  Space: 'SPC',
  ShiftLeft: 'SHF',
  ShiftRight: 'RSH',
  ControlLeft: 'CTR',
  ControlRight: 'RCT',
  AltLeft: 'ALT',
  AltRight: 'RAL',
  Tab: 'TAB',
  CapsLock: 'CAP',
  Enter: 'ENT',
  Backspace: 'BSP',
  Mouse3: 'M3',
  Mouse4: 'M4',
  Mouse5: 'M5',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→'
};

export function formatKeyLabel(code) {
  if (!code) return '—';
  if (KEY_LABEL_MAP[code]) return KEY_LABEL_MAP[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code.toUpperCase();
}

export function formatKeyShort(code) {
  if (!code) return '—';
  if (KEY_SHORT_MAP[code]) return KEY_SHORT_MAP[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `N${code.slice(6)}`;
  return code.slice(0, 3).toUpperCase();
}

const DEFAULT_SETTINGS = {
  lang: 'en', // 'en' | 'cs'
  quality: 'medium', // 'low' | 'medium' | 'high'
  skinId: 'cyan',
  buildMat: 'wood', // 'wood' | 'brick' | 'metal'
  playerName: `Player_${Math.floor(100 + Math.random() * 899)}`,
  muted: false,
  sensitivity: 1.0,
  keybinds: { ...DEFAULT_KEYBINDS }
};

class StorageManager {
  constructor() {
    this.state = {
      ...DEFAULT_SETTINGS,
      keybinds: { ...DEFAULT_KEYBINDS }
    };
    this.listeners = new Set();
    this.load();
  }

  load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.save();
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.lang === 'en' || parsed.lang === 'cs') {
          this.state.lang = parsed.lang;
        }
        if (['low', 'medium', 'high'].includes(parsed.quality)) {
          this.state.quality = parsed.quality;
        }
        if (typeof parsed.skinId === 'string' && parsed.skinId.length > 0) {
          this.state.skinId = parsed.skinId;
        }
        if (['wood', 'brick', 'metal'].includes(parsed.buildMat)) {
          this.state.buildMat = parsed.buildMat;
        }
        if (typeof parsed.playerName === 'string' && parsed.playerName.trim().length > 0) {
          this.state.playerName = parsed.playerName.trim().slice(0, 18);
        }
        if (typeof parsed.muted === 'boolean') {
          this.state.muted = parsed.muted;
        }
        if (
          typeof parsed.sensitivity === 'number' &&
          Number.isFinite(parsed.sensitivity) &&
          parsed.sensitivity >= MIN_SENSITIVITY &&
          parsed.sensitivity <= MAX_SENSITIVITY
        ) {
          this.state.sensitivity = Math.round(parsed.sensitivity * 100) / 100;
        }
        if (parsed.keybinds && typeof parsed.keybinds === 'object') {
          const merged = { ...DEFAULT_KEYBINDS };
          for (const key of Object.keys(DEFAULT_KEYBINDS)) {
            const val = parsed.keybinds[key];
            if (typeof val === 'string' && val.length > 0 && val.length <= 24) {
              merged[key] = val;
            }
          }
          this.state.keybinds = merged;
        }
      }
    } catch {
      // Ignore storage access restrictions
    }
  }

  save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore quota/private mode errors
    }
  }

  get() {
    return this.state;
  }

  update(patch) {
    if (patch && typeof patch.sensitivity === 'number') {
      patch = {
        ...patch,
        sensitivity: Math.max(MIN_SENSITIVITY, Math.min(MAX_SENSITIVITY, Math.round(patch.sensitivity * 100) / 100))
      };
    }
    if (patch && patch.keybinds && typeof patch.keybinds === 'object') {
      const nextBinds = { ...this.state.keybinds };
      for (const key of Object.keys(DEFAULT_KEYBINDS)) {
        const val = patch.keybinds[key];
        if (typeof val === 'string' && val.length > 0 && val.length <= 24) {
          nextBinds[key] = val;
        }
      }
      patch = { ...patch, keybinds: nextBinds };
    }
    Object.assign(this.state, patch);
    this.save();
    for (const cb of this.listeners) {
      cb(this.state);
    }
  }

  resetKeybinds() {
    this.update({ keybinds: { ...DEFAULT_KEYBINDS } });
  }

  subscribe(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const storage = new StorageManager();
