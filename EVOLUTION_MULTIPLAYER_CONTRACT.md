# Evolution 多人增補契約

沿用 wire v2、`classic-multitrack-collisions-v3`；不修改 server/physics.mjs。全部成績仍由伺服器進度門計算，客戶端只傳輸入。

- 新能力 `evolution:true`；client entry 必須宣告 `clientCapabilities.evolution:true`。非預設玩法、投票與隨機巡迴要求房內全部席位（含斷線保留席）支援。舊 client 可繼續普通單場與原系列；舊 server 不顯示新控制。
- `evolution` snapshot 保存 mode (`race|time-trial|pursuit|teams`)、durationSeconds (`180|300`)、releaseDelays（0/3/5/10 秒）、teams (`red|blue`)、vote（revision、ballots）。大廳操作綁 roomCode/expectedLobbyRevision；投票另綁 expectedVoteRevision。設定或結算換圖提升世代、清 ready/loaded，舊投票不得重播。
- `vote-track` 一人一票可覆投；房主 `resolve-vote` 才結算。平手依 catalog 固定順序；無票拒絕。`random-series` 用 server crypto Fisher–Yates 在全部24圖抽不重複3–5站。配置前驗證所有圖。
- `configure-event` 房主設定玩法、分鐘與讓秒；`select-team` 玩家選隊。固定四人2v2要求各兩人，必須系列，隊友照常碰撞。離線保留10秒，逾期失去本場資格；2v2後續站不足原四席不可開始，可結束系列。隊積分為兩人個人積分總和，同分以隊勝站數、個人冠軍數、完賽數、完賽共同時間總和、紅隊固定順序判定。
- 限時最快圈固定無碰撞，2–4人，倒數180/300秒不以圈數結束。期限前已開始的最後一圈可在 finishGraceSeconds 內完成，期限後不再開新有效圈。有效完成至少一圈才可排名；無有效圈或離線逾期 DNF。最快圈、次快圈、完成圈數、席位順序解同分。結果 finishMs 相容欄位記最快圈，另 event mode 分類；不冒充一般完賽。
- 追逐賽在共同 startAt 後依各車延遲放行；放行前不更新車、不接受輸入、不參與碰撞。共同起跑至完賽時間決定先後，另 netFinishMs 扣除延遲只供資訊。HUD顯示個人放行倒數。
- `checkpoint-series` 只由原系列房主在已結算 results 提出，綁 matchId/expectedSeriesRevision；token 只單播給該房主，不放 snapshot、戰績 export、telemetry。服務用 HMAC-SHA256 簽完整已結算系列、規則、車手、隊伍與下一站狀態；TTL 7天，上限64KiB，驗證 signature、expiry、catalog、physics 與完整結構後才建立新房，拒絕用戶捏造成績。
- 固定 `SERIES_RESUME_SECRET`（32–4096 bytes）才宣告 persistent。未設定只用 process ephemeral key，UI明示服務重啟無法恢復。`resume-series` 只讓持有原房主能力憑證的用戶開新房；其他原車手用原瀏覽器獨立保存的 playerId/session token 輸入新房碼恢復原席，簽名檔只含席位 token 的SHA256 hash，不能同名冒領。原房主不分享其他車手憑證，其他車手也看不到房主checkpoint。清除原瀏覽器憑證後不能恢復該席。已撤銷/逾期席位不復活，既有積分保留，後續站缺席DNF0；一般系列至少剩兩個有效原席才可保存，固定2v2需原四席。原房主不能藉 token 更改既有積分。原 series host 不隨大廳交棒改變。
- 第一站鎖名單時，以當時的高熵session能力固定為該series的席位能力，其hash獨立保存在server `seriesSeatHash`；client依seriesId/playerId保存首次席位能力，最多10個系列席位、七日。還原席位後live session token照常輪替，穩定席位能力不被覆寫；後續checkpoint仍簽原固定hash，所以同一舊檔可重複重啟恢復、新檔也可恢復。穩定能力只允許claim `awaitingSeriesSeat`，不能取代已恢復席位的live session權限。

測試必須用本機真 WebSocket，固定測試 key 驗證跨服務重啟、竄改、到期與catalog拒絕；服務端終點 fixture 清楚標示，不宣稱真人駕駛或手機驗證。
