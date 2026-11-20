# Evolution 多人交付

入口為 `multiplayer.html`。本輪完成站間簽名續賽、投票與24圖隨機巡迴、3/5分鐘最快圈、0/3/5/10秒讓秒追逐、固定四人2v2系列。原版圈數競速、房規、逐圈、雷達、觀戰、近期戰績及自動畫質保留。詳細wire契約見 [EVOLUTION_MULTIPLAYER_CONTRACT.md](./EVOLUTION_MULTIPLAYER_CONTRACT.md)，前端細節見 [EVOLUTION_MULTIPLAYER_UI.md](./EVOLUTION_MULTIPLAYER_UI.md)。

新玩法在房間「本場玩法」套用，全員重新載入確認與準備。投票一人一票可改票，由房主按結算，平票取catalog先後；隨機巡迴可選3–5站且不重複。限時賽固定無碰撞，時限後只完成原先已開始的末圈；無有效圈DNF。追逐放行前車輛、輸入與碰撞完全停用，以共同起跑的實際先完賽排名，淨跑時間另列。2v2每隊兩人、隊友仍碰撞，隊積分與平手規則在介面說明；下一站需原四席齊備。

原系列房主在非最後一站的結算頁保存HMAC-SHA256簽名checkpoint，可存在獨立localStorage或下載JSON。七日有效、64KiB上限，token不渲染、不進snapshot/近期戰績/匯出。其他車手使用各自原瀏覽器保存的舊席位憑證輸入新房碼恢復；checkpoint只保存席位憑證hash，無法以同名冒領。清除原瀏覽器資料後不能恢復該席。已撤銷/過期席只保留歷史分數，不復活；一般系列至少剩兩席，2v2需原四席才可保存。

席位能力依seriesId/playerId穩定保存（最多10個系列席位），還原時live session token輪替而不覆寫穩定席位能力；server後續checkpoint仍簽固定seriesSeatHash。同一舊checkpoint重複重啟與新checkpoint恢復因此都可用。穩定能力只對待恢復的原席有效，不可接管已恢復的live session。未鎖大廳替換車手時清理舊ID的隊伍、讓秒和票；已鎖系列仍保留歷史名單與隊分。

固定 `SERIES_RESUME_SECRET` 必須32–4096 bytes，服務才宣告可跨重啟；未設定使用程序記憶體key，UI明示重啟後無效。本工作未設定真實部署金鑰。載入檔案有世代/client/endpoint/連線世代/房間/busy/pagehide檢查與明確取消鈕，晚到檔案不會開新房；下載URL在替換與離頁回收。

本機驗證（2026-11-17）：

- `node tools/dev-tests/evolution-multiplayer-server.mjs`：18／18 PASS；真loopback WS，含不可變before拒絕新命令、physics bytes相同、投票重播、全員能力、個人放行凍結、末圈/無圈DNF、真隊友接觸、替補舊ID清理後自簽自驗與2v2保隊、同舊checkpoint兩次重啟及新checkpoint第三次恢復（live token每次輪替）、HMAC竄改/錯key/到期/catalog/超限拒絕。
- 同測試含**無替換Car、無圈數/終點注入的完整3分鐘限時賽**：首圈58.4秒，兩車各4圈，224.1秒末圈結算，最快圈55,219.340／55,220.992毫秒。其他涉及計分/終點/閘門的測試明示為隔離服務fixture。
- `node tools/dev-tests/evolution-multiplayer-ui.mjs`：11／11 PASS；真client/panel/Car/scene，隔離DOM/socket，含穩定席位能力不被live token覆寫、慢速File.text九種失效情境、新檔優先、取消與URL回收。不能把此組當真網路證據。
- 舊後端回歸：multiplayer-server-regression 14、multiplayer-collision-server-regression 9、tenpack-multiplayer-server 11、twelve-multiplayer-server 9、next6-multiplayer-deadlines 6，全部PASS。舊前端97案PASS，完整清單見UI交付；最後整合仍應統一重跑。
- `npm.cmd run build`：PASS（最近完整版本 `93f5c9b633a6`，最終整合需重新build）。

已準備 `tools/dev-tests/evolution-multiplayer-browser.mjs`（`node --check` PASS），依root要求**尚未執行CDP**，由root統一循序跑。腳本使用四個隔離Chrome context、真loopback WS、強制本機endpoint、封鎖外網、只清自己context；覆蓋全部新UI、投票平手、隨機3/4/5去重、三尺寸可達、TT末圈/追逐凍結、2v2隊分、checkpoint Blob與同port重建服務後四席恢復再開站。其圈時/截止/成績明示servicefixture，下載檢查真Blob但攔截anchor，不宣稱作業系統下載資料夾驗證。

新增產品檔：`src/multiplayer-evolution-ui.ts`、`shared/multiplayer-evolution.ts`、`server/series-checkpoint.mjs`。既有產品修改限多人client/game/ui/scene/spectator/series-ui/history/history-ui、HTML與server/shared協定。兩個舊抽取UI harness只補新依賴，lobbybrake-client harness增加可選的隔離localStorage注入（原預設仍禁止存取單人localStorage），tenpack舊server browser fixture補刪除evolution欄以正確模擬舊server，未改原斷言。

`server/physics.mjs` SHA256仍為 `83e8719214c953924093ccc989c398320290b9db50f319ac459ccc3bef45ffbc`；未修改input.ts、單人模擬、隨機次序、HANDOFF、原專案、before或其他agent目錄。未commit、push、部署、連外或改正式設定。真手機、外網、真人完整多人對局、單人固定三基準在此子任務未驗證，交由root整合驗證。
