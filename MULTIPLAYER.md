# 私人房連線競速

提供台北及全部 23 條大獎賽賽道、2～4 人、1／3／5 圈、房間碼加入、全員準備、三秒同步倒數、即時順位、成績與再戰。房主可在建房時選圖，也能在大廳換圖；換圖後全員重新載入並準備。沿用原本多人 classic 自動油門、方向／煞車與車輛物理，保留 GP 高低差、傾斜彎與日夜場景。比賽中玩家車輛會互相碰撞：追撞傳遞速度、側擦推開，高架橋上下不互撞，撞牆照常減速。

伺服器以 60Hz 推進真實車輛、依序判定分段／終點與完賽時間，再以 20Hz 傳送快照。玩家只送方向和煞車；車輛位置、圈數和成績不接受客戶端上報。前端預測自車、平滑校正及插值其他車輛。這是朋友私人房，沒有公開配對、帳號或語音功能；不發錢或修改單人 PB、賽季及排行榜。

## 本機開啟

需 Node.js 24 以上。於專案根目錄安裝原有依賴及服務依賴，建置後啟動兩個程序：

```powershell
npm.cmd ci
npm.cmd --prefix server ci --ignore-scripts --no-audit --no-fund
npm.cmd run build
npm.cmd run multiplayer
```

第二個 PowerShell：

```powershell
npx.cmd vite preview --port 4317 --strictPort
```

開啟 `http://127.0.0.1:4317/`，選「連線對戰」，或直接開 `http://127.0.0.1:4317/multiplayer.html`。一人選圖並建房，其他人輸入六碼房間碼；全員載圖與準備完成，至少兩人，由房主開始。房主離開大廳後會自動移交。載圖失敗可重試，也可由房主換圖，無須離房。

服務預設僅監聽本機。若用同一個區域網路的其他裝置，服務設 `HOST=0.0.0.0`，`ALLOWED_ORIGINS` 加上實際前端網址（例如 `http://192.168.1.20:4317`），preview 使用 `--host`，並依系統權限允許區域網路連線。HTTP 的 localhost／私人 IP 頁面預設使用同主機的 `ws://主機:4320/ws`。不要將開發用裸 WS 直接公開到網際網路。

## 斷線與操作

沒有新操作超過 700ms，伺服器會自動煞車。切到背景或失焦時自車煞停，其他車手繼續比賽。短暫斷線十秒內可自動恢復，重新載入可按「重新連回上一個房間」；逾期記為未完成。重連憑證只放本分頁的專用 sessionStorage，沒有帳號登入。

第一位完賽後最多等六十秒；整場最多十分鐘，未完成者顯示 DNF。伺服器停頓超過五秒時結束未完成比賽。服務重啟會清空記憶體房間。

## 公開讓朋友加入

Rex 已建立 Render Free 服務 `https://taipei-gp.onrender.com`。24 圖版已於提交 `f586ca9` 部署，並由 Rex 回報「看得到地圖，且已雙人起跑」。本輪碰撞功能尚未部署，必須一起更新對戰服務及 Vercel 測試前端。設定見 [MULTIPLAYER_DEPLOYMENT.md](./MULTIPLAYER_DEPLOYMENT.md)。服務維持單實例、Node 24、WebSocket 長連線，不能改成一般 `api/` request／response 函式。

1. 依 [server/README.md](./server/README.md) 部署服務並提供 TLS，取得 `wss://自己的服務/ws`；Docker 檔已備妥，Docker build 尚未實測。
2. 在服務設定 `ALLOWED_ORIGINS` 為實際遊戲前端的 HTTPS origin。
3. 在前端建置環境設定公開 `VITE_MULTIPLAYER_URL=wss://自己的服務/ws`，重新建置並部署前端。
4. 先在測試部署驗證兩位玩家與行動網路，再決定正式上版。

沒有設定公開端點的頁面會顯示「連線服務尚未開放」。碰撞版使用 `classic-multitrack-collisions-v3`；舊 v1 及 24 圖 `classic-multitrack-v2` 前端無法加入新後端。兩端必須配套更新；要保留舊版多人連線，須分開服務及端點。單人模式不依賴對戰服務。本輪尚未 commit／push；碰撞版外網與手機實機尚未驗證。

## 架構與重跑

- `multiplayer.html`、`src/multiplayer-game.ts`／`multiplayer-scene.ts`／`multiplayer.css`：獨立多人入口，不進入單人結算流程。
- `src/multiplayer-client.ts`：房間操作、時鐘校正、序號及 token 重連。
- `shared/circuit-catalog.ts`／`multiplayer-tracks.ts`／`multiplayer-catalog.json`：共用 GP metadata、24 圖白名單及指紋。
- `shared/multiplayer-track-recipe.ts`／`src/multiplayer-track-loader.ts`：GP 幾何配方、按需下載及每房獨立賽道。
- `shared/multiplayer-protocol.ts`／[協定說明](./shared/multiplayer-protocol.md)：訊息、版本與賽道身分。
- `server/room-service.mjs`／`index.mjs`：權威物理、房間、Origin 及資源限制。
- `shared/multiplayer-collisions.ts`：多人車身碰撞、掃掠防穿車及高度分層；全車更新後解碰撞，再以最終位置計進度及成績。
- `src/multiplayer-collision-feedback.ts`：碰撞權威修正及附近車輛的畫面同步。
- `tools/build-multiplayer-physics.mjs`：直接將現有 `Car`／`buildTrack` 打包成 `server/physics.mjs`，不維護另一套物理參數；每次 `npm run build` 自動生成。

測試入口見 [測試計畫](./tools/dev-tests/MULTIPLAYER_TEST_PLAN.md)，本輪設計及結果見 [MULTIPLAYER_COLLISIONS.md](./MULTIPLAYER_COLLISIONS.md) 與 [MULTIPLAYER_COLLISIONS_VALIDATION.md](./MULTIPLAYER_COLLISIONS_VALIDATION.md)；選圖歷史結果見 [MULTIPLAYER_MAPS_VALIDATION.md](./MULTIPLAYER_MAPS_VALIDATION.md)。v1 歷史結果保留在 `MULTIPLAYER_VALIDATION.md`。若修改物理、賽道或協定，必須同步更新身分並重建前後端，版本不一致會拒絕加入。
