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

## IDs importantes (não são segredos)

- Pixel principal (site/CRM): `587774608991001`
- Dataset Zernio bianca (CTWA): `3967148386923935`
- Meta App ID: `1168218527728605`
