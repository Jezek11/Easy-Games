import { audio as portalAudio } from '../../js/audio.js';

class CS2AudioEngine {
  constructor() {
    this._stepToggle = false;
  }

  _ctx() {
    return portalAudio.ensureContext();
  }

  _tone(fStart, fEnd, dur, type = 'sine', vol = 0.25, delay = 0) {
    portalAudio.playTone(fStart, fEnd, dur, type, vol, delay);
  }

  _noise(dur, filterFreq, filterType = 'bandpass', vol = 0.3, delay = 0) {
    portalAudio.playNoise(dur, filterFreq, filterType, vol, delay);
  }

  playWeaponFire(weaponId, distance = 0) {
    const atten = distance <= 2 ? 1.0 : Math.max(0.06, Math.min(1.0, 1.0 - distance / 85));
    if (atten <= 0.04) return;

    if (weaponId === 'ak47') {
      this._tone(165, 52, 0.11, 'sawtooth', 0.34 * atten);
      this._noise(0.11, 1450, 'bandpass', 0.42 * atten);
      this._noise(0.06, 3200, 'highpass', 0.18 * atten);
    } else if (weaponId === 'm4a1') {
      // Crisp suppressed/tactical carbine snap
      this._tone(235, 84, 0.08, 'triangle', 0.24 * atten);
      this._noise(0.085, 2200, 'bandpass', 0.30 * atten);
    } else if (weaponId === 'awp') {
      // Heavy thunderous sniper cannon + bolt cycle
      this._tone(110, 26, 0.34, 'sawtooth', 0.56 * atten);
      this._noise(0.36, 980, 'lowpass', 0.58 * atten);
      this._noise(0.16, 2600, 'bandpass', 0.24 * atten, 0.02);
      if (atten > 0.65) {
        this._tone(720, 520, 0.05, 'triangle', 0.11, 0.44);
        this._tone(920, 680, 0.045, 'triangle', 0.10, 0.58);
      }
    } else if (weaponId === 'deagle') {
      this._tone(145, 44, 0.16, 'sawtooth', 0.42 * atten);
      this._noise(0.16, 1700, 'bandpass', 0.45 * atten);
    } else if (weaponId === 'pistol') {
      this._tone(270, 96, 0.075, 'triangle', 0.20 * atten);
      this._noise(0.07, 2500, 'bandpass', 0.24 * atten);
    } else if (weaponId === 'knife') {
      this._noise(0.09, 1200, 'bandpass', 0.16 * atten);
      this._tone(340, 160, 0.07, 'sine', 0.10 * atten);
    }
  }

  playDryFire() {
    this._tone(880, 700, 0.03, 'square', 0.09);
  }

  playScopeToggle(zoomLevel) {
    if (zoomLevel === 1) {
      this._tone(660, 860, 0.035, 'sine', 0.11);
    } else if (zoomLevel === 2) {
      this._tone(880, 1180, 0.035, 'sine', 0.12);
    } else {
      this._tone(520, 320, 0.035, 'sine', 0.09);
    }
  }

  playReloadStart(weaponId = 'ak47') {
    if (weaponId === 'awp') {
      this._tone(580, 380, 0.05, 'triangle', 0.11, 0);
      this._tone(450, 680, 0.05, 'triangle', 0.11, 0.18);
    } else {
      this._tone(440, 260, 0.05, 'triangle', 0.12, 0);
      this._noise(0.04, 1900, 'bandpass', 0.09, 0.02);
    }
  }

  playReloadDone(weaponId = 'ak47') {
    this._tone(640, 920, 0.045, 'triangle', 0.13, 0);
    this._noise(0.035, 2500, 'bandpass', 0.08, 0.03);
    if (weaponId === 'ak47' || weaponId === 'm4a1') {
      this._tone(780, 1080, 0.04, 'triangle', 0.09, 0.09);
    }
  }

  playHitFeedback(isHeadshot = false, isKill = false) {
    if (isHeadshot) {
      // Crisp CS-style metallic helmet/headshot dink
      this._tone(1680, 2240, 0.07, 'triangle', 0.36);
      this._tone(2420, 1840, 0.065, 'sine', 0.22, 0.025);
    } else {
      this._tone(280, 160, 0.05, 'sine', 0.18);
    }
    if (isKill) {
      this._tone(520, 780, 0.08, 'triangle', 0.16, 0.04);
    }
  }

  playTookDamage(isHeadshot = false) {
    if (isHeadshot) {
      this._tone(1520, 620, 0.12, 'sawtooth', 0.28);
    }
    this._tone(130, 58, 0.13, 'sawtooth', 0.24);
  }

  playFootstep(distance = 0) {
    const atten = distance <= 1 ? 1.0 : Math.max(0, 1.0 - distance / 24);
    if (atten <= 0.05) return;
    this._stepToggle = !this._stepToggle;
    const freq = this._stepToggle ? 540 : 480;
    this._noise(0.05, freq, 'lowpass', 0.11 * atten);
    this._tone(110, 62, 0.04, 'sine', 0.05 * atten);
  }

  playLand(speedU = 300) {
    const scale = Math.min(1.0, Math.max(0.25, speedU / 650));
    this._noise(0.08, 420, 'lowpass', 0.20 * scale);
    this._tone(95, 42, 0.09, 'triangle', 0.14 * scale);
  }

  playKnifeHit(headshot = false) {
    this._tone(headshot ? 920 : 420, 180, 0.09, 'square', 0.22);
    this._noise(0.07, 2100, 'highpass', 0.18);
  }

  playBuyItem() {
    this._tone(560, 740, 0.05, 'triangle', 0.16, 0);
    this._tone(840, 1080, 0.06, 'sine', 0.14, 0.045);
  }

  playBuyDenied() {
    this._tone(220, 160, 0.08, 'sawtooth', 0.14);
  }

  playC4PlantTick(step = 0) {
    const freqs = [1100, 1240, 1380, 1520, 1280, 1620, 1760];
    const f = freqs[step % freqs.length];
    this._tone(f, f, 0.045, 'square', 0.11);
  }

  playC4Planted() {
    this._tone(880, 880, 0.08, 'square', 0.22, 0);
    this._tone(1174.66, 1174.66, 0.12, 'square', 0.24, 0.09);
  }

  playC4Beep(remainingSec = 40, distance = 0) {
    const atten = distance <= 4 ? 1.0 : Math.max(0.14, Math.min(1.0, 1.0 - distance / 52));
    const urgency = Math.max(0, Math.min(1, 1 - remainingSec / 40));
    const freq = 2350 + urgency * 350;
    this._tone(freq, freq * 0.99, 0.065, 'sine', 0.24 * atten);
  }

  playC4DefuseStart() {
    this._tone(520, 780, 0.06, 'triangle', 0.16, 0);
    this._tone(780, 960, 0.05, 'sine', 0.12, 0.06);
  }

  playC4Defused() {
    this._tone(523.25, 523.25, 0.1, 'triangle', 0.24, 0);
    this._tone(659.25, 659.25, 0.1, 'triangle', 0.24, 0.09);
    this._tone(783.99, 1046.5, 0.22, 'triangle', 0.26, 0.18);
  }

  playC4Explosion() {
    const ctx = this._ctx();
    if (!ctx) return;
    this._tone(120, 24, 0.85, 'sawtooth', 0.6);
    this._noise(0.48, 380, 'lowpass', 0.65);
    this._noise(0.45, 760, 'lowpass', 0.45, 0.15);
  }

  playRoundStart() {
    this._tone(440, 587.33, 0.09, 'triangle', 0.18, 0);
    this._tone(587.33, 880, 0.14, 'triangle', 0.18, 0.08);
  }

  playRoundWin(won = true) {
    if (won) {
      this._tone(523.25, 523.25, 0.11, 'triangle', 0.22, 0);
      this._tone(659.25, 659.25, 0.11, 'triangle', 0.22, 0.1);
      this._tone(783.99, 1046.5, 0.28, 'triangle', 0.26, 0.2);
    } else {
      this._tone(349.23, 311.13, 0.16, 'sawtooth', 0.16, 0);
      this._tone(277.18, 220, 0.26, 'sawtooth', 0.16, 0.15);
    }
  }

  playUiClick() {
    portalAudio.playUiClick();
  }
}

export const cs2Audio = new CS2AudioEngine();
