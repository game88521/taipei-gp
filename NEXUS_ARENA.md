# Nexus：多人接力與補給道具賽

本輪為使用者六項中的 **1、3**。其餘多人／城市功能由整合分支合併；本文件不宣稱已套回、提交或部署。

## 入口與規則

開啟 `multiplayer.html` 建立私人房，於大廳下方「接力與道具賽」選擇玩法並套用。需要所有參賽席位支援 `nexusArena`（斷線保留席也包含），設定變更後全員重新載入確認及準備。僅搭配單場圈數競速；系列、限時、追逐、既有2v2、淘汰、防堵路與倒序須先關閉。房主、地圖選擇、房規寬限、重連與觀眾機制沿用既有流程。

### 1 雙隊接力

- 固定4人、紅藍兩隊各2位，隊伍共跑3或5圈。選接力時原本1圈會改為3圈。先加入且slot較前的隊員為首棒。
- 可於大廳選紅／藍隊；對方已滿且自己原本有隊時，交換對方最後加入的隊員，保持每隊2位。起跑後不能換隊。
- 每隊同時只有當值車手能駕駛／參與碰撞；候場車輛不呈現，候場者可追看當值車手。隊伍進度、圈表、完賽時間與DNF同步給兩位隊員。
- 首棒至少完成1圈；回到起終線後80公尺內，減速至18 km/h以下交棒。青色地面為交棒區；未交棒會限制速度並在約70公尺停留，避免錯過交棒區。第二棒接手原車況、檢查點與完整隊伍進度，從靜止跑完其餘圈數；停留時間照常計入成績。
- 操作：畫面交棒按鈕，或目前綁定的「甩尾」鍵／標準手把X（多人原本不使用甩尾物理）。連按或重送不會再交第二次。
- 交棒對象必須已連線並載入。原席短斷線仍保留棒次，10秒內可續接；任一隊員離賽／逾期，全隊DNF。結算另列兩隊名單、時間與交棒次數；重開清除所有棒次／計圈暫態。

### 3 補給道具賽

- 每圈三個彩色補給點，位於賽道1/6、1/2、5/6；伺服器依實際前進進度授予加速或護盾，一次持有一個。沒有額外隨機物理或可指定道具／時間的網路操作。
- 加速：2.5秒使用既有Car.boost增量；護盾：4秒不參與車輛碰撞，撞牆依舊減速。護盾不是扣血機制。有效期間不可再次拾取或使用；新補給需再跑到下一點。
- 操作：道具按鈕或目前綁定的甩尾鍵／標準手把X。按住只送一次動作，伺服器驗證場次、地圖、身分、載入、持有道具與單調序號；效果結束自動恢復原能力。
- UI顯示道具／剩餘時間，3D有補給與效果環。不同玩法的近期戰績以 `relay`／`items` 分類，不把它們標成普通圈數競速。

## 實作

權威邏輯在 `server/nexus-arena-service.mjs`，公開契約與嚴格快照驗證在 `shared/multiplayer-arena.ts`。核心room service只加接收、起跑、步進、碰撞、結算與公開狀態hook。`src/multiplayer-arena-ui.ts`／CSS負責大廳與行駛HUD；`src/multiplayer-arena-visuals.ts`只擁有自己的可釋放幾何／材質，切圖／切回一般即清理。預測與呈現也排除候場或護盾車，交棒世代變更立即清輸入與位置平滑。一般模式不回寫單人存檔、錢包、PB或賽季。

單人 `car.ts`、`track.ts`、`rivals.ts`、`pitlane.ts` 與 `server/physics.mjs` bytes與Nexus before一致；不修改模擬亂數或固定回歸基準。

## 驗證與限制

- `node tools/dev-tests/nexus-arena-server.mjs`：最終整合來源23案PASS，納入 `nexus-node.mjs` 六套共88案PASS（`nexus-node-evidence-1794976072475-d4044633`），產品與全部頂層測試腳本前後SHA256均不變。包含原版before不支援對照、真WebSocket權限／版本／舊世代、交棒與進度、DNF／重連、道具／護盾、異常快照、一般模式30份逐幀權威車況與before完全一致。
- 其中接力完整3圈由真Car與服務內controller駕駛，交棒透過真WS，未放置車輛／修改計圈／偽造完賽結果；兩隊都合法交棒並完賽，10375 ticks／172.9167模擬秒。其餘邊界案例的車況、補給及結算使用明示服務fixture，不冒稱真人駕駛。
- `npm.cmd run build`：root最終整合build `64bc8f19a76a` 通過TypeScript、前端與多人physics。root固定三項皆PASS：54.425／hits0、162.0／aiHits8、175.7／aiHits5，未改回歸基準。
- `node tools/dev-tests/nexus-arena-browser.mjs`：最終整合build `64bc8f19a76a`、CDP9334與preview4398，8案PASS／0FAIL。四個隔離真Chrome context與本機WS，驗證候場追看／禁止輸入／只顯示當值兩車、真UI交棒及駕駛權轉移、兩玩法近期戰績、加速、自訂F鍵單次觸發護盾、四種尺寸控制可達且至少44px、切回一般清除marker與單人錢包不變。0外部請求、0JS例外，測後全數context／preview／WS清理完成。圈數、補給與結算由明示服務fixture安排，不能冒稱四位真人完整完賽。
- 瀏覽器證據：`tools/dev-tests/nexus-arena-browser-evidence-1794975449024/summary.json`與同資料夾截圖；整合初版 `ab3d3a796f5b` 在候場控制隱藏曾2PASS／1FAIL，定位為Horizon面板覆寫 `mp-controls.hidden` 遺漏arena候場條件，補正後 `c4bd48b3899f` 與最終版均8案通過。失敗對照保留在 `nexus-arena-browser-evidence-1794974390763`。
- Replay與arena共存的真client VM測試7案PASS；既有VM loader僅補真arena／replay模組與Object.create fixture的arenaRevision初始化，保留原案例／斷言。
- 舊33套首次整合24套PASS／9套FAIL、共393案，完整保留於 `tools/dev-tests/evolution-legacy-1794975105916-d645fc83`。缺少新依賴的VM補真模組／新欄位；時間fixture將注入時鐘同步至既有9999／10000ms等邊界，未放寬期限。唯一修改的舊斷言是 `tenpack-multiplayer-server.mjs` 對完整capabilities的 `deepEqual`：經root明確授權，在原四旗標之外加入本輪 `nexusArena:true`、`replay:true`，仍精確比對，未移除舊能力、案例或固定回歸基準。最終完整33套／393案PASS、產品來源不變、歷史報告保留，證據 `tools/dev-tests/evolution-legacy-1794975808415-01bc550c`；另原26套、Horizon87案、Evolution91案均PASS。詳見 `NEXUS_VALIDATION.md` 與 `NEXUS_TEST_HARNESS_AUDIT.md`。
- 真手機、真手把、真人平衡與樂趣、外網四人連賽、長時間效能與美術觀感未驗證。桌面尺寸模擬不代表真手機。新玩法需要前後端同步更新。

未修改Git、原專案、Render／Vercel／Origin，未使用正式站測試。
