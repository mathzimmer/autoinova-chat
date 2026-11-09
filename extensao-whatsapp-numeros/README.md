# Captador de Números – Grupos WhatsApp (extensão Chrome)

Extensão simples (Manifest V3) que lê o WhatsApp Web aberto no navegador e salva os
números de telefone dos participantes de um grupo. Os dados ficam **somente no seu
navegador** (`chrome.storage.local`) e podem ser exportados em CSV.

## Instalar

1. Abra `chrome://extensions`.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione esta pasta (`extensao-whatsapp-numeros`).
4. Recarregue a aba do https://web.whatsapp.com (F5).

## Usar

1. No WhatsApp Web, abra o grupo.
2. Clique no nome do grupo (abre "Dados do grupo") e, na lista de participantes,
   clique em **Ver todos** — assim a extensão consegue ler a lista completa.
3. Clique no ícone da extensão → **Captar números**. A lista é rolada automaticamente
   até o fim, coletando os números que vão aparecendo.
4. Use **Exportar CSV**, **Copiar** ou **Limpar**. O filtro permite ver/exportar por grupo.

### De onde os números são lidos

| Fonte                     | O que capta                                                    |
|---------------------------|----------------------------------------------------------------|
| Painel de participantes   | Números exibidos na lista "Dados do grupo" / "Ver todos"       |
| Cabeçalho do grupo        | Números que aparecem no subtítulo do cabeçalho                 |
| Remetentes das mensagens  | Números de quem enviou mensagens carregadas na conversa        |

## Limitações

- Contatos **salvos na sua agenda** aparecem pelo nome no WhatsApp Web, não pelo número,
  e por isso podem não ser captados pelo painel.
- Em comunidades e grupos com privacidade de número ativada, o WhatsApp oculta os
  números — a extensão só capta o que o WhatsApp mostra na tela.
- O WhatsApp Web muda o HTML com frequência; se parar de funcionar, os seletores em
  `content.js` (`#main header`, `[role="dialog"]`, `data-id`) podem precisar de ajuste.

## Uso responsável

Use apenas em grupos dos quais você participa e para fins legítimos. Números de
telefone são dados pessoais (LGPD): não envie mensagens em massa sem consentimento —
além de violar os Termos do WhatsApp, isso costuma levar ao banimento do número.
