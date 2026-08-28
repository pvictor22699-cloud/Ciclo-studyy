'use strict';

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}

const badRequest = (msg, extra) => new HttpError(400, 'bad_request', msg, extra);
const unauthorized = (msg = 'não autenticado') => new HttpError(401, 'unauthorized', msg);
const forbidden = (msg = 'sem permissão') => new HttpError(403, 'forbidden', msg);
const notFound = (msg = 'não encontrado') => new HttpError(404, 'not_found', msg);
const conflict = (msg, extra) => new HttpError(409, 'conflict', msg, extra);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict };
