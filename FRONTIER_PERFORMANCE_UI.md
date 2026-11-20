# Frontier 第 5 項：本機效能採樣介面

作者：Rex <game88521@gmail.com>。本代理只修改效能 UI／CSS 與專用驗證；metric 核心、摘要保存／備份、main／多人 render 計時由其他代理整合。沒有 commit、push、部署或線上測試。

## 操作與情境

- 保留設定頁原有非 modal `<details>` 與 `expedition-perf-start/stop/download-{scope}`，新增最多 40 字的安全文字標籤、解析度對照與明確保存按鈕。
- 解析度選項為「沿用目前／1.00／0.80／0.65」，只在本輪採樣套用，不永久保存設定；停止、60 分鐘上限、pagehide 或 dispose 都還原。採樣中變更比例會標示情境變更，建議固定條件比較另開一輪。
- mount 不會呼叫 `options.context()` 或 `onScale()`，避免 main 尚未初始化完成時讀到狀態。未採樣的 frame 也不呼叫 context provider。
- 開始時讀實際同源 module script 的 `/assets/*.js` 作為 `sourceEntry`；開發入口或無法識別時留空並明示，不以目前原始碼假稱已載入某個 build。
- 畫面顯示全程 wall、有效駕駛、接受樣本與覆蓋比例、回呼／繪製 FPS、p95、長幀、繪製提交 CPU、拒收／狀態切換樣本、排除原因、每 5 分鐘區段及首尾情境。p95 明示為 1ms 桶上界估計，CPU 明示不是 GPU 時間。
- 覆蓋比例使用 `acceptedMs / (activeWallMs + excludedMs.invalidDelta)`，避免無效長間隔被排除後看似完整流暢；排除原因仍逐項列出。
- 即使 metric 保留 3600 個視窗，DOM 只顯示全程摘要、最多 12 區段與最後一個視窗，不建立幾千列元素。

## 排除與還原

- root 每 frame 呼叫 `sample(dt,drawn,active|exclusion,renderer.info,{renderCpuMs})`。UI 只在 recording 時更新 context 並交給真 metric；未繪製時 calls／triangles 傳 0，也不傳前一幀的 CPU 時間。
- `visibilitychange` 在背景時呼叫 `meter.activity('hidden')`，返回前景先用 `inactive`，直到下一個真 sample 決定狀態。背景沒有 rAF 的時間仍由單調時鐘歸入排除，不歸為長幀。
- 背景事件使 60 分鐘上限到達時，UI 會當下檢查 recording 並還原，不等下一幀。
- 返回介面保留 `meter/panel/sample/dispose`，另提供 `stop()` 給 WebGL context lost 等生命週期使用。公開 stop／pagehide 只停止採樣並還原，不保存摘要、不變更遊戲模式或主存檔。
- 開始時 context 或套用 scale 失敗，採樣停止且嘗試還原，可重新開始。還原 callback 拋錯時會明示「重試還原解析度」；不將外部還原失敗假報成功，也不無限逐幀重送。
- stop／dispose 冪等，dispose 移除 visibilitychange 與 pagehide listener。

## 保存與下載

- 每次採樣只保留在本頁記憶體，按下「保存本次摘要」才呼叫 `PerformanceHistory.add()`。摘要使用獨立 `taipei-gp-frontier-performance-v1` key，最多五份與 100000 UTF-8 bytes，嚴格解析、CAS 與讀回確認由共用 store 負責。
- 損壞原文、配額或跨頁更新失敗都保留來源與本輪 RAM；完整報告仍可下載。不讀寫主存檔或私人席位 token。
- 「下載本次完整報告」保留 core report 的 scope／label／source／context／逐秒樣本；歷史每份另有明確「下載這份摘要」，不把摘要假當完整報告。
- 這些資料代表本機裝置與已記錄情境，不是外網負載或真手機 30 分鐘效能、溫度／耗電通過證據。

## 接線與驗證

第三參數：`{context:()=>PerformanceContext,onScale?:(scale:number|null)=>void}`。返回 `scale:number|null` 只代表目前採樣選定的覆寫比例。root 在對照期間凍結自動畫質／解析度，只調繪製，不改模擬。

新增 IDs：`expedition-perf-label/scale/save/status/source/totals/segments/window/history-{scope}`；歷史下載按鈕用 `data-performance-record` 綁匿名摘要 id。

```powershell
node tools/dev-tests/frontier-performance-ui-node.mjs
npx tsc --noEmit
```

專用測試 **8／8 PASS**，使用真產品 UI、metric、history，加上 DOM／單調時鐘／記憶體 storage 替身；來源與腳本執行期間未改動。覆蓋初始零 provider 呼叫、label/source 與 draw-only CPU、明確保存／完整下載、無 rAF 的 5 分鐘背景排除、無效 gap 與情境變更、3600 視窗與 12 段有界 DOM、上限還原、公開 stop／pagehide／dispose、callback 拋錯重試、損壞／quota／CAS 保存拒絕，以及五份歷史與來源未知情境。

報告：`tools/dev-tests/frontier-performance-ui-node-result.json`。TypeScript 通過。CSS 對控制提供至少 44px 尺寸並支援換行／短高度；390×844、844×390、844×220 的實際可點擊與捲動版面由 root 統一 CDP 驗證，本代理未將尚未執行的瀏覽器／真手機檢查標為通過。

## 最終統一回歸

2026-11-21 本輪build **caeeecc35bef**已完成34套Node／服務、14套瀏覽器與固定三基準，詳見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。本段是最後封版狀態；上文各次build、待root與before FAIL保留開發當時事實，未改寫原始證據。PASS只涵蓋本機實作與驗證；真機／外網／完整真人駕駛限制依統一報告，沒有commit、push或部署。
