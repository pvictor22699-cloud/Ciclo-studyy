'use strict';
/** Painel do professor: lista de alunos, % de progresso, permissões. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, completeAllToday } = require('./helpers');

const HOJE = '2026-01-05';

test('GET /professor/students lista só os alunos vinculados, com % de progresso', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());

  const prof = await ctx.login('professor');
  assert.equal(prof.user.role, 'professor');

  const vazio = await ctx.call('GET', '/api/professor/students', { token: prof.access_token });
  assert.equal(vazio.status, 200);
  assert.equal(vazio.body.students.length, 1, 'o aluno2 não está vinculado a este professor');
  assert.equal(vazio.body.students[0].name, 'Kaleu');
  assert.equal(vazio.body.students[0].progress.percent, 0);
  assert.equal(vazio.body.students[0].progress.total, 48);

  // aluno estuda um dia inteiro
  const aluno = await ctx.login('aluno');
  await completeAllToday(ctx, aluno.access_token, HOJE);

  const depois = await ctx.call('GET', '/api/professor/students', { token: prof.access_token });
  const kaleu = depois.body.students[0];
  assert.ok(kaleu.progress.percent > 0, 'o professor enxerga o avanço do aluno');
  assert.ok(kaleu.progress.done >= 1);
  assert.ok(kaleu.progress.hours > 0);
  assert.equal(kaleu.streak.count, 1);
  assert.equal(kaleu.lastActivity, HOJE);
  assert.ok(Array.isArray(kaleu.progress.bySubj) && kaleu.progress.bySubj.length === 4);
});

test('o painel do professor não altera o estado do aluno', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const prof = await ctx.login('professor');
  const aluno = await ctx.login('aluno');

  await ctx.call('GET', `/api/today?today=${HOJE}`, { token: aluno.access_token });
  const antes = await ctx.repo.getStudentById(ctx.students.aluno.id);

  await ctx.call('GET', '/api/professor/students', { token: prof.access_token });
  await ctx.call('GET', `/api/professor/students/${ctx.students.aluno.id}`, { token: prof.access_token });

  const depois = await ctx.repo.getStudentById(ctx.students.aluno.id);
  assert.equal(depois.state_version, antes.state_version, 'leitura do professor não grava');
  assert.deepEqual(depois.state, antes.state);
});

test('GET /professor/students/:id traz detalhe, dia e histórico', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const prof = await ctx.login('professor');
  const aluno = await ctx.login('aluno');
  await completeAllToday(ctx, aluno.access_token, HOJE);

  const res = await ctx.call('GET', `/api/professor/students/${ctx.students.aluno.id}`, {
    token: prof.access_token,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.studentName, 'Kaleu');
  assert.equal(res.body.topics.length, 9);
  assert.ok(res.body.today.items.length >= 0);
  assert.ok(res.body.recent.length >= 1, 'histórico de conclusões');
  assert.ok(res.body.topics.some((t2) => t2.steps.some((s) => s.done)));
});

test('permissões', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const prof = await ctx.login('professor');
  const aluno = await ctx.login('aluno');

  await t.test('aluno não entra na área do professor', async () => {
    const res = await ctx.call('GET', '/api/professor/students', { token: aluno.access_token });
    assert.equal(res.status, 403);
  });

  await t.test('professor não abre aluno que não acompanha', async () => {
    const res = await ctx.call('GET', `/api/professor/students/${ctx.students.aluno2.id}`, {
      token: prof.access_token,
    });
    assert.equal(res.status, 403);
  });

  await t.test('aluno inexistente dá 404', async () => {
    const res = await ctx.call('GET', '/api/professor/students/00000000-0000-0000-0000-000000000000', {
      token: prof.access_token,
    });
    assert.equal(res.status, 404);
  });

  await t.test('sem token, 401', async () => {
    assert.equal((await ctx.call('GET', '/api/professor/students')).status, 401);
  });
});

test('professor cadastra aluno novo com login e ciclo próprios', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const prof = await ctx.login('professor');

  const res = await ctx.call('POST', '/api/professor/students', {
    token: prof.access_token,
    body: {
      name: 'Aluno Novo',
      email: 'novo@teste.local',
      password: 'novo12345',
      startDate: HOJE,
      seed: {
        subjects: [{ id: 'PT', name: 'Português', color: '#2DD4BF', weight: 2 }],
        subjectQueue: [],
        topicsSeed: [
          { subj: 'PT', entry: 'novo', name: 'Crase' },
          { subj: 'PT', entry: 'revisao', name: 'Regência' },
        ],
      },
    },
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.student.id);

  const lista = await ctx.call('GET', '/api/professor/students', { token: prof.access_token });
  assert.equal(lista.body.students.length, 2);

  // o aluno novo já consegue entrar e ver o dia dele, com a semente própria
  const login = await ctx.call('POST', '/api/auth/login', {
    body: { email: 'novo@teste.local', password: 'novo12345' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'aluno');
  const day = await ctx.call('GET', `/api/today?today=${HOJE}`, { token: login.body.access_token });
  assert.equal(day.status, 200);
  assert.ok(day.body.items.length > 0);
  assert.ok(day.body.items.every((i) => i.subj === 'PT'));

  const prog = await ctx.call('GET', '/api/progress', { token: login.body.access_token });
  assert.equal(prog.body.topics.length, 2, 'usou a semente enviada, não a padrão');
});

test('cadastro de aluno valida entrada', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const prof = await ctx.login('professor');
  const aluno = await ctx.login('aluno');

  assert.equal(
    (await ctx.call('POST', '/api/professor/students', { token: prof.access_token, body: {} })).status,
    400,
  );
  assert.equal(
    (
      await ctx.call('POST', '/api/professor/students', {
        token: prof.access_token,
        body: { name: 'X', email: 'x@teste.local' },
      })
    ).status,
    400,
    'e-mail sem senha inicial',
  );
  const seedRuim = await ctx.call('POST', '/api/professor/students', {
    token: prof.access_token,
    body: { name: 'X', seed: { subjects: [], topicsSeed: [] } },
  });
  assert.equal(seedRuim.status, 400, 'semente inválida é recusada com 400');
  assert.match(seedRuim.body.message, /semente inválida/);
  assert.equal(
    (await ctx.call('POST', '/api/professor/students', { token: aluno.access_token, body: { name: 'X' } }))
      .status,
    403,
  );
});

test('professor pede Estudo Extra para um aluno seu', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const prof = await ctx.login('professor');
  const aluno = await ctx.login('aluno');

  const day = (await ctx.call('GET', `/api/today?today=${HOJE}`, { token: aluno.access_token })).body;
  const e1 = day.items.find((i) => i.step === 'E1');
  await ctx.call('POST', '/api/complete', { token: aluno.access_token, body: { itemId: e1.id, today: HOJE } });
  const d2 = (await ctx.call('GET', '/api/today?today=2026-01-06', { token: aluno.access_token })).body;
  const e2 = d2.items.find((i) => i.topicId === e1.topicId && i.step === 'E2');
  await ctx.call('POST', '/api/complete', {
    token: aluno.access_token,
    body: { itemId: e2.id, today: '2026-01-06' },
  });

  const res = await ctx.call('POST', `/api/professor/students/${ctx.students.aluno.id}/extra`, {
    token: prof.access_token,
    body: { topicId: e1.topicId, minutes: 90, today: '2026-01-06' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.extra.minutes, 90);

  const negado = await ctx.call('POST', `/api/professor/students/${ctx.students.aluno2.id}/extra`, {
    token: prof.access_token,
    body: { topicId: 'T001', minutes: 30 },
  });
  assert.equal(negado.status, 403, 'não pode mexer em aluno que não acompanha');
});
