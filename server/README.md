# 台北街道賽：私人房間服務

Node.js 24 以上、單一常駐程序的 WebSocket 服務。協定 v2 提供台北加全部 23 張 GP 地圖、2～4 人私人房、1／3／5 圈、同步起跑與伺服器裁定結果。所有多人地圖維持原有經典操控，房主可在大廳切圖，全員需重新載入確認及準備。沒有玩家碰撞、AI、公開配對或帳號系統；對戰不改玩家存檔、錢包、單人紀錄或排行榜。

## 本機執行

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

範例（只啟動本機服務）：

```powershell
$env:HOST='127.0.0.1'
$env:PORT='4320'
$env:ALLOWED_ORIGINS='http://127.0.0.1:4317,http://localhost:4317'
npm.cmd run multiplayer
```

正式 allowlist 應填遊戲前端實際 HTTPS origin，不含路徑、尾端斜線或萬用字元。WebSocket upgrade 一律要求在 allowlist 中的 Origin；健康檢查不需要 Origin。這是瀏覽器來源限制，不是帳號認證，原生客戶端仍可能自行宣告 Origin。公開服務應再由反向代理限制 IP／連線與 TLS。

## 部署

前端仍可放在 Vercel。此服務需要可保留記憶體房間、長連線與固定物理 tick 的常駐 Node 服務；不要放進目前的 `api/` request／response 函式或把高頻位置寫入排行榜 Redis。

在準備好的單實例 Node 24 主機，安裝 `server/package-lock.json` 的 production 依賴、帶上生成的 `physics.mjs`、`shared/multiplayer-protocol.ts`／`shared/multiplayer-catalog.json`、`src/data/track.json` 以及全部 `public/data/circuits/*.json`。伺服器按白名單 lazy 讀取並驗證資料，建圖快取與每房 arrays 分離。將 HTTPS 反向代理的 `/ws` 設定為支援 WebSocket upgrade 且 idle timeout 大於心跳週期，提供公開 `wss://<自己的主機>/ws`。`/health` 會回報 v2、物理及 catalog stamp，可作程序健康檢查。

用 Docker 時，build context 必須是遊戲根目錄，先完成 `npm run build` 以產生物理 bundle：

```powershell
docker build -f server/Dockerfile -t taipei-gp-multiplayer .
docker run --rm -p 4320:4320 -e ALLOWED_ORIGINS=https://your-game.example taipei-gp-multiplayer
```

既有 Render v1 服務已上線，使用者已回報可成功連線對戰；這一輪地圖版 v2 尚未部署。上面 Docker 指令尚未實測，不能以 Node 本機通過推定容器通過。本輪不會自動建立服務或付費資源；部署 v2 時需沿用實際主機的 TLS／Origin 設定，並同步更新前端公開 WSS 連線版本。Node 服務本身不提供 TLS 憑證管理。

只開一個程序／replica。沒有跨 replica 房間共享、房間持久化或斷電恢復；不能直接加多副本或在中途無縫滾動更新。重啟會中止現有比賽，客戶端應顯示房間失效。未來要擴充可加入房間分片與路由，不能只共用目前的排行榜 Redis。

## 同步與限制

完整協定見 `../shared/multiplayer-protocol.md`。遊戲使用伺服器 60Hz 物理、約 20Hz 快照；客戶端只能送方向／煞車與單調遞增 input 序號，不能上報位置或完賽。協定、物理或整包 catalog stamp 不一致會拒絕進房；每次 ready/start/input 另綁房間 track revision。v1 前端不能連線 v2 服務，發布時需一起更新前端與後端。

700ms 無新 input 自動煞車；斷線十秒可持 token 重連；第一人完賽後六十秒與全場十分鐘有結束上限。伺服器停頓超過五秒中止未完成者。此版本沒有行車輸入以外的完整反濫用或公平網路認證：不宣稱抵擋自動駕駛、修改客戶端輔助或惡意流量攻擊。

測試可 import `createMultiplayerServer({now, autoTick:false, allowedOrigins})`，透過 `httpServer.listen(0,'127.0.0.1')` 取得隔離隨機埠，再以 `service.tick(now)` 快進。只有程式內測試能呼叫 tick／檢視房間；網路協定沒有作弊或跳終點指令。測完呼叫 `await close()`，不影響其他既有服務。
