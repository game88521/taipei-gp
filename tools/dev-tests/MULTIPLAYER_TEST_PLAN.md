# 私人房連線競速測試

只用本機服務及隔離資料。結果依每次 JSON 中的來源雜湊與時間為準；下方是重跑方式，不表示公開服務或手機已驗證。

## 權威伺服器

在專案根目錄執行：

```powershell
npm.cmd run build:multiplayer
node tools/dev-tests/multiplayer-server-regression.mjs
```

建置共用 `tools/build-multiplayer-physics.mjs` 產生與前端同源的物理 bundle。測試另開隨機 loopback 埠，不占用一般遊戲服務；透過真 WebSocket 傳入方向與煞車，測試時鐘只在 Node 工廠內注入，沒有網路快進、位置或完賽接口。

十四組案例涵蓋：Origin／路徑、版本與名稱、四人與滿房、準備與同步起跑、輸入格式與序號、無輸入自動煞車、真物理完整圈與名次、重連及房主移交、首位完賽六十秒寬限、逾期 DNF、倒數中斷線、空房清理、全場／伺服器停頓期限、容量／訊息／速率限制。

完整圈案例讀取伺服器實際車況選擇方向，透過 WebSocket 傳入合法控制；不改車況、距離、圈數或比賽狀態。成績由伺服器分段及終點判定，測試不提供預期完賽時間。快照不能含其他人的重連 token。

證據為 `multiplayer-server-summary.json`，每輪另保留 `multiplayer-server-evidence-*`。最終結果要求 `status: PASS`、十四項 PASS、`sourceUnchangedDuringTests: true`，並核對 `sourceHashes` 與交付檔案。

## 原單人回歸

產品來源停止修改後執行：

```powershell
node tools/dev-tests/multiplayer-checks.mjs
```

沿用原二十六套的腳本、斷言及時間限制。各腳本舊輸出先暫存，本次新結果存入唯一 `multiplayer-node-evidence-*`，之後還原歷史輸出。`shots-all-node-summary.json` 不會被改寫；新總結為 `multiplayer-node-summary.json`。

最終要求二十六套全部 exit 0、`sourceUnchangedDuringTests` 與 `oldSummaryPreserved` 都為 true，各結果 `historyPreserved: true`。失敗時先讀本次 evidence 的 stdout／stderr，不使用舊 PASS 推定成功。

TypeScript／Vite 建置及原三項固定回歸另行執行，不包含在二十六套計數內。固定基準維持 BOT `54.425 hits=0`、GP 陳冠宇 `162.0`／aiHits `8`、進站 `175.7`／aiHits `5`。

## 真瀏覽器及手機

雙瀏覽器 runner `multiplayer-browser.mjs` 建立兩個獨立 browser contexts，九組涵蓋初始不開 socket 與隔離錢包、入口三尺寸、真建立／加入與大廳三尺寸、共同 matchId／startAt、真鍵盤及鏡頭／音效按鈕、真失焦持續煞車、offline 重連、persisted 事件續接、比賽三尺寸與離房後對手繼續。完整圈、成績與再戰另由下方單 UI＋真 WS 及權威伺服器測試涵蓋，不把九組雙 context 結果擴張為兩台實機完整比賽。不能為雙玩家測試停用既有存檔 Web Lock；每個 context 使用自己的隔離資料。

### 雙 context 目前結果：9334 正常 GPU，9／9 PASS

build `c27a6eb50a74`、`multiplayer-browser-evidence-1794536582069-11ee85d3` 已完成 **9／9 PASS、exit 0**。CDP 9334 的 SystemInfo 實際回報 Intel Iris Xe／ANGLE Direct3D11、WebGL 與 GPU compositing enabled；兩個場景皆使用真 renderer，`setupRenderIsolation.requested` 與 `pausedOnlyAWhileBLoads` 都為 false，沒有啟用舊隔離旗標或修改產品。

```powershell
$env:GP_MULTIPLAYER_CDP_PORT='9334'
node tools/dev-tests/multiplayer-browser.mjs
```

預設 CDP 埠仍為 9333；預期 build 從本機 `dist/sw.js` 讀取，也可明確用 `GP_MULTIPLAYER_EXPECTED_BUILD` 指定。每次 CDP 操作仍限制三十秒，其餘原有期限與九組斷言均保留。

第六組先在 A 自己的 context 建立並啟用原生 `about:blank` 分頁，明確等待 A 的 `document.hasFocus()===false`，再確認 B 為 true；沒有合成 blur 或覆寫產品焦點。摘要的 `realFocusPrecondition.achieved` 為 true、`focusState` 為 `{a:false,b:true}`。A 持續送出五個煞車封包跨 `3988ms`、速度降至 0，B 同時前進約 `210m`。該空白分頁隨 A 的 context 一起釋放，`blankDisposedWithContext` 為 true。

本輪 `localStorageUnchanged`、`sourceUnchangedDuringTests`、`productUnchangedDuringTests` 全為 true，例外／外部請求／封鎖外部請求均為空，兩個 context 均已 dispose。完整產品 SHA256 執行前後同為 `79c25ed69d7cb0ad04e37b00070bd091d0826f599f8107ab62dccca305346bbe`，演算法及範圍與原二十六套入口一致。入口／大廳／比賽的 `390×844`、`844×390`、`844×220` 共九張截圖及 JSON 均存於本次 evidence。

### 雙 context 歷史失敗保留

新硬體環境的第一輪 `multiplayer-browser-evidence-1794536409263-f478c4d4` 仍保留 **5 PASS／1 FAIL**。第六組斷言失敗時 A、B 的 `document.hasFocus()` 同時為 true，證明跨 context 的 `Page.bringToFront(B)` 沒有形成 A 真失焦的前置條件；因此只修正 harness 的原生分頁切換，再執行上述一次驗證，沒有放寬逐包煞車／方向、自車減速、對手前進斷言。舊 FAIL、兩張 failure 截圖與摘要完整保留，沒有改寫成 PASS；該輪結尾錢包核對未執行，不能宣稱全程存檔核對已完成。

原 CDP 9333／SwiftShader 環境的失敗也保留：build `8b6383026764` 的 `multiplayer-browser-evidence-1794477326234-17376e28` 在第二個場景初始化時 `Runtime.evaluate` 三十秒逾時。診斷輪 `multiplayer-browser-evidence-1794533940668-57b74180` 只在 B 初始化時暫停 A 的 render，恢復後入口截圖仍三十秒逾時；該輪一項 PASS、一項 FAIL，兩個 context 均已釋放。這些歷史輪未執行的案例不補算通過，也不再代表雙 context 的目前結論。

另有明確不同的備援 runner，使用一個真瀏覽器玩家及一個真 WebSocket 玩家，不表示雙瀏覽器通過：

```powershell
$env:GP_MULTIPLAYER_EXPECTED_BUILD='c27a6eb50a74'
$env:GP_MULTIPLAYER_CDP_PORT='9334' # 本輪完成驗證的獨立 Chrome；預設仍 9333，只連本機
node tools/dev-tests/multiplayer-ui-browser.mjs
```

此 runner 預定十一組案例：初始不連線與隔離錢包、三尺寸入口、UI 真加入及建立、三尺寸大廳與共同起跑、真鍵盤及鏡頭／音效按鈕焦點、真失焦煞車、離線重連、persisted 離頁／回頁事件、三尺寸比賽 HUD、真物理完賽及 UI 再戰、第二場與離房後對手繼續。每個 CDP 操作仍限制三十秒，完整圈條件等待最多一百八十秒；駕駛器只觀察快照並傳入方向／煞車，不改車況、進度、終點或伺服器時間。persisted 事件採合成事件驗證 disconnect／restore，未驗證真正 BFCache 命中。

build `8b6383026764` 的 `multiplayer-ui-browser-evidence-1794534486273-b995311e` 為 **4 PASS／1 FAIL**：入口及大廳的 `390×844`、`844×390`、`844×220` DOM／截圖、UI 加入／建立、遠端模型及共同 matchId／startAt 通過；進入第五組真鍵盤測試後 `Runtime.evaluate` 三十秒逾時。其後六組未執行。context 已釋放、來源測試期間未變、無外部請求；結尾錢包核對未執行，不能宣稱全程存檔不變。初次版本未記下逾時 expression，不能由此確定第五組具體停點；helper 已補記逾時 CDP 指令與 expression，尚待下一次實際結果。

同 build 的診斷輪 `multiplayer-ui-browser-evidence-1794535045502-8f002c67` 在第三組的真 WS peer 開啟時三秒逾時，結果 **2 PASS／1 FAIL**，尚未到起跑，故沒有 race trace。隔離 context 已釋放；本次失敗的 Node runner 已停止。runner 已修正 open 失敗時也關閉該 peer，未延長 WS 或 CDP 時限。

手機大廳按鈕排版修正後的 build `c27a6eb50a74`，原 CDP 9333 診斷證據 `multiplayer-ui-browser-evidence-1794535409814-9db76101` 仍為 **4 PASS／1 FAIL**。三尺寸入口／大廳、真加入及建立、遠端車與同一 matchId／startAt 通過；親看 `lobby-390x844.png`，準備按鈕已完整橫排。進入 racing 後，第五組第一個 `Page.bringToFront` 三十秒逾時，後續 snapshot／截圖／leave 也逾時，該輪未驗鍵盤、重連、成績與再戰。browser 端於第一次起跑前已啟動 `devtools.timeline`／V8 CPU／GPU tracing，但結束時 `Tracing.tracingComplete` 三十秒未回，**沒有取得 trace，無法由此確認 JavaScript 或 GPU 根因**。context 已釋放、來源未變、外部請求為零；結尾錢包核對未執行。此輪後停止原 CDP 9333 的 UI 重跑，保留失敗。

同 build 改用另一個獨立 Chrome（CDP **9334**）後，`multiplayer-ui-browser-evidence-1794536217624-18ed7d54` 最終 **11／11 PASS，exit 0**。SystemInfo 實際回報 `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics … Direct3D11)`、WebGL／GPU compositing enabled、sandboxed true；沒有停 render、修改產品、延長 WS 三秒或 CDP 三十秒限制。真方向／煞車、按鈕釋放焦點、失焦煞車、offline＋socket close 自動 resume、合成 persisted restore、三尺寸 HUD、真時間完賽／成績／UI 再戰、新 match 與離房後對手繼續皆通過。第十組以正常控制駕駛 `57868ms`，兩個伺服器成績為 `63675.022ms`／`64859.915ms`，順位 P1／P2。

本輪 `localStorageUnchanged`、`sourceUnchangedDuringTests`、`productUnchangedDuringTests` 全為 true，例外／外部請求／封鎖外部請求為空，唯一 context 已 dispose；產品 SHA256 為 `79c25ed69d7cb0ad04e37b00070bd091d0826f599f8107ab62dccca305346bbe`。三尺寸 DOM 與九張截圖均完成，另親看直向與低高度比賽 HUD。**診斷 trace 仍未取得**：`Tracing.tracingComplete` 三十秒逾時，`trace.status` 為 FAIL，與十一項功能驗證分開記錄；這次成功不能證明原 9333 逾時的 GPU 根因。先前雙瀏覽器失敗仍保留，雙 context 目前結論以上方 9334 九組結果為準。

runner 每個逾時保留 `cdpTimeouts` 的 method、params、起訖時間；`lastCdpCommands` 保留各連線末指令。若成功取得 `browser-race-trace.json`，可用 `node tools/dev-tests/multiplayer-trace-summary.mjs <trace路徑>` 離線列出 thread、長任務與 V8 取樣；此工具不構成功能通過證據。

每輪證據及三尺寸截圖位於唯一 `multiplayer-ui-browser-evidence-*`，摘要為 `multiplayer-ui-browser-summary.json`。完整通過要求十一項 PASS、`localStorageUnchanged: true`、`sourceUnchangedDuringTests: true`、`productUnchangedDuringTests: true`、所有 context 已釋放，且例外、外部請求、遭封鎖外部請求均為空。`productHash` 與原二十六套採相同演算法，包含 src／api／shared／server（排除 node_modules／.git）及相同根目錄／建置檔，避免只看多人入口檔而漏掉傳遞依賴變更；舊失敗摘要不補寫新欄位。舊摘要每輪先歸檔，不重用舊 PASS。

手機實機最後確認觸控操控、背景切換、行動網路延遲與重新連線。本機隔離 Chrome 的 UI／流程結果不代表兩台實機、手機 FPS、耗電、網路手感或公開 WSS 可靠度；原生 BFCache 命中、Render 與外網仍未驗證。
