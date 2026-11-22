// Utilidades compartilhadas: API, DOM, ícones, avisos, modais, datas e gráficos.
export const state = { user: null, settings: {}, csrf: '', cleanup: [] };

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let resp;
  try { resp = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' }); }
  catch (_) { throw new ApiError('Sem conexão. Verifique a internet e tente de novo.', 0); }
  const data = (resp.headers.get('content-type') || '').includes('json') ? await resp.json().catch(() => null) : null;
  if (!resp.ok) {
    if (resp.status === 401 && !path.startsWith('/api/auth')) emit('logout');
    throw new ApiError((data && data.error) || `Erro ${resp.status}`, resp.status);
  }
  return data;
}

// ---------- eventos internos ----------
export const emit = (name, detail) => window.dispatchEvent(new CustomEvent('jv:' + name, { detail }));
export function on(name, fn) { const f = (e) => fn(e.detail); window.addEventListener('jv:' + name, f); return () => window.removeEventListener('jv:' + name, f); }
/** Assina um evento enquanto a tela atual estiver aberta. */
export function onView(name, fn) { state.cleanup.push(on(name, fn)); }

// ---------- DOM ----------
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el) { el.replaceChildren(); return el; }

// ---------- ícones (traço simples, 24x24) ----------
const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  tasks: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 12l2.5 2.5L16 9"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/>',
  idea: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  focus: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  clip: '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"/>',
  repeat: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
};
export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span.firstChild;
}

// ---------- avisos ----------
export function toast(title, sub = '', { error = false, ms = 3800, action } = {}) {
  const t = h('div', { class: 'toast' + (error ? ' err' : '') }, h('div', { class: 'grow' }, title, sub ? h('small', {}, sub) : null),
    action ? h('button', { onclick: () => { action.fn(); t.remove(); } }, action.label) : null);
  const box = $('#toasts');
  while (box.children.length >= 2) box.firstChild.remove();
  box.append(t);
  setTimeout(() => t.remove(), ms);
}
export function fail(e) { toast(e && e.message ? e.message : String(e), '', { error: true }); }

// ---------- modais ----------
export function modal(content, { onClose } = {}) {
  const card = h('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' }, content);
  const wrap = h('div', { class: 'modal' }, card);
  let closed = false;
  const close = () => { if (closed) return; closed = true; wrap.remove(); document.removeEventListener('keydown', esc); onClose && onClose(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', esc);
  document.body.append(wrap);
  setTimeout(() => { const f = card.querySelector('[autofocus], input:not([type=checkbox]), textarea, select'); f && f.focus(); }, 40);
  return close;
}
export function confirmBox(message, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let v = false;
    const close = modal(h('div', {}, h('p', { style: { fontSize: '1rem', margin: '0 0 .5rem' } }, message),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => close() }, 'Cancelar'),
        h('button', { class: 'btn ' + (danger ? 'primary danger-bg' : 'primary'), style: danger ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : null,
          onclick: () => { v = true; close(); } }, ok))), { onClose: () => resolve(v) });
  });
}
/** Formulário em modal. fields: [{name,label,type,value,options,required,placeholder}] */
export function formBox(title, fields, { ok = 'Salvar', extra } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const form = h('form', {});
    for (const f of fields) {
      if (f.type === 'checkbox') { form.append(h('label', { class: 'check' }, h('input', { type: 'checkbox', name: f.name, checked: !!f.value }), f.label)); continue; }
      let input;
      if (f.type === 'select') input = h('select', { name: f.name }, f.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(f.value ?? '') }, l)));
      else if (f.type === 'textarea') input = h('textarea', { name: f.name, placeholder: f.placeholder || '' }, f.value || '');
      else input = h('input', { name: f.name, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', required: !!f.required, step: f.step, min: f.min, max: f.max });
      form.append(h('label', { class: 'f' }, f.label, input));
    }
    if (extra) form.append(extra);
    form.append(h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar'),
      h('button', { class: 'btn primary', type: 'submit' }, ok)));
    form.onsubmit = (e) => {
      e.preventDefault();
      result = {};
      for (const f of fields) { const el = form.elements[f.name]; result[f.name] = f.type === 'checkbox' ? el.checked : el.value; }
      close();
    };
    const close = modal(h('div', {}, h('h2', {}, title), form), { onClose: () => resolve(result) });
  });
}

// ---------- datas ----------
const pad = (n) => String(n).padStart(2, '0');
export const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const DOW_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function parseLocal(s) { if (!s) return null; const [d, t = '00:00:00'] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [hh, mm] = t.split(':').map(Number); return new Date(y, m - 1, dd, hh || 0, mm || 0); }
export function toLocalISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function fmtTime(s) { const d = typeof s === 'string' ? parseLocal(s) : s; return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''; }
export function hasTime(s) { return s && !/T00:00(:00)?$/.test(s); }
export function dayLabel(d) {
  const today = new Date(); const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((x - t) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  if (diff === -1) return 'Ontem';
  if (diff > 1 && diff < 7) return DOW_LONG[d.getDay()].replace('-feira', '').replace(/^./, (c) => c.toUpperCase());
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : ''}`;
}
export function fmtDue(s) { if (!s) return ''; const d = parseLocal(s); return dayLabel(d) + (hasTime(s) ? ' ' + fmtTime(d) : ''); }
export function isLate(s) { if (!s) return false; const d = parseLocal(s); const now = new Date(); return hasTime(s) ? d < now : dateKey(d) < dateKey(now); }
export function fmtUTC(s) { if (!s) return ''; const d = new Date(s + 'Z'); return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; }
export function fmtBytes(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`; }
export function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = () => { clearTimeout(t); fn(); }; return d; }

// ---------- gráfico de barras ----------
export function barChart(items, { goal = 0 } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = (tag, a) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) el.setAttribute(k, v); return el; };
  const W = 640, H = 180, P = { l: 4, r: 4, t: 16, b: 22 };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  const max = Math.max(goal, ...items.map((i) => i.value), 1);
  const bw = (W - P.l - P.r) / items.length;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b5bd6';
  items.forEach((it, i) => {
    const bh = (it.value / max) * (H - P.t - P.b);
    svg.append(s('rect', { x: P.l + i * bw + bw * .18, y: H - P.b - bh, width: bw * .64, height: Math.max(bh, 2), rx: 4,
      fill: it.value ? accent : 'currentColor', opacity: it.value ? (goal && it.value >= goal ? 1 : .55) : .12 }));
    const t = s('text', { x: P.l + i * bw + bw / 2, y: H - 6, 'text-anchor': 'middle' }); t.textContent = it.label; svg.append(t);
    if (it.value) { const v = s('text', { x: P.l + i * bw + bw / 2, y: H - P.b - bh - 4, 'text-anchor': 'middle' }); v.textContent = Math.round(it.value); svg.append(v); }
  });
  if (goal) { const gy = H - P.b - (goal / max) * (H - P.t - P.b); svg.append(s('line', { x1: P.l, x2: W - P.r, y1: gy, y2: gy, stroke: accent, 'stroke-dasharray': '4 4', opacity: .7 })); }
  return svg;
}

// ---------- sons e notificações ----------
let audioCtx;
export function beep(pattern = [[880, .15], [0, .07], [1175, .2]], volume = .2) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    let t = audioCtx.currentTime;
    for (const [f, d] of pattern) {
      if (f) { const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); o.frequency.value = f; g.gain.setValueAtTime(volume, t); g.gain.exponentialRampToValueAtTime(.001, t + d); o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + d); }
      t += d;
    }
  } catch (_) {}
}
export function unlockAudio() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (_) {} }
export async function systemNotify(title, body, { alarm = false } = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, icon: '/static/icons/icon-192.png', badge: '/static/icons/icon-192.png', requireInteraction: alarm };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch (_) {}
}
