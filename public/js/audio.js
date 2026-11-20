import { storage } from './storage.js';

class ProceduralAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.muted = Boolean(storage.get().muted);
    storage.subscribe((s) => {
      this.muted = Boolean(s.muted);
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.45, this.ctx.currentTime);
      }
    });
  }

  ensureContext() {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.45;
      this.masterGain.connect(this.ctx.destination);

      // Pre-generate 0.5s reusable white noise buffer once
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playTone(freqStart, freqEnd, duration, type = 'sine', volume = 0.25, delay = 0) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + duration);
    }
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + duration + 0.01);
  }

  playNoise(duration, filterFreq, filterType = 'bandpass', volume = 0.3, delay = 0) {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(t);
    src.stop(t + Math.min(0.49, duration + 0.01));
  }

  playShotgun(distanceAtten = 1) {
    const v = Math.max(0.08, Math.min(1, distanceAtten));
    this.playTone(150, 38, 0.22, 'triangle', 0.5 * v);
    this.playNoise(0.24, 950, 'lowpass', 0.55 * v);
    // Crisp pump click right after
    if (v > 0.5) {
      this.playTone(540, 320, 0.045, 'square', 0.09, 0.24);
      this.playTone(680, 460, 0.04, 'square', 0.08, 0.31);
    }
  }

  playAR(distanceAtten = 1) {
    const v = Math.max(0.06, Math.min(1, distanceAtten));
    this.playTone(230, 75, 0.085, 'sawtooth', 0.24 * v);
    this.playNoise(0.09, 1900, 'bandpass', 0.32 * v);
  }

  playPickaxeSwing() {
    this.playNoise(0.11, 650, 'bandpass', 0.16);
    this.playTone(280, 140, 0.09, 'sine', 0.12);
  }

  playPickaxeHit() {
    this.playTone(460, 180, 0.09, 'square', 0.18);
    this.playNoise(0.08, 2200, 'highpass', 0.18);
  }

  playBuildPlace(mat = 'wood') {
    if (mat === 'metal') {
      this.playTone(620, 340, 0.08, 'triangle', 0.22);
      this.playTone(940, 820, 0.06, 'sine', 0.12);
    } else if (mat === 'brick') {
      this.playTone(260, 120, 0.09, 'triangle', 0.26);
      this.playNoise(0.06, 900, 'lowpass', 0.16);
    } else {
      this.playTone(340, 170, 0.075, 'triangle', 0.24);
      this.playNoise(0.05, 1300, 'bandpass', 0.14);
    }
  }

  playBuildBreak() {
    this.playTone(170, 52, 0.19, 'sawtooth', 0.24);
    this.playNoise(0.22, 820, 'lowpass', 0.28);
  }

  playEditOpen() {
    this.playTone(540, 760, 0.06, 'sine', 0.15);
  }

  playEditConfirm() {
    this.playTone(620, 920, 0.07, 'triangle', 0.18);
  }

  playEditReset() {
    this.playTone(720, 420, 0.08, 'triangle', 0.18);
  }

  playHitmarker(isHeadshot = false) {
    if (isHeadshot) {
      this.playTone(1350, 1850, 0.075, 'triangle', 0.34);
      this.playTone(2100, 1500, 0.07, 'sine', 0.22, 0.03);
    } else {
      this.playTone(920, 1220, 0.055, 'triangle', 0.24);
    }
  }

  playTakeDamage() {
    this.playTone(140, 65, 0.14, 'sawtooth', 0.22);
  }

  playEliminate() {
    this.playTone(523.25, 523.25, 0.09, 'triangle', 0.22, 0);
    this.playTone(659.25, 659.25, 0.09, 'triangle', 0.22, 0.07);
    this.playTone(783.99, 1046.5, 0.22, 'triangle', 0.26, 0.14);
  }

  playArenaReset() {
    this.playTone(320, 960, 0.24, 'sine', 0.24);
    this.playTone(640, 1280, 0.22, 'triangle', 0.15, 0.06);
  }

  playCountdownTick(isGo = false) {
    if (isGo) {
      this.playTone(660, 990, 0.22, 'triangle', 0.28);
      this.playTone(990, 1320, 0.24, 'sine', 0.22, 0.04);
    } else {
      this.playTone(440, 420, 0.1, 'triangle', 0.2);
    }
  }

  playBoostPad() {
    this.playTone(220, 780, 0.26, 'sine', 0.24);
    this.playNoise(0.28, 1200, 'bandpass', 0.22);
  }

  playLootPickup() {
    this.playTone(587.33, 880, 0.09, 'sine', 0.22, 0);
    this.playTone(880, 1174.66, 0.12, 'triangle', 0.2, 0.05);
  }

  playVictoryRoyale() {
    this.playTone(523.25, 523.25, 0.14, 'triangle', 0.26, 0);
    this.playTone(659.25, 659.25, 0.14, 'triangle', 0.26, 0.1);
    this.playTone(783.99, 783.99, 0.14, 'triangle', 0.28, 0.2);
    this.playTone(1046.5, 1046.5, 0.45, 'triangle', 0.32, 0.3);
  }

  playUiClick() {
    this.playTone(680, 520, 0.04, 'sine', 0.11);
  }
}

export const audio = new ProceduralAudio();
