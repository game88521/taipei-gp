# Nexus 第 4 項：多人賽事回放

本子功能已整合至 `taipei-gp-nexus-work`，於六項最終整合 build **64bc8f19a76a** 通過本機瀏覽器 7／7 案；Node 模型／server／client 27／27 案亦通過。整體六項的固定三項回歸及交付狀態由根交接文件統一記錄；此文件不代表已套回原專案、提交、推送或上版。

## 玩家入口

- 多人比賽結算新增「取得本場回放」，只有本房原車手及仍在房內的觀眾可明確取得；再戰、離房或房間回收前需先取得。
- 下方「多人回放庫」可播放目前資料、保存至 IndexedDB、下載 JSON 或匯入檔案。最多保留 5 場，成功保存第 6 場時在同一交易替換最舊一筆；空間不足則交易回滾，顯示可改用下載的提示。
- 獨立 3D 畫面提供播放／暫停、任意時間軸、前後 5 秒、0.25／0.5／1／2／4 倍、跟隨任一車手及鏡頭切換。可倒帶，關閉時釋放獨立場景、動畫回呼及事件。開賽時自動關閉回放。
- 檔案及本機庫包含車手暱稱；不包含房碼、原車手 id、原 match id、房間／系列續接憑證。下載及分享檔案前會提示玩家確認暱稱。
- 舊服務未宣告能力時，結算下載停用並顯示未提供；本機匯入／回放庫仍可使用。

## 資料與界線

- `RoomService.snapshot()` 在已完成排序後取伺服器實際車況，5 Hz 白名單錄製車身位置／方向／速度／路段／進度／圈數／名次／完賽／DNF／接力當值狀態；不修改車輛或進度。
- 最多保存前 **12 分鐘**、3602 個 frame 上限。超過時仍正常比賽，metadata 與播放器明示「部分回放／未包含尾段」。原有單場期限 10 分鐘，因此一般短賽包含全程；不是無限錄影。
- 這是 **權威軌跡回放**，不是逐步重算物理或錄製影片；場景以取樣間插值顯示。原結果、單人 PB、獎金、車庫及近期多人戰績不受回放操作影響。
- JSON 綁定 schema、protocol、physics、catalog、track stamp；嚴格白名單、有限數值、車手／frame 數、時間單調及 tuple 長度校驗，超過 8 MB 文字或版本不合拒絕。載入真賽道後再核對 length、sample index。
- `replay-chunk` 只接受現有連線本房的 results 回放 id，以及對齊的 24 KiB 字元 offset；無列舉他房介面。純觀眾可讀但不取得車手權限。
- client 單一下載、連續分段、順序／總長／識別驗證、20 秒總期限；斷線或下一場會中止，舊分段不會拼入新場。
- IndexedDB 不是防作弊或永久雲端儲存。匯入的軌跡是玩家持有的檔案，不能憑此檔案提交成績。房間回放留在記憶體，服務重啟不保存。

## 本子項驗證

`npm.cmd run build` 通過，副本 build `e8da520d784b`（root 整合後版本另計）。

| 指令 | 結果 | 證明範圍 |
|---|---|---|
| `node tools/dev-tests/nexus-replay-models.mjs` | 14／14 PASS | 白名單、不可變歷史、封頂／截斷、版本／格式拒絕、插值／倒帶、播放 room、快照排序及同毫秒結算 |
| `node tools/dev-tests/nexus-replay-server.mjs` | 6／6 PASS | 真 loopback WS、真 Car 短時駕駛、多分段、他房／未入房拒絕、觀眾、再戰清理 |
| `node tools/dev-tests/nexus-replay-client.mjs` | 7／7 PASS | 真 client 原始碼＋隔離 socket／時鐘，分段次序／內容／型別／逾時／跨場中止、無單人存檔存取 |
| `node tools/dev-tests/nexus-replay-browser.mjs` | 7／7 PASS | 最終整合 build `64bc8f19a76a`：真 WS 取得／保存、實際 3D 車模移動與倒帶、速度／車手、三種手機尺寸、匯入及重載後 IndexedDB 播放／刪除 |

server suite 的短場以 server DNF fixture 結束；有真物理移動，未宣稱人類完整完賽。client 第一次執行 5／7，兩個失敗為 fixture 不足 24 KiB 沒有跨段，以及 VM realm 的 Error 不同；增加實際跨段測資與注入同 realm Error 後原斷言通過，未改產品。server 第一次 5／6，結算舊 broadcast 未耗盡造成 reset 案讀到舊訊息；使用既有 settle 後原斷言通過。

`src/car.ts`、`src/track.ts`、`src/rivals.ts`、`src/pitlane.ts`、`server/physics.mjs` 五檔 SHA256 與本輪 before 完全一致。未新增物理亂數或改 pitRnd 次序。

瀏覽器腳本已在獨立 context／IndexedDB／loopback 完成：41 個權威 frame，3D 車模由 `(11.80,61.08)` 移至 `(136.48,217.46)`，倒帶及切車手正常，播放時沒有傳送比賽 input；390×844、844×390、844×220 的控制項均可達。姿態與 DNF 明示為服務內 fixture，非人類完整比賽。最終 build `64bc8f19a76a` 報告為 `tools/dev-tests/nexus-replay-browser-result.json`，當次獨立封存報告與圖像證據位於 `tools/dev-tests/nexus-replay-browser-evidence-1794976025185/`；其中 `report.json` 與頂層結果為同一份 JSON bytes，先封存後更新頂層指標。外部請求 0、JS 例外 0、產品與腳本 SHA256 在測試期間穩定，browser context／peer／server／preview 均清理完成。預設 preview 4398、CDP 9334；不要與其他 browser suite 同時佔用 CDP。

真手機、外網多人、12 分鐘真實時間 GPU／記憶體／耗電及真人回放觀感未驗證，不能把虛擬時間模型測試當成上述證據。

## 整合

- 與 Arena 三方合併 `room-service`、`multiplayer-protocol`、`multiplayer-client/game/scene`。`receiveReplay()` 放在 `horizonReceive()` 前，讓本房純觀眾也可讀；在 `snapshot` 的最終排序後呼叫 `observeReplay(room, now, players)`，不能移至 raw player 排序之前。
- `shared/nexus-replay.ts` 的 `replayRoomAt()` 會把錄製的當值 active=false 映成半透明回放車輛，不重算接力進度；mode 支援 `relay`／`items` 字串。
- server Docker 需加入 `server/nexus-replay-service.mjs` 及 `shared/nexus-replay.ts`（已告知 coop agent）。不需新增 Vite entry／npm 依賴。
- client 新增 runtime import `../shared/nexus-replay`。歷史測試若手寫 VM loader，需注入這個真模組並保留原測試案例及期望；新增 client 測試採顯式依賴映射。
- 檢查 `multiplayer-game.ts` 最末的 `mountMultiplayerReplay(()=>client)` 與 `__mp.replay` 沒有在三方合併時遺失。回放使用額外場景，不碰 live renderer 或 input 傳輸。
