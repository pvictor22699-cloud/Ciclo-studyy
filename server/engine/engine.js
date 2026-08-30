/* ============================================================
   KALEU — Motor (pós-CBM, rumo a PM-RR + PRF)

   Decisões fechadas nesta conversa:
   - Sequência Novo: Estudo 1 (2h) → Estudo 2 (1h) → [Estudo Extra opcional]
     → Revisão Ativa → Q1 → Q2 → Q3 → Questões Erradas
   - Sequência Revisão (entrada própria, "já viu antes"): Q1 → Q2 → Q3 → Questões Erradas
     (mesmo ponto de chegada de quem vem do Novo via Revisão Ativa)
   - Checagem de 70% depois do Q2: INSTRUÇÃO pro aluno, motor não guarda score
   - Sólido = fase "pra sempre" (era "Manutenção" nos outros motores) — por MATÉRIA,
     não por tópico: quando todos os tópicos de uma matéria terminam Questões Erradas,
     a matéria vira Sólido e uma matéria da fila de espera entra no lugar dela
   - Estudo Extra: só 1x por tópico, até 120 min, agendado +2 dias do Estudo 2,
     Revisão Ativa nunca cai antes dele
   - Periódica ÚNICA, 11 dias, ROTAÇÃO (não sorteio): entre matérias por peso,
     dentro da matéria por "nunca apareceu" (mais antigo primeiro), depois por
     "há mais tempo sem aparecer" — sem herança de pool do CBM
   - Peso por matéria = dificuldade percebida pelo professor (não edital, não
     desempenho automático) — nasce neutro (1x) até Victor mandar os números
   ============================================================ */

const STEP_LABEL = {
  E1: 'Estudo 1', E2: 'Estudo 2', EXTRA: 'Estudo Extra',
  RATIVA: 'Revisão Ativa',
  Q1: 'Questões 1', Q2: 'Questões 2', Q3: 'Questões 3', QE: 'Questões Erradas',
};
const STEP_INSTRUCTION = {
  RATIVA: 'Recall em branco (tenta lembrar sem olhar) → confere → ~15 questões',
  Q1: 'Bancas principais (IDECAN, FGV, FCC, Cebraspe) ou UERR quando tiver volume suficiente',
  Q2: 'Mesmas bancas, sem repetir questão já respondida. Confira sua % de acertos acumulada — abaixo de 70%, reforce a teoria antes de seguir.',
  Q3: 'Mesmas bancas, sem repetir questão já respondida',
  QE: 'Revisar o caderno de erros da matéria no TecConcursos',
};
const STEP_TAG = { E1:'ESTUDO', E2:'ESTUDO', EXTRA:'ESTUDO EXTRA', RATIVA:'REVISÃO ATIVA',
  Q1:'QUESTÕES', Q2:'QUESTÕES', Q3:'QUESTÕES', QE:'QUESTÕES ERRADAS' };

// gaps em dias — PROPOSTA (não confirmada número a número), cresce sempre.
// Só Estudo1→Estudo2 não tem mínimo (fica disponível assim que possível).
const GAP = {
  E2_RATIVA: 7,      // Estudo 2 → Revisão Ativa
  RATIVA_Q1: 10,     // Revisão Ativa → Q1  (também usado como 1ª etapa de quem entra por Novo)
  Q1_Q2: 14,
  Q2_Q3: 18,
  Q3_QE: 21,
};
const EXTRA_GAP = 2;              // Estudo Extra sempre +2 dias do Estudo 2
const EXTRA_MAX_MIN = 120;        // teto de minutos por pedido
const SOLIDO_FIRST = 45, SOLIDO_FACTOR = 1.65, SOLIDO_CAP = 120; // por MATÉRIA
const PER_INTERVAL = 11;
const START_TOLERANCE = 1.0;

const DEFAULT_DUR = { E1:2.0, E2:1.0, RATIVA:1.25, Q1:1.25, Q2:1.0, Q3:1.0, QE:1.0, SOLIDO:0.5, PER:1.0 };

function todayLocal(){
  const ov = (typeof localStorage !== 'undefined') && localStorage.getItem('kaleu_today_override');
  if (ov) return ov;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDays(iso, n){
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, m-1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
function diffDays(a,b){ const p=s=>{const [y,m,d]=s.split('-').map(Number); return Date.UTC(y,m-1,d);}; return Math.round((p(b)-p(a))/86400000); }
function fmtBR(iso){ const [y,m,d]=iso.split('-'); return `${d}/${m}/${y.slice(2)}`; }

function seqFor(entry){
  if (entry === 'novo') return ['E1','E2','RATIVA','Q1','Q2','Q3','QE'];
  return ['Q1','Q2','Q3','QE']; // entrada 'revisao'
}
function gapAfter(entry, k){
  // intervalo (dias) até a PRÓXIMA etapa depois de concluir `k`
  if (k==='E1') return null;              // Estudo1→Estudo2: sem mínimo
  if (k==='E2') return GAP.E2_RATIVA;     // Estudo2→Revisão Ativa
  if (k==='RATIVA') return GAP.RATIVA_Q1;
  if (k==='Q1') return GAP.Q1_Q2;
  if (k==='Q2') return GAP.Q2_Q3;
  if (k==='Q3') return GAP.Q3_QE;
  return null; // QE = fim da trilha fixa, vira Sólido (por matéria)
}

function buildInitialState(today){
  const topics = TOPICS_SEED.map((t,i)=>({
    id: 'T'+String(i+1).padStart(3,'0'), subj: t.subj, name: t.name, entry: t.entry,
    started: false,
    steps: seqFor(t.entry).map(k=>({ k, due:null, done:null })),
    extra: null,           // { minutes, done, due } — só existe se foi solicitado
    lastPeriodica: null,   // data da última vez que caiu em periódica (null = nunca)
  }));
  return {
    version: 1, kind: 'kaleu', startDate: today,
    config: { limit: 3, durations: {...DEFAULT_DUR} },  // limite diário simples por enquanto
    subjects: SUBJECTS.map(s=>({...s})),
    topics,
    subjectQueue: [...SUBJECT_QUEUE],   // matérias aguardando pra entrar quando uma ficar Sólido
    subjSolido: {},                      // subj -> {next, gap, count}
    per: { anchor: today, count: 0, history: [] },
    day: null,
    streak: { count:0, last:null, best:0 },
    log: [],
    meta: { sinceExport: 0 },
  };
}

function topicById(state,id){ return state.topics.find(t=>t.id===id); }
function pendingStep(t){ return t.steps.find(s=>!s.done) || null; }
function isSubjActive(state, subj){ return state.subjects.some(s=>s.id===subj) && !state.subjSolido[subj]; }
function isSubjSolido(state, subj){ return !!state.subjSolido[subj]; }
function subjTopicsAllDone(state, subj){
  const ts = state.topics.filter(t=>t.subj===subj);
  return ts.length>0 && ts.every(t=>t.steps.every(s=>s.done));
}
function durOf(state, ref){
  const D = state.config.durations;
  if (ref.type==='per') return D.PER;
  if (ref.type==='solido') return D.SOLIDO;
  if (ref.type==='extra') return Math.round((ref.minutes/60)*100)/100;
  return D[ref.k] ?? 1;
}

function weightedOrder(state, candidates){
  const pool = state.subjects.filter(s=>candidates.has(s.id)).map(s=>({...s, credit:0}));
  const total = pool.reduce((a,s)=>a+s.weight,0) || 1;
  const order = []; const left = [...pool];
  while (left.length){
    for (const s of left) s.credit += s.weight;
    let best = left.reduce((a,b)=> b.credit>a.credit?b:a);
    order.push(best.id); best.credit -= total;
    left.splice(left.indexOf(best),1);
  }
  return order;
}
function intercalate(state, items){
  const bySubj = new Map();
  for (const it of items){ if(!bySubj.has(it.subj)) bySubj.set(it.subj,[]); bySubj.get(it.subj).push(it); }
  for (const arr of bySubj.values()) arr.sort((a,b)=>(a.due||'').localeCompare(b.due||''));
  const order = weightedOrder(state, new Set(bySubj.keys()));
  const out = []; let moved=true;
  while(moved){ moved=false; for(const s of order){ const arr=bySubj.get(s); if(arr&&arr.length){ out.push(arr.shift()); moved=true; } } }
  return out;
}

function dueItems(state, today){
  const out = [];
  for (const t of state.topics){
    if (!t.started) continue;
    if (t.extra && !t.extra.done && t.extra.due<=today){
      out.push({ type:'extra', topicId:t.id, subj:t.subj, due:t.extra.due, minutes:t.extra.minutes });
    }
    const p = pendingStep(t);
    if (p && p.due && p.due<=today) out.push({ type:'step', topicId:t.id, k:p.k, due:p.due, subj:t.subj });
  }
  for (const subj in state.subjSolido){
    const s = state.subjSolido[subj];
    if (s.next<=today) out.push({ type:'solido', subj, due:s.next });
  }
  return out;
}

// ---- periódica: ROTAÇÃO, nunca sorteio ----
function nextPeriodicaTopic(state, subj, today){
  const candidatos = state.topics.filter(t=>t.subj===subj && t.started);
  if (!candidatos.length) return null;
  const nuncaAppareceu = candidatos.filter(t=>!t.lastPeriodica);
  if (nuncaAppareceu.length){
    // entre os que nunca apareceram, o estudado há mais tempo primeiro
    const comData = nuncaAppareceu.map(t=>{
      const primeiraData = t.steps.find(s=>s.done)?.done || today;
      return { t, primeiraData };
    });
    comData.sort((a,b)=>a.primeiraData.localeCompare(b.primeiraData));
    return comData[0].t;
  }
  // todos já apareceram — pega quem está há mais tempo SEM aparecer
  return [...candidatos].sort((a,b)=>a.lastPeriodica.localeCompare(b.lastPeriodica))[0];
}
function duePeriodica(state, today){
  const next = addDays(state.per.anchor, PER_INTERVAL);
  if (today < next) return null;
  const subjsComHistorico = new Set(
    state.topics.filter(t=>t.started).map(t=>t.subj)
  );
  if (!subjsComHistorico.size) return null;
  const order = weightedOrder(state, subjsComHistorico);
  const subj = order[state.per.count % order.length];
  const topic = nextPeriodicaTopic(state, subj, today);
  if (!topic) return null;
  return { type:'per', n: state.per.count+1, subj, topicId: topic.id };
}

function computeDay(state, today){
  if (state.day && state.day.date===today) return state.day;
  const limit = state.config.limit;
  let due = dueItems(state, today);
  const hadOverdue = due.some(it=>it.due && it.due<today);
  due = intercalate(state, due);

  const per = duePeriodica(state, today);
  let sum = per ? DEFAULT_DUR.PER : 0;

  const sel = []; let deferred = 0;
  for (const it of due){
    if (sum < limit){ sel.push(it); sum += durOf(state,it); }
    else deferred++;
  }

  if (deferred===0){
    let guard=0, added=true;
    while (added && guard++<300){
      added=false;
      const ativos = state.subjects.filter(s=>isSubjActive(state,s.id)).map(s=>s.id);
      const notStarted = new Set(state.topics.filter(t=>!t.started && ativos.includes(t.subj)).map(t=>t.subj));
      if (!notStarted.size) break;
      const order = weightedOrder(state, notStarted);
      for (const subj of order){
        const t = state.topics.find(x=>x.subj===subj && !x.started);
        if (!t) continue;
        const k0 = t.steps[0].k;
        const d = DEFAULT_DUR[k0];
        if (sum + d <= limit + START_TOLERANCE){
          t.started = true; t.steps[0].due = today;
          sel.push({ type:'step', topicId:t.id, k:k0, due:today, subj:t.subj });
          sum += d; added = true;
        }
      }
    }
  }

  let items = intercalate(state, sel);
  if (per) items.splice(Math.floor(items.length/2), 0, per);

  state.day = { date: today, items, hadOverdue, deferred, perDone:false };
  return state.day;
}

function isItemDone(state, ref){
  if (ref.type==='per') return !!(state.day && state.day.perDone);
  if (ref.type==='extra'){ const t=topicById(state,ref.topicId); return !!(t.extra && t.extra.done); }
  if (ref.type==='solido') return !(state.subjSolido[ref.subj] && state.subjSolido[ref.subj].next<=state.day.date);
  const t = topicById(state, ref.topicId); if(!t) return true;
  const s = t.steps.find(x=>x.k===ref.k);
  return !!(s && s.done);
}
function dayAllDone(state){ return state.day && state.day.items.every(it=>isItemDone(state,it)); }

// ---- ações do professor: pedir Estudo Extra, tratado à parte de completeItem ----
function requestExtra(state, topicId, minutes, today){
  const t = topicById(state, topicId);
  if (!t) return { ok:false, reason:'tópico não encontrado' };
  if (t.extra) return { ok:false, reason:'este tópico já usou o Estudo Extra (limite de 1x)' };
  const e2 = t.steps.find(s=>s.k==='E2');
  if (!e2 || !e2.done) return { ok:false, reason:'só pode pedir Estudo Extra depois de concluir o Estudo 2' };
  const mins = Math.max(1, Math.min(EXTRA_MAX_MIN, Math.round(minutes)));
  const dueExtra = addDays(e2.done, EXTRA_GAP);
  t.extra = { minutes: mins, done: null, due: dueExtra };
  // Revisão Ativa nunca cai antes do Estudo Extra concluído: empurra se precisar
  const rativa = t.steps.find(s=>s.k==='RATIVA');
  if (rativa){
    const minimoAposExtra = addDays(dueExtra, 1);
    if (!rativa.due || rativa.due < minimoAposExtra) rativa.due = minimoAposExtra;
  }
  return { ok:true, due: dueExtra, minutes: mins };
}

function completeItem(state, ref, today){
  if (ref.type==='per'){
    state.day.perDone = true; state.per.count++;
    const t = topicById(state, ref.topicId); if (t) t.lastPeriodica = today;
    state.per.history.push({ n: ref.n, subj: ref.subj, topicId: ref.topicId, done: today });
    let a = state.per.anchor;
    while (addDays(a, PER_INTERVAL) <= today) a = addDays(a, PER_INTERVAL);
    state.per.anchor = a;
  } else if (ref.type==='extra'){
    const t = topicById(state, ref.topicId);
    if (t.extra && !t.extra.done) t.extra.done = today;
  } else if (ref.type==='solido'){
    const s = state.subjSolido[ref.subj];
    s.count++; s.gap = Math.min(SOLIDO_CAP, Math.round(s.gap*SOLIDO_FACTOR)); s.next = addDays(today, s.gap);
  } else {
    const t = topicById(state, ref.topicId);
    const idx = t.steps.findIndex(s=>s.k===ref.k);
    const s = t.steps[idx];
    if (s.done) return;
    s.done = today;
    if (idx+1 < t.steps.length){
      const gap = gapAfter(t.entry, ref.k);
      const nxt = t.steps[idx+1];
      if (gap===null) nxt.due = today;                       // Estudo1→Estudo2, sem mínimo
      else {
        const proposto = addDays(today, gap);
        // se já existe due maior (empurrado pelo Estudo Extra), respeita o maior
        nxt.due = nxt.due && nxt.due > proposto ? nxt.due : proposto;
      }
    } else {
      // fim da trilha fixa (QE concluído) — checa se a MATÉRIA inteira já fechou
      if (subjTopicsAllDone(state, t.subj) && !state.subjSolido[t.subj]){
        state.subjSolido[t.subj] = { next: addDays(today, SOLIDO_FIRST), gap: SOLIDO_FIRST, count:0 };
        // puxa a próxima matéria da fila de espera, se houver
        if (state.subjectQueue.length){
          const proxima = state.subjectQueue.shift();
          if (!state.subjects.some(s=>s.id===proxima.id)) state.subjects.push({...proxima});
        }
      }
    }
  }
  state.log.push({ date:today, ref, hours: durOf(state,ref) });
  state.meta.sinceExport++;
  if (dayAllDone(state)) bumpStreak(state, today);
}

function bumpStreak(state, today){
  const st = state.streak;
  if (st.last===today) return;
  if (st.last===addDays(today,-1)) st.count++;
  else if (st.last===null) st.count=1;
  else st.count = state.day.hadOverdue ? 1 : st.count+1;
  st.last = today; st.best = Math.max(st.best, st.count);
}

function project(state, fromDate, maxDays){
  const sim = JSON.parse(JSON.stringify(state));
  sim.day = null;
  const days = [];
  let d = fromDate;
  for (let i=0;i<maxDays;i++){
    const day = computeDay(sim, d);
    if (day.items.length){
      days.push({ date:d, items: day.items.map(it=>({...it})) });
      for (const it of day.items) completeItem(sim, it, d);
    }
    d = addDays(d,1);
  }
  return days;
}

function progressStats(state){
  const bySubj = {};
  for (const s of state.subjects) bySubj[s.id] = { name:s.name, color:s.color, weight:s.weight, totalSteps:0, doneSteps:0, solido:isSubjSolido(state,s.id) };
  let total=0, done=0;
  for (const t of state.topics){
    const b = bySubj[t.subj]; if(!b) continue;
    b.totalSteps += t.steps.length; total += t.steps.length;
    const dn = t.steps.filter(s=>s.done).length; b.doneSteps += dn; done += dn;
  }
  const hours = state.log.reduce((a,l)=>a+l.hours,0);
  return { bySubj, total, done, hours, streak: state.streak, per: state.per.count };
}

const ENGINE = { STEP_LABEL, STEP_INSTRUCTION, STEP_TAG, GAP, EXTRA_GAP, EXTRA_MAX_MIN, DEFAULT_DUR,
  todayLocal, addDays, diffDays, fmtBR, seqFor, gapAfter,
  buildInitialState, computeDay, completeItem, requestExtra, isItemDone, dayAllDone, dueItems,
  project, progressStats, topicById, pendingStep, durOf, isSubjSolido, isSubjActive, subjTopicsAllDone,
  nextPeriodicaTopic, duePeriodica };
if (typeof module !== 'undefined') module.exports = ENGINE;
if (typeof window !== 'undefined') window.ENGINE = ENGINE;
