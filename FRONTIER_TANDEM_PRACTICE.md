# 第11項：追走單人陪練

作者：Rex <game88521@gmail.com>。離線領跑鬼車與獨立陪練成績，不冒充真人連線，也不寫單人錢包／圈速。

固定紫電GT／晴天，先錄10～120秒、至少50公尺的實際駕駛軌跡，再從同一條軌跡後方15公尺試跑。錄製與跟隨各有3秒倒數；選單／背景暫停 active 時間。錄完先留在本頁，明確按保存才取代舊鬼車；無效、太短、跳步或傳送資料不取代原文。

原樣本約50ms一筆，最多2402筆／1MB UTF8；時間嚴格遞增、間隔最多200ms、速度及位移與高度跳動有界。播放採短弧朝向插值。鬼車沒有車碰，原場景靜態障礙仍由自己的FreeCar處理。

得分條件：同層差小於1.8公尺、落後3～25公尺、橫向偏離不超過8公尺、朝向差不超過0.7rad、雙方至少7m/s、追車正向速度至少3m/s、滑角0.14～1.05rad。距離、滑角及橫向偏差共同決定品質，品質×秒×100計分。碰撞後1秒停止得分並斷連段。HUD逐項指出過近、過遠、超前、錯層、側偏、朝向、速度、滑角不足／過大、碰撞保護等原因。

完整跟完才發一次結果；重置、離開或無效資料不保存未完成分數。最近30次結果在 `taipei-gp-frontier-tandem-results-v1`，100000 UTF8 bytes；領跑鬼車在 `taipei-gp-frontier-tandem-ghost-v1`。二者嚴格解析、深副本、損壞原文／CAS／quota／readback保護，納入整包備份；沒有私席憑證。原生JSON可下載目前鬼車、獨立結果及本場。

核心／Storage 24PASS；收據 `frontier-tandem-practice-evidence-1795186866106`。首輪22PASS／2FAIL抓到不可能成績：有效追走0秒卻有分，以及invalid原因資料可保存。修後限制score≤goodSeconds×100，invalid必須0；失敗前收據保留。完整時長、尾步10.05秒、單次結果、取消無效、全部原因與儲存保護均覆蓋。

main整合透過獨立lazy入口借車，main原車模型／普通模擬／傷害／進度暫停，陪練只更新自己的FreeCar一次；離開還原姿態、spec、geometry、天候、鏡頭和導航，保持paused。自有車／鬼車資源離開釋放，共用貼圖不dispose。瀏覽器真錄製、原生下載、三尺寸及還車證據仍以最終收據為準；沒有真手機或真人完整甩尾評分實測。

## 真瀏覽器整合證據

`node tools/dev-tests/frontier-tandem-practice-browser.mjs` 在 build `e673965de1c8` 為 **8 PASS／0 FAIL**，來源與測試腳本 hash 在測試期間不變、cleanup 完整、外網請求與瀏覽器例外皆為 0。原始收據：`tools/dev-tests/frontier-tandem-practice-browser-evidence-1795188630183/report.json`；最新彙整：`tools/dev-tests/frontier-tandem-practice-browser-result.json`。

從玩法目錄真入口開啟，CDP 原生油門／煞車經實際 Input、FreeCar、Collider 錄製 1260 個 `1/120 s` 小步，得到 `10.50000000000005 s`、`120.8188994877216 m`、211 筆樣本、0 接觸的鬼車；錄製期間沒有注入 ghost、pose、速度或分數。明確保存後，中立操控完整跟隨同一時長，結果僅保存一次：0 分、far `9.125000000000123 s`、slow `1.3749999999999976 s`，invalid 為 0。這是未跟上時的低分基準，沒有宣稱真人追走技巧或評分平衡通過。

原生下載 `taipei-tandem-practice.json` 為 21732 bytes，鬼車／獨立成績／本場資料嚴格解析及私人欄位排除通過。中途離開不新增成績，62 個自有 geometry 與 10 個 material 均收到預期 dispose；原車 spec／geometry 參照、姿態、天候、導航及單人資料還原。兩種 await 前取消路徑均驗證晚到工作不重啟；0.5 秒錄製被拒且保留既有鬼車／唯一紀錄。還車後點真「繼續」回到 `free`，單人存檔比較在繼續前完成。

入口與結果各驗證 390×844、844×390、844×220，屬桌面 Chrome 尺寸模擬。測試明確停止背景 RAF，以實際 `__gp.freeStep(1/120)` 加速物理；借車前合法 geometry 標記只驗還原。取消競態使用同一 JavaScript 呼叫中的真按鈕 `.click()` 接停止／返回，刻意命中 await 前時機；其餘主要流程使用 CDP 原生輸入。沒有真手機、外網或真人全程實時甩尾證據。

## 最終統一回歸

2026-11-21 本輪build **caeeecc35bef**已完成34套Node／服務、14套瀏覽器與固定三基準，詳見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。本段是最後封版狀態；上文各次build、待root與before FAIL保留開發當時事實，未改寫原始證據。PASS只涵蓋本機實作與驗證；真機／外網／完整真人駕駛限制依統一報告，沒有commit、push或部署。
