# Twelve 多人改善契約（5／6／7／8）

協定仍v2、physics仍classic-multitrack-collisions-v3；不改Car／track／碰撞求解器。只在目前工作副本實作，不連外、不提交、不部署。

## 5 有界網路呈現

以本機可重現排程量測50／100／200ms延遲、變動間隔與短停頓。快照到達的單調時鐘間隔用於估計抖動，伺服器時間不拿來當到達時鐘。遠車一般插值由110ms起，範圍80～220ms，慢慢恢復，碰撞後漸回目前延遲的時間軸不可倒退。180ms自車物理預測上限、權威位置、30Hz輸入及60Hz物理不變。快照超過500ms未更新時顯示過期提示；連回／換場／換圖重設量測。只減少畫面取樣欠缺，不宣稱外網／手機已改善。

## 6 賽道資訊

小地圖使用實際目前track中心線px/pz，保留真形狀及長寬比，不用圓環冒充賽道；重用路徑、最多10Hz更新車點。相對車雷達以觀看車的航向轉成前後／左右，距離與高度門檻排除高架不同層。前後差讀權威progress，單位公尺，套圈另標；不轉換成精確秒差。觀戰使用觀戰目標，無合格目標時不顯示虛構資料；HUD可收合且手機矮尺寸保留操作區。

## 7 本機戰績

專用鍵taipei-gp-multiplayer-history-v1，最多20場單場及10筆系列。只在results且本機車手屬名單時保存已驗證的權威結算，以matchId／seriesId去重，後續快照不得多存。只保留日期、地圖／圈數／房間規則、暱稱、排名、完賽／最快／逐圈時間、DNF原因與總積分；不保存房碼、token、endpoint、玩家ID或位置／輸入軌跡。無效／過大／儲存失敗不阻擋比賽並明示；離房仍能開近期戰績。匯出僅下載本機JSON；清除需明確確認並刪專用鍵，不動單人存檔或其他設定。這不是伺服器續賽，也不是線上排行榜。

## 8 私人房規則與相容性

新client建立／加入／續接皆可選宣告clientCapabilities:{roomRules:true}；舊client省略視為不支援。新server的capabilities新增可選roomRules:true，並提供roomRules:{collisions:boolean,finishGraceSeconds:30|60|120}；預設一般碰撞／60秒。舊server兩欄省略時新client顯示舊版預設且隱藏修改入口；有提供錯型別或能力／設定不成對則拒絕，不靜默降級。

set-room-rules只允許房主在大廳、且系列尚未鎖名單時，綁roomCode與expectedLobbyRevision；只接受兩個嚴格合法欄位。非預設規則要求房內所有身分（含斷線保留名額）已宣告能力；舊client不得加入／續接非預設規則房，錯誤RULES_UNSUPPORTED。規則變更同時升大廳及賽道revision、清ready／loaded，阻止晚到舊ready／input，冪等不清狀態。大廳、HUD及成績全員明示規則。系列第一站開始後規則固定；換圖、下一站、重連及再戰保留。

碰撞開關僅控制多人server碰撞呼叫及client預測／畫面分離呼叫，無碰撞模式可互相穿越；不改共用solver。finishGraceSeconds僅改第一位完賽後寬限，不改整場10分鐘上限、既有10秒重連或DNF原因。房間變更前後的權威驗證、舊server相容、舊client拒絕非預設規則、series／重連與無碰撞車況均須測試。
