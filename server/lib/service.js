'use strict';
/**
 * Camada de aplicação: carrega o state do banco, chama o engine.js ORIGINAL,
 * grava o resultado de volta. Nenhuma regra pedagógica mora aqui — se você
 * está pensando em decidir "o que vence hoje" neste arquivo, é sinal de que
 * a chamada certa é uma função do ENGINE.
 */
const { createEngine } = require('../engine/loader');
const { DEFAULT_SEED } = require('../engine/seed-kaleu');
const { todayIn, isIsoDate } = require('./dates');
const { badRequest, conflict, forbidden, notFound } = require('./errors');

/* ------------------------------------------------------------------ *
 * helpers                                                             *
 * ------------------------------------------------------------------ */

const clone = (v) => JSON.parse(JSON.stringify(v));

/** id estável de um item do dia — é isso que o front devolve no POST /complete. */
function itemId(it) {
  if (it.type === 'step') return `step:${it.topicId}:${it.k}`;
  if (it.type === 'extra') return `extra:${it.topicId}`;
  if (it.type === 'per') return `per:${it.n}`;
  if (it.type === 'solido') return `solido:${it.subj}`;
  return `?:${JSON.stringify(it)}`;
}

function engineFor(student) {
  return createEngine(student.seed);
}

function todayFor(student, requested, allowOverride) {
  if (requested != null) {
    if (!isIsoDate(requested)) throw badRequest('data inválida (use YYYY-MM-DD)');
    if (!allowOverride) throw forbidden('override de data desabilitado neste ambiente');
    return requested;
  }
  return todayIn(student.timezone);
}

/** Enriquece os itens do dia com rótulos/instruções do próprio ENGINE. */
function decorate(engine, state, items, today) {
  const subjName = {};
  const subjColor = {};
  for (const s of state.subjects) {
    subjName[s.id] = s.name;
    subjColor[s.id] = s.color;
  }
  return items.map((it) => {
    const topic = it.topicId ? engine.topicById(state, it.topicId) : null;
    const label =
      it.type === 'per'
        ? `Periódica #${it.n}`
        : it.type === 'solido'
          ? 'Sólido'
          : it.type === 'extra'
            ? engine.STEP_LABEL.EXTRA
            : engine.STEP_LABEL[it.k];
    return {
      id: itemId(it),
      ref: clone(it),
      type: it.type,
      step: it.k || (it.type === 'extra' ? 'EXTRA' : null),
      label,
      tag:
        it.type === 'per'
          ? 'PERIÓDICA'
          : it.type === 'solido'
            ? 'SÓLIDO'
            : engine.STEP_TAG[it.k || 'EXTRA'],
      instruction:
        it.type === 'per'
          ? 'Revisão periódica de rotação — tópico escolhido pelo motor'
          : it.type === 'solido'
            ? 'Manutenção da matéria já consolidada'
            : engine.STEP_INSTRUCTION[it.k] || null,
      subj: it.subj,
      subjName: subjName[it.subj] || it.subj,
      color: subjColor[it.subj] || '#8888a8',
      topicId: it.topicId || null,
      topicName: topic ? topic.name : null,
      minutes: it.minutes ?? null,
      due: it.due ?? null,
      overdue: !!(it.due && it.due < today),
      hours: engine.durOf(state, it),
      done: engine.isItemDone(state, it),
    };
  });
}

function completionRow(engine, state, ref, today) {
  return {
    done_on: today,
    item_type: ref.type,
    subj: ref.subj || null,
    topic_id: ref.topicId || null,
    step: ref.k || (ref.type === 'extra' ? 'EXTRA' : null),
    hours: engine.durOf(state, ref),
    ref: clone(ref),
  };
}

/* ------------------------------------------------------------------ *
 * serviço                                                             *
 * ------------------------------------------------------------------ */

function createService({ repo, allowTodayOverride = false }) {
  /** Grava com concorrência otimista; devolve a nova versão. */
  async function persist(student, state, { reason, completions = [] }) {
    const { state_version } = await repo.saveState(student.id, {
      state: clone(state),
      expectedVersion: student.state_version,
      reason,
      completions,
    });
    student.state = clone(state);
    student.state_version = state_version;
    return state_version;
  }

  /**
   * Monta o dia. computeDay() pode MUTAR o state (marca tópicos como iniciados,
   * grava state.day), então gravamos de volta quando algo mudou.
   */
  async function buildDay(student, { today, persistChanges = true }) {
    const engine = engineFor(student);
    const state = clone(student.state);
    const before = JSON.stringify(state);
    const day = engine.computeDay(state, today);
    const changed = JSON.stringify(state) !== before;
    if (changed && persistChanges) {
      await persist(student, state, { reason: 'day' });
    } else if (changed) {
      student.state = clone(state);
    }
    return { engine, state, day };
  }

  function dayPayload(engine, state, day, today, student) {
    const items = decorate(engine, state, day.items, today);
    const stats = engine.progressStats(state);
    const doneCount = items.filter((i) => i.done).length;
    return {
      date: today,
      studentId: student.id,
      studentName: student.name,
      version: student.state_version,
      hadOverdue: !!day.hadOverdue,
      deferred: day.deferred || 0,
      allDone: engine.dayAllDone(state),
      limit: state.config.limit,
      plannedHours: Math.round(items.reduce((a, i) => a + i.hours, 0) * 100) / 100,
      doneCount,
      total: items.length,
      items,
      streak: stats.streak,
      progress: summarize(stats),
    };
  }

  function summarize(stats) {
    return {
      total: stats.total,
      done: stats.done,
      percent: stats.total ? Math.round((stats.done / stats.total) * 1000) / 10 : 0,
      hours: Math.round(stats.hours * 100) / 100,
      periodicas: stats.per,
      bySubj: Object.entries(stats.bySubj).map(([id, s]) => ({
        id,
        name: s.name,
        color: s.color,
        weight: s.weight,
        solido: s.solido,
        totalSteps: s.totalSteps,
        doneSteps: s.doneSteps,
        percent: s.totalSteps ? Math.round((s.doneSteps / s.totalSteps) * 1000) / 10 : 0,
      })),
    };
  }

  return {
    itemId,
    summarize,

    /* ---------------- ciclo do aluno ---------------- */

    async createCycle({ userId = null, name, seed = DEFAULT_SEED, timezone = 'America/Boa_Vista', startDate }) {
      const engine = createEngine(seed);
      const today = startDate && isIsoDate(startDate) ? startDate : todayIn(timezone);
      const state = engine.buildInitialState(today);
      return repo.createStudent({ userId, name, kind: state.kind || 'kaleu', timezone, seed, state });
    },

    async getStudentForUser(userId) {
      const student = await repo.getStudentByUserId(userId);
      if (!student) throw notFound('nenhum ciclo de estudo vinculado a este usuário');
      return student;
    },

    async getToday(student, { today: requested } = {}) {
      const today = todayFor(student, requested, allowTodayOverride);
      const { engine, state, day } = await buildDay(student, { today });
      return dayPayload(engine, state, day, today, student);
    },

    /** Conclui uma meta do dia. `itemId` vem do GET /today. */
    async complete(student, { itemId: id, today: requested, expectedVersion }) {
      const today = todayFor(student, requested, allowTodayOverride);
      if (expectedVersion != null && Number(expectedVersion) !== student.state_version) {
        throw conflict('o estado mudou em outro dispositivo — recarregue', {
          currentVersion: student.state_version,
        });
      }
      const { engine, state, day } = await buildDay(student, { today });
      const target = day.items.find((it) => itemId(it) === id);
      if (!target) throw badRequest('esta meta não está no dia de hoje');
      if (engine.isItemDone(state, target)) {
        return { alreadyDone: true, ...dayPayload(engine, state, day, today, student) };
      }
      const row = completionRow(engine, state, target, today);
      engine.completeItem(state, target, today);
      await persist(student, state, { reason: 'complete', completions: [row] });
      const after = engine.computeDay(state, today);
      return { alreadyDone: false, ...dayPayload(engine, state, after, today, student) };
    },

    /** Ação do professor (ou do próprio aluno): pedir Estudo Extra. */
    async requestExtra(student, { topicId, minutes, today: requested }) {
      const today = todayFor(student, requested, allowTodayOverride);
      const engine = engineFor(student);
      const state = clone(student.state);
      const mins = Number(minutes);
      if (!Number.isFinite(mins) || mins <= 0) throw badRequest('minutos inválidos');
      const res = engine.requestExtra(state, topicId, mins, today);
      if (!res.ok) throw badRequest(res.reason);
      state.day = null; // força recomputar o dia com o extra já agendado
      await persist(student, state, { reason: 'extra' });
      const day = engine.computeDay(state, today);
      await persist(student, state, { reason: 'day' });
      return { extra: res, ...dayPayload(engine, state, day, today, student) };
    },

    async updateConfig(student, { limit, durations }) {
      const engine = engineFor(student);
      const state = clone(student.state);
      if (limit != null) {
        const n = Number(limit);
        if (!Number.isFinite(n) || n < 0.5 || n > 16) throw badRequest('limite diário fora do intervalo (0.5–16h)');
        state.config.limit = n;
      }
      if (durations && typeof durations === 'object') {
        for (const [k, v] of Object.entries(durations)) {
          if (!(k in state.config.durations)) throw badRequest(`etapa desconhecida: ${k}`);
          const n = Number(v);
          if (!Number.isFinite(n) || n <= 0 || n > 8) throw badRequest(`duração inválida para ${k}`);
          state.config.durations[k] = n;
        }
      }
      state.day = null; // o dia é recalculado com o novo limite
      await persist(student, state, { reason: 'config' });
      return { config: clone(state.config), version: student.state_version };
    },

    async progress(student) {
      const engine = engineFor(student);
      const state = clone(student.state);
      const stats = engine.progressStats(state);
      const topics = state.topics.map((t) => {
        const pending = engine.pendingStep(t);
        return {
          id: t.id,
          subj: t.subj,
          name: t.name,
          entry: t.entry,
          started: t.started,
          steps: t.steps.map((s) => ({ k: s.k, label: engine.STEP_LABEL[s.k], due: s.due, done: s.done })),
          extra: t.extra,
          lastPeriodica: t.lastPeriodica,
          nextStep: pending ? { k: pending.k, label: engine.STEP_LABEL[pending.k], due: pending.due } : null,
          canRequestExtra: !t.extra && !!t.steps.find((s) => s.k === 'E2' && s.done),
          done: t.steps.every((s) => s.done),
        };
      });
      return {
        studentId: student.id,
        studentName: student.name,
        startDate: state.startDate,
        version: student.state_version,
        config: state.config,
        progress: summarize(stats),
        solido: state.subjSolido,
        subjectQueue: state.subjectQueue,
        periodica: { anchor: state.per.anchor, count: state.per.count, history: state.per.history.slice(-10) },
        topics,
      };
    },

    async projection(student, { days = 21, today: requested } = {}) {
      const today = todayFor(student, requested, allowTodayOverride);
      const engine = engineFor(student);
      const state = clone(student.state);
      const n = Math.max(1, Math.min(120, Number(days) || 21));
      const projected = engine.project(state, today, n);
      return {
        from: today,
        days: projected.map((d) => ({
          date: d.date,
          items: decorate(engine, state, d.items, d.date).map((i) => ({
            id: i.id,
            label: i.label,
            tag: i.tag,
            subjName: i.subjName,
            color: i.color,
            topicName: i.topicName,
            hours: i.hours,
          })),
        })),
      };
    },

    /* ---------------- painel do professor ---------------- */

    async professorStudents(professorId) {
      const students = await repo.listStudentsForProfessor(professorId);
      const out = [];
      for (const student of students) {
        const engine = engineFor(student);
        const state = clone(student.state);
        const stats = engine.progressStats(state);
        const today = todayIn(student.timezone);
        // painel do professor NÃO grava: só olha, com uma cópia do state
        const day = engine.computeDay(clone(state), today);
        const lastLog = state.log.length ? state.log[state.log.length - 1] : null;
        out.push({
          id: student.id,
          name: student.name,
          timezone: student.timezone,
          userId: student.user_id,
          startDate: state.startDate,
          updatedAt: student.updated_at,
          version: student.state_version,
          progress: summarize(stats),
          streak: stats.streak,
          today: {
            date: today,
            total: day.items.length,
            deferred: day.deferred || 0,
            hadOverdue: !!day.hadOverdue,
          },
          lastActivity: lastLog ? lastLog.date : null,
          idleDays: lastLog ? engine.diffDays(lastLog.date, today) : null,
        });
      }
      out.sort((a, b) => b.progress.percent - a.progress.percent);
      return { students: out };
    },

    async professorStudentDetail(professorId, studentId) {
      const student = await repo.getStudentById(studentId);
      if (!student) throw notFound('aluno não encontrado');
      if (!(await repo.teaches(professorId, studentId))) throw forbidden('você não acompanha este aluno');
      const detail = await this.progress(student);
      const today = todayIn(student.timezone);
      const engine = engineFor(student);
      const state = clone(student.state);
      const day = engine.computeDay(state, today); // cópia: leitura do professor não grava
      const completions = await repo.listCompletions(studentId, 30);
      return {
        ...detail,
        today: { date: today, items: decorate(engine, state, day.items, today) },
        streak: state.streak,
        recent: completions,
      };
    },

    async assertTeaches(professorId, studentId) {
      const student = await repo.getStudentById(studentId);
      if (!student) throw notFound('aluno não encontrado');
      if (!(await repo.teaches(professorId, studentId))) throw forbidden('você não acompanha este aluno');
      return student;
    },
  };
}

module.exports = { createService, itemId };
