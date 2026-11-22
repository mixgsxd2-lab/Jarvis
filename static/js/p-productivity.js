// Painel Produtividade: Pomodoro, pausas, metas, rotinas automáticas, histórico de foco e relatórios PDF.
import { api, barChart, beep, clear, confirmBox, fail, formBox, h, state, systemNotify, tabs, toast } from './core.js';
import { speak } from './voice.js';

// ====================================================================== Pomodoro (continua rodando fora do painel)
const P = {
  mode: 'foco', running: false, endAt: 0, remaining: 0, total: 0, cycle: 0, label: '', startedAt: 0, ui: null, iv: null,
};
const MODES = { foco: 'Foco', curta: 'Pausa curta', longa: 'Pausa longa' };
function dur(mode) {
  const s = state.settings;
  return 60 * Number(mode === 'foco' ? s.pomodoro_focus || 25 : mode === 'curta' ? s.pomodoro_short || 5 : s.pomodoro_long || 15);
}
function persist() { try { localStorage.setItem('jarvis:pomo', JSON.stringify({ ...P, ui: null, iv: null })); } catch (_) {} }
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem('jarvis:pomo') || 'null');
    if (s) Object.assign(P, s, { ui: null, iv: null });
  } catch (_) {}
  if (!P.total) { P.total = dur(P.mode); P.remaining = P.total; }
  if (P.running) startLoop();
}
function setMode(mode, minutes) {
  P.mode = mode; P.running = false; P.total = minutes ? minutes * 60 : dur(mode); P.remaining = P.total; persist(); draw();
}
function start() {
  if (P.running) return;
  P.running = true; P.endAt = Date.now() + P.remaining * 1000; P.startedAt = P.startedAt || Date.now(); persist(); startLoop(); draw();
}
function pause() { if (!P.running) return; P.running = false; P.remaining = Math.max(0, Math.round((P.endAt - Date.now()) / 1000)); persist(); draw(); }
function reset() { P.running = false; P.startedAt = 0; P.remaining = P.total = dur(P.mode); persist(); draw(); }
function startLoop() { clearInterval(P.iv); P.iv = setInterval(loop, 500); loop(); }
function loop() {
  if (!P.running) { clearInterval(P.iv); return; }
  P.remaining = Math.max(0, Math.round((P.endAt - Date.now()) / 1000));
  if (P.remaining <= 0) finish(); else draw();
}
async function finish() {
  clearInterval(P.iv);
  const minutes = P.total / 60;
  const kind = P.mode === 'foco' ? 'foco' : 'pausa';
  P.running = false;
  api('/api/focus', { method: 'POST', body: { minutes, kind, label: P.label } }).catch(() => {});
  beep([[784, .2], [0, .08], [988, .2], [0, .08], [1318, .35]], .3);
  let next; let msg;
  if (P.mode === 'foco') {
    P.cycle += 1;
    const long = P.cycle % Number(state.settings.pomodoro_cycles || 4) === 0;
    next = long ? 'longa' : 'curta';
    msg = `Foco concluído! Hora de uma ${long ? 'pausa longa' : 'pausa curta'}.`;
  } else { next = 'foco'; msg = 'Pausa encerrada. Vamos voltar ao foco?'; }
  toast('Pomodoro', msg, { ms: 9000 });
  systemNotify('Pomodoro', msg);
  speak(msg);
  P.startedAt = 0;
  setMode(next);
  if (next !== 'foco') start(); // pausas começam sozinhas
  window.dispatchEvent(new Event('jarvis:focus'));
}
function mmss(s) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function draw() {
  document.title = P.running ? `${mmss(P.remaining)} · ${MODES[P.mode]} — JARVIS` : 'JARVIS AI';
  const u = P.ui; if (!u || !u.ring.isConnected) return;
  const C = 2 * Math.PI * 54;
  u.bar.setAttribute('stroke-dasharray', C);
  u.bar.setAttribute('stroke-dashoffset', C * (1 - (P.total - P.remaining) / (P.total || 1)));
  u.ring.classList.toggle('break', P.mode !== 'foco');
  u.time.firstChild.textContent = mmss(P.remaining);
  u.sub.textContent = `${MODES[P.mode]} · ciclo ${P.cycle % Number(state.settings.pomodoro_cycles || 4) + (P.mode === 'foco' ? 1 : 0)}/${state.settings.pomodoro_cycles || 4}`;
  u.go.textContent = P.running ? 'Pausar' : (P.remaining < P.total ? 'Continuar' : 'Iniciar');
  u.modes.forEach((b) => b.classList.toggle('active', b.dataset.mode === P.mode));
}
restore();

// ====================================================================== painel
export async function render(root, ctx) {
  const view = h('div');
  root.append(tabs([['pomo', 'Pomodoro'], ['goals', 'Metas'], ['routines', 'Rotinas'], ['hist', 'Histórico e relatórios']], 'pomo', (k) => {
    clear(view); ({ pomo: pomodoro, goals, routines, hist: history })[k](view, ctx);
  }), view);
  pomodoro(view, ctx);
}

function pomodoro(view, ctx) {
  const auto = sessionStorage.getItem('jarvis:pomodoro');
  if (auto !== null) { sessionStorage.removeItem('jarvis:pomodoro'); setMode('foco', Number(auto) || undefined); start(); }
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 120 120');
  const track = document.createElementNS(NS, 'circle'); Object.entries({ cx: 60, cy: 60, r: 54, class: 'track' }).forEach(([k, v]) => track.setAttribute(k, v));
  const bar = document.createElementNS(NS, 'circle'); Object.entries({ cx: 60, cy: 60, r: 54, class: 'bar' }).forEach(([k, v]) => bar.setAttribute(k, v));
  svg.append(track, bar);
  const time = h('div', { class: 'pomo-time' }, '25:00', h('small', { class: 'muted' }, ''));
  const ring = h('div', { class: 'pomo-ring' }, svg, time);
  const modes = Object.entries(MODES).map(([k, l]) => h('button', { class: 'tab', 'data-mode': k, onclick: async () => { if (!P.running || await confirmBox('Trocar de modo e reiniciar o tempo?', { ok: 'Trocar' })) setMode(k); } }, l));
  const go = h('button', { class: 'btn primary', style: { minWidth: '130px' }, onclick: () => (P.running ? pause() : start()) }, 'Iniciar');
  const label = h('input', { placeholder: 'No que você vai focar? (opcional)', value: P.label, maxlength: 200, oninput: (e) => { P.label = e.target.value; persist(); } });
  const todayBox = h('div', { class: 'card', style: { marginTop: '1rem' } });
  view.append(h('div', { class: 'pomo stack' }, h('div', { class: 'tabs', style: { justifyContent: 'center' } }, modes), ring,
    h('div', { class: 'row', style: { justifyContent: 'center' } }, go, h('button', { class: 'btn', onclick: reset }, 'Reiniciar'),
      h('button', { class: 'btn ghost', onclick: () => { P.remaining = 1; P.endAt = Date.now() + 1000; if (!P.running) start(); } }, 'Pular')),
    label), todayBox);
  P.ui = { ring, bar, time, sub: time.querySelector('small'), go, modes };
  draw();
  const loadToday = async () => {
    const st = await api('/api/focus/stats?days=7').catch(() => null);
    if (!st) return;
    clear(todayBox).append(h('h3', {}, 'Hoje'),
      h('div', { class: 'progress' }, h('i', { style: { width: `${Math.min(100, (st.today / (st.goal || 1)) * 100)}%` } })),
      h('p', { class: 'muted' }, `${Math.round(st.today)} de ${st.goal} min de foco · ${st.streak} dia(s) seguidos`),
      h('p', { class: 'muted', style: { fontSize: '.82rem' } }, `Durações: foco ${state.settings.pomodoro_focus} min, pausa curta ${state.settings.pomodoro_short}, longa ${state.settings.pomodoro_long} (altere em Configurações).`));
  };
  loadToday();
  const onFocus = () => loadToday();
  const onStart = () => { const m = sessionStorage.getItem('jarvis:pomodoro'); sessionStorage.removeItem('jarvis:pomodoro'); setMode('foco', Number(m) || undefined); start(); };
  window.addEventListener('jarvis:focus', onFocus);
  window.addEventListener('jarvis:pomodoro', onStart);
  ctx.onCleanup(() => { P.ui = null; window.removeEventListener('jarvis:focus', onFocus); window.removeEventListener('jarvis:pomodoro', onStart); });
}

// ------------------------------------------------------------------ metas
async function goals(view) {
  const list = h('div', { class: 'stack' });
  view.append(h('div', { class: 'row', style: { marginBottom: '.8rem' } }, h('button', { class: 'btn primary', onclick: () => edit() }, '+ Nova meta')), list);
  async function edit(g) {
    const d = await formBox(g ? 'Editar meta' : 'Nova meta', [
      { name: 'title', label: 'Meta', value: g?.title || '', required: true, placeholder: 'Ex.: Ler livros' },
      { name: 'target', label: 'Objetivo (número)', type: 'number', step: 'any', value: g?.target ?? 10, required: true },
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
    if (!gs.length) list.append(h('div', { class: 'empty' }, 'Defina metas e acompanhe seu progresso.'));
    for (const g of gs) {
      list.append(h('div', { class: 'card' },
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, g.title), h('span', { class: 'badge' + (g.progress >= 100 ? ' ok' : '') }, `${Math.round(g.progress)}%`)),
        h('div', { class: 'progress', style: { margin: '.5rem 0' } }, h('i', { style: { width: `${g.progress}%` } })),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, `${g.current} / ${g.target} ${g.unit}${g.period !== 'nenhum' ? ' · ' + g.period : ''}`),
          h('button', { class: 'btn small ok', onclick: async () => { await api(`/api/goals/${g.id}`, { method: 'PATCH', body: { increment: 1 } }).catch(fail); load(); } }, '+1'),
          h('button', { class: 'btn small', onclick: () => edit(g) }, 'Editar'),
          h('button', { class: 'btn small danger', onclick: async () => { if (await confirmBox(`Excluir a meta “${g.title}”?`, { ok: 'Excluir', danger: true })) { await api(`/api/goals/${g.id}`, { method: 'DELETE' }).catch(fail); load(); } } }, 'Excluir'))));
    }
  }
  load();
}

// ------------------------------------------------------------------ rotinas
const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
async function routines(view) {
  const list = h('div', { class: 'stack' });
  view.append(h('p', { class: 'muted' }, 'Rotinas rodam sozinhas no horário: resumo do dia (clima, agenda e tarefas), mensagens, criação de tarefas ou início de foco.'),
    h('div', { class: 'row', style: { marginBottom: '.8rem' } }, h('button', { class: 'btn primary', onclick: () => edit() }, '+ Nova rotina')), list);
  async function edit(r) {
    const acts = r?.actions || [{ type: 'briefing', value: '' }];
    const has = (t) => acts.find((a) => a.type === t);
    const dayPick = h('div', { class: 'days-pick' }, DAYS.map((d, i) => h('label', {}, h('input', { type: 'checkbox', value: i, checked: (r?.days || [0, 1, 2, 3, 4]).includes(i) }), h('span', {}, d))));
    const d = await formBox(r ? 'Editar rotina' : 'Nova rotina', [
      { name: 'name', label: 'Nome', value: r?.name || 'Bom dia', required: true },
      { name: 'time', label: 'Horário', type: 'time', value: r?.time || '07:00', required: true },
      { name: 'briefing', label: 'Falar o resumo do dia (clima, agenda, tarefas)', type: 'checkbox', value: !!has('briefing') },
      { name: 'focus', label: 'Iniciar um Pomodoro', type: 'checkbox', value: !!has('focus') },
      { name: 'message', label: 'Mensagem personalizada (opcional)', value: has('message')?.value || '', placeholder: 'Ex.: Tomar o remédio' },
      { name: 'task', label: 'Criar tarefa (opcional)', value: has('task')?.value || '', placeholder: 'Ex.: Revisar e-mails' },
    ], { extra: h('label', {}, 'Dias', dayPick) });
    if (!d) return;
    const actions = [];
    if (d.briefing) actions.push({ type: 'briefing' });
    if (d.message.trim()) actions.push({ type: 'message', value: d.message.trim() });
    if (d.task.trim()) actions.push({ type: 'task', value: d.task.trim() });
    if (d.focus) actions.push({ type: 'focus' });
    const days = [...dayPick.querySelectorAll('input:checked')].map((i) => Number(i.value));
    try { await api(r ? `/api/routines/${r.id}` : '/api/routines', { method: r ? 'PATCH' : 'POST', body: { name: d.name, time: d.time, days, actions } }); load(); }
    catch (e) { fail(e); }
  }
  const actName = { briefing: 'resumo do dia', message: 'mensagem', task: 'criar tarefa', focus: 'Pomodoro' };
  async function load() {
    const rs = await api('/api/routines').catch((e) => { fail(e); return []; });
    clear(list);
    if (!rs.length) list.append(h('div', { class: 'empty' }, 'Nenhuma rotina. Que tal um “Bom dia” às 7h com o resumo do dia?'));
    for (const r of rs) {
      list.append(h('div', { class: 'card' },
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, `${r.time} · ${r.name}`),
          h('label', { class: 'check', style: { flex: '0 0 auto', margin: 0 } }, h('input', { type: 'checkbox', checked: r.enabled, onchange: async (e) => { await api(`/api/routines/${r.id}`, { method: 'PATCH', body: { enabled: e.target.checked } }).catch(fail); } }), 'Ativa')),
        h('div', { class: 'muted', style: { fontSize: '.85rem' } }, `${r.days.map((i) => DAYS[i]).join(', ') || 'nenhum dia'} · ${r.actions.map((a) => actName[a.type]).join(', ')}`),
        h('div', { class: 'row', style: { marginTop: '.5rem' } },
          h('button', { class: 'btn small', onclick: async () => { try { await api(`/api/routines/${r.id}/run`, { method: 'POST' }); toast('Rotina executada', 'O aviso aparece em instantes.'); window.dispatchEvent(new Event('jarvis:tick')); } catch (e) { fail(e); } } }, '▶ Executar agora'),
          h('button', { class: 'btn small', onclick: () => edit(r) }, 'Editar'),
          h('button', { class: 'btn small danger', onclick: async () => { if (await confirmBox(`Excluir a rotina “${r.name}”?`, { ok: 'Excluir', danger: true })) { await api(`/api/routines/${r.id}`, { method: 'DELETE' }).catch(fail); load(); } } }, 'Excluir'))));
    }
  }
  load();
}

// ------------------------------------------------------------------ histórico
async function history(view) {
  const box = h('div', { class: 'stack' }, h('div', { class: 'empty' }, 'Carregando…'));
  view.append(box);
  const st = await api('/api/focus/stats?days=14').catch((e) => { fail(e); return null; });
  clear(box);
  if (!st) return;
  box.append(
    h('div', { class: 'grid3' },
      h('div', { class: 'card stat' }, h('b', {}, `${Math.round(st.today)}`), h('small', {}, 'min hoje')),
      h('div', { class: 'card stat' }, h('b', {}, `${(st.total / 60).toFixed(1)}`), h('small', {}, 'horas em 14 dias')),
      h('div', { class: 'card stat' }, h('b', {}, `${Math.round(st.average)}`), h('small', {}, 'min/dia (média)')),
      h('div', { class: 'card stat' }, h('b', {}, `${st.sessions}`), h('small', {}, 'sessões de foco')),
      h('div', { class: 'card stat' }, h('b', {}, `${st.streak}`), h('small', {}, 'dias seguidos'))),
    h('div', { class: 'card' }, h('h3', {}, 'Minutos de foco por dia'),
      barChart(st.days.map((d) => ({ label: d.date.slice(8, 10), value: d.minutes })), { goal: st.goal }),
      h('small', {}, `Linha amarela: meta diária de ${st.goal} min.`)),
    h('div', { class: 'card' }, h('h3', {}, 'Relatórios em PDF'),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: '/api/report.pdf?days=7', download: '', style: { textDecoration: 'none' } }, '⬇ Últimos 7 dias'),
        h('a', { class: 'btn', href: '/api/report.pdf?days=30', download: '', style: { textDecoration: 'none' } }, '⬇ Últimos 30 dias'))),
    h('div', { class: 'card' }, h('h3', {}, 'Sessões recentes'),
      st.recent.length ? h('div', { class: 'list' }, st.recent.map((r) => h('div', { class: 'li', style: { cursor: 'default' } },
        h('span', {}, r.kind === 'foco' ? '🎯' : '☕'),
        h('div', { class: 'grow' }, h('span', { class: 't' }, r.label || (r.kind === 'foco' ? 'Foco' : 'Pausa')), h('div', { class: 'meta' }, r.started_at.replace('T', ' ').slice(0, 16))),
        h('b', {}, `${Math.round(r.minutes)} min`)))) : h('p', { class: 'muted' }, 'Nenhuma sessão ainda.')));
}
