# Histórico do que foi construído

Registro em ordem temática do que já está pronto no AutoInova CRM. Serve de
memória rápida — o detalhe fino está no código e no MANUAL-AUTOINOVA-CRM.md.

## Inbox / atendimento
- Caixa de entrada única com seletor de instância (Evolution, Zernio, API oficial).
- ChatView em tema claro, separadores de data, mídia, áudio transcrito.
- Nova conversa, arquivar/excluir, seleção múltipla, busca por nome/telefone/conteúdo.
- Botão "Ir para o lead" ligando conversa ↔ lead.

## Funil e leads
- Lead canônico por telefone (uma pessoa = um lead), com oportunidades por ciclo.
- Kanban do funil, tela "Meus leads" do vendedor, timeline unificada com comentários da IA.
- Qualidade do lead (Alta/Baixa, definida pelo vendedor) + pontuação objetiva.
- Carência pós-venda (não reabre lead por mensagem de pós-venda) e auto-perdido (14 dias).
- Reativação limpa o crédito antigo para reavaliação.

## IA e fluxos
- IA multi-agente (agente por instância/canal), agente geral em 3 camadas.
- Motor de análise da conversa (temperatura, objeções, crédito, próxima ação).
- Fluxos com nós de espera/lembrete, entrada inesperada, remetente por canal.

## Canais WhatsApp
- Zernio (agregador): webhook, envio, mídia no S3, sincronizador de recuperação.
- Evolution: unificado no inbox.
- API oficial multi-número (coexistência) — ver modulos/whatsapp-coexistencia.md.

## Marketing / atribuição (Meta)
- Meta Conversions API: funil → eventos (Lead, SubmitApplication, InitiateCheckout, Purchase).
- Atribuição CTWA via Zernio: eventos vão ao dataset do anúncio (bianca), ancorados
  na conversa original; sem contagem dupla; otimização por valor do veículo.
- Selo "📢 Anúncio" no chat mostrando de qual anúncio o lead veio (lê metadata.referral).
- Painel "Últimos eventos enviados" com selo de origem (Zernio / CTWA / pixel).

## Gestão
- Dashboard (TMA, 1ª resposta, conversão, vendas), Painel do Gestor, Performance de vendedores.
- Configurações: etiquetas, nomes do funil, permissões por cargo.

## Infra / segurança
- Assinatura de webhooks (Meta e Zernio), Socket.io autenticado, CORS restrito.
- Locks nos jobs, migrações manuais versionadas, paginação.
- Scripts ship.sh (Mac) e deploy.sh (VPS) para subir em 1 comando.

## Marcos recentes (jul/2026)
- Verificação Meta aprovada (whatsapp_business_messaging + management).
- Cadastro Incorporado (Embedded Signup) funcionando: conecta número próprio em
  coexistência, com auto-salvar + auto-assinar webhook (modelo de provedor).
