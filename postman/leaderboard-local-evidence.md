# 排行榜本機契約與驗證

2026-11-11，原始對照版本 `feaa6ff`。遵循已讀的 Postman api-engineer、api-simulation、api-documentation：先定契約，再實作並經過真實 HTTP 驗證；沒有登入、publish 或操作正式儲存。

## 可重跑

```powershell
node tools/dev-tests/generate-track-manifest.mjs
node --experimental-vm-modules tools/dev-tests/leaderboard-regression.mjs
node tools/dev-tests/lap-proof-reference.mjs
node --experimental-vm-modules tools/dev-tests/identity-regression.mjs
```

第一個命令只以真實 `buildTrack()` 建立伺服器路徑 manifest；Vite 使用 `write:false`，臨時 Node 模組最後移除，不寫正式 dist，也沒有 WebGL。

## 已觀察

- `shots-leaderboard-regression.json`：**12 組通過、85 次依賴 HTTP 請求**。實際新舊 API handler 皆經本機 HTTP 呼叫有狀態 Redis REST stand-in，不是直接 stub fetch 回應。
- 修改前：同名不同 UUID 仍只一筆，內部錯誤會回到 caller。修改後：同名 UUID 分開、固定錯誤碼不含內部內容。
- 新榜經典／2026 分開、版本拒絕、慢圈不覆蓋、舊榜唯讀、冪等回放／衝突、IP 限流、8 種壞軌跡、格式與大小限制、上游 JSON／HTML 錯誤、上游掛住期限均通過。
- 實際 `network.ts` 與 `leaderboard-ui.ts` 在簡化 DOM 執行真實本機 HTTP，確認期限、取消、過期經典回應不覆蓋 2026、雙擊一次請求、關閉後不覆蓋狀態。
- `shots-lap-proof-reference.json`：真實 `Car.update()` 與既有 botInput 追蹤公式產生完整圈，經典 **58.260 秒／1166 點**、2026 **57.560 秒／1152 點**，均通過伺服器檢查。不是固定回歸基準，也不是完整 main。
- 伺服器 manifest：**3118.704933698768m／1559 點**，指紋 `1559:311870:44240:50660:20929:-30914:44440:50665`，附來源檔 SHA-256 供重建核對。
- `shots-identity-regression.json`：**6 項 UUID 測試通過**，覆蓋原生分支、區網 HTTP getRandomValues fallback、v4／variant 位元、拒絕其他版本／錯誤 variant／無效 ID。API 與存檔都限定 UUID v4；排行榜重跑仍為 12/12。

## 邊界與環境

依賴 stand-in 依既有 Redis REST 命令格式建置，只支援端點使用的命令與四 key 原子提交語義；未知命令會失敗。它保存 sorted scores、名稱、回條、限流狀態並提供延遲／錯誤注入，不聯絡網際網路。假 token 僅測試資料。

**沒有實際 Redis／Lua 執行、正式部署、真實瀏覽器 UI 或手機測試**。正式 Redis 命令與 Lua 相容性仍需部署前驗證；本輪不能聲稱已連上遠端。合成／參照軌跡不提供可信跑圈證明；UUID 沒有身分所有權驗證。伺服器只檢查合理性，不是權威反作弊。

追加部署審查：`api/leaderboard.js` 靜態相對匯入 `../shared/lap-proof.js`，後者靜態匯入 `./taipei-track.json`；兩者必須隨原始碼部署，不能只上傳 dist。JSON import attributes 需要支援的 Node（與現有 Vite 8 的 Node 20.19+/22.12+ 要求相容）。Lua 的 SET NX 回 false、ZADD LT、cjson 回條與 ZRANK＋1 已逐項核對語義，未找到語法錯誤，但不以閱讀或 stand-in 代替真 Redis。已修正多次 Redis 往返各自 5 秒造成總等待過長，改共用 API 7 秒期限；亦修空 KV 環境值阻斷 Upstash fallback、UUID 大小寫不一致。既有 12 組本機驗證再次通過。

Postman CLI **1.74.0**，`postman simulation run --help` 可用，但 `postman status` 回 `unknown command 'status'`。沿用使用者授權的本機實際 HTTP stand-in 路徑；未執行雲端 owner 搜尋、login、init 綁定、push 或 deploy。契約權威來源為 `leaderboard.openapi.json`，測試程式及本文件記錄本機證據；不把這次測試稱為 Postman 雲端 simulation 成功。
