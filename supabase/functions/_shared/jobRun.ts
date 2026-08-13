// Helper para popular a tabela job_runs (log de execução dos cron jobs).
// Ver docs/tech-specs.md (seção 9) — falha silenciosa de ingestão é o tipo
// de bug que corrompe dado sem ninguém perceber, daí o log explícito.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export async function startJobRun(client: SupabaseClient, jobName: string) {
  const { data, error } = await client
    .from("job_runs")
    .insert({ job_name: jobName, status: "running" })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as number;
}

export async function finishJobRun(
  client: SupabaseClient,
  jobRunId: number,
  outcome: { status: "success" } | { status: "error"; errorMessage: string },
  details?: Record<string, unknown>,
) {
  await client
    .from("job_runs")
    .update({
      status: outcome.status,
      finished_at: new Date().toISOString(),
      error_message: outcome.status === "error" ? outcome.errorMessage : null,
      details: details ?? null,
    })
    .eq("id", jobRunId);
}

export async function withJobRun(
  client: SupabaseClient,
  jobName: string,
  fn: () => Promise<Record<string, unknown> | void>,
): Promise<Response> {
  const jobRunId = await startJobRun(client, jobName);
  try {
    const details = (await fn()) ?? undefined;
    await finishJobRun(client, jobRunId, { status: "success" }, details);
    return new Response(JSON.stringify({ ok: true, jobRunId, details }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await finishJobRun(client, jobRunId, { status: "error", errorMessage });
    return new Response(JSON.stringify({ ok: false, jobRunId, error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
