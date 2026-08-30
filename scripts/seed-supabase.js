#!/usr/bin/env node
'use strict';
/**
 * Cria o professor e um aluno no Supabase já configurado.
 *
 *   node scripts/seed-supabase.js \
 *     --professor victor@exemplo.com --professor-senha "..." \
 *     --aluno kaleu@exemplo.com --aluno-senha "..." --nome Kaleu
 *
 * Precisa de SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY no
 * ambiente (ou num .env carregado pelo seu shell). Rode UMA vez, depois de
 * aplicar supabase/migrations/0001_init.sql.
 *
 * Pra usar a lista real de tópicos, passe --seed caminho/para/seed.json com
 * { "subjects": [...], "subjectQueue": [...], "topicsSeed": [...] }.
 */
const fs = require('node:fs');
const { loadConfig } = require('../server/config');
const { createSupabaseRepo } = require('../server/lib/repo-supabase');
const { createSupabaseAuth } = require('../server/lib/auth-supabase');
const { createService } = require('../server/lib/service');
const { DEFAULT_SEED } = require('../server/engine/seed-kaleu');

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) continue;
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

async function main() {
  const a = args();
  const config = loadConfig({ ...process.env, BACKEND: 'supabase' });
  const repo = createSupabaseRepo(config.supabase);
  const auth = createSupabaseAuth(config.supabase);
  const service = createService({ repo, allowTodayOverride: false });

  const seed = a.seed ? JSON.parse(fs.readFileSync(a.seed, 'utf8')) : DEFAULT_SEED;

  if (!a.professor || !a['professor-senha']) throw new Error('--professor e --professor-senha são obrigatórios');
  if (!a.aluno || !a['aluno-senha']) throw new Error('--aluno e --aluno-senha são obrigatórios');

  const prof = await auth.createUser({
    email: a.professor,
    password: a['professor-senha'],
    fullName: a['professor-nome'] || 'Professor',
    role: 'professor',
  });
  await repo.upsertProfile({
    id: prof.id,
    email: a.professor,
    full_name: a['professor-nome'] || 'Professor',
    role: 'professor',
  });
  console.log('professor criado:', prof.id);

  const aluno = await auth.createUser({
    email: a.aluno,
    password: a['aluno-senha'],
    fullName: a.nome || 'Aluno',
    role: 'aluno',
  });
  await repo.upsertProfile({ id: aluno.id, email: a.aluno, full_name: a.nome || 'Aluno', role: 'aluno' });

  const student = await service.createCycle({
    userId: aluno.id,
    name: a.nome || 'Aluno',
    seed,
    timezone: a.fuso || 'America/Boa_Vista',
  });
  await repo.linkProfessor(prof.id, student.id);

  console.log('aluno criado:', aluno.id, '· ciclo:', student.id);
  console.log('pronto — entre em / com o login do aluno e em /professor.html com o do professor');
}

main().catch((err) => {
  console.error('falhou:', err.message);
  process.exit(1);
});
