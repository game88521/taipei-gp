# Aurora 城市功能（7～9）

署名：Rex <game88521@gmail.com>

## 7 公車連續營運

在「城市勤務」的「公車連續營運」選普通班、南城短線或加班車。普通班依公車路線選單，加班車選目前候車最多的路線；連續營運使用封路環境。依真路網駕駛、對準停靠、開門、等乘客作業完成、關門。完成後可按「接下一班」。

- 四個實際服務站各自累積候車需求，每300秒在一般／尖峰1.5倍之間切換。僅有效模擬時間累積，暫停、地圖、背景不增加。
- 32人容量，先下後上；實際關門完成才扣除已上車人數。客滿留站人數和後續新候車者保留至下一班，重新載入亦保留最近保存的營運狀態。
- 離開未完成班次不產生成績；尚未完成的上車作業不扣候車者。營運時鐘／候車每15秒與完成停站時保存；未保存的15秒內進度可能在強制關閉時遺失。車輛與未完成路段不續存。
- 評分包含平順／準點原始勤務分、實際服務量與留站扣分。最近30班和累計服務量存於營運專用檔，不混入原單趟勤務、錢包或正式比賽。
- 可下載營運備份、存檔原文與明確確認還原。損壞資料保留；讀取原文與最後一次成功寫入不一致時轉唯讀，避免覆蓋另一頁或整包還原的資料。

檔案：`src/aurora-bus.ts`、`src/summit-city-ui.ts`。存檔 `taipei-gp-aurora-bus-v1`，30KB；嚴格解析 `parseBusOperation`。

## 8 工坊多階段劇本

在原城市工坊選路線點後，下方「NG3 多階段任務劇本」可設定每個到站點：

1. 依序抵達：沿路線檢查點到達指定地點。
2. 精準停靠：同層3公尺內、與道路行進方向差小於0.3弧度、速度低於0.3m/s，連續停留2～30秒；移位會重算。
3. 停留上下貨：使用相同精停條件，停留完成後由玩家按「確認裝卸完成」。

終點必做，其他階段可標記選用支線。起跑前可選是否跑支線，會依選擇重新沿單行方向、路層與現有道路重建整條路線。跳點、扶正、錯層、超時、超過碰撞條件不計成功。

劇本使用原單人城市 `FreeCar`／collider／輸入更新；沒有動畫代駕或新物理。開始保存位置與天候，離開恢復。NG3 分享碼包含嚴格的 NG1 底層路線及階段資料；未知欄位、版本、非法動作、長度、checksum、UTF-8、路網版本均拒絕，匯入後必須手動開始。NG1／NG2 原有核心編碼及玩法未修改。此版NG3只支援單人。

可儲存12份劇本草稿、40筆獨立成功紀錄。原文損壞或與上次讀取不同時不覆寫；quota失敗保留本頁資料並提示複製分享碼。

檔案：`src/aurora-story.ts`、`src/aurora-story-ui.ts`、`src/nexus-workshop-ui.ts`。存檔 `taipei-gp-aurora-story-v1`，700KB；嚴格解析 `parseStorySave`。NG3單碼上限12KB。

## 9 城市回放導演

開啟任一有效匿名城市回放，展開「城市回放導演」。可用「加入導演剪輯」選事件前後3秒，或手動設定0.5～30秒片段，最多8段、成片合計60秒；片段可上移、下移、刪除。每段指定車手、跟車／俯視／側跟拍、0.25／0.5／1／2倍及80字內字幕。

多段預覽依真回放時間插值重現，跨片段切換與慢動作均套用在城市車輛與相機。錄影以實際城市 renderer 畫面同步複製至合成 canvas，燒錄字幕後以 `MediaRecorder` 編碼，提供可播放與下載的 WebM／MP4，並非JSON或下載腳本。

錄影時採 `performance.now()` 真實經過時間定位片段，避免遊戲 `dt` 上限在低FPS時額外拖慢成片。低FPS仍可能有重複或跳過的畫格；預覽使用原遊戲dt。

- 影片無聲、最多1280×720、30fps目標與4Mbps；實際影格受裝置影響。
- 依瀏覽器實際支援選 VP9／VP8／MP4 等，無可用API／codec／畫面來源時明示，仍可預覽。
- 分頁進入背景、編碼失敗、擷取失敗、超過90秒或100MB會取消，不提供空檔或中斷影片。
- 關閉回放會取消錄製、停軌、釋放舊Blob URL，維持原本暫停狀態。
- 此版剪輯清單僅保留本次回放工作階段，不寫入進度或房間資料。

檔案：`src/aurora-director.ts`、`src/aurora-director-ui.ts`、`src/frontier-city-replay-ui.ts`。main需傳入 `capture:()=>{if(composer)composer.render();else renderer.render(scene,camera);return renderer.domElement;}`，避免 WebGL 未保留 drawing buffer 時擷取黑畫面。

## 驗證與限制

`node tools/dev-tests/aurora-city-models.mjs`：目前8 PASS／0 FAIL，涵蓋營運累積／留站／隔離／quota／損壞／CAS、NG3嚴格驗證與舊NG1/2往返、真FreeCar直路精停／裝卸／支線通關、錯層／反向／移動重算／裝卸需手動確認的幾何fixture、導演時間／切鏡模型／codec選擇。含支線通關53.0667秒、主線48.4秒，皆零碰撞。這是明示360m道路fixture，不是真手機或真城市人工試駕。

既有 `nexus-workshop-models.mjs`：19 PASS／0 FAIL。

`aurora-city-browser.mjs` 使用已啟動的 `127.0.0.1:4317` dist 與專用CDP新context，不起服務、不連正式站。最終建置 `bdc4e4bc9821` 驗證7 PASS／0 FAIL，含真工坊／勤務UI與存檔隔離、導演A/B多片段、真MediaRecorder影片decode／非黑像素／實際下載、未支援MediaRecorder明示及關閉清理。影片VP9 WebM 35,453 bytes、192×108、1.706秒，可解碼且19,836/20,736像素非黑；零外網、零例外，source未變且context清理完成。證據 `tools/dev-tests/aurora-city-browser-evidence-1795401177726/report.json`。

另以舊dist做同一JS task生命週期fixture，確認終點裝卸／最後關門後、下一個step前記錄仍為0筆（`--settlement-only --expect-sync=0`，3 PASS；對照證據 `aurora-city-browser-evidence-1795400221322/report.json`）。修正為操作完成當下結算後，最終browser驗證同一task各已保存1筆，避免立即離開／接下一班漏存。這是明示狀態fixture，不宣稱該段是真駕駛通關。錄影壁鐘與取消finalizing保護亦包含在最終建置驗證。

## 伺服器發布收尾

`/health.aurora` 與 `/diagnostics.capabilities` 加上 `partyVersion`、`crewTeamVersion`、`auroraCupVersion`、`auroraRallyVersion`，直接匯入各shared版本常數，不以固定文字冒充服務能力。

`server/Dockerfile` 補上Aurora兩個server與兩個shared模組。專用 `Dockerfile.dockerignore` 補上現有服務、shared契約、城市及tile資產，並在放行各目錄後重新排除子項，再明確允許所需副檔名與檔案；不將.env或node_modules放入context。

`node tools/dev-tests/aurora-server-package.mjs` 靜態驗證PASS：58模組、171個執行期import依賴、188個城市相關資產。去除TS型別import再檢查，刻意漏掉Aurora模組的對照可被抓出；.env/node_modules拒絕控制亦通過。**未執行Docker build或容器啟動**，不能將此靜態證據視為容器實測。

完整建置、三條固定回歸與全功能整合由root統一跑；本文件不宣稱手機實機、跨網路真人對戰、無障礙全檢或影片裝置全面相容。
