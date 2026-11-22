// Utilidades compartilhadas: API, DOM, avisos, modais, datas e gráficos.
export const state = { user: null, settings: {}, csrf: '', panel: null, cleanup: [] };

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

export async function api(path, { method = 'GET', body, form, raw } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let resp;
  try {
    resp = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch (e) {
    throw new ApiError('Sem conexão com o servidor. Verifique a internet.', 0);
  }
  if (raw) return resp;
  let data = null;
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('json')) data = await resp.json().catch(() => null);
  if (!resp.ok) {
    if (resp.status === 401 && !path.startsWith('/api/auth')) window.dispatchEvent(new Event('jarvis:logout'));
    throw new ApiError((data && data.error) || `Erro ${resp.status}`, resp.status, data);
  }
  return data;
}

// ---------- DOM ----------
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; // usado só com conteúdo estático do próprio app
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
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function tabs(names, active, onChange) {
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  for (const [key, label] of names) {
    bar.append(h('button', {
      class: 'tab' + (key === active ? ' active' : ''), role: 'tab', 'data-tab': key, type: 'button',
      onclick: () => { $$('.tab', bar).forEach((b) => b.classList.toggle('active', b.dataset.tab === key)); onChange(key); },
    }, label));
  }
  return bar;
}

// ---------- avisos ----------
export function toast(title, body = '', { error = false, ms = 4200 } = {}) {
  const box = $('#toasts');
  const t = h('div', { class: 'toast' + (error ? ' err' : '') }, h('b', {}, title), body ? h('div', { class: 'muted' }, body) : null);
  box.append(t);
  setTimeout(() => t.remove(), ms);
}
export function fail(e) { toast('Ops', e && e.message ? e.message : String(e), { error: true }); }

// ---------- modais ----------
export function modal(content, { onClose } = {}) {
  const wrap = $('#modal');
  const card = clear($('.modal-card', wrap));
  card.append(content);
  wrap.hidden = false;
  const close = () => { wrap.hidden = true; clear(card); wrap.onclick = null; onClose && onClose(); };
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  return close;
}
export function confirmBox(message, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; close(); resolve(v); } };
    const close = modal(h('div', {},
      h('p', {}, message),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn ghost', onclick: () => finish(false) }, 'Cancelar'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => finish(true) }, ok))),
    { onClose: () => { if (!done) { done = true; resolve(false); } } });
  });
}
/** Formulário em modal. fields: [{name,label,type,value,options,required,placeholder}] */
export function formBox(title, fields, { ok = 'Salvar', extra } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const form = h('form', {});
    for (const f of fields) {
      let input;
      if (f.type === 'select') {
        input = h('select', { name: f.name }, f.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(f.value ?? '') }, l)));
      } else if (f.type === 'textarea') {
        input = h('textarea', { name: f.name, placeholder: f.placeholder || '' }, f.value || '');
      } else if (f.type === 'checkbox') {
        form.append(h('label', { class: 'check' }, h('input', { type: 'checkbox', name: f.name, checked: !!f.value }), f.label));
        continue;
      } else {
        input = h('input', { name: f.name, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '',
          required: !!f.required, step: f.step, min: f.min, max: f.max, inputmode: f.inputmode });
      }
      form.append(h('label', {}, f.label, input));
    }
    if (extra) form.append(extra);
    form.append(h('div', { class: 'modal-actions' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { done = true; close(); resolve(null); } }, 'Cancelar'),
      h('button', { class: 'btn primary', type: 'submit' }, ok)));
    form.onsubmit = (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        out[f.name] = f.type === 'checkbox' ? el.checked : el.value;
      }
      done = true; close(); resolve(out);
    };
    const close = modal(h('div', {}, h('h3', {}, title), form), { onClose: () => { if (!done) resolve(null); } });
    setTimeout(() => { const first = form.querySelector('input:not([type=checkbox]),textarea,select'); first && first.focus(); }, 50);
  });
}

// ---------- datas ----------
const pad = (n) => String(n).padStart(2, '0');
export const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function parseLocal(s) { if (!s) return null; const [d, t = '00:00:00'] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [hh, mm, ss = 0] = t.split(':').map(Number); return new Date(y, m - 1, dd, hh, mm, ss); }
export function toLocalISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function fmtTime(s) { const d = typeof s === 'string' ? parseLocal(s) : s; return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''; }
export function fmtDate(s, withTime = true) {
  const d = typeof s === 'string' ? parseLocal(s) : s; if (!d) return '';
  const today = new Date(); const tm = new Date(today); tm.setDate(today.getDate() + 1);
  let day;
  if (dateKey(d) === dateKey(today)) day = 'hoje';
  else if (dateKey(d) === dateKey(tm)) day = 'amanhã';
  else day = `${DOW[d.getDay()]}, ${d.getDate()}/${pad(d.getMonth() + 1)}${d.getFullYear() !== today.getFullYear() ? '/' + d.getFullYear() : ''}`;
  return withTime ? `${day} ${fmtTime(d)}` : day;
}
export function fmtUTC(s) { if (!s) return ''; const d = new Date(s + 'Z'); return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; }
export function fmtNum(v, dec = 2) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
export function fmtBytes(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`; }

export function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; return d; }

export function setSaveState(text, ok = true) {
  const el = $('#save-state'); if (!el) return;
  el.textContent = text; el.style.color = ok ? 'var(--ok)' : 'var(--danger)';
}

// ---------- gráficos SVG ----------
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}) { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; }

export function lineChart(points, { height = 200, fmt = (v) => fmtNum(v), xfmt = (t) => '' } = {}) {
  const W = 640, H = height, P = { l: 8, r: 64, t: 12, b: 22 };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', preserveAspectRatio: 'none', role: 'img' });
  if (!points || points.length < 2) { const t = s('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }); t.textContent = 'Sem dados suficientes'; svg.append(t); return svg; }
  const ys = points.map((p) => p[1]); const min = Math.min(...ys), max = Math.max(...ys); const span = max - min || 1;
  const x = (i) => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - min) / span) * (H - P.t - P.b);
  const up = ys[ys.length - 1] >= ys[0];
  const color = up ? '#3ddc97' : '#ff5c7a';
  const defs = s('defs'); const lg = s('linearGradient', { id: 'lg' + up, x1: 0, y1: 0, x2: 0, y2: 1 });
  lg.append(s('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '.35' }), s('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' }));
  defs.append(lg); svg.append(defs);
  for (const v of [min, (min + max) / 2, max]) {
    svg.append(s('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), stroke: 'rgba(41,182,255,.15)', 'stroke-dasharray': '3 4' }));
    const t = s('text', { x: W - P.r + 6, y: y(v) + 3 }); t.textContent = fmt(v); svg.append(t);
  }
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  svg.append(s('path', { d: `${d}L${x(points.length - 1)},${H - P.b}L${x(0)},${H - P.b}Z`, fill: `url(#lg${up})` }));
  svg.append(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  for (const i of [0, Math.floor(points.length / 2), points.length - 1]) {
    const t = s('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle' });
    t.textContent = xfmt(points[i][0]); svg.append(t);
  }
  return svg;
}

export function barChart(items, { height = 180, goal = 0 } = {}) {
  const W = 640, H = height, P = { l: 6, r: 6, t: 14, b: 22 };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  const max = Math.max(goal, ...items.map((i) => i.value), 1);
  const bw = (W - P.l - P.r) / items.length;
  items.forEach((it, i) => {
    const bh = (it.value / max) * (H - P.t - P.b);
    const hit = goal && it.value >= goal;
    svg.append(s('rect', { x: P.l + i * bw + bw * 0.15, y: H - P.b - bh, width: bw * 0.7, height: Math.max(bh, 1), rx: 3,
      fill: hit ? '#3ddc97' : '#29b6ff', opacity: it.value ? 0.9 : 0.25 }));
    const t = s('text', { x: P.l + i * bw + bw / 2, y: H - 7, 'text-anchor': 'middle' }); t.textContent = it.label; svg.append(t);
    if (it.value) { const v = s('text', { x: P.l + i * bw + bw / 2, y: H - P.b - bh - 3, 'text-anchor': 'middle' }); v.textContent = Math.round(it.value); svg.append(v); }
  });
  if (goal) {
    const gy = H - P.b - (goal / max) * (H - P.t - P.b);
    svg.append(s('line', { x1: P.l, x2: W - P.r, y1: gy, y2: gy, stroke: '#ffc857', 'stroke-dasharray': '5 4' }));
  }
  return svg;
}

// ---------- sons ----------
let audioCtx;
export function beep(pattern = [[880, 0.18], [0, 0.08], [880, 0.18]], volume = 0.25) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    let t = audioCtx.currentTime;
    for (const [freq, dur] of pattern) {
      if (freq) {
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = freq; g.gain.setValueAtTime(volume, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + dur);
      }
      t += dur;
    }
  } catch (_) { /* sem áudio */ }
}
export function unlockAudio() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (_) {} }

// ---------- notificações do sistema ----------
export async function systemNotify(title, body, { alarm = false } = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, icon: '/static/icons/icon-192.png', badge: '/static/icons/icon-192.png', requireInteraction: alarm, vibrate: alarm ? [400, 200, 400] : [200] };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch (_) { /* ignorado */ }
}
