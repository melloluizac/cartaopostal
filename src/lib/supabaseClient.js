import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Falha alto e cedo — evita erros confusos de "fetch failed" mais tarde
  // por causa de env vars não configuradas no StackBlitz (.env / .env.local).
  console.error(
    '[supabaseClient] VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY ausentes. ' +
      'Verifique o arquivo .env na raiz do projeto.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Explícito por causa do Safari no iPhone: em modo standalone (ícone
    // adicionado à Tela de Início) e em navegação privada, o Safari é mais
    // agressivo limpando storage. Apontar window.localStorage direto (em vez
    // de deixar o supabase-js escolher sozinho) evita cair num storage em
    // memória que se perde ao trocar de app ou fechar a aba.
    storage: window.localStorage,
  },
})