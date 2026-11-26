# Lantern 介面交接

署名：Rex <game88521@gmail.com>

## 範圍與順序

1. 手機大廳分為玩家、房規、賽事；保留原始控制節點、ID、事件與伺服器狀態。640px 以下為可用方向鍵切換的分頁；較寬畫面保留完整進階表單。準備／開始／離開固定於手機底部，搭配真實名單的準備、載圖與續接摘要。手機高視窗將原操作列移至 body，避開面板 backdrop-filter 形成固定定位容器；離開大廳會隱藏，較寬或低高度視窗、軟體鍵盤出現時移回文件內排列。既有「定位玩法設定」會先揭露所屬分頁。
2. 24 圖均有真實來源中心線的 SVG、資料起點、地點與約略圈長，可展開搜尋。原生 select 保留；快速開房只修改草稿，最後確認才切圖、建立房間。預覽不建立 Three 場景，也不另行抓地圖。SVG 是來源中心線的選單縮圖，並非處理過後的精確煞車圖。
3. 閱讀 125%／150% 保留每個 h1／h2／h3／h4 原始字級與行距比例。只在新增標題或尺寸改變時批次量測，避免網路快照觸發全頁重測。原 HUD 舒適設定、儲存格式與行車尺寸維持原機制。
4. 合作救援、單人定速拉力、社交模式（含 CTF 城市搶旗）、耐久接力與跨圖錦標賽加入「目標／你的職責／計分」圖卡，全文收在可展開的完整規則。現在要做的提示依實際角色、倒數、到站、持冠、持旗、作業階段、暫停、結束或中止更新；HUD 顯示同一提示，不虛構進度。

## 檔案

- `multiplayer.html`：掛載大廳呈現模組。
- `src/lantern-lobby.ts`、`.css`：分頁、準備列、延後掛載面板分組。
- `src/lantern-track-picker.ts`、`.css`：原生選單旁的路線卡與搜尋。
- `src/harbor-quick-room.ts`：快速開房串接路線卡。
- `shared/lantern-ui-tracks.ts`：中心線正規化與取樣，僅供選單。
- `tools/build-lantern-track-previews.mjs`、`shared/lantern-ui-track-previews.json`：來源 SHA 核對後產生 24 圖預覽；正常 build 在多人 catalog 後執行。
- `src/lantern-reading.ts`、`src/harbor-accessibility.ts`、`.css`：保留閱讀標題層級。
- `src/lantern-rules.ts`、`.css`、`shared/lantern-ui-rules.ts`：圖卡、全文展開、由實際狀態產生提示。
- `src/expedition-duty-ui.ts`、`src/meridian-racing-ui.ts`：只加入介面與提示掛接；未變更遊戲規則。
- `src/beacon-mode-launch.ts`：定位前發出 `lantern-reveal`，使手機隱藏頁可先揭露。
- `tools/dev-tests/lantern-ui.mjs`、`lantern-ui-browser.mjs`：新驗證。
- `tools/dev-tests/harbor-reading-browser.mjs`：將過時的固定標題 30px 斷言改為實測原始字級的 1.5 倍。

沒有 `main.ts`／`index.html` hooks 需要另補。沒有變更四個模擬核心。

## 驗證

已執行：

```powershell
node tools/build-lantern-track-previews.mjs
node tools/dev-tests/lantern-ui.mjs
npx.cmd tsc --noEmit
node --check tools/dev-tests/lantern-ui-browser.mjs
```

- 24 個來源 SHA、24 條獨立真實中心線、有限座標／長度檢查：PASS。
- 提示測試含角色交換、到站、區外持冠、倒數、候場、救援暫停／結束、賽事中止：PASS。
- 全專案 TypeScript：PASS。
- 新瀏覽器測試語法：PASS。

最終集中驗證的建置為 `a16fb2c38497`。`lantern-ui-browser.mjs` 在正常圖形設定的測試 Chrome 9336 執行，結果 **4/4 PASS、0 FAIL、0 JavaScript 例外、0 對外請求**：

- 真實本機巡航房依序進入 lobby、countdown、running，規則卡與 HUD 提示隨實際狀態更新。
- 42 個標題、8 種原始字級，在 125%／150% 保留比例；HUD 舒適設定沒有被改寫。
- 24 張賽道均使用對應來源 geometry 的中心線繪製獨立 SVG；可搜尋、選擇，草稿階段建立房間數為 0，當前場景不切圖。來源 SHA 與完整中心線對照另由 Node 測試核對。
- 390×844、844×390、390×220 尺寸分頁與原準備事件均可操作，方向鍵切換通過。在手機高視窗分別捲至 0／400／1200 時，實測操作列容器底緣與 viewport 底緣相差小於 2px，確認確實貼底。

結果見 `tools/dev-tests/lantern-ui-browser-result.json`，截圖與對應證據目錄由該報告的 `evidence` 欄位提供。完整 build、其他瀏覽器套件與三個物理回歸基準由 root 的集中驗證報告統一列出，本文件不推定其尚未回報的結果。單獨重跑介面驗證的指令：

```powershell
node tools/dev-tests/lantern-ui-browser.mjs
```

此腳本沿用 `frontier-browser-harness`，僅連本機 4317／4320 與既有測試 Chrome，不自行啟動 preview／Chrome。正常圖形測試使用 `GP_MULTIPLAYER_CDP_PORT=9336`。先前 SwiftShader 設定曾發生 CDP 長時間無回應；正常圖形設定下及本次集中測試未重現，不能把軟體繪圖失敗宣稱為已通過。

## 限制

- **尚未驗證真實 iPhone 17／Safari／VoiceOver**；390px 與橫向等尺寸是桌面 Chrome 模擬，不能替代手機實機測試。
- 原始中心線縮圖不宣稱對應所有遊戲幾何平滑、路面寬度或高架層級。
- 不提交、不推送、不部署，也不測試正式網站。

集中封版補充：本機build a16fb2c38497 的16套完整回歸全通過，固定三基準與四核心bytes保持；最後結果以LANTERN_VALIDATION.md為準。
