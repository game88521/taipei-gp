# 第 4 項：城市社交房短斷線自動續接

署名：Rex <game88521@gmail.com>。共用排程約定與 30 案證據見 [FRONTIER_CITY_RECONNECT.md](./FRONTIER_CITY_RECONNECT.md)。此文件說明巡航、警匪及追走的真服務／客戶端接線。

只有已成功加入的車手席位在非預期斷線後，才自動續接。初次進房、觀眾、主動離房／取消、被移出及房間到期都不自動進房。hello 必須精確宣告 `autoResumeVersion: frontier-city-resume-v1`；舊後端只提供手動續接，仍須明確確認操控。

## 玩家流程

首次察覺中斷起最多 3 次、共 15 秒，單次最多 4 秒。普通網路失敗退避 500／1500ms；typed `SEAT_BUSY` 改為 3000／5000ms，讓舊連線有機會釋放，但不增加次數或截止時間。背景時不開新嘗試，回前景也不重新給 15 秒。取消、耗盡或 terminal error 都停止排程；可在伺服器原保留期內手動續接，或明確離房。

除了真 WebSocket close，既有 `frame()` 也呼叫 `checkConnection()`：前景且已進房時，通過完整 parser、同房、非舊 serverTime 且含原席位的權威快照停更超過 3500ms，即使 socket 仍 OPEN、ping／pong 還通，也先關閉舊 transport、停止操控，沿同一有界流程檢查原席。hello、pong、無效及過期／跨房快照都不延長狀態 watchdog。重複 frame 不另開 episode。觀眾只結束觀戰，不轉為車手或自動進房。watchdog 沒有新增 interval，隱藏頁面不以停更啟動重連。

斷線後自動開啟續接面板並暫停主駕駛狀態。油門、方向、準備、開始、換車、標記、復位及房主管理均由 client gate 拒絕，不重送舊命令。成功接回先停在 `confirm`；玩家按「確認恢復操控」，取得匹配目前 runId／epoch 的 server ACK 後才解除 gate。Escape／關閉面板不能繞過確認，仍可選擇離房。

已接回的確認階段不再有續接 timer，可等待超過原 15 秒再確認。確認前又斷線只沿原 episode、原次數及原截止點，不另給 15 秒。手動續接同樣先取消背景排程，再進確認畫面，不新增自動重試期限。手動遇到暫時 busy／連不上只關閉失敗 transport，保留私席、RAM key、借車與操控 gate，可在原期限內重試；不因 UI catch 自動離房或刪除憑證。

主要 DOM：`#social-reconnect`、`#social-reconnect-status`、`#social-reconnect-cancel`、`#social-reconnect-confirm`。`dispose()` 完整呼叫 client／helper dispose，移除 visibility listener、清除 timer、關閉 transport；普通離房可 reset 後重新開房。

## 伺服器席位安全

客戶端以 crypto 產生每輪 24 hex 的 `resumeKey`，只放 RAM。session seat 仍只含既有 endpoint／code／selfId／token；不將 key 寫入 session、存檔、備份、診斷、快照或匿名回放。

首次帶 key 的 resume 旋轉一次 token 與輸入 epoch，服務 RAM grant 綁定同一席位、key、oldToken、newToken 與首次斷線的固定截止時間。若 welcome 在旋轉後遺失，同 key 配 old／new token 可在原期限內冪等取回同一 newToken，不再旋轉、不延長 grace；仍有 live client 時回 `SEAT_BUSY`，不允許雙綁。oldToken 不能換 key 或改為無 key 重播。持有 newToken 的手動流程可重新旋轉，仍必須在原剩餘保留期內。

`SEAT_BUSY` 是 retryable；`SEAT_EXPIRED`、`SEAT_REJECTED`、`VERSION_MISMATCH`、`ROOM_GONE` 是 terminal，adapter 保留 typed code 交給共用排程。比較 token 使用 timing-safe 比對。

`confirm-resume` 精確驗證 code、selfId、resumeKey、runId、epoch 及當前綁定連線。成功後撤 grant；有效 input 也撤 grant。服務在當前連線暫存最後成功確認的 key／runId／epoch，讓首個 ACK 遺失時可重按並回同 ACK；drop 或換場清掉這份記憶。移除、離房及保留期到期都依既有規則撤銷憑證與輸入。沒有增加帳號登入或永久封鎖。

## 驗證與界線

`node tools/dev-tests/frontier-social-reconnect-node.mjs` 最終 **15 PASS／0 FAIL**，使用真 loopback、真服務及真 client，外部請求 0。覆蓋確認 gate、lost welcome、雙綁、同 grant 冪等、換 key 拒絕、typed error、原期限、確認 ACK 遺失重按、取消後手動 busy 再續接、三次耗盡、觀眾／主動退出隔離、確認前再斷、OPEN outbound 全靜默與只斷快照但 ping／pong 尚通的 watchdog，以及 welcome resolve 後同 tick owner 取消。所有房間、席位、連線皆已清理，來源／腳本雜湊未在測試中改動。

故障 fixture 均明示：只攔截真服務 welcome／ACK／outbound、回覆明示 typed busy／撤席錯誤，或 offset clock 驗期限；沒有 fake socket、注入車位／phase／分數。

首輪 **12 PASS／2 FAIL** 保留於 `tools/dev-tests/frontier-social-reconnect-before-result.json`。一案是 fixture 尚未等 server close 就推進時鐘，導致清理多留 1 房；改成先等真 server clients 清空再推時間，未放寬產品期限。另一案抓到 welcome 已 resolve 後 owner 同 tick disconnect 時，helper abort 會把最終 idle 蓋成 closed；產品改成先 reset helper、最後完成 owner 狀態清理，相同 late-welcome 案已 PASS。

狀態 watchdog 新增對照修改前 **14 PASS／1 FAIL**，保留於 `frontier-social-reconnect-snapshot-watchdog-before-result.json`：只攔 room 快照並保留真服務 ping／pong 時，舊版錯將 pong 當狀態更新，沒有停止操控。改成只在接受權威快照後刷新時鐘，相同案例已 PASS。

既有社交服務 **19 PASS**、房主管理 **19 PASS**、舊能力手動 client **6 PASS**、連線診斷 **11 PASS**，TypeScript exit 0。舊 client 手動案例已明示移除 hello auto capability，保留 token 輪替與確認 gate 斷言；修改前因新預設自動續接而出現的 **5 PASS／1 FAIL** 保留於 `frontier-social-client-manual-before-result.json`。

觀戰／匿名回放 **19 PASS**，包含四車真 12 分鐘容量截短與 **3,010,839 字元／123 塊** 完整下載。整體 build、瀏覽器續接面板與主 state 暫停、固定三回歸另由最新整合證據記錄；Node 不證明畫面。實體手機背景節流、不同網路真人及免費主機容量尚未驗證。本代理未 build、操作 CDP、commit、push 或測正式站。
