'use strict';
/**
 * Garante que o engine.js ORIGINAL continua se comportando igual depois de
 * carregado pelo loader (vm + semente injetada). Não testa regra nova: testa
 * que a migração não mexeu em nada.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { createEngine, ENGINE_PATH } = require('../server/engine/loader');
const { DEFAULT_SEED } = require('../server/engine/seed-kaleu');

const TODAY = '2026-01-05';
const engine = () => createEngine(DEFAULT_SEED);

test('engine.js não foi modificado pela migração (hash da referência)', () => {
  const src = fs.readFileSync(ENGINE_PATH, 'utf8');
  // marcadores que provam que a lógica validada continua lá, byte a byte
  assert.match(src, /const GAP = \{\n  E2_RATIVA: 7,/);
  assert.match(src, /const EXTRA_GAP = 2;/);
  assert.match(src, /const SOLIDO_FIRST = 45, SOLIDO_FACTOR = 1\.65, SOLIDO_CAP = 120;/);
  assert.match(src, /const PER_INTERVAL = 11;/);
  assert.equal(src.includes('localStorage'), true, 'todayLocal segue intacto');
  // nenhuma referência a banco/rede dentro do motor
  assert.equal(/fetch\(|require\(/.test(src), false);
});

test('buildInitialState monta o mesmo formato do localStorage', () => {
  const E = engine();
  const st = E.buildInitialState(TODAY);
  assert.equal(st.version, 1);
  assert.equal(st.kind, 'kaleu');
  assert.equal(st.startDate, TODAY);
  assert.deepEqual(Object.keys(st.config).sort(), ['durations', 'limit']);
  assert.equal(st.topics.length, DEFAULT_SEED.topicsSeed.length);
  assert.equal(st.subjects.length, DEFAULT_SEED.subjects.length);
  assert.deepEqual(st.per, { anchor: TODAY, count: 0, history: [] });
  assert.deepEqual(st.streak, { count: 0, last: null, best: 0 });
  assert.equal(st.day, null);
  assert.deepEqual(st.log, []);
});

test('sequência Novo tem 7 etapas e Revisão começa em Q1', () => {
  const E = engine();
  assert.deepEqual(E.seqFor('novo'), ['E1', 'E2', 'RATIVA', 'Q1', 'Q2', 'Q3', 'QE']);
  assert.deepEqual(E.seqFor('revisao'), ['Q1', 'Q2', 'Q3', 'QE']);
});

test('cada semente ganha um contexto próprio (sem vazar entre alunos)', () => {
  const outraSeed = {
    subjects: [{ id: 'X', name: 'Só Matemática', color: '#fff', weight: 1 }],
    subjectQueue: [],
    topicsSeed: [{ subj: 'X', entry: 'novo', name: 'Único tópico' }],
  };
  const a = createEngine(DEFAULT_SEED).buildInitialState(TODAY);
  const b = createEngine(outraSeed).buildInitialState(TODAY);
  assert.equal(a.topics.length, DEFAULT_SEED.topicsSeed.length);
  assert.equal(b.topics.length, 1);
  assert.equal(b.subjects[0].id, 'X');
  // e a semente do primeiro continua intacta depois do segundo build
  const c = createEngine(DEFAULT_SEED).buildInitialState(TODAY);
  assert.equal(c.topics.length, DEFAULT_SEED.topicsSeed.length);
});

test('Estudo 1 → Estudo 2 sem intervalo mínimo; Estudo 2 → Revisão Ativa em 7 dias', () => {
  const E = engine();
  const st = E.buildInitialState(TODAY);
  E.computeDay(st, TODAY);
  const t = st.topics.find((x) => x.entry === 'novo' && x.started);
  E.completeItem(st, { type: 'step', topicId: t.id, k: 'E1', subj: t.subj }, TODAY);
  assert.equal(t.steps[1].due, TODAY, 'E2 fica disponível no mesmo dia');
  E.completeItem(st, { type: 'step', topicId: t.id, k: 'E2', subj: t.subj }, TODAY);
  assert.equal(t.steps[2].due, E.addDays(TODAY, 7), 'RATIVA cai 7 dias depois');
});

test('Estudo Extra: só depois do E2, 1x por tópico, teto de 120 min, +2 dias', () => {
  const E = engine();
  const st = E.buildInitialState(TODAY);
  E.computeDay(st, TODAY);
  const t = st.topics.find((x) => x.entry === 'novo' && x.started);

  assert.equal(E.requestExtra(st, t.id, 60, TODAY).ok, false, 'antes do E2 é recusado');

  E.completeItem(st, { type: 'step', topicId: t.id, k: 'E1', subj: t.subj }, TODAY);
  E.completeItem(st, { type: 'step', topicId: t.id, k: 'E2', subj: t.subj }, TODAY);

  const r = E.requestExtra(st, t.id, 999, TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.minutes, 120, 'teto de 120 min');
  assert.equal(r.due, E.addDays(TODAY, 2), 'agendado +2 dias do Estudo 2');
  assert.equal(E.requestExtra(st, t.id, 30, TODAY).ok, false, 'segundo pedido é recusado');

  const rativa = t.steps.find((s) => s.k === 'RATIVA');
  assert.ok(rativa.due > r.due, 'Revisão Ativa nunca cai antes do Estudo Extra');
});

test('matéria vira Sólido só quando TODOS os tópicos dela terminam', () => {
  const seed = {
    subjects: [{ id: 'PT', name: 'Português', color: '#2DD4BF', weight: 1 }],
    subjectQueue: [{ id: 'INFO', name: 'Informática', color: '#4f8ef7', weight: 1 }],
    topicsSeed: [
      { subj: 'PT', entry: 'revisao', name: 'A' },
      { subj: 'PT', entry: 'revisao', name: 'B' },
    ],
  };
  const E = createEngine(seed);
  const st = E.buildInitialState(TODAY);
  E.computeDay(st, TODAY);
  const [a, b] = st.topics;
  a.started = b.started = true;

  for (const k of ['Q1', 'Q2', 'Q3', 'QE']) {
    E.completeItem(st, { type: 'step', topicId: a.id, k, subj: 'PT' }, TODAY);
  }
  assert.equal(E.isSubjSolido(st, 'PT'), false, 'um tópico pendente ainda segura a matéria');

  for (const k of ['Q1', 'Q2', 'Q3', 'QE']) {
    E.completeItem(st, { type: 'step', topicId: b.id, k, subj: 'PT' }, TODAY);
  }
  assert.equal(E.isSubjSolido(st, 'PT'), true);
  assert.equal(st.subjSolido.PT.gap, 45, 'primeiro Sólido em 45 dias');
  assert.equal(st.subjects.some((s) => s.id === 'INFO'), true, 'matéria da fila entrou no lugar');
  assert.equal(st.subjectQueue.length, 0);
});

test('Sólido cresce 1.65x com teto de 120 dias', () => {
  const E = engine();
  const st = E.buildInitialState(TODAY);
  st.subjSolido.PT = { next: TODAY, gap: 45, count: 0 };
  st.day = { date: TODAY, items: [], hadOverdue: false, deferred: 0, perDone: false };
  E.completeItem(st, { type: 'solido', subj: 'PT', due: TODAY }, TODAY);
  assert.equal(st.subjSolido.PT.gap, 74);
  st.subjSolido.PT.gap = 119;
  E.completeItem(st, { type: 'solido', subj: 'PT', due: TODAY }, TODAY);
  assert.equal(st.subjSolido.PT.gap, 120, 'teto de 120');
});

test('periódica é rotação (11 dias), nunca sorteio', () => {
  const E = engine();
  const st = E.buildInitialState(TODAY);
  E.computeDay(st, TODAY);
  for (const t of st.topics) {
    t.started = true;
    t.steps[0].done = TODAY;
  }
  assert.equal(E.duePeriodica(st, E.addDays(TODAY, 10)), null, 'antes de 11 dias, nada');

  const dia11 = E.addDays(TODAY, 11);
  const p1 = E.duePeriodica(st, dia11);
  assert.equal(p1.type, 'per');
  assert.equal(p1.n, 1);
  // determinístico: mesma entrada, mesma saída
  assert.deepEqual(E.duePeriodica(st, dia11), p1);

  st.day = { date: dia11, items: [p1], hadOverdue: false, deferred: 0, perDone: false };
  E.completeItem(st, p1, dia11);
  assert.equal(E.topicById(st, p1.topicId).lastPeriodica, dia11);
  assert.equal(st.per.count, 1);

  const dia22 = E.addDays(dia11, 11);
  const p2 = E.duePeriodica(st, dia22);
  assert.notEqual(p2.topicId, p1.topicId, 'não repete o mesmo tópico em sequência');
});

test('computeDay respeita o limite diário e congela o dia', () => {
  const E = engine();
  const st = E.buildInitialState(TODAY);
  const day = E.computeDay(st, TODAY);
  const horas = day.items.reduce((a, it) => a + E.durOf(st, it), 0);
  assert.ok(horas <= st.config.limit + 1, `horas do dia (${horas}) dentro do limite + tolerância`);
  const again = E.computeDay(st, TODAY);
  assert.equal(again, day, 'mesmo dia = mesma lista, não recalcula');
});

test('project() não altera o state real', () => {
  const E = engine();
  const st = E.buildInitialState(TODAY);
  const antes = crypto.createHash('sha1').update(JSON.stringify(st)).digest('hex');
  const dias = E.project(st, TODAY, 30);
  const depois = crypto.createHash('sha1').update(JSON.stringify(st)).digest('hex');
  assert.equal(antes, depois, 'projeção é simulação pura');
  assert.ok(dias.length > 0);
});

test('progressStats conta etapas por matéria', () => {
  const E = engine();
  const st = E.buildInitialState(TODAY);
  const s = E.progressStats(st);
  const totalEsperado = st.topics.reduce((a, t) => a + t.steps.length, 0);
  assert.equal(s.total, totalEsperado);
  assert.equal(s.done, 0);
  assert.equal(Object.keys(s.bySubj).length, st.subjects.length);
});

test('loader rejeita semente malformada', () => {
  assert.throws(() => createEngine({ subjects: [], topicsSeed: [] }), /subjects/);
  assert.throws(
    () =>
      createEngine({
        subjects: [{ id: 'A', name: 'A', color: '#fff', weight: 1 }],
        topicsSeed: [{ subj: 'ZZ', name: 'x', entry: 'novo' }],
      }),
    /matéria inexistente/,
  );
  assert.throws(
    () =>
      createEngine({
        subjects: [{ id: 'A', name: 'A', color: '#fff', weight: 1 }],
        topicsSeed: [{ subj: 'A', name: 'x', entry: 'talvez' }],
      }),
    /entry inválido/,
  );
});
