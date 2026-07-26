# Playbook de operação — AutoInova CRM

## Subir alterações (o caminho de 2 comandos)

No seu **Mac** (pasta `~/Documents/autoinova-chat-main`):
```bash
./ship.sh "mensagem curta do que mudou"
```

Na **VPS** (`/root/autoinova`):
```bash
./deploy.sh
```

## Migração de banco (quando há schema novo)

Só quando criamos coluna/tabela nova. Na VPS:
```bash
cd /root/autoinova
set -a; source .env; set +a
psql "$DATABASE_URL" -f drizzle/migrations_manual/ARQUIVO.sql
```
Detalhes: o banco é remoto (Supabase). Sem `source .env`, o psql tenta conectar
como "root" e falha. Nomes de colunas no banco às vezes diferem do Drizzle
(ex.: `capiEventStatus`, `settingKey`).

## Armadilhas conhecidas

- **Container fantasma** ("No such container ..."): o `deploy.sh` já trata
  (remove com `docker rm -f` antes do `up`). Se rodar manual, faça o mesmo.
- **`docker compose` "no configuration file"**: o compose é `docker-compose.prod.yml`
  — sempre com `-f docker-compose.prod.yml`, e rodar de dentro de `/root/autoinova`.
- **Disco cheio (Docker)**: `docker image prune -af` + `docker builder prune -af`.
- **Zernio 429 (rate limit)**: o sincronizador já paceia; um 429 isolado com
  "aguardando Xs" é normal (retry funcionando).
- **`.git/index.lock` preso**: `rm -f .git/index.lock` (o `ship.sh` já faz isso).

## Segurança (regras fixas)

- Nunca colar tokens/segredos no chat. Se algum vazar, **gerar um novo** e descartar.
- Editar `.env` na VPS via `nano`, nunca por aqui.
- Segredos ficam só no `.env` do servidor.

## Colaboração entre IAs (Claude/Gemini/Cursor) — Regras de Git

Para evitar perda de código ou perda de contexto ao alternar entre diferentes ferramentas de IA:
1. **Pasta Única**: Use sempre o diretório principal do projeto (`~/Documents/autoinova-chat-main`). Evite criar pastas paralelas (como `-experimental`). Se for fazer testes arriscados, crie uma branch Git (`git checkout -b feat/nome-do-teste`).
2. **Sincronização Obrigatória**:
   - **Antes de iniciar** o trabalho em qualquer IA: execute sempre `git pull` para trazer a versão mais recente.
   - **Ao terminar** o trabalho em qualquer IA: execute `git add -A && git commit -m "feat: descrição"` e depois `git push` (ou `./ship.sh`).
3. **Edições Isoladas**: Nunca edite o mesmo arquivo em duas IAs diferentes ao mesmo tempo sem dar commit/push no meio do processo.
4. **Memória Compartilhada**: Mantenha a pasta `_contexto/` atualizada. É ela quem reconstrói o contexto da sessão para a próxima IA.

## IDs importantes (não são segredos)

- Pixel principal (site/CRM): `587774608991001`
- Dataset Zernio bianca (CTWA): `3967148386923935`
- Meta App ID: `1168218527728605`
