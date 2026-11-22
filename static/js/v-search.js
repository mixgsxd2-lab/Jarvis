// Busca geral em tarefas, projetos, ideias, anotações, compromissos e lembretes.
import { api, clear, debounce, fail, fmtDue, h, icon } from './core.js';
import { topbar } from './app.js';
import { KIND, openItem } from './item.js';

const KIND_ICON = { task: 'tasks', subtask: 'tasks', project: 'folder', idea: 'idea', note: 'note', research: 'search' };

export async function render(root) {
  const q = h('input', { type: 'search', placeholder: 'Buscar em tudo…', autofocus: true, 'aria-label': 'Buscar', style: { fontSize: '1.05rem' } });
  const out = h('div');
  root.append(topbar('Buscar'), h('div', { class: 'capture-inline' }, icon('search'), q), out);
  const run = debounce(async () => {
    const t = q.value.trim();
    clear(out);
    if (t.length < 2) { out.append(h('div', { class: 'empty' }, 'Digite pelo menos 2 letras. Dica: tecle “/” em qualquer tela para buscar.')); return; }
    let r; try { r = await api('/api/search?q=' + encodeURIComponent(t)); } catch (e) { fail(e); return; }
    const total = r.items.length + r.events.length + r.reminders.length;
    if (!total) { out.append(h('div', { class: 'card empty' }, `Nada encontrado para “${t}”.`)); return; }
    const group = (title, rows) => rows.length && out.append(h('div', { class: 'group-title' }, h('h3', {}, title), h('span', { class: 'badge' }, rows.length)), h('div', { class: 'list boxed' }, rows));
    group('Itens', r.items.map((i) => h('div', { class: 'row-item', onclick: () => (i.kind === 'project' ? (location.hash = `projetos/${i.id}`) : openItem(i.id)) },
      icon(KIND_ICON[i.kind] || 'note', 'sm'), h('div', { class: 'grow' }, h('span', { class: 't' }, i.title || '(sem título)'),
        h('div', { class: 'meta' }, KIND[i.kind], i.due ? ' · ' + fmtDue(i.due) : '', i.body ? ' · ' + i.body.slice(0, 60) : '')))));
    group('Compromissos', r.events.map((e) => h('div', { class: 'row-item', onclick: () => { location.hash = 'agenda'; } }, icon('calendar', 'sm'),
      h('div', { class: 'grow' }, h('span', { class: 't' }, e.title), h('div', { class: 'meta' }, fmtDue(e.start))))));
    group('Lembretes', r.reminders.map((x) => h('div', { class: 'row-item', onclick: () => { location.hash = 'agenda'; } }, icon('bell', 'sm'),
      h('div', { class: 'grow' }, h('span', { class: 't' }, x.title), h('div', { class: 'meta' }, fmtDue(x.at) + (x.done ? ' · concluído' : ''))))));
  }, 250);
  q.oninput = run;
  run();
}
