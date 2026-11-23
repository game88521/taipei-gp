# Meridian：站間續局、三四人追走、雙人領航

署名：Rex <game88521@gmail.com>

本文件只記錄本次 #3、#7、#11。未 commit、push 或部署；正式交接由主代理最後更新。

## #3 好友盃／派對跨日站間續局

- `shared/meridian-checkpoints.ts`、`server/meridian-checkpoints.mjs`：7 天、最多 64 KiB 的 `MC1` HMAC-SHA256 簽章摘要。拒絕任何深層 token、secret、input、queue、pose、physics、carState 或原型欄位。
- 每位原席另收獨立隨機恢復秘密；公開票只有 SHA256 proofHash。秘密不沿用正常 session token。瀏覽器必須成功寫入、讀回私密儲存後才 ACK，全部原席 ACK 後才發布可下載的公開摘要。
- 私密 key：`taipei-gp-meridian-private-continuation-v1`，**必須排除備份**。公開 key：`taipei-gp-meridian-checkpoints-v1`，使用 `parsePublicCheckpoints`，最多 12 筆。
- Cup adapter：`server/meridian-cup-checkpoints.mjs`；GP 共用房間 helper/client/UI 由 racing 代理整合。普通好友盃與 Aurora 循環好友盃都可在下一小場的 ready 大廳保存。不能保存倒數／行駛中的車輛。
- Party adapter：`server/meridian-party-checkpoints.mjs`，可保存大廳或上一場結束後的公開派對回合、積分、原席與下輪玩法。恢復只建立新的大廳，不重放剛完成的那一場。
- 恢復保留原公開席位／歷史 player ID，配發全新 session token 與新車；其餘席預約且鎖定，不開放新玩家取代。全員原席到齊並重新準備後才可起跑；非房主先回來也保留原房主身份。
- 一期票在服務記憶體內只對應一間恢復房，來源房仍存在時重用同房。來源已繼續比賽時拒絕把舊站間摘要套回去。新 export 釋放上一張 active handle，避免 64 張容量累積。
- `MERIDIAN_CHECKPOINT_SECRET` 必須是 64 個小寫 hex。設定固定 key 才能跨服務重啟驗簽；未設定使用 ephemeral key，UI 明示重啟即失效。主機免費方案休眠仍須保有相同環境變數。

公開備份只包含簽章摘要，不能替朋友取得私密身份。同一來源網域、同一瀏覽器儲存未清除，是跨日恢復的前提。這是私人房存檔功能，沒有伺服器持久化防重播帳本：最新世代防回退在單次服務記憶體內有效；重啟後可由全體原席載入尚有效、簽章正確的舊站間存檔。沒有宣稱永久防回退、恢復行駛車輛或全域官方成績。

## #7 三四人公平追走輪賽

- 保留舊雙人追走，建房選單另勾選「三四人公平追走輪賽」。獨立能力 `meridian-tandem-rotation-v1`。
- 3 人共 6 段、4 人共 12 段；每段正常 60 秒，每個有向的領跑／追走配對各一次。每人領跑、追走各 n−1 次，追走分累加。每段重新倒數、清空舊輸入與更新控制世代。
- 每次只有 leader/follower 兩輛車實際模擬、接觸與計分；其他原席停在候場區，client 與 server 都拒絕候場輸入。沒有把第三、四人當成純觀眾。
- 原席掉線即停車、凍結當段剩餘時間；15 秒內原席續接且明確確認後恢復，逾期整輪取消，未完成配對不保存完整排名。已結束的 roster 不因斷線逾期而縮短。
- 獨立歷史 `taipei-gp-meridian-tandem-rotation-v1`，`parseRotationHistory`，最多 20 筆／65536 字元。驗證每個配對、每人追走次數與總分；不混入舊雙人 tuple 戰績。

## #11 雙人領航拉力

- 原好友定速拉力入口勾選「雙人領航拉力」。能力 `meridian-navigator-rally-v1`；保留舊 2～4 人經典定速拉力。
- 兩人共用一輛真 sedan；driver 唯一接受 input、唯一 FreeCar.update。navigator 不更新第二輛物理車，只讀共用權威姿態、路書與成績。
- 領航員可用原生 HUD 按鈕傳送左彎、右彎、直行、迴轉、注意減速、保持均速；白名單、場次、revision、序號與 500 ms 節流均在 server 驗證。司機不能發領航指示，領航員不能控制方向、油門、位置或通關進度。
- Driver 隱藏自動路書、導航 path 與路門提示，只接收真對端發來的指示；navigator 有路書與可查看的道路資訊。客戶端仍需驗證共享路網，不宣稱能對改版作弊 client 隱藏原始地圖。
- 真實順向、同層、順序道路門與四計時點沿用既有 authoritative 裁定；時差、超速罰分、完賽時間兩人一致。成功共同結果只存一筆獨立 crew 成績，不在經典個人戰績重複記兩次勝利。
- 任一掉線立即停車、清佇列並凍結賽時計時；原始 15 秒期限不因重試延長，原席恢復還須確認操控。逾期或主動離房共同 DNF，保留可解析的雙席結果；>1 秒模擬停頓或時鐘倒退取消本場。
- `SummitCityRaceService.tick` 只增加可選 `skipBaseTick` hook；普通服務預設完全照舊。Frontier 子類只對 navigator 房自行 tick，避免同一個 server tick 做兩次模擬。
- 獨立歷史 `taipei-gp-meridian-navigator-results-v1`，`parseNavigatorHistory`，最多 20 筆／32768 字元。只收共同成功結果，Storage 異常保留原文、提供下載、不誤報成功。

## 本機驗證

命令使用 `node`，避開 Windows 的 npm/npx PowerShell execution-policy 問題。

| 指令 | 結果 |
| --- | --- |
| `node tools/dev-tests/meridian-checkpoints-node.mjs` | 7/7 PASS，驗簽、防偽、錯席、過期、generation、一票一房、公開備份邊界 |
| `node tools/dev-tests/meridian-checkpoint-client-node.mjs` | 5/5 PASS，先私寫讀回再 ACK、quota/CAS/損壞不 ACK、公開備份不能冒領、公開保存錯誤不被成功文案覆蓋 |
| `node tools/dev-tests/meridian-social-node.mjs` | 7/7 PASS；完整 3 人 6 段與 4 人 12 段正常各 60 秒 authority ticks、候場 update=0、15 秒取消；另真 180 秒王冠產生非零派對積分後簽章保存，跨服務原席恢復且保留該回合與積分；新 export 在世代上限失敗時保留舊 active handle |
| `node tools/dev-tests/meridian-navigator-node.mjs` | 9/9 PASS；真 loopback WS 司機操控／領航指示、真 FreeCar 移動 4.29 m，領航 car.update=0、續接、逾期、離房與倒時鐘 |
| `node tools/dev-tests/aurora-social-node.mjs` | 9/9 PASS，舊派對／投票／換模式回歸 |
| `node tools/dev-tests/frontier-rally-node.mjs` | 17/17 PASS，舊 2～4 人經典拉力／private seat／真產品 client 回歸 |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS；最終集中 build 由 root 執行 |
| `node tools/dev-tests/meridian-social-browser.mjs` | 最終 build `862f7f9c9857`，3 個隔離 context，6/6 PASS；0 exception／0 external，完整清理、source/script 未變更稽核均 true。涵蓋原生 44px checkbox、候場鍵盤隔離、私證明 ACK、逆序原席恢復、真領航指示、390直式／844橫式／220矮窗可捲動點擊，以及 QR 真顯示／收起與實際黑白像素斷言 |

最終 browser 證據：`tools/dev-tests/meridian-social-browser-evidence-1795411303859/report.json`；收據：`tools/dev-tests/meridian-social-browser-result.json`。實測 QR 為 246×246，19,908 黑像素、40,608 白像素，透明／其他色像素 0；收起時 computed display 為 none，尺寸與 client rect 數歸零。腳本 SHA256：`d3c21f4250cbe51fbc3fe5723a8f12f6513bb078aa50febcebb968fb7d906d61`。共用 heading helper 更新後，navigator Node 亦已重跑 9/9 PASS，來源稽核與清理均 true。

Node 成績完整過門測試明示安排 server-side 前後 crossing fixture，驗證真路網方向、路層、計時與共同計分；沒有宣稱真人駛完整條路。完整追走輪轉使用正常時長的閒置 FreeCar，證明機會公平、角色隔離與流程，不代表漂移手感或網路延遲平衡。所有測試只在本機，未訪問線上遊戲或部署平台；沒有真機或 Render 免費方案負載／四位跨網路人類試玩結論。

四套新 Node 與 browser suite 都記錄產品來源 SHA256、測試腳本 SHA256 及執行期間未變更檢查。公開 quota 原文錯誤與新 export 失敗的狀態原子性都有針對性回歸案。

初次 browser FAIL 是既有 helper 只接受 `button/a` 卻拿來點 checkbox。保留該次 evidence；新 helper 直接檢查 input 實際命中、44px、未隱藏／停用後，用 CDP 原生 mouse 按下與放開，沒有用程式設定 checked 或放寬可觸達檢查。產品 source 沒因此變更。

後續截圖複查發現舊邀請卡 `.aurora-invite canvas{display:block}` 蓋過原生 hidden，未展開 QR 時露出白框；已窄加 `canvas[hidden]{display:none}`。邀請 section 本身沒有 display 覆蓋，保留正常原生 hidden。social 首案現在原生點擊「顯示QR／收起QR」，檢查收起時 computed display 與 rect 歸零、展開時有面積且實際 canvas 各含超過 10% 的不透明黑／白像素，拒絕透明或純白畫面；將該 CSS、QR 與邀請 UI 都列入來源稽核。
