# Nexus 2：城市合作配送

入口為主選單「📦 城市合作配送 · 2～4人分工」。建立六碼私人合作房，朋友以相同城市頁與合作房碼加入。邀請連結只含 `?coop=房碼`，開啟只預填／顯示合作頁，按加入才連線，不含續接憑證。

## 玩法

- 兩至四人各自準備，房主開始20分鐘共同貨單。六件貨物由共同倉庫送往六個不同地面站，每車一次載一件；沒有先搶完貨的個人勝負。
- 停在目標同層12公尺內、速度不超過1m/s，前景頁持續回報停穩1.2秒，再按取貨／交付。可在房間貨單頁停穩操作；暫停到一般選單或切背景時不累積有效停穩。
- 伺服器裁定貨單是否待領、每車容量、所有權、目的地、停穩時間、共同截止與結算。已送一件100合作分，六件600分；不兌換單人錢包、正式PB或外觀。
- 朋友車有車手標籤、獨立顏色與平滑位置；合作採友善穿透。背景車流與行人於合作中隱藏，沒有聲稱它們已同步。建築碰撞和道路高低沿用原城市物理。
- 房間清單可導航倉庫／目的地、退回貨單、返回共同倉庫（攜帶貨物一併退回），結算後房主同房再戰。駕駛HUD可展開自己的目標與交付按鈕。
- 斷線保留原席位／貨物30秒，分頁自動續接最多28秒；房主斷線即移交已連線朋友。逾時／主動離開後貨物退回待領，最後一席離開清房。已送貨物不撤銷。重開頁面可在30秒內按本分頁續接。
- 合作結果只寫獨立 `taipei-gp-city-coop-results-v1`，最多20輪，依伺服器runId防止重複紀錄；讀取失敗不覆蓋原資料。續接憑證僅存在該分頁 `sessionStorage`，不進邀請連結、房間snapshot或合作紀錄。

## 架構與信任範圍

`server/nexus-coop-service.mjs` 是獨立WS服務，與賽道 `/ws` 共用HTTP服務及精確Origin白名單，使用 `/coop`。`/health` 加上合作連線與房間數，原競速欄位保留。整體連線上限及每IP限制共用；合作另限16房／64連線，96KiB WS通用上限後再以4KiB合作payload上限與每秒65訊息限制處理。

**城市車輛位置仍由客戶端模擬並回報，並非權威城市物理或完整防作弊。** 伺服器驗證有限數值、序號、位移／垂直速度、90m/s保守極限、停穩前景狀態與同層；這能阻擋直接傳送取送，不能證明車輛確實沿道路駕駛。合作分數不列競技排行榜。輸入、takeover、異常封包和重送不直接改貨物狀態；貨單指令不自動重送，斷線後先核對狀態。

`shared/nexus-coop-city.json` 從真 `public/data/city.json` 的可開道路產生，先依單行方向尋找由市中心可去可回的地面主路網，再選道路旁倉庫與六站，保留source SHA及節點來源。生成指令：

```powershell
node tools/build-nexus-coop-city.mjs
```

目前7站stamp為 `coop-city-v1:d0486aeecbfb4906e5cc`。前後端握手同時檢查coop v1與這個stamp；若城市資料變動，須重建catalog並同步部署前後端。使用原 `VITE_MULTIPLAYER_URL` 的WS origin，pathname改為 `/coop`；本機預設 `ws://127.0.0.1:4320/coop`。未設定公開endpoint時不猜測服務網址。

`main.ts` 的合作支線在 `freeStep` 早退，只推FreeCar＋靜態城市碰撞，不執行計程車／街賽／追緝／甩尾結算、車損、探索、統計或自由位置存檔。離房還原進合作前的位置。一般模式入口明示離房；車庫換車、單人維修和護照在合作中拒絕。主線未改Car／Track／Rivals／PitLane與既有亂數順序。

## 驗證

```powershell
node tools/dev-tests/nexus-coop-server.mjs
node tools/dev-tests/nexus-coop-browser.mjs
node tools/dev-tests/nexus-city-visibility.mjs
npm.cmd run build
```

開發副本正式build通過。真本機WS測試19案通過，含完整六件受控位置fixture結算、目的地／同層／停穩、持有人競爭、防重送、傳送拒絕、4人容量、續接／token輪換、斷線貨物回收、逾時和清理。早期17PASS／2FAIL證據保留；其中一項為測試變數遮蔽，另一項揭露逾時結算同一tick立即閒置清房，已將結算時刻更新為新閒置起點。

最終整合build `64bc8f19a76a` 的本機Chrome回歸9／9 PASS，cleanup PASS、JS例外0、外部請求0。使用一個真城市Chrome頁面與一個真WS peer，涵蓋真倉庫取貨、全員準備與開局UI、七站雙向可達與高度、遠車平滑、導航、390×844／844×390手機尺寸、存檔隔離、返回倉庫退貨及退房後恢復自由駕駛。報告為 `tools/dev-tests/nexus-coop-browser-result.json`，其中evidence欄指向同bytes的封存report、手機截圖與前次失敗結果；包含來源／腳本SHA及測試期間不變檢查。早期browser 7PASS／1FAIL是測試未先展開HUD details就點內部按鈕，已改成真滑鼠點summary再驗證按鈕可達，原斷言保留。

另修正真實的共用視覺問題：Traffic隱藏時夜間車燈會在下一次render重新顯示。`visible`現同時控制車身、影子及車燈，render持續遵守隱藏狀態。真Traffic方法＋真Three InstancedMesh的Node前後對照6／6 PASS，不可變before重現舊問題，after立即隱藏、持續隱藏、恢復及白天零燈數皆通過，位置／模擬時間不變。報告為 `tools/dev-tests/nexus-city-visibility-result.json`；預設before來源為開發基準副本，可用 `GP_NEXUS_BEFORE_TRAFFIC` 指定保存的before原檔。

尚未驗證：兩台實機、真手機／手把、真人完整六件城市駕駛、外網延遲、長時間服務、Docker執行與合作樂趣／時限平衡。未commit、push、部署或操作正式服務。

Docker runtime檔已由root整合合作、replay與arena相依；Docker建置／執行沒驗證。
