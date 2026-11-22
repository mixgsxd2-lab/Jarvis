// Verificação dos botões principais em navegador real (Chromium + Playwright).
// Uso: node tests/e2e/ui.test.mjs   (sobe o servidor de teste sozinho)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5055;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS_DIR || '';

const server = spawn('python3', [path.join(here, 'serve.py'), String(PORT)], { stdio: ['ignore', 'ignore', 'pipe'] });
let serverLog = '';
server.stderr.on('data', (d) => { serverLog += d; });

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) return; } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('servidor não subiu\n' + serverLog);
}
const results = [];
let curPage = null;
async function step(name, fn) {
  try { await fn(); results.push(['✔', name]); } catch (e) {
    results.push(['✘', name, e.message.split('\n')[0]]);
    if (SHOTS && curPage) await curPage.screenshot({ path: `${SHOTS}/falha-${results.length}.png` }).catch(() => {});
  }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function mobile(page) {
  curPage = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await step('[celular] criar conta e entrar', async () => {
    await page.goto(BASE);
    await page.waitForSelector('.login-card');
    await page.fill('input[name=username]', 'tony');
    await page.fill('input[name=name]', 'Tony');
    await page.fill('input[name=password]', 'senha-forte-123');
    await page.click('#login-btn');
    await page.waitForSelector('.hello');
  });

  await step('[celular] adicionar tarefa rápida no Hoje (com data em português)', async () => {
    await page.fill('.capture-inline input', 'Enviar relatório hoje às 23h');
    await page.click('.capture-inline button[type=submit]');
    await page.waitForSelector('.row-item >> text=Enviar relatório');
  });

  await step('[celular] botão + abre captura e cria ideia', async () => {
    await page.click('.fab');
    await page.click('.seg button:has-text("Ideia")');
    await page.fill('.capture-box textarea', 'App para dividir contas');
    await page.click('.capture-box button[type=submit]');
    await page.waitForSelector('.toast >> text=Ideia guardada');
  });

  await step('[celular] captura de compromisso mostra prévia da data', async () => {
    await page.click('.fab');
    await page.click('.seg button:has-text("Compromisso")');
    await page.fill('.capture-box textarea', 'Dentista amanhã 14h30');
    await page.waitForFunction(() => /Amanhã|amanhã/.test(document.querySelector('.capture-preview').textContent));
    await page.click('.capture-box button[type=submit]');
    await page.waitForSelector('.toast >> text=Compromisso agendado');
  });
  await page.waitForTimeout(400);
  await shot(page, 'm-hoje');

  await step('[celular] concluir tarefa pelo círculo', async () => {
    await page.click('.bottom-nav a[data-view=tarefas]');
    await page.waitForSelector('.row-item >> text=Enviar relatório');
    await page.click('.row-item:has-text("Enviar relatório") .tick');
    await page.waitForSelector('.toast >> text=Concluída');
  });

  await step('[celular] detalhes: salvar automático + subtarefa', async () => {
    await page.click('.chip:has-text("Concluídas")');
    await page.click('.row-item:has-text("Enviar relatório") .t');
    await page.waitForSelector('.drawer');
    await page.fill('.drawer label.f textarea', 'Incluir gráficos do trimestre');
    await page.waitForFunction(() => /Salvo/.test(document.querySelector('.save-state').textContent), null, { timeout: 5000 });
    await page.fill('.drawer input[placeholder="Adicionar subtarefa…"]', 'Revisar números');
    await page.press('.drawer input[placeholder="Adicionar subtarefa…"]', 'Enter');
    await page.waitForSelector('.drawer .subtasks >> text=Revisar números');
    await shot(page, 'm-detalhe');
    await page.click('.drawer [aria-label=Fechar]');
  });

  await step('[celular] ideia vira projeto mantendo a original', async () => {
    await page.click('.bottom-nav button[data-view=mais]');
    await page.click('.modal a:has-text("Ideias")');
    await page.waitForSelector('.idea >> text=App para dividir contas');
    await page.click('.idea button:has-text("→ Projeto")');
    await page.waitForSelector('.toast >> text=Virou projeto');
    await page.click('.chip:has-text("Viraram")');
    await page.waitForSelector('.idea >> text=App para dividir contas');
  });

  await step('[celular] projeto: quadro com tarefas e mover entre colunas', async () => {
    await page.click('.bottom-nav a[data-view=projetos]');
    await page.click('.project-card:has-text("App para dividir contas")');
    await page.waitForSelector('.board');
    await page.click('.column[data-status=pendente] button:has-text("Adicionar tarefa")');
    await page.fill('.capture-box textarea', 'Desenhar telas');
    await page.click('.capture-box button[type=submit]');
    await page.waitForSelector('.kcard >> text=Desenhar telas');
    await page.click('.kcard:has-text("Desenhar telas") button:has-text("Fazendo →")');
    await page.waitForSelector('.column[data-status=andamento] .kcard >> text=Desenhar telas');
    await shot(page, 'm-projeto');
  });

  await step('[celular] agenda mostra compromisso e cria lembrete', async () => {
    await page.click('.bottom-nav a[data-view=agenda]');
    await page.waitForSelector('.cal');
    await page.click('.topbar button:has-text("Lembrete")');
    await page.fill('.modal input[name=title]', 'Tomar remédio');
    await page.click('.modal button[type=submit]');
    await page.waitForSelector('.toast >> text=Lembrete criado');
  });

  await step('[celular] foco: iniciar e pausar Pomodoro', async () => {
    await page.goto(`${BASE}/#foco`);
    await page.click('button:has-text("Começar")');
    await page.waitForTimeout(1200);
    await page.click('button:has-text("Pausar")');
    await page.waitForSelector('button:has-text("Continuar")');
  });

  await step('[celular] anotações: criar e salvar', async () => {
    await page.goto(`${BASE}/#notas`);
    await page.click('.topbar button:has-text("Nova")');
    await page.fill('.note-editor .title-input', 'Lista de compras');
    await page.fill('.note-editor textarea', 'Arroz, feijão');
    await page.waitForFunction(() => /Salvo/.test(document.querySelector('.note-editor .save-state').textContent), null, { timeout: 5000 });
  });

  await step('[celular] buscar encontra itens', async () => {
    await page.goto(`${BASE}/#buscar`);
    await page.fill('.capture-inline input', 'compras');
    await page.waitForSelector('.row-item >> text=Lista de compras');
  });

  await step('[celular] ajustes: tema escuro', async () => {
    await page.goto(`${BASE}/#ajustes`);
    await page.click('.seg button:has-text("Escuro")');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.goto(`${BASE}/#hoje`);
    await page.waitForSelector('.hello');
    await page.waitForTimeout(300);
    await shot(page, 'm-hoje-escuro');
    await page.goto(`${BASE}/#ajustes`);
    await page.click('.seg button:has-text("Automático")');
  });

  await step('[celular] sem erros de JavaScript', async () => expect(!errors.length, errors.join(' | ')));
}

try {
  await waitServer();
  const browser = await chromium.launch();
  const phone = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await mobile(await phone.newPage());
  const desk = await browser.newContext({ viewport: { width: 1360, height: 860 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const p = await desk.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await step('[computador] login e barra lateral com todas as seções', async () => {
    await p.goto(BASE);
    await p.fill('input[name=username]', 'tony');
    await p.fill('input[name=password]', 'senha-forte-123');
    await p.click('#login-btn');
    await p.waitForSelector('.sidebar .nav a[data-view=ideias]');
    expect((await p.$$('.sidebar .nav a[data-view]')).length === 9, 'faltam seções');
    await p.waitForSelector('.side-projects a');
  });
  await step('[computador] atalho N abre captura', async () => {
    await p.keyboard.press('n');
    await p.waitForSelector('.capture-box');
    await p.keyboard.press('Escape');
  });
  for (const v of ['hoje', 'tarefas', 'projetos', 'ideias', 'notas', 'agenda', 'foco', 'buscar', 'ajustes']) {
    await step(`[computador] abrir ${v}`, async () => {
      await p.click(`.sidebar a[data-view=${v}]`);
      await p.waitForFunction(() => !/Carregando…|Erro ao abrir/.test(document.querySelector('#main').textContent.slice(0, 30)));
      await p.waitForTimeout(250);
      await shot(p, `d-${v}`);
    });
  }
  await step('[computador] sem erros de JavaScript', async () => expect(!errors.length, errors.join(' | ')));
  await browser.close();
} catch (e) { results.push(['✘', 'execução', e.message]); }
finally { server.kill(); }

for (const r of results) console.log(r.join(' '));
const failed = results.filter((r) => r[0] === '✘').length;
console.log(`\n${results.length - failed}/${results.length} verificações OK`);
process.exit(failed ? 1 : 0);
