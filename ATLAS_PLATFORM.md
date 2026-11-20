# Atlas 模式入口與整包備份

署名：Rex <game88521@gmail.com>

Build **205d0c8df91e**。玩法搜尋保留舊按鈕與網址；依分類、名稱、裝置搜尋，收藏與最近保存在獨立偏好。駕校只在城市面板完成載入後定位與記錄，跨賽道不可用入口會提供回台北的44px導航。

整包入口：選單→紀錄→全模式整包備份與還原。最多40MB；先顯示來源版本、分類、容量與清除／取代動作，確認後保存還原前journal。IndexedDB最多5場回放，localStorage精確15分類：

|分類|key|字元上限|
|---|---|---:|
|主存檔|`taipei-gp-v2`|8000000|
|鍵位與手把|`taipei-gp-controls-v1`|4096|
|工坊草稿與紀錄|`taipei-gp-workshop-v1`|250000|
|回放書籤|`taipei-gp-replay-bookmarks-v1`|200000|
|公車與救援勤務|`taipei-gp-summit-duty-v1`|50000|
|同機雙人成績|`taipei-gp-split-results-v1`|32000|
|合作配送成績|`taipei-gp-city-coop-results-v1`|16000|
|GP情境成績|`taipei-gp-scenarios-v1`|60000|
|多人戰績|`taipei-gp-multiplayer-history-v1`|200000|
|房間範本|`taipei-gp-multiplayer-presets-v1`|40000|
|進站校準|`taipei-gp-pit-calibration-v1`|60000|
|多人畫質|`taipei-gp-multiplayer-quality-v1`|100|
|多人幀率|`taipei-gp-multiplayer-fps-v1`|100|
|收藏與最近玩法|`taipei-gp-mode-browser-v1`|4096|
|主進度救援快照|`taipei-gp-v2-last-good`|8500000|

以原始字串保存，嚴格驗證壞格式、重複key、回放及模式紀錄；不任意打包localStorage，不含房間碼席位憑證、sessionStorage或離線地圖。空白分類明示清除；主檔與救援快照都為空可安全新開始。還原需獨佔頁面鎖並暫停主存檔寫入；寫入失敗會檢查當前bytes再rollback，不覆蓋第三方變更。跨store中斷先阻擋正常啟動，提供原檔下載、經驗證的舊檔復原及明確保留目前內容；復原再次失敗保留首次journal。下載產生後須自行確認檔案已保存。

整包還原需要瀏覽器Web Locks及關閉其他目前版本遊戲頁；任意舊版頁面、擴充套件或外部寫入不受新頁面鎖協定控制。匯出不代表已保存下載，操作前仍須確認備份檔。

證據以[ATLAS_VALIDATION.json](./ATLAS_VALIDATION.json)為準。
