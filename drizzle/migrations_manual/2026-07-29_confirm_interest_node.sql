-- Novo tipo de nó "Confirmar Interesse" (confirm_interest): se o lead já vem com
-- um veículo de interesse, pergunta se ele quer seguir com esse (→ negociação) ou
-- ver outras opções (→ Apresentar com IA). Se não tem interesse anterior, já
-- encaminha direto para descobrir o interesse.
ALTER TYPE "node_type" ADD VALUE IF NOT EXISTS 'confirm_interest';
