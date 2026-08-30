'use strict';
/** Fluxos do aluno pela API: login, carregar o dia, concluir meta, sincronizar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, completeAllToday } = require('./helpers');

const HOJE = '2026-01-05';

test('login', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());

  await t.test('e-mail e senha corretos devolvem token e papel', async () => {
    const res = await ctx.call('POST', '/api/auth/login', {
      body: { email: 'kaleu@teste.local', password: 'kaleu123' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.access_token);
    assert.ok(res.body.refresh_token);
    assert.equal(res.body.user.role, 'aluno');
    assert.equal(res.body.user.name, 'Kaleu');
    assert.equal(res.body.user.studentId, ctx.students.aluno.id);
  });

  await t.test('senha errada dá 401', async () => {
    const res = await ctx.call('POST', '/api/auth/login', {
      body: { email: 'kaleu@teste.local', password: 'errada' },
    });
    assert.equal(res.status, 401);
  });

  await t.test('campos faltando dão 400', async () => {
    const res = await ctx.call('POST', '/api/auth/login', { body: { email: 'kaleu@teste.local' } });
    assert.equal(res.status, 400);
  });

  await t.test('rota protegida sem token dá 401', async () => {
    assert.equal((await ctx.call('GET', '/api/today')).status, 401);
    assert.equal((await ctx.call('GET', '/api/me')).status, 401);
  });

  await t.test('token inválido dá 401', async () => {
    const res = await ctx.call('GET', '/api/today', { token: 'nao-existe' });
    assert.equal(res.status, 401);
  });

  await t.test('refresh troca a sessão', async () => {
    const login = await ctx.login('aluno');
    const res = await ctx.call('POST', '/api/auth/refresh', {
      body: { refresh_token: login.refresh_token },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.access_token);
    const me = await ctx.call('GET', '/api/me', { token: res.body.access_token });
    assert.equal(me.status, 200);
    assert.equal(me.body.email, 'kaleu@teste.local');
  });

  await t.test('logout invalida o token', async () => {
    const login = await ctx.login('aluno');
    assert.equal((await ctx.call('GET', '/api/me', { token: login.access_token })).status, 200);
    await ctx.call('POST', '/api/auth/logout', { token: login.access_token });
    assert.equal((await ctx.call('GET', '/api/me', { token: login.access_token })).status, 401);
  });
});

test('GET /today monta o dia a partir do banco', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const { access_token: token } = await ctx.login('aluno');

  const res = await ctx.call('GET', `/api/today?today=${HOJE}`, { token });
  assert.equal(res.status, 200);
  const day = res.body;
  assert.equal(day.date, HOJE);
  assert.ok(day.items.length > 0, 'o motor escalou metas pro primeiro dia');
  assert.equal(day.doneCount, 0);
  assert.ok(day.plannedHours <= day.limit + 1);

  for (const item of day.items) {
    assert.ok(item.id, 'todo item tem id estável');
    assert.ok(item.label, 'rótulo vem do STEP_LABEL do motor');
    assert.ok(item.subjName);
    assert.ok(item.topicName || item.type === 'solido');
    assert.equal(item.done, false);
  }

  await t.test('o dia é persistido: segundo GET devolve exatamente a mesma lista', async () => {
    const again = await ctx.call('GET', `/api/today?today=${HOJE}`, { token });
    assert.deepEqual(
      again.body.items.map((i) => i.id),
      day.items.map((i) => i.id),
    );
  });

  await t.test('outro dispositivo (novo login) enxerga o mesmo dia', async () => {
    const outro = await ctx.login('aluno');
    const noOutro = await ctx.call('GET', `/api/today?today=${HOJE}`, { token: outro.access_token });
    assert.deepEqual(
      noOutro.body.items.map((i) => i.id),
      day.items.map((i) => i.id),
    );
  });
});

test('POST /complete conclui a meta e grava no banco', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const { access_token: token } = await ctx.login('aluno');
  const day = (await ctx.call('GET', `/api/today?today=${HOJE}`, { token })).body;
  const alvo = day.items[0];

  const res = await ctx.call('POST', '/api/complete', {
    token,
    body: { itemId: alvo.id, today: HOJE, expectedVersion: day.version },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.alreadyDone, false);
  assert.equal(res.body.items.find((i) => i.id === alvo.id).done, true);
  assert.equal(res.body.doneCount, 1);
  assert.ok(res.body.version > day.version, 'versão do state avançou');
  assert.ok(res.body.progress.done >= 1);

  await t.test('a conclusão sobrevive a um novo GET (está no banco, não na memória do cliente)', async () => {
    const depois = await ctx.call('GET', `/api/today?today=${HOJE}`, { token });
    assert.equal(depois.body.items.find((i) => i.id === alvo.id).done, true);
  });

  await t.test('outro dispositivo vê a meta já concluída', async () => {
    const outro = await ctx.login('aluno');
    const depois = await ctx.call('GET', `/api/today?today=${HOJE}`, { token: outro.access_token });
    assert.equal(depois.body.items.find((i) => i.id === alvo.id).done, true);
  });

  await t.test('concluir de novo é idempotente', async () => {
    const de_novo = await ctx.call('POST', '/api/complete', {
      token,
      body: { itemId: alvo.id, today: HOJE },
    });
    assert.equal(de_novo.status, 200);
    assert.equal(de_novo.body.alreadyDone, true);
    assert.equal(de_novo.body.doneCount, 1);
  });

  await t.test('meta que não é do dia é recusada', async () => {
    const res2 = await ctx.call('POST', '/api/complete', {
      token,
      body: { itemId: 'step:T999:QE', today: HOJE },
    });
    assert.equal(res2.status, 400);
  });

  await t.test('itemId ausente é recusado', async () => {
    assert.equal((await ctx.call('POST', '/api/complete', { token, body: {} })).status, 400);
  });

  await t.test('versão desatualizada dá 409 (outro dispositivo gravou antes)', async () => {
    const atual = (await ctx.call('GET', `/api/today?today=${HOJE}`, { token })).body;
    const pendente = atual.items.find((i) => !i.done);
    const res3 = await ctx.call('POST', '/api/complete', {
      token,
      body: { itemId: pendente.id, today: HOJE, expectedVersion: 1 },
    });
    assert.equal(res3.status, 409);
    assert.equal(res3.body.currentVersion, atual.version);
  });

  await t.test('o log de conclusões foi gravado', async () => {
    const rows = await ctx.repo.listCompletions(ctx.students.aluno.id, 10);
    assert.ok(rows.length >= 1);
    assert.equal(rows[0].done_on, HOJE);
    assert.ok(rows[0].hours > 0);
  });

  await t.test('snapshot do estado anterior foi guardado', async () => {
    const snaps = await ctx.repo.listSnapshots(ctx.students.aluno.id, 5);
    assert.ok(snaps.length >= 1);
    assert.ok(snaps[0].state);
  });
});

test('dia inteiro concluído acende o streak', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const { access_token: token } = await ctx.login('aluno');
  const day = await completeAllToday(ctx, token, HOJE);
  assert.equal(day.allDone, true);
  assert.equal(day.doneCount, day.total);
  assert.equal(day.streak.count, 1);
  assert.equal(day.streak.best, 1);
});

test('Estudo Extra pela API respeita as regras do motor', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const { access_token: token } = await ctx.login('aluno');

  const day = (await ctx.call('GET', `/api/today?today=${HOJE}`, { token })).body;
  const e1 = day.items.find((i) => i.step === 'E1');
  assert.ok(e1, 'o primeiro dia tem pelo menos um Estudo 1');

  const cedo = await ctx.call('POST', '/api/extra', {
    token,
    body: { topicId: e1.topicId, minutes: 60, today: HOJE },
  });
  assert.equal(cedo.status, 400, 'sem Estudo 2 concluído, o motor recusa');

  // conclui E1 e E2 do tópico
  await ctx.call('POST', '/api/complete', { token, body: { itemId: e1.id, today: HOJE } });
  const amanha = '2026-01-06';
  const dia2 = (await ctx.call('GET', `/api/today?today=${amanha}`, { token })).body;
  const e2 = dia2.items.find((i) => i.topicId === e1.topicId && i.step === 'E2');
  assert.ok(e2, 'Estudo 2 aparece no dia seguinte');
  await ctx.call('POST', '/api/complete', { token, body: { itemId: e2.id, today: amanha } });

  const ok = await ctx.call('POST', '/api/extra', {
    token,
    body: { topicId: e1.topicId, minutes: 200, today: amanha },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.extra.minutes, 120, 'teto de 120 min aplicado pelo motor');
  assert.equal(ok.body.extra.due, '2026-01-08', '+2 dias do Estudo 2');

  const repetido = await ctx.call('POST', '/api/extra', {
    token,
    body: { topicId: e1.topicId, minutes: 30, today: amanha },
  });
  assert.equal(repetido.status, 400, 'só 1 Estudo Extra por tópico');

  // no dia agendado o Extra está vencido: entra na lista, ou fica adiado se o
  // limite diário já estourou com metas atrasadas (decisão do motor, não da API)
  const noDia = (await ctx.call('GET', '/api/today?today=2026-01-08', { token })).body;
  const entrou = noDia.items.some((i) => i.type === 'extra' && i.topicId === e1.topicId);
  assert.ok(entrou || noDia.deferred > 0, 'ou entra no dia, ou aparece como adiado');

  // com folga na agenda, o Extra tem que aparecer
  await ctx.call('PATCH', '/api/config', { token, body: { limit: 8 } });
  const comFolga = (await ctx.call('GET', '/api/today?today=2026-01-08', { token })).body;
  const item = comFolga.items.find((i) => i.type === 'extra' && i.topicId === e1.topicId);
  assert.ok(item, 'o Estudo Extra entra na lista do dia agendado');
  assert.equal(item.hours, 2, '120 min = 2h no cálculo do dia');
  assert.equal(item.label, 'Estudo Extra');

  const feito = await ctx.call('POST', '/api/complete', {
    token,
    body: { itemId: item.id, today: '2026-01-08' },
  });
  assert.equal(feito.status, 200);
  assert.equal(feito.body.items.find((i) => i.id === item.id).done, true);
});

test('GET /progress e /projection', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const { access_token: token } = await ctx.login('aluno');
  await completeAllToday(ctx, token, HOJE);

  const prog = await ctx.call('GET', '/api/progress', { token });
  assert.equal(prog.status, 200);
  assert.equal(prog.body.progress.total, 48);
  assert.ok(prog.body.progress.percent > 0);
  assert.equal(prog.body.topics.length, 9);
  assert.ok(prog.body.progress.bySubj.length === 4);

  const proj = await ctx.call('GET', `/api/projection?days=14&today=${HOJE}`, { token });
  assert.equal(proj.status, 200);
  assert.ok(proj.body.days.length > 0);
  assert.ok(proj.body.days[0].items.length > 0);

  const antes = (await ctx.call('GET', '/api/progress', { token })).body;
  assert.deepEqual(antes.progress, prog.body.progress, 'projeção não altera o progresso real');
});

test('PATCH /config muda o limite diário e recalcula o dia', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const { access_token: token } = await ctx.login('aluno');

  const antes = (await ctx.call('GET', `/api/today?today=${HOJE}`, { token })).body;
  const res = await ctx.call('PATCH', '/api/config', { token, body: { limit: 6 } });
  assert.equal(res.status, 200);
  assert.equal(res.body.config.limit, 6);

  const depois = (await ctx.call('GET', `/api/today?today=${HOJE}`, { token })).body;
  assert.ok(depois.items.length > antes.items.length, 'limite maior = mais metas no dia');

  assert.equal((await ctx.call('PATCH', '/api/config', { token, body: { limit: 99 } })).status, 400);
  assert.equal(
    (await ctx.call('PATCH', '/api/config', { token, body: { durations: { XX: 1 } } })).status,
    400,
  );
});

test('usuário sem ciclo vinculado recebe 404 explicativo', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  // remove o vínculo do aluno2 com o ciclo dele
  await ctx.repo.updateStudent(ctx.students.aluno2.id, { user_id: null });
  const { access_token: token } = await ctx.login('aluno2');
  const res = await ctx.call('GET', '/api/today', { token });
  assert.equal(res.status, 404);
  assert.match(res.body.message, /ciclo/);
});

test('override de data é bloqueado quando desligado', async (t) => {
  const ctx = await startServer({ allowTodayOverride: false });
  t.after(() => ctx.close());
  const { access_token: token } = await ctx.login('aluno');
  const res = await ctx.call('GET', '/api/today?today=2030-01-01', { token });
  assert.equal(res.status, 403);
  assert.equal((await ctx.call('GET', '/api/today', { token })).status, 200, 'sem override segue normal');
});

test('rotas inexistentes e método errado', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  assert.equal((await ctx.call('GET', '/api/nao-existe')).status, 404);
  assert.equal((await ctx.call('GET', '/api/complete')).status, 405);
  assert.equal((await ctx.call('GET', '/api/health')).status, 200);
});
