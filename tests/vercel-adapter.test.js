'use strict';
/**
 * O caminho de produção (Vercel) não é o mesmo do servidor local: a requisição
 * chega numa função serverless, através do rewrite do vercel.json, e com o
 * corpo já lido pelo runtime. Estes testes simulam isso — foi o que faltava
 * quando /api/auth/login caiu no 404 da Vercel e /api/health funcionava.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const adapter = require(path.join(RAIZ, 'api', 'index.js'));

/** Servidor que imita o rewrite da Vercel: /api/x/y -> /api?__path=x/y */
async function servidorComoVercel(t, { corpoJaLido = false } = {}) {
  const server = http.createServer((req, res) => {
    const [caminho, query] = req.url.split('?');
    const resto = caminho.replace(/^\/api\/?/, '');
    const params = new URLSearchParams(query || '');
    params.set('__path', resto);
    req.url = `/api?${params.toString()}`;

    if (!corpoJaLido) return adapter(req, res);

    // o runtime da Vercel lê o stream e entrega o corpo pronto em req.body
    const pedacos = [];
    req.on('data', (c) => pedacos.push(c));
    req.on('end', () => {
      const texto = Buffer.concat(pedacos).toString('utf8');
      req.body = texto ? JSON.parse(texto) : {};
      adapter(req, res);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('restaurarCaminho remonta a URL original a partir do rewrite', () => {
  const { restaurarCaminho } = adapter;
  assert.equal(restaurarCaminho('/api?__path=health'), '/api/health');
  assert.equal(restaurarCaminho('/api?__path=auth/login'), '/api/auth/login');
  assert.equal(
    restaurarCaminho('/api?__path=professor/students/abc-123'),
    '/api/professor/students/abc-123',
  );
  assert.equal(
    restaurarCaminho('/api?__path=today&today=2026-01-05'),
    '/api/today?today=2026-01-05',
  );
  // sem rewrite (caminho já preservado), passa intacto
  assert.equal(restaurarCaminho('/api/today?today=2026-01-05'), '/api/today?today=2026-01-05');
  assert.equal(restaurarCaminho('/api/health'), '/api/health');
});

test('rotas de vários segmentos respondem através do rewrite', async (t) => {
  const base = await servidorComoVercel(t);

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  // ESTE é o caso que quebrou em produção: dois segmentos
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'professor@ciclo.local', password: 'professor123' }),
  });
  assert.equal(login.status, 200, 'POST /api/auth/login não pode cair em 404');
  const sessao = await login.json();
  assert.equal(sessao.user.role, 'professor');

  // rota de professor: três segmentos
  const alunos = await fetch(`${base}/api/professor/students`, {
    headers: { Authorization: `Bearer ${sessao.access_token}` },
  });
  assert.equal(alunos.status, 200);
  assert.ok(Array.isArray((await alunos.json()).students));

  // query string sobrevive ao rewrite
  const aluno = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'kaleu@ciclo.local', password: 'kaleu123' }),
  });
  const sessaoAluno = await aluno.json();
  const hoje = await fetch(`${base}/api/today?today=2026-01-05`, {
    headers: { Authorization: `Bearer ${sessaoAluno.access_token}` },
  });
  assert.equal(hoje.status, 200);
  assert.equal((await hoje.json()).date, '2026-01-05', 'o ?today= chegou no handler');

  const semToken = await fetch(`${base}/api/today`);
  assert.equal(semToken.status, 401);

  const inexistente = await fetch(`${base}/api/nao-existe`);
  assert.equal(inexistente.status, 404);
  assert.equal((await inexistente.json()).error, 'not_found', '404 nosso é JSON, não HTML');
});

test('corpo já lido pelo runtime (req.body) é aproveitado', async (t) => {
  const base = await servidorComoVercel(t, { corpoJaLido: true });

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'kaleu@ciclo.local', password: 'kaleu123' }),
  });
  assert.equal(login.status, 200, 'não pode virar 400 de "e-mail obrigatório"');
  const sessao = await login.json();
  assert.equal(sessao.user.role, 'aluno');

  const hoje = await fetch(`${base}/api/today`, {
    headers: { Authorization: `Bearer ${sessao.access_token}` },
  });
  const dia = (await hoje.json()).items;
  assert.ok(dia.length > 0);

  const concluir = await fetch(`${base}/api/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.access_token}` },
    body: JSON.stringify({ itemId: dia[0].id }),
  });
  assert.equal(concluir.status, 200);
  assert.equal((await concluir.json()).doneCount, 1);
});

test('vercel.json: rewrite cobre todas as rotas e o engine.js entra no bundle', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'vercel.json'), 'utf8'));

  assert.equal(cfg.outputDirectory, 'public', 'o front sai de public/, não da raiz');

  const rw = (cfg.rewrites || []).find((r) => r.source.startsWith('/api'));
  assert.ok(rw, 'precisa de um rewrite pra /api');
  assert.match(rw.destination, /__path=\$1/, 'o caminho original tem que viajar no __path');

  // toda rota registrada no app precisa casar com o source do rewrite
  const appSrc = fs.readFileSync(path.join(RAIZ, 'server', 'app.js'), 'utf8');
  const rotas = [...appSrc.matchAll(/router\.\w+\('(\/api[^']*)'/g)].map((m) => m[1]);
  assert.ok(rotas.length > 10, 'achou as rotas do app');
  const re = new RegExp(`^${rw.source}$`);
  for (const rota of rotas) {
    const concreta = rota.replace(/:\w+/g, 'abc-123');
    assert.ok(re.test(concreta), `o rewrite não cobre ${rota}`);
  }

  // engine.js é lido em runtime (fs.readFileSync), não importado — sem
  // includeFiles a Vercel não o empacota e a função quebra com ENOENT
  const fn = cfg.functions && cfg.functions['api/index.js'];
  assert.ok(fn, 'a função precisa estar declarada com um caminho literal (sem glob de colchete)');
  assert.ok(fn.includeFiles, 'includeFiles é obrigatório por causa do readFileSync do loader');
  assert.match(fn.includeFiles, /^server\/engine\//);
  assert.ok(fs.existsSync(path.join(RAIZ, 'server', 'engine', 'engine.js')));

  // o nome do arquivo da função não pode ter colchete: em glob, [...] é classe
  // de caracteres, e foi por aí que a rota de vários segmentos se perdeu
  for (const chave of Object.keys(cfg.functions || {})) {
    assert.equal(/[[\]]/.test(chave), false, `chave de function com colchete: ${chave}`);
  }
  for (const arq of fs.readdirSync(path.join(RAIZ, 'api'))) {
    assert.equal(/[[\]]/.test(arq), false, `arquivo em api/ com colchete: ${arq}`);
  }
});

test('nenhuma outra leitura de arquivo em runtime escapou do includeFiles', () => {
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
