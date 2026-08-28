'use strict';
/** Repositório real: Supabase (Postgres via PostgREST), com service_role. */
const { createRest } = require('./supabase-rest');
const { conflict, notFound } = require('./errors');

function createSupabaseRepo({ url, serviceKey }) {
  const rest = createRest({ url, serviceKey });
  const one = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : null);

  return {
    kind: 'supabase',
    rest,

    async upsertProfile(profile) {
      return one(await rest.from('profiles').upsert([profile]));
    },

    async getProfile(userId) {
      return one(await rest.from('profiles').select(`id=eq.${userId}&select=*`));
    },

    async createStudent({ userId = null, name, kind = 'kaleu', timezone = 'America/Boa_Vista', seed, state }) {
      return one(
        await rest.from('students').insert([
          { user_id: userId, name, kind, timezone, seed, state, state_version: 1 },
        ]),
      );
    },

    async getStudentById(id) {
      return one(await rest.from('students').select(`id=eq.${id}&select=*`));
    },

    async getStudentByUserId(userId) {
      return one(await rest.from('students').select(`user_id=eq.${userId}&select=*`));
    },

    async linkProfessor(professorId, studentId) {
      await rest.from('professor_students').upsert([
        { professor_id: professorId, student_id: studentId },
      ]);
      return true;
    },

    async unlinkProfessor(professorId, studentId) {
      await rest
        .from('professor_students')
        .remove(`professor_id=eq.${professorId}&student_id=eq.${studentId}`);
      return true;
    },

    async teaches(professorId, studentId) {
      const rows = await rest
        .from('professor_students')
        .select(`professor_id=eq.${professorId}&student_id=eq.${studentId}&select=student_id`);
      return Array.isArray(rows) && rows.length > 0;
    },

    async listStudentsForProfessor(professorId) {
      const links = await rest
        .from('professor_students')
        .select(`professor_id=eq.${professorId}&select=student_id`);
      const ids = (links || []).map((l) => l.student_id);
      if (!ids.length) return [];
      const inList = `(${ids.join(',')})`;
      const rows = await rest.from('students').select(`id=in.${inList}&select=*&order=name.asc`);
      return rows || [];
    },

    /** Gravação com concorrência otimista: o UPDATE filtra pela versão lida. */
    async saveState(studentId, { state, expectedVersion, reason = 'update', completions = [] }) {
      const current = await this.getStudentById(studentId);
      if (!current) throw notFound('aluno não encontrado');
      if (expectedVersion != null && current.state_version !== expectedVersion) {
        throw conflict('o estado mudou em outro dispositivo — recarregue', {
          currentVersion: current.state_version,
        });
      }

      // snapshot do estado ANTERIOR antes de sobrescrever
      await rest.from('state_snapshots').insert(
        [{ student_id: studentId, state_version: current.state_version, reason, state: current.state }],
        { returning: false },
      );

      const updated = await rest
        .from('students')
        .update(`id=eq.${studentId}&state_version=eq.${current.state_version}`, {
          state,
          state_version: current.state_version + 1,
        });

      if (!Array.isArray(updated) || !updated.length) {
        const fresh = await this.getStudentById(studentId);
        throw conflict('o estado mudou em outro dispositivo — recarregue', {
          currentVersion: fresh ? fresh.state_version : null,
        });
      }

      if (completions.length) {
        await rest
          .from('completions')
          .insert(completions.map((c) => ({ student_id: studentId, ...c })), { returning: false });
      }

      return { state_version: updated[0].state_version };
    },

    async updateStudent(studentId, patch) {
      return one(await rest.from('students').update(`id=eq.${studentId}`, patch));
    },

    async listCompletions(studentId, limit = 50) {
      return (
        (await rest
          .from('completions')
          .select(`student_id=eq.${studentId}&select=*&order=done_on.desc,id.desc&limit=${limit}`)) || []
      );
    },

    async listSnapshots(studentId, limit = 10) {
      return (
        (await rest
          .from('state_snapshots')
          .select(`student_id=eq.${studentId}&select=id,state_version,reason,created_at&order=id.desc&limit=${limit}`)) ||
        []
      );
    },
  };
}

module.exports = { createSupabaseRepo };
