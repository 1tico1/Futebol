// Cliente Supabase para Server Components / SSR.
// Usa a chave anon (o dashboard lê dados via as policies de leitura
// autenticada definidas em supabase/migrations/0001_initial_schema.sql —
// nunca use a service_role key aqui, ela é exclusiva de Edge Functions/worker).
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // chamado de um Server Component sem permissão de escrita de
            // cookies — inofensivo se houver middleware renovando a sessão.
          }
        },
      },
    },
  );
}
