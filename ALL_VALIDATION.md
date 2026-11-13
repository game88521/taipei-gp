# 全模式優化驗證

最終 build **ae3c201679c2**；產品來源 SHA256 **181fd12a7acccdee92b302afb8612c70264d417c231d57d420e632700712ba63**。TypeScript＋Vite build 通過。基準為含既有未提交內容的 `811385b20e05`，不可用 HEAD 取代；原專案套用狀態另見 DCISI 本輪 apply-result／original-verification。沒有 commit／push。

## 結果

- 最終 **26／26 套**程式測試通過，測試期間產品來源 hash 不變。入口 `node tools/dev-tests/all-checks.mjs`。
- 固定回歸 **3／3**：BOT **54.425 hits=0／aiHits0**；GP 陳冠宇 **162.0／aiHits8**；進站 **175.7／aiHits5**，未更改基準。
- 本輪瀏覽器共 **59 項**通過，測試版本逐項列於下表；使用本機4317及外部Chrome的新隔離context，不碰玩家storage或正式站。
- 套用工具獨立fixture **12／12** 通過：備份、保留舊未提交／未追蹤、整批拒絕、重入、回滾及build失敗保留；未在fixture測試中套用真原專案。

| 瀏覽器證據 | 通過 | 實測build |
|---|---:|---|
| all-platform-browser-results.json | 7／7 | 3706620d7568 |
| shots-all-racing-browser.json | 13／13 | 3706620d7568 |
| all-street-browser.json | 13／13 | ae3c201679c2 |
| shots-all-city-browser.json | 7／7 | ae3c201679c2 |
| shots-abcd-ui-browser.json | 8／8 | ae3c201679c2 |
| shots-followup-ui-browser.json | 7／7 | ae3c201679c2 |
| shots-abcd-lifecycle-regression.json | 4／4 | ae3c201679c2 |

平台及賽車瀏覽器通過後，最後修正只有街賽設定正規化、探索容量及觸控CSS，分別由最終街頭13項、城市7項、進度5項與全26套重新驗證。平台Q下載管理含真SW、5塊實際下載／SHA、斷網讀取與限定刪除；新季及回放27控制項另以44px門檻重審通過。

## 重要對照與修正

- U／V／X 有封存before重現及after對照；部分損壞錢包救援還原12,345，啟動前WebGL建構0次。
- W 真城市三個道路中點樣本每10秒重算由40／2／40次降為各1次；不是手機FPS或耗電量測。
- Y 使用真賽果與積分同分排序；短季不領23站專屬完整獎勵。
- M 真暫停→reload→續接前後均剩114.98秒；I以真freeStep推進完整60／90秒。街賽檢查點與地標位置由測試準備，未宣稱真人完整駕駛成績。
- 真城市護照顯示2,466地標，存檔上限已由2,000調至10,000，真城市完整列表保存重載通過。系列次站結果僅保留三項賽事設定，不嵌入舊results。

## 失敗與測試調整紀錄

早期平台browser有runner跳脫錯誤、街頭runner曾以dt0未刷新HUD；已保留原始結果並修正工具。街頭實際43px結算按鈕失敗已修為48px並重測。city HUD檢查補回直向viewport及真可見性，護照filter、載客／系列勾選標籤也補觸控尺寸。

一次並行測試的下載idle案例先碰到總timeout而失敗；未改期限或斷言，單獨重跑通過。最終入口將毫秒級timeout案例先單獨執行，其餘仍並行，26套全數通過。首輪與重跑證據分別保留於shots-all-node-first-final.json及shots-all-platform-regression-rerun.txt。舊AST／dataURL loader僅增加真依賴及新UI操作，未改固定數值／放寬斷言。

## 重跑

工作副本：`npm.cmd run build`、`node tools/dev-tests/all-checks.mjs`。Chrome9333可用後：

```powershell
$env:GP_CDP_PORT='9333'
& 'C:\Program Files\Git\bin\bash.exe' tools/dev-tests/chain-stab.sh
node tools/dev-tests/external-browser.mjs 9333 all-city-browser.mjs
node tools/dev-tests/external-browser.mjs 9333 all-street-browser.mjs
node tools/dev-tests/external-browser.mjs 9333 all-platform-browser.mjs
node tools/dev-tests/external-browser.mjs 9333 all-racing-browser.mjs
```

在原專案重跑程式對照需設GP_BASELINE_DIR指向DCISI/taipei-gp-priority-before-20261111、GP_FOLLOWUP_BASELINE_DIR指向taipei-gp-followup-before-2dee076、GP_ABCD_BASELINE_DIR指向taipei-gp-abcd-before-3bdf97336c02、GP_ALL_BASELINE_DIR指向taipei-gp-all-before-811385b20e05。原生pagehide另需GP_ABCD_MICROTASK_SOURCE指向DCISI/taipei-gp-pagehide-microtask-before.ts。詳細結果與逐案例限制見ALL_VALIDATION.json；手機實機最後另做，尚未執行。
