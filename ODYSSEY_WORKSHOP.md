# Odyssey：手把、回放與工坊交接

日期：2026-11-20  
署名：Rex <game88521@gmail.com>

本文件涵蓋固定選項 2、6、7、8，以及完整備份新增分類。所有修改位於 `taipei-gp-odyssey-work`，原專案、Git、部署狀態以主交接及交付 receipt 為準。

## 操作與規則

### 2：標準手把功能鍵與主要選單

在設定的「鍵位／手把」中，可設定 DRS、進站、鏡頭、暫停。預設依序為 RB、LB、Y、Menu；四個功能不得重複，不占用既有油門、煞車、轉向及甩尾按鈕。沿用標準手把辨識；不支援非標準裝置的自動推測。

方向十字鍵移動選單焦點，A 確認、B 返回。下拉選單以左右切換、滑桿以左右調整；文字欄位有焦點時不接管輸入。選單、最上層對話框及可見按鈕均使用現有 DOM 操作。

啟動、換頁面模式、換裝置、改設定、失焦或返回後，必須先放開所有按鈕並讓搖桿回死區，才接受下一次按鍵。持續按住只觸發一次。單人切換分頁仍沿用遊戲原有自動暫停；多人按暫停會明示比賽持續，不停止其他玩家。功能鍵另存 `taipei-gp-odyssey-pad-v1`，不變更既有駕駛設定格式；目前頁面的啟用／死區讀取實際 Input 設定，儲存遭拒時也保持一致。

### 6：回放五場滿額替換

回放庫維持五場。第六場不再自動刪除最舊場次；先明確選擇舊場，可下載選取回放、確認替換，或取消。沒有預選場次；取消會完整保留現有回放。倒數與比賽期間禁止保存，並取消未完成的替換選擇。

讀取現況、比對完整舊內容、寫入新回放與刪除選取舊場，均在同一 IndexedDB readwrite transaction 中完成。另一頁刪除或改寫選取場次會回報資料變更，要求重新選擇；不會自動重試或覆蓋。同 ID 相同內容視為已保存，同 ID 不同內容同樣需要明確確認。四格時兩頁同時新增，最多只有一頁填第五格；容量錯誤會回滾，不先刪舊場。

### 7：工坊手動 S1／S2

工坊設定可選「自動等距」或「手動檢查點」，最多設定兩個既有檢查點。S2 必須在 S1 後，且兩者必須在終點前。道路檢查點相距 30 公尺，選項顯示索引及距離；例如 S1=2、S2=5 代表 60／150 公尺。地圖與摘要標示兩個位置。

手動位置直接使用既有 NG2 `splits`，分享、匯入、草稿、復原、重做及幽靈車分類均保留。不修改 NG2 物理或計時規則。變更路線點會清除原手動分段並回到自動模式，避免沿用不再適用的索引。

### 8：A／B 循環與書籤註記分享

回放載入完成後，可用秒數或「目前時間設為 A／B」指定片段，最短 0.2 秒。4 倍速及跨尾端大步進會保留循環餘數。拖時間軸、前後五秒、選事件或選書籤會停止循環；關閉回放會清理註記工具與待處理匯入。

註記另下載為 JSON，朋友仍需原回放檔。格式為 `app: taipei-gp-replay-notes`、`v:1`，包含回放 ID、整份回放的 SHA-256 指紋、錄製總時間、可選 A／B 與時間書籤，不包含軌跡、房間碼或續接憑證。canonical 指紋排序物件欄位，保留陣列順序；任何軌跡或其他回放內容差異都不接受。

匯入上限 32 KB、64 筆；書籤文字最多 40 字，禁止控制字元與角括號。額外欄位、錯誤 ID／指紋／錄製長度、非法或越界時間均拒絕。先完整驗證並檢查合併容量，才去重合併至既有本機書籤；不自動播放、不修改原權威回放。播放相容性沿用共用回放 parser，支援舊版及本輪新版回放。

## 完整備份相容

新增 `taipei-gp-odyssey-pad-v1` 與 `taipei-gp-odyssey-road-duty-v1`，完整備份共 19 類。舊 15、Voyager 17 及新 19 類只接受各自完整白名單集合，拒絕缺欄或混搭集合。舊備份未包含的新增分類保留目前內容；19 類備份的明確 `raw:null` 仍會清除對應分類。中斷還原 journal 捕捉完整現況，沿用既有回滾與第三頁變更保護。

手把功能鍵格式由 `parsePadPreferences` 嚴格驗證；一般道路公車由 `parseRoadDutyRecords` 驗證。既有勤務與一般道路勤務各自上限 1,000,000 字元，沿用最近 30 趟上限，不混合排行榜。

## 驗證與限制

本輪 Node：

```powershell
node --experimental-vm-modules tools/dev-tests/odyssey-workshop-node.mjs
node --experimental-vm-modules tools/dev-tests/voyager-platform-models.mjs
node --experimental-vm-modules tools/dev-tests/voyager-workshop-models.mjs
node --experimental-vm-modules tools/dev-tests/atlas-platform-models.mjs
```

最新已執行結果為 14／14、11／11、23／23、15／15 PASS。新 Node 包含真 FreeCar 完成手動 60／150 公尺分段，總秒數 `17.731683405187034`，三段 `4.416676527605859 / 4.993123730486979 / 8.321883147094196`。舊 Voyager 平台測試最初 10 PASS／1 FAIL，只因完整備份由 17 增為 19；保留失敗 evidence 後，將精確分類數更新為 19，另保留 legacy 17 解析及舊 15 還原斷言，再跑 11 PASS。沒有放寬原內容及拒絕條件。

Chrome 由主代理統一安排，禁止同時執行：

```powershell
node --experimental-vm-modules tools/dev-tests/odyssey-workshop-browser.mjs
node --experimental-vm-modules tools/dev-tests/odyssey-workshop-replay-browser.mjs
```

兩支各六案，使用 fresh browser context、本機 preview、真 DOM／IndexedDB／下載事件，阻擋所有外部請求，記錄來源／腳本 hash、例外與清理。第一支手把輸入明確注入 `navigator.getGamepads`；第二支回放以真賽道／真車建立明示權威 pose fixture，並在同源兩頁測交易競態。

兩支 Chrome 已在本機 build `d468d76a17e4` 各 **6 PASS／0 FAIL**，0 例外、0 外部請求，來源／腳本／helper hash 及清理皆通過。證據：

- `tools/dev-tests/odyssey-workshop-browser-evidence-1795142668415-7ad7cb06/report.json`
- `tools/dev-tests/odyssey-workshop-replay-browser-evidence-1795142705021-5b05eb47/report.json`

第一支完成真設定保存、重複映射拒絕、主選單導航、文字欄位保護、真分頁失焦自動暫停及中立恢復、工坊手動分段分享／草稿／復原／重做，以及 390×844、844×390 控制可達。第二支完成真 UI 保存五場、取消與明確替換、真瀏覽器下載事件／檔案、兩頁 IndexedDB 競態、A／B 實際觀察兩次循環、錯註記不改原資料、有效註記合併及兩尺寸可達。四格兩頁競存的結果為 `['full','saved']`，仍維持五場。

第一次 pilot 的鏡頭案反映原有分頁自動暫停，fixture 補恢復步驟後通過；回放 pilot 在 lazy mount 前上傳，補等待真 file input 可用後通過。失敗 evidence 保留。最終整體狀態以各 `*-result.json` 及主驗證總表為準。

舊 UI VM 回歸亦已完成：`twelve-multiplayer-ui.mjs` **5／5 PASS**、`tenpack-multiplayer-ui.mjs` **6／6 PASS**。兩支原腳本 bytes、案名及案數均未修改。初次失敗原因為共用 VM harness 的舊 import／export 去除規則留下新版 re-export 尾段；共用環境修正並補入真 Odyssey 設定／面板依賴後通過。診斷與手把掛載在這兩套舊範圍使用明示 noop adapter，不藉此聲稱測到新診斷或硬體控制。原失敗與新成功結果另存 `tools/dev-tests/odyssey-legacy-workshop-ui-evidence-1795142880635/report.json`。

實體手把、手機實機及外網真人操作沒有驗證。視窗尺寸模擬不能代表手機實機。完整 build、固定三項回歸及整體交付由主代理統一執行，本子範圍沒有更動固定基準或 GP 物理。
