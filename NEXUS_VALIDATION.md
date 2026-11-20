# Nexus本機驗證

Build **64bc8f19a76a**，產品SHA256 **0738102e3b63d52f30501c1150c9e3c18f7d88376e792cea82286475c3b315ae**。

|類別|通過|
|---|---:|
|六項新玩法Node|6套／88案|
|封路顯示修正|6案|
|本輪瀏覽器|29案|
|Horizon回歸|5套／87案|
|Evolution回歸|8套／91案|
|原回歸|26套|
|歷史回歸|33套／393案|
|固定基準|3項|
|交付工具fixture|19項|

各組可能重複覆蓋流程，不能相加為獨立功能數。660檔before、歷史根文件與HANDOFF原bytes保留；既有car/track/rivals/freecar/pitlane/server physics、package/lock/vite不變。固定輸出為BOT lap2 54.425 hits=0／aiHits0；陳冠宇162.0／aiHits8；pittest陳冠宇175.7／aiHits5。瀏覽器0外部請求／0JS例外且清理完成。逐案、失敗對照、來源、腳本與唯一證據hash見[NEXUS_VALIDATION.json](./NEXUS_VALIDATION.json)。建置log含型別檢查、catalog與前後端完成結尾。

- 僅本機隔離驗證，未測正式站、Render、Vercel或外網真人房；副本通過不代表已套回或發布，後續以成功套用收據與獨立核對為準。
- 手機尺寸為桌面Chrome模擬，鍵盤/觸控/手把命令部分採受控fixture；真手機、真手把、外網真人完整賽事、玩法平衡及長時間穩定性未驗證。
- 接力另有真Car跑完三圈與真WS交棒；瀏覽器中的圈數、完賽、道具補給及回放移動部分由明示server fixture推進，不冒稱真人完整賽事。
- 城市合作貨單、所有權與結算由server裁定，位置仍由client FreeCar提供，server檢查序號、數值、速度/位移、道路層與停穩；不是完整權威城市物理或完整防作弊。
- 城市挑戰/編輯器共用真Router；真FreeCar直線挑戰另有完整逐步駕駛，其餘路線、邊界與完賽UI含明示fixture。分享碼checksum非安全簽章，成績為本機獨立紀錄。
- 自訂城市路線尚不支援載入既有多人賽道房；合作為友善穿透，不提供城市車碰。回放限5Hz/12分鐘/本機5場，超限明示截斷。
- Dockerfile依賴閉包與Node執行通過，不代表已在Docker建置或驗證免費主機負載；Docker實際執行未驗證。
- 原26與固定三runner未逐案記runtime script SHA，本彙整驗當輪產品hash、唯一證據、exit及固定輸出，另外捕捉現有腳本hash。
- 交付fixture使用受控Git/npm，不開原專案；其報告未攜runtime工具hash，封存前已確認fixture後apply/package/verifier工具未再改動，並另捕捉目前rootScriptHashes。
- 若首次套用已複製但建置失敗，備份與失敗結果仍保留；不能用零job重建冒充首次成功。須檢查該次完整備份後受控還原再套用，不得直接覆寫或刪除未追蹤檔。
- 沒有commit、push或部署；多人新增arena/replay/coop契約需要前後端一起更新。
