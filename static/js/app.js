// Estrutura do app: login, navegação, captura rápida, avisos e alarmes.
import { $, api, beep, clear, debounce, emit, fail, h, icon, modal, on, state, systemNotify, toast, unlockAudio } from './core.js';

const VIEWS = {
  hoje: ['Hoje', 'today', () => import('./v-today.js')],
  tarefas: ['Tarefas', 'tasks', () => import('./v-tasks.js')],
  projetos: ['Projetos', 'folder', () => import('./v-projects.js')],
  ideias: ['Ideias', 'idea', () => import('./v-ideas.js')],
  notas: ['Anotações', 'note', () => import('./v-notes.js')],
  agenda: ['Agenda', 'calendar', () => import('./v-agenda.js')],
  foco: ['Foco e metas', 'focus', () => import('./v-focus.js')],
  buscar: ['Buscar', 'search', () => import('./v-search.js')],
  ajustes: ['Ajustes', 'settings', () => import('./v-settings.js')],
};
const SIDE = ['hoje', 'tarefas', 'projetos', 'ideias', 'notas', 'agenda', 'foco', 'buscar'];
const BOTTOM = ['hoje', 'tarefas', 'projetos', 'agenda'];

// ====================================================================== boot
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  on('logout', () => showLogin());
  on('settings', applyTheme);
  try {
    const st = await api('/api/auth/state');
    if (st.authenticated) { setUser(st); showApp(); } else showLogin(st.signup);
  } catch (e) { showLogin(false, e.message); }
}

function setUser(data) {
  state.user = data.user;
  state.settings = data.user.settings || {};
  state.csrf = data.csrf;
  applyTheme();
}

export function applyTheme() {
  const s = state.settings;
  const root = document.documentElement;
  if (s.theme === 'claro') root.dataset.theme = 'light';
  else if (s.theme === 'escuro') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  root.style.setProperty('--accent', s.accent || '#5b5bd6');
}

// ====================================================================== login
function showLogin(signupAllowed = false, error = '') {
  stopTicker();
  state.user = null;
  let signup = !!signupAllowed;
  const err = h('p', { class: 'error', role: 'alert' }, error);
  const user = h('input', { name: 'username', autocomplete: 'username', required: true, minlength: 3, maxlength: 40, autocapitalize: 'none', spellcheck: 'false' });
  const name = h('input', { name: 'name', maxlength: 60, autocomplete: 'given-name' });
  const pass = h('input', { name: 'password', type: 'password', required: true, minlength: 8 });
  const nameField = h('label', { class: 'f' }, 'Como quer ser chamado? (opcional)', name);
  const submit = h('button', { class: 'btn primary block', type: 'submit', id: 'login-btn' });
  const sub = h('p', { class: 'muted' });
  const toggle = h('button', { class: 'btn ghost block', type: 'button', hidden: !signupAllowed });
  const render = () => {
    sub.textContent = signup ? 'Crie sua conta para começar a organizar tudo.' : 'Entre para ver suas tarefas, projetos e ideias.';
    submit.textContent = signup ? 'Criar conta' : 'Entrar';
    toggle.textContent = signup ? 'Já tenho conta' : 'Criar conta';
    nameField.hidden = !signup;
    pass.autocomplete = signup ? 'new-password' : 'current-password';
  };
  toggle.onclick = () => { signup = !signup; render(); };
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = ''; submit.disabled = true;
    try {
      const data = await api(signup ? '/api/auth/register' : '/api/auth/login', { method: 'POST',
        body: { username: user.value.trim(), password: pass.value, name: name.value.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      setUser(data); showApp();
    } catch (ex) { err.textContent = ex.message; } finally { submit.disabled = false; }
  } }, h('label', { class: 'f' }, 'Usuário', user), nameField, h('label', { class: 'f' }, 'Senha', pass), err, submit, toggle);
  render();
  clear($('#root')).append(h('main', { class: 'login' }, h('div', { class: 'login-card' },
    h('div', { class: 'logo' }, h('span', { class: 'logo-mark' }, icon('check')), 'JARVIS'), sub, form)));
}

// ====================================================================== estrutura
let mainEl;
function showApp() {
  const navLink = (key) => {
    const [label, ic] = VIEWS[key];
    return h('a', { href: '#' + key, 'data-view': key }, icon(ic), label, h('span', { class: 'count', 'data-count': key }));
  };
  const sideProjects = h('div', { class: 'nav side-projects' });
  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'logo' }, h('span', { class: 'logo-mark' }, icon('check')), 'JARVIS'),
    h('button', { class: 'btn primary block capture-btn', onclick: () => openCapture() }, icon('plus'), 'Adicionar'),
    h('nav', { class: 'nav' }, SIDE.map(navLink)),
    h('div', { class: 'nav-sep' }), h('h3', { style: { padding: '0 .6rem' } }, 'Projetos'), sideProjects,
    h('div', { style: { marginTop: 'auto' } }, h('nav', { class: 'nav' }, navLink('ajustes'))));
  mainEl = h('main', { class: 'main', id: 'main' });
  const bottom = h('nav', { class: 'bottom-nav' },
    BOTTOM.map((k) => h('a', { href: '#' + k, 'data-view': k }, icon(VIEWS[k][1]), VIEWS[k][0])),
    h('button', { 'data-view': 'mais', onclick: openMore }, icon('more'), 'Mais'));
  const fab = h('button', { class: 'fab', 'aria-label': 'Adicionar', onclick: () => openCapture() }, icon('plus'));
  clear($('#root')).append(h('div', { class: 'shell' }, sidebar, mainEl), bottom, fab);
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  route();
  refreshSide(sideProjects);
  on('data', () => refreshSide(sideProjects));
  startTicker();
  document.addEventListener('pointerdown', unlockAudio, { once: true });
}

async function refreshSide(box) {
  try {
    const t = await api('/api/today');
    const set = (k, n) => { document.querySelectorAll(`[data-count=${k}]`).forEach((el) => { el.textContent = n || ''; }); };
    set('hoje', t.overdue.length + t.today.length || '');
    set('tarefas', t.counts.open);
    set('projetos', t.counts.projects);
    clear(box);
    for (const p of t.projects) box.append(h('a', { href: `#projetos/${p.id}` }, h('span', { class: 'dot', style: { background: p.color || 'var(--accent)' } }), p.title));
    if (!t.projects.length) box.append(h('p', { class: 'faint small', style: { padding: '0 .6rem' } }, 'Nenhum projeto ativo.'));
  } catch (_) {}
}

function openMore() {
  const items = ['ideias', 'notas', 'foco', 'buscar', 'ajustes'];
  const close = modal(h('div', {}, h('h2', {}, 'Mais'), h('nav', { class: 'nav' }, items.map((k) =>
    h('a', { href: '#' + k, onclick: () => close() }, icon(VIEWS[k][1]), VIEWS[k][0])))));
}

async function route() {
  if (!state.user) return;
  const [key = state.settings.start_view || 'hoje', param] = location.hash.replace('#', '').split('/');
  const view = VIEWS[key] ? key : 'hoje';
  document.querySelectorAll('[data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
  for (const fn of state.cleanup.splice(0)) { try { fn(); } catch (_) {} }
  clear(mainEl).append(h('div', { class: 'empty' }, 'Carregando…'));
  try {
    const mod = await VIEWS[view][2]();
    clear(mainEl);
    await mod.render(mainEl, param);
    document.title = `${VIEWS[view][0]} · JARVIS`;
  } catch (e) { clear(mainEl).append(h('div', { class: 'empty' }, 'Erro ao abrir: ' + e.message)); }
  window.scrollTo(0, 0);
}

/** Cabeçalho padrão das telas. */
export function topbar(title, ...actions) {
  return h('header', { class: 'topbar' }, h('h1', {}, title), ...actions);
}

// ====================================================================== captura rápida
const KINDS = [['task', 'Tarefa'], ['idea', 'Ideia'], ['note', 'Anotação'], ['project', 'Projeto'], ['reminder', 'Lembrete'], ['event', 'Compromisso']];
const HINTS = {
  task: 'Ex.: Pagar a conta de luz amanhã 10h', idea: 'Ex.: App para dividir contas com amigos', note: 'Primeira linha vira o título',
  project: 'Ex.: Reforma da cozinha', reminder: 'Ex.: Ligar para a Ana às 15h', event: 'Ex.: Dentista sexta 14h30',
};
export async function openCapture(kind = 'task', extra = {}) {
  let k = kind;
  const seg = h('div', { class: 'seg', role: 'tablist' });
  const text = h('textarea', { placeholder: HINTS[k], 'aria-label': 'O que você quer registrar?', autofocus: true });
  const preview = h('div', { class: 'capture-preview' });
  const projectSel = h('select', { 'aria-label': 'Projeto' }, h('option', { value: '' }, 'Sem projeto'));
  const prio = h('select', { 'aria-label': 'Prioridade' }, [['0', 'Sem prioridade'], ['1', 'Baixa'], ['2', 'Média'], ['3', 'Alta']].map(([v, l]) => h('option', { value: v }, l)));
  const alarm = h('label', { class: 'check' }, h('input', { type: 'checkbox' }), 'Tocar como alarme');
  const taskOpts = h('div', { class: 'row nowrap' }, projectSel, prio);
  const err = h('p', { class: 'error' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Adicionar');
  api('/api/items?kind=project&top=1').then((ps) => {
    for (const p of ps.filter((x) => x.status !== 'concluida')) projectSel.append(h('option', { value: p.id, selected: String(extra.project_id) === String(p.id) }, p.title));
  }).catch(() => {});
  const renderSeg = () => {
    clear(seg).append(...KINDS.map(([v, l]) => h('button', { type: 'button', class: v === k ? 'on' : '', onclick: () => { k = v; renderSeg(); } }, l)));
    text.placeholder = HINTS[k];
    taskOpts.hidden = k !== 'task';
    alarm.hidden = k !== 'reminder';
    doPreview();
  };
  const doPreview = debounce(async () => {
    const t = text.value.trim();
    if (!t || !['task', 'reminder', 'event'].includes(k)) { clear(preview); return; }
    try {
      const r = await api('/api/capture', { method: 'POST', body: { text: t, kind: k, dry_run: true } });
      clear(preview).append(r.label ? [icon('calendar', 'sm'), `${r.title} · ${r.label}`] : (k === 'task' ? 'Sem data' : 'Diga quando, ex.: “amanhã 9h”'));
    } catch (_) { clear(preview); }
  }, 250);
  text.addEventListener('input', doPreview);
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && k !== 'note') { e.preventDefault(); form.requestSubmit(); } });
  const form = h('form', { class: 'capture-box', onsubmit: async (e) => {
    e.preventDefault();
    if (!text.value.trim()) return;
    err.textContent = ''; submit.disabled = true;
    try {
      const r = await api('/api/capture', { method: 'POST', body: { text: text.value, kind: k, project_id: projectSel.value || null,
        priority: Number(prio.value), reminder_kind: alarm.querySelector('input').checked ? 'alarme' : 'lembrete' } });
      close();
      const names = { item: { task: 'Tarefa criada', idea: 'Ideia guardada', note: 'Anotação criada', project: 'Projeto criado' }, reminder: 'Lembrete criado', event: 'Compromisso agendado' };
      const label = r.type === 'item' ? names.item[r.item.kind] : names[r.type];
      const sub = r.conflicts?.length ? `Atenção: conflita com “${r.conflicts[0].title}”` : '';
      const action = r.type === 'item' ? { label: 'Abrir', fn: () => (r.item.kind === 'project' ? (location.hash = `projetos/${r.item.id}`) : import('./item.js').then((m) => m.openItem(r.item.id))) } : null;
      toast(label, sub, { action, ms: 5000 });
      emit('data');
    } catch (ex) { err.textContent = ex.message; } finally { submit.disabled = false; }
  } }, seg, text, preview, taskOpts, alarm, err, h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar'), submit));
  const close = modal(h('div', {}, h('h2', {}, 'Adicionar'), form));
  renderSeg();
}
document.addEventListener('keydown', (e) => {
  if (!state.user || e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('.modal, .drawer')) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openCapture(); }
  if (e.key === '/') { e.preventDefault(); location.hash = 'buscar'; }
});

// ====================================================================== avisos e alarmes
let alarmLoop = null;
function alarm(title, body) {
  systemNotify(title, body, { alarm: true });
  const ring = () => beep([[988, .22], [0, .1], [988, .22], [0, .1], [1318, .35]], .3);
  ring();
  clearInterval(alarmLoop);
  alarmLoop = setInterval(ring, 2000);
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
  const close = modal(h('div', { class: 'alarm' }, h('div', { class: 'ring' }, icon('bell')), h('h2', {}, title), h('p', { class: 'muted' }, body),
    h('div', { class: 'modal-actions', style: { justifyContent: 'center' } }, h('button', { class: 'btn primary', onclick: () => close() }, 'Parar alarme'))),
  { onClose: () => { clearInterval(alarmLoop); alarmLoop = null; } });
  setTimeout(() => { clearInterval(alarmLoop); }, 60000);
}

let ticker = null;
let lastBreak = Date.now();
function startTicker() { stopTicker(); tick(); ticker = setInterval(() => { if (document.visibilityState === 'visible') tick(); }, 30000); }
function stopTicker() { clearInterval(ticker); ticker = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ticker) tick(); });
on('tick', () => setTimeout(tick, 200));
async function tick() {
  if (!state.user) return;
  try {
    const r = await api('/api/tick');
    for (const n of r.notifications) {
      if (n.kind === 'alarme') alarm(n.title, n.body);
      else { toast(n.title, n.body, { ms: 9000 }); beep(); systemNotify(n.title, n.body); }
    }
    if (r.notifications.length) emit('data');
  } catch (_) {}
  const every = Number(state.settings.break_reminder || 0);
  if (every > 0 && Date.now() - lastBreak > every * 60000) {
    lastBreak = Date.now();
    toast('Hora de uma pausa', 'Levante, alongue-se e beba água.', { ms: 9000 });
    systemNotify('Hora de uma pausa', 'Levante, alongue-se e beba água.');
  }
}

boot();
