# 第 3 項：共用城市匿名回放

作者：Rex <game88521@gmail.com>。

本文件記錄共用契約、權威錄製工具與真城市播放器。社交房與合作救援的觀眾名額、權限及錄製掛接，另由各模式文件與回歸報告說明。回放工具不更改車輛物理，不保存單人進度，不判定接觸肇責。

## 契約與匿名範圍

`shared/frontier-city-replay.ts` 定義 `frontier-city-replay-v1`、`CityReplayArchive`、`CityReplayDescriptor` 及嚴格解析器。沿用目前城市的 `COOP_CITY_STAMP`；既有封閉賽道 `nexus-replay` schema 1～6 不修改。

匯出的 actor 只保留席位 0～3，其他資料以匿名整數 actor 索引引用。錄製器內部使用玩家識別碼對照索引，輸出不包含姓名、玩家識別碼、原場次識別碼、房碼或續接憑證。事件細節使用固定列舉；傳入任意文字會轉成空字串。下載 key 是獨立隨機值，亦不寫入回放檔。軌跡仍會揭露當時的遊戲位置與行動，不能稱為無法關聯到真人的隱私保證。

每份資料最多前 12 分鐘、3,602 frames、512 events、16 個先後參與的匿名 actor；每個 frame 最多 4 輛社交車或 1 輛救援車。巡航同一席位換人會建立新的匿名 actor；actor 滿額後停止增加錄製資料並標示部分回放。事件滿額或未錄到實際尾段同樣標示部分回放。整份文字限制 8 MiB。

所有物件採精確欄位白名單，檢查有限數值、車款／角色列舉、時間順序、首末採樣時間、actor 引用、同 frame 席位重複及救援結構。`decodeCityReplay` 先檢查長度及 JSON；通過後回傳深拷貝。救援 frame 可保留階段、完整度、作業量、停穩量、路線進度、絞盤、載車與事故車位置；不保留司機或協助者姓名。

## 權威錄製與分段傳輸

`server/frontier-city-replay-service.mjs` 提供 `CityReplayRecorder`：

```js
const recorder = new CityReplayRecorder({source:'social', mode:'cruise'});
recorder.sample(now, [{
  key: internalPlayerId, slot:0, vehicle:'sedan',
  pose:{x,y,z,h,vx,vz,steer,pitch,roll},
  epoch:1, connected:true, role:'driver', outcome:''
}], {weather:'dry'});
recorder.event(now, 'contact', [internalPlayerId], '');
recorder.sample(finishedAt, finalRows, {weather:'dry'});
recorder.finish(finishedAt, 'complete');
```

第一次有效 `sample` 決定時間零點；來源服務須在開始場次時立即採樣。後續最多每 200 毫秒保存一筆，結束時追加最後一筆實際採樣。沒有採樣的時間不會用較晚位置偽裝補齊。新場次請建立新 recorder；`reset()` 會清空記憶體與更換下載 key。

`descriptor()` 回傳 `{key,ready,frames,durationMs,recordedMs,truncated}`。只有 `finish()` 成功嚴格驗證後才 `ready=true`。`part(key,offset)` 一次回傳最多 24 KiB 文字：`{type:'city-replay-part',key,offset,totalChars,text}`；拒絕未結束、舊 key、未對齊或越界 offset。

各服務應先驗證目前房間及結束權限，再接受精確 `{type:'city-replay-chunk',key,offset}`，並檢查 socket backpressure。共用 `CityReplayDownload` 由 `src/frontier-city-replay-client.ts` 提供，一次只要求一塊；取消、離房或換場必須中止下載。服務端錄製上限與分塊共同避免一次傳送多 MiB WebSocket 訊息。

回放片與 pong 不取代房間狀態更新；下載期間來源服務仍須照常 tick 並廣播權威快照。直接掛服務的長檔 fixture 也須保留這條生命週期，不能靠停用或延長 watchdog 完成下載。

## 真城市播放器

`src/frontier-city-replay-ui.ts` 的 `mountFrontierCityReplay` 在既有 main 城市 scene 加入獨立車輛 Group，使用真正車款與救援平板車模型，不另建立城市或 WebGL renderer。它提供播放／暫停、時間軸、前後 5 秒、0.25～2 倍速、匿名車手跟隨、跟車／俯視、事件前後 3 秒、匯入與匯出。

`prepare(isCurrent)` 完成且世代仍有效後才呼叫 `begin(archive)`。準備期間取消只撤銷等待，不呼叫 `end()`。開始後 main 負責暫停單人狀態、隱藏原車、排除操控與進度；每格在一般畫面更新後採用播放器的獨立 camera，讓原城市串流依真正觀戰位置載入區塊。`weather` getter 隨時間軸變化，供 main 套用當時天候；結束由 main 還原天候與鏡頭，保持暫停。

`stop()`／`dispose()` 可重複清理；只有曾開始的播放才呼叫 `end()`，沒有會話時不改焦點。釋放自建 geometry／material 與名字資源，不釋放車款共用 texture。匯出 URL 會撤銷；沒有自動寫入 localStorage／IndexedDB，故沒有新增備份分類。匯入先檢查檔案大小，再讀文字及嚴格解析。

位置與朝向採線性／短弧插值；重置世代、換車、斷線、actor 變更或過大距離／高度變化不插值穿過城市。它只重現採樣資料，不重新模擬物理。輪胎轉動是視覺近似；200 毫秒採樣不能重建每次接觸的完整過程。

## 驗證界線

`node tools/dev-tests/frontier-city-replay-node.mjs`：**19 PASS／0 FAIL**，涵蓋真 recorder、匿名白名單、各容量上限、分塊、嚴格資料拒絕、索引壓縮、reset、救援狀態及插值界線。報告為 `tools/dev-tests/frontier-city-replay-node-result.json`，含來源與腳本雜湊。

首筆壞資料不會提交 `startedAt`，有效 row 與 extra 全部驗證後才確定零點。專用第 19 案在記憶體中明示還原「驗證前提交時鐘」的舊順序，重現首筆壞 row／extra 導致第一個有效 frame 為 100ms、無法封存；相同輸入在真產品得到 frame 0 與可下載回放。這是對舊順序的明示對照，不是舊提交或正式站測試；測試不改寫磁碟上的產品來源。

下載 helper、來源服務的真 WebSocket 掛接與 main 的瀏覽器回歸由整合代理執行，應以各自最新報告為準。上述 Node 結果不代表 GPU 畫面、相機／暫停整合、實體手機、外網真人或長期負載已通過；本代理沒有操作 CDP 或整體 build。

## 最終統一回歸

2026-11-21 本輪build **caeeecc35bef**已完成34套Node／服務、14套瀏覽器與固定三基準，詳見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。本段是最後封版狀態；上文各次build、待root與before FAIL保留開發當時事實，未改寫原始證據。PASS只涵蓋本機實作與驗證；真機／外網／完整真人駕駛限制依統一報告，沒有commit、push或部署。
