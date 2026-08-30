'use strict';
/**
 * Carrega o engine.js ORIGINAL (byte a byte igual ao que já passou nos 27 testes)
 * injetando a semente do aluno como as globais que o motor espera
 * (SUBJECTS, SUBJECT_QUEUE, TOPICS_SEED).
 *
 * Por que não require(): buildInitialState() lê essas três globais do escopo do
 * arquivo. Com require() elas virariam globais do processo, e um servidor
 * multi-aluno acabaria misturando semente entre requisições.
 *
 * A solução é compilar o arquivo como corpo de função, com a semente vindo por
 * parâmetro: cada aluno ganha o seu próprio ENGINE, com objetos do mesmo realm
 * do Node (nada de vm/proxy no meio), e engine.js segue intocado — a única
 * coisa acrescentada é o `return ENGINE;` no fim.
 *
 * `module` e `window` entram como parâmetros valendo undefined, então os dois
 * `typeof ... !== 'undefined'` do fim do arquivo continuam sendo no-op.
 */
const fs = require('node:fs');
const path = require('node:path');

const ENGINE_PATH = path.join(__dirname, 'engine.js');
const SOURCE = fs.readFileSync(ENGINE_PATH, 'utf8');

// eslint-disable-next-line no-new-func
const FACTORY = new Function(
  'SUBJECTS',
  'SUBJECT_QUEUE',
  'TOPICS_SEED',
  'module',
  'window',
  `${SOURCE}\n;return ENGINE;\n//# sourceURL=engine.js`,
);

function normalizeSeed(seed) {
  if (!seed || typeof seed !== 'object') throw new Error('seed inválida');
  const subjects = seed.subjects ?? seed.SUBJECTS;
  const subjectQueue = seed.subjectQueue ?? seed.SUBJECT_QUEUE ?? [];
  const topicsSeed = seed.topicsSeed ?? seed.TOPICS_SEED;
  if (!Array.isArray(subjects) || !subjects.length) throw new Error('seed.subjects vazia');
  if (!Array.isArray(topicsSeed) || !topicsSeed.length) throw new Error('seed.topicsSeed vazia');
  if (!Array.isArray(subjectQueue)) throw new Error('seed.subjectQueue precisa ser lista');
  for (const s of subjects) {
    if (!s || !s.id || !s.name) throw new Error('seed.subjects precisa de { id, name, color, weight }');
    if (typeof s.weight !== 'number' || !(s.weight > 0)) throw new Error(`peso inválido em ${s.id}`);
  }
  const ids = new Set(subjects.map((s) => s.id));
  for (const t of topicsSeed) {
    if (!t || !t.subj || !t.name) throw new Error('seed.topicsSeed precisa de { subj, name, entry }');
    if (!ids.has(t.subj)) throw new Error(`tópico aponta pra matéria inexistente: ${t.subj}`);
    if (t.entry !== 'novo' && t.entry !== 'revisao') throw new Error(`entry inválido: ${t.entry}`);
  }
  return { subjects, subjectQueue, topicsSeed };
}

/**
 * @param {object} seed { subjects, subjectQueue, topicsSeed }
 * @returns {object} a API do ENGINE, ligada a essa semente
 */
function createEngine(seed) {
  const s = normalizeSeed(seed);
  return FACTORY(clone(s.subjects), clone(s.subjectQueue), clone(s.topicsSeed), undefined, undefined);
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

module.exports = { createEngine, normalizeSeed, ENGINE_PATH };
