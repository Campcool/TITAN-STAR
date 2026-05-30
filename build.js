// ════════════════════════════════════════════════════════════════════
// build.js — 將多檔專案打包成單一 TITAN-STAR.html（可離線本機使用）
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

function buildHtml(extraCss) {
  let html = indexHTML;
  // styles.css（+ 可選的覆蓋主題）
  html = html.replace(
    '<link rel="stylesheet" href="styles.css">',
    inlineStyle(stylesCss + (extraCss ? '\n/* ── Theme Override ── */\n' + extraCss : ''))
  );
  html = html.replace('<link rel="stylesheet" href="rma-styles.css">', inlineStyle(rmaStylesCss));
  html = html.replace('<script src="parser.js"></script>',   inlineScript(parserJs));
  html = html.replace('<script src="analyzer.js"></script>', inlineScript(analyzerJs));
  html = html.replace('<script src="report.js"></script>',   inlineScript(reportJs));
  html = html.replace('<script src="rma.js"></script>',      inlineScript(rmaJs));
  html = html.replace('<script src="app.js"></script>',      inlineScript(appJs));
  return html;
}

function validate(html, label) {
  const leftoverCss = ['styles.css', 'rma-styles.css'].filter(f => html.includes('href="' + f + '"'));
  const leftoverJs  = ['parser.js','analyzer.js','report.js','rma.js','app.js'].filter(f => html.includes('src="' + f + '"'));
  if (leftoverCss.length || leftoverJs.length) {
    console.error(`✗ [${label}] 未內嵌：`, [...leftoverCss, ...leftoverJs].join(', '));
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
    if (!cm) { console.error(`✗ [${label}] 區塊#${block} 找不到關閉標籤`); ok = false; break; }
    openRe.lastIndex = cm.index + cm[0].length;
  }
  const sizeKB = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
  console.log(`${ok?'✓':'✗'} 打包完成：${label} (${sizeKB} KB, ${block} 個 script 區塊)`);
}

// ── 原始深色版 ──
const htmlDark = buildHtml(null);
fs.writeFileSync('TITAN-STAR.html', htmlDark, 'utf8');
validate(htmlDark, 'TITAN-STAR.html（深色原版）');

// ── 莫蘭迪淺色版 ──
const htmlMorandi = buildHtml(morandiCss);
fs.writeFileSync('TITAN-STAR-morandi.html', htmlMorandi, 'utf8');
validate(htmlMorandi, 'TITAN-STAR-morandi.html（莫蘭迪色系）');
