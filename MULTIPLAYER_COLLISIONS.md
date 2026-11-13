# 多人車輛碰撞

2～4 人私人競速的玩家車輛會互相撞到，適用台北與全部 23 條 GP 地圖。追撞會讓後車減速並推動前車，側擦會推開車身；高速接近使用掃掠檢查，降低單幀穿車。橋上與橋下依高度分層，護牆仍沿用既有車輛物理。

伺服器在每個 60Hz 步進先更新所有車，再解同房車輛碰撞，最後以碰撞後的位置計圈、排名及完賽。倒數、未載入、斷線、完賽及 DNF 車不阻擋其他玩家。客戶端仍只傳方向／煞車，不能傳位置或碰撞結果。

共用碰撞器位於 shared/multiplayer-collisions.ts，車身 OBB 半長 2.6m、半寬 0.95m，高度容許 1.5m，低回彈 0.05。這是私人競速的車身阻擋與速度傳遞，沒有車損、維修、處罰或撞擊音效。

前端對碰撞採用權威姿態修正，並在附近車輛之間對齊預測時間，避免自車預測穿過停留在舊快照的對手。伺服器保持最終裁定；本地預測不更動房間快照，不寫單人存檔。

## 相容性與發布

JSON 訊息結構維持 protocol version 2；physics 改為 **classic-multitrack-collisions-v3**。舊 classic-multitrack-v2 前端會被拒絕。前後端必須以同一份來源建置並一起更新；本輪尚未公開部署。24 圖版 f586ca9 的已部署狀態保留，不代表本輪碰撞已上線。

## 本機驗證

先 npm run build，再執行：

```powershell
node tools/dev-tests/multiplayer-collision-physics.mjs
node tools/dev-tests/multiplayer-collision-server-regression.mjs
node tools/dev-tests/multiplayer-collision-client-regression.mjs
node tools/dev-tests/multiplayer-collision-browser.mjs
node tools/dev-tests/multiplayer-maps-fixed.mjs
```

瀏覽器測試使用既有專用 Chrome CDP 9334，建立並清理自己的隔離 context；不測正式站。結果與限制見 [MULTIPLAYER_COLLISIONS_VALIDATION.md](./MULTIPLAYER_COLLISIONS_VALIDATION.md)。手機實機、不同網路延遲與外網碰撞尚未驗證。
