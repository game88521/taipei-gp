# Lantern 十二項驗證

Rex <game88521@gmail.com>

本機 build **a16fb2c38497**，**16套／16套通過**。產品來源在所有驗證期間未變，四個模擬核心原始bytes與基準e630d71e6abc17115c759fb38fb468c81949c853相同。本輪沒有commit、push、部署或正式站試玩；原專案套回狀態另以DCISI/taipei-gp-lantern-delivery/result.json為準，不能由副本驗證推定套回成功。

| 檢查 | 結果 | 有獨立案例計數時：PASS／FAIL |
| --- | --- | --- |
| build | PASS | 見原始輸出 |
| lantern-ui | PASS | 見原始輸出 |
| lantern-performance-node | PASS | 10／0 |
| lantern-api-node | PASS | 13／0 |
| lantern-api-deadline-node | PASS | 7／0 |
| lantern-ctf-node | PASS | 6／0 |
| lantern-story-node | PASS | 8／0 |
| beacon-modes-node | PASS | 見原始輸出 |
| leaderboard-regression | PASS | 12／0 |
| lantern-ui-browser | PASS | 4／0 |
| lantern-performance-browser | PASS | 3／0 |
| lantern-modes-browser | PASS | 5／0 |
| lantern-online-browser | PASS | 6／0 |
| harbor-reading-browser | PASS | 6／0 |
| harbor-quick-room-browser | PASS | 7／0 |
| chain-stab | PASS | 見原始輸出 |

固定三基準：BOT lap2 54.425 hits=0、aiHits 0；GP冠軍陳冠宇162.0、aiHits 8；維修測試陳冠宇175.7、aiHits 5。原始輸出完整保留在`tools/dev-tests/lantern-validation-1795661679942/chain-stab-out.txt`。

## 證據與重現

來源與suite摘要見[LANTERN_VALIDATION.json](./LANTERN_VALIDATION.json)。時間戳原始證據總根為`C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\DCISI\taipei-gp-lantern-work`，最新集中目錄`tools/dev-tests/lantern-validation-1795661679942`；成功沿用前次封版收據的suite保留carriedFrom。不可變stdout／stderr hash在JSON中，早先失敗原檔保留，不以成功結果覆蓋。原始證據不放進原案或Git；相對證據路徑以副本為根。

使用Node24及已安裝依賴，先本機preview4317、獨立正常圖形Chrome CDP9336，再執行`node tools/dev-tests/run-lantern-validation.mjs`。runner序列執行，不可共用同一CDP並行跑browser。`--resume`僅允許來源及dist build完全相同、從第一個失敗suite重跑，不跳過失敗；產品改變必須fresh驗證。原始SwiftShader環境的長延遲與各測試lazy入口／存檔正規化同步失敗均保留，不當成產品PASS。

## 實際範圍

- 24圖預覽由真實路線產生；排行榜manifest獨立取真正GP幾何。既有台北榜、經典／2026與各圖版本隔離。
- 城市半成品取消確實dispose，重新載入碰撞恢復，兩輪卸載geometry81→81、textures52→52；這不是手機FPS或GPU耗時保證。
- API使用真HTTP handler與有狀態Redis REST stand-in，測CAS、並行、版本、重送、截止與總deadline；stand-in不是Redis Lua引擎。
- CTF真loopback四席WS與真FreeCar操控；取還旗、碰撞、終局與部分劇情到站明示fixture。NG4節點另以直路fixture駕駛完成不同結局，不能稱真人完整城市賽事。
- online browser串接本機真API，私碼留瀏覽器且relay回應遮蔽；不讀印正式憑證。

## 仍需環境與實機驗收

- 雲端API經本機HTTP relay及有狀態Redis REST stand-in驗證，沒有真Redis Lua、Vercel函式或公開服務測試。
- iPhone 17／Safari／VoiceOver、外網真人四人、免費服務容量、長時間GPU／耗電／溫度未驗證。
- 排行榜與每週盃使用軌跡合理性驗證，不是權威防作弊；部分到站／終局使用報告明示fixture。
- 雲端備份上限3MB；較大回放與鬼車請用既有40MB本機整包匯出。
- NG4本輪為單人離線；CTF回放尚無完整旗幟動畫歷史。
- 第8／9／12項需要Vercel持久Redis REST設定；本機程序未設定不代表遠端未設定。沿用既有有效設定，不新增服務或購買。CTF需新版Render與前端同步部署；本輪沒有發布授權。

詳見[LANTERN_ONLINE.md](./LANTERN_ONLINE.md)、[LANTERN_PHONE_TEST_PLAN.md](./LANTERN_PHONE_TEST_PLAN.md)。

## 手機榜單修前／修後對照

修前build0043b597f2b4的同一瀏覽器布局測試量到暱稱33px、選圖19px、提交43px，低於44px；原FAIL收據保留。修後builda16fb2c38497重新執行完整16套，390px及844px橫向所有可見控制項均至少44px、可點擊且無裁切或橫向溢出。390px實測：lb-name 248×44、lb-track 276×44、lb-board 276×44、lb-submit 312×44、lb-close 312×58。這是Chrome尺寸模擬，非Safari實機。
