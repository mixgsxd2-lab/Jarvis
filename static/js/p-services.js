// Painel Serviços: clima, notícias, Spotify e cotações reais (BBAS3, Ibovespa, dólar, euro) com gráficos, conversor e alertas.
import { api, clear, confirmBox, fail, fmtNum, formBox, h, lineChart, state, tabs, toast } from './core.js';

export async function render(root, ctx) {
  const view = h('div');
  root.append(tabs([['quotes', 'Cotações'], ['weather', 'Clima'], ['news', 'Notícias'], ['spotify', 'Spotify']], 'quotes', (k) => {
    clear(view);
    ({ quotes, weather, news, spotify })[k](view, ctx);
  }), view);
  quotes(view, ctx);
}

// ------------------------------------------------------------------ cotações
const RANGES = [['1d', '1D'], ['5d', '5D'], ['1mo', '1M'], ['6mo', '6M'], ['1y', '1A']];
let selSym = 'BBAS3';
let selRange = '1mo';

function fmtQuote(sym, v) {
  if (v == null) return '—';
  if (sym === 'IBOV') return fmtNum(v, 0) + ' pts';
  return 'R$ ' + fmtNum(v, sym === 'USD' || sym === 'EUR' ? 4 : 2);
}

async function quotes(view, ctx) {
  const cards = h('div', { class: 'grid3' });
  const chartBox = h('div', { class: 'card', style: { marginTop: '.8rem' } });
  const conv = h('div', { class: 'card' });
  const alerts = h('div', { class: 'card' });
  view.append(cards, chartBox, h('div', { class: 'grid2', style: { marginTop: '.8rem' } }, conv, alerts));
  let data = [];
  async function loadQuotes() {
    data = await api('/api/quotes').catch((e) => { fail(e); return []; });
    clear(cards);
    for (const q of data) {
      const ch = q.change_pct;
      cards.append(h('div', { class: `card quote ${q.symbol === selSym ? 'sel' : ''}`, role: 'button', tabindex: 0,
        onclick: () => { selSym = q.symbol; loadQuotes(); loadChart(); } },
      h('small', {}, q.name),
      h('div', { class: 'price' }, q.price == null ? 'indisponível' : fmtQuote(q.symbol, q.price)),
      ch == null ? h('small', {}, q.source || '') : h('b', { class: ch >= 0 ? 'up' : 'down' }, `${ch >= 0 ? '▲' : '▼'} ${fmtNum(Math.abs(ch))}%`)));
    }
    renderConverter();
  }
  async function loadChart() {
    clear(chartBox);
    const q = data.find((x) => x.symbol === selSym);
    chartBox.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('h3', { style: { margin: 0 } }, q ? q.name : selSym),
      h('div', { class: 'tabs', style: { margin: 0, flex: '0 0 auto' } }, RANGES.map(([k, l]) => h('button', { class: 'tab' + (k === selRange ? ' active' : ''),
        onclick: () => { selRange = k; loadChart(); } }, l)))));
    const holder = h('div', { class: 'empty' }, 'Carregando gráfico…');
    chartBox.append(holder);
    try {
      const hist = await api(`/api/quotes/${selSym}/history?range=${selRange}`);
      const xfmt = (t) => { const d = new Date(t * 1000); return selRange === '1d' ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };
      holder.replaceWith(lineChart(hist.points, { fmt: (v) => fmtQuote(selSym, v).replace('R$ ', ''), xfmt }), h('small', {}, 'Fonte: ' + hist.source + ' · pode haver atraso de até 15 min'));
    } catch (e) { holder.textContent = 'Gráfico indisponível: ' + e.message; }
  }
  function renderConverter() {
    clear(conv);
    const rate = (s) => data.find((x) => x.symbol === s)?.price;
    const amount = h('input', { type: 'number', value: '100', min: 0, step: 'any', inputmode: 'decimal', 'aria-label': 'Valor' });
    const from = h('select', { 'aria-label': 'De' }, [['BRL', 'Real (R$)'], ['USD', 'Dólar (US$)'], ['EUR', 'Euro (€)']].map(([v, l]) => h('option', { value: v }, l)));
    const to = h('select', { 'aria-label': 'Para' }, [['USD', 'Dólar (US$)'], ['BRL', 'Real (R$)'], ['EUR', 'Euro (€)']].map(([v, l]) => h('option', { value: v }, l)));
    const out = h('div', { class: 'price', style: { fontSize: '1.4rem', fontFamily: 'var(--mono)', marginTop: '.5rem' } });
    const calc = () => {
      const toBRL = { BRL: 1, USD: rate('USD'), EUR: rate('EUR') };
      if (!toBRL[from.value] || !toBRL[to.value]) { out.textContent = 'Cotação indisponível'; return; }
      const v = Number(amount.value || 0) * toBRL[from.value] / toBRL[to.value];
      const sym = { BRL: 'R$', USD: 'US$', EUR: '€' }[to.value];
      out.textContent = `${sym} ${fmtNum(v)}`;
    };
    [amount, from, to].forEach((el) => { el.oninput = calc; el.onchange = calc; });
    conv.append(h('h3', {}, 'Conversor'), amount, h('div', { class: 'row', style: { marginTop: '.5rem', flexWrap: 'nowrap' } }, from,
      h('button', { class: 'icon-btn', 'aria-label': 'Inverter', onclick: () => { const a = from.value; from.value = to.value; to.value = a; calc(); } }, '⇄'), to), out);
    calc();
  }
  async function loadAlerts() {
    clear(alerts);
    alerts.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h3', { style: { margin: 0 } }, 'Alertas de preço'),
      h('button', { class: 'btn small primary', onclick: newAlert }, '+ Alerta')));
    const list = await api('/api/alerts').catch(() => []);
    if (!list.length) alerts.append(h('p', { class: 'muted' }, 'Receba um aviso quando uma cotação passar de um valor.'));
    for (const a of list) {
      alerts.append(h('div', { class: 'li', style: { marginTop: '.4rem', cursor: 'default' } },
        h('div', { class: 'grow' }, h('span', { class: 't' }, `${a.symbol} ${a.direction} de ${a.formatted}`),
          h('div', { class: 'meta' }, a.active ? 'ativo' : a.triggered_at ? 'disparado' : 'pausado')),
        h('button', { class: 'btn small', onclick: async () => { await api(`/api/alerts/${a.id}`, { method: 'PATCH', body: { active: !a.active } }).catch(fail); loadAlerts(); } }, a.active ? 'Pausar' : 'Reativar'),
        h('button', { class: 'btn small danger', 'aria-label': 'Excluir alerta', onclick: async () => { if (await confirmBox('Excluir este alerta?', { ok: 'Excluir', danger: true })) { await api(`/api/alerts/${a.id}`, { method: 'DELETE' }).catch(fail); loadAlerts(); } } }, '✕')));
    }
  }
  async function newAlert() {
    const cur = data.find((x) => x.symbol === selSym);
    const d = await formBox('Novo alerta de cotação', [
      { name: 'symbol', label: 'Ativo', type: 'select', value: selSym, options: [['BBAS3', 'BBAS3'], ['IBOV', 'Ibovespa'], ['USD', 'Dólar'], ['EUR', 'Euro']] },
      { name: 'direction', label: 'Avisar quando ficar', type: 'select', options: [['acima', 'acima de'], ['abaixo', 'abaixo de']] },
      { name: 'price', label: 'Valor', type: 'number', step: 'any', inputmode: 'decimal', value: cur?.price ? cur.price.toFixed(2) : '', required: true },
    ], { ok: 'Criar alerta' });
    if (!d) return;
    try { await api('/api/alerts', { method: 'POST', body: d }); toast('Alerta criado', 'Verificado sempre que o app estiver aberto ou pelo agendador.'); loadAlerts(); } catch (e) { fail(e); }
  }
  await loadQuotes();
  loadChart();
  loadAlerts();
  const iv = setInterval(loadQuotes, 60000);
  ctx.onCleanup(() => clearInterval(iv));
}

// ------------------------------------------------------------------ clima
async function weather(view) {
  const cityIn = h('input', { value: state.settings.city || '', placeholder: 'Cidade', 'aria-label': 'Cidade' });
  const box = h('div', { class: 'stack', style: { marginTop: '.8rem' } }, h('div', { class: 'empty' }, 'Carregando…'));
  view.append(h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); load(); } }, cityIn, h('button', { class: 'btn', type: 'submit' }, 'Ver')), box);
  async function load() {
    clear(box).append(h('div', { class: 'empty' }, 'Carregando…'));
    try {
      const w = await api('/api/weather?city=' + encodeURIComponent(cityIn.value.trim() || state.settings.city));
      const c = w.current;
      clear(box).append(
        h('div', { class: 'card' }, h('div', { class: 'wx-now' }, h('div', { style: { fontSize: '3rem' } }, c.icon),
          h('div', {}, h('div', { class: 'big' }, `${Math.round(c.temperature)}°`), h('div', {}, c.description)),
          h('div', { class: 'muted', style: { marginLeft: 'auto', textAlign: 'right' } }, h('b', {}, w.city), h('br'), w.region, h('br'),
            `Sensação ${Math.round(c.feels_like)}° · Umidade ${c.humidity}% · Vento ${Math.round(c.wind)} km/h`))),
        h('div', { class: 'card' }, h('h3', {}, 'Próximas horas'), h('div', { class: 'wx-hours' }, w.hours.map((x) => h('div', {},
          h('small', {}, x.time.slice(11, 16)), h('div', { style: { fontSize: '1.3rem' } }, x.icon), h('b', {}, `${Math.round(x.temp)}°`), x.rain != null ? h('div', { class: 'muted' }, `${x.rain}%`) : null)))),
        h('div', { class: 'card' }, h('h3', {}, '7 dias'), h('div', { class: 'wx-days' }, w.days.map((d) => {
          const dt = new Date(d.date + 'T12:00');
          return h('div', { class: 'card', style: { textAlign: 'center', padding: '.5rem' } }, h('small', {}, dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })),
            h('div', { style: { fontSize: '1.5rem' } }, d.icon), h('b', {}, `${Math.round(d.max)}°`), ' ', h('span', { class: 'muted' }, `${Math.round(d.min)}°`),
            d.rain != null ? h('div', { class: 'muted', style: { fontSize: '.8rem' } }, `☔ ${d.rain}%`) : null);
        }))));
    } catch (e) { clear(box).append(h('div', { class: 'empty' }, e.message)); }
  }
  load();
}

// ------------------------------------------------------------------ notícias
async function news(view) {
  const topic = h('input', { value: state.settings.news_topic || '', placeholder: 'Tema (vazio = principais manchetes)', type: 'search', 'aria-label': 'Tema' });
  const box = h('div', { class: 'list news', style: { marginTop: '.8rem' } });
  view.append(h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); load(); } }, topic, h('button', { class: 'btn', type: 'submit' }, 'Buscar')), box);
  async function load() {
    clear(box).append(h('div', { class: 'empty' }, 'Carregando…'));
    try {
      const ns = await api('/api/news?topic=' + encodeURIComponent(topic.value.trim()));
      clear(box);
      if (!ns.length) box.append(h('div', { class: 'empty' }, 'Nenhuma notícia encontrada.'));
      for (const n of ns) {
        box.append(h('div', { class: 'card' }, h('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer' }, h('b', {}, n.title),
          h('div', { class: 'muted', style: { fontSize: '.8rem' } }, [n.source, n.published ? new Date(n.published).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''].filter(Boolean).join(' · ')))));
      }
    } catch (e) { clear(box).append(h('div', { class: 'empty' }, e.message)); }
  }
  load();
}

// ------------------------------------------------------------------ Spotify
function embedUrl(url) {
  const m = String(url || '').match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/);
  return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
}

async function spotify(view) {
  const box = h('div', { class: 'stack' }, h('div', { class: 'empty' }, 'Carregando…'));
  view.append(box);
  let st;
  try { st = await api('/api/spotify/status'); } catch (e) { clear(box).append(h('div', { class: 'empty' }, e.message)); return; }
  clear(box);
  const q = h('input', { placeholder: 'Música, artista ou playlist…', type: 'search', 'aria-label': 'Buscar no Spotify' });
  const control = async (action, query) => {
    try { const r = await api('/api/spotify/control', { method: 'POST', body: { action, query } }); toast('Spotify', r.message); setTimeout(() => { clear(view); spotify(view); }, 1200); }
    catch (e) { fail(e); }
  };
  if (st.connected) {
    const p = st.playing;
    box.append(h('div', { class: 'card' },
      p && p.name ? h('div', { class: 'sp-now' }, p.image ? h('img', { src: p.image, alt: '' }) : null, h('div', {}, h('b', {}, p.name), h('div', { class: 'muted' }, p.artist), h('small', {}, p.is_playing ? 'Tocando agora' : 'Pausado')))
        : h('p', { class: 'muted' }, 'Nada tocando. Abra o Spotify em um aparelho.'),
      h('div', { class: 'row', style: { marginTop: '.7rem', justifyContent: 'center' } },
        h('button', { class: 'btn', 'aria-label': 'Anterior', onclick: () => control('previous') }, '⏮'),
        h('button', { class: 'btn primary', 'aria-label': 'Tocar ou pausar', onclick: () => control(p && p.is_playing ? 'pause' : 'play') }, p && p.is_playing ? '⏸ Pausar' : '▶ Tocar'),
        h('button', { class: 'btn', 'aria-label': 'Próxima', onclick: () => control('next') }, '⏭'))),
    h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); if (q.value.trim()) control('search_play', q.value.trim()); } }, q, h('button', { class: 'btn', type: 'submit' }, 'Tocar')),
    h('button', { class: 'btn small ghost', onclick: async () => { await api('/api/spotify/disconnect', { method: 'POST' }); clear(view); spotify(view); } }, 'Desconectar Spotify'));
  } else {
    box.append(h('div', { class: 'card stack' },
      h('h3', {}, 'Spotify'),
      st.configured ? h('a', { class: 'btn primary', href: '/api/spotify/login', style: { textDecoration: 'none', display: 'inline-block' } }, 'Conectar minha conta Spotify')
        : h('p', { class: 'muted' }, 'Controle completo (tocar, pausar, pular) exige configurar SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET no servidor. Enquanto isso, você pode buscar e ouvir pelo player abaixo.'),
      h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); if (q.value.trim()) window.open('https://open.spotify.com/search/' + encodeURIComponent(q.value.trim()), '_blank', 'noopener'); } },
        q, h('button', { class: 'btn', type: 'submit' }, 'Buscar no Spotify'))));
  }
  const url = embedUrl(st.embed);
  const embedIn = h('input', { value: st.embed || '', placeholder: 'Cole o link de uma playlist do Spotify', 'aria-label': 'Link da playlist' });
  box.append(h('div', { class: 'card stack' }, h('h3', {}, 'Minha playlist'),
    url ? h('iframe', { class: 'sp', src: url, loading: 'lazy', allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture', title: 'Player do Spotify' }) : null,
    h('form', { class: 'row', onsubmit: async (e) => {
      e.preventDefault();
      try { state.settings = await api('/api/settings', { method: 'PUT', body: { spotify_embed: embedIn.value.trim() } }); clear(view); spotify(view); } catch (err) { fail(err); }
    } }, embedIn, h('button', { class: 'btn', type: 'submit' }, 'Salvar'))));
}
