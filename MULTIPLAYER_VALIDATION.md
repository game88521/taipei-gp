# 私人房連線競速驗證（v1 歷史，2026-11-13）

> 本檔保留 v1 原始證據；下方「未建立服務／未公開」只描述當時狀態。之後 Rex 已回報透過 Render／Vercel 成功對戰。本輪 24 圖 v2 結果見 [MULTIPLAYER_MAPS_VALIDATION.md](./MULTIPLAYER_MAPS_VALIDATION.md)，v2 尚未部署，不混用兩輪結果。

build **c27a6eb50a74**，產品來源 SHA256 **79c25ed69d7cb0ad04e37b00070bd091d0826f599f8107ab62dccca305346bbe**。本機核心流程已驗證，同 Chrome 的兩個隔離玩家畫面通過，未部署外網服務。逐檔來源雜湊、測試完整摘要與證據檔雜湊見 [MULTIPLAYER_VALIDATION.json](./MULTIPLAYER_VALIDATION.json)。

| 實測範圍 | 結果 | 證明範圍 |
| --- | --- | --- |
| TypeScript／Vite／伺服器物理 bundle | build c27a6eb50a74 | 前端多入口及同源物理可建置 |
| 權威伺服器 | 14／14 PASS | 真 WS、真物理，雙車完整圈 58426.284／60393.956ms，含房間、版本、輸入、斷線、DNF／期限 |
| client 生命週期與真 WS | 16／16 PASS | 隔離 fixture 15 組＋真 server 1 組；重連維持 playerId／matchId |
| 單瀏覽器＋真 WS peer | 11／11 PASS | 真 UI、鍵盤、三尺寸、失焦／重連、真時間完賽／成績／再戰；不是雙瀏覽器 |
| 原單人回歸 | 26／26 PASS | 最終產品 hash 相符，歷史摘要與個別結果均還原 |
| 固定三回歸 | 3／3 PASS | 54.425 hits0／aiHits0；陳冠宇162.0／aiHits8；進站175.7／aiHits5，未改斷言 |
| 本輪交付工具 | 16／16 PASS | 隔離 fixture 的完整預檢、備份、回滾、重入、物理雜湊與 Render 檔候選 |
| 兩個隔離 browser contexts | 9／9 PASS | 正常圖形設定、兩個真 UI 同時繪圖，不暫停 A 初始化 B；同機 Chrome，非兩台裝置；保留歷次失敗，未延長原 30 秒期限 |

單 UI 實測 build 與最終產品一致；伺服器／client 的先前結果只在各自來源 SHA256 逐檔仍相符時沿用。Node 26 套綁定目前整體產品 SHA256。各套執行時來源未變，固定回歸保留舊文字；測試頁的 localStorage 前後一致，隔離 context 已 dispose，外部請求與未處理例外皆為零。Render 文件／設定與測試工具也列入逐檔來源清單。

## 限制與待完成

- 雙 context 本機測試只代表同一台 Chrome 的兩個隔離玩家；不代表兩台實機或外網。歷史強制 SwiftShader 測試曾初始化／截圖逾時，失敗證據保留；新正常圖形環境結果另列，不由環境差異斷言唯一根因。
- 本輪單 UI＋真 WebSocket peer 的結果僅代表本機流程；無兩台實機、外網 WSS、行動網路延遲／丟包驗證。
- persisted pagehide/pageshow 使用合成事件；真 BFCache 命中尚未驗證。
- 單 UI 的 11 組功能斷言通過，但額外效能診斷未取得 trace：Tracing.tracingComplete 在原 30 秒限制內未完成；診斷失敗另存，不以新環境功能通過斷言舊停頓的唯一根因。
- 手機實機 FPS／耗電、音效聽感、感測器操作與真人難度平衡尚未驗證。
- 極低高度 844×220 的 HUD 速度與排名文字有局部重疊；操作按鈕的尺寸／可達性測試通過，一般直向與 844×390 另有截圖。低高度文字排版待調整。
- Docker build 尚未實測；Render 免費額度、信用卡要求、區域及 Blueprint 最新欄位未經官方頁面核實，建立時須顯示 Free／0 費用。
- 沒有建立 Render 服務、連接帳號、公開 WSS URL 或 Vercel 多人測試部署；尚未授權本輪 commit／push。
- 套用原專案的狀態須由 DCISI 本輪 apply-result 及 original-verification 另行核對；此來源驗證文件不能證明已套用或上線。

完整重跑入口見 [測試計畫](./tools/dev-tests/MULTIPLAYER_TEST_PLAN.md)。原 26 套及固定三回歸沒有放寬條件。UI 整圈等待 180 秒用於真 wall clock 跑圈，單次 CDP 操作期限仍為 30 秒。未使用正式站，也未讀寫真人玩家存檔。原始 evidence 目錄位於 DCISI/taipei-gp-work/tools/dev-tests，未將它們當產品或 node_modules 交付；本 JSON 內保留各套摘要與原檔雜湊，歷史 ALL_VALIDATION 未覆寫。
