# Nexus 多人資料與信任契約

本文件描述本輪六項的整合設計，實際驗證結果以 `NEXUS_VALIDATION.md` 及本次來源雜湊對應的測試證據為準。文件存在不代表原專案已套用、遠端已部署或實機已驗收。

## 服務與版本

同一 Node 程序提供賽道 WebSocket `/ws`、城市合作 WebSocket `/coop` 及唯讀健康檢查 `GET /health`。前端使用 `VITE_MULTIPLAYER_URL`；合作沿用其 origin 並改 pathname 為 `/coop`。公開環境未設定 endpoint 時顯示未設定，不猜測服務位址。

| 通道 | 相容性識別 | 狀態來源 |
|---|---|---|
| 賽道 `/ws` | protocol、physics、catalog stamp、track stamp／revision；接力與道具另需 `clientCapabilities.nexusArena=true` | 伺服器真 Car／賽道物理、檢查點、計圈及結算 |
| 城市 `/coop` | `v=1`、`COOP_CITY_STAMP` | 伺服器裁定貨單；城市 pose 由客戶端回報並受移動／停穩防護 |
| 多人回放 | schema 1、protocol、physics、catalog／track stamp | 賽道服務錄製的有限軌跡；匯入檔案由本機驗證 |
| NG1 城市挑戰碼 | schema 1、`city-workshop-v1`、城市 roads stamp | 本機路線與成績；分享碼不是競技結果證明 |

WebSocket 升級只接受精確 HTTP(S) Origin 白名單，不接受拼接字串、路徑或不相符的新部署來源。Origin 是瀏覽器來源隔離，並非帳號登入或完整防作弊。相同程序共用總連線限制、每來源 socket 位址最多16條，忽略偽造的 forwarded header；公開反向代理須自行處理真正的使用者 IP 政策。單一 WS frame 上限96KiB；合作另限4KiB payload／每連線每秒65訊息、16房／64連線、192KiB待傳緩衝門檻。

所有房間與尚未下載的賽道回放保存在單一程序記憶體。服務重新啟動會失去它們；這版沒有跨節點房間或持久化多人戰局。

## 接力與道具：權威賽道流程

`room.evolution.mode` 保持既有 `race`，新玩法放在 `room.arena.mode=off|relay|items`。伺服器公開 `capabilities.nexusArena=true`；舊服務缺能力時，前端不提供可執行的新玩法。房內斷線保留席也必須支援此能力。

| 指令 | 必要作用域 | 伺服器裁定 |
|---|---|---|
| `set-arena` | `roomCode`、`expectedLobbyRevision`、`mode` | 當前房主、大廳世代、全部席位能力及玩法相容性 |
| `arena-team` | `roomCode`、`expectedLobbyRevision`、`team` | 大廳接力分隊；隊伍滿額時交換另一隊最後加入隊員 |
| `relay-handoff` | `roomCode`、`matchId`、`trackRevision`、單調 `seq` | 當值首棒、至少1圈、未完賽、起終線後80m內且速度≤5.1m/s、隊友連線並載入 |
| `use-item` | 同上 | 正在道具賽、持有物品、尚未完賽／DNF、效果未啟用、命令序號未用過 |

設定限單場圈數競速，不能與系列、限時、追逐、既有2v2、淘汰、防堵路或倒序混用。改設定會讓全員重新確認載入／準備。

接力固定四人、紅藍各兩人、總3或5圈，每隊只有當值車手參與輸入與碰撞。交棒由服務複製完整 Car、隊伍進度、gate 與圈表，第二棒靜止接手；舊棒立刻失去駕駛權，前端清預測輸入與位置平滑。任何隊員主動離賽或重連逾期使全隊 DNF；短暫斷線沿用既有賽道席位寬限與棒次。

道具按真前進距離經過每圈三補給點授予，一次一件。加速2.5秒；護盾4秒排除車輛碰撞，牆面仍依原 Car 處理。伺服器使用自身時鐘決定期限，重送或舊場命令不延長效果。前端預測、車模呈現與觀戰只讀此結果，不能用回報位置取得道具或交棒。

## 城市合作：貨單權威、位置有限信任

`create`／`join`／`resume` 必須包含合作版本與城市 stamp。除 `position` 使用自身單調 `seq` 外，命令使用正整數 `request`，重複或較舊序號拒絕。`welcome` 的續接 token 只回到該連線，綁定新連線時輪換；公開 snapshot 不含 token。

| 命令／狀態 | 規則 |
|---|---|
| `ready`／`start` | 房主在大廳開始，2～4位全員已連線／準備；共同20分鐘 |
| `position` | 有限座標／角度／速度、序號與最小回報間隔；90m/s及垂直35m/s加容差的位移上限 |
| `pickup`／`deliver` | running 且截止前；同層12m、速度≤1m/s、最近pose≤600ms、前景停穩≥1.2秒；貨單／持有人／目的地互相核對 |
| `release`／`return` | 放回未送貨；返回共同倉庫會退回持有貨物，已交付數不撤銷 |
| `again` | 房主結算後開新一輪、換runId、重設共同貨單與準備 |
| 斷線 | 原席與貨物保留30秒；前端自動續接最多28秒，房主移交已連線朋友；超時／離開退回未交付貨物 |

城市 pose 防護能阻擋明顯傳送與偽造瞬間停穩，**不能證明車輛確實沿道路行駛**。合作分數限共同配送紀錄，不能兌換單人金錢或提交競技排行榜。朋友車採友善穿透；背景車流／行人隱藏，不宣稱它們已同步。靜態城市碰撞沿用原本機 FreeCar 流程。

合作分支停用單人計程車／街賽／追緝／甩尾結算、車損／探索／統計及自由位置寫入，離房還原加入前位置。貨單指令斷線後不自動重送，先看最新 snapshot 再重試。記錄使用獨立 `taipei-gp-city-coop-results-v1`，最多20輪，依runId防重複；token只放該分頁sessionStorage，邀請連結只含房碼。

## 回放與本機分享資料

賽道服務在最終公開排名排序後，以5Hz錄製白名單位置、方向、速度、路段、進度、圈數、名次、完賽／DNF與當值狀態。最多前12分鐘／3602 frame；超長標示截斷。這是取樣軌跡插值，沒有重新推算比賽物理或錄製影片。

結算後 `replay-chunk` 只允許目前本房車手／觀眾，指定該場replay id及對齊24KiB字元offset。前端單筆下載限20秒，驗證連續順序、總長、id與完整schema，斷線／下一場中止。最大8Mi字元；車手1～4、時間嚴格單調、各frame固定白名單tuple，拒絕未知欄位／不合版本。載入真地圖後再核對length與sample index。

回放把原車手 id 改為 `driver-N`，不輸出房碼、match id或任何續接憑證；仍包含暱稱。玩家明確確認後才下載／分享。IndexedDB最多5場、同交易替換最舊，空間失敗可下載JSON。匯入檔案可由玩家修改，不能拿來提交正式成績。

城市工坊的NG1碼僅承載真路網節點、名稱、車款、天候及挑戰限制；checksum用於意外損壞偵測，不是簽章。邀請碼只預填，須玩家確認開始。路線與成績存在獨立工坊鍵，未增加自訂城市路線多人賽道介面。

## 驗證可以證明的範圍

`node tools/dev-tests/nexus-node.mjs` 依序執行六套、預期88案；每輪唯一evidence保存stdout、stderr、前一份／本次report及腳本／產品來源SHA256，來源變更或套件數不符會失敗。舊26套／33套回歸另以 `multiplayer-checks.mjs` 與 `evolution-legacy.mjs` 執行，不放寬舊斷言。

舊測試載入器須載入新增的真模組並對齊既有受控時鐘；固定三項與物理／逾時判定基準維持原值。唯一必要的舊契約期望變更是 `tenpack-multiplayer-server` 的能力物件：保留原四個旗標，精確加入本輪 `nexusArena` 與 `replay` 兩個旗標。首輪失敗證據保留，不刪案例或改成寬鬆包含檢查。

接力完整3圈另有真Car controller與真WS交棒；其他交棒／補給／結算邊界使用明示fixture。合作完整六件使用受控合法pose；回放短場以DNF fixture收束；工坊有真FreeCar直線完整挑戰。這些都不等同多人真人跑完城市／賽道。

桌面Chrome多context、loopback WS與尺寸模擬可查UI／權限／清理，不能取代真手機／手把、跨網路、服務冷啟動／重啟、長時間GPU／記憶體／耗電或玩法平衡驗收。實機待辦見 `NEXUS_PHONE_TEST_PLAN.md`；本輪沒有使用線上站測試。
