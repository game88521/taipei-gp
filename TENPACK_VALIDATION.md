# 十項改善驗證

最終本機 build **102e84eea8ea**，產品 SHA256 **e70175bfe6446355c76ed12676bfe18426ea7ba164b250871fe5e82915d46f8d**。本文件與 JSON 證明工作副本的驗證，不推定原專案套用成功。

| 類別 | PASS |
|---|---:|
| newNode | 100 |
| browser | 29 |
| beforeBrowser | 3 |
| originalSuites | 26 |
| legacyNode | 205 |
| fixed | 3 |
| deliveryFixtures | 19 |

新增 Node 100 案包含 2 案修前重現；before 瀏覽器 3 案為舊行為的預期對照，不是舊版修好。29 項新版瀏覽器檢查包含來源／腳本穩定性。原26指套數，不能與逐案數字混為總數。完整結果、來源hash、腳本身分與唯一證據路徑見 [TENPACK_VALIDATION.json](./TENPACK_VALIDATION.json)。

固定回歸：BOT lap2 54.425 hits=0／aiHits0；陳冠宇162.0／aiHits8；進站陳冠宇175.7／aiHits5。Car、track、rivals、pitlane與server physics逐檔等於c220不可變before。

- 只用本機測試；未測正式站／Render／Vercel，沒有commit、push或部署。
- 手機尺寸為桌面Chrome模擬；未驗證手機實機、FPS、耗電、發熱、真瀏覽器權限延遲。
- 多人系列完賽/DNF由隔離服務端fixture安排；真WS與雙context驗生命週期，不等於真人完整三站或長時四人駕駛。
- GP分析僅本場觀察資料，續賽／跳圈／環境採樣缺口明示未知；TT速度與煞車trace只存當次session，舊PB不補造。
- 警察逮捕與觀光停靠使用真城市系統配合合法位置／已攔停fixture，不等於完整實際追捕、城市路線或難度平衡。
- 多人browser在d32ab8410821執行；其12個產品來源雜湊仍逐檔吻合最終版，之後只改單人HUD與tour取消保護。
- 早期失敗紀錄保留：舊AST缺依賴、初次browser期間main變更、HUD蓋時速表及tour延遲取消；後兩項已修並重測。

舊AST harness只補新依賴／真career observer與DOM接口，原斷言保持；歷史固定baseline套用工具不強跑。套用工具19案是隔離Git/npm替身，原專案真build與完整dist／備份／Git核對須由獨立verifier確認。
