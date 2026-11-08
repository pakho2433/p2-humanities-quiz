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
        this.bgmGain.gain.value = 0.18;
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

    tone(freq, t0, dur, type, gainNode, vol) {
      if (!this.ctx || this.muted) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(gainNode || this.sfxGain);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    },

    /** Short welcoming chime */
    playWelcome() {
      if (this.welcomePlayed || this.muted || !this.ctx) return;
      this.welcomePlayed = true;
      const t = this.ctx.currentTime + 0.05;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((f, i) => {
        this.tone(f, t + i * 0.12, 0.35, "triangle", this.sfxGain, 0.28);
        this.tone(f * 2, t + i * 0.12, 0.25, "sine", this.sfxGain, 0.08);
      });
      // sparkle
      this.tone(1318.5, t + 0.55, 0.4, "sine", this.sfxGain, 0.15);
    },

    /** Upbeat looping BGM via sequenced tones */
    startBgm() {
      this._wantBgm = true;
      if (this.muted || !this.ctx || this.bgmOn) return;
      this.bgmOn = true;
      this.bgmBeat = 0;
      const bpm = 128;
      const step = 60 / bpm / 2; // 8th notes
      // C major energetic riff (relative MIDI-ish freqs)
      const melody = [
        523.25, 0, 659.25, 0, 783.99, 659.25, 587.33, 523.25,
        659.25, 0, 783.99, 0, 987.77, 783.99, 659.25, 587.33,
        523.25, 587.33, 659.25, 783.99, 880, 783.99, 659.25, 523.25,
        392, 523.25, 659.25, 783.99, 659.25, 523.25, 392, 0
      ];
      const bass = [
        130.81, 0, 0, 0, 196, 0, 0, 0,
        146.83, 0, 0, 0, 220, 0, 0, 0,
        164.81, 0, 0, 0, 196, 0, 0, 0,
        130.81, 0, 174.61, 0, 196, 0, 261.63, 0
      ];

      const tick = () => {
        if (!this.bgmOn || this.muted || !this.ctx) return;
        const t = this.ctx.currentTime + 0.03;
        const mi = this.bgmBeat % melody.length;
        const mf = melody[mi];
        const bf = bass[mi];
        if (mf) {
          this.tone(mf, t, step * 1.6, "square", this.bgmGain, 0.09);
          this.tone(mf * 1.5, t, step * 1.2, "triangle", this.bgmGain, 0.04);
        }
        if (bf) {
          this.tone(bf, t, step * 1.8, "triangle", this.bgmGain, 0.12);
        }
        // light percussion click every beat
        if (this.bgmBeat % 2 === 0) {
          this.tone(180, t, 0.04, "square", this.bgmGain, 0.05);
        }
        if (this.bgmBeat % 8 === 0) {
          this.tone(90, t, 0.08, "sine", this.bgmGain, 0.1);
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
