'use strict';
/** Adaptador serverless (Vercel): reaproveita o mesmo handler do server/app.js. */
const { buildApp } = require('../server/factory');

let appPromise;

module.exports = async (req, res) => {
  appPromise = appPromise || buildApp();
  const app = await appPromise;
  return app(req, res);
};
