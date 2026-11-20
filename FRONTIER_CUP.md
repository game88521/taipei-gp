# 第 12 項：四人好友盃

作者：Rex <game88521@gmail.com>

入口在既有 `multiplayer.html` 的房間大廳下方「四人好友盃」。這是既有 GP 權威車輛模擬中的獨立盃賽，不走 series。沒有新增服務路徑、套件或存檔鍵。

## 玩法與界線

- 四位新版真人都載入後，房主鎖定名單、目前賽道、1／3／5 圈及碰撞／完賽寬限房規。種子依原加入 slot 排 1～4。
- 準決賽 A：1 對 4；準決賽 B：2 對 3；接著兩位落敗者跑季軍賽，兩位勝出者跑冠軍賽。
- 每小場只有兩個 activeIds 能輸入、模擬、計圈及碰撞；其餘原席是觀戰者，自車與名字隱藏，不用 DNF 表示候場。四位每場都要重新準備。
- Cup 的準備／取消準備必須帶 `cupReady: { cupId, cupRevision, lobbyRevision }`，嚴格核對目前小場及大廳；前一場、前一盃或已取消盃賽的舊訊息不能替新小場準備。不增加地圖 revision，也不重載地圖。普通 GP 的原有裸 ready 訊息維持相容。
- 每場相同兩個橫向發車格（-1／+1 m），不受原 slot 0／3 的寬距影響。
- 一位 DNF 時，另一位仍須真正完賽才能獲勝。兩位都 DNF、完全同時成績或 server stall 均只標本小場重賽，不晉級；房主可明確取消整盃。
- 斷線保留原席 15 秒；候場離房／逾期仍不造 DNF，也不刪固定 entrant。失去原席且逾期時無法替補／起跑，請明確取消整盃後重開。沿用單 socket 擁有者與既有 token 核對。
- 不允 AI、series、排位週末、耐久、接力、道具、限時、追逐、天候、自由練習、其他特殊房規混用。鎖盃時拒絕外人 join／watch／claim-seat；固定四個原席輪流觀戰。
- 本盃在房間的記憶體內，沒有跨 server 重啟續盃。完成後可下載只含公開名單、設定與四場結果的 JSON；不含房碼、token、私席。沒有自動保存。
- 不錄進通用單場歷史或通用單場 replay；避免把原席候場誤列 DNF／四車回放。現有結果卡會識別本盃小場與最終名次。

## 接線

- `shared/frontier-cup.ts`：版本、意圖、固定賽程、嚴格 parser、跨欄位快照驗證。
- `server/frontier-cup-service.mjs`：configure／start／next／replay／cancel、一次結算、候場權限、同組重賽與 15 秒常數。
- `server/room-service.mjs`：在其他玩法 handler 前 cupReceive；make/resume 能力；grid、toLobby、leave、expire、simulate、maybeFinish、stall、snapshot 的 cup gate。
- `src/multiplayer-client.ts`：capability、完整意圖 capture 與過期拒絕、嚴格快照、候場 sendInput gate、15 秒續接訊息。
- `src/frontier-cup-ui.ts/.css`：大廳設定／賽程、HUD 候場提示、結果、明確取消確認、下載。`multiplayer-game.ts` 已接入，無須改 main。
- `shared/summit-racing.ts` 只重匯 cup 的 client parser／常數，使既有測試對此已存在依賴的載入保持相容。
- `shared/multiplayer-horizon.ts`、scene／spectator／awareness／player list：候場不預測、不碰、不顯車、可選兩位真出賽者追看。
- 候場 HUD 與圈速摘要明示不列圈速；小場逐圈選單只列這一場的兩位出賽者，不把候場顯示成尚未完成第一圈。

`server/Dockerfile` 已包含本玩法的兩個 COPY：

```dockerfile
COPY server/frontier-cup-service.mjs ./
COPY shared/frontier-cup.ts /app/shared/
```

RoomService 已匯入 cup，所以不需在 index 額外建立服務。既有 `/ws` Origin、速率、訊息上限繼續適用。請勿改 protocol／physics version；這是 additive `frontierCup: frontier-cup-v1` 能力。

Docker COPY 集合的隔離啟動 smoke 已完成 **5 PASS／0 FAIL**：`tools/dev-tests/frontier-docker-smoke-evidence-1795188545626/result.json`，當時 build `864be4d1d7b8`。測試依實際 Dockerfile 複製 266 個來源檔及 19 個本地鎖定 `ws@8.21.3` 依賴檔，逐檔比對 SHA，並強制 171 次模組解析留在 staging；實際啟動 factory／城市預熱、health／diagnostics、24 圖、六條本機 WebSocket 與四人 Cup 準備／取消。來源未變、socket／server／staging 清理通過，外站請求為零。這是 Windows Node 24 的 COPY 集合驗證，**沒有建置或執行 Docker／Alpine image**，不能當作 Linux 權限、大小寫或 registry 安裝的證據。

## 驗證

```powershell
npx.cmd tsc --noEmit --pretty false
node tools/dev-tests/frontier-cup-node.mjs
```

測試覆蓋純 schema、真 RoomService 權限與 lifecycle、真 loopback WebSocket、真 MultiplayerClient；完整四場用真 Car.update 加方向／煞車輸入跑到權威圈線，沒有指派位置／圈數／finish／勝負。平手／DNF／stall 案使用明示的權威狀態 fixture，不能當作實際行駛證明。

測試會保留每輪 `frontier-cup-node-evidence-*/result.json`，含來源 SHA-256、完整數字與 cleanup。第一輪 16 PASS／1 FAIL 是 malformed series 測試 fixture 在 cleanup 觸發既有 prepareGrid，已修測試；失敗證據保留。補齊準備世代及候場圈速後，最終輪 **21 PASS／0 FAIL**，來源未變、cleanup 通過：`tools/dev-tests/frontier-cup-node-evidence-1795187924452/result.json`。四場真 Car／WS 都以 59628.796／58755.410 ms 完賽，候場每場都非 DNF。

準備世代的同腳本前後對照（真 RoomService＋明示 finish fixture，不使用網路）：`frontier-cup-ready-control-evidence-1795187794032/result.json` 是舊版 **FAIL**，準決賽 A 的舊 ready 使 B 場自動準備；`frontier-cup-ready-control-evidence-1795187823085/result.json` 是修後 **PASS**，同一類舊訊息被拒絕、保持未準備。可重跑 `node tools/dev-tests/frontier-cup-ready-control.mjs`，兩份證據均保存來源 SHA-256。

既有正式賽規回歸 `node --experimental-transform-types tools/dev-tests/expedition-racing-node.mjs`：14 PASS／0 FAIL。未帶 transform flag 的第一次啟動因既有 Coach TypeScript 參數屬性不支援 strip-only 失敗，不是產品邏輯失敗。

`tools/dev-tests/frontier-cup-browser.mjs` 沿 FrontierBrowserHarness 啟動四個獨立 context 後轉到本機多人頁，用真 UI 建房／四席加入／鎖盃／準備／四場切換／候場追看與圈速選單／真 wire 重放前場 ready 必須被拒絕／拒絕取消確認／原生 public JSON 檔案下載／三手機尺寸／離房清理。小場結算採明示 finish/lap fixture，不能當作真人完整駕駛證明；完整真 Car／WS 在 Node 另列。

首次 browser 在 build `e673965de1c8` 得到 **2 PASS／1 FAIL**，原報告保存為 `tools/dev-tests/frontier-cup-browser-before-controls-result.json`，完整證據在 `frontier-cup-browser-evidence-1795188718162/`。候場車模與輸入 gate 正常，但 `MultiplayerHorizonPanel.render()` 覆寫 `mp-controls.hidden` 時漏判 Cup 候場席，讓操作按鈕重新顯示；已在 `src/multiplayer-horizon-ui.ts` 補相同 Cup gate。測試也將此檔加入來源 hash，並在 assertion 前記錄逐場候場 DOM／輸入狀態。修後 TypeScript 與測試語法檢查通過。

目前 root 正以 build `caeeecc35bef` 執行最後 browser 序列，第 12 項的最終結果尚待該輪報告，不提前列 PASS。較早各份 Node／Docker 證據保留其當時來源及 build；最後交付狀態以 root 的 final validation 為準。尚無真手機或跨網路真人四場長測證據；未 commit／push／部署。

## 最終統一回歸

2026-11-21 本輪build **caeeecc35bef**已完成34套Node／服務、14套瀏覽器與固定三基準，詳見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。本段是最後封版狀態；上文各次build、待root與before FAIL保留開發當時事實，未改寫原始證據。PASS只涵蓋本機實作與驗證；真機／外網／完整真人駕駛限制依統一報告，沒有commit、push或部署。
