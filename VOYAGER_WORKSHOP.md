# Voyager：道路救援、公車服務與工坊幽靈

署名：Rex <game88521@gmail.com>

本文件對應 `TAIPEI_NEXT_OPTIONS_AFTER_ATLAS_2026-11-19.md` 新編號 **9、10、11**。以 Atlas build `205d0c8df91e` 為 before；不重列已完成的 NG1／NG2 工坊、三條乘客服務線或長軸勤務車。整合 build、全套回歸、瀏覽器與原專案套用結果以本輪根交接及驗證清單為準。本文件不代表已提交、推送、部署或套回原專案。

## 9．三案件道路救援

在城市選單進入「公車勤務／平板道路救援」，選案件卡後按「接道路救援」。每張卡顯示從真路網計算的往返路程、難度與估時：

| 案件 | 真道路往返 | 估時 | 第一版流程 |
|---|---:|---:|---|
| 信安街熄火救援 | 2,595.224m | 333秒 | 警示→定位→固定→載回→卸車 |
| 基隆路故障回送 | 4,227.277m | 530秒 | 同上 |
| 市民大道車輛回收 | 5,062.398m | 630秒 | 同上 |

每段沿真 Router 選擇單行路網；靠站要求依序經過路線檢查點、同層、距離2.5m內、車頭誤差0.18rad內、速度低於0.3m/s並停穩1.5秒。警示與定位各2秒，固定與卸車各4秒。作業中鎖車；離位取消該次作業並保留階段，重新停妥後才能繼續。警示完成後顯示警示三角形，完成固定才顯示平台故障車。

滿載會真正改變同一輛 FreeCar 的加速、極速、煞車、抓地、質量與轉動慣量；完整度會受衝擊及過度加減速影響。卸車完成回空載，退出勤務還原原車規格、車體幾何與位置。新案件用獨立勤務紀錄，新增 `rescue:{caseId,secured:true}`；中止、超時或位置不連續不結算。單趟單人、固定三案，不包含繩索物理或任意城市事故產生器。

原 `buildDutyPlan(router, kind)` 的 practice 計畫逐欄保持 before；新案件由第三參數案件 ID 啟用。

## 10．南城接駁線下車鈴與無障礙服務

在同一勤務頁勾選「南城接駁線：下車鈴字幕與輪椅坡板服務」會選取既有南城接駁線。其他既有線及原 practice 仍可選；切換其他線會取消此選項。班表預告每站上下車及輪椅需求，輪椅乘客包含在原乘客需求內，沿用32人容量。

到站依原方向與停穩規則開門，再按「展開輪椅坡板」。展板2秒、原乘客服務時間另加6秒、收板2秒，最後明確關門才一次結算乘客。等待尚未完成時不能先收板或關門；車門／坡板作業期間鎖車。第一站上一位輪椅乘客，返站下車，返站總乘客及輪椅人數均歸零。後一站預定到達時間增加前站的10秒服務，總估時增加20秒。

每段接近下一站且有人下車時，下車鈴最多一次，HUD字幕含下一站、預定下車人數與輪椅需求。聲音由 `mountSummitDuty` 可選 `bell()` 接到現有 `sound.beep(880,.18)`，沿用聲音解鎖與音量設定；沒有另建 AudioContext。新增紀錄 `accessibility:{wheelchairBoarded,wheelchairAlighted,bells}`，仍使用 `taipei-gp-summit-duty-v1`，舊勤務紀錄可讀。沒有新增3D乘客。

## 11．工坊最佳有效幽靈

進入「城市挑戰工坊」，幽靈面板可選自己的最佳或本頁匯入的朋友檔。只有成功且未超過5分鐘的有效挑戰會錄製；固定5Hz，每200ms一筆，最多1,501筆。超過5分鐘仍保留工坊成績，但不保存截斷幽靈。重新挑戰會建立新錄製器，離開／啟動例外會移除並釋放自有幽靈模型。

每個完整 canonical NG1／NG2 分享碼保留一條最佳軌跡；路線、地圖版本、車款、天候、圈數、分段、名稱或目標不同均分開。幽靈只作半透明視覺比較，不加入碰撞或改變裁定，可在編輯器及駕駛HUD關閉。沒有改動 TT 好友影子、原 NG 編碼、工坊成績格式或正式成績／錢包。

單檔 JSON 上限250,000 bytes，整庫上限2,000,000 bytes、最多12條不同路線；滿庫拒絕新增並顯示原因，可在面板管理並明確刪除任一舊路線。匯出只含挑戰碼、時間與軌跡。匯入先檢查完整 schema、canonical碼、抽樣時間、有限數值、位移／高度上限，不自動起跑。不同設定會提示；按「載入朋友路線設定」後仍須通過目前路網驗證，並由玩家按開始。朋友檔只在記憶體，不替換自己的最佳。

新模組 `src/voyager-workshop-ghost.ts` 提供 `WorkshopGhostRecorder`、`WorkshopGhostLibrary`、`parseWorkshopGhost`、`parseWorkshopGhostStorage`、`ghostCompatible`、`workshopGhostAt`。整包備份應以 exported parser 驗證新 slot `taipei-gp-voyager-workshop-ghost-v1`。讀到損壞或超量舊資料會保留原文並停止覆寫；quota寫入失敗則明示僅保留在本頁，可先下載。`mountNexusWorkshop` 回傳 `ghostLibrary` 與非駕駛中才可呼叫的 `reloadGhosts()`，供成功還原後刷新。

幽靈檔是玩家可編輯的本機比較資料，沒有伺服器簽名，不是全球排行榜或可信競技成績。

## 已跑的分支驗證與整合待跑

在工作副本已實跑：

- `tsc --noEmit`：PASS。
- `node tools/dev-tests/voyager-workshop-models.mjs`：23 PASS／0 FAIL。
- `node --check tools/dev-tests/voyager-workshop-browser.mjs`：PASS；瀏覽器 runner 尚待根代理串行實跑，不能把語法檢查當瀏覽器通過。

模型報告為 `tools/dev-tests/voyager-workshop-models-result.json`，含 before／after source SHA256、script SHA256及執行期間不變檢查。根代理會在整合副本重新執行，不將本分支報告當交付產品。

模型真值包括三案件真 Router 往返及入站方向；兩段各100m明示直線 fixture 的真 FreeCar 完整救援45.783秒、公車輪椅98.975秒；120節點明示圓環的真 WorkshopRun／FreeCar 成功圈64.362秒、322筆5Hz。空載4秒行駛32.570m、滿載23.341m；15m/s起煞1.2秒後空載2.955m/s、滿載5.585m/s。這些是可重現的受控 fixture，不是完整城市真人或平衡性驗收。

瀏覽器 runner 宣告7案，使用本機preview 4426埠及現有9334 CDP，獨立 context、外請求封鎖、唯一證據資料夾、真下載／真檔案輸入與cleanup。先讀真案件UI，再明示使用平坦200m／圓環 fixture 並停自動動畫迴圈，仍執行真 FreeCar、CityDutyRun／WorkshopRun、產品UI按鈕、錄製及儲存。只在此測試內略過真城市 surface／collider；未宣稱完整城市碰撞驗收。兩次相同圓環的無幽靈／顯示幽靈結果應完全相同，並檢查重試錄製、字幕、坡板、主檔／TT隔離、390×844與844×390的44px操作及無橫溢。

根整合還必須跑完整 build、多人build、歷史回歸與AGENTS三個固定基準。真Android／iPhone、真手把、真人完整勤務、外網、長期負載與舒適度仍未驗。未操作Git、Render、Vercel或正式站。
