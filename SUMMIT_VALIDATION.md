# Summit 本機驗證

Build **8447a11b8964**；產品 SHA256 **22d0f619af79f0ca02a915718d65a4029be323b7b9962d7be66ae432e8ab26cb**。

|類別|通過|
|---|---:|
|Summit 新功能 Node|9套／114案|
|Summit browser|28案|
|Nexus回歸|6套／88案＋browser29案＋visibility6案|
|Horizon回歸|5套／87案|
|Evolution回歸|8套／91案|
|歷史回歸|33套／393案|
|原回歸|26套|
|固定三基準|3項|
|入口資源量測|2頁 byte／gzip|

各組覆蓋可能重疊，不能相加為獨立功能數。報告必須晚於 2026-11-18T06:00:00.000Z，並逐一核對當前來源、腳本、build、唯一證據副本、截圖與清理。702檔before與歷史文件保持原bytes；HANDOFF原bytes保留為suffix。car/track/rivals/pitlane/原server physics不變。固定結果：BOT lap2 54.425 hits=0、aiHits0；陳冠宇162.0、aiHits8；pittest175.7、aiHits5。詳見[SUMMIT_VALIDATION.json](./SUMMIT_VALIDATION.json)。

- 僅本機隔離驗證；未測正式站、Render、Vercel、外網真人或免費主機負載。隔離副本通過不表示已套回或發布。
- 手機尺寸為桌面Chrome模擬，手把資料為受控fixture；真手機、真手把、真人完整玩法平衡及長時間穩定性未驗。
- AI全24圖完成單圈、完整耐久集中台北，不能宣稱每圖十分鐘均已驗。browser圈表、進站靠位與時間含明示server fixture。
- 公車與救援完整真物理流程使用短直線fixture；約6.19km／2.60km完整真城市路線尚未真人驗收。
- 合作位置仍由client提供並受pose guard檢查；城市競速另用server權威FreeCar。兩者不代表完整防作弊。
- 城市全184tiles listen前預熱曾量到約1.6秒、RSS約90→289～293MB；未測512MB服務、多房持續CPU／GC或程式容量上限。
- 可選UI首次開啟後保留一份實例，沒有卸載JavaScript；核心預取不含所有模式。byte/gzip僅檔案尺寸，非實機速度/FPS/記憶體。
- Docker runtime依賴接線不等於實際Docker建置／執行已驗證。
- 原26及固定三runner未記錄逐案runtime script SHA；此封版驗當輪產品hash、唯一證據、exit與固定輸出，另捕捉目前腳本hash。
- 建置log驗證完成結尾，log本身未攜可獨立核對的process exit收據；不冒稱已記錄exit code。
- 封版器不執行測試、原專案存取、套用、Git或部署；後續實際套用仍須備份、逐檔核對及獨立成功收據。
