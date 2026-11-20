# Voyager 多人契約

署名：Rex <game88521@gmail.com>

前後端需同步更新；本文件不表示已部署。

- 城市為city-race-v3，席位key taipei-gp-city-race-seat-v3；motionRevision隔離起跑／再戰／續接／脫困的輸入，ack僅在物理tick執行後前進。正向、同層gates與圈速由server裁定；NG1舊碼bytes保留，NG2限閉合1／3／5圈、2～4人及600秒。
- 合作為COOP_VERSION=4與seat-v4；direct／relay保留，special固定兩急件、兩易碎、兩一般。急件首領起六分鐘，退貨不重計；貨況不因退貨修復。server逐單與隊員分數去重並嚴格校驗。
- 賽道沿用wire2／classic-multitrack-collisions-v3，新增voyagerRacing:true及voyager-racing-v1。set-voyager綁roomCode與大廳revision；VSC另綁match／trackRevision／seq。未知欄位、錯世代及能力不相容拒絕。
- 自由練習10／20分鐘、只GP圖及真人一般房、無碰撞；中途加入第一圈無效。有效最快與三段最佳獨立，分段不合成虛假整圈。到時立即結算另列practice歷史；正賽仍拒絕中途加入。
- 晴／固定雨／乾轉雨共用startAt，乾轉雨2:00開始、3:00全雨；legacy耐久保持舊曲線。大廳切換先重設起始濕度，避免把上次固定雨當legacy現況。
- VSC由房主預先允許並於正賽／耐久啟動，權威與prediction80km/h，三秒恢復期仍限速。禁超車只提示與記錄，不自動加秒／判肇責。
- 正賽回放schema4嚴格保存濕度／VSC／匿名driver ids，仍讀1／2／3；練習可變名單不產生固定名單正賽回放。照片只用獨立已存viewer，不暫停線上房或送駕駛input。
- 整包備份為17分類，新增comfort與workshop ghost；仍讀15分類並保留缺少的新類，憑證不進備份。幽靈可編輯且無server簽名，非可信競技榜。

不改部署設定、ALLOWED_ORIGINS或正式站。外網真人延遲與長期主機負載尚未驗證。
