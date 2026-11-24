# Harbor 站間續局設定

作者：Rex <game88521@gmail.com>。

本輪準備好設定與離線檢查，尚未修改 Render 私密環境，也未部署。上一版公開檢查回報 Meridian 暫存簽章；不能把本機檢查當作正式環境已設定。

在 Render 的既有 taipei-gp 服務 → Environment，分別新增兩個私密環境變數：

| 名稱 | 格式 | 用途 |
|---|---|---|
| `MERIDIAN_CHECKPOINT_SECRET` | 64 個小寫十六進位字元 | 好友盃、派對、跨圖錦標賽站間續局 |
| `SERIES_RESUME_SECRET` | 32～4096 UTF-8 bytes；建議另產一組64字元hex | 舊系列賽站間續賽 |

既有值若已有效請保留，更換會撤銷舊續局碼。沒有設定時，可在自己的一般 PowerShell 各執行一次下列命令，把不同結果直接貼到 Render 的對應欄位。不要貼回對話或存入 Git、Vercel 的 `VITE_` 變數、備份或測試報告：

```powershell
node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

保留現有 `ALLOWED_ORIGINS`。新 Blueprint 已列出兩個 `sync:false` 私密欄位；既有服務仍須由管理者在控制台設定。若本輪尚未發布，可先儲存，發布新後端時再一起部署；不要在有玩家比賽時重啟。

在完整專案的根目錄、使用待檢查的伺服器環境變數時，可執行以下離線檢查。Docker 執行映像沒有包含這支開發工具；正式服務的實際狀態請依新版 `/health` 的布林欄位核對。此命令只輸出 `MISSING`／`INVALID`／`CONFIGURED`，不顯示值；任一缺少或格式錯誤會回傳非零狀態，不連網、不改設定：

```powershell
node tools/check-resume-config.mjs
```

新版 `/health` 的 `continuation` 僅回報兩個布林設定狀態，兩者皆 `true` 才表示兩種簽章均固定；不公開值、摘要或長度。這只證明簽章設定，不表示有比賽中途持久化、資料庫、跨程序防重播或多副本房間。續局仍須事先於站間匯出、相容版本及各原席瀏覽器的私密證明；免費服務重啟會中止當場比賽。
