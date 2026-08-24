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

  // Carrega a viagem do usuário logado + destinos + viajantes + alertas
  useEffect(() => {
    let ignore = false
    async function loadTrip() {
      setLoading(true)
      setErrorMsg(null)

      const { data: trips, error: tripError } = await supabase
        .from('trips')
        .select('*')
        .eq('user_id', session.user.id)
        .limit(1)

      if (tripError) {
        if (!ignore) setErrorMsg(tripError.message)
        setLoading(false)
        return
      }

      const currentTrip = trips?.[0] ?? null
      if (!currentTrip) {
        if (!ignore) {
          setTrip(null)
          setLoading(false)
        }
        return
      }
      if (ignore) return
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

      if (!ignore) {
        if (destRes.data) setDestinations(destRes.data)
        setTravelers(travelersRes.data ?? [])
        setAlertRows(alertRes.data ?? [])
        setLoading(false)
      }
    }
    loadTrip()
    return () => {
      ignore = true
    }
  }, [session.user.id])

  // Viajante (linha de trip_travelers) vinculado à conta atualmente logada,
  // via trip_travelers.user_id. Usado como responsável padrão quando
  // "Pago por" é deixado em branco.
  const currentTraveler = useMemo(
    () => travelers.find((t) => t.user_id === session.user.id) ?? null,
    [travelers, session.user.id]
  )
  const currentTravelerName = currentTraveler?.name ?? session.user.email

  // Opções do "Tipo de divisão" — só 50/50 (compartilhado, entra no saldo) ou
  // Individual (privado, não gera cobrança e some do extrato de quem não pagou).
  const splitTypeOptions = useMemo(
    () => [
      { value: 'igual', label: '50/50' },
      { value: 'individual', label: 'Individual' },
    ],
    []
  )

  // Data de início da viagem, calculada como a menor data entre todas as
  // hospedagens/passeios/transportes já cadastrados em qualquer cidade —
  // a tabela trips não tem campo de data próprio.
  useEffect(() => {
    if (!trip || destinations.length === 0) {
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
  useEffect(() => {
    if (!activeDestId || !trip) return
    loadItineraryData(activeDestId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDestId, trip])

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

  // Se a pessoa preencheu custo por pessoa num passeio/transporte, lança
  // automaticamente um gasto correspondente em expenses_ledger. "50/50"
  // multiplica pelo nº de viajantes (é uma despesa compartilhada); os outros
  // 3 tipos ficam só com o valor informado (não são divididos com ninguém).
  async function maybeLogExpense({ paidBy, splitType, costPerPerson, date, description, category }) {
    const perPerson = Number(costPerPerson)
    if (!perPerson) return

    const finalPaidBy = paidBy?.trim() || currentTravelerName
    const finalSplitType = splitType || 'individual'
    const totalCost = finalSplitType === 'igual' ? perPerson * Math.max(travelers.length, 1) : perPerson

    const { error } = await supabase.from('expenses_ledger').insert({
      trip_id: trip.id,
      transaction_date: date || null,
      description,
      category,
      total_cost_eur: totalCost,
      paid_by: finalPaidBy,
      split_type: finalSplitType,
      created_by: session.user.id,
    })
    if (error) throw error
    await refreshFinancials()
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

  async function handleAddActivity(form) {
    // Na Visão geral não existe uma cidade implícita, então o formulário
    // pede pra escolher (campo `destination_id`). Numa aba de cidade
    // específica, usa a cidade que já está selecionada.
    const destinationId = activeDestId === 'ALL' ? form.destination_id : activeDestId
    const { error } = await supabase.from('itinerary_activities').insert({
      destination_id: destinationId,
      activity_name: form.activity_name,
      assigned_date: form.assigned_date || null,
      shift: form.shift || null,
      exact_time: form.exact_time || null,
      cost_per_person_eur: form.cost_per_person_eur ? Number(form.cost_per_person_eur) : null,
      status: form.status || 'planejando',
      booking_rule: form.booking_rule || null,
      ticket_url: form.ticket_url || null,
      notes: form.notes || null,
    })
    if (error) throw error

    await maybeLogExpense({
      paidBy: form.paid_by,
      splitType: form.split_type,
      costPerPerson: form.cost_per_person_eur,
      date: form.assigned_date,
      description: `Passeio: ${form.activity_name}`,
      category: 'Passeio',
    })

    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleAddTransport(form) {
    const { error } = await supabase.from('transport').insert({
      trip_id: trip.id,
      origin_city: form.origin_city,
      origin_station: form.origin_station || null,
      destination_city: form.destination_city,
      destination_station: form.destination_station || null,
      departure_date: form.departure_date || null,
      departure_time: form.departure_time || null,
      arrival_time: form.arrival_time || null,
      cost_per_person_eur: form.cost_per_person_eur ? Number(form.cost_per_person_eur) : null,
      status: form.status || 'planejando',
      comments: form.comments || null,
    })
    if (error) throw error

    await maybeLogExpense({
      paidBy: form.paid_by,
      splitType: form.split_type,
      costPerPerson: form.cost_per_person_eur,
      date: form.departure_date,
      description: `Transporte: ${form.origin_city} → ${form.destination_city}`,
      category: 'Transporte',
    })

    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleAddExpense(form) {
    const finalPaidBy = form.paid_by?.trim() || currentTravelerName
    const finalSplitType = form.split_type || 'individual'

    const { error } = await supabase.from('expenses_ledger').insert({
      trip_id: trip.id,
      transaction_date: form.transaction_date || null,
      description: form.description,
      category: form.category || null,
      total_cost_eur: form.total_cost_eur ? Number(form.total_cost_eur) : 0,
      paid_by: finalPaidBy,
      split_type: finalSplitType,
      created_by: session.user.id,
    })
    if (error) throw error
    await refreshFinancials()
  }

  // --- Handlers de edição / exclusão --------------------------------------
  // Os campos "Pago por" / "Tipo de divisão" começam em branco toda vez que
  // a edição abre (não vêm de nenhuma coluna salva). Se a pessoa deixar em
  // branco, editar só atualiza os dados normais, sem mexer no financeiro —
  // só lança um gasto novo se ela preencher "Pago por" explicitamente
  // *nessa* edição, evitando duplicar o gasto criado na hora do cadastro.

  async function handleUpdateActivity(id, form) {
    const { error } = await supabase
      .from('itinerary_activities')
      .update({
        activity_name: form.activity_name,
        assigned_date: form.assigned_date || null,
        shift: form.shift || null,
        exact_time: form.exact_time || null,
        cost_per_person_eur: form.cost_per_person_eur ? Number(form.cost_per_person_eur) : null,
        status: form.status || 'planejando',
        booking_rule: form.booking_rule || null,
        ticket_url: form.ticket_url || null,
        notes: form.notes || null,
      })
      .eq('id', id)
    if (error) throw error

    if (form.paid_by?.trim()) {
      await maybeLogExpense({
        paidBy: form.paid_by,
        splitType: form.split_type,
        costPerPerson: form.cost_per_person_eur,
        date: form.assigned_date,
        description: `Passeio: ${form.activity_name}`,
        category: 'Passeio',
      })
    }

    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleDeleteActivity(id) {
    const { error } = await supabase.from('itinerary_activities').delete().eq('id', id)
    if (error) throw error
    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleUpdateTransport(id, form) {
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
        cost_per_person_eur: form.cost_per_person_eur ? Number(form.cost_per_person_eur) : null,
        status: form.status || 'planejando',
        comments: form.comments || null,
      })
      .eq('id', id)
    if (error) throw error

    if (form.paid_by?.trim()) {
      await maybeLogExpense({
        paidBy: form.paid_by,
        splitType: form.split_type,
        costPerPerson: form.cost_per_person_eur,
        date: form.departure_date,
        description: `Transporte: ${form.origin_city} → ${form.destination_city}`,
        category: 'Transporte',
      })
    }

    await loadItineraryData(activeDestId)
    await loadPendingCount()
  }

  async function handleDeleteTransport(id) {
    const { error } = await supabase.from('transport').delete().eq('id', id)
    if (error) throw error
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
    const travelerCount = Math.max(travelers.length, 1)
    let total = 0
    for (const a of overviewActivities) {
      if (estimateStatuses.has(a.status) && a.cost_per_person_eur != null) {
        total += Number(a.cost_per_person_eur) * travelerCount
      }
    }
    for (const t of overviewTransport) {
      if (estimateStatuses.has(t.status) && t.cost_per_person_eur != null) {
        total += Number(t.cost_per_person_eur) * travelerCount
      }
    }
    for (const acc of overviewAccommodations) {
      if (estimateStatuses.has(acc.status) && acc.total_cost_eur != null) {
        total += Number(acc.total_cost_eur)
      }
    }
    return total
  }, [overviewActivities, overviewTransport, overviewAccommodations, estimateStatuses, travelers])

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
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <p className="font-mono text-sm text-muted-foreground">
          Nenhuma viagem encontrada para este usuário.
        </p>
        <button
          onClick={() => supabase.auth.signOut()}
          className="font-mono text-xs uppercase tracking-wide text-primary underline"
        >
          Sair
        </button>
      </div>
    )
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

        {/* Navegação entre as 3 telas */}
        <div className="mx-auto mt-2 grid max-w-2xl grid-cols-3 gap-1 rounded-lg border border-border bg-background p-1">
          {[
            { key: 'home', label: 'Início', icon: Home },
            { key: 'roteiro', label: 'Roteiro', icon: MapPin },
            { key: 'gastos', label: 'Gastos', icon: Wallet },
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
                                    {!isAccommodation &&
                                      item.data.cost_per_person_eur != null &&
                                      ` · ${formatEUR(item.data.cost_per_person_eur)}/pessoa`}
                                    {isAccommodation &&
                                      item.data.total_cost_eur != null &&
                                      ` · ${formatEUR(item.data.total_cost_eur)}`}
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
                                {!isAccommodation && (
                                  <button
                                    onClick={() => setEditingItem({ kind: item.kind, data: item.data })}
                                    aria-label="Editar"
                                    className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                )}
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
                  const splitLabel = splitTypeOptions.find((opt) => opt.value === e.split_type)?.label ?? e.split_type
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
      </main>

      {/* Ações rápidas (mobile-first, fixas no rodapé). Passeio/Transporte só
          aparecem na tela Roteiro; Gasto aparece nas 3 telas. */}
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
            </>
          )}
          <button
            onClick={() => setOpenSheet('expense')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 font-mono text-xs uppercase tracking-wide text-primary-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> Gasto
          </button>
        </div>
      </div>

      {/* Sheets de criação */}
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
            { name: 'cost_per_person_eur', label: 'Custo por pessoa (EUR)', type: 'number' },
            {
              name: 'paid_by',
              label: 'Pago por (opcional — se vazio, vira compra individual sua)',
              type: 'select',
              options: travelers.map((t) => t.name),
            },
            {
              name: 'split_type',
              label: 'Tipo de divisão',
              type: 'select',
              options: splitTypeOptions,
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
            { name: 'cost_per_person_eur', label: 'Custo por pessoa (EUR)', type: 'number' },
            {
              name: 'paid_by',
              label: 'Pago por (opcional — se vazio, vira compra individual sua)',
              type: 'select',
              options: travelers.map((t) => t.name),
            },
            {
              name: 'split_type',
              label: 'Tipo de divisão',
              type: 'select',
              options: splitTypeOptions,
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

      {/* Sheets de edição (abrem ao clicar no lápis de um item da timeline) */}
      {editingItem?.kind === 'activity' && (
        <QuickAddSheet
          title="Editar passeio"
          icon={Ticket}
          onClose={() => setEditingItem(null)}
          initialValues={editingItem.data}
          onSubmit={(form) => handleUpdateActivity(editingItem.data.id, form)}
          onDelete={() => handleDeleteActivity(editingItem.data.id)}
          fields={[
            { name: 'activity_name', label: 'Nome do passeio', required: true },
            { name: 'assigned_date', label: 'Data', type: 'date' },
            { name: 'shift', label: 'Turno', type: 'select', options: ['Manhã', 'Tarde', 'Noite'] },
            { name: 'exact_time', label: 'Horário exato', type: 'time' },
            { name: 'cost_per_person_eur', label: 'Custo por pessoa (EUR)', type: 'number' },
            {
              name: 'paid_by',
              label: 'Lançar gasto agora: pago por (opcional)',
              type: 'select',
              options: travelers.map((t) => t.name),
            },
            {
              name: 'split_type',
              label: 'Tipo de divisão do gasto',
              type: 'select',
              options: splitTypeOptions,
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
          initialValues={editingItem.data}
          onSubmit={(form) => handleUpdateTransport(editingItem.data.id, form)}
          onDelete={() => handleDeleteTransport(editingItem.data.id)}
          fields={[
            { name: 'origin_city', label: 'Cidade de origem', required: true },
            { name: 'origin_station', label: 'Estação/aeroporto de saída (opcional)' },
            { name: 'destination_city', label: 'Cidade de destino', required: true },
            { name: 'destination_station', label: 'Estação/aeroporto de chegada (opcional)' },
            { name: 'departure_date', label: 'Data de partida', type: 'date' },
            { name: 'departure_time', label: 'Hora de partida', type: 'time' },
            { name: 'arrival_time', label: 'Hora de chegada', type: 'time' },
            { name: 'cost_per_person_eur', label: 'Custo por pessoa (EUR)', type: 'number' },
            {
              name: 'paid_by',
              label: 'Lançar gasto agora: pago por (opcional)',
              type: 'select',
              options: travelers.map((t) => t.name),
            },
            {
              name: 'split_type',
              label: 'Tipo de divisão do gasto',
              type: 'select',
              options: splitTypeOptions,
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
              name: 'paid_by',
              label: 'Pago por (opcional — se vazio, vira compra individual sua)',
              type: 'select',
              options: travelers.map((t) => t.name),
            },
            {
              name: 'split_type',
              label: 'Tipo de divisão',
              type: 'select',
              options: splitTypeOptions,
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