# TITAN-STAR

電子工廠維修數據分析報表（純前端 vanilla JS，部署於 GitHub Pages）。

- 線上版：https://campcool.github.io/TITAN-STAR/
- 離線單檔版：`TITAN-STAR.html`（由 `node build.js` 打包產生）

## 文件

AI 與 AI 之間的進度交接、目前狀態、修改注意事項請見 **[AI-HANDOFF.md](./AI-HANDOFF.md)**。

完整的**設計初衷與內容說明**（含核心領域知識、架構、資料模型、分析引擎、角色視角
系統、已知限制）請見 **[DESIGN.md](./DESIGN.md)**。此文件同時可直接提供給其他 AI
模型，作為理解與分析本專案的依據。

想請其他 AI 分析本專案，可直接複製 **[AI-REVIEW-PROMPT.md](./AI-REVIEW-PROMPT.md)**
內的文稿貼給對方（自足版，對方不需打開原始碼也能分析）。

## 每月資料更新（2026-09-07 起）

1. 到 [Campcool/campcool-website 的 date 資料夾](https://github.com/Campcool/campcool-website/tree/main/date)，上傳當月的維修報表與整新故障 Excel 並 Commit changes。
2. 開啟 https://campcool.github.io/TITAN-STAR/ 。每次開啟都檢查新增／更正版；已開啟時按「檢查更新」。
3. 確认分析期間與更新狀態；不需要執行程式、改日期、重新部署或等待每月 1 號。

完整檔名規則與排錯步驟見 [接手者操作說明](https://github.com/Campcool/campcool-website/blob/main/date/README.md)。
最新月份取報表月份最大值；同月更正版取代原月份，保留歷史。整批解析、資料驗證與檔案 SHA 比對通過後才套用。
沒有變更只讀資料夾清單，不重抓 Excel。連線／格式／版本衝突時保留本機上一版，首次使用則保留隨站歷史快照並明示失敗。

支援的檔名為 `115年 08 月維修報表.xlsx` 與 `115年8月整新故障.xlsx`；兩種格式會在開頁時一起更新。品號主檔、年度或其他機種補充表仍沿用既有獨立資料源，不能改名混入 date。

## 工程驗證

使用 Node 22、pnpm 10.4.1；執行 `pnpm install --frozen-lockfile`、`node --test tests/*.test.mjs`。
檢查來源資料夾：`node scripts/check-source-dir.cjs <Excel資料夾>`，唯讀，不寫入 data.json。
改網頁後執行 `node scripts/build-version.mjs YYYYMMDD-N`、`node build.js`，提交離線單檔並通過 Pages CI。
