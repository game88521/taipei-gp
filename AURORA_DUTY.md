# Aurora 2～4人合作救援

維護署名：Rex <game88521@gmail.com>

## 入口與職責

玩法目錄「2～4人合作救援」，或原合作救援按鈕。新產品client建房自動協商多人救援能力；同一房最多4人，依序分配拖救司機、絞盤技師、現場警戒、領航調度。在大廳可由房主輪換全隊職責，會清全部準備與舊操控世代。2人沿用原司機／技師流程；沒有第三、四席時不要求額外安全與調度按鈕。

司機依順序城市道路門前往事故，同層對準並停穩；技師完成警示、側修絞盤、收盤及返站卸載。沿用既有1～3件事故選擇、三種停靠難度、同一輛真FreeCar與長平板車幾何，不在切案時傳送車輛或補完整度。

第三席的警戒是真操作：事故40m內、同層且低於2m/s，前方與後方警示區各長按2秒，可在司機進場與技師警示時並行。平台停妥後再按「確認現場淨空」，有效8秒；絞盤進展與最後固定都需要有效淨空，逾時立即停止進展，需重新確認。

第四席的調度需在出勤／警示／定位階段確認「本件事故簡報」，未確認司機不能進入絞盤階段；裝載後再通知勤務站接收，未通知就不能累積返站卸載進度。指令綁目前incidentId，切到下一案時重置當案警戒與調度。每位職責的關鍵工作計數整場累積，賽後可查。

## 斷線與接手

斷線先停止車速與全部held操作，缺職則安全暫停。原房主斷線立即把房主移交在線隊員。現在房主可在房間面板，把離線／已釋放職責指派在線隊員兼任；司機與技師必須是兩個不同的人。起跑時所需職責不因掉線消失，全部補齊才繼續。

原席15秒內可用旋替token續接，原職責會收回並清除該角色暫代與舊輸入；產品client仍必須明確確認恢復操作。原席過期不會把新多人房整場重開，可由暫代者繼續同一run；過期token不能重新取得席位。舊雙人房維持原本過期回大廳規則。

## 協定、成績與回放

主版本維持`city-duty-v2`，hello新增`features.crewTeamVersion='aurora-duty-team-v1'`。新多人房才有optional `team`；原手動不送能力的房間仍最多2人。多人房的加入／續接／觀戰都必須送精確crewTeamVersion，不讓舊viewer誤讀新工作。輸入只接收合法操控，所有作業綁revision／runId，未知或多餘私席、分數、座標欄位拒絕。

新完成成績存於`localStorage['taipei-gp-aurora-duty-results-v1']`，最多30場，沿用FrontierRecords的原文比對、損壞保留、quota錯誤與讀回衝突保護。成績只含公開暱稱／職責／任務／工作次數，不含房碼、玩家ID或token。新team房不寫舊雙人tuple結果；整包備份由共用Aurora備份工具接線。

匿名城市回放仍是一輛匿名平板車actor，新增operation固定值`safety-front`、`safety-rear`、`safety-clear`、`dispatch-brief`、`dispatch-depot`、`crew-cover`，不記姓名或席位憑證。舊回放parser遇到未知固定值會明確拒絕相容性，不靜默忽略事件。

## 驗證與限制

`node tools/dev-tests/aurora-duty-node.mjs`：9 PASS／0 FAIL。涵蓋2人、3人、4人各自完整作業閉環、前後警戒與簡報並行、8秒到期停止、返站通知gate、工作計數、匿名回放、嚴格成績／CAS、斷線暫代／逾期接手、4個真產品client的loopback能力／角色與輸入權限。原`expedition-duty-node`為14 PASS／0 FAIL。

首輪新suite為5 PASS／3 FAIL：測試在完成後仍持續送operate遭服務正確拒絕，導致後兩案未取得完成摘要；收據保留為`aurora-duty-before-finished-command-guard-result.json`。改成只在running送長按後重跑8案通過。

`node tools/dev-tests/aurora-social-duty-browser.mjs`：build `bdc4e4bc9821`，8 PASS／0 FAIL，0 runtime exception、0外網請求。4個獨立Chrome context透過真UI／loopback WS完成全部職責：簡報、前後警示長按、技師警示、定位、淨空、側修收盤、固定、返站通知與卸載。四頁各寫新key一次，原雙人結果key與單人存檔不變，離房後借車／輸入／服務與context清理通過；警戒HUD另驗三個尺寸的可達性。來源與測試腳本hash於執行期間不變。

完整救援閉環採明示事故與勤務站停靠／道路門fixture，服務、FreeCar、路網與30Hz作業運算均為真產品；不代表真人跑完全長城市路線。瀏覽器作業在原生長按送達後加速step，8秒到期另由Node遞進權威時鐘測試。手機實機、外網4人容量與體感未驗證。
