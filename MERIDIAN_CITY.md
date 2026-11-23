# Meridian 城市續玩、NG3合作與照片尋寶

作者：Rex <game88521@gmail.com>

本輪對應第2、10、12項。原專案套用、commit、push及部署由主代理另行核對；這份文件不代表已發布。

## 公車與單人NG3續玩

- 公車勤務面板和NG3編輯器各有「續玩未完成任務」與「放棄」按鈕。存在未完成資料時，開始同類新任務會要求先處理原任務。
- 每2秒有效模擬時間、階段切換、開關門／手動確認，以及離頁／隱藏時保存。離開任務保留未完成進度；「放棄」才清除。
- 續玩重建原路線、班表、支線與車款，核對路網及計畫指紋，再將真FreeCar停在保存位置；速度歸零，離線期間不扣任務時間。路網或物理版本不相容則拒絕，保存原文。
- 公車保存站序、路門、乘客交換、門與輪椅坡板中間階段、下車鈴、時間、平順與準點、紅燈分與分段損失。另保存路口狀態none／approach／entered，重新載入時綁定新Traffic路口物件；停在紅燈前續玩後首次闖入仍扣8分，已進同次路口則不重扣。舊v1缺少此欄位仍可讀，視為尚未進入，下次保存補上狀態。
- NG3保存倒數／進行階段、前序路門、停留、碰撞與模擬時間。精停與裝卸繼續使用真車姿態判定，裝卸仍需明確確認。
- 成功以一次CAS寫入同時清除pending與保存唯一完整receipt。公車連續營運透過事件ID重播關站及班次入帳，防止重複扣候車或加班次。舊單趟／NG3列表可從receipt補顯示，跨儲存key的鏡像不是第二次結算。
- 損壞、quota、唯讀、另一頁更新與備份還原衝突，均保留儲存中的原文。不因自動保存覆寫另一頁。

## NG3好友合作

進入「城市挑戰工坊」，設定NG3後使用「以目前NG3建立合作房」。朋友在同一面板填六碼房間碼加入。每人確認路線並準備，房主讓2～4人同步起跑；NG1／NG2既有玩法保留。

每名玩家各開一台真FreeCar。伺服器以固定60Hz模擬真城市路面與建築碰撞，玩家只傳方向、油門、煞車、手煞車及作業指令，不能回傳位置、分數或通關狀態。

分工依目前隊伍次序為司機、裝卸員、領航員、警戒員。司機依序沿路門前進並同層精停；隊友須自行到場，在18公尺內停穩並長按自己的工作。長按中移動、錯層、放開或指令超過700ms未更新，都重算該次作業。全隊完成才進下一階段；支線在建房前選擇。

隊員顯示既有虛構車款、車輪轉動與轉向、車身俯仰／側傾及具席次色彩的名字牌。此模式隊員車輛互相穿透，房規介面不宣稱車間碰撞；建築與路面仍使用真Collider／Surface。

斷線保留席位15秒，使用本頁sessionStorage私密憑證續接；續接旋轉token，收到welcome前斷線可用同一resumeKey重試。續接後需明確按「確認恢復操控」，期間自車停下、舊輸入及長按清空。倒數掉線取消準備；房主離房移交在線隊員；人數不足、任務超時或伺服器模擬中斷都不偽造成績。伺服器重啟沒有持久化城市任務房間。

## 城市照片尋寶

同一面板提供離線單人及1～4人好友房。三個關卡取自真城市、可沿道路連通的不同路名，總路線不超過6公里，必須依序尋找。現行城市產生「松智路」「信義路五段」「松仁路」線索，完整路程約1238.287公尺；城市資料更新後會重新驗證。

閱讀線索尋找遊戲中的同名綠色路牌，沿同層道路找到目的地，12公尺內、速度低於0.5m/s時按「拍攝現場並確認線索」。線上由伺服器依真車況接受，隊員共享關卡進度；離線使用同一產品規則。拍照不額外捏造模擬時間。

照片來自當下已渲染的遊戲canvas，縮至不超過960×540的JPEG。本頁最多保留3張，只有通過位置／順序檢查的照片會出現下載連結；沒有相機權限請求、不使用AI圖片、不上傳照片至服務端。未通過時可移動後重拍。離開任務會撤銷Blob URL並釋放圖片與同場模型。照片本體不寫入存檔，應於離開前自行下載。

## 儲存與服務界面

| 資料 | key／路徑 | 邊界 |
| --- | --- | --- |
| 單人未完成任務與結算receipt | `taipei-gp-meridian-city-resume-v1` | 1MB；每類1個pending；最近60筆完整receipt；不含token |
| 照片／合作結果 | `taipei-gp-meridian-city-records-v1` | 最近40場；驗NG3內外checksum與結構；不含照片或token |
| 私密續接席位 | sessionStorage `taipei-gp-meridian-city-private-seat-v1` | 只供本頁續接；不得匯出／備份 |
| 連續公車營運 | 既有 `taipei-gp-aurora-bus-v1` | 相容舊v1；新可選ledger；100KB匯入上限 |
| 城市任務服務 | WebSocket `/city-mission` | `meridian-city-v1`；每房最多4人，預設最多2房；沿用整站來源／容量檢查 |

公用房間snapshot不含私席token或resumeGrant。指令有revision、matchId、motionRevision與遞增序號；長按另綁目前階段。重開一場、席位續接或名單世代變動，都重置相應序列與操作狀態。伺服器heartbeats、房間TTL、流量與backpressure有界，關閉後late callback不能重建房間。

HUD最多每150ms更新一次，隊伍、歷史與照片以內容key避免逐frame重建。相同劇本／路網的路線只重建驗證一次，後續snapshot仍比較實際route與definition資料。連線中也會占用工坊busy，關閉工坊會取消等待，遲到welcome不會借車或切回其他模式。成功與儲存狀態分開顯示；quota／CAS／唯讀會在駕駛中的結果HUD明示原因，避免誤報已保存。

NG3合作、雙人領航拉力與城市自訂競速共用`workshopRoutesMatch`。本機實捕同一條路的起始朝向在Chrome為`-0.011235482257952508`、Node為`-0.01123548225795251`，只有`Math.atan2`末位相差約`1.7347e-18`。比較僅允兩個有限`start.h`相差不超過`1e-12`；路徑、路層、高度、路門、錨點、路長、起點座標及其他欄位仍逐字精確比較，NG3的definition也保持精確比較。NG1／NG2編碼與路線生成不變。

城市任務client只在`racing`送操控與作業；大廳、倒數和結算不發無效訊息，也不消耗序號。比賽中的`active:false`仍能送出，供切背景／失焦安全停車。服務端原有90訊息／秒上限保持。測試另修正authority clock隨真經過時間前進；倒數與合作階段快進仍明示由fixture執行，避免凍結時鐘卻持續送真WS的假限流。

## 測試與實際範圍

主代理統一build及固定基準，子代理依序使用獨占CDP。城市主suite、儲存HUD與路線修後對照已在最終本機build`862f7f9c9857`執行；完整專案最終狀態仍以主代理的本輪驗證清單與不可變evidence為準。

```powershell
node tools/dev-tests/meridian-city-models.mjs
node tools/dev-tests/meridian-city-node.mjs
node tools/dev-tests/meridian-city-client-node.mjs
node tools/dev-tests/meridian-city-road-prime-node.mjs --expect-fixed=1
node tools/dev-tests/meridian-city-browser.mjs
node tools/dev-tests/meridian-city-save-hud-browser.mjs --expect-fixed=1
node tools/dev-tests/aurora-city-models.mjs
node tools/dev-tests/aurora-duty-node.mjs
```

- 新純模型：15/15 PASS。包括240m真FreeCar完整公車、道路中與開門／坡板5種續玩、360m NG3主支線真車續玩、原子receipt、CAS／quota／權限／損壞、營運冪等、合作作業及照片順序邊界、真城市三路名可達。另驗真共用路線函式的有限heading／`1e-12`邊界，67個其他數值逐一做最小可表示改動及新增／缺欄都被拒絕。
- 新真WS服務：12/12 PASS。2／3／4台真FreeCar沿真城市143.105m道路完整合作裝卸，分別20.4167、20.45、20.95秒；另驗重連憑證／lost-welcome／確認、TTL、五人拒絕、長任務parser、房主換手、close-latch與cleanup。
- 產品client：7/7 PASS。以明示記憶體transport連接真client／service，驗超過12000包的長場再戰、名單世代、token／resumeKey、確認、取消遲到welcome與清理；另以明示phase快照驗非比賽不送包／不耗序號，比賽inactive仍可送。不冒稱這7案是真網路測試。
- 路口恢復對照：修前2/2按預期重現approach漏扣0分，修後2/2驗首次扣8分、同次不重扣、離開後再次進入扣分。
- 新瀏覽器主suite：10/10 PASS，build`862f7f9c9857`。包含reload續玩、取消pending連線、同task最後確認結算、真JPEG非黑與下載、gallery穩定、雙頁真UI建房／準備／同步起跑、車外觀、原生單頁長按／blur、390×844／844×390／844×220排版、借還車與資源釋放。最終下載JPEG為4877 bytes，192×108，20736像素中20729非黑；低解析為桌面測試設定，不宣稱手機原生照片品質。
- 儲存HUD瀏覽器對照：修前`a4ac47c8001c` 2/2按預期重現錯誤提示；最終build`862f7f9c9857`修後2/2 PASS。quota及另一頁CAS皆保留原文，駕駛中HUD顯示「結果僅保留在本頁」及實際原因，不誤報已保存。修前的PASS代表舊問題已重現，不代表問題已修好。
- 額外路線對照：修前保留真heading差與拒絕建房，最終build修後1/1 PASS，確認差值依然存在但client正常connected，其他route／definition相同；此對照不混入城市主suite的10案。
- 凍結時鐘對照：build`35ff11abd0b0`實捕原服務在第91包呼叫close，code1008「城市任務指令超限」，`now`與限流window完全相同。該PASS僅證明fixture問題已重現；先前過嚴要求close完成時count恰為91、實際多一個in-flight包為92的0PASS／1FAIL也保留。
- 舊`aurora-city-models.mjs`：8/8、`aurora-duty-node.mjs`：9/9均在最後變更後重跑PASS；全專案`tsc --noEmit` PASS。這些結果不能代替本輪瀏覽器或手機實機驗證。

明示測試限制：完整單人行車使用直路fixture；合作服務是真城市短直路，沒有冒稱真人跑完所有長劇本。照片fixture會由測試將車放到目的地，再驗證真拍攝／像素與規則。兩個Chrome context仍共用一台桌面；合作終段使用兩頁真WS work指令fixture，原生長按另案驗證；TTL真時鐘邊界由Node證明。免費Render多人負載、跨網路與手機實機尚未測試。

最終不可變瀏覽器證據為`tools/dev-tests/meridian-city-browser-evidence-1795410736796/report.json`、`meridian-city-save-hud-browser-fixed-evidence-1795410788580/report.json`與`meridian-city-route-fixed-evidence-1795410804447/report.json`。各次失敗保留在原時間戳資料夾；包括有效範例路線前置遺漏、隔離context下載設定、末位朝向誤拒、凍結時鐘限流。真WS Node亦曾因跨socket準備訊息未到就start而1PASS／1FAIL，原`meridian-city-node-evidence-1795409752879/report.json`的status留在RUNNING是當時catch漏標，不能視為通過；之後改等真WS全員ready並重跑12/12 PASS，後續catch明確標FAIL，未改寫原收據。

## 手機最後驗收

1. 使用本機建置與同網測試預覽，確認主選單入口與舊玩法皆可達；遵守AGENTS，不拿線上站測試。
2. 公車在駕駛中、車門開啟、坡板展開／服務／收回各重新載入一次；確認車停妥、原站序／乘客／時間不倒退、已完成班次不重複入帳。
3. NG3含支線，在倒數、精停或裝卸中關頁續玩；確認保留進度，最後確認只入帳一次。
4. 兩至四部裝置加入合作房，依序準備。每人自行開車到場並長按自己的工作；離開工作範圍、放開、切背景都不應繼續累積。
5. 一部裝置短斷線後15秒內續接，確認其他人仍在同房、token不出現在任何公用邀請資料，續接需確認才恢復操控。
6. 單人與好友依三條真路名尋寶，各拍至少一張並下載，確認畫面不是黑圖、照片與目前現場一致、共享關卡依序前進。
7. 窄直向、橫向與矮視窗都能捲動HUD並點到退出／長按／拍照；離開後控制釋放、還原原車與天候。
