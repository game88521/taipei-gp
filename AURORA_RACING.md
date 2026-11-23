# Aurora：追走課程、分段拉力、循環好友盃與GP策略沙盒

作者：Rex <game88521@gmail.com>。本文件記錄 Aurora 第3～6項；整批最後build、瀏覽器及固定三基準由整合報告另列。沒有commit、push、公開部署或線上遊戲測試。

## 3. 追走課程與好友鬼車

原「追走單人陪練」增加三個課程：穩定跟車、彎道銜接、完整追走。三段領跑分別20／35／50秒，由真正FreeCar、城市Collider及控制輸入離線錄製，沒有在起點之後指定車輛位置；401／701／1001樣本、128.08／271.70／445.01m，三段皆零靜態碰撞。作者腳本與來源雜湊見 `tools/dev-tests/aurora-generate-ghosts.mjs`／`aurora-ghost-authoring-result.json`。這是預先錄製軌跡，不是假裝真人連線或即時AI。

第一課先練同層、速度、方向與3～25m距離，不要求滑角；第二課至少4度，第三課及原自錄陪練仍用原8～60度條件。課程列明有效跟車秒數目標。各課分數不能當成相同門檻的競技排名；鬼車ID及課程標題用於識別。載入課程只影響本頁，不覆寫原鬼車；明確保存才更新舊保存槽。冷啟動只有內容完全符合內建課程的保存鬼車會恢復課程規則。

「下載可分享的鬼車」產生嚴格封包 `taipei-gp-aurora-ghost/v1`，包含精確城市stamp與物理格式版本，不含成績、房碼或私席。舊結果下載保持可用；不把無地圖版本的舊檔直接當成新版分享檔。好友匯入會先驗UTF8大小上限（1MB加封包開銷）、欄位白名單、型別、版本、車款／天候、時間／位移／高度／朝向／速度連續性；課程標記還須完全符合內建錄製內容。錯誤／過大／其他城市或物理版本保留原鬼車。匯入僅先載入本頁，使用者可試跑後再明確保存；不匯入對方成績。

## 4. 多路線、四賽段定速拉力

保留原經典固定均速拉力。新增建房路線選單與四個均速選單，每段可選28／36／42km/h，三條道路由現有 `WorkshopRoads.route` 依真城市路網與單行方向建立：信義—松山、信義—信安、市民—松山。路線、起點、同款sedan、晴天與四段均速在建房時鎖定。

這是連續道路上的四個計時賽段，不是四次傳送或四個獨立服務。各四分之一計時門的應到時間，按前面每段實際道路距離／該段目標均速累加；不能以全程單一均速代替。仍須正常正向同層通過每30m順序門，四點絕對時差與沿途超速罰分累加排名。HUD顯示目前賽段均速；路書根據真路線轉向列出接下來三個彎道與約略距離。路書不是導航指令自動操控。

`coursePlan.version=aurora-rally-v1` 是additive能力：新前端從hello能力決定是否發新版欄位，經典路線維持原封包；新分段房拒絕缺能力的舊版加入／續接。每個快照嚴格重算四點應到時間，前端仍以本機道路重建核對server路線。保持原15秒續席、明確恢復操控、同起點／友車穿透、600秒期限及server-stall整場取消。公開保存結果增加可選coursePlan，原結果仍可讀，沒有新存檔鍵或私席外洩。

開發第一輪完整道路案13 PASS／1 FAIL：候選信義—市民路線未在600秒內自然完賽，原始失敗保留於 `aurora-racing-evidence-1795399516451/`，沒有延長期限或將失敗改成PASS。路線改選另一條真道路，之後完整驗證結果以最新不可變收據為準。

## 5. 2～4人循環單挑與BO3決賽

原四人淘汰盃、固定1v4／2v3／季軍／冠軍流程保留。新增獨立按鈕「鎖定2～4人，循環對戰＋BO3決賽」，只有所有原席都支援 `auroraCup: aurora-league-v1`、已載圖、關閉其他特殊玩法且沒有外部觀眾才可建立。

每對原車手單挑一次，2／3／4人分別1／3／6場循環賽；勝場→完賽數→累積完賽秒數→原種子為公開同分比較順序，前兩名進決賽。決賽三戰兩勝，每場交換左右發車側，2比0即結束，不強迫多跑第三場。2人也先跑一場循環熱身排序，再跑BO3；全部原車手每場重新準備，未出賽原席留在原房觀戰、不操控、不碰撞、不列DNF。

沿用綁cup/lobby世代的ready與host意圖、同分／雙DNF／server-stall同組重賽、15秒原席續接、不能替補及明確取消。新schema會重算整份配對、循環排序、決賽人選、連續場次及2勝結束條件；偽造晉級、跳場、重複match、已封盃後多跑均拒絕。沒有跨server重啟續盃，結果仍需明確下載，不包含房碼／token；新聯賽下載另含 `league.version`，原淘汰盃下載不增加此欄。

主要程式仍為 `shared/frontier-cup.ts`、`server/frontier-cup-service.mjs`、`src/frontier-cup-ui.ts`，沒有新服務路徑。一般GP client/server已接新版能力與續席gate。

## 6. GP任意圈停站與多胎序A/B沙盒

不取代原本已存在的「本圈／下圈進站」即時建議。新 `aurora-strategy.ts` 提供獨立模型：每組自選起跑胎、最多8個遞增且早於最後一圈的停站圈／換胎序列，逐圈列胎耗、條件、停站損失與累積時間區間。A/B各有自選終場濕度，明示為假設情境，由目前濕度線性變化，不讀未來雨勢、AI決策或尚未發生的停站抽籤。

選擇一組方案可綁下場的賽道、賽道stamp、規則與圈數，主程式在真GP完圈時送入實際圈秒／胎種／停站數。不同條件、跳圈、重送同圈或結束後樣本拒絕。賽後只將真實已觀察圈數與相同圈數的預估區間比較；未滿圈明示不完整，停站只稱「這一圈觀察到次數增加」，不捏造精確進站時刻。可下載整份A/B與實績JSON。

本沙盒只保留本頁記憶體，重新載入會清除；不下進站指令、不推進Car、不寫PB、錢包、賽季或正式結果，也不接觸任何模擬亂數。模型尚未用真人逐圖校準，交通／安全車／操作誤差可能超出範圍；區間重疊時不宣稱哪套必然更快。

對外UI：`mountAuroraStrategy(host,{context})` → `update/observe(context,sample)/finish/reset/dispose`，完整型別在 `aurora-strategy-ui.ts`。主要介面已接到GP設定、正式完圈及結算事件；沒有本機PB時明示使用賽道建議速度模型作參考，完成有效圈後改用已觀察圈速。

## 驗證與限制

```powershell
node --experimental-transform-types tools/dev-tests/aurora-racing-node.mjs
node --experimental-transform-types tools/dev-tests/aurora-racing-browser.mjs
node tools/dev-tests/frontier-cup-node.mjs
node tools/dev-tests/frontier-rally-node.mjs
```

Aurora測試每輪另存 `aurora-racing-evidence-*/result.json`，包含來源hash、真道路控制證據與明示finish fixture，latest為 `aurora-racing-node-result.json`。Node檢查不是瀏覽器或實體手機驗收；不宣稱外網真人平衡、四人免費主機承載、手機FPS、發熱或耗電。整合build／browser／原固定三基準以Root總報告為準。

2026-11-23 最新功能來源Node收據：`tools/dev-tests/aurora-racing-evidence-1795400706432/result.json` 為14 PASS／0 FAIL，來源雜湊前後相同。三條道路由真FreeCar／Collider與控制器自然經全部門完賽，分別277.00／132.77／326.00秒；EventEmitter傳輸不宣稱WebSocket或真人駕駛。原四人淘汰盃回歸21 PASS／0 FAIL，`frontier-cup-node-evidence-1795400743055/` 包含四人真loopback WebSocket與真Car.update四場。原拉力回歸17 PASS／0 FAIL，見 `frontier-rally-node-evidence-1795399866123/`。

最新瀏覽器收據為 `tools/dev-tests/aurora-racing-browser-evidence-1795401254044/report.json`，版本 `bdc4e4bc9821`，6 PASS／0 FAIL、外部請求0、未處理例外0、來源及測試腳本前後雜湊相同，四個獨立context與本機服務清理完成。驗證真原生鬼車/策略/聯賽JSON下載、真file input好友匯入及錯版/過大保留、三課程切換、多停A/B與非法末圈、分段拉力兩頁同步與短程真鍵盤前進、2/3/4人建循環盃、四人六場循環加BO3 2:0、16次候場唯讀與最終離房。五個面板各驗390×844、844×390、844×220的44px控制/hit-test，共15份截圖。聯賽每場末圈/完賽與沙盒observe為明示fixture，不宣稱本次browser真人跑完八場或模型已真人校準。

開發browser失敗收據保留：`aurora-racing-browser-evidence-1795400186674/` 的離房斷言誤查已移除room物件內的舊players，而應查服務room Map釋放；`aurora-racing-browser-evidence-1795400401143/` 首次導頁時使用裸 `__mp` 守衛導致ReferenceError，且該輪有整合來源變更。兩者均修測試後完整重跑，上述最終PASS收據不跳過功能案例或放寬產品規則。
