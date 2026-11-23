# Aurora 操作排版、選擇性還原與好友邀請

作者：Rex <game88521@gmail.com>

## 10. 手機駕駛按鈕自由排版

設定 → 操作 →「手機駕駛按鈕・自由排版」。一般頁與多人賽道頁共用排版資料，實際只套用該頁存在的按鈕。橫向與直向分別儲存啟用狀態、位置與大小；關閉自訂排版會恢復既有 CSS。舊的整組觸控設定仍可使用。

編輯時可選按鈕、拖曳預覽、用方向鍵微調（Shift 為較大步幅），或使用左右／上下位置滑桿。矮畫面可捲動工具列，不必精點縮小的預覽按鈕。預覽依畫面等比例縮小，實際控制仍至少 44px，位置限制在安全邊距內。重疊會提示；左右按鈕與轉向滑桿屬替代控制，不互相警告。

取消不寫入；「儲存並啟用」才生效。編輯器開啟時釋放駕駛輸入。橫直向切換保留各自草稿。`taipei-gp-aurora-touch-v1` 採嚴格 schema 與原文 CAS；空字串也視為損壞資料，停止寫入而不覆蓋。

## 11. 全模式備份選擇性還原

紀錄 → 全模式整包備份 → 選取檔案後，可逐類選擇「保留本機」或「使用備份」。主存檔另有「備份主進度＋較佳 PB」：金錢、進度依備份，不將兩份資產相加；只比較相同賽道指紋的成績，鬼車與其最佳圈一起保留。不同指紋無法比較，保留本機該組 PB。分段最佳可各自比較。

回放可保留、以勾選場次取代，或加入勾選場次；合併時相同 ID 保留本機，上限仍為五場。未選回放不寫入 IndexedDB。選用備份的空白分類才會清除該分類；未選分類保持原文。每次改選都清除確認勾選，無有效選擇時不能套用。

延續原本的還原租約、全部分類 CAS、還原前完整 journal 與失敗 rollback。失敗且無法回復時保留 journal，不宣稱已成功。新備份為 35 類，仍讀取先前 15／17／19／26／27／31 類備份；新類別為按鈕排版、公車連續營運、NG3 劇本與多人救援結果。私席 token、房碼、登入資料不列入備份。

## 12. 統一好友邀請

賽道好友房、城市競速、合作配送、社交玩法、合作救援與好友拉力均接入 `mountRoomInvite`。提供原生分享、複製、可選取網址及本機 QR。舊邀請入口保留相容。

邀請只保留乾淨的 origin、遊戲路徑、房碼與社交玩法；不帶工具列碼、登入參數、續接憑證或 hash。網址仍受部署環境的存取權與 Origin 設定限制，邀請不會更改這些設定。原生分享取消只顯示取消，權限拒絕時可手動複製。

QR 為本機產生的標準 Model 2 byte/L，版本 1～6，上限 134 UTF-8 bytes；過長時明示改用網址，不截斷。測試使用獨立的 `jsqr@1.4.0` 解碼，沒有新增遊戲執行期依賴，也不傳送房碼到 QR 服務。

## 驗證方式

```powershell
node --experimental-transform-types tools/dev-tests/aurora-platform-node.mjs
node --experimental-transform-types tools/dev-tests/aurora-platform-browser.mjs
node --experimental-transform-types tools/dev-tests/aurora-qr-node.mjs
```

Browser 使用本機 `dist`、4317 preview、9334 專用 CDP Chrome，會暫時啟動自己的 4320 對戰服務；不可和其他使用焦點／4320 的測試並行。全部操作使用隔離 context。Node QR 測試預設從工作副本旁的 `taipei-gp-aurora-test-tools/node_modules/jsqr/dist/jsQR.js` 讀取 decoder；其他環境可用 `AURORA_JSQR` 指定已安裝的相同版本，不在測試中自動下載。

Browser 的原生分享取消／拒絕使用明示 API fixture，不能當成實體手機分享面板的證據。實機觸控、系統分享及相機掃碼應依手機計畫補驗，最終結果以 `AURORA_VALIDATION.md` 為準。
