// Painel de detalhes de um item (tarefa, subtarefa, ideia, anotação, projeto) com salvamento automático,
// subtarefas, anexos e conversões — e a linha de tarefa usada nas listas.
import { api, clear, confirmBox, debounce, emit, fail, fmtBytes, fmtDue, fmtUTC, h, icon, isLate, toast } from './core.js';

export const KIND = {
  task: 'Tarefa', subtask: 'Subtarefa', idea: 'Ideia', note: 'Anotação', project: 'Projeto', research: 'Pesquisa',
};
export const STATUS = {
  task: [['pendente', 'A fazer'], ['andamento', 'Fazendo'], ['concluida', 'Concluída']],
  subtask: [['pendente', 'A fazer'], ['andamento', 'Fazendo'], ['concluida', 'Concluída']],
  idea: [['nova', 'Nova'], ['avaliando', 'Avaliando'], ['convertida', 'Virou tarefa/projeto'], ['arquivada', 'Arquivada']],
  note: [['pendente', 'Ativa'], ['arquivada', 'Arquivada']],
  project: [['pendente', 'Planejando'], ['andamento', 'Em andamento'], ['pausado', 'Pausado'], ['concluida', 'Concluído']],
  research: [['pendente', 'Aberta'], ['concluida', 'Concluída']],
};
export const PRIOS = [['0', 'Nenhuma'], ['1', 'Baixa'], ['2', 'Média'], ['3', 'Alta']];
export const COLORS = ['#5b5bd6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];

export async function toggleDone(it) {
  const done = it.status === 'concluida';
  try {
    await api(`/api/items/${it.id}`, { method: 'PATCH', body: { status: done ? 'pendente' : 'concluida' } });
    if (!done) toast('Concluída ✓', it.title, { action: { label: 'Desfazer', fn: async () => { await api(`/api/items/${it.id}`, { method: 'PATCH', body: { status: 'pendente' } }); emit('data'); } } });
    emit('data');
  } catch (e) { fail(e); }
}

/** Linha de tarefa com círculo de concluir, prazo, projeto e progresso de subtarefas. */
export function taskRow(it, { showProject = true } = {}) {
  const done = it.status === 'concluida';
  const meta = [];
  if (it.due) meta.push(h('span', { class: isLate(it.due) && !done ? 'late' : '' }, icon('calendar', 'sm'), ' ', fmtDue(it.due)));
  if (it.children_count) meta.push(h('span', {}, `☑ ${it.children_done}/${it.children_count}`));
  if (showProject && it.parent) meta.push(h('span', { class: 'row', style: { gap: '.3rem' } }, h('span', { class: 'dot', style: { width: '8px', height: '8px', background: it.parent.color || 'var(--accent)' } }), it.parent.title));
  if (it.status === 'andamento') meta.push(h('span', { class: 'badge accent' }, 'Fazendo'));
  for (const t of it.tags || []) meta.push(h('span', { class: 'faint' }, '#' + t));
  return h('div', { class: `row-item ${done ? 'done' : ''}`, tabindex: 0, role: 'button', onclick: () => openItem(it.id),
    onkeydown: (e) => { if (e.key === 'Enter') openItem(it.id); } },
  h('button', { class: `tick p${it.priority} ${done ? 'on' : ''}`, 'aria-label': done ? 'Reabrir tarefa' : 'Concluir tarefa',
    onclick: (e) => { e.stopPropagation(); toggleDone(it); } }, done ? icon('check') : null),
  h('div', { class: 'grow' }, h('span', { class: 't' }, it.title || '(sem título)'), meta.length ? h('div', { class: 'meta' }, meta) : null));
}

// ====================================================================== painel de detalhes
let current = null;
export async function openItem(id) {
  closeItem();
  let it;
  try { it = await api(`/api/items/${id}`); } catch (e) { fail(e); return; }
  const scrim = h('div', { class: 'scrim', onclick: () => closeItem() });
  const saveState = h('span', { class: 'save-state' });
  const body = h('div', { class: 'drawer-body' });
  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': KIND[it.kind] },
    h('div', { class: 'drawer-head' }, h('button', { class: 'btn ghost icon', 'aria-label': 'Fechar', onclick: () => closeItem() }, icon('x')),
      h('span', { class: 'badge' }, KIND[it.kind]), saveState,
      h('button', { class: 'btn ghost icon', 'aria-label': 'Excluir', onclick: () => remove(it) }, icon('trash'))), body);
  const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal')) closeItem(); };
  document.addEventListener('keydown', esc);
  document.body.append(scrim, drawer);
  current = { scrim, drawer, esc, flush: () => {} };
  renderBody(body, it, saveState);
}

export function closeItem() {
  if (!current) return;
  current.flush();
  current.scrim.remove(); current.drawer.remove();
  document.removeEventListener('keydown', current.esc);
  current = null;
  emit('data');
}

async function remove(it) {
  const kids = it.children?.length ? ` e ${it.children.length} subitem(ns)` : '';
  if (!(await confirmBox(`Excluir “${it.title || 'sem título'}”${kids}?`, { ok: 'Excluir', danger: true }))) return;
  try { await api(`/api/items/${it.id}`, { method: 'DELETE' }); current.flush = () => {}; closeItem(); toast('Excluído'); } catch (e) { fail(e); }
}

function renderBody(body, it, saveState) {
  clear(body);
  const patch = {};
  const save = debounce(async () => {
    const data = { ...patch };
    for (const k of Object.keys(patch)) delete patch[k];
    if (!Object.keys(data).length) return;
    saveState.textContent = 'Salvando…';
    try { await api(`/api/items/${it.id}`, { method: 'PATCH', body: data }); saveState.textContent = 'Salvo'; }
    catch (e) { saveState.textContent = 'Erro ao salvar'; fail(e); }
  }, 600);
  current.flush = () => save.flush();
  const set = (k, v, now = false) => { patch[k] = v; it[k] = v; saveState.textContent = 'Editando…'; now ? save.flush() : save(); };

  const isTask = it.kind === 'task' || it.kind === 'subtask';
  const title = h('textarea', { class: 'title-input', rows: 1, placeholder: 'Título', style: { minHeight: '0', resize: 'none', width: '100%' },
    oninput: (e) => { autosize(e.target); set('title', e.target.value); } }, it.title);
  setTimeout(() => autosize(title), 0);
  const head = h('div', { class: 'row nowrap', style: { alignItems: 'flex-start' } },
    isTask ? h('button', { class: `tick p${it.priority} ${it.status === 'concluida' ? 'on' : ''}`, style: { marginTop: '.45rem' }, 'aria-label': 'Concluir',
      onclick: (e) => { const done = it.status === 'concluida'; set('status', done ? 'pendente' : 'concluida', true); e.currentTarget.classList.toggle('on', !done); e.currentTarget.replaceChildren(done ? '' : icon('check')); statusSel.value = it.status; } },
    it.status === 'concluida' ? icon('check') : null) : null, title);
  body.append(head);

  // propriedades
  const props = h('div', { class: 'props' });
  const statusSel = h('select', { onchange: (e) => set('status', e.target.value, true) }, (STATUS[it.kind] || STATUS.task).map(([v, l]) => h('option', { value: v, selected: it.status === v }, l)));
  props.append(h('span', {}, 'Situação'), statusSel);
  if (it.kind !== 'note') props.append(h('span', {}, 'Prioridade'), h('select', { onchange: (e) => set('priority', Number(e.target.value), true) }, PRIOS.map(([v, l]) => h('option', { value: v, selected: String(it.priority) === v }, l))));
  if (['task', 'subtask', 'project'].includes(it.kind)) {
    const date = h('input', { type: 'date', value: it.due ? it.due.slice(0, 10) : '' });
    const time = h('input', { type: 'time', value: it.due && !/T00:00/.test(it.due) ? it.due.slice(11, 16) : '' });
    const upd = () => set('due', date.value ? `${date.value}T${time.value || '00:00'}` : null, true);
    date.onchange = upd; time.onchange = upd;
    props.append(h('span', {}, 'Prazo'), h('div', { class: 'row nowrap' }, date, time,
      h('button', { class: 'btn ghost icon sm', 'aria-label': 'Remover prazo', onclick: () => { date.value = ''; time.value = ''; upd(); } }, icon('x', 'sm'))));
  }
  if (it.kind === 'task') {
    const proj = h('select', { onchange: (e) => set('parent_id', e.target.value ? Number(e.target.value) : null, true) }, h('option', { value: '' }, 'Sem projeto'));
    api('/api/items?kind=project&top=1').then((ps) => ps.forEach((p) => proj.append(h('option', { value: p.id, selected: p.id === it.parent_id }, p.title)))).catch(() => {});
    props.append(h('span', {}, 'Projeto'), proj);
  }
  if (it.kind === 'subtask' && it.parent_id) props.append(h('span', {}, 'Faz parte de'), h('a', { href: '#', onclick: (e) => { e.preventDefault(); openItem(it.parent_id); } }, 'abrir item principal'));
  if (it.kind === 'project') {
    const sw = h('div', { class: 'row' }, COLORS.map((c) => h('button', { class: 'btn icon sm', 'aria-label': 'Cor ' + c, style: { background: c, borderColor: it.color === c ? 'var(--text)' : c, borderWidth: '2px' },
      onclick: () => { set('color', c, true); renderBody(body, it, saveState); } })));
    props.append(h('span', {}, 'Cor'), sw);
  }
  if (it.kind === 'note') props.append(h('span', {}, 'Fixar no topo'), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.pinned, onchange: (e) => set('pinned', e.target.checked, true) }), 'Fixada'));
  props.append(h('span', {}, 'Etiquetas'), h('input', { value: (it.tags || []).join(', '), placeholder: 'casa, trabalho', oninput: (e) => set('tags', e.target.value) }));
  body.append(props);

  body.append(h('label', { class: 'f' }, it.kind === 'idea' ? 'Desenvolva a ideia' : 'Anotações', h('textarea', {
    placeholder: it.kind === 'idea' ? 'Por que é boa? Próximos passos? Links…' : 'Detalhes, links, observações…',
    style: { minHeight: it.kind === 'note' ? '260px' : '130px' }, oninput: (e) => set('body', e.target.value) }, it.body || '')));

  // origem / derivados (ideia → tarefa/projeto mantendo a original)
  if (it.origin) body.append(h('p', { class: 'small muted' }, 'Criado a partir de: ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openItem(it.origin.id); } }, `${KIND[it.origin.kind].toLowerCase()} “${it.origin.title}”`)));
  if (it.derived?.length) body.append(h('p', { class: 'small muted' }, 'Virou: ', it.derived.map((d, i) => [i ? ', ' : '', h('a', { href: '#', onclick: (e) => { e.preventDefault(); d.kind === 'project' ? (closeItem(), location.hash = `projetos/${d.id}`) : openItem(d.id); } }, `${KIND[d.kind].toLowerCase()} “${d.title}”`)])));

  // subtarefas
  if (['task', 'idea', 'research'].includes(it.kind)) {
    const list = h('div', { class: 'list subtasks' });
    const add = h('input', { placeholder: it.kind === 'idea' ? 'Adicionar próximo passo…' : 'Adicionar subtarefa…' });
    const drawKids = () => {
      clear(list);
      for (const k of it.children || []) {
        const done = k.status === 'concluida';
        list.append(h('div', { class: `row-item ${done ? 'done' : ''}` },
          h('button', { class: `tick ${done ? 'on' : ''}`, 'aria-label': 'Concluir subtarefa', onclick: async () => {
            k.status = done ? 'pendente' : 'concluida';
            await api(`/api/items/${k.id}`, { method: 'PATCH', body: { status: k.status } }).catch(fail); drawKids();
          } }, done ? icon('check') : null),
          h('span', { class: 't grow', onclick: () => openItem(k.id) }, k.title),
          h('button', { class: 'btn ghost icon sm', 'aria-label': 'Remover subtarefa', onclick: async () => {
            await api(`/api/items/${k.id}`, { method: 'DELETE' }).catch(fail); it.children = it.children.filter((x) => x.id !== k.id); drawKids();
          } }, icon('x', 'sm'))));
      }
    };
    drawKids();
    const done = (it.children || []).filter((k) => k.status === 'concluida').length;
    body.append(h('h3', { style: { marginTop: '1.2rem' } }, `${it.kind === 'idea' ? 'Próximos passos' : 'Subtarefas'}${it.children?.length ? ` · ${done}/${it.children.length}` : ''}`), list,
      h('form', { class: 'row nowrap', style: { marginTop: '.4rem' }, onsubmit: async (e) => {
        e.preventDefault(); const t = add.value.trim(); if (!t) return;
        try { const k = await api('/api/items', { method: 'POST', body: { kind: 'subtask', title: t, parent_id: it.id } }); it.children = [...(it.children || []), k]; add.value = ''; drawKids(); } catch (ex) { fail(ex); }
      } }, add, h('button', { class: 'btn', type: 'submit' }, 'Adicionar')));
  }

  // anexos
  const atts = h('div', { class: 'stack' });
  const file = h('input', { type: 'file', hidden: true, onchange: async () => {
    const f = file.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Arquivo maior que 5 MB', '', { error: true }); return; }
    const fd = new FormData(); fd.append('file', f);
    saveState.textContent = 'Enviando…';
    try { const a = await api(`/api/items/${it.id}/attachments`, { method: 'POST', form: fd }); it.attachments.push(a); drawAtts(); saveState.textContent = 'Salvo'; } catch (e) { fail(e); }
    file.value = '';
  } });
  const drawAtts = () => {
    clear(atts);
    for (const a of it.attachments) atts.append(h('div', { class: 'attach' }, icon('clip', 'sm'), h('a', { href: `/api/attachments/${a.id}`, target: '_blank', rel: 'noopener' }, a.filename),
      h('span', { class: 'faint small' }, fmtBytes(a.size)),
      h('button', { class: 'btn ghost icon sm', 'aria-label': 'Remover anexo', onclick: async () => {
        if (!(await confirmBox(`Remover “${a.filename}”?`, { ok: 'Remover', danger: true }))) return;
        await api(`/api/attachments/${a.id}`, { method: 'DELETE' }).catch(fail); it.attachments = it.attachments.filter((x) => x.id !== a.id); drawAtts();
      } }, icon('x', 'sm'))));
  };
  drawAtts();
  body.append(h('h3', { style: { marginTop: '1.2rem' } }, 'Anexos'), atts, file,
    h('button', { class: 'btn sm', style: { marginTop: '.5rem' }, onclick: () => file.click() }, icon('clip', 'sm'), 'Anexar arquivo'));

  // conversões
  const conv = h('div', { class: 'row', style: { marginTop: '1.4rem' } });
  const convert = async (to) => {
    save.flush();
    try {
      const n = await api(`/api/items/${it.id}/convert`, { method: 'POST', body: { to } });
      toast(`${KIND[n.kind]} criada a partir de “${it.title}”`, 'O original foi mantido.');
      if (n.kind === 'project') { closeItem(); location.hash = `projetos/${n.id}`; } else openItem(n.id);
    } catch (e) { fail(e); }
  };
  if (['idea', 'note', 'research'].includes(it.kind)) conv.append(h('button', { class: 'btn', onclick: () => convert('task') }, icon('arrow', 'sm'), 'Virar tarefa'), h('button', { class: 'btn', onclick: () => convert('project') }, icon('arrow', 'sm'), 'Virar projeto'));
  if (it.kind === 'task') conv.append(h('button', { class: 'btn', onclick: () => convert('project') }, icon('arrow', 'sm'), 'Transformar em projeto'));
  body.append(conv, h('p', { class: 'faint small', style: { marginTop: '1rem' } }, `Criado em ${fmtUTC(it.created_at)} · salvamento automático`));
}

function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
