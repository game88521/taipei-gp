# 台北街道賽 Taipei Street GP

手機瀏覽器就能玩的 F1 風格計時賽，跑在**真實的台北信義區街道**上：
信義路 → 基隆路 → 忠孝東路 → 松仁路，一圈 3.1 km，起跑線在 101 前。
Vite + TypeScript + Three.js；道路與 5,000 多棟建築來自 OpenStreetMap，貼圖、車子、音效全部用程式產生，沒有素材檔。

地圖資料 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 貢獻者，以 ODbL 授權。

## 跑起來

```
npm install
npm run dev          # 會印出 Network 網址，手機連同一個 Wi-Fi 開那個網址
npm run build        # 輸出到 dist/，推上 GitHub 後 Vercel 會自動部署
npm run check-track  # 賽道健檢：長度、最急彎、路段是否靠太近
```

## 地圖資料流程（只有要改路線或更新地圖時才需要）

```
npm run fetch-osm    # 從 Overpass API 下載信義區周邊 → tools/osm-raw.json（7 MB，不進 git）
npm run build-city   # 轉成 src/data/track.json（賽道）與 public/data/city.json（建築、道路、綠地、樹）
npm run plan         # 輸出 tools/plan.svg 平面圖，檢查賽道有沒有對準真實道路
```

`tools/build-city.mjs` 的重點：
- **賽道**：每一邊取那條路「行車方向正確」的車道，每 8 m 平均成一條線；路口直角修成半徑 24 m 的圓弧，再往中央分隔島平移 2.5 m。
  基隆路往北過了松壽路之後主車道進了車行地下道，所以直接取道路的平面走向，不照實際的地下道／單行規定找路。
- **建築**：輪廓 + 高度（`height`，沒有就用樓層數 × 3.3 m）；有 `building:part` 的建築改畫各部件。
  壓到賽道的建築會刪掉。101 的塔身在 `src/city.ts` 用竹節造型重做（OSM 只有一根方柱），裙樓照 OSM。
- **行道樹**：OSM 有標的樹 + 主要道路兩側每 11 m 一棵 + 公園裡隨機撒。

## 離線快取（Service Worker）

`npm run build` 會自動產生 `dist/sw.js`（範本在 `src/sw-template.js`，產生邏輯在 `vite.config.ts`），街景資料也會一起快取。
玩過一次之後第二次開幾乎瞬間載入，沒網路也能玩；任何檔案改了版本號就會變，手機下次開啟自動換新版。
`npm run dev` 時不會註冊，避免改了程式碼看不到。

## 操作

- 手機（橫向）：左下拖曳轉向、右下按住煞車，油門自動
- 電腦：← → / A D 轉向，↓ / S / 空白鍵煞車，Esc 暫停
- 選單可開關：傾斜手機轉向、行車輔助線、影子車、音效

## 測試網址參數

- `?bot`：自動駕駛（照建議速度開）
- `?bot&sim=60`：街景載入後直接模擬 60 秒，圈速寫在分頁標題，給無頭瀏覽器測用
- `&cam=x,y,z,lx,ly,lz`：固定鏡頭位置與看的點（截圖檢查街景用），例如 `?bot&sim=1&cam=560,4,520,263,200,393` 從信義路看 101

## 程式結構

| 檔案 | 內容 |
|---|---|
| `src/track.ts` | 讀賽道、取樣、曲率、建議速度曲線、車子性能常數 |
| `src/world.ts` | 賽道路面、路緣、護牆看板、起點門架、路燈、天空與光線 |
| `src/city.ts` | 真實街景：建築外牆（公寓／玻璃帷幕／公家）、店面、直式招牌、道路、綠地、行道樹、101 |
| `src/car.ts` | 街機式物理（抓地力隨速度上升、撞牆處理） |
| `src/carModel.ts` | 低多邊形 F1 車模 |
| `src/input.ts` | 觸控 / 鍵盤 / 陀螺儀 |
| `src/audio.ts` | Web Audio 合成引擎聲、撞擊、起跑燈嗶聲 |
| `src/main.ts` | 遊戲流程、計時、分段、影子車、鏡頭、HUD |

調手感：`track.ts` 最上面的 `VMAX`、`ENGINE`、`BRAKE`、`gripAt()`。
