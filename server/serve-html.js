// serve-html.js — GAS <?!= include('name') ?> 문법을 Node.js에서 재현
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'client');  // client/ (index.html 위치)

function readFile(name) {
  const p = path.join(ROOT, name + '.html');
  if (!fs.existsSync(p)) {
    console.warn('[serve-html] 파일 없음:', p);
    return '';
  }
  return fs.readFileSync(p, 'utf8');
}

function resolveIncludes(html) {
  return html.replace(/\s*<\?!=\s*include\('([^']+)'\)\s*;?\s*\?>/g, function (_, name) {
    return readFile(name);
  });
}

// Express 핸들러: GET / → 조합된 index.html 반환
function serveApp(req, res) {
  try {
    let html = readFile('index');

    // 폴리필 주입 — </head> 바로 앞에 삽입
    html = html.replace(
      '</head>',
      '<script src="/gs_polyfill.js"></script>\n</head>'
    );

    html = resolveIncludes(html);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('[serve-html]', e);
    res.status(500).send('HTML 렌더링 오류');
  }
}

module.exports = { serveApp };
