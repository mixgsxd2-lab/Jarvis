// Anotações: lista à esquerda e editor com salvamento automático à direita (no celular, um de cada vez).
import { api, clear, confirmBox, debounce, emit, fail, fmtUTC, h, icon, onView } from './core.js';
import { topbar } from './app.js';

let selected = null;

export async function render(root) {
  const q = h('input', { type: 'search', placeholder: 'Buscar anotações…', 'aria-label': 'Buscar anotações' });
  const list = h('div', { class: 'list boxed' });
  const editor = h('div', { class: 'card note-editor' });
  const layout = h('div', { class: 'notes-layout' }, h('div', { class: 'stack' }, q, list), editor);
  root.append(topbar('Anotações', h('button', { class: 'btn primary', onclick: create }, icon('plus'), 'Nova')), layout);
  const narrow = () => window.matchMedia('(max-width: 899px)').matches;

  async function create() {
    try { const n = await api('/api/items', { method: 'POST', body: { kind: 'note', title: '' } }); selected = n.id; await load(); open(n.id, true); } catch (e) { fail(e); }
  }
  async function load() {
    let notes;
    try { notes = await api('/api/items?kind=note&top=1' + (q.value.trim() ? '&q=' + encodeURIComponent(q.value.trim()) : '')); } catch (e) { fail(e); return; }
    notes = notes.filter((n) => n.status !== 'arquivada').sort((a, b) => (b.pinned - a.pinned) || b.updated_at.localeCompare(a.updated_at));
    clear(list);
    if (!notes.length) list.append(h('div', { class: 'empty' }, 'Nenhuma anotação.'));
    for (const n of notes) {
      list.append(h('div', { class: 'row-item', style: n.id === selected ? { background: 'var(--accent-soft)' } : null, onclick: () => open(n.id, true) },
        n.pinned ? icon('pin', 'sm') : icon('note', 'sm'),
        h('div', { class: 'grow' }, h('span', { class: 't' }, n.title || 'Sem título'),
          h('div', { class: 'meta' }, (n.body || '').slice(0, 70) || fmtUTC(n.updated_at)))));
    }
    if (!narrow() && !selected && notes.length) open(notes[0].id);
    if (!notes.length) clear(editor).append(h('div', { class: 'empty' }, 'Crie uma anotação para começar.'));
  }
  async function open(id, focus = false) {
    selected = id;
    let n;
    try { n = await api(`/api/items/${id}`); } catch (e) { fail(e); return; }
    const state = h('span', { class: 'save-state' });
    const pending = {};
    const save = debounce(async () => {
      const body = { ...pending }; for (const k of Object.keys(pending)) delete pending[k];
      if (!Object.keys(body).length) return;
      state.textContent = 'Salvando…';
      try { await api(`/api/items/${id}`, { method: 'PATCH', body }); state.textContent = 'Salvo'; load(); } catch (e) { state.textContent = 'Erro'; fail(e); }
    }, 600);
    const set = (k, v) => { pending[k] = v; state.textContent = 'Editando…'; save(); };
    const title = h('input', { class: 'title-input', value: n.title, placeholder: 'Título', oninput: (e) => set('title', e.target.value) });
    const text = h('textarea', { placeholder: 'Escreva aqui… tudo é salvo automaticamente.', oninput: (e) => set('body', e.target.value) }, n.body || '');
    clear(editor).append(
      h('div', { class: 'row', style: { marginBottom: '.6rem' } },
        narrow() ? h('button', { class: 'btn ghost sm', onclick: () => { save.flush(); editor.hidden = true; list.parentElement.hidden = false; selected = null; load(); } }, icon('back', 'sm'), 'Voltar') : null,
        state,
        h('button', { class: 'btn ghost sm', onclick: async () => { await api(`/api/items/${id}`, { method: 'PATCH', body: { pinned: !n.pinned } }).catch(fail); n.pinned = !n.pinned; load(); } }, icon('pin', 'sm'), n.pinned ? 'Desafixar' : 'Fixar'),
        h('button', { class: 'btn ghost sm', onclick: async () => { save.flush(); const m = await import('./item.js'); m.openItem(id); } }, 'Anexos e mais'),
        h('button', { class: 'btn ghost icon sm', 'aria-label': 'Excluir anotação', onclick: async () => {
          if (!(await confirmBox('Excluir esta anotação?', { ok: 'Excluir', danger: true }))) return;
          await api(`/api/items/${id}`, { method: 'DELETE' }).catch(fail); selected = null; emit('data');
          if (narrow()) { editor.hidden = true; list.parentElement.hidden = false; }
        } }, icon('trash', 'sm'))),
      title, h('div', { style: { height: '.6rem' } }), text);
    if (narrow()) { editor.hidden = false; list.parentElement.hidden = true; }
    state.textContent = '';
    if (focus) (n.title ? text : title).focus();
  }
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  if (narrow()) editor.hidden = true;
  await load();
  onView('data', () => { if (!document.activeElement?.closest('.note-editor')) load(); });
}
