# TITAN-STAR AI 交接 README

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
- 最新確認版本：`20260716-5`
- 最新功能/UI 確認 commit：`2e9fb31 fix: prioritize model search and clarify roles`
- 目前 `data.json` 內容：
  - 月份：`2026-03`、`2026-04`、`2026-05`、`2026-06`
  - 維修紀錄：`5,408` 筆
  - `publishedAt`：`2026-07-15T09:06:03.018Z`

## 使用者偏好與重要決策

- 使用者不希望每次登入後還要手動上傳資料。
- 每月資料由使用者放到 GitHub 指定位置，網站每月 1 號才自動嘗試讀取，其他日期不要自動讀 Excel。
- 型號查詢是最重要入口，必須放在最上面，PC 與手機都一樣。
- 型號查詢結果要「只針對這個型號」，不要混入其他設備、其他零件或全廠異常卡。
- 目前已改成型號查詢結果直接顯示在頁面下方，不再依賴彈跳視窗。
- 角色觀點切換必須有明確文字，例如 `角色觀點：綜合`，不能只顯示 `綜合`。
- UI 必須讓非工程人員、小學生也能大致看懂。避免功能名太抽象，避免使用者需要猜按鈕用途。
- 手機 RWD 很重要。PC 可放長文字，但中尺寸與手機要收斂，不能把畫面撐爆。

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
| `styles-morandi.css` | 莫蘭迪主題覆蓋。 |
| `parser.js` | Excel 解析與維修資料標準化。 |
| `analyzer.js` | 純分析函式，避免在這裡碰 DOM。 |
| `app.js` | 主應用狀態、登入後流程、雲端同步、頁面渲染、型號查詢。 |
| `report.js` | 報告產出。 |
| `rma.js` | RMA 管理模組，目前不是主流程。 |
| `data.json` | GitHub Pages 讀取的雲端資料快照。 |
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
- 手機寬度曾有右側大量留白問題。改 CSS 時務必注意 `100vw`、`100dvw`、固定寬度與橫向 overflow。
- service worker 若未升版，使用者手機可能一直看到舊畫面。
- `TITAN-STAR.html` 是 build 產物。改 JS/CSS 後若需要離線版同步，必須跑 `node build.js`。
- 工作區可能有使用者或其他 AI 的變更；不要 `git reset --hard`，不要回復不相關改動。

## 下一步建議

1. 補一份正式 `TECHNICAL_HANDOFF.md` 給真人工程師閱讀，內容可從本文件整理成人類版。
2. 針對型號查詢頁再做一次手機實機確認，重點看：
   - 查詢列是否永遠在最上方。
   - 查詢結果是否只顯示該型號。
   - 長型號是否造成水平捲動。
3. 若後續要接交易別 5 換修率，先確認該 Excel 的型號與目前維修資料型號是否能對上。先前交集很少，不要硬塞成主功能。
