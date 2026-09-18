// ════════════════════════════════════════════════════════════════════
// build.js — 打包成單一 TITAN-STAR.html，內含深色/莫蘭迪雙主題切換
// 用法： node build.js
// ════════════════════════════════════════════════════════════════════
const fs = require('fs');

function readText(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
}

function safeInline(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

const indexHTML    = readText('index.html');
const stylesCss    = readText('styles.css');
const morandiCss   = readText('styles-morandi.css');
const rmaStylesCss = readText('rma-styles.css');
const parserJs     = safeInline(readText('parser.js'));
const analyzerJs   = safeInline(readText('analyzer.js'));
const appJs        = safeInline(readText('app.js'));
const privacyJs = safeInline(readText('privacy.js'));
const monthlyJs = safeInline(readText('monthly-source.js'));
const reportJs     = safeInline(readText('report.js'));
const rmaJs        = safeInline(readText('rma.js'));

// 自帶的第三方函式庫（vendor/）。單檔版必須一起內嵌，否則複製出去的那一個
// 檔案沒有圖表也不能匯入 Excel。來源與版本見 vendor/README.md。
const VENDOR_FILES = [
  'chart.umd.js',
  'xlsx.full.min.js',
  'hammer.min.js',
  'chartjs-plugin-zoom.min.js',
  'chartjs-plugin-annotation.min.js',
];

// 共用資料。線上版是 fetch ./data.json；單檔版沒有同伴檔案可以 fetch
// （而且 file:// 也禁止 fetch），所以把同一份資料掛成 window.__TITAN_EMBEDDED_DB__，
// 由 app.js 的 loadCloudPayload() 在 file:// 時讀取。
const dataJson = readText('data.json');
JSON.parse(dataJson);  // 壞掉的 JSON 要在打包時就爆，不要等使用者打開才發現

const inlineStyle  = (css)  => () => '<style>\n'  + css  + '\n</style>';
const inlineScript = (code) => () => '<script>\n' + code + '\n</script>';

// 莫蘭迪 CSS 以 JS 字串形式注入，供動態切換使用
const morandiCssEscaped = JSON.stringify(morandiCss);
const themeLoaderJs = `window.__morandiCSS__ = ${morandiCssEscaped};`;

let html = indexHTML;
// 單檔版本身就是離線版，不需要（也不能）再轉址到自己
html = html.replace(/<!-- 離線（file:\/\/）[\s\S]*?<script data-file-redirect>[\s\S]*?<\/script>\n/, '');
html = html.replace(/<link rel="stylesheet" href="styles\.css(?:\?[^"]*)?">/,     inlineStyle(stylesCss));
html = html.replace(/<link rel="stylesheet" href="rma-styles\.css(?:\?[^"]*)?">/, inlineStyle(rmaStylesCss));
// 莫蘭迪改用 JS 注入（window.__morandiCSS__），移除外部 link 避免 404
html = html.replace(/<link rel="stylesheet" href="styles-morandi\.css(?:\?[^"]*)?" id="morandiThemeLink">/, '');
// 單檔版不使用 manifest / SW（需要獨立檔案才能運作），移除相關 link
html = html.replace('<link rel="manifest" href="manifest.json">', '');
html = html.replace(/<script src="parser\.js(?:\?[^"]*)?"><\/script>/,   inlineScript(parserJs));
html = html.replace(/<script src="analyzer\.js(?:\?[^"]*)?"><\/script>/, inlineScript(analyzerJs));
html = html.replace(/<script src="report\.js(?:\?[^"]*)?"><\/script>/,   inlineScript(reportJs));
// 在 rma.js 前注入莫蘭迪 CSS 字串（rma.js 之後 index.html inline script 才初始化主題）
html = html.replace(/<script src="rma\.js(?:\?[^"]*)?"><\/script>/,
  `<script>\n${themeLoaderJs}\n<\/script>\n` +
  inlineScript(rmaJs)()
);
html = html.replace(/<script src="app\.js(?:\?[^"]*)?"><\/script>/,      inlineScript(appJs));

html = html.replace(/<script src="privacy\.js(?:\?[^"]*)?"><\/script>/, inlineScript(privacyJs));
html = html.replace(/<script src="monthly-source\.js(?:\?[^"]*)?"><\/script>/, inlineScript(monthlyJs));

// vendor/ 逐支內嵌。第一支同時帶進整包資料，順序不重要（app.js 在 body 尾端才跑）。
VENDOR_FILES.forEach((name, i) => {
  const re = new RegExp('<script src="vendor/' + name.replace(/\./g, '\\.') + '(?:\\?[^"]*)?"></script>');
  if (!re.test(html)) { console.error('✗ index.html 找不到 vendor/' + name + ' 的 script 標籤'); process.exit(1); }
  const code = safeInline(readText('vendor/' + name));
  const prefix = i === 0
    ? '<script>\nwindow.__TITAN_EMBEDDED_DB__ = ' + safeInline(dataJson) + ';\n</' + 'script>\n'
    : '';
  html = html.replace(re, () => prefix + inlineScript(code)());
});

// GitHub Actions checks out text sources with LF while Windows may use CRLF.
// Normalize the generated bundle so both environments produce identical bytes.
html = html.replace(/\r\n?/g, '\n');

fs.writeFileSync('TITAN-STAR.html', html, 'utf8');

// ── 驗證 ──
const leftoverCss = ['styles.css', 'rma-styles.css'].filter(f => new RegExp(`href="${f.replace('.', '\\.')}(?:\\?|")`).test(html));
const leftoverJs  = ['parser.js','analyzer.js','report.js','rma.js','privacy.js','monthly-source.js','app.js']
  .concat(VENDOR_FILES.map(n => 'vendor/' + n))
  .filter(f => new RegExp(`src="${f.replace(/\./g, '\\.')}(?:\\?|")`).test(html));
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
console.log('  離線自足：vendor/ 五支函式庫 + data.json 全部內嵌，複製單一檔案到任何電腦都能開');
if (!html.includes('window.__TITAN_EMBEDDED_DB__')) {
  console.error('✗ 資料未內嵌，單檔版離線打開會是空的');
  process.exit(1);
}
if (/src="https?:\/\//.test(html)) {
  console.error('✗ 仍有外部 script：', html.match(/src="https?:\/\/[^"]+"/g).join(', '));
  process.exit(1);
}
