# 後續優化驗證（2026-11-11）

基準提交：`2dee076de30da52fe20b4d33faf659e6acf0aed3`。範圍為分析清單1～5、17；功能說明見 [FOLLOWUP_FIXES.md](./FOLLOWUP_FIXES.md)。

本文件記錄工作副本的完成結果。原專案實際套用／建置狀態以 DCISI 的 `taipei-gp-followup-apply-result.json` 為準；這輪未授權提交或推送。封裝不代表上版。

## 驗證結果

- `npm.cmd run build`：通過，SW `3bdf97336c02`。保留既有大bundle及原生設定`__dirname`警告。
- 自動驗證：16／16套通過；測試期間產品原碼沒有改動。
- 固定回歸：3／3通過，BOT **54.425 hits=0、aiHits 0**；GP陳冠宇 **162.0、aiHits 8**；進站陳冠宇 **175.7、aiHits 5**，未修改基準。
- GP專項：13個案例各跑before／after，無效40秒對照有效60秒與AI50秒時，錯領26分改為25分。普通圈、最後圈、續賽、正常有效圈與既有發獎規則均涵蓋。
- 存檔專項：23個案例通過。包含損毀／缺主檔／權限錯誤、原始副本、容量錯誤、匯入及重載前鎖定、跨分頁變更與總容量壓力。
- 無線電：9／9通過，成功入列才冷卻，重要消息可取代一般待播消息，去重、解除舊提醒與防止飢餓。
- 幀率／罰款：10／10通過；真main動畫回呼AST涵蓋24組呼叫軌跡，物理／天氣／無線電／統計不受繪圖上限影響。錢包50、應罰200時，餘額0、帳本-50，文案顯示實扣50；獎金流程不變。
- 本機瀏覽器：7／7通過、未捕獲例外、外部請求0。救援取消／快照／新進度／自行備份有實際重載；390×844與844×390無橫向溢出，救援按鈕48px，橫向可捲。WebGL建立失敗可重試／低畫質重試並保留賽道參數。人工120Hz回呼下30／60／不限分別呼叫render **30／60／120**次；設定即時生效、重載保留，原FPS勾選仍是boolean。
- 交付工具：既有10項及新增6組安全回歸通過；只用隔離fixture，未以原專案驗證寫入。

## 證據與重跑

詳細摘要、版本、SHA256與限制收錄於 [FOLLOWUP_VALIDATION.json](./FOLLOWUP_VALIDATION.json)。原始測試結果保留在DCISI工作副本的`tools/dev-tests/`，不是發布資產。不要把第一次尚未修正測試準備時序的失敗報告或舊priority摘要當成最終結果。

產品摘要SHA256：`9c7b4916fde33400065ef8f61cb932f3ba044340fbbd99c19c3bc142a34f0d68`；`src/main.ts`：`a01d7b6eee32cc6be6e2c6b56fa6f2ed133f01db21433f676e4958229386cf45`。

從原專案或工作副本執行時，先設定兩份不可變對照資料夾；兩者不能指向目前受測原碼：

```powershell
$env:GP_BASELINE_DIR='C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\DCISI\taipei-gp-priority-before-20261111'
$env:GP_FOLLOWUP_BASELINE_DIR='C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\DCISI\taipei-gp-followup-before-2dee076'
npm.cmd run build
node tools/dev-tests/followup-checks.mjs
$env:GP_CDP_PORT='9333'
& 'C:\Program Files\Git\bin\bash.exe' tools/dev-tests/chain-stab.sh
node tools/dev-tests/external-browser.mjs 9333 followup-ui-browser.mjs
```

瀏覽器測試固定連本機4317。原專案重跑前，必須確認4317預覽的dist就是當前受測建置；目前4317服務的是DCISI工作副本。`external-browser.mjs`建立隔離context，不使用玩家原有存檔、不關閉外部Chrome。Chrome軟體繪圖不能當手機效能量測。

## 限制

手機實機FPS／耗電／溫度／觸控與聲音仍未驗證；渲染次數減少不能直接換算省電比例。快照受瀏覽器容量限制，主檔優先，不保證永遠存在；重要進度仍可自行匯出。舊存檔既有無效最快圈與已發出的賽季積分不追溯修改。這輪未使用正式站或排行榜測試，也沒有新增玩法。
