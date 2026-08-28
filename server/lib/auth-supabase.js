'use strict';
/**
 * Supabase Auth (GoTrue) via REST.
 * O login vai pela API (o front nunca vê a service_role): trocamos e-mail/senha
 * por access_token + refresh_token e devolvemos ao cliente.
 */
const { HttpError, unauthorized } = require('./errors');

function createSupabaseAuth({ url, anonKey, serviceKey }) {
  const base = String(url).replace(/\/$/, '');
  const cache = new Map(); // access_token -> { user, exp }
  const TTL_MS = 60_000;

  async function call(path, { method = 'POST', body, token, key } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        apikey: key || anonKey,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = (data && (data.error_description || data.msg || data.message)) || `Auth ${res.status}`;
      throw new HttpError(res.status === 400 || res.status === 401 ? 401 : res.status, 'auth_error', msg);
    }
    return data;
  }

  return {
    kind: 'supabase',

    /** Só usado por scripts administrativos (criar aluno/professor). */
    async createUser({ email, password, fullName, role = 'aluno' }) {
      const data = await call('/auth/v1/admin/users', {
        body: {
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName || String(email).split('@')[0], role },
        },
        key: serviceKey,
        token: serviceKey,
      });
      return { id: data.id, email: data.email, fullName };
    },

    async signIn(email, password) {
      const data = await call('/auth/v1/token?grant_type=password', { body: { email, password } });
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        token_type: data.token_type,
        user: { id: data.user.id, email: data.user.email },
      };
    },

    async refreshSession(refresh_token) {
      const data = await call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token } });
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        token_type: data.token_type,
        user: { id: data.user.id, email: data.user.email },
      };
    },

    async verify(accessToken) {
      if (!accessToken) throw unauthorized();
      const hit = cache.get(accessToken);
      if (hit && hit.exp > Date.now()) return hit.user;
      let data;
      try {
        data = await call('/auth/v1/user', { method: 'GET', token: accessToken });
      } catch (err) {
        cache.delete(accessToken);
        throw unauthorized('token inválido ou expirado');
      }
      const user = { id: data.id, email: data.email };
      cache.set(accessToken, { user, exp: Date.now() + TTL_MS });
      return user;
    },

    async signOut(accessToken) {
      cache.delete(accessToken);
      try {
        await call('/auth/v1/logout', { token: accessToken });
      } catch {
        /* logout é best-effort */
      }
      return true;
    },
  };
}

module.exports = { createSupabaseAuth };
