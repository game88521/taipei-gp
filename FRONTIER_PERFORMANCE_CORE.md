# 第 5 項：有界效能採樣核心

署名：Rex <game88521@gmail.com>。核心位於 `src/expedition-performance.ts`；UI／真正 draw 計時、摘要儲存與備份由各整合模組負責。

## 容量與資料

每輪最多 **60 分鐘 wall time**、**3,600 個約一秒 row**、**12 個各五分鐘 activeWall 分段**。row 滿時保留前 3,600 個並設定 `rowsTruncated`，全程 aggregate 繼續累計至固定 wall 截止；不以最後幾個 row 冒充全程。沒有事件的背景期間不另開 interval，下一次 activity／sample／report／summary／stop 會把 timeline 截在原一小時截止點，不納入越界時間。

`wallMs` 只依注入的單調 clock，且等於 `activeWallMs + hidden + menu + map + inactive + invalidDelta`。clock 倒退不減少已記錄時間或延長截止。`acceptedMs` 另為通過檢查的 callback raw delta 總和，FPS 只用這段時間作分母；它不是 wall time。UI 必須同時顯示未採樣／跳過與排除時間。評估採樣覆蓋時宜將 invalidDelta 納入分母，避免只看排除壞 gap 後的 activeWall 而誤以為全程順暢。

`activity(reason)` 先結算舊狀態至事件當下，再切換原因，讓 hidden 期間即使完全沒有 rAF，仍能在前景事件精確結算。每次排除／恢復邊界的第一個 active callback 都跳過，不把跨背景／選單的 raw delta 算成 active 長幀。active 狀態遇到非法 delta（非有限、<=0、>2000ms）或真 callback clock gap >2000ms，該 wall 區間列 `invalidDelta` 並增加 `rejectedSamples`，不以引擎 clamp 後的小 dt 偽裝流暢。

`sample(s, boolean)` 舊介面仍可使用；false 對應 `inactive`。新的第二參數可直接傳明確排除原因。既有 `ExpeditionResolution` 原文保留，沒有改解析度遲滯、物理／輸入時鐘或 simulation 隨機串流。

## 指標

- callback 與實際 draw 的個數及 FPS 分開；未 draw 的 callback 不重複計上一幀的 calls／triangles／CPU。
- 嚴格記錄 `>50ms`、`>100ms` 的 callback 數量及最大 raw delta。
- 全程、各分段、各 row 各自維護 **1ms histogram**，p95 用 nearest rank 的桶上界估計，明標 `histogram-1ms-upper-bound`；不平均 row／segment p95。每個 histogram 固定 2,001 桶，不保存全程 frame 陣列。
- `renderCpuMs` 只在該次 `drawn===true`、CPU 值有限且 0～60,000ms 時納入。缺值保持 null，不補成 0。平均／最大值量的是 renderer 提交的 **CPU** 耗時，**不是 GPU 時間**。
- calls／triangles、geometries／textures 與可用時的 heapBytes 是計數／觀察值，不是顯示記憶體、溫度或耗電。

五分鐘分段依 activeWall 的固定區間，callback 歸落點段；精確落在 300,000／600,000ms 等邊界時歸前段。因此不拆一個 callback，不平均分段 p95，單段 acceptedMs 與 activeWall 區間可差一格。所有段的 acceptedMs、callback／draw／長幀／CPU 樣本與總耗時合計必須等於全程。

## 公開介面與 schema

`new ExpeditionPerformance(now?: () => number)` 可注入單調 clock；預設 `performance.now()`，沒有使用 `Math.random()`。`start(meta?)`、`stop(reason?: 'manual'|'dispose')`、`activity(reason|null)`、`setContext(context)`、`sample(s, active)`、`report()`、`summary()`；`recording` 與 `rows` 為 getter。stop 冪等；rows、report、summary、metadata 與所有巢狀資料均回傳／保存獨立副本。

`PerformanceExclusion` 精確為 `hidden | menu | map | inactive | invalidDelta`。`PerformanceContext` 全鍵必填：mode、track、quality、fpsCap、viewportWidth、viewportHeight、dpr、bufferWidth、bufferHeight、effectiveScale、players、streamLoaded、streamPending。`PerformanceMeta` 僅 scope（main／multiplayer）、sourceEntry、label（<=40字）、context。sourceEntry 是該頁實際載入的 `/assets/*.js` 路徑；未知為空字串，不重新 fetch sw.js 後冒充已載入版本。

`PerformanceSummary` v2 僅含 id（24 hex）、at／atMs（同一 UTC 毫秒）、meta、startContext、endContext、contextChanged、totals、segments、rowsTruncated、stopReason。stopReason 為 recording／manual／limit／restart／dispose。即使情境 A→B→A，`contextChanged` 仍為 true，不能僅憑首尾相同當成可直接 A／B 比較。

無 accepted callback 時，callback／render FPS 為 0，p95 與 CPU 平均／最大值為 null。`parsePerformanceSummary(unknown)` 是 history／backup 共用的嚴格 parser，拒絕未知鍵、非有限／越界數字、私席欄、錯 UTC、錯段覆蓋／段合計、矛盾 FPS／CPU 平均／p95 上界等，並回傳副本。它不強制 acceptedMs<=activeWall，保留舊受控 synthetic clock 呼叫的相容性；數字仍有安全上限。完整 rows 與 histogram 不進摘要儲存。

## 驗證證據

執行 `node tools/dev-tests/frontier-performance-core-node.mjs`，最終 **21 PASS／0 FAIL**，來源／腳本雜湊穩定，外部請求 0。

`tools/dev-tests/fixtures/frontier-performance-before.ts` 是從原專案唯讀複製的修改前實檔，SHA-256 `e916ac622e7837a030bf850b169e35ef0e842dab15ce19240862178ccfd965a1`。相同 1,800 個受控一秒 callback，舊版只留 900 row 且無全程 summary；新版保留 1,800 row、全程 1,800 callback 與六段。受控一小時精確得到 3,600 row／12 段並截停。

新增精確五分鐘邊界與矛盾 parser 對照，修改前 **19 PASS／2 FAIL** 保留於 `frontier-performance-core-consistency-before-result.json`：第一項發現第 300 秒 callback 被放入尚未匯出的下一段；第二項發現任意 callbackFps 可通過 parser。修正後同一組 **21 PASS／0 FAIL**。

其他案例覆蓋 callback60／draw30、CPU只算60次真draw、全程 p95=10ms 而錯誤平均 row p95=19.09ms、嚴格長幀門檻、無rAF背景分鐘、menu／map／inactive timeline、邊界跳過、非法delta與clock大gap、clock倒退、純背景一小時、資料副本、stop冪等與 Resolution 對照。摘要／備份既有專用測試另行重跑；真正 draw、畫面、固定三回歸由 root 整合驗證。

以上是受控 synthetic，不能宣稱已完成實體手機一小時 FPS／GPU／熱量／耗電長測。本代理沒有 build、CDP、commit、push 或測正式站。
