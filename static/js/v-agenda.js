// Agenda: calendário do mês, compromissos recorrentes, aviso de conflito, lembretes, alarmes e notificações.
import { api, clear, confirmBox, dateKey, dayLabel, emit, fail, fmtDue, fmtTime, formBox, h, icon, MONTHS, onView, parseLocal, state, toast, toLocalISO } from './core.js';
import { openCapture, topbar } from './app.js';

const RECS = [['none', 'Não repete'], ['daily', 'Todo dia'], ['weekdays', 'Dias úteis (seg–sex)'], ['weekly', 'Toda semana'], ['monthly', 'Todo mês'], ['yearly', 'Todo ano']];
const REMS = [['', 'Sem aviso'], ['0', 'Na hora'], ['5', '5 min antes'], ['10', '10 min antes'], ['15', '15 min antes'], ['30', '30 min antes'], ['60', '1 hora antes'], ['1440', '1 dia antes']];
const REPEATS = [['none', 'Uma vez'], ['daily', 'Todo dia'], ['weekdays', 'Dias úteis'], ['weekly', 'Toda semana']];

let cursor = new Date(); cursor.setDate(1);
let selected = dateKey(new Date());
let tab = 'cal';

export async function render(root) {
  const seg = h('div', { class: 'seg' });
  const view = h('div', { style: { marginTop: '1rem' } });
  root.append(topbar('Agenda',
    h('button', { class: 'btn', onclick: () => reminderForm() }, icon('bell', 'sm'), 'Lembrete'),
    h('button', { class: 'btn primary', onclick: () => eventForm({ start: selected + 'T09:00', end: selected + 'T10:00' }) }, icon('plus', 'sm'), 'Compromisso')), seg, view);
  const draw = () => {
    clear(seg).append(...[['cal', 'Calendário'], ['rem', 'Lembretes e alarmes'], ['notif', 'Notificações']].map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; draw(); } }, l)));
    ({ cal: calendar, rem: reminders, notif: notifications })[tab](view);
  };
  draw();
  onView('data', () => { if (tab !== 'notif') draw(); });
}

// ------------------------------------------------------------------ calendário
async function calendar(view) {
  const ws = Number(state.settings.week_start || 0);
  const first = new Date(cursor);
  const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() - ws + 7) % 7));
  const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 42);
  let occ = [], rems = [], tasks = [];
  try {
    [occ, rems, tasks] = await Promise.all([api(`/api/events?start=${toLocalISO(gridStart)}&end=${toLocalISO(gridEnd)}`), api('/api/reminders'), api('/api/items?kind=task,subtask&status=pendente,andamento')]);
  } catch (e) { fail(e); }
  const byDay = {};
  const push = (k, x) => (byDay[k] ||= []).push(x);
  for (const o of occ) {
    const s = parseLocal(o.occ_start), e = parseLocal(o.occ_end);
    for (let d = new Date(s.getFullYear(), s.getMonth(), s.getDate()); d < e; d.setDate(d.getDate() + 1)) push(dateKey(d), { type: 'event', ...o });
  }
  for (const r of rems) push(r.at.slice(0, 10), { type: 'reminder', ...r });
  for (const t of tasks.filter((x) => x.due)) push(t.due.slice(0, 10), { type: 'task', ...t });

  const dows = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const grid = h('div', { class: 'cal' }, Array.from({ length: 7 }, (_, i) => h('div', { class: 'dow' }, dows[(i + ws) % 7])));
  const today = dateKey(new Date());
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
    const k = dateKey(d);
    const items = byDay[k] || [];
    grid.append(h('button', { class: `day ${d.getMonth() !== cursor.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''} ${k === selected ? 'sel' : ''}`,
      'aria-label': `${d.getDate()} de ${MONTHS[d.getMonth()]}${items.length ? `, ${items.length} item(ns)` : ''}`, onclick: () => { selected = k; calendar(clear(view)); } },
    h('span', { class: 'num' }, d.getDate()), h('span', { class: 'dots' }, items.slice(0, 3).map((x) => h('i', { class: x.type === 'event' ? '' : 'r' })))));
  }
  const cal = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', { style: { textTransform: 'capitalize' } }, `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost sm', onclick: () => { cursor = new Date(); cursor.setDate(1); selected = today; calendar(clear(view)); } }, 'Hoje'),
        h('button', { class: 'btn ghost icon sm', 'aria-label': 'Mês anterior', onclick: () => { cursor.setMonth(cursor.getMonth() - 1); calendar(clear(view)); } }, icon('back', 'sm')),
        h('button', { class: 'btn ghost icon sm', 'aria-label': 'Próximo mês', style: { transform: 'scaleX(-1)' }, onclick: () => { cursor.setMonth(cursor.getMonth() + 1); calendar(clear(view)); } }, icon('back', 'sm')))),
    grid);

  const sd = parseLocal(selected + 'T00:00');
  const items = (byDay[selected] || []).sort((a, b) => (a.occ_start || a.at || a.due || '').localeCompare(b.occ_start || b.at || b.due || ''));
  const day = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, `${dayLabel(sd)} · ${sd.getDate()} de ${MONTHS[sd.getMonth()]}`),
    h('button', { class: 'btn ghost sm', onclick: () => eventForm({ start: selected + 'T09:00', end: selected + 'T10:00' }) }, icon('plus', 'sm'), 'Agendar')));
  if (!items.length) day.append(h('div', { class: 'empty' }, 'Nada neste dia.'));
  const list = h('div', { class: 'list timeline' });
  for (const x of items) {
    if (x.type === 'event') {
      const meta = [x.all_day ? 'Dia inteiro' : `${fmtTime(x.occ_start)} – ${fmtTime(x.occ_end)}`];
      if (x.recurrence !== 'none') meta.push('↻ ' + RECS.find((r) => r[0] === x.recurrence)[1].toLowerCase());
      if (x.location) meta.push(x.location);
      list.append(h('div', { class: 'row-item', onclick: () => eventForm(x) }, h('span', { class: 'time' }, x.all_day ? 'dia' : fmtTime(x.occ_start)), icon('calendar', 'sm'),
        h('div', { class: 'grow' }, h('span', { class: 't' }, x.title), h('div', { class: 'meta' }, meta.join(' · ')))));
    } else if (x.type === 'reminder') {
      list.append(h('div', { class: 'row-item', onclick: () => reminderForm(x) }, h('span', { class: 'time' }, fmtTime(x.at)), icon('bell', 'sm'),
        h('div', { class: 'grow' }, h('span', { class: 't' }, x.title), h('div', { class: 'meta' }, x.kind === 'alarme' ? 'Alarme' : 'Lembrete'))));
    } else {
      list.append(h('div', { class: 'row-item', onclick: () => import('./item.js').then((m) => m.openItem(x.id)) }, h('span', { class: 'time' }, /T00:00/.test(x.due) ? '' : fmtTime(x.due)), icon('tasks', 'sm'),
        h('div', { class: 'grow' }, h('span', { class: 't' }, x.title), h('div', { class: 'meta' }, 'Prazo de tarefa'))));
    }
  }
  day.append(list);
  view.append(h('div', { class: 'cal-layout' }, cal, day));
}

async function eventForm(ev = {}) {
  const isNew = !ev.id;
  const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
  const later = new Date(now); later.setHours(now.getHours() + 1);
  const del = isNew ? null : h('button', { class: 'btn danger', type: 'button', onclick: async () => {
    document.querySelector('.modal')?.remove();
    if (!(await confirmBox(`Excluir “${ev.title}”${ev.recurrence !== 'none' ? ' (todas as repetições)' : ''}?`, { ok: 'Excluir', danger: true }))) return;
    try { await api(`/api/events/${ev.id}`, { method: 'DELETE' }); toast('Compromisso excluído'); emit('data'); } catch (e) { fail(e); }
  } }, icon('trash', 'sm'), 'Excluir');
  const d = await formBox(isNew ? 'Novo compromisso' : 'Editar compromisso', [
    { name: 'title', label: 'Título', value: ev.title || '', required: true },
    { name: 'start', label: 'Início', type: 'datetime-local', value: (ev.start || toLocalISO(now)).slice(0, 16), required: true },
    { name: 'end', label: 'Fim', type: 'datetime-local', value: (ev.end || toLocalISO(later)).slice(0, 16) },
    { name: 'all_day', label: 'Dia inteiro', type: 'checkbox', value: ev.all_day },
    { name: 'recurrence', label: 'Repetir', type: 'select', options: RECS, value: ev.recurrence || 'none' },
    { name: 'until', label: 'Repetir até (opcional)', type: 'date', value: ev.until ? ev.until.slice(0, 10) : '' },
    { name: 'reminder_minutes', label: 'Avisar', type: 'select', options: REMS, value: ev.reminder_minutes ?? (isNew ? '15' : '') },
    { name: 'alarm', label: 'Avisar com alarme sonoro', type: 'checkbox', value: ev.alarm },
    { name: 'location', label: 'Local', value: ev.location || '' },
    { name: 'notes', label: 'Observações', type: 'textarea', value: ev.notes || '' },
  ], { ok: isNew ? 'Agendar' : 'Salvar', extra: del });
  if (!d) return;
  const body = { ...d, reminder_minutes: d.reminder_minutes === '' ? null : Number(d.reminder_minutes), until: d.until || null };
  try {
    const chk = await api('/api/events/check', { method: 'POST', body: { ...body, id: ev.id } });
    if (chk.conflicts.length) {
      const names = chk.conflicts.slice(0, 3).map((c) => `“${c.title}” (${fmtDue(c.start)})`).join(', ');
      if (!(await confirmBox(`Conflito de horário com ${names}. Salvar mesmo assim?`, { ok: 'Salvar mesmo assim' }))) return;
    }
    await api(isNew ? '/api/events' : `/api/events/${ev.id}`, { method: isNew ? 'POST' : 'PATCH', body });
    toast(isNew ? 'Compromisso agendado' : 'Compromisso atualizado');
    selected = body.start.slice(0, 10);
    const sd = parseLocal(body.start); cursor = new Date(sd.getFullYear(), sd.getMonth(), 1);
    emit('data');
  } catch (e) { fail(e); }
}

async function reminderForm(r = {}) {
  const isNew = !r.id;
  const d0 = new Date(); d0.setMinutes(d0.getMinutes() + 30, 0, 0);
  const del = isNew ? null : h('button', { class: 'btn danger', type: 'button', onclick: async () => {
    document.querySelector('.modal')?.remove();
    try { await api(`/api/reminders/${r.id}`, { method: 'DELETE' }); toast('Removido'); emit('data'); } catch (e) { fail(e); }
  } }, icon('trash', 'sm'), 'Excluir');
  const d = await formBox(isNew ? 'Novo lembrete' : 'Editar lembrete', [
    { name: 'title', label: 'Lembrar de…', value: r.title || '', required: true },
    { name: 'at', label: 'Quando', type: 'datetime-local', value: (r.at || toLocalISO(d0)).slice(0, 16), required: true },
    { name: 'kind', label: 'Tipo', type: 'select', options: [['lembrete', 'Lembrete (aviso)'], ['alarme', 'Alarme (toca até parar)']], value: r.kind || 'lembrete' },
    { name: 'repeat', label: 'Repetir', type: 'select', options: REPEATS, value: r.repeat || 'none' },
  ], { ok: isNew ? 'Criar' : 'Salvar', extra: del });
  if (!d) return;
  try {
    await api(isNew ? '/api/reminders' : `/api/reminders/${r.id}`, { method: isNew ? 'POST' : 'PATCH', body: d });
    toast(d.kind === 'alarme' ? 'Alarme definido' : 'Lembrete criado', fmtDue(d.at));
    emit('data');
  } catch (e) { fail(e); }
}

async function reminders(view) {
  clear(view);
  const rs = await api('/api/reminders').catch((e) => { fail(e); return []; });
  if (!rs.length) { view.append(h('div', { class: 'card empty' }, 'Nenhum lembrete ou alarme ativo.', h('br'), h('button', { class: 'btn', style: { marginTop: '.7rem' }, onclick: () => openCapture('reminder') }, 'Criar lembrete'))); return; }
  view.append(h('div', { class: 'list boxed' }, rs.map((r) => h('div', { class: 'row-item', onclick: () => reminderForm(r) }, icon(r.kind === 'alarme' ? 'clock' : 'bell', 'sm'),
    h('div', { class: 'grow' }, h('span', { class: 't' }, r.title), h('div', { class: 'meta' }, fmtDue(r.at) + (r.repeat !== 'none' ? ' · ↻ ' + REPEATS.find((x) => x[0] === r.repeat)[1].toLowerCase() : ''))),
    h('span', { class: 'badge' + (r.kind === 'alarme' ? ' warn' : '') }, r.kind)))));
}

// ------------------------------------------------------------------ notificações
function b64ToBytes(b64) { const p = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); }

export async function enablePush() {
  if (!('Notification' in window)) throw new Error('Este navegador não suporta notificações. No iPhone, instale o app na Tela de Início primeiro.');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Permissão negada. Libere as notificações nas configurações do navegador.');
  const reg = await navigator.serviceWorker.ready;
  if (!reg.pushManager) return 'local';
  const { key } = await api('/api/push/key');
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  return 'push';
}

function notifications(view) {
  clear(view);
  const perm = 'Notification' in window ? Notification.permission : 'indisponível';
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  view.append(h('div', { class: 'card stack' },
    h('h2', {}, 'Avisos no celular e no computador'),
    h('p', { class: 'muted' }, 'Com o app aberto, lembretes, alarmes e prazos tocam um som e aparecem na tela. Ative as notificações para receber avisos também com o app fechado.'),
    isIOS && !standalone ? h('p', { class: 'badge warn' }, 'No iPhone, primeiro instale o app: Compartilhar → Adicionar à Tela de Início.') : null,
    h('p', {}, 'Situação: ', h('b', {}, ({ granted: 'permitidas', denied: 'bloqueadas', default: 'ainda não ativadas' })[perm] || perm)),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: async () => {
        try { const m = await enablePush(); toast('Notificações ativadas', m === 'push' ? 'Você receberá avisos mesmo com o app fechado.' : ''); notifications(view); } catch (e) { fail(e); }
      } }, icon('bell', 'sm'), 'Ativar notificações'),
      h('button', { class: 'btn', onclick: async () => {
        try { const r = await api('/api/push/test', { method: 'POST' }); toast(r.sent ? 'Notificação de teste enviada' : 'Nenhum aparelho inscrito ainda'); } catch (e) { fail(e); }
      } }, 'Enviar teste')),
    h('p', { class: 'faint small' }, 'No Render Free o servidor dorme sem uso. Para avisos com o app fechado, configure o cron-job.org chamando /cron/tick a cada 5 minutos (veja o README).')));
}
