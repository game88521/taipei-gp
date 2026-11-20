# 玩家連線診斷契約

署名：Rex <game88521@gmail.com>

`GET /diagnostics` 是唯讀診斷，不建立房間、不續接席位。請求必須帶有效 HTTP(S) `Origin`，不能用 query 指定其他來源。回應只包含本次來源的 `originAllowed`、公開版本與固定診斷能力，不回傳允許清單、房碼、玩家、token、環境變數或容量資訊。

成功為 HTTP 200、JSON `{schema:1,status:"ok",originAllowed:boolean,protocol:{version:number,physics:string,catalogStamp:string,coopVersion:number,cityRaceVersion:string},capabilities:{odysseyDiagnostics:true}}`。即使本次來源未獲 WebSocket 放行，仍可用精確 `Access-Control-Allow-Origin` 讀取自身拒絕狀態；這不會改變 WS Origin 規則，不允許 credentials。

無效或缺少 Origin 為400；非GET為405；每個實際連線位址每分鐘最多30次，超額429附Retry-After。所有回應no-store、nosniff；不接受代理轉送IP。診斷只在玩家按下按鈕後進行，不自動輪詢或改寫設定。

前端從設定的WS網址導出同主機HTTP(S) /diagnostics，拒絕含帳密、query、fragment及HTTPS頁上的不安全服務。8秒總期限、可取消、不追蹤重新導向且不傳credentials。版本相符、來源放行後，最多額外開一次不進房的WS /ws，送ping並核對pong後關閉。無法讀取HTTP回應或WS錯誤時只能報「原因未確認」，不能推定403／503。

匯出僅保留頁面Origin、服務Origin、時間、版本及固定結果碼，不讀取storage、暱稱、完整網址、房碼或席位憑證。詳見本機實作測試 `tools/dev-tests/odyssey-network-node.mjs`。
