# 台北街道賽：私人房間服務

Node.js 24 以上、單一常駐程序的 WebSocket 服務。協定 v2 提供台北加全部 23 張 GP 地圖、2～4 人私人房、1／3／5 圈、玩家車輛碰撞、同步起跑與伺服器裁定結果。所有多人地圖維持原有經典操控，房主可在大廳切圖，全員需重新載入確認及準備。沒有 AI、公開配對或帳號系統；對戰不改單人存檔、錢包、紀錄或排行榜。

房主可設定一般碰撞／無碰撞練習，以及首車完賽後 30／60／120 秒寬限；預設為一般碰撞與 60 秒。支援 3～5 張不重複地圖的系列賽、鎖定原車手名單與累積積分。Evolution 增加限時最快圈（3／5 分鐘、固定無碰撞）、追逐賽（各車延後 0／3／5／10 秒放行）、固定四人 2v2 系列賽、地圖投票與隨機巡迴。新房規與玩法會檢查全員能力，使用時需配套更新前後端；完整規格見 [多人協定](../shared/multiplayer-protocol.md) 與 [Evolution 增補契約](../EVOLUTION_MULTIPLAYER_CONTRACT.md)。

## 本機執行

Horizon 增加可選防堵路房規、純觀眾候場、常用房間範本、系列倒序發車與定時末位淘汰；規則見 [Horizon 多人契約](../HORIZON_MULTIPLAYER_CONTRACT.md)。防堵路先警告，持續違反才凍結並暫時無碰撞，需安全分離後恢復；不授予穿車超車。觀眾最多八位，不佔四個車手席，只能在未鎖名單的大廳明確轉入空位。倒序使用獨立格序與真實前後距離；淘汰只提供一般單場，不與系列或其他玩法混用。新功能需全席相容的 Horizon 前後端，舊服務隱藏新操作。

先在專案根目錄完成前端依賴安裝，再產生由同一份 `src/car.ts`／`src/track.ts` 打包而來的物理檔。建置會自動以全部資料／metadata／配方產生 `shared/multiplayer-catalog.json`；不要手動編輯 catalog 或 `server/physics.mjs`。單人 `Car`／`track`／GP 配方沒有改動，多人使用獨立共用建圖程序，沒有設定全域性能。

```powershell
npm.cmd run build
npm.cmd --prefix server ci --ignore-scripts --no-audit --no-fund
npm.cmd run multiplayer
```

預設監聽 `127.0.0.1:4320`，WebSocket 是 `ws://127.0.0.1:4320/ws`，健康狀態是 `http://127.0.0.1:4320/health`。另外執行本機 `npx vite preview --port 4317 --strictPort`，由遊戲連線入口建立／加入房間。設定前端公開端點的方式依遊戲根目錄連線文件；正式頁面必須使用 WSS。

本機測試只用 preview 與專用 Chrome 的隔離 contexts，不用正式站。測試兩名玩家使用兩個獨立 browser contexts，分別準備隔離存檔，確認互不影響。多人獨立頁不匯入單人存檔；一般遊戲頁仍受既有同 origin Web Lock 保護，不得為了測試多人停用這項保護。

## 環境變數

| 變數 | 預設／用途 |
|---|---|
| `PORT` | `4320`；1～65535 |
| `HOST` | `127.0.0.1`；部署於容器改 `0.0.0.0` |
| `ALLOWED_ORIGINS` | 逗號分隔的精確 HTTP(S) origins；預設 localhost／127.0.0.1 的 4317、5173 |
| `SERIES_RESUME_SECRET` | 僅伺服器使用、32～4096 bytes 的 HMAC 金鑰；未設定時每次啟動隨機產生，續賽憑證會隨程序重啟失效 |

範例（只啟動本機服務）：

```powershell
$env:HOST='127.0.0.1'
$env:PORT='4320'
$env:ALLOWED_ORIGINS='http://127.0.0.1:4317,http://localhost:4317'
npm.cmd run multiplayer
```

正式 allowlist 應填遊戲前端實際 HTTPS origin，不含路徑、尾端斜線或萬用字元。WebSocket upgrade 一律要求在 allowlist 中的 Origin；健康檢查不需要 Origin。這是瀏覽器來源限制，不是帳號認證，原生客戶端仍可能自行宣告 Origin。公開服務應再由反向代理限制 IP／連線與 TLS。

## 站間續賽憑證

原系列房主可在一站已結算、系列尚未結束時匯出續賽憑證；憑證以 HMAC-SHA256 簽署已結算成績、房規、玩法與原車手席位，最長有效七天。匯入後建立新房並前往下一站。這是站間的 export／import，沒有即時比賽持久化；不保存行進中的車輛狀態，也不能在程序中斷後接續未完成的一站。

要讓重啟後仍可驗證憑證，管理者須透過伺服器的秘密管理或環境設定，提供足夠隨機且固定保存的 `SERIES_RESUME_SECRET`，每次啟動保留相同值；長度按 UTF-8 bytes 計算，必須介於 32～4096 bytes。更換金鑰會撤銷舊金鑰簽發的全部憑證。金鑰不得使用 `VITE_` 前綴，不得進入前端 bundle、版本庫、manifest、驗證報告或匯出檔；匯出的續賽憑證本身也應由原房主保管，不公開分享。未設定時服務只宣告暫存續賽能力，介面會明示重啟後失效。相同金鑰仍須搭配相容的物理與 catalog 版本，不能保證跨版本匯入。

其他原車手以原瀏覽器、相同前端 origin 及服務端點保存的席位憑證，輸入新房碼恢復原席；同名不能冒領，清除瀏覽器資料後也不能補回該席。續賽檔只包含席位憑證的 hash，不代替每位車手的原瀏覽器憑證。一般系列至少需兩個有效原席，固定 2v2 則需原四席；前端需支援匯出、匯入及原席恢復，不能只更新後端。

## 部署

前端仍可放在 Vercel。此服務需要可保留記憶體房間、長連線與固定物理 tick 的常駐 Node 服務；不要放進目前的 `api/` request／response 函式或把高頻位置寫入排行榜 Redis。

在準備好的單實例 Node 24 主機，安裝 `server/package-lock.json` 的 production 依賴。執行檔需包含 `server/index.mjs`、`room-service.mjs`、生成的 `physics.mjs` 與 `series-checkpoint.mjs`；保留相對目錄，帶上 `shared/` 下的 `multiplayer-protocol.ts`、`multiplayer-series.ts`、`multiplayer-room-rules.ts`、`multiplayer-evolution.ts`、`multiplayer-tracks.ts`、`circuit-catalog.ts`、`multiplayer-track-fingerprint.ts` 及生成的 `multiplayer-catalog.json`，另需 `src/data/track.json` 與全部 `public/data/circuits/*.json`。Dockerfile 以這份執行期相依白名單複製檔案；型別專用 import 在 Node 24 執行時移除，不需複製整份前端原始碼。

伺服器按白名單 lazy 讀取並驗證地圖資料，建圖快取與每房 arrays 分離。將 HTTPS 反向代理的 `/ws` 設定為支援 WebSocket upgrade 且 idle timeout 大於心跳週期，提供公開 `wss://<自己的主機>/ws`。`/health` 會回報 v2、物理及 catalog stamp，可作程序健康檢查。

用 Docker 時，build context 必須是遊戲根目錄，先完成 `npm run build` 以產生物理 bundle：

```powershell
docker build -f server/Dockerfile -t taipei-gp-multiplayer .
docker run --rm -p 4320:4320 -e ALLOWED_ORIGINS=https://your-game.example taipei-gp-multiplayer
```

24 圖版先前已部署至 Render 與 Vercel 測試版，使用者也已確認雙人起跑；這不代表本輪 Evolution 已部署。**本輪尚未部署，也未改動現有服務或建立付費資源。** 本機未安裝 Docker CLI，上面 Docker 指令未實測，不能以 Node 本機通過推定容器通過。發布本輪時需沿用實際主機的 TLS／Origin 設定，並配套更新前端公開 WSS 連線及後端。上面的容器啟動範例未設定續賽金鑰，因此只提供暫存續賽能力；需要跨重啟驗證時，另由部署環境安全注入固定金鑰。Node 服務本身不提供 TLS 憑證管理。

只開一個程序／replica。沒有跨 replica 房間共享或即時房間持久化；不能直接加多副本或在中途無縫滾動更新。重啟會中止現有比賽，客戶端應顯示房間失效；只有事先匯出的有效站間憑證能在驗證通過後建立下一站新房。未來要擴充可加入房間分片與路由，不能只共用目前的排行榜 Redis。

## 同步與限制

本輪 Horizon 未部署。Node 原生 import 另需 `server/horizon-service.mjs` 與 `shared/multiplayer-horizon.ts`，Dockerfile 已補入精確白名單；容器執行仍未驗證。HMAC 舊續賽檔可缺省 Horizon 設定（全關閉），新檔保存設定與原席能力，反序依已簽前站分類重建。房間範本只存純設定，不包含房碼、endpoint、player/session ID 或憑證，也不能代替已結算續賽檔。

完整協定見 `../shared/multiplayer-protocol.md`。遊戲使用伺服器 60Hz 物理、約 20Hz 快照；客戶端只能送方向／煞車與單調遞增 input 序號，不能上報位置或完賽。協定、物理或整包 catalog stamp 不一致會拒絕進房；每次 ready/start/input 另綁房間 track revision。v1 前端不能連線 v2 服務，發布時需一起更新前端與後端。

700ms 無新 input 自動煞車；斷線十秒可持 token 重連；一般競速在第一人完賽後依房規給予 30／60／120 秒寬限，全場十分鐘為上限。限時最快圈則依所選 3／5 分鐘結束計時，期限前已開始的最後一圈可在房規寬限內完成。伺服器停頓超過五秒中止未完成者。此版本沒有行車輸入以外的完整反濫用或公平網路認證：不宣稱抵擋自動駕駛、修改客戶端輔助或惡意流量攻擊。

測試可 import `createMultiplayerServer({now, autoTick:false, allowedOrigins})`，透過 `httpServer.listen(0,'127.0.0.1')` 取得隔離隨機埠，再以 `service.tick(now)` 快進。只有程式內測試能呼叫 tick／檢視房間；網路協定沒有作弊或跳終點指令。測完呼叫 `await close()`，不影響其他既有服務。
# Meridian 新增能力與站間續局

作者：Rex <game88521@gmail.com>。

`/city-mission` 提供 NG3 2～4 人合作及單人／好友照片尋寶，沿用同一來源白名單、總連線限制與城市路網。前後端須一起建置；`/health` 的 `meridian`、`cityMission` 及 `/diagnostics` 可核對新版本。Docker COPY 與專用 ignore 必須保留 Meridian 模組；只靜態驗閉包不代表已執行容器測試。

`MERIDIAN_CHECKPOINT_SECRET` 是僅供伺服器使用、固定保存的 **64 個小寫十六進位字元**。管理者可在自己的終端用 `node -p "require('node:crypto').randomBytes(32).toString('hex')"` 產生後存入服務的秘密環境變數；不要貼進對話、前端、Git、備份或測試報告。新建 Blueprint 已列為私密手動欄位，既有 Render 服務須在下次授權部署時設定。更換或遺失金鑰會使舊續局碼失效。

缺少此設定仍可玩遊戲，但每次程序啟動會更換暫時簽章，介面會明示無法保證重啟後恢復；不能宣稱免費主機休眠／重啟後仍能跨日續局。持久金鑰只保證相容版本可驗真，不提供跨程序共享房間、持久資料庫或全域一次性兌換鎖。

續局只在派對／好友盃／跨圖錦標賽的**站間**保存公開賽程與積分。每位原隊員還須保留同一瀏覽器的私密恢復證明並全員確認；不能代朋友佔席。整包備份只納入公開簽章摘要，刻意排除 `taipei-gp-meridian-private-continuation-v1`、token 與其他私席資料。公開續局碼不能取代各人的私密證明，也不會恢復行駛中的車輛。

