// Ideias em tópicos: escrever, Enter para salvar, tocar para editar, × para apagar.
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
let csrf = '';

async function api(path, { method = 'GET', body, keepalive = false } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let resp;
  try {
    resp = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', keepalive });
  } catch (_) { throw new Error('Sem conexão. Tente de novo.'); }
  const data = await resp.json().catch(() => null);
  if (resp.status === 401 && !path.startsWith('/api/auth')) { showLogin(false); throw new Error('Entre novamente.'); }
  if (!resp.ok) throw new Error((data && data.error) || `Erro ${resp.status}`);
  return data;
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.filter((k) => k !== null && k !== undefined));
  return e;
}

let toastTimer;
function toast(msg, action) {
  clearTimeout(toastTimer);
  toastEl.replaceChildren(el('span', {}, msg), action ? el('button', { onclick: () => { action.fn(); toastEl.hidden = true; } }, action.label) : '');
  toastEl.hidden = false;
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 5000);
}

// ------------------------------------------------------------------ login
function showLogin(signup, error = '') {
  let isSignup = signup;
  const user = el('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, minlength: 3, maxlength: 40 });
  const pass = el('input', { name: 'password', type: 'password', required: true, minlength: 8 });
  const err = el('p', { class: 'error', role: 'alert' }, error);
  const btn = el('button', { class: 'btn', type: 'submit' });
  const sub = el('p', { class: 'muted' });
  const toggle = el('button', { class: 'link', type: 'button', hidden: !signup });
  const draw = () => {
    btn.textContent = isSignup ? 'Criar conta' : 'Entrar';
    sub.textContent = isSignup ? 'Crie sua conta (só na primeira vez).' : 'Entre para ver suas ideias.';
    toggle.textContent = isSignup ? 'Já tenho conta' : 'Criar conta';
    pass.setAttribute('autocomplete', isSignup ? 'new-password' : 'current-password');
  };
  toggle.addEventListener('click', () => { isSignup = !isSignup; draw(); });
  const form = el('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; err.textContent = '';
    try {
      const r = await api(isSignup ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: { username: user.value.trim(), password: pass.value } });
      csrf = r.csrf;
      showIdeas();
    } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
  } }, el('h1', {}, 'Ideias'), sub, el('label', {}, 'Usuário', user), el('label', {}, 'Senha (mín. 8 caracteres)', pass), err, btn, toggle);
  draw();
  app.replaceChildren(form);
  user.focus();
}

// ------------------------------------------------------------------ ideias
const pendingDeletes = new Map(); // id -> timer (apaga de verdade após 5 s, para poder desfazer)

async function showIdeas() {
  const input = el('input', { placeholder: 'Nova ideia…', 'aria-label': 'Nova ideia', maxlength: 300, enterkeyhint: 'done', autocomplete: 'off' });
  const addBtn = el('button', { class: 'btn', type: 'submit' }, 'Anotar');
  const list = el('ul', { class: 'ideas' });
  const empty = el('p', { class: 'empty' }, 'Nenhuma ideia ainda. Escreva a primeira acima.');
  const count = el('span', {});
  let ideas = [];

  const render = () => {
    const visible = ideas.filter((i) => !pendingDeletes.has(i.id));
    list.replaceChildren(...visible.map(item));
    empty.hidden = visible.length > 0;
    count.textContent = visible.length ? `${visible.length} ${visible.length === 1 ? 'ideia' : 'ideias'}` : '';
  };

  function item(idea) {
    const text = el('span', { class: 'text', contenteditable: 'true', role: 'textbox', 'aria-label': 'Editar ideia', spellcheck: 'true' });
    text.textContent = idea.text;
    const save = async () => {
      const t = text.textContent.replace(/\s+/g, ' ').trim();
      if (!t) { text.textContent = idea.text; return; }
      if (t === idea.text) return;
      try { const r = await api(`/api/ideias/${idea.id}`, { method: 'PATCH', body: { text: t } }); idea.text = r.text; toast('Ideia atualizada'); }
      catch (e) { text.textContent = idea.text; toast(e.message); }
    };
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); text.blur(); }
      if (e.key === 'Escape') { text.textContent = idea.text; text.blur(); }
    });
    text.addEventListener('blur', save);
    text.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
    const del = el('button', { class: 'del', 'aria-label': `Apagar “${idea.text}”`, title: 'Apagar', onclick: () => remove(idea) }, '×');
    return el('li', {}, el('span', { class: 'dot', 'aria-hidden': 'true' }), text, del);
  }

  function remove(idea) {
    const timer = setTimeout(() => commitDelete(idea.id), 5000);
    pendingDeletes.set(idea.id, timer);
    render();
    toast('Ideia apagada', { label: 'Desfazer', fn: () => { clearTimeout(pendingDeletes.get(idea.id)); pendingDeletes.delete(idea.id); render(); } });
  }
  async function commitDelete(id, keepalive = false) {
    pendingDeletes.delete(id);
    try { await api(`/api/ideias/${id}`, { method: 'DELETE', keepalive }); ideas = ideas.filter((i) => i.id !== id); }
    catch (e) { toast(e.message); render(); }
  }

  const form = el('form', { class: 'add', onsubmit: async (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    addBtn.disabled = true;
    try {
      const r = await api('/api/ideias', { method: 'POST', body: { text: t } });
      ideas.unshift(r);
      input.value = '';
      render();
    } catch (ex) { toast(ex.message); } finally { addBtn.disabled = false; input.focus(); }
  } }, input, addBtn);

  const logout = el('button', { class: 'link', onclick: async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); showLogin(false); } }, 'Sair');
  app.replaceChildren(el('h1', {}, 'Ideias'), form, list, empty, el('div', { class: 'foot' }, count, logout));
  try { ideas = await api('/api/ideias'); } catch (e) { toast(e.message); }
  render();
}

// se o app for fechado com uma exclusão pendente, conclui a exclusão
window.addEventListener('pagehide', () => {
  for (const [id, timer] of pendingDeletes) { clearTimeout(timer); api(`/api/ideias/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {}); }
  pendingDeletes.clear();
});

// ------------------------------------------------------------------ início
(async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try {
    const st = await api('/api/auth/state');
    if (st.authenticated) { csrf = st.csrf; showIdeas(); } else showLogin(st.signup);
  } catch (e) { showLogin(false, e.message); }
})();
