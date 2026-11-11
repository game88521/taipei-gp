# AGENTS.md — 台北街道賽

完整交接請讀 [HANDOFF.md](./HANDOFF.md)。這份只放每次都要遵守的規則。

## 規則
- 回覆與 commit 訊息用**繁體中文**；程式碼、檔名、API 路徑維持原文。
- git 署名一律 `Rex <game88521@gmail.com>`（`git -c user.name=Rex -c user.email=game88521@gmail.com commit …`）。**不要用 IBM 信箱或全域設定。**
- 只用虛構名稱，不出現真實車廠、車隊、贊助商、商標。
- **不要自行 push**，要 Rex 明說才推（push `main` 會直接部署到線上）。
- **不要用線上站（taipei-gp.vercel.app）測試**，只用本機 `npx vite preview --port 4317 --strictPort`（吃 `dist`，改完先 `npx vite build`）。
- 手機實機測試最後才做。
- 如實回報：失敗要貼數字；沒驗證的寫「沒驗證」；推論標「推論」。

## 改完任何東西都要跑
```bash
npm run build                                   # tsc --noEmit + vite build
cd tools/dev-tests && bash chain-stab.sh && cat chain-stab-out.txt
```
三個回歸基準必須一字不差：
- `bot&sim=120` → `BOT lap2 54.425 hits=0`
- `bot&gp&sim=400` → 冠軍 陳冠宇 162.0、aiHits 8
- `bot&gp&pittest&sim=400` → 陳冠宇 175.7、aiHits 5

對不上就回報，**不要改基準**。純畫面／聲音的改動不該動到基準；不要在模擬路徑（`step()`、`rivals.ts`、`car.ts`、`track.ts`）新增 `Math.random()` 或改 `pitRnd` 的呼叫順序。

## 工具提醒
- 測試腳本在 `tools/dev-tests/`（用 CDP 連無頭 Chrome，讀 `window.__gp`）。無頭 Chrome 很慢（0.7～2.7 fps），不要用「等幾秒」判斷，改用 `__gp.step(0.02)` 迴圈或 `&sim=`。
- 寫測試腳本請用檔案寫入，不要在 shell 裡用 `node -e` 內嵌（跳脫字元會弄壞）。
- 要證明「修好了」，做對照組：還原修改、build、確認舊行為重現，再換回來。
