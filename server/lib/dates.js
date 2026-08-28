'use strict';

/**
 * "Hoje" no fuso do aluno (o motor trabalha com datas locais ISO, YYYY-MM-DD).
 * Roraima não tem horário de verão, mas guardamos o fuso por aluno mesmo assim.
 */
function todayIn(timezone = 'America/Boa_Vista', now = new Date()) {
  try {
    // en-CA formata como YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(now);
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (s) => typeof s === 'string' && ISO_DATE.test(s);

module.exports = { todayIn, isIsoDate };
