# J.A.R.V.I.S. AI — assistente pessoal em português

Aplicativo web instalável (PWA) feito em **Python (Flask)**, pronto para o **Render Free**.
Abre como app no **Android** e no **iPhone**, com ícone na tela inicial.

- **Tela inicial:** só o JARVIS azul animado e o microfone. Toque no microfone para falar (ele responde em voz alta). Toque no JARVIS para abrir o menu. Toque longo no JARVIS abre uma caixa para digitar.
- **Assistente:** conversa por texto e voz, histórico, memória autorizada (você vê e apaga tudo) e **confirmação antes de alterar qualquer dado** (botão ou dizendo “sim”/“não”).
- **Meu Espaço:** tarefas, subtarefas, ideias, anotações, projetos, pesquisas, anexos (até 5 MB), pesquisa geral e salvamento automático. Ideias viram tarefas ou projetos **mantendo o original**.
- **Agenda:** calendário, compromissos recorrentes, aviso de conflito de horário, lembretes, alarmes e notificações push.
- **Serviços:** clima (Open-Meteo), notícias (Google Notícias), Spotify e cotações reais de **BBAS3, Ibovespa, dólar e euro** com gráficos, conversor e alertas de preço.
- **Produtividade:** rotinas automáticas, Pomodoro com pausas, lembrete de pausa, metas, histórico de foco e relatórios em PDF.
- **Windows (opcional):** abre apps e sites autorizados, ajusta o volume, mostra o uso do PC e inicia temporizadores, por meio de um pequeno agente instalado no seu computador.
- **Configurações:** voz, velocidade, tom, cidade, fuso horário, preferências, troca de senha, **baixar meus dados** e excluir conta.

Segurança: senhas com hash, cookie de sessão protegido (HttpOnly, Secure, SameSite), proteção CSRF, limite de tentativas de login, cabeçalhos de segurança (CSP), dados separados por usuário e só o primeiro cadastro é liberado (depois, cadastro fechado).

---

## Publicar no Render Free (passo a passo)

### 1. Banco de dados gratuito (recomendado)
O disco do Render Free é apagado a cada reinício ou atualização. Para **não perder seus dados**, use um Postgres gratuito:

1. Crie uma conta em **neon.tech** (gratuito e sem prazo de validade) → *Create project*.
2. Copie a *connection string* (começa com `postgresql://...`).

> Também funciona com o Postgres gratuito do próprio Render, mas ele expira após 30 dias.
> Sem `DATABASE_URL` o app funciona com SQLite, mas os dados somem quando o servidor reinicia.

### 2. Criar o serviço
1. Coloque este projeto no seu GitHub (já está neste repositório).
2. Entre em **render.com** → **New +** → **Blueprint** → escolha o repositório. O arquivo `render.yaml` já configura tudo (plano Free, comando de início, chaves secretas geradas automaticamente).
3. Quando o Render pedir as variáveis, preencha:
   - `DATABASE_URL` → a connection string do Neon.
   - `ANTHROPIC_API_KEY` → *opcional*, para conversa livre com IA (Claude). Sem ela, o JARVIS entende comandos em português (“crie uma tarefa…”, “me lembre de… às 15h”, “cotação do dólar”, “como está o tempo”…).
   - `SPOTIFY_CLIENT_ID` e `SPOTIFY_CLIENT_SECRET` → *opcionais* (veja abaixo).
   - Deixe `ALLOW_SIGNUP` vazio.
4. Clique em **Apply**. Em alguns minutos o endereço fica pronto, algo como `https://jarvis-ai-xxxx.onrender.com`.
5. Abra o endereço e **crie sua conta** (o primeiro cadastro é o seu; depois o cadastro fecha).

> No plano Free o servidor “dorme” após 15 minutos sem uso; o primeiro acesso depois disso demora uns 30–50 segundos.

### 3. Lembretes com o app fechado (opcional, gratuito)
Com o app aberto, lembretes e alarmes funcionam sempre. Para recebê-los **com o app fechado**:

1. No Render, abra o serviço → **Environment** → copie o valor de `CRON_SECRET`.
2. Crie uma conta grátis em **cron-job.org** → *Create cronjob*:
   - URL: `https://SEU-ENDERECO.onrender.com/cron/tick?key=SEU_CRON_SECRET`
   - Execução: a cada 5 minutos.
3. No app: **Agenda → Notificações → Ativar notificações**.

Isso também mantém o servidor acordado. Um único serviço ligado o mês todo cabe nas 750 horas gratuitas do Render.

---

## Instalar no celular

**Android (Chrome):** abra o endereço → menu **⋮** → **Instalar app** (ou “Adicionar à tela inicial”) → **Instalar**.

**iPhone (Safari):** abra o endereço no **Safari** → botão **Compartilhar** (□↑) → **Adicionar à Tela de Início** → **Adicionar**. Abra sempre pelo ícone. Para notificações no iPhone é preciso iOS 16.4 ou mais novo e o app instalado.

Na primeira vez que tocar no microfone, permita o acesso. Se o navegador não reconhecer voz, aparece uma caixa de texto e você pode usar o microfone do teclado.

---

## Spotify (opcional)
1. Em **developer.spotify.com/dashboard** → *Create app*.
2. Redirect URI: `https://SEU-ENDERECO.onrender.com/api/spotify/callback`.
3. Copie *Client ID* e *Client Secret* para as variáveis do Render.
4. No app: **Serviços → Spotify → Conectar**. Para tocar, pausar e pular é preciso Spotify Premium. Sem configurar, você ainda pode buscar músicas e colar uma playlist no player.

## Windows (opcional)
1. No app: **Windows → Conectar um computador** → copie a chave gerada.
2. No PC: instale o Python 3, baixe `jarvis_agent.py` pelo painel e rode `python jarvis_agent.py` uma vez. Ele cria o `jarvis_agent.json`.
3. Edite o `jarvis_agent.json`: endereço do app, chave e os apps e sites que podem ser abertos. Rode de novo e deixe a janela aberta.
4. No painel Windows, autorize os mesmos nomes de apps e sites. Só funciona o que estiver autorizado **nos dois lugares**.
5. Opcional, para volume exato e uso detalhado do PC: `pip install psutil pycaw comtypes`.

---

## Rodar no seu computador
```bash
pip install -r requirements.txt
python app.py            # abre em http://localhost:5000
```

## Testes
```bash
pip install pytest
python -m pytest -q                 # 29 testes da API (login, dados, agenda, assistente, push, PDF…)
node tests/e2e/ui.test.mjs          # botões principais em navegador real (requer Node + Playwright)
```

## Variáveis de ambiente
| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Postgres para guardar os dados de forma permanente (recomendado) |
| `SECRET_KEY` | Assina o cookie de login (o Render gera sozinho) |
| `CRON_SECRET` | Protege `/cron/tick` (o Render gera sozinho) |
| `ANTHROPIC_API_KEY` | Opcional: conversa livre com IA |
| `JARVIS_MODEL` / `JARVIS_EFFORT` | Opcional: modelo (padrão `claude-opus-5-5`) e esforço (padrão `low`, mais rápido para voz) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Opcional: controle do Spotify |
| `BRAPI_TOKEN` | Opcional: reserva para cotações da B3 |
| `ALLOW_SIGNUP` | `true` para permitir novos cadastros além do primeiro |

## Estrutura
```
app.py                 entrada (gunicorn app:app)
jarvis/                backend: auth, api, assistant, actions, services, productivity, windows, push, scheduler
static/                PWA: index.html, css, js (um arquivo por painel), sw.js, manifest, ícones
windows_agent/         agente opcional para Windows
tests/                 testes da API (pytest) e da interface (Playwright)
render.yaml            configuração do Render
```
