# 12 項優化：城市子項 3／4／11／12

日期：2026-11-17。此文件記錄 `taipei-gp-twelve-city` 子副本的實作與驗證；整合版 build、三基準與瀏覽器結果由 root 另外彙整。沒有 commit、push、連外或修改原專案。

## 實作

| 子項 | 行為與入口 | 主要檔案 |
|---|---|---|
| 3 普通接單／單次街賽取消 | 裝置授權或城市準備尚未結束時，返回、Escape、隱藏頁面、換模式、更新清單／選項都會使原意圖失效。按鈕等待期間停用；每次 await 後重驗頁面、按鈕歸屬與狀態；失敗後恢復按鈕。 | `city-entry-intent.ts`、`main.ts` |
| 4 跟丟預警 | 巡邏追緝距嫌犯超過 450m，直接顯示 `Police.escapeIn` 真倒數；3秒內紅色，其餘黃色；追回450m內立即清除。可選每秒一次短音。 | `police-warning.ts`、`main.ts`、`style.css` |
| 11 城市轉向導航 | 手動地圖導航及計程車沿原 `path/routeYs` 顯示下一轉向、沿路距離、地面／高架／地下。投影考慮高度及既有進度；換路線重算提示；以實際彎座標24m去重，保留相鄰不同轉彎的短音。計程車提示放在既有固定任務HUD，街賽保留原急彎提示。 | `city-guidance.ts`、`main.ts`、`index.html`、`style.css` |
| 12 同級車挑戰 v1 | 街頭對決新增「對手性能：原版固定對手／同級車挑戰 v1」。依所選車真實極速、加速、煞車、抓地力配置對手，再套既有難度倍率；三站系列固定原設定。 | `street-performance.ts`、`streetrace.ts`、`main.ts`、`index.html` |

兩個短音選項位於「設定 → 音效」，預設關閉；保存為 `save.opts['city-pursuit-sound']`、`save.opts['city-nav-sound']`。既有 save parser 已保留有界 boolean 選項，無須修改 schema。短音仍遵守原總音效開關。

同級規則為 `traffic-class-v1`／`clear-class-v1`。原 `traffic`／`clear` 計時分類不變，新規則由既有 `streetChallengeKey` 隔離；系列 checkpoint 也保存並驗證完整規則。繼續系列時只比對車流基底以容許 class 系列續接。原未分類 `save.street` 不被寫入。BOT 強制原規則、原車款。`street-f1` 配對使用原 `DEFAULT_SPEC`，不是車庫高性能 F1 規格。

同級對手仍用原街賽車外觀，UI 已明示。v1 是性能配置，尚未證明真人駕駛平衡或所有車款公平。導航使用幾何轉向，未辨識道路語意或提供語音報路；UI 說明提示僅供參考。

## 子副本已跑驗證

| 指令／證據 | 結果 | 範圍 |
|---|---|---|
| `node tools/dev-tests/twelve-city-entry.mjs --before` | 20／20 PASS | 對不可變 `taipei-gp-twelve-before-102e84eea8ea` 執行真main AST，重現舊授權／載入晚到仍啟動，以及重複入口呼叫。這裡PASS代表舊缺口可重現。 |
| `node tools/dev-tests/twelve-city-entry.mjs` | 23／23 PASS | 真main普通單、單次街賽 callback；返回、Escape、pagehide、改模式、更新清單、連點、合法操作、授權失敗及第二await取消／失敗恢復。 |
| `node --experimental-vm-modules tools/dev-tests/twelve-city-models.mjs` | 18／18 PASS | 真Police getter、警告／真HUD消費、導航左右轉／迴轉／平滑彎／沿路距離／高度／折返投影／同彎重規劃不重播／45m兩右轉各提示／取消；車庫真spec、class key／系列、真StreetRace能力；原版單挑／對決×三難度各1800步逐狀態與before一致；真main續接class系列保持原車／難度／規則，車流不符安全拒絕。 |
| `node --experimental-vm-modules tools/dev-tests/all-street-regression.mjs ../taipei-gp-twelve-before-102e84eea8ea` | 13／13 PASS | 既有街頭、甩尾、計程車核心回歸。 |
| `node --experimental-vm-modules tools/dev-tests/tenpack-city-regression.mjs` | 17／17 PASS | 原追緝勤務與觀光行程核心回歸。 |
| `node tools/dev-tests/main-platform-integration.mjs` | 11／11 PASS | 原真main平台測試。僅補新helper／真提示模型及DOM fixture，未修改原斷言。 |
| `node tools/dev-tests/main-economy-integration.mjs` | 8／8 PASS | 原交易與模式切換回歸。 |
| `node tools/dev-tests/all-street-main.mjs` | 6／6 PASS | 原真main街賽／系列／結算回歸。僅補真規則helper載入，未修改原斷言。 |
| `node tools/dev-tests/next6-city-main.mjs` | 12／12 PASS | 原街賽結果守門、第二await取消、城市碰撞管線；僅補新helper依賴。 |
| `node tools/dev-tests/abcd-street-regression.mjs` | 8／8 PASS | 原統計／成就／動畫／HUD節流與導航回歸；補真導航helper及未啟動練習fixture。 |
| `node tools/dev-tests/all-navigation-regression.mjs` | 4／4 PASS | 真城市長路段仍只六秒定期重算；偏離與單行環路回歸。 |
| `node --experimental-vm-modules tools/dev-tests/route-preview-audit.mjs` | 7／7 PASS | 真8條路線、SVG、急彎與20萬點邊界。`racing-test-env.mjs` 只補未受測車模陰影的匯出stub，呼叫仍會拋錯，未動業務斷言。 |
| `node tools/dev-tests/tenpack-tour-cancel.mjs` | 11／11 PASS | before先嚴驗不可變TenPack來源fbbd3c全文，還原原3處guard後仍嚴驗原ab3917 known-before全文SHA；after跑目前真main與真CityEntryIntent。只修歷史輸入來源／fixture，未改原known hash或業務斷言。 |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS | 子副本產品型別檢查。 |
| 真本機 `twelve-city-browser.mjs` | 14/14 PASS | 整合 build d251460c360c；例外／外部請求／對話框均0，包含三尺寸與真任務入口。 |

新 Node 報告含 `status`、`cases`、專案相對完整路徑的 `sourceHashes`、`scriptSha256`，並確認測試期間來源未變；DOM／外觀／玩家儲存空間為隔離替身。

近彎去重另外保留修前證據 `twelve-city-models-close-turn-before.json`：17 PASS／1 FAIL，失敗是相隔45m兩右轉的第二個短音被65m舊半徑吞掉；改實際座標24m後同一測試通過。該檔的FAIL是刻意保存的修前結果，不可當成目前整合版失敗或完成證據。

## 交由 root 的整合驗證

新增瀏覽器腳本 `tools/dev-tests/twelve-city-browser.mjs`，須複製至整合 work、build 後，由 root 的獨立 CDP 時段執行：

```powershell
node tools/dev-tests/external-browser.mjs <CDP> twelve-city-browser.mjs <本輪build> http://127.0.0.1:<preview>
```

腳本核對本機 `dist/sw.js`／preview build，使用 wrapper 的隔離 context，攔阻非本機請求，記錄 `exceptions`、`externalRequests`、`dialogs`、來源／腳本雜湊與 cleanup。案例包含兩種入口延遲取消及連點、真追緝倒數／選配音、真setNav後受控轉彎與高度、同級真選賽及完賽紀錄隔離、計程車導航、844×390／844×220／390×844 控件與HUD。Context由 `external-browser.mjs` 的 finally 在子腳本結束後釋放，腳本只回報自身覆寫恢復，不能提早宣稱 wrapper 已釋放。

子代理依排程**未執行完整build、CDP、三基準或手機實機**。三基準仍必須由 root 在整合版檢查：54.425 hits=0、162.0 aiHits=8、175.7 aiHits=5。未修改 `police.ts`、`taxi.ts`、`freecar.ts`、`router.ts`、`car.ts`、`track.ts`、`rivals.ts`、`pitlane.ts` 或伺服器物理，也未新增模擬亂數。

整合瀏覽器初跑5 PASS／1 FAIL：`#duel-back` 實際36×48px，小於44px寬度門檻；第二次13 PASS／1 FAIL：新音效選項label只有34px高。已將兩種返回鍵與新音效開關觸控區補至至少44px，保留原測試斷言後重建，最終 **14/14 PASS**，build **d251460c360c**。報告 `tools/dev-tests/twelve-city-browser.json`；context由外層wrapper finally清理，子報告只直接證明自身覆寫恢復。
