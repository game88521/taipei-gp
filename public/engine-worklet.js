// 引擎聲合成器（AudioWorklet，逐樣本計算）：不用音檔，照引擎的物理去合成
//
// 原理：曲軸每轉兩圈（720°），每個汽缸各點火一次。每一次點火是一個短促的「燃燒脈衝」，
// 脈衝經過排氣管共鳴（兩個帶通共振）變成我們聽到的聲音。所以：
//   基頻 = 轉速(rpm) × 汽缸數 / 120     （直四 3000 rpm = 100 Hz、V8 = 200 Hz）
//   V8 cross-plane 的點火間隔其實是均勻的 90°，招牌的「轟轟」來自左右兩排各自的排氣管：
//   同一排的四個汽缸排氣脈衝間隔是 270/180/90/180（不均勻）→ 每排排氣管裡是一串不規則的脈衝，兩排混在一起就是那個 lope。
//   所以每個汽缸標上自己屬於哪一排（bank），兩排各有一組排氣共鳴，最後左右混合
//   燃燒有隨機性 → 每次脈衝強弱、時間有一點點不同（粗糙度）
// 另外加上：進氣（低通噪音，隨油門）、機械聲（高頻、隨轉速）、放油回火（偶爾爆一兩聲）、換檔斷火。
//
// 參數（AudioParam，主執行緒每格設定）：rpm、load（0 放油 ~ 1 全油門）、gain
// 訊息（port）：{ type: 'profile', ...車種參數 }、{ type: 'shift' }（換檔：斷火 70 ms）

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.phase = 0; // 曲軸角度，0 ~ 720（度）
    this.fire = [0, 180, 360, 540]; // 每個汽缸的點火角度（直四）
    this.bank = [0, 0, 0, 0]; // 每個汽缸屬於哪一排排氣（直列都是 0；V 型一半是 1）
    this.bankMix = 0; // 兩排排氣的音色差（0 = 兩排一樣）
    this.nextIdx = 0;
    // 正在響的燃燒脈衝（固定大小的池：音訊執行緒上不配置記憶體，不然垃圾回收會爆音）
    this.POOL = 96;
    this.pAmp = new Float32Array(this.POOL); this.pAge = new Int32Array(this.POOL); this.pBank = new Uint8Array(this.POOL); this.pn = 0;
    this.rough = 0.15; // 燃燒的隨機程度（強弱、時間）
    this.res1 = 180; this.res2 = 520; this.q1 = 4; this.q2 = 3; // 排氣管共鳴頻率與 Q
    this.decay = 0.004; // 一次燃燒脈衝的衰減時間（秒）
    this.noise = 0.25; // 脈衝裡的噪音比例（柴油高）
    this.intake = 0.15; this.mech = 0.06; this.backfire = 0.0; this.turbo = 0;
    this.cut = 0; // 換檔斷火剩幾個樣本
    this.smoothRpm = 900; this.smoothLoad = 0;
    // 兩個共振器（帶通，雙二次濾波器）的狀態
    this.b1 = [0, 0, 0, 0]; this.b2 = [0, 0, 0, 0]; // 第一排的兩個共振器
    this.b3 = [0, 0, 0, 0]; this.b4 = [0, 0, 0, 0]; // 第二排
    this.lpI = 0; this.lpM = 0; this.hpM = 0; this.dc = 0; this.dcPrev = 0;
    // 四組濾波器係數（寫進固定陣列，不在音訊執行緒上配置新陣列）
    this.c1 = new Float64Array(5); this.c2 = new Float64Array(5); this.c3 = new Float64Array(5); this.c4 = new Float64Array(5);
    this.lastR1 = 0; // 上一次算係數時的第一共鳴頻率（變動超過 2 Hz 才重算）
    this.seed = (Math.random() * 1e9) | 0;
    this.whine = 0; this.bfTimer = 0; this.lastLoad = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'profile') {
        this.fire = m.fire; this.bank = m.bank || m.fire.map(() => 0); this.bankMix = m.bankMix || 0; this.rough = m.rough; this.res1 = m.res1; this.res2 = m.res2; this.q1 = m.q1; this.q2 = m.q2;
        this.decay = m.decay; this.noise = m.noise; this.intake = m.intake; this.mech = m.mech; this.backfire = m.backfire; this.turbo = m.turbo || 0;
        this.nextIdx = 0;
        this.lastR1 = 0; // 換了車種：下一個區塊一定要照轉速重算係數
        this.coef();
      } else if (m.type === 'shift') this.cut = Math.round(sampleRate * 0.07);
    };
    this.coef();
  }

  rand() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }

  /** 帶通濾波器係數（RBJ cookbook，0 dB 峰值增益），寫進 o[0..4]（不回傳新陣列：音訊執行緒上不配置記憶體） */
  bp(f, q, o) {
    const w = (2 * Math.PI * Math.min(f, sampleRate * 0.45)) / sampleRate, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    o[0] = al / a0; o[1] = 0; o[2] = -al / a0; o[3] = (-2 * Math.cos(w)) / a0; o[4] = (1 - al) / a0;
  }
  coef() {
    this.bp(this.res1, this.q1, this.c1); this.bp(this.res2, this.q2, this.c2);
    // 第二排：管長略不同，共鳴頻率偏一點（bankMix），兩排的音色才不會完全相同
    this.bp(this.res1 * (1 + this.bankMix), this.q1, this.c3); this.bp(this.res2 * (1 + this.bankMix * 0.7), this.q2, this.c4);
  }
  run(c, s, x) { // 直接型 II：s = [x1, x2, y1, y2]
    const y = c[0] * x + c[1] * s[0] + c[2] * s[1] - c[3] * s[2] - c[4] * s[3];
    s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y;
    return y;
  }
  /** 加一個燃燒脈衝（池滿了就丟掉：極端轉速才會發生） */
  pushPulse(amp, bank) {
    if (this.pn >= this.POOL) return;
    const i = this.pn++;
    this.pAmp[i] = amp; this.pAge[i] = 0; this.pBank[i] = bank;
  }
  /** 輸出出現 NaN／無限大（上游給了壞數字）：濾波器是遞迴的，壞值進去就永遠出不來，所以整組狀態歸零 */
  heal() {
    for (const s of [this.b1, this.b2, this.b3, this.b4]) s[0] = s[1] = s[2] = s[3] = 0;
    this.lpI = this.lpM = this.dc = this.dcPrev = 0; this.pn = 0; this.whine = 0;
    if (!Number.isFinite(this.smoothRpm)) this.smoothRpm = 900;
    if (!Number.isFinite(this.smoothLoad)) this.smoothLoad = 0;
    if (!Number.isFinite(this.phase)) this.phase = 0;
  }

  process(_in, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const n = out.length;
    let rpmT = params.rpm[0], loadT = params.load[0];
    const gain = params.gain[0];
    if (!(rpmT >= 0 && rpmT < 40000)) rpmT = this.smoothRpm; // NaN／離譜的轉速：沿用上一個
    if (!(loadT >= 0 && loadT <= 1)) loadT = Math.min(1, Math.max(0, loadT || 0));
    if (!(gain > 0.0001)) { out.fill(0); this.pn = 0; return true; }
    // 每個區塊平滑一次（128 樣本 ≈ 2.9 ms）
    this.smoothRpm += (rpmT - this.smoothRpm) * 0.25;
    this.smoothLoad += (loadT - this.smoothLoad) * 0.15;
    const rpm = Math.max(300, this.smoothRpm), load = this.smoothLoad;
    // 放油的瞬間（load 從高掉到低）：回火的機率
    if (this.backfire > 0 && this.lastLoad > 0.6 && loadT < 0.3 && rpm > 3500) this.bfTimer = Math.round(sampleRate * (0.05 + this.rand() * 0.25));
    this.lastLoad = loadT;
    const degPerSample = (rpm / 60) * 360 / sampleRate; // 每個樣本曲軸轉幾度
    const cyl = this.fire.length;
    // 燃燒強度：全油門強、放油時剩一點（引擎煞車）；轉速越高每次越短越尖
    const strength = 0.25 + 0.75 * load;
    const decaySamples = Math.max(8, (this.decay * sampleRate) * Math.min(1.6, 2600 / rpm));
    const k = Math.exp(-1 / decaySamples);
    const r1 = this.res1 * (0.85 + rpm / 20000), r2 = this.res2 * (0.85 + rpm / 15000);
    if (Math.abs(r1 - this.lastR1) > 2) {
      this.bp(r1, this.q1, this.c1); this.bp(r2, this.q2, this.c2);
      this.bp(r1 * (1 + this.bankMix), this.q1, this.c3); this.bp(r2 * (1 + this.bankMix * 0.7), this.q2, this.c4);
      this.lastR1 = r1;
    }
    // 進氣噪音：低通（截止隨轉速），音量隨油門
    const aI = 1 - Math.exp((-2 * Math.PI * (300 + rpm * 0.25)) / sampleRate);
    // 機械聲：高通後的噪音、隨轉速
    const aM = 1 - Math.exp((-2 * Math.PI * (2500 + rpm * 0.6)) / sampleRate);
    // 渦輪（F1 混動）：一個隨轉速走的高頻嘯聲
    const whineF = 3200 + rpm * 0.9;
    for (let s = 0; s < n; s++) {
      const prev = this.phase;
      this.phase += degPerSample;
      if (this.phase >= 720) this.phase -= 720;
      // 這個樣本有沒有跨過下一個汽缸的點火角度
      const target = this.fire[this.nextIdx], cylIdx = this.nextIdx;
      const crossed = prev <= this.phase ? prev < target && this.phase >= target : prev < target || this.phase >= target;
      if (crossed) {
        this.nextIdx = (this.nextIdx + 1) % cyl;
        if (this.cut > 0) { /* 換檔斷火：這一下不點火 */ }
        else {
          // 每次燃燒有隨機性：強弱 ±rough、偶爾一下特別弱（失火感，很少）
          let a = strength * (1 + (this.rand() * 2 - 1) * this.rough);
          if (this.rand() < 0.01 * this.rough) a *= 0.3;
          this.pushPulse(a, this.bank[cylIdx] || 0);
        }
      }
      // 所有正在衰減的脈衝加總（一個脈衝 = 一次壓力波：先正後負的衰減，加上噪音）
      // 包絡用逐樣本乘 k 推進（等於 amp·k^age，但不用每個樣本算 pow；轉速變動時衰減也是平順的）
      let x = 0, xb = 0; // 兩排排氣各自的壓力
      const pAmp = this.pAmp, pAge = this.pAge, pBank = this.pBank;
      for (let p = this.pn - 1; p >= 0; p--) {
        const env = pAmp[p];
        if (env < 0.0005) { // 播完了：用最後一個補上來（從後面往前掃，補上來的那個這個樣本已經算過了）
          const last = --this.pn;
          pAmp[p] = pAmp[last]; pAge[p] = pAge[last]; pBank[p] = pBank[last];
          continue;
        }
        const shape = pAge[p] < 3 ? 1 : -0.35; // 壓力突升再回落
        const v = env * (shape * (1 - this.noise) + (this.rand() * 2 - 1) * this.noise);
        if (pBank[p]) xb += v; else x += v;
        pAmp[p] = env * k;
        pAge[p]++;
      }
      // 回火：放油時一連串爆裂（很短的高噪音脈衝）
      if (this.bfTimer > 0) {
        this.bfTimer--;
        if (this.rand() < 0.0012 * this.backfire) this.pushPulse(1.6 + this.rand(), this.rand() < 0.5 ? 0 : 1);
      }
      if (this.cut > 0) this.cut--;
      // 排氣管共鳴：兩個帶通（低：管長的主共鳴、高：管口的音色）
      const ex = this.run(this.c1, this.b1, x) + this.run(this.c2, this.b2, x) * 0.55
        + this.run(this.c3, this.b3, xb) + this.run(this.c4, this.b4, xb) * 0.55;
      // 進氣
      const wn = this.rand() * 2 - 1;
      this.lpI += aI * (wn - this.lpI);
      const intake = this.lpI * this.intake * (0.3 + load);
      // 機械聲（高通：噪音減去它的低通）
      this.lpM += aM * (wn - this.lpM);
      const mech = (wn - this.lpM) * this.mech * (rpm / 9000);
      // 渦輪嘯聲
      let tw = 0;
      if (this.turbo > 0) { this.whine += (2 * Math.PI * whineF) / sampleRate; if (this.whine > 6.2832) this.whine -= 6.2832; tw = Math.sin(this.whine) * this.turbo * (0.2 + load) * Math.min(1, rpm / 9000); }
      let y = (ex * 2.2 + (x + xb) * 0.25 + intake + mech + tw) * gain;
      // 去直流
      const dcOut = y - this.dcPrev + 0.995 * this.dc;
      this.dcPrev = y; this.dc = dcOut;
      // 軟限幅：大聲時也不會爆音
      out[s] = Math.tanh(dcOut);
    }
    if (!Number.isFinite(out[n - 1])) { this.heal(); out.fill(0); }
    return true;
  }
}

registerProcessor('engine', EngineProcessor);
