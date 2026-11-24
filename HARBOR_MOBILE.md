# Harbor：手機閱讀與對話框

Rex <game88521@gmail.com>

本輪基準為 `1e98cf6`，在 `taipei-gp-harbor-work` 本機副本開發。主力裝置為 iPhone 17／Safari；iOS 與 Safari 版本待記錄。以下 Node 與桌面 Chrome 證據均不代表實體 iPhone、VoiceOver、30 分鐘溫度或耗電驗證已通過。

## 修前證據與本輪處理

| 問題 | 可重現證據 | 處理 |
| --- | --- | --- |
| 主頁禁止縮放 | 舊 dist `fae95fac6d0e` viewport 含 `maximum-scale=1,user-scalable=no`；修前 browser 2/2 PASS；另查得 html/body CSS `touch-action:none` | 移除主頁 meta 限制；可見選單／結果／modal 才將根 touch-action 設為 pan-x／pan-y／pinch-zoom，駕駛仍維持 none |
| 缺少選單／房規／成績獨立字級 | 舊 dist 沒有 `harbor-reading-scale`，原 HUD comfort 控制存在 | 新增 100／125／150%，只作用閱讀 surface，舊 HUD 設定格式不變 |
| lazy modal 背景仍曝光 | 舊 dist 真實城市房對話框開啟後，背景 canvas／選單無 inert 或 aria-hidden | 共用 modal ownership，隔離目前 top modal 到 body 路徑的兄弟分支，關閉時還原 |
| 單送 pageshow 未清按住油門 | 真 `Input` 在 Node 事件模型，pointerdown 後只送 pageshow，throttle 仍 true | `installHarborMobile` 在 pageshow／pagehide／orientationchange 呼叫現有 `input.release()`；不是實機 Safari 缺陷重現 |
| 虛擬鍵盤縮小後無 visual viewport 量測 | 產品原無 VisualViewport hook；以縮小／offset 模型驗證 | 量測 VisualViewport 並調整目前 fixed modal；只有文字欄位聚焦且 scale=1 才辨識鍵盤 |

修復根節點 `touch-action` 後，Node 已驗證 navigation 只在可見閱讀介面設定；最終 build `f15b569a01d7` 的 browser 6/6 PASS，包含真自由駕駛時根與油門 `none`、暫停時根 `manipulation` 的 computed CSS。桌面 computed CSS 及 meta 宣告仍不等於實機 pinch 通過。

## 新介面與存檔

- `installHarborMobile({release})`：入口接既有 Input release，不自動續賽、不離房、不切模式。回傳 `refresh()`／`dispose()`；dispose 清除事件、RAF 與 viewport CSS。
- `installHarborAccessibility({fallbackFocus?})`：每頁單例。由 comfort 閱讀控制自動安裝；CSS 由 main／multiplayer 入口載入，保持純 Node loader 與備份 validator 相容。
- `mountHarborReading(host)`：掛入原 comfort fieldset。閱讀 key 為 `taipei-gp-harbor-reading-v1`，格式嚴格限定 `{v:1,scale:100|125|150}`；root 整合備份分類與 validator，舊 40 類備份仍須可讀。
- `parseHarborReading` 從 `harbor-accessibility.ts` re-export；純模型在 `harbor-accessibility-model.ts`。
- 閱讀保存採 exact raw CAS，包含 null。損壞、未來版本、過大、額外欄位、讀失敗保留原文且停止寫入；保存需讀回核對。Storage event 或 bfcache pageshow 重新讀取。
- 原 `taipei-gp-voyager-comfort-v1` 仍為原五欄 v1；新增 exact raw CAS、失敗訊息及讀回核對。閱讀選項事件不會冒泡誤寫舊設定。

## Modal ownership

掃描可見 `[aria-modal=true]`／`dialog[open]`，依層級與開啟順序選 top。只隔離 top 到 body 路徑每層的兄弟分支，不會 inert 其祖先。每支原 inert boolean、aria-hidden 原值（含不存在／false）均保存並原樣還原。

同時使用 capture focus／pointer／keyboard guard，協助不具 native inert 的環境；Tab 可雙向循環。關閉時優先尊重既有 UI 明確還原的合法焦點，再找仍連線、可見且屬於目前 modal 的來源／歷史／fallback。空 panel 的臨時 tabindex 會還原。這些是 DOM 行為，不等於已驗證 Safari accessibility tree。

既有 modal 匯入／匯出常暫掛 file input 或下載錨點於 body。只放行程式化 `input[type=file]` 與 blob／data `a[download]` click；實際背景按鈕及遠端連結仍受 guard。沒有關閉 modal 的共用副作用，沒有送出連線或房規動作。

## 已跑驗證

| 腳本 | 最新結果 | immutable 證據 |
| --- | --- | --- |
| `harbor-accessibility-node.mjs` | 12 PASS | `tools/dev-tests/harbor-accessibility-node-evidence-1795484550055-8ca83d25/report.json` |
| `harbor-mobile-node.mjs` | 7 PASS | `tools/dev-tests/harbor-mobile-node-evidence-1795484543760-b71f61ba/report.json` |
| `harbor-reading-browser.mjs --before` | 2 PASS（成功重現舊版缺口） | `tools/dev-tests/harbor-reading-browser-before-result.json` 指向 immutable evidence |
| `harbor-reading-browser.mjs` | **6 PASS／0 FAIL，build `f15b569a01d7`** | `tools/dev-tests/harbor-reading-browser-evidence-1795486140622/report.json` |
| 整合 build／三個固定回歸 | root 已完成 PASS | 全案結果與精確數值見最後交接；本文件不將它們算入手機實機 |

Node 報告含 source/script SHA-256、起訖時間、原始案例結果；時間戳 evidence 不覆蓋。另有同名 latest result 僅方便查詢。初次 PASS 仍保留；若後續失敗也須保留，不刪除原始證據。

中途修後 browser 曾在 build `b7c807b82e48` 跑 5/5 PASS，僅證明當時字級、modal 與 storage 行為；之後發現根 touch-action 漏項並修復，因此不能沿用該舊 build 作最終驗收。最終採上表 `f15b569a01d7` 的 6 案證據；報告確認 source／script 測試期間未變、context 清理完成、零外部請求及零例外。實體 iPhone 與 VoiceOver 仍依 [HARBOR_PHONE_TEST_PLAN.md](./HARBOR_PHONE_TEST_PLAN.md) 執行。

build `f15b569a01d7` 的首次新版 browser 首案曾 FAIL，保留於 `tools/dev-tests/harbor-reading-browser-evidence-1795485387026/report.json`。調查未改產品：獨立 background `about:blank` 真 Chrome probe 證明指定 `pan-x pan-y pinch-zoom` 時 computed CSS 會正規化為等價 `manipulation`，原斷言只找文字 `pinch-zoom` 因而失敗。原始 probe 在 `tools/dev-tests/harbor-touch-action-probe-evidence-1795485703414/report.json`；未載入 app、未啟動 harness、未占用本機後端。修正測試後接受上述等價值，仍拒絕 `none`／`auto`，駕駛 `none` 斷言維持，並保存 navigation readiness 前後原始值。此測試修正也不代表已驗證 Safari 手勢。

同 build 重跑曾為 4 PASS／1 FAIL，保留於 `tools/dev-tests/harbor-reading-browser-evidence-1795485867652/report.json`。截圖顯示第五案受 `save-conflict`「請重新讀取進度」保護覆蓋；原因是第四案人工派送 pagehide 同時觸發真實存檔 writer 的永久釋放保護，僅派送 pageshow 不應繞過該保護。測試現記錄這項副作用，下一案透過可見重新讀取按鈕的原生點擊載入新 document，確認 guard 關閉後才繼續原生自由駕駛／暫停測試。產品保護、hit test 及可達性斷言均未放寬。

最終截圖均位於 `tools/dev-tests/harbor-reading-browser-evidence-1795486140622/`：`after-city-dialog.png`、`reading-150-menu.png`、`reading-150-multiplayer.png`。後續 PASS 沒有覆蓋上述兩份 FAIL evidence。

## 本輪範圍

不改 `car.ts`、`track.ts`、`rivals.ts`、`pitlane.ts`；不改物理／碰撞／AI 隨機順序；不以畫面字級測試宣稱遊戲效能提升。不 commit、不 push、不部署、不測正式站。
