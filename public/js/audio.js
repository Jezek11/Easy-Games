import { storage } from './storage.js';

class ProceduralAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.emoteGain = null;
    this._emoteInterval = null;
    this._activeEmoteId = null;
    this._emoteStep = 0;
    this._emoteNextTime = 0;
    this.noiseBuffer = null;
    this.muted = Boolean(storage.get().muted);
    storage.subscribe((s) => {
      this.muted = Boolean(s.muted);
      if (this.muted) {
        this.stopEmoteMusic(true);
      }
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

  playSMG(distanceAtten = 1) {
    const v = Math.max(0.06, Math.min(1, distanceAtten));
    this.playTone(320, 120, 0.055, 'square', 0.17 * v);
    this.playNoise(0.06, 2600, 'bandpass', 0.24 * v);
  }

  playSniper(distanceAtten = 1) {
    const v = Math.max(0.1, Math.min(1, distanceAtten));
    this.playTone(135, 32, 0.30, 'sawtooth', 0.52 * v);
    this.playNoise(0.32, 1300, 'lowpass', 0.56 * v);
    if (v > 0.5) {
      this.playTone(760, 520, 0.045, 'triangle', 0.09, 0.40);
      this.playTone(920, 680, 0.04, 'triangle', 0.08, 0.52);
    }
  }

  playWeaponPickup() {
    this.playTone(480, 720, 0.07, 'triangle', 0.20);
    this.playTone(720, 960, 0.08, 'sine', 0.16, 0.055);
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

  _playEmoteNote(freq, dur, type, vol, time, dest, cutoffHz = 3400, slideTo = null) {
    if (!this.ctx || !dest || !freq) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (slideTo && slideTo !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(25, slideTo), time + dur);
    }

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz, time);
    filter.Q.setValueAtTime(1.4, time);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + dur + 0.015);
  }

  _playEmoteDrum(kind, time, vol, dest) {
    if (!this.ctx || !dest) return;
    const ctx = this.ctx;
    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(145, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.13);
      gain.gain.setValueAtTime(vol, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(time);
      osc.stop(time + 0.15);
    } else if (kind === 'snare' || kind === 'clap') {
      if (this.noiseBuffer) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(kind === 'clap' ? 2100 : 1650, time);
        filter.Q.setValueAtTime(1.2, time);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol * 0.85, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + (kind === 'clap' ? 0.12 : 0.10));
        src.connect(filter);
        filter.connect(gain);
        gain.connect(dest);
        src.start(time);
        src.stop(time + 0.14);
      }
      if (kind === 'snare') {
        this._playEmoteNote(210, 0.06, 'triangle', vol * 0.45, time, dest, 1800, 110);
      }
    } else if (kind === 'hat' && this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(6200, time);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol * 0.5, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      src.start(time);
      src.stop(time + 0.055);
    }
  }

  _scheduleEmoteStep(emoteId, step, time, dest) {
    const s = step % 16;

    if (emoteId === 'take_l') {
      // Bouncy carnival polka-brass taunt rhythm (um-pah bass + brassy lead + crisp snare)
      const bass = [130.81, 0, 196.0, 0, 146.83, 0, 196.0, 0, 130.81, 0, 196.0, 0, 164.81, 0, 146.83, 0]; // C3-G3 / D3-G3 um-pah
      const lead = [523.25, 659.25, 783.99, 659.25, 698.46, 659.25, 587.33, 0, 523.25, 587.33, 659.25, 783.99, 880.0, 783.99, 659.25, 587.33];
      const chord = [0, 329.63, 0, 392.0, 0, 349.23, 0, 392.0, 0, 329.63, 0, 392.0, 0, 392.0, 0, 349.23];

      if (s % 4 === 0) this._playEmoteDrum('kick', time, 0.42, dest);
      if (s % 4 === 2) this._playEmoteDrum('snare', time, 0.28, dest);
      if (s % 2 === 1) this._playEmoteDrum('hat', time, 0.14, dest);

      if (bass[s]) this._playEmoteNote(bass[s], 0.16, 'triangle', 0.34, time, dest, 950);
      if (chord[s]) this._playEmoteNote(chord[s], 0.11, 'sawtooth', 0.12, time, dest, 1800);
      if (lead[s]) this._playEmoteNote(lead[s], s % 2 === 0 ? 0.17 : 0.14, 'sawtooth', 0.22, time, dest, 2700);
    } else if (emoteId === 'floss') {
      // Upbeat backpack-kid electro-pop dance groove (4-on-the-floor kick + clap + plucky EDM synth)
      const bass = [110.0, 0, 110.0, 220.0, 98.0, 0, 98.0, 196.0, 87.31, 0, 87.31, 174.61, 98.0, 110.0, 130.81, 0]; // A2 - G2 - F2 - G2 groove
      const lead = [440.0, 0, 523.25, 659.25, 587.33, 523.25, 440.0, 0, 349.23, 440.0, 523.25, 587.33, 659.25, 587.33, 523.25, 493.88];

      if (s % 4 === 0) this._playEmoteDrum('kick', time, 0.50, dest);
      if (s % 8 === 4) this._playEmoteDrum('clap', time, 0.34, dest);
      this._playEmoteDrum('hat', time, s % 2 === 1 ? 0.19 : 0.08, dest);

      if (bass[s]) this._playEmoteNote(bass[s], 0.18, 'sawtooth', 0.28, time, dest, 900);
      if (lead[s]) this._playEmoteNote(lead[s], 0.16, 'square', 0.16, time, dest, 2400);
    } else {
      // 'gg' — Uplifting Major-9th victory synth bells & warm groove
      const bass = [130.81, 0, 0, 130.81, 164.81, 0, 0, 164.81, 174.61, 0, 0, 174.61, 196.0, 0, 196.0, 0];
      const bells = [523.25, 659.25, 783.99, 987.77, 1046.5, 987.77, 783.99, 659.25, 698.46, 880.0, 1046.5, 1174.66, 987.77, 880.0, 783.99, 659.25];

      if (s % 4 === 0) this._playEmoteDrum('kick', time, 0.38, dest);
      if (s === 4 || s === 12) this._playEmoteDrum('clap', time, 0.24, dest);
      if (s % 2 === 1) this._playEmoteDrum('hat', time, 0.12, dest);

      if (bass[s]) this._playEmoteNote(bass[s], 0.22, 'triangle', 0.28, time, dest, 950);
      if (bells[s]) {
        this._playEmoteNote(bells[s], 0.22, 'triangle', 0.20, time, dest, 4200);
        this._playEmoteNote(bells[s] * 1.5, 0.15, 'sine', 0.08, time, dest, 5200);
      }
    }
  }

  stopEmoteMusic(immediate = false) {
    if (this._emoteInterval) {
      clearInterval(this._emoteInterval);
      this._emoteInterval = null;
    }
    this._activeEmoteId = null;
    if (this.emoteGain && this.ctx) {
      const oldGain = this.emoteGain;
      this.emoteGain = null;
      const now = this.ctx.currentTime;
      try {
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(oldGain.gain.value, now);
        oldGain.gain.exponentialRampToValueAtTime(0.0001, now + (immediate ? 0.015 : 0.04));
        setTimeout(() => {
          try { oldGain.disconnect(); } catch {}
        }, 70);
      } catch {
        try { oldGain.disconnect(); } catch {}
      }
    }
  }

  playEmoteStart(emoteId = 'take_l', volumeScale = 1.0) {
    this.stopEmoteMusic(true);
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(Math.max(0.08, Math.min(1.0, volumeScale)), ctx.currentTime);
    bus.connect(this.masterGain);
    this.emoteGain = bus;

    this._activeEmoteId = emoteId;
    this._emoteStep = 0;
    this._emoteNextTime = ctx.currentTime + 0.02;

    const stepDur = emoteId === 'take_l' ? 0.215 : (emoteId === 'floss' ? 0.235 : 0.255);
    const pumpSchedule = () => {
      if (this.muted || !this.ctx || !this.emoteGain || this._activeEmoteId !== emoteId) return;
      const horizon = this.ctx.currentTime + 0.20;
      while (this._emoteNextTime < horizon) {
        this._scheduleEmoteStep(emoteId, this._emoteStep, this._emoteNextTime, this.emoteGain);
        this._emoteStep += 1;
        this._emoteNextTime += stepDur;
      }
    };

    pumpSchedule();
    this._emoteInterval = setInterval(pumpSchedule, 65);
  }

  playReloadStart(weaponId = 'ar') {
    if (weaponId === 'shotgun') {
      this.playTone(310, 210, 0.055, 'triangle', 0.14, 0);
      this.playTone(460, 320, 0.045, 'square', 0.08, 0.16);
    } else if (weaponId === 'sniper') {
      this.playTone(620, 420, 0.05, 'triangle', 0.11, 0);
      this.playTone(490, 740, 0.055, 'triangle', 0.11, 0.14);
    } else {
      this.playTone(440, 260, 0.05, 'triangle', 0.13, 0);
      this.playNoise(0.045, 1800, 'bandpass', 0.1, 0.02);
    }
  }

  playReloadDone(weaponId = 'ar') {
    if (weaponId === 'shotgun') {
      this.playTone(540, 760, 0.045, 'triangle', 0.13, 0);
      this.playTone(720, 980, 0.04, 'square', 0.07, 0.06);
    } else if (weaponId === 'sniper') {
      this.playTone(760, 1080, 0.045, 'triangle', 0.13, 0);
      this.playNoise(0.035, 2400, 'bandpass', 0.09, 0.03);
    } else {
      this.playTone(620, 920, 0.04, 'triangle', 0.12, 0);
      this.playNoise(0.03, 2600, 'bandpass', 0.08, 0.025);
    }
  }

  playScopeToggle(level = 1) {
    if (level === 2) {
      this.playTone(860, 1140, 0.04, 'sine', 0.11);
    } else if (level === 1) {
      this.playTone(640, 820, 0.04, 'sine', 0.1);
    } else {
      this.playTone(480, 300, 0.035, 'sine', 0.08);
    }
  }
}

export const audio = new ProceduralAudio();
