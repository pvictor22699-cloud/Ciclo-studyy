'use strict';
/** Monta o app com o backend escolhido (supabase | memory). */
const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { createMemoryRepo } = require('./lib/repo-memory');
const { createMemoryAuth } = require('./lib/auth-memory');
const { createSupabaseRepo } = require('./lib/repo-supabase');
const { createSupabaseAuth } = require('./lib/auth-supabase');
const { createService } = require('./lib/service');
const { DEFAULT_SEED } = require('./engine/seed-kaleu');

function buildBackend(config) {
  if (config.backend === 'supabase') {
    return {
      repo: createSupabaseRepo(config.supabase),
      auth: createSupabaseAuth(config.supabase),
    };
  }
  return { repo: createMemoryRepo(), auth: createMemoryAuth() };
}

/** Popula o backend em memória com um professor e um aluno pra rodar o app local. */
async function seedDemo({ repo, auth, config }) {
  const service = createService({ repo, allowTodayOverride: true });

  const prof = await auth.createUser({
    email: config.demo.professorEmail,
    password: config.demo.professorPassword,
    fullName: 'Victor (professor)',
  });
  await repo.upsertProfile({ id: prof.id, email: prof.email, full_name: 'Victor', role: 'professor' });

  const aluno = await auth.createUser({
    email: config.demo.studentEmail,
    password: config.demo.studentPassword,
    fullName: 'Kaleu',
  });
  await repo.upsertProfile({ id: aluno.id, email: aluno.email, full_name: 'Kaleu', role: 'aluno' });

  const student = await service.createCycle({ userId: aluno.id, name: 'Kaleu', seed: DEFAULT_SEED });
  await repo.linkProfessor(prof.id, student.id);
  return { prof, aluno, student };
}

async function buildApp(env = process.env) {
  const config = loadConfig(env);
  const { repo, auth } = buildBackend(config);
  if (config.backend === 'memory') await seedDemo({ repo, auth, config });
  const app = createApp({ repo, auth, allowTodayOverride: config.allowTodayOverride });
  app.config = config;
  return app;
}

module.exports = { buildApp, buildBackend, seedDemo };
