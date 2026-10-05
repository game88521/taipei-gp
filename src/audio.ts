// 音效全部用 Web Audio 即時合成，沒有音檔

/**
 * 引擎聲的個性：base/range 轉速對應的基頻（Hz）、兩個振盪器的波形與第二個的頻率倍數／音量、
 * 濾波器（越亮越尖）、lope = 低頻調幅相對基頻的倍數與深度（V8 的「轟轟轟」、柴油的喀啦聲）
 */
export interface EngineProfile { base: number; range: number; w1: OscillatorType; w2: OscillatorType; ratio2: number; mix2: number; fBase: number; fRange: number; gain: number; lope: number; lopeDepth: number }
export const ENGINES: Record<string, EngineProfile> = {
  sedan: { base: 85, range: 300, w1: 'sawtooth', w2: 'square', ratio2: 0.5, mix2: 0.35, fBase: 500, fRange: 2600, gain: 1, lope: 0, lopeDepth: 0 },
  muscle: { base: 46, range: 210, w1: 'sawtooth', w2: 'square', ratio2: 0.5, mix2: 0.7, fBase: 360, fRange: 1700, gain: 1.45, lope: 0.5, lopeDepth: 0.6 }, // V8：低沉、不規則的轟轟聲
  f1: { base: 190, range: 1050, w1: 'sawtooth', w2: 'sawtooth', ratio2: 2, mix2: 0.25, fBase: 1400, fRange: 6500, gain: 0.85, lope: 0, lopeDepth: 0 }, // 高轉尖嘯
  super: { base: 118, range: 700, w1: 'sawtooth', w2: 'triangle', ratio2: 1.5, mix2: 0.45, fBase: 900, fRange: 4300, gain: 1.1, lope: 0, lopeDepth: 0 }, // V12：圓滑的高音
  police: { base: 78, range: 330, w1: 'sawtooth', w2: 'square', ratio2: 0.5, mix2: 0.45, fBase: 450, fRange: 2400, gain: 1.15, lope: 0.5, lopeDepth: 0.2 },
  pickup: { base: 40, range: 150, w1: 'square', w2: 'sawtooth', ratio2: 0.5, mix2: 0.5, fBase: 280, fRange: 1050, gain: 1.05, lope: 0.75, lopeDepth: 0.4 }, // 柴油：低、喀啦喀啦
};
ENGINES.taxi = ENGINES.sedan;

export class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engGain!: GainNode;
  private o1!: OscillatorNode;
  private o2!: OscillatorNode;
  private filter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private g2!: GainNode;
  private am!: GainNode;
  private lfo!: OscillatorNode;
  private lfoGain!: GainNode;
  private siren!: OscillatorNode;
  private sirenGain!: GainNode;
  private prof: EngineProfile = ENGINES.sedan;
  private profKey = 'sedan';

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
    // 濾波器 → 調幅（am，被 lfo 調變）→ 音量
    this.am = ctx.createGain();
    this.lfo = ctx.createOscillator();
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0;
    this.lfo.connect(this.lfoGain).connect(this.am.gain);
    this.lfo.start();
    this.filter.connect(this.am).connect(this.engGain).connect(this.master);
    this.o1 = ctx.createOscillator();
    this.o2 = ctx.createOscillator();
    this.g2 = ctx.createGain();
    this.o1.connect(this.filter);
    this.o2.connect(this.g2).connect(this.filter);
    this.o1.start();
    this.o2.start();
    // 警笛（平常音量 0）
    this.siren = ctx.createOscillator();
    this.siren.type = 'triangle';
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.siren.connect(this.sirenGain).connect(this.master);
    this.siren.start();
    this.applyProfile();
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  }

  suspend() { void this.ctx?.suspend(); }

  /** 換引擎聲（車種 id，或 'f1'） */
  setEngine(key: string) {
    if (key === this.profKey) return;
    this.profKey = key;
    this.prof = ENGINES[key] ?? ENGINES.sedan;
    this.applyProfile();
  }
  private applyProfile() {
    if (!this.ctx) return;
    const p = this.prof;
    this.o1.type = p.w1;
    this.o2.type = p.w2;
    this.g2.gain.value = p.mix2;
    this.am.gain.value = 1 - p.lopeDepth / 2;
    this.lfoGain.gain.value = p.lopeDepth / 2;
  }

  /** 警笛：vol 0..1（0 = 關），t = 現在時間（秒）；高低音來回 */
  sirenAt(vol: number, t: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const f = 650 + 520 * (0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 2.2));
    this.siren.frequency.setTargetAtTime(f, now, 0.03);
    this.sirenGain.gain.setTargetAtTime(this.enabled ? vol * 0.07 : 0, now, 0.15);
  }

  /** rpm 0..1，load 0..1（踩油門的程度） */
  engine(rpm: number, load: number, running: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const p = this.prof;
    const f = p.base + rpm * p.range;
    this.o1.frequency.setTargetAtTime(f, t, 0.025);
    this.o2.frequency.setTargetAtTime(f * p.ratio2, t, 0.025);
    this.lfo.frequency.setTargetAtTime(Math.max(1, f * p.lope), t, 0.03);
    this.filter.frequency.setTargetAtTime(p.fBase + rpm * p.fRange * (0.5 + load * 0.5), t, 0.05);
    this.engGain.gain.setTargetAtTime(this.enabled && running ? (0.05 + 0.08 * load) * p.gain : 0, t, 0.08);
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

  /** 汽車喇叭：兩個差三度的方波（像真的雙音喇叭）＋低通；vol 0..1、pitch 倍率（每台車不太一樣） */
  horn(vol = 1, pitch = 1, dur = 0.35) {
    if (!this.ctx || !this.enabled || vol <= 0.02) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * vol, t + 0.015);
    g.gain.setValueAtTime(0.16 * vol, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.06);
    lp.connect(g).connect(this.master);
    for (const f of [415, 523]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * pitch;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.08);
    }
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
