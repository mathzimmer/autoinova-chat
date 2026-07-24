# Base de conhecimento — AutoInova / Matheus

Esta pasta é a nossa memória de trabalho. Serve para o Claude entender rápido o
contexto sem redescobrir tudo, e para você achar as coisas de forma organizada.

## Índice

- **PLAYBOOK.md** — como subir alterações (deploy), comandos, e as armadilhas
  conhecidas (container fantasma, migração de banco, rate limit do Zernio).
- **modulos/whatsapp-coexistencia.md** — o módulo de conexão de números WhatsApp
  (Cadastro Incorporado + API oficial + coexistência), documentado para ser
  **reaproveitado em outro sistema** sem desenvolver do zero.
- **HISTORICO.md** — registro do que já foi construído, em ordem.

## Como trabalhamos

1. Você me mostra o que quer (print marcado é o melhor), uma tela por vez.
2. Eu confirmo o que entendi antes de mexer, e só toco no que você apontou.
3. Eu edito os arquivos direto nesta pasta (você não copia/cola código).
4. Você sobe com `./ship.sh "mensagem"` (no Mac) e `./deploy.sh` (na VPS).

## O negócio, em uma linha

AutoInova CRM — CRM de concessionária de veículos, atendimento via WhatsApp
(Zernio + Evolution + API oficial), com IA, funil de vendas e atribuição de
anúncios Click-to-WhatsApp de volta para a Meta.
