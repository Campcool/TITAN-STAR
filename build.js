// ════════════════════════════════════════════════════════════════════
// build.js — 將多檔專案打包成單一 TITAN-STAR.html（可離線本機使用）
// 用法： node build.js
// ════════════════════════════════════════════════════════════════════
const fs = require('fs');

// 把 JS 內容中的 </script 轉義，避免提前關閉外層 <script> 標籤。
// 注意：</script  後可接 >、空白、/ 等字元，HTML 解析器都視為結束，
// 故用部分比對 </script（不含 >）做轉義；JS 字串中 <\/ 等同 </，輸出不變。
function safeInline(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

const indexHTML   = fs.readFileSync('index.html', 'utf8');
const stylesCss   = fs.readFileSync('styles.css', 'utf8');
const rmaStylesCss= fs.readFileSync('rma-styles.css', 'utf8');
const parserJs    = safeInline(fs.readFileSync('parser.js', 'utf8'));
const analyzerJs  = safeInline(fs.readFileSync('analyzer.js', 'utf8'));
const appJs       = safeInline(fs.readFileSync('app.js', 'utf8'));
const reportJs    = safeInline(fs.readFileSync('report.js', 'utf8'));
const rmaJs       = safeInline(fs.readFileSync('rma.js', 'utf8'));

let html = indexHTML;
html = html.replace('<link rel="stylesheet" href="styles.css">',     '<style>\n' + stylesCss + '\n</style>');
html = html.replace('<link rel="stylesheet" href="rma-styles.css">', '<style>\n' + rmaStylesCss + '\n</style>');
html = html.replace('<script src="parser.js"></script>',   '<script>\n' + parserJs   + '\n</script>');
html = html.replace('<script src="analyzer.js"></script>', '<script>\n' + analyzerJs + '\n</script>');
html = html.replace('<script src="report.js"></script>',   '<script>\n' + reportJs   + '\n</script>');
html = html.replace('<script src="rma.js"></script>',      '<script>\n' + rmaJs      + '\n</script>');
html = html.replace('<script src="app.js"></script>',      '<script>\n' + appJs      + '\n</script>');

fs.writeFileSync('TITAN-STAR.html', html, 'utf8');

// ── 驗證 ──
const leftoverCss = ['styles.css', 'rma-styles.css'].filter(f => html.includes('href="' + f + '"'));
const leftoverJs  = ['parser.js','analyzer.js','report.js','rma.js','app.js'].filter(f => html.includes('src="' + f + '"'));
if (leftoverCss.length || leftoverJs.length) {
  console.error('✗ 未內嵌：', [...leftoverCss, ...leftoverJs].join(', '));
  process.exit(1);
}

// 模擬 HTML 解析器：確認沒有 script 區塊被內容中的 </script 提前截斷
const openRe = /<script\b[^>]*>/gi;
let m, block = 0, ok = true;
while ((m = openRe.exec(html))) {
  block++;
  const start = m.index + m[0].length;
  const closeRe = /<\/script[\s>\/]/gi;
  closeRe.lastIndex = start;
  const cm = closeRe.exec(html);
  if (!cm) { console.error('✗ 區塊#' + block + ' 找不到關閉標籤'); ok = false; break; }
  openRe.lastIndex = cm.index + cm[0].length;
}

const sizeKB = Math.round(fs.statSync('TITAN-STAR.html').size / 1024);
console.log((ok ? '✓' : '✗') + ' 打包完成：TITAN-STAR.html (' + sizeKB + ' KB, ' + block + ' 個 script 區塊)');
