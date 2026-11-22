// Tela Hoje: resumo do dia, captura rápida, atrasadas, agenda, próximos dias, projetos e ideias.
import { api, clear, DOW_LONG, emit, fail, fmtTime, h, icon, MONTHS, onView, state, toast } from './core.js';
import { openCapture } from './app.js';
import { openItem, taskRow } from './item.js';

export async function render(root) {
  const box = h('div');
  root.append(box);
  await draw(box);
  onView('data', () => draw(box));
}

async function draw(box) {
  let t;
  try { t = await api('/api/today'); } catch (e) { fail(e); return; }
  const now = new Date();
  const hour = now.getHours();
  const nome = state.settings.name ? `, ${state.settings.name}` : '';
  const saud = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const quick = h('input', { placeholder: 'Nova tarefa… ex.: “enviar relatório amanhã 10h”', 'aria-label': 'Nova tarefa rápida' });

  const stat = (n, label, cls = '') => h('div', { class: 'stat' }, h('b', { class: cls }, n), h('span', {}, label));
  const section = (title, items, opts = {}) => {
    if (!items.length && !opts.always) return null;
    return h('section', { class: 'card', style: { padding: '.9rem .9rem .5rem' } },
      h('div', { class: 'card-head' }, h('h3', { class: opts.cls || '' }, title), opts.right || h('span', { class: 'badge' }, items.length)),
      items.length ? h('div', { class: 'list' }, items.map((i) => taskRow(i))) : h('div', { class: 'empty' }, opts.empty || 'Nada por aqui.'));
  };

  const agenda = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Agenda de hoje'),
    h('a', { href: '#agenda', class: 'small' }, 'Ver agenda')));
  if (!t.agenda.length) agenda.append(h('div', { class: 'empty' }, 'Nenhum compromisso ou lembrete hoje.'));
  else agenda.append(h('div', { class: 'list timeline' }, t.agenda.map((a) => h('div', { class: 'row-item', onclick: () => { location.hash = 'agenda'; } },
    h('span', { class: 'time' }, a.all_day ? 'dia' : fmtTime(a.start)),
    icon(a.type === 'event' ? 'calendar' : 'bell', 'sm'),
    h('div', { class: 'grow' }, h('span', { class: 't' }, a.title), a.location ? h('div', { class: 'meta' }, a.location) : null),
    a.type === 'reminder' && a.kind === 'alarme' ? h('span', { class: 'badge warn' }, 'alarme') : null))));

  const projects = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Projetos ativos'), h('a', { href: '#projetos', class: 'small' }, 'Ver todos')));
  if (!t.projects.length) projects.append(h('div', { class: 'empty' }, 'Nenhum projeto em andamento.'));
  for (const p of t.projects) {
    const pct = p.children_count ? Math.round((p.children_done / p.children_count) * 100) : 0;
    projects.append(h('a', { href: `#projetos/${p.id}`, style: { display: 'block', textDecoration: 'none', color: 'inherit', padding: '.45rem 0' } },
      h('div', { class: 'row spread' }, h('span', { class: 'row' }, h('span', { class: 'dot', style: { background: p.color || 'var(--accent)' } }), h('b', {}, p.title)),
        h('span', { class: 'faint small' }, `${p.children_done}/${p.children_count}`)),
      h('div', { class: 'progress', style: { marginTop: '.35rem' } }, h('i', { style: { width: pct + '%', background: p.color || 'var(--accent)' } }))));
  }

  const ideas = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Ideias recentes'),
    h('button', { class: 'btn ghost sm', onclick: () => openCapture('idea') }, icon('plus', 'sm'), 'Ideia')));
  if (!t.ideas.length) ideas.append(h('div', { class: 'empty' }, 'Guarde ideias aqui antes que elas fujam.'));
  else ideas.append(h('div', { class: 'list' }, t.ideas.map((i) => h('div', { class: 'row-item', onclick: () => openItem(i.id) }, icon('idea', 'sm'), h('span', { class: 't grow' }, i.title)))));

  const focusPct = t.focus.goal ? Math.min(100, (t.focus.today / t.focus.goal) * 100) : 0;
  clear(box).append(
    h('div', { class: 'hello' }, h('h1', {}, `${saud}${nome}`),
      h('p', {}, `${DOW_LONG[now.getDay()].replace(/^./, (c) => c.toUpperCase())}, ${now.getDate()} de ${MONTHS[now.getMonth()]}`)),
    h('form', { class: 'capture-inline', onsubmit: async (e) => {
      e.preventDefault();
      if (!quick.value.trim()) return;
      try { await api('/api/capture', { method: 'POST', body: { text: quick.value, kind: 'task' } }); quick.value = ''; toast('Tarefa criada'); emit('data'); } catch (ex) { fail(ex); }
    } }, icon('plus'), quick, h('button', { class: 'btn primary sm', type: 'submit' }, 'Adicionar')),
    h('div', { class: 'stats' },
      stat(t.today.length, 'para hoje'),
      stat(t.overdue.length, 'atrasadas', t.overdue.length ? 'danger-text' : ''),
      stat(t.counts.done_today, 'concluídas hoje', t.counts.done_today ? 'ok-text' : ''),
      h('a', { class: 'stat', href: '#foco', style: { textDecoration: 'none', color: 'inherit' } }, h('b', {}, `${Math.round(t.focus.today)}m`), h('span', {}, `foco (meta ${t.focus.goal}m)`),
        h('div', { class: 'progress', style: { marginTop: '.35rem' } }, h('i', { style: { width: focusPct + '%' } })))),
    h('div', { class: 'dash' },
      h('div', { class: 'stack' },
        section('Atrasadas', t.overdue, { cls: 'danger-text' }),
        section('Para hoje', t.today, { always: true, empty: t.overdue.length ? 'Nada novo para hoje. Que tal resolver as atrasadas?' : 'Dia livre! Adicione algo acima ou aproveite.' }),
        section('Próximos 7 dias', t.upcoming),
        section('Importantes sem data', t.important)),
      h('div', { class: 'stack' }, agenda, projects, ideas)));
}
