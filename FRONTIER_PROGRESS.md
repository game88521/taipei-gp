# Frontier 十二項：本機封版

作者：Rex <game88521@gmail.com>。build **caeeecc35bef**；承接未提交 Expedition d5068bed213b，基準 HEAD a387c72bec2931411957063aaa63120a59122749。以下PASS指實作與本機驗證，實機／外網限制另列。原專案套用狀態須查 DCISI/taipei-frontier-delivery-receipt.json 與獨立核對，不以本文件代替成功收據。

| # | 完成項目 | 狀態／說明 |
|---|---|---|
|1|[好友雷達與車頂暱稱](./FRONTIER_FRIENDS.md)|PASS；四席識別色與編號、車頂名字、方位／高度與文字名單，含過期資料和競技資訊限制。|
|2|[城市房主管理](./FRONTIER_ROOMS.md)|PASS；房主鎖房、移除確認與取消、revision和原席續接保護。|
|3|[城市觀戰與匿名回放](./FRONTIER_CITY_REPLAY.md)|PASS；獨立觀眾席、競技延遲視角、匿名有界記錄、分塊下載、原場景播放及匯入匯出。|
|4|[城市短斷線自動續接](./FRONTIER_CITY_RECONNECT.md)|PASS；原15秒期限內最多三次，單socket與token輪替，服務端確認前禁止操控。|
|5|[效能採樣與可驗證調校](./FRONTIER_PERFORMANCE_UI.md)|PASS；最多60分鐘、有效駕駛／背景分離、5分鐘分段、最近五份摘要與暫時解析度對照。|
|6|[碰撞事實分析](./FRONTIER_INCIDENTS.md)|PASS；接觸前後原始速度、相對位置、朝向與缺資料提示，匯出事實報告；不判責、不加罰。|
|7|[車隊巡遊](./FRONTIER_CONVOY.md)|PASS；2～4人三條真路網、3／4／5站，順序門、同層停穩和全隊共同進度。|
|8|[移動王冠](./FRONTIER_CROWN.md)|PASS；2～4人三分鐘、持冠秒數、真接觸轉移、三秒保護與出界／斷線停分。|
|9|[多人定速拉力](./FRONTIER_RALLY.md)|PASS；2～4人權威FreeCar、無車碰、同一路線四計時點、早晚與超速罰分、獨立成績。|
|10|[多事故合作救援](./FRONTIER_DUTY_MISSIONS.md)|PASS；1～3件不同事故、三難度、每件完整作業、同一平板車與下場交換職責。|
|11|[追走單人陪練](./FRONTIER_TANDEM_PRACTICE.md)|PASS；真操控錄製領跑軌跡、跟車距離／滑角／失分原因、明確保存與獨立結果。|
|12|[四人好友盃](./FRONTIER_CUP.md)|PASS；四原席準決賽A／B→季軍／冠軍，兩人比兩人觀戰、逐場重備、重賽與公開JSON。|

最終完整build、34套Node／服務回歸、14套瀏覽器（96案）與chain-stab三基準全部通過。完整來源hash、證據及逐套狀態見 FRONTIER_VALIDATION.json／md。HANDOFF最後統一更新。

- 實體手機、真手把、跨網路真人、玩法平衡、免費主機容量、30分鐘實機溫度／耗電未驗證；桌面viewport不能列作實機PASS。
- 效能採樣的draw CPU不是GPU時間；0.65解析度的像素量減少57.75%，不等於FPS提升。
- 巡遊與定速拉力另有真FreeCar完整道路證據；救援六腿完整道路不等於真人精準停靠。救援browser明示停靠fixture；四人盃browser明示finish fixture，完整真Car／WS四場由Node另驗。
- 追走browser用真Input／FreeCar錄製，停renderer後以固定步加速；不是真人時間試駕。中立跟隨0分基準驗規則，不宣稱真人正分平衡。
- COPY隔離smoke是Windows Node24啟動集合驗證，沒有執行Docker／Alpine image build。
- 本輪只使用localhost，沒有commit、push或部署。前後端上線須同步：city-duty-v2、city-rally與新增能力；公開網址目前不包含本輪。
