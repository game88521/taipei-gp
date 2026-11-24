# Harbor 本機驗證

Rex <game88521@gmail.com>

最終 build `f15b569a01d7`：**122 PASS／0 FAIL**。數字由下列真實 raw cases 動態加總；五個 root wrapper 列與修前對照不重複計入。全量 build input map、各來源／runner hash、保留 raw bytes 與四個核心原始 bytes 均核對。證據根目錄：`C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\DCISI\taipei-gp-harbor-work\tools\dev-tests\harbor-validation-audit-evidence-1795486817130-e9e96543`。

| 測試 | 結果 | 收據 |
|---|---|---|
| resume-config | 5 PASS | [raw](tools/dev-tests/harbor-root-checks-evidence-1795484811450/resume-config-result.json) |
| server-status | 2 PASS | [raw](tools/dev-tests/harbor-root-checks-evidence-1795484811450/server-status-result.json) |
| backup | 3 PASS | [raw](tools/dev-tests/harbor-root-checks-evidence-1795484811450/backup-result.json) |
| legacy-backup | 4 PASS | [raw](tools/dev-tests/harbor-root-checks-evidence-1795484811450/legacy-backup-result.json) |
| legacy-checkpoints | 7 PASS | [raw](tools/dev-tests/harbor-root-checks-evidence-1795484811450/legacy-checkpoints-result.json) |
| harbor-accessibility-node | 12 PASS | [raw](tools/dev-tests/harbor-accessibility-node-result.json) |
| harbor-mobile-node | 7 PASS | [raw](tools/dev-tests/harbor-mobile-node-result.json) |
| harbor-quick-room-node | 10 PASS | [raw](tools/dev-tests/harbor-quick-room-node-result.json) |
| harbor-preset-handshake-node | 7 PASS | [raw](tools/dev-tests/harbor-preset-handshake-node-result.json) |
| harbor-multiplayer-node | 14 PASS | [raw](tools/dev-tests/harbor-multiplayer-node-result.json) |
| harbor-reading-browser | 6 PASS | [raw](tools/dev-tests/harbor-reading-browser-result.json) |
| harbor-quick-room-browser | 7 PASS | [raw](tools/dev-tests/harbor-quick-room-browser-result.json) |
| harbor-multiplayer-browser-4 | 4 PASS | [raw](tools/dev-tests/harbor-multiplayer-browser-4-result.json) |
| harbor-chain-stab | 3 PASS | [raw](tools/dev-tests/harbor-chain-stab-result.json) |
| meridian-racing-node | 11 PASS | [raw](tools/dev-tests/meridian-racing-node-result.json) |
| multiplayer-server | 14 PASS | [raw](tools/dev-tests/multiplayer-server-summary.json) |
| tenpack-multiplayer-client | 6 PASS | [raw](tools/dev-tests/tenpack-multiplayer-client-result.json) |

固定三基準保持原值：BOT lap2 54.425 hits=0；GP 陳冠宇 162.0、aiHits 8；進站陳冠宇 175.7、aiHits 5。chain 嚴格使用最終 build，且執行時間在建置完成之後。

修前對照使用原 build `fae95fac6d0e`；其舊來源與腳本 hash 依原收據保存，不要求等於修改後版本，也不計入上列總數。舊 racing 的 raw 只在本次封版保留，不冒稱測試時已有不可變 wrapper；細節及限制列於 JSON。

## 修正與原始失敗

- 真瀏覽器揭露 socket open 早於能力 pong；產品新增當前 socket 的有效 pong 握手，7 秒單次上限並沿用 45 秒外層取消／連線重試，建房不自動重送。
- public AI 位於 summit.ai；原測試誤用不存在的頂層 ai。保留原 FAIL 與真 RoomService 重現，後續分別嚴查真人未準備／AI 已準備。
- 切換特殊玩法保留 AI／雨天／車損草稿是產品預期；後續獨立玩法案例只在存在真衝突時明確原生按重設，無衝突不按隱藏按鈕；草稿保留與阻擋仍有獨立完整斷言。
- Chrome 的 touch-action: manipulation 語意包含 pan-x pan-y pinch-zoom；閱讀測試修正等價判斷，未放寬實際縮放要求。
- pagehide 的 writer guard 會結束該頁的偏好寫入生命週期；對照測試改用原生 reload 驗證真正離頁與重新初始化，原始 FAIL 保留，未把合成 pagehide 後繼續使用同頁當成產品行為。
- 斷線 browser 在原生切圖後等待所選地圖 ready，並記錄 ready/disabled，再原生按建房；保留原先在載圖時按 disabled 按鈕的 FAIL。
- 舊 VM loader 未綁新 named imports，六案在編譯前失敗；改從真模組取得具名 exports，原六個 assertion script 未變，修前／修後腳本與 raw 都保留。
- quick-room Node 第一次缺 experimental-transform-types 而未執行任何案例；原啟動 FAIL 保留，不算為通過。

保留本輪原始 FAIL 路徑與 SHA256，未刪除、改寫或轉算為 PASS：

- [tools/dev-tests/harbor-legacy-harness-evidence-1795485211186/before-tenpack-multiplayer-client-result.json](tools/dev-tests/harbor-legacy-harness-evidence-1795485211186/before-tenpack-multiplayer-client-result.json)：{"passed":0,"failed":6}；SHA256 `14bc8887f03de13c927502ae407a3063fae212d8cf486b9eb9b64db20781fe14`。
- [tools/dev-tests/harbor-multiplayer-browser-4-evidence-1795485507137/report.json](tools/dev-tests/harbor-multiplayer-browser-4-evidence-1795485507137/report.json)：{"PASS":0,"FAIL":1}；SHA256 `d0e345cd7fafae0927544826126bb8f8cbef5bbd8da7c9c8ff2014e4a73a4e9a`。
- [tools/dev-tests/harbor-multiplayer-node-evidence-1795428793371-f2e579/report.json](tools/dev-tests/harbor-multiplayer-node-evidence-1795428793371-f2e579/report.json)：{"PASS":11,"FAIL":1}；SHA256 `fa15cd2283da5fd17560d971ad4b7816cd20cd5a9b1b4a47ffddabce8022441b`。
- [tools/dev-tests/harbor-quick-room-browser-evidence-1795484273294/report.json](tools/dev-tests/harbor-quick-room-browser-evidence-1795484273294/report.json)：{"PASS":2,"FAIL":1}；SHA256 `79ecb522b03c7d0e0385b178b106eeb7f8d95158385f6e119ca1af99301c4398`。
- [tools/dev-tests/harbor-quick-room-browser-evidence-1795485205034/report.json](tools/dev-tests/harbor-quick-room-browser-evidence-1795485205034/report.json)：{"PASS":2,"FAIL":1}；SHA256 `56176394df484b3e91450e47028d97ab74e11c1f058d15408c24c8176e72a220`。
- [tools/dev-tests/harbor-quick-room-browser-evidence-1795485820994/report.json](tools/dev-tests/harbor-quick-room-browser-evidence-1795485820994/report.json)：{"PASS":3,"FAIL":1}；SHA256 `8c6006867aeea26a9ff60f8da61a5e604908c2331fd6c33d7e1b18d3fe302986`。
- [tools/dev-tests/harbor-quick-room-browser-evidence-1795486227844/report.json](tools/dev-tests/harbor-quick-room-browser-evidence-1795486227844/report.json)：{"PASS":4,"FAIL":1}；SHA256 `7b494396deec55cab71426bdd3a65f0b2204de9e297615ce6468f18634d3246a`。
- [tools/dev-tests/harbor-quick-room-node-startup-failure-1795500000000.json](tools/dev-tests/harbor-quick-room-node-startup-failure-1795500000000.json)：啟動／工具失敗；SHA256 `3afaa8c694544a1dc4fa1fde7f3c765cda81a1b6fe50d2e8ac06bae6c174de85`。
- [tools/dev-tests/harbor-quick-room-ready-oracle-evidence-1795485417326/before-browser-result.json](tools/dev-tests/harbor-quick-room-ready-oracle-evidence-1795485417326/before-browser-result.json)：{"PASS":2,"FAIL":1}；SHA256 `56176394df484b3e91450e47028d97ab74e11c1f058d15408c24c8176e72a220`。
- [tools/dev-tests/harbor-reading-browser-evidence-1795485387026/report.json](tools/dev-tests/harbor-reading-browser-evidence-1795485387026/report.json)：{"PASS":0,"FAIL":1}；SHA256 `22968b82d9417aabd157d9d732f913133521c1e9e923b62fdf4ed994742b8be1`。
- [tools/dev-tests/harbor-reading-browser-evidence-1795485867652/report.json](tools/dev-tests/harbor-reading-browser-evidence-1795485867652/report.json)：{"PASS":4,"FAIL":1}；SHA256 `30ecdc04730e0020b1bbce75c97a9f3ab8e85afc9aa1bbc540f46e43b15ef749`。

## 尚未驗證

- Render 兩種固定金鑰（MERIDIAN_CHECKPOINT_SECRET、SERIES_RESUME_SECRET）的實際設定／生效尚未確認；既有有效值保留。沒有管理連線，也未收到本輪設定確認。站間續局設定檢查與狀態揭露已本機驗證，未宣稱公開持久續局已可用。
- iPhone 17、實體 Safari 與 VoiceOver 沒驗證。本機桌面 Chrome 尺寸、鍵盤與生命週期模擬不能代替實機；操作流程見 HARBOR_PHONE_TEST_PLAN.md。
- 沒有跨網路延遲／丟包、Render 免費服務容量或長時間負載驗證。暫停測試含真 loopback WebSocket 與真 Car，時間／完賽邊界 fixture 均由個案明示。
- 快速開房測試以真權威確認四玩法與 24 圖原子建房；不代表每種玩法完整實際完賽。讓秒追逐建房預設全員 0 秒，須入房後另設。
- meridian-racing-node 的原始收據沒有 sourceHashes／scriptSha256 或獨立 evidence wrapper；本輪時間戳、原始 PASS 與 protectedSourcesUnchanged 均核對，封版才建立 raw snapshot，未冒稱測試當時有完整來源快照。最終來源另外由全量 build source map 核對。
- tenpack-multiplayer-client 原始報告不含起訖時間；使用本輪 timestamped harness 目錄、完整 raw bytes、原 assertion script 與修正 loader hash 核對。
- 本輪沒有 commit、push、部署或正式站測試。此為套回前封版；原案套回結果依 DCISI/TAIPEI_HARBOR_DELIVERY.md 獨立收據。時間戳原始證據不入套用包，請依 evidenceArchiveRoot 的副本絕對總根讀取。

原始證據絕對總根：`C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\DCISI\taipei-gp-harbor-work\tools\dev-tests`。本次封版 audit 子目錄：`C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\DCISI\taipei-gp-harbor-work\tools\dev-tests\harbor-validation-audit-evidence-1795486817130-e9e96543`。各 suite 原始報告分布於總根內的時間戳資料夾；時間戳證據不入原案套用包，請依總根與 JSON 的 absolutePath 讀取。此為套回前封版；原案套回結果依 DCISI/TAIPEI_HARBOR_DELIVERY.md 獨立收據。
