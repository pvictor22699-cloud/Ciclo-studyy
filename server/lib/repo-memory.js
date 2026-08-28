'use strict';
/**
 * Repositório em memória — usado pelos testes e pelo `npm run dev:memory`
 * (dá pra rodar o app inteiro sem Supabase). Mesma interface do repo-supabase.
 */
const crypto = require('node:crypto');
const { conflict, notFound } = require('./errors');

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function createMemoryRepo() {
  const profiles = new Map();          // userId -> profile
  const students = new Map();          // id -> student
  const links = new Set();             // `${professorId}|${studentId}`
  const snapshots = [];
  const completions = [];

  return {
    kind: 'memory',

    async upsertProfile(profile) {
      profiles.set(profile.id, { role: 'aluno', ...profile });
      return clone(profiles.get(profile.id));
    },

    async getProfile(userId) {
      return clone(profiles.get(userId)) ?? null;
    },

    async createStudent({ userId = null, name, kind = 'kaleu', timezone = 'America/Boa_Vista', seed, state }) {
      const row = {
        id: crypto.randomUUID(),
        user_id: userId,
        name,
        kind,
        timezone,
        seed: clone(seed),
        state: clone(state),
        state_version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      students.set(row.id, row);
      return clone(row);
    },

    async getStudentById(id) {
      return clone(students.get(id)) ?? null;
    },

    async getStudentByUserId(userId) {
      for (const s of students.values()) if (s.user_id === userId) return clone(s);
      return null;
    },

    async linkProfessor(professorId, studentId) {
      if (!students.has(studentId)) throw notFound('aluno não encontrado');
      links.add(`${professorId}|${studentId}`);
      return true;
    },

    async unlinkProfessor(professorId, studentId) {
      return links.delete(`${professorId}|${studentId}`);
    },

    async teaches(professorId, studentId) {
      return links.has(`${professorId}|${studentId}`);
    },

    async listStudentsForProfessor(professorId) {
      const out = [];
      for (const key of links) {
        const [prof, studentId] = key.split('|');
        if (prof !== professorId) continue;
        const s = students.get(studentId);
        if (s) out.push(clone(s));
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      return out;
    },

    /**
     * Grava o state com concorrência otimista.
     * expectedVersion = versão que o chamador leu. Se alguém gravou no meio, 409.
     */
    async saveState(studentId, { state, expectedVersion, reason = 'update', completions: rows = [] }) {
      const row = students.get(studentId);
      if (!row) throw notFound('aluno não encontrado');
      if (expectedVersion != null && row.state_version !== expectedVersion) {
        throw conflict('o estado mudou em outro dispositivo — recarregue', {
          currentVersion: row.state_version,
        });
      }
      snapshots.push({
        id: snapshots.length + 1,
        student_id: studentId,
        state_version: row.state_version,
        reason,
        state: clone(row.state),
        created_at: new Date().toISOString(),
      });
      row.state = clone(state);
      row.state_version += 1;
      row.updated_at = new Date().toISOString();
      for (const c of rows) {
        completions.push({ id: completions.length + 1, student_id: studentId, ...clone(c) });
      }
      return { state_version: row.state_version };
    },

    async updateStudent(studentId, patch) {
      const row = students.get(studentId);
      if (!row) throw notFound('aluno não encontrado');
      Object.assign(row, clone(patch), { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async listCompletions(studentId, limit = 50) {
      return completions
        .filter((c) => c.student_id === studentId)
        .slice(-limit)
        .reverse()
        .map(clone);
    },

    async listSnapshots(studentId, limit = 10) {
      return snapshots
        .filter((s) => s.student_id === studentId)
        .slice(-limit)
        .reverse()
        .map(clone);
    },

    // atalhos usados só em teste/dev
    _debug: { profiles, students, links, snapshots, completions },
  };
}

module.exports = { createMemoryRepo };
