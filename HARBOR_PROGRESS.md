# Harbor 1–5 進度

Rex <game88521@gmail.com>

本機 build `f15b569a01d7`，原 main/HEAD `1e98cf6b60b7c5fb3eb389f434ed01edb117cf30`。

| 項目 | 目前結果 | 尚待完成 |
|---|---|---|
| 1 站間續局部署設定與檢查 | 檢查指令、設定範例與公開健康狀態已本機驗證 | Render 兩種固定金鑰實際設定／生效待核對；既有有效值保留 |
| 2 iPhone 17／Safari 頁面、鍵盤與生命週期 | viewport、觸控、鍵盤／VisualViewport 與生命週期邏輯已本機驗證 | 真 iPhone／Safari 驗證 |
| 3 獨立閱讀字級、modal 背景隔離與 VoiceOver 基礎 | 100／125／150 字級、偏好還原、modal 背景隔離與焦點已本機驗證 | 真 VoiceOver 與 Safari 人工操作 |
| 4 私人競速房短斷線同步暫停 | 預設關閉、權威停鐘、原席載圖確認、3 秒恢復、10 秒期限及兩次上限已驗證 | 跨網路及免費服務容量驗證 |
| 5 三步快速開房 | 四玩法、24 圖、房規相容預覽、明確原子建房、防雙送及焦點已驗證 | 真手機與朋友實際全程遊玩 |

**122 PASS／0 FAIL**；數字、原始失敗、對照與來源 hash 見 [HARBOR_VALIDATION.md](HARBOR_VALIDATION.md) 及 [HARBOR_VALIDATION.json](HARBOR_VALIDATION.json)。Render 設定／生效尚未確認；真機與跨網路沒驗證。本輪沒有 commit、push、部署或正式站測試。

操作文件：[部署設定](HARBOR_DEPLOYMENT.md)、[手機與閱讀](HARBOR_MOBILE.md)、[斷線暫停](HARBOR_MULTIPLAYER.md)、[快速建房](HARBOR_QUICK_ROOM.md)、[最後實機計畫](HARBOR_PHONE_TEST_PLAN.md)。

原始證據絕對總根：`C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\DCISI\taipei-gp-harbor-work\tools\dev-tests`。本次封版 audit 子目錄：`C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\DCISI\taipei-gp-harbor-work\tools\dev-tests\harbor-validation-audit-evidence-1795486817130-e9e96543`。各 suite 原始報告分布於總根內的時間戳資料夾；時間戳證據不入原案套用包，請依總根與 JSON 的 absolutePath 讀取。此為套回前封版；原案套回結果依 DCISI/TAIPEI_HARBOR_DELIVERY.md 獨立收據。
