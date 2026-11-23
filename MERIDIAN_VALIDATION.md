# Meridian 十二項本機驗證

作者：Rex <game88521@gmail.com>

本機build `862f7f9c9857`；承接未提交Aurora `bdc4e4bc9821`，HEAD `c56ca26e04bb1f39c144a93454ae1bc8d09d6737`。沒有commit、push或部署。原案套回以 `DCISI/taipei-gp-meridian-delivery/apply-result-latest.json` 的APPLIED_BUILD_VERIFIED獨立核對。

新增Node 84案、五套瀏覽器 28案、既有回歸 87案與固定基準3案通過。

| 測試 | PASS | FAIL |
|---|---:|---:|
| meridian-platform-node | 5 | 0 |
| meridian-backup-node | 4 | 0 |
| meridian-racing-node | 11 | 0 |
| meridian-city-models | 15 | 0 |
| meridian-city-node | 12 | 0 |
| meridian-city-client-node | 7 | 0 |
| meridian-city-road-prime-fixed | 2 | 0 |
| meridian-checkpoints-node | 7 | 0 |
| meridian-checkpoint-client-node | 5 | 0 |
| meridian-social-node | 7 | 0 |
| meridian-navigator-node | 9 | 0 |
| meridian-platform-browser | 5 | 0 |
| meridian-racing-browser | 5 | 0 |
| meridian-social-browser | 6 | 0 |
| meridian-city-browser | 10 | 0 |
| meridian-city-save-hud-browser-fixed | 2 | 0 |
| aurora-city-models | 8 | 0 |
| aurora-platform-node | 13 | 0 |
| aurora-racing-node | 14 | 0 |
| aurora-duty-node | 9 | 0 |
| aurora-social-node | 9 | 0 |
| frontier-rally-node | 17 | 0 |
| frontier-performance-history-node | 17 | 0 |

資源：兩個編輯器延後 8249 gzip bytes；首次預快取排除，完整離線包包含。伺服器打包靜態閉包：74模組／249依賴／188資產，未跑Docker。

```text
=== baseline1
BOT lap2 54.425 hits=0
aiHits 0
PASS: baseline1
=== baseline2
GP P10 陳冠宇:162.0 王柏翰:162.9 吳俊傑:163.0 黃子軒:164.9 林志豪:165.7 張家瑋:165.9 劉宇翔:166.0 蔡明哲:166.2 李承恩:166.5 你:166.9 謝承翰:- 許書豪:- 鄭宇辰:- 郭彥廷:- 洪志明:- 楊凱文:- 邱冠廷:- 廖哲瑋:- 曾柏宇:- 周家豪:- 賴俊宏:- 葉子豪:- DRS區3 回放167s 安全車無 濕0.00 雨胎0台 無線電13則（燈號熄滅！第一個彎小心，別跟人擠／後面的 鄭宇辰 在 1 秒內，守住內線／許書豪 很會卡位，先假裝走一邊、等他換線再從另一邊過／漂亮！上到第 11 名／漂亮！上到第 9 名／後面的 蔡明哲 在 1 秒內，守住內線／漂亮！上到第 10 名／後面的 蔡明哲 在 1 秒內，守住內線／漂亮！上到第 10 名／最後一圈！全力推！／後面的 李承恩 在 1 秒內，守住內線／漂亮！上到第 9 名／後面的 謝承翰 在 1 秒內，他很敢晚煞車，進彎前守好內線）
aiHits 8
PASS: baseline2
=== baseline3
GP P22 陳冠宇:175.7(進1 2.0s) 王柏翰:177.3(進1 2.3s) 吳俊傑:180.0(進1 2.8s) 張家瑋:183.3(進1 2.2s) 黃子軒:185.5(進1 2.4s) 林志豪:186.9(進1 2.5s) 許書豪:188.3(進1 2.5s) 蔡明哲:189.4(進1 2.5s) 洪志明:191.3(進1 2.3s) 劉宇翔:192.4(進1 2.5s) 郭彥廷:195.5(進1 2.2s) 李承恩:198.2(進1 2.3s) 楊凱文:200.2(進1 2.0s) 鄭宇辰:201.4(進1 2.4s) 邱冠廷:203.1(進1 2.1s) 謝承翰:204.4(進1 2.1s) 廖哲瑋:206.3(進1 9.1s) 曾柏宇:208.1(進1 2.8s) 周家豪:210.8(進1 3.3s) 賴俊宏:211.9(進1 2.9s) 葉子豪:213.2(進1 2.2s) 你:217.3(進1 2.2s) DRS區3 回放217s 安全車無 濕0.00 雨胎0台 無線電12則（燈號熄滅！第一個彎小心，別跟人擠／Box, box！這圈進站，選好要換的胎／後面的 鄭宇辰 在 1 秒內，守住內線／許書豪 很會卡位，先假裝走一邊、等他換線再從另一邊過／漂亮！上到第 11 名／漂亮！上到第 9 名／後面的 蔡明哲 在 1 秒內，守住內線／後面的 賴俊宏 在 1 秒內，他很敢晚煞車，進彎前守好內線／漂亮！上到第 20 名／廖哲瑋 很會卡位，先假裝走一邊、等他換線再從另一邊過／漂亮的停站，2.2 秒！／最後一圈！全力推！）
aiHits 5
PASS: baseline3
=== done: 3/3 PASS
```

四個駕駛核心與開始前capture的raw bytes相同。全部收據及來源hash見JSON；時間戳FAIL保留，修前對照不算新版PASS。早期racing Node有一次原始latest遺失，重建紀錄明確標示來源；測試selector／checkbox helper錯誤、儲存失敗HUD、紅燈恢復對照與修正均另記，不把失敗改寫成功。

整合驗收另修正NG3開始按鈕誤將MouseEvent當續玩參數、QR白框、公車續玩紅燈漏扣、連線中關閉工坊的遲到事件、接力HUD遭場景遮擋，以及候場／結算仍送駕駛封包。路線只對Math.atan2產生的start.h末位誤差允許1e-12，其他67個數值仍逐一精確拒變，NG3／領航拉力／城市競速共用。原始失敗、修前與修後收據分開保留。
城市測試補齊重載後有效路線、隔離context下載權限、跨socket全員ready確認及會前進的authority時鐘；凍結時鐘曾造成90/sec視窗不重設而1008關閉，沒有提高伺服器限制。賽道測試則等真實離房預覽載完再恢復，避免測試攔截器在中途取消的瓦片請求上回覆Invalid InterceptionId；原strict Fetch／JS錯誤判定保留，先前5案PASS但suite FAIL的證據沒有改寫。

限制：
- 只測本機 dist 4317 與 loopback WebSocket；隔離桌面Chrome contexts與viewport不代表實體手機或外網真人。
- 賽事晉級／交棒UI、城市終段／停靠／合作作業與影片事件部分使用明示fixture；真Car／FreeCar道路、真WS與控制另外驗證，不宣稱人工跑完全程。
- 真TT指令為轉向、煞車與自動加速模型；不是類比油門，參考走線不寫入PB。
- 效能資料是CPU回呼／提交採樣；8249 gzip bytes只指兩個編輯器延後量，不代表FPS、總啟動時間、GPU、耗電或溫度成效。
- 影片為真MediaRecorder編碼／解碼，受瀏覽器支援限制；Docker只靜態閉包，沒有image實測。
- 跨程序續局需要固定MERIDIAN_CHECKPOINT_SECRET；只驗簽章與原席權限，沒有持久防重播資料庫。
- 實體手機、真手把、外網多人、玩法平衡、免費主機四人容量及長時間GPU／溫度／耗電尚未驗證。

最後實機計畫見 [MERIDIAN_PHONE_TEST_PLAN.md](./MERIDIAN_PHONE_TEST_PLAN.md)，實機欄位仍未驗。
