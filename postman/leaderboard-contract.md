# 台北排行榜 API 契約（先於實作定義）

權威契約：`postman/leaderboard.openapi.json`；本文件說明遷移及驗證邊界。不 publish、不接正式 Redis。

- `GET /api/leaderboard?rules=classic|2026&version=1&playerId=<UUID>`：台北指定規則／紀錄版本前 20 名及自己的名次。預設 classic、version=1。同名不同 UUID 分開計分。
- `GET /api/leaderboard?board=legacy&name=<舊名稱>`：原 `taipei-gp:tt:v2` 榜唯讀，標示未檢查軌跡、不推測其規則。所有寫入只進新榜，不刪舊榜。
- `POST /api/leaderboard`：JSON `{playerId,name,time,board:{track:'taipei',rules:'classic'|'2026',version:1},proof:{v:1,trackStamp,samples:[t,s,x,z][]}}`。
- `Idempotency-Key` 必填 UUID；同玩家同 key 同內容重送不重寫分數，`rank` 沿用該次回條，`top/me` 為當下讀取的榜；內容不同回 409。回條保存 24 小時。客戶端 POST 不自動重試；同一上傳進行中合併，離開／切榜可取消 UI 等待；取消不代表伺服器未寫入。
- 名稱只作顯示（1–12 字元）；玩家識別及冪等 key 均限定 UUID v4。UUID 是裝置／存檔識別，沒有登入或所有權驗證，不能當作身分認證。區網 HTTP 無 randomUUID 時，由同一個 identity helper 以 getRandomValues 產生 v4，不改動 Math.random。
- time 為秒，40–300。proof t 必須從 0 到 time、嚴格遞增且取樣間隔不超過 0.2 秒；s 是沿該圈連續進度，開始接近起線，結尾跨過終點。座標／進度需符合由實際 `buildTrack()` 產生的 manifest，速度／跳躍在寬鬆上限內。不接受缺首尾的舊影子車，請重跑。
- 檢查只證明軌跡合理性，客戶端可以偽造整條合理軌跡；不是權威模擬、防作弊或可信競技排名。
- 讀取／上傳均為 no-store；上游 Redis 每次 HTTP 最多 5 秒，同一 API 請求的多次往返共用 7 秒期限。應用 GET/POST 有可取消期限與過期回應保護。IP 10 秒限制保留；冪等回放不再扣限制。UUID 大小寫統一為小寫。
- 錯誤只回固定碼：400 invalid-request/name/time/identity/board/proof，405 method，409 idempotency-conflict，413 payload-too-large，429 slow-down，503 not-configured/unavailable，504 upstream-timeout。不得回傳 Redis／HTTP 內部錯誤、URL 或 token。
- 實際 Redis 行為以原 REST 命令契約為來源；本機 HTTP stand-in 支援本端點用到的命令、保存狀態並能注入延遲／錯誤。它不是正式 Redis 相容性或正式部署的證明。

前端要保留真實首尾點：startLap 記 t=0 當下車輛位置；completeLap 記 t=圈速、跨線後的真實位置及連續 s，再存 ghost／上傳。不在缺資料時人工插補造圈。
