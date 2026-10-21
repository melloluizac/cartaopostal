// Traduz erros técnicos (Supabase/Postgres/rede, quase sempre em inglês) para uma
// mensagem em português que a pessoa entende. O texto técnico original NÃO some:
// continua aparecendo num rodapé pequeno, pra facilitar o diagnóstico.

const RULES = [
  // --- login / cadastro ---
  [/invalid login credentials/i, 'E-mail ou senha incorretos. Confira e tente de novo.'],
  [/email not confirmed/i, 'Seu e-mail ainda não foi confirmado. Abra o link que enviamos para a sua caixa de entrada (veja também o spam).'],
  [/user already registered|already been registered/i, 'Este e-mail já está cadastrado. Tente entrar.'],
  [/password should be at least|weak password|password.*characters/i, 'A senha é muito curta ou fraca. Use pelo menos 6 caracteres.'],
  [/rate limit|too many requests|over_email_send_rate_limit|for security purposes/i, 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.'],
  [/unable to validate email|invalid email|email address.*invalid/i, 'Esse e-mail não parece válido. Confira se digitou certo.'],
  [/jwt expired|invalid jwt|refresh token|session.*(expired|missing)/i, 'Sua sessão expirou. Saia e entre novamente.'],
  // --- conexão ---
  [/failed to fetch|networkerror|network request failed|load failed/i, 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'],
  // --- banco ---
  [/not trip owner/i, 'Só quem criou a viagem pode fazer isso.'],
  [/row-level security|permission denied|violates row-level|42501/i, 'Você não tem permissão para fazer isso. Se acha que deveria ter, avise quem administra a viagem.'],
  [/duplicate key|already exists|23505/i, 'Esse registro já existe.'],
  [/foreign key|violates foreign key|23503/i, 'Este item está ligado a outro registro e não pode ser alterado ou excluído desse jeito.'],
  [/null value in column|not-null|23502/i, 'Falta preencher um campo obrigatório.'],
  [/invalid input syntax|22P02|out of range|numeric field overflow/i, 'Algum campo foi preenchido com um valor inválido. Confira datas e números.'],
  [/multiple \(or no\) rows|PGRST116|no rows/i, 'Não encontramos esse registro. Ele pode ter sido excluído; recarregue a página.'],
  [/could not find the function|PGRST202|does not exist|42P01|42883|schema cache/i, 'O app depende de uma configuração do banco que ainda não existe. Avise quem administra o app.'],
  [/timeout|timed out|57014/i, 'O servidor demorou para responder. Tente novamente em instantes.'],
]

const FALLBACK = 'Algo deu errado. Tente novamente; se continuar, envie o detalhe técnico abaixo para quem administra o app.'

// Aceita: string já amigável, erro do Supabase/JS, ou { message, detail }.
export function friendlyError(err, fallback = FALLBACK) {
  if (!err) return null
  if (typeof err === 'string') return { message: err, detail: null }
  if (err.message && err.detail !== undefined && !err.code && !err.hint) {
    // já é { message, detail } montado à mão
    return { message: err.message, detail: err.detail }
  }
  const raw = [err.code, err.message, err.details, err.hint].filter(Boolean).join(' · ')
  for (const [re, text] of RULES) {
    if (re.test(raw)) return { message: text, detail: raw }
  }
  return { message: fallback, detail: raw || null }
}

export function ErrorNote({ error, className = '' }) {
  const e = typeof error === 'string' ? { message: error, detail: null } : error
  if (!e) return null
  return (
    <div className={`rounded-lg border border-rosewood/40 bg-rosewood/10 px-3 py-2 ${className}`} role="alert">
      <p className="font-mono text-xs text-rosewood">{e.message}</p>
      {e.detail && (
        <p className="mt-1.5 break-words border-t border-rosewood/20 pt-1 font-mono text-[10px] leading-snug text-muted-foreground">
          Detalhe técnico: {e.detail}
        </p>
      )}
    </div>
  )
}
