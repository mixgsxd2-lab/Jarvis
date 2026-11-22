// Tela Tarefas: filtros, agrupamento por prazo e adição rápida.
import { api, clear, dateKey, emit, fail, h, icon, onView, parseLocal, toast } from './core.js';
import { topbar } from './app.js';
import { taskRow } from './item.js';

const FILTERS = [['abertas', 'Abertas'], ['hoje', 'Hoje'], ['semana', 'Próximos 7 dias'], ['semdata', 'Sem data'], ['alta', 'Prioridade alta'], ['concluidas', 'Concluídas']];
let filter = 'abertas';
let sort = 'prazo';

export async function render(root) {
  const quick = h('input', { placeholder: 'Adicionar tarefa… (entende “amanhã 9h”, “sexta”, “em 2 horas”)', 'aria-label': 'Nova tarefa' });
  const chips = h('div', { class: 'chips' });
  const sortSel = h('select', { 'aria-label': 'Ordenar', style: { width: 'auto' }, onchange: (e) => { sort = e.target.value; load(); } },
    [['prazo', 'Ordenar por prazo'], ['prioridade', 'Por prioridade'], ['recentes', 'Mais recentes']].map(([v, l]) => h('option', { value: v, selected: sort === v }, l)));
  const q = h('input', { type: 'search', placeholder: 'Filtrar por texto…', 'aria-label': 'Filtrar', style: { maxWidth: '260px' } });
  const listBox = h('div');
  root.append(topbar('Tarefas'),
    h('form', { class: 'capture-inline', onsubmit: async (e) => {
      e.preventDefault(); if (!quick.value.trim()) return;
      try { await api('/api/capture', { method: 'POST', body: { text: quick.value, kind: 'task' } }); quick.value = ''; toast('Tarefa criada'); emit('data'); } catch (ex) { fail(ex); }
    } }, icon('plus'), quick, h('button', { class: 'btn primary sm', type: 'submit' }, 'Adicionar')),
    chips, h('div', { class: 'row', style: { margin: '.7rem 0' } }, q, sortSel), listBox);

  const drawChips = () => clear(chips).append(...FILTERS.map(([k, l]) => h('button', { class: 'chip' + (k === filter ? ' on' : ''), onclick: () => { filter = k; drawChips(); load(); } }, l)));
  drawChips();

  async function load() {
    let items;
    try { items = await api('/api/items?kind=task,subtask' + (q.value.trim() ? '&q=' + encodeURIComponent(q.value.trim()) : '')); } catch (e) { fail(e); return; }
    items = items.filter((i) => i.kind === 'task' || (i.kind === 'subtask' && i.due));
    const today = dateKey(new Date());
    const week = new Date(); week.setDate(week.getDate() + 7);
    const open = (i) => i.status !== 'concluida';
    const due = (i) => (i.due ? i.due.slice(0, 10) : null);
    const f = {
      abertas: open, hoje: (i) => open(i) && due(i) && due(i) <= today, semana: (i) => open(i) && due(i) && due(i) <= dateKey(week),
      semdata: (i) => open(i) && !i.due, alta: (i) => open(i) && i.priority >= 3, concluidas: (i) => !open(i),
    }[filter];
    items = items.filter(f);
    const bySort = {
      prazo: (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.priority - a.priority,
      prioridade: (a, b) => b.priority - a.priority || (a.due || '9999').localeCompare(b.due || '9999'),
      recentes: (a, b) => b.updated_at.localeCompare(a.updated_at),
    }[sort];
    if (filter === 'concluidas') items.sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
    else items.sort(bySort);
    clear(listBox);
    if (!items.length) { listBox.append(h('div', { class: 'card empty' }, filter === 'concluidas' ? 'Nenhuma tarefa concluída ainda.' : 'Nenhuma tarefa aqui. 🎉')); return; }
    if (filter === 'concluidas' || sort !== 'prazo') { listBox.append(h('div', { class: 'list boxed' }, items.map((i) => taskRow(i)))); return; }
    const groups = [['Atrasadas', []], ['Hoje', []], ['Amanhã', []], ['Próximos dias', []], ['Mais adiante', []], ['Sem data', []]];
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    for (const i of items) {
      const d = due(i);
      const g = !d ? 5 : d < today ? 0 : d === today ? 1 : d === dateKey(tomorrow) ? 2 : parseLocal(d) <= week ? 3 : 4;
      groups[g][1].push(i);
    }
    for (const [title, list] of groups) {
      if (!list.length) continue;
      listBox.append(h('div', { class: 'group-title' }, h('h3', { class: title === 'Atrasadas' ? 'danger-text' : '' }, title), h('span', { class: 'badge' }, list.length)),
        h('div', { class: 'list boxed' }, list.map((i) => taskRow(i))));
    }
  }
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  await load();
  onView('data', load);
}
