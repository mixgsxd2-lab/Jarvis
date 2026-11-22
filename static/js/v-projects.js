// Projetos: grade de projetos e página do projeto com lista ou quadro (kanban).
import { api, clear, confirmBox, debounce, emit, fail, fmtDue, formBox, h, icon, isLate, onView, toast } from './core.js';
import { openCapture, topbar } from './app.js';
import { COLORS, openItem, STATUS, taskRow } from './item.js';

let showDone = false;

export async function render(root, id) {
  if (id) return project(root, Number(id));
  const grid = h('div', { class: 'projects-grid' });
  const toggle = h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: showDone, onchange: (e) => { showDone = e.target.checked; load(); } }), 'Mostrar concluídos');
  root.append(topbar('Projetos', h('button', { class: 'btn primary', onclick: newProject }, icon('plus'), 'Novo projeto')),
    h('div', { class: 'row', style: { marginBottom: '.9rem' } }, toggle), grid);
  async function load() {
    let ps;
    try { ps = await api('/api/items?kind=project&top=1'); } catch (e) { fail(e); return; }
    if (!showDone) ps = ps.filter((p) => p.status !== 'concluida');
    clear(grid);
    if (!ps.length) grid.append(h('div', { class: 'card empty', style: { gridColumn: '1 / -1' } }, 'Nenhum projeto ainda. Crie um para agrupar tarefas, anotações e anexos.'));
    for (const p of ps) {
      const pct = p.children_count ? Math.round((p.children_done / p.children_count) * 100) : 0;
      const st = STATUS.project.find((s) => s[0] === p.status)?.[1] || p.status;
      grid.append(h('div', { class: 'project-card', style: { '--pc': p.color || 'var(--accent)' }, tabindex: 0, role: 'button',
        onclick: () => { location.hash = `projetos/${p.id}`; }, onkeydown: (e) => { if (e.key === 'Enter') location.hash = `projetos/${p.id}`; } },
      h('div', { class: 'row spread' }, h('span', { class: 'badge' + (p.status === 'andamento' ? ' accent' : p.status === 'concluida' ? ' ok' : '') }, st),
        p.due ? h('span', { class: 'small ' + (isLate(p.due) && p.status !== 'concluida' ? 'danger-text' : 'muted') }, fmtDue(p.due)) : null),
      h('h2', {}, p.title || '(sem título)'),
      p.body ? h('div', { class: 'desc' }, p.body) : null,
      h('div', { class: 'foot' }, h('div', { class: 'row spread small muted', style: { marginBottom: '.35rem' } }, h('span', {}, `${p.children_done}/${p.children_count} tarefas`), h('span', {}, pct + '%')),
        h('div', { class: 'progress' }, h('i', { style: { width: pct + '%', background: p.color || 'var(--accent)' } })))));
    }
  }
  await load();
  onView('data', load);
}

async function newProject() {
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const d = await formBox('Novo projeto', [
    { name: 'title', label: 'Nome do projeto', required: true, placeholder: 'Ex.: Mudança de apartamento' },
    { name: 'body', label: 'Objetivo / descrição (opcional)', type: 'textarea' },
    { name: 'due', label: 'Prazo (opcional)', type: 'date' },
  ], { ok: 'Criar projeto' });
  if (!d) return;
  try {
    const p = await api('/api/items', { method: 'POST', body: { kind: 'project', title: d.title, body: d.body, due: d.due || null, color } });
    emit('data');
    location.hash = `projetos/${p.id}`;
  } catch (e) { fail(e); }
}

// ====================================================================== página do projeto
let mode = localStorage.getItem('jv:projmode') || 'quadro';
const COLS = [['pendente', 'A fazer'], ['andamento', 'Fazendo'], ['concluida', 'Concluído']];

async function project(root, id) {
  let p;
  try { p = await api(`/api/items/${id}`); } catch (e) { root.append(h('div', { class: 'empty' }, 'Projeto não encontrado.')); return; }
  const save = debounce(async (body) => { try { await api(`/api/items/${id}`, { method: 'PATCH', body }); } catch (e) { fail(e); } }, 600);
  const pending = {};
  const set = (k, v) => { pending[k] = v; save({ ...pending }); };
  const title = h('input', { class: 'title-input', value: p.title, 'aria-label': 'Nome do projeto', oninput: (e) => set('title', e.target.value) });
  const desc = h('textarea', { placeholder: 'Objetivo, escopo, links importantes…', style: { minHeight: '70px' }, oninput: (e) => set('body', e.target.value) }, p.body || '');
  const status = h('select', { style: { width: 'auto' }, onchange: async (e) => { await api(`/api/items/${id}`, { method: 'PATCH', body: { status: e.target.value } }).catch(fail); emit('data'); } },
    STATUS.project.map(([v, l]) => h('option', { value: v, selected: p.status === v }, l)));
  const due = h('input', { type: 'date', style: { width: 'auto' }, value: p.due ? p.due.slice(0, 10) : '', 'aria-label': 'Prazo do projeto',
    onchange: async (e) => { await api(`/api/items/${id}`, { method: 'PATCH', body: { due: e.target.value || null } }).catch(fail); } });
  const seg = h('div', { class: 'seg' });
  const content = h('div');
  const drawSeg = () => clear(seg).append(
    h('button', { class: mode === 'quadro' ? 'on' : '', onclick: () => { mode = 'quadro'; localStorage.setItem('jv:projmode', mode); drawSeg(); load(); } }, 'Quadro'),
    h('button', { class: mode === 'lista' ? 'on' : '', onclick: () => { mode = 'lista'; localStorage.setItem('jv:projmode', mode); drawSeg(); load(); } }, 'Lista'));
  drawSeg();
  const progress = h('div', { class: 'progress', style: { margin: '.6rem 0 1rem' } });

  root.append(
    h('div', { class: 'row', style: { marginBottom: '.5rem' } }, h('a', { href: '#projetos', class: 'btn ghost sm' }, icon('back', 'sm'), 'Projetos')),
    h('div', { class: 'project-head' }, h('span', { class: 'swatch', style: { background: p.color || 'var(--accent)' } }), h('div', { class: 'grow' }, title)),
    h('div', { class: 'row', style: { marginBottom: '.6rem' } }, status, due, h('span', { class: 'grow' }), seg,
      h('button', { class: 'btn', onclick: () => openItem(id) }, 'Detalhes e anexos'),
      h('button', { class: 'btn ghost icon', 'aria-label': 'Excluir projeto', onclick: async () => {
        if (!(await confirmBox(`Excluir o projeto “${p.title}” e todas as suas tarefas?`, { ok: 'Excluir tudo', danger: true }))) return;
        await api(`/api/items/${id}`, { method: 'DELETE' }).catch(fail); toast('Projeto excluído'); emit('data'); location.hash = 'projetos';
      } }, icon('trash'))),
    desc, progress, content);

  async function load() {
    let x;
    try { x = await api(`/api/items/${id}`); } catch (_) { return; }
    const tasks = x.children || [];
    const done = tasks.filter((t) => t.status === 'concluida').length;
    clear(progress).append(h('i', { style: { width: (tasks.length ? (done / tasks.length) * 100 : 0) + '%', background: p.color || 'var(--accent)' } }));
    clear(content);
    if (mode === 'lista') {
      const add = h('input', { placeholder: 'Nova tarefa do projeto…' });
      content.append(h('form', { class: 'capture-inline', onsubmit: async (e) => {
        e.preventDefault(); if (!add.value.trim()) return;
        try { await api('/api/capture', { method: 'POST', body: { text: add.value, kind: 'task', project_id: id } }); add.value = ''; emit('data'); } catch (ex) { fail(ex); }
      } }, icon('plus'), add, h('button', { class: 'btn primary sm', type: 'submit' }, 'Adicionar')));
      const open = tasks.filter((t) => t.status !== 'concluida').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
      const closed = tasks.filter((t) => t.status === 'concluida');
      content.append(open.length ? h('div', { class: 'list boxed' }, open.map((t) => taskRow(t, { showProject: false }))) : h('div', { class: 'card empty' }, 'Sem tarefas abertas.'));
      if (closed.length) content.append(h('div', { class: 'group-title' }, h('h3', {}, 'Concluídas'), h('span', { class: 'badge' }, closed.length)),
        h('div', { class: 'list boxed' }, closed.map((t) => taskRow(t, { showProject: false }))));
      return;
    }
    const board = h('div', { class: 'board' });
    for (const [st, label] of COLS) {
      const col = h('div', { class: 'column', 'data-status': st });
      const items = tasks.filter((t) => (st === 'pendente' ? !['andamento', 'concluida'].includes(t.status) : t.status === st));
      col.append(h('div', { class: 'column-head' }, h('b', {}, label), h('span', { class: 'badge' }, items.length)));
      for (const t of items) col.append(kcard(t, st));
      if (st === 'pendente') col.append(h('button', { class: 'btn ghost sm block', onclick: () => openCapture('task', { project_id: id }) }, icon('plus', 'sm'), 'Adicionar tarefa'));
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); col.classList.remove('drop');
        const tid = e.dataTransfer.getData('text/plain');
        if (tid) await move(Number(tid), st);
      });
      board.append(col);
    }
    content.append(board);
  }
  function kcard(t, st) {
    const idx = COLS.findIndex((c) => c[0] === st);
    const meta = [];
    if (t.due) meta.push(h('span', { class: isLate(t.due) && t.status !== 'concluida' ? 'danger-text' : '' }, icon('calendar', 'sm'), ' ', fmtDue(t.due)));
    if (t.priority >= 2) meta.push(h('span', { class: 'badge ' + (t.priority === 3 ? 'danger' : 'warn') }, t.priority === 3 ? 'alta' : 'média'));
    return h('div', { class: 'kcard', draggable: 'true', ondragstart: (e) => e.dataTransfer.setData('text/plain', String(t.id)), onclick: () => openItem(t.id) },
      h('div', { class: 't', style: t.status === 'concluida' ? { textDecoration: 'line-through', color: 'var(--faint)' } : null }, t.title),
      meta.length ? h('div', { class: 'meta' }, meta) : null,
      h('div', { class: 'move' },
        idx > 0 ? h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); move(t.id, COLS[idx - 1][0]); } }, '← ' + COLS[idx - 1][1]) : null,
        idx < 2 ? h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); move(t.id, COLS[idx + 1][0]); } }, COLS[idx + 1][1] + ' →') : null));
  }
  async function move(tid, st) {
    try { await api(`/api/items/${tid}`, { method: 'PATCH', body: { status: st } }); emit('data'); } catch (e) { fail(e); }
  }
  await load();
  onView('data', load);
}
