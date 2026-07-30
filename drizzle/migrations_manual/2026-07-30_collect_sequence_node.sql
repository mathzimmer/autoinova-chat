-- Novo tipo de nó "Coletar Dados (Sequência)" (collect_sequence) — arquitetura
-- vendedor virtual, fase 3: cadeias determinísticas de perguntas fixas
-- (ex.: financiamento = entrada → prazo → CPF; troca = modelo → ano → km → fotos).
-- A ordem é garantida pelo motor; a IA (NLU) só extrai a resposta de cada passo.
ALTER TYPE "node_type" ADD VALUE IF NOT EXISTS 'collect_sequence';
