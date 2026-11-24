# Ideias

Uma página branca para anotar ideias em tópicos e não esquecer.

- Escreva e aperte **Enter** (ou toque em **Anotar**). A mais nova fica no topo.
- **Toque no texto** para editar. O app salva quando você aperta Enter ou toca fora do texto.
- **×** apaga. Durante alguns segundos aparece **Desfazer**.
- Tem login próprio (só o primeiro cadastro é permitido) e as ideias ficam salvas no servidor.
- Dá para instalar no celular como app.

Feito em Python (Flask). Roda no Render Free.

## Publicar no Render Free
1. Crie um Postgres grátis em **neon.tech** e copie o endereço (`postgresql://...`).
2. No **render.com** vá em **New + → Blueprint** e escolha este repositório.
3. Cole o endereço em `DATABASE_URL`, deixe `ALLOW_SIGNUP` vazio e clique em **Apply**.
4. Abra o endereço gerado e crie sua conta.

Se você já tinha publicado uma versão anterior, o Render atualiza sozinho e as ideias que você já tinha continuam lá.
As variáveis antigas (`CRON_SECRET`, `ANTHROPIC_API_KEY`, `SPOTIFY_*`) podem ser apagadas.

> No plano grátis o servidor dorme após 15 min sem uso; o primeiro acesso depois disso leva uns 30–50 s.

## Instalar no celular
- **Android (Chrome):** menu **⋮** → **Instalar app**.
- **iPhone (Safari):** **Compartilhar** (□↑) → **Adicionar à Tela de Início**.

## Rodar no computador
```bash
pip install -r requirements.txt
python app.py      # http://localhost:5000
```

## Testes
```bash
python -m pytest -q             # API
node tests/e2e/ui.test.mjs      # tela em navegador real (Node + Playwright)
```
