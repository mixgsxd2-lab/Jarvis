// Painel Meu Espaço: tarefas, subtarefas, ideias, anotações, projetos, pesquisas e anexos — com salvamento automático.
import { api, clear, confirmBox, debounce, fail, fmtBytes, fmtDate, fmtUTC, h, setSaveState, tabs, toast } from './core.js';

const KINDS = {
  task: { label: 'Tarefas', one: 'tarefa', statuses: [['pendente', 'Pendente'], ['andamento', 'Em andamento'], ['concluida', 'Concluída']] },
  idea: { label: 'Ideias', one: 'ideia', statuses: [['nova', 'Nova'], ['avaliando', 'Avaliando'], ['convertida', 'Convertida'], ['arquivada', 'Arquivada']] },
  note: { label: 'Anotações', one: 'anotação', statuses: [['pendente', 'Ativa'], ['arquivada', 'Arquivada']] },
  project: { label: 'Projetos', one: 'projeto', statuses: [['pendente', 'Planejamento'], ['andamento', 'Em andamento'], ['pausado', 'Pausado'], ['concluida', 'Concluído']] },
  research: { label: 'Pesquisas', one: 'pesquisa', statuses: [['pendente', 'Aberta'], ['andamento', 'Em andamento'], ['concluida', 'Concluída']] },
  subtask: { label: 'Subtarefas', one: 'subtarefa', statuses: [['pendente', 'Pendente'], ['concluida', 'Concluída']] },
};
const PRIOS = [['0', 'Sem prioridade'], ['1', 'Baixa'], ['2', 'Média'], ['3', 'Alta']];

export async function render(root, ctx) {
  const view = h('div');
  const search = sessionStorage.getItem('jarvis:search');
  sessionStorage.removeItem('jarvis:search');
  const start = search ? 'search' : 'task';
  root.append(tabs([['task', 'Tarefas'], ['idea', 'Ideias'], ['note', 'Anotações'], ['project', 'Projetos'], ['search', 'Pesquisa']], start,
    (k) => (k === 'search' ? searchView(view, '') : listView(view, k))), view);
  const reload = () => { if (view.dataset.kind && !view.dataset.editing) listView(view, view.dataset.kind); };
  window.addEventListener('jarvis:data', reload);
  ctx.onCleanup(() => window.removeEventListener('jarvis:data', reload));
  if (search) searchView(view, search); else listView(view, 'task');
}

// ------------------------------------------------------------------ lista
async function listView(view, kind, filter = 'open') {
  clear(view);
  view.dataset.kind = kind;
  delete view.dataset.editing;
  const K = KINDS[kind];
  const input = h('input', { placeholder: `Nova ${K.one}…`, maxlength: 300, 'aria-label': `Nova ${K.one}` });
  const q = h('input', { placeholder: 'Filtrar…', type: 'search', 'aria-label': 'Filtrar' });
  const sel = h('select', { 'aria-label': 'Situação' },
    h('option', { value: 'open', selected: filter === 'open' }, 'Abertas'),
    h('option', { value: 'all', selected: filter === 'all' }, 'Todas'),
    h('option', { value: 'done', selected: filter === 'done' }, kind === 'idea' ? 'Convertidas/arquivadas' : 'Concluídas'));
  const list = h('div', { class: 'list' });
  view.append(
    h('form', { class: 'row', onsubmit: async (e) => {
      e.preventDefault();
      const title = input.value.trim(); if (!title) return;
      try { const it = await api('/api/items', { method: 'POST', body: { kind, title } }); input.value = ''; setSaveState('Salvo ✓'); load(); if (kind !== 'task') editor(view, it.id); }
      catch (err) { fail(err); }
    } }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Adicionar')),
    h('div', { class: 'row', style: { margin: '.7rem 0' } }, q, sel), list);

  const closed = kind === 'idea' ? ['convertida', 'arquivada'] : kind === 'note' ? ['arquivada'] : ['concluida'];
  async function load() {
    const params = new URLSearchParams({ kind, top: '1' });
    if (q.value.trim()) params.set('q', q.value.trim());
    let items = await api('/api/items?' + params).catch((e) => { fail(e); return []; });
    if (sel.value === 'open') items = items.filter((i) => !closed.includes(i.status));
    if (sel.value === 'done') items = items.filter((i) => closed.includes(i.status));
    clear(list);
    if (!items.length) list.append(h('div', { class: 'empty' }, `Nenhuma ${K.one} por aqui.`));
    for (const it of items) list.append(row(it, () => editor(view, it.id), load));
  }
  q.oninput = debounce(load, 300);
  sel.onchange = () => listView(view, kind, sel.value);
  load();
}

function row(it, open, reload) {
  const done = it.status === 'concluida';
  const isTask = it.kind === 'task' || it.kind === 'subtask';
  const meta = [];
  if (it.due) meta.push('⏰ ' + fmtDate(it.due));
  if (it.children_count) meta.push(`☑ ${it.children_done}/${it.children_count}`);
  if (it.tags?.length) meta.push('#' + it.tags.join(' #'));
  if (it.kind !== 'task') meta.push(KINDS[it.kind].statuses.find((s) => s[0] === it.status)?.[1] || it.status);
  return h('div', { class: `li prio-${it.priority} ${done ? 'done' : ''}`, onclick: open, role: 'button', tabindex: 0,
    onkeydown: (e) => { if (e.key === 'Enter') open(); } },
  isTask ? h('button', { class: 'chk' + (done ? ' on' : ''), 'aria-label': done ? 'Reabrir' : 'Concluir', onclick: async (e) => {
    e.stopPropagation();
    try { await api(`/api/items/${it.id}`, { method: 'PATCH', body: { status: done ? 'pendente' : 'concluida' } }); setSaveState('Salvo ✓'); reload(); } catch (err) { fail(err); }
  } }, done ? '✓' : '') : null,
  h('div', { class: 'grow' }, h('span', { class: 't' }, it.title || '(sem título)'), meta.length ? h('div', { class: 'meta' }, meta.join(' · ')) : null),
  h('span', { class: 'muted' }, '›'));
}

// ------------------------------------------------------------------ editor com salvamento automático
async function editor(view, id, backKind) {
  let it;
  try { it = await api(`/api/items/${id}`); } catch (e) { fail(e); return; }
  clear(view);
  view.dataset.editing = '1';
  const K = KINDS[it.kind];
  const back = () => listView(view, backKind || (it.kind === 'subtask' ? 'task' : it.kind));
  const pendingPatch = {};
  const save = debounce(async () => {
    const body = { ...pendingPatch };
    for (const k of Object.keys(pendingPatch)) delete pendingPatch[k];
    if (!Object.keys(body).length) return;
    setSaveState('Salvando…');
    try { await api(`/api/items/${id}`, { method: 'PATCH', body }); setSaveState('Salvo ✓'); }
    catch (e) { setSaveState('Erro ao salvar', false); fail(e); }
  }, 700);
  const change = (field) => (e) => { pendingPatch[field] = e.target.value; setSaveState('Editando…'); save(); };

  const title = h('input', { value: it.title, placeholder: 'Título', maxlength: 300, style: { fontSize: '1.15rem' }, oninput: change('title') });
  const fields = h('div', { class: 'grid3' },
    h('label', {}, 'Situação', h('select', { onchange: (e) => { pendingPatch.status = e.target.value; save.flush(); } },
      K.statuses.map(([v, l]) => h('option', { value: v, selected: it.status === v }, l)))),
    h('label', {}, 'Prioridade', h('select', { onchange: (e) => { pendingPatch.priority = Number(e.target.value); save.flush(); } },
      PRIOS.map(([v, l]) => h('option', { value: v, selected: String(it.priority) === v }, l)))),
    ['task', 'project', 'subtask', 'research'].includes(it.kind)
      ? h('label', {}, 'Prazo', h('input', { type: 'datetime-local', value: it.due ? it.due.slice(0, 16) : '', onchange: (e) => { pendingPatch.due = e.target.value || null; save.flush(); } })) : null,
    h('label', {}, 'Etiquetas', h('input', { value: (it.tags || []).join(', '), placeholder: 'trabalho, casa', oninput: change('tags') })));
  const bodyArea = h('textarea', { placeholder: it.kind === 'research' ? 'Anotações da pesquisa, links, fontes…' : 'Detalhes, anotações…', oninput: change('body') }, it.body || '');

  view.append(
    h('div', { class: 'row', style: { marginBottom: '.6rem' } },
      h('button', { class: 'btn small ghost', onclick: () => { save.flush(); back(); } }, '‹ Voltar'),
      h('span', { class: 'badge' }, K.one),
      h('span', { class: 'muted', style: { fontSize: '.8rem', textAlign: 'right' } }, 'Salvamento automático')),
    title, fields, h('label', {}, 'Conteúdo', bodyArea));

  // origem e derivados (ideia → tarefa/projeto mantendo o original)
  if (it.origin) view.append(h('p', { class: 'muted' }, 'Criado a partir de: ', h('a', { href: '#espaco', onclick: (e) => { e.preventDefault(); save.flush(); editor(view, it.origin.id); } }, `${KINDS[it.origin.kind].one} “${it.origin.title}”`)));
  if (it.derived?.length) view.append(h('p', { class: 'muted' }, 'Virou: ', it.derived.map((d, i) => [i ? ', ' : '', h('a', { href: '#espaco', onclick: (e) => { e.preventDefault(); save.flush(); editor(view, d.id); } }, `${KINDS[d.kind].one} “${d.title}”`)])));

  // subitens
  if (['task', 'project', 'research'].includes(it.kind)) {
    const childKind = it.kind === 'project' ? 'task' : 'subtask';
    const box = h('div', { class: 'list' });
    const add = h('input', { placeholder: it.kind === 'project' ? 'Nova tarefa do projeto…' : 'Nova subtarefa…', maxlength: 300 });
    const renderKids = (kids) => {
      clear(box);
      const done = kids.filter((k) => k.status === 'concluida').length;
      if (kids.length) box.append(h('div', { class: 'progress', title: `${done}/${kids.length}` }, h('i', { style: { width: `${(done / kids.length) * 100}%` } })));
      for (const k of kids) box.append(row(k, () => { save.flush(); editor(view, k.id, it.kind === 'subtask' ? 'task' : undefined); }, reloadKids));
    };
    async function reloadKids() { const x = await api(`/api/items/${id}`); renderKids(x.children || []); }
    view.append(h('h3', { style: { marginTop: '1rem' } }, it.kind === 'project' ? 'Tarefas do projeto' : 'Subtarefas'),
      h('form', { class: 'row', style: { marginBottom: '.5rem' }, onsubmit: async (e) => {
        e.preventDefault(); const t = add.value.trim(); if (!t) return;
        try { await api('/api/items', { method: 'POST', body: { kind: childKind, title: t, parent_id: id } }); add.value = ''; setSaveState('Salvo ✓'); reloadKids(); } catch (err) { fail(err); }
      } }, add, h('button', { class: 'btn', type: 'submit' }, 'Adicionar')), box);
    renderKids(it.children || []);
  }

  // anexos
  const attList = h('div', { class: 'stack' });
  const file = h('input', { type: 'file', style: { display: 'none' }, onchange: async () => {
    const f = file.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Arquivo grande demais', 'O limite é 5 MB.', { error: true }); return; }
    const fd = new FormData(); fd.append('file', f);
    setSaveState('Enviando…');
    try { const a = await api(`/api/items/${id}/attachments`, { method: 'POST', form: fd }); it.attachments.push(a); renderAtt(); setSaveState('Salvo ✓'); }
    catch (e) { setSaveState('Erro', false); fail(e); }
    file.value = '';
  } });
  const renderAtt = () => {
    clear(attList);
    if (!it.attachments.length) attList.append(h('div', { class: 'muted', style: { fontSize: '.85rem' } }, 'Nenhum anexo.'));
    for (const a of it.attachments) {
      attList.append(h('div', { class: 'attach' }, '📎', h('a', { href: `/api/attachments/${a.id}`, target: '_blank', rel: 'noopener' }, a.filename),
        h('small', {}, fmtBytes(a.size)),
        h('button', { class: 'btn small danger', onclick: async () => {
          if (!(await confirmBox(`Remover o anexo “${a.filename}”?`, { ok: 'Remover', danger: true }))) return;
          await api(`/api/attachments/${a.id}`, { method: 'DELETE' }).catch(fail);
          it.attachments = it.attachments.filter((x) => x.id !== a.id); renderAtt();
        } }, 'Remover')));
    }
  };
  view.append(h('h3', { style: { marginTop: '1rem' } }, 'Anexos'), attList, file,
    h('button', { class: 'btn small', style: { marginTop: '.5rem' }, onclick: () => file.click() }, '+ Anexar arquivo (até 5 MB)'));
  renderAtt();

  // ações
  const actions = h('div', { class: 'row', style: { marginTop: '1.4rem' } });
  const convert = async (to) => {
    save.flush();
    try {
      const n = await api(`/api/items/${id}/convert`, { method: 'POST', body: { to } });
      toast('Pronto!', `Criei ${KINDS[n.kind].one} “${n.title}”. O original foi mantido.`);
      editor(view, n.id);
    } catch (e) { fail(e); }
  };
  if (['idea', 'note', 'research'].includes(it.kind)) {
    actions.append(h('button', { class: 'btn', onclick: () => convert('task') }, '→ Transformar em tarefa'),
      h('button', { class: 'btn', onclick: () => convert('project') }, '→ Transformar em projeto'));
  }
  if (it.kind === 'task') actions.append(h('button', { class: 'btn', onclick: () => convert('project') }, '→ Transformar em projeto'));
  actions.append(h('button', { class: 'btn danger', onclick: async () => {
    if (!(await confirmBox(`Excluir “${it.title}”${it.children?.length ? ' e seus subitens' : ''}?`, { ok: 'Excluir', danger: true }))) return;
    try { await api(`/api/items/${id}`, { method: 'DELETE' }); toast('Excluído'); back(); } catch (e) { fail(e); }
  } }, 'Excluir'));
  view.append(actions, h('p', { class: 'muted', style: { fontSize: '.78rem' } }, `Criado em ${fmtUTC(it.created_at)}`));
}

// ------------------------------------------------------------------ pesquisa geral
async function searchView(view, initial) {
  clear(view);
  view.dataset.kind = '';
  delete view.dataset.editing;
  const q = h('input', { type: 'search', placeholder: 'Pesquisar em tudo: tarefas, ideias, anotações, agenda, memória, conversas…', value: initial || '' });
  const out = h('div', { class: 'stack' });
  view.append(h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); run(); } }, q, h('button', { class: 'btn primary', type: 'submit' }, 'Pesquisar')), out);
  const group = (title, nodes) => (nodes.length ? [h('h3', { style: { marginTop: '1rem' } }, title), h('div', { class: 'list' }, nodes)] : []);
  async function run() {
    const text = q.value.trim();
    clear(out);
    if (text.length < 2) { await researchList(out, view); return; }
    const r = await api('/api/search?q=' + encodeURIComponent(text)).catch((e) => { fail(e); return null; });
    if (!r) return;
    const total = r.items.length + r.events.length + r.memories.length + r.messages.length;
    out.append(h('p', { class: 'muted' }, `${total} resultado(s) para “${text}”.`));
    out.append(...group('Meu Espaço', r.items.map((i) => row(i, () => editor(view, i.id), run))));
    out.append(...group('Agenda', r.events.map((e) => h('div', { class: 'li', onclick: () => { location.hash = 'agenda'; } }, h('div', { class: 'grow' }, h('span', { class: 't' }, e.title), h('div', { class: 'meta' }, fmtDate(e.start)))))));
    out.append(...group('Memória', r.memories.map((m) => h('div', { class: 'li' }, h('span', { class: 'grow' }, m.content)))));
    out.append(...group('Conversas', r.messages.map((m) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('span', {}, m.content), h('div', { class: 'meta' }, m.role === 'user' ? 'Você' : 'JARVIS'))))));
  }
  q.oninput = debounce(run, 400);
  run();
}

async function researchList(out, view) {
  const input = h('input', { placeholder: 'Novo tema de pesquisa…', maxlength: 300 });
  const list = h('div', { class: 'list' });
  out.append(h('h3', { style: { marginTop: '1rem' } }, 'Minhas pesquisas'),
    h('form', { class: 'row', onsubmit: async (e) => {
      e.preventDefault(); const t = input.value.trim(); if (!t) return;
      try { const it = await api('/api/items', { method: 'POST', body: { kind: 'research', title: t } }); editor(view, it.id, 'research'); } catch (err) { fail(err); }
    } }, input, h('button', { class: 'btn', type: 'submit' }, 'Criar')), list);
  const items = await api('/api/items?kind=research&top=1').catch(() => []);
  if (!items.length) list.append(h('div', { class: 'empty' }, 'Use pesquisas para juntar notas, links e anexos sobre um tema.'));
  for (const it of items) list.append(row(it, () => editor(view, it.id, 'research'), () => {}));
}
