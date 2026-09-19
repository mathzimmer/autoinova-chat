-- Departamento de atendimento por pessoa do cadastro (vendas/compras/posvenda).
-- Roteamento do handoff usa isso pra mandar o lead pro grupo certo.
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS department varchar(20) NOT NULL DEFAULT 'vendas';

-- Índice pra fila por departamento (rodízio de compras/pós-venda é global).
CREATE INDEX IF NOT EXISTS idx_sellers_department_active ON sellers (department, "isActive");
