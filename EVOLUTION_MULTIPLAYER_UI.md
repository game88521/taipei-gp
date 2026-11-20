# Evolution 多人前端交付

入口為 `multiplayer.html`。建立房間後，在「本場玩法」選擇限時最快圈、讓秒追逐或四人 2 對 2，按套用；追逐可逐車設定 0／3／5／10 秒。限時賽顯示剩餘時間與末圈寬限，末圈完成後停止輸入及預測並可觀戰。讓秒賽在個人放行前鎖定輸入、權威校正與預測；成績分列共同完賽時間和個人淨跑時間。

大廳有逐人選隊、投票選圖與房主結算，平票依目錄順序。既有 3～5 站系列設定旁有 24 圖不重複隨機路線。2 對 2 需四位、每隊兩位及已設定系列才可開賽，系列總成績列出隊分與分站勝場。

站末結算的原房主可取得伺服器簽名續賽檔，保存在獨立 localStorage 鍵並可下載。入口「接續已保存的系列賽」可用本機檔、匯入 JSON 或隱碼貼上憑證開新房。其他車手輸入新房碼，選擇原席位恢復；原席位憑證在原瀏覽器獨立保存，最長七日。憑證不渲染為可見文字、不加入近期戰績或匯出。未設定固定 `SERIES_RESUME_SECRET` 時，介面明示伺服器重啟會失效。設定實際部署金鑰由整合層處理。

新能力缺省時沿用舊玩法並隱藏新房內控制。一般圈數賽的嚴格逐圈驗證保留；限時賽改以最多128圈及最快圈結算驗證；追逐另外核對共同時間－淨跑時間＝放行秒數。近期戰績保存玩法分類、隊伍及追逐雙時間，不保存憑證。

主要新增：`src/multiplayer-evolution-ui.ts`。另修改 client/game/ui/scene/spectator/series-ui/history/history-ui 與 HTML；沒有修改 input.ts、單人模擬或求解器。既有兩個抽取式 UI harness 僅補入新模組依賴與 checkpoint 訂閱介面，未更動原斷言。

本機驗證（2026-11-17）：

- `node tools/dev-tests/evolution-multiplayer-ui.mjs`：8／8 PASS，含真 client/panel、真 Car/scene 放行前與末圈完成後凍結；結果 `evolution-multiplayer-ui-result.json`。
- `npm.cmd run build`：PASS；最後本機產物版本 `1722145a94d4`。
- 既有回歸：multiplayer-client-regression 25、multiplayer-collision-client-regression 16、tenpack-multiplayer-client 6、tenpack-multiplayer-models 7、tenpack-multiplayer-ui 6、twelve-multiplayer-models 13、twelve-multiplayer-ui 5、next6-multiplayer-ui 4、multiplayer-map-ui-lifecycle 8、raceplus-invite-main 7 全 PASS。

最後加入 timeTrialDone 後重跑新增8案與完整build；上述既有組別在該旗標接入前通過，整合時可統一重跑。最初完整控制器 fixture 的假 client 缺 endpoint 引出空 checkpoint 判斷問題，已以明確空值檢查修正，原8／5／7組重跑通過，沒有改斷言。

限制：本子任務未執行真瀏覽器、WebGL視覺、真下載、手機、外網、真人完整對局或單人固定三基準；真 loopback WebSocket由多人伺服器子任務提供，不能把本UI隔離socket測試當作真網路證據。未commit、push或部署。

後續整合前修正：已加入慢速讀檔取消/世代/新意圖/pagehide保護、Blob URL回收，以及依seriesId/playerId保存穩定席位能力（live session token輪替不覆寫）。最終新增UI回歸11／11 PASS、完整build `93f5c9b633a6` PASS；真WS18案及待root實跑的四context browser腳本見 [EVOLUTION_MULTIPLAYER.md](./EVOLUTION_MULTIPLAYER.md)。
