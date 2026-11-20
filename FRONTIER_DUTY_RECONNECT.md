# Frontier 第 4 項：合作救援短斷線自動續接

作者：Rex <game88521@gmail.com>。承接第 3 項 build `1c02903cc913`，未 commit、push 或部署。本代理未執行產品 build 或 CDP。

## 使用方式

- 原司機與協助者遇非主動斷線，只有後端精確宣告 `features.autoResumeVersion=frontier-city-resume-v1` 才自動續接原席；觀眾不恢復私人隊員席。
- 同一 episode 最多三次、首次意外斷線起 15 秒，每次握手最多 4 秒。共用 helper 保留原期限／次數，背景頁不送新嘗試；返回頁面也不延長期限。一般退避 500／1500ms，`SEAT_BUSY` 為 3000／5000ms。
- 前景、已加入房間且仍顯示 WS OPEN 時，若成功解析且同房的 room／state 超過 4 秒沒有更新，500ms watchdog 會先停止原 transport，釋放操控並啟動同一有界續接。hello 只初始化時間；pong 或無效／跨房資料不能延長快照期限。觀眾只結束跟車。
- 續接時保留借車、打開房間面板並暫停；自動成功或手動成功都先顯示「確認恢復操控／作業」。確認之前不送 input、operate、ready、start、action 等業務命令，Escape／返回按鈕也不能繞過。
- 確認按下後仍等伺服器 ACK 才解除操控閘門。1.5 秒未收到 ACK 可手動再按；沒有自動重送確認或任何舊油門、方向、警示、絞盤與卸載。協助者必須重新按下作業。
- 取消會停止排程、關閉待續接連線，但保留記憶體中的本次 key 及私人席位，原期限內仍可手動續接。明確結束還車才清除席位憑證。
- 舊後端未宣告能力時只提供手動續接並顯示更新提示；手動成功同樣需要確認。

## 服務端與憑證

- 每個 episode 的 `resumeKey` 由 crypto 產生 24 個 hex 字元，只在記憶體及當次 WS 握手使用，不進 storage、回放、診斷、成績或公開快照。
- 服務端每席最多一個 RAM grant，綁定 oldToken、newToken、key、當場 run／revision 與第一次 drop 的絕對 15 秒期限。原 token 只能配同一 key 重取相同 newToken，不會再次輪替或延長期限；更換 nonce 及冒用其他席位都拒絕。
- 若已收到 welcome 並保存有效 newToken，未確認便重開頁面時，新 client 可用該 current token 配新的 key 手動續接；必須原 socket 已斷，會撤換舊 grant 並安全輪替，但仍沿第一次 drop 的 expiresAt。舊 token 仍不能換 nonce 重播。
- 原 socket 尚未釋放回 `SEAT_BUSY`；`SEAT_EXPIRED`、`SEAT_REJECTED`、`VERSION_MISMATCH`、`ROOM_GONE` 為終止錯誤。觀眾、主動離房、席位釋放、過期或版本不符都不自動重試。
- 確認或新的合法 input／operate 會撤銷 grant，無效指令不撤銷。已連線但仍等確認的玩家過 15 秒不會被踢；若未確認又斷線，仍沿用原 episode 期限與次數。
- 同連線、同場的重複確認可冪等回 ACK；首次 ACK 遺失不會令操控永遠被鎖。drop／reset 清除確認紀錄。
- 每次 await 續接後再檢 signal、client 世代、connected、room 與原 selfId，避免取消或換模式後晚到的 welcome 復活。
- 離房清計時器與待完成下載，UI dispose 另外 dispose 共用 helper，解除 visibilitychange listener；watchdog、heartbeat、confirm timeout 與 transport 都會清理。

## 接線與驗證

UI IDs：`expedition-duty-reconnect-status`（`dataset.phase`）、`expedition-duty-reconnect-cancel`、`expedition-duty-reconnect-confirm`。

Client 提供 `reconnectState`、`controlGated`、`confirmPending`、`cancelReconnect()`、`confirmReconnect()`。新後端的 `confirmReconnect()` 送出後回 `false` 並等待 ACK；收到 ACK 才解除 gate、由 UI 關面板。舊後端本機確認可直接回 `true`。

```powershell
node tools/dev-tests/frontier-duty-reconnect-node.mjs
node tools/dev-tests/frontier-duty-watch-node.mjs
node tools/dev-tests/frontier-duty-replay-node.mjs
node tools/dev-tests/expedition-duty-node.mjs
node tools/dev-tests/expedition-server-node.mjs
```

本輪針對性驗證 **14／14 PASS**，涵蓋原席／職責、welcome 遺失與 token 單次輪替、雙綁與換 nonce、原期限不延長、取消後手動重用同 key、操控／作業閘門、確認 ACK 遺失、同 tick 取消後晚到成功、OPEN 但停收的 watchdog、持續 pong 但快照停更、重建 client 用 current token 手動恢復、觀眾及舊後端能力限制、typed 終止錯誤。真 WS 全部只連 loopback；來源與腳本執行期間未改動。

舊觀戰 **6／6**、匿名回放 **7／7**、原 duty **14／14**、server 整合 **9／9** 與 TypeScript 皆通過；Docker 遞迴白名單驗 45 個 runtime 檔案、24 個賽道資產及 184 個城市圖塊，未做 Docker image build。

首輪 7 PASS／2 FAIL 已保存 `tools/dev-tests/frontier-duty-reconnect-node-before-1795181665573.json`：一案為測試未等真 WS close 回呼便檢查 held；另一案為舊後端手動恢復受 capability eligibility 阻擋。修正 fixture 與 eligibility 後重跑通過；未改基準或跳過失敗。

專用報告：`tools/dev-tests/frontier-duty-reconnect-node-result.json`。UI 暫停、按鈕、Escape、手機版面與最終建置由 root 統一瀏覽器驗證；本文件未將尚未跑過的 gate 標為通過。勤務絞盤案例使用明示同層停靠／stage fixture，不代表真人跑完整路線。手機實機、跨裝置與外網服務負載尚未驗證。
