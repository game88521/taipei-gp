# Odyssey 多人契約

署名：Rex <game88521@gmail.com>

## 相容性

- GP通訊仍v2、物理仍 `classic-multitrack-collisions-v3`，固定24圖catalog及基準物理保持；新增可選 `clientCapabilities.odysseyRacing`、房間能力及 `odyssey-racing-v1` 狀態，舊端不可進啟用新規的房間。
- 城市合作升為 `COOP_VERSION=5`，席位儲存key改為v5。v4握手明確拒絕，前後端需同步更新；城市競速版本未變。
- 新規回放使用schema5；既有schema1～4仍可讀，未啟用新規的舊流程仍使用原schema。註記分享為獨立本機檔，不更改權威成績。

## 衝刺週末與一停策略

`set-odyssey`／`next-odyssey-stage`必須由房主依當前roomCode與lobbyRevision發送，觀眾不可操作。相同設定為no-op。首版僅真人單場，不能混用AI、系列、其他特殊玩法、VSC或自選天候。

衝刺週末：同張GP圖、固定2～4席；排位→一圈衝刺→原正賽圈數。衝刺依排位、正賽依衝刺結果發車；獨立積分，同分先比正賽名次，再比衝刺，最後原名單次序。取消倒數保留既有階段；短斷續接仍是同席；明確離席或逾期不可換人續週末，需房主重設。

強制一停：先套用八／十分鐘耐久，開啟新規。換胎在比賽20%～80%內開始且完成才有效：八分鐘1:36～6:24；十分鐘2:00～8:00，含端點。純修復及僅有pitStops數字不算；續接不清除已完成的有效換胎。結果區分合格、房規未完成及DNF；戰績／分享卡同步隱去未合格者有效名次。

## 合作快捷通訊

`quick`含固定phrase、to（隊友ID或null）及cargoId（有效貨單或null）；寄件者、識別碼與20秒期限由伺服器產生。六種短句不接受自由文字，3秒冷卻、全房8則上限。`ack-quick`只含id；指定訊息限收件者確認，廣播限其他在線隊友，重複確認不重複加入。

新一輪、結算、逾時及寄／收件者斷線清除適用訊息。快訊是公開房間調度資料，指定對象表示收件／確認權限，不承諾私密通訊；不增加貨物權限、不自動取送、不自動接受交接。

## 自助診斷

唯讀 `GET /diagnostics` 僅回傳本Origin允許狀態與公開版本，精確CORS且不傳credentials、不公開Origin清單。WS升級仍使用原exact Origin限制，診斷的可讀回應不放寬WS權限。詳細HTTP契約見 [postman/diagnostics-contract.md](./postman/diagnostics-contract.md)。

檢查由玩家主動觸發，總期限8秒，最多一次HTTP及一次不進房WS ping。診斷不會修改Render／Vercel環境或自動重送進房指令；WS錯誤無法可靠區分403／503時明示未確認。
