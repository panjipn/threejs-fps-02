// Every sound the game makes is synthesised in WebAudio: no audio files, no network.
// The context is created lazily on the first user gesture; in a headless capture there is
// no context and every method is a silent no-op.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  let unlocked = false;

  function ensure() {
    // No sound until a user gesture unlocks it (the Play click): creating an
    // AudioContext earlier only logs warnings and stays suspended.
    if (!unlocked) return false;
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch (err) {
      ctx = null;
      return false;
    }
    return true;
  }

  function noise(dur, filterFreq, gain, type = 'lowpass') {
    if (!ensure() || muted) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = 0) {
    if (!ensure() || muted) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g);
    g.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  return {
    unlock() {
      unlocked = true;
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    shot(kind) {
      // kind: 'rifle' | 'smg' | 'pistol' | 'dmr' | 'shotgun'
      if (kind === 'shotgun') { noise(0.22, 900, 0.9); tone(140, 0.16, 0.5, 'sawtooth', 60); }
      else if (kind === 'dmr') { noise(0.3, 1400, 0.8); tone(220, 0.2, 0.4, 'square', 70); }
      else if (kind === 'smg') { noise(0.09, 2200, 0.55); tone(320, 0.07, 0.25, 'square', 120); }
      else if (kind === 'pistol') { noise(0.12, 1800, 0.6); tone(260, 0.1, 0.3, 'square', 90); }
      else { noise(0.14, 1600, 0.7); tone(200, 0.12, 0.35, 'sawtooth', 80); }
    },
    dryFire() { tone(900, 0.04, 0.2, 'square'); },
    reload() { tone(500, 0.05, 0.25, 'square'); setTimeout(() => tone(700, 0.05, 0.25, 'square'), 350); },
    hit(kill) {
      tone(kill ? 1320 : 990, 0.07, 0.3, 'sine');
      if (kill) setTimeout(() => tone(1760, 0.12, 0.3, 'sine'), 70);
    },
    hurt() { noise(0.18, 500, 0.5); tone(110, 0.18, 0.4, 'sawtooth', 55); },
    footstep() { noise(0.06, 400, 0.12); },
    plantBeep(final) { tone(final ? 1760 : 880, final ? 0.3 : 0.09, 0.35, 'sine'); },
    defuseBeep() { tone(660, 0.08, 0.3, 'sine'); },
    explosion() {
      noise(1.4, 300, 1.0);
      tone(70, 1.1, 0.8, 'sine', 30);
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.3, 'triangle'), i * 120));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.25, 0.3, 'triangle'), i * 130));
    },
    buy() { tone(880, 0.08, 0.3, 'sine'); setTimeout(() => tone(1174, 0.12, 0.3, 'sine'), 80); },
    denied() { tone(220, 0.12, 0.3, 'square'); },
    click() { tone(1200, 0.03, 0.2, 'sine'); },
    grenadePin() { tone(1500, 0.04, 0.25, 'square'); },
  };
}
