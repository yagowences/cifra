-- Estorno, cashback e resgate de pontos: crédito (INCOME) que abate despesa em vez de contar como receita.
ALTER TABLE "transactions" ADD COLUMN "is_refund" BOOLEAN NOT NULL DEFAULT false;

-- Só entrada pode ser estorno.
ALTER TABLE "transactions" ADD CONSTRAINT transactions_refund_check CHECK (NOT is_refund OR type = 'INCOME');
