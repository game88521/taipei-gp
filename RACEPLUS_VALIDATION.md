# RacePlus 本機驗證與交接

本輪包含進站策略估值、多人逐圈／最快圈／冠軍差距，以及房碼邀請連結，功能說明見 [RACEPLUS_FIXES.md](./RACEPLUS_FIXES.md)。目前建置為 **f8ca4b1d251c**，來源 baseline 為 **57b09b2f3f78dffd5dadac0ca83581c01f9c42c3**、分支 `multiplayer-test`。

**本輪完整本機驗證已通過。** [RACEPLUS_VALIDATION.json](./RACEPLUS_VALIDATION.json) 已彙整 19 份報告，`status=PASS`，核對 22 個交付程式／測試來源雜湊；產品 SHA256 為 `263b8b728692918a5acb07f2247f7b19179da8acb02d32ab06b84c3f68dafd53`。下列各組全部通過，最終版 browser 與固定回歸均使用 build `f8ca4b1d251c`。後續來源變更須重新驗證；舊 `NEXT6_VALIDATION.*` 保留上一輪結果，不當成本輪證據。

本文件於封裝前寫入，當時尚未核對原專案套用，也未 commit、push 或部署。原專案是否已套用，以 `DCISI/taipei-gp-raceplus-apply-result.json`、獨立 `DCISI/taipei-gp-raceplus-original-verification.json`、manifest 與逐檔現況為準；後續狀態由 `DCISI/TAIPEI_GP_CODEX_HANDOFF.md` 追蹤，這份封裝來源文件不推定已套用。

## 已通過的驗收結果

| 組別 | 通過案例／套數 | 報告 |
|---|---:|---|
| 新增策略模型／真控制器 | 10 + 4 | `raceplus-strategy-result.json`、`raceplus-strategy-main-result.json` |
| 多人權威逐圈／新舊相容／結果列 | 9 | `raceplus-laps-result.json` |
| 邀請 helper／真控制器 | 12 + 7 | `raceplus-invite-result.json`、`raceplus-invite-main-result.json` |
| 原多人 client／真 WS server／換圖 UI | 25 + 14 + 8 | `shots-multiplayer-maps-client-regression.json`、`multiplayer-server-summary.json`、`shots-multiplayer-map-ui-lifecycle.json` |
| 原多人 keyed UI／期限／繪圖節奏／碰撞 client | 4 + 6 + 3 + 16 | `next6-multiplayer-{ui,deadlines,pacing}-result.json`、`multiplayer-collision-client-result.json` |
| 原單人回歸 | 26 套 | `multiplayer-node-summary.json` 及其唯一 evidence 目錄 |
| 新多人／新策略／原多人瀏覽器 | 7 + 3 + 5 | `raceplus-browser-result.json`、`raceplus-strategy-browser-result.json`、`next6-multiplayer-browser-result.json` |
| 舊版瀏覽器對照 | 3 + 1 | `raceplus-browser-before.json`、`raceplus-strategy-browser-before.json` |
| 固定三回歸 | 3 | `multiplayer-maps-fixed-summary.json` |
| 安全套用隔離 fixture | 12 | `DCISI/taipei-gp-raceplus-delivery-fixture-result.json` |

專案報告均位於 `tools/dev-tests/`。新增 Node 共 42 案、既有多人 Node 共 76 案、最終版 browser 共 15 案、舊版對照 4 案；26 套與分項案例有重疊覆蓋，不相加為獨立功能數。

三個固定基準逐字一致，未修改基準：

- TT：`BOT lap2 54.425 hits=0`，`aiHits 0`。
- GP：冠軍 `陳冠宇:162.0`，`aiHits 8`。
- 進站：冠軍 `陳冠宇:175.7`，`aiHits 5`。

## 證據與版本綁定

彙整工具 `DCISI/create-taipei-raceplus-validation.mjs` 只讀取既有本機結果，不執行測試、建置、封包、網路或原專案操作，唯一輸出為本專案 `RACEPLUS_VALIDATION.json`。它會：

- 核對不可變 before 的 504 檔與 inventory；其中已包含上一輪 34 個未提交修改，不以 Git HEAD 還原。
- 核對 car、track、rivals、pitlane、`server/physics.mjs` 五檔未變；`main.ts`、`strategy.ts` 與相關 UI 為本輪允許改動。
- 依 `apply-taipei-raceplus.mjs` 的 allowlist 收錄所有交付程式與測試腳本的 SHA256；文件與彙整 JSON 本身不放入 `sourceHashes` 循環雜湊。
- 嚴格核對報告已記錄的產品／測試來源雜湊、最終 browser build、例外與外連紀錄；舊版對照須是 `38335611f205`，不拿舊版 build 代替新版證據。
- 使用與原 26 套入口相同的路徑、排序及 bytes 重算 `productHash`，並逐檔核對 26 份實際 result 的 SHA256。
- 嵌入報告、報告 SHA256、12 案 fixture 與四支 RacePlus 交付工具雜湊；保留 `NEXT6_FIXES.md`、`NEXT6_VALIDATION.md`、`NEXT6_VALIDATION.json` 原 bytes。

部分既有獨立測試沒有記錄完整來源雜湊；彙整檢查其所有已記錄來源，另以 26 套 `productHash` 與 browser 最終 build 綁定產品版本。彙整時若來源、證據或 build 變動會拒絕完成。

## 重跑命令

以下於 `DCISI/taipei-gp-raceplus-work` 執行，保留各腳本所需的相鄰 before 目錄。建置與一般 Node 測試可用：

```powershell
npm.cmd run build
node --experimental-vm-modules tools/dev-tests/raceplus-strategy.mjs
node --experimental-vm-modules tools/dev-tests/raceplus-strategy-main.mjs
node --experimental-vm-modules tools/dev-tests/raceplus-laps-regression.mjs
node --experimental-vm-modules tools/dev-tests/raceplus-invite.mjs
node --experimental-vm-modules tools/dev-tests/raceplus-invite-main.mjs
node --experimental-vm-modules tools/dev-tests/multiplayer-client-regression.mjs
node --experimental-vm-modules tools/dev-tests/multiplayer-server-regression.mjs
node --experimental-vm-modules tools/dev-tests/multiplayer-map-ui-lifecycle.mjs
node --experimental-vm-modules tools/dev-tests/next6-multiplayer-ui.mjs
node --experimental-vm-modules tools/dev-tests/next6-multiplayer-deadlines.mjs
node --experimental-vm-modules tools/dev-tests/next6-multiplayer-pacing.mjs
node --experimental-vm-modules tools/dev-tests/multiplayer-collision-client-regression.mjs --baseline ../taipei-gp-collision-before-f586ca9
node --experimental-vm-modules tools/dev-tests/multiplayer-checks.mjs
```

瀏覽器測試需可用的獨立 CDP Chrome，預設埠 9334。每支腳本會建立並清理自己的本機 preview／WebSocket／隔離 context，請循序執行，避開固定回歸與其他 browser 同時競爭。

```powershell
node tools/dev-tests/raceplus-multiplayer-browser.mjs
node tools/dev-tests/raceplus-strategy-browser.mjs
node tools/dev-tests/next6-multiplayer-browser.mjs
node tools/dev-tests/multiplayer-maps-fixed.mjs
```

多人 browser 使用 preview 4325、WS 4326，策略 browser 使用 preview 4327，原多人 browser 使用 preview 4319、WS 4322；固定三回歸使用獨立 4318。舊版對照分別以 `RACEPLUS_BROWSER_PROJECT`／`RACEPLUS_STRATEGY_BROWSER_PROJECT` 指向保留的舊版建置，並設 `RACEPLUS_EXPECT_BEFORE=1`；執行新版前須清除這些環境設定。重跑原多人 browser 也須清除舊 `NEXT6_BROWSER_PROJECT`／`NEXT6_EXPECT_BEFORE`，以免誤測舊版。

全部結果完成後，回到 `DCISI` 執行：

```powershell
node test-taipei-raceplus-delivery.mjs
node create-taipei-raceplus-validation.mjs
```

## 實測範圍與限制

- 策略模型比較公開胎種參數、當下濕度及近期有效胎耗，未校準實際進站估值誤差或區間涵蓋率，不預讀未來雨勢／維修結果。
- 逐圈 Node 使用真 `RoomService`、Car 與過線插值，含安排的測試位置／時刻；browser 以私有測試 server 安排一致圈速，不代表真人完整駕駛三圈。
- browser 為同機隔離 Chrome contexts 與本機 WebSocket；viewport 為桌面模擬，未驗手機實機、觸控手勢、外網延遲、長時間四人對戰、耗電或真實 FPS。
- 邀請中的 clipboard／share 使用替身；未呼叫系統分享、發送訊息或更動公開網址權限。朋友仍需有目前部署的存取權。
- wire protocol 維持 v2；舊 server 完全省略逐圈欄位時仍可用，會顯示未提供圈速。完整逐圈資料需同步更新 server。
- 外網真人碰撞、全 24 圖逐圖完整駕駛與音效聽感未驗證；手機實機最後才做。

## 安全套用

工作副本為 `DCISI/taipei-gp-raceplus-work`，不可變 before 為 `DCISI/taipei-gp-raceplus-before-38335611f205`，inventory 為 `DCISI/taipei-gp-raceplus-baseline.json`。只使用本輪 `Apply-TaipeiRacePlus.ps1`；封裝完成後，無參數先唯讀預檢，`-Apply -Build` 才備份、套用、建置與逐檔核對。不要重跑舊 Apply／Publish，也不要以 HEAD 覆蓋既有未提交成果。

若未取得本輪明確發布授權，不 commit、push 或部署；之後獲准提交時使用繁體中文訊息與 `Rex <game88521@gmail.com>`。
