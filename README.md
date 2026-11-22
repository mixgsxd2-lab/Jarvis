# JARVIS — central de organização

Um lugar só para **tarefas, projetos, ideias, anotações, agenda e lembretes**.
Feito em **Python (Flask)**, pronto para o **Render Free** e instalável como app no **Android** e no **iPhone** (PWA).

## O que tem
- **Hoje:** saudação, adição rápida, tarefas atrasadas e do dia, próximos 7 dias, agenda do dia, projetos ativos, ideias recentes e minutos de foco.
- **Adicionar (botão +, ou tecla N no computador):** escolha tarefa, ideia, anotação, projeto, lembrete ou compromisso. Entende datas em português sem precisar de IA: “amanhã 10h”, “sexta”, “dia 5 às 9 da manhã”, “em 30 min”, “25/12”. Antes de salvar, mostra como entendeu a data.
- **Tarefas:** filtros (abertas, hoje, 7 dias, sem data, prioridade alta, concluídas) e grupos por prazo. Para concluir, toque no círculo; dá para desfazer. Cada tarefa tem prioridade, prazo, projeto, etiquetas, anotações, subtarefas e anexos.
- **Projetos:** cartões com cor e progresso. Dentro do projeto, quadro Kanban (A fazer / Fazendo / Concluído; arraste no computador ou use os botões no celular) ou lista. Tem descrição, prazo, situação e anexos.
- **Ideias:** mural de cartões. Uma ideia vira tarefa ou projeto **mantendo a original**, com ligação entre as duas.
- **Anotações:** lista e editor com salvamento automático, notas fixadas e anexos.
- **Agenda:** calendário com compromissos, lembretes e prazos de tarefas. Compromissos podem se repetir, e o app avisa quando há conflito de horário. Lembretes e alarmes podem tocar uma vez ou se repetir. Tem notificações push.
- **Foco e metas:** Pomodoro com pausas automáticas, metas com progresso, histórico de foco e relatório em PDF.
- **Buscar (tecla /):** procura em tudo.
- **Ajustes:** tema claro, escuro ou automático, cor de destaque, fuso horário, tela inicial, preferências do Pomodoro, troca de senha, **baixar meus dados** (JSON) e excluir conta.

**Segurança:** senhas com hash e cookie de sessão protegido (HttpOnly, Secure, SameSite). Tem proteção CSRF, limite de tentativas de login e cabeçalhos de segurança (CSP). Os dados de cada usuário ficam separados. Só o primeiro cadastro é liberado.

---

## Publicar no Render Free

1. **Banco de dados (recomendado):** crie um Postgres gratuito em **neon.tech** e copie a connection string (`postgresql://...`). Sem ele, os dados somem quando o Render reinicia.
2. No **render.com** vá em **New + → Blueprint** e escolha este repositório. O `render.yaml` configura tudo.
3. Preencha `DATABASE_URL` com o endereço do Neon. Deixe `ALLOW_SIGNUP` vazio. Clique em **Apply**.
4. Abra o endereço gerado (`https://….onrender.com`) e crie sua conta.

Se você já tinha publicado a versão anterior, basta enviar este código: o Render atualiza sozinho e seus dados continuam lá. As variáveis antigas (`ANTHROPIC_API_KEY`, `SPOTIFY_*`) podem ser apagadas.

> No plano Free o servidor dorme após 15 min sem uso; o primeiro acesso depois disso leva uns 30–50 s.

### Avisos com o app fechado (opcional)
1. No Render: serviço → **Environment** → copie `CRON_SECRET`.
2. No **cron-job.org** (grátis), crie uma tarefa chamando `https://SEU-ENDERECO.onrender.com/cron/tick?key=SEU_CRON_SECRET` a cada 5 minutos.
3. No app: **Agenda → Notificações → Ativar notificações**.

## Instalar no celular
- **Android (Chrome):** menu **⋮** → **Instalar app**.
- **iPhone (Safari):** **Compartilhar** (□↑) → **Adicionar à Tela de Início**. Para notificações: iOS 16.4+ e abrir pelo ícone.

## Rodar no computador
```bash
pip install -r requirements.txt
python app.py      # http://localhost:5000
```

## Testes
```bash
python -m pytest -q             # API: login, itens, captura, Hoje, agenda, push, PDF, migração
node tests/e2e/ui.test.mjs      # botões principais em navegador real (Node + Playwright)
```

## Estrutura
```
app.py              entrada (gunicorn app:app)
jarvis/             backend: auth, api (itens, captura, hoje, agenda), productivity (foco/metas/PDF), push, scheduler
static/             PWA: index.html, css/app.css, js/ (app, core, item e uma tela por arquivo v-*.js), sw.js, ícones
tests/              testes da API (pytest) e da interface (Playwright)
render.yaml         configuração do Render
```
