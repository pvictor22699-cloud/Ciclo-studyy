/* Semente padrão do Kaleu — mesmo conteúdo do data.js original.
   No banco cada aluno guarda a SUA cópia disso em students.seed, então este
   arquivo serve só como default ao criar um ciclo novo.

   ⚠️ DADOS DE EXEMPLO (placeholder) — Victor ainda vai mandar a lista real de
   tópicos + dificuldade (peso) de cada matéria. */

const SUBJECTS = [
  { id: 'PT',  name: 'Português',              color: '#2DD4BF', weight: 1 },
  { id: 'RLM', name: 'Raciocínio Lógico',       color: '#EAB308', weight: 1 },
  { id: 'DC',  name: 'Direito Constitucional',  color: '#FB7185', weight: 1 },
  { id: 'DA',  name: 'Direito Administrativo',  color: '#F5A524', weight: 1 },
];

// fila de matérias aguardando pra entrar quando uma matéria ativa virar Sólido
const SUBJECT_QUEUE = [];

const TOPICS_SEED = [
  { subj: 'PT',  entry: 'novo',    name: '[placeholder] Interpretação de texto' },
  { subj: 'PT',  entry: 'revisao', name: '[placeholder] Crase' },
  { subj: 'PT',  entry: 'revisao', name: '[placeholder] Concordância verbal' },

  { subj: 'RLM', entry: 'novo',    name: '[placeholder] Estruturas lógicas' },
  { subj: 'RLM', entry: 'novo',    name: '[placeholder] Proposições e conectivos' },

  { subj: 'DC',  entry: 'revisao', name: '[placeholder] Direitos fundamentais' },
  { subj: 'DC',  entry: 'novo',    name: '[placeholder] Controle de constitucionalidade' },

  { subj: 'DA',  entry: 'revisao', name: '[placeholder] Atos administrativos' },
  { subj: 'DA',  entry: 'revisao', name: '[placeholder] Licitações' },
];

/** Formato guardado em students.seed (JSONB). */
const DEFAULT_SEED = {
  subjects: SUBJECTS,
  subjectQueue: SUBJECT_QUEUE,
  topicsSeed: TOPICS_SEED,
};

module.exports = { SUBJECTS, SUBJECT_QUEUE, TOPICS_SEED, DEFAULT_SEED };
