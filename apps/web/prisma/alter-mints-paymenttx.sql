ALTER TABLE "mints" ADD COLUMN IF NOT EXISTS "paymentTx" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "mints_paymentTx_key" ON "mints"("paymentTx");
