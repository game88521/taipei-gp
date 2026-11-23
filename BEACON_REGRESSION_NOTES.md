# Beacon 既有多人賽事回歸紀錄

署名：Rex <game88521@gmail.com>

本輪檢查對象為本機 `dist`，build `fae95fac6d0e`；未測試正式站、未 commit、push 或部署。

## 保留的首次失敗

- `meridian-racing-browser`：**3 PASS／1 FAIL**。第四案在耐久接力結算後，點擊 `mp-meridian-result-close` 時回報 `button unavailable`。
- 原始不可變收據：`tools/dev-tests/meridian-racing-browser-evidence-1795415845907/report.json`；raw SHA256 為 `548ec2fdd3bf2516c4bcfbafd3165b1f7e0559a4ab87cff831aa54593951a57c`。
- 原收據的 `sourceUnchangedDuringTests`、`scriptUnchangedDuringTests`、`cleanupComplete` 都為 true；外部請求與觀測到的頁面例外均為 0。測試操作本身的 CDP evaluate 錯誤仍保留在 FAIL 與 fatal 中。
- 原失敗腳本 SHA256 為 `56a97014dfb222801f65c21dfba006c07f075a073c8be01d36a2e05e2ccbbd21`；從 Meridian 對照副本逐 byte 核對後，另存文字與原始 bytes base64 於 `tools/dev-tests/meridian-racing-browser-diagnosis-1795415845907/script-source.json`。未改寫原 FAIL 收據。

## 已確認的邊界與測試補強

原測試只等待四個客戶端的 `room.phase === 'results'`，隨即點擊按鈕。按鈕操作 helper 會在 `hidden` 或 `disabled` 時直接失敗，並保留原生點擊命中檢查。

Beacon 與 Meridian 對照副本的結束按鈕條件完全相同：`hidden = !host`、`disabled = !connected || busy`。本次診斷未修改產品程式。原 FAIL 未記錄房主 ID、自己的 ID 或按鈕屬性，無法只靠該收據確定是等待不足、連線切換或房主狀態變化。

僅在舊回歸腳本補上最長 15 秒的真實 UI 就緒等待，要求連線正常、目前使用者確為房主、房間已結算、結果區與按鈕顯示、按鈕啟用且具有佈局範圍。後續仍使用原生滑鼠操作與命中測試，不放寬產品條件、不直接呼叫產品 handler。等待前後的時間、身分、phase 與 DOM 屬性都寫入 `resultControlReadiness`；失敗時另補相同診斷。

## 最終重跑

序列重跑 **5 PASS／0 FAIL**，exit 0，build `fae95fac6d0e`。

- 最終收據：`tools/dev-tests/meridian-racing-browser-evidence-1795416422595/report.json`。
- raw SHA256：`bb864085a43fc59b93993dcf1b8c888c3c8c58fe86878c0068574530158f49ef`；與 latest 原始 bytes 相同。
- 最終腳本 SHA256：`6cf5a3f9d0d95e14e32aced67e7431b9c7f104a0a6df16310b5a4ff05e74c806`。
- `cleanupComplete`、`sourceUnchangedDuringTests`、`scriptUnchangedDuringTests` 皆為 true；頁面例外與外部請求皆為 0。重新核對產品來源與測試腳本 hash，符合現況。
- 三次結果操作（結束耐久、排位下一階段、衝刺下一階段）都保留等待前／後狀態與時間；本次的三個 `before.ready` 已經全為 true，沒有觀測到從未就緒變成就緒的過程。
- 因此只能確認本次完整路徑通過，以及原測試已增加有界前置條件與診斷；**無法據此斷言首次失敗的根因是缺少等待，也未宣稱修復了產品問題**。原 FAIL 與對應腳本快照均保留，後續若再發生可直接比對房主、連線與 DOM 狀態。
- 本次不可變 evidence 另含 `script-source.json`，是原 FAIL 腳本的 bytes 快照；不取代收據中記錄的本次腳本 hash。

此回歸使用桌面 Chrome 的四個隔離 context，以及明示的完賽／維修區姿態 fixture；沒有驗證實體手機、跨網路連線或人工完整耐久完賽。
