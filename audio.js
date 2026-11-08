/* Self-hosted Web Audio SFX + BGM — no external music files */
(function (global) {
  const AudioCtl = {
    ctx: null,
    muted: false,
    unlocked: false,
    welcomePlayed: false,
    bgmOn: false,
    bgmTimer: null,
    bgmBeat: 0,
    master: null,
    sfxGain: null,
    bgmGain: null,
    _wantBgm: false,

    async ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        this.master.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.45;
        this.sfxGain.connect(this.master);
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.value = 0.32; // louder, more driving mix
        this.bgmGain.connect(this.master);
      }
      if (this.ctx.state === "suspended") {
        try { await this.ctx.resume(); } catch (_) {}
      }
      this.unlocked = this.ctx.state === "running";
      return this.unlocked;
    },

    setMuted(m) {
      this.muted = !!m;
      try { localStorage.setItem("p2quiz-muted", this.muted ? "1" : "0"); } catch (_) {}
      if (this.master) {
        this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
      }
      if (this.muted) this.stopBgm(true);
      else if (this._wantBgm) this.startBgm();
      this.syncMuteBtn();
    },

    toggleMute() {
      this.setMuted(!this.muted);
    },

    syncMuteBtn() {
      const b = document.getElementById("muteBtn");
      if (!b) return;
      b.textContent = this.muted ? "🔇" : "🔊";
      b.setAttribute("aria-label", this.muted ? "開啟聲音" : "靜音");
      b.title = this.muted ? "開啟聲音" : "靜音";
    },

    tone(freq, t0, dur, type, gainNode, vol, glide) {
      if (!this.ctx || this.muted) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || "sine";
      if (glide && glide > 0) {
        o.frequency.setValueAtTime(freq * 0.92, t0);
        o.frequency.exponentialRampToValueAtTime(freq, t0 + Math.min(0.05, dur * 0.3));
      } else {
        o.frequency.setValueAtTime(freq, t0);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol || 0.2), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(gainNode || this.sfxGain);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    },

    /** Noise burst for drums / clap */
    noiseHit(t0, dur, vol, hpHz) {
      if (!this.ctx || this.muted) return;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filt = this.ctx.createBiquadFilter();
      filt.type = "highpass";
      filt.frequency.value = hpHz || 800;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol || 0.2, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filt);
      filt.connect(g);
      g.connect(this.bgmGain);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    },

    kick(t0) {
      if (!this.ctx || this.muted) return;
      // punchy falling sine
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(160, t0);
      o.frequency.exponentialRampToValueAtTime(48, t0 + 0.14);
      g.gain.setValueAtTime(0.55, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(g);
      g.connect(this.bgmGain);
      o.start(t0);
      o.stop(t0 + 0.25);
      this.noiseHit(t0, 0.04, 0.12, 200);
    },

    snare(t0) {
      this.noiseHit(t0, 0.1, 0.28, 1200);
      this.tone(220, t0, 0.06, "triangle", this.bgmGain, 0.08);
    },

    hat(t0, open) {
      this.noiseHit(t0, open ? 0.08 : 0.03, open ? 0.12 : 0.08, open ? 6000 : 8000);
    },

    /** Short welcoming chime (unchanged vibe) */
    playWelcome() {
      if (this.welcomePlayed || this.muted || !this.ctx) return;
      this.welcomePlayed = true;
      const t = this.ctx.currentTime + 0.05;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((f, i) => {
        this.tone(f, t + i * 0.12, 0.35, "triangle", this.sfxGain, 0.28);
        this.tone(f * 2, t + i * 0.12, 0.25, "sine", this.sfxGain, 0.08);
      });
      this.tone(1318.5, t + 0.55, 0.4, "sine", this.sfxGain, 0.15);
    },

    /**
     * High-energy triumphant loop for Primary kids
     * ~145 BPM, strong kick/snare, bright lead, rising chords
     */
    startBgm() {
      this._wantBgm = true;
      if (this.muted || !this.ctx || this.bgmOn) return;
      this.bgmOn = true;
      this.bgmBeat = 0;

      const bpm = 145;
      const step = 60 / bpm / 2; // 8th notes

      // Bright triumphant lead (C major / rising fanfare feel)
      // Two 16-step phrases × 2 = 64 eighths before loop
      const lead = [
        // phrase A — charge forward
        523.25, 523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 523.25,
        587.33, 659.25, 783.99, 880.00, 1046.5, 1174.7, 1046.5, 783.99,
        // phrase B — climb higher
        659.25, 783.99, 880.00, 1046.5, 1174.7, 1318.5, 1174.7, 1046.5,
        783.99, 880.00, 1046.5, 1174.7, 1318.5, 1568.0, 1318.5, 1046.5,
        // phrase C — heroic call-response
        1046.5, 0, 1046.5, 1174.7, 1318.5, 0, 1174.7, 1046.5,
        783.99, 880.00, 1046.5, 0, 1318.5, 1174.7, 1046.5, 783.99,
        // phrase D — big finish then reset
        659.25, 783.99, 1046.5, 1318.5, 1568.0, 1318.5, 1046.5, 783.99,
        1046.5, 1174.7, 1318.5, 1568.0, 2093.0, 1568.0, 1318.5, 0
      ];

      // Power chords roots (C–G–Am–F style energy, then rising)
      const bass = [
        130.81, 0, 130.81, 0, 196.00, 0, 196.00, 0,
        220.00, 0, 220.00, 0, 174.61, 0, 174.61, 0,
        130.81, 0, 130.81, 0, 196.00, 0, 196.00, 0,
        146.83, 0, 174.61, 0, 196.00, 0, 261.63, 0,
        130.81, 0, 130.81, 0, 196.00, 0, 196.00, 0,
        220.00, 0, 220.00, 0, 174.61, 0, 196.00, 0,
        130.81, 0, 164.81, 0, 196.00, 0, 246.94, 0,
        261.63, 0, 196.00, 0, 130.81, 0, 261.63, 0
      ];

      // Chord stabs (thirds above bass when present)
      const chord = [
        329.63, 0, 0, 0, 493.88, 0, 0, 0,
        523.25, 0, 0, 0, 440.00, 0, 0, 0,
        329.63, 0, 0, 0, 493.88, 0, 0, 0,
        369.99, 0, 440.00, 0, 493.88, 0, 659.25, 0,
        329.63, 0, 0, 0, 493.88, 0, 0, 0,
        523.25, 0, 0, 0, 440.00, 0, 493.88, 0,
        329.63, 0, 415.30, 0, 493.88, 0, 622.25, 0,
        659.25, 0, 493.88, 0, 329.63, 0, 659.25, 0
      ];

      const tick = () => {
        if (!this.bgmOn || this.muted || !this.ctx) return;
        const t = this.ctx.currentTime + 0.02;
        const mi = this.bgmBeat % lead.length;
        const eighth = this.bgmBeat % 2; // 0 = on-beat 8th within pair
        const beatInBar = this.bgmBeat % 8; // 8 eighths = 1 bar of 4/4

        // Drums: kick on 1 & 3, snare on 2 & 4, busy hats
        if (beatInBar === 0 || beatInBar === 4) this.kick(t);
        if (beatInBar === 2 || beatInBar === 6) this.snare(t);
        // extra kick pickup for drive
        if (beatInBar === 3 || beatInBar === 7) this.kick(t + step * 0.5 * 0); // sync with step
        if (beatInBar === 7) this.kick(t); // double feel into next bar
        this.hat(t, beatInBar === 2 || beatInBar === 6);
        if (eighth === 1) this.hat(t, false);

        const lf = lead[mi];
        if (lf) {
          // bright square lead + octave sparkle
          this.tone(lf, t, step * 1.35, "square", this.bgmGain, 0.14, 1);
          this.tone(lf * 2, t, step * 0.9, "triangle", this.bgmGain, 0.06);
          // slight fifth harmony on big notes
          if (lf >= 1046.5) this.tone(lf * 1.5, t, step * 0.8, "sawtooth", this.bgmGain, 0.035);
        }

        const bf = bass[mi];
        if (bf) {
          this.tone(bf, t, step * 1.7, "triangle", this.bgmGain, 0.2);
          this.tone(bf * 2, t, step * 1.2, "sine", this.bgmGain, 0.08);
        }

        const cf = chord[mi];
        if (cf) {
          this.tone(cf, t, step * 1.5, "sawtooth", this.bgmGain, 0.07);
          this.tone(cf * 1.25, t, step * 1.3, "triangle", this.bgmGain, 0.05);
        }

        // Rising whoosh every 8 bars (every 64 eighths)
        if (mi === 0 && this.bgmBeat > 0) {
          this.tone(200, t, step * 4, "sawtooth", this.bgmGain, 0.06, 1);
          this.tone(400, t + step, step * 3, "sawtooth", this.bgmGain, 0.05, 1);
          this.tone(800, t + step * 2, step * 2, "square", this.bgmGain, 0.04, 1);
        }

        this.bgmBeat++;
        this.bgmTimer = setTimeout(tick, step * 1000);
      };
      tick();
    },

    stopBgm(keepWant) {
      if (!keepWant) this._wantBgm = false;
      this.bgmOn = false;
      if (this.bgmTimer) {
        clearTimeout(this.bgmTimer);
        this.bgmTimer = null;
      }
    },

    async unlockAndWelcome() {
      const ok = await this.ensure();
      if (!ok) return;
      if (!this.muted) this.playWelcome();
    },

    async onQuizStart() {
      await this.ensure();
      if (!this.welcomePlayed && !this.muted) this.playWelcome();
      this.startBgm();
    },

    onQuizEnd() {
      this.stopBgm(false);
    }
  };

  try {
    AudioCtl.muted = localStorage.getItem("p2quiz-muted") === "1";
  } catch (_) {}

  global.AudioCtl = AudioCtl;
})(window);
