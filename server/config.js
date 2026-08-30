'use strict';
const { problemaNaChave } = require('./lib/header-safe');

function loadConfig(env = process.env) {
  const hasSupabase = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_ANON_KEY);
  const backend = env.BACKEND || (hasSupabase ? 'supabase' : 'memory');
  if (backend === 'supabase' && !hasSupabase) {
    throw new Error(
      'BACKEND=supabase exige SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  // Chaves com máscara/acento viram TypeError cru lá no fetch. Detectamos aqui
  // pra dizer QUAL variável está errada (e /api/health mostra isso).
  const problems = [];
  if (backend === 'supabase') {
    for (const [nome, valor] of [
      ['SUPABASE_URL', env.SUPABASE_URL],
      ['SUPABASE_ANON_KEY', env.SUPABASE_ANON_KEY],
      ['SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY],
    ]) {
      const problema = problemaNaChave(nome, valor);
      if (problema) problems.push(problema);
    }
  }

  return {
    backend,
    problems,
    port: Number(env.PORT || 3000),
    supabase: {
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
    // override de "hoje" (?today=YYYY-MM-DD) — ligado fora de produção pra testar
    allowTodayOverride: env.ALLOW_TODAY_OVERRIDE
      ? env.ALLOW_TODAY_OVERRIDE === 'true'
      : backend === 'memory',
    demo: {
      professorEmail: env.DEMO_PROFESSOR_EMAIL || 'professor@ciclo.local',
      professorPassword: env.DEMO_PROFESSOR_PASSWORD || 'professor123',
      studentEmail: env.DEMO_STUDENT_EMAIL || 'kaleu@ciclo.local',
      studentPassword: env.DEMO_STUDENT_PASSWORD || 'kaleu123',
    },
  };
}

module.exports = { loadConfig };
