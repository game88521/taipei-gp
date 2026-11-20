# Nexus 舊測試支架獨立審查

審查日期：2026-11-18。這份文件記錄對整合副本舊測試的獨立靜態複核，**不是重新執行測試，也不是測試通過報告**。審查僅讀取 before／after 原檔、逐檔完整差異、相關真產品入口與 SHA256；本次只新增這份文件，未修改測試、產品、不可變 before 或原專案，未建置、連線或操作 Git 狀態。

before 為 `../taipei-gp-nexus-before-999a1a3aa5b7`，after 為本專案 `taipei-gp-nexus-work`。before 承接已套回但未提交的 Horizon build `999a1a3aa5b7`，不是以 Git HEAD 重建。其 660 檔 inventory SHA256 為 `ad0434d4cfee824963b4d4b3d8df1ec0301dbd62b8e1c034aaac98b6a6892c00`。

範圍為 before 已存在的頂層 `tools/dev-tests/*.mjs`，排除本輪新增 `nexus-*`。核對全部舊檔清單後，有 **27 檔修改、0 檔刪除**。27 檔的完整差異均已逐一檢視；未見原案例刪減或既有斷言放寬。唯一經 root 明確允許的期望變更，是下述 capabilities 精確擴充。測試執行者已確認這些腳本凍結；後續若任一 after SHA 變動，須重新審查受影響差異，不能沿用本文件的結論。

## 唯一允許的期望擴充

`tools/dev-tests/tenpack-multiplayer-server.mjs` 保留同一個 `assert.deepEqual`、同一份真 server snapshot，以及原四個旗標的精確值，僅新增本輪已實作的兩個能力：

```js
// before
{ lobbyOptions: true, championship: true, roomRules: true, horizon: true }
// after
{ lobbyOptions: true, championship: true, roomRules: true, horizon: true,
  nexusArena: true, replay: true }
```

沒有改為子集合斷言、存在性檢查或忽略額外欄位。其他已改舊測試沒有變更原斷言的期望值、比較方式或案例數。

## 支架與來源載入調整

城市／競速 VM 補入 `nexusCoop: undefined`、`nexusWorkshop: undefined`，表示舊模式下新模式未啟動；沒有把真產品函式換成固定成功回傳。Scene／client loader 補入真 `arenaDriver`、`arenaCollision`、arena validator 與 replay parser 等新相依，以及 `arenaRevision: 0` 初始欄位。

UI 支架補入真預設控制設定、控制鍵標籤、arena／replay 模組、真 Three namespace，以及被新 UI 使用的最小 DOM 方法。原 UI、生命週期、網路、物理與儲存斷言保留。

`main-economy-integration.mjs` 的 AST 事件選擇器新增排除 capture listener。原因是產品在既有維修交易 callback 前新增隔離模式 capture guard；一般模式交易測試需繼續抽取原本的非 capture callback。原交易斷言保留，未繞過交易函式或把交易結果替換為 fixture 常數。新模式隔離的驗證應由新模式測試負責，不能用本靜態審查代替。

## 時鐘調整沒有放寬期限

`next6-multiplayer-deadlines.mjs` 的 `pair()` 原本就以 `now: () => now` 注入受控時鐘，也原本就提供 `setNow`。本輪只在四次既有操作前，將該 clock 同步為**同一次呼叫原已使用的時間參數**：

|操作|相對 `room.startAt` 的原時間|保留的原斷言|
|---|---:|---|
|第一次 `expireDisconnected`|9999 ms|尚未 DNF|
|第二次 `expireDisconnected`|10000 ms|`disconnect-expired`|
|`maybeFinish`|600000 ms|較早斷線原因不被全場逾時覆蓋|
|停頓房的 `tick`|5001 ms|進入 results，全部原因為 `server-stall`|

沒有移動斷線時刻、提高上限、縮短等待、取消驗證器，或以額外 tick 幫產品跨過原不應跨過的邊界。同步讓 `this.now()`、傳入 `now` 與後續 snapshot 的時間一致；真 server 在相同呼叫期間也是同一時間來源。原 9999／10000 毫秒邊界、600000 毫秒全場期限與 5001 毫秒停頓條件均保留。

`next6-multiplayer-ui.mjs` 新增 `client.serverNow` 常數，供新增 arena panel 的介面使用；原 `deadlineText` 案例仍明確傳入 `100000`、`159500`、`160500`，精確斷言 `1:00`、`0:01`、`0:00`，並保留 results／舊 server 不顯示虛構期限的斷言。此常數未取代原倒數邊界檢查。

## 逐檔 SHA256

以下檔名均相對 `tools/dev-tests/`，雜湊為檔案原始 bytes 的 SHA256。

|檔案|before SHA256|after SHA256|
|---|---|---|
|`abcd-street-regression.mjs`|`1b892f86325925d834a431b38af0de3a5a1690345927d02dd7033332e97d9bb2`|`94c1c7efe1de5a6303d76f2a32df83866da30ed87b172899ae9918cddc831c8b`|
|`all-navigation-regression.mjs`|`43717ab0688200972202da2915b6b88fe18f8b1a703172bdbfb511457d99a2f3`|`a0565ffeb4c9e89a3feb0773fc917332eff85f7348915d3e4eb30508a35ad74f`|
|`all-street-main.mjs`|`6932a63b11ecf6a579c59bb000751ad09576642ab1f117453cb40592526a135d`|`f590f2a27fca69a529a4c93cd0c1758eb8a31783b7fe309097c43f53332dee34`|
|`evolution-city-save-main.mjs`|`42f9573d3c883e49d30867ba5b200e1f23044b5a9b1e4d8163b8ab3b120a7832`|`388eca7f2146abd1954a6879430f67288a492d63355178f35073c445077ee6d9`|
|`evolution-racing-challenges.mjs`|`b0271bd14f3a8cdd4388c33799c7c3b19b534b51be45c3cd07eea74dd451087a`|`1a43af64dcf60860c06e7aae68af3a2dd9eccd64e352d89e8ddef114964b7a62`|
|`followup-platform-regression.mjs`|`4660e0ed9fef3365cd8873920cc1a1bf6c1eafc74b9b51da35ff81141740862c`|`1176b70328aa0edee6c9a5956311b0fe24587a7c2d54bb0f8bfb655040a3eb81`|
|`horizon-racing-node.mjs`|`1bfb454fa9f6aba4514305925cc609a13427c35448b3d4a343f59a8f2053df3f`|`45df9d5f95d042c94fe334e6c6fe9813f39fd9ad01b088b09a225f16e7f3169b`|
|`lobbybrake-client.mjs`|`256745a21f6d8bd85983b4ec070be17addbbdd0dbcf8acd27f5bd249605c228a`|`be0a8e3b70d46d0ad505c7deb950ef06c240cc2fceeead48b13650862201be56`|
|`main-economy-integration.mjs`|`32b372b1f3c23cc28c8fa8e68d8c40db071de697d3e707de23249c106bc65376`|`7c046772959cbbe3f638913016205bd5a5b5fed905925b1beeecb3ec291aee3a`|
|`main-platform-integration.mjs`|`f6db6c92a9d281449cd315a28ba83162e7134dc91ffbbd4871fdc72027bc3af1`|`a8f750e839e3b08b81e4441ade23d48c2f034a136030e5c6b70b4673b1dce9af`|
|`main-racing-integration.mjs`|`795a22965c8e416591d5a4e0f348c27cfb96c8216a484b24be1ee0116a7a36d6`|`ef57603bb0ba4e7e4204054eeb9a6dcda650154c4c17d4b07762f446e17da469`|
|`multiplayer-client-regression.mjs`|`940ac1fb605fe4c98fbe92f3e3894c0e1e862df88c8f69304ae6381921df3b77`|`544c075ce3db39fd790b7ec0ea8f2a68b4d1629a68370a32378aef1cecb0e2e9`|
|`multiplayer-collision-client-regression.mjs`|`5951649548ecd6fcb4da11dfcaff895ae611b18138ac54be113ade4577c348a7`|`f920fde0fa2472af321825d8499d7e98e9431b7225ccc5e0587310e64f683f62`|
|`multiplayer-map-ui-lifecycle.mjs`|`3c221ee9603b616917b323f940888821d64b943473ae0069a09b8c729308fe81`|`bb2be7d2751c0f41acc3bee069f3ff360f055c7cfe6e89ad59169e1ca25db332`|
|`next6-city-main.mjs`|`c11fbf8a1e8e6f9f73fa8725163811ee2ecceba08dda2483584079cf53dad401`|`1c045a7e9ffc98746eaced99aab9a9f7e08fbee9bbd52d3b253c381d0c33632b`|
|`next6-multiplayer-deadlines.mjs`|`927f19c5da3c0f8f9897633e2638e0a4adf0fda12abe8d281a6f94b43a452002`|`d5506390b146fb59fcc8dc32b3012a7f6ac50e26a61f8145315be25467f2e3d0`|
|`next6-multiplayer-pacing.mjs`|`e96c942a976316bd69fdc141a62508a776511777432e2643585a482b2cde043a`|`55f6bdf4693ae9b5dd858beebeea20d39a58841af92183d52d3eadbd98a3799d`|
|`next6-multiplayer-ui.mjs`|`2648a8b8c24198b89da6e5a6560d799a6abf414599ac640ffe42a0d62bca578a`|`fcedf85bff5cd12694f29ce7569aceb8b5c3853592db2a0de9627fe168114e7b`|
|`next6-racing-regression.mjs`|`9b7bec45691134ed7bd3b01650f7c6bf50edb5bf0d8cb6c69ac73bc0b4d95a27`|`c629c671f27cca7bc1108d4778c85ee5cfc47b1a1b07764b0592c664f700a7e4`|
|`raceplus-laps-regression.mjs`|`93c5f2b273e448f3bae9428ac33c45c19e6dc2051012460436925a32feff8209`|`71956a33b1987016eae7d35765feb4a2811eac6909fe50f13029e4016a920e00`|
|`tenpack-multiplayer-models.mjs`|`da79e9937f68367e99176aa6d06c1c84c6e00eae259565ad8e354bf105c6f14d`|`34bc25c5e7af976f868bd2282b49781bffbf66d6ecea0fb8b7afad46a729333b`|
|`tenpack-multiplayer-server.mjs`|`4dd430bea87feb5836a7a24b77434208c1a181cf5e64d4fbd0bd911cfeac8b5e`|`e3d0fe5b9e5b0370474c2484435fee6c3c68aaa0acdcc623ea4fff310a0f623d`|
|`tenpack-tour-cancel.mjs`|`13b9576d4fec86f38a5be34aa629c74334051ebff126aee4b7f754cc8c690f5d`|`6e49f350ed2b1b246d64030d92e84868745d3bbfa56468f4a9a86c8118f76e12`|
|`twelve-city-entry.mjs`|`24138d92ab78c745de8231edd4b68a34cb705e4a6be96ab35c7295d96d5f61b9`|`dd9970642efb192f1b1fce8f3e1e5c4e549f6a8f242cc0249d0271fffbdbd362`|
|`twelve-city-models.mjs`|`394d023a670a554e8abcf70c0bbb2dc52f39736277e1e201527980585ee7ca5d`|`367ad4f1b4fbad3c9386f7b4a6bfb57a12214e6ed5a56a57ec5e823e63c4db14`|
|`twelve-multiplayer-fixtures.mjs`|`62e36513a76c70bfb054735ea2ff0e01f7204e2d040cf800958264f986703c0c`|`c982ef5569d6c06003d5df72f38a60684f558b659690696bea911170efec03fb`|
|`twelve-racing-regression.mjs`|`af21a104568665a67b23c4089558990863417c33a3263ec28461f6a8e51d586a`|`fd3217dd4c5f1ba2cfc1bdab1c0d5f71999f39d58c2f3ef25ba668d8db8bb2eb`|

## 結論與限制

就上列固定 bytes 的靜態差異，允許本輪舊測試支架更新；未發現藉刪案例、刪斷言、放寬期限或替換真產品結果使回歸通過的改動。唯一期望擴充如前述 capabilities 所列。

本文件不證明測試已執行或通過、不提供新的案數、不驗證 GPU／真人駕駛／真手機／外網，也不授權修改固定三基準。實際執行結果、當輪來源／腳本綁定與封存證據仍由 `NEXUS_VALIDATION.json` 與各 runner report 提供。root 已將已審查的四個新增修改舊檔明確納入交付工具白名單，明確項目由 73 增為 **77**：`tenpack-multiplayer-server.mjs`、`next6-racing-regression.mjs`、`next6-multiplayer-ui.mjs`、`multiplayer-map-ui-lifecycle.mjs`；這不擴大核心產品或物理檔案的權限。交付工具執行驗證由 root 另外負責，不計入本靜態審查。
