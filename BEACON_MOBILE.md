# Beacon：手機長場資源清理

作者：Rex <game88521@gmail.com>

本輪承接 Meridian build `862f7f9c9857`，只處理已重現的城市串流資源遺漏。使用者已提供主力裝置為 **iPhone 17／Safari**，iOS 與 Safari 的實際版本待記錄，這台實機仍未驗證；桌面 Chrome 手機尺寸、Node dispose 事件及 WebGL 幾何計數均不能代替手機 FPS、溫度與耗電量測。

## 實際修正

原 `city.ts` 卸載區塊時只遍歷 `isMesh` 物件。巨蛋與小巨蛋的屋頂骨架是 `LineSegments`，因此每次離開再重訪時，該骨架的幾何與自有材質都沒有呼叫 `dispose()`。

新 `beacon-mobile-resources.ts` 依原所有權清理整個區塊：

- 未標記 `geometry.userData.shared` 的幾何包含 Mesh、LineSegments、Points，一個共享實例只釋放一次。
- 只有 `ownMats` 子樹的自有材質會釋放，支援材質陣列與重複引用。
- 保留城市共用幾何、共用材質與所有貼圖的原所有權；沒有擅自釋放城市圖集。
- `InstancedMesh` 的實例緩衝仍會釋放。
- 完成後拆開整棵舊子樹，渲染清單保留任一物件時不會連帶留住整塊城市；同一區塊重複釋放不再重複 dispose。

沒有改變城市路網、碰撞、車流、車輛物理、亂數或載入／卸載距離。

## 驗證

`node tools/dev-tests/beacon-mobile-resources-node.mjs`：目前 **5／5 PASS**。使用實際 `buildSpecial` 產生巨蛋、小巨蛋及紀念館，並驗共享資源、陣列材質、InstancedMesh、深層拆解與重複呼叫。

100 輪重建／卸載對照：修前共建立 500 份幾何／500 份材質，各只釋放 400 份；修後 500 份均釋放。這是實際產品地標物件的生命週期計數，不是 GPU bytes 或實機效能。

修前程式取自保留的 Meridian `city.ts` 卸載原文，僅去除 TypeScript 型別。第一輪測試的共用模組載入器將 Three 導向 CJS，造成 1 PASS／4 FAIL，原始時間戳收據保留於 `beacon-mobile-resources-node-evidence-1795414339177`；之後只修正測試的 Three ESM 對應，沒有改寫失敗紀錄。

`node tools/dev-tests/beacon-mobile-browser.mjs --before` 為舊 dist 對照，不帶旗標則為新版驗收。腳本只連本機 4317 與專用 CDP，實際載入真巨蛋區塊、將骨架上傳 WebGL，往返卸載三輪，核對真 dispose 事件及相同空城狀態的 `renderer.info.memory.geometries`。為單獨測串流，腳本直接移動串流中心與鏡頭，不宣稱真人沿道路駕駛。

修前瀏覽器對照在實際 build `862f7f9c9857` 完成 **2／2 PASS**；修後在實際 build `fae95fac6d0e` 完成 **2／2 PASS**。同一腳本及相同真城市區塊 fixture 的結果如下：

| 項目 | 修前 | 修後 |
| --- | --- | --- |
| 三輪骨架幾何 dispose 次數 | 0、0、0 | 1、1、1 |
| 三輪骨架自有材質 dispose 次數 | 0、0、0 | 1、1、1 |
| 卸載後相同空城狀態的 WebGL 幾何數 | 81 → 82 → 83 | 80 → 80 → 80 |
| 卸載後貼圖數 | 52、52、52 | 52、52、52 |

兩次來源及腳本 hash 均確認測試期間未改變，隔離 context 清理通過，JavaScript 例外、外部請求及 loadingFailed 均為 0。完整收據分別為 `tools/dev-tests/beacon-mobile-browser-before-evidence-1795415534306/report.json` 與 `tools/dev-tests/beacon-mobile-browser-evidence-1795415644984/report.json`。

瀏覽器工具第一輪在尚未執行測試案例時，等待 Network quiet 10 分鐘後失敗，收據保留於 `beacon-mobile-browser-before-evidence-1795414580439`。獨立 90 秒診斷 `beacon-mobile-network-diagnostic-evidence-1795415338479` 重現：Chrome 將三個 tileworker 的 Script request id 當作 Worker target id，父頁沒有對應的 `loadingFinished`，但城市區塊已載入完成。沒有產品 JavaScript 例外、外部請求或 loadingFailed。

後續只修正測試工具：對這些精確 Worker id，同時要求原 Fetch 攔截已繼續、三個原生 Worker 各自回傳真實 tile 結果、Resource Timing 已有 responseEnd、同 context 的 Worker target 存在且 `stream.pending === 0`，才記錄明示的替代完成證據；其他請求仍必須正常結束。所有 loadingFailed、JavaScript 例外及外部請求仍使測試失敗。清理步驟也分別執行，quiet／Fetch 停用失敗不會阻止銷毀隔離 context；原始失敗與獨立清理收據均保留。

## 最後實機驗收

1. 在 iPhone 17／Safari 以已授權的本機測試連線開啟新版，記錄 iOS／Safari 實際版本、畫質、解析度及 FPS 上限；無法取得的欄位如實註記。
2. 以同一路線、同天候、同人數分開做修前／修後各 30 分鐘；使用現有「效能採樣與報告」保存完整 JSON。
3. 路線包含重訪巨蛋區域；檢查幾何數是否在載入／卸載後回落，同時查看長幀與後段是否持續劣化。
4. 真觸控同時轉向／油門／煞車，檢查 Safari 橫直向旋轉、工具列展開／收合、安全區及選單／鍵盤；切 App、鎖定後回前景及返回／前進還原頁面時，確認操控沒有卡住，且不會自行開始任務或略過多人恢復確認。
5. Safari 不假定支援 `performance.memory`，不可取得的記憶體欄位不填 0；幾何數不是 GPU bytes 或顯示記憶體容量。溫度與耗電由裝置的可用量測方式另記，前後比較仍須看有效駕駛覆蓋。
6. 依實際系統介面驗收效能 JSON 儲存到「檔案」、遊戲照片匯出到「照片」／「檔案」，核對內容可開啟，並測取消及拒絕權限後仍可操作。詳細待驗步驟見 [BEACON_PHONE_TEST_PLAN.md](./BEACON_PHONE_TEST_PLAN.md)。

目前尚無上述實機紀錄，不宣稱已解決所有手機掉幀或已降低發熱／耗電。
