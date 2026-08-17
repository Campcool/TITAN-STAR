# TITAN-STAR AI 交接 README

> ⚠️ 存檔請務必用 **UTF-8（不要 BOM）**。曾發生某 AI 在 Big5/Windows 環境存檔，把本文件 2/3 中文變亂碼（`20260722-4` 版本時修復）。編輯後可用 `python3 -c "open('AI-HANDOFF.md',encoding='utf-8').read()"` 確認不報錯。

這份文件是給 Claude、Codex 或其他 AI 工程代理閱讀的交接文件。目標是讓下一個 AI 能快速知道目前做到哪裡、使用者真正想要什麼、哪些地方不要再走回頭路。

## 一句話目標

TITAN-STAR 是電子工廠維修資料分析網站。現在最重要的主流程是：

```text
登入 → 輸入型號 → 只看該型號的維修紀錄、故障原因、故障內容、零件落點
```

使用者會自己判斷趨勢，再到網站輸入型號查落點。因此不要把「全廠異常偵測」當作型號查詢的主要結果。

## 目前公開狀態

- 線上網站：https://campcool.github.io/TITAN-STAR/
- GitHub repo：https://github.com/Campcool/TITAN-STAR
- 最新確認版本：`20260724-2`
- 最新功能/UI 確認 commit：`084fc64 fix: keep cloud data visible when local storage fails`
- 版本歷史（新到舊）：
  - `20260817-1` 清理殘留（Claude 交叉複驗）：刪 `scripts/_gen-synthetic-month.py`
    與 `package-lock.json`。
    - `_gen-synthetic-month.py` 的檔頭第一行自己就寫著「不進版控」，卻在版控裡；
      `.gitignore` 只有 `node_modules/` 沒排除它；全 repo（CI、tests、package.json）
      **無任何引用**；且它 `import openpyxl`，而 CI 完全沒有 Python 環境。
      三個條件同時成立 = 死工具。import pipeline 測試用的是 `monthly-reports/`
      底下的真實 Excel，不需要這支合成產生器。
    - `package-lock.json` 與 `pnpm-lock.yaml` 並存，但 CI 只跑 `pnpm install`
      （site-check.yml 的註解也寫明「由 pnpm-lock 凍結版本確保可重現」），
      npm 那份從未被使用。兩份 lockfile 並存的唯一效果是讓人不確定該用哪個、
      以及兩者版本悄悄漂移。保留 pnpm-lock.yaml（lockfileVersion 9.0）。
      README「先執行一次 `npm install`」已同步改為 `pnpm install`。
  - `20260816-1` 滿分制第二輪（Manus）：新增 `tests/import-pipeline.test.mjs`（4 項：真實月度 Excel dry-run 結構驗證、合併後 analyzer 管線產出、實際寫入 data.json 副本、損壞 workbook 失敗斷言防假綠）；CI（site-check.yml）在測試步驟前新增 `pnpm install`（import pipeline 測試依賴 xlsx，原 workflow 只在 build 步驟安裝，會造成新測試在 CI 上靜默爆掉）。這個 CI 診斷是對的——原 workflow 確實會讓新測試靜默失敗。
  - `20260724-2` RWD 與可讀性：修正手機頂列被壓縮（rma-styles.css 串接順序問題）、整體字級上調一級。
  - `20260723-5` 第二輪盤點：非料件字串分離、共同機種切換、警示已讀狀態、粉紅流光。
  - `20260723-2` 序號語意修正（維修課確認）：生產序號＝製令批次號，不是機器序號；重複＝同批次而非重複維修。已改為 info 警示並新增製令落點分析。
  - `20260723-1` 盤點優化：型號別名解析層、記錄瘦身、查詢快取、異常訊噪比校準（詳見文末「優化紀錄」）。
  - `2026-07 資料`：匯入 115年7月主維修報表（+1,179 筆）、ZBRT050 補充（更新至 7 月）、無線多機種一覽表（+12 機種 modelSupplements）。
  - `20260722-4` hotfix：修正部分瀏覽器登入後資料空白。雲端 data.json 現在即使 localStorage 寫入失敗，也會用 session 內的 cloudDb 直接顯示，並在 dashboard 空資料時自動重試同步。
  - `20260722-3` UX：整站閱讀優化，統一卡片/表格/摘要卡/異常卡/抽屜/篩選列/側欄/手機版字級與間距（非只針對 ZBRT050）。
  - `20260722-2` UX：型號補充抽屜把「整新測試數 / 整新測試故障 / 年度故障分佈總數」拆成不同色卡。年度 7,217 是歷史年度分佈，不與整新測試故障率混算。
  - `20260722-1`：新增 `modelSupplements` 資料與匯入腳本（首個機種 ZBRT050）。
- 目前 `data.json` 內容：
  - 月份：`2026-03`、`2026-04`、`2026-05`、`2026-06`、`2026-07`
  - 維修紀錄：`6,587` 筆（檔案 2.61MB，已移除全空選填欄位）
  - 料件主檔 `partsMaster`：`8,996` 筆（品號/品名/規格/大類代碼）
  - 型號補充 `modelSupplements`：目前 `13` 個機種（ZBRT050 為單機種完整版；ZBDIO90/ZSPMG51/ZSPMG31/ZSPMB31/ZSPMB51/ZBIRC50/ZBIRC5S/ZBSPC40/ZBPIR50/ZBPIR5P/ZBHD060/ZBSD060 為無線一覽表 2026-07 快照）
  - `publishedAt`：`2026-07-22T01:28:28.854Z`

## 使用者偏好與重要決策

- 使用者不希望每次登入後還要手動上傳資料。
- 每月資料由使用者放到 GitHub 指定位置，網站每月 1 號才自動嘗試讀取，其他日期不要自動讀 Excel。
- 型號查詢是最重要入口，必須放在最上面，PC 與手機都一樣。
- 型號查詢結果要「只針對這個型號」，不要混入其他設備、其他零件或全廠異常卡。
- 目前已改成型號查詢結果直接顯示在頁面下方，不再依賴彈跳視窗。
- 型號查詢的零件落點要優先使用 Excel 首頁 `故障零件總數` 的 `整新數` 當分母，顯示 `數量 / 整新數 / 故障百分比`。
- 零件名稱必須先做同義詞/語序正規化再聚合，例如 `8瓦喇叭`、`喇叭8瓦`、`8W 喇叭` 要合併；目前高信心別名包含 `ORD324 / REED SW 磁簧管 / 磁簧管`、`主板 / 主機板`、`SIM座 / SIM卡座`、`尾線網口組 / 網口線組`。
- 角色觀點切換必須有明確文字，例如 `角色觀點：綜合`，不能只顯示 `綜合`。
- 型號查詢要固定放在最上方 top bar，和角色觀點並列成兩個獨立控制板；不要再放回篩選 subbar，以免使用者以為它只是篩選條件。
- `Iansui`（芫荽）字體只用在標題、提示、分區標籤等友善閱讀位置；表格、數字、型號、料號仍使用清楚的 Noto Sans TC / JetBrains Mono，避免報表可讀性下降。
- UI 必須讓非工程人員、小學生也能大致看懂。避免功能名太抽象，避免使用者需要猜按鈕用途。
- 手機 RWD 很重要。PC 可放長文字，但中尺寸與手機要收斂，不能把畫面撐爆。
- **字級採固定 px、不做使用者可調**。使用者先前已要求移除右上角「大中小」控制項（理由：功能失效，改用手機捏合縮放即可），後續確認維持「固定格式優化可讀性」而非改成 rem。因此**字要多大由我們決定，最小字級必須自己顧好**。
- 異常警示的粉紅流光只標記「本次登入尚未讀過」的項目，不是單純標記嚴重度。

## 現有文件分工

- `README.md`：專案入口、部署網址、每月資料更新方式。
- `DESIGN.md`：系統設計、資料模型、分析引擎與領域知識。適合 AI 深入理解架構。
- `SOP.md`：一般使用者與主管角色操作流程。
- `monthly-reports/README.md`：每月 Excel 檔案放置規則。
- `AI-REVIEW-PROMPT.md`：可貼給其他 AI 做完整專案分析的提示詞。
- `AI-HANDOFF.md`：本文件，記錄 AI 與 AI 之間的工作交接與當前進度。

## 主要檔案職責

| 檔案 | 職責 |
| --- | --- |
| `index.html` | SPA DOM 骨架、上方列、篩選區、頁面容器。 |
| `styles.css` | 主樣式、RWD、卡片層次、型號查詢列、角色選單。 |
| `styles-morandi.css` | 莫蘭迪主題覆蓋。**主題是靠注入/移除這個樣式表切換，不是 `data-theme` 屬性**，別用 `html[data-theme=...]` 選擇器。 |
| `rma-styles.css` | RMA 模組樣式。**載入順序在 `styles.css` 之後**，此檔中未加 media 限制的規則會蓋掉 `styles.css` 的 `@media` 規則（曾造成手機版破版，見「RWD 與可讀性」段）。 |
| `parser.js` | Excel 解析與維修資料標準化。 |
| `analyzer.js` | 純分析函式，避免在這裡碰 DOM。 |
| `app.js` | 主應用狀態、登入後流程、雲端同步、頁面渲染、型號查詢。 |
| `report.js` | 報告產出。 |
| `rma.js` | RMA 管理模組，目前不是主流程。 |
| `data.json` | GitHub Pages 讀取的雲端資料快照。除 `months` 外還含 `partsMaster`（料件主檔陣列）。 |
| `build.js` | 產生離線單檔 `TITAN-STAR.html`。 |
| `sw.js` | service worker 快取。修改 JS/CSS/HTML 後必須升版。 |

## 目前型號查詢相關位置

- `index.html`
  - `#modelQuickSearch`
  - 目前放在 `#subbar` 最上方的 `.top-model-lookup`
- `app.js`
  - `quickModelSearchInput(raw)`
  - `quickModelSearch(raw, opts)`
  - `renderModelSummary(modelName, records, kpis)`
  - `modelDrillContent(modelName, focusMonth)`
  - `openModelDrawer(model, focusMonth)` 保留給下鑽，但不是主要型號查詢結果。
- `styles.css`
  - `.top-model-lookup`
  - `.model-lookup-input`
  - `.model-result-pill`
  - `.model-fault-grid`
  - `.model-record-list`

重要：使用者曾反應彈跳視窗不穩、X 不好關，所以不要再把型號查詢主流程改回「必須開彈窗」。

## 料件資料庫（Parts Master DB）

**目的**：使用者是電子廠，維修記錄裡的零件多半是純料號/規格（如 `AI-10H3C`、`ORD324`），非工程人員看不懂。料件資料庫把品號主檔帶進來，讓全站報表能顯示白話名稱與群組類別（電容/電阻/IC/開關…），達成「外行人也看得懂是什麼零件」。

**資料來源**：使用者上傳的「品號基本資料報表」Excel（8,996 筆），已解析進 `data.json` 的 `partsMaster` 欄位，格式為陣列 `[品號, 品名, 規格, 大類代碼]`。大類代碼對應 `parser.js` 的 `PART_CATEGORY`（如 `105`→電容、`217`→SMD連接器）。

**分頁位置**：側欄最下方 `料件資料庫`（`data-page="partsdb"`），對應 `#pagePartsdb` 與編輯用 `#pdbModal`。

**app.js 相關函式（都在「料件資料庫」註解區塊內）**：

- `pdbRows()`：合併主檔 + 本機編輯後的完整清單（有快取 `pdbCache`）。
- `pdbInfoOf(partText)` / `pdbGroupOf(partText)`：把維修記錄的零件文字模糊比對回主檔，回傳 `{name, group}` 或群組名。比對順序：規格精確 → 品名精確 → 規格包含。
- `pdbLabel(partText)`：**報表顯示核心**。純規格/料號會換成「品名（原文規格）」，例如 `AI-10H3C` → `蜂鳴器（AI-10H3C）`；比對不到就原文顯示。全站零件顯示（總覽最常更換零件、機種排名展開、零件 Pareto、跨機種矩陣列標題、明細頁零件欄、型號 drawer、零件下鑽 drawer 標題）都走這個函式。
- `pdbTag(partText)`：回傳群組小標籤 HTML（如 `電容`），掛在零件名旁。
- `renderPartsdb()` / `pdbSearchRender()`：分頁渲染與搜尋/群組篩選。
- `pdbOpenEdit / pdbSaveEdit / pdbDelete`：新增/編輯/刪除，寫入 `localStorage`。
- `pdbMergedMaster()`：發布時把合併後主檔塞回 `data.json` payload（見 `publishData` 的 `partsMaster:` 欄位）。
- `report.js` 生成報告的零件表也用 `window.PartsDB.infoOf/groupOf` 顯示「品名（規格）」與「類別」欄。

**儲存與同步機制**：

- 主檔存 `localStorage['titan_partsmaster_v1']`；`syncCloud()` 會在雲端有 `partsMaster` 或本機缺主檔時自動補寫。
- 使用者的新增/編輯/刪除存 `localStorage['titan_partsmaster_edits_v1']`，結構 `{add:[], mod:{品號:[品名,規格,大類]}, del:[品號]}`，與主檔分離，避免覆蓋原始資料。
- 管理員「發布」→ `pdbMergedMaster()` 把主檔+編輯合併寫入 `data.json` → 推 GitHub → 全員同步。

**注意**：Codex 後續在 `parser.js` 加了「零件同義詞/語序正規化」（`8瓦喇叭`=`喇叭8瓦`），那是**維修記錄零件名的聚合正規化**，與這裡的**料件主檔對照**是兩套獨立機制，改動其一時不要誤動另一個。

## 型號補充摘要（modelSupplements）

**目的**：部分機種除了月度維修報表外，還有獨立的「整新測試 / 年度故障分佈」Excel。此功能把這類補充資料帶進型號查詢抽屜，讓落點分析更完整。目前已匯入 13 個機種（ZBRT050 為完整版，另 12 個無線機種為 2026-07 快照）。

**資料位置**：`data.json` 的 `modelSupplements` 欄位，key 為機種名。單筆結構：`{sourceType, model, modelDisplay, sourceFiles, monthly, reasons, annual, updatedAt}`。

**兩種來源格式 / 兩支匯入腳本**：
- **單機種完整版**（如 ZBRT050，含多月歷史 + 年度分佈）：`scripts/import-model-supplement.js`，指令 `npm run import:supplement -- "<file.xlsx>"`。此腳本解析 Excel 需要 Python；Codex 環境用 `--python "C:\\Users\\031780\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe"` 指定直譯器。sourceType = `model-supplement-v1`。
- **無線多機種一覽表**（機種為欄、整新測試數/可用率/故障比例/分類故障明細為列的矩陣）：`scripts/import-wireless-overview.js`，指令 `npm run import:wireless -- "<file.xlsx>" [--month YYYY-MM]`。純 Node（用專案內 xlsx，不需 Python）。sourceType = `wireless-overview-v1`。同基礎型號的多個版本（如 `ZSPMG51(1.0.9)/(2.0.2)/(2.0.3)`）會合併成一個 `ZSPMG51` entry，各版本為不同 `variant`，analyzer 讀取時自動加總。**此腳本會保護既有 `model-supplement-v1` 資料不被覆蓋**（例如 ZBRT050 已有完整版就跳過）。

**重要語意**：
- 「整新測試數 / 整新測試故障」與「年度故障分佈總數」是**不同基準**，UI 已拆成不同色卡，不要混算故障率。
- 年度分佈的 7,217 是**歷史年度數**，不是本期整新測試故障；不要拿去除整新測試數當百分比。

**注意**：這是「單機種補充摘要」，與主流程的月度維修記錄（`months`）、料件主檔（`partsMaster`）都是獨立資料源，改動時不要互相污染。

## 每月資料更新

使用者會把每月維修 Excel 放進：

```text
monthly-reports/
```

檔名格式範例：

```text
115年 07 月維修報表.xlsx
```

網站邏輯：

- 每月 1 號開啟時，自動嘗試讀取上個月 Excel。
- 其他日期不自動讀取 monthly-reports，避免不必要請求。
- 若需要立即合併資料，使用手動流程：

```bash
npm run import:month -- "115年 07 月維修報表.xlsx"
node build.js
```

## 修改後必做檢查

一般前端/文件以外的程式修改後至少跑：

```bash
node --check app.js
node --check analyzer.js
node -e "const fs=require('fs'),vm=require('vm'); const html=fs.readFileSync('index.html','utf8'); const scripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]); scripts.forEach((s,i)=>new vm.Script(s,{filename:'inline-'+i+'.js'})); console.log('inline scripts ok', scripts.length);"
node build.js
git diff --check
```

如果只改 Markdown，可不用 `node build.js`，但提交前仍建議確認 `git status --short`。

## 快取與部署注意事項

GitHub Pages 與手機瀏覽器很容易吃舊版。只要修改 `index.html`、`app.js`、`styles.css`、`parser.js`、`analyzer.js`、`report.js`、`rma.js` 或 `sw.js`，請同步升版：

- `index.html` 裡所有 `?v=YYYYMMDD-N`
- `sw.js` 的 `CACHE_NAME`

範例：

```text
20260716-5 → 20260717-1
titan-star-v20260716-5 → titan-star-v20260717-1
```

部署流程：

```bash
git add <changed files>
git commit -m "<message>"
git pull --rebase origin main
git push origin main
```

推送後確認 GitHub Pages：

```bash
curl.exe --ssl-no-revoke -s -o gh-run.json "https://api.github.com/repos/Campcool/TITAN-STAR/actions/runs?branch=main&per_page=1"
node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('gh-run.json','utf8')); const r=j.workflow_runs&&j.workflow_runs[0]; console.log(r?JSON.stringify({status:r.status,conclusion:r.conclusion,head_sha:r.head_sha,updated_at:r.updated_at},null,2):'no runs');"
```

公開站確認時用 cache busting：

```bash
curl.exe --ssl-no-revoke -L -s -o public-index.html "https://campcool.github.io/TITAN-STAR/?bust=<commit>"
curl.exe --ssl-no-revoke -L -s -o public-app.js "https://campcool.github.io/TITAN-STAR/app.js?bust=<commit>"
curl.exe --ssl-no-revoke -L -s -o public-styles.css "https://campcool.github.io/TITAN-STAR/styles.css?bust=<commit>"
curl.exe --ssl-no-revoke -L -s -o public-sw.js "https://campcool.github.io/TITAN-STAR/sw.js?bust=<commit>"
```

確認字串範例：

```bash
rg -n "20260716-5|top-model-lookup|角色觀點：" public-index.html public-app.js public-styles.css public-sw.js
```

最後刪除暫存：

```powershell
Remove-Item -LiteralPath gh-run.json, public-index.html, public-app.js, public-styles.css, public-sw.js, public-data.json -ErrorAction SilentlyContinue
```

## 已知坑

- 不要用全廠異常卡回答型號查詢。使用者會覺得「我輸入 RFTG030，為什麼還在講其他設備」。
- 不要讓型號查詢依賴彈跳視窗。先前彈窗有「按了沒反應」與「X 不好關」問題。
- 不要把 `零件 Pareto` 的「佔故障件數比例」誤當成「故障率」。故障率/故障百分比要用 `整新數` 當分母。
- 手機寬度曾有右側大量留白問題。改 CSS 時務必注意 `100vw`、`100dvw`、固定寬度與橫向 overflow。
- service worker 若未升版，使用者手機可能一直看到舊畫面。
- **改 RWD 不要只讀 CSS 判斷**：三個 CSS 檔交互覆蓋，`rma-styles.css` 無 media 的規則會蓋掉 `styles.css` 的 `@media`。請用 Playwright 實測（見「RWD 與可讀性」段）。
- **字級固定 px，系統/瀏覽器字級設定對本站無效**，所以最小字級要自己顧；目前手機下限 13.5px。
- `TITAN-STAR.html` 是 build 產物。改 JS/CSS 後若需要離線版同步，必須跑 `node build.js`。
- 工作區可能有使用者或其他 AI 的變更；不要 `git reset --hard`，不要回復不相關改動。

## Claude 審查紀錄（2026-07-17）

Claude 依本文件審查 Codex 的型號查詢實作後，修正 3 個 bug。
修正 commit：`32e5293`，快取版本 `20260716-5 → 20260717-1`。以下逐項記錄「為什麼改」與「怎麼改」。

### 修正 1：跨頁搜尋沒反應（嚴重，UI 流程）

- **位置**：`app.js` → `quickModelSearch(raw, opts)`
- **原因**：原寫法只設 `state.currentPage = 'summary'` 再 `renderAll()`。`renderAll → renderPage` 只負責「渲染內容」，不負責「切換哪個 `.page` 可見」— 可見性由 `switchPageDom()` 控制（切 `.page.active` class、導覽高亮、history）。所以使用者只要不是已經停在摘要頁（例如在總覽、零件 Pareto 頁）輸入型號，結果會渲染進 `display:none` 的 `#pageSummary`，畫面看起來完全沒反應 — 正是本文件「已知坑」裡最忌諱的「按了沒反應」。
- **修改方式**：搜尋命中後改為：
  - 若 `state.currentPage !== 'summary'`：先 `history.pushState({__page:'summary'})`（手機返回鍵可回原頁），再呼叫 `switchPageDom('summary')`（內含 renderPage），最後補跑 `renderFilters` 與 `updateSubbarSummary` 同步篩選列。
  - 若已在摘要頁：維持原本 `renderAll()`。
- **不要回退成**：直接改 `state.currentPage` + `renderAll()`。那就是這個 bug 本身。

### 修正 2：歷年零件落點數字不準（資料正確性）

- **位置**：`app.js` → `modelDrillContent(modelName, focusMonth)` 與 `modelMetrics(modelName)`
- **原因**：`analyzer.js` 的 `modelHistory()` 對每個月只回傳 `topParts: aggregateParts(recs).slice(0, 5)`（每月前 5 名）。原寫法把「每月 top-5」相加當成「累計零件落點」，造成兩個問題：(a) 在每個月都排第 6 名以後的零件會從累計清單完全消失；(b) 某零件只在部分月份進前 5，累計數字會偏低。實測 MSM0801：舊算法 7 種零件、正確為 9 種。對「輸入型號查歷年故障落點」這條主流程來說是給錯資料。
- **修改方式**：改用完整記錄直接聚合，不經過每月截斷：
  - 累計檢視（`__all__`）：`RepairAnalyzer.aggregateParts(modelRecords)`
  - 單月檢視：`RepairAnalyzer.aggregateParts(modelRecords.filter(r => r._monthKey === curMonth))`
  - `modelMetrics` 的 `topParts` 同樣改為 `aggregateParts(recs)`。
  - `aggregateParts` 已在 `window.RepairAnalyzer` 匯出，可直接使用。
- **注意**：`modelHistory()` 本身沒改（月卡片仍用它），只是不再拿它的截斷結果做累計。

### 修正 3：模糊比對未正規化（搜尋容錯）

- **位置**：`app.js` → `resolveModelQuery(raw)`
- **原因**：exact 比對有把兩邊都過 `normalizeModel`，但 fuzzy 比對寫成 `m.includes(norm) || norm.includes(m)` — `m` 是原始型號字串、`norm` 是正規化後（大寫、去 `-_空格`）的輸入。只要輸入帶連字號、空格或小寫（`msm-0801`、`zspmg 51`），fuzzy 就永遠比不中。
- **修改方式**：fuzzy 比對兩邊都先過 `normFn`（`normalizeModel`，含 fallback），並加 `norm.length >= 3` 門檻，避免打一兩個字就誤中不相干型號。實測 `msm-0801`→`MSM0801`、`zspmg 51`→`ZSPMG51`、`iot0600`→`IOT0600` 均命中。

### 驗證方式（本次實際跑過）

```bash
node --check app.js && node --check analyzer.js
node build.js
# 以 node 直接載入 analyzer.js + data.json，驗證：
#   1) resolveModelQuery 對 msm-0801 / zspmg 51 / iot0600 命中
#   2) MSM0801 累計零件 舊法 7 種 vs aggregateParts 9 種，top1 數字一致
```

已知但未動的項目（留給下一位 AI 判斷）：
- `modelDrillContent` 的「故障原因落點」永遠用全月份記錄，即使 drawer 聚焦單月 — 型號查詢主流程用 `__all__` 所以不影響，但 drawer 單月檢視時語意稍有不一致。
- `sw.js` activate 時 `client.navigate()` 會強制重載所有分頁 — 這是刻意換新版的設計，但使用者若正在輸入會被打斷，屬已接受的取捨。
- `quickModelSearchInput` 自動搜尋會把月份選擇重設為全部 — 符合「歷年落點」目標，屬刻意行為。

## 優化紀錄（2026-07-23，版本 20260723-1）

針對 7 月資料匯入後的全面盤點，10 項全部完成。下一個 AI 請勿回退這些設計：

### 資料正確性
1. **型號別名解析層**（`analyzer.js` → `buildModelAliases` / `canonicalModel`）。來源 Excel 對同一產品有多種寫法，造成歷年落點被拆散、分母對不上。用三段式資料驅動推導：版本尾碼→基礎型號、分頁名↔主要 model 綁定、易混淆字元折疊+編輯距離≤1（限唯一候選）。**不要改成寫死對照表**。實測合併 4 組（THS0010←THSM010/THS001A、ZWDI020←ZWDIO20/ZWDUO20/ZWIO20、ZBPIR50←V2.0/V2.0.2、SCL0200←SCL0020），分母失效 8→0，有故障率的機種 5→7。
   - 注意：分頁名必須通過 `MODEL_CODE_RE`（純英數且含數字）才納入綁定，否則「立保保全」「主機」這類大類分頁會被誤綁成單一型號。
   - 版本家族的代表寫法固定用「基礎型號」（ZBPIR50，不是筆數較多的 ZBPIR50V2.0）。
2. **版本變體合併**：ZBPIR50 家族從 5 筆變 31 筆。記錄保留 `modelVariantKey` 供 UI 顯示合併前寫法。
3. **選填欄位無資料時顯示「來源未填」**（`app.js` → `fieldHasData` / `optionalMetric`）。保固/技師/工時等 v2 模板欄位在所有來源報表都是空的，原本指標永遠顯示 0 會誤導。

### 效能
4. **條件式請求**：`app.js` 與 `sw.js` 的 `cache` 從 `'no-store'` 改 `'no-cache'`，帶 If-None-Match，內容沒變時回 304 不重傳 body。**不要改回 `no-store`**，那等於每次開啟全量下載 2.6MB。
5. **記錄瘦身**（`parser.js` → `compactRecord`）：省略空值選填欄位，data.json 4.06MB→2.61MB（-36%），分析結果完全一致。讀取端一律 `r.x || ''` / `!= null`，undefined 與空字串等價。
6. **查詢快取**（`analyzer.js` → `cached` / `filterKey`）：以 db 物件為 key 的 WeakMap，db 一換自動失效。getRecords / getDenominators / detectAnomalies 皆已包裹。實測 40 次 getRecords 750ms→4ms。**前提是回傳值不可就地修改**（已全檔掃描確認無 sort/push/splice）。

### 判讀正確性
7-8. **型號補充抽屜警語**（`app.js` → `suppCaveats`）：無維修記錄時明說「不是資料遺漏」；有維修記錄時明說兩種故障率分母不同不可比大小。故障率 KPI 加註「此口徑≠維修故障率」。
9. **序號語意：機器序號 vs 生產序號**（`parser.js` → `serialKind`；`analyzer.js` → `isMachineSerial` / `batchSerialModels`）。

   **維修課已確認**：部分分頁的序號欄是「生產序號」＝製令批次號，同一批多台機器共用同一個號碼。重複出現代表**同一批次**，不是同一台機器重複維修，**不應列為異常，只列為警示**。

   根因：`findCol` 用 `includes` 比對，`'生產序號'.includes('序號')` 為真，於是被當成機器序號。實測 7 月來源檔：
   - `IOT0600` / `ZSPMG51` / `ZSPMG31` 分頁用「生產序號」→ `serialKind='production'`
   - 其餘分頁用「機器序號」→ `serialKind='machine'`

   修正內容：
   - `parser.js` 明確判斷欄名並寫入 `record.serialKind`，同時保留 `prodSerial`。**不要只靠 `findCol` 的 includes 判斷序號語意**。
   - 重複維修（單月 `repeatedSerials`、跨月 `crossMonthSerials`、KPI `repeatedSerials`）一律只採計 `serialKind==='machine'`。
   - 舊資料已依 7 月來源檔的分頁欄名回填 `serialKind`（同一份月報模板每月一致）；7 月沒有的分頁用統計推定（重複倍數 <3 者判為 machine，實測 14 個分頁全為 1.0x）。
   - 原本的「序號欄疑似填成批號」異常改為 **info 層級說明性警示**「這些機種用製令批次號」，並指向製造批次頁。

   效果：7 月異常 46→36、critical 30→**9**（剩下全是真實問題）、跨月重複 99→9、重複維修 KPI 164→**50**。

   **不要**把 production 序號放回重複維修分析，也不要把這則警示升級成 critical。

9b. **製令落點分析**（`analyzer.js` → `orderLotAnalysis`；`app.js` → `renderOrderLots`；`index.html` → `#orderLotPanel`）。這是製令號重複時**真正該用的分析**：依製令批次彙總，看哪一批故障集中、集中在哪個零件。實測 7 月 129 個製令，最集中的 `ZSPMG31 製令190218053` 82 件、83% 集中在 `ORD324`。位置在「製造批次」頁最上方。
10. **小樣本/單月警語**：整新測試數 <100 台或只有單月資料時，抽屜顯示明確警語（ZBIRC5S 僅 74 台、12 個無線機種都只有單月）。

## 第二輪優化（2026-07-23，版本 20260723-3~5）

### 異常警示流光（依使用者指定行為）
- **粉紅底 + 流光只出現在「本次登入尚未讀過」的 critical 警示**（`app.js` → `alertKey`/`isAlertUnseen`/`markAlertSeen`/`resetSeenAlerts`；CSS class `.alert-unseen`）。
- 點開警示 → `markAlertSeen()` 立刻移除 class（不等重新渲染）並記入 `sessionStorage['titan_alert_seen_v1']`。
- `doLogin()` 成功時呼叫 `App.resetSeenAlerts()` → 重新登入全部再亮。**注意 `doLogin` 在 Auth IIFE、`resetSeenAlerts` 在 App IIFE，必須透過 `App.` 呼叫**。
- key 用 `type|subject`，總覽列與異常頁共用已讀狀態。
- 流光 3 秒一輪（0.6s 掃、2.4s 停），`pointer-events:none` 不擋點擊，`prefers-reduced-motion` 時只留粉紅底。
- 莫蘭迪版在 `styles-morandi.css`（主題是靠注入樣式表切換，**不是 `data-theme` 屬性**，別用 `html[data-theme=...]` 選擇器）。

### 非料件字串分離（使用者確認：不算備料、保留在故障分析）
- `analyzer.js` → `isWorkNote` / `workNotePareto`；`partPareto(records, {db})` 預設排除。
- **雙重把關**（使用者指定）：含動作關鍵字（取消/破損/重燒/氧化…）**且**在 `partsMaster` 8,996 筆主檔找不到，才判為作業記錄。真料件品名帶「不良」字樣但主檔有登錄就不會誤判。
- 實測分出 10 項 2,060 件（占 24%），最大宗「取消C15、C41、E1」1,746 件（寫在故障零件二欄）。修正前備料建議會算出「建議備料 699 個取消C15」。
- 排除後會 `recomputeShares()` 重算佔比與累計，否則百分比加不到 100%。
- UI：零件 Pareto 頁下方 `#workNotePanel`（`renderWorkNotes`），明示「不計入備料建議」但保留查詢。
- **所有 `partPareto` 呼叫點都要傳 `{db}`**，否則排除不會生效。

### 月趨勢「只看每月都有的機種」（使用者指定：預設開）
- `analyzer.js` → `commonModels(db, filter)`、`monthlyTrend(db, filter, {commonOnly})`。
- 原因：各月涵蓋差異大（3月39種、5月24種、7月55種），件數上升有一部分只是納入更多機種。共同機種目前 11 種。
- **只看共同機種時分母也要同步只算這些機種**，否則故障率被低估。
- 預設開（`state.trendCommonOnly`，存 `localStorage['titan_trend_common_only']`），開關在月趨勢頁 `#trendCommonOnly`，並在各月機種數落差 ≥1.5 倍時顯示 `#trendCoverageNotice` 說明。

### 使用者未採納 / 待確認
- `TS-1185-025C`（1,087 件）與 `TS-1185-025`（538 件）只差 C 尾碼、同為 TAC SW 按鍵開關，**使用者表示不確定，暫不合併**。若日後確認同料，加入 `parser.js` 的 `normalizeKnownPartAlias`。

## RWD 與可讀性（版本 20260724-1 / -2）

### ⚠️ CSS 串接順序的坑（曾造成手機版破版）

`index.html` 的載入順序是 `styles.css` → `rma-styles.css` → `styles-morandi.css`。
**後面檔案中「沒有 media 限制」的規則，會蓋掉前面檔案 `@media` 內的規則**
（media query 不增加 specificity，同權重時看串接順序）。

實際發生過的問題：`rma-styles.css` 的 `.mode-tabs { display: flex }`（無 media）
壓過 `styles.css` 的 `@media (max-width:820px) { .mode-tabs { display: grid } }`，
導致「型號查詢」與「角色觀點」在手機被擠成兩欄，**型號輸入框只剩 62px 寬**，
placeholder 只看得到一個字。同時該檔還有一組遺留規則：先 `display:none` 隱藏
主切換列、再用 `display:flex !important` 補救，那個 `!important` 是連鎖元兇。

修正方式：移除遺留規則，並把手機版佈局補在 **`rma-styles.css` 的最末**
（最後載入才贏得過）。**改動 `.mode-tabs`、`.mode-bar` 等共用 class 前，
務必三個 CSS 檔一起看**。

### 字級策略（使用者已定案）

- 全站字級固定 `px`（409 處），**不用 rem**。實測瀏覽器字級從 16 調到 28px，
  body 始終 16px —— 即系統/瀏覽器字級設定對本站**完全無效**。
- 這是刻意取捨：版面永遠不會被使用者設定撐爆，代價是**最小字級必須自己顧好**。
- 右上角「大中小」控制項已於更早版本移除，目前**不存在**，也沒有計畫加回。
- 20260724-2 已把整體字級**逐階上調一級**（不是套倍率——倍率會把行高、間距、
  圖示比例一起拉走）：

  | 手機（≤820px） | 原 | 現 |
  | --- | --- | --- |
  | 小標籤 | 12.5px | 13.5px |
  | 輔助文字 | 13 / 13.5px | 14.5px |
  | 一般內文 | 14px | **15px** |
  | 次要標題 | 15px | 16px |
  | 說明區塊 | 16px | **17px** |
  | 可點元素 | 12～13px | **15px + 42px 高** |

  標題與大數字（20/30/36px）**維持不變**，否則手機卡片會被撐爆。
  表格只上調一階（欄寬吃緊）。桌機最小輔助文字 12/12.5/13 → 13.5/14px。
- 目前手機最小字級 **13.5px**（原 10px）；仍在 14px 以下的只剩純圖示字符
  （下拉箭頭 ▾ 等），那是符號不是文字，放大會破壞對齊。
- **若日後要再調大**：沿用「逐階上調」而非倍率，並跑下方的實機驗證。

### 其他已修正的手機問題

- 篩選列收合鈕原本重複顯示下方控制項已有的統計，佔掉一整行 →
  展開時只留「篩選」二字（`.sbs-detail` 由 CSS 控制，見 `updateSubbarSummary`）。
- 手機下拉選單可用寬度僅約 180px，原本文字含整新數會被截成
  「大類：全部・維修(」→ 已縮短為「全部 5 個月」「全部大類 · 6587 筆」。
- `.nav-toggle` 是 `position:fixed` 左下角 54px 浮動鈕，會蓋住最後一張卡片 →
  `.content` 手機版加 `padding-bottom: 96px`。
- `.role-sel-focus` 在 ~1024px 會被硬切 → 1024px 以下改為隱藏。

### 實機驗證方式（改 CSS/RWD 後請照跑）

**不要只讀 CSS 判斷版面**，本專案三個 CSS 檔交互覆蓋，讀原始碼很容易誤判
（我第一次就判斷錯）。用真實瀏覽器量測：

```bash
npm install -D playwright          # 沙箱已預裝 chromium，勿執行 playwright install
python3 -m http.server 8099 &      # 用 http 而非 file://，SW 與 fetch 才正常
```

驗證腳本重點（可自行重寫，這些是踩過的雷）：

- `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`
- **攔截外部 CDN**（jsdelivr / fonts.googleapis），沙箱連不出去會卡住 `networkidle`；
  用 `waitUntil: 'domcontentloaded'` + 固定等待，不要用 `networkidle`
- 登入態：`sessionStorage.setItem('titan_session', JSON.stringify({username:'031780', isAdmin:true}))`
  然後**重新 goto** 一次
- 截圖必須加 `animations: 'disabled'`，否則警示流光是 infinite 動畫會讓
  `page.screenshot()` 逾時
- 檢查項目：`document.documentElement.scrollWidth > innerWidth`（橫向溢出）、
  `e.scrollWidth > e.clientWidth + 2`（文字截斷）、`getComputedStyle(e).fontSize`（字級分佈）
- 驗證寬度：**360 / 390 / 412 / 480 / 600 / 768 / 820 / 1024 / 1280**
  （目前這九種全部無橫向溢出、無文字截斷）
- 模擬瀏覽器字級：CDP `Page.setFontSizes({ fontSizes: { standard, fixed } })`
- 驗證完**記得刪掉暫存腳本**，也不要把 `playwright` 提交進 `package.json`

## 下一步建議

1. 補一份正式 `TECHNICAL_HANDOFF.md` 給真人工程師閱讀，內容可從本文件整理成人類版。
2. ~~型號查詢頁手機實機確認~~ → **20260724-1/-2 已用 Playwright 完成**：
   查詢列固定在最上方、九種寬度無水平捲動、無文字截斷。若再改版請照
   「RWD 與可讀性」段的流程重跑。
3. 若後續要接交易別 5 換修率，先確認該 Excel 的型號與目前維修資料型號是否能對上。先前交集很少，不要硬塞成主功能。
4. **來源資料品質**（已回報使用者，需工廠端配合，非程式可解）：
   - `製令品號` 僅 15%、`製造日期` 22% 有值、`condition`（全新/整新）0% →
     「全新/整新責任歸屬」分析無法啟用（製造批次頁仍顯示待解鎖提示）。
   - 15% 記錄無序號，無法做重複維修追蹤。
   - `ZWDIO20` 在來源「故障零件總數」頁的整新數表頭誤打成 `ZWDUO20`；
     目前靠別名解析層自動修正，但根治要改 Excel。
   - `TS-1185-025C`（1,087 件）與 `TS-1185-025`（538 件）疑似同料，
     **使用者表示不確定、暫不合併**；若確認同料，加進 `parser.js` 的
     `normalizeKnownPartAlias`。
5. 各月機種涵蓋差異大（3月39種、5月24種、7月55種），共同機種僅 11 種。
   月趨勢已預設「只看每月都有的機種」，但若之後月份持續增加、共同機種
   繼續縮小，這個預設值可能要重新評估。

## 2026-08-16 AI-readme 更新（Manus 多倉庫優化迭代）

### 現況

本次迭代前：線上版部署 index.html＋五支 JS（parser/analyzer/app/report/rma）＋sw.js，版本快取靠手動同步三處錨點（JS `?v=`、sw.js `CACHE_NAME`、data.json `publishedAt`）；離線單檔 `TITAN-STAR.html` 由 `build.js` 產出。**沒有任何 CI/測試自動化**——每月 Excel 匯入、改碼、升版全部人工，手動升版漏改任一個錨點就可能讓使用者手機看到舊版 data.json。工程分數 87（滿分組最弱之一）。

### 修改方向（2026-08-16 迭代，經多輪辯證後收斂）

- **拆 app.js？否。** 辯證結論：app.js（369KB）是 UI 主體且與版式深度耦合，CI 無法驗證 UI 行為，強行拆風險>收益，留給下一輪（下一輪需配合 UI 回歸測試框架）。
- **版本管理自動化：是。** 新增 `scripts/build-version.mjs` 單一命令升版，一次更新 index.html 全部 `?v=` 與 sw.js `CACHE_NAME`，data.json 只讀不寫；並用 `scripts/check-version-anchors.mjs` 驗證錨點一致。
- **補資料層測試：是。** `tests/data-integrity.test.mjs`（9 項）：data.json 結構斷言（月份/8,996 筆 partsMaster/13 機種 modelSupplements）、parser/analyzer 用 vm 模擬掛載 smoke 測試、normalizePart 同義詞合併斷言、每月筆數合理性。
- **CI：是。** `.github/workflows/site-check.yml`：語法檢查五支 JS、`node --test`、錨點一致性、離線單檔 build 檢查。

### 修改進度（2026-08-16 已完成並驗證）

| 項目 | 狀態 | 驗證 |
|---|---|---|
| `scripts/build-version.mjs` | 已建立 | dry-run：升版 20260816-1 成功、錨點一致、data.json md5 未變、checkout 可完全復原 |
| `scripts/check-version-anchors.mjs` | 已建立 | 現狀 20260724-2 一致；模擬不一致可正確報錯 |
| `tests/data-integrity.test.mjs` | 9 項全綠 | node --test 9 pass / 0 fail |
| `.github/workflows/site-check.yml` | 已建立 | node --check 五支 JS OK、build.js 產出 822KB 單檔 OK |

### 後續接手注意事項

1. **每次改版（含每月匯入新月份）必須跑 `node scripts/build-version.mjs <YYYYMMDD-N>`**，不要手動改 ?v= 或 CACHE_NAME；升版後同步更新本段版本歷史再 commit。
2. **每月匯入新月份後必跑 `node --test tests/`**——測試已內建「每月筆數 < 5,000」合理性斷言，匯入腳本壞掉或資料欄位偏移會被抓到；若測試擋住合法變更，先改測試再改資料。
3. **app.js 模組化留給下一輪**，但下一輪開始前必須先建立 UI 回歸測試（建議 Playwright 針對型號查詢/異常卡/手機 390×844 三條核心路徑截圖比對），沒有回歸網不拆。
4. `TITAN-STAR.html` 離線單檔存在 repo 內供離線使用，build.js 產出後若內容變更需一併 commit；CI 會警告不同步。
5. parser/analyzer 的解析輔助函式（normalizePart 等）在 IIFE 內部 scope 不掛 window，測試用 vm 只能測公開介面——日後若想測內部函式，需在 parser.js 加測試用掛鉤（僅限開發環境）。
6. data.json 2.6MB 每月成長，tests 裡 partsMaster/modelSupplements 數量下限（8,000 / 12）會隨新匯入自動通過；但若某天**筆數異常下降**（匯入腳本清掉舊月份）測試也會擋，屆時確認是預期行為再調下限。
