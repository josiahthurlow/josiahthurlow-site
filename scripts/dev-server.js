/* ==========================================================================
   LOCAL DEV SERVER  —  node scripts/dev-server.js   (npm run dev)
   --------------------------------------------------------------------------
   The site is plain static files, so this only has to stand in for the two
   things Netlify does in production:

     1. CLEAN URLS — /lp-parents serves lp-parents.html, /blog serves
        blog/index.html. Without this every local link 404s.
     2. FORM HANDLING — Netlify intercepts the POST the lead forms make to "/".
        Here that POST is parsed and printed to the terminal instead, so you
        can see exactly which fields (including the utm_* attribution) would
        have been recorded.

   No dependencies, no build step.
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8888;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`
};

/* Netlify only records fields declared in the hidden form — these are the
   attribution ones, printed apart so the lead itself stays readable. */
const ATTR = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
              'gclid', 'fbclid', 'channel', 'referrer', 'landing_page',
              'first_touch', 'visit_count', 'ga_client_id', 'attribution'];

let submissions = 0;

function handleFormPost(req, res) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1e6) { req.destroy(); }
  });
  req.on('end', () => {
    const fields = {};
    try {
      new URLSearchParams(body).forEach((v, k) => { fields[k] = v; });
    } catch (e) {}

    const name = fields['form-name'];
    if (!name) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No form-name — Netlify would reject this too.\n');
      return;
    }

    submissions++;
    const pad = k => k.padEnd(14);
    console.log('\n' + c.green('━'.repeat(64)));
    console.log(c.green(c.bold(`  FORMULÁRIO RECEBIDO  #${submissions}  →  ${name}`)));
    console.log(c.green('━'.repeat(64)));

    console.log(c.bold('\n  Lead'));
    Object.keys(fields).forEach(k => {
      if (ATTR.includes(k) || k === 'form-name' || k === 'bot-field') { return; }
      console.log(`    ${pad(k)}: ${fields[k] || c.dim('(vazio)')}`);
    });

    console.log(c.bold('\n  Origem (atribuição)'));
    ATTR.forEach(k => {
      if (!(k in fields)) { return; }
      if (k === 'attribution') {
        console.log(`    ${pad(k)}: ${fields[k] ? c.dim(`JSON, ${fields[k].length} chars`) : c.yellow('AUSENTE')}`);
        return;
      }
      console.log(`    ${pad(k)}: ${fields[k] || c.dim('(vazio)')}`);
    });

    const missing = ATTR.filter(k => !(k in fields));
    if (missing.length) {
      console.log(c.yellow(`\n  ⚠ campos de atribuição ausentes: ${missing.join(', ')}`));
      console.log(c.yellow('    (declare-os no formulário oculto, ou o Netlify não grava)'));
    }
    console.log(c.dim('\n  O webhook do CRM é enviado pelo navegador, com env:"local".'));
    console.log(c.green('━'.repeat(64)) + '\n');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>OK</title><p>Form received (dev server).');
  });
}

/* /lp-parents → lp-parents.html, /blog → blog/index.html, / → index.html */
function resolveFile(pathname) {
  const clean = decodeURIComponent(pathname.split('?')[0]);
  if (clean.includes('..')) { return null; }

  const candidates = [];
  if (clean === '/' || clean === '') {
    candidates.push('index.html');
  } else {
    const rel = clean.replace(/^\/+/, '').replace(/\/+$/, '');
    candidates.push(rel, rel + '.html', path.join(rel, 'index.html'));
  }

  for (const cand of candidates) {
    const full = path.join(ROOT, cand);
    if (!full.startsWith(ROOT)) { continue; }
    try {
      if (fs.statSync(full).isFile()) { return full; }
    } catch (e) {}
  }
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'POST') { return handleFormPost(req, res); }

  const file = resolveFile(url.pathname);
  if (!file) {
    console.log(c.yellow(`  404  ${url.pathname}`));
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>404</title><h1>404</h1><p>' + url.pathname);
    return;
  }

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log('\n' + c.cyan(c.bold('  Josiah Thurlow — dev server')));
  console.log(c.cyan('  ' + '─'.repeat(50)));
  console.log(`  Site          ${c.bold(`http://localhost:${PORT}/`)}`);
  console.log(`  LP pais       http://localhost:${PORT}/lp-parents`);
  console.log(`  Blog          http://localhost:${PORT}/blog`);
  console.log(`  Bio links     http://localhost:${PORT}/links`);
  console.log(c.cyan('  ' + '─'.repeat(50)));
  console.log(c.dim('  Teste a atribuição abrindo, por exemplo:'));
  console.log(c.dim(`  http://localhost:${PORT}/?utm_source=google&utm_medium=cpc&utm_campaign=teste&gclid=ABC123`));
  console.log(c.dim('\n  Os envios de formulário aparecem aqui. Ctrl+C para parar.\n'));
});
