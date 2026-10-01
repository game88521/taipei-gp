# 台北街道賽 Taipei Street GP

手機瀏覽器就能玩的 F1 風格計時賽：信義區一圈 2.6 km，繞著 101 跑。
Vite + TypeScript + Three.js，城市、招牌、車子、音效全部用程式產生，沒有任何素材檔。

## 跑起來

```
npm install
npm run dev        # 會印出 Network 網址，手機連同一個 Wi-Fi 開那個網址
npm run build      # 輸出到 dist/，可直接丟 Vercel / Cloudflare Pages
npm run check-track  # 改賽道後跑：長度、最急彎、路段是否靠太近
```

## 離線快取（Service Worker）

`npm run build` 會自動產生 `dist/sw.js`（範本在 `src/sw-template.js`，產生邏輯在 `vite.config.ts`）。
玩過一次之後第二次開幾乎瞬間載入，沒網路也能玩；任何檔案改了版本號就會變，手機下次開啟自動換新版。
`npm run dev` 時不會註冊，避免改了程式碼看不到。

## 操作

- 手機（橫向）：左下拖曳轉向、右下按住煞車，油門自動
- 電腦：← → / A D 轉向，↓ / S / 空白鍵煞車，Esc 暫停
- 選單可開關：傾斜手機轉向、行車輔助線、影子車、音效

## 測試網址參數

- `?bot`：自動駕駛（照建議速度開）
- `?bot&sim=60`：不等畫面直接模擬 60 秒，圈速寫在分頁標題，給無頭瀏覽器測用

## 程式結構

| 檔案 | 內容 |
|---|---|
| `src/track.ts` | 賽道控制點、取樣、曲率、建議速度曲線、車子性能常數 |
| `src/world.ts` | 路面、路緣、護牆看板、路燈、大樓、霓虹招牌、101、天空 |
| `src/car.ts` | 街機式物理（抓地力隨速度上升、撞牆處理） |
| `src/carModel.ts` | 低多邊形 F1 車模 |
| `src/input.ts` | 觸控 / 鍵盤 / 陀螺儀 |
| `src/audio.ts` | Web Audio 合成引擎聲、撞擊、起跑燈嗶聲 |
| `src/main.ts` | 遊戲流程、計時、分段、影子車、鏡頭、HUD |

調手感：`track.ts` 最上面的 `VMAX`、`ENGINE`、`BRAKE`、`gripAt()`；改賽道：`CONTROL` 陣列。
