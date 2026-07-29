-- Novo tipo de nó "Apresentar com IA" (vehicle_discovery): a IA busca no estoque,
-- apresenta N carros por vez com os campos escolhidos, conversa e — quando percebe
-- que o cliente confirmou interesse num carro (etapa interesse_definido) — avança
-- o fluxo para a negociação.
ALTER TYPE "node_type" ADD VALUE IF NOT EXISTS 'vehicle_discovery';
