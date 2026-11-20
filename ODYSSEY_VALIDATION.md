# Odyssey 本機封版驗證

署名：Rex <game88521@gmail.com>

本輪在 DCISI/taipei-gp-odyssey-work 完成本機封版，build **d376274301b9**，承接已套回但未提交的 Voyager bc5f6fdf669f。封版時尚未套回原專案，沒有 commit、push 或部署。這是封版時的紀錄；後續實際套回狀態以 DCISI 根目錄 TAIPEI_ODYSSEY_DELIVERY.md、本輪成功套用收據與獨立核對結果為準。

只在真實最新報告全部通過後產生。fresh-after=2026-11-20T03:03:18.518Z；產品 SHA256 5d00803192caa5d9fb601c5659c4c4a3eafa21ba93973310901167fb77ea9530。完整840檔before、來源／測試／dist snapshot、最新build收據及log、五phase與其新鮮子報告、核心／歷史保護、固定三回歸與當前交付工具24案均已核對。本輪不沿用pilot或舊phase，沒有fixture revision例外。

| 分組 | 通過範圍 |
|---|---|
| newnode | 5 套 |
| regression | 14 套 |
| browser | 5 套 |
| legacybrowser | 7 套 |
| fixed | 1 套 |
| 本輪Node | 61 案 |
| 新舊瀏覽器 | 84 案（含明示fixture） |
| 交付工具 | 24 案（隔離stub） |
| 快照工具自測 | 13 案（真reader／隔離filesystem） |
| 固定回歸 | 3／3：54.425 hits0／陳冠宇162.0 aiHits8／175.7 aiHits5 |

快照工具13案獨立驗證兩種exact UUID runtime scratch及非豁免來源保護，報告綁定目前build helper／generator／runner／自測script的完整bytes。這個工具自測可早於正式build，沒有替代或沿用任何phase；原pilot報告保留為歷史，正式phase仍全部受上述fresh-after與完整snapshot約束。獨立審查文件 TAIPEI_ODYSSEY_REVIEW.md 的原文及SHA另封存；它是唯讀code／既有evidence review，不是新增執行測試。

完整報告、phase／build／工具／審查文件與PNG等證據hash見 [ODYSSEY_VALIDATION.json](./ODYSSEY_VALIDATION.json)。分組有重疊覆蓋，不當作獨立玩法數。

- 真 Android／iPhone、實體手把、外網真人雙端與完整真人勤務尚未驗證。
- 標準手把樣本、位置、時鐘、網路狀況與回放 fixture 均明示；桌面尺寸模擬不能當成手機實機或真人延遲體驗。
- 本輪沒有實時間長壓、免費主機承載容量、FPS／耗電／發熱或記憶體洩漏量測，不能由本機測試推論。
- 免費測試服務部署、Origin、公開網址及現行線上版本未由封版器操作或驗證。
- 交付工具24案只測隔離stub流程，不能代替原專案真套用、建置、成功收據與獨立逐檔驗證。
- 本輪尚未套回原專案、commit、push或部署；來源驗證通過不等於已上線。

成功套回仍需本輪精確manifest、實際備份與離線build成功收據，以及獨立verifier逐檔核對；封版或預檢不能代替套用。
