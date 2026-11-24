// Verificação da tela em navegador real (Chromium + Playwright). Uso: node tests/e2e/ui.test.mjs
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
const server = spawn('python3', [path.join(here, 'serve.py'), String(PORT)], { stdio: 'ignore' });

const results = [];
async function step(name, fn) { try { await fn(); results.push(['✔', name]); } catch (e) { results.push(['✘', name, e.message.split('\n')[0]]); } }
const expect = (c, m) => { if (!c) throw new Error(m); };

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch (_) {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const texts = () => page.$$eval('.ideas .text', (els) => els.map((e) => e.textContent));

  await step('criar conta', async () => {
    await page.goto(BASE);
    await page.click('button:has-text("Criar conta")');
    await page.fill('input[name=username]', 'tony');
    await page.fill('input[name=password]', 'senha-forte-123');
    await page.click('button[type=submit]');
    await page.waitForSelector('.add input');
    expect(await page.isVisible('.empty'), 'mensagem de lista vazia não aparece');
  });
  await step('anotar ideias com Enter e com o botão', async () => {
    await page.fill('.add input', 'Comprar presente da mãe');
    await page.press('.add input', 'Enter');
    await page.waitForSelector('.ideas li');
    await page.fill('.add input', 'Pagar o IPVA');
    await page.click('button:has-text("Anotar")');
    await page.waitForFunction(() => document.querySelectorAll('.ideas li').length === 2);
    await page.fill('.add input', 'Marcar dentista');
    await page.press('.add input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.ideas li').length === 3);
    expect((await texts())[0] === 'Marcar dentista', 'a mais nova deve ficar no topo');
  });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ideias.png` });
  await step('editar tocando no texto', async () => {
    const t = page.locator('.ideas .text').nth(1);
    await t.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' até sexta');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#toast:has-text("Ideia atualizada")');
    await page.reload();
    await page.waitForSelector('.ideas li');
    expect((await texts()).includes('Pagar o IPVA até sexta'), 'edição não salvou');
  });
  await step('apagar e desfazer', async () => {
    await page.click('.ideas li:has-text("Marcar dentista") .del');
    await page.waitForSelector('#toast:has-text("Ideia apagada")');
    expect(!(await texts()).includes('Marcar dentista'), 'não sumiu');
    await page.click('#toast button:has-text("Desfazer")');
    expect((await texts()).includes('Marcar dentista'), 'desfazer não funcionou');
  });
  await step('apagar de verdade', async () => {
    await page.click('.ideas li:has-text("Comprar presente") .del');
    await page.waitForTimeout(5600);
    await page.reload();
    await page.waitForSelector('.ideas li');
    expect(!(await texts()).includes('Comprar presente da mãe'), 'não apagou no servidor');
  });
  await step('fundo branco', async () => {
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg === 'rgb(255, 255, 255)', 'fundo não é branco: ' + bg);
  });
  await step('sair e entrar de novo', async () => {
    await page.click('button:has-text("Sair")');
    await page.fill('input[name=username]', 'tony');
    await page.fill('input[name=password]', 'senha-forte-123');
    await page.click('button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('.ideas li').length === 2);
  });
  if (SHOTS) {
    const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await desk.goto(BASE); await desk.screenshot({ path: `${SHOTS}/login.png` });
  }
  await step('sem erros de JavaScript', async () => expect(!errors.length, errors.join(' | ')));
  await browser.close();
} catch (e) { results.push(['✘', 'execução', e.message]); } finally { server.kill(); }

for (const r of results) console.log(r.join(' '));
const failed = results.filter((r) => r[0] === '✘').length;
console.log(`\n${results.length - failed}/${results.length} verificações OK`);
process.exit(failed ? 1 : 0);
