// Ajustes: perfil, aparência, preferências, notificações, instalação, senha, exportação e conta.
import { api, emit, fail, formBox, h, icon, state, toast } from './core.js';
import { topbar } from './app.js';
import { COLORS } from './item.js';

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });

export async function render(root) {
  const s = { ...state.settings };
  const save = async (patch, msg = 'Ajustes salvos') => {
    try { state.settings = await api('/api/settings', { method: 'PUT', body: patch }); emit('settings'); toast(msg); } catch (e) { fail(e); }
  };
  const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['America/Sao_Paulo']).filter((z) => /^(America|Europe|Atlantic)\//.test(z) || z === 'UTC');
  if (!zones.includes(s.timezone)) zones.unshift(s.timezone);
  const f = {
    name: h('input', { value: s.name || '', maxlength: 60 }),
    timezone: h('select', {}, zones.map((z) => h('option', { value: z, selected: z === s.timezone }, z.replace(/_/g, ' ')))),
    start_view: h('select', {}, [['hoje', 'Hoje'], ['tarefas', 'Tarefas'], ['projetos', 'Projetos'], ['agenda', 'Agenda']].map(([v, l]) => h('option', { value: v, selected: s.start_view === v }, l))),
    week_start: h('select', {}, [[0, 'Domingo'], [1, 'Segunda-feira']].map(([v, l]) => h('option', { value: v, selected: Number(s.week_start) === v }, l))),
    pomodoro_focus: h('input', { type: 'number', min: 1, max: 180, value: s.pomodoro_focus }),
    pomodoro_short: h('input', { type: 'number', min: 1, max: 60, value: s.pomodoro_short }),
    pomodoro_long: h('input', { type: 'number', min: 1, max: 120, value: s.pomodoro_long }),
    pomodoro_cycles: h('input', { type: 'number', min: 1, max: 12, value: s.pomodoro_cycles }),
    daily_focus_goal: h('input', { type: 'number', min: 0, max: 1440, value: s.daily_focus_goal }),
    break_reminder: h('select', {}, [[0, 'Desligado'], [30, 'A cada 30 min'], [45, 'A cada 45 min'], [60, 'A cada 1 hora'], [90, 'A cada 1h30']].map(([v, l]) => h('option', { value: v, selected: Number(s.break_reminder) === v }, l))),
  };
  const num = new Set(['week_start', 'pomodoro_focus', 'pomodoro_short', 'pomodoro_long', 'pomodoro_cycles', 'daily_focus_goal', 'break_reminder']);
  const collect = (keys) => Object.fromEntries(keys.map((k) => [k, num.has(k) ? Number(f[k].value) : f[k].value]));

  const theme = h('div', { class: 'seg' });
  const drawTheme = () => theme.replaceChildren(...[['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']].map(([v, l]) =>
    h('button', { class: (state.settings.theme || 'auto') === v ? 'on' : '', onclick: async () => { await save({ theme: v }, 'Tema alterado'); drawTheme(); } }, l)));
  drawTheme();
  const accents = h('div', { class: 'row' }, COLORS.map((c) => h('button', { class: 'btn icon sm', 'aria-label': 'Cor ' + c,
    style: { background: c, borderColor: c, outline: (state.settings.accent || '#5b5bd6') === c ? '2px solid var(--text)' : 'none', outlineOffset: '2px' },
    onclick: async (e) => { await save({ accent: c }, 'Cor alterada'); accents.querySelectorAll('button').forEach((b) => { b.style.outline = 'none'; }); e.currentTarget.style.outline = '2px solid var(--text)'; } })));

  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  root.append(topbar('Ajustes'), h('div', { class: 'stack', style: { maxWidth: '760px' } },
    h('section', { class: 'card stack' }, h('h3', {}, 'Perfil'),
      h('div', { class: 'fields' }, h('label', { class: 'f' }, 'Seu nome', f.name), h('label', { class: 'f' }, 'Fuso horário', f.timezone),
        h('label', { class: 'f' }, 'Tela inicial', f.start_view), h('label', { class: 'f' }, 'Semana começa no', f.week_start)),
      h('button', { class: 'btn primary', onclick: () => save(collect(['name', 'timezone', 'start_view', 'week_start'])) }, 'Salvar perfil')),
    h('section', { class: 'card stack' }, h('h3', {}, 'Aparência'),
      h('div', { class: 'row spread' }, h('span', {}, 'Tema'), theme), h('div', { class: 'row spread' }, h('span', {}, 'Cor de destaque'), accents)),
    h('section', { class: 'card stack' }, h('h3', {}, 'Foco'),
      h('div', { class: 'fields' }, h('label', { class: 'f' }, 'Bloco de foco (min)', f.pomodoro_focus), h('label', { class: 'f' }, 'Pausa curta (min)', f.pomodoro_short),
        h('label', { class: 'f' }, 'Pausa longa (min)', f.pomodoro_long), h('label', { class: 'f' }, 'Blocos até a pausa longa', f.pomodoro_cycles),
        h('label', { class: 'f' }, 'Meta diária de foco (min)', f.daily_focus_goal), h('label', { class: 'f' }, 'Lembrete de pausa', f.break_reminder)),
      h('button', { class: 'btn primary', onclick: () => save(collect(['pomodoro_focus', 'pomodoro_short', 'pomodoro_long', 'pomodoro_cycles', 'daily_focus_goal', 'break_reminder'])) }, 'Salvar preferências de foco')),
    h('section', { class: 'card stack' }, h('h3', {}, 'Instalar no celular'),
      standalone ? h('p', { class: 'badge ok' }, 'Você já está usando o app instalado.') : null,
      h('p', {}, h('b', {}, 'Android (Chrome): '), 'menu ⋮ → “Instalar app”.'),
      h('p', {}, h('b', {}, 'iPhone (Safari): '), 'Compartilhar → “Adicionar à Tela de Início”.'),
      standalone ? null : h('button', { class: 'btn', onclick: async () => { if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; } else toast('Use o menu do navegador como explicado acima.'); } }, icon('download', 'sm'), 'Instalar agora'),
      h('p', { class: 'muted small' }, 'Notificações: Agenda → Notificações. Atalhos no computador: “N” adiciona, “/” busca.')),
    h('section', { class: 'card stack' }, h('h3', {}, 'Conta e dados'),
      h('p', { class: 'muted' }, `Conectado como ${state.user.username}. Tudo é salvo automaticamente.`),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: '/api/export', download: '' }, icon('download', 'sm'), 'Baixar meus dados'),
        h('button', { class: 'btn', onclick: changePassword }, 'Trocar senha'),
        h('button', { class: 'btn', onclick: async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.hash = ''; emit('logout'); } }, icon('logout', 'sm'), 'Sair')),
      h('button', { class: 'btn danger sm', style: { alignSelf: 'flex-start' }, onclick: deleteAccount }, 'Excluir conta e todos os dados'))));
}

async function changePassword() {
  const d = await formBox('Trocar senha', [{ name: 'current', label: 'Senha atual', type: 'password', required: true }, { name: 'new', label: 'Nova senha (mín. 8 caracteres)', type: 'password', required: true }]);
  if (!d) return;
  try { const r = await api('/api/auth/password', { method: 'POST', body: d }); state.csrf = r.csrf; toast('Senha alterada', 'As outras sessões foram encerradas.'); } catch (e) { fail(e); }
}

async function deleteAccount() {
  const d = await formBox('Excluir conta', [{ name: 'password', label: 'Isso apaga TUDO, sem volta. Baixe seus dados antes. Digite sua senha para confirmar:', type: 'password', required: true }], { ok: 'Excluir definitivamente' });
  if (!d) return;
  try { await api('/api/account', { method: 'DELETE', body: d }); location.hash = ''; emit('logout'); } catch (e) { fail(e); }
}
