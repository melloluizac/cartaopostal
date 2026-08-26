import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import {
  Stamp,
  LogOut,
  AlertTriangle,
  Check,
  AlertCircle,
  HelpCircle,
  MapPin,
  Plane,
  Ticket,
  Wallet,
  Plus,
  X,
  Loader2,
  Pencil,
  Trash2,
  ExternalLink,
  Home,
  Hotel,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Link2,
  Copy,
} from 'lucide-react'

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const formatEUR = (value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'EUR' }).format(
    Number(value ?? 0)
  )

const formatDate = (iso) => {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
}

// Gera o link de busca do Google Maps (formato oficial /maps/search) a
// partir de um texto livre — ex: "Coliseu Roma". Em iOS/Android, esse
// formato costuma acionar a abertura direta no app nativo do Maps quando
// instalado, já com o local pré-preenchido.
const buildMapsSearchUrl = (query) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`

// `expenses_ledger.transaction_date` não aceita nulo no banco. Quando o
// passeio/transporte de origem ainda não tem data definida, usa a data de
// hoje como padrão em vez de tentar gravar null (o que gerava erro 400).
const todayIso = () => new Date().toISOString().slice(0, 10)

// Dias até uma data (negativo = já passou)
const daysUntil = (iso) => {
  if (!iso) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${iso}T00:00:00`)
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24))
}

// NOTA DE ARQUITETURA:
// Assumimos que as colunas `status` de accommodations / transport /
// itinerary_activities usam os mesmos 4 valores do design system
// (confirmado | pendente | atrasado | planejando). Ajuste o `STATUS_CONFIG`
// abaixo se os valores reais no Supabase forem diferentes.
const STATUS_CONFIG = {
  confirmado: { label: 'Confirmado', icon: Check, className: 'bg-secondary/25 text-secondary-foreground border-secondary/50' },
  pendente: { label: 'Pendente', icon: AlertCircle, className: 'bg-accent/15 text-accent border-accent/40' },
  atrasado: { label: 'Atrasado', icon: AlertTriangle, className: 'bg-rosewood/10 text-rosewood border-rosewood/40' },
  planejando: { label: 'Planejando', icon: HelpCircle, className: 'bg-primary/10 text-primary border-primary/40' },
}
const STATUS_ORDER = ['confirmado', 'pendente', 'atrasado', 'planejando']

// Cores sólidas (não dá pra usar opacidade/tailwind em <option>, precisa de
// hex de verdade) usadas só no filtro de status da tela de Roteiro.
const STATUS_OPTION_COLORS = {
  confirmado: { bg: '#d9e2cd', fg: '#2c3125' },
  pendente: { bg: '#f0dcd0', fg: '#7a3a1e' },
  atrasado: { bg: '#f0d6d2', fg: '#7a2e22' },
  planejando: { bg: '#dbe6e8', fg: '#234047' },
}

// Categorias fixas de gasto, pra manter padrão no Controle de Gastos.
const EXPENSE_CATEGORIES = ['Passeio', 'Transporte', 'Alimentação', 'Compras', 'Hospedagem']

// Se `onChange` for passado, o badge vira clicável: um <select> nativo fica
// posicionado (invisível) por cima do badge inteiro, então o clique em
// qualquer parte dele abre as opções de status. Sem `onChange`, é só o
// badge estático de antes.
function StatusBadge({ status, onChange }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.planejando
  const Icon = config.icon
  const content = (
    <>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {config.label}
    </>
  )

  if (!onChange) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${config.className}`}
      >
        {content}
      </span>
    )
  }

  return (
    <span
      className={`relative inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${config.className}`}
    >
      {content}
      <select
        value={status ?? 'planejando'}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        aria-label="Alterar status"
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none border-0 bg-transparent p-0 opacity-0"
      >
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {STATUS_CONFIG[s].label}
          </option>
        ))}
      </select>
    </span>
  )
}

// -----------------------------------------------------------------------
// Tela de Login
// -----------------------------------------------------------------------

function LoginScreen() {
  // 'signin' usa supabase.auth.signInWithPassword — 'signup' usa supabase.auth.signUp
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Mostrado após signUp bem-sucedido, quando o Supabase exige confirmação por e-mail
  // (por padrão, session vem null e o usuário precisa clicar no link recebido).
  const [signupEmailSent, setSignupEmailSent] = useState(false)

  function switchMode(nextMode) {
    setMode(nextMode)
    setError(null)
    setSignupEmailSent(false)
    setPassword('')
    setConfirmPassword('')
  }

  async function handleSignIn(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError(error.message)
  }

  async function handleSignUp(e) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }
    if (password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.')
      return
    }

    setLoading(true)
    const { data, error } = await supabase.auth.signUp({ email, password })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    // Com confirmação de e-mail ativada (padrão do Supabase), `data.session` vem
    // null e `data.user.identities` vem vazio se o e-mail já existir. Sem
    // confirmação ativada, o signUp já retorna sessão e o onAuthStateChange
    // do App cuida do resto — não precisamos redirecionar manualmente aqui.
    if (data.user && data.user.identities?.length === 0) {
      setError('Este e-mail já está cadastrado. Tente entrar.')
      return
    }
    if (!data.session) {
      setSignupEmailSent(true)
    }
  }

  const isSignUp = mode === 'signup'

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Stamp className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="font-display text-3xl font-semibold text-foreground">Cartão Postal</h1>
          <p className="mt-1 font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Diário de viagem em grupo
          </p>
        </div>

        {/* Alternância Entrar / Criar conta */}
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-1">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`rounded-md py-1.5 font-mono text-xs uppercase tracking-wide transition-colors ${
              !isSignUp ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`rounded-md py-1.5 font-mono text-xs uppercase tracking-wide transition-colors ${
              isSignUp ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            }`}
          >
            Criar conta
          </button>
        </div>

        {signupEmailSent ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-3 font-mono text-xs text-secondary-foreground">
              Enviamos um link de confirmação para <strong>{email}</strong>. Abra seu e-mail para
              ativar a conta e depois volte aqui para entrar.
            </p>
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="font-mono text-xs uppercase tracking-wide text-primary underline"
            >
              Voltar para o login
            </button>
          </div>
        ) : (
          <form onSubmit={isSignUp ? handleSignUp : handleSignIn} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-sm text-foreground outline-none ring-primary/40 focus:ring-2"
                placeholder="voce@email.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Senha
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={isSignUp ? 6 : undefined}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-sm text-foreground outline-none ring-primary/40 focus:ring-2"
                placeholder="••••••••"
              />
            </div>

            {isSignUp && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="confirmPassword"
                  className="font-mono text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Confirmar senha
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-sm text-foreground outline-none ring-primary/40 focus:ring-2"
                  placeholder="••••••••"
                />
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-rosewood/40 bg-rosewood/10 px-3 py-2 font-mono text-xs text-rosewood">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-mono text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {isSignUp ? 'Criar conta' : 'Entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------
// Formulário genérico "Adicionar/Editar" — usado para passeio, transporte e
// gasto. Campos `select` aceitam tanto um array de strings simples quanto um
// array de { value, label } (usado pelo "Tipo de divisão", cujos rótulos
// mudam conforme os nomes dos viajantes).
// -----------------------------------------------------------------------

function QuickAddSheet({ title, icon: Icon, fields, initialValues, onSubmit, onDelete, onClose }) {
  const initial = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.name, initialValues?.[f.name] ?? f.default ?? ''])),
    [fields, initialValues]
  )
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState(null)

  function setField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSubmit(form)
      onClose()
    } catch (err) {
      setError(err.message ?? 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await onDelete()
      onClose()
    } catch (err) {
      setError(err.message ?? 'Erro ao excluir.')
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 backdrop-blur-sm sm:items-center">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-lg sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="font-display text-xl font-semibold text-foreground">{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="rounded-full p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {fields.map((f) => (
            <div key={f.name} className="flex flex-col gap-1">
              <label className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                {f.label}
                {f.required && ' *'}
              </label>
              {f.type === 'select' ? (
                <select
                  value={form[f.name]}
                  required={f.required}
                  onChange={(e) => setField(f.name, e.target.value)}
                  className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none ring-primary/40 focus:ring-2"
                >
                  <option value="" disabled>
                    Selecione
                  </option>
                  {f.options.map((opt) => {
                    const value = typeof opt === 'string' ? opt : opt.value
                    const label = typeof opt === 'string' ? opt : opt.label
                    return (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    )
                  })}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea
                  value={form[f.name]}
                  required={f.required}
                  onChange={(e) => setField(f.name, e.target.value)}
                  rows={2}
                  className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none ring-primary/40 focus:ring-2"
                />
              ) : (
                <input
                  type={f.type ?? 'text'}
                  step={f.type === 'number' ? '0.01' : undefined}
                  value={form[f.name]}
                  required={f.required}
                  onChange={(e) => setField(f.name, e.target.value)}
                  className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none ring-primary/40 focus:ring-2"
                />
              )}
            </div>
          ))}

          {error && (
            <p className="rounded-lg border border-rosewood/40 bg-rosewood/10 px-3 py-2 font-mono text-xs text-rosewood">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-mono text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Salvar
          </button>
        </form>

        {onDelete &&
          (confirmDelete ? (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-rosewood/40 bg-rosewood/10 p-3">
              <p className="font-mono text-xs text-rosewood">Excluir definitivamente?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md px-2 py-1 font-mono text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-1.5 rounded-md bg-rosewood px-2.5 py-1 font-mono text-xs uppercase tracking-wide text-rosewood-foreground disabled:opacity-60"
                >
                  {deleting && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                  Excluir
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-rosewood/40 py-2 font-mono text-xs uppercase tracking-wide text-rosewood"
            >
              <Trash2 className="h-3.5 w-3.5" /> Excluir
            </button>
          ))}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------
// Dashboard (3 telas: Início, Roteiro, Gastos)
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// Item de accordion de "Anotações por cidade" — salva sozinho quando o
// campo perde o foco (sem precisar de um botão "Salvar" separado).
// -----------------------------------------------------------------------

function CityNotesItem({ cityName, notes, isOpen, onToggle, onSave }) {
  const [text, setText] = useState(notes ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setText(notes ?? '')
  }, [notes])

  async function handleBlur() {
    if (text === (notes ?? '')) return
    setSaving(true)
    await onSave(text)
    setSaving(false)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 font-mono text-xs uppercase tracking-wide text-foreground"
      >
        {cityName}
        {isOpen ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {isOpen && (
        <div className="border-t border-border p-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={handleBlur}
            rows={4}
            placeholder="Ex: comprar bilhete de metrô de 24h na estação..."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none ring-primary/40 focus:ring-2"
          />
          {saving && <p className="mt-1 font-mono text-[10px] text-muted-foreground">Salvando…</p>}
        </div>
      )}
    </div>
  )
}


// Gera um código de convite de 6 caracteres. Evita 0/O e 1/I de propósito,
// pra reduzir confusão na hora de digitar/ler em voz alta.
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

// -----------------------------------------------------------------------
// Onboarding — tela mostrada quando a conta logada ainda não é dona nem
// participante de nenhuma viagem. Duas portas de entrada: criar uma viagem
// nova (gera o código de convite) ou entrar com um código recebido.
// -----------------------------------------------------------------------

function Onboarding({ session, onTripReady }) {
  const [mode, setMode] = useState(null) // null | 'create' | 'join'
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState(null)
  const [joining, setJoining] = useState(false)

  async function handleCreateTrip(form) {
    let lastError = null
    // Tenta algumas vezes: se o código sortido colidir com um já existente
    // (UNIQUE), sorteia outro. Qualquer outro tipo de erro para na hora.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabase.from('trips').insert({
        user_id: session.user.id,
        title: form.title,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        currency: form.currency || 'EUR',
        base_euro_rate: form.base_euro_rate ? Number(form.base_euro_rate) : null,
        invite_code: generateInviteCode(),
      })
      if (!error) {
        await onTripReady()
        return
      }
      lastError = error
      if (error.code !== '23505') break
    }
    throw lastError
  }

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase()
    if (code.length !== 6) {
      setJoinError('O código tem 6 caracteres.')
      return
    }
    setJoining(true)
    setJoinError(null)

    const { data, error } = await supabase.rpc('find_trip_by_invite_code', { code })
    if (error || !data || data.length === 0) {
      setJoinError('Código não encontrado. Confira com quem te enviou.')
      setJoining(false)
      return
    }

    const { error: insertError } = await supabase
      .from('trip_participants')
      .insert({ trip_id: data[0].id, user_id: session.user.id })
    setJoining(false)

    // 23505 = unique_violation — já era participante, trata como sucesso.
    if (insertError && insertError.code !== '23505') {
      setJoinError(insertError.message)
      return
    }

    await onTripReady()
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 text-center">
      <div>
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Stamp className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="font-display text-3xl font-semibold text-foreground">Cartão Postal</h1>
        <p className="mt-1 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Nenhuma viagem vinculada à sua conta ainda
        </p>
      </div>

      {mode === null && (
        <div className="flex w-full max-w-sm flex-col gap-3">
          <button
            onClick={() => setMode('create')}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-mono text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Criar Nova Viagem
          </button>
          <button
            onClick={() => setMode('join')}
            className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 font-mono text-sm font-medium text-foreground"
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
            Entrar com Código
          </button>
        </div>
      )}

      {mode === 'join' && (
        <div className="flex w-full max-w-sm flex-col gap-3">
          <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Código de convite
          </label>
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
            maxLength={6}
            placeholder="EUR26X"
            className="rounded-lg border border-input bg-card px-3 py-3 text-center font-mono text-2xl tracking-[0.3em] text-foreground outline-none ring-primary/40 focus:ring-2"
          />
          {joinError && (
            <p className="rounded-lg border border-rosewood/40 bg-rosewood/10 px-3 py-2 font-mono text-xs text-rosewood">
              {joinError}
            </p>
          )}
          <button
            onClick={handleJoin}
            disabled={joining || joinCode.length !== 6}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-mono text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {joining && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Sincronizar
          </button>
          <button
            onClick={() => {
              setMode(null)
              setJoinError(null)
              setJoinCode('')
            }}
            className="font-mono text-xs uppercase tracking-wide text-muted-foreground underline"
          >
            Voltar
          </button>
        </div>
      )}

      {mode === 'create' && (
        <QuickAddSheet
          title="Criar Nova Viagem"
          icon={Stamp}
          onClose={() => setMode(null)}
          onSubmit={handleCreateTrip}
          fields={[
            { name: 'title', label: 'Título da viagem', required: true },
            { name: 'start_date', label: 'Data de início', type: 'date' },
            { name: 'end_date', label: 'Data de término', type: 'date' },
            {
              name: 'currency',
              label: 'Moeda',
              type: 'select',
              options: ['EUR', 'USD', 'BRL', 'GBP', 'CHF'],
              default: 'EUR',
            },
            { name: 'base_euro_rate', label: 'Cotação base da moeda (opcional)', type: 'number' },
          ]}
        />
      )}

      <button
        onClick={() => supabase.auth.signOut()}
        className="font-mono text-xs uppercase tracking-wide text-muted-foreground underline underline-offset-2"
      >
        Sair
      </button>
    </div>
  )
}


function Dashboard({ session }) {
  const [view, setView] = useState('home') // 'home' | 'roteiro' | 'gastos'
  const [trip, setTrip] = useState(null)
  const [destinations, setDestinations] = useState([])
  const [travelers, setTravelers] = useState([]) // linhas de trip_travelers, para os dropdowns "Pago por"
  const [activeDestId, setActiveDestId] = useState('ALL') // id de um destino, ou 'ALL' (Visão geral)
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'confirmado' | 'pendente' | 'atrasado' | 'planejando'
  const [categoryFilter, setCategoryFilter] = useState('all') // 'all' | 'activity' | 'transport' | 'accommodation'
  const [expandedDays, setExpandedDays] = useState(() => new Set()) // dias abertos na Visão geral (accordion)
  const [accommodations, setAccommodations] = useState([])
  const [activities, setActivities] = useState([])
  const [transport, setTransport] = useState([])
  const [expenses, setExpenses] = useState([]) // linhas cruas de expenses_ledger (já filtradas por RLS)
  const [alertRows, setAlertRows] = useState([])
  const [tripStartDate, setTripStartDate] = useState(null) // calculado, não vem de trips
  const [pendingCount, setPendingCount] = useState(0)
  // Dados brutos de TODAS as cidades (independente do filtro da tela
  // Roteiro), usados na estimativa de custos da tela Gastos.
  const [overviewAccommodations, setOverviewAccommodations] = useState([])
  const [overviewActivities, setOverviewActivities] = useState([])
  const [overviewTransport, setOverviewTransport] = useState([])
  const [includePendenteInEstimate, setIncludePendenteInEstimate] = useState(false)
  const [includeAtrasadoInEstimate, setIncludeAtrasadoInEstimate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [openSheet, setOpenSheet] = useState(null) // 'activity' | 'transport' | 'expense' | null
  const [editingItem, setEditingItem] = useState(null) // { kind: 'activity' | 'transport', data: {...} } | null
  const [errorMsg, setErrorMsg] = useState(null)
  // Aba "Detalhes"
  const [reminders, setReminders] = useState([])
  const [newReminderText, setNewReminderText] = useState('')
  const [expandedCityNotes, setExpandedCityNotes] = useState(() => new Set())
  const [cityNotes, setCityNotes] = useState([]) // linhas de city_notes (1 por destino, criada sob demanda)
  const [codeCopied, setCodeCopied] = useState(false)

  async function handleCopyInviteCode() {
    if (!trip?.invite_code) return
    try {
      await navigator.clipboard.writeText(trip.invite_code)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    } catch {
      // clipboard indisponível (ex: contexto não-seguro) — ignora silenciosamente
    }
  }

  // Carrega a viagem do usuário logado (como dona OU como participante via
  // trip_participants) + destinos + viajantes + alertas.
  const loadTrip = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)

    // 1. É dona de alguma viagem?
    const { data: ownedTrips, error: ownedError } = await supabase
      .from('trips')
      .select('*')
      .eq('user_id', session.user.id)
      .limit(1)

    if (ownedError) {
      setErrorMsg(ownedError.message)
      setLoading(false)
      return
    }

    let currentTrip = ownedTrips?.[0] ?? null

    // 2. Se não é dona, é participante de alguma via convite?
    if (!currentTrip) {
      const { data: participantRows } = await supabase
        .from('trip_participants')
        .select('trip_id')
        .eq('user_id', session.user.id)
        .limit(1)

      if (participantRows?.[0]) {
        const { data: participantTrips } = await supabase
          .from('trips')
          .select('*')
          .eq('id', participantRows[0].trip_id)
          .limit(1)
        currentTrip = participantTrips?.[0] ?? null
      }
    }

    if (!currentTrip) {
      setTrip(null)
      setLoading(false)
      return
    }
    setTrip(currentTrip)

    const [destRes, travelersRes, alertRes] = await Promise.all([
      supabase
        .from('destinations')
        .select('*')
        .eq('trip_id', currentTrip.id)
        .order('order_index', { ascending: true }),
      supabase.from('trip_travelers').select('*').eq('trip_id', currentTrip.id),
      supabase.from('view_hotel_cancellation_alerts').select('*').eq('trip_id', currentTrip.id),
    ])

    if (destRes.data) setDestinations(destRes.data)
    setTravelers(travelersRes.data ?? [])
    setAlertRows(alertRes.data ?? [])
    setLoading(false)
  }, [session.user.id])

  useEffect(() => {
    loadTrip()
  }, [loadTrip])

  // Viajante (linha de trip_travelers) vinculado à conta atualmente logada,
  // via trip_travelers.user_id. Usado como responsável padrão quando
  // "Pago por" é deixado em branco.
  const currentTraveler = useMemo(
    () => travelers.find((t) => t.user_id === session.user.id) ?? null,
    [travelers, session.user.id]
  )
  const currentTravelerName = currentTraveler?.name ?? session.user.email

  // Opções do dropdown único "Responsável pelo Pagamento": 'individual' (padrão
  // — cada um paga o seu, sem gerar cobrança) ou o nome de um viajante
  // (assume divisão igual entre TODOS os viajantes ativos, calculada
  // dinamicamente por 1/N — não é mais um bloco fixo de 50/50).
  const responsavelOptions = useMemo(
    () => [
      { value: 'individual', label: 'Individual' },
      ...travelers.map((t) => ({ value: t.name, label: t.name })),
    ],
    [travelers]
  )

  // Resolve o valor bruto do dropdown único em (paid_by, split_type) — o
  // par que efetivamente é gravado no banco.
  function resolveResponsavel(value) {
    const isIndividual = !value || value === 'individual'
    return {
      paidBy: isIndividual ? currentTravelerName : value,
      splitType: isIndividual ? 'individual' : 'igual',
    }
  }

  // Data de início da viagem: usa trip.start_date se a pessoa cadastrou na
  // criação da viagem; senão, calcula como a menor data entre todas as
  // hospedagens/passeios/transportes já cadastrados em qualquer cidade.
  useEffect(() => {
    if (!trip) {
      setTripStartDate(null)
      return
    }
    if (trip.start_date) {
      setTripStartDate(trip.start_date)
      return
    }
    if (destinations.length === 0) {
      setTripStartDate(null)
      return
    }
    let ignore = false
    async function loadEarliestDate() {
      const destIds = destinations.map((d) => d.id)
      const [accRes, actRes, transRes] = await Promise.all([
        supabase
          .from('accommodations')
          .select('check_in')
          .in('destination_id', destIds)
          .not('check_in', 'is', null)
          .order('check_in', { ascending: true })
          .limit(1),
        supabase
          .from('itinerary_activities')
          .select('assigned_date')
          .in('destination_id', destIds)
          .not('assigned_date', 'is', null)
          .order('assigned_date', { ascending: true })
          .limit(1),
        supabase
          .from('transport')
          .select('departure_date')
          .eq('trip_id', trip.id)
          .not('departure_date', 'is', null)
          .order('departure_date', { ascending: true })
          .limit(1),
      ])
      const candidates = [
        accRes.data?.[0]?.check_in,
        actRes.data?.[0]?.assigned_date,
        transRes.data?.[0]?.departure_date,
      ].filter(Boolean)
      if (!ignore) setTripStartDate(candidates.length ? candidates.sort()[0] : null)
    }
    loadEarliestDate()
    return () => {
      ignore = true
    }
  }, [trip, destinations])

  // Busca hospedagens + passeios + transporte de TODAS as cidades (independente
  // do filtro da tela Roteiro), usado tanto pra contagem de pendências (tela
  // Início) quanto pra estimativa de custos do roteiro (tela Gastos).
  const loadPendingCount = useCallback(async () => {
    if (!trip || destinations.length === 0) {
      setPendingCount(0)
      setOverviewAccommodations([])
      setOverviewActivities([])
      setOverviewTransport([])
      return
    }
    const destIds = destinations.map((d) => d.id)
    const [accRes, actRes, transRes] = await Promise.all([
      supabase.from('accommodations').select('*').in('destination_id', destIds),
      supabase.from('itinerary_activities').select('*').in('destination_id', destIds),
      supabase.from('transport').select('*').eq('trip_id', trip.id),
    ])
    const accData = accRes.data ?? []
    const actData = actRes.data ?? []
    const transData = transRes.data ?? []
    setOverviewAccommodations(accData)
    setOverviewActivities(actData)
    setOverviewTransport(transData)
    setPendingCount(
      accData.filter((a) => a.status === 'pendente').length +
        actData.filter((a) => a.status === 'pendente').length +
        transData.filter((t) => t.status === 'pendente').length
    )
  }, [trip, destinations])

  useEffect(() => {
    loadPendingCount()
  }, [loadPendingCount])

  // Carrega hospedagens, passeios e transporte de um destino específico, ou
  // de TODOS os destinos da viagem quando destId === 'ALL' (visão geral).
  const loadItineraryData = useCallback(
    async (destId) => {
      if (!trip) return

      if (destId === 'ALL') {
        const destIds = destinations.map((d) => d.id)
        const [accRes, actRes, transRes] = await Promise.all([
          destIds.length
            ? supabase.from('accommodations').select('*').in('destination_id', destIds)
            : Promise.resolve({ data: [] }),
          destIds.length
            ? supabase
                .from('itinerary_activities')
                .select('*')
                .in('destination_id', destIds)
                .order('assigned_date', { ascending: true })
                .order('exact_time', { ascending: true })
            : Promise.resolve({ data: [] }),
          supabase
            .from('transport')
            .select('*')
            .eq('trip_id', trip.id)
            .order('departure_date', { ascending: true }),
        ])
        setAccommodations(accRes.data ?? [])
        setActivities(actRes.data ?? [])
        setTransport(transRes.data ?? [])
        return
      }

      if (!destId) return
      const activeDest = destinations.find((d) => d.id === destId)
      const [accRes, actRes, transRes] = await Promise.all([
        supabase.from('accommodations').select('*').eq('destination_id', destId),
        supabase
          .from('itinerary_activities')
          .select('*')
          .eq('destination_id', destId)
          .order('assigned_date', { ascending: true })
          .order('exact_time', { ascending: true }),
        activeDest
          ? supabase
              .from('transport')
              .select('*')
              .eq('trip_id', trip.id)
              .or(`origin_city.eq.${activeDest.city_name},destination_city.eq.${activeDest.city_name}`)
              .order('departure_date', { ascending: true })
          : Promise.resolve({ data: [] }),
      ])
      setAccommodations(accRes.data ?? [])
      setActivities(actRes.data ?? [])
      setTransport(transRes.data ?? [])
    },
    [trip, destinations]
  )

  // Recarrega hospedagens, passeios e transporte quando o destino ativo muda
  // — ou quando a lista de destinos termina de carregar (loadItineraryData é
  // recriada nesse momento, já que depende de `destinations`). Sem isso, a
  // primeiríssima busca em "Visão geral" podia rodar antes das cidades
  // chegarem do banco, e nunca era refeita sozinha depois.
  useEffect(() => {
    if (!activeDestId || !trip) return
    loadItineraryData(activeDestId)
  }, [activeDestId, loadItineraryData])

  // Recarrega o extrato de gastos (já filtrado pelo RLS: entradas
  // "Individual" de outra conta simplesmente não voltam nessa consulta) e
  // os alertas de cancelamento.
  const refreshFinancials = useCallback(async () => {
    if (!trip) return
    const [expensesRes, alertRes] = await Promise.all([
      supabase.from('expenses_ledger').select('*').eq('trip_id', trip.id).order('transaction_date', { ascending: false }),
      supabase.from('view_hotel_cancellation_alerts').select('*').eq('trip_id', trip.id),
    ])
    setExpenses(expensesRes.data ?? [])
    setAlertRows(alertRes.data ?? [])
  }, [trip])

  useEffect(() => {
    refreshFinancials()
  }, [refreshFinancials])

  // --- Aba "Detalhes": lembretes globais + notas por cidade --------------

  const loadReminders = useCallback(async () => {
    if (!trip) {
      setReminders([])
      return
    }
    const { data } = await supabase
      .from('trip_reminders')
      .select('*')
      .eq('trip_id', trip.id)
      .order('created_at', { ascending: true })
    setReminders(data ?? [])
  }, [trip])

  useEffect(() => {
    loadReminders()
  }, [loadReminders])

  async function handleAddReminder() {
    const text = newReminderText.trim()
    if (!text || !trip) return
    const { error } = await supabase.from('trip_reminders').insert({ trip_id: trip.id, task_text: text, is_completed: false })
    if (error) {
      setErrorMsg(error.message)
      return
    }
    setNewReminderText('')
    await loadReminders()
  }

  async function handleToggleReminder(reminder) {
    const { error } = await supabase
      .from('trip_reminders')
      .update({ is_completed: !reminder.is_completed })
      .eq('id', reminder.id)
    if (error) {
      setErrorMsg(error.message)
      return
    }
    await loadReminders()
  }

  async function handleDeleteReminder(id) {
    const { error } = await supabase.from('trip_reminders').delete().eq('id', id)
    if (error) {
      setErrorMsg(error.message)
      return
    }
    await loadReminders()
  }

  function toggleCityNotes(destId) {
    setExpandedCityNotes((prev) => {
      const next = new Set(prev)
      if (next.has(destId)) next.delete(destId)
      else next.add(destId)
      return next
    })
  }

  // Busca as notas de todas as cidades da viagem de uma vez (a tabela
  // city_notes tem no máximo 1 linha por destino, criada só quando a pessoa
  // salva algo pela primeira vez naquela cidade).
  const loadCityNotes = useCallback(async () => {
    if (destinations.length === 0) {
      setCityNotes([])
      return
    }
    const destIds = destinations.map((d) => d.id)
    const { data } = await supabase.from('city_notes').select('*').in('destination_id', destIds)
    setCityNotes(data ?? [])
  }, [destinations])

  useEffect(() => {
    loadCityNotes()
  }, [loadCityNotes])

  const cityNoteByDestId = useMemo(
    () => Object.fromEntries(cityNotes.map((n) => [n.destination_id, n])),
    [cityNotes]
  )

  async function handleSaveCityNotes(destId, text) {
    const existing = cityNoteByDestId[destId]
    if (existing) {
      const { error } = await supabase
        .from('city_notes')
        .update({ notes_content: text, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) {
        setErrorMsg(error.message)
        return
      }
    } else {
      const { error } = await supabase
        .from('city_notes')
        .insert({ destination_id: destId, notes_content: text })
      if (error) {
        setErrorMsg(error.message)
        return
      }
    }
    await loadCityNotes()
  }

  // Cria OU atualiza o gasto vinculado a um item do roteiro (passeio,
  // transporte ou hospedagem). Se `existingExpenseId` já existir, faz
  // .update() nele em vez de duplicar; senão, faz .insert() e devolve o id
  // criado, pra ser salvo de volta em `linked_expense_id` no item de origem.
  // Se o custo total ficar zerado/vazio E não houver gasto prévio, não faz
  // nada — é o cenário de "criei o card ainda sem saber o valor".
  async function syncLinkedExpense({ existingExpenseId, totalCost, paidBy, splitType, date, description, category }) {
    const cost = Number(totalCost) || 0

    if (existingExpenseId) {
      const { error } = await supabase
        .from('expenses_ledger')
        .update({
          total_cost_eur: cost,
          paid_by: paidBy,
          split_type: splitType,
          transaction_date: date || todayIso(),
          description,
          category,
        })
        .eq('id', existingExpenseId)
      if (error) throw error
      await refreshFinancials()
      return existingExpenseId
    }

    if (!cost) return null

    const { data, error } = await supabase
      .from('expenses_ledger')
      .insert({
        trip_id: trip.id,
        transaction_date: date || todayIso(),
        description,
        category,
        total_cost_eur: cost,
        paid_by: paidBy,
        split_type: splitType,
        created_by: session.user.id,
      })
      .select('id')
      .single()
    if (error) throw error
    await refreshFinancials()
    return data.id
  }

  // Atualiza o status de uma linha (hospedagem, passeio ou transporte) ao
  // clicar no badge, e recarrega tudo que depende disso.
  async function handleStatusChange(table, id, newStatus) {
    const { error } = await supabase.from(table).update({ status: newStatus }).eq('id', id)
    if (error) {
      setErrorMsg(error.message)
      return
    }
    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  // --- Handlers de insert -------------------------------------------------

  async function handleAddDestination(form) {
    const orderIndex = destinations.length
      ? Math.max(...destinations.map((d) => d.order_index ?? 0)) + 1
      : 0
    const { data: inserted, error } = await supabase
      .from('destinations')
      .insert({
        trip_id: trip.id,
        city_name: form.city_name,
        is_bate_volta: form.is_bate_volta === 'sim',
        order_index: orderIndex,
      })
      .select('*')
      .single()
    if (error) throw error
    setDestinations((prev) => [...prev, inserted])
    // Já deixa a cidade recém-criada selecionada, pra poder começar a
    // adicionar passeios/hospedagem nela na hora.
    setActiveDestId(inserted.id)
  }

  async function handleAddActivity(form) {
    // Na Visão geral não existe uma cidade implícita, então o formulário
    // pede pra escolher (campo `destination_id`). Numa aba de cidade
    // específica, usa a cidade que já está selecionada.
    const destinationId = activeDestId === 'ALL' ? form.destination_id : activeDestId
    const { paidBy, splitType } = resolveResponsavel(form.responsavel)
    const totalCost = form.total_cost_eur ? Number(form.total_cost_eur) : 0

    const { data: inserted, error } = await supabase
      .from('itinerary_activities')
      .insert({
        destination_id: destinationId,
        activity_name: form.activity_name,
        assigned_date: form.assigned_date || null,
        shift: form.shift || null,
        exact_time: form.exact_time || null,
        total_cost_eur: totalCost || null,
        paid_by: paidBy,
        split_type: splitType,
        status: form.status || 'planejando',
        booking_rule: form.booking_rule || null,
        ticket_url: form.ticket_url || null,
        notes: form.notes || null,
      })
      .select('id')
      .single()
    if (error) throw error

    if (totalCost) {
      const expenseId = await syncLinkedExpense({
        existingExpenseId: null,
        totalCost,
        paidBy,
        splitType,
        date: form.assigned_date,
        description: `Passeio: ${form.activity_name}`,
        category: 'Passeio',
      })
      if (expenseId) {
        await supabase.from('itinerary_activities').update({ linked_expense_id: expenseId }).eq('id', inserted.id)
      }
    }

    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleAddTransport(form) {
    const { paidBy, splitType } = resolveResponsavel(form.responsavel)
    const totalCost = form.total_cost_eur ? Number(form.total_cost_eur) : 0

    const { data: inserted, error } = await supabase
      .from('transport')
      .insert({
        trip_id: trip.id,
        origin_city: form.origin_city,
        origin_station: form.origin_station || null,
        destination_city: form.destination_city,
        destination_station: form.destination_station || null,
        departure_date: form.departure_date || null,
        departure_time: form.departure_time || null,
        arrival_time: form.arrival_time || null,
        total_cost_eur: totalCost || null,
        paid_by: paidBy,
        split_type: splitType,
        status: form.status || 'planejando',
        comments: form.comments || null,
      })
      .select('id')
      .single()
    if (error) throw error

    if (totalCost) {
      const expenseId = await syncLinkedExpense({
        existingExpenseId: null,
        totalCost,
        paidBy,
        splitType,
        date: form.departure_date,
        description: `Transporte: ${form.origin_city} → ${form.destination_city}`,
        category: 'Transporte',
      })
      if (expenseId) {
        await supabase.from('transport').update({ linked_expense_id: expenseId }).eq('id', inserted.id)
      }
    }

    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleAddAccommodation(form) {
    const destinationId = activeDestId === 'ALL' ? form.destination_id : activeDestId
    const { paidBy, splitType } = resolveResponsavel(form.responsavel)
    const totalCost = form.total_cost_eur ? Number(form.total_cost_eur) : 0

    const { data: inserted, error } = await supabase
      .from('accommodations')
      .insert({
        destination_id: destinationId,
        hotel_name: form.hotel_name,
        check_in: form.check_in || null,
        check_out: form.check_out || null,
        total_cost_eur: totalCost || null,
        paid_by: paidBy,
        split_type: splitType,
        status: form.status || 'planejando',
        cancellation_deadline: form.cancellation_deadline || null,
        booking_link: form.booking_link || null,
        comments: form.comments || null,
      })
      .select('id')
      .single()
    if (error) throw error

    if (totalCost) {
      const expenseId = await syncLinkedExpense({
        existingExpenseId: null,
        totalCost,
        paidBy,
        splitType,
        date: form.check_in,
        description: `Hospedagem: ${form.hotel_name}`,
        category: 'Hospedagem',
      })
      if (expenseId) {
        await supabase.from('accommodations').update({ linked_expense_id: expenseId }).eq('id', inserted.id)
      }
    }

    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleAddExpense(form) {
    const { paidBy, splitType } = resolveResponsavel(form.responsavel)
    const { error } = await supabase.from('expenses_ledger').insert({
      trip_id: trip.id,
      transaction_date: form.transaction_date || todayIso(),
      description: form.description,
      category: form.category || null,
      total_cost_eur: form.total_cost_eur ? Number(form.total_cost_eur) : 0,
      paid_by: paidBy,
      split_type: splitType,
      created_by: session.user.id,
    })
    if (error) throw error
    await refreshFinancials()
  }

  // --- Handlers de edição / exclusão --------------------------------------
  // Diferente da versão anterior, editar SEMPRE sincroniza o financeiro: se
  // já existe um gasto vinculado (linked_expense_id), atualiza esse gasto em
  // vez de duplicar; se não existe ainda e agora há um valor total, cria um
  // novo. Ao excluir o item, o gasto vinculado é excluído junto.

  async function handleUpdateActivity(existing, form) {
    const { paidBy, splitType } = resolveResponsavel(form.responsavel)
    const totalCost = form.total_cost_eur ? Number(form.total_cost_eur) : 0

    const { error } = await supabase
      .from('itinerary_activities')
      .update({
        activity_name: form.activity_name,
        assigned_date: form.assigned_date || null,
        shift: form.shift || null,
        exact_time: form.exact_time || null,
        total_cost_eur: totalCost || null,
        paid_by: paidBy,
        split_type: splitType,
        status: form.status || 'planejando',
        booking_rule: form.booking_rule || null,
        ticket_url: form.ticket_url || null,
        notes: form.notes || null,
      })
      .eq('id', existing.id)
    if (error) throw error

    const expenseId = await syncLinkedExpense({
      existingExpenseId: existing.linked_expense_id,
      totalCost,
      paidBy,
      splitType,
      date: form.assigned_date,
      description: `Passeio: ${form.activity_name}`,
      category: 'Passeio',
    })
    if (expenseId && expenseId !== existing.linked_expense_id) {
      await supabase.from('itinerary_activities').update({ linked_expense_id: expenseId }).eq('id', existing.id)
    }

    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleDeleteActivity(existing) {
    const { error } = await supabase.from('itinerary_activities').delete().eq('id', existing.id)
    if (error) throw error
    if (existing.linked_expense_id) {
      await supabase.from('expenses_ledger').delete().eq('id', existing.linked_expense_id)
      await refreshFinancials()
    }
    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleUpdateTransport(existing, form) {
    const { paidBy, splitType } = resolveResponsavel(form.responsavel)
    const totalCost = form.total_cost_eur ? Number(form.total_cost_eur) : 0

    const { error } = await supabase
      .from('transport')
      .update({
        origin_city: form.origin_city,
        origin_station: form.origin_station || null,
        destination_city: form.destination_city,
        destination_station: form.destination_station || null,
        departure_date: form.departure_date || null,
        departure_time: form.departure_time || null,
        arrival_time: form.arrival_time || null,
        total_cost_eur: totalCost || null,
        paid_by: paidBy,
        split_type: splitType,
        status: form.status || 'planejando',
        comments: form.comments || null,
      })
      .eq('id', existing.id)
    if (error) throw error

    const expenseId = await syncLinkedExpense({
      existingExpenseId: existing.linked_expense_id,
      totalCost,
      paidBy,
      splitType,
      date: form.departure_date,
      description: `Transporte: ${form.origin_city} → ${form.destination_city}`,
      category: 'Transporte',
    })
    if (expenseId && expenseId !== existing.linked_expense_id) {
      await supabase.from('transport').update({ linked_expense_id: expenseId }).eq('id', existing.id)
    }

    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleDeleteTransport(existing) {
    const { error } = await supabase.from('transport').delete().eq('id', existing.id)
    if (error) throw error
    if (existing.linked_expense_id) {
      await supabase.from('expenses_ledger').delete().eq('id', existing.linked_expense_id)
      await refreshFinancials()
    }
    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleUpdateAccommodation(existing, form) {
    const { paidBy, splitType } = resolveResponsavel(form.responsavel)
    const totalCost = form.total_cost_eur ? Number(form.total_cost_eur) : 0

    const { error } = await supabase
      .from('accommodations')
      .update({
        hotel_name: form.hotel_name,
        check_in: form.check_in || null,
        check_out: form.check_out || null,
        total_cost_eur: totalCost || null,
        paid_by: paidBy,
        split_type: splitType,
        status: form.status || 'planejando',
        cancellation_deadline: form.cancellation_deadline || null,
        booking_link: form.booking_link || null,
        comments: form.comments || null,
      })
      .eq('id', existing.id)
    if (error) throw error

    const expenseId = await syncLinkedExpense({
      existingExpenseId: existing.linked_expense_id,
      totalCost,
      paidBy,
      splitType,
      date: form.check_in,
      description: `Hospedagem: ${form.hotel_name}`,
      category: 'Hospedagem',
    })
    if (expenseId && expenseId !== existing.linked_expense_id) {
      await supabase.from('accommodations').update({ linked_expense_id: expenseId }).eq('id', existing.id)
    }

    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleDeleteAccommodation(existing) {
    const { error } = await supabase.from('accommodations').delete().eq('id', existing.id)
    if (error) throw error
    if (existing.linked_expense_id) {
      await supabase.from('expenses_ledger').delete().eq('id', existing.linked_expense_id)
      await refreshFinancials()
    }
    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  function toggleDay(date) {
    setExpandedDays((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  // Mapa id do destino -> nome da cidade, usado na Visão geral pra
  // identificar de qual cidade cada item da timeline é.
  const destById = useMemo(
    () => Object.fromEntries(destinations.map((d) => [d.id, d.city_name])),
    [destinations]
  )

  // Custo por pessoa exibido na timeline: se o item é "Individual", o valor
  // por pessoa é o próprio total (só a pessoa paga, por ela mesma). Se é
  // "igual" (um viajante específico foi escolhido como responsável), divide
  // pelo número de viajantes ativos — dinamicamente, não em blocos fixos.
  function perPersonCost(row) {
    if (row.total_cost_eur == null) return null
    const total = Number(row.total_cost_eur)
    return row.split_type === 'igual' ? total / Math.max(travelers.length, 1) : total
  }

  const filteredAccommodations = useMemo(() => {
    let list = accommodations
    if (statusFilter !== 'all') list = list.filter((a) => a.status === statusFilter)
    if (categoryFilter !== 'all' && categoryFilter !== 'accommodation') list = []
    return list
  }, [accommodations, statusFilter, categoryFilter])

  const filteredActivities = useMemo(() => {
    let list = activities
    if (statusFilter !== 'all') list = list.filter((a) => a.status === statusFilter)
    if (categoryFilter !== 'all' && categoryFilter !== 'activity') list = []
    return list
  }, [activities, statusFilter, categoryFilter])

  const filteredTransport = useMemo(() => {
    let list = transport
    if (statusFilter !== 'all') list = list.filter((t) => t.status === statusFilter)
    if (categoryFilter !== 'all' && categoryFilter !== 'transport') list = []
    return list
  }, [transport, statusFilter, categoryFilter])

  // --- Timeline combinada (hospedagem + passeios + transporte) -----------
  // Hospedagens entram no dia do check-in (não ficam mais numa seção à
  // parte no topo).

  const timelineByDay = useMemo(() => {
    const groups = {}
    for (const acc of filteredAccommodations) {
      if (!acc.check_in) continue
      const key = acc.check_in
      groups[key] = groups[key] ?? []
      groups[key].push({ kind: 'accommodation', time: '00:00', data: acc })
    }
    for (const a of filteredActivities) {
      const key = a.assigned_date ?? 'Sem data'
      groups[key] = groups[key] ?? []
      groups[key].push({ kind: 'activity', time: a.exact_time, data: a })
    }
    for (const t of filteredTransport) {
      const key = t.departure_date ?? 'Sem data'
      groups[key] = groups[key] ?? []
      groups[key].push({ kind: 'transport', time: t.departure_time, data: t })
    }
    return Object.entries(groups)
      .sort(([a], [b]) => (a === 'Sem data' ? 1 : b === 'Sem data' ? -1 : a.localeCompare(b)))
      .map(([date, items]) => ({
        date,
        items: items.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99')),
      }))
  }, [filteredAccommodations, filteredActivities, filteredTransport])

  // Usado pelo botão "Expandir tudo" no topo da tela Roteiro (só relevante
  // no modo accordion, ou seja, na Visão geral).
  const allTimelineDates = useMemo(() => timelineByDay.map((d) => d.date), [timelineByDay])
  const allDaysExpanded = allTimelineDates.length > 0 && allTimelineDates.every((d) => expandedDays.has(d))
  function toggleExpandAll() {
    setExpandedDays(allDaysExpanded ? new Set() : new Set(allTimelineDates))
  }

  const urgentAlerts = useMemo(
    () => alertRows.filter((row) => (row.days_remaining ?? daysUntil(row.cancellation_deadline)) <= 7),
    [alertRows]
  )

  // --- Saldo do grupo (calculado no app, não numa view SQL) --------------
  // "Total pago" soma tudo que a pessoa desembolsou, qualquer tipo de
  // divisão. "Saldo" (a receber/a pagar) só considera os gastos 50/50 — os
  // "100% Pessoa X" e "Individual" não geram cobrança pra ninguém.
  const balances = useMemo(() => {
    const totalPaidByName = {}
    const sharedPaidByName = {}
    let sharedPool = 0
    for (const t of travelers) {
      totalPaidByName[t.name] = 0
      sharedPaidByName[t.name] = 0
    }
    for (const e of expenses) {
      const cost = Number(e.total_cost_eur) || 0
      if (e.paid_by && totalPaidByName[e.paid_by] !== undefined) {
        totalPaidByName[e.paid_by] += cost
        if (e.split_type === 'igual') sharedPaidByName[e.paid_by] += cost
      }
      if (e.split_type === 'igual') sharedPool += cost
    }
    const fairShare = travelers.length ? sharedPool / travelers.length : 0
    return travelers.map((t) => ({
      name: t.name,
      totalPaid: totalPaidByName[t.name] ?? 0,
      balance: (sharedPaidByName[t.name] ?? 0) - fairShare,
    }))
  }, [expenses, travelers])

  const grandTotal = useMemo(
    () => expenses.reduce((sum, e) => sum + (Number(e.total_cost_eur) || 0), 0),
    [expenses]
  )

  const categoryTotals = useMemo(() => {
    const totals = {}
    for (const e of expenses) {
      const cat = e.category || 'Outros'
      totals[cat] = (totals[cat] ?? 0) + (Number(e.total_cost_eur) || 0)
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1])
  }, [expenses])

  const maxCategoryAmount = useMemo(
    () => Math.max(1, ...categoryTotals.map(([, amount]) => amount)),
    [categoryTotals]
  )

  // Estimativa de custo com base nos pontos do roteiro (passeios, transportes
  // e hospedagens de TODAS as cidades) — independente de já ter sido lançado
  // um gasto de verdade ou não. Por padrão só soma "confirmado"; os
  // checkboxes na tela de Gastos permitem incluir "pendente" e "atrasado".
  const estimateStatuses = useMemo(() => {
    const set = new Set(['confirmado'])
    if (includePendenteInEstimate) set.add('pendente')
    if (includeAtrasadoInEstimate) set.add('atrasado')
    return set
  }, [includePendenteInEstimate, includeAtrasadoInEstimate])

  const roteiroEstimateTotal = useMemo(() => {
    let total = 0
    for (const a of overviewActivities) {
      if (estimateStatuses.has(a.status) && a.total_cost_eur != null) {
        total += Number(a.total_cost_eur)
      }
    }
    for (const t of overviewTransport) {
      if (estimateStatuses.has(t.status) && t.total_cost_eur != null) {
        total += Number(t.total_cost_eur)
      }
    }
    for (const acc of overviewAccommodations) {
      if (estimateStatuses.has(acc.status) && acc.total_cost_eur != null) {
        total += Number(acc.total_cost_eur)
      }
    }
    return total
  }, [overviewActivities, overviewTransport, overviewAccommodations, estimateStatuses])

  // Contagem regressiva mostrada na tela Início
  const countdownLabel = useMemo(() => {
    if (!tripStartDate) return 'Sem data ainda'
    const days = daysUntil(tripStartDate)
    if (days > 1) return `${days} dias para a viagem`
    if (days === 1) return 'Falta 1 dia!'
    if (days === 0) return 'É hoje!'
    return 'Viagem em andamento'
  }, [tripStartDate])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    )
  }

  if (!trip) {
    return <Onboarding session={session} onTripReady={loadTrip} />
  }

  const activeDest = destinations.find((d) => d.id === activeDestId)

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header comum às 3 telas */}
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Cartão Postal</p>
          <button
            onClick={() => supabase.auth.signOut()}
            aria-label="Sair"
            className="rounded-full p-2 text-muted-foreground hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {/* Navegação entre as telas — "Início" fica compacto (só o ícone),
            as outras 3 dividem o espaço restante igualmente. */}
        <div className="mx-auto mt-2 flex max-w-2xl gap-1 rounded-lg border border-border bg-background p-1">
          <button
            onClick={() => setView('home')}
            aria-label="Início"
            title="Início"
            className={`flex shrink-0 items-center justify-center rounded-md px-3 py-1.5 transition-colors ${
              view === 'home' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            }`}
          >
            <Home className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="grid flex-1 grid-cols-3 gap-1">
            {[
              { key: 'roteiro', label: 'Roteiro', icon: MapPin },
              { key: 'gastos', label: 'Gastos', icon: Wallet },
              { key: 'detalhes', label: 'Detalhes', icon: ClipboardList },
            ].map(({ key, label, icon: NavIcon }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                  view === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                }`}
              >
                <NavIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pt-5">
        {errorMsg && (
          <p className="rounded-lg border border-rosewood/40 bg-rosewood/10 px-3 py-2 font-mono text-xs text-rosewood">
            {errorMsg}
          </p>
        )}

        {/* ================= TELA 1 — INÍCIO ================= */}
        {view === 'home' && (
          <div className="flex flex-col items-center gap-8 px-2 pt-10 text-center">
            <div>
              <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Cartão Postal</p>
              <h1 className="font-display text-4xl font-semibold text-foreground sm:text-5xl">{trip.title}</h1>
              {trip.invite_code && (
                <button
                  onClick={handleCopyInviteCode}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground"
                  title="Copiar código de convite"
                >
                  {codeCopied ? (
                    <Check className="h-3 w-3 text-secondary-foreground" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden="true" />
                  )}
                  {trip.invite_code}
                </button>
              )}
            </div>

            <p className="font-display text-5xl font-semibold leading-tight text-primary sm:text-6xl">
              {countdownLabel}
            </p>

            <button
              onClick={() => {
                setActiveDestId('ALL')
                setStatusFilter('pendente')
                setCategoryFilter('all')
                setView('roteiro')
              }}
              className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground underline underline-offset-2"
            >
              {pendingCount} {pendingCount === 1 ? 'pendência' : 'pendências'}
            </button>

            {reminders.some((r) => !r.is_completed) && (
              <div className="flex w-full flex-col gap-1.5 text-left">
                <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Lembretes</h2>
                {reminders
                  .filter((r) => !r.is_completed)
                  .map((r) => (
                    <button
                      key={r.id}
                      onClick={() => handleToggleReminder(r)}
                      className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left"
                    >
                      <span
                        className="h-3.5 w-3.5 shrink-0 rounded-sm border border-primary/50"
                        aria-hidden="true"
                      />
                      <span className="font-mono text-xs text-foreground">{r.task_text}</span>
                    </button>
                  ))}
              </div>
            )}

            {urgentAlerts.length > 0 && (
              <div className="flex w-full flex-col gap-2 text-left">
                <h2 className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-rosewood">
                  <AlertTriangle className="h-3.5 w-3.5" /> Cancelamento próximo
                </h2>
                {urgentAlerts.map((row, i) => {
                  const days = row.days_remaining ?? daysUntil(row.cancellation_deadline)
                  return (
                    <div
                      key={row.accommodation_id ?? i}
                      className="flex items-center justify-between rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5"
                    >
                      <div>
                        <p className="font-medium text-foreground">{row.hotel_name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{row.city_name}</p>
                      </div>
                      <span className="font-mono text-xs font-semibold text-accent">
                        {days <= 0 ? 'vence hoje' : `${days}d restantes`}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ================= TELA 2 — ROTEIRO ================= */}
        {view === 'roteiro' && (
          <section aria-labelledby="roteiro-heading">
            <div className="mb-2 flex items-center justify-between">
              <h2 id="roteiro-heading" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> Roteiro
              </h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setOpenSheet('destination')}
                  className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground underline underline-offset-2"
                >
                  + Cidade
                </button>
                {activeDestId === 'ALL' && allTimelineDates.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleExpandAll}
                    className="font-mono text-[10px] uppercase tracking-wide text-primary underline underline-offset-2"
                  >
                    {allDaysExpanded ? 'Recolher tudo' : 'Expandir tudo'}
                  </button>
                )}
              </div>
            </div>

            {/* 3 filtros lado a lado: Cidade / Status / Tipo */}
            <div className="grid grid-cols-3 gap-2">
              <select
                value={activeDestId}
                onChange={(e) => setActiveDestId(e.target.value)}
                className="rounded-lg border border-input bg-card px-2 py-2 font-mono text-[11px] text-foreground"
              >
                <option value="ALL">Visão geral</option>
                {destinations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.city_name}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-input bg-card px-2 py-2 font-mono text-[11px] text-foreground"
              >
                <option value="all">Todos os status</option>
                {STATUS_ORDER.map((s) => (
                  <option
                    key={s}
                    value={s}
                    style={{ backgroundColor: STATUS_OPTION_COLORS[s].bg, color: STATUS_OPTION_COLORS[s].fg }}
                  >
                    {STATUS_CONFIG[s].label}
                  </option>
                ))}
              </select>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-lg border border-input bg-card px-2 py-2 font-mono text-[11px] text-foreground"
              >
                <option value="all">Todos os tipos</option>
                <option value="activity">Passeio</option>
                <option value="transport">Transporte</option>
                <option value="accommodation">Hospedagem</option>
              </select>
            </div>

            {/* Timeline cronológica (hospedagem + passeios + transporte) */}
            <div className="mt-4 flex flex-col gap-4">
              {timelineByDay.length === 0 && (
                <p className="rounded-xl border border-dashed border-border p-4 text-center font-mono text-xs text-muted-foreground">
                  Nada planejado para {activeDestId === 'ALL' ? 'a viagem' : activeDest?.city_name ?? 'este destino'}{' '}
                  ainda.
                </p>
              )}
              {timelineByDay.map(({ date, items }) => {
                const isAccordion = activeDestId === 'ALL'
                const isExpanded = !isAccordion || expandedDays.has(date)
                return (
                  <div key={date}>
                    <button
                      type="button"
                      onClick={() => isAccordion && toggleDay(date)}
                      className={`mb-1.5 flex w-full items-center justify-between font-mono text-[11px] uppercase tracking-wide text-muted-foreground ${
                        isAccordion ? 'cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <span>
                        {date === 'Sem data' ? date : formatDate(date)} · {items.length}{' '}
                        {items.length === 1 ? 'item' : 'itens'}
                      </span>
                      {isAccordion &&
                        (isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        ))}
                    </button>

                    {isExpanded && (
                      <div className="flex flex-col gap-2">
                        {items.map((item, idx) => {
                          const isAccommodation = item.kind === 'accommodation'
                          return (
                            <div
                              key={`${item.kind}-${item.data.id ?? idx}`}
                              className={`flex items-start justify-between gap-2 rounded-xl border border-border bg-card ${
                                isAccommodation ? 'p-2' : 'p-3'
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <div className="flex flex-col items-center gap-1">
                                  {item.kind === 'activity' && (
                                    <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                  )}
                                  {item.kind === 'transport' && (
                                    <Plane className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                  )}
                                  {isAccommodation && (
                                    <Hotel className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                                  )}
                                  {item.kind === 'activity' && (
                                    <a
                                      href={buildMapsSearchUrl(
                                        `${item.data.activity_name} ${
                                          activeDestId === 'ALL'
                                            ? destById[item.data.destination_id] ?? ''
                                            : activeDest?.city_name ?? ''
                                        }`
                                      )}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      title="Como chegar"
                                      aria-label={`Como chegar: ${item.data.activity_name}`}
                                      className="flex flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-primary transition-colors hover:bg-primary/10 active:bg-primary/15"
                                    >
                                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                                      <span className="font-mono text-[8px] uppercase leading-none tracking-wide">
                                        Mapa
                                      </span>
                                    </a>
                                  )}
                                  {item.kind === 'transport' && (
                                    <a
                                      href={buildMapsSearchUrl(
                                        item.data.origin_station || item.data.origin_city
                                      )}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      title="Como chegar (local de partida)"
                                      aria-label={`Como chegar ao local de partida: ${
                                        item.data.origin_station || item.data.origin_city
                                      }`}
                                      className="flex flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-primary transition-colors hover:bg-primary/10 active:bg-primary/15"
                                    >
                                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                                      <span className="font-mono text-[8px] uppercase leading-none tracking-wide">
                                        Mapa
                                      </span>
                                    </a>
                                  )}
                                  {isAccommodation && (
                                    <a
                                      href={buildMapsSearchUrl(
                                        `${item.data.hotel_name} ${
                                          activeDestId === 'ALL'
                                            ? destById[item.data.destination_id] ?? ''
                                            : activeDest?.city_name ?? ''
                                        }`
                                      )}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      title="Como chegar"
                                      aria-label={`Como chegar: ${item.data.hotel_name}`}
                                      className="flex flex-col items-center gap-0.5 rounded-lg px-1 py-0.5 text-primary transition-colors hover:bg-primary/10 active:bg-primary/15"
                                    >
                                      <MapPin className="h-3 w-3" aria-hidden="true" />
                                    </a>
                                  )}
                                </div>
                                <div>
                                  <p className={`font-medium text-foreground ${isAccommodation ? 'text-sm' : ''}`}>
                                    {item.kind === 'activity' && item.data.activity_name}
                                    {item.kind === 'transport' &&
                                      `${item.data.origin_city} → ${item.data.destination_city}`}
                                    {isAccommodation && item.data.hotel_name}
                                  </p>
                                  <p className="font-mono text-[11px] text-muted-foreground">
                                    {activeDestId === 'ALL' &&
                                      (item.kind === 'activity' || isAccommodation) &&
                                      destById[item.data.destination_id]
                                      ? `${destById[item.data.destination_id]} · `
                                      : ''}
                                    {isAccommodation
                                      ? `${formatDate(item.data.check_in)} → ${formatDate(item.data.check_out)}`
                                      : item.time ?? '—'}
                                    {item.kind === 'activity' && item.data.shift ? ` · ${item.data.shift}` : ''}
                                    {item.data.total_cost_eur != null &&
                                      ` · ${formatEUR(perPersonCost(item.data))}/pessoa`}
                                  </p>
                                  {item.kind === 'transport' &&
                                    (item.data.origin_station || item.data.destination_station) && (
                                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                        {item.data.origin_station || '—'} → {item.data.destination_station || '—'}
                                      </p>
                                    )}
                                  {item.kind === 'activity' && item.data.booking_rule && (
                                    <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                                      <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                                      {item.data.booking_rule}
                                    </p>
                                  )}
                                  {item.kind === 'activity' && item.data.ticket_url && (
                                    <a
                                      href={item.data.ticket_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-primary underline underline-offset-2"
                                    >
                                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                      Abrir ingresso
                                    </a>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <StatusBadge
                                  status={item.data.status}
                                  onChange={(newStatus) =>
                                    handleStatusChange(
                                      item.kind === 'activity'
                                        ? 'itinerary_activities'
                                        : item.kind === 'transport'
                                        ? 'transport'
                                        : 'accommodations',
                                      item.data.id,
                                      newStatus
                                    )
                                  }
                                />
                                <button
                                  onClick={() => setEditingItem({ kind: item.kind, data: item.data })}
                                  aria-label="Editar"
                                  className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ================= TELA 3 — GASTOS ================= */}
        {view === 'gastos' && (
          <div className="flex flex-col gap-6">
            <section aria-labelledby="saldo-heading">
              <h2 id="saldo-heading" className="mb-2 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" /> Saldo do grupo
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {balances.length === 0 && (
                  <p className="col-span-2 rounded-xl border border-dashed border-border p-4 text-center font-mono text-xs text-muted-foreground">
                    Nenhum viajante cadastrado ainda.
                  </p>
                )}
                {balances.map((b) => {
                  const isPositive = b.balance >= 0
                  return (
                    <div key={b.name} className="rounded-xl border border-border bg-card p-3">
                      <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{b.name}</p>
                      <p className="font-display text-xl font-semibold text-foreground">{formatEUR(b.totalPaid)}</p>
                      <p className={`font-mono text-[11px] ${isPositive ? 'text-secondary-foreground' : 'text-accent'}`}>
                        {isPositive ? 'a receber ' : 'a pagar '}
                        {formatEUR(Math.abs(b.balance))}
                      </p>
                    </div>
                  )
                })}
              </div>
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                "Total pago" soma tudo que a pessoa desembolsou. "A receber/a pagar" considera só os gastos 50/50.
              </p>
            </section>

            <section aria-labelledby="total-heading">
              <h2 id="total-heading" className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Total da viagem
              </h2>
              <p className="font-display text-4xl font-semibold text-foreground">{formatEUR(grandTotal)}</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                Soma dos gastos já lançados no extrato abaixo.
              </p>
            </section>

            <section aria-labelledby="estimativa-heading">
              <h2
                id="estimativa-heading"
                className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground"
              >
                Estimativa do roteiro
              </h2>
              <p className="font-display text-3xl font-semibold text-foreground">
                {formatEUR(roteiroEstimateTotal)}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                Soma dos custos de passeios, transportes e hospedagens cadastrados, por status — independente de já
                ter virado gasto lançado.
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                <label className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <input type="checkbox" checked readOnly className="accent-primary" />
                  Confirmado (sempre incluído)
                </label>
                <label className="flex items-center gap-2 font-mono text-[11px] text-foreground">
                  <input
                    type="checkbox"
                    checked={includePendenteInEstimate}
                    onChange={(e) => setIncludePendenteInEstimate(e.target.checked)}
                    className="accent-primary"
                  />
                  Somar pendente
                </label>
                <label className="flex items-center gap-2 font-mono text-[11px] text-foreground">
                  <input
                    type="checkbox"
                    checked={includeAtrasadoInEstimate}
                    onChange={(e) => setIncludeAtrasadoInEstimate(e.target.checked)}
                    className="accent-primary"
                  />
                  Somar atrasado
                </label>
              </div>
            </section>

            <section aria-labelledby="categoria-heading">
              <h2 id="categoria-heading" className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Por categoria
              </h2>
              {categoryTotals.length === 0 && (
                <p className="rounded-xl border border-dashed border-border p-4 text-center font-mono text-xs text-muted-foreground">
                  Nenhum gasto lançado ainda.
                </p>
              )}
              <div className="flex flex-col gap-2.5">
                {categoryTotals.map(([cat, amount]) => (
                  <div key={cat} title={formatEUR(amount)}>
                    <div className="mb-1 flex items-center justify-between font-mono text-[11px] text-foreground">
                      <span>{cat}</span>
                      <span className="text-muted-foreground">{formatEUR(amount)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-primary transition-all"
                        style={{ width: `${(amount / maxCategoryAmount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section aria-labelledby="lancamentos-heading">
              <h2 id="lancamentos-heading" className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Lançamentos
              </h2>
              {expenses.length === 0 && (
                <p className="rounded-xl border border-dashed border-border p-4 text-center font-mono text-xs text-muted-foreground">
                  Nenhum gasto lançado ainda.
                </p>
              )}
              <div className="flex flex-col gap-2">
                {expenses.map((e) => {
                  const splitLabel = e.split_type === 'igual' ? '50/50' : 'Individual'
                  return (
                    <div key={e.id} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-foreground">{e.description}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {e.category ?? 'Sem categoria'} · {formatDate(e.transaction_date)} · {e.paid_by}
                          </p>
                        </div>
                        <p className="font-mono text-sm font-semibold text-foreground">{formatEUR(e.total_cost_eur)}</p>
                      </div>
                      <span className="mt-1.5 inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {splitLabel}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        )}

        {/* ================= TELA 4 — DETALHES ================= */}
        {view === 'detalhes' && (
          <div className="flex flex-col gap-6">
            <section aria-labelledby="lembretes-heading">
              <h2
                id="lembretes-heading"
                className="mb-2 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground"
              >
                <ClipboardList className="h-3.5 w-3.5" /> Lembretes
              </h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newReminderText}
                  onChange={(e) => setNewReminderText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddReminder()
                  }}
                  placeholder="Ex: Mudar o cartão no Booking"
                  className="flex-1 rounded-lg border border-input bg-card px-3 py-2 font-mono text-sm text-foreground outline-none ring-primary/40 focus:ring-2"
                />
                <button
                  onClick={handleAddReminder}
                  aria-label="Adicionar lembrete"
                  className="flex shrink-0 items-center justify-center rounded-lg bg-primary px-3 text-primary-foreground"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="mt-3 flex flex-col gap-1.5">
                {reminders.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border p-4 text-center font-mono text-xs text-muted-foreground">
                    Nenhum lembrete ainda.
                  </p>
                )}
                {reminders.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      checked={r.is_completed}
                      onChange={() => handleToggleReminder(r)}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    <span
                      className={`flex-1 font-mono text-sm ${
                        r.is_completed ? 'text-muted-foreground line-through' : 'text-foreground'
                      }`}
                    >
                      {r.task_text}
                    </span>
                    <button
                      onClick={() => handleDeleteReminder(r.id)}
                      aria-label="Excluir lembrete"
                      className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section aria-labelledby="notas-heading">
              <h2
                id="notas-heading"
                className="mb-2 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground"
              >
                <MapPin className="h-3.5 w-3.5" /> Anotações por cidade
              </h2>
              <div className="flex flex-col gap-2">
                {destinations.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border p-4 text-center font-mono text-xs text-muted-foreground">
                    Cadastre uma cidade no Roteiro pra começar a anotar.
                  </p>
                )}
                {destinations.map((d) => (
                  <CityNotesItem
                    key={d.id}
                    cityName={d.city_name}
                    notes={cityNoteByDestId[d.id]?.notes_content}
                    isOpen={expandedCityNotes.has(d.id)}
                    onToggle={() => toggleCityNotes(d.id)}
                    onSave={(text) => handleSaveCityNotes(d.id, text)}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Ações rápidas (mobile-first, fixas no rodapé). Passeio/Transporte/
          Hospedagem só aparecem na tela Roteiro; Gasto aparece nas 3 telas,
          mas fica reduzido (só o ícone "+") quando está na tela Roteiro, já
          que ali ele divide espaço com os outros três botões. */}
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-2">
          {view === 'roteiro' && (
            <>
              <button
                onClick={() => setOpenSheet('activity')}
                disabled={destinations.length === 0}
                title={destinations.length === 0 ? 'Cadastre uma cidade primeiro' : undefined}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-xs uppercase tracking-wide text-foreground disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> Passeio
              </button>
              <button
                onClick={() => setOpenSheet('transport')}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-xs uppercase tracking-wide text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> Transporte
              </button>
              <button
                onClick={() => setOpenSheet('accommodation')}
                disabled={destinations.length === 0}
                title={destinations.length === 0 ? 'Cadastre uma cidade primeiro' : undefined}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-xs uppercase tracking-wide text-foreground disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> Hospedagem
              </button>
              <button
                onClick={() => setOpenSheet('expense')}
                aria-label="Novo gasto"
                title="Novo gasto"
                className="flex shrink-0 items-center justify-center rounded-lg bg-primary px-3 py-2.5 text-primary-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {view !== 'roteiro' && (
            <button
              onClick={() => setOpenSheet('expense')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 font-mono text-xs uppercase tracking-wide text-primary-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> Gasto
            </button>
          )}
        </div>
      </div>

      {/* Sheets de criação */}
      {openSheet === 'destination' && (
        <QuickAddSheet
          title="Nova cidade"
          icon={MapPin}
          onClose={() => setOpenSheet(null)}
          onSubmit={handleAddDestination}
          fields={[
            { name: 'city_name', label: 'Nome da cidade', required: true },
            {
              name: 'is_bate_volta',
              label: 'É bate-volta?',
              type: 'select',
              options: [
                { value: 'nao', label: 'Não' },
                { value: 'sim', label: 'Sim' },
              ],
              default: 'nao',
            },
          ]}
        />
      )}

      {openSheet === 'activity' && (
        <QuickAddSheet
          title={activeDestId === 'ALL' ? 'Novo passeio' : `Novo passeio em ${activeDest?.city_name ?? ''}`}
          icon={Ticket}
          onClose={() => setOpenSheet(null)}
          onSubmit={handleAddActivity}
          fields={[
            ...(activeDestId === 'ALL'
              ? [
                  {
                    name: 'destination_id',
                    label: 'Cidade',
                    type: 'select',
                    options: destinations.map((d) => ({ value: d.id, label: d.city_name })),
                    required: true,
                  },
                ]
              : []),
            { name: 'activity_name', label: 'Nome do passeio', required: true },
            { name: 'assigned_date', label: 'Data', type: 'date' },
            { name: 'shift', label: 'Turno', type: 'select', options: ['Manhã', 'Tarde', 'Noite'] },
            { name: 'exact_time', label: 'Horário exato', type: 'time' },
            { name: 'total_cost_eur', label: 'Valor total (EUR)', type: 'number' },
            {
              name: 'responsavel',
              label: 'Responsável pelo Pagamento',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
              default: 'planejando',
            },
            { name: 'booking_rule', label: 'Regra de compra' },
            { name: 'ticket_url', label: 'Link do ingresso', type: 'url' },
            { name: 'notes', label: 'Notas', type: 'textarea' },
          ]}
        />
      )}

      {openSheet === 'transport' && (
        <QuickAddSheet
          title="Novo transporte"
          icon={Plane}
          onClose={() => setOpenSheet(null)}
          onSubmit={handleAddTransport}
          fields={[
            { name: 'origin_city', label: 'Cidade de origem', required: true, default: activeDest?.city_name ?? '' },
            { name: 'origin_station', label: 'Estação/aeroporto de saída (opcional)' },
            { name: 'destination_city', label: 'Cidade de destino', required: true },
            { name: 'destination_station', label: 'Estação/aeroporto de chegada (opcional)' },
            { name: 'departure_date', label: 'Data de partida', type: 'date' },
            { name: 'departure_time', label: 'Hora de partida', type: 'time' },
            { name: 'arrival_time', label: 'Hora de chegada', type: 'time' },
            { name: 'total_cost_eur', label: 'Valor total (EUR)', type: 'number' },
            {
              name: 'responsavel',
              label: 'Responsável pelo Pagamento',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
              default: 'planejando',
            },
            { name: 'comments', label: 'Comentários', type: 'textarea' },
          ]}
        />
      )}

      {openSheet === 'accommodation' && (
        <QuickAddSheet
          title={activeDestId === 'ALL' ? 'Nova hospedagem' : `Nova hospedagem em ${activeDest?.city_name ?? ''}`}
          icon={Hotel}
          onClose={() => setOpenSheet(null)}
          onSubmit={handleAddAccommodation}
          fields={[
            ...(activeDestId === 'ALL'
              ? [
                  {
                    name: 'destination_id',
                    label: 'Cidade',
                    type: 'select',
                    options: destinations.map((d) => ({ value: d.id, label: d.city_name })),
                    required: true,
                  },
                ]
              : []),
            { name: 'hotel_name', label: 'Nome do hotel', required: true },
            { name: 'check_in', label: 'Check-in', type: 'date' },
            { name: 'check_out', label: 'Check-out', type: 'date' },
            { name: 'total_cost_eur', label: 'Valor total (EUR)', type: 'number' },
            {
              name: 'responsavel',
              label: 'Responsável pelo Pagamento',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
              default: 'planejando',
            },
            { name: 'cancellation_deadline', label: 'Prazo de cancelamento', type: 'date' },
            { name: 'booking_link', label: 'Link da reserva', type: 'url' },
            { name: 'comments', label: 'Comentários', type: 'textarea' },
          ]}
        />
      )}

      {/* Sheets de edição (abrem ao clicar no lápis de um item da timeline) */}
      {editingItem?.kind === 'activity' && (
        <QuickAddSheet
          title="Editar passeio"
          icon={Ticket}
          onClose={() => setEditingItem(null)}
          initialValues={{
            ...editingItem.data,
            responsavel: editingItem.data.split_type === 'igual' ? editingItem.data.paid_by : 'individual',
          }}
          onSubmit={(form) => handleUpdateActivity(editingItem.data, form)}
          onDelete={() => handleDeleteActivity(editingItem.data)}
          fields={[
            { name: 'activity_name', label: 'Nome do passeio', required: true },
            { name: 'assigned_date', label: 'Data', type: 'date' },
            { name: 'shift', label: 'Turno', type: 'select', options: ['Manhã', 'Tarde', 'Noite'] },
            { name: 'exact_time', label: 'Horário exato', type: 'time' },
            { name: 'total_cost_eur', label: 'Valor total (EUR)', type: 'number' },
            {
              name: 'responsavel',
              label: 'Responsável pelo Pagamento',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
            },
            { name: 'booking_rule', label: 'Regra de compra' },
            { name: 'ticket_url', label: 'Link do ingresso', type: 'url' },
            { name: 'notes', label: 'Notas', type: 'textarea' },
          ]}
        />
      )}

      {editingItem?.kind === 'transport' && (
        <QuickAddSheet
          title="Editar transporte"
          icon={Plane}
          onClose={() => setEditingItem(null)}
          initialValues={{
            ...editingItem.data,
            responsavel: editingItem.data.split_type === 'igual' ? editingItem.data.paid_by : 'individual',
          }}
          onSubmit={(form) => handleUpdateTransport(editingItem.data, form)}
          onDelete={() => handleDeleteTransport(editingItem.data)}
          fields={[
            { name: 'origin_city', label: 'Cidade de origem', required: true },
            { name: 'origin_station', label: 'Estação/aeroporto de saída (opcional)' },
            { name: 'destination_city', label: 'Cidade de destino', required: true },
            { name: 'destination_station', label: 'Estação/aeroporto de chegada (opcional)' },
            { name: 'departure_date', label: 'Data de partida', type: 'date' },
            { name: 'departure_time', label: 'Hora de partida', type: 'time' },
            { name: 'arrival_time', label: 'Hora de chegada', type: 'time' },
            { name: 'total_cost_eur', label: 'Valor total (EUR)', type: 'number' },
            {
              name: 'responsavel',
              label: 'Responsável pelo Pagamento',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
            },
            { name: 'comments', label: 'Comentários', type: 'textarea' },
          ]}
        />
      )}

      {editingItem?.kind === 'accommodation' && (
        <QuickAddSheet
          title="Editar hospedagem"
          icon={Hotel}
          onClose={() => setEditingItem(null)}
          initialValues={{
            ...editingItem.data,
            responsavel: editingItem.data.split_type === 'igual' ? editingItem.data.paid_by : 'individual',
          }}
          onSubmit={(form) => handleUpdateAccommodation(editingItem.data, form)}
          onDelete={() => handleDeleteAccommodation(editingItem.data)}
          fields={[
            { name: 'hotel_name', label: 'Nome do hotel', required: true },
            { name: 'check_in', label: 'Check-in', type: 'date' },
            { name: 'check_out', label: 'Check-out', type: 'date' },
            { name: 'total_cost_eur', label: 'Valor total (EUR)', type: 'number' },
            {
              name: 'responsavel',
              label: 'Responsável pelo Pagamento',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
            },
            { name: 'cancellation_deadline', label: 'Prazo de cancelamento', type: 'date' },
            { name: 'booking_link', label: 'Link da reserva', type: 'url' },
            { name: 'comments', label: 'Comentários', type: 'textarea' },
          ]}
        />
      )}

      {openSheet === 'expense' && (
        <QuickAddSheet
          title="Novo gasto"
          icon={Wallet}
          onClose={() => setOpenSheet(null)}
          onSubmit={handleAddExpense}
          fields={[
            { name: 'description', label: 'Descrição', required: true },
            { name: 'transaction_date', label: 'Data', type: 'date' },
            { name: 'category', label: 'Categoria', type: 'select', options: EXPENSE_CATEGORIES },
            { name: 'total_cost_eur', label: 'Valor total (EUR)', type: 'number', required: true },
            {
              name: 'responsavel',
              label: 'Responsável pelo Pagamento',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
            },
          ]}
        />
      )}
    </div>
  )
}

// -----------------------------------------------------------------------
// App raiz — controla o gate de autenticação
// -----------------------------------------------------------------------

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = carregando

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    )
  }

  return session ? <Dashboard session={session} /> : <LoginScreen />
}
