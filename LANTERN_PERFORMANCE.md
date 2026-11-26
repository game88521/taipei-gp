# Lantern 5–7：城市串流與省電畫面

作者：Rex <game88521@gmail.com>

本子項已在統一 build `a16fb2c38497` 完成本機驗證：Node 10 PASS／0 FAIL、瀏覽器 3 PASS／0 FAIL。原專案套回、整輪固定三基準及發布狀態，以本輪總驗證與獨立交付收據為準。本子項驗證沒有 commit、push、部署或存取正式站。

## 5. 城市細分建模

`src/city.ts` 現在於每個幾何／地標與每 64 個實例檢查 CPU 預算，平常 3ms、近處急需 4ms，開場載入 6ms；移除行駛中原本的 25ms 整批預算。水塔、鐵皮、機車與樹的內迴圈均可讓出下一格，並重用暫存向量。

新建的 InstancedMesh 一開始即歸入尚未上場的 Group，取消／失敗會用既有 `releaseCityTile` 釋放半成品（包含實例緩衝與地標自有幾何／材質，保留 shared 資源）。牆線及樹碰撞延後至整個 Group 成功後與畫面同一個同步提交段發布，避免半成品留下看不見的牆或樹。提交例外也會移除該區塊 tag。

預算是合作式排程，**不是每幀最大耗時保證**：單次 `computeBoundingSphere`、地標建模、首次 GPU 上傳及碰撞發布仍不可中斷。沒有加入 GPU 計時，也沒有宣稱真機 FPS 提升。

## 6. 方向預載與過期工作取消

`planCityTiles` 保留原半徑內所有需求，急迫近區優先；其餘依距離及行駛方向排序。依車速預估前方最多兩秒、上限 1.5 個區塊，只額外預載最多兩塊。倒車方向反轉；沒有有效速度時不猜測預載。未提供 heading／speed 的既有呼叫依位置差推估，超過兩秒的樣本與超過兩塊的傳送位移不當成車速。

每 0.4 秒重新排序。新需求以外的下載／待建模工作立即 abort；同一塊在等待及預載之間共用工作，不重複下載。保留原 450m 卸載遲滯。取消後可重新要求同一塊。

`TilePool.run(url,tag,signal)` 支援逐工作取消；Worker 收到 cancel 即中斷該筆 fetch，主執行緒清理等待與 listener、忽略晚到結果；取消不會誤走主執行緒備援。整個場景 dispose 仍終止全部 Worker。**已開始執行的同步 `genTile` 無法被 message 中途打斷**，但取消後其結果不進場景；無 Worker 的備援仍同步計算幾何，本輪只讓其 fetch 可取消。

`__gp.stream.workYields`／`cancelled` 提供唯讀統計，供本機驗證。

## 7. 省電視覺節流

`VisualWorkClock` 累積略過畫面的視覺時間，單人交通／警車／行人呈現、車模、鏡頭、座艙、一般競速 HUD、觀眾、雨絲與區塊長出動畫只在實際繪圖時更新。狀態回呼、車輛物理與輸入時鐘保持原值。

維修區聲音來源及 `field.render`、水花與聲音、列車停站狀態、倒木恢復、TT 比較與自由 HUD 裡的喇叭／驚叫／導航事件仍每次 callback 執行；沒有為省電而漏讀瞬間事件。結算凍結與 visibilitychange 清掉累積時間，不追補背景時長。GP AI／維修視覺仍依原回呼更新，這是保留既有音訊來源所作的取捨。

新增唯讀 `__gp.lanternPerformance` 回報 visualCallbacks／visualDraws／workYields／cancelled。統計不是 FPS 或 GPU 時間。

## 驗證

- 統一 `npm run build` 已通過，build `a16fb2c38497`，包含 TypeScript 檢查與前後端建置。
- `node tools/dev-tests/lantern-performance-node.mjs`：10 PASS／0 FAIL。包含 192 個方向場景、急轉及近區優先、逐 Worker 取消／晚到結果／dispose／部分 Worker 失敗／無 Worker fetch abort，以及 120 callbacks 對應 30／60／120 次視覺更新且事件時間不變。
- 分批對照使用明示的 0.1ms／item 合成時鐘：每 64 個實例檢查一次，25ms 預算最長連續工作 25.6ms、3ms 預算 6.4ms，工作總量同為 64ms。**這是排程契約測試，不是真實效能量測。**
- 第一輪 Node 執行為 6 PASS 後 loader 中斷：泛用測試 loader 把 Three 解析至 CommonJS，沒有 named export `Color`；已改測試使用 Three 的真 ESM 入口，不替換產品邏輯。原失敗另留 `lantern-performance-node-harness-failure.json`。
- `node tools/dev-tests/lantern-performance-browser.mjs`：3 PASS／0 FAIL，由統一驗證在本機 dist／專用 Chrome 執行。真城市逐物件分幀已執行；132 次視覺 callback 對應 40 次繪圖，觀測到工作讓出；這些次數不是 FPS。
- 使用真城市區塊及明示的一次性幾何 callback 取消 fixture，半成品已 dispose，沒有殘留該區塊牆／樹，取消後可重新載入。同一區塊往返兩輪，載入幾何均為 116，兩輪卸載後幾何均回到 81（81→81）、材質貼圖均為 52（52→52），可撞物也回到相同數量。這是本機資源回收檢查，不是人工行車或真機效能測試。

Node 及瀏覽器 runner 產生時間戳 evidence/report.json 與 latest result，含來源與 runner hashes；以實際收據為準。真 iPhone 17／Safari、20–30 分鐘熱衰退／耗電、GPU 時間及外網多人均未驗證。四個模擬核心檔案未編輯；54.425／162.0／175.7、aiHits 0／8／5 必須由統一 chain-stab 原值驗證。

集中封版補充：本機build a16fb2c38497 的16套完整回歸全通過，固定三基準與四核心bytes保持；最後結果以LANTERN_VALIDATION.md為準。
