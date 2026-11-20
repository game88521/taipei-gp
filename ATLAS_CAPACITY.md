# Atlas 容量與資源量測

署名：Rex <game88521@gmail.com>

兩個獨立Node進程使用同一支probe、真loopback WS與真城市184 tiles，比較已封存Summit與目前Atlas。兩個負載階段各30模擬秒，真控制輸入駕駛；背景另有GP2人與合作2人，表中4／8車指城市競速車數。

|版本|階段|結束RSS MiB|CPU單核%|combined tick p95 ms|sockets|
|---|---|---:|---:|---:|---:|
|atlas|empty|274.06|0.000|0.088|0|
|atlas|city-1-room-4-cars-plus-gp2-coop2|319.18|107.805|3.351|8|
|atlas|city-2-rooms-8-cars-plus-gp2-coop2|321.93|100.426|2.826|12|
|atlas|after-disconnect-and-grace-cleanup|322.92|0.000|0.078|0|
|summit|empty|262.27|3.486|0.035|0|
|summit|city-1-room-4-cars-plus-gp2-coop2|312.52|49.267|1.668|8|
|summit|city-2-rooms-8-cars-plus-gp2-coop2|315.98|79.750|1.766|12|
|summit|after-disconnect-and-grace-cleanup|317.03|0.000|0.037|0|

Atlas預熱1183.932ms、預熱後RSS 273.98MiB；Summit為726.015ms／268.25MiB。Atlas合作與城市競速共用一份world／Collider。此比較同時含合作由pose改權威物理等行為差異，不能把差值都歸因為單一最佳化。

容量環境變數：`ATLAS_GP_ROOMS`預設12（1～100）、`ATLAS_COOP_ROOMS`預設4（1～24）、`ATLAS_CITY_ROOMS`預設4（1～24）、`ATLAS_MAX_CONNECTIONS`預設64（1～256）。這些是程式上限；共用連線額滿會拒絕新連線，不代表免費主機能承受。`/health`列容量、RSS／high-water、heap、CPU及各服務最近600個tick的p50／p95／max，零樣本為null；事件迴圈另列樣本與延遲。

容量為加速手動tick，兩個有負載階段各30個模擬秒，包含GP2人與合作2人背景房；CPU包含同一process的本機WS客戶端與IO，RSS為階段採樣而非持續峰值。這不是30秒實時壓測、長期洩漏證明或免費主機承載量。清理證明房／席位／socket歸零，不要求V8立即歸還RSS。

原始來源、script SHA、各階段數值、真物理步數、移動距離與清理記在驗證JSON的capacity records；未用本表決定公開部署容量。

容量報告的來源hash精確綁定七個服務／協定／城市物理檔，沒有捕捉完整依賴樹與atlas-runtime本身；其餘依賴如有變更須重測，不能把這份比較宣稱為完整產品的效能封存。
