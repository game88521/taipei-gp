# Summit 多人與回放契約

署名：Rex <game88521@gmail.com>

本文件整理 Summit 新增行為；既有系列／特殊房規仍以各 shared 契約為準。內容由本機程式、`SUMMIT_RACING.md`、`SUMMIT_CITY.md`、`SUMMIT_WORKSHOP.md`核對，未操作公開服務。最終build、驗證與是否套回原專案，見根代理封版文件。

## 服務分界與版本

三種WebSocket共用同一Node process與Origin閘門，房間、身分及續接憑證各自獨立。相同六碼不代表相同模式的房間；跨endpoint不會轉換房間、貨物、成績或身分。

|入口|契約|權威邊界|本輪同步|
|---|---|---|---|
|`/ws`|`PROTOCOL_VERSION=2`、`PHYSICS_VERSION='classic-multitrack-collisions-v3'`、24圖catalogStamp|真Car／Track、車間碰撞、計圈、排名／成績由server運算；client送操控並做預測|input30Hz／physics60Hz／snapshot20Hz；Summit擴充能力協商|
|`/coop`|`COOP_VERSION=2`、`COOP_CITY_STAMP`|貨單所有權、預約、交付、分數、回合由server裁定；駕駛位置仍為client pose加移動guard，**不是完整權威城市物理或競技防作弊**|client通常10Hz位置；server拒小於50ms重送；service30Hz tick|
|`/city-race`|`CITY_RACE_VERSION='city-race-v1'`、NG1 `physics='city-workshop-v1'`與`roads-v1:*`|真FreeCar、全城市Surface／Collider／Router、檢查點、路層、名次／時間由server運算；只接受操控|input30Hz／physics60Hz／snapshot20Hz；車手之間穿透|

`GET /health`維持一般競速version／physics／catalogStamp，另回`coop.version=2`與`cityRace.version='city-race-v1'`及各服務rooms/connections。health成功不等於前端版本、Origin、實際玩法或免費主機容量已驗證。

Origin採完整`http(s)://host[:port]`逐一比對，不含路徑、尾端斜線、wildcard、憑證或多個網址黏接。未列入來源403；未知endpoint404；容量503。Vercel新部署網址須另列白名單；公開Preview的登入保護是另一項設定，不能以改Origin解除。此輪未測／改動任何線上設定。

## 進階賽事與互斥

`shared/summit-racing.ts`定義`SUMMIT_VERSION='summit-racing-v1'`與`SummitSettings={weekend:boolean,ai:0..3,endurance:0|480|600}`。client入房宣告`clientCapabilities.summit=true`，server以`capabilities.summit`與`room.summit`／`players[].summit`成對發送。舊車手或觀眾不能加入已啟用的新模式；已有舊能力席位時也不能開啟。普通舊房仍保留原物理路徑，不用新模式放寬舊快照驗證。

- 房主`set-summit`須帶目前`roomCode`與`expectedLobbyRevision`，僅一般單場大廳可改設定。真人加AI最多四車，AI不占假socket且不能擔任房主。AI明示於車手列、結果及回放。
- 週末、AI、耐久彼此可組合；任一啟用時，不能同時搭配系列、限時刷圈／讓秒追逐／2v2、淘汰／反序／其他Horizon房規、接力或道具房。須先關閉進階設定再改特殊玩法，UI與server均檢查。
- 三分鐘排位使用`stage='qualifying'`、180秒時限。擦牆／車間接觸令當圈無效；只採期限內有效最快圈，無有效圈排後。房主於結果發`next-weekend`進入同圖`stage='race'`，沿原身分排格，新match／trackRevision、載入／準備及圈表重置；不是原match直接把車搬到前排。
- 原席尚在一般競速10秒斷線窗口時，不開始下一節；過期席位依規則剔除。排位後正賽鎖住名單，不接受新車手插入。要換圖／重新接納新車手，先重設完整週末。至少兩個可出賽席位，可含AI。
- 耐久480或600秒，到時後各車再過線完賽，最長另等120秒，未完賽DNF。不是固定圈數先到即結束；乾→雨→乾同步天候、真前進里程胎耗，soft／medium／hard／wet四胎種。
- `summit-pit`帶roomCode、matchId、trackRevision、遞增seq、armed與compound。僅本人有效耐久車手可改策略，排位不換胎。已開始6秒作業時鎖定策略；重送seq不重複執行。
- 24圖維修區在起終線後80m靠右青色區；先預約，再以約18km/h以下實際駛入。服務6秒期間ghost，完成才換胎／加停站數，不傳送。維修限速只在已預約的終點前180m及起點後80m區間作用。

## 合作調度 v2

2～4人，七站、六件貨物，一輪最多20分鐘。建立／加入／續接同時核對v與cityStamp；每筆控制指令帶遞增request，位置另帶seq。每車最多一件已領貨，server依最後接受的位置檢查同層、12m內、速度≤1m/s且停穩1.2秒，再准取送。這些guard不能證明client真的沿路行駛，不能把合作分數當公平競技榜。

|新增指令|server規則|
|---|---|
|`reserve {cargoId}`|只預約待領貨物；每人一張、每張一人，120秒上限。改約釋放自己的舊預約，不轉移貨物所有權|
|`cancel-reservation`|只取消自己的預約，不能取消隊友|
|`ping {stationId}`|七站白名單，每人一點，每兩秒可更新，30秒過期|
|`cancel-ping`|只取消自己的集合標記|

他人不能搶領預約貨單，本人領取即移除預約。斷線／離房／返回倉庫立即釋放本人預約與標記；已領貨物沿用斷線保留30秒規則，非立即讓別人取得。client自動續接最多約28秒、token續接後輪替；過期或主動離房按舊規則歸還未交付貨物，不重送已中斷取送指令。

小地圖用真BigMap道路背景，隊友、目的地與集合標記為調度資訊；虛線只表示方向，實際導航另走真路網。離房解除地圖listeners並清canvas／peer資源，保留一份按需載入UI供再次使用。

## NG1 城市競速

房主`create`帶v、暱稱與NG1 `challenge`；server自行decode、以真Router重建路線。`join`帶v、暱稱及code；`resume`帶v、code、selfId及本席token。`welcome`只向本人回token，全房snapshot不含其他憑證。

路線2～12 anchors、100m～20km；server最多700個順序gates。車型／天候／原目標來自NG1，但連線時限為`min(600, NG1.seconds)`：原1800秒定義保留，房主建立前明確看見本場600秒，大廳及HUD亦顯示實際時限。工坊原NG1分享／草稿與單人成績不變。

- `ready`核對revision與map；房主`start`需2～4人全部連線準備。倒數三秒，新matchId；倒數掉線取消回大廳並更新revision。
- `input`僅允許type、matchId、revision、遞增seq及steer／throttle／brake／handbrake。拒絕pose、速度欄位、錯場與亂序；server同層依序過點並以內插時間計時。
- 700ms無有效操控自動煞停；每房每tick最多12個補步，模擬落後超過1秒明確DNF，不無界追趕。開選單／背景分頁送煞車，賽事時鐘不暫停。
- 斷線保留15秒，由使用者手動續接，非合作28秒自動重試。錯token／逾時拒絕；房主離線移交。有效完賽者後來斷線不被改為DNF，仍有在線車手時保留全體結果；所有人離線且續接期滿刪房。
- `again`僅房主可於結果呼叫，回同房大廳、更新revision、清結果／準備／操控。主動離房還原單人原位置與天候。
- 車手互相穿透，建築／護欄仍有真碰撞；交通車／行人／可破壞擺設不參與。沒有接用合作pose作權威，沒有宣稱完整反作弊、持久雲端榜、ELO或外網手感已完成。

## 回放 schema 1／2

一般競速wire仍是v2；回放JSON的`schema`另分1或2，不能混為同一版本。server在有Summit能力車手的房間錄schema2；舊普通房仍可錄schema1。新版匯入嚴格接受兩者及相同physics／catalog／trackStamp，不把v1自動補成假事件。

共同上限：5Hz軌跡、最長12分鐘／最多3602frames、8MB文字、24KB chunk；超長標記truncated。schema2另加events、summit設定／stage、driver AI標記、每frame雨勢及胎況／進站資料；最多512events。collision／wall／overtake同類同組合每秒最多一筆。

事件類型為collision、wall、overtake、handoff、item、pit、weather、lap、finish、session。碰撞依60Hz真解算結果，超車依server前進進度交換；事件不是從5Hz軌跡猜出，也不提供自動肇責。可篩選、播放事件前後三秒及加本機書籤。

公開回放driver id改為`driver-N`，不含房碼、原playerId、matchId或token；**暱稱與車色仍包含在回放內**。書籤獨立key `taipei-gp-replay-bookmarks-v1`，最多20場／每場64筆；不混入權威JSON，損壞舊資料不覆寫，儲存拒絕仍可本頁使用。

## 載入、隔離與容量

合作／工坊／回放按需載入、下載去重、可取消與重試；第一次開啟後保留單一UI實例，不聲稱卸載JS。主城市的合作、工坊挑戰、城市競速與勤務共用fcar，進入／準備期間要互斥；單人維修、換車、探索及一般任務不能穿透隔離。退出／切模式需取消未完成進入、釋放輸入、還原位置／車規／天候及所屬標記。勤務與同機雙人皆為離線獨立模式，不建立新多人契約。

|限制|預設值／行為|
|---|---|
|GP `/ws`|最多50房、256clients；一般10秒斷線保留|
|合作|最多16房、64clients、每房4人；訊息65/s、4KB；192KB背壓終止|
|城市競速|最多12房、48clients、每房4人；訊息90/s、8KB；1MB背壓關閉|
|三服務合計|共同最多一般service.maxClients（預設256），同來源socket IP最多16；不信任client偽造X-Forwarded-For|
|共同傳輸|WebSocket maxPayload96KB、perMessageDeflate關閉、5秒心跳；HTTP request/headers timeout10秒；app.close清timer/socket/room|

城市全184tiles、Surface／Collider／Router在process共用一次快取。實測冷載入約1.55～1.62秒、RSS約90→289～293MB，因此在**listen及simulation intervals前預熱**，不能等已有GP進行才首次讀全城。這些是本機數字；**512MB免費主機、多房同時GP／合作／城市競速、48城市車及長時間GC皆未驗**。上表是程式防護上限，不是免費方案的容量承諾。server重啟會失去記憶體房間，啟動預熱不等同持久化。

不新增雲端帳號、資料庫、公開排行榜或付費服務。單人正式PB、錢包、任務、成就、NG1工坊最佳與新增模式分開；交付前仍須保留三個固定GP回歸與最後實機清單。
