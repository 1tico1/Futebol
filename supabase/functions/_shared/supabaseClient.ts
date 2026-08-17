// Cliente Supabase para uso dentro das Edge Functions.
// Roda sempre com a service_role key (nunca a anon key) porque estas
// funções escrevem em tabelas que só a service_role pode gravar sob RLS
// (ver supabase/migrations/0001_initial_schema.sql).
import { createClient } from "jsr:@supabase/supabase-js@2";

export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
