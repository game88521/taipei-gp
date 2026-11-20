# 第 1 項：好友雷達與車頂暱稱

署名：Rex <game88521@gmail.com>。

使用既有城市社交房權威快照，最多顯示其他 3 位已連線車手。席位 1～4 對應固定顏色與編號，同款車與同名玩家仍可辨識。HUD 與房間面板另有純文字名單，包含距離、同層／上方／下方及好友／隊友／對手關係；更新上限每秒 4 次，不設持久化偏好、不新增備份分類。

`src/frontier-friends.ts` 提供純資料判定與獨立名字 Sprite。車頂名字只在水平距離 100 公尺內顯示，材質 `depthTest=true`、`depthWrite=false`，接受場景建築的深度遮擋，不採永遠置頂。名字以 Canvas 純文字繪製，固定席位編號、不插入 HTML，顯示字串移除控制／方向覆寫字元。

警匪對手須水平距離不超過 80 公尺且高度差小於 1.8 公尺，才出現在雷達、車頂名字與文字距離。原本 HUD 的最近對手方向也採相同過濾，避免繞過新規則。同隊好友可提供較遠的雷達資料，供小地圖顯示邊界箭頭。離線、中途離席或快照停更超過 2.5 秒即隱藏識別資訊。這是介面顯示策略；既有權威快照仍包含全房資料，沒有宣稱網路層隱藏位置或防作弊。

`radarInfo()` 型別供 main／minimap 接線：

```ts
readonly {
  x:number; z:number; h:number; color:string;
  label:string; dy:number; slot:number;
}[]
```

`label` 已包含「席位號 暱稱」，`dy` 為相對本車高度。資料只選上述欄位，不含玩家 ID、房碼、token；遲載 fallback 回傳空陣列。main／minimap 投影及邊界箭頭由整合代理接入。

名字有自己的 CanvasTexture／SpriteMaterial，建立後重用，不每格重畫。離線／離房／dispose 會釋放名字自有資源；不遍歷或釋放借用車款的共用 texture。沒有增加 WebSocket 訊息頻率、改變物理、寫入單人進度或新增外部請求。

專用驗證：`node tools/dev-tests/frontier-friends-node.mjs`。使用真純資料模組與真 Three.js SpriteMaterial／資源釋放事件，驗證 3 人上限、穩定席位、距離／高度／停更邊界、警匪顯示政策、私席排除、Unicode 及只釋放自有資源。GPU 遮擋像素、實際手機與本機瀏覽器接線尚待整合回歸；不能用材質旗標測試代替 GPU 實測。本代理不執行 CDP、不執行整體 build、不 commit／push。

專用 Node 測試結果為 **9 PASS／0 FAIL**，`tsc --noEmit` 通過。首輪 **8 PASS／1 FAIL** 是測試載入器使用 `require()` 解析 Three 而載入 CJS，導致 `CanvasTexture is not a constructor`；失敗原文保存在 `tools/dev-tests/frontier-friends-node-loader-before-result.json`。專用測試已改接真 Three ESM 匯出，沒有替換產品邏輯，也沒有修改共用載入器；最新結果在 `tools/dev-tests/frontier-friends-node-result.json`。

## 最終統一回歸

2026-11-21 本輪build **caeeecc35bef**已完成34套Node／服務、14套瀏覽器與固定三基準，詳見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。本段是最後封版狀態；上文各次build、待root與before FAIL保留開發當時事實，未改寫原始證據。PASS只涵蓋本機實作與驗證；真機／外網／完整真人駕駛限制依統一報告，沒有commit、push或部署。
