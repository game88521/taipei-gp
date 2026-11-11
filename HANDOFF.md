> 上版執行紀錄：2026-11-11 09:41:33（本機時間）。整合補丁已套用原專案；正式產物與已驗證副本一致，三項固定回歸通過。下方「尚未套用／未提交」文字為先前交接的歷史狀態。commit、push 與平台部署結果請見 DCISI/taipei-gp-release-result.json。

> 最新更新：2026-11-10。四輪優化已在 DCISI 工作副本完成；本輪六項體驗與三項回歸通過。原專案未套用、沒有 commit／push。最新詳情見文末「Codex 工作副本整合交接」；下方原始交接保留作為歷史與規則。

# 交接文件：台北街道賽（Claude Code → Codex）

最後更新：2026-11-10　｜　HEAD：`cc79663`（已推到 `origin/main`，Vercel 自動部署）

Rex 的私人手機賽車遊戲，Vite + TypeScript（strict）+ Three.js r0.186。跟 IBM／DCISI 工作無關。
Rex 目前要繼續做的是**優化**。這份文件寫的是：怎麼跑、什麼不能動、已經做了什麼、還剩什麼。

---

## 0. 先看這幾條（違反會出事）

1. **回覆用繁體中文**。程式碼、檔名、API 路徑維持原文。commit 訊息也用繁體中文。
2. **git 署名**：`Rex <game88521@gmail.com>`，GitHub 帳號 `game88521`（repo：`game88521/taipei-gp`）。**不要用 IBM 信箱**，也不要用全域設定。
   提交時用 `git -c user.name=Rex -c user.email=game88521@gmail.com commit ...`。
3. **只用虛構名稱**：不可以出現真實車廠、車隊、贊助商、商標（例：車隊是「躍馬紅」「銀箭」「木瓜橘」，紅牛環叫「史匹堡」）。
4. **不要拿線上站（taipei-gp.vercel.app）做測試**：連續打會觸發 Vercel Security Checkpoint（403）。只在本機 `vite preview` 測。
5. **不要未經 Rex 同意就 push**。push 到 `main` 會直接部署到線上。
6. **手機實機測試排在最後**（Rex 說「先繼續優化，最後再用手機測」）。清單在 `tools/dev-tests/phone-test-plan.md`。
7. **如實回報**：測試失敗就貼數字，沒驗證的就寫「沒驗證」，推論要標「推論」。

---

## 1. 環境與常用指令

專案路徑：`C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\Rex\taipei-gp`（獨立 git repo，分支 `main`）。

```bash
npm run build          # = tsc --noEmit && vite build；同時產生 dist/sw.js（版本＝dist 內容雜湊）
npx vite build         # 只打包（測試用，快）
npx vite preview --port 4317 --strictPort   # 測試伺服器，吃的是 dist
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4317/   # 每次測試前確認是 200
```

- **改完原始碼一定要重新 `npx vite build`**，因為 preview 吃的是 `dist`。
- 測試腳本出現 `__gp is not defined`，通常是 4317 伺服器死了，不是程式錯。到專案目錄背景重啟。
- 看 tsc 有沒有錯要讀輸出內容，不要用 `${PIPESTATUS[0]}`（在子殼層裡永遠是 0）。
- 檔案換行是 LF。要數換行請用 node 讀位元組，不要用 `grep -c $'\r'`（會誤判）。
- Windows + Git Bash：Bash 單次指令超過約 7 KB 會被截斷；`node -e` 裡內嵌正規式或跳脫字元容易把腳本弄壞，**寫腳本請用檔案寫入工具，不要用 shell 內嵌**。

---

## 2. 回歸基準（改任何東西後都要跑，必須一字不差）

```bash
cd tools/dev-tests && bash chain-stab.sh; cat chain-stab-out.txt
```
（約 5～8 分鐘，建議背景跑。需要 Chrome 在 `C:\Program Files\Google\Chrome\Application\chrome.exe`。）

| # | 網址參數 | 預期 |
|---|---|---|
| 1 | `bot&sim=120` | `BOT lap2 54.425 hits=0` |
| 2 | `bot&gp&sim=400` | 冠軍 陳冠宇 **162.0**，aiHits **8** |
| 3 | `bot&gp&pittest&sim=400` | 陳冠宇 **175.7**（各車停站秒數 2.0/2.3/2.8/2.2…），aiHits **5** |

另有 `?phys` 物理基準（甩尾 3 秒得分 2104、0–100 km/h 3.9 s 等），動到 `freecar.ts` 才需要。

**為什麼這些數字不會被「畫面／聲音」改動影響**：`?sim=N`（`runSim`）是同步模擬，只呼叫 `step()`，不跑 `updateVisuals` / `field.render` / `pitlane.update`；音效在 `sound.started=false` 時全部 no-op。所以純畫面或聲音的優化不該動到基準。
**什麼會動到基準**：任何碰 `rivals.ts` 的車速/碰撞/進站邏輯、`car.ts`、`track.ts`，或在模擬路徑上新增 `Math.random()` 呼叫、改變 `pitRnd`（種子 11 的 LCG）的呼叫次數或順序。基準對不上就**回報，不要改基準**。

---

## 3. 測試工具（`tools/dev-tests/`）

| 檔案 | 用途 |
|---|---|
| `run-one.sh 腳本 參數…` | 開一個新的無頭 Chrome（port 9333），跑完關掉；逾時 550 秒 |
| `run-node.sh 腳本 參數…` | 同上但逾時 3000 秒（長測試用）。**它已經把 port 當第一個參數傳給腳本，腳本不要再傳 port** |
| `chain-stab.sh` | 一次跑三個回歸基準 → `chain-stab-out.txt` |
| `gp-title.mjs` | 開網址、等 `document.title` 以指定前綴開頭，印 title 與 `aiHits` |
| `lod-check.mjs` | AI 賽車遠近細節：繪製次數、陰影數量 |
| `board-check.mjs` | 正賽名次板：內容與名次一致、`<li>` 節點有重用 |
| `load-timeline.mjs` `stage-times.mjs` `main-busy.mjs` `load-prof.mjs` | 首屏載入時間線（模擬 10 Mbps／40 ms） |
| `city-fail.mjs` `circuit-fail.mjs` `circuit-fail-shot.mjs` | 資料下載失敗時的降級行為 |
| `podium-shot.mjs` `hud-overlap.mjs` | 頒獎台、手機三種尺寸的 HUD 重疊 |
| `start-cost*.mjs` `stream-cost.mjs` `shadow-cost.mjs` `lamp-cell-tradeoff.mjs` | 繪製次數／三角形量測 |

截圖會輸出到 `tools/dev-tests/shots-*.png`（已加進 `.gitignore`）。
這些腳本是用 CDP（Chrome DevTools Protocol）直接連 Chrome，透過頁面上的 `window.__gp` 讀狀態；`__gp` 的內容在 `src/main.ts` 最後幾行。

**無頭 Chrome 的限制（會害你誤判）**：
- 用 SwiftShader 軟體繪製，台北場景約 0.7～2.7 fps，dt 上限 0.1。所以**不要用「等幾秒看有沒有發生」判斷**，改用 `__gp.step(0.02)` 迴圈、`&sim=` 參數，或等 `requestAnimationFrame` 的格數。
- 同一個分頁連續跑多個 `?sim` 會讓 Chrome 斷線；每個測試開新瀏覽器（`run-one.sh` 已經是這樣）。
- Chrome 剛啟動 6 秒內連 CDP 可能 `ECONNRESET`；腳本裡有 `sleep 8`。
- **只能關測試用的 Chrome**：用命令列含 `gpw-prof` 比對，不要全殺。
- `BOT` 模式（`?bot`）不會安裝返回鍵（popstate）處理，這部分只能讀程式驗證或用非 BOT 頁面。
- 要驗證「修好了」，最好做一個**對照組**：暫時還原修改、重新 build、確認舊行為真的重現，再換回來（並用 grep 確認換回來了）。

---

## 4. 架構速覽

```
src/main.ts         遊戲主程式（約 3,200 行）：狀態機、HUD、選單、大獎賽流程、結算、__gp
src/rivals.ts       大獎賽 AI 車隊 RaceField：22 台、進站、安全車、天氣、LOD、名次
src/f1model.ts      F1 車模（loft 放樣機身、合併網格）、setTyre、setLod
src/pitlane.ts      維修區與人形維修人員（InstancedMesh）
src/track.ts        賽道幾何與物理常數（改手感先動頂端常數）
src/car.ts freecar.ts  賽車物理／自由駕駛 2D 剛體
src/city.ts         台北街景載入與分區串流（600 m 區塊）；citydata.ts 解碼
src/circuits.ts circuitenv.ts  23 條國外賽道資料與通用場景
src/world.ts weather.ts        賽道場景、時段天氣、下雨強度 rainLevel
src/audio.ts enginevoice.ts    音效（AudioWorklet 引擎，public/engine-worklet.js）
src/save.ts         存檔（localStorage key v2；best/gpBest/ghost/賽季…）
src/season.ts       賽季純邏輯（不碰 DOM）
src/loading.ts boot.ts  載入進度、載入畫面、失敗畫面
src/podium.ts       頒獎台
vite.config.ts      含產生 sw.js 的外掛；src/sw-template.js 是 Service Worker 範本
tools/              資料產生腳本（OSM 下載、build-city、切區塊…）
public/data/        city.json、tiles/（184 塊）、circuits/（23 條）
```

重要的設計約定：
- **畫面與模擬分離**：改畫面不能影響 `step()` 路徑（見第 2 節）。
- **LOD**：`setLod(model, far)`，遠 120 m／近 90 m 滯後切換，停站中一律完整。
- **名次板**：`updateGpHud` 每 6 格更新，`<li>` 重用，顏色存在 `dataset.c`。
- **結算**：`settleRace()` 在衝線當下做一次（獎金、勝場、賽季、存檔），`showResults()` 只畫表。
- **存檔賽道指紋**：`trackStamp(track)`；賽道形狀改了會自動清掉該賽道的最快圈與影子車。
- **Service Worker**：版本＝dist 內容雜湊；`/api/` 不快取；`/data/tiles/` 不預先快取。
- **城市區塊**用 Web Worker 計算（`tilegen/tileworker/tilepool`），結果必須和原本一致。
- 材質若要被天氣系統影響，必須讓 `weather.collect` 掃得到（city.ts 有「隱藏代表」）。

---

## 5. 這一輪（11/3～11/10）已完成

全部已 push（`125fd61..cc79663`）；每項都跑過三個基準。

| commit | 內容 |
|---|---|
| `eb59e99` | 手機穩定性：WebGL 畫面中斷時顯示覆蓋層並可重新載入；Android 返回鍵（`goBack()`） |
| `0431b01` | 存檔備份與還原（匯入不信任內容，白名單＋範圍檢查） |
| `c0b5f8a` | 甩尾胎煙與煞車尖叫聲 |
| `c71e8b0` | 進站出口紅綠燈 |
| `ba3a838` | 下雨前的風聲 |
| `baef2bb` | 大獎賽流程五個錯（衝線即結算、排位旗標、賽季暫停續玩、返回鍵、未完賽顯示） |
| `f4d61f3` | 正賽另記 `gpBest`；自由駕駛小地圖搬到左上角 |
| `be4cad6` | 頒獎台背板顯示該賽道名稱＋名牌順序 P2｜P1｜P3；賽道資料下載失敗顯示「載入失敗」與重試 |
| `e288b39` | 賽季排位吃本站車手狀態，排位表顯示 ↑↓ |
| `2ca47d2` | 遠處 AI 賽車簡化（繪製次數 945→714，車隊拉開後） |
| `4039cb7` | 正賽名次板重用節點 |
| `cc79663` | 台北街景資料提前下載（請求時間 3.4~5.2 s → 0.6 s；**進選單總時間沒變短**） |

---

## 6. 還沒做／可以繼續的優化

按「效益 ÷ 風險」排，**每項動手前先量**：

1. **首屏載入的真正瓶頸是主執行緒，不是網路**（`cc79663` 的實測結論）。模擬 4G 下，進選單約 6.4～7.3 秒，其中 city.json 下載提前後仍沒變短。下一步是用 `tools/dev-tests/load-prof.mjs` 看「導覽 → city.json 請求之前」那段 CPU 在忙什麼：取樣顯示壓縮後名為 `Pe` 的函式在 city.json 請求前占了約 1.36 秒（總共約 2.2 秒）；我在打包檔裡找到的 `Pe` 是 three.js `WebGLRenderer` 裡的 `getContext` 包裝，但**同一個壓縮名稱可能不只一個函式，這個對應沒有用未壓縮版本再核對**。若真是建立 WebGL 環境，推論是無頭 Chrome 用 SwiftShader 軟體繪製造成的成本，真機未必如此。先在真機量過，或用 `vite build --minify false` 重新取樣確認，再動手。
2. **路燈（最大單項三角形，約 94 萬）**：18,761 盞、4 個 InstancedMesh、永遠整批送出。把它分格會把繪製次數從 3 次變成約 400 次（300 m 格）。**卡在不知道 Rex 手機等級**：新手機可以用 300 m 格；舊手機改 600 m 格（約 130 次、60 萬三角形）。另一個候選是距離分層（遠的只畫燈桿，不增加繪製次數，但要新做簡化幾何）。`breakables` 用 `[pole, arm, head]＋索引`，分格時索引要重新對應。細節與數字：`tools/dev-tests/lamp-cell-tradeoff.mjs`。
3. **起跑區繪製次數 1,084 次／286 萬三角形**：多出來的約 600 次是 21 台 AI 車，而它們全在 95 m 內，LOD 幫不上。可考慮「只有最近 6 台完整，其餘合併成 1～2 個網格」（量測：只留最近 6 台可省 410 次）。
4. **維修人員三角形 55,088**：頭球 `SphereGeometry(0.17,10,8)` ×165 是大宗，降成 6×4 分段可省約 1.5 萬三角形；`bone` 改 5 邊。
5. **未完成的審查**：大獎賽規則／AI 行為審查、UI 文字大小與對比、直式畫面；一個已知小重疊：長 toast × 喇叭按鈕（667×375，自由駕駛有時鐘時，約 54×18 px）。
6. **手機實機測試**（最後做）：`tools/dev-tests/phone-test-plan.md`。目前**所有聲音都沒被人聽過、沒有任何東西在真機上驗證過**。

### 需要 Rex 決定的事（不要自己決定）
- 路燈要採哪一種切法（先問手機型號）。
- 信義大環線（`xinyi-loop`）其實是「來回線」（101 → 國父紀念館，1015 m 處 180° 迴轉），要不要改成真環線。
- 遊戲裡錢的出口（買東西／花費）要加什麼。
- 什麼時候 push。

---

## 7. 已知的坑

- **改了 `public/engine-worklet.js` 要重跑兩支離線測試**（`eng-test.mjs`、`eng-sweep.mjs`、`voices-test.mjs`）。這三支**沒有複製進專案**，只在 Rex 電腦的 `C:\Users\RexChiu\AppData\Local\Temp`（找不到就要重寫）；要全過才算數。聲音至今沒有人耳聽過，所有驗證都是量出來的。
- `Math.random()`：視覺模組（cockpit、rainfx、weather）可以用；**模擬路徑不能新增呼叫**，會位移後面所有隨機結果。行人用種子 `rng(88)`，新增 `this.rand()` 會位移自由駕駛的行人配置。
- 材質若沒有自己的 `envMap`，three 一律用 `scene.environmentIntensity`，單獨設 `envMapIntensity` 沒用。
- `world.ground.visible` 不能每格設定（各國賽道的 `circuitenv` 會把它關掉）。
- 主畫面走 `EffectComposer`，量亮度要用 `composer.render()`，直接 `renderer.render` 差一倍以上。
- `weather.ts` 的 `nightFade` 清單、`rainOnly`（雨燈、積水）由天氣系統管顯示，LOD 不要去動。
- 存檔裡寫假的 `trackV` 會被當成「賽道改過」而清掉最快圈；測試要先開一次遊戲取得真實指紋。
- 自動模式（Claude Code 專用）的分類器會擋 `git push` 與改設定檔；這與專案無關，Codex 不受影響。

---

## 8. 給接手者的第一步

```bash
cd "C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\Rex\taipei-gp"
git status            # 應該乾淨（HANDOFF.md、AGENTS.md、tools/dev-tests/ 是這次交接新增，未提交）
git log --oneline -3  # 最上面是 cc79663
npm run build
npx vite preview --port 4317 --strictPort     # 背景執行
cd tools/dev-tests && bash chain-stab.sh && cat chain-stab-out.txt   # 三個基準要一字不差
```

基準通過，才表示環境和我這邊一致，可以開始動手。


---
# Codex 工作副本整合交接

# 台北街道賽：Codex 對話交接

最後更新：2026-11-10（Asia/Taipei）

## 最新完成狀態

使用者要求「直接開始優化遊戲，最後再一次更新交接文件」。本文件在本輪驗證完成後統一更新。

**四輪優化都已在可寫副本完成；最新六項體驗優化、48 組手機排版、正式建置與三項固定回歸通過。原專案尚未套用任何變更，沒有 stage、commit 或 push。**

- 原專案（目前只能讀）：`C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\Rex\taipei-gp`
- 可寫獨立副本：`C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\DCISI\taipei-gp-work`
- 本機副本 preview：`http://127.0.0.1:4317/`。
- 專用測試 Chrome：使用者已再次手動啟動，CDP `127.0.0.1:9333` 可連線。本輪已完成測試；未關閉外部 Chrome。
- 原專案 HEAD `cc79663`；最後重新確認：`.gitignore` 已修改，`AGENTS.md`、`HANDOFF.md`、`tools/dev-tests/` 未追蹤。這些是原有交接內容，全部保留。

## 必讀規則

先讀原專案或副本的 `AGENTS.md`、`HANDOFF.md`。回覆／commit 訊息使用繁體中文；如需 commit，單次命令指定 `Rex <game88521@gmail.com>`，不要改全域設定。不自行 push。只在本機 preview 4317 測試，禁止拿線上站測試。手機實測最後做。只用虛構名稱。

不要改回歸預期值，不在模擬路徑新增 Math.random()，不改 pitRnd 呼叫順序。修改前量測，修改後做前後對照。未驗證就明寫未驗證。

## 最新一輪：使用者選擇 1、2、3、7、8、10（已完成）

這六個編號分別是操作手感、手機介面、大獎賽策略、車庫體驗、聲音平衡、載入體驗。實作都在 `taipei-gp-work`，保持所有車輛免費及原本預設駕駛手感，未更改模擬亂數或進站亂數順序。

### 實作內容

1. **操作手感**：設定增加標準／柔和轉向曲線；預設標準與舊版相同。柔和曲線細化拖曳與傾斜的小幅修正，滿舵仍為 1。切換視窗、隱藏頁面、旋轉螢幕清除各輸入來源與視覺狀態；處理 lostpointercapture、阻止第二指搶走轉向板，沒有方向感測器時正常回傳不支援。
2. **手機介面**：長通知改為限制寬度並換行。直向排列分段、胎況、策略與速度表；甩尾／喇叭避免壓到轉向。窄螢幕會自動限制實際控制尺寸（直向最多 90%、矮橫向最多 100%，保留儲存的使用者設定），橫向拖曳板縮到不遮速度表／訊息的範圍。駕駛按鈕至少 44px；四種換胎按鈕改為 44px 並限制在視窗內。無線電可捲動，換胎選項出現時暫時隱藏無線電，避免互相遮擋。
3. **GP 策略**：可展開面板，顯示目前胎況、2026 電量、濕度與已觀察到的變化方向、建議胎種、剩餘圈數、最後一圈及隊友停站提醒。進站數字是「限速段基礎時間差」，含標準停站 2.5 秒，依賽道建議速度估，**未包含進出減速、煞停及排隊**；不是完整進站損失預測。不讀取未來下雨時刻、不修改 AI 策略。
4. **車庫**：點車款只預覽，按「使用這台車」才儲存選車。顯示與目前使用車輛的速度上限、引擎、抓地及重量差。速度上限依車輛設定，不當成實測極速；清楚說明車輛免費、烤漆另計價。
5. **聲音**：自己引擎、其他車輛引擎、音效、環境聲分開調整，另保留主音量。其他車引擎走獨立匯流排，環境聲不再受音效滑桿連動，殘響亦接在各分類音量之後。以 30ms 時間常數平滑調整。舊存檔中其他引擎沿用舊引擎值、環境聲沿用舊音效值；新設定可儲存、匯入與重新載入。
6. **載入**：車庫預覽改為分頁開啟後才下載，並排除 Service Worker 預先快取；有載入狀態、失敗重試，預覽失敗仍能比較／選車。修正 top-level await 之後可能錯過 window.load、導致離線快取未註冊的時機問題。載入進度限制在 0–100%、不倒退，增加無障礙進度資訊，完成後停止提示計時器。

主要來源：`src/input.ts`、`src/main.ts`、`src/strategy.ts`、`src/audio.ts`、`src/save.ts`、`src/boot.ts`、`src/style.css`、`index.html`、`vite.config.ts`。

### 對照與驗證證據

- 修改前保留 `shots-experience-before.json/png`：轉向板輸入 0.5 後 blur 仍為 0.5；點預覽直接將 sedan 改成 pickup；375px 畫面長通知左右界為 -171.5／546.5px。
- 修改後：blur 轉向歸零；同樣輸入標準為 0.5、柔和約 0.329877；滿舵仍為 1。多指、失去 pointer capture、按鍵、隱藏頁面與不支援傾斜的情境通過。
- 通知在 375／390px 直向左右各保留 16px；667×375 橫向亦完全位於畫面內。
- `experience-gp.mjs`：375×812、390×844、667×375；自由／GP、70%／140% 設定、標準／對調抬高、按鈕／拖曳，共 **48 組**。檢查控制、速度表、策略摘要與無線電的邊界／重疊，以及駕駛觸控目標至少 44px。截圖另外核對展開策略與換胎選項。這是桌面 Chrome 尺寸模擬，不是手機實測。
- 真正 GP 頁面：乾地策略、濕度 70% 的雨胎建議、最後一圈提醒通過；摩納哥基礎損失約 13.9 秒。純函式對照：300m 限速段、賽道用時 5 秒，60／80km/h 時分別估 15.5／11 秒；非法輸入回傳 null。
- 車庫先預覽不改存檔、使用按鈕才換車。以 CDP 阻擋預覽 chunk，確認失敗提示出現、仍可選車；解除阻擋後重試成功。
- 確認自己的引擎／其他車輛引擎／環境聲的真實 Web Audio 連線；以 OfflineAudioContext 驗證增益約 `[0.48, 0, 0.35, 0.6, 0.2]`。新音量與曲線重新載入後保留，舊三欄音量存檔可匯入。**沒有驗證人耳聽感。**
- 進度輸入 0.8、0.2、NaN、2，顯示依序為 80%、80%、80%、100%；完成後不倒退。確認 Service Worker 自動接手、車庫 chunk 未預先快取，開車庫才請求。兩支介面測試沒有未處理 JS 例外。
- 載入數字須如實解讀：延後下載的車庫 chunk 約 **4.83KB 原始／2.16KB gzip**。修改前初始 JS encodedBodySize 為 318,800 bytes；本輪全部新功能後，主程式與共用 Three 合計 **319,750 bytes（增加 950 bytes）**。不宣稱總下載量減少或首屏秒數改善；原本車庫 WebGL 就已延後建立，本次新增的是模組下載延後及失敗處理。

最新正式建置：`index-XY8jD8ig.js`、`index-DaDzJsmL.css`；SW `8bbadd29c4ad`，37 個預先快取檔，dist 不含診斷模組。Vite 既有 __dirname 與大 chunk 提示仍存在。

三項固定回歸 **3/3 PASS**：`BOT lap2 54.425 hits=0`／aiHits 0；冠軍陳冠宇 162.0／aiHits 8；強制進站陳冠宇 175.7／aiHits 5。最新證據保存為 `shots-experience-regression.txt` 與 `shots-last-verified-regression.txt`。

重跑本輪檢查（副本根目錄，外部 Chrome 9333 已啟動）：

```powershell
npm.cmd run build
node tools/dev-tests/build-experience-test.mjs
node tools/dev-tests/external-browser.mjs 9333 experience-ui.mjs after
node tools/dev-tests/external-browser.mjs 9333 experience-gp.mjs
# 清掉 dist 的診斷模組，再做正式回歸
npm.cmd run build
$env:GP_CDP_PORT='9333'
& 'C:\Program Files\Git\bin\bash.exe' tools/dev-tests/chain-stab.sh
Get-Content tools/dev-tests/chain-stab-out.txt -Encoding UTF8
```

`experience-ui.mjs before` 只可對實際舊版執行；不要用新版覆蓋既有 before 證據。`build-experience-test.mjs` 產生測試專用 dist/__experience.js，正式 build 會移除它。手機實機、實際握持／陀螺儀、人耳聲音及低階裝置啟動時間仍未驗證。

## 上一輪：排位計算分批執行與超時處理（已驗證）

使用者在模式分析後選擇「大獎賽：排位停頓＋超時處理」。此節保留上一輪紀錄；最新六項變更見前節。備份還原遺失賽季的問題仍未修正。

正式變更：

- `src/rivals.ts`：以同一個 `qualifyingSteps` 迭代器提供同步 `qualify()` 與畫面用 `qualifyAsync()`；約每 8 ms 交還事件迴圈。物理仍是 1/120 秒，每位 AI 保留原有一次 Math.random，pitRnd 未動。
- 最多模擬 150 秒；未完成一圈回傳 null，不再把時間上限加擾動當作有效圈。沒有擅自延長時限。
- `src/main.ts`、`index.html`：新增 qualifying 狀態、進度與取消。計算時不能開始正賽／重跑；回選單或 Escape 可中止。中止立即關閉迭代器、釋放 solo，舊 Promise 不會覆寫新狀態。出錯時可重跑或回選單。
- 無有效圈顯示「無有效圈」，排在所有有效成績之後，差距空白；同為無有效圈保留原順序。畫面說明 150 秒限制。
- BOT 同步測試仍用同步路徑，避免同步 runSim 無法等待 Promise。

前後量測使用保留的真實修改前／後 bundle、真實 RaceField 與車輛物理、固定亂數，沒有載入城市或進行 GPU 渲染。桌面 Chrome 單次暖機後結果（不是手機數字）：

| 項目 | 修改前同步 | 修改後分批 |
|---|---:|---:|
| 整體排位計算經過時間 | 70.8 ms | 108.9 ms |
| 測試計時器最長更新間隔 | 70.8 ms | 12.0 ms |
| 計算期間計時器更新次數 | 0 | 17 |

**改善的是事件迴圈可回應程度，總耗時增加，不能宣稱計算更快。** 分批以約 8 ms 為目標，GC／瀏覽器排程仍可能使單批更久；初次量測曾出現 62 ms 間隔，不能保證每批硬上限 8 ms。

對照與功能驗證：

- 經典、2026 兩套規則的 21 位 AI 正常圈速，修改前／後同步／後分批完全相同。
- 強制一位 AI 不前進：對照組仍記 149.805 秒；修改後同步與分批皆 null。後面 20 位 AI 圈速不受影響，亂數呼叫次數仍為 21。
- 計算已有進度時中止，Promise 正確拒絕、solo 釋放，隨後重新計算成功。
- 真正非 BOT 的摩納哥頁面：完圈後進度狀態、Escape 取消、一位超時排最後、全部 21 位超時仍有玩家有效竿位、同狀態穩定排序、重跑及接續正賽皆通過。正賽起跑位置確認為竿位，不依賴 racers 陣列順序。沒有 JS 例外。
- 另測 `bot&gp&quali&circuit=monaco&q=low&sim=500`，同步排位接正賽成功，玩家排位 P22、完賽 P19。這是流程測試，非固定數字基準；該次 aiHits 153，不代表 AI 行為已優化。
- 最新正式 build 與三項必要回歸 3/3 PASS，見下方。

產物：副本 `tools/dev-tests/shots-quali-before.json`、`after.json`、`comparison.json`、`ui.json`、`ui-timeout.png`、`bot.txt`、`regression.txt`。截圖已檢查上半部表格，無有效圈的最後一列由 DOM 斷言驗證；未做手機實機檢查。

重跑專項測試（需 4317 preview 及 9333 Chrome）：

```powershell
node tools/dev-tests/external-browser.mjs 9333 quali-benchmark.mjs before
node tools/dev-tests/external-browser.mjs 9333 quali-benchmark.mjs after
node tools/dev-tests/quali-compare.mjs
node tools/dev-tests/external-browser.mjs 9333 quali-ui.mjs
```

`quali-entry.ts` 與 `build-quali-test.mjs` 供獨立 bundle；**不要在修改後來源重建 before**。已保留 `shots-quali-rivals-before.ts`、`shots-quali-model-before.mjs`／`after.mjs`。診斷頁會寫入 dist，最後須正式 build 清掉。

介面測試要等 `__gp` 存在且「大獎賽」按鈕可用，再停止動畫；不能只等 state=menu。開發過程中測試腳本曾因提早停止載入，以及錯把 racers 陣列索引當發車位置而失敗，已修正腳本，沒有因此修改遊戲規則或預期基準。

未驗證：所有 23 站的排位、完整賽季流程、低階手機回應時間、切背景後的排位體驗。2026 已驗證物理結果，但非 BOT UI 流程本輪使用經典規則。

## 上一輪：車輛飾件材質合併（已驗證）

`src/f1model.ts` 把 7 種無彩色貼圖的飾件材質合成 2 個遠近細節網格，共用標準材質。線性頂點色保留原色；7×1 RGBA Float32 DataTexture 存粗糙度／金屬度，NearestFilter，不使用自訂 shader。各隊共用 position／normal／uv BufferAttribute，顏色各自保留。

主車漆、碳纖維、貼花、隊名、輪胎／轉向、煞車導管、雨燈及 ghost 保留原處理。沒有修改模擬、AI 或既有 LOD 距離。

CPU 生成真實車模，11 種車隊逐一比對 full、far、restored：

| 項目 | 修改前 | 修改後 |
|---|---:|---:|
| 完整模型可見網格 | 21 | 16 |
| 遠處可見網格 | 10 | 9 |
| 完整三角形 | 9,026 | 9,026 |
| 遠處三角形 | 6,972 | 6,972 |
| 11 模型不重複幾何緩衝區 bytes | 10,367,896 | 9,359,464 |

不重複幾何緩衝區減少約 **9.7%**。單台逐項屬性相加會因新增頂點色增加，不要宣稱單車屬性總量減少。所有飾件頂點位置、法線、線性 RGB、float32 粗糙度／金屬度及遠近歸屬的排序雜湊完全相同；full → far → full 精確還原。

獨立 WebGL 實測（固定 960×540、22 車、同鏡位／光線、含陰影）：

| 場景 | 修改前 calls | 修改後 calls | 三角形前後相同 |
|---|---:|---:|---:|
| 全細節車陣 | 837 | 617 | 396,354 |
| 遠處細節 | 199 | 177 | 153,122 |
| 切回完整細節 | 837 | 617 | 396,354 |
| 單車改漆／綠胎／轉向／雨燈開啟 | 40 | 30 | 18,030 |

完整車陣實際繪製次數減少 **220／26.3%**。這是獨立車模場景，**不是整場遊戲 draw calls 或手機 FPS**。

四組畫面均無 WebGL error／JS 例外，像素門檻全部通過。遠處畫面 RGB 完全一致；完整車陣平均通道差異 0.00008166／255，只有 2 個像素任一 RGB 差異 > 8；近照平均差異 0.00046553，6 個像素差異 > 8。已目視檢查前後 full 與近照 PNG，未見明顯外觀差異。近照為前側視角，雨燈背面的目視檢查未完成。

證據在副本 `tools/dev-tests/`：

- `shots-f1-comparison.json`、`shots-f1-topology-before.json`／`after.json`
- `shots-f1-render-before.json`／`after.json`、`shots-f1-pixels.json`
- `shots-f1-before-*.png`／`after-*.png` 及原始 `.rgba`
- `shots-car-batching-regression.txt`、`shots-last-verified-regression.txt`、`chain-stab-out.txt`：均為本輪成功結果

## 上一輪：維修人員幾何簡化（已驗證）

`src/pitlane.ts`：頭盔 8×6 → 8×4，保留水平輪廓；四肢／工具圓柱 6 邊 → 5 邊。

- 維修人員三角形 **55,088 → 45,188，減少 17.97%**。
- 同鏡位全場三角形 **3,131,446 → 3,121,546**，繪製次數 **1,007 → 1,007**。
- 實例數、待命矩陣及頭盔 bounding box 相同，已檢查前後截圖。
- 當輪建置與三回歸通過；本輪保留該改動並再次通過三回歸。
- 證據：副本 `tools/dev-tests/shots-pit-*`。

## 最新正式建置與回歸結果

最後在完成排位功能測試後執行 `npm.cmd run build`，清除 dist 裡診斷頁，通過 TypeScript 與 Vite。JS `index-Z79bAQqp.js`，SW `9ef949b55ee4`。既有 Vite 大 chunk／未來 configLoader 提示仍在，不是新的建置失敗。

接著 `chain-stab.sh` 程序狀態 **0，3/3 PASS**，三項完全符合原基準：

1. `bot&sim=120`：`BOT lap2 54.425 hits=0`，aiHits 0。
2. `bot&gp&sim=400`：冠軍陳冠宇 `162.0`、`aiHits 8`。
3. `bot&gp&pittest&sim=400`：冠軍陳冠宇 `175.7`、`aiHits 5`。

重跑（在副本，需專用 Chrome 仍開在 9333）：

```powershell
npm.cmd run build
$env:GP_CDP_PORT='9333'
& 'C:\Program Files\Git\bin\bash.exe' tools/dev-tests/chain-stab.sh
Get-Content tools/dev-tests/chain-stab-out.txt -Encoding UTF8
```

PowerShell 會阻擋 npm.ps1，使用 npm.cmd，沒有變更執行原則。

## 補丁與原專案狀態

都在 DCISI 根目錄：

- **`taipei-gp-optimization.patch`：最新完整已驗證版本，共 35 檔**，包含六項體驗、先前維修人員／車輛飾件／排位改動、測試工具及副本 HANDOFF.md。匯出後重新對原專案執行 `git apply --check`，尚未套用。
- `taipei-gp-qualifying-verified.patch`：本輪前排位功能與前兩輪優化的 23 檔備份，73,795 bytes。
- `taipei-gp-car-batching-verified.patch`：備份本輪之前、兩輪畫面優化與工具的 15 檔已驗證版本。
- `taipei-gp-pitlane-verified.patch`：備份上一輪僅維修人員與工具的 8 檔已驗證版本。
- `taipei-gp-candidate-unverified.patch`：先前驗證前匯出的歷史候選，請使用上面的最新正式補丁。
- `taipei-gp-export.mjs`：預設匯出完整 35 檔到 `taipei-gp-optimization.patch`。

```powershell
# 在 DCISI 執行，重新匯出目前副本
node taipei-gp-export.mjs 'C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\Rex\taipei-gp'
```

補丁不含 node_modules、dist、測試 bundle、截圖或 JSON 產物；副本 HANDOFF.md 包含整合交接，本文件另留在 DCISI 根目錄。原始對照組與量測產物仍在副本，清理或換機前須保留。各備份補丁內容重疊，只套用最新完整版本。

接手若能寫原專案，先確認原檔沒有後續修改，再重新 apply --check，然後套用最新補丁並在原專案重跑 build／三回歸。保留原本未提交交接文件與 .gitignore。Git dubious ownership 可用單次 `-c safe.directory=原專案路徑`，不要改全域設定。

## 測試工具與環境注意事項

- `localhost:4317` 與 `127.0.0.1:4317` 曾連到不同服務（推論 IPv4／IPv6 各有服務）。這輪所有驗證固定使用副本 `127.0.0.1:4317`，不關閉其他既有服務。
- `external-browser.mjs` 使用外部專用 Chrome，每次建立／銷毀獨立 browser context，只清理自己建立的環境，不關閉 Chrome。不是每次重啟瀏覽器程序。
- `run-one.sh` 支援 GP_CDP_PORT，保留真正失敗碼，清理限本次 profile。`chain-stab.sh` 核對精確數字，失敗立即停止。
- `gp-title.mjs` 遇逾時或 JS 例外失敗；錯誤 CDP port 的負向測試正確回傳 1。
- `f1-entry.ts` 先 export PLAYER_LIVERY 再 export f1model，因原架構循環相依需要這個初始化順序。
- `build-f1-test.mjs` 依當下來源建立 bundle。**不要在修改後的來源上重建 before**，會覆蓋真正對照組。保留了 `shots-f1-source-before.ts` 與 `shots-f1-model-before.mjs`／`after.mjs`。
- 正式 build 清掉 dist 診斷頁；`f1-render.mjs` 會從保留 bundle 恢復自己需要的頁面。GPU 重跑後要再正式 build 清掉診斷頁。

```powershell
node tools/dev-tests/external-browser.mjs 9333 f1-render.mjs before
node tools/dev-tests/external-browser.mjs 9333 f1-render.mjs after
node tools/dev-tests/f1-pixels.mjs
```

CPU 比對：`node tools/dev-tests/f1-topology.mjs before`、`after`，再 `node tools/dev-tests/f1-compare.mjs`。

如果 Chrome 關閉，可請使用者在一般 PowerShell 執行並保持開啟：

```powershell
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --remote-debugging-port=9333 --user-data-dir="$env:TEMP\taipei-gp-cdp" --use-angle=swiftshader --enable-unsafe-swiftshader about:blank
```

沙箱內 Chrome 曾報 GPU 子程序 `exit_code=-1073741790` 與 `GPU process isn't usable`；single-process／in-process 診斷未產生有效結果，已停止。沙箱外啟動申請最近仍被自動核准服務擋住：403、codex-auto-review 模型不可用，操作未執行。不要繞過核准；這輪靠使用者手動啟動成功恢復測試。

## 首屏分析的重要修正與後續方向

`startup-prof.mjs` 使用同一單調時鐘對齊 Network／Profiler，等待 `?prof` 的 PROF 標題。初始 state 就可能是 menu，不能用 menu 判定載入完成。

先前一次未壓縮、CPU profiling、SwiftShader 測量：city 請求約 700 ms，完整 ready **159,848.8 ms**，含大量 idle、GC、城市建置及 shader 首次使用。不能代表手機，也不能直接與原交接 6.4～7.3 秒相比。原本把壓縮函式 Pe 歸因 getContext 的說法沒有證據支持。該輪未改首屏程式；最新載入變更與限制見六項體驗章節，未宣稱首屏秒數改善。產物 `shots-load-profile.cpuprofile`／`.json`。

後續優化參照原 HANDOFF 第 6 節：首屏成本、起跑區全遊戲實測、GP 規則／AI 審查、UI 對比與直式重疊。路燈切格原交接要求先問手機型號與切法，不能自行決定。

**尚未驗證：**本輪完整遊戲同鏡位 draw calls 前後對照、手機 FPS／實機觀感、主動換胎動畫人眼檢查與雨燈背面人眼檢查。手機測試仍排最後，清單在原 `tools/dev-tests/phone-test-plan.md`。
