'use strict';
/**
 * API fina: autentica, carrega o aluno, delega ao serviço (que chama o engine.js
 * original) e devolve JSON. Nenhuma decisão pedagógica aqui.
 *
 *   POST /api/auth/login            { email, password }
 *   POST /api/auth/refresh          { refresh_token }
 *   POST /api/auth/logout
 *   GET  /api/me
 *   GET  /api/today
 *   POST /api/complete              { itemId, expectedVersion? }
 *   POST /api/extra                 { topicId, minutes }
 *   GET  /api/progress
 *   GET  /api/projection?days=21
 *   PATCH /api/config               { limit?, durations? }
 *   GET  /api/professor/students
 *   POST /api/professor/students          { name, email?, password?, seed?, timezone? }
 *   GET  /api/professor/students/:id
 *   POST /api/professor/students/:id/extra  { topicId, minutes }
 *   POST /api/professor/students/:id/link
 */
const path = require('node:path');
const { createService } = require('./lib/service');
const { createRouter, readJsonBody, sendJson, sendError, serveStatic } = require('./lib/http');
const { badRequest, forbidden, notFound, unauthorized } = require('./lib/errors');
const { DEFAULT_SEED } = require('./engine/seed-kaleu');
const { normalizeSeed } = require('./engine/loader');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp({ repo, auth, allowTodayOverride = false, staticDir = PUBLIC_DIR }) {
  const service = createService({ repo, allowTodayOverride });
  const router = createRouter();

  /* ----------------------------- auth ----------------------------- */

  function bearer(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? m[1].trim() : null;
  }

  async function currentUser(req) {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const user = await auth.verify(token);
    let profile = await repo.getProfile(user.id);
    if (!profile) {
      // usuário existe no Auth mas ainda não tem profile (ex.: trigger não rodou)
      profile = await repo.upsertProfile({
        id: user.id,
        email: user.email,
        full_name: (user.email || '').split('@')[0],
        role: 'aluno',
      });
    }
    return { ...user, role: profile.role, fullName: profile.full_name, token };
  }

  async function requireStudent(req) {
    const user = await currentUser(req);
    const student = await repo.getStudentByUserId(user.id);
    if (!student) throw notFound('nenhum ciclo de estudo vinculado a este usuário');
    return { user, student };
  }

  async function requireProfessor(req) {
    const user = await currentUser(req);
    if (user.role !== 'professor') throw forbidden('área exclusiva do professor');
    return user;
  }

  /* ---------------------------- rotas ----------------------------- */

  router.get('/api/health', async () => ({ ok: true, repo: repo.kind, auth: auth.kind }));

  router.post('/api/auth/login', async ({ body }) => {
    const { email, password } = body;
    if (!email || !password) throw badRequest('e-mail e senha são obrigatórios');
    const session = await auth.signIn(email, password);
    let profile = await repo.getProfile(session.user.id);
    if (!profile) {
      profile = await repo.upsertProfile({
        id: session.user.id,
        email: session.user.email,
        full_name: (session.user.email || '').split('@')[0],
        role: 'aluno',
      });
    }
    const student = await repo.getStudentByUserId(session.user.id);
    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: profile.full_name,
        role: profile.role,
        studentId: student ? student.id : null,
      },
    };
  });

  router.post('/api/auth/refresh', async ({ body }) => {
    if (!body.refresh_token) throw badRequest('refresh_token obrigatório');
    const session = await auth.refreshSession(body.refresh_token);
    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
    };
  });

  router.post('/api/auth/logout', async ({ req }) => {
    const token = bearer(req);
    if (token) await auth.signOut(token);
    return { ok: true };
  });

  router.get('/api/me', async ({ req }) => {
    const user = await currentUser(req);
    const student = await repo.getStudentByUserId(user.id);
    return {
      id: user.id,
      email: user.email,
      name: user.fullName,
      role: user.role,
      student: student
        ? { id: student.id, name: student.name, timezone: student.timezone, version: student.state_version }
        : null,
    };
  });

  router.get('/api/today', async ({ req, query }) => {
    const { student } = await requireStudent(req);
    return service.getToday(student, { today: query.get('today') || undefined });
  });

  router.post('/api/complete', async ({ req, body }) => {
    const { student } = await requireStudent(req);
    if (!body.itemId) throw badRequest('itemId obrigatório');
    return service.complete(student, {
      itemId: body.itemId,
      today: body.today,
      expectedVersion: body.expectedVersion,
    });
  });

  router.post('/api/extra', async ({ req, body }) => {
    const { student } = await requireStudent(req);
    if (!body.topicId) throw badRequest('topicId obrigatório');
    return service.requestExtra(student, { topicId: body.topicId, minutes: body.minutes, today: body.today });
  });

  router.get('/api/progress', async ({ req }) => {
    const { student } = await requireStudent(req);
    return service.progress(student);
  });

  router.get('/api/projection', async ({ req, query }) => {
    const { student } = await requireStudent(req);
    return service.projection(student, {
      days: query.get('days') || 21,
      today: query.get('today') || undefined,
    });
  });

  router.patch('/api/config', async ({ req, body }) => {
    const { student } = await requireStudent(req);
    return service.updateConfig(student, body);
  });

  /* -------------------------- professor --------------------------- */

  router.get('/api/professor/students', async ({ req }) => {
    const prof = await requireProfessor(req);
    return service.professorStudents(prof.id);
  });

  router.get('/api/professor/students/:id', async ({ req, params }) => {
    const prof = await requireProfessor(req);
    return service.professorStudentDetail(prof.id, params.id);
  });

  router.post('/api/professor/students', async ({ req, body }) => {
    const prof = await requireProfessor(req);
    if (!body.name) throw badRequest('nome do aluno é obrigatório');

    let userId = body.userId || null;
    if (!userId && body.email) {
      if (!auth.createUser) throw badRequest('este provedor de auth não cria usuários');
      if (!body.password) throw badRequest('senha inicial obrigatória ao criar o login do aluno');
      const created = await auth.createUser({
        email: body.email,
        password: body.password,
        fullName: body.name,
        role: 'aluno',
      });
      userId = created.id;
      await repo.upsertProfile({ id: userId, email: body.email, full_name: body.name, role: 'aluno' });
    }

    let seed = DEFAULT_SEED;
    if (body.seed) {
      try {
        seed = normalizeSeed(body.seed);
      } catch (err) {
        throw badRequest(`semente inválida: ${err.message}`);
      }
    }
    const student = await service.createCycle({
      userId,
      name: body.name,
      seed,
      timezone: body.timezone || 'America/Boa_Vista',
      startDate: body.startDate,
    });
    await repo.linkProfessor(prof.id, student.id);
    return {
      student: { id: student.id, name: student.name, userId: student.user_id, timezone: student.timezone },
    };
  });

  router.post('/api/professor/students/:id/link', async ({ req, params }) => {
    const prof = await requireProfessor(req);
    const student = await repo.getStudentById(params.id);
    if (!student) throw notFound('aluno não encontrado');
    await repo.linkProfessor(prof.id, params.id);
    return { ok: true };
  });

  router.post('/api/professor/students/:id/extra', async ({ req, params, body }) => {
    const prof = await requireProfessor(req);
    const student = await service.assertTeaches(prof.id, params.id);
    if (!body.topicId) throw badRequest('topicId obrigatório');
    return service.requestExtra(student, { topicId: body.topicId, minutes: body.minutes, today: body.today });
  });

  /* --------------------------- handler ---------------------------- */

  async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname.replace(/\/{2,}/g, '/');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    const route = router.match(req.method, pathname);
    if (route) {
      try {
        const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJsonBody(req) : {};
        const result = await route.handler({ req, res, body, params: route.params, query: url.searchParams });
        if (res.writableEnded) return undefined;
        return sendJson(res, req.method === 'POST' && result && result.created ? 201 : 200, result);
      } catch (err) {
        return sendError(res, err);
      }
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, router.hasPath(pathname) ? 405 : 404, {
        error: 'not_found',
        message: 'rota inexistente',
      });
    }

    if (req.method === 'GET' && staticDir) {
      if (serveStatic(staticDir, pathname, res)) return undefined;
      // SPA-ish: /professor → professor.html, resto → index.html
      const fallback = pathname.startsWith('/professor') ? '/professor.html' : '/index.html';
      if (serveStatic(staticDir, fallback, res)) return undefined;
    }

    return sendJson(res, 404, { error: 'not_found', message: 'não encontrado' });
  }

  function corsHeaders() {
    return {
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
  }

  handler.service = service;
  handler.repo = repo;
  handler.auth = auth;
  return handler;
}

module.exports = { createApp, PUBLIC_DIR };
