# LobbyBrake 本機驗證與交接

本輪完成多人進房等待／取消／明確重試、大廳房主移除車手／交棒，以及依 GP 即時抓地力調整煞車提示與輔助線。功能與相容規則見 [LOBBYBRAKE_FIXES.md](./LOBBYBRAKE_FIXES.md) 及 [LOBBYBRAKE_HOST_CONTRACT.md](./LOBBYBRAKE_HOST_CONTRACT.md)。最終來源建置為 **c220d98a7f5c**，baseline 為 **57b09b2f3f78dffd5dadac0ca83581c01f9c42c3**、分支 `multiplayer-test`；本輪 before 建置為 `f8ca4b1d251c`。

**完整本機驗證已通過：新增 Node 68 案、舊 Node 118 案、原單人 26 套、最終版 browser 28 案、before 對照 2 案、固定三回歸及隔離 fixture 15 案全部 PASS。** 舊 Node 118 案由上一輪 42 案與既有多人 76 案組成；所有最終版 browser 與固定回歸均驗 build `c220d98a7f5c`。[LOBBYBRAKE_VALIDATION.json](./LOBBYBRAKE_VALIDATION.json) 已由 `DCISI/create-taipei-lobbybrake-validation.mjs` 嚴格核對，`status=PASS`，收錄 27 份報告與 22 個交付程式／測試來源雜湊；產品 SHA256 為 `a877800df9e2026a5ed0b19e36736f18e4cceb35bb5c9ab3e0f0daa5388fd56c`。本文件不替代實際 JSON 或套用狀態。

本文件於封裝前寫入，目前尚未套回原專案，沒有 commit、push 或部署。原專案後續實際狀態須核對 `DCISI/taipei-gp-lobbybrake-apply-result.json`、獨立 `DCISI/taipei-gp-lobbybrake-original-verification.json`、manifest 與逐檔現況；由 `DCISI/TAIPEI_GP_CODEX_HANDOFF.md` 追蹤，不由本來源文件推定。

## 驗證組合

| 組別 | 案例／套數 | 目前狀態與報告 |
|---|---:|---|
| 房主管理真 server／真 client | 18 + 14 | PASS；`lobbybrake-host-result.json`、`lobbybrake-client-result.json` |
| 入口等待協調器／真控制器 UI | 10 + 9 | PASS；`lobbybrake-entry-result.json`、`lobbybrake-ui-result.json` |
| 即時抓地提示模型／真 main、world 整合 | 9 + 8 | PASS；`lobbybrake-assist-model-result.json`、`lobbybrake-assist-main-result.json` |
| 上一輪策略／逐圈／邀請回歸 | 10 + 4 + 9 + 12 + 7 | PASS；本輪重新執行的 `raceplus-*-result.json` |
| 原多人 client／真 WS server／換圖 UI | 25 + 14 + 8 | PASS；`shots-multiplayer-maps-client-regression.json`、`multiplayer-server-summary.json`、`shots-multiplayer-map-ui-lifecycle.json` |
| 原多人 UI／期限／繪圖節奏／碰撞 client | 4 + 6 + 3 + 16 | PASS；`next6-multiplayer-{ui,deadlines,pacing}-result.json`、`multiplayer-collision-client-result.json` |
| 原單人回歸 | 26 套 | PASS；`multiplayer-node-summary.json` 及其 evidence 子結果 |
| 新多人／GP 抓地提示 browser | 9 + 4 | PASS；`lobbybrake-browser-result.json`、`lobbybrake-assist-browser-result.json` |
| 本輪 before browser 對照 | 1 + 1 | PASS；`lobbybrake-browser-before.json`、`lobbybrake-assist-browser-before.json` |
| 原多人圈速／策略／期限 browser | 7 + 3 + 5 | PASS；`raceplus-browser-result.json`、`raceplus-strategy-browser-result.json`、`next6-multiplayer-browser-result.json` |
| 固定三回歸 | 3 | PASS；`multiplayer-maps-fixed-summary.json` |
| 安全套用隔離 fixture | 15 | PASS；`DCISI/taipei-gp-lobbybrake-delivery-fixture-result.json` |

專案測試報告均位於 `tools/dev-tests/`。新增 Node 共 68 案，上一輪 Node 回歸共 42 案，既有多人 Node 共 76 案；最終版 browser 共 28 案、本輪 before 對照 2 案。各組存在重疊覆蓋，26 套與分項案例不相加為獨立功能數。

三固定基準逐字一致，未更新期望數字來通過：

- TT：`BOT lap2 54.425 hits=0`，`aiHits 0`。
- GP：冠軍 `陳冠宇:162.0`，`aiHits 8`。
- 進站：冠軍 `陳冠宇:175.7`，`aiHits 5`。

## 證據與版本綁定

本輪 work 為 `DCISI/taipei-gp-lobbybrake-work`；不可變 before 為 `DCISI/taipei-gp-lobbybrake-before-f8ca4b1d251c`。inventory 為 `DCISI/taipei-gp-lobbybrake-baseline.json`，共 **515 檔**，SHA256 為 `d9e2ad65d1989fae60b153d11a9323f036f21557c8cb4b409170610cf4f5f692`。它包含前幾輪已套回但未提交的成果，不以 Git HEAD 還原。

彙整工具只讀取既有本機證據，不執行測試、建置、網路、封裝或原專案操作，唯一輸出為本專案 `LOBBYBRAKE_VALIDATION.json`。它會核對：

- 全部 515 個 before 檔與 inventory；不在 allowlist 的既有來源須保持原 bytes。
- `src/car.ts`、`src/track.ts`、`src/rivals.ts`、`src/pitlane.ts`、`server/physics.mjs` 五項核心未變；本輪允許改動 main、world、獨立提示模型、多人大廳與相關 UI。
- 所有允許交付的新增／改動程式及測試腳本 SHA256，並拒絕報告未知的來源別名。文件及彙整 JSON 不放入 `sourceHashes`，避免循環雜湊。
- 報告所記錄的全部 `sourceHashes`、`beforeHashes`、script hash、提示模型參考 hash；舊 RacePlus 對照仍綁其 `38335611f205` before，碰撞對照仍綁原碰撞 before，本輪對照則綁 `f8ca4b1d251c`。
- 最終 browser 與固定回歸須使用目前 build；本輪 before browser 必須為 `f8ca4b1d251c`。兩份 before 報告實際使用保留的 `DCISI/taipei-gp-raceplus-work` 既有 dist，因不可變 before 未產生 dist。這個 control project 只以明確白名單接受，另逐檔核對完整 515 份 inventory bytes 與 `f8ca4b1d251c` 建置；before 的報告來源雜湊仍核對不可變 snapshot。browser 例外與外連須為空，新增 browser 須明確完成 context／preview／service 清理。
- 與 `multiplayer-checks.mjs` 完全相同的路徑、排序與 bytes 所得 `productHash`，26 個確切套名、各份子結果 raw SHA256，以及結果摘要的 byte-identical evidence 副本。
- 其他報告 raw SHA256、已有的 summary 副本、固定三基準原始輸出、15 案隔離 fixture，以及四支本輪交付工具的定稿 SHA256。
- 歷史 `NEXT6_FIXES.md`、`NEXT6_VALIDATION.md`、`NEXT6_VALIDATION.json`、`RACEPLUS_FIXES.md`、`RACEPLUS_VALIDATION.md`、`RACEPLUS_VALIDATION.json` 六檔原 bytes 完整保留。

部分舊測試未自帶 script hash；彙整會核對所有已提供的來源資訊，另記錄當下測試腳本指紋。原 26 套另外以精確 `productHash` 綁定產品來源。彙整前後若來源、證據或 build 改變即拒絕完成，歷史驗證 JSON 不當成本輪結果。

## 重跑命令

以下在 `DCISI/taipei-gp-lobbybrake-work` 執行；Node 需支援直接載入 TypeScript，VM 測試使用 `--experimental-vm-modules`。保留相鄰的本輪 before、RacePlus before 及碰撞 before，因個別腳本會載入原始對照來源。

```powershell
npm.cmd run build
node --experimental-vm-modules tools/dev-tests/lobbybrake-host.mjs
node --experimental-vm-modules tools/dev-tests/lobbybrake-client.mjs
node --experimental-vm-modules tools/dev-tests/lobbybrake-entry.mjs
node --experimental-vm-modules tools/dev-tests/lobbybrake-ui.mjs
node --experimental-vm-modules tools/dev-tests/lobbybrake-assist-model.mjs
node --experimental-vm-modules tools/dev-tests/lobbybrake-assist-main.mjs
node --experimental-vm-modules tools/dev-tests/multiplayer-checks.mjs
```

上一輪五支 `raceplus-*.mjs` Node 回歸及原多人七支 Node 命令見 [RACEPLUS_VALIDATION.md](./RACEPLUS_VALIDATION.md)；須在本輪 work 重新執行，不能採用該歷史文件或 JSON 作為本輪通過證據。碰撞 client 的 `--baseline` 維持 `../taipei-gp-collision-before-f586ca9`。

browser 需既有獨立 CDP Chrome，預設 9334。每支測試建立並清理自己的本機 preview、服務及隔離 context；所有 browser 與固定回歸循序執行。新版測試前清除舊 `LOBBYBRAKE_EXPECT_BEFORE`、`LOBBYBRAKE_BROWSER_PROJECT`、`LOBBYBRAKE_ASSIST_BROWSER_PROJECT`、`RACEPLUS_EXPECT_BEFORE`、`RACEPLUS_BROWSER_PROJECT`、`RACEPLUS_STRATEGY_BROWSER_PROJECT`、`NEXT6_EXPECT_BEFORE`、`NEXT6_BROWSER_PROJECT`，避免誤測 before。

```powershell
node tools/dev-tests/lobbybrake-browser.mjs
node tools/dev-tests/lobbybrake-assist-browser.mjs
node tools/dev-tests/raceplus-multiplayer-browser.mjs
node tools/dev-tests/raceplus-strategy-browser.mjs
node tools/dev-tests/next6-multiplayer-browser.mjs
node tools/dev-tests/multiplayer-maps-fixed.mjs
```

本輪多人 browser 使用 preview 4330、WS 4331；抓地提示 browser 用 preview 4332。原多人圈速 browser 用 4325／4326、策略 browser 用 4327、原期限 browser 用 4319／4322；固定三基準用 4318，均不操作現有 4317。

本輪 before 對照以 `LOBBYBRAKE_EXPECT_BEFORE=1`，並分別將 `LOBBYBRAKE_BROWSER_PROJECT` 或 `LOBBYBRAKE_ASSIST_BROWSER_PROJECT` 指向保留 `f8ca4b1d251c` 建置的 `../taipei-gp-raceplus-work` 再執行相同腳本。不要修改不可變 before 來補建 dist；彙整工具會額外核對該 control project 的全部 515 份來源。抓地提示 browser 另支援 `LOBBYBRAKE_EXPECT_BUILD` 指定預期 build；回到新版前必須清除 before 設定。

全部結果完成後回到 `DCISI`：

```powershell
node test-taipei-lobbybrake-delivery.mjs
node create-taipei-lobbybrake-validation.mjs
```

## 實測範圍與限制

- 入口測試只重試 WebSocket 握手；原單次 7 秒、重試間隔 1.5 秒、總上限 45 秒。真本機 HTTP upgrade proxy 安排 503／等待／恢復，沒有模擬房間訊息，不代表 Render 免費服務實際啟動時間。傳輸開啟後的房間操作不自動重送。
- 房主管理由真 loopback server、真 client 及三個隔離 Chrome contexts 驗證交棒、權限、移除通知、憑證撤銷、停止自動重連及手動新身分重入。移除不是封鎖，未實測不同網路或長時間四人對戰。
- GP 模型測試使用真胎種／磨耗／濕度的抓地計算；browser 安排相同位置、速度及抓地，驗真 HUD 文字與 Three.js 線色 buffer。這不證明真人整圈改善、所有地圖平衡、實際煞停安全速度、FPS 或耗電。
- 844×220 的既有策略摘要與煞車 warning 上緣約有 8px 重疊，文字主體仍可見；390×844 直式時，橫握提醒疊在 warning 下緣。不能宣稱提示完全無遮擋；極短視窗與直式提示排版仍可改善。
- 手機尺寸為桌面 Chrome 模擬。DOM 邊界、捲動與可點擊控制項通過，不等於手機實機、真觸控手勢或整體介面完全無重疊；手機實機留最後驗證。
- 新 server 的管理能力欄位為 v2 加法相容；舊 server 省略能力時隱藏管理入口，不能從新版前端單獨推定遠端 server 已支援。physics 維持 `classic-multitrack-collisions-v3`。
- 原邀請 clipboard／share 採替身，未發送訊息；原圈速 browser 安排私有 server 狀態，未真人完整駕駛三圈。策略估值誤差、外網碰撞、全 24 圖逐圖完整駕駛、真 BFCache、音效聽感及手機耗電未驗。
- browser 曾出現取消請求後，CDP 攔截 ID 已失效的測試診斷錯誤；失敗證據保留。定稿腳本僅對本機、且已有取消事件佐證的失效 ID 記錄診斷，其餘錯誤仍判失敗；最終重跑未觸發該 race 並 PASS。這不能解讀為真實網路或產品效能改善。

## 安全套用

只用本輪 `DCISI/Apply-TaipeiLobbyBrake.ps1`。無參數先唯讀預檢；`-Apply -Build` 才先備份，再套用、建置與逐檔核對。交付包保護全部 515 檔 baseline、未知既有檔、五項核心與六份歷史文件，檔案衝突或來源／驗證不符即拒絕。15 案 fixture 的 Git／建置為隔離替身，不代表原專案已實際執行。

不要重跑舊 Apply／Publish，也不要用 Git HEAD 覆蓋未提交成果。本輪未授權 commit、push 或部署；日後明確獲准提交時，繁體中文訊息並使用 `Rex <game88521@gmail.com>`。
