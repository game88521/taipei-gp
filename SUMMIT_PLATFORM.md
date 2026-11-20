# Summit：載入與資源

城市工坊、合作配送與多人回放工具改為按需載入。主選單保留入口，開啟後才建立完整介面、地圖和標記；下載中可取消，取消後晚到的模組不會自行開啟。相同下載去重、失敗可重試；工坊在點擊時先準備音訊與城市系統，避免非同步載入遺失使用者啟動手勢。

Service Worker 依 Vite 實際靜態相依圖預取主遊戲與多人入口；可選 UI、車庫及同機雙人入口改為首次使用時下載與快取。版本仍涵蓋所有建置內容。可選功能需先在線上開啟一次，後續才能離線使用；安裝核心成功不代表所有可選功能都已離線備妥。

同機雙人使用獨立頁面，離開主遊戲後才建立自己的單一 renderer。兩個鏡頭共用場景；換圖先釋放舊場景的 geometry、material、texture、render lists，離頁終止迴圈並釋放 renderer。工坊與合作模組首次開啟後會保留一份介面實例供再次使用，不宣稱卸載已下載的 JavaScript。

驗證工具：

- `node tools/dev-tests/summit-platform-models.mjs`：下載取消／重試／去重，以及分割畫面的輸入與真物理。
- `node tools/dev-tests/summit-platform-browser.mjs`：實際請求、入口、重複掛載、換圖資源、介面與清理；只連本機 CDP 9334。
- `node tools/dev-tests/summit-loading-metrics.mjs`：逐檔比較已交付 Nexus 與本輪 HTML 入口資源大小。量測檔案位元組與 gzip，沒有把它稱為實機載入速度或幀率改善。

最終當輪結果與來源 SHA 以 `SUMMIT_VALIDATION.json` 為準。實體手機記憶體上限、長時間 GPU 壓力與不同瀏覽器尚需實機驗收。
