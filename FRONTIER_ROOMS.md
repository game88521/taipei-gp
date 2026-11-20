# 第 2 項：城市房主管理

署名：Rex <game88521@gmail.com>。

城市巡航／警匪／追走共用社交房新增房主管理。房主可鎖定新加入、開放新加入，以及移除其他席位；管理只在大廳或進行中的自由巡航開放。倒數、競技進行中與結束畫面均由伺服器拒絕管理，避免中途改變競技人數。房主自己請使用既有離開操作。

鎖房只阻止新 `join`，不阻止斷線原席在 15 秒保留期內 `resume`；續接沿用玩家 ID 並輪替 token。這不是帳號系統或永久封鎖，移除後原憑證失效；房間重新開放時，玩家仍可用全新席位加入。

移除先顯示目標暱稱與席位，預設聚焦「取消移除」。取消、Escape 或關閉面板都不送管理命令。確認保存當下房間碼、revision、房主與目標 ID；房主或名單變化時自動取消，要求重新選擇，不將舊確認套到同席號的新玩家。

伺服器精確驗證以下命令，拒絕未知或缺漏欄位、過期 revision、跨房間、非目前房主與無效目標：

```ts
type SocialManagement = {
  code: string; revision: number; hostId: string; targetId: string;
} & ({ action: 'lock'; locked: boolean } | { action: 'remove' });
// wire 另含 type: 'manage'；lock 的 targetId 必須是目前房主。
```

房間增加 `locked:boolean`，採嚴格快照解析。協定升為 `frontier-social-v2`；本輪後續城市社交功能共用此版本，前後端需要一起更新。前端與伺服器診斷原已引用 `SOCIAL_VERSION` 常數，本輪保留並透過整合診斷回歸核對，不另寫版本字串。

加入、離開、斷線、續接、席位到期及房主交接都更新 revision；大廳成員或連線變化也取消準備。大廳顯示尚缺玩家、未準備車手、斷線待續接，全部就緒後提示等待房主。鎖定狀態向全房顯示，管理按鈕僅房主可操作。

移除在伺服器同步刪除席位、集合標記與續接 token，清空輸入／佇列、停止目標車輛速度並解除連線的房間綁定。目標收到 `removed` 後，真客戶端清除 session 中的 `taipei-gp-expedition-social-seat-v1`、room、自身 ID、序號及續接能力。UI 立即清理預測與好友圖形，呼叫原本還車流程，還原借車前狀態；不等待關閉面板或下一次操控。已移除連線再送輸入無權控制原車。

介面元素供本機瀏覽器驗收：`#social-management`、`#social-lock`、`#social-lock-status`、`#social-waiting`、`#social-remove-<slot>`、`#social-remove-confirmation`、`#social-remove-confirm`、`#social-remove-cancel`。管理區在非房主畫面只顯示狀態與說明。

整合瀏覽器首輪發現真問題：借車返回後，房間面板背後仍進行一般駕駛，單人 `playTime` 從 0 增加約 0.3723 秒。主代理另修整合還車的暫停狀態；本介面補上被移除或房間到期時先顯示房間面板，再還車並呼叫開面板暫停接口，保留權威原因。焦點落在狀態旁的 `#social-exit-close`「返回選單」，可明確退出，不自動恢復駕駛；此流程不遞迴呼叫離房或清掉 `lastExit`。修補後實際暫停與存檔隔離仍由整合瀏覽器重新驗收。

本項另包含第 1 項實際截圖發現的 HUD 遮住小地圖修補：正常高度移至小地圖下方；高度不超過 480px 時移至地圖右方，限制最大高度並允許滾動，保留至少 44px 控制。實際矩形不得相交與手機直橫版面由整合瀏覽器驗收，不以 CSS 數值推定已通過。

驗證使用真 loopback WebSocket、真服務與實際客戶端，不連公開服務、不替換物理。`node tools/dev-tests/frontier-room-node.mjs` **19 PASS／0 FAIL**，涵蓋真 `manage()` 保留舊確認、移除停止真車、清除 session、鎖房續接、房主交接、跨房與競技限制；來源雜湊及清理檢查均通過。修補後新增真服務超過 35 分鐘期限的到期案例，並核對 removed／expired 的 changed 觀察者同次已見原因、lastExit 及完整清理狀態；修補前 18 PASS 報告另存 `frontier-room-node-stage2-before-result.json`。既有 social **19 PASS／0 FAIL**、client **6 PASS／0 FAIL**、diagnostics **11 PASS／0 FAIL**，`tsc --noEmit` 通過；client 與 tsc 已於 UI 修補後重跑通過。

專用測試首輪 **15 PASS／2 FAIL** 為任意 room 廣播先於待驗指令回應，以及「移除／移出」文字斷言過窄；原報告保留 `frontier-room-node-before-result.json`。專用 helper 改為觀察真伺服器已消費訊息、配對當前權威快照；文字案同時核對 `lastExit==='removed'`，沒有更改產品或放寬權限斷言。

首輪舊 social 併行測試為 **13 PASS／6 FAIL**，首個建房遇既有 3 秒回應期限，後 5 個為未建立 cruise 測試資料的連鎖失敗，原結果保留 `frontier-room-social-parallel-before-result.json`。原樣串行重跑 **19 PASS／0 FAIL**，未修改舊 timeout、斷言或回歸基準。

尚未 commit、push 或部署。外網連線、真人競技平衡、實體手機與長時間效能尚未驗證；本代理不執行 CDP 或整體建置，整合驗證由主代理執行。

## 最終統一回歸

2026-11-21 本輪build **caeeecc35bef**已完成34套Node／服務、14套瀏覽器與固定三基準，詳見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。本段是最後封版狀態；上文各次build、待root與before FAIL保留開發當時事實，未改寫原始證據。PASS只涵蓋本機實作與驗證；真機／外網／完整真人駕駛限制依統一報告，沒有commit、push或部署。
