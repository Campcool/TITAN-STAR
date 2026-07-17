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

## 每月資料更新

建議流程：

1. 每月把 Excel 維修報表放到 `monthly-reports/`
2. 檔名維持 `115年 07 月維修報表.xlsx`
3. commit / push 到 GitHub
4. 系統會在每月 1 號開啟時自動嘗試匯入「上個月」報表；其他日期不會自動讀取 Excel

若需要立刻把資料併入 `data.json`，可用手動備用流程：

```bash
npm run import:month -- "115年 06 月維修報表.xlsx"
node build.js
```

若尚未安裝 Node 套件，先執行一次 `npm install`。自動與手動流程都使用同一份 `parser.js` 解析 Excel，避免每個月因欄位小變動就另外修正模型。
