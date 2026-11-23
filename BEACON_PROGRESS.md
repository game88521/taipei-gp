# Beacon：玩法入口、手機資源與四人長場

作者：Rex <game88521@gmail.com>

本輪處理使用者選定1、3、4。承接未提交Meridian build `862f7f9c9857`，原案HEAD/main `c56ca26e04bb1f39c144a93454ae1bc8d09d6737`；開始前1529檔raw bytes一致，沒有用Git HEAD覆蓋未提交成果。封版build `fae95fac6d0e`。

| 項目 | 成果 | 狀態 |
|---|---|---|
| 1 玩法入口整合 | 27→38；搜尋、收藏、最近開啟、人數篩選及可用時間建議；首次lazy深層入口與取消保護 | 本機已驗證 |
| 3 手機長時間調校 | 修城市地標LineSegments幾何／自有材質卸載漏釋放，保留共享資源 | Node與browser前後對照已通過；實體手機未驗 |
| 4 四人長場穩定 | 修原席重連後換棒序號；真WS600秒、短四車、加速完賽、40次換圖及停控／背壓 | 本機已驗證；外網真人長場未驗 |

最終90 PASS／0 FAIL、完整build與固定三基準通過。詳細證據及限制見[驗證](BEACON_VALIDATION.md)、[入口](BEACON_MODES.md)、[手機](BEACON_MOBILE.md)、[多人](BEACON_MULTIPLAYER.md)。未commit、push或部署。套回原專案由外層交付工具先備份及逐檔核對，最終狀態見DCISI/TAIPEI_BEACON_DELIVERY.md。
