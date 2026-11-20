# 城市巡航、警匪與雙人追走

本輪提供三種共用真實城市道路的獨立私人房玩法，入口為主選單「城市巡航／警匪／追走」，也可在「玩法搜尋・收藏・最近遊玩」分別開啟。車款皆沿用遊戲虛構名稱。署名：Rex <game88521@gmail.com>。

## 玩法與規則

- **巡航**：1～4 人，所有人準備後由房主起跑，最多 30 分鐘，可中途加入。友車穿透。可低速換車；晴／雨／夜天候由房主共用設定。集合點只接受既有城市站點，2 秒冷卻、30 秒期限；低速返回集合區有 10 秒冷卻。越界或無效物理狀態會回集合區。
- **警匪**：2～4 人，3 秒倒數、3 分鐘限時，前 10 秒保護。追捕方與逃跑方同層且相距不超過 6 公尺，逃跑方速度低於 5m/s、追捕方低於 8m/s、相對速度低於 6m/s，持續 2 秒才逮捕。HUD 顯示最近對手距離、相對方向、高度差及攔截進度。超時未被捕者逃脫；對手全離線超過續接期則列為中斷。下一輪交換角色。
- **雙人追走**：固定 2 人、同款紫電 GT，兩段各 60 秒，交換領跑／追走。追走必須在領跑車後方 3～25 公尺、同向同層，雙方至少 7m/s，追走車有有效滑角。距離、橫向偏移、滑角及連段決定權威計分。接觸會中斷連段並停止計分 1 秒。中途離席列為中斷。

警匪與追走起跑後有 3 秒友車接觸保護。巡航沒有車碰。這些獨立玩法不寫入正式 PB、單人錢包、賽季或成就；退出時由 main 接線還原原車況、位置與天候。

## 架構及部署

`shared/expedition-social.ts` 為版本、快照解析與純判定契約，`server/expedition-social-service.mjs` 透過 `/city-social` 處理。版本為 `expedition-social-v1`。伺服器以真實 `FreeCar`、既有城市道路／碰撞資料 60Hz 推進，20Hz 快照，客戶端只送操控輸入。輸入有 seq／runId／epoch、90 則/秒及 4KB 上限，700ms 舊輸入停止加速。客戶端採 30Hz 預測與 ack 重播，友車插值且使用真車模型。

前端沿用 `VITE_MULTIPLAYER_URL` 的主機，將路徑改為 `/city-social`。HTTPS 頁面只接受 WSS，拒絕帳密、query、fragment；本機 HTTP 未設定時才使用 `ws://127.0.0.1:4320/city-social`。後端沿用精確 Origin 白名單及共用連線容量。Docker 必須包含新 shared/service 檔；由 `server/index.mjs` 接線。

本輪 `odyssey-diagnostics` 保留實際 `/ws`、`/coop`、`/city-race`、`/city-social`、`/city-duty` 路徑；HTTP capabilities 宣告新版本，不能用舊 `/ws` 的成功冒稱新玩法可用。新城市端點須核對 hello 版本再確認 ping/pong。合作配送 `/coop` 的 ping 原有集合點語意，因此只驗其版本化 hello 與城市指紋。

## 存檔、備份與離線

私席保存在 **sessionStorage** `taipei-gp-expedition-social-seat-v1`，包含續接 token，最多保留 15 秒手動續接；重連旋轉 token 與輸入 epoch。不自動重試或重複建房，按離開會清席位。

本機最近 20 場摘要使用 **localStorage** `taipei-gp-expedition-social-results-v1`，只存場次隨機 runId、時間、玩法／天候、結束原因、暱稱與計分摘要，沒有房碼、玩家 ID 或 token。損壞原文、跨頁修改或寫入失敗會停止覆寫。

整包備份擴為 26 類，包含新 HUD／連線偏好／圈速教練／每日／拉力／救援／城市好友戰績；仍接受完整的舊 15、17、19 類，混合世代拒絕，缺少的新分類維持原值。所有私席憑證均排除。新增社交與救援 UI 遲載 chunk 不納入一般自由駕駛離線包；連線玩法仍需服務。

## 本機驗證及界線

目前已執行：

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
node tools/dev-tests/expedition-social-node.mjs
node tools/dev-tests/expedition-social-client-node.mjs
node tools/dev-tests/expedition-diagnostics-node.mjs
node tools/dev-tests/expedition-backup-node.mjs
```

對應結果為 19、6、11、7 個案例 PASS。伺服器測試使用真 loopback WS、真 `FreeCar` 和真城市道路資料；警匪遠距超時、追走計分／接觸、越界及離線中斷案例均明示控制 server pose 的 fixture，不能當成人工實跑全城市或平衡性認證。快照在各層只允許已知欄位，拒絕 `update`、`geometry`、`__proto__`、token 等額外欄位；本車修正僅寫入明列的物理數值。介面的階段、結束原因、個人結果均以繁中呈現；警匪追捕方只有在權威判定全員逮捕後標為獲勝，超時有對手逃脫則標為落敗，離席或服務中斷明列不計勝負。純資料測試包含這些結果關係。

首輪雙瀏覽器回歸已確認真 UI 雙人建房／準備／起跑、共用雨天與友車 mesh，以及原生鍵盤輸入獲 server ack 並移動。該輪手機檢測誤掃到收合 `<details>` 裡保留的 layout rect，已改成明確展開診斷／戰績再逐項 hit-test，保留首輪失敗證據。另修正真正的時序問題：同車只換天候不再重置車輛 epoch；實際換車時仍在途的舊世代操控只作過期丟棄，不動新車，也不誤報為位置造假，未來世代／重複序號／額外欄位仍拒絕。獨立真 WS 客戶端測試涵蓋這個 configure→input 競態與新世代 ack。

`tools/dev-tests/expedition-social-browser.mjs` 已於最終本機 build `d5068bed213b` 重跑，**7 PASS／0 FAIL、Node exit 0**，例外及外網請求均為零，來源／腳本測試期間未變動，兩個 context 與 4320 後端均清理。使用既有 preview 4317、專用 Chrome `GP_MULTIPLAYER_CDP_PORT`（預設 9334）；兩個獨立 browser context 真 UI 建房／準備／起跑、共用雨天與友車 mesh、原生鍵盤推進獲 server ack 51 並實際移動約 0.5969m、390×844 與 844×390 展開診斷／戰績後所有可操作控制的尺寸與點擊命中、離房還原位置與受保護單人資料、舊自由駕駛及警匪／追走雙 UI 起跑角色均通過。外網請求一律封鎖。瀏覽器原始證據為 `tools/dev-tests/expedition-social-browser-result.json` 及其 evidence 路徑；上一輪 build `347a8f72fb12` 的 7 PASS 證據與首輪失敗原始報告／截圖（`expedition-social-browser-evidence-1795173380860`）均保留。報告的 build 欄綁定本機 dist 版本。

真手機、兩台實機、跨網路延遲、免費主機容量和人工警匪／追走平衡性仍需另驗。沒有 commit、push 或部署。
