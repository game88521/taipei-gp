# Render 免費測試部署

Rex 選擇「沒有主機，請幫我選免費測試方案」，本輪選用 **Render 的 Free Web Service**，前端繼續沿用 Vercel。此檔和 `render.yaml` 是部署準備，尚未建立服務、連接帳號或公開上線。

官方文件讀取被本機自動核准服務以 403／codex-auto-review 模型不可用拒絕，本輪沒有核實 Render 當前免費額度、信用卡要求、區域供應或欄位版本。建立服務時必須以 Render 控制台顯示的 **Free／0 費用**為準；如果只提供付費方案，先停止建立，不自動升級。

## 已備妥的設定

- `render.yaml`：單一 Node 24 Web Service，Free、Singapore、`/health`，部署不會修改玩家資料。
- 建置會安裝根目錄及 `server` 的鎖定依賴，再從原 Car／track 建立物理 bundle；根目錄明確使用 `--include=dev` 安裝建置需要的 Vite，避免受平台 `NODE_ENV=production` 影響。不用把 `node_modules` 上傳。
- 啟動 `node server/index.mjs`，讀取 Render 提供的 `PORT`，監聽 `0.0.0.0`。
- `autoDeploy: false`：避免每次推送直接更新正在比賽的服務。重啟會中斷記憶體房間。

## 完成公開連線還需要

1. Rex 登入／建立自己的 [Render 帳號](https://dashboard.render.com/)，授權連接自己的 GitHub 專案。此步由帳號擁有人操作，不要在聊天提供密碼、登入驗證碼或帳單資料。
2. 程式仍未 commit／push，必須先明確授權本輪提交／發布，讓 Render 能讀到本輪檔案。不要用舊 main 假裝已含連線功能。
3. 從 repo 的 `render.yaml` 建立 Blueprint；確認只有一個 **Free Web Service**、沒有資料庫或磁碟、區域可用。若控制台不接受設定欄位，以官方頁面與實際錯誤修正，不切付費方案。
4. `ALLOWED_ORIGINS` 填前端的精確 HTTPS origin，例如既有遊戲的 `https://taipei-gp.vercel.app`。可以另外加入測試部署 origin，逗號分隔，沒有尾端斜線或路徑。
5. 部署成功後取得 Render 分配的公開網址，WebSocket 對應 `wss://實際服務名稱.onrender.com/ws`；不能用此範例名稱冒充真端點。
6. 在 Vercel 的前端建置環境設定公開 `VITE_MULTIPLAYER_URL` 為實際 WSS URL，重新建置測試部署。只把公開網址放在 VITE 變數，不放密鑰。
7. 先驗測試部署的兩位玩家、重新連線與服務重啟，再經 Rex 授權切正式版。不使用正式遊戲站壓測。

## 免費測試的使用方式

Free 服務可能在閒置後休眠；首次開房可能要等待服務喚醒。若第一次顯示連線失敗，等服務就緒再按建立／加入；不要把首次失敗誤當成房間碼錯誤。這輪沒有在真 Render 上量測喚醒秒數，不保證固定等待時間。

兩名玩家先等伺服器就緒，再共用房間碼。連線中的正常心跳是為了偵測斷線；沒有新增定時呼叫來繞過免費平台休眠限制。免費服務適合朋友試玩，公開網路延遲、可用性、負載及手機實機尚未驗證。

官方參考（本輪讀取未成功，需由帳號控制台確認）：[Free services](https://render.com/docs/free)、[WebSockets](https://render.com/docs/websocket)、[Blueprint specification](https://render.com/docs/blueprint-spec)。
