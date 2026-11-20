<!-- frontier-release-20261121 -->
# 2026-11-21 Frontier 新版發布準備

作者：Rex <game88521@gmail.com>。Rex 已明確要求「幫我上新版」，授權將已驗證且套回的 Expedition＋Frontier 改善提交並正常推送 main 與 multiplayer-test，沿用原網址 https://taipei-gp.vercel.app/，同步更新多人後端。

這是發布前準備紀錄；實際提交、兩分支推送、Vercel Production 與 Render 更新狀態，以 DCISI/taipei-frontier-release-receipt.json 及 TAIPEI_FRONTIER_RELEASE.md 為準。未有部署成功證據，不能只由本段宣稱已上線。Render 設定 autoDeploy:false，無管理授權時仍需控制台 Manual Deploy 最新提交。

產品來源維持封版相同；發布另以正式公開 WSS 環境建置。公開設定造成的 build 差異會另記，不改寫原本機 caeeecc35bef 與歷史驗證。唯一文件差異是在 HANDOFF 前新增本段，以下原始封版 bytes 完整保留；其中「尚未提交／未部署」是當時狀態。只讀部署中繼資料與靜態版本，不在正式站開房或操作遊戲。

以下完整保留封版紀錄。

<!-- frontier-current-20261121 -->
# 2026-11-21 最新：Frontier 十二項改善與新玩法

作者：Rex <game88521@gmail.com>。承接已套回但未提交的Expedition build d5068bed213b，本輪於 DCISI/taipei-gp-frontier-work／feature/frontier-12 完成十二項實作與本機封版，build **caeeecc35bef**。基準HEAD a387c72bec2931411957063aaa63120a59122749；不從Git HEAD覆蓋前輪未提交成果。

固定編號：1好友雷達與車頂暱稱、2城市房主管理、3城市觀戰與匿名回放、4城市短斷線自動續接、5效能採樣與可驗證調校、6碰撞事實分析、7車隊巡遊、8移動王冠、9多人定速拉力、10多事故合作救援、11追走單人陪練、12四人好友盃。入口與行為見 [FRONTIER_FIXES.md](./FRONTIER_FIXES.md)，逐項狀態見 [FRONTIER_PROGRESS.md](./FRONTIER_PROGRESS.md)，完整證據與來源清單見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。

完整build、34套Node／服務、14套瀏覽器共96案、固定三基準全部PASS。四個物理核心原文保持；三基準54.425／162.0／175.7及aiHits0／8／5相同。原始FAIL與修前對照完整保留，沒有改寫為PASS。

**沒有commit、push或部署，本輪尚未出現在公開網址。** 原專案實際套入狀態以 DCISI/taipei-frontier-delivery-receipt.json 的APPLIED_BUILD_VERIFIED與 TAIPEI_FRONTIER_DELIVERY.md獨立核對為準；本段本機封版不代替成功收據。只用本輪精確差異／CAS交付工具，先備份、套回、離線build及逐檔驗證；保留前輪86個未提交改動與其他檔案，不重跑歷史Apply。上線前後端須同步，含city-duty-v2、/city-rally與frontier-cup／crown等能力。

實體手機、真手把、跨網路真人、玩法平衡、免費主機容量、30分鐘實機溫度／耗電未驗證；桌面viewport不能列作實機PASS。 效能採樣的draw CPU不是GPU時間；0.65解析度的像素量減少57.75%，不等於FPS提升。 巡遊與定速拉力另有真FreeCar完整道路證據；救援六腿完整道路不等於真人精準停靠。救援browser明示停靠fixture；四人盃browser明示finish fixture，完整真Car／WS四場由Node另驗。 追走browser用真Input／FreeCar錄製，停renderer後以固定步加速；不是真人時間試駕。中立跟隨0分基準驗規則，不宣稱真人正分平衡。 COPY隔離smoke是Windows Node24啟動集合驗證，沒有執行Docker／Alpine image build。 最後實機計畫在 tools/dev-tests/frontier-phone-test-plan.md。AGENTS持續適用：繁體中文、虛構品牌、署名Rex、不自行push、只測本機、手機最後。全部報告／截圖／原生下載／原始FAIL另存 DCISI/taipei-gp-frontier-validation-evidence。

以下完整保留本輪開始前HANDOFF原bytes，各輪狀態以當時時間理解。

<!-- expedition-current-20261120 -->
# 2026-11-20 最新：Expedition 十二項改善與新玩法

作者：Rex <game88521@gmail.com>。本輪基準 main 提交 `a387c72bec2931411957063aaa63120a59122749`，在 `DCISI/taipei-gp-expedition-work`／`feature/expedition-12` 完成十二項功能與本機封版，build **d5068bed213b**。入口、規則及限制見 [EXPEDITION_FIXES.md](./EXPEDITION_FIXES.md)；機器可核對的來源清單與證據見 [EXPEDITION_VALIDATION.json](./EXPEDITION_VALIDATION.json)。

固定編號：1延遲碰撞呈現、2效能採樣與渲染、3分裝置HUD、4PB遙測教練、5多人正式賽規罰秒、6全24圖三難度AI校準、7城市巡航、8警匪追逐、9合作救援、10定速拉力、11每日固定挑戰、12雙人輪換追走。新城市玩法會還原原車、天候、鏡頭與導航；尚未完成入場就取消及重複清理也不清掉原導航。

完整build通過；Node／真Car AI共 **267案**、資源 **4案**、瀏覽器 **33案** 與固定回歸 **3案** 全PASS。AI72組全部完賽、零護牆接觸、24圖難度圈時有序。固定54.425／162.0／175.7、aiHits0／8／5保持；car／track／rivals／pitlane原文未改。曾失敗的測試與導航修前2FAIL保留，沒有改寫成PASS。

**沒有commit、push或部署，本輪尚未出現在公開網址。** 本章記錄本機封版；原專案是否已套回，以 `DCISI/taipei-expedition-delivery-receipt.json` 的APPLIED_BUILD_VERIFIED及 `TAIPEI_EXPEDITION_DELIVERY.md` 獨立核對為準。套回工具只在原專案仍為乾淨main／同基準時備份、精確複製、建置及逐檔驗證；不要重跑歷史Apply或覆蓋既有變更。發布時Vercel與Render須同步，新路徑/city-social、/city-duty及schema6／expedition-racing能力需前後端相符。

測試只使用本機。實體手機／手把、外網真人與平衡、免費主機容量、30分鐘GPU／溫度／耗電及Docker image build尚未驗證；桌面viewport與明示停靠／計分fixture不算真機或人工完整跑線。動態解析度實測像素減少57.75%，不是FPS增幅。最後真機計畫見 `tools/dev-tests/expedition-phone-test-plan.md`。

全部報告與前輪失敗保留於worktree的tools/dev-tests；本輪最終報告另存 `DCISI/taipei-gp-expedition-validation-evidence`。AGENTS.md持續適用：繁中、虛構品牌、署名Rex、不自行push、只測本機、手機最後。

以下完整保留本輪開始前HANDOFF原bytes；各輪狀態以當時時間理解。

<!-- version-audit-release-20261120 -->
# 2026-11-20 修正版發布準備

Rex 已明確要求「幫我上修正版」，授權將本次 4 項修正提交並推送 main，以既有 Vercel Git 整合更新 https://taipei-gp.vercel.app/，並同步多人分支。產品仍是已通過 109 項檢查的相同 5 個前端檔案，沒有變更伺服器或契約。

本段是提交前的發布準備紀錄；實際推送、提交 SHA、Vercel Production 結果與正式網址核對，請查工作區 DCISI/taipei-version-audit-release-receipt.json 及 TAIPEI_VERSION_AUDIT_RELEASE.md。未有成功收據前，不能只由本段宣稱已部署。

以下 VERSION_AUDIT_VALIDATION.json 與檢查交接文字保留檢查封版時狀態；其中「尚未 commit／push／上線」及 HANDOFF 原雜湊指封版當時。發布只在其前新增本段說明；原檢查證據與其他交付檔不改寫。正式環境公開 WSS 設定會影響 build 雜湊，發布建置另行記錄，不冒稱等於原本機 ca2f03b4217a。

以下完整保留檢查封版紀錄。

<!-- version-audit-20261120-start -->
# 2026-11-20 最新：版本檢查，4 項修正尚未上線

本輪以原專案 main／multiplayer-test 的提交 `9f39d05a0cc9c658911f6bbcccdff438b6548bc9` 建立隔離 worktree `DCISI/taipei-gp-version-audit-20261120`，分支 `fix/version-audit-20261120`，build **ca2f03b4217a**。已修正一般道路公車隱形車流、分割畫面 BFCache 返回不能再起跑、書籤讀取失敗後覆寫原資料，以及多圈成績取整被誤拒絕。詳見 [VERSION_AUDIT_FIXES.md](./VERSION_AUDIT_FIXES.md)。

Node 8 套 **72 案**、瀏覽器 6 套 **34 案**、固定基準 **3 案**全數通過，證據見 [VERSION_AUDIT_VALIDATION.json](./VERSION_AUDIT_VALIDATION.json)。物理核心未改，三個基準保持 54.425／162.0／175.7 與 aiHits 0／8／5。工坊選點疑點經解碼後路網核對已排除，未保留相關修改。真手機／實體手把／外網真人及長期負載未驗。

**修正只在此隔離工作目錄，尚未 commit、套入原專案、push 或部署。** 原專案與正式版本不包含這 4 項修正；不要把以下舊段落的「最新／尚未提交」當成本輪狀態。後續發布應先檢查此分支的明確檔案清單，保留測試證據，依 Rex 明確指示才 push；不要重跑歷史 Apply／Publish。
<!-- version-audit-20261120-end -->

以下原文件完整保留，各輪狀態以當時時間理解。

<!-- odyssey-current-start -->
# 2026-11-20 最新：Odyssey 十二項改善與新玩法

本輪在 DCISI/taipei-gp-odyssey-work 完成本機封版，build **d376274301b9**，承接已套回但未提交的 Voyager bc5f6fdf669f。封版時尚未套回原專案，沒有 commit、push 或部署。這是封版時的紀錄；後續實際套回狀態以 DCISI 根目錄 TAIPEI_ODYSSEY_DELIVERY.md、本輪成功套用收據與獨立核對結果為準。

固定編號：1連線自助診斷、2標準手把映射／選單、3停靠儀表、4勤務逐站明細、5合作快捷通訊／確認、6滿額回放明確替換、7手動S1／S2、8回放A／B與註記分享、9多人衝刺週末、10耐久強制一停、11南城一般道路公車、12救援絞盤裝載。入口與限制見 [ODYSSEY_FIXES.md](./ODYSSEY_FIXES.md)、城市／競速／工坊文件及 [ODYSSEY_MULTIPLAYER_CONTRACT.md](./ODYSSEY_MULTIPLAYER_CONTRACT.md)。

證據見 [ODYSSEY_VALIDATION.md](./ODYSSEY_VALIDATION.md) 及JSON：newnode5、regression14、browser5、legacybrowser7、fixed1全部fresh PASS，本輪Node 61案、browser 84案、固定三與交付工具24案。真機、真手把、外網及長期負載尚未驗證，依最後人工驗收計畫處理。

基準HEAD 67ce0881c91caddbdfcfb424e37ac74188862c0c，branch multiplayer-test，main 2dee076de30da52fe20b4d33faf659e6acf0aed3；封版器未操作Git。before完整840檔，inventory SHA256 7adacb81ddf0224eda92e40e029502de736f1ed64af979ae87fc26f96a5fd837。不要從HEAD覆蓋既有未提交成果或重跑歷史Apply。套用只使用本輪交付包，須先預檢／備份，再離線build、成功收據及獨立verifier。多人契約變更需前後端同步，不能只更新前端。

AGENTS持續適用：繁體中文、虛構品牌、署名Rex <game88521@gmail.com>、不自行push、只測本機、手機實機最後。
<!-- odyssey-current-end -->

以下完整保留本輪開始前HANDOFF原bytes，各輪狀態以當時時間理解。

<!-- voyager-current-start -->
# 2026-11-19 最新：Voyager 十二項改善與新玩法

本輪在DCISI/taipei-gp-voyager-work完成本機封版，build **bc5f6fdf669f**，承接已套回但未提交的Atlas 205d0c8df91e。尚未套回原專案，沒有commit、push或部署。來源／測試通過不等於成功套用或上線。

證據沿用已明示：browser／legacy-browser共17套與Voyager Node沿用修補前原PASS報告，未重跑或改寫。產品與dist逐檔完全相同；完整測試inventory只允許platform-regression.mjs由已封存Atlas舊hash改為審查過的Response預先構造fixture，保留100ms總期限／15ms閒置期限與全部斷言。原25通過／1失敗及stderr保留FAIL；修補收據650eb54e59f703abf4ca44829183b4ad36c02f6617253b6120085692271a8c51後已重新執行build、固定三與資源／容量、完整legacy及24交付工具fixture。其餘entry／helper與測試hash均完全一致。

功能入口見[VOYAGER_FIXES.md](./VOYAGER_FIXES.md)，證據見[VOYAGER_VALIDATION.md](./VOYAGER_VALIDATION.md)及JSON；契約與最後真機計畫各自另列。新Node74案、新舊browser128案、固定三與交付工具24案通過；確定性fixture不能替代外網真人／真機／長時壓測。

基準HEAD 67ce0881c91caddbdfcfb424e37ac74188862c0c、branch multiplayer-test、main 2dee076de30da52fe20b4d33faf659e6acf0aed3未由封版器操作。before完整803檔，inventory SHA256 48406a86a3f67c5e3d3b24853648705193ba3805d7863db802478d6a401bb893。不可從HEAD覆蓋既有未提交成果，不要重跑歷史Apply。只使用本輪精確交付包，預檢、備份、離線build、逐檔驗證、成功收據與獨立verifier均須完成。

城市city-race-v3／合作v4須前後端一起更新；賽道新增voyager-racing-v1能力，schema4回放仍讀舊1／2／3。VSC只記錄禁超車、不自動罰秒；照片僅單人暫停／已存回放，不停線上房。真手機、真手把、真人完整勤務、外網、長期負載與Docker仍未驗。

AGENTS持續適用：繁體中文、虛構品牌、署名Rex <game88521@gmail.com>、不自行push、只測本機、實機最後。
<!-- voyager-current-end -->

以下完整保留本輪開始前HANDOFF原bytes，各輪狀態以當時時間理解。

<!-- atlas-current-start -->
# 2026-11-18 最新：Atlas 十二項改善與新玩法

承接已套回且尚未提交的Summit build 8447a11b8964。本輪隔離副本DCISI/taipei-gp-atlas-work已完成十二項功能及本機封版，build **205d0c8df91e**。入口與行為見[ATLAS_FIXES.md](./ATLAS_FIXES.md)，實際報告見[ATLAS_VALIDATION.md](./ATLAS_VALIDATION.md)及JSON；容量比較另見[ATLAS_CAPACITY.md](./ATLAS_CAPACITY.md)，不能當作免費主機承載量。

封版時尚未套回原專案、commit、push或部署。不要重跑歷史Apply，不可從Git HEAD覆蓋未提交成果。後續只使用本輪精確白名單交付包，預檢／備份／build／逐檔驗證與獨立成功收據均須完成；文件不等於已套用。Git基準67ce0881c91caddbdfcfb424e37ac74188862c0c，branch multiplayer-test，main 2dee076de30da52fe20b4d33faf659e6acf0aed3；封版器未操作Git。immutable before為taipei-gp-atlas-before-8447a11b8964，共761檔，庫存SHA256 d34e95d3dba67b3b4409808dbaebe20c7cfa231abb34d963592e5aa4f9a90cb0。

前後端需同步：合作v3、城市競速city-race-v2，賽道多人另以atlasRacing能力與atlas-racing-v1啟用AI難度／損傷／旗號；v3回放仍讀舊v1／v2。NG1城市多人與NG2單人工坊不能混用。整包備份排除席位憑證，還原前確認下載與關閉其他遊戲頁；受中斷journal保護，不覆蓋首次救援原檔。

真手機、真手把、真人完整勤務路線、外網、長期負載、玩法平衡與Docker實跑仍待[ATLAS_PHONE_TEST_PLAN.md](./ATLAS_PHONE_TEST_PLAN.md)。AGENTS持續：繁體中文、虛構品牌、署名Rex <game88521@gmail.com>、不自行push、只測本機、實機最後。
本段是套用前封版快照；後續實際是否已套回，請從DCISI/TAIPEI_ATLAS_DELIVERY.md查本輪操作與結果，再核DCISI/taipei-gp-atlas-status.json（最近一次命令狀態）、DCISI/taipei-gp-atlas-apply-receipt.json（成功套用、備份及build的不可變收據），及DCISI/taipei-gp-atlas-original-verification.json（獨立唯讀verifier結果）。收據須與本輪manifest／build一致且獨立核對PASS；只有封版文件、preflight或零工作重建不能當作已套回證明。收據不存在或核對未通過時不要宣稱已套回，也不要重跑歷史Apply。

城市競速修正收包wall時間比固定物理tick略新時，誤把有效油門當作idle而反覆阻尼；相同30Hz輸入／60Hz真FreeCar的5個模擬秒，+2ms相位由0.66458m恢復為93.21462m，並保留700ms過期與active:false煞停。另修正按脫困後焦點停在按鈕而阻擋鍵盤：產品會將焦點交回有標籤的遊戲畫布，瀏覽器案檢查焦點後才實際鍵盤駛過全部gates。原始29 PASS／1 FAIL對照（含前版來源hash）與修後Node／瀏覽器報告保存在ATLAS_VALIDATION.json的regression-before、atlas-city-server及summit-city-race-browser records；原始預期失敗不計入PASS總數。
<!-- atlas-current-end -->

以下完整保留本輪開始前的HANDOFF原bytes，各輪狀態以當時時間理解。

<!-- summit-current-start -->
# 2026-11-18最新：Summit十二項改善與新玩法

承接已套回但尚未提交的Nexus build 64bc8f19a76a。本輪十二項在DCISI/taipei-gp-summit-work完成整合與本機驗證，build **8447a11b8964**。功能見[SUMMIT_FIXES.md](./SUMMIT_FIXES.md)，證據見[SUMMIT_VALIDATION.md](./SUMMIT_VALIDATION.md)／JSON。Summit Node 9套114案、browser28案；Nexus Node88案／browser29案／visibility6案；Horizon87案、Evolution91案、歷史33套393案、原26套與固定3通過。資源byte/gzip另列實測，不能當實機速度。

封版時尚未套回原專案、commit、push或部署。不要重跑舊Apply或從HEAD覆蓋未提交成果；後續須以本輪成功套用收據與獨立核對為準，封版文件不等於成功套用。Git基準67ce0881c91caddbdfcfb424e37ac74188862c0c、branch multiplayer-test、main 2dee076de30da52fe20b4d33faf659e6acf0aed3均未由封版器操作。不可變before為DCISI/taipei-gp-summit-before-64bc8f19a76a，702檔inventory SHA256 cc9e643ca6015aaf74dd0247aeca99dcd4c179dafd4d974c690a83851e686cb6。

前後端須同步更新：合作v2、城市競速city-race-v1與GP Summit／replay v2；exact Origin、/ws／/coop／/city-race共用連線上限。正賽大廳名單減少會清除整份排位並重新準備；續接新socket的耐久／道具序號可重新起算，舊socket仍失效。城市184tiles在listen前預熱，本機RSS約293MB不代表免費主機容量。真手機、真手把、外網真人、完整勤務路線、長期負載／平衡與Docker實跑未驗，最後按[SUMMIT_PHONE_TEST_PLAN.md](./SUMMIT_PHONE_TEST_PLAN.md)驗收。AGENTS持續：繁中、虛構品牌、署名Rex <game88521@gmail.com>、不自行push、只測本機、實機最後。
<!-- summit-current-end -->

以下完整保留歷史原bytes，各輪目前／尚未以當時時間理解。

<!-- nexus-current-start -->
# 2026-11-18最新：Nexus六項新玩法

使用者指定的1～6為接力、合作配送、道具、賽事回放、挑戰分享碼及城市編輯器，已在DCISI/taipei-gp-nexus-work完成整合與本機驗證，build **64bc8f19a76a**。入口與範圍見[NEXUS_FIXES.md](./NEXUS_FIXES.md)，完整驗證見[NEXUS_VALIDATION.md](./NEXUS_VALIDATION.md)／JSON。新Node88案、封路顯示6案、browser29案、Horizon87案、Evolution91案、原26套、歷史33套393案、固定3與工具19項通過。

上一輪Horizon已套回並獨立核對、尚未提交；不要從HEAD還原或重跑歷史Apply。本封版時本輪尚未套回原專案、commit、push或部署。後續實際套回狀態以DCISI/TAIPEI_NEXUS_DELIVERY.md、taipei-gp-nexus-status.json、不可變成功Apply收據與獨立verifier為準；此封版文不代替成功收據。Git HEAD 67ce0881c91caddbdfcfb424e37ac74188862c0c，branch multiplayer-test，main 2dee076de30da52fe20b4d33faf659e6acf0aed3均未動。

不可變before DCISI/taipei-gp-nexus-before-999a1a3aa5b7，660檔inventory SHA256 ad0434d4cfee824963b4d4b3d8df1ec0301dbd62b8e1c034aaac98b6a6892c00；74個額外既有檔完整保留。使用新DCISI/Apply-TaipeiNexus.ps1：無旗標只預檢，-Apply -Build才備份套用及離線建置；verify-taipei-nexus-original.mjs需指定經核對manifest SHA。不能用預檢/latest代替成功套用證據。

前後端需同步更新arena/replay/coop契約；共用server Origin限制，合作新增/coop WS路徑；不操作Render/Vercel/Origin或正式站。合作位置非完整權威物理，自訂路線不支援多人賽道房。真手機、真手把、外網真人、玩法平衡與長時間負載未驗，最後按[NEXUS_PHONE_TEST_PLAN.md](./NEXUS_PHONE_TEST_PLAN.md)驗收。AGENTS持續：繁中、虛構品牌、署名Rex <game88521@gmail.com>、不自行push、只測本機、實機最後。
<!-- nexus-current-end -->

以下完整保留歷史原bytes，各輪目前/尚未以當時時間理解。

<!-- horizon-current-start -->
# 2026-11-18最新：Horizon十二項

使用者指定的1～12均已在DCISI/taipei-gp-horizon-work整合與本機驗證，build **999a1a3aa5b7**。項目與入口見[HORIZON_FIXES.md](./HORIZON_FIXES.md)，證據見[驗證](./HORIZON_VALIDATION.md)／JSON。新Node87案、browser30案、Evolution91案、原26套、歷史33套393案、固定3及交付工具19項通過。

上一輪Evolution已套回原專案並獨立核對，仍未commit／push；不要用HEAD覆蓋或重跑舊Apply。本輪來源副本**尚未套回原專案，沒有commit、push或部署**。Git基準HEAD仍67ce0881c91caddbdfcfb424e37ac74188862c0c，branch multiplayer-test；main 2dee076de30da52fe20b4d33faf659e6acf0aed3未動。

不可變before為DCISI/taipei-gp-horizon-before-b1f70bac2788，627檔inventory SHA256 4c0c6f912bf1f21ac9bdbe2742b0f56fd9619d408383d209c46905cc2ceff0b7。使用新DCISI/Apply-TaipeiHorizon.ps1，不帶旗標只預檢，-Apply -Build才備份、套用、離線建置及逐檔驗證；成功收據與verify-taipei-horizon-original.mjs才證明套回成功，預檢或latest不能代替。

多人新增房規／觀眾／淘汰／格位需要前後端一起更新；本輪沒有操作Render／Vercel／Origin或任何正式站。跨重啟系列續賽沿用固定SERIES_RESUME_SECRET規則。真手機、真手把、外網真人完整賽事與長時間壓測未驗。AGENTS照常：繁中、虛構品牌、全部舊車免費、未獲明確授權不push、只測本機、實機最後。署名Rex <game88521@gmail.com>。
<!-- horizon-current-end -->

以下完整保留歷史原bytes；各輪「目前／尚未」以該輪時間點理解。

<!-- evolution-current-start -->
# 2026-11-17最新：Evolution十二項優化與新玩法

使用者授權的1～12項已在DCISI/taipei-gp-evolution-work整合與本機驗證：AI安全並排／回場、多人站間簽名續賽、投票／隨機巡迴、自訂鍵位／手把、限時刷圈、讓秒追逐、四人2v2、GP三種挑戰、TT好友影子、自訂街賽賽曆、路段甩尾與易碎貨物配送。build **b1f70bac2788**；新Node91、browser31、原26套、legacy33套393案、固定3、交付fixture19通過。見[EVOLUTION_FIXES.md](./EVOLUTION_FIXES.md)與[驗證](./EVOLUTION_VALIDATION.md)／JSON。

基準Git HEAD為67ce0881c91caddbdfcfb424e37ac74188862c0c、multiplayer-test，上一輪已commit並push；main為2dee076de30da52fe20b4d33faf659e6acf0aed3。本輪來源副本**尚未套回原專案、沒有commit、push或部署**。不要把下面舊段落的「尚未提交」當成目前基準狀態，也不要重跑舊Apply／Publish覆蓋現有成果。

不可變before=DCISI/taipei-gp-evolution-before-d251460c360c，inventory591檔、SHA256 36d203784e512295d7b4c60e49a20cda4809731a158ef66a1599c841d78feacb。只用新的DCISI/Apply-TaipeiEvolution.ps1；不帶旗標先預檢，-Apply -Build才備份、套用、離線建置及逐檔驗證。成功收據=taipei-gp-evolution-apply-receipt.json；latest或失敗預檢不能代替成功收據，原專案須再由verify-taipei-evolution-original.mjs核對。

多人須同步更新前後端，站間續賽需原瀏覽器席位能力；正式跨重啟需固定SERIES_RESUME_SECRET（32～4096 bytes），本輪未改真實環境或建立金鑰。四人loopback、受控成績與城市位置fixture不是外網真人完整賽事證據。手機實機、真手把、真人難度／長時穩定性仍待實測。

AGENTS持續適用：繁體中文、虛構品牌、未獲當輪明確授權不push、只測本機、手機實機最後做。署名Rex <game88521@gmail.com>。本輪不改Render／Vercel／Origin。
<!-- evolution-current-end -->

以下原bytes完整保留此前交接；各段「目前／尚未」是當輪歷史。

<!-- twelve-current-start -->
# 2026-11-17 最新：十二項改善（Twelve）

Rex授權的12項已完成整合本機驗證：長時錄製／存檔、同分決勝、接單取消、追緝預警、多人平滑／雷達／戰績／房規、TT區段練習、進站校準、逐路口導航與同級街賽。build **d251460c360c**，Node88、before22、新browser29、原26套、legacy27套305案、固定3、交付fixture19通過。規格見[TWELVE_FIXES.md](./TWELVE_FIXES.md)，完整證據與限制見[TWELVE_VALIDATION.md](./TWELVE_VALIDATION.md)／JSON。

work=DCISI/taipei-gp-twelve-work；不可變before=DCISI/taipei-gp-twelve-before-102e84eea8ea；inventory557檔，SHA256 b4538336021ffb6a1d9d5e16d4314ca15ad57ad5e29bb24955219bb160ee6f15。Git HEAD仍57b09b2f3f78dffd5dadac0ca83581c01f9c42c3、multiplayer-test，main為2dee076de30da52fe20b4d33faf659e6acf0aed3。不得用Git HEAD覆蓋既有未提交成果或重跑舊Apply／Publish。

本來源文件只表示工作副本通過，**尚未證明套回原專案，沒有commit、push或部署**。只使用新的DCISI/Apply-TaipeiTwelve.ps1；不帶旗標先預檢，-Apply -Build才備份、套用、離線建置與逐檔驗證。成功收據=taipei-gp-twelve-apply-receipt.json；latest或失敗預檢不能取代成功收據。原專案狀態依manifest雜湊、成功收據、verify-taipei-twelve-original.mjs與DCISI根交接確認，動態保留原有未知／忽略檔。

AGENTS仍適用：繁中、虛構品牌、未獲當輪明確授權不push、只測本機、手機實機最後做。署名Rex <game88521@gmail.com>。不改Render/Vercel/Origin。多人房規需新前後端配套，外網／手機／長時四人／真下載／難度平衡與校準準確度未驗，不能把受控fixture當成真人證據。
<!-- twelve-current-end -->

以下完整保留此前交接；各段「目前／尚未」是當輪歷史。

<!-- tenpack-current-start -->
# 2026-11-16 最新：十項改善（TenPack）

Rex選擇的十項均已完成：GP小螢幕HUD、完賽觀戰、同房圈數、自動畫質、3～5圖連賽、全車逐圈胎段、自訂賽季、TT遙測教練、分級警察職涯、3～5站觀光載客。最終工作副本build **102e84eea8ea**。新增Node100、新版browser29、舊26套、固定3、交付fixture19全PASS；另有before browser3與舊Node205。規格／使用入口見 [TENPACK_FIXES.md](./TENPACK_FIXES.md)，範圍與限制見 [TENPACK_VALIDATION.md](./TENPACK_VALIDATION.md)／JSON。

work=DCISI/taipei-gp-tenpack-work；不可變before=DCISI/taipei-gp-tenpack-before-c220d98a7f5c；inventory529檔，SHA256 cc14632b7689778895e31d624fbfa10edecdab619fb89d9ea9cf324a6e8283eb；來源HEAD 57b09b2f3f78dffd5dadac0ca83581c01f9c42c3，multiplayer-test，main 2dee076de30da52fe20b4d33faf659e6acf0aed3。不可從Git HEAD還原既有未提交改善。原專案另74個既有未知／忽略檔由套用前完整盤點動態保留。

只用新的 Apply-TaipeiTenPack.ps1（預檢不帶旗標，套用需-Apply -Build）；先備份、檢查整批與保留檔、離線build、逐檔驗證，不commit／push。成功真套用收據=DCISI/taipei-gp-tenpack-apply-receipt.json；latest結果與preflight各自另存；預檢／失敗／零檔重建不抹成功收據。原專案狀態必須由此收據＋verify-taipei-tenpack-original.mjs --manifest-sha256 <reviewed SHA>＋DCISI根交接確認，不能由本封存來源文件推定已套用。

不得重跑舊套用／發布工具；AGENTS規則繼續適用。手機實機最後測，外網／真人完整連賽、耗電與難度平衡尚未驗證，未授權本輪提交／推送／部署。
<!-- tenpack-current-end -->

以下保留先前交接原文；各段「目前／尚未」是當輪歷史。

<!-- lobbybrake-current-start -->
# 2026-11-16 最新：連線等待、房主管理與即時抓地提示

接續 Rex「幫我繼續優化遊戲」，完成進房等待／取消／明確重試、大廳移除車手／房主交棒，以及 GP 雨天、胎種與磨耗反映到煞車提示及輔助線。詳細功能見 [LOBBYBRAKE_FIXES.md](./LOBBYBRAKE_FIXES.md)，管理訊息與相容契約見 [LOBBYBRAKE_HOST_CONTRACT.md](./LOBBYBRAKE_HOST_CONTRACT.md)。

最終 build **c220d98a7f5c**，baseline **57b09b2f3f78dffd5dadac0ca83581c01f9c42c3**，分支 `multiplayer-test`。**完整本機驗證已通過**：新增 Node 68 案、舊 Node 118 案（上一輪42＋既有多人76）、原單人26套、最終版browser28案、before對照2案、固定三回歸與安全套用fixture15案全部PASS。`LOBBYBRAKE_VALIDATION.json` 為 `status=PASS`，收錄27份報告及22個交付程式／測試來源雜湊；產品SHA256為 `a877800df9e2026a5ed0b19e36736f18e4cceb35bb5c9ab3e0f0daa5388fd56c`。最終browser與固定回歸均驗本build；詳見 [LOBBYBRAKE_VALIDATION.md](./LOBBYBRAKE_VALIDATION.md)，各組有重疊覆蓋。

三固定基準完全一致：TT 54.425 hits0／aiHits0、陳冠宇162.0／aiHits8、進站175.7／aiHits5，未修改期望數字。car／track／rivals／pitlane／server physics五檔與before逐位元一致；本輪main、world、獨立提示模型及多人相關程式有修改，不更動模擬亂數。wire仍v2加法相容，physics仍classic-multitrack-collisions-v3。

入口僅重試WebSocket握手：原單次7秒、間隔1.5秒、總等待上限45秒；傳輸開啟後，建立／加入／續接命令只送一次，房間拒絕改由玩家明確重試。可取消、保留輸入，不新增HTTP健康探測。房主管理僅在大廳且server提供能力時顯示，確認後再次檢查房碼／世代／權限；被移除身分撤銷續接憑證並停止自動重連，仍可手動取得新身分加入。舊server省略能力時隱藏管理入口。

GP提示讀取已有胎種／濕度／磨耗的car.gripMul，獨立保守曲線最多4Hz更新，重用線色buffer；不回寫track.vTarget或車輛／AI物理。進維修道in／box／out不顯示煞車警告，非GP／排位／回放恢復原曲線。提示屬中心線估計，未量測真人整圈改善或保證實際安全速度。

work=`DCISI/taipei-gp-lobbybrake-work`；不可變before=`DCISI/taipei-gp-lobbybrake-before-f8ca4b1d251c`；inventory=`taipei-gp-lobbybrake-baseline.json`，完整515檔，SHA256=`d9e2ad65d1989fae60b153d11a9323f036f21557c8cb4b409170610cf4f5f692`，已包含前幾輪未提交成果。歷史NEXT6三份與RACEPLUS三份文件／JSON均保留原bytes。before browser使用保留f8ca4b1d251c建置的`DCISI/taipei-gp-raceplus-work`；彙整另核其完整515檔與inventory一致，報告來源hash仍對不可變snapshot，不接受任意control路徑。

**目前尚未套回原專案，沒有commit、push或部署。** 本文件於封裝前寫入；原專案後續套用須核對 `DCISI/taipei-gp-lobbybrake-apply-result.json`、獨立 `DCISI/taipei-gp-lobbybrake-original-verification.json`、manifest與逐檔現況，後續由`DCISI/TAIPEI_GP_CODEX_HANDOFF.md`追蹤。只用本輪`DCISI/Apply-TaipeiLobbyBrake.ps1`；無參數唯讀預檢，`-Apply -Build`才先備份、套用、建置及逐檔驗證。不要重跑舊Apply／Publish，也不以Git HEAD覆蓋未提交成果；來源與測試通過不等於已套回或已發布。

只測本機，不改Render／Vercel／ALLOWED_ORIGINS。CDP預設9334；本輪多人preview4330／WS4331、抓地提示4332；既有圈速4325／4326、策略4327、期限4319／4322、固定三基準4318，browser循序執行。手機尺寸為桌面Chrome模擬；844×220既有策略摘要覆蓋warning上緣約8px但文字主體可見，390×844直式橫握提醒疊在warning下緣，不能宣稱完全無遮擋。手機實機、外網延遲、長時間四人對戰、全24圖真人完整駕駛、策略估值誤差、真觸控、耗電／FPS未驗證；手機實機最後測。clipboard／share仍採替身，未發送訊息。後續明確授權提交時使用繁中訊息與`Rex <game88521@gmail.com>`。
<!-- lobbybrake-current-end -->

以下完整保留各輪歷史；下方的「最新／未套回」是當輪記錄，本輪狀態以上方LobbyBrake段落及實際驗證／套用狀態檔為準。

<!-- raceplus-current-start -->
# 2026-11-16 最新：進站策略、多人圈速與房碼邀請

接續 Rex「幫我繼續優化遊戲」：進站估值納入指定下一套胎、當下濕度與近期有效胎耗，進站中改顯示階段／鎖定胎種；多人增加權威逐圈、最快圈、完賽差距與可切換車手的圈表；新增乾淨邀請連結、分享及手動複製備援。朋友開連結只預填房碼，按加入才連線。完整範圍見 [RACEPLUS_FIXES.md](./RACEPLUS_FIXES.md)。

最終 build **f8ca4b1d251c**，baseline **57b09b2f3f78dffd5dadac0ca83581c01f9c42c3**，分支 `multiplayer-test`。**完整本機驗證已通過**：新增 Node 42 案、既有多人 Node 76 案、原單人 26 套、最終 browser 15 案、舊版對照 4 案、固定三回歸與安全套用 fixture 12 案全部 PASS。`RACEPLUS_VALIDATION.json` 為 `status=PASS`，收錄 19 份報告、22 個交付程式／測試雜湊，產品 SHA256 為 `263b8b728692918a5acb07f2247f7b19179da8acb02d32ab06b84c3f68dafd53`。最終 browser／固定回歸均驗本 build；詳見 [RACEPLUS_VALIDATION.md](./RACEPLUS_VALIDATION.md)，各組有重疊覆蓋。

三固定基準完全一致：TT 54.425 hits0／aiHits0、陳冠宇162.0／aiHits8、進站175.7／aiHits5，未改基準。car／track／rivals／pitlane／server physics 五檔已核對與 before 逐位元一致；本輪 main／strategy 與相關 UI 有修改。wire protocol 仍 v2 加法相容、physics 仍 classic-multitrack-collisions-v3；舊 server 無逐圈欄位時明示未提供成績，不捏造圈速。

work=`DCISI/taipei-gp-raceplus-work`；不可變 before=`DCISI/taipei-gp-raceplus-before-38335611f205`；inventory=`taipei-gp-raceplus-baseline.json`，共 504 檔，已包含 Rex 確認套回的上一輪 34 個未提交修改。歷史 `NEXT6_FIXES.md`、`NEXT6_VALIDATION.md`、`NEXT6_VALIDATION.json` 原封保留；下方「最新／未套回」是各輪當時記錄，不代表本輪狀態。

本文件於封裝前寫入，當時尚未核對原專案套用，也未 commit、push 或部署。原專案是否已套用，以 `DCISI/taipei-gp-raceplus-apply-result.json`、獨立 `DCISI/taipei-gp-raceplus-original-verification.json`、manifest 與逐檔現況為準；後續狀態由 `DCISI/TAIPEI_GP_CODEX_HANDOFF.md` 追蹤。只用新 `DCISI/Apply-TaipeiRacePlus.ps1`，無參數唯讀預檢，`-Apply -Build` 才備份／套用／建置／逐檔驗證。來源交接及測試通過不等於已套用。不要重跑舊 Apply／Publish 工具或用 Git HEAD 還原未提交成果，本輪未有發布授權。

只測本機，不改 Render／Vercel／ALLOWED_ORIGINS。新多人 browser 用 preview4325／WS4326，策略 browser 用4327，既有多人 browser 用4319／WS4322，固定三基準用4318，CDP預設9334；browser循序執行。手機實機、外網延遲、長時間四人對戰、全24圖真人完整駕駛、策略估值誤差與耗電／FPS尚未驗證；clipboard／share為替身，未發送訊息。後續明確授權提交時使用繁中訊息及 `Rex <game88521@gmail.com>`。
<!-- raceplus-current-end -->

以下保留全部歷史，本輪狀態以上方 RacePlus 段落及實際驗證／套用狀態檔為準。

<!-- next6-current-start -->
# 2026-11-16 最新：Rex 選定的六項優化已完成驗證

範圍為 [NEXT6_FIXES.md](./NEXT6_FIXES.md) 的 1～6：有效 TT 完圈才提交最佳分段、排位／GP 紀錄隔離、賽季續賽分段、警車碰撞回饋、街賽結算凍結與非同步下一站保護、多人 keyed 清單／30及60fps／閒置10fps、伺服器完賽倒數及 DNF 原因。未擴做分析的 7～13。

最終 build **38335611f205**，baseline **57b09b2f3f78dffd5dadac0ca83581c01f9c42c3**，分支 `multiplayer-test`。建置、原26套、分項新增53案例、原多人client/UI/碰撞client/server共63案例、真browser14案例、固定3基準與套用fixture12案例均通過。原26套有一項毫秒級下載逾時測試先失敗，再以同產品／原斷言孤立重跑一次通過；原失敗保留。詳見 [NEXT6_VALIDATION.md](./NEXT6_VALIDATION.md) 與完整JSON，不將各組重疊覆蓋當成獨立功能數量。

三固定值仍為54.425 hits0／aiHits0、陳冠宇162.0／aiHits8、進站175.7／aiHits5。car／track／rivals／pitlane與server physics bytes未變；wire protocol仍v2加法相容，physics仍classic-multitrack-collisions-v3。新截止與DNF資訊需新server提供欄位；本輪未commit、push或部署。

work=`DCISI/taipei-gp-next6-work`；不可變before=`DCISI/taipei-gp-next6-before-57b09b2`；inventory=`taipei-gp-next6-baseline.json`，490檔。只用新 `DCISI/Apply-TaipeiNext6.ps1`，無參數唯讀預檢，`-Apply -Build`才備份／套用／建置／逐檔驗證。原專案是否已套回以 `DCISI/taipei-gp-next6-apply-result.json`、manifest及當下檔案核對為準；來源交接不預先宣稱套用成功。不要重跑舊Apply／Publish工具，也不以Git HEAD覆蓋未提交成果。

不清歷史來源不明的最佳分段；續賽前歷史圈表／回放從續賽起重記，當圈分段保留。手機實機、耗電、音質、外網真人碰撞與全24圖逐圖駕駛未驗。CDP9334；新browser用4319/4322與4324、固定三基準自開4318，不碰既有4317；詳細命令見驗證文件。

上一輪碰撞提交57b09b2已推送測試分支，Rex回報兩平台已更新，最新頁面為 https://taipei-p7316te67-rex-7837.vercel.app/multiplayer.html ，Render為 https://taipei-gp.onrender.com 。該Origin後端10項通過，Rex僅確認「能開頁，尚未雙人測試」。本輪不連外、不改Origin、不重新部署；下方碰撞／24圖的「未發布」是當時歷史，不能當作現況或本輪發布授權。
<!-- next6-current-end -->

以下保留各輪歷史，現況以本輪段落、DCISI狀態檔及逐檔驗證為準。

<!-- multiplayer-collisions-current-start -->
# 2026-11-13 最新：多人車輛碰撞

Rex要求「我想要讓連線對戰的車會互相撞到」。已完成追撞傳速、側擦推開、高速掃掠、高度分層、權威計圈以及接觸時的前端預測／畫面同步。適用既有台北＋23 GP，保留classic操控。build **8b61f77003ce**；physics **classic-multitrack-collisions-v3**，wire protocol仍2；必須配套更新前後端，舊24圖physics v2會被拒絕。

本機驗證全部通過：碰撞物理14／server9／client16／雙browser5；原server14／maps9／client26／UI8／geometry26／resources4／maps-browser6／單人26／固定3。固定三數值54.425 hits0／162.0 aiHits8／175.7 aiHits5未改，單人核心五檔bytes不變。詳見 [設計](./MULTIPLAYER_COLLISIONS.md)、[驗證](./MULTIPLAYER_COLLISIONS_VALIDATION.md)及JSON。持續frame測試不是實際FPS量測；手機、外網碰撞及全24圖逐圖駕駛未驗。

work=DCISI/taipei-gp-collision-work，before=DCISI/taipei-gp-collision-before-f586ca9，baseline=f586ca96bfe73b0d7e6d38a749b14b4386f6f5bb，inventory包含481檔。只用新的 Apply-TaipeiCollisions.ps1；先備份、驗雜湊及保留檔，再套用／build／核對，不自行commit或push。套回原專案是否成功，以 DCISI/taipei-gp-collision-apply-result.json 與逐檔現況為準，不由本來源文件推定。

上一輪24圖版已於 f586ca9 部署Render及Vercel測試版，Rex確認「看得到地圖，且已雙人起跑」；下方maps的「未部署」是當時歷史。該發布授權已完成，不延伸為本輪碰撞的commit／push授權。本輪尚未公開部署，不測正式站。
<!-- multiplayer-collisions-current-end -->

<!-- multiplayer-maps-current-start -->
# 2026-11-13 最新：多人可選台北與全部23條GP地圖

Rex已回報舊v1成功連線，請勿繼續把舊endpoint／分享登入問題當作當前阻擋。本輪已完成24圖、房主大廳換圖、全員載入確認與重新準備、失敗重試、GP場景及換圖資源清理，使用既有multiplayer classic性能。版本為v2，尚未公開部署；v1/v2不相容，需同步更新前後端。未授權本輪commit／push。

build **65dd59ab8882**，產品 SHA256 **841581350e52fadea6ed41e06a0d3a76ff4f97967069a44e5839f68b9c1dde41**；server14／maps-server9／client26／UI生命周期8／geometry26／resources4／雙browser6／原Node26／固定3全部通過。三固定值54.425 hits0／aiHits0、162.0／aiHits8、175.7／aiHits5完全不變，單人核心五檔bytes不變。完整限制見 [MULTIPLAYER_MAPS_VALIDATION.md](./MULTIPLAYER_MAPS_VALIDATION.md) 與JSON；舊v1證據保留，不當成本輪結果。

本輪工作副本 `DCISI/taipei-gp-maps-work`；不可變before `DCISI/taipei-gp-maps-before-f41315a`，來源HEAD `f41315a3e4fff78a251d5ebbf97b53b26571d2be`，原專案當時乾淨。不要用舊multiplayer／ALL／ABCD套用或發布工具：舊工具綁不同baseline。新交付 `DCISI/taipei-gp-maps-delivery` 與 `Apply-TaipeiMaps.ps1` 先唯讀預檢、備份、保護464個baseline檔、套用、build及逐檔核對，不commit／push。是否已套回原專案，以 `DCISI/taipei-gp-maps-apply-result.json` 的manifest身份、applied／built／verified及逐檔現況為準，不能由這份來源文件推定。

功能見 [MULTIPLAYER_MAPS.md](./MULTIPLAYER_MAPS.md)，發布見 [MULTIPLAYER_DEPLOYMENT.md](./MULTIPLAYER_DEPLOYMENT.md)，現有端點 `wss://taipei-gp.onrender.com/ws` 仍是舊v1。手機實機最後測；本輪v2外網與Docker尚未驗。CDP9334可用，maps browser／fixed各自開新4318 preview並只清自己的contexts，別誤連舊4317／4320的v1。幾何測試回原專案執行時請用--baseline指定DCISI中的本輪before。
<!-- multiplayer-maps-current-end -->

以下為先前各輪歷史，當前狀態以上方maps段落為準。

<!-- multiplayer-current-start -->
# 2026-11-13 最新交接：私人房連線競速

使用者選定賽道競速 2～4 人私人房，以及無主機的免費測試方案。多人版在 DCISI/taipei-gp-work 完成，build **c27a6eb50a74**；產品來源 SHA256 **79c25ed69d7cb0ad04e37b00070bd091d0826f599f8107ab62dccca305346bbe**。目前未 commit／push，未建立 Render 服務或公開 WSS。原專案實際套用須以 DCISI/taipei-gp-multiplayer-apply-result.json 與 taipei-gp-multiplayer-original-verification.json 核對，不可由本文件推定。

功能：台北賽道 1／3／5 圈、六碼私人房、全員準備及三秒共同起跑、排名／成績／再戰。伺服器沿用原 Car／track，以 60Hz 權威物理及 20Hz 快照運作；客戶端只送方向／煞車，含自車預測校正、遠車插值、700ms 無輸入煞車、10 秒重連、DNF／房主移交／清房及輸入限制。不寫單人 PB、獎金、賽季或排行榜。玩家互不碰撞。

實測：真 WS／真權威物理 14／14、client 16／16、單瀏覽器＋真 WS peer 11／11、原 26／26 套、固定 3／3、套用工具 16／16。同 Chrome 兩個隔離 browser contexts 同時真實繪圖 9／9 通過，使用正常圖形設定；歷史強制 SwiftShader 失敗仍保留，不宣稱唯一根因。兩台實機／外網尚未驗證。固定基準維持 BOT 54.425 hits0／aiHits0、陳冠宇162.0／aiHits8、進站175.7／aiHits5。

架構與啟動見 [MULTIPLAYER.md](./MULTIPLAYER.md)，實測與完整限制見 [MULTIPLAYER_VALIDATION.md](./MULTIPLAYER_VALIDATION.md)／JSON。Render Free 原生 Node 部署設定見 [MULTIPLAYER_DEPLOYMENT.md](./MULTIPLAYER_DEPLOYMENT.md) 與 render.yaml；前端沿用 Vercel。免費方案最新條件未核實，控制台若不是 Free／0 費用就停止；帳號由 Rex 登入。仍需發布授權、實際 WSS URL、ALLOWED_ORIGINS 及 VITE_MULTIPLAYER_URL 後重建測試部署。

本輪不可變 before 是 DCISI/taipei-gp-multiplayer-before-ae3c201679c2（503 檔），inventory.source 是原專案，不是 work；HEAD 為 2dee076de30da52fe20b4d33faf659e6acf0aed3，包含既有未提交成果。只用新的 Apply-TaipeiMultiplayer.ps1，不重跑前輪工具，不以 Git HEAD 還原。套用前先備份、核對整批雜湊與保留檔；server 依賴另依 lock 安裝，不複製 node_modules。

本機 preview 4317；WS 4320/ws、health 4320/health；本輪 UI 測試 CDP 9334，固定三回歸使用 9333。使用者啟動 Chrome 的 updater AccessDenied 不影響已確認可用的 CDP。所有新測試使用隔離 context／資料並清理，不碰正式站或玩家存檔。手機實機、外網、真 BFCache、Docker 尚未驗證。歷史 ALL／FOLLOWUP／ABCD／PRIORITY 文件保留，不能視作多人測試結果。
<!-- multiplayer-current-end -->

<!-- all-current-start -->
# 2026-11-12 最新交接：全模式優化完成驗證

使用者要求「幫我全部都做」。本輪完成 U／V／W／X／Y、E／F／G／H／I／J／K／L／M／N／O、Q／R／S；P併V，T增加受控邊界防護。完整內容見 [ALL_FIXES.md](./ALL_FIXES.md)，驗證見 [ALL_VALIDATION.md](./ALL_VALIDATION.md)／JSON。最終build **ae3c201679c2**，來源SHA256 **181fd12a7acccdee92b302afb8612c70264d417c231d57d420e632700712ba63**。本輪不commit、不push、不測正式站。

結果：26／26套程式回歸、固定3／3、瀏覽器59項（各實測build見驗證表）、套用工具fixture12／12。固定值54.425 hits0／aiHits0、陳冠宇162.0／aiHits8、進站175.7／aiHits5未改。城市地標2,466個，progress上限10,000；系列options僅三欄，避免舊results嵌入。手機實機、耗電、音質與真人難度平衡尚未驗證。

本輪before是DCISI/taipei-gp-all-before-811385b20e05（1,097檔，含followup／A～D未提交成果），inventory為taipei-gp-all-baseline.json。不得以Git HEAD或舊包覆蓋。新交付為taipei-gp-all-delivery／Apply-TaipeiAll.ps1，先備份、逐檔雜湊、保留舊成果；不重跑舊priority／followup／ABCD工具。

原專案是否已套用，請讀DCISI/taipei-gp-all-apply-result.json並執行DCISI/verify-taipei-all-original.mjs，以allDeliveryFilesMatch／previousWorkPreserved／immutableBaselineMatches／distMatches為準；最新工作狀態另見DCISI/TAIPEI_GP_CODEX_HANDOFF.md最上方。此文件與測試通過不等於已commit、push或部署。Git若日後明確授權提交仍用Rex <game88521@gmail.com>及繁中訊息。
<!-- all-current-end -->

以下是歷史交接；舊版待辦或驗證數不代表本輪狀態。

<!-- abcd-current-start -->
# 2026-11-11 最新交接：A～D 已實作並完成驗證

Rex 選定的 A 正常多分頁存檔保護、B GP完整計圈、C 開地圖停止累計里程、D 導航六秒定期重算已完成。正式build `811385b20e05`；20／20套自動測試、固定回歸3／3、真雙分頁瀏覽器8／8、原救援／啟動瀏覽器7／7與原生離頁保存4／4通過。固定數值仍為54.425 hits0／aiHits0、陳冠宇162.0／aiHits8、進站175.7／aiHits5，未改基準。

對照基準為 DCISI/taipei-gp-abcd-before-3bdf97336c02，包含上一輪已套用的20個未提交檔案；不可用Git HEAD 2dee076當本輪before。A不支援Web Locks時僅逐次比對，無同時寫入原子性保證；B不追溯清除舊錯誤紀錄。手機實機與正式服務未驗證。

詳見 [ABCD_FIXES.md](./ABCD_FIXES.md)、[ABCD_VALIDATION.md](./ABCD_VALIDATION.md)及JSON。總入口tools/dev-tests/abcd-checks.mjs（20套），對照資料夾環境設定見驗證文件。上一輪followup／priority文件均保留歷史，不可將舊測試結果當本輪結果。

此文件於封裝前更新；原專案實際套用須讀 DCISI/taipei-gp-abcd-apply-result.json、taipei-gp-abcd-original-verification.json及TAIPEI_GP_CODEX_HANDOFF.md最上方。本輪工具 Apply-TaipeiABCD.ps1 無參數為唯讀預檢；-Apply -Build先備份再套用建置，不commit、不push。禁止重跑舊followup／priority套用包；本輪未授權提交／上版。
<!-- abcd-current-end -->

以下保留先前交接；本輪範圍與狀態以上方及ABCD文件為準。

<!-- followup-current-start -->
# 2026-11-11 最新交接：六項後續優化已完成驗證

基準與目前已知線上提交為`2dee076`。本輪已完成分析項1～5、17：GP無效圈不拿最快圈積分、損毀存檔救援、重要無線電優先、WebGL啟動失敗重試、罰款應罰／實扣明細、30／60／不限幀率與真實FPS。未新增其他玩法，不追溯舊積分。

工作副本`DCISI/taipei-gp-work`正式build `3bdf97336c02`、16套自動測試、固定回歸3／3、本機隔離瀏覽器7／7通過。固定數值54.425 hits0／aiHits0、陳冠宇162.0／aiHits8、進站175.7／aiHits5。存檔救援也已防範初始主檔缺失後的跨頁新進度覆寫，以及額外快照提早占滿容量。手機實機效能與耗電尚未量測。

詳情見 [FOLLOWUP_FIXES.md](./FOLLOWUP_FIXES.md)、[FOLLOWUP_VALIDATION.md](./FOLLOWUP_VALIDATION.md)與JSON。`tools/dev-tests/followup-checks.mjs`是16套總入口，對照資料夾設定見驗證文件；不要沿用舊12套摘要推定本輪結果。

本文件於交付封裝時更新；原專案套用結果須核對`DCISI/taipei-gp-followup-apply-result.json`與manifest逐檔雜湊。套用工具`Apply-TaipeiFollowup.ps1 -Apply -Build`會先備份，無參數只做唯讀檢查。本輪未要求commit／push，不可自行上版；前輪2dee076上版已完成，禁止重跑舊套用／發布工具。權限阻擋與使用者後續處理請先讀`DCISI/TAIPEI_GP_CODEX_HANDOFF.md`最上方。
<!-- followup-current-end -->

以下保留先前交接歷史；最新範圍與測試結果以上方及FOLLOWUP文件為準。

<!-- priority-current-start -->
# 2026-11-11 全模式優先改善（上版交接）

本輪已套用原專案並通過建置；61個交付檔案、223個dist產物與已測試版本完全一致，build `99f984fced89`。Rex 已明確授權本輪提交並推送 main 觸發部署。提交／推送／部署的最終狀態以 DCISI/taipei-gp-priority-publish-result.json 及 GitHub 對該提交的 Vercel 狀態為準。不要重跑舊補丁、舊 release 或套用腳本。

基準 feaa6ff；本輪完成規則分榜／有效圈、GP結算／計時點、賽季續賽／同分比較、歷史回放、街頭同層互動與任務互斥、街賽PB／路線圖、甩尾練習、載客明細、各車車況、烤漆試色、收支／完整備份、排行榜與下載／離線／GPU穩定性。完整項目與限制見 [PRIORITY_VALIDATION.md](./PRIORITY_VALIDATION.md)。

驗證：正式build、12組自動測試、固定回歸3/3、手機尺寸UI9/9、非BOT GP瀏覽器3/3。三項基準54.425 hits0／aiHits0、陳冠宇162.0／aiHits8、進站175.7／aiHits5。手機實機與正式Redis Lua仍未驗證；排行榜為軌跡合理性檢查，非權威防作弊。本輪未使用線上遊戲測試。

上版必須包含 api/leaderboard.js、shared/lap-proof.js、shared/taipei-track.json。沿用既有KV／Upstash環境變數，不需新增套件。作者一律 Rex <game88521@gmail.com>。上版結果不能由下方歷史紀錄推定；先前『未套用』及403為已處理歷史。
<!-- priority-current-end -->

以下為先前交接／上版歷史，狀態以最上方本輪說明為準。

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
