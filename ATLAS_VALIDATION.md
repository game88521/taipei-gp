# Atlas 本機封版驗證

署名：Rex <game88521@gmail.com>

Build **205d0c8df91e**；來源集合SHA256 **fd9157125e88309d652c3162b1a83c6065b4e741add8bf2c33994b8708d30724**。Fresh boundary：2026-11-18T09:29:46.049Z。所有數字取自當前來源綁定的實際報告，未預填通過數。

|執行階段|通過套數|根收據|
|---|---:|---|
|node|7套|`taipei-gp-atlas-final-node.json`|
|atlas|1套|`taipei-gp-atlas-final-atlas.json`|
|browser|5套|`taipei-gp-atlas-final-browser.json`|
|legacy-browser|7套|`taipei-gp-atlas-final-legacy-browser.json`|
|fixed|2套|`taipei-gp-atlas-final-fixed.json`|

逐案Node報告96套／1146列；browser 12套／93案；固定三基準3項；安全交付fixture 20案。原報告覆蓋可能重疊，不能相加當成獨立功能數。容量是MEASURED比較資料，不混入PASS測試數。

封版逐一核對5階段完整suite順序、exit code、fresh報告hash、唯一證據副本、來源／測試／dist全檔hash、當前build、截圖PNG與清理；Node聚合器還核對各子報告與執行腳本。受控build收據記真exit與stdout／stderr／log hashes。761檔immutable before、全部歷史文件、四核心與原server physics保持原bytes，HANDOFF原bytes完整保留為suffix。

固定結果：BOT lap2 54.425 hits=0／aiHits0；陳冠宇162.0／aiHits8；pittest175.7／aiHits5。新舊協定需同步更新，詳[ATLAS_MULTIPLAYER_CONTRACT.md](./ATLAS_MULTIPLAYER_CONTRACT.md)及賽道對戰文件。

- 只有本機隔離副本與loopback驗證；未測正式站、Render／Vercel、外網真人、真手機、真手把或免費主機。文件封版不等於套回、提交或上版。
- 容量為加速手動tick，兩個有負載階段各30個模擬秒，包含GP2人與合作2人背景房；CPU包含同一process的本機WS客戶端與IO，RSS為階段採樣而非持續峰值。這不是30秒實時壓測、長期洩漏證明或免費主機承載量。清理證明房／席位／socket歸零，不要求V8立即歸還RSS。
- 三難度×24圖單車完整圈與台北混合三圈賽由模型報告記錄；不能據此宣稱所有地圖長時間多人賽、零碰撞或真人難度平衡。
- 車損、旗號、維修靠位及中繼站瀏覽器操作包含明示server fixture；不冒稱真人完整跨城或全程自行進站。碰撞事件不判肇責，旗號不自動處罰。
- 公車三條2.60／4.23／6.19km真路線未全程真人驗收；乘客是人數模型，沒有3D乘客／背景車流。完整上下車與工坊1／3／5圈使用明示真物理fixture。
- 合作與城市競速的server權威輸入、版本與pose guard仍不代表完整防作弊。NG2多圈目前限單人；城市連線明確只接受NG1。
- 整包還原需要瀏覽器Web Locks及關閉其他目前版本遊戲頁；任意舊版頁面、擴充套件或外部寫入不受新頁面鎖協定控制。匯出不代表已保存下載，操作前仍須確認備份檔。
- 入口資源byte／gzip是實際檔案大小，不是裝置載入速度、FPS、耗電或記憶體；可選模組仍於首次使用下載。Docker實際建置／執行未驗。
- 容量報告的來源hash精確綁定七個服務／協定／城市物理檔，沒有捕捉完整依賴樹與atlas-runtime本身；其餘依賴如有變更須重測，不能把這份比較宣稱為完整產品的效能封存。

完整逐檔hash、真報告與比較值見[ATLAS_VALIDATION.json](./ATLAS_VALIDATION.json)。

城市競速修正收包wall時間比固定物理tick略新時，誤把有效油門當作idle而反覆阻尼；相同30Hz輸入／60Hz真FreeCar的5個模擬秒，+2ms相位由0.66458m恢復為93.21462m，並保留700ms過期與active:false煞停。另修正按脫困後焦點停在按鈕而阻擋鍵盤：產品會將焦點交回有標籤的遊戲畫布，瀏覽器案檢查焦點後才實際鍵盤駛過全部gates。原始29 PASS／1 FAIL對照（含前版來源hash）與修後Node／瀏覽器報告保存在ATLAS_VALIDATION.json的regression-before、atlas-city-server及summit-city-race-browser records；原始預期失敗不計入PASS總數。
