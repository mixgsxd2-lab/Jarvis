// Painel Configurações: voz, cidade, fuso horário, preferências, senha, exportação de dados e instalação.
import { api, confirmBox, fail, formBox, h, state, toast } from './core.js';
import { canSpeak, speak, voices } from './voice.js';

export async function render(root, ctx) {
  const s = { ...state.settings };
  const save = async (patch, msg = 'Configurações salvas') => {
    try {
      state.settings = await api('/api/settings', { method: 'PUT', body: patch });
      document.documentElement.style.setProperty('--accent', state.settings.theme_accent || '#29b6ff');
      window.dispatchEvent(new Event('jarvis:settings'));
      toast(msg);
    } catch (e) { fail(e); }
  };

  // ---- voz
  const voiceSel = h('select', { 'aria-label': 'Voz' });
  const fillVoices = () => {
    voiceSel.replaceChildren(h('option', { value: '' }, 'Automática (pt-BR)'), ...voices().map((v) => h('option', { value: v.name, selected: v.name === s.voice }, `${v.name} (${v.lang})`)));
  };
  fillVoices();
  window.addEventListener('jarvis:voices', fillVoices);
  ctx.onCleanup(() => window.removeEventListener('jarvis:voices', fillVoices));
  const rate = h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.05, value: s.voice_rate });
  const pitch = h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.05, value: s.voice_pitch });
  const autoSpeak = h('input', { type: 'checkbox', checked: s.auto_speak });
  const aiOn = h('input', { type: 'checkbox', checked: s.ai_enabled });
  root.append(h('div', { class: 'card stack' }, h('h3', {}, 'Voz'),
    canSpeak ? null : h('p', { class: 'badge warn' }, 'Este navegador não suporta voz falada.'),
    h('label', {}, 'Voz do JARVIS', voiceSel), h('label', {}, 'Velocidade', rate), h('label', {}, 'Tom', pitch),
    h('label', { class: 'check' }, autoSpeak, 'Falar as respostas automaticamente'),
    h('label', { class: 'check' }, aiOn, 'Usar IA nas conversas (quando configurada no servidor)'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { state.settings = { ...state.settings, voice: voiceSel.value, voice_rate: rate.value, voice_pitch: pitch.value }; speak('Olá, eu sou o JARVIS. Como posso ajudar?', { force: true }); } }, '▶ Testar voz'),
      h('button', { class: 'btn primary', onclick: () => save({ voice: voiceSel.value, voice_rate: Number(rate.value), voice_pitch: Number(pitch.value), auto_speak: autoSpeak.checked, ai_enabled: aiOn.checked }) }, 'Salvar voz'))));

  // ---- local e preferências
  const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['America/Sao_Paulo']).filter((z) => z.startsWith('America/') || z.startsWith('Europe/') || z.startsWith('Atlantic/') || z === 'UTC');
  if (!zones.includes(s.timezone)) zones.unshift(s.timezone);
  const f = {
    name: h('input', { value: s.name || '', maxlength: 60 }),
    city: h('input', { value: s.city || '' }),
    timezone: h('select', {}, zones.map((z) => h('option', { value: z, selected: z === s.timezone }, z.replace(/_/g, ' ')))),
    news_topic: h('input', { value: s.news_topic || '', placeholder: 'vazio = manchetes gerais' }),
    pomodoro_focus: h('input', { type: 'number', min: 1, max: 180, value: s.pomodoro_focus }),
    pomodoro_short: h('input', { type: 'number', min: 1, max: 60, value: s.pomodoro_short }),
    pomodoro_long: h('input', { type: 'number', min: 1, max: 120, value: s.pomodoro_long }),
    pomodoro_cycles: h('input', { type: 'number', min: 1, max: 12, value: s.pomodoro_cycles }),
    daily_focus_goal: h('input', { type: 'number', min: 0, max: 1440, value: s.daily_focus_goal }),
    break_reminder: h('select', {}, [[0, 'Desligado'], [30, 'A cada 30 min'], [45, 'A cada 45 min'], [60, 'A cada 1 hora'], [90, 'A cada 1h30']].map(([v, l]) => h('option', { value: v, selected: Number(s.break_reminder) === v }, l))),
    theme_accent: h('input', { type: 'color', value: s.theme_accent || '#29b6ff', style: { minHeight: '42px', padding: '2px' } }),
  };
  root.append(h('div', { class: 'card stack', style: { marginTop: '.8rem' } }, h('h3', {}, 'Você e sua região'),
    h('div', { class: 'grid2' }, h('label', {}, 'Como devo chamar você?', f.name), h('label', {}, 'Cidade (clima)', f.city),
      h('label', {}, 'Fuso horário', f.timezone), h('label', {}, 'Tema das notícias', f.news_topic)),
    h('h3', {}, 'Preferências'),
    h('div', { class: 'grid3' }, h('label', {}, 'Foco (min)', f.pomodoro_focus), h('label', {}, 'Pausa curta (min)', f.pomodoro_short),
      h('label', {}, 'Pausa longa (min)', f.pomodoro_long), h('label', {}, 'Ciclos até pausa longa', f.pomodoro_cycles),
      h('label', {}, 'Meta diária de foco (min)', f.daily_focus_goal), h('label', {}, 'Lembrete de pausa', f.break_reminder), h('label', {}, 'Cor de destaque', f.theme_accent)),
    h('button', { class: 'btn primary', onclick: () => save(Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.type === 'number' || k === 'break_reminder' ? Number(el.value) : el.value]))) }, 'Salvar preferências')));

  // ---- instalar
  root.append(h('div', { class: 'card stack', style: { marginTop: '.8rem' } }, h('h3', {}, 'Instalar como aplicativo'),
    h('p', {}, h('b', {}, 'Android (Chrome): '), 'menu ⋮ → “Instalar app” ou “Adicionar à tela inicial”.'),
    h('p', {}, h('b', {}, 'iPhone (Safari): '), 'botão Compartilhar □↑ → “Adicionar à Tela de Início” → Adicionar.'),
    installButton()));

  // ---- conta e dados
  root.append(h('div', { class: 'card stack', style: { marginTop: '.8rem' } }, h('h3', {}, 'Conta e dados'),
    h('p', { class: 'muted' }, `Conectado como ${state.user.username}. Seus dados são salvos automaticamente no servidor.`),
    h('div', { class: 'row' },
      h('a', { class: 'btn', href: '/api/export', download: '', style: { textDecoration: 'none' } }, '⬇ Baixar meus dados (JSON)'),
      h('button', { class: 'btn', onclick: changePassword }, 'Trocar senha'),
      h('button', { class: 'btn', onclick: async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); state.user = null; location.hash = ''; window.dispatchEvent(new Event('jarvis:logout')); } }, 'Sair')),
    h('button', { class: 'btn danger small', style: { marginTop: '1rem' }, onclick: deleteAccount }, 'Excluir minha conta e todos os dados')));
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
function installButton() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return h('p', { class: 'badge ok' }, 'Você já está usando o app instalado.');
  return h('button', { class: 'btn', onclick: async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
    else toast('Instalação', 'Use o menu do navegador conforme as instruções acima.');
  } }, 'Instalar agora');
}

async function changePassword() {
  const d = await formBox('Trocar senha', [
    { name: 'current', label: 'Senha atual', type: 'password', required: true },
    { name: 'new', label: 'Nova senha (mín. 8 caracteres)', type: 'password', required: true },
  ]);
  if (!d) return;
  try { const r = await api('/api/auth/password', { method: 'POST', body: d }); state.csrf = r.csrf; toast('Senha alterada', 'Outras sessões foram encerradas.'); }
  catch (e) { fail(e); }
}

async function deleteAccount() {
  if (!(await confirmBox('Isso apaga sua conta e TODOS os dados, sem volta. Recomendo baixar seus dados antes. Continuar?', { ok: 'Continuar', danger: true }))) return;
  const d = await formBox('Confirme com sua senha', [{ name: 'password', label: 'Senha', type: 'password', required: true }], { ok: 'Excluir definitivamente' });
  if (!d) return;
  try { await api('/api/account', { method: 'DELETE', body: d }); location.hash = ''; window.dispatchEvent(new Event('jarvis:logout')); }
  catch (e) { fail(e); }
}
