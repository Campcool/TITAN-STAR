// ════════════════════════════════════════════════════════════════════
// build.js — 打包成單一 TITAN-STAR.html，內含深色/莫蘭迪雙主題切換
// 用法： node build.js
// ════════════════════════════════════════════════════════════════════
const fs = require('fs');

function safeInline(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

const indexHTML    = fs.readFileSync('index.html', 'utf8');
const stylesCss    = fs.readFileSync('styles.css', 'utf8');
const morandiCss   = fs.readFileSync('styles-morandi.css', 'utf8');
const rmaStylesCss = fs.readFileSync('rma-styles.css', 'utf8');
const parserJs     = safeInline(fs.readFileSync('parser.js', 'utf8'));
const analyzerJs   = safeInline(fs.readFileSync('analyzer.js', 'utf8'));
const appJs        = safeInline(fs.readFileSync('app.js', 'utf8'));
const reportJs     = safeInline(fs.readFileSync('report.js', 'utf8'));
const rmaJs        = safeInline(fs.readFileSync('rma.js', 'utf8'));

const inlineStyle  = (css)  => () => '<style>\n'  + css  + '\n</style>';
const inlineScript = (code) => () => '<script>\n' + code + '\n</script>';

// 莫蘭迪 CSS 以 JS 字串形式注入，供動態切換使用
const morandiCssEscaped = JSON.stringify(morandiCss);
const themeLoaderJs = `window.__morandiCSS__ = ${morandiCssEscaped};`;

let html = indexHTML;
html = html.replace('<link rel="stylesheet" href="styles.css">',     inlineStyle(stylesCss));
html = html.replace('<link rel="stylesheet" href="rma-styles.css">', inlineStyle(rmaStylesCss));
html = html.replace('<script src="parser.js"></script>',   inlineScript(parserJs));
html = html.replace('<script src="analyzer.js"></script>', inlineScript(analyzerJs));
html = html.replace('<script src="report.js"></script>',   inlineScript(reportJs));
// 在 rma.js 前注入莫蘭迪 CSS 字串（rma.js 之後 index.html inline script 才初始化主題）
html = html.replace('<script src="rma.js"></script>',
  `<script>\n${themeLoaderJs}\n<\/script>\n` +
  inlineScript(rmaJs)()
);
html = html.replace('<script src="app.js"></script>',      inlineScript(appJs));

fs.writeFileSync('TITAN-STAR.html', html, 'utf8');

// ── 驗證 ──
const leftoverCss = ['styles.css', 'rma-styles.css'].filter(f => html.includes('href="' + f + '"'));
const leftoverJs  = ['parser.js','analyzer.js','report.js','rma.js','app.js'].filter(f => html.includes('src="' + f + '"'));
if (leftoverCss.length || leftoverJs.length) {
  console.error('✗ 未內嵌：', [...leftoverCss, ...leftoverJs].join(', '));
  process.exit(1);
}

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

const sizeKB = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
console.log(`${ok?'✓':'✗'} 打包完成：TITAN-STAR.html (${sizeKB} KB, ${block} 個 script 區塊)`);
console.log('  包含：深色主題 + 莫蘭迪主題（右上角按鈕切換，預設莫蘭迪）');
