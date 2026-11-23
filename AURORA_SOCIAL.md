# Aurora 好友派對連玩

維護署名：Rex <game88521@gmail.com>

## 入口與流程

從玩法目錄開啟城市自由巡航，先讓2～4位朋友進同一房，再由房主按「啟用好友派對」。既有城市好友面板直接顯示派對卡與乾淨邀請連結／QR，不建立第二條連線。

全員在大廳或賽後各投一票，可改票；房主按「依投票結果切換下一場」後，同一房碼、原隊伍、私席與活動分保留，全部重新準備。可輪換自由巡航、全隊巡遊、王冠爭奪及警匪追捕；雙人追走維持獨立入口。同票固定依巡航、巡遊、王冠、警匪順序決定，UI顯示此規則。巡航起跑後，全部車速低於2m/s時房主可結束這段巡航。

啟用時鎖定原隊伍，原席15秒內可續接並輪替token，新席需等派對結束後再加入。隊友斷線時不能提交下一場；原房管理與目前房主權限仍有效。切場會換runId、revision及輸入世代，清ready、舊輸入、舊標記、觀戰歷史與匿名回放，避免跨場沿用。

## 計分與保存

- 王冠：不同分數的前三名5／3／1分，其餘1分；並列同名次。
- 警匪：勝方3分，另一方1分；依服務的正常完成／超時結果判定。
- 全隊巡遊正常完成：每席3分。
- 自由巡航、中斷及退出：0分。

最多20場，每個runId只結算一次。「再開一輪」仍可在同玩法重玩並保留積分，會開新投票世代。活動分只留在目前伺服器房間RAM，可下載匿名席位積分JSON；沒有永久跨服務排行榜。結束派對會經確認並清除這次活動分，原房與隊友保留。

## 協定與相容性

主版本仍為`frontier-social-v2`，hello能力新增`capabilities.partyVersion='aurora-social-party-v1'`。玩家必須同時支援現行party、convoy及crown精確版本，才能啟用與續接派對。舊房快照不新增party欄；有派對時才帶嚴格解析的optional `party`。沒有對應能力的前後端會明確拒絕新派對操作，原玩法保持可用。所有派對命令綁目前revision／runId，投票另綁ballot；客戶端不能指定分數或姿態。

## 驗證

`node tools/dev-tests/aurora-social-node.mjs`：9 PASS／0 FAIL。使用真loopback WebSocket、真FreeCar與城市world。三人王冠及警匪都從正常起跑位經服務實際180秒tick自然結算；王冠積分、三人警匪部分攔截及超時、同房切換、權限、改票、短斷續接、匿名與嚴格parser皆涵蓋。巡遊只驗真路網建構與切入，未宣稱全程駕駛。

`node tools/dev-tests/aurora-social-client-node.mjs`：3 PASS／0 FAIL；三個真產品client驗證完整能力協商、投票／改票／同房切換，以及舊hello不送派對命令。

首輪為6 PASS／3 FAIL，原因是測試錯把三人警匪當作雙人13秒可全部攔截；已保留`aurora-social-before-three-player-timing-result.json`，改為正常180秒超時驗證，產品沒有為符合測試而改結果。

`node tools/dev-tests/aurora-social-duty-browser.mjs`：build `bdc4e4bc9821`，8 PASS／0 FAIL，0 runtime exception、0外網請求，4個獨立Chrome context。真UI啟用、全員投票切巡遊／巡航、準備起跑、低速結束與離房還車通過；派對大廳及救援HUD各驗390×844、844×390、844×220可達性。完成後釋放全部context與本機4320服務，來源與腳本hash於測試期間不變。詳見同名result與evidence。

完整巡遊路程、手機實機與跨網路多人容量未驗證。瀏覽器只連本機4317／4320與獨立CDP context，不把桌面尺寸模擬當成手機實機。
