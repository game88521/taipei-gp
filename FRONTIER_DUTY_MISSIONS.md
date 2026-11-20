# 第10項：多事故合作救援

作者：Rex <game88521@gmail.com>。本機實作，未 commit、push 或部署。本文件與各項收據分開記錄；最終整合狀態見 HANDOFF。

房主可於大廳選信安街、市民大道、松山路1～3件不同事故，以及協作入門／標準勤務／精準定位。每件都走完整八階段：前往、警示、定位、絞盤、固定、滿載返站、卸載，再接下一案。同一輛權威長平板車持續出勤，換案不傳送、不回復完整度。每件最多30分鐘 active 時間，三件最多90分鐘；隊員斷線原15秒期間不模擬作業。原單件預設與單人定速拉力保留。

三難度的停靠半徑為4／3／2.2公尺，角度容許約25.8／17.2／9.2度，停穩1／1.5／2秒，速限0.6／0.4／0.25m/s，同層1.2／1／0.8公尺，滿載碰撞損傷倍率0.6／1／1.4。完整路線順序門仍須通過，不能只開到事故座標。

大廳房主可交換下場司機／協助者；房主身分不變，兩人須在線、清準備與舊操控世代後重新確認。進行中、觀眾、舊 revision/runId 指令均不能修改事故或換角色。`city-duty-v2` 與 `dutyMissionsVersion` 明示前後端必須同步更新。

新增 `taipei-gp-frontier-crew-v2` 保存最近30場完整多案結果，上限100000 UTF8 bytes。嚴格核對事故順序、各案／總秒數、完整度與兩種角色。原單件 key 不遷移；只有單件結果繼續寫舊格式，多件結果不塞入舊1801秒解析器。壞原文、跨頁變更、quota與寫入讀回衝突皆明示；仍可原生下載本場 v2 JSON。原文比對是衝突保護，沒有宣稱跨頁原子交易。私席不納備份。

道路驗證使用真有向路網與真長車：空載mass4.5／滿載7.2、wheelbase4.5與五圓碰撞形狀。市民去程繞經車站5，避開原直線路段護欄；信安返程經真節點6010，從現場停靠朝向直接離場，避免初始180度迴轉。六腿各僅一次「停靠後出發」fixture，之後僅操控／真 update，不注入位置或檢查點：39/39、72/72、127/127、87/87、79/79、83/83門，全數零撞，終點距9.897～9.968m。收據 `frontier-duty-roads-evidence-1795186511323`。這證明路線可行，抵達時約3m/s，沒有冒稱真人精準停靠或連續全作業實測。原5PASS／1FAIL護欄與候選via4246失敗證據均保留。

Node 10PASS涵蓋權限、難度、三案完整作業 fixture、不換car／不傳送、換職責、結果與Storage，以及第二件獨立30分鐘邊界。作業案明示在各站順序停靠及門游標 fixture；道路證據另列。舊勤務14、觀戰6、回放7、續接14PASS。瀏覽器整合與最後build／固定回歸仍以最終收據為準；沒有真手機、跨網路或真人90分鐘長測。

## 真瀏覽器整合證據

`node tools/dev-tests/frontier-duty-missions-browser.mjs` 在 build `864be4d1d7b8` 為 **9 PASS／0 FAIL**，來源與測試腳本 hash 在測試期間不變、cleanup 完整、外網請求與瀏覽器例外皆為 0。原始收據：`tools/dev-tests/frontier-duty-missions-browser-evidence-1795188198541/report.json`；最新彙整：`tools/dev-tests/frontier-duty-missions-browser-result.json`。

兩個獨立 Chrome context 經玩法目錄真入口及 loopback WebSocket 建房加入。房主選三案與精準定位，改設定及交換職責皆清除準備，非房主交換被拒；換職後新司機以真 CDP 油門移動同一長平板車 `1.1264688314679454 m`。三案依序完成警示、定位、側修絞盤、固定、返程與卸載，完整度均為 100；同一 car／geometry 持續使用，勤務中產品 `place` 呼叫為 0。兩頁各只有 1 筆新紀錄、舊 crew 原文保留，原生下載 `taipei-expedition-duty.json` 通過嚴格解析。下場交換及離房清理通過；原 spec／geometry 參照、姿態、天候、導航與單人資料還原，0 房間、席位憑證清除，房主點真「繼續」回到 `free`。

六次精準停靠及順序門游標是**明示的服務端 fixture**；1827 次真 `service.step` 以每步 `1/30 s` 加速作業，沒有宣稱瀏覽器以操控跑完六條道路，也沒有實際等待每次絞盤九秒。道路可行性仍由前述六腿純操控 Node 收據證明。設定與作業 HUD 各驗證 390×844、844×390、844×220，屬桌面尺寸模擬。借車前的合法 geometry 標記與舊紀錄也屬還原／相容性 fixture；沒有真手機、外網或真人完整勤務長測。

首輪 **5 PASS／1 FAIL** 保留於 `frontier-duty-missions-browser-evidence-1795187903123/report.json` 及 `frontier-duty-missions-browser-before-result.json`：測試錯誤要求已 `finished` 的房間繼續處理 `operate:stop`，而服務已完成三案並拒絕後續作業命令。修正測試為僅 `running` 等待 stop；完賽則驗證車速／角速為 0，並以真 `service.tick` 的明示 `+1000 ms` 時間驗證位置、elapsed、完整度與結算完全凍結，未放寬進行中的放開即停止斷言。

## 最終統一回歸

2026-11-21 本輪build **caeeecc35bef**已完成34套Node／服務、14套瀏覽器與固定三基準，詳見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。本段是最後封版狀態；上文各次build、待root與before FAIL保留開發當時事實，未改寫原始證據。PASS只涵蓋本機實作與驗證；真機／外網／完整真人駕駛限制依統一報告，沒有commit、push或部署。
