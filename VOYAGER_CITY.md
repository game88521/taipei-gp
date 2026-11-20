# Voyager 城市連線：第 1、4、8 項

署名：Rex <game88521@gmail.com>

本文件描述 Voyager 城市分支的實作與本機證據。基準為 Atlas build `205d0c8df91e`；沒有修改原專案、既有封版證據、`main` 分支或線上服務，也沒有 commit、push、部署。整輪建置、固定三回歸、最終 Chrome 及交付核對由整合工作副本執行；以下不將子分支的 Node 成功當成整輪已完成。

## 1．城市競速本車預測

- 新增 `src/voyager-city-prediction.ts`，以真 `FreeCar`、相同車款、雨天 grip `.82` 與 Collider 模擬。真物理車與畫面車分開，顯示平滑偏移不回寫物理。
- 真 `VoyagerCityClock` 累積 60Hz 固定步，與 render FPS 分離；每 frame 最多六步，超過 100ms 的慢 frame 清時鐘並送 neutral，不補跑整段舊油門。輸入歷程最多 120 筆。
- Server 僅在物理 tick 取出佇列時更新 ack；收到封包不代表已執行。Client 以權威物理＋未 ack 操控重播；舊／重複時間戳不能倒帶。
- 每玩家 `motionRevision` 在起跑、再戰、低速脫困及續接輪替；舊世代輸入拒絕，斷線清空待執行佇列。失焦 neutral 即使佇列已滿也優先清除舊油門。
- 原 700ms 輸入過期停止、wall/simulation 相位修正、碰撞、15 秒續接與 server 裁定保留。關閉房間面板或脫困後回復真駕駛畫布焦點。

## 4．NG2 城市線上多圈

- NG1 舊分享碼序列化 bytes 保留；新增閉合 NG2 的 1／3／5 圈私人房，2～4 人。非閉合 NG2 仍明確拒絕。
- NG2 每一 gate 必須沿路線正向穿越平面（與單人 `WorkshopRun.stepAdvanced` 同規則），並同時符合半徑與路層；靜止、反向、跳 gate 或錯層不計圈。保存 tick 起點，在車對車接觸之後裁定，涵蓋碰撞推過線的位移。NG1 保留既有裁定方式與順序。
- 每圈完成後重設下一圈第一個 gate，最後一圈才完賽。Server 以實際平面交點的 tick 比例計圈速，`finishMs` 為所有圈速總和；名次包含完成圈數與當圈進度。
- 原最多 600 秒、碰撞、ghost protection、低速脫困、續接及斷線結果保留。Client 房間列圈速，HUD 列目前圈數；多圈資料不寫入單人金錢或工坊紀錄。

## 8．合作特殊貨運

- 合作建房新增獨立 `special` 房規：固定六單，兩急件、兩易碎、兩一般。原 direct 六單、relay 五單與各 100 分保留。
- 急件首次取貨由 server 開始六分鐘計時：期限內 200 分、超時仍可交付 100 分。退貨、返回倉庫及再領不重設已開始的期限。
- 易碎貨初始完整度 100%，真 `FreeCar.update` 的碰撞／落地衝量與有效急煞損耗完整度，分數為 `round(integrity*2)`；失焦與過期輸入的保護阻尼不當作急煞。退貨不修復貨況。
- 一般貨各 100 分，全隊最高 1000 分。Server 儲存單件 score，重送交付不重複加分；parser 同時檢查類型數量、單件合法分數、貨況、隊員歸屬分數與總分。
- UI 顯示每件種類、期限、完整度、交付分數及載貨 HUD；固定貨單顯示期限時間，動態倒數放在 HUD，避免每秒重建貨單而搶走焦點。
- 特殊貨運歷史含 `mode:'special'`、`total:6` 與 points，沿既有 UI／backup 的同一 parser 驗證。缺 mode/total 的舊六單紀錄與原 direct/relay 仍可讀。

## 協定與整合

- 城市協定：`city-race-v3`；席位 key：`taipei-gp-city-race-seat-v3`。快照新增 physics、motionRevision、completedLaps、lapTimes；輸入新增必填 motionRevision。
- 合作協定：`COOP_VERSION=4`；席位 key：`taipei-gp-city-coop-seat-v4`。舊 client 會明確版本拒絕，必須一起更新前後端。
- 根整合 `main.ts` 的 `mountSummitCityRace` 只新增 `collider: () => collider`。`frame()` 已完成本車預測，不能再於 `step()`／`freeStep()` 重複模擬城市本車。
- 根須在工坊 UI 放行**閉合** NG2 的「連線競速」：`online.disabled = start.disabled || (def?.v===2 && !closed)`；非閉合仍禁用。提示須寫明線上 1／3／5 圈、server 計圈、最多 600 秒，不能再寫 NG2 僅單人。
- 根的新容量 probe 須協商 `city-race-v3`、合作 v4，城市輸入帶 motionRevision。保留歷史容量工具及 immutable before 證據。

## 本機證據

命令在專案根目錄執行，沒有外部請求。每份 runner 會寫最新 result 與獨立 evidence 子目錄，記錄來源／腳本 hash、來源未變及 cleanup。

| 指令 | 子分支結果與證明範圍 |
|---|---|
| `node tools/dev-tests/voyager-city-models.mjs` | 7/7：真預測、ack 重播、顯示平滑、受控 FPS、延遲／抖動／反序與上限 |
| `node tools/dev-tests/voyager-city-server.mjs` | 16/16：真 WS、真城市／FreeCar；1／3 圈雙人、5 圈四人全程操控完賽、正向 gate 與特殊貨運 |
| `node tools/dev-tests/atlas-city-client.mjs` | 14/14：續接取消／世代／舊 socket、背壓及既有合作預測 |
| `node tools/dev-tests/summit-city-race-client.mjs` | 6/6：握手、schema、取消、完賽／再戰與席位隔離 |
| `node tools/dev-tests/atlas-city-server.mjs` | 30/30：舊配送／接力、碰撞／脫困、wall/sim 相位及 stale/失焦停止 |
| `node tools/dev-tests/summit-city-race-server.mjs` | 13/13：原 NG1 真 WS 雙人／四人完整路線、容量、600 秒上限等 |
| `node tools/dev-tests/atlas-coop-client.mjs` | 7/7：既有合作續接／逾時／命令錯誤 |
| `node tools/dev-tests/nexus-coop-server.mjs` | 19/19：一般配送、重送、權限、容量、回合與 schema |
| `node tools/dev-tests/summit-coop-server.mjs` | 13/13：預約與集合標記，斷線／離房／過期清理 |
| `node tools/dev-tests/summit-coop-entry.mjs` | 21/21：原 UI／main 等待與取消競態，DOM/transport 有明示 fixture |
| `node tools/dev-tests/atlas-coop-history.mjs` | 8/8：direct/relay/special 真 server 結算→真 UI recordResult→backup；舊格式、壞值與去重 |

Before/after：從不可變 Atlas source 擷取原 `applyPose`，同樣 100ms 沒有新快照時，舊本車位移 0m、新真預測 0.04958075m。15／30／60／120fps 的真時鐘各執行三秒共 180 步，皆 36.48265137m；受控 100～200ms delay/jitter/reordered snapshot 的最後誤差約 `1.14e-13m`。這是確定性模型證據，不是外網／實機手感測量。

NG2 真城市路線 `[199,200,199]`、286.21006272m、10 gates，碰撞啟用；方向修正後雙人一圈約 35.89／36.37 秒、三圈約 104.40／105.87 秒，四人五圈約 181.20～189.27 秒。圈速總和等於 finishMs，全部在原 600 秒上限內。多車結果受隨機 id 與接觸排序影響，不把這些秒數當固定三回歸基準。

易碎貨真 tile 牆接觸的完整度為 `100 → 76.07050667%`，server 計 `152` 分；急煞案為 `99.7582%`。特殊貨運六單全數經真 server 取送／結算為 1000 分，UI 真 recordResult 與 backup 接受且同輪只寫一次。取送、錯層與邊界案的起點是**明示 server 放車 fixture**，不是人類完整城市配送。

## 瀏覽器及整輪尚待整合驗證

- 已新增 `node tools/dev-tests/voyager-city-browser.mjs`，`node --check` 通過；本子代理沒有執行 Chrome。預設本機 preview `4421`、CDP `9334`，可用 `GP_VOYAGER_CITY_PORT`／`GP_CDP_PORT` 覆寫。
- Runner 使用真 Chrome＋真 WS peer，驗 NG2 建房／起跑、真鍵盤與產品 frame 即時預測、neutral／recover／續接、圈數 UI、special 期限／貨況／交付 UI、手機尺寸與存檔隔離。模型部分持有 RAF 並明示固定 frame 時鐘；停站與單圈 UI 使用明示 server fixture。
- 整合後仍須執行 `npm run build`、server multiplayer build、三條既有固定回歸與新舊 Chrome runner。子分支全量 tsc 的唯一整合缺口是根尚未新增上述 collider hook，不能將此描述為本子分支全量 build 成功。
- 真 Android／iPhone、真手把、兩台實機外網、長時間多房、目標免費主機負載與主觀手感**沒驗證**；新功能及受控回歸不替代這些驗收。
