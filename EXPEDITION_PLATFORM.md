# Expedition 1／2／3：連線呈現、效能與 HUD

作者：Rex <game88521@gmail.com>。這份說明實作與量測範圍，最終結果以 EXPEDITION_VALIDATION.json 為準。

## 連線畫面平順度

多人賽道頁的設定提供「平衡／反應優先／平順優先」，保存於 `taipei-gp-expedition-network-v1`。選擇只改變遠車快照的緩衝餘裕，延遲維持 80～220ms；平順模式會多等待畫面資料，不能消除真實網路延遲。

- 自車立即採用伺服器碰撞後的位置及速度。畫面最多保留 0.65m 接觸偏移，以每秒30的指數速率收斂；大幅移位、重設及換場直接重置。
- 遠車只有在正常駕駛、非接觸時可依兩個有效快照短暫外推，最多70ms。停包時停在封頂末點，不在200ms門檻退回舊位置。
- 離線、未載入、幽靈、進站、接力非駕駛、DNF及完賽車不外推。最後對呈現副本做車身分離；不改權威快照、進度、圈數、速度衝量或成績。
- 20案實際 Scene／Car 回歸覆蓋三種手感、延遲、抖動、遺失與900ms停包，以及停止狀態。瀏覽器另驗真雙人 WS 與連續碰撞模型。這些受控情境不等同公網試駕。

## 效能採樣與動態解析度

主遊戲設定及多人頁都有「效能採樣與報告」。按開始後駕駛，回設定停止並下載 JSON；不自動上傳。記錄實際動畫回呼、繪製 FPS、p95幀時間、長幀、draw calls、三角形及幾何／貼圖數；Chrome若提供會附 JS heap。

- 選單、暫停與背景不列入駕駛樣本。最多保留900個約一秒視窗。
- 多人自動畫質增加解析度調整：連續慢視窗降低，連續穩定快視窗才逐步恢復，範圍0.65～1。輸入傳送與模擬時鐘不變。
- 真 WebGL drawing buffer 在0.65比例時，像素數下降57.75%，代價是畫面較軟。這是繪圖工作量指標，不能換算成特定手機 FPS 或耗電改善。
- 30分鐘資料保留上限使用合成時序驗證；瀏覽器採樣是本機短測。沒有宣稱完成30分鐘實機負載、溫度、耗電或實際 GPU 記憶體量測。

## 自訂 HUD

主遊戲設定與多人設定可開啟「自訂 HUD 版面」。拖曳預覽元件、使用位置滑桿，或聚焦元件後按方向鍵（Shift加大步幅），再儲存；取消不寫回，重置只影響目前裝置的版面。

- 主遊戲：時速、計時、名次、小地圖、狀態。多人：時速、圈數計時、名次、近車資訊。
- `taipei-gp-expedition-hud-v1` 分為 main／multiplayer 與 desktop／mobile 共四個 profile。觸控裝置或寬度小於700px使用手機 profile。
- 座標正規化保存，顯示時依畫面及元件尺寸夾限；不移動方向盤與踏板。編輯器開啟時停止遊戲輸入。
- 只還原被覆寫的位置 CSS，不還原遊戲動態的顯示／隱藏樣式。損壞資料、儲存錯誤及其他頁面已變更時保留原文，本次版面仍可暫用。
- 瀏覽器驗證原生拖曳、鍵盤、取消、儲存、重新載入、主遊戲／多人共存，以及390×844、844×390、844×220。這些是桌面 viewport 模擬。

## 測試指令

先依 AGENTS.md 建置並啟動本機 preview；瀏覽器使用專用 CDP9334。瀏覽器套件序列執行。

```powershell
node tools/dev-tests/expedition-platform-node.mjs
node tools/dev-tests/multiplayer-collision-client-regression.mjs
node tools/dev-tests/multiplayer-collision-server-regression.mjs
node tools/dev-tests/expedition-platform-browser.mjs
node tools/dev-tests/multiplayer-collision-browser.mjs
```

手機與實體手把驗收留到最後，見 `tools/dev-tests/expedition-phone-test-plan.md`。本輪不透過正式站測試。
