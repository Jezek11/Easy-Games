const STORAGE_KEY = 'buildroyale_portal_settings_v1';

const DEFAULT_SETTINGS = {
  quality: 'medium', // 'low' | 'medium' | 'high'
  skinId: 'cyan',
  buildMat: 'wood', // 'wood' | 'brick' | 'metal'
  playerName: `Hráč_${Math.floor(100 + Math.random() * 899)}`,
  muted: false,
  sensitivity: 1.0
};

class StorageManager {
  constructor() {
    this.state = { ...DEFAULT_SETTINGS };
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
        if (typeof parsed.sensitivity === 'number' && parsed.sensitivity >= 0.2 && parsed.sensitivity <= 3.0) {
          this.state.sensitivity = parsed.sensitivity;
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
    Object.assign(this.state, patch);
    this.save();
    for (const cb of this.listeners) {
      cb(this.state);
    }
  }

  subscribe(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const storage = new StorageManager();
