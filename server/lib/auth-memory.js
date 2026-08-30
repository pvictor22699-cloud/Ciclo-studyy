'use strict';
/** Auth falso pra teste/dev local: mesma interface do auth-supabase. */
const crypto = require('node:crypto');
const { unauthorized, badRequest } = require('./errors');

function createMemoryAuth() {
  const users = new Map();   // email -> { id, email, password }
  const tokens = new Map();  // access_token -> userId
  const refresh = new Map(); // refresh_token -> userId

  function issue(userId) {
    const access_token = crypto.randomUUID();
    const refresh_token = crypto.randomUUID();
    tokens.set(access_token, userId);
    refresh.set(refresh_token, userId);
    return { access_token, refresh_token, expires_in: 3600, token_type: 'bearer' };
  }

  return {
    kind: 'memory',

    async createUser({ email, password, fullName }) {
      const key = String(email).toLowerCase();
      if (users.has(key)) throw badRequest('e-mail já cadastrado');
      const user = { id: crypto.randomUUID(), email: key, password, fullName: fullName || key.split('@')[0] };
      users.set(key, user);
      return { id: user.id, email: user.email, fullName: user.fullName };
    },

    async signIn(email, password) {
      const user = users.get(String(email).toLowerCase());
      if (!user || user.password !== password) throw unauthorized('e-mail ou senha inválidos');
      return { ...issue(user.id), user: { id: user.id, email: user.email } };
    },

    async refreshSession(refresh_token) {
      const userId = refresh.get(refresh_token);
      if (!userId) throw unauthorized('sessão expirada');
      refresh.delete(refresh_token);
      const email = [...users.values()].find((u) => u.id === userId)?.email;
      return { ...issue(userId), user: { id: userId, email } };
    },

    async verify(accessToken) {
      const userId = tokens.get(accessToken);
      if (!userId) throw unauthorized('token inválido');
      const user = [...users.values()].find((u) => u.id === userId);
      return { id: userId, email: user ? user.email : null };
    },

    async signOut(accessToken) {
      tokens.delete(accessToken);
      return true;
    },
  };
}

module.exports = { createMemoryAuth };
