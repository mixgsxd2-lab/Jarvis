// Inicialização: login, tela inicial (orbe + microfone), menu, painéis, notificações e timers.
import { $, api, beep, clear, fail, h, modal, state, systemNotify, toast, unlockAudio } from './core.js';
import { canListen, isListening, isSpeaking, listen, speak, stopListening, stopSpeaking, unlockSpeech } from './voice.js';

const PANELS = {
  assistente: ['Assistente', () => import('./p-assistant.js')],
  espaco: ['Meu Espaço', () => import('./p-space.js')],
  agenda: ['Agenda', () => import('./p-agenda.js')],
  servicos: ['Serviços', () => import('./p-services.js')],
  produtividade: ['Produtividade', () => import('./p-productivity.js')],
  windows: ['Windows', () => import('./p-windows.js')],
  config: ['Configurações', () => import('./p-settings.js')],
};

// ====================================================================== boot
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('jarvis:logout', showLogin);
  try {
    const st = await api('/api/auth/state');
    if (st.authenticated) { applyUser(st); showApp(); } else showLogin(st.signup);
  } catch (e) {
    showLogin(false);
    $('#login-error').textContent = e.message;
  }
}

function applyUser(data) {
  state.user = data.user;
  state.settings = data.user.settings || {};
  state.csrf = data.csrf;
  document.documentElement.style.setProperty('--accent', state.settings.theme_accent || '#29b6ff');
}

// ====================================================================== login
let signupMode = false;
function showLogin(signupAllowed) {
  stopTicker();
  $('#home').hidden = true; $('#menu').hidden = true; $('#panel').hidden = true; $('#login').hidden = false;
  if (typeof signupAllowed === 'boolean') {
    signupMode = signupAllowed;
    $('#toggle-signup').hidden = !signupAllowed;
  }
  renderLoginMode();
}
function renderLoginMode() {
  $('#login-sub').textContent = signupMode ? 'Criar sua conta (primeiro acesso)' : 'Acesso seguro';
  $('#login-btn').textContent = signupMode ? 'Criar conta e entrar' : 'Entrar';
  $('#toggle-signup').textContent = signupMode ? 'Já tenho conta' : 'Criar conta';
  $('#name-field').hidden = !signupMode;
  $('#login-form').password.autocomplete = signupMode ? 'new-password' : 'current-password';
}
$('#toggle-signup').addEventListener('click', () => { signupMode = !signupMode; renderLoginMode(); });
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#login-error').textContent = '';
  $('#login-btn').disabled = true;
  try {
    const body = { username: f.username.value.trim(), password: f.password.value, name: f.name.value.trim(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const data = await api(signupMode ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body });
    applyUser(data);
    f.password.value = '';
    showApp(true);
  } catch (err) {
    $('#login-error').textContent = err.message;
  } finally { $('#login-btn').disabled = false; }
});

// ====================================================================== app
function showApp(justLoggedIn = false) {
  $('#login').hidden = true;
  $('#home').hidden = false;
  route();
  startTicker();
  if (justLoggedIn) {
    const nome = state.settings.name;
    caption('', `Olá${nome ? ', ' + nome : ''}. Toque no microfone para falar ou em mim para abrir o menu.`);
  }
}

window.addEventListener('hashchange', route);
function route() {
  if (!state.user) return;
  const key = location.hash.replace('#', '');
  if (key === 'menu') { $('#menu').hidden = false; closePanel(); return; }
  $('#menu').hidden = true;
  if (PANELS[key]) openPanel(key); else closePanel();
}

async function openPanel(key) {
  const [title, loader] = PANELS[key];
  const panel = $('#panel');
  if (state.panel === key && !panel.hidden) return;
  runCleanup();
  state.panel = key;
  $('#panel-title').textContent = title;
  $('#save-state').textContent = '';
  const body = clear($('#panel-body'));
  body.append(h('div', { class: 'empty' }, 'Carregando…'));
  panel.hidden = false;
  $('#home').hidden = true;
  try {
    const mod = await loader();
    if (state.panel !== key) return;
    clear(body);
    await mod.render(body, { onCleanup: (fn) => state.cleanup.push(fn), runActions, speakReply });
  } catch (e) { clear(body).append(h('div', { class: 'empty' }, 'Erro ao abrir: ' + e.message)); }
}
function runCleanup() { for (const fn of state.cleanup.splice(0)) { try { fn(); } catch (_) {} } }
function closePanel() { runCleanup(); state.panel = null; $('#panel').hidden = true; if (state.user) $('#home').hidden = false; }

$('#panel-back').addEventListener('click', () => { location.hash = 'menu'; });
$('#close-menu').addEventListener('click', () => { location.hash = ''; });
$('#menu').addEventListener('click', (e) => { if (e.target.id === 'menu') location.hash = ''; });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !$('#modal').hidden) return;
  if (!$('#panel').hidden) location.hash = 'menu'; else if (!$('#menu').hidden) location.hash = '';
});

// ====================================================================== tela inicial
const home = $('#home');
function setMode(mode) { home.classList.remove('listening', 'thinking', 'speaking'); if (mode) home.classList.add(mode); }

function caption(you, say, pending = []) {
  const box = clear($('#caption'));
  if (you) box.append(h('div', { class: 'you' }, '“' + you + '”'));
  if (say) box.append(h('div', { class: 'say' }, say));
  if (pending.length) box.append(pendingCards(pending, (msg) => { caption('', msg); speakReply(msg); }));
}

export function pendingCards(pending, onDone) {
  const wrap = h('div', {});
  for (const p of pending) {
    const card = h('div', { class: 'pending', 'data-pending': p.id },
      h('p', {}, p.summary),
      h('div', { class: 'row' },
        h('button', { class: 'btn ok small', onclick: () => resolve(true) }, 'Confirmar'),
        h('button', { class: 'btn ghost small', onclick: () => resolve(false) }, 'Cancelar')));
    async function resolve(accept) {
      card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        const r = await api(`/api/assistant/confirm/${p.id}`, { method: 'POST', body: { accept } });
        card.replaceWith(h('p', { class: r.status === 'done' ? 'up' : 'muted' }, r.message));
        onDone && onDone(r.message);
        window.dispatchEvent(new Event('jarvis:data'));
      } catch (e) { fail(e); card.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
    }
    wrap.append(card);
  }
  return wrap;
}

export async function speakReply(text) {
  setMode('speaking');
  await speak(text);
  if (home.classList.contains('speaking')) setMode(null);
}

async function ask(text) {
  setMode('thinking');
  caption(text, 'Processando…');
  try {
    const r = await api('/api/assistant/chat', { method: 'POST', body: { text } });
    caption(text, r.reply, r.pending || []);
    runActions(r.client_actions || []);
    if (r.resolved) window.dispatchEvent(new Event('jarvis:data'));
    await speakReply(r.reply);
  } catch (e) {
    setMode(null);
    caption(text, e.message);
  }
}

$('#mic').addEventListener('click', (e) => {
  e.stopPropagation();
  unlockSpeech(); unlockAudio();
  if (isSpeaking()) { stopSpeaking(); setMode(null); return; }
  if (isListening()) { stopListening(); return; }
  if (!canListen) { showTextInput('Seu navegador não reconhece voz aqui. Digite ou use o microfone do teclado.'); return; }
  setMode('listening');
  caption('', 'Ouvindo…');
  listen({
    onInterim: (t) => caption(t, 'Ouvindo…'),
    onFinal: (t) => ask(t),
    onEnd: (t) => { if (!t) { setMode(null); caption('', 'Não ouvi nada. Toque no microfone e fale.'); } },
    onError: (err) => {
      setMode(null);
      if (err === 'not-allowed' || err === 'service-not-allowed') showTextInput('Permita o uso do microfone nas configurações do navegador, ou digite abaixo.');
      else if (err !== 'no-speech' && err !== 'aborted') showTextInput('Não consegui usar o microfone. Digite abaixo.');
    },
  });
});

function showTextInput(msg) {
  caption('', msg);
  const f = $('#home-text');
  f.hidden = false;
  f.text.focus();
}
$('#home-text').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = e.target.text.value.trim();
  if (!t) return;
  e.target.text.value = '';
  unlockSpeech();
  ask(t);
});
// toque longo no orbe abre a caixa de texto; toque simples abre o menu
let pressTimer = null; let longPressed = false;
$('#orb').addEventListener('pointerdown', () => { longPressed = false; pressTimer = setTimeout(() => { longPressed = true; showTextInput('Digite sua mensagem:'); }, 650); });
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('#orb').addEventListener(ev, () => clearTimeout(pressTimer)));
$('#orb').addEventListener('click', () => { unlockSpeech(); unlockAudio(); if (longPressed) return; location.hash = 'menu'; });

// ====================================================================== ações no aparelho
let floatTimer = null;
export function runActions(list) {
  for (const a of list) {
    if (a.type === 'open_panel') {
      location.hash = a.panel;
      if (a.search) sessionStorage.setItem('jarvis:search', a.search);
    } else if (a.type === 'open_url') {
      window.open(a.url, '_blank', 'noopener');
    } else if (a.type === 'pomodoro') {
      sessionStorage.setItem('jarvis:pomodoro', String(a.minutes || ''));
      if (state.panel === 'produtividade') window.dispatchEvent(new Event('jarvis:pomodoro'));
      else location.hash = 'produtividade';
    } else if (a.type === 'timer') {
      startFloatTimer(a.seconds, a.label || 'Temporizador');
    }
  }
}

function startFloatTimer(seconds, label) {
  clearInterval(floatTimer);
  const el = $('#float-timer');
  const end = Date.now() + seconds * 1000;
  el.hidden = false;
  el.title = 'Toque para cancelar';
  el.onclick = () => { clearInterval(floatTimer); el.hidden = true; toast('Temporizador cancelado'); };
  const tickT = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    const m = Math.floor(left / 60), s = left % 60;
    el.textContent = `⏱ ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (left <= 0) { clearInterval(floatTimer); el.hidden = true; alarm(label, 'Tempo esgotado!'); }
  };
  tickT();
  floatTimer = setInterval(tickT, 500);
}

// ====================================================================== notificações / alarmes
let alarmLoop = null;
export function alarm(title, body) {
  systemNotify(title, body, { alarm: true });
  clearInterval(alarmLoop);
  beep([[988, .25], [0, .1], [988, .25], [0, .1], [1318, .4]], .35);
  alarmLoop = setInterval(() => beep([[988, .25], [0, .1], [988, .25], [0, .1], [1318, .4]], .35), 2000);
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
  const stop = () => { clearInterval(alarmLoop); alarmLoop = null; close(); };
  const close = modal(h('div', { class: 'alarm-card' },
    h('div', { class: 'mini-orb' }, h('span')),
    h('h3', {}, title), h('p', {}, body),
    h('div', { class: 'modal-actions', style: { justifyContent: 'center' } }, h('button', { class: 'btn primary', onclick: stop }, 'Parar alarme'))),
  { onClose: () => { clearInterval(alarmLoop); alarmLoop = null; } });
  speak(`${title}. ${body}`, { force: true });
  setTimeout(() => { if (alarmLoop) { clearInterval(alarmLoop); alarmLoop = null; } }, 60000);
}

let ticker = null;
let lastBreak = Date.now();
function startTicker() {
  stopTicker();
  tick();
  ticker = setInterval(() => { if (document.visibilityState === 'visible') tick(); }, 30000);
}
function stopTicker() { clearInterval(ticker); ticker = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ticker) tick(); });

async function tick() {
  if (!state.user) return;
  try {
    const r = await api('/api/tick');
    for (const n of r.notifications) {
      if (n.kind === 'alarme') alarm(n.title, n.body);
      else {
        toast(n.title, n.body, { ms: 9000 });
        beep();
        systemNotify(n.title, n.body);
        if (n.kind === 'rotina' || n.kind === 'rotina_foco' || n.kind === 'lembrete' || n.kind === 'alerta') speak(n.title + '. ' + n.body);
        if (n.kind === 'rotina_foco') runActions([{ type: 'pomodoro' }]);
      }
    }
    if (r.notifications.length) window.dispatchEvent(new Event('jarvis:data'));
  } catch (_) { /* offline: tenta de novo depois */ }
  const every = Number(state.settings.break_reminder || 0);
  if (every > 0 && Date.now() - lastBreak > every * 60000) {
    lastBreak = Date.now();
    toast('Hora de uma pausa', 'Levante-se, alongue-se e beba água.', { ms: 9000 });
    systemNotify('Hora de uma pausa', 'Levante-se, alongue-se e beba água.');
    speak('Hora de uma pausa. Levante-se, alongue-se e beba um pouco de água.');
  }
}
window.addEventListener('jarvis:settings', () => { lastBreak = Date.now(); });
window.addEventListener('jarvis:tick', () => setTimeout(tick, 300));

export { caption, ask };
boot();
