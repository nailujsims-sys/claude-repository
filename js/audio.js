// ============================================================================
// Fruit Hockey — Procedural audio (Web Audio API)
// ----------------------------------------------------------------------------
// No audio files: every sound is synthesised on the fly. Also exposes a small
// vibrate() helper that respects the player's haptics setting.
// ============================================================================
import { store } from './storage.js';

class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this._musicTimer = null;
    this._musicStep = 0;
    this._unlocked = false;
  }

  // Must be called from within a user gesture the first time.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this._unlocked = true;
  }

  get sfxOn() { return !!store.state.settings.sfx; }
  get musicOn() { return !!store.state.settings.music; }

  // --- Low level helpers ----------------------------------------------------
  _tone(freq, dur, { type = 'sine', vol = 0.3, when = 0, glideTo = null, attack = 0.005, dest = null } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(dest || this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise(dur, { vol = 0.3, when = 0, filter = 1200, type = 'lowpass' } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filter;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // --- Public sound effects -------------------------------------------------
  sfx(name, opts = {}) {
    if (!this.sfxOn || !this._unlocked) return;
    this.ensure();
    switch (name) {
      case 'click':
        this._tone(520, 0.06, { type: 'square', vol: 0.12 });
        this._tone(780, 0.05, { type: 'square', vol: 0.08, when: 0.01 });
        break;
      case 'back':
        this._tone(420, 0.07, { type: 'square', vol: 0.1, glideTo: 300 });
        break;
      case 'hitWall': {
        const s = Math.min(1, (opts.speed || 0.5));
        this._tone(180 + 120 * s, 0.05, { type: 'triangle', vol: 0.08 + 0.12 * s });
        this._noise(0.04, { vol: 0.05 + 0.08 * s, filter: 900 });
        break;
      }
      case 'hitMallet': {
        const s = Math.min(1, (opts.speed || 0.5));
        this._tone(240 + 160 * s, 0.07, { type: 'triangle', vol: 0.12 + 0.14 * s });
        this._noise(0.05, { vol: 0.06 + 0.1 * s, filter: 1600 });
        break;
      }
      case 'smash':
        this._tone(120, 0.16, { type: 'sawtooth', vol: 0.22, glideTo: 60 });
        this._noise(0.12, { vol: 0.18, filter: 2200 });
        break;
      case 'goal': {
        // juicy splat + happy arpeggio
        this._noise(0.18, { vol: 0.22, filter: 1800 });
        const notes = [523, 659, 784, 1046];
        notes.forEach((f, i) => this._tone(f, 0.18, { type: 'triangle', vol: 0.18, when: i * 0.06 }));
        break;
      }
      case 'win': {
        const notes = [523, 659, 784, 1046, 1318];
        notes.forEach((f, i) => this._tone(f, 0.3, { type: 'triangle', vol: 0.2, when: i * 0.11 }));
        this._noise(0.4, { vol: 0.08, filter: 5000, type: 'highpass' });
        break;
      }
      case 'lose': {
        const notes = [440, 392, 330, 262];
        notes.forEach((f, i) => this._tone(f, 0.32, { type: 'sawtooth', vol: 0.14, when: i * 0.13 }));
        break;
      }
      case 'coin':
        this._tone(988, 0.07, { type: 'square', vol: 0.14 });
        this._tone(1319, 0.12, { type: 'square', vol: 0.14, when: 0.06 });
        break;
      case 'rankUp': {
        const notes = [659, 880, 1175, 1568];
        notes.forEach((f, i) => this._tone(f, 0.25, { type: 'triangle', vol: 0.16, when: i * 0.09 }));
        break;
      }
      case 'count':
        this._tone(660, 0.1, { type: 'sine', vol: 0.16 });
        break;
      case 'serve':
        this._tone(880, 0.18, { type: 'sine', vol: 0.18, glideTo: 1320 });
        break;
      case 'error':
        this._tone(160, 0.18, { type: 'sawtooth', vol: 0.14, glideTo: 110 });
        break;
      case 'match':
        this._tone(440, 0.12, { type: 'sine', vol: 0.14, glideTo: 660 });
        this._tone(660, 0.18, { type: 'sine', vol: 0.14, when: 0.1, glideTo: 880 });
        break;
    }
  }

  // --- Background music (gentle looping arpeggio) ---------------------------
  startMusic() {
    if (!this.musicOn) return;
    this.ensure();
    if (!this.ctx || this._musicTimer) return;
    const scale = [261.6, 329.6, 392.0, 523.3, 392.0, 329.6]; // C major-ish
    const bass = [130.8, 130.8, 174.6, 196.0];
    this._musicStep = 0;
    const musicGain = this.ctx.createGain();
    musicGain.gain.value = 0.5;
    musicGain.connect(this.master);
    this._musicTimer = setInterval(() => {
      if (!this.musicOn) { this.stopMusic(); return; }
      const i = this._musicStep++;
      this._tone(scale[i % scale.length], 0.45, { type: 'triangle', vol: 0.05, dest: musicGain });
      if (i % 2 === 0) this._tone(bass[(i / 2) % bass.length], 0.6, { type: 'sine', vol: 0.05, dest: musicGain });
    }, 260);
  }

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  }

  toggleMusic(on) { if (on) this.startMusic(); else this.stopMusic(); }

  // --- Haptics --------------------------------------------------------------
  vibrate(pattern) {
    if (!store.state.settings.haptics) return;
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
  }
}

export const audio = new AudioManager();
