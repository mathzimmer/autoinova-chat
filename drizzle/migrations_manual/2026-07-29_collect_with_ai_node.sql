-- Novo tipo de nó "Coletar com IA": a IA pede dados do cliente, insiste até
-- completar e avança com o que coletou ao esgotar as tentativas.
ALTER TYPE "node_type" ADD VALUE IF NOT EXISTS 'collect_with_ai';
