# Beacon 本機驗證

作者：Rex <game88521@gmail.com>

封版 build `fae95fac6d0e`，本輪最終 **90 PASS／0 FAIL**：新 Node 22、既有 Node 40、新 browser 10、既有 browser 15、固定基準 3。完整建置成功；四核心 raw bytes 等於開始前基準。每份最終收據均重新核對來源／腳本 SHA256、immutable raw bytes及其清理欄位；before 對照、包裝器2案、診斷、交付工具案不重複計入產品案數。

| 套件 | 結果 | 證據 |
|---|---|---|
| beacon-modes-node | 11 PASS | [收據](tools/dev-tests/beacon-modes-node-result.json) |
| beacon-mobile-resources-node | 5 PASS | [收據](tools/dev-tests/beacon-mobile-resources-node-result.json) |
| beacon-multiplayer-node | 4 PASS | [收據](tools/dev-tests/beacon-multiplayer-node-result.json) |
| beacon-multiplayer-soak | 1 PASS | [收據](tools/dev-tests/beacon-multiplayer-soak-result.json) |
| beacon-multiplayer-long-soak | 1 PASS | [收據](tools/dev-tests/beacon-multiplayer-long-soak-result.json) |
| atlas-platform-models | 15 PASS | [收據](tools/dev-tests/atlas-platform-models-result.json) |
| meridian-racing-node | 11 PASS | [收據](tools/dev-tests/beacon-multiplayer-regressions-evidence-1795414836836-2b1fc5/meridian-racing-node-result.json) |
| multiplayer-server-regression | 14 PASS | [收據](tools/dev-tests/beacon-multiplayer-regressions-evidence-1795414836836-2b1fc5/multiplayer-server-summary.json) |
| beacon-modes-browser | 8 PASS | [收據](tools/dev-tests/beacon-modes-browser-result.json) |
| beacon-mobile-browser | 2 PASS | [收據](tools/dev-tests/beacon-mobile-browser-result.json) |
| meridian-racing-browser | 5 PASS | [收據](tools/dev-tests/meridian-racing-browser-result.json) |
| meridian-city-browser | 10 PASS | [收據](tools/dev-tests/meridian-city-browser-result.json) |
| beacon-chain-stab | 3 PASS | [收據](tools/dev-tests/beacon-chain-stab-result.json) |

固定原基準：BOT lap2 54.425 hits=0；GP冠軍陳冠宇162.0、aiHits8；進站陳冠宇175.7、aiHits5。沒有改期待值。

手機：真城市區塊三輪載卸，修前 WebGL geometries 81→82→83，修後80→80→80，textures均52；每輪骨架幾何與自有材質各釋放一次。這是資源生命週期證據；截圖未作地標視覺驗收。**實體手機30分鐘、幀率、溫度及耗電未驗證**，見 [實機計畫](BEACON_PHONE_TEST_PLAN.md)。

四人：真牆鐘600.200秒、四席兩當棒車、六次明示pit姿態交棒、兩次短續接、兩段背景停控。排程max12，GC後heap樣本區間約5.06MiB；結尾仍racing且無DNF，不算正常完賽。另有121秒四車測試及607.5秒加速權威完賽案。不是跨網路真人或免費主機容量驗收。

保留的本輪失敗共 5 份，原收據不改寫：

- [tools/dev-tests/beacon-mobile-browser-before-evidence-1795414580439/report.json](tools/dev-tests/beacon-mobile-browser-before-evidence-1795414580439/report.json)：{"PASS":0,"FAIL":0}。
- [tools/dev-tests/beacon-mobile-network-diagnostic-evidence-1795415338479/report.json](tools/dev-tests/beacon-mobile-network-diagnostic-evidence-1795415338479/report.json)：診斷／基建失敗。
- [tools/dev-tests/beacon-mobile-resources-node-evidence-1795414339177/report.json](tools/dev-tests/beacon-mobile-resources-node-evidence-1795414339177/report.json)：{"PASS":1,"FAIL":4}。
- [tools/dev-tests/beacon-multiplayer-node-evidence-1795414347678-dab160/report.json](tools/dev-tests/beacon-multiplayer-node-evidence-1795414347678-dab160/report.json)：{"PASS":2,"FAIL":2}。
- [tools/dev-tests/meridian-racing-browser-evidence-1795415845907/report.json](tools/dev-tests/meridian-racing-browser-evidence-1795415845907/report.json)：{"PASS":3,"FAIL":1}。

手機Node首輪1 PASS／4 FAIL為測試ESM mapping問題；多人首輪2 PASS／2 FAIL涉及錯欄位、停控斷言與測試終點fixture；手機before初輪timeout為0案且清理未完成，另立清理收據；network診斷已保存Worker完成事件跨target的證據。舊錦標賽browser首輪3 PASS／1 FAIL的原因及修正見 [回歸補充](BEACON_REGRESSION_NOTES.md)。以上均保留修前結果及修正後的新收據。

本輪未commit／push／部署，未測正式站；交付套回結果另見DCISI/TAIPEI_BEACON_DELIVERY.md。
