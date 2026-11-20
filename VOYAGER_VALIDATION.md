# Voyager 本機封版驗證

署名：Rex <game88521@gmail.com>

本輪在DCISI/taipei-gp-voyager-work完成本機封版，build **bc5f6fdf669f**，承接已套回但未提交的Atlas 205d0c8df91e。尚未套回原專案，沒有commit、push或部署。來源／測試通過不等於成功套用或上線。

證據沿用已明示：browser／legacy-browser共17套與Voyager Node沿用修補前原PASS報告，未重跑或改寫。產品與dist逐檔完全相同；完整測試inventory只允許platform-regression.mjs由已封存Atlas舊hash改為審查過的Response預先構造fixture，保留100ms總期限／15ms閒置期限與全部斷言。原25通過／1失敗及stderr保留FAIL；修補收據650eb54e59f703abf4ca44829183b4ad36c02f6617253b6120085692271a8c51後已重新執行build、固定三與資源／容量、完整legacy及24交付工具fixture。其餘entry／helper與測試hash均完全一致。

本文件只在所有真報告驗證通過後產生。fresh-after=2026-11-19T05:07:22.197Z；產品SHA256 0812ecd1ef31cb5cf7de29fe9c0001e2fa72062110d4470547c78c2b1048a0d6。固定803檔before、完整source／test／dist snapshot、五phase、葉報告與巢狀報告hash及freshness、build收據／log、核心／歷史文件保護及24交付工具fixture逐一核對。

| 分組 | 通過範圍 |
|---|---|
| voyager | 6 套 |
| legacy | 8 套 |
| browser | 5 套 |
| legacy-browser | 12 套 |
| fixed | 3 套 |
| 本輪Node | 74 案 |
| 新舊瀏覽器 | 128 案（含明示fixture） |
| 交付工具 | 24 案（隔離stub，非原專案套用） |
| 固定回歸 | 3／3，54.425 hits0／陳冠宇162.0 aiHits8／175.7 aiHits5 |

每筆完整report與artifact hash見[VOYAGER_VALIDATION.json](./VOYAGER_VALIDATION.json)；不同分組有重疊覆蓋，不當作獨立玩法數。資源byte／gzip是實際建置量，非真機速度或免費主機容量。

- 真Android／iPhone、真手把、外網真人雙端、完整真人勤務與主觀舒適度未驗證。
- 受控延遲、位置、時鐘、下載與DOM fixture不能當作外網或真機FPS／耗電證據；照片下載另有真Chrome完成事件與PNG像素驗證。
- 本輪容量probe僅各30模擬秒的四車／八車、另有GP兩車與合作兩車背景負載及自然清理；不是實時間長壓、目標免費主機容量、記憶體洩漏證明或Docker實跑。
- VSC為房主手動全場80km/h與三秒恢復，禁超車僅記錄，不自動加秒或判肇責；沒有實體安全車。
- 自由練習到時立即結算，沒有末圈寬限；練習名單可變，不產生固定名單正賽回放。
- NG2線上只支援閉合1／3／5圈與原600秒上限；工坊朋友幽靈為可編輯本機比較資料，無簽名或全球排行榜。
- 離線僅自由駕駛與單人工坊；瀏覽器可能回收快取，線上對戰仍需網路。
- 交付fixture僅驗隔離工具流程，不能代替原專案成功套用；尚未commit、push、部署。

本輪未commit／push／部署。後續成功套回須有本輪manifest、實際備份與build成功收據及獨立verifier；只有封版文件或預檢不算完成套用。
