'use strict';
/**
 * Headers HTTP só aceitam bytes (ASCII/Latin-1). Uma chave copiada da tela do
 * Supabase com a máscara ("sb_publi••••••") vira um TypeError cru do fetch:
 *
 *   Cannot convert argument to a ByteString because the character at index 8
 *   has a value of 8226 which is greater than 255
 *
 * Estas funções transformam isso numa mensagem que diz QUAL variável está
 * errada e por quê, antes de a requisição sair.
 */

const MASCARAS = new Set([
  0x2022, // • bullet
  0x2023, // ‣
  0x25cf, // ●
  0x25cb, // ○
  0x00b7, // ·
  0x2219, // ∙
  0x2026, // … (valor truncado com reticências)
  0x2217, // ∗
]);

/** Primeiro caractere que não cabe num header, ou null se estiver tudo certo. */
function primeiroInvalido(valor) {
  const s = String(valor);
  for (let i = 0; i < s.length; i++) {
    const code = s.codePointAt(i);
    // aceita ASCII imprimível; recusa controle, acento, emoji, máscara…
    if (code < 0x20 || code > 0x7e) {
      return { index: i, char: s[i], code, mascara: MASCARAS.has(code) };
    }
  }
  return null;
}

const ehSeguro = (valor) => primeiroInvalido(valor) === null;

/** Mensagem pronta pra quem for corrigir a variável, ou null se estiver ok. */
function problemaNaChave(nome, valor) {
  if (valor === undefined || valor === null || valor === '') {
    return `${nome} está vazia.`;
  }
  const s = String(valor);
  if (s !== s.trim()) {
    return `${nome} tem espaço ou quebra de linha nas pontas — recadastre a variável sem espaços.`;
  }
  const ruim = primeiroInvalido(s);
  if (!ruim) return null;
  const hex = `U+${ruim.code.toString(16).toUpperCase().padStart(4, '0')}`;
  if (ruim.mascara) {
    return (
      `${nome} tem "${ruim.char}" (${hex}) na posição ${ruim.index}: ` +
      'o valor foi copiado com a máscara da tela em vez da chave real. ' +
      'Use o botão de copiar do painel do Supabase (Settings → API) e recadastre a variável.'
    );
  }
  return (
    `${nome} tem o caractere "${ruim.char}" (${hex}) na posição ${ruim.index}, ` +
    'que não é aceito num header HTTP. Recadastre a variável com o valor exato da chave.'
  );
}

module.exports = { primeiroInvalido, ehSeguro, problemaNaChave };
