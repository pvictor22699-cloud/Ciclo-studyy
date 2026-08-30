'use strict';
/**
 * Adaptador serverless (Vercel) — reaproveita o mesmo handler do server/app.js.
 *
 * O nome do arquivo é uma rota catch-all: `api/[...path].js` atende TODOS os
 * caminhos sob /api/*, sem precisar de rewrite. O `req.url` chega com o caminho
 * original (/api/today, /api/complete, ...), que é exatamente o que o router
 * do app espera.
 *
 * O front (public/) é servido pela camada estática da Vercel — esta função só
 * recebe /api/*.
 */
const { buildApp } = require('../server/factory');

let appPromise;

module.exports = async (req, res) => {
  appPromise = appPromise || buildApp();
  const app = await appPromise;
  return app(req, res);
};
