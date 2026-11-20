# Summit 工坊與城市競速交接

署名：Rex <game88521@gmail.com>

本檔負責 Summit #5 工坊進階編輯與 #9 自訂城市路線多人競速。所有驗證均為本機，未修改原專案、commit、push、部署或測線上。整體封版、固定三基準及交付狀態以根代理整合後的 HANDOFF／validation 為準。

## #5 進階工坊

- `WorkshopHistory<T>` 儲存最多100份完整快照（可復原99次）；路線點順序、增刪、清空、載入、名稱、車型、天候、目標秒數與碰撞次數均可復原／重做。復原後新編輯截斷重做分支，重複快照不增加歷程，快照不共用物件參照。
- UI 提供「復原」「重做」，以及 Ctrl/Cmd+Z、Shift+Z；文字輸入欄維持原生文字編輯快捷鍵。編輯歷程限本次頁面，不宣稱跨重新整理保存。
- 「沿道路接回起點」先由真 `WorkshopRoads/Router` 驗證返程，成功才加入起點，末段也建立順序檢查點。不可達跨層不畫假連線；完整路線均顯示同層過點與匝道提示。
- 複製草稿使用獨立名稱與 nodes 副本，不繼承原成績。24份已滿明確拒絕，保留原草稿。NG1 schema、version、編碼逐位元維持相容，舊草稿／成績保留。
- 工坊「連線競速 · 2～4人」透過 optional `WorkshopHooks.online(definition)` 帶入完整 NG1 至城市競速建房頁。`history` getter 供測試與 lazy facade 使用。

## #9 權威城市競速

入口為城市選單「城市自訂路線競速 · 2～4人」，或工坊內連線競速。房主選NG1路線，2～4名車手確認相同 revision／地圖後準備，房主同步三秒倒數起跑；結算後可回同房再戰。邀請網址 `?cityrace=六碼` 只預填／開啟，不自動加入。

此為封路穿透競速：車手互相穿透，真建築、護欄、地形／高架／隧道仍由城市物理處理。路線使用單行真路網、順序密集檢查點及高度判定。NG1原本允許15～1800秒；連線賽採 `min(600, NG1.seconds)`，建立前顯示原時限、實際時限及建房按鈕秒數，大廳與HUD亦顯示實際時限，超時DNF。NG1原始定義不被改寫。

### 權威來源與限制

- 客戶端只送 steer／throttle／brake／handbrake；server拒絕pose、速度覆寫、錯matchId/revision、亂序seq等，使用真 `FreeCar.update(1/60)`、城市 `Collider` 與 `Surface` 運算。從NG1重建真Router路線，不接收client提供的gates／軌跡。
- `server/summit-city-physics-entry.ts` 及 `tools/build-summit-city-physics.mjs` 產生獨立 `server/summit-city-physics.mjs`（目前26.91KB／gzip9.48KB）。七款車規由build時解析真 `src/vehicles.ts` 的spec expression，沿用真FreeCar預設，不重抄數值，不引入瀏覽器GP／renderer。
- server載入 `public/data/city.json` 與184個tiles，加入全部tile建築與Surface護欄，tunnels=true。世界／Collider在整個Node process共用一份；`createMultiplayerServer` 預設在listen及simulation intervals之前預熱，避免中途首次建房阻塞既有賽事。`prewarmCityRace:false` 僅供冷載入測試。
- 本機冷載入最新量測1554.236ms，RSS90.46→288.73MB、heapUsed15.30→188.86MB；前次1615.327ms亦保留報告。這是桌機Node process數字，不代表Render免費主機記憶體或啟動時間。
- 最多12房、每房4車；城市服務最多48clients，並沿用server三模式合計連線／同IP上限。60Hz物理、20Hz狀態、client30Hz input；常態state省略重複route/definition。每房每tick至多12步；simulation落後超過1秒明確DNF，不無界追趕。700ms未收到有效input自動煞車，較晚收到input不倒灌至先前simulation時間。
- 掉線保留15秒token席位，房主離線移交；倒數掉線取消。有效完賽後掉線不改判DNF，結果列在仍有在線車手時保留。所有人離線且續接期滿刪房。主動離房、逾時、心跳／背壓、90msg/s與8KB inbound均有界。
- session token僅寫自己的sessionStorage key，不寫單人localStorage。權威車況以平滑方式顯示，無client prediction；未宣稱高延遲手感已調好、完整反作弊、公開配對、持久雲端榜或ELO。
- 本模式不跑交通車／行人／破壞擺設，不寫單人金錢、PB、任務、成就、工坊最佳等；離房還原原位置與天候。獨立3D group與peer材質／幾何提供dispose。

### 接線與部署檔

- 新檔：`shared/summit-city-race.ts`（`CITY_RACE_VERSION='city-race-v1'`）、`src/summit-city-race-client.ts`、`src/summit-city-race-ui.ts`、`src/summit-city-race.css`、`server/summit-city-race-service.mjs`、`server/summit-city-physics-entry.ts`、`server/summit-city-specs.d.ts`、`tools/build-summit-city-physics.mjs`及生成bundle。
- `server/index.mjs` 新增 `/city-race`，沿用exact Origin，與 `/ws`、`/coop`共用總限額；新增tick／heartbeat於app.close清理。`close`會終止socket、清clients／rooms／service worldRef，process共用唯讀world快取保持供下一service重用。
- `server/Dockerfile`新增service／bundle／shared型別與全城市資料COPY。`tools/build-multiplayer-physics.mjs`於既有物理build後建獨立城市bundle。
- main新增模式互斥、存檔／經濟隔離、輸入／單人物理guard、路線導航、指定車型與天候，以及 `__gp.summitCityRace`。城市權威pose須在當格updateVisuals之前套用；重置／修車／換車／導航等單人操作不可穿透隔離。
- root整合lazy facade時保留工坊`online` hook及`history` getter；舊VM抽取main的測試需注入`const summitCityRace=undefined`，不可移除隔離斷言。
- `src/car.ts`、`src/track.ts`、`src/rivals.ts`、`src/pitlane.ts`、既有 `server/physics.mjs`與before逐位元一致；最終整合後仍須重跑固定三基準。

## 驗證

工作副本最後成功build：`92ee74cc558a`。整合後build與其最終測試另列根代理封版文件。

|指令|本副本結果|建立的證據|
|---|---|---|
|`npm run build`|PASS，tsc及兩套physics bundle成功|工具輸出；GP bundle維持原bytes|
|`node tools/dev-tests/summit-workshop-node.mjs`|8/8 PASS|before API對照、完整歷程、NG1逐byte／舊存檔、副本上限、真單行閉合、錯層、核心五檔|
|`node tools/dev-tests/summit-city-race-client.mjs`|6/6 PASS|實際client module在可控socket/storage/timer邊界下驗證取消、過期socket、handshake/state、seq重置、finish/DNF不送input、seat隔離、error/timeout重試|
|`node tools/dev-tests/summit-city-race-server.mjs`|13/13 PASS|真WS、真城市／真FreeCar完成比賽、4車、容量／Origin、重連／結果保留、時限、stall/catchup|
|`node tools/dev-tests/summit-city-race-browser.mjs`|整合副本6/6 PASS|整合build `3c95bd915b9f`；新增建房前1800→600秒UI預覽斷言|

Node最新四車：665ticks全部完成真城市143.105m路線／5gates、無DNF；成績9666.714／10183.383／10416.718／11083.387ms，tick平均0.540ms、最大4.750ms。此為一房短直線、本機可控時間搭配真WS輸入；不是12房免費主機負載保證。

早期browser build `bc6d9b1cfa84` 的5/5僅保留為歷史，整合後已重跑新版6/6。最新build `3c95bd915b9f` 一個真Chrome玩家＋一個真WS peer，實際CDP ArrowUp→client input→server真FreeCar全5gates完賽：瀏覽器甲23066.779ms、WS乙12500.061ms，均無DNF。工坊UI、存檔隔離、3D友車、手機390×844／844×390／844×220無溢出及按鈕44px、離房還原、建房前實際600秒規則預覽均通過；0外部請求、0JS例外、source/script未變、cleanupComplete=true。

最新browser證據 `tools/dev-tests/summit-city-race-browser-evidence-1794980833863/report.json`，與頂層result逐bytes一致，SHA256 `6fac120157af7fbe04400cc80654e0b44570f8bebd110e36d4f0469746884d35`。整合首跑1/2失敗是測試直接讀取lazy尚未建立的工坊DOM.hidden；等待改為先確認元素存在後重跑6/6，未動產品或刪除斷言。

每套Node／browser都有頂層result與同bytes evidence/report.json，記錄source/script SHA256、測試期間未變及cleanup。fixture錯層／stall等案例明確標示，不冒充真人行駛。`summit-workshop-audit.mjs`提供Node共同hash封存。

曾失敗且已修正／保留：工坊首次7/8是測試把真Router圓角路長錯估800m，改為與真路段和比對；server首次bundle直接引入vehicles造成Node的location不存在，改build期取spec；擴充server首次9/10是測試在服務端close事件前跳時，補settle後13/13；client載入器不能讀JSON及Vite回傳array為測試工具問題，改真Vite記憶體bundle後6/6。未削弱產品或既有基準。

尚未驗證：兩台真實裝置與外網、高延遲／丟包長時間手感、真手機／真手把、全城市各類路線平衡、12房／48車持續CPU與記憶體、Render免費方案實際限制。最終實機驗收清單保留。
