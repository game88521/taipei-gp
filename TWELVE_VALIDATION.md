# 十二項改善驗證

整合工作副本 build **d251460c360c**，產品 SHA256 **d57224f6c84344f619f4dea9db0ded883617ded86f33aadd6bb4ca1839d400d1**。所有gate通過後才產生本文件；不推定原專案已套用。

| 類別 | PASS |
|---|---:|
| newNode | 88 |
| beforeNode | 22 |
| browser | 29 |
| cityBrowser | 14 |
| originalSuites | 26 |
| legacySuites | 27 |
| legacyReportedCases | 305 |
| fixed | 3 |
| deliveryFixtures | 19 |

新Node88案；before22案的PASS表示舊缺口可重現，並非舊版已修好。新版browser 29案含城市實際14案。原26與legacy27是套數，legacy另回報305案；各組覆蓋可重疊，不加總成獨立功能數。完整逐案、唯一evidence路徑、來源／腳本／build雜湊見 [TWELVE_VALIDATION.json](./TWELVE_VALIDATION.json)。legacy及原26均讀本輪summary所指的唯一evidence，沒有拿保留的top-level歷史結果冒充本輪。

固定三回歸逐段驗證：BOT lap2 54.425 hits=0／aiHits0；陳冠宇162.0／aiHits8；進站陳冠宇175.7／aiHits5。car、track、pitlane及server physics與不可變before逐位元相同。rivals僅合法改錄製／回放，650.999秒真before/after對照的22車snapshot、停站與亂數呼叫一致，13,020框壓成6,510框且完整時長相同。

建置證據為npm完整指令、當下sw版本及前後端Vite成功結尾；現有build log沒有獨立exitCode欄位，JSON如實標示。城市wrapper獨立cleanup收據：未提供；只直接驗子腳本覆寫恢復，未假稱context已釋放。

- 僅本機隔離測試；未使用正式站、Render或Vercel，沒有commit、push或部署。工作副本通過不代表已套回原專案。
- 手機尺寸為桌面Chrome模擬，未測手機實機、真系統授權延遲、觸控駕駛、FPS、耗電或發熱。
- 多人以真loopback WS、權威物理與雙context驗證；重疊位置及完賽使用受控服務fixture，未測真人完整連賽或長時間四人外網對戰。
- 網路50／100／200ms、抖動與600ms短停來自受控到達排程。200ms組仍有360／540 frames缺乏插值快照，不能宣稱已消除高延遲頓挫。
- 近期戰績只保存在本瀏覽器，不是伺服器持久化或續賽。JSON匯出驗真Blob並攔截下載click，未驗作業系統下載資料夾。
- TT練習開新場次會清空本場圈表，試次不加入正式紀錄。長ghost／回放採樣有界壓縮會降低時間解析度；未量測記憶體或效能收益。
- 進站樣本是進出站耗時相對公開建議速度基準之差，不是未進站的反事實損失；未證明多圖多規則校準後整體更準。
- 導航先建真路線再以受控幾何／高度驗轉向，未驗全城市逐路口準確度；同級街賽是性能配置v1，未證明所有車款真人平衡。
- 城市browser只直接回報自身覆寫恢復；context釋放由外層wrapper負責。是否具有獨立cleanup收據見cityWrapper，不將子報告當成已釋放證據。
- 原26 runner的歷史schema未逐案記錄執行時script SHA；本彙整綁當前所有script bytes、真執行exit0及完整產品hash。legacy27另逐案核對執行時script SHA與唯一結果SHA。
- delivery19案使用隔離Git/npm替身；原專案真套用、建置、備份及完整dist核對須待獨立收據與verifier完成。所有早期失敗與歷史報告保留。
