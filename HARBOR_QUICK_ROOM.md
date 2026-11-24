# Harbor 三步快速開房

Rex <game88521@gmail.com>

依序選玩法、24 張現有地圖、房規與相容預覽，最後明確按「確認建立房間」，才呼叫既有原子 `create-configured`。草稿操作、回退、取消不連線、不改地圖、不建立或修改房間；已有房間時禁用此入口，原建房／範本／進階房規保留。

四種玩法為一般圈數競速、限時最快圈、讓秒追逐、補給道具賽。AI、天候與車損只供一般競速使用；特殊玩法會保留先前草稿並列出衝突，必須手動調整或按建議房規按鈕。限時最快圈固定無碰撞。相容判斷最後仍由現有 `parseRoomPreset`／`parseMeridianAdvanced` 與伺服器驗證。

讓秒追逐的玩家 ID 必須在入房後才能指派，因此預覽明示建房時全員預設 0 秒；朋友入房後，房主再在既有玩法設定逐人指定並明確套用。快速開房不會假裝已完成逐人讓秒。

## 整合介面

```ts
import {mountHarborQuickRoom} from './harbor-quick-room';
const quickRoom = mountHarborQuickRoom(host, {
  getState: () => ({hasRoom: !!client?.room, busy, ready: graphicsReady}),
  create: async preset => {
    // 由既有進房流程驗證名稱、連線與取消；連線後重查未在其他房間。
    // await client.createConfigured(name, preset)，確認收到新房間才 resolve。
    // 成功後把焦點移至帶可存取名稱且 tabIndex=-1 的房間大廳。
    // 失敗必須 reject，勿直接用吞掉錯誤的 action() 當成功。
  },
  initialTrackId: 'taipei',
});
// renderUi() 內呼叫 quickRoom.refresh()；卸載時呼叫 quickRoom.dispose()。
```

`HarborQuickRoomFlow` 不依賴 DOM。送出前重查房間、busy 與載圖；等待建立結果時防重複送出與修改，失敗保留草稿。建房回呼未確認房間時不顯示成功。送出前可取消；送出後等待同一次請求結果，不重新送出或自動起跑。

整合的能力握手使用 `connectRoomPresets()` 等待目前 socket 對應 ping 的有效 pong，避免把 socket 已開啟誤認成伺服器能力已知。外層沿用 45 秒可取消連線流程，每次能力等待最多 7 秒；明確不支援的 pong 會完成能力握手，再由原本能力檢查立即拒絕，不反覆送出建房。舊範本及觀戰入口同用此流程。斷線會清除能力與等待者；退休 socket 或前次的 true 不能授權新 socket。

## 最終本機驗證

- `node --experimental-transform-types tools/dev-tests/harbor-quick-room-node.mjs`：**10 PASS／0 FAIL**，證據 `tools/dev-tests/harbor-quick-room-node-evidence-1795484196183/report.json`。96 個四玩法乘 24 圖組合由真 `RoomService` 原子建立，留在大廳且不自動起跑；另驗 AI／雨天／車損、無效組合原子拒絕、已有房不覆蓋、回退取消、防雙送與失敗重試。真人未自動準備；一般競速的 AI 依既有規則準備。
- `node --experimental-transform-types tools/dev-tests/harbor-preset-handshake-node.mjs`：**7 PASS／0 FAIL**，證據 `tools/dev-tests/harbor-preset-handshake-node-evidence-1795484991203-1b0504/report.json`。涵蓋原呼叫次序重現、延遲／錯配／非法 pong、三種負能力立即拒絕、取消、斷線與退休 socket、7 秒單次／45 秒外層界線、同步 pong 與共用等待者。正向由真 client 與 in-process 真 `RoomService` 建房一次；10 個測試環境全清理、來源及腳本 hash 全程一致。
- `node tools/dev-tests/harbor-quick-room-browser.mjs`：**7 PASS／0 FAIL**，本機 dist build `f15b569a01d7`。最終 immutable 證據 `tools/dev-tests/harbor-quick-room-browser-evidence-1795486311763/report.json` 與 latest JSON 的原始 SHA-256 相同；零外部請求、零未捕捉例外、完整 cleanup，來源及腳本 hash 全程一致。
- 完整 build 已通過，證據 `tools/dev-tests/harbor-build-evidence-1795485090753/report.json`；固定三基準 **3 PASS／0 FAIL**，證據 `tools/dev-tests/harbor-chain-stab-evidence-1795485666960/report.json`，同為 build `f15b569a01d7`。

Node 及能力握手的 socket／時間是明示的 in-process fixture，不將其當成真 WebSocket 證據。瀏覽器結果使用本機 dist、真 Chrome 頁面與 loopback 服務；手機尺寸模擬不是實體手機。

### 瀏覽器最終七案

1. 三步草稿、24 圖、回退與取消均不建房、不切圖，保留原進階入口。
2. 換玩法保留三項不相容草稿並阻擋建立，明確重設後解除；390×844、844×390、844×220 下表單可達與觸控範圍通過。
3. 一般競速確認一次，原子建立地圖、1 輛 AI、雨天、車損、5 圈及 120 秒完賽寬限；真人 `ready=false`、AI `ready=true`，仍為大廳、`matchId=null`。快速入口禁用；不變快照的預覽保持同一 DOM 節點且 0 mutations。
4. 限時最快圈建立與預覽一致：無碰撞、300 秒、無 AI、legacy 天候、無車損，真人未準備、未起跑。
5. 讓秒追逐建立與預覽一致，建房時尚無逐人延遲，真人未準備、未起跑。
6. 補給道具賽建立與預覽一致，`arena=items`，真人未準備、未起跑。
7. 草稿期間用原入口建房後，快速流程禁用，原房保留且沒有新增快速房。

四種玩法成功建房後均驗證原生操作完成時，焦點位於帶 `aria-label="房間大廳"`、`tabIndex=-1` 的 `mp-room`，有可見尺寸且不在 hidden、inert 或 `aria-hidden` 祖先內。

最終證據截圖位於 `tools/dev-tests/harbor-quick-room-browser-evidence-1795486311763/`：`quick-room-rules-390x844.png`、`quick-room-rules-844x390.png`、`quick-room-rules-844x220.png`。

## 保留的歷史失敗與修正

- 最初以不帶 transform flag 的 Node 指令啟動失敗（0 案執行），保留於 `tools/dev-tests/harbor-quick-room-node-startup-failure-1795500000000.json`；沒有將啟動失敗列為測試通過。
- `tsc --noEmit` 第一次檢查遇到同時開發的共用 client capability literal 型別錯誤；quick-room 新檔當次沒有型別錯誤，最終完整建置通過。
- 首次瀏覽器 **2 PASS／1 FAIL**：第三案遇到 open／pong 能力競態，證據保留於 `tools/dev-tests/harbor-quick-room-browser-evidence-1795484273294/`；修正為等待目前 socket 的有效能力 pong。
- 後續 build `f15b569a01d7` 瀏覽器仍為 **2 PASS／1 FAIL**，原執行證據為 `tools/dev-tests/harbor-quick-room-browser-evidence-1795485205034/`。測試用不存在的頂層 `ai` 欄分類，誤把正常已準備的 AI 算成真人。真 `RoomService` 獨立重現證明真人未準備、AI 已準備、仍為大廳且 `matchId=null`；僅修測試分類為 `summit.ai`。原 FAIL、修前腳本與重現證據保留於 `tools/dev-tests/harbor-quick-room-ready-oracle-evidence-1795485417326/`，沒有放寬真人不自動準備／不起跑要求。
- 接續 **3 PASS／1 FAIL**，保留於 `tools/dev-tests/harbor-quick-room-browser-evidence-1795485820994/`：前案的一般競速 AI／雨天／車損草稿依設計保留，切限時最快圈後正確出現衝突並停用建立；harness 未明確重設就按建立。修正為測試在存在衝突時，透過既有可見建議房規按鈕明確重設，不改產品的草稿保留行為。
- 再次 **4 PASS／1 FAIL**，保留於 `tools/dev-tests/harbor-quick-room-browser-evidence-1795486227844/`：harness 對沒有衝突的讓秒草稿仍無條件按隱藏的 reset，原生命中檢查正確拒絕。修正為只有 `errors` 存在、reset 可見且可用時才原生點擊；沒有衝突時維持現有草稿並繼續，未強制顯示或 DOM click。

整合由 root 協調；四個模擬核心未變。本輪沒有 commit、push、部署或正式站測試，未宣稱實體手機、外網容量或公開部署已驗證。
