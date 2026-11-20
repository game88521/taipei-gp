# Voyager 第5、6、7項交接

署名：Rex <game88521@gmail.com>。由 `taipei-gp-voyager-racing` 整合至 `taipei-gp-voyager-work`；本文件記錄功能與子系統驗證，整輪最後結果以 [VOYAGER_VALIDATION.md](./VOYAGER_VALIDATION.md) 為準，實際套回狀態另見 DCISI/TAIPEI_VOYAGER_DELIVERY.md。沒有 commit、push、部署或外網測試。

## 已實作

5. 自由練習：大獎賽地圖、10或20分鐘、2～4位真人開場，開始後能加入、離開及10秒續接。無碰撞；依權威三分段／完整圈計時，擦牆作廢本圈；中途加入第一圈是無效出場圈，圈時從加入時間開始，避免吃到加入前的整房時間。到點立即結算有效最快圈，無有效圈標示。離開／續接逾期釋放席位，不改正賽中途加入限制。獨立 `practice` 歷史分類，保留天候及最佳分段；沿用原 history storage key 與整包備份 parser，無新存檔槽。

6. 天候：`legacy`（原房規）、全晴、全雨、乾轉雨。乾轉雨固定從共同起跑2:00開始，3:00全雨；預報不依個別裝置加入時間。權威、prediction、胎種抓地、實際里程胎耗、服務區換胎、雨效、schema4回放同源。預設耐久乾→雨→乾時序完全保留。一般場可換胎；排位週末與其他特殊玩法須先關閉。沒有分路段積水模擬。

7. VSC：房主事先在大廳允許，在正賽／耐久手動啟動。server強制80 km/h、prediction同限速；房主解除後再等3秒，倒數期間仍限速。共用HUD顯示禁超車與倒數，server記錄次序變動及啟動／解除事件。**此版不因超車自動加秒、不判肇責**；進站／避事故存在例外，事件供人工檢視。不是實體安全車，不支援自由練習與排位週末。

## 協議與相容

- 新能力 `voyagerRacing:true`，狀態 `voyager-racing-v1`。新房規只讓全員／觀眾都支援 Voyager 及 Summit 時開啟，拒舊加入、觀戰與續接，保留舊房舊路徑。
- `set-voyager` 綁房碼／大廳世代，精確設定鍵；`voyager-vsc` 綁房碼、match、track revision及socket單調seq，僅房主且phase正確才接受。未知欄位、錯世代、NaN／超限／能力錯配均拒絕。
- 設定練習會暫存原碰撞規則，關閉練習恢復；練習20分鐘有獨立deadline，不能被原10分鐘raceLimit截斷。
- 正賽新規採嚴格schema4回放，包含設定與各影格的濕度／VSC phase／相對解除時刻；沿用schema3車況欄位，舊1／2／3仍嚴格讀取。人物ID匿名化，不含房碼、token或真player ID。
- 練習名單可變且最長20分鐘，**不產生固定名單／12分鐘上限的正賽回放**；UI明示並另外保存練習戰績。主動離房前未到結束時，不提前保存本次未完成練習戰績。
- 分段最佳可來自不同有效圈；不是把三段相加捏造最佳完整圈。到時正在跑的未完成圈不計入，沒有最後一圈寬限。
- 修改 `validateSummit` 時先轉入嚴格 `validateVoyager`，避免對既有client VM harness增添替代驗證。UI透過原 `SummitRacingPanel` 掛載；兩支歷史DOM harness已載入真新增模組，未移除原斷言。

## 本機驗證

- `npx.cmd tsc --noEmit`：通過。
- `node tools/dev-tests/voyager-racing-node.mjs`：11/11；真loopback WS、真client parser、真Car兩完整圈／14178固定步、有效三分段；含20分鐘deadline、進出／續接、天候／換胎、限速／解除、schema4匿名與負向驗證，以及雨切回 legacy 的嚴格快照相容。
- `node tools/dev-tests/atlas-racing-server.mjs`：16/16；原24圖×3難度完整圈、三難度1真人3AI三圈碰撞賽，以及原四核心與physics byte hash不變。
- `node tools/dev-tests/summit-racing-client.mjs`：7/7。
- `node tools/dev-tests/next6-multiplayer-ui.mjs`：4/4（穩定快照不額外建立列表元素）。
- `node tools/dev-tests/multiplayer-map-ui-lifecycle.mjs`：8/8。

瀏覽器runner已備 `node tools/dev-tests/voyager-racing-browser.mjs`；預設本機4396及CDP9334，由根串行執行，本子代理未開Chrome。runner有獨立BrowserContext、攔截外部HTTP／WS、清理、source/script hash、desktop／portrait／landscape版面與截圖。真UI涵蓋練習、固定雨、中途加入／離房、獨立戰績、一般場乾轉雨／VSC與schema4回放。時間、速度與部分成績是明示server fixture；完整自然圈另由Node真Car驗證。

根整合後仍須統一build、歷史回歸、固定三基準與新browser runner；未執行前不可宣稱整輪已驗收或上線。

## 根整合接點

- 未修改 `server/index.mjs`、`main.ts`、`index.html`、`style.css`、`multiplayer-game.ts`、`nexus-replay-ui.ts`、package／lock、AGENTS或歷史交接。
- `multiplayer-scene.ts` 僅改雨勢來源一行，照片與舒適FOV hook由根另合。
- `nexus-replay-ui.ts` 完全保留，照片hook可由根插入；現有回放事件分類以 `session` 顯示VSC事件。
- 原核心 `src/car.ts`／`track.ts`／`rivals.ts`／`pitlane.ts` 與 `server/physics.mjs` 不改。
- 精確交付檔案與SHA256見 `tools/dev-tests/voyager-racing-files.json`。根應先合碼再build，不能直接帶此副本Atlas舊dist上版。
