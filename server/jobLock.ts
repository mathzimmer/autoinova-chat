/**
 * Job Lock — exclusão mútua entre processos via Postgres advisory lock.
 *
 * Evita execução duplicada de jobs periódicos (scheduler, rescue, campanhas)
 * quando há mais de um processo/container rodando — por exemplo durante um
 * deploy em que o container antigo ainda não parou.
 *
 * Usa pg_try_advisory_xact_lock dentro de uma transação: o lock vale pela
 * duração do callback e é liberado automaticamente no commit — imune a
 * problemas de pool (lock e unlock sempre na mesma conexão).
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";

export async function withJobLock(jobName: string, fn: () => Promise<void>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  let acquired = false;
  try {
    await db.transaction(async (tx) => {
      const res = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${jobName})) AS locked`);
      const row = (res as any)[0] ?? (res as any).rows?.[0];
      if (!row?.locked) return; // outro processo está rodando este job

      acquired = true;
      await fn(); // lock mantido até o fim da transação
    });
  } catch (err) {
    console.error(`[JobLock] Erro no job "${jobName}":`, err);
  }
  return acquired;
}
