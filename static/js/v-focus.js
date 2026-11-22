// Foco e metas: Pomodoro (continua rodando ao trocar de tela), metas, histórico e relatório em PDF.
import { api, barChart, beep, clear, confirmBox, emit, fail, formBox, h, icon, onView, state, systemNotify, toast } from './core.js';
import { topbar } from './app.js';

const P = { mode: 'foco', running: false, endAt: 0, remaining: 0, total: 0, cycle: 0, label: '', ui: null, iv: null };
const MODES = { foco: 'Foco', curta: 'Pausa curta', longa: 'Pausa longa' };
const dur = (m) => 60 * Number(m === 'foco' ? state.settings.pomodoro_focus || 25 : m === 'curta' ? state.settings.pomodoro_short || 5 : state.settings.pomodoro_long || 15);
function persist() { try { localStorage.setItem('jv:pomo', JSON.stringify({ ...P, ui: null, iv: null })); } catch (_) {} }
(function restore() {
  try { Object.assign(P, JSON.parse(localStorage.getItem('jv:pomo') || '{}'), { ui: null, iv: null }); } catch (_) {}
  if (P.running) loopStart();
})();
function setMode(m) { P.mode = m; P.running = false; P.total = P.remaining = dur(m); persist(); draw(); }
function start() { if (P.running) return; if (!P.total) setMode(P.mode); P.running = true; P.endAt = Date.now() + P.remaining * 1000; persist(); loopStart(); draw(); }
function pause() { if (!P.running) return; P.running = false; P.remaining = Math.max(0, Math.round((P.endAt - Date.now()) / 1000)); persist(); draw(); }
function reset() { P.running = false; P.total = P.remaining = dur(P.mode); persist(); draw(); }
function loopStart() { clearInterval(P.iv); P.iv = setInterval(loop, 500); loop(); }
function loop() {
  if (!P.running) { clearInterval(P.iv); return; }
  P.remaining = Math.max(0, Math.round((P.endAt - Date.now()) / 1000));
  if (P.remaining <= 0) finish(); else draw();
}
function finish() {
  clearInterval(P.iv);
  P.running = false;
  api('/api/focus', { method: 'POST', body: { minutes: P.total / 60, kind: P.mode === 'foco' ? 'foco' : 'pausa', label: P.label } }).then(() => emit('focus')).catch(() => {});
  beep([[784, .2], [0, .08], [988, .2], [0, .08], [1318, .35]], .25);
  let next, msg;
  if (P.mode === 'foco') {
    P.cycle += 1;
    const long = P.cycle % Number(state.settings.pomodoro_cycles || 4) === 0;
    next = long ? 'longa' : 'curta'; msg = `Bloco de foco concluído! Hora de uma ${long ? 'pausa longa' : 'pausa curta'}.`;
  } else { next = 'foco'; msg = 'Pausa encerrada. Bora para o próximo bloco?'; }
  toast('Pomodoro', msg, { ms: 9000 }); systemNotify('Pomodoro', msg);
  setMode(next);
  if (next !== 'foco') start();
}
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
function draw() {
  if (P.running) document.title = `${mmss(P.remaining)} · ${MODES[P.mode]}`;
  const u = P.ui; if (!u || !u.ring.isConnected) return;
  if (!P.total) { P.total = P.remaining = dur(P.mode); }
  const C = 2 * Math.PI * 54;
  u.bar.setAttribute('stroke-dasharray', C);
  u.bar.setAttribute('stroke-dashoffset', C * (1 - (P.total - P.remaining) / P.total));
  u.ring.classList.toggle('break', P.mode !== 'foco');
  u.time.firstChild.textContent = mmss(P.remaining);
  u.sub.textContent = MODES[P.mode];
  clear(u.go).append(icon(P.running ? 'pause' : 'play', 'sm'), P.running ? 'Pausar' : P.remaining < P.total ? 'Continuar' : 'Começar');
  u.seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === P.mode));
}

let tab = 'pomo';
export async function render(root) {
  const seg = h('div', { class: 'seg' });
  const view = h('div', { style: { marginTop: '1rem' } });
  root.append(topbar('Foco e metas'), seg, view);
  const go = () => {
    clear(seg).append(...[['pomo', 'Pomodoro'], ['metas', 'Metas'], ['hist', 'Histórico e relatórios']].map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; go(); } }, l)));
    clear(view);
    ({ pomo: pomodoro, metas: goals, hist: history })[tab](view);
  };
  go();
}

function pomodoro(view) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 120 120');
  const mk = (cls) => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', 60); c.setAttribute('cy', 60); c.setAttribute('r', 54); c.setAttribute('class', cls); return c; };
  const bar = mk('bar'); svg.append(mk('track'), bar);
  const time = h('div', { class: 'pomo-time' }, '25:00', h('small', {}));
  const ring = h('div', { class: 'pomo-ring' }, svg, time);
  const segM = h('div', { class: 'seg' }, Object.entries(MODES).map(([k, l]) => h('button', { 'data-m': k, onclick: async () => {
    if (P.running && !(await confirmBox('Trocar de modo e reiniciar o tempo?', { ok: 'Trocar' }))) return; setMode(k);
  } }, l)));
  const goBtn = h('button', { class: 'btn primary', style: { minWidth: '140px' }, onclick: () => (P.running ? pause() : start()) });
  const label = h('input', { placeholder: 'No que você vai focar? (opcional)', value: P.label, style: { maxWidth: '380px' }, oninput: (e) => { P.label = e.target.value; persist(); } });
  const todayBox = h('div', { class: 'card', style: { maxWidth: '520px', margin: '0 auto', width: '100%' } });
  view.append(h('div', { class: 'card' }, h('div', { class: 'pomo' }, segM, ring,
    h('div', { class: 'row', style: { justifyContent: 'center' } }, goBtn, h('button', { class: 'btn', onclick: reset }, 'Reiniciar'),
      h('button', { class: 'btn ghost', onclick: () => { if (!P.running) start(); P.endAt = Date.now() + 500; } }, 'Pular')), label, todayBox)));
  P.ui = { ring, bar, time, sub: time.querySelector('small'), go: goBtn, seg: segM };
  draw();
  const loadToday = async () => {
    const st = await api('/api/focus/stats?days=7').catch(() => null); if (!st) return;
    clear(todayBox).append(h('div', { class: 'row spread' }, h('b', {}, `${Math.round(st.today)} de ${st.goal} min hoje`), h('span', { class: 'muted small' }, `${st.streak} dia(s) seguidos`)),
      h('div', { class: 'progress', style: { marginTop: '.5rem' } }, h('i', { style: { width: Math.min(100, (st.today / (st.goal || 1)) * 100) + '%' } })));
  };
  loadToday();
  onView('focus', loadToday);
  state.cleanup.push(() => { P.ui = null; });
}

async function goals(view) {
  const list = h('div', { class: 'stack' });
  view.append(h('div', { class: 'row', style: { marginBottom: '.8rem' } }, h('button', { class: 'btn primary', onclick: () => edit() }, icon('plus', 'sm'), 'Nova meta')), list);
  async function edit(g) {
    const d = await formBox(g ? 'Editar meta' : 'Nova meta', [
      { name: 'title', label: 'Meta', value: g?.title || '', required: true, placeholder: 'Ex.: Ler livros' },
      { name: 'target', label: 'Objetivo', type: 'number', step: 'any', value: g?.target ?? 10, required: true },
      { name: 'current', label: 'Progresso atual', type: 'number', step: 'any', value: g?.current ?? 0 },
      { name: 'unit', label: 'Unidade', value: g?.unit || '', placeholder: 'livros, km, horas…' },
      { name: 'period', label: 'Período', type: 'select', value: g?.period || 'nenhum', options: [['nenhum', 'Sem período'], ['diaria', 'Diária'], ['semanal', 'Semanal'], ['mensal', 'Mensal']] },
    ]);
    if (!d) return;
    try { await api(g ? `/api/goals/${g.id}` : '/api/goals', { method: g ? 'PATCH' : 'POST', body: d }); load(); } catch (e) { fail(e); }
  }
  async function load() {
    const gs = await api('/api/goals').catch((e) => { fail(e); return []; });
    clear(list);
    if (!gs.length) list.append(h('div', { class: 'card empty' }, 'Defina metas e acompanhe o progresso.'));
    for (const g of gs) {
      list.append(h('div', { class: 'card' },
        h('div', { class: 'row spread' }, h('h2', {}, g.title), h('span', { class: 'badge' + (g.progress >= 100 ? ' ok' : ' accent') }, `${Math.round(g.progress)}%`)),
        h('div', { class: 'progress', style: { margin: '.6rem 0' } }, h('i', { style: { width: g.progress + '%', background: g.progress >= 100 ? 'var(--ok)' : null } })),
        h('div', { class: 'row' }, h('span', { class: 'muted grow' }, `${g.current} de ${g.target} ${g.unit}${g.period !== 'nenhum' ? ' · ' + g.period : ''}`),
          h('button', { class: 'btn sm', onclick: async () => { await api(`/api/goals/${g.id}`, { method: 'PATCH', body: { increment: 1 } }).catch(fail); load(); } }, '+1'),
          h('button', { class: 'btn ghost sm', onclick: () => edit(g) }, 'Editar'),
          h('button', { class: 'btn ghost icon sm', 'aria-label': 'Excluir meta', onclick: async () => { if (await confirmBox(`Excluir a meta “${g.title}”?`, { ok: 'Excluir', danger: true })) { await api(`/api/goals/${g.id}`, { method: 'DELETE' }).catch(fail); load(); } } }, icon('trash', 'sm')))));
    }
  }
  load();
}

async function history(view) {
  const st = await api('/api/focus/stats?days=14').catch((e) => { fail(e); return null; });
  if (!st) return;
  const stat = (n, l) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, l));
  view.append(
    h('div', { class: 'stats' }, stat(`${Math.round(st.today)}m`, 'hoje'), stat(`${(st.total / 60).toFixed(1)}h`, 'em 14 dias'), stat(`${Math.round(st.average)}m`, 'média por dia'), stat(st.streak, 'dias seguidos')),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Minutos de foco por dia'), h('span', { class: 'faint small' }, `meta: ${st.goal} min`)),
      barChart(st.days.map((d) => ({ label: d.date.slice(8, 10), value: d.minutes })), { goal: st.goal })),
    h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h3', {}, 'Relatório em PDF'),
      h('p', { class: 'muted small' }, 'Resumo do foco, tarefas concluídas e pendentes, projetos e metas.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: '/api/report.pdf?days=7', download: '' }, icon('download', 'sm'), 'Últimos 7 dias'),
        h('a', { class: 'btn', href: '/api/report.pdf?days=30', download: '' }, icon('download', 'sm'), 'Últimos 30 dias'))));
}
