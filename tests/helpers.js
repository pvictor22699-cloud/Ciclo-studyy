'use strict';
/** Sobe a API com backend em memória e devolve um cliente HTTP simples. */
const http = require('node:http');
const { createApp } = require('../server/app');
const { createMemoryRepo } = require('../server/lib/repo-memory');
const { createMemoryAuth } = require('../server/lib/auth-memory');
const { createService } = require('../server/lib/service');
const { DEFAULT_SEED } = require('../server/engine/seed-kaleu');

const CRED = {
  aluno: { email: 'kaleu@teste.local', password: 'kaleu123' },
  aluno2: { email: 'outro@teste.local', password: 'outro123' },
  professor: { email: 'victor@teste.local', password: 'prof123' },
};

async function startServer({ seed = DEFAULT_SEED, allowTodayOverride = true } = {}) {
  const repo = createMemoryRepo();
  const auth = createMemoryAuth();
  const service = createService({ repo, allowTodayOverride });

  const profUser = await auth.createUser({ ...CRED.professor, fullName: 'Victor' });
  await repo.upsertProfile({ id: profUser.id, email: profUser.email, full_name: 'Victor', role: 'professor' });

  const alunoUser = await auth.createUser({ ...CRED.aluno, fullName: 'Kaleu' });
  await repo.upsertProfile({ id: alunoUser.id, email: alunoUser.email, full_name: 'Kaleu', role: 'aluno' });

  const aluno2User = await auth.createUser({ ...CRED.aluno2, fullName: 'Outro Aluno' });
  await repo.upsertProfile({ id: aluno2User.id, email: aluno2User.email, full_name: 'Outro Aluno', role: 'aluno' });

  const student = await service.createCycle({ userId: alunoUser.id, name: 'Kaleu', seed, startDate: '2026-01-05' });
  const student2 = await service.createCycle({
    userId: aluno2User.id,
    name: 'Outro Aluno',
    seed,
    startDate: '2026-01-05',
  });
  await repo.linkProfessor(profUser.id, student.id); // student2 fica SEM vínculo de propósito

  const app = createApp({ repo, auth, allowTodayOverride });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { body, token } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async function login(who) {
    const res = await call('POST', '/api/auth/login', { body: CRED[who] });
    if (res.status !== 200) throw new Error(`login falhou: ${JSON.stringify(res.body)}`);
    return res.body;
  }

  return {
    base,
    repo,
    auth,
    service,
    server,
    users: { professor: profUser, aluno: alunoUser, aluno2: aluno2User },
    students: { aluno: student, aluno2: student2 },
    call,
    login,
    async close() {
      await new Promise((r) => server.close(r));
    },
  };
}

/** Roda um dia inteiro: pega /today e conclui tudo. Devolve o último payload. */
async function completeAllToday(ctx, token, today) {
  let day = (await ctx.call('GET', `/api/today?today=${today}`, { token })).body;
  for (const item of day.items) {
    const res = await ctx.call('POST', '/api/complete', {
      token,
      body: { itemId: item.id, today, expectedVersion: day.version },
    });
    if (res.status !== 200) throw new Error(`falha ao concluir ${item.id}: ${JSON.stringify(res.body)}`);
    day = res.body;
  }
  return day;
}

module.exports = { startServer, completeAllToday, CRED };
