// 音效全部用 Web Audio 即時合成，沒有音檔
// 引擎：public/engine-worklet.js 逐樣本模擬點火脈衝＋排氣共鳴（enginevoice.ts 是各車的參數）；
// 瀏覽器不支援 AudioWorklet 時退回舊的「兩個振盪器＋濾波器」
import { VOICES, realRpm, type EngineVoice } from './enginevoice';

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
  private limiterOut!: GainNode; // 軟限幅之後、接到喇叭之前的最後一個節點（測試量真正送出去的聲音用）
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
  private engBus!: GainNode;
  private fx!: GainNode;
  // ---- 新版引擎（AudioWorklet）
  private worklet = false; // 載入成功才用
  private eng: AudioWorkletNode | null = null;
  private voice: EngineVoice = VOICES.sedan;
  private lastRpmFrac = 0;
  /** 其他車的引擎聲源（大獎賽 AI、車流、警車）：固定幾個，每格指派給最近的幾台車；idleAt = 上次空出來的時間（挑安靜最久的來接手） */
  private others: { node: AudioWorkletNode; pan: PannerNode; lp: BiquadFilterNode; g: GainNode; key: string; voice: string; idleAt: number }[] = [];
  private hushed = true; // 持續的聲音（其他車、刮擦、環境）是不是已經關掉了；engine(…, false) 會關
  // ---- 環境
  private amb!: GainNode; // 環境音的總音量（城市嗡嗡、觀眾、雨）
  private city: { src: AudioBufferSourceNode; g: GainNode } | null = null;
  private crowd: { src: AudioBufferSourceNode; g: GainNode; bp: BiquadFilterNode } | null = null;
  private rain: { src: AudioBufferSourceNode; g: GainNode } | null = null;
  private verb!: ConvolverNode; // 隧道殘響
  private verbSend!: GainNode;
  private scrapeG: GainNode | null = null; // 刮護欄（持續的）
  private ambBuf: AudioBuffer | null = null;
  /** 音量 0~1：主音量、引擎聲、音效 */
  vol = { master: 1, engine: 1, fx: 1 };
  setVolume(v: Partial<{ master: number; engine: number; fx: number }>) { Object.assign(this.vol, v); this.applyVolume(); }
  private applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = 0.6 * this.vol.master;
    this.engBus.gain.value = this.vol.engine;
    this.fx.gain.value = this.vol.fx;
  }

  /** 一定要在點擊事件裡呼叫（iOS 規定） */
  start() {
    playbackSession();
    if (this.ctx) { this.unlock(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    // 軟限幅：好幾台引擎＋撞擊＋喇叭疊在一起時不會爆音。
    // 0.6 以下完全不動（一般音量聽起來跟沒有限幅一樣），超過之後 T + (C−T)·tanh((|x|−T)/(C−T)) 平順地逼近 C = 0.95：
    // 輸入 1.0 → 0.885、1.5 → 0.946，永遠到不了 1 被喇叭削掉。
    // WaveShaper 的曲線只定義在輸入 ±1，超過的輸入會變成平頂（硬削波，聽起來很刺，舊版輸入大於 1 就是這樣）；
    // 所以前面先除以 K、後面乘回 K，讓這條曲線實際涵蓋 ±K（輸入 4 倍滿幅也還在曲線上）
    const K = 4, T = 0.6, C = 0.95;
    const pre = ctx.createGain();
    pre.gain.value = 1 / K;
    const soft = ctx.createWaveShaper();
    const curve = new Float32Array(8193);
    for (let i = 0; i < curve.length; i++) {
      const x = K * (i / 4096 - 1), a = Math.abs(x);
      curve[i] = (Math.sign(x) * (a <= T ? a : T + (C - T) * Math.tanh((a - T) / (C - T)))) / K;
    }
    soft.curve = curve;
    soft.oversample = '2x';
    this.limiterOut = ctx.createGain();
    this.limiterOut.gain.value = K;
    this.master.connect(pre).connect(soft).connect(this.limiterOut).connect(ctx.destination);
    // 引擎與其他音效分開兩個通道，選單可以各自調音量
    this.engBus = ctx.createGain();
    this.engBus.connect(this.master);
    this.fx = ctx.createGain();
    this.fx.connect(this.master);
    this.applyVolume();
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
    this.filter.connect(this.am).connect(this.engGain).connect(this.engBus);
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
    this.siren.connect(this.sirenGain).connect(this.fx);
    this.siren.start();
    this.applyProfile();
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    // 隧道殘響：程式產生的脈衝響應（0.9 秒、指數衰減的雜訊）；平常送進去的量是 0
    this.verb = ctx.createConvolver();
    // 不用內建的正規化：它會把這段脈衝響應縮到約 0.24 倍（−12 dB），送出量 0.9 時殘響只剩乾聲的 −15 dB，幾乎聽不到。
    // impulse() 自己把能量正規化成 1，送出量就是濕聲相對乾聲的比例（normalize 要在設定 buffer 之前關掉）
    this.verb.normalize = false;
    this.verb.buffer = this.impulse(0.9, 2.6);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0;
    // 隧道的殘響偏暗（混凝土、空氣吸收高頻）
    const verbLp = ctx.createBiquadFilter();
    verbLp.type = 'lowpass';
    verbLp.frequency.value = 3200;
    this.verbSend.connect(this.verb).connect(verbLp).connect(this.master);
    this.engBus.connect(this.verbSend);
    this.fx.connect(this.verbSend); // 撞擊、喇叭、警笛在隧道裡也有回音
    // 環境音
    this.amb = ctx.createGain();
    this.amb.gain.value = 1;
    this.amb.connect(this.fx);
    // 引擎合成器（AudioWorklet）：載入成功之後才切過去，載入中仍用舊的振盪器
    void this.loadWorklet();
    // 看門狗：音訊時鐘 0.6 秒沒人餵引擎（遊戲不再步進）就把持續的聲音全部關掉；暫停（suspend）時時鐘不走，不會誤關
    setInterval(() => { if (this.ctx && !this.hushed && this.ctx.currentTime - this.lastFeed > 0.6) this.hush(); }, 300);
  }

  /** 載入 public/engine-worklet.js；成功就建主引擎節點，舊的振盪器靜音 */
  private async loadWorklet() {
    const ctx = this.ctx!;
    if (!ctx.audioWorklet) return;
    try {
      await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}engine-worklet.js`);
    } catch { return; }
    this.eng = this.makeEngine(this.voice);
    this.eng.connect(this.engBus);
    this.worklet = true;
    this.engGain.gain.value = 0; // 舊的振盪器從此不出聲
    // 其他車的聲源：電腦 6 個、手機 4 個（每個都是一個 worklet，逐樣本合成很吃 CPU）
    const n = matchMedia('(pointer: coarse)').matches ? 4 : 6;
    for (let k = 0; k < n; k++) {
      const node = this.makeEngine(VOICES.traffic);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      const g = ctx.createGain(); // 固定 1：淡入淡出走 worklet 自己的 gain 參數（降到 0 時 worklet 直接輸出靜音、不耗 CPU）
      g.gain.value = 1;
      const pan = ctx.createPanner();
      pan.panningModel = 'equalpower';
      // 真實的距離衰減（每遠一倍 −6 dB）：6 m 內全音量、12 m 剩一半、50 m 約一成、180 m 約 3%
      pan.distanceModel = 'inverse';
      pan.refDistance = 6;
      pan.maxDistance = 400;
      pan.rolloffFactor = 1.1;
      node.connect(lp).connect(g).connect(pan).connect(this.engBus);
      this.others.push({ node, pan, lp, g, key: '', voice: 'traffic', idleAt: -10 });
    }
  }
  private makeEngine(v: EngineVoice): AudioWorkletNode {
    const node = new AudioWorkletNode(this.ctx!, 'engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.postMessage({ type: 'profile', ...v });
    return node;
  }
  /** 殘響的脈衝響應：左右各一段指數衰減的白噪音，每聲道能量正規化成 1（寬頻的聲音進去，出來一樣大聲） */
  private impulse(sec: number, decay: number, seed = 1) {
    const ctx = this.ctx!, n = Math.round(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    // 固定種子：引擎聲只有幾條諧波，進出殘響的音量取決於脈衝響應的頻率起伏；用 Math.random 的話每次載入會差到 5 dB。
    // 種子 1 是掃 6 個種子 × 5 個轉速挑出來的：隧道殘響讓整體多 +2.5 ~ +3.7 dB（離 0 與 6 dB 的門檻都有餘裕）
    let rs = seed >>> 0;
    const rnd = () => (rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let e = 0;
      for (let i = 0; i < n; i++) { d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / n, decay); e += d[i] * d[i]; }
      for (let i = 0, k = 1 / Math.sqrt(e); i < n; i++) d[i] *= k;
    }
    return b;
  }

  suspend() { void this.ctx?.suspend(); }

  /**
   * 手機會在切到別的 App、鎖螢幕、來電時把網頁的聲音停掉（iOS 叫 interrupted），回來以後要在使用者碰螢幕時才能叫醒：
   * main 在每次觸控、按鍵時呼叫；順便播一小段無聲的聲音（iOS 要真的播過東西才算解鎖）
   */
  unlock() {
    const ctx = this.ctx;
    if (!ctx || (ctx.state as string) === 'running') return;
    void ctx.resume();
    try {
      const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(ctx.destination);
      src.start();
    } catch { /* 有些瀏覽器還沒 resume 完不給播 */ }
    playbackSession();
  }
  get state() { return this.ctx?.state ?? 'none'; }
  /** 音效系統已經啟動（使用者點過畫面）；自動測試時沒有，main 就不用白算其他車的資料 */
  get started() { return this.ctx !== null; }
  /** 除錯用：狀態一行字（?audiodebug 會顯示在標題） */
  debug() {
    const busy = this.others.filter((o) => o.key).length;
    return `${this.state} worklet=${this.worklet ? 'on' : 'off'} others=${busy}/${this.others.length}`;
  }

  /** 換引擎聲（車種 id，或 'f1'） */
  setEngine(key: string) {
    if (key === this.profKey) return;
    this.profKey = key;
    this.prof = ENGINES[key] ?? ENGINES.sedan;
    this.applyProfile();
    this.voice = VOICES[key] ?? VOICES.sedan;
    this.eng?.port.postMessage({ type: 'profile', ...this.voice });
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

  /**
   * 持續的聲音（其他車、刮擦、環境）都是「每格餵一次目標值」的；遊戲停止步進（選單、成績表、暫停）後沒人再餵，
   * 會一直卡在最後一個音量上。所以：engine(…, false) 時全部淡出，另外有個看門狗（start 裡的計時器）處理沒呼叫 engine 的情況
   */
  private hush() {
    if (this.hushed || !this.ctx) return;
    this.hushed = true; // 關掉之後，在下一次 engine(…, true) 以前 otherEngines／ambience／scrape 都不會把聲音再打開
    const t = this.ctx.currentTime;
    for (const o of this.others) {
      if (!o.key) continue;
      (o.node.parameters as unknown as Map<string, AudioParam>).get('gain')!.setTargetAtTime(0, t, 0.05);
      o.key = ''; o.idleAt = t;
    }
    this.scrapeG?.gain.setTargetAtTime(0, t, 0.05);
    this.city?.g.gain.setTargetAtTime(0, t, 0.3);
    this.crowd?.g.gain.setTargetAtTime(0, t, 0.3);
    this.rain?.g.gain.setTargetAtTime(0, t, 0.3);
    this.verbSend.gain.setTargetAtTime(0, t, 0.2);
    // 主引擎也關：遊戲停止步進（選單、成績表、分頁被丟到背景）時不要卡在最後的轉速上一直響
    if (this.worklet && this.eng) (this.eng.parameters as unknown as Map<string, AudioParam>).get('gain')!.setTargetAtTime(0, t, 0.05);
    else this.engGain.gain.setTargetAtTime(0, t, 0.05);
  }
  private lastFeed = 0; // 上一次 engine(…, true) 的時間（音訊時鐘）
  private limiterAt = 0; // 上一次限速器斷火的時間（音訊時鐘）

  /**
   * 維修區限速器（每格呼叫，跟 engine 一起）：真的 F1 按了限速器之後，ECU 一直切斷點火把車速壓在限速，
   * 引擎是「噗噗噗」一頓一頓的。這裡每 0.11 秒送一次斷火（worklet 的 shift：70 ms 不點火），聽起來就是那個顫音
   */
  limiter() {
    if (!this.ctx || !this.worklet || !this.eng || this.hushed) return;
    const t = this.ctx.currentTime;
    if (t - this.limiterAt < 0.11) return;
    this.limiterAt = t;
    this.eng.port.postMessage({ type: 'shift' });
  }

  /** rpm 0..1，load 0..1（踩油門的程度） */
  engine(rpm: number, load: number, running: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (running) { this.hushed = false; this.lastFeed = t; } else this.hush();
    if (this.worklet && this.eng) {
      // 換檔：轉速比例突然往下掉一大截 → 斷火一下（真的換檔會有一瞬間沒動力）
      if (running && this.lastRpmFrac - rpm > 0.25) this.eng.port.postMessage({ type: 'shift' });
      this.lastRpmFrac = rpm;
      const P = this.eng.parameters as unknown as Map<string, AudioParam>;
      P.get('rpm')!.setTargetAtTime(realRpm(this.voice, rpm), t, 0.02);
      P.get('load')!.setTargetAtTime(load, t, 0.04);
      P.get('gain')!.setTargetAtTime(this.enabled && running ? 0.78 * this.voice.gain : 0, t, 0.08);
      return;
    }
    const p = this.prof;
    const f = p.base + rpm * p.range;
    this.o1.frequency.setTargetAtTime(f, t, 0.025);
    this.o2.frequency.setTargetAtTime(f * p.ratio2, t, 0.025);
    this.lfo.frequency.setTargetAtTime(Math.max(1, f * p.lope), t, 0.03);
    this.filter.frequency.setTargetAtTime(p.fBase + rpm * p.fRange * (0.5 + load * 0.5), t, 0.05);
    this.engGain.gain.setTargetAtTime(this.enabled && running ? (0.05 + 0.08 * load) * p.gain : 0, t, 0.08);
  }

  /**
   * 撞擊：kind = 'wall' 撞牆（悶響＋碎屑）、'car' 撞車（金屬：幾個不諧和的衰減正弦）、'soft' 撞樹／路燈（木頭、鐵桿）。
   * power 是撞擊力道（跟以前一樣），越大越響、越低沉
   */
  hit(power: number, kind: 'wall' | 'car' | 'soft' = 'wall') {
    if (!this.ctx || !this.enabled || power < 2) return;
    const ctx = this.ctx, t = ctx.currentTime, v = Math.min(1, power / 40);
    const out = ctx.createGain();
    out.gain.value = kind === 'soft' ? 1.3 : 1.7;
    out.connect(this.fx);
    // 1. 衝擊的悶響：低通後的噪音爆發（所有撞擊都有）
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'soft' ? 900 : 380 + 1200 * (1 - v);
    const g = ctx.createGain();
    g.gain.setValueAtTime(v * (kind === 'car' ? 0.7 : 1), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + v * 0.25);
    src.connect(lp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.6);
    // 2. 碎屑：高頻的噪音尾巴（撞牆、撞車：玻璃、碳纖維碎片）
    if (kind !== 'soft' && v > 0.15) {
      const s2 = ctx.createBufferSource();
      s2.buffer = this.noise;
      s2.playbackRate.value = 1.6;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(0.25 * v, t + 0.03);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      s2.connect(hp).connect(g2).connect(out);
      s2.start(t);
      s2.stop(t + 0.55);
    }
    // 3. 金屬的鏗鏘：不諧和的幾個頻率（車身鈑金、碳纖維）
    if (kind === 'car' || (kind === 'wall' && v > 0.4)) {
      for (const [f, a, d] of [[310, 0.2, 0.35], [517, 0.14, 0.28], [893, 0.1, 0.2], [1471, 0.06, 0.14]] as const) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * (0.9 + Math.random() * 0.2);
        const og = ctx.createGain();
        og.gain.setValueAtTime(a * v, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + d * (0.6 + v));
        o.connect(og).connect(out);
        o.start(t);
        o.stop(t + d * (0.6 + v) + 0.05);
      }
    }
  }

  /** 刮護欄：持續的摩擦聲，v 0..1（0 = 沒刮）；每格呼叫 */
  scrape(v: number) {
    if (!this.ctx || this.hushed) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.scrapeG) {
      const src = ctx.createBufferSource();
      src.buffer = this.loopNoise();
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700;
      bp.Q.value = 1.4;
      this.scrapeG = ctx.createGain();
      this.scrapeG.gain.value = 0;
      src.connect(bp).connect(this.scrapeG).connect(this.fx);
      src.start();
    }
    this.scrapeG.gain.setTargetAtTime(this.enabled ? Math.min(1, v) * 0.35 : 0, t, v > 0 ? 0.02 : 0.12);
  }

  /** 3 秒、可以無縫循環的白噪音（環境音、刮擦共用） */
  private loopNoise() {
    if (this.ambBuf) return this.ambBuf;
    const ctx = this.ctx!, n = ctx.sampleRate * 3, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return (this.ambBuf = b);
  }
  private loopSrc(filter: BiquadFilterNode, gain: number) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = this.loopNoise();
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.amb);
    src.start();
    return { src, g };
  }

  /**
   * 環境音（每格呼叫）：city 0..1 城市車流的遠處嗡嗡、crowd 0..1 看台觀眾（excite 0..1 歡呼程度）、
   * rain 0..1 雨聲、tunnel 0..1 隧道殘響（引擎、其他車的聲音送進去多少）
   */
  ambience(a: { city?: number; crowd?: number; excite?: number; rain?: number; tunnel?: number }, alive = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, on = this.enabled ? 1 : 0;
    if (alive) { this.hushed = false; this.lastFeed = t; } else if (this.hushed) return; // alive = 這一格沒有引擎在跑（頒獎台），靠環境音自己維持
    if ((a.city ?? 0) > 0 && !this.city) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      this.city = this.loopSrc(lp, 0);
    }
    if ((a.crowd ?? 0) > 0 && !this.crowd) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
      this.crowd = { ...this.loopSrc(bp, 0), bp };
    }
    if ((a.rain ?? 0) > 0 && !this.rain) {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
      this.rain = this.loopSrc(hp, 0);
    }
    this.city?.g.gain.setTargetAtTime(on * (a.city ?? 0) * 0.1, t, 0.6);
    if (this.crowd) {
      const ex = a.excite ?? 0;
      this.crowd.g.gain.setTargetAtTime(on * (a.crowd ?? 0) * (0.06 + 0.5 * ex), t, ex > 0.3 ? 0.08 : 0.8);
      this.crowd.bp.frequency.setTargetAtTime(600 + 900 * ex, t, 0.2); // 歡呼時人聲變亮
    }
    this.rain?.g.gain.setTargetAtTime(on * (a.rain ?? 0) * 0.16, t, 0.8);
    this.verbSend.gain.setTargetAtTime(on * (a.tunnel ?? 0) * 0.9, t, 0.3);
  }

  /**
   * 其他車的引擎聲：cars = 附近的車（最多 others.length 台會發聲，main 依距離排好）。
   * 每台：key 讓同一台車黏著同一個聲源（不會換來換去）、voice 車種、x z 位置、vx vz 速度、rpm 0..1、load 0..1。
   * 聽者在 (lx, lz)、速度 (lvx, lvz)、面向 lh：算距離衰減、左右聲像、都卜勒（呼嘯而過）、遠處變悶
   */
  otherEngines(cars: { key: string; voice: string; x: number; z: number; vx: number; vz: number; rpm: number; load: number; d?: number }[], lx: number, lz: number, lvx: number, lvz: number, lh: number) {
    if (!this.ctx || !this.worklet || !this.others.length || this.hushed) return;
    const ctx = this.ctx, t = ctx.currentTime, L = ctx.listener;
    // 聽者：在原點、面向 lh（遊戲的前進方向 = (sin h, cos h)；Web Audio 的「右」= 前 × 上 = (−cos h, 0, sin h)，剛好是遊戲裡車子的右邊）
    const fx = Math.sin(lh), fz = Math.cos(lh);
    if (L.forwardX) { L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; L.positionX.value = 0; L.positionY.value = 0; L.positionZ.value = 0; }
    else (L as unknown as { setOrientation: (...a: number[]) => void }).setOrientation(fx, 0, fz, 0, 1, 0);
    // 選出要發聲的車：已經佔著聲源的車排序時距離打八折（遲滯），兩台差不多遠的車不會一直互相搶
    const held = new Set(this.others.map((o) => o.key).filter(Boolean));
    const dist = (c: (typeof cars)[number]) => (c.d ?? Math.hypot(c.x - lx, c.z - lz)) * (held.has(c.key) ? 0.8 : 1);
    const want = [...cars].sort((a, b) => dist(a) - dist(b)).slice(0, this.others.length);
    const used = new Set<(typeof this.others)[number]>();
    for (const c of want) {
      let o = this.others.find((q) => q.key === c.key);
      if (!o) {
        // 新的車：找一個已經安靜夠久的聲源（淡出後音量 < 0.1%，換車不會有喀聲）；沒有就等下一格
        o = this.others.filter((q) => !q.key && t - q.idleAt > 0.45 && !used.has(q)).sort((a, b) => a.idleAt - b.idleAt)[0];
        if (!o) continue;
        o.key = c.key;
        const G = (o.node.parameters as unknown as Map<string, AudioParam>).get('gain')!;
        G.cancelScheduledValues(t);
        G.setValueAtTime(0, t);
      }
      used.add(o);
      if (o.voice !== c.voice) { o.voice = c.voice; o.node.port.postMessage({ type: 'profile', ...(VOICES[c.voice] ?? VOICES.traffic) }); }
      const rx = c.x - lx, rz = c.z - lz, d = Math.hypot(rx, rz) || 0.01;
      // 都卜勒：f' = f × (c + 聽者朝聲源的速度) / (c + 聲源遠離的速度)，聲速 343 m/s；夾在 ±30%（真的 F1 擦身而過會差一倍，遊戲裡太誇張）
      const ux = rx / d, uz = rz / d;
      const dop = Math.max(0.7, Math.min(1.3, (343 + lvx * ux + lvz * uz) / (343 + c.vx * ux + c.vz * uz)));
      const v = VOICES[c.voice] ?? VOICES.traffic;
      const P = o.node.parameters as unknown as Map<string, AudioParam>;
      P.get('rpm')!.setTargetAtTime(realRpm(v, c.rpm) * dop, t, 0.05);
      P.get('load')!.setTargetAtTime(c.load, t, 0.08);
      P.get('gain')!.setTargetAtTime(this.enabled ? 0.45 * v.gain : 0, t, 0.1); // 別人的車比自己的小聲（自己是 0.78）
      if (o.pan.positionX) { o.pan.positionX.setTargetAtTime(rx, t, 0.03); o.pan.positionY.setTargetAtTime(0, t, 0.03); o.pan.positionZ.setTargetAtTime(rz, t, 0.03); }
      else (o.pan as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(rx, 0, rz);
      // 遠處變悶（空氣吸收高頻）：近處全亮、200 m 剩 1 kHz
      o.lp.frequency.setTargetAtTime(Math.max(900, 9000 - d * 40), t, 0.1);
    }
    // 沒分到車的聲源：用 worklet 自己的 gain 淡出（降到 0 之後 worklet 直接輸出靜音，不耗 CPU）
    for (const o of this.others) {
      if (used.has(o) || !o.key) continue;
      (o.node.parameters as unknown as Map<string, AudioParam>).get('gain')!.setTargetAtTime(0, t, 0.05);
      o.key = '';
      o.idleAt = t;
    }
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
    lp.connect(g).connect(this.fx);
    for (const f of [415, 523]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * pitch;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.08);
    }
  }

  /** 尖叫：從高音往下滑、帶顫音；pitch 每個人不太一樣 */
  scream(vol = 1, pitch = 1) {
    if (!this.ctx || !this.enabled || vol <= 0.02) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 0.55 + Math.random() * 0.25;
    const o = ctx.createOscillator(), vib = ctx.createOscillator(), vg = ctx.createGain(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(980 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(620 * pitch, t + dur);
    vib.frequency.value = 9;
    vg.gain.value = 35 * pitch;
    vib.connect(vg).connect(o.frequency);
    bp.type = 'bandpass';
    bp.frequency.value = 1500 * pitch;
    bp.Q.value = 1.2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09 * vol, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(bp).connect(g).connect(this.fx);
    o.start(t); vib.start(t);
    o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
  }

  /** 直升機旋翼：一下低沉的「噠」（main 每 0.12 秒呼叫一次） */
  thump(vol: number) {
    if (!this.ctx || !this.enabled || vol <= 0.02) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const g = this.ctx.createGain(), t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.5 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(lp).connect(g).connect(this.fx);
    src.start(t);
    src.stop(t + 0.1);
  }

  /**
   * 維修區的聲音（換胎）：在 (x, z) 發生，聽者在 (lx, lz)；距離衰減跟其他車一樣（每遠一倍 −6 dB，6 m 內全音量）。
   * kind：'gun' 氣動扳手（高速的「滋——」：帶通噪音被 ~45 Hz 的方波斬成一串，鬆開時尾音往下掉）、
   *       'jack' 千斤頂頂起／放下（低沉的「咚」＋一點金屬聲）、'go' 放行（短促的高音嗶）
   */
  pitSound(kind: 'gun' | 'jack' | 'go', x: number, z: number, lx: number, lz: number, vol = 1) {
    if (!this.ctx || !this.enabled) return;
    const d = Math.hypot(x - lx, z - lz), att = 6 / (6 + 1.1 * Math.max(0, d - 6));
    const v = vol * att;
    if (v < 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime, g = ctx.createGain();
    g.connect(this.fx);
    if (kind === 'gun') {
      // 扳手：噪音 → 帶通（3.2 kHz 的金屬嘶聲）→ 被 45 Hz 方波調幅（衝擊扳手一下一下打的那個「達達達」）
      const dur = 0.32;
      const src = ctx.createBufferSource(); src.buffer = this.loopNoise(); src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(1800, t + dur); bp.Q.value = 2.5;
      const am = ctx.createGain(); am.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.setValueAtTime(46, t); lfo.frequency.linearRampToValueAtTime(30, t + dur);
      const lg = ctx.createGain(); lg.gain.value = 0.5;
      const bias = ctx.createConstantSource(); bias.offset.value = 0.5; // 方波（−1~1）× 0.5 + 0.5 → 0~1 的開關
      lfo.connect(lg).connect(am.gain); bias.connect(am.gain);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32 * v, t + 0.01); g.gain.setValueAtTime(0.32 * v, t + dur - 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(bp).connect(am).connect(g);
      for (const n of [src, lfo, bias]) { n.start(t); n.stop(t + dur + 0.02); }
    } else if (kind === 'jack') {
      // 千斤頂：低通噪音的悶響＋一個短的金屬正弦（鋼管碰到車底）
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      g.gain.setValueAtTime(0.7 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      src.connect(lp).connect(g);
      src.start(t); src.stop(t + 0.2);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = 620;
      og.gain.setValueAtTime(0.08 * v, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(og).connect(this.fx); o.start(t); o.stop(t + 0.13);
    } else {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1760;
      g.gain.setValueAtTime(0.06 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g); o.start(t); o.stop(t + 0.13);
    }
  }

  /** 開過積水的「唰」：高頻一點的噪音 */
  splash(vol: number) {
    if (!this.ctx || !this.enabled || vol <= 0.02) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 0.7;
    const g = this.ctx.createGain(), t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.5 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(bp).connect(g).connect(this.fx);
    src.start(t);
    src.stop(t + 0.4);
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
    o.connect(g).connect(this.fx);
    o.start(t);
    o.stop(t + dur);
  }
}

/**
 * iPhone 的靜音鍵切到靜音時，網頁的 Web Audio 預設會被靜音（影片不會）。
 * 告訴系統這是「播放」類的聲音就不會：iOS 17 起有 navigator.audioSession；更舊的 iOS 改成在背景循環播一段無聲的 <audio>
 * （有 HTML 媒體在播，整個網頁的聲音就被當成播放類）。只在第一次點擊時做一次
 */
let sessionDone = false;
function playbackSession() {
  if (sessionDone) return;
  sessionDone = true;
  const nav = navigator as unknown as { audioSession?: { type: string } };
  if (nav.audioSession) { try { nav.audioSession.type = 'playback'; return; } catch { /* 不支援就用下面的方法 */ } }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios) return;
  // 0.5 秒、8 kHz 的無聲 WAV
  const n = 4000, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  const a = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
  a.loop = true;
  a.setAttribute('playsinline', '');
  a.play().catch(() => { sessionDone = false; }); // 沒成功（不在點擊事件裡）就下次點擊再試
}
