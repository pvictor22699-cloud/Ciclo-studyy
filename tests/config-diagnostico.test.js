'use strict';
/**
 * Regressão do 500 em produção:
 *   TypeError: Cannot convert argument to a ByteString because the character
 *   at index 8 has a value of 8226 ...
 *
 * Uma chave do Supabase copiada com a máscara da tela ("sb_publi••••") vira
 * caractere fora do ASCII num header HTTP. Antes isso estourava lá dentro do
 * fetch e chegava como "erro interno". Agora a config é conferida na largada.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { primeiroInvalido, ehSeguro, problemaNaChave } = require('../server/lib/header-safe');
const { loadConfig } = require('../server/config');
const { createApp } = require('../server/app');
const { createMemoryRepo } = require('../server/lib/repo-memory');
const { createMemoryAuth } = require('../server/lib/auth-memory');

const CHAVE_REAL = 'sb_publishable_WqBnPOTmKxzLsLAQ8fys7Q_RWSi9Muy';
const CHAVE_MASCARADA = 'sb_publi' + '•'.repeat(30); // o que quebrou em produção

test('detecta o caractere que um header não aceita', () => {
  assert.equal(ehSeguro(CHAVE_REAL), true);
  assert.equal(ehSeguro('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc-_'), true);

  const ruim = primeiroInvalido(CHAVE_MASCARADA);
  assert.equal(ruim.index, 8, 'mesma posição do erro que a Vercel logou');
  assert.equal(ruim.code, 8226, 'mesmo code point do erro (• U+2022)');
  assert.equal(ruim.mascara, true);

  // o mesmo erro que o undici dá, pra provar que a detecção bate com a realidade
  assert.throws(() => new Headers({ apikey: CHAVE_MASCARADA }), /index 8/);
  assert.doesNotThrow(() => new Headers({ apikey: CHAVE_REAL }));
});

test('a mensagem diz qual variável está errada e o que fazer', () => {
  const msg = problemaNaChave('SUPABASE_ANON_KEY', CHAVE_MASCARADA);
  assert.match(msg, /SUPABASE_ANON_KEY/);
  assert.match(msg, /posição 8/);
  assert.match(msg, /máscara/);
  assert.match(msg, /Supabase/);

  assert.equal(problemaNaChave('SUPABASE_ANON_KEY', CHAVE_REAL), null);
  assert.match(problemaNaChave('SUPABASE_URL', ''), /vazia/);
  assert.match(problemaNaChave('SUPABASE_ANON_KEY', ` ${CHAVE_REAL}\n`), /espaço/);
});

test('loadConfig aponta a chave mascarada, e só ela', () => {
  const env = {
    BACKEND: 'supabase',
    SUPABASE_URL: 'https://buymmmhxnssfobloylox.supabase.co',
    SUPABASE_ANON_KEY: CHAVE_MASCARADA,
    SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.abc.def',
  };
  const cfg = loadConfig(env);
  assert.equal(cfg.problems.length, 1);
  assert.match(cfg.problems[0], /SUPABASE_ANON_KEY/);

  // service_role mascarada é pega do mesmo jeito (mesmo prefixo de 8 chars)
  const cfg2 = loadConfig({ ...env, SUPABASE_ANON_KEY: CHAVE_REAL, SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGci' + '•'.repeat(40) });
  assert.equal(cfg2.problems.length, 1);
  assert.match(cfg2.problems[0], /SUPABASE_SERVICE_ROLE_KEY/);

  // config boa não reclama
  const cfg3 = loadConfig({ ...env, SUPABASE_ANON_KEY: CHAVE_REAL });
  assert.deepEqual(cfg3.problems, []);
  assert.deepEqual(loadConfig({ BACKEND: 'memory' }).problems, []);
});

test('a API responde a causa em vez de 500 opaco', async (t) => {
  const problems = ['SUPABASE_ANON_KEY tem "•" (U+2022) na posição 8: ...'];
  const app = createApp({
    repo: createMemoryRepo(),
    auth: createMemoryAuth(),
    configProblems: problems,
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;

  // health continua respondendo — é por ele que se descobre o problema
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.ok, false);
  assert.deepEqual(health.problems, problems);

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.c', password: 'seja-la-o-que-for' }),
  });
  assert.equal(login.status, 503);
  const corpo = await login.json();
  assert.equal(corpo.error, 'config_invalida');
  assert.deepEqual(corpo.problems, problems, 'a resposta diz qual variável corrigir');
});

test('health fica ok quando a config está boa', async (t) => {
  const app = createApp({ repo: createMemoryRepo(), auth: createMemoryAuth() });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const health = await (
    await fetch(`http://127.0.0.1:${server.address().port}/api/health`)
  ).json();
  assert.equal(health.ok, true);
  assert.equal(health.problems, undefined);
});

test('token do cliente com caractere inválido é 401, não 500', async () => {
  const { createSupabaseAuth } = require('../server/lib/auth-supabase');
  const auth = createSupabaseAuth({
    url: 'https://exemplo.supabase.co',
    anonKey: CHAVE_REAL,
    serviceKey: 'eyJhbGciOiJIUzI1NiJ9.abc.def',
  });
  // não chega a fazer rede: o token é recusado antes de virar header
  await assert.rejects(() => auth.verify('token-com-•-dentro'), (err) => {
    assert.equal(err.status, 401);
    return true;
  });
});
