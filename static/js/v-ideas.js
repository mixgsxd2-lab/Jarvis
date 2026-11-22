// Ideias: mural de cartões, filtro por situação e conversão em tarefa/projeto mantendo a ideia original.
import { api, clear, emit, fail, h, icon, onView, toast } from './core.js';
import { topbar } from './app.js';
import { openItem } from './item.js';

let filter = 'ativas';

export async function render(root) {
  const input = h('input', { placeholder: 'Anote uma ideia… (Enter para salvar)', 'aria-label': 'Nova ideia' });
  const chips = h('div', { class: 'chips', style: { marginBottom: '.9rem' } });
  const wall = h('div', { class: 'ideas' });
  root.append(topbar('Ideias'),
    h('form', { class: 'capture-inline', onsubmit: async (e) => {
      e.preventDefault(); if (!input.value.trim()) return;
      try { await api('/api/capture', { method: 'POST', body: { text: input.value, kind: 'idea' } }); input.value = ''; toast('Ideia guardada'); emit('data'); } catch (ex) { fail(ex); }
    } }, icon('idea'), input, h('button', { class: 'btn primary sm', type: 'submit' }, 'Guardar')), chips, wall);
  const drawChips = () => clear(chips).append(...[['ativas', 'Ativas'], ['avaliando', 'Avaliando'], ['convertida', 'Viraram tarefa/projeto'], ['arquivada', 'Arquivadas']]
    .map(([k, l]) => h('button', { class: 'chip' + (k === filter ? ' on' : ''), onclick: () => { filter = k; drawChips(); load(); } }, l)));
  drawChips();

  async function convert(i, to) {
    try {
      const n = await api(`/api/items/${i.id}/convert`, { method: 'POST', body: { to } });
      toast(to === 'task' ? 'Virou tarefa' : 'Virou projeto', 'A ideia original foi mantida.', { action: { label: 'Abrir', fn: () => (to === 'project' ? (location.hash = `projetos/${n.id}`) : openItem(n.id)) } });
      emit('data');
    } catch (e) { fail(e); }
  }
  async function load() {
    let items;
    try { items = await api('/api/items?kind=idea&top=1'); } catch (e) { fail(e); return; }
    items = items.filter((i) => (filter === 'ativas' ? ['nova', 'avaliando'].includes(i.status) : i.status === filter));
    clear(wall);
    if (!items.length) { wall.append(h('div', { class: 'card empty' }, filter === 'ativas' ? 'Nenhuma ideia ainda. Escreva a primeira acima!' : 'Nada por aqui.')); return; }
    for (const i of items) {
      wall.append(h('div', { class: 'idea', tabindex: 0, role: 'button', onclick: () => openItem(i.id), onkeydown: (e) => { if (e.key === 'Enter') openItem(i.id); } },
        h('b', {}, i.title || '(sem título)'), i.body ? h('p', {}, i.body) : null,
        h('div', { class: 'foot' },
          i.status === 'avaliando' ? h('span', { class: 'badge accent' }, 'avaliando') : null,
          i.children_count ? h('span', { class: 'badge' }, `${i.children_done}/${i.children_count} passos`) : null,
          ...(i.tags || []).map((t) => h('span', { class: 'badge' }, '#' + t))),
        ['nova', 'avaliando'].includes(i.status) ? h('div', { class: 'row', style: { marginTop: '.6rem' } },
          h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); convert(i, 'task'); } }, '→ Tarefa'),
          h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); convert(i, 'project'); } }, '→ Projeto'),
          h('button', { class: 'btn ghost sm', onclick: async (e) => { e.stopPropagation(); await api(`/api/items/${i.id}`, { method: 'PATCH', body: { status: 'arquivada' } }).catch(fail); emit('data'); } }, 'Arquivar')) : null));
    }
  }
  await load();
  onView('data', load);
}
