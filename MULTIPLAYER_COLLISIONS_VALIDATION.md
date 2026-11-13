# 多人碰撞本機驗證

本輪 build **8b61f77003ce**，來源 baseline **f586ca96bfe73b0d7e6d38a749b14b4386f6f5bb**，physics **classic-multitrack-collisions-v3**。所有下列檢查通過；精確來源及報告雜湊見 [JSON](./MULTIPLAYER_COLLISIONS_VALIDATION.json)。單人核心五檔與本輪不可變before逐位元一致。尚未 commit／push 或部署碰撞版。

| 檢查 | 結果 |
|---|---|
| collisionPhysics | 14／14 PASS |
| collisionServer | 9／9 PASS |
| collisionClient | 16／16 PASS |
| collisionBrowser | 5／5 PASS |
| server | 14／14 PASS |
| mapsServer | 9／9 PASS |
| client | 26／26 PASS |
| mapLifecycle | 8／8 PASS |
| geometry | 26／26 PASS |
| resources | 4／4 PASS |
| mapsBrowser | 6／6 PASS |
| singlePlayer | 26／26 PASS |
| fixed | 3／3 PASS |
| 交付工具隔離fixture | 6／6 PASS |

固定回歸完全一致：BOT lap2 54.425 hits=0／aiHits 0；陳冠宇 162.0／aiHits 8；進站陳冠宇 175.7／aiHits 5。

## 修正對照

伺服器真WS追撞對照：舊版後車穿過前車（縱距 −1.240m），新版碰撞後縱距 5.522m，後車降速、前車受推。初版前端雖通過 accept 與 frame(0)檢查，持續frame仍在20ms時出現模型距4.7819m，車長5.2m；本輪已加入非零dt及恢復期後的連續驗證，並讓附近車輛以同一預測時點處理接觸。測試保留舊行為與失敗證據，不改既有基準。

## 範圍與限制

- 碰撞瀏覽器使用同機兩個Chrome隔離context；非兩台裝置或外網WSS。
- 持續frame案例用真frame非零dt與20Hz快照、60Hz模擬時序，動畫排程為穩定擷取而暫停，不代表真60FPS量測。
- 橋上橋下及傾斜碰撞為合成幾何；沒有全24圖逐圖碰撞或完整真人比賽。
- 手機實機、外網延遲與長時間四人效能尚未驗證。

歷史 maps 及 v1 驗證保留，本輪沒有把舊上線結果當成碰撞版外網驗證。原專案套用狀態以 DCISI/taipei-gp-collision-apply-result.json 及逐檔現況為準；本文件是封裝時的本機驗證快照。
