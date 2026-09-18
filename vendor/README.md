# vendor/ — 自帶的第三方函式庫

這裡的檔案**不要手改**，是從 npm 原封不動複製過來的。

| 檔案 | 套件 | 版本 | 來源 |
| --- | --- | --- | --- |
| `chart.umd.js` | chart.js | 4.4.3 | `dist/chart.umd.js` |
| `chartjs-plugin-annotation.min.js` | chartjs-plugin-annotation | 3.0.1 | `dist/…min.js` |
| `chartjs-plugin-zoom.min.js` | chartjs-plugin-zoom | 2.0.1 | `dist/…min.js` |
| `hammer.min.js` | hammerjs | 2.0.8 | `hammer.min.js` |
| `xlsx.full.min.js` | xlsx (SheetJS) | 0.18.5 | `dist/xlsx.full.min.js` |

## 為什麼不用 CDN

1. **離線可用**：整個資料夾複製到別台電腦、沒有網路也要能開。之前是從
   `cdn.jsdelivr.net` 載，沒網路就沒有圖表、也不能匯入 Excel。
2. **不卡分頁**：CDN 連不上時瀏覽器要等到 timeout，分頁的載入轉圈會一直轉。
3. **不受外部服務影響**：公司網路擋掉 jsdelivr 或 CDN 當機都不會影響這個工具。

## 要升版時

```bash
npm pack chart.js@<新版本>
tar xzf chart.js-<新版本>.tgz
cp package/dist/chart.umd.js vendor/chart.umd.js
```

換檔案之後記得跑 `node build.js` 重新打包 `TITAN-STAR.html`，
並更新上面表格的版本號。
