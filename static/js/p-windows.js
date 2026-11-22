// Painel Windows (opcional): apps e sites autorizados, volume, uso do computador e temporizadores via agente local.
import { api, clear, confirmBox, fail, fmtUTC, formBox, h, modal, state, toast } from './core.js';

export async function render(root, ctx) {
  const box = h('div', { class: 'stack' });
  root.append(box);
  await draw(box);
  const iv = setInterval(() => refreshDevices(box), 10000);
  ctx.onCleanup(() => clearInterval(iv));
}

let devices = [];
async function refreshDevices(box) {
  const prev = JSON.stringify(devices.map((d) => [d.id, d.online]));
  devices = await api('/api/windows/devices').catch(() => devices);
  if (JSON.stringify(devices.map((d) => [d.id, d.online])) !== prev) draw(box);
}

async function send(type, payload = {}) {
  try {
    const c = await api('/api/windows/commands', { method: 'POST', body: { type, payload } });
    if (c.warning) toast('Comando na fila', c.warning); else toast('Comando enviado');
    return c;
  } catch (e) { fail(e); return null; }
}

async function waitResult(id, tries = 16) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 750));
    const c = await api(`/api/windows/commands/${id}`).catch(() => null);
    if (c && (c.status === 'ok' || c.status === 'erro')) return c;
  }
  return null;
}

async function draw(box) {
  devices = await api('/api/windows/devices').catch((e) => { fail(e); return []; });
  clear(box);
  const online = devices.find((d) => d.online);
  const s = state.settings;

  // ---- computadores
  const devCard = h('div', { class: 'card stack' }, h('h3', {}, 'Computadores conectados'));
  if (!devices.length) devCard.append(h('p', { class: 'muted' }, 'Nenhum computador ainda. Siga os 3 passos abaixo para conectar seu PC com Windows.'));
  for (const d of devices) {
    const info = d.info || {};
    devCard.append(h('div', { class: 'li', style: { cursor: 'default' } },
      h('span', { class: 'badge ' + (d.online ? 'ok' : '') }, d.online ? 'online' : 'offline'),
      h('div', { class: 'grow' }, h('span', { class: 't' }, d.name), h('div', { class: 'meta' }, d.last_seen ? 'Visto em ' + fmtUTC(d.last_seen) : 'Nunca conectado',
        info.cpu_percent != null ? ` · CPU ${Math.round(info.cpu_percent)}% · RAM ${Math.round(info.memory_percent)}%` : '')),
      h('button', { class: 'btn small danger', onclick: async () => {
        if (!(await confirmBox(`Remover “${d.name}”? O agente desse PC deixará de funcionar.`, { ok: 'Remover', danger: true }))) return;
        await api(`/api/windows/devices/${d.id}`, { method: 'DELETE' }).catch(fail); draw(box);
      } }, 'Remover')));
  }
  devCard.append(h('button', { class: 'btn', onclick: async () => {
    const f = await formBox('Conectar computador', [{ name: 'name', label: 'Nome do computador', value: 'Meu PC', required: true }], { ok: 'Gerar chave' });
    if (!f) return;
    const name = f.name;
    try {
      const d = await api('/api/windows/devices', { method: 'POST', body: { name } });
      const close = modal(h('div', { class: 'stack' }, h('h3', {}, 'Chave do agente'),
        h('p', {}, 'Copie esta chave agora (ela não será mostrada de novo) e cole no arquivo jarvis_agent.json do seu PC:'),
        h('div', { class: 'token-box' }, d.token),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', onclick: () => navigator.clipboard?.writeText(d.token).then(() => toast('Copiado!')) }, 'Copiar'),
          h('button', { class: 'btn primary', onclick: () => { close(); draw(box); } }, 'Pronto'))));
    } catch (e) { fail(e); }
  } }, '+ Conectar um computador'));
  box.append(devCard);

  // ---- controles
  const ctl = h('div', { class: 'card stack' }, h('h3', {}, 'Controles'), online ? null : h('p', { class: 'badge warn' }, 'Nenhum computador online — os comandos expiram em 2 minutos.'));
  const apps = s.windows_apps || [];
  ctl.append(h('b', {}, 'Abrir aplicativo'), apps.length ? h('div', { class: 'row' }, apps.map((a) => h('button', { class: 'btn small', onclick: () => send('open_app', { name: a }) }, a)))
    : h('p', { class: 'muted' }, 'Autorize aplicativos abaixo.'));
  const sites = s.windows_sites || [];
  ctl.append(h('b', {}, 'Abrir site'), sites.length ? h('div', { class: 'row' }, sites.map((u) => h('button', { class: 'btn small', onclick: () => send('open_site', { url: u }) }, u)))
    : h('p', { class: 'muted' }, 'Autorize sites abaixo.'));
  const vol = h('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Volume' });
  const volLabel = h('b', {}, '50%');
  vol.oninput = () => { volLabel.textContent = vol.value + '%'; };
  vol.onchange = () => send('volume', { level: Number(vol.value) });
  ctl.append(h('b', {}, 'Volume'), h('div', { class: 'row' }, vol, volLabel,
    h('button', { class: 'btn small', onclick: () => send('volume', { action: 'down' }) }, '−'),
    h('button', { class: 'btn small', onclick: () => send('volume', { action: 'up' }) }, '+'),
    h('button', { class: 'btn small', onclick: () => send('volume', { action: 'mute' }) }, 'Mudo')));
  const usage = h('div', { class: 'muted' });
  ctl.append(h('b', {}, 'Uso do computador'), h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: async () => {
    const c = await send('system_info'); if (!c) return;
    usage.textContent = 'Consultando…';
    const r = await waitResult(c.id);
    if (!r) { usage.textContent = 'Sem resposta do computador.'; return; }
    const i = r.result || {};
    usage.textContent = r.status === 'ok'
      ? [i.cpu_percent != null && `CPU ${Math.round(i.cpu_percent)}%`, i.memory_percent != null && `Memória ${Math.round(i.memory_percent)}% (${i.memory_used_gb}/${i.memory_total_gb} GB)`,
        i.disk_percent != null && `Disco ${Math.round(i.disk_percent)}%`, i.battery_percent != null && `Bateria ${Math.round(i.battery_percent)}%${i.plugged ? ' (carregando)' : ''}`,
        i.uptime_hours != null && `Ligado há ${i.uptime_hours} h`].filter(Boolean).join(' · ')
      : 'Erro: ' + (i.message || '');
  } }, 'Consultar agora'), usage));
  const tmin = h('input', { type: 'number', min: 1, max: 1440, value: 10, inputmode: 'numeric', 'aria-label': 'Minutos' });
  const tlabel = h('input', { placeholder: 'Descrição', value: 'Temporizador' });
  ctl.append(h('b', {}, 'Temporizador no PC'), h('div', { class: 'row' }, tmin, h('span', { class: 'muted', style: { flex: '0 0 auto' } }, 'min'), tlabel,
    h('button', { class: 'btn small primary', onclick: () => send('timer', { seconds: Math.round(Number(tmin.value) * 60), label: tlabel.value }) }, 'Iniciar')));
  box.append(ctl);

  // ---- autorizações
  const appsIn = h('textarea', { style: { minHeight: '90px' }, placeholder: 'Um por linha. Ex.:\nBloco de Notas\nCalculadora\nChrome' }, apps.join('\n'));
  const sitesIn = h('textarea', { style: { minHeight: '90px' }, placeholder: 'Um domínio por linha. Ex.:\nyoutube.com\ngmail.com' }, sites.join('\n'));
  box.append(h('div', { class: 'card stack' }, h('h3', {}, 'Lista de autorizados'),
    h('p', { class: 'muted' }, 'Só o que estiver aqui E no arquivo do agente no seu PC pode ser aberto (dupla autorização).'),
    h('label', {}, 'Aplicativos (nomes iguais aos do jarvis_agent.json)', appsIn), h('label', {}, 'Sites', sitesIn),
    h('button', { class: 'btn primary', onclick: async () => {
      try { state.settings = await api('/api/settings', { method: 'PUT', body: { windows_apps: appsIn.value, windows_sites: sitesIn.value } }); toast('Autorizações salvas'); draw(box); }
      catch (e) { fail(e); }
    } }, 'Salvar autorizações')));

  // ---- instruções
  box.append(h('div', { class: 'card stack' }, h('h3', {}, 'Como instalar o agente no Windows'),
    h('ol', {},
      h('li', {}, 'Instale o Python 3 (python.org) marcando “Add Python to PATH”.'),
      h('li', {}, 'Baixe o agente: ', h('a', { href: '/download/jarvis_agent.py' }, 'jarvis_agent.py'), '. Opcional, para volume exato e uso do PC: ', h('span', { class: 'kbd' }, 'pip install psutil pycaw comtypes')),
      h('li', {}, 'Rode uma vez ', h('span', { class: 'kbd' }, 'python jarvis_agent.py'), ' — ele cria o jarvis_agent.json. Coloque nele o endereço do seu JARVIS (', h('span', { class: 'kbd' }, location.origin), '), a chave gerada acima e os apps/sites autorizados. Rode de novo e deixe a janela aberta (ou coloque na Inicialização do Windows).'))));
}
