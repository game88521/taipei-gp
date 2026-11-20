# Frontier 本機驗證

作者：Rex <game88521@gmail.com>。封版日期2026-11-21，build **caeeecc35bef**，基準HEAD a387c72bec2931411957063aaa63120a59122749、前輪build d5068bed213b。

- 完整npm build：PASS，真process exit 0。
- Node／服務：34套PASS，來源與執行腳本hash穩定；最終Node、瀏覽器、固定三依序執行。
- 真Chrome獨立context：14套／96案PASS，同一build、零外站請求、零未處理例外、資源清理完成。
- 固定三基準：BOT lap2 54.425 hits=0／陳冠宇162.0 aiHits8／陳冠宇175.7 aiHits5。
- car／track／rivals／pitlane四核心SHA256與932檔before快照完全相同。
- Docker COPY集合隔離啟動5案PASS；不是image build。

## 最終服務回歸

| Suite | Status |
|---|---|
|frontier-friends|PASS|
|frontier-radar|PASS|
|frontier-room|PASS|
|expedition-social-client|PASS|
|frontier-city-replay|PASS|
|frontier-city-replay-capacity|PASS|
|frontier-replay-download|PASS|
|frontier-social-watch|PASS|
|frontier-duty-watch|PASS|
|frontier-duty-replay|PASS|
|frontier-city-reconnect|PASS|
|frontier-social-reconnect|PASS|
|frontier-duty-reconnect|PASS|
|frontier-performance-core|PASS|
|frontier-performance-history|PASS|
|frontier-performance-ui|PASS|
|frontier-incidents|PASS|
|frontier-incidents-service|PASS|
|frontier-convoy-models|PASS|
|frontier-convoy-service|PASS|
|frontier-crown-models|PASS|
|frontier-crown-cleanup|PASS|
|frontier-crown-service|PASS|
|frontier-rally|PASS|
|frontier-rally-road|PASS|
|frontier-duty-missions|PASS|
|frontier-duty-roads|PASS|
|frontier-tandem-practice|PASS|
|frontier-cup|PASS|
|frontier-integration|PASS|
|expedition-main-restore|PASS|
|expedition-duty|PASS|
|expedition-social|PASS|
|expedition-racing|PASS|

## 最終瀏覽器回歸

| Suite | PASS | FAIL |
|---|---|---|
|frontier-friends|6|0|
|frontier-room|4|0|
|frontier-city-watch|8|0|
|frontier-city-replay-import|3|0|
|frontier-city-reconnect|10|0|
|frontier-performance|11|0|
|frontier-incidents|8|0|
|frontier-convoy|7|0|
|frontier-crown|6|0|
|frontier-rally|9|0|
|frontier-duty-missions|9|0|
|frontier-tandem-practice|8|0|
|frontier-cup|6|0|
|frontier-mode-switch|1|0|

## 原始失敗與對照

所有before FAIL均保留原文，不計入PASS：備份槽測試27→31是舊測試假設；王冠清理先跳時鐘的次序由真WS延後server-drop重現，改測試等待authority-close後通過；長回放測試原自製server漏定時權威tick，會觸發正確4秒watchdog，修fixture恢復正常broadcast，不放寬期限；回放stop後保留隱藏共用王冠物件，舊測試誤要求children為0，已改驗同一共用物件隱藏且所有場次資源解除。候場按鈕覆寫、追走錯入口、還車resume／導航／切換、舊小場ready、王冠末tick與事件滿額一致性等產品修正皆有各項報告的before／after證據。詳見各功能文件與證據包。

## 驗證邊界

- 實體手機、真手把、跨網路真人、玩法平衡、免費主機容量、30分鐘實機溫度／耗電未驗證；桌面viewport不能列作實機PASS。
- 效能採樣的draw CPU不是GPU時間；0.65解析度的像素量減少57.75%，不等於FPS提升。
- 巡遊與定速拉力另有真FreeCar完整道路證據；救援六腿完整道路不等於真人精準停靠。救援browser明示停靠fixture；四人盃browser明示finish fixture，完整真Car／WS四場由Node另驗。
- 追走browser用真Input／FreeCar錄製，停renderer後以固定步加速；不是真人時間試駕。中立跟隨0分基準驗規則，不宣稱真人正分平衡。
- COPY隔離smoke是Windows Node24啟動集合驗證，沒有執行Docker／Alpine image build。
- 本輪只使用localhost，沒有commit、push或部署。前後端上線須同步：city-duty-v2、city-rally與新增能力；公開網址目前不包含本輪。

最後實機計畫：tools/dev-tests/frontier-phone-test-plan.md。報告、原始FAIL、截圖、下載檔等封存至 DCISI/taipei-gp-frontier-validation-evidence；來源精確清單與證據SHA在FRONTIER_VALIDATION.json。套用只用本輪CAS工具，先備份後逐檔建置核對，不能用Git HEAD覆蓋上輪86個未提交改動。

## 同版服務回歸沿用

34套Node已在本build通過；之後只修正獨立瀏覽器fixture，沒有產品或Node runner變更。最後重跑瀏覽器前及封版時，逐檔重新核對Node報告中的全部產品來源SHA與runner SHA，完全相同才沿用原PASS，不將沿用結果假稱重新執行。救援觀戰的舊單事故完成fixture缺v2任務明細，新增控制2PASS證明舊快照被拒絕，修後由真service.step完成最後卸載、產生有效明細後才廣播，未放寬產品parser。

瀏覽器同版沿用套件：frontier-friends、frontier-room、frontier-city-watch。每份報告的build、產品及helper來源SHA、套件script SHA、零外站／例外與cleanup均重新核對；其餘套件由失敗處接續真實執行。所有沿用均保留原時間與結果SHA，不偽造fresh執行。
