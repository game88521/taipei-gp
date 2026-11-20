# Atlas 城市競速與合作配送

署名：Rex <game88521@gmail.com>

本文件對應 2026-11-18 清單第 4、6、7、10 項。產品碼完成；支線 `npm run build` 通過，暫版 `03f3ef5aca88`。整合版 build、三條固定競速回歸與 Chrome 驗證由根代理執行，不能把本支線結果當作整合封版結果。未操作原專案、未連外、未 commit／push／部署。

## 已完成

- 城市競速改用 `city-race-v2`。網路中斷保留房間畫面，自動續接同席位；採原斷線時間起算 14.5 秒本機重試窗口，保留伺服器 15 秒期限餘裕。重試不延長保留期限，可取消並離房；失效版本／席位不持續重試。瀏覽器不提供底層原因時不捏造 HTTP 403。
- 合作配送改用 v3 輸入權威物理。前端只傳控制輸入；伺服器以真 `FreeCar`／`Collider`／`Surface` 固定 30Hz 更新車況、停穩條件、貨物與分數，拒絕所有 `position` 封包。前端同頻率預測，依伺服器 `ack` 重播最多 90 筆未確認輸入；歡迎、續接、返回倉庫與新一輪切換時清除舊預測。
- 城市競速房主可選友車穿透或實體車碰。多圓接觸使用車輛質量反作用與旋轉，同層高度差至多 1.6 公尺；斷線、完賽與保護車不阻擋對手。起跑保護 1.5 秒，低速持續接觸 4 秒給 3 秒保護。低於 2m/s 可每 10 秒脫困一次，回上一個已通過 gate 後方 3 公尺，不增加進度。
- 新合作「中繼接力」建房選項。一般配送仍是六件；接力為五件，先到市民大道共同中繼站，由另一位在線空車隊友同層停穩 1.2 秒後確認接貨，再赴終點。邀請有效 10 秒，可取消；轉移由伺服器原子執行，重複命令不重複持有或加分。未交接不得直接送終點；退貨／離房／30 秒斷線過期重設整條接力。
- 合作與城市競速共用同一份全城 184 tiles 的世界與 Collider，避免第二次預熱及雙份世界記憶體。沒有把相鄰地塊近似成整城物理。
- 修正城市競速無輸入時的 `brake=true` 會觸發倒車：改成無動力輸入加阻尼停車；同樣用於合作失焦、過期輸入及前端預測。
- 合作自動續接仍以本機 28 秒／伺服器 30 秒為界，連線與 resume 等待也受原窗口限制。resume 被拒清理席位，逾時或取消關閉舊 socket，防止額外連線和晚到訊息接管。不自動重送取送指令。

城市連線仍僅接受 NG1 單圈路線；NG2 多圈留給單人工坊，UI 與伺服器都明確拒絕，沒有暗自把多圈當單圈開房。合作的「看面板時仍以中性輸入累積停穩」保留，以便安全操作取送；真正失焦則停止控制與停穩認領。

## 已執行的本機驗證

命令前綴均為 `node --experimental-strip-types tools/dev-tests/`：

| 腳本 | 結果 | 證明範圍 |
|---|---:|---|
| `atlas-city-server.mjs` | 28 PASS／0 FAIL | 真 loopback WS、共享真城市世界、權威輸入移動 36.693m、重連世代／token輪替、第三人交接授權、接力、車碰、脫困、清理 |
| `atlas-city-client.mjs` | 14 PASS／0 FAIL | 自動續接 before/after、期限／取消／晚到訊息、真 FreeCar 預測與 ack 重播 |
| `atlas-coop-client.mjs` | 7 PASS／0 FAIL | 合作重連 timeout／拒絕／socket 清理、序號與背壓、正常指令錯誤 |
| `atlas-coop-history.mjs` | 6 PASS／0 FAIL | 真 WS direct／relay 結算接真 recordResult，UI／備份共用 parser，舊結果與壞 mode／total 邊界 |
| `summit-city-race-client.mjs` | 6 PASS／0 FAIL | 原城市 client 邊界斷言，升級 v2 必填欄位與等待策略 |
| `summit-city-race-server.mjs` | 13 PASS／0 FAIL | 原真 WS 城市物理／4 車完賽／容量／路層與 deadline 回歸 |
| `nexus-coop-server.mjs` | 19 PASS／0 FAIL | 原六貨單、停穩、所有權、30 秒保留與完整結算 |
| `summit-coop-server.mjs` | 13 PASS／0 FAIL | 原預約、集合、競爭、逾期及 parser 回歸 |
| `summit-coop-entry.mjs` | 21 PASS／0 FAIL | 原真 UI／main callback 取消、晚到、還原責任與切模式回歸 |

共 127 項 PASS；結果在同目錄的 `*-result.json`，入口取消測試的結果檔名為 `summit-coop-entry.json`。其中新增兩項授權／token 案例及六項歷史／備份測試已於整合目錄重跑；整體封版仍以根代理最後的整合／瀏覽器結果為準。

整合審查另外修正：城市 resume 每次成功輪替 token；relay 非受邀第三人亂送接受／取消／改派命令不會清除合法邀請；合作 UI 自動續接期間只顯示倒數與停止按鈕，停止後 closed 才可手動續接，避免兩條續接流程競爭。合作結果由 `src/atlas-coop-history.ts` 統一驗證遊戲載入與備份恢復，檢查 direct/6、relay/5、own不超過共同送達數、完成狀態及重複 id，舊結果仍預設6/direct。整合審查 build `4f0d82b2270f` 通過，非最後封版宣告。

兩個真來源對照使用不可變 `taipei-gp-atlas-before-8447a11b8964`：舊城市 client 斷線後 700ms 仍只有一個 socket；新 client 自動建立第二條續接。舊 idle 煞車在平直地面 180 格倒退 18.96626752180571m；修後 0m。before 檔案雜湊驗證未變。

早期測試失敗曾包含舊 socket 關閉同步、保護快照選錯，以及測試 Collider 漏回傳 array，已修正 fixture，未放寬產品。舊合作測試原傳 `position` 的 fixture 已明示改為伺服器放車加真 `input`／tick，保留貨物流轉斷言；另將舊「傳送後還原」斷言加強為 v3 完全拒收 `position`。v3 頻率上限為 90 筆／秒，對應測試改送 100 筆，沒有為歷史測試留下位置後門。

## 交由根代理排程的瀏覽器驗證

- `atlas-coop-browser.mjs`：本機 4409 preview、獨立 CDP context、真 WS peer；relay 選單／五貨單、倉庫停穩、真鍵盤權威駕駛、雙向中繼邀請與 UI 確認、手機尺寸、獨立存檔與離房清理。
- `summit-city-race-browser.mjs`：本機 4407 preview；碰撞選單、真斷線自動續接倒數／token 輪替、UI 脫困、真鍵盤城市完賽、手機尺寸與位置／天氣還原。
- `nexus-coop-browser.mjs`：保留原一般配送 UI 回歸，遠車 fixture 改為伺服器放車再送真 v3 控制輸入。

CDP 預設 9334；所有 runner 封鎖外部請求，記錄 source/build hashes、例外、截圖並清理。中繼站點用明示 server 放車 fixture，不能宣稱真人完整跨城駕駛。支線未執行上述 Chrome runner、未驗真手機／外網／免費主機負載。
