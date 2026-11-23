# Aurora 十二項實作進度

作者：Rex <game88521@gmail.com>

基準：main `c56ca26e04bb1f39c144a93454ae1bc8d09d6737`。本輪於 `DCISI/taipei-gp-aurora-work`／`feature/aurora-12` 完成實作與本機驗證，build `bdc4e4bc9821`。尚未提交、推送或部署；原專案套回狀態以 `DCISI/taipei-gp-aurora-delivery/apply-result-latest.json` 為準，成功必須為 `APPLIED_BUILD_VERIFIED`。

|#|項目|狀態|
|---|---|---|
|1|好友派對連玩：同房投票換巡航／巡遊／王冠／警匪、活動積分|完成本機驗證|
|2|2～4人合作救援：司機／技師／警戒／調度、短斷線兼任|完成本機驗證|
|3|三階段追走教學、真錄製鬼車庫與嚴格好友檔案匯入|完成本機驗證|
|4|三條真道路、四賽段不同均速、路書與累積罰分|完成本機驗證|
|5|2～4人循環單挑、前二BO3、原席候場及公開JSON|完成本機驗證|
|6|任意圈多停／多胎序A/B沙盒、預估區間與GP實績JSON|完成本機驗證|
|7|普通／短線／加班公車、尖峰候車、留站跨班與獨立紀錄|完成本機驗證|
|8|NG3抵達／精停／裝卸及可選支線，保留NG1／NG2|完成本機驗證|
|9|多片段城市導演、鏡位／慢動作／字幕、真WebM影片下載|完成本機驗證|
|10|橫直向獨立排版、拖曳／鍵盤／44px位置滑桿、取消／CAS|完成本機驗證|
|11|35類備份逐類還原、同版較佳PB、逐場回放選擇與rollback|完成本機驗證|
|12|六種好友房統一分享／QR／複製、乾淨網址與取消替代操作|完成本機驗證|

11套新功能測試93案、四套既有回歸72案、伺服器打包靜態檢查、完整build與固定三基準通過。四個駕駛核心原文未變；完整收據、原始失敗及fixture限制見 [AURORA_VALIDATION.md](./AURORA_VALIDATION.md)／JSON。

規則與入口：[派對](./AURORA_SOCIAL.md)、[救援](./AURORA_DUTY.md)、[競速3～6](./AURORA_RACING.md)、[城市7～9](./AURORA_CITY.md)、[平台10～12](./AURORA_PLATFORM.md)。手機最後依 [實機計畫](./AURORA_PHONE_TEST_PLAN.md) 驗收；目前實體手機、原生分享面板、相機掃碼、真手把、跨網真人、免費主機四人承載及長時間發熱／耗電均未驗證。
