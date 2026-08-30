'use strict';
/**
 * Cliente mínimo de PostgREST/GoTrue via fetch — sem dependências.
 * Evita puxar @supabase/supabase-js só pra fazer 6 chamadas HTTP.
 */
const { HttpError } = require('./errors');

function createRest({ url, serviceKey }) {
  const base = String(url).replace(/\/$/, '');

  async function request(path, { method = 'GET', body, headers = {}, prefer } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      throw new HttpError(
        res.status >= 500 ? 502 : res.status,
        'supabase_error',
        (data && (data.message || data.error_description || data.error)) || `Supabase ${res.status}`,
        { details: data },
      );
    }
    return data;
  }

  return {
    base,
    request,
    from(table) {
      return {
        select: (query = 'select=*') => request(`/rest/v1/${table}?${query}`),
        insert: (rows, { returning = true } = {}) =>
          request(`/rest/v1/${table}`, {
            method: 'POST',
            body: rows,
            prefer: returning ? 'return=representation' : 'return=minimal,resolution=merge-duplicates',
          }),
        upsert: (rows) =>
          request(`/rest/v1/${table}`, {
            method: 'POST',
            body: rows,
            prefer: 'return=representation,resolution=merge-duplicates',
          }),
        update: (query, patch) =>
          request(`/rest/v1/${table}?${query}`, {
            method: 'PATCH',
            body: patch,
            prefer: 'return=representation',
          }),
        remove: (query) => request(`/rest/v1/${table}?${query}`, { method: 'DELETE' }),
      };
    },
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

module.exports = { createRest };
