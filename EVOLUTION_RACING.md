# Evolution 單人競速：1／8／9

只在 `taipei-gp-evolution-racing` 實作；沒有 commit、push、連外或線上測試。實際瀏覽器與三個固定 120 Hz BOT 基準交由 root 統一驗證；本文件不宣稱已通過那些瀏覽器項目。

## 1：AI 並排與安全回場

設定 → 比賽 → `#opt-ai-policy`：新的一般 GP 預設「安全並排 v1」，可明確選原版。固定 BOT、賽季、版本 1 checkpoint 一律保留 legacy。沒有改 snapshot 格式或舊賽季策略，也沒有增加 Math.random、改 pitRnd 次序、修改 car／track／pitlane／server physics。

真 before `taipei-gp-evolution-before-d251460c360c/src/rivals.ts` 由真 RaceField.drive 重現：AI 卡住超過三秒後直接 placeAt，與同點來車中心距離小於 0.01 m。新版在扶正前檢查同線前方 14 m、後方 `10 + 1.5 × 來車速度` m 走廊，以及全車 7 m 實距；沒有空檔便煞車等待。扶正仍在同一賽道取樣點，不向前跳來取得進度。

並排時目標預留 2.8 m，重疊車未完全清開前限制換線，路緣不夠空間先煞車。這是新的行為規則，不保證消除所有物理碰撞；無附近約束時保留原目標公式。legacy 真 before／after 5000 步 snapshot 和一般亂數呼叫完全一致。

## 8：GP 情境挑戰

開始頁展開 `#gp-challenges`，在目前賽道選三個獨立入口：

- `#gp-challenge-pursuit`：種子 81012，最後兩圈 P12 追 P8。
- `#gp-challenge-defend`：種子 81006，中性胎磨耗 78%，最後一圈 P6 守位。
- `#gp-challenge-rain`：種子 81010，濕地 60%、雨胎、最後一圈 P10 內且重撞不超過兩次。

固定經典規則、簡單 AI、安全並排 v1；同一賽道同一關快照完全可重試。從真 RaceField.snapshot 建立固定情境，再用真 restore 啟動，之後真 Car.update／RaceField.update／playerLap 物理過線。HUD `#gp-challenge-hud` 即時顯示名次／條件／剩餘圈／胎況／實際耗時；完成顯示成敗，提供 `#gp-challenge-retry`、`#gp-challenge-exit`。扶正、重置、未依序跑圈或逾時失敗。暫停可續開；離開、換模式及 pagehide 清理。

關卡 step 提前獨立返回，不觸發正式圈速、GP 結算、賽季 checkpoint、錢包或成就；tickStats 亦隔離。通關次數與最快實際耗時只存在獨立 localStorage `taipei-gp-scenarios-v1`，以賽道 stamp／classic／safe-v1／關卡分組，不屬於正式存檔備份。

## 9：TT 影子分享

紀錄頁展開 `#tt-ghost-share`。`#tt-ghost-download` 下載自己目前賽道／規則的正式 PB；`#tt-ghost-file` 選 JSON 或 `#tt-ghost-paste` 貼上後按 `#tt-ghost-import-paste`。`#tt-ghost-source` 切自己的 PB／好友，`#tt-ghost-clear` 取消好友。

獨立 `taipei-gp-tt-ghost` v1／tt-v1 契約，核對 circuit、完整 stamp、規則、formula 車種、10～3600 秒、4～8192 點、五欄等長有限數值、時間／距離單調、首尾完整圈、速度與座標跳躍、賽道幾何，以及 2 MB 位元組上限。完整備份、異圖、異版、異規則明確拒絕。匯入只留本分頁的參考，不寫 Save，不覆蓋自己 PB，也不送全球榜；正式自己跑出 PB 仍走既有正式流程。

好友參考整合原影子車顯示與即時距離差，也使用現有 TtCoach.current／interpolateCoach 作同距離速度比較。好友速度由位置推算；沒有煞車遙測，UI 明確說明。倒退或超出合理幾何的既有個人 PB 可以繼續自用，但會拒絕分享。影子沒有簽章，驗證代表格式／相容／軌跡合理，不是防作弊認證。

同檔重選會清空 file input；新選檔、貼上、取消、規則變更、模式入口與 pagehide 撤銷舊讀檔意圖，晚到成功或失敗均不覆蓋新意圖。

## 本範圍驗證

```powershell
node --experimental-vm-modules tools/dev-tests/evolution-racing-ai.mjs
node --experimental-vm-modules tools/dev-tests/evolution-racing-challenges.mjs
node --experimental-vm-modules tools/dev-tests/evolution-racing-ghost.mjs
npm.cmd run build
```

AI 5、挑戰 5、ghost 6 項 Node 測試通過，涵蓋真 before 重現、真物理跑完三關、真 main step／stats／checkpoint 隔離與影子邊界／晚到意圖。額外舊 `twelve-racing-regression.mjs` 20 項通過。這些不是手機、效能或瀏覽器點擊證據；root 整合後另驗。

`main-racing-integration.mjs` 舊 20 項亦通過。`evolution-racing-browser.mjs` 已編寫並作 Node 語法檢查，尚未執行；由 root 對本機 dist／既有 CDP 循序執行，預設 preview 4386，支援 `GP_EVOLUTION_RACING_PORT`、`GP_CDP_PORT`／`GP_MULTIPLAYER_CDP_PORT`。腳本涵蓋三關真 UI 起跑／失敗／重試／退出、追逐關真完賽、正式資料保護、實際下載／選檔／重選／貼上／切來源／晚到取消，以及一般 GP safe-v1／legacy 真選項。
