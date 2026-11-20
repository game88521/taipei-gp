# Voyager 十二項改善與新玩法

署名：Rex <game88521@gmail.com>

本輪在DCISI/taipei-gp-voyager-work完成本機封版，build **bc5f6fdf669f**，承接已套回但未提交的Atlas 205d0c8df91e。尚未套回原專案，沒有commit、push或部署。來源／測試通過不等於成功套用或上線。

證據沿用已明示：browser／legacy-browser共17套與Voyager Node沿用修補前原PASS報告，未重跑或改寫。產品與dist逐檔完全相同；完整測試inventory只允許platform-regression.mjs由已封存Atlas舊hash改為審查過的Response預先構造fixture，保留100ms總期限／15ms閒置期限與全部斷言。原25通過／1失敗及stderr保留FAIL；修補收據650eb54e59f703abf4ca44829183b4ad36c02f6617253b6120085692271a8c51後已重新執行build、固定三與資源／容量、完整legacy及24交付工具fixture。其餘entry／helper與測試hash均完全一致。

| 項目 | 已實作行為 |
|---|---|
| 1．城市競速本車預測 | 真FreeCar固定60Hz、ack重播、受控平滑與失焦／續接世代。 |
| 2．按玩法離線包 | 自由駕駛與單人工坊完整依賴、184區塊、worker；逐檔hash／MIME驗證及真離線重啟。 |
| 3．HUD與舒適設定 | 資訊100／125／150%、高對比、固定FOV、關閉選單運鏡；觸控按鈕維持自訂尺寸。 |
| 4．城市線上多圈 | 閉合NG2的2～4人、1／3／5圈；正向同層gate於接觸後裁定與權威圈速。 |
| 5．多人自由練習 | GP地圖10／20分鐘、2～4人開場、可中途加入／離開／短暫續接、穿透與有效圈／分段。 |
| 6．多人天候預報 | 晴、雨、乾轉雨共用起跑時序，權威／預測／胎況／回放一致；legacy耐久曲線保留。 |
| 7．多人VSC | 房主手動、server80km/h、解除倒數3秒，超車只記錄不自動罰秒。 |
| 8．合作特殊貨運 | 兩急件＋兩易碎＋兩一般；server期限、碰撞／有效急煞貨況及最多1000分。 |
| 9．多案件道路救援 | 三真路網案件、警示／定位／固定／載回／卸車、完整度與空滿載操控差異。 |
| 10．公車無障礙服務 | 南城接駁線下車鈴字幕、輪椅坡板及開關門服務，沿用32人容量。 |
| 11．工坊最佳幽靈 | 每canonical路線最佳有效5Hz／最多5分鐘、半透明不碰撞、真檔匯出入、容量與舊資料保護。 |
| 12．照片與成績PNG | 單人暫停／已存回放構圖、恢復播放與鏡頭；結算卡含地圖、名次與圈時，只存本機。 |

入口與細節分見[城市](./VOYAGER_CITY.md)、[競速](./VOYAGER_RACING.md)、[勤務／幽靈](./VOYAGER_WORKSHOP.md)、[離線／畫面／照片](./VOYAGER_PLATFORM.md)。精確證據見[驗證](./VOYAGER_VALIDATION.md)及JSON。

新增大廳天候切換回歸：雨切回legacy會清除舊濕度，無耐久的一般房可立即被真client接受；legacy耐久起跑後仍走原乾→雨→乾曲線。

全部舊車與既有玩家資料保留，未操作Render／Vercel／Origin。真機、外網、長期負載及平衡按[最後驗收](./VOYAGER_PHONE_TEST_PLAN.md)處理。
