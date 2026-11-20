# Evolution驗證

整合工作副本build **b1f70bac2788**，產品SHA256 **af53cc66c6191b3041c56649f424f6990ea01c4e2f9b7cb7eb525482e226cd11**。全部gate通過後才生成本文件；未推定原專案已套用。

| 類別 | PASS |
|---|---:|
| 新Node | 8套／91案 |
| 真本機browser | 31案（操控5、競速6、城市11、多人9） |
| 原回歸 | 26套 |
| 前輪回歸 | 33套／393案 |
| 固定三 | 3 |
| 交付fixture | 19 |

各組覆蓋可重疊，不加總成獨立功能數。新Node及legacy均驗完整產品來源、runtime runner／子腳本SHA及本輪唯一evidence；browser驗目前build、來源、腳本、截圖與cleanup；原26驗完整產品hash與本輪唯一evidence。完整逐案、路徑、hash與限制見[EVOLUTION_VALIDATION.json](./EVOLUTION_VALIDATION.json)。早期失敗與所有歷史報告保留，不以舊top-level PASS取代本輪。

固定三原值：BOT lap2 54.425 hits=0／aiHits0；陳冠宇162.0／aiHits8；進站陳冠宇175.7／aiHits5。car、track、pitlane與server physics和不可變before逐位元相同。rivals合法新增safe-v1，legacy另由真before／after比較與固定三保護。

建置核對npm完整指令、當下sw版本及前後端Vite成功結尾；現有log無獨立exitCode欄位，JSON如實標示。591檔不可變before與inventory SHA全部核對；歷史根文件原bytes保留，HANDOFF在舊原bytes前新增現況。

- 本輪僅本機隔離驗證，未連正式站、Render或Vercel；工作副本通過不等於已套回原專案或上線。
- Dockerfile已補齊新服務模組與相依檔；目前環境沒有Docker CLI，未執行容器建置或啟動，不能以Node本機通過推定容器已通過。
- 手機尺寸為桌面Chrome模擬，Gamepad為受控標準手把資料；未測手機實機、真手把、觸控舒適度、FPS、耗電或發熱。
- 多人browser使用四個隔離Chrome context與真loopback WS；圈時、截止、成績與部分起跑條件使用受控服務fixture，未測外網或真人完整多人連賽。
- 多人server新測試另外以原Car物理跑完整三分鐘限時賽；其他受控圈時與完賽不冒稱真人駕駛。
- 城市路段計分與交貨完成用逐米連續位置fixture接真controller/model；未證明真人難度、平衡或完整城市路網皆最佳。
- 多人下載驗真Blob並攔截anchor；TT browser實際讀取隔離測試下載目錄的檔案，不宣稱玩家作業系統預設下載資料夾、手機分享流程已驗。
- TT好友影子只驗格式、賽道版本與軌跡合理，沒有防作弊簽章，不是全球榜認證，也不覆蓋自己的PB。
- safe-v1是新的一般GP選項；BOT、舊賽季及舊checkpoint保留legacy。固定三通過不能證明safe-v1所有賽道及真人對戰都已無碰撞。
- 站間續賽需要原席位瀏覽器能力；清除瀏覽器資料後無法認領原席。跨伺服器重啟需自行在部署環境設定固定SERIES_RESUME_SECRET（32至4096 bytes）；本輪未設定真實金鑰。
- 原26及固定三的歷史runner不逐案記錄runtime script SHA；本彙整捕捉目前腳本bytes，另核本輪唯一evidence、exit0、來源hash及固定輸出，不把目前腳本hash說成已存在於舊schema。
- 交付fixture使用隔離Git/npm替身；原專案的真備份、套用、建置及dist逐檔驗證仍須Apply成功收據與original verifier確認。
