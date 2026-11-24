# Harbor 私人房短斷線同步暫停

Rex <game88521@gmail.com>

## 行為與範圍

大廳房主可勾選「私人房短斷線保護」，預設關閉。第一版限定 2～4 位同版真人的一般單場圈數競速，沒有觀眾；開啟時阻擋 AI、系列、排位、耐久、接力、好友盃、限時及其他進階房規。關閉後沿用既有斷線煞車、其他玩家繼續的行為。

每席每場最多保護 2 次。比賽中原席掉線或用續接 token 直接取代 socket 時，全房物理與賽鐘立即凍結。該次 incident 只有固定 10 秒，重複續接、再次斷線或恢復倒數中再掉線均不延長；只有受影響原席須完成回線、同世代載圖並按「我已回來，確認繼續」。其餘玩家等候。全部受影響原席已確認或 DNF 後，同步倒數 3 秒恢復。

逾期、未確認或用完次數的席位以 `disconnect-expired` DNF。起跑倒數掉線仍回大廳；已完賽或 DNF 席位不啟動保護。房主離開、多人同時掉線及全員 DNF 有終止路徑。

## 實作

- `server/harbor-network-pause-service.mjs`：伺服器持有 incident deadline、次數、epoch 與時鐘補償。暫停時保留 `racing`，獨立狀態為 `idle / waiting / resuming`。逐次平移 `startAt / firstFinishAt` 並重設 `simAt`；不改 Car 姿態、速度、圈數或圈速。
- `shared/harbor-network-pause.ts`：版本 `harbor-network-pause-v1`、相容判斷、嚴格快照驗證與 HUD 停鐘。
- client 輸入帶 `harborEpoch`，伺服器拒絕暫停期間及舊 epoch 控制。scene 清除舊預測與插值歷史，避免停車後外推。
- UI 自行掛載於多人頁面；原席載圖未完成不能確認。一般房不要求所有玩家再次確認。
- Docker 需包含上述 server 檔及 shared 檔。health 可公開 `harbor.networkPauseVersion`。

## 已執行本機驗證

`node tools/dev-tests/harbor-multiplayer-node.mjs`

14 PASS / 0 FAIL。包括原案修前對照、預設關閉／舊 client、房主與大廳 revision、14 種進階變更拒絕、真正 2／3／4 人 loopback WS、真 Car 停動、圈數與圈速狀態不變、賽鐘與領先者期限、回放排除暫停、固定期限、未確認 DNF、兩次限制、退休 socket、直接續接、clock rollback、同時掉線、房主離開、全員 DNF、倒數掉線與 backpressure。

最終證據：`tools/dev-tests/harbor-multiplayer-node-evidence-1795485084517-673881/report.json`，已核對與 latest 結果的原始 SHA-256 相同。包含 source/script SHA-256、script 快照、零外部請求及 14／14 cleanup；最早 11 PASS / 1 FAIL 證據保留於 `harbor-multiplayer-node-evidence-1795428793371-f2e579`，已修正起停瞬間多補一個未模擬子步時間的問題。

`tsc --noEmit`、兩個 server 檔與 browser 腳本的 `node --check` 已通過。既有 `meridian-racing-node.mjs` 11／11 PASS；`multiplayer-server-regression.mjs` 14／14 PASS（證據 `multiplayer-server-evidence-1795484125258-eae0cfc6`，含真物理完整圈、斷線續接、完賽寬限、伺服器停頓）。產品未改四核心物理檔案、沒有 commit／push／部署或正式站測試。

## dist 瀏覽器驗證

`node tools/dev-tests/harbor-multiplayer-browser.mjs --seats=4`：4 PASS / 0 FAIL，build `f15b569a01d7`。使用本機 dist preview 4317、loopback WS 4320 與四個獨立 Chrome context；最終 immutable 證據為 `tools/dev-tests/harbor-multiplayer-browser-4-evidence-1795485953625/report.json`，已核對與 latest 結果的原始 SHA-256 相同。

1. 四個真頁面選取 `china` 並等待新圖就緒，再以原生點擊建房、加入及開啟保護，確認保護預設關閉、只有房主可設定。
2. 大廳設定在 390×844、844×390、844×220 下通過可見、可捲動、44px 觸控範圍與命中檢查。
3. 原生準備並同步起跑後，伺服器實際關閉一個 WS；確認真 Car 姿態、HUD 賽鐘及輸入凍結。原席自動續接、載圖完成，再原生按確認；觀察到確認後 3807ms 恢復，包含排程及觀察耗時，不將此數字視為 3 秒規則本身改變。
4. 恢復後控制帶正確 epoch `6`、保護次數保留，離房與伺服器清理通過。

結果包含零外部請求、零未捕捉例外、source/script hash 未變與完整 cleanup。第一輪 browser 的 0 PASS / 1 FAIL 仍保留於 `tools/dev-tests/harbor-multiplayer-browser-4-evidence-1795485507137/report.json`：harness 在選新賽道後未等新圖就緒，立即按合法停用中的建房按鈕。修正 harness 等待實際 `china` preview revision 0 與既有 enabled 條件；checkbox 使用精確命中 input 的原生指標操作，沒有放寬產品就緒規則或以 DOM click 繞過。

## 建置、固定基準與限制

完整本機 build 已通過，build `f15b569a01d7`，證據為 `tools/dev-tests/harbor-build-evidence-1795485090753/report.json`；建置期間來源未變。固定 `chain-stab` 三組基準 3 PASS / 0 FAIL，證據為 `tools/dev-tests/harbor-chain-stab-evidence-1795485666960/report.json`，來源、腳本及 build 均未漂移。

這些結果限於本機驗證，不代表實體手機、跨網路封包損失、公網容量、人工全程試駕、公開部署或後端重啟後比賽續存已通過；後端重啟仍依既有規則結束進行中的比賽。本輪未 commit、push、部署或使用正式站測試。
