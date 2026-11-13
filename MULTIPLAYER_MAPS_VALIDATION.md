# 多人全部地圖 v2 驗證（2026-11-13）

本輪來源 build **65dd59ab8882**，產品 SHA256 **841581350e52fadea6ed41e06a0d3a76ff4f97967069a44e5839f68b9c1dde41**。完整逐檔來源雜湊、報告雜湊及證據位置見 [MULTIPLAYER_MAPS_VALIDATION.json](./MULTIPLAYER_MAPS_VALIDATION.json)。基準為乾淨的 `f41315a`，來源及測試在 `DCISI/taipei-gp-maps-work`；本文件不代表原專案已套用或公開上線。

| 實測範圍 | 結果 | 證明範圍 |
| --- | --- | --- |
| TypeScript／Vite／catalog／physics | build 65dd59ab8882 | npm run build 成功；24圖目錄可重建 |
| 既有權威 WS | 14／14 PASS | 原14組斷言、真物理完整圈、重連／DNF／期限 |
| 選圖權威 WS | 9／9 PASS | 24圖建房、四人載入、舊操作拒絕、兩房獨立、重連／再戰 |
| client | 26／26 PASS | 25隔離案例＋1真WS案例，舊v1憑證不採用 |
| 控制器生命周期 | 8／8 PASS | 載圖、失敗重試、過期Promise與跨房／續接世代 |
| 幾何對照 | 26／26 PASS | 24圖全部typedarray與原main配方bytes相同，48個獨立房間 |
| 資源取消／清理 | 4／4 PASS | Worker、fallback取消、GPU資源去重dispose |
| 雙瀏覽器 | 6／6 PASS | 同機兩個隔離context、24選項、七次代表圖切換、快速連換、同步起跑 |
| 原單人回歸 | 26／26 PASS | 來源穩定、歷史摘要及個別結果保留 |
| 原固定回歸 | 3／3 PASS | BOT54.425／aiHits0、GP162.0／aiHits8、進站175.7／aiHits5 |

瀏覽器實測荷蘭、日本、新加坡夜景、阿布達比黃昏／沙漠、馬來西亞熱帶、中國、台北，另有澳洲→比利時快速換圖與雙人起跑。重回荷蘭後幾何／貼圖為 83／24，初次為 83／24；沒有累積舊場景資源。三種入口／大廳尺寸 `390×844`、`844×390`、`844×220` 控制可達，截圖已親看。例外及外部請求為零，兩個context均已釋放，隔離玩家localStorage完全不變。測試只把本機預設4320端點轉到本次專用4321，未連線上服務。

單人 `main.ts`、`car.ts`、`track.ts`、`rivals.ts`、`pitlane.ts` bytes與不可變before完全相同。全部GP metadata與原23條相同；幾何比對從原main抽配方、原track獨立bundle，不使用新版recipe充當預期值。多人仍用classic性能。

舊測試首次有2支data module loader未支援抽出的metadata，僅適配測試模組載入器，原斷言未改。另一輪平台毫秒級案例在並行瀏覽器初始化時回timeout而非預期idle；保留失敗後單獨按原timeout重跑，全26套通過。資源競爭是推論，不宣稱已確認唯一根因。首輪瀏覽器runner未等入口換圖完成就點禁用建房，修正測試等待後通過；各輪失敗證據保留，未補算PASS。

Rex回報既有v1曾成功與朋友連線；這是使用者回報，不是Codex本輪外網實測。v2尚未部署／外網驗證，v1/v2不相容，需配套更新前後端。Docker、兩台實機、手機觸控／FPS／耗電、聲音聽感與公開WSS延遲尚未驗證。代表場景的短時起跑不表示24圖逐一完整跑完比賽。

原專案套用以 `DCISI/taipei-gp-maps-apply-result.json` 與新manifest逐檔核對；本輪未自行commit／push，也未使用正式遊戲站測試。重跑方式見 [測試計畫](./tools/dev-tests/MULTIPLAYER_TEST_PLAN.md)。
