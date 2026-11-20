# Frontier 城市短斷線自動續接

作者：Rex <game88521@gmail.com>。

共用能力版本：`frontier-city-resume-v1`。此文件記錄第 4 項的共用排程與操控確認約定；社交城市與救援城市各自的 client、server、UI 和真 WebSocket 驗證仍須另外通過，不能用 helper 測試代替。

## 玩家行為

只有已成功加入的玩家席位在非預期斷線後，才啟動自動續接。初次連線失敗、觀眾、主動離房、被移出和失效席位不啟動。

每輪最多 3 次，自首次察覺斷線起只有 15 秒，單次連線最多 4 秒。第 1 次立即嘗試；一般網路失敗後分別等待 500ms 和 1500ms。若 server 明確回覆 `SEAT_BUSY`，代表舊連線可能仍在等待 heartbeat 釋放，兩次退避改為 3000ms 和 5000ms，避免在約 2 秒內就耗盡三次。所有等待仍夾在原 15 秒內，可能因此不足三次；這不保證一定能續接。畫面顯示目前次數、原期限剩餘時間及取消操作。瀏覽器背景期間不發起新的嘗試，回前景也不補發新的 15 秒。

續接成功後進入 `confirm`，玩家必須確認才恢復操控。helper 不重送油門、方向、準備、起跑或救援作業。進入確認畫面就清除續接 timer；已經連上的玩家可停留超過 15 秒再確認，不會因本機續接倒數被斷線。若確認前再次斷線，仍只可用原期限與原剩餘次數。

三次失敗、期限屆滿或取消後，不會自行開啟另一輪。由新房間或完成明確手動流程重設狀態。伺服器的 15 秒斷線保留期可能比 client 察覺斷線更早開始，不能保證每次在 client 畫面期限內都仍有席位。

## 共用介面與整合

- `shared/frontier-city-resume.ts`：能力版本、typed failure code 與 terminal 判定。
- `src/frontier-city-reconnect.ts`：`CityAutoResume`、`CityResumeError`、唯讀狀態與有界 timer。
- `CityAutoResume` 建構參數：`resume(signal, context)`、`abortTransport()`、`eligible()`、`changed()`；測試可注入 `visible()`、`now()` 和 `timers`。
- `start()` 只由已加入席位的非預期 close 呼叫；`wake()` 在前景重查期限，helper 自行監聽 `visibilitychange`。
- `cancel()` 中止當前嘗試與後續排程；`confirm()` 只接受已成功續接的 `confirm` 狀態，然後解除操控關卡。
- `reset()` 用於明確的新連線流程；`dispose()` 同步取消嘗試、清除 timer、移除 visibility listener。
- `state` 每次回傳副本；`gated` 在所有非 idle 階段保持 true。`context` 帶有 episode、attempt 與 deadline，不含席位憑證。

`deadline` 使用注入的單調 clock，預設是 `performance.now()`，不是 UTC 時間。clock 倒退不能增加剩餘時間。每次 attempt 有獨立 `AbortController`，逾時、取消和 dispose 會 abort signal，並透過 `abortTransport()` 使 client 的連線世代失效。即使 event loop 延遲或舊 Promise 晚到，也須再次驗證 4 秒／15 秒及世代，不能重新打開操控。

`eligible()` 代表仍允許恢復這個席位，不應直接用 connecting 時可能短暫為 false 的 `resumable` getter。adapter 必須以世代和 signal 排除舊 socket，並在操控入口與 UI 都落實確認關卡。

## 手動續接

手動操作先取消舊 auto，再執行手動 resume；成功且 client 世代仍有效時呼叫 `restored()`，統一進入相同確認畫面。

`restored()` 不發出網路請求，允許 idle、failed、cancelled 進入 confirm；已 confirm 時冪等。waiting 或 connecting 時返回 false，避免共用 welcome handler 誤繞過當前自動嘗試。既有 episode 的 deadline 和 attempts 保留；若原本沒有 episode，只建立標記，不授予新的背景自動重試期限。

confirm 階段沒有待中止的 controller；單獨 `cancel()` 不會關閉已恢復的 transport。介面應提供確認／離房；若仍提供取消續接，adapter 必須明確 disconnect 並保留未確認的操控關卡。

## 伺服器憑證與錯誤

helper 不生成、保存、匯出或記錄私席 token／resumeKey。兩個模式各自管理 24 hex（12 random bytes）的每輪 resumeKey，以及伺服器記憶體中的有界 grant，綁定舊 token、新 token、同一 resumeKey 與原 grace 截止時間。

grant 用於處理已旋轉 token 但 welcome 遺失的情況：同輪重試可冪等取得同一新 token，同時禁止重複綁定兩條連線。確認恢復、有效 input 或 operate 後撤除 grant。這部分需各模式的真服務測試證明，helper 不實作也不聲稱已證明。

`SEAT_BUSY` 可重試，adapter 須保留 `code`，共用 helper 才能採取較長退避。`SEAT_EXPIRED`、`SEAT_REJECTED`、`VERSION_MISMATCH`、`ROOM_GONE` 為 terminal；adapter 轉為 `CityResumeError(message, 'fatal', code)`。普通連線失敗或 retryable error 在剩餘次數與原期限內重試。

## 本機驗證證據

執行 `node tools/dev-tests/frontier-city-reconnect-node.mjs`，最新結果為 **30 PASS／0 FAIL**：`tools/dev-tests/frontier-city-reconnect-node-result.json`。修訂後全專案 `tsc --noEmit` exit 0。

測試載入真實 helper；注入 clock 的案例覆蓋三次封頂、精確退避、4 秒與 15 秒逾時、typed error、背景節流、取消、確認前再斷、晚 Promise、世代／重入保護、時鐘倒退、狀態副本與資源清理。另有 2 案使用原生 clock、timer 與 AbortSignal；4 案專測手動 restored 的確認流程；2 案專測 SEAT_BUSY 等待舊席釋放及夾住原截止點。所有案例 dispose 並核對 fake timer 清空，外部請求 0，測試期間來源／腳本 hash 未變。

前一版 24 PASS 證據保留於 `frontier-city-reconnect-before-manual-result.json`，用於區分新增手動確認覆蓋，並非缺陷失敗對照。SEAT_BUSY 改善另有真 helper 修改前對照 `frontier-city-reconnect-busy-policy-before-result.json`，**28 PASS／2 FAIL**：舊等待分別為 500ms／1500ms，無法等到測試中 7 秒後釋放的舊席；修改後相同腳本 **30 PASS／0 FAIL**，第 3 試於原輪第 8 秒恢復，另一案證明晚回覆時不延長 15 秒、不在截止點補送。

真 WebSocket、雙模式 UI、token grant、整體建置、瀏覽器與固定三回歸，由對應模式及整合測試另外記錄。真手機背景節流與不同網路的實際恢復時間尚未驗證。

## 最終統一回歸

2026-11-21 本輪build **caeeecc35bef**已完成34套Node／服務、14套瀏覽器與固定三基準，詳見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。本段是最後封版狀態；上文各次build、待root與before FAIL保留開發當時事實，未改寫原始證據。PASS只涵蓋本機實作與驗證；真機／外網／完整真人駕駛限制依統一報告，沒有commit、push或部署。
