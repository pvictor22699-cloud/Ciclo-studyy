'use strict';
/**
 * Testes de interface (Playwright, opcional).
 *
 *   npm i -D playwright && npx playwright install chromium
 *   npm run test:e2e
 *
 * Sem o playwright instalado, o arquivo se declara "skipped" e o `npm test`
 * continua verde — a suíte principal (node --test tests/) não depende dele.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  /* playwright ausente */
}

const { startServer, completeAllToday } = require('../helpers');

const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

async function abrirNavegador() {
  return chromium.launch({ executablePath, args: ['--no-sandbox'] });
}

test('interface do aluno e painel do professor', { skip: !chromium && 'playwright não instalado' }, async (t) => {
  const ctx = await startServer();
  const browser = await abrirNavegador();
  t.after(async () => {
    await browser.close();
    await ctx.close();
  });

  await t.test('aluno: login → dia → concluir meta', async () => {
    const page = await browser.newPage();
    await page.goto(`${ctx.base}/`);

    await page.fill('#email', 'kaleu@teste.local');
    await page.fill('#senha', 'errada');
    await page.click('#btnEntrar');
    await page.waitForSelector('#loginMsg.on');
    assert.match(await page.textContent('#loginMsg'), /senha|inválid/i);

    await page.fill('#senha', 'kaleu123');
    await page.click('#btnEntrar');
    await page.waitForSelector('#app .mc');

    const metas = await page.$$('#hojeLista .mc');
    assert.ok(metas.length > 0, 'o dia veio da API');
    const antes = await page.textContent('#hojeSub');

    await metas[0].click();
    await page.waitForSelector('#hojeLista .mc.done');
    const feitas = await page.$$('#hojeLista .mc.done');
    assert.equal(feitas.length, 1);
    assert.notEqual(await page.textContent('#hojeSub'), antes, 'o resumo do dia se atualiza');

    // a conclusão está no banco: recarregar a página mantém o estado
    await page.reload();
    await page.waitForSelector('#hojeLista .mc.done');
    assert.equal((await page.$$('#hojeLista .mc.done')).length, 1);

    // e outro dispositivo (contexto novo, mesmo login) vê o mesmo
    const outro = await browser.newContext();
    const page2 = await outro.newPage();
    await page2.goto(`${ctx.base}/`);
    await page2.fill('#email', 'kaleu@teste.local');
    await page2.fill('#senha', 'kaleu123');
    await page2.click('#btnEntrar');
    await page2.waitForSelector('#hojeLista .mc.done');
    assert.equal((await page2.$$('#hojeLista .mc.done')).length, 1);
    await outro.close();

    await page.close();
  });

  await t.test('aluno: abas de progresso e próximos dias', async () => {
    const page = await browser.newPage();
    await page.goto(`${ctx.base}/`);
    await page.fill('#email', 'kaleu@teste.local');
    await page.fill('#senha', 'kaleu123');
    await page.click('#btnEntrar');
    await page.waitForSelector('#app .mc');

    await page.click('.ntab[data-tela="progresso"]');
    await page.waitForSelector('#progMaterias .prog-materia');
    assert.equal((await page.$$('#progMaterias .prog-materia')).length, 4);
    await page.click('#progTopicos .mat-hdr');
    await page.waitForSelector('#progTopicos .mat-blk.open .tr');

    await page.click('.ntab[data-tela="agenda"]');
    await page.waitForSelector('#agendaLista .proj-dia');
    assert.ok((await page.$$('#agendaLista .proj-dia')).length > 0);

    await page.click('.ntab[data-tela="ajustes"]');
    await page.fill('#limite', '5');
    await page.click('#btnSalvarConfig');
    await page.waitForSelector('#ajustesMsg.ok.on');
    assert.match(await page.textContent('#ajustesMsg'), /5h/);

    await page.close();
  });

  await t.test('professor: lista de alunos com % e detalhe', async () => {
    // o aluno fecha o dia pra ter progresso visível
    const aluno = await ctx.login('aluno');
    const hoje = (await ctx.call('GET', '/api/today', { token: aluno.access_token })).body.date;
    await completeAllToday(ctx, aluno.access_token, hoje);

    const page = await browser.newPage();
    await page.goto(`${ctx.base}/professor.html`);
    await page.fill('#email', 'victor@teste.local');
    await page.fill('#senha', 'prof123');
    await page.click('#btnEntrar');
    await page.waitForSelector('#alunosLista .al');

    const cards = await page.$$('#alunosLista .al');
    assert.equal(cards.length, 1, 'só o aluno vinculado aparece');
    const texto = await cards[0].textContent();
    assert.match(texto, /Kaleu/);
    assert.match(texto, /%/);
    const pct = Number((await page.textContent('#alunosLista .al-pct')).replace('%', ''));
    assert.ok(pct > 0, 'o painel mostra progresso real do aluno');

    await cards[0].click();
    await page.waitForSelector('#tela-detalhe.on');
    assert.match(await page.textContent('#detNome'), /Kaleu/);
    assert.ok((await page.$$('#detMaterias .prog-materia')).length === 4);
    assert.ok((await page.$$('#detRecentes div')).length > 0, 'histórico de conclusões');

    await page.close();
  });

  await t.test('professor: aluno comum não abre o painel', async () => {
    const page = await browser.newPage();
    await page.goto(`${ctx.base}/professor.html`);
    await page.fill('#email', 'kaleu@teste.local');
    await page.fill('#senha', 'kaleu123');
    await page.click('#btnEntrar');
    await page.waitForSelector('#loginMsg.on');
    assert.match(await page.textContent('#loginMsg'), /professor/i);
    await page.close();
  });
});
