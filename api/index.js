'use strict';
/**
 * Adaptador serverless (Vercel) — reaproveita o mesmo handler do server/app.js.
 *
 * Roteamento: o vercel.json reescreve /api/(.*) para /api?__path=$1, que é a
 * rota deste arquivo (api/index.js). Um único ponto de entrada, sem depender de
 * arquivo com colchetes no nome nem de rota dinâmica de vários segmentos.
 *
 * O router do app trabalha com o caminho ORIGINAL (/api/auth/login), então
 * remontamos ele a partir de __path antes de entregar. Se a Vercel já tiver
 * preservado o caminho (não há __path), passa direto.
 *
 * O front (public/) é servido pela camada estática — esta função só vê /api/*.
 */
const { buildApp } = require('../server/factory');

let appPromise;

/** Devolve o caminho original da requisição a partir do rewrite. */
function restaurarCaminho(url) {
  const u = new URL(url, 'http://interno');
  const p = u.searchParams.get('__path');
  if (p === null) return url;            // sem rewrite: caminho já veio inteiro
  u.searchParams.delete('__path');
  const qs = u.searchParams.toString();
  return `/api/${p.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
}

module.exports = async (req, res) => {
  appPromise = appPromise || buildApp();
  const app = await appPromise;
  req.url = restaurarCaminho(req.url || '/');
  return app(req, res);
};

module.exports.restaurarCaminho = restaurarCaminho;
