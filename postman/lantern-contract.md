# Lantern HTTP 契約

Rex <game88521@gmail.com>

共用：同源 JSON API、Cache-Control:no-store；不使用 URL 查詢傳遞私密憑證。不傳回上游錯誤、Redis 位址或權杖。持久 Redis REST 沿用 KV_REST_API_URL/TOKEN 或 UPSTASH_REDIS_REST_URL/TOKEN；未設定 503 not-configured。上游錯誤 503 unavailable，超時 504 upstream-timeout。所有寫入限制大小與操作頻率。

## /api/cloud（第8項）

POST action:create 建立匿名個人同步帳戶，回傳 accountId(UUID)、256位元 recoveryKey。這是個人持有型憑證，非公開車手 UUID；只有伺服器存雜湊。憑證僅顯示給建立者一次，不進備份、日誌或邀請。

後續 GET/PUT/DELETE 需 X-Sync-Account 與 Authorization:Bearer recoveryKey。GET 傳回 {revision,updatedAt,backup}，初始 revision=0、backup=null。PUT {expectedRevision,operationId(UUID),backup}：只在版本吻合時原子寫入；同operationId同內容重送回原收據，不重複遞增；不同內容409 idempotency-conflict，版本不合409 revision-conflict（僅含目前版本，不覆寫）。完整備份上限3MB（大回放應先本機匯出）；不接受憑證欄位。DELETE {expectedRevision}刪除帳戶，版本不合不刪。錯誤認證401，格式400，過大413，過頻429。

瀏覽器在主動點擊後讀寫，不自動覆蓋本機或雲端；先下載／預覽雲端，再以既有逐類還原流程明確確認。手機與電腦可用同步帳戶代碼連結，離開時清除本頁憑證；玩家可自行選擇此裝置記住。遺失復原金鑰無法代為找回。

## /api/leaderboard（第9項）

既有GET/POST契約向後相容；新增track查詢及board.track支援24圖，預設taipei。每圖以實際GP幾何產生manifest；proof.trackStamp必須吻合該圖，完整軌跡、時間／位置／進度合理性檢查。經典與2026、recordVersion分開。台北舊榜仍唯讀。合理性檢查不是權威防作弊。

## /api/weekly（第12項）

GET ?cup=CODE：取得私人好友盃及依固定UTC週、三站、經典規則、賽道manifest鎖定的榜。週一00:00UTC至下週一截止，已結束唯讀。POST action:create,name 建立邀請碼；action:join,cup,name 加入；需個人同步帳戶認證，最多16位。POST action:submit,cup,track,time,proof,operationId：驗證成員與賽期、圖、固定規則，當週提交後原子保留較佳圈；重送冪等。每站依完成人數排名給25/18/15/12/10/8/6/4/2/1分，未跑0分，總分同分依完成站數、總時間、穩定ID排序。GET回傳清楚截止與官方伺服器時間；不宣稱客戶端離線紀錄可證明實際完成日期。邀請碼為私人存取能力，不是公開配對。
