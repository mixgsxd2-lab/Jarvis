// Painel Agenda: calendário, compromissos recorrentes, conflitos, lembretes, alarmes e notificações.
import { $, api, clear, confirmBox, dateKey, fail, fmtDate, fmtTime, formBox, h, MONTHS, parseLocal, tabs, toast, toLocalISO } from './core.js';

const RECS = [['none', 'Não repete'], ['daily', 'Todo dia'], ['weekdays', 'Dias úteis (seg–sex)'], ['weekly', 'Toda semana'], ['monthly', 'Todo mês'], ['yearly', 'Todo ano']];
const REMS = [['', 'Sem lembrete'], ['0', 'Na hora'], ['5', '5 min antes'], ['10', '10 min antes'], ['15', '15 min antes'], ['30', '30 min antes'], ['60', '1 hora antes'], ['120', '2 horas antes'], ['1440', '1 dia antes']];
const REPEATS = [['none', 'Uma vez'], ['daily', 'Todo dia'], ['weekdays', 'Dias úteis'], ['weekly', 'Toda semana']];

export async function render(root, ctx) {
  const view = h('div');
  root.append(tabs([['cal', 'Calendário'], ['rem', 'Lembretes e alarmes'], ['notif', 'Notificações']], 'cal',
    (k) => (k === 'cal' ? calendar(view) : k === 'rem' ? reminders(view) : notifications(view))), view);
  const reload = () => { if (view.dataset.tab === 'cal') calendar(view); else if (view.dataset.tab === 'rem') reminders(view); };
  window.addEventListener('jarvis:data', reload);
  ctx.onCleanup(() => window.removeEventListener('jarvis:data', reload));
  calendar(view);
}

// ------------------------------------------------------------------ calendário
let cursor = new Date(); cursor.setDate(1);
let selected = dateKey(new Date());

async function calendar(view) {
  clear(view);
  view.dataset.tab = 'cal';
  const calBox = h('div', { class: 'card' });
  const dayBox = h('div', { class: 'card' });
  view.append(h('div', { class: 'row', style: { marginBottom: '.8rem' } },
    h('button', { class: 'btn primary', onclick: () => eventForm(null, view) }, '+ Compromisso'),
    h('button', { class: 'btn', onclick: () => reminderForm(null, view) }, '+ Lembrete / alarme')),
  h('div', { class: 'layout-2' }, calBox, dayBox));

  const first = new Date(cursor);
  const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 7) % 7));
  const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 42);
  let occ = [];
  try { occ = await api(`/api/events?start=${toLocalISO(gridStart)}&end=${toLocalISO(gridEnd)}`); } catch (e) { fail(e); }
  const rems = await api('/api/reminders').catch(() => []);
  const byDay = {};
  for (const o of occ) {
    const s = parseLocal(o.occ_start), e = parseLocal(o.occ_end);
    for (let d = new Date(s.getFullYear(), s.getMonth(), s.getDate()); d < e; d.setDate(d.getDate() + 1)) {
      (byDay[dateKey(d)] ||= []).push(o);
    }
    if (+s === +e) (byDay[dateKey(s)] ||= []).push(o);
  }
  for (const r of rems) (byDay[r.at.slice(0, 10)] ||= []).push({ reminder: true, ...r });

  calBox.append(h('div', { class: 'cal-head' },
    h('button', { class: 'icon-btn', 'aria-label': 'Mês anterior', onclick: () => { cursor.setMonth(cursor.getMonth() - 1); calendar(view); } }, '‹'),
    h('b', {}, `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`),
    h('button', { class: 'icon-btn', 'aria-label': 'Próximo mês', onclick: () => { cursor.setMonth(cursor.getMonth() + 1); calendar(view); } }, '›')));
  const grid = h('div', { class: 'cal' }, ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d) => h('div', { class: 'dow' }, d)));
  const today = dateKey(new Date());
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
    const k = dateKey(d);
    const n = (byDay[k] || []).length;
    grid.append(h('button', {
      class: `day ${d.getMonth() !== cursor.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''} ${k === selected ? 'sel' : ''}`,
      'aria-label': `${d.getDate()} de ${MONTHS[d.getMonth()]}${n ? `, ${n} item(ns)` : ''}`,
      onclick: () => { selected = k; calendar(view); },
    }, String(d.getDate()), h('span', { class: 'dots' }, Array.from({ length: Math.min(n, 4) }, () => h('i')))));
  }
  calBox.append(grid, h('div', { class: 'row', style: { marginTop: '.6rem' } },
    h('button', { class: 'btn small ghost', onclick: () => { cursor = new Date(); cursor.setDate(1); selected = today; calendar(view); } }, 'Hoje')));

  const sd = parseLocal(selected + 'T00:00');
  dayBox.append(h('h3', {}, fmtDate(sd, false) + ` · ${sd.getDate()} de ${MONTHS[sd.getMonth()]}`));
  const items = (byDay[selected] || []).sort((a, b) => (a.occ_start || a.at).localeCompare(b.occ_start || b.at));
  if (!items.length) dayBox.append(h('div', { class: 'empty' }, 'Nada agendado.'),
    h('button', { class: 'btn small', onclick: () => eventForm({ start: selected + 'T09:00', end: selected + 'T10:00' }, view) }, '+ Agendar neste dia'));
  const list = h('div', { class: 'list' });
  for (const o of items) {
    if (o.reminder) {
      list.append(h('div', { class: 'li', onclick: () => reminderForm(o, view) }, h('span', {}, o.kind === 'alarme' ? '⏰' : '🔔'),
        h('div', { class: 'grow' }, h('span', { class: 't' }, o.title), h('div', { class: 'meta' }, `${o.kind} · ${fmtTime(o.at)}`))));
      continue;
    }
    const meta = [o.all_day ? 'Dia inteiro' : `${fmtTime(o.occ_start)}–${fmtTime(o.occ_end)}`];
    if (o.recurrence !== 'none') meta.push('↻ ' + RECS.find((r) => r[0] === o.recurrence)[1]);
    if (o.location) meta.push('📍 ' + o.location);
    if (o.reminder_minutes != null) meta.push(o.alarm ? '⏰ alarme' : '🔔 lembrete');
    list.append(h('div', { class: 'li', onclick: () => eventForm(o, view) }, h('span', {}, '📅'),
      h('div', { class: 'grow' }, h('span', { class: 't' }, o.title), h('div', { class: 'meta' }, meta.join(' · ')))));
  }
  dayBox.append(list);
}

async function eventForm(ev, view) {
  const isNew = !ev || !ev.id;
  const base = ev || {};
  const now = new Date(); now.setMinutes(0, 0, 0); now.setHours(now.getHours() + 1);
  const later = new Date(now); later.setHours(now.getHours() + 1);
  const data = await formBox(isNew ? 'Novo compromisso' : 'Editar compromisso', [
    { name: 'title', label: 'Título', value: base.title || '', required: true },
    { name: 'start', label: 'Início', type: 'datetime-local', value: (base.start || toLocalISO(now)).slice(0, 16), required: true },
    { name: 'end', label: 'Fim', type: 'datetime-local', value: (base.end || toLocalISO(later)).slice(0, 16) },
    { name: 'all_day', label: 'Dia inteiro', type: 'checkbox', value: base.all_day },
    { name: 'recurrence', label: 'Repetir', type: 'select', options: RECS, value: base.recurrence || 'none' },
    { name: 'until', label: 'Repetir até (opcional)', type: 'date', value: base.until ? base.until.slice(0, 10) : '' },
    { name: 'reminder_minutes', label: 'Lembrete', type: 'select', options: REMS, value: base.reminder_minutes ?? (isNew ? '15' : '') },
    { name: 'alarm', label: 'Tocar como alarme (som contínuo)', type: 'checkbox', value: base.alarm },
    { name: 'location', label: 'Local', value: base.location || '' },
    { name: 'notes', label: 'Observações', type: 'textarea', value: base.notes || '' },
  ], { ok: isNew ? 'Agendar' : 'Salvar', extra: isNew ? null : h('button', { class: 'btn danger', type: 'button', style: { marginTop: '.5rem' }, onclick: async () => {
    $('#modal').hidden = true;
    if (!(await confirmBox(`Excluir “${base.title}”${base.recurrence !== 'none' ? ' (todas as repetições)' : ''}?`, { ok: 'Excluir', danger: true }))) return;
    try { await api(`/api/events/${base.id}`, { method: 'DELETE' }); toast('Compromisso excluído'); calendar(view); } catch (e) { fail(e); }
  } }, 'Excluir compromisso') });
  if (!data) return;
  const body = { ...data, reminder_minutes: data.reminder_minutes === '' ? null : Number(data.reminder_minutes), until: data.until || null };
  try {
    const chk = await api('/api/events/check', { method: 'POST', body: { ...body, id: base.id } });
    if (chk.conflicts.length) {
      const names = chk.conflicts.slice(0, 3).map((c) => `“${c.title}” (${fmtDate(c.start)})`).join(', ');
      if (!(await confirmBox(`Conflito de horário com ${names}. Salvar mesmo assim?`, { ok: 'Salvar mesmo assim' }))) return;
    }
    if (isNew) await api('/api/events', { method: 'POST', body });
    else await api(`/api/events/${base.id}`, { method: 'PATCH', body });
    toast(isNew ? 'Compromisso agendado' : 'Compromisso atualizado');
    selected = body.start.slice(0, 10);
    const sd = parseLocal(body.start); cursor = new Date(sd.getFullYear(), sd.getMonth(), 1);
    calendar(view);
  } catch (e) { fail(e); }
}

async function reminderForm(r, view) {
  const isNew = !r || !r.id;
  const d = new Date(); d.setMinutes(d.getMinutes() + 30, 0, 0);
  const data = await formBox(isNew ? 'Novo lembrete ou alarme' : 'Editar', [
    { name: 'title', label: 'Descrição', value: r?.title || '', required: true },
    { name: 'at', label: 'Quando', type: 'datetime-local', value: (r?.at || toLocalISO(d)).slice(0, 16), required: true },
    { name: 'kind', label: 'Tipo', type: 'select', options: [['lembrete', 'Lembrete (aviso)'], ['alarme', 'Alarme (som até parar)']], value: r?.kind || 'lembrete' },
    { name: 'repeat', label: 'Repetir', type: 'select', options: REPEATS, value: r?.repeat || 'none' },
  ], { ok: isNew ? 'Criar' : 'Salvar', extra: isNew ? null : h('button', { class: 'btn danger', type: 'button', style: { marginTop: '.5rem' }, onclick: async () => {
    $('#modal').hidden = true;
    try { await api(`/api/reminders/${r.id}`, { method: 'DELETE' }); toast('Removido'); view.dataset.tab === 'rem' ? reminders(view) : calendar(view); } catch (e) { fail(e); }
  } }, 'Excluir') });
  if (!data) return;
  try {
    if (isNew) await api('/api/reminders', { method: 'POST', body: data });
    else await api(`/api/reminders/${r.id}`, { method: 'PATCH', body: data });
    toast(data.kind === 'alarme' ? 'Alarme definido' : 'Lembrete criado', fmtDate(data.at));
    if (view.dataset.tab === 'rem') reminders(view); else calendar(view);
  } catch (e) { fail(e); }
}

// ------------------------------------------------------------------ lembretes
async function reminders(view) {
  clear(view);
  view.dataset.tab = 'rem';
  const list = h('div', { class: 'list' });
  view.append(h('div', { class: 'row', style: { marginBottom: '.8rem' } },
    h('button', { class: 'btn primary', onclick: () => reminderForm(null, view) }, '+ Lembrete / alarme')), list);
  const rs = await api('/api/reminders').catch((e) => { fail(e); return []; });
  if (!rs.length) list.append(h('div', { class: 'empty' }, 'Nenhum lembrete ou alarme ativo.'));
  for (const r of rs) {
    list.append(h('div', { class: 'li', onclick: () => reminderForm(r, view) }, h('span', {}, r.kind === 'alarme' ? '⏰' : '🔔'),
      h('div', { class: 'grow' }, h('span', { class: 't' }, r.title),
        h('div', { class: 'meta' }, fmtDate(r.at) + (r.repeat !== 'none' ? ' · ↻ ' + REPEATS.find((x) => x[0] === r.repeat)[1] : ''))),
      h('span', { class: 'badge' + (r.kind === 'alarme' ? ' warn' : '') }, r.kind)));
  }
}

// ------------------------------------------------------------------ notificações
function b64ToBytes(b64) { const p = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); }

export async function enablePush() {
  if (!('Notification' in window)) throw new Error('Este navegador não suporta notificações. No iPhone, instale o app na tela de início primeiro.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão de notificação negada. Libere nas configurações do navegador.');
  const reg = await navigator.serviceWorker.ready;
  if (!reg.pushManager) return 'local';
  const { key } = await api('/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  return 'push';
}

async function notifications(view) {
  clear(view);
  view.dataset.tab = 'notif';
  const status = h('p', {});
  const perm = 'Notification' in window ? Notification.permission : 'indisponível';
  status.textContent = `Permissão atual: ${({ granted: 'permitida', denied: 'bloqueada', default: 'ainda não pedida' })[perm] || perm}.`;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  view.append(h('div', { class: 'card stack' },
    h('h3', {}, 'Avisos de lembretes, alarmes e alertas'),
    h('p', { class: 'muted' }, 'Com o app aberto, o JARVIS toca o som, fala e mostra o aviso. Para receber avisos com o app fechado, ative as notificações push abaixo.'),
    isIOS && !standalone ? h('p', { class: 'badge warn' }, 'No iPhone: primeiro instale o app (Compartilhar → Adicionar à Tela de Início) e abra pelo ícone.') : null,
    status,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: async () => {
        try { const mode = await enablePush(); toast('Notificações ativadas', mode === 'push' ? 'Você receberá avisos mesmo com o app fechado.' : 'Avisos com o app aberto.'); notifications(view); }
        catch (e) { fail(e); }
      } }, 'Ativar notificações'),
      h('button', { class: 'btn', onclick: async () => {
        try { const r = await api('/api/push/test', { method: 'POST' }); toast(r.sent ? 'Notificação de teste enviada' : 'Nenhum aparelho inscrito ainda', r.sent ? '' : 'Toque em “Ativar notificações” primeiro.'); }
        catch (e) { fail(e); }
      } }, 'Testar')),
    h('p', { class: 'muted', style: { fontSize: '.82rem' } }, 'Importante no Render Free: o servidor “dorme” sem uso. Para lembretes com o app fechado, configure um agendador gratuito (cron-job.org) chamando /cron/tick a cada 5 minutos — veja o README.')));
}
