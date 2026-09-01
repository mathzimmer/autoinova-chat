# Configuração do Meta Business Agent — Auto Inova (teste sandbox)

Estes arquivos são pra você preencher o agente da Meta no número de teste. Onde colar cada um:

| Arquivo | Onde vai no painel do agente |
|---|---|
| `01_informacoes_empresa.md` | **Informações da empresa** (Business Info) |
| `02_faqs.md` | **Perguntas frequentes** (FAQs) — cadastre par a par |
| `03_habilidades_skills.md` | **Habilidades** (Skills) — cole como instrução do agente |
| `04_conhecimento_empresa.md` | **Arquivos** — suba este arquivo como fonte de conhecimento |
| Estoque (JSON) | Ver seção no fim — me manda o link que eu monto |

## Ordem sugerida
1. Informações da empresa → 2. FAQs → 3. Habilidades → 4. (opcional) sobe o arquivo de conhecimento e o site `https://autoinovars.com.br` em **Sites**.
5. Vai em **Teste seu agente** (sandbox) e conversa com ele. **Não precisa** ligar pagamento nem "Permitir que o agente responda" só pra testar.

## Falta preencher (não achei no site)
- **Horário de atendimento** — procure `[PREENCHER: horário]` nos arquivos e ajuste.

## Estoque ao vivo
Você tem um link JSON do estoque. Duas formas:
- **Rápido (teste):** eu gero um arquivo-resumo do estoque pra subir em "Arquivos" (é um retrato do momento, desatualiza).
- **Definitivo:** configurar um **Conector** (a Meta chama seu JSON ao vivo) — assim o agente sempre vê o estoque atual.
Me manda o **link do JSON** que eu faço o que você preferir.
