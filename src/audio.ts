// 音效全部用 Web Audio 即時合成，沒有音檔

export class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engGain!: GainNode;
  private o1!: OscillatorNode;
  private o2!: OscillatorNode;
  private filter!: BiquadFilterNode;
  private noise!: AudioBuffer;

  /** 一定要在點擊事件裡呼叫（iOS 規定） */
  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 4;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.filter.connect(this.engGain).connect(this.master);
    this.o1 = ctx.createOscillator();
    this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator();
    this.o2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.o1.connect(this.filter);
    this.o2.connect(g2).connect(this.filter);
    this.o1.start();
    this.o2.start();
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  }

  suspend() { void this.ctx?.suspend(); }

  /** rpm 0..1，load 0..1（踩油門的程度） */
  engine(rpm: number, load: number, running: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 95 + rpm * 330;
    this.o1.frequency.setTargetAtTime(f, t, 0.025);
    this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.025);
    this.filter.frequency.setTargetAtTime(500 + rpm * 2600 * (0.5 + load * 0.5), t, 0.05);
    this.engGain.gain.setTargetAtTime(this.enabled && running ? 0.05 + 0.08 * load : 0, t, 0.08);
  }

  hit(power: number) {
    if (!this.ctx || !this.enabled || power < 2) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const g = this.ctx.createGain();
    g.gain.value = Math.min(1, power / 40);
    src.connect(g).connect(this.master);
    src.start();
  }

  beep(freq: number, dur = 0.18) {
    if (!this.ctx || !this.enabled) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }
}
