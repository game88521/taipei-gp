# Horizon本機驗證

Build **999a1a3aa5b7**，產品SHA256 **0c2be5f01f3db6057695267de4d4cfeba22eb55fbb8717ac78840696740b0d2d**。

|類別|PASS|
|---|---:|
|本輪Node|5套／87案|
|本輪瀏覽器|30案|
|Evolution回歸|8套／91案|
|原回歸|26套|
|歷史回歸|33套／393案|
|固定基準|3項|
|交付工具fixture|19項|

各組可能覆蓋相同流程，不相加為獨立功能數。627份不可變before逐檔核對，歷史根文件與HANDOFF原bytes保留；car、track、pitlane與server physics完全相同。固定輸出仍是BOT lap2 54.425 hits=0／aiHits0；陳冠宇162.0／aiHits8；pittest陳冠宇175.7／aiHits5。新Node、browser及舊suite核對本輪來源、腳本、唯一證據與清理，不採舊PASS代替。完整逐案與hash見[HORIZON_VALIDATION.json](./HORIZON_VALIDATION.json)。建置log含指令、版本與前後端完成結尾，沒有獨立exitCode欄位，如實標記。

- 僅本機隔離驗證，未連正式站、Render、Vercel或外網真人房；工作副本通過不代表已套回或已發布。
- 手機尺寸是桌面Chrome模擬，Gamepad資料是受控fixture；真手機、真手把、長時間穩定性與真人難度仍未驗證。
- 多人使用真loopback WebSocket，部分順位、時間與完賽條件由受控服務fixture推進；不冒稱真人完整賽事。
- 駕校四課另以真FreeCar逐步完整操作；城市位置及探索造訪含受控fixture，未宣稱全路網遊戲平衡最佳。
- Docker CLI若不可用，Node與Dockerfile閉包檢查不代表已完成容器建置。
- 原26與固定三舊runner未逐案記runtime script SHA，本彙整驗其當輪產品hash、唯一證據及exit／固定輸出；現有腳本hash另行捕捉。
- 原專案套用需新Apply備份與成功收據、獨立verifier；不重跑舊Apply，不自行commit／push／部署。
