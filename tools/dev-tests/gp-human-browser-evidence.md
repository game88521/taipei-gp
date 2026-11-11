# 非 BOT 大獎賽瀏覽器整合證據

2026-11-11；本機 build `99f984fced89`。結果：**3 組 PASS、0 個 Runtime 例外**。

執行方式（由既有專用 Chrome 建立獨立 context，結束只清除測試 context）：

```powershell
cd tools/dev-tests
node external-browser.mjs 9333 gp-human-browser.mjs
```

測試程式：`gp-human-browser.mjs`；完整輸出：`gp-human-browser-result.json`。

## 已驗證

1. 本機 `http://127.0.0.1:4317/?q=low&notraffic`，未使用 `bot`。透過設定 UI 關閉排位，再由賽道選單開始大獎賽，正常倒數到 `race`，共 22 台車。
2. 使用既有 `__gp` 準備最後圈，再執行真實 `step(1/120)`。11 步後玩家在 `150.09166666666658` 秒衝線，進入 `settling`；真正的 `finishRemainderAsync()` 呼叫一次，21 位 AI 繼續依真物理完賽，時間介於 `151.83333333333167` 至 `157.45833333332655` 秒，接續進入 `podium`。錢包 `1000 → 2500`、冠軍收支只有一筆 `+1500`、勝場只增加一次。
3. UI 跳過頒獎到結果表，再開啟回放。執行真實 main／Three.js 動畫 callback，保留 WebGL，僅降低 canvas 解析度。回放樣本的雨勢由 `0` 到約 `0.791`，胎色由中性胎黃到硬胎白，維修樣本正確拆輪。每次回放取樣後，全場物理 snapshot 都與完賽時相同。結束回放後四輪縮放恢復 `1`，結果表共 23 列（表頭加 22 台車），錢包及獎金交易筆數沒有再增加。

## 測試界線

- 末圈車位、圈數、比賽時間與乾／濕／維修樣本由測試準備，**不是完整實際駕駛**；AI 背景完賽使用真正的物理及計圈。
- 為控制時間，維修樣本在尚未裝回輪胎時直接結束；此人工截斷不代表正常停站，也不能用來判定正常停站存在輪胎殘留問題。本次只驗證歷史拆輪顯示及結束回放清理。
- 本案例沒有 AI 超時 DNF；超時、取消與重試另由 `racing-state-audit.mjs`、`main-racing-integration.mjs` 覆蓋。
- 未測賽季瀏覽器重載、完整正常停站回放、手機實機、FPS 或畫質。
- 未測線上站、未修改產品程式、未新增產品 debug 入口、未 commit／push。
