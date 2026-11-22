// Verificação dos botões principais em navegador real (Chromium + Playwright).
// Uso: node tests/e2e/ui.test.mjs   (o script sobe o servidor de teste sozinho)
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
const stop = () => { try { server.kill(); } catch (_) {} };

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/healthz'); if (r.ok) return; } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('servidor não subiu\n' + serverLog);
}

// Microfone e voz simulados: o reconhecimento “ouve” a frase definida em window.__say.
const voiceStub = () => {
  window.__spoken = [];
  class FakeRec {
    start() {
      setTimeout(() => {
        const text = window.__say || 'que horas são';
        const res = [[{ transcript: text }]]; res[0].isFinal = true;
        this.onresult && this.onresult({ resultIndex: 0, results: res });
        this.onend && this.onend();
      }, 150);
    }
    stop() { this.onend && this.onend(); }
  }
  window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
  const synth = { speaking: false, getVoices: () => [], cancel() {}, speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 10); } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
};

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['✔', name]); } catch (e) { results.push(['✘', name, e.message.split('\n')[0]]); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function run(page, label) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });

  await step(`[${label}] cadastro e login`, async () => {
    await page.goto(BASE);
    await page.waitForSelector('#login:not([hidden])');
    if (await page.isVisible('#toggle-signup') && (await page.textContent('#login-btn')).includes('Entrar')) await page.click('#toggle-signup');
    await page.fill('input[name=username]', 'tony');
    await page.fill('input[name=password]', 'senha-forte-123');
    await page.click('#login-btn');
    await page.waitForSelector('#home:not([hidden])');
    expect(await page.isVisible('#orb') && await page.isVisible('#mic'), 'orbe/microfone não visíveis');
  });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-home.png` });

  await step(`[${label}] microfone: fala → resposta falada`, async () => {
    await page.evaluate(() => { window.__say = 'que horas são'; });
    await page.click('#mic');
    await page.waitForFunction(() => /Agora são/.test(document.querySelector('#caption').textContent));
    await page.waitForFunction(() => window.__spoken.some((t) => /Agora são/.test(t)));
  });

  await step(`[${label}] microfone: criar tarefa com confirmação`, async () => {
    await page.evaluate(() => { window.__say = 'crie uma tarefa testar o jarvis amanhã às 9h'; });
    await page.click('#mic');
    await page.waitForSelector('#caption .pending');
    await page.click('#caption .pending .btn.ok');
    await page.waitForFunction(() => /criada/.test(document.querySelector('#caption').textContent));
  });

  await step(`[${label}] tocar no JARVIS abre o menu`, async () => {
    await page.click('#orb');
    await page.waitForSelector('#menu:not([hidden])');
    expect((await page.$$('.tile')).length === 7, 'menu sem 7 painéis');
  });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-menu.png` });

  const panels = ['assistente', 'espaco', 'agenda', 'servicos', 'produtividade', 'windows', 'config'];
  for (const p of panels) {
    await step(`[${label}] abrir painel ${p}`, async () => {
      await page.goto(`${BASE}/#menu`);
      await page.click(`.tile[data-panel=${p}]`);
      await page.waitForSelector('#panel:not([hidden])');
      await page.waitForFunction(() => !/Carregando…|Erro ao abrir/.test(document.querySelector('#panel-body').textContent.slice(0, 40)));
      await page.waitForTimeout(250);
      expect(!/Erro ao abrir/.test(await page.textContent('#panel-body')), 'erro ao abrir painel');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-${p}.png` });
    });
  }

  await step(`[${label}] assistente: texto + memória`, async () => {
    await page.goto(`${BASE}/#assistente`);
    await page.fill('.composer input', 'lembre que eu gosto de café');
    await page.click('.composer button[type=submit]');
    await page.waitForSelector('.chat .pending');
    await page.click('.chat .pending .btn.ok');
    await page.waitForFunction(() => /Guardado/.test(document.querySelector('.chat').textContent));
    await page.click('.tab[data-tab=mem]');
    await page.waitForFunction(() => /gosto de café/.test(document.querySelector('#panel-body').textContent));
  });

  await step(`[${label}] Meu Espaço: criar, salvar automático, subtarefa, ideia → projeto`, async () => {
    await page.goto(`${BASE}/#espaco`);
    await page.waitForSelector('.li');
    expect(/Testar o jarvis/i.test(await page.textContent('#panel-body')), 'tarefa criada por voz não aparece');
    await page.click('.li >> text=/Testar o jarvis/i');
    await page.fill('textarea', 'Detalhes salvos automaticamente');
    await page.waitForFunction(() => /Salvo/.test(document.querySelector('#save-state').textContent), null, { timeout: 5000 });
    await page.fill('input[placeholder="Nova subtarefa…"]', 'Sub 1');
    await page.press('input[placeholder="Nova subtarefa…"]', 'Enter');
    await page.waitForSelector('.list .li >> text=Sub 1');
    await page.click('.tab[data-tab=idea]');
    await page.fill('input[placeholder="Nova ideia…"]', 'Ideia brilhante');
    await page.press('input[placeholder="Nova ideia…"]', 'Enter');
    await page.waitForSelector('text=→ Transformar em projeto');
    await page.click('text=→ Transformar em projeto');
    await page.waitForSelector('text=Criado a partir de:');
  });

  await step(`[${label}] Agenda: novo compromisso + conflito`, async () => {
    await page.goto(`${BASE}/#agenda`);
    for (const [title, start] of [['Consulta', '2031-03-10T10:00'], ['Outra', '2031-03-10T10:30']]) {
      await page.click('text=+ Compromisso');
      await page.fill('.modal-card input[name=title]', title);
      await page.fill('.modal-card input[name=start]', start);
      await page.fill('.modal-card input[name=end]', start.replace(/T(\d\d)/, (m, h) => `T${String(+h + 1).padStart(2, '0')}`));
      await page.click('.modal-card button[type=submit]');
      if (title === 'Outra') {
        await page.waitForSelector('.modal-card >> text=/Conflito de horário/');
        await page.click('.modal-card .btn.primary');
      }
      await page.waitForSelector('#modal[hidden]', { state: 'attached' });
    }
    await page.waitForSelector('.li >> text=Outra');
  });

  await step(`[${label}] Serviços: cotações, gráfico e conversor`, async () => {
    await page.goto(`${BASE}/#servicos`);
    await page.waitForSelector('.quote');
    expect((await page.$$('.quote')).length === 4, 'faltam cotações');
    await page.waitForSelector('svg.chart path');
    await page.waitForFunction(() => /US\$ 19,61/.test(document.body.textContent));
    await page.click('.tab[data-tab=weather]');
    await page.waitForSelector('text=Predomínio de sol');
  });

  await step(`[${label}] Produtividade: Pomodoro iniciar/pausar`, async () => {
    await page.goto(`${BASE}/#produtividade`);
    await page.click('button:has-text("Iniciar")');
    await page.waitForTimeout(1300);
    await page.click('button:has-text("Pausar")');
    await page.waitForSelector('button:has-text("Continuar")');
    await page.click('.tab[data-tab=hist]');
    await page.waitForSelector('text=Relatórios em PDF');
  });

  await step(`[${label}] Configurações: salvar cidade`, async () => {
    await page.goto(`${BASE}/#config`);
    const city = page.locator('label:has-text("Cidade (clima)") input');
    await city.fill('Recife');
    await page.click('text=Salvar preferências');
    await page.waitForSelector('.toast >> text=Configurações salvas');
  });

  await step(`[${label}] sem erros de JavaScript`, async () => { expect(!errors.length, errors.join(' | ')); });
}

try {
  await waitServer();
  const browser = await chromium.launch();
  const phone = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await phone.addInitScript(voiceStub);
  await run(await phone.newPage(), 'celular');
  const desk = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await desk.addInitScript(voiceStub);
  const p2 = await desk.newPage();
  await p2.goto(BASE);
  await p2.waitForSelector('#login:not([hidden])');
  await step('[computador] login com conta existente', async () => {
    await p2.fill('input[name=username]', 'tony');
    await p2.fill('input[name=password]', 'senha-forte-123');
    await p2.click('#login-btn');
    await p2.waitForSelector('#home:not([hidden])');
  });
  if (SHOTS) {
    await p2.screenshot({ path: `${SHOTS}/computador-home.png` });
    await p2.goto(`${BASE}/#servicos`); await p2.waitForSelector('svg.chart path'); await p2.screenshot({ path: `${SHOTS}/computador-servicos.png` });
    await p2.goto(`${BASE}/#agenda`); await p2.waitForSelector('.cal'); await p2.screenshot({ path: `${SHOTS}/computador-agenda.png` });
  }
  await browser.close();
} catch (e) {
  results.push(['✘', 'execução', e.message]);
} finally { stop(); }

for (const r of results) console.log(r.join(' '));
const failed = results.filter((r) => r[0] === '✘').length;
console.log(`\n${results.length - failed}/${results.length} verificações OK`);
process.exit(failed ? 1 : 0);
