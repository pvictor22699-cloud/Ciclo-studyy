'use strict';
/** Helpers de apresentação usados pelas duas telas (sem DOM). */
const test = require('node:test');
const assert = require('node:assert/strict');
const VM = require('../public/js/view-model.js');

test('formatação de datas e horas', () => {
  assert.equal(VM.fmtBR('2026-01-05'), '05/01/26');
  assert.equal(VM.fmtLongo('2026-01-05'), 'segunda, 05 de jan');
  assert.equal(VM.fmtBR(null), '');
  assert.equal(VM.fmtHoras(2), '2h');
  assert.equal(VM.fmtHoras(1.25), '1h15');
  assert.equal(VM.fmtHoras(0.5), '30min');
});

test('resumo do dia', () => {
  assert.match(VM.resumoDia({ items: [], total: 0, doneCount: 0 }), /Nada agendado/);
  assert.match(
    VM.resumoDia({ items: [1], allDone: true, total: 1, doneCount: 1, plannedHours: 2 }),
    /Dia fechado/,
  );
  assert.equal(
    VM.resumoDia({ items: [1, 2, 3], allDone: false, total: 3, doneCount: 1, plannedHours: 3.5 }),
    '2 de 3 metas · 3h30 planejadas',
  );
});

test('subtítulo do item junta atraso, minutos do extra e instrução do motor', () => {
  const s = VM.itemSubtitulo({
    overdue: true,
    due: '2026-01-03',
    type: 'extra',
    minutes: 90,
    instruction: 'Recall em branco',
  });
  assert.match(s, /atrasada desde 03\/01\/26/);
  assert.match(s, /90 min/);
  assert.match(s, /Recall em branco/);
  assert.equal(VM.itemSubtitulo({ instruction: null, overdue: false }), '');
});

test('agrupar por matéria preserva a ordem intercalada do motor', () => {
  const grupos = VM.agruparPorMateria([
    { subj: 'PT', subjName: 'Português', color: '#1', id: 'a' },
    { subj: 'RLM', subjName: 'RLM', color: '#2', id: 'b' },
    { subj: 'PT', subjName: 'Português', color: '#1', id: 'c' },
  ]);
  assert.deepEqual(grupos.map((g) => g.subj), ['PT', 'RLM']);
  assert.deepEqual(grupos[0].items.map((i) => i.id), ['a', 'c']);
});

test('classes visuais por etiqueta do motor', () => {
  assert.equal(VM.badgeClass('ESTUDO'), 'b-teoria');
  assert.equal(VM.badgeClass('QUESTÕES'), 'b-questoes');
  assert.equal(VM.badgeClass('ESTUDO EXTRA'), 'b-accent');
  assert.equal(VM.badgeClass('coisa nova'), 'b-muted');
  assert.equal(VM.agendaClass('REVISÃO ATIVA'), 'r');
});

test('régua de etapas marca feito, próximo e futuro', () => {
  const regua = VM.reguaEtapas({
    steps: [
      { k: 'E1', label: 'Estudo 1', done: '2026-01-05', due: '2026-01-05' },
      { k: 'E2', label: 'Estudo 2', done: null, due: '2026-01-05' },
      { k: 'RATIVA', label: 'Revisão Ativa', done: null, due: null },
    ],
  });
  assert.deepEqual(regua.map((e) => e.estado), ['on', 'next', 'off']);
  assert.equal(regua[2].curto, 'RA', 'rótulo curto cabe no chip');
});

test('status do aluno no painel do professor', () => {
  assert.deepEqual(VM.statusAluno({ lastActivity: null }), { texto: 'ainda não começou', tom: 'alerta' });
  assert.equal(VM.statusAluno({ lastActivity: '2026-01-05', idleDays: 0 }).texto, 'estudou hoje');
  assert.equal(VM.statusAluno({ lastActivity: '2026-01-04', idleDays: 1 }).texto, 'estudou ontem');
  assert.equal(VM.statusAluno({ lastActivity: '2026-01-01', idleDays: 2 }).tom, 'neutro');
  assert.equal(VM.statusAluno({ lastActivity: '2025-12-20', idleDays: 9 }).tom, 'alerta');
});

test('cor do progresso muda por faixa', () => {
  assert.notEqual(VM.corProgresso(10), VM.corProgresso(50));
  assert.notEqual(VM.corProgresso(50), VM.corProgresso(90));
});

test('escapeHtml protege nomes de tópico vindos do banco', () => {
  assert.equal(VM.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(VM.escapeHtml(null), '');
});
