/* Cliente da API. O que fica no navegador é só o token da sessão — o state
   do ciclo mora no banco. */
(function (root, factory) {
  const API = factory();
  if (typeof module !== 'undefined') module.exports = API;
  if (typeof window !== 'undefined') window.API = API;
})(this, function () {
  const KEY = 'ciclo_sessao';

  function carregarSessao() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {
      return null;
    }
  }
  function salvarSessao(s) {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  }

  let sessao = typeof localStorage !== 'undefined' ? carregarSessao() : null;

  class ApiError extends Error {
    constructor(status, body) {
      super((body && body.message) || `Erro ${status}`);
      this.status = status;
      this.code = body && body.error;
      this.currentVersion = body && body.currentVersion;
    }
  }

  async function raw(method, path, body, token) {
    const res = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const texto = await res.text();
    const dados = texto ? JSON.parse(texto) : null;
    if (!res.ok) throw new ApiError(res.status, dados);
    return dados;
  }

  /** Chama a API autenticada; se o token expirou, tenta um refresh e repete. */
  async function call(method, path, body) {
    if (!sessao) throw new ApiError(401, { message: 'sessão não iniciada' });
    try {
      return await raw(method, path, body, sessao.access_token);
    } catch (err) {
      if (err.status !== 401 || !sessao.refresh_token) throw err;
      const novo = await raw('POST', '/api/auth/refresh', { refresh_token: sessao.refresh_token });
      sessao = { ...sessao, access_token: novo.access_token, refresh_token: novo.refresh_token };
      salvarSessao(sessao);
      return raw(method, path, body, sessao.access_token);
    }
  }

  return {
    ApiError,
    get sessao() {
      return sessao;
    },
    usuario() {
      return sessao ? sessao.user : null;
    },
    async login(email, password) {
      const s = await raw('POST', '/api/auth/login', { email, password });
      sessao = s;
      salvarSessao(s);
      return s;
    },
    async logout() {
      try {
        if (sessao) await call('POST', '/api/auth/logout');
      } catch {
        /* ignora */
      }
      sessao = null;
      salvarSessao(null);
    },
    me: () => call('GET', '/api/me'),
    hoje: (today) => call('GET', `/api/today${today ? `?today=${today}` : ''}`),
    concluir: (itemId, expectedVersion, today) =>
      call('POST', '/api/complete', { itemId, expectedVersion, today }),
    pedirExtra: (topicId, minutes, today) => call('POST', '/api/extra', { topicId, minutes, today }),
    progresso: () => call('GET', '/api/progress'),
    projecao: (days, today) =>
      call('GET', `/api/projection?days=${days}${today ? `&today=${today}` : ''}`),
    salvarConfig: (patch) => call('PATCH', '/api/config', patch),
    alunos: () => call('GET', '/api/professor/students'),
    aluno: (id) => call('GET', `/api/professor/students/${id}`),
    criarAluno: (dados) => call('POST', '/api/professor/students', dados),
    extraDoAluno: (id, topicId, minutes) =>
      call('POST', `/api/professor/students/${id}/extra`, { topicId, minutes }),
  };
});
