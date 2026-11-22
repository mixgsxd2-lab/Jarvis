// Painel Assistente: conversa por texto e voz, histórico e memória autorizada.
import { api, clear, confirmBox, fail, fmtUTC, h, tabs, toast } from './core.js';
import { canListen, isListening, listen, stopListening, unlockSpeech } from './voice.js';
import { pendingCards } from './app.js';

const MIC = '<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>';

export async function render(root, ctx) {
  const view = h('div');
  root.append(tabs([['chat', 'Conversa'], ['mem', 'Memória']], 'chat', (k) => (k === 'chat' ? chat(view, ctx) : memory(view))), view);
  const status = await api('/api/assistant/status').catch(() => ({ ai: false }));
  root.insertBefore(h('p', { class: 'muted', style: { fontSize: '.82rem', marginTop: 0 } },
    status.ai ? 'Modo IA ativo: converse livremente. Alterações nos seus dados sempre pedem confirmação.'
      : 'Modo comandos (sem chave de IA no servidor). Diga “ajuda” para ver exemplos. Alterações pedem confirmação.'), view);
  chat(view, ctx);
}

async function chat(view, ctx) {
  clear(view);
  const log = h('div', { class: 'chat', id: 'chat-log' });
  const input = h('input', { placeholder: 'Mensagem para o JARVIS…', autocomplete: 'off', enterkeyhint: 'send', 'aria-label': 'Mensagem' });
  const micBtn = h('button', { class: 'mic-sm', type: 'button', 'aria-label': 'Falar', html: MIC });
  const form = h('form', { class: 'composer' }, micBtn, input, h('button', { class: 'btn primary', type: 'submit' }, 'Enviar'));
  const tools = h('div', { class: 'row', style: { justifyContent: 'flex-end', marginBottom: '.6rem' } },
    h('button', { class: 'btn small ghost', onclick: async () => {
      if (!(await confirmBox('Apagar todo o histórico de conversa?', { ok: 'Apagar', danger: true }))) return;
      await api('/api/assistant/history', { method: 'DELETE' }).catch(fail);
      clear(log).append(h('div', { class: 'empty' }, 'Histórico apagado.'));
    } }, 'Limpar histórico'));
  view.append(tools, log, form);

  const scroll = () => { const b = document.getElementById('panel-body'); b.scrollTop = b.scrollHeight; };
  const bubble = (role, text, when) => h('div', { class: `bubble ${role}` }, text, when ? h('time', {}, when) : null);

  try {
    const hist = await api('/api/assistant/history');
    if (!hist.length) log.append(h('div', { class: 'empty' }, 'Comece uma conversa. Ex.: “crie uma tarefa revisar contrato amanhã”.'));
    for (const m of hist) log.append(bubble(m.role, m.content, fmtUTC(m.created_at)));
    const pend = await api('/api/pending');
    if (pend.length) log.append(pendingCards(pend, (msg) => { log.append(bubble('assistant', msg)); scroll(); }));
  } catch (e) { fail(e); }
  setTimeout(scroll, 30);

  async function send(text) {
    log.querySelector('.empty')?.remove();
    log.append(bubble('user', text));
    const wait = bubble('assistant', '…');
    log.append(wait); scroll();
    try {
      const r = await api('/api/assistant/chat', { method: 'POST', body: { text } });
      wait.replaceWith(bubble('assistant', r.reply));
      if (r.pending?.length) log.append(pendingCards(r.pending, (msg) => { log.append(bubble('assistant', msg)); scroll(); ctx.speakReply(msg); }));
      scroll();
      ctx.runActions(r.client_actions || []);
      ctx.speakReply(r.reply);
    } catch (e) { wait.replaceWith(bubble('assistant', 'Erro: ' + e.message)); }
  }

  form.onsubmit = (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ''; unlockSpeech(); send(t); };
  micBtn.onclick = () => {
    unlockSpeech();
    if (!canListen) { toast('Voz indisponível', 'Use o microfone do teclado do celular para ditar.'); input.focus(); return; }
    if (isListening()) { stopListening(); return; }
    micBtn.classList.add('on');
    listen({
      onInterim: (t) => { input.value = t; },
      onFinal: (t) => { input.value = ''; send(t); },
      onEnd: () => micBtn.classList.remove('on'),
      onError: (err) => { micBtn.classList.remove('on'); if (err !== 'no-speech' && err !== 'aborted') toast('Microfone', 'Não foi possível ouvir: ' + err); },
    });
  };
  ctx.onCleanup(() => stopListening());
}

async function memory(view) {
  clear(view);
  view.append(h('p', { class: 'muted' }, 'O JARVIS só guarda o que você autorizar. Você pode adicionar, revisar e apagar tudo aqui.'));
  const input = h('input', { placeholder: 'Ex.: Prefiro reuniões depois das 10h', maxlength: 2000 });
  const list = h('div', { class: 'list' });
  view.append(h('form', { class: 'row', onsubmit: async (e) => {
    e.preventDefault();
    const content = input.value.trim(); if (!content) return;
    try { await api('/api/memories', { method: 'POST', body: { content } }); input.value = ''; load(); } catch (err) { fail(err); }
  } }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Guardar')), h('hr'), list);

  async function load() {
    clear(list);
    const ms = await api('/api/memories').catch((e) => { fail(e); return []; });
    if (!ms.length) list.append(h('div', { class: 'empty' }, 'Nenhuma memória guardada.'));
    for (const m of ms) {
      list.append(h('div', { class: 'li' }, h('div', { class: 'grow' }, h('span', {}, m.content), h('div', { class: 'meta' }, fmtUTC(m.created_at))),
        h('button', { class: 'btn small danger', onclick: async () => {
          if (!(await confirmBox(`Esquecer “${m.content}”?`, { ok: 'Esquecer', danger: true }))) return;
          await api(`/api/memories/${m.id}`, { method: 'DELETE' }).catch(fail); load();
        } }, 'Esquecer')));
    }
  }
  load();
}
