'use strict';
/**
 * O caminho de produção (Vercel) usa api/[...path].js, não server/index.js.
 * Estes testes seguram os erros que só apareceriam depois do deploy.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ADAPTER = path.join(RAIZ, 'api', '[...path].js');

test('o adaptador serverless responde como o servidor local', async (t) => {
  const handler = require(ADAPTER);
  assert.equal(typeof handler, 'function');

  const server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  // o login de demonstração existe no backend em memória
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'kaleu@ciclo.local', password: 'kaleu123' }),
  });
  assert.equal(login.status, 200);
  const sessao = await login.json();

  const hoje = await fetch(`${base}/api/today`, {
    headers: { Authorization: `Bearer ${sessao.access_token}` },
  });
  assert.equal(hoje.status, 200);
  assert.ok((await hoje.json()).items.length > 0);

  const semToken = await fetch(`${base}/api/today`);
  assert.equal(semToken.status, 401);
});

test('vercel.json leva o engine.js pro bundle da função', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'vercel.json'), 'utf8'));

  assert.equal(cfg.outputDirectory, 'public', 'o front sai de public/, não da raiz');

  // engine.js é lido em runtime (fs.readFileSync), não importado — sem
  // includeFiles a Vercel não o empacota e a função quebra com ENOENT.
  const fn = cfg.functions && cfg.functions['api/[...path].js'];
  assert.ok(fn, 'a função catch-all precisa estar declarada');
  assert.ok(fn.includeFiles, 'includeFiles é obrigatório por causa do readFileSync do loader');

  const alvo = path.join(RAIZ, 'server', 'engine', 'engine.js');
  assert.ok(fs.existsSync(alvo), 'engine.js existe onde o loader procura');
  assert.match(fn.includeFiles, /^server\/engine\//);
});

test('nenhuma outra leitura de arquivo em runtime escapou do includeFiles', () => {
  // se aparecer um readFileSync novo fora de engine/loader e do estático, o
  // teste avisa antes do deploy
  const arquivos = [];
  (function anda(dir) {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (fs.statSync(p).isDirectory()) anda(p);
      else if (p.endsWith('.js')) arquivos.push(p);
    }
  })(path.join(RAIZ, 'server'));

  const permitidos = [
    path.join(RAIZ, 'server', 'engine', 'loader.js'), // engine.js, coberto por includeFiles
    path.join(RAIZ, 'server', 'lib', 'http.js'),      // estático, servido pela Vercel
  ];
  for (const arq of arquivos) {
    if (permitidos.includes(arq)) continue;
    const src = fs.readFileSync(arq, 'utf8');
    assert.equal(
      /readFileSync|fs\.readFile\(/.test(src),
      false,
      `${path.relative(RAIZ, arq)} lê arquivo em runtime — inclua no includeFiles do vercel.json`,
    );
  }
});
