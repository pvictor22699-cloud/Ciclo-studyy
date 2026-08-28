/* Funções puras de apresentação — sem DOM, sem rede.
   Testáveis no Node (tests/view-model.test.js) e usadas pelos dois fronts. */
(function (root, factory) {
  const VM = factory();
  if (typeof module !== 'undefined') module.exports = VM;
  if (typeof window !== 'undefined') window.VM = VM;
})(this, function () {
  const TAG_CLASS = {
    ESTUDO: 'b-teoria',
    'ESTUDO EXTRA': 'b-accent',
    'REVISÃO ATIVA': 'b-revisao',
    QUESTÕES: 'b-questoes',
    'QUESTÕES ERRADAS': 'b-questoes',
    PERIÓDICA: 'b-revisao',
    SÓLIDO: 'b-muted',
  };
  const AGENDA_CLASS = {
    ESTUDO: 't',
    'ESTUDO EXTRA': 'x',
    'REVISÃO ATIVA': 'r',
    QUESTÕES: 'q',
    'QUESTÕES ERRADAS': 'q',
    PERIÓDICA: 'r',
    SÓLIDO: 'q',
  };

  function badgeClass(tag) {
    return TAG_CLASS[tag] || 'b-muted';
  }
  function agendaClass(tag) {
    return AGENDA_CLASS[tag] || 't';
  }

  /** '2026-01-05' → '05/01/26' (mesmo formato do fmtBR do motor). */
  function fmtBR(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    return `${d}/${m}/${y.slice(2)}`;
  }

  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  /** '2026-01-05' → 'segunda, 05 de jan' */
  function fmtLongo(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return `${DIAS[dt.getDay()]}, ${String(d).padStart(2, '0')} de ${MESES[m - 1]}`;
  }

  function fmtHoras(h) {
    const n = Number(h) || 0;
    if (n < 1) return `${Math.round(n * 60)}min`;
    const inteiro = Math.floor(n);
    const min = Math.round((n - inteiro) * 60);
    return min ? `${inteiro}h${String(min).padStart(2, '0')}` : `${inteiro}h`;
  }

  /** Subtítulo de um item do dia: instrução do motor + atraso, quando houver. */
  function itemSubtitulo(item) {
    const partes = [];
    if (item.overdue) partes.push(`atrasada desde ${fmtBR(item.due)}`);
    if (item.type === 'extra' && item.minutes) partes.push(`${item.minutes} min pedidos pelo professor`);
    if (item.instruction) partes.push(item.instruction);
    return partes.join(' · ');
  }

  /** Frase-resumo do topo da tela do aluno. */
  function resumoDia(day) {
    if (!day || !day.items.length) return 'Nada agendado pra hoje — aproveita pra descansar.';
    if (day.allDone) return 'Dia fechado. Tudo concluído.';
    const faltam = day.total - day.doneCount;
    const horas = fmtHoras(day.plannedHours);
    return `${faltam} de ${day.total} ${faltam === 1 ? 'meta' : 'metas'} · ${horas} planejadas`;
  }

  /** Agrupa itens por matéria mantendo a ordem intercalada que o motor definiu. */
  function agruparPorMateria(items) {
    const ordem = [];
    const mapa = new Map();
    for (const it of items) {
      if (!mapa.has(it.subj)) {
        mapa.set(it.subj, { subj: it.subj, name: it.subjName, color: it.color, items: [] });
        ordem.push(it.subj);
      }
      mapa.get(it.subj).items.push(it);
    }
    return ordem.map((s) => mapa.get(s));
  }

  /** Cor do % de progresso (verde forte → vermelho). */
  function corProgresso(pct) {
    if (pct >= 66) return 'var(--green)';
    if (pct >= 33) return 'var(--amber)';
    return 'var(--accent2)';
  }

  /** Texto de "quanto tempo sem estudar" pro painel do professor. */
  function statusAluno(aluno) {
    if (!aluno.lastActivity) return { texto: 'ainda não começou', tom: 'alerta' };
    const dias = aluno.idleDays == null ? 0 : aluno.idleDays;
    if (dias <= 0) return { texto: 'estudou hoje', tom: 'ok' };
    if (dias === 1) return { texto: 'estudou ontem', tom: 'ok' };
    if (dias <= 3) return { texto: `${dias} dias sem estudar`, tom: 'neutro' };
    return { texto: `${dias} dias sem estudar`, tom: 'alerta' };
  }

  const CURTO = { E1: 'E1', E2: 'E2', EXTRA: 'EX', RATIVA: 'RA', Q1: 'Q1', Q2: 'Q2', Q3: 'Q3', QE: 'QE' };

  /** Marca as etapas de um tópico pra régua visual (feito / próximo / futuro). */
  function reguaEtapas(topic) {
    let proximaMarcada = false;
    return topic.steps.map((s) => {
      let estado = 'off';
      if (s.done) estado = 'on';
      else if (!proximaMarcada) {
        estado = 'next';
        proximaMarcada = true;
      }
      return { k: s.k, curto: CURTO[s.k] || s.k, label: s.label, due: s.due, done: s.done, estado };
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]);
  }

  return {
    badgeClass,
    agendaClass,
    fmtBR,
    fmtLongo,
    fmtHoras,
    itemSubtitulo,
    resumoDia,
    agruparPorMateria,
    corProgresso,
    statusAluno,
    reguaEtapas,
    escapeHtml,
  };
});
