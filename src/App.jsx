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
// Formulário genérico "Adicionar" — usado para atividade / transporte / gasto
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
                  {f.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
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
// Dashboard
// -----------------------------------------------------------------------

function Dashboard({ session }) {
  const [trip, setTrip] = useState(null)
  const [destinations, setDestinations] = useState([])
  const [travelers, setTravelers] = useState([]) // linhas de trip_travelers, para os dropdowns "Pago por"
  const [activeDestId, setActiveDestId] = useState(null) // id de um destino, ou 'ALL' para a visão geral
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'confirmado' | 'pendente' | 'atrasado' | 'planejando'
  const [accommodations, setAccommodations] = useState([])
  const [activities, setActivities] = useState([])
  const [transport, setTransport] = useState([])
  const [balanceRows, setBalanceRows] = useState([])
  const [alertRows, setAlertRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [openSheet, setOpenSheet] = useState(null) // 'activity' | 'transport' | 'expense' | null
  const [editingItem, setEditingItem] = useState(null) // { kind: 'activity' | 'transport', data: {...} } | null
  const [errorMsg, setErrorMsg] = useState(null)

  // Carrega a viagem do usuário logado + destinos + viajantes + views financeiras/alertas
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

      const [destRes, travelersRes, balanceRes, alertRes] = await Promise.all([
        supabase
          .from('destinations')
          .select('*')
          .eq('trip_id', currentTrip.id)
          .order('order_index', { ascending: true }),
        supabase.from('trip_travelers').select('*').eq('trip_id', currentTrip.id),
        supabase.from('view_trip_financial_balance').select('*').eq('trip_id', currentTrip.id),
        supabase.from('view_hotel_cancellation_alerts').select('*').eq('trip_id', currentTrip.id),
      ])

      if (!ignore) {
        if (destRes.data) {
          setDestinations(destRes.data)
          setActiveDestId((prev) => prev ?? destRes.data[0]?.id ?? null)
        }
        setTravelers(travelersRes.data ?? [])
        setBalanceRows(balanceRes.data ?? [])
        setAlertRows(alertRes.data ?? [])
        setLoading(false)
      }
    }
    loadTrip()
    return () => {
      ignore = true
    }
  }, [session.user.id])

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

  async function refreshBalanceAndAlerts() {
    if (!trip) return
    const [balanceRes, alertRes] = await Promise.all([
      supabase.from('view_trip_financial_balance').select('*').eq('trip_id', trip.id),
      supabase.from('view_hotel_cancellation_alerts').select('*').eq('trip_id', trip.id),
    ])
    setBalanceRows(balanceRes.data ?? [])
    setAlertRows(alertRes.data ?? [])
  }

  // Se a pessoa preencheu "Pago por" + custo por pessoa num passeio/transporte,
  // lança automaticamente um gasto correspondente em expenses_ledger, dividido
  // igualmente entre todos os viajantes cadastrados (mesma regra do saldo).
  async function maybeLogExpense({ paidBy, costPerPerson, date, description, category }) {
    const perPerson = Number(costPerPerson)
    if (!paidBy || !perPerson) return
    const totalCost = perPerson * Math.max(travelers.length, 1)
    const { error } = await supabase.from('expenses_ledger').insert({
      trip_id: trip.id,
      transaction_date: date || null,
      description,
      category,
      total_cost_eur: totalCost,
      paid_by: paidBy,
      split_type: 'igual',
    })
    if (error) throw error
    await refreshBalanceAndAlerts()
  }

  // Atualiza o status de uma linha (hospedagem, passeio ou transporte) ao
  // clicar no badge, e recarrega a lista pra refletir a mudança.
  async function handleStatusChange(table, id, newStatus) {
    const { error } = await supabase.from(table).update({ status: newStatus }).eq('id', id)
    if (error) {
      setErrorMsg(error.message)
      return
    }
    await loadItineraryData(activeDestId)
  }

  // --- Handlers de insert -------------------------------------------------

  async function handleAddActivity(form) {
    const { error } = await supabase.from('itinerary_activities').insert({
      destination_id: activeDestId,
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
      costPerPerson: form.cost_per_person_eur,
      date: form.assigned_date,
      description: `Passeio: ${form.activity_name}`,
      category: 'Passeio',
    })

    await loadItineraryData(activeDestId)
  }

  async function handleAddTransport(form) {
    const { error } = await supabase.from('transport').insert({
      trip_id: trip.id,
      origin_city: form.origin_city,
      destination_city: form.destination_city,
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
      costPerPerson: form.cost_per_person_eur,
      date: form.departure_date,
      description: `Transporte: ${form.origin_city} → ${form.destination_city}`,
      category: 'Transporte',
    })

    await loadItineraryData(activeDestId)
  }

  async function handleAddExpense(form) {
    const { error } = await supabase.from('expenses_ledger').insert({
      trip_id: trip.id,
      transaction_date: form.transaction_date || null,
      description: form.description,
      category: form.category || null,
      total_cost_eur: form.total_cost_eur ? Number(form.total_cost_eur) : 0,
      paid_by: form.paid_by,
      split_type: form.split_type || 'igual',
    })
    if (error) throw error
    await refreshBalanceAndAlerts()
  }

  // --- Handlers de edição / exclusão --------------------------------------
  // Não recriam gasto automático na edição (só o insert original faz isso),
  // pra evitar duplicar lançamentos no saldo a cada vez que algo é editado.

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
    await loadItineraryData(activeDestId)
  }

  async function handleDeleteActivity(id) {
    const { error } = await supabase.from('itinerary_activities').delete().eq('id', id)
    if (error) throw error
    await loadItineraryData(activeDestId)
  }

  async function handleUpdateTransport(id, form) {
    const { error } = await supabase
      .from('transport')
      .update({
        origin_city: form.origin_city,
        destination_city: form.destination_city,
        departure_date: form.departure_date || null,
        departure_time: form.departure_time || null,
        arrival_time: form.arrival_time || null,
        cost_per_person_eur: form.cost_per_person_eur ? Number(form.cost_per_person_eur) : null,
        status: form.status || 'planejando',
        comments: form.comments || null,
      })
      .eq('id', id)
    if (error) throw error
    await loadItineraryData(activeDestId)
  }

  async function handleDeleteTransport(id) {
    const { error } = await supabase.from('transport').delete().eq('id', id)
    if (error) throw error
    await loadItineraryData(activeDestId)
  }

  // Mapa id do destino -> nome da cidade, usado só na "Visão geral" pra
  // identificar de qual cidade cada item da timeline é.
  const destById = useMemo(
    () => Object.fromEntries(destinations.map((d) => [d.id, d.city_name])),
    [destinations]
  )

  const filteredAccommodations = useMemo(
    () => (statusFilter === 'all' ? accommodations : accommodations.filter((a) => a.status === statusFilter)),
    [accommodations, statusFilter]
  )
  const filteredActivities = useMemo(
    () => (statusFilter === 'all' ? activities : activities.filter((a) => a.status === statusFilter)),
    [activities, statusFilter]
  )
  const filteredTransport = useMemo(
    () => (statusFilter === 'all' ? transport : transport.filter((t) => t.status === statusFilter)),
    [transport, statusFilter]
  )

  // --- Timeline combinada (atividades + transporte) do destino ativo -----

  const timelineByDay = useMemo(() => {
    const groups = {}
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
  }, [filteredActivities, filteredTransport])

  const urgentAlerts = useMemo(
    () => alertRows.filter((row) => (row.days_remaining ?? daysUntil(row.cancellation_deadline)) <= 7),
    [alertRows]
  )

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
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Cartão Postal</p>
            <h1 className="font-display text-2xl font-semibold leading-tight text-foreground">{trip.title}</h1>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            aria-label="Sair"
            className="rounded-full p-2 text-muted-foreground hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pt-5">
        {errorMsg && (
          <p className="rounded-lg border border-rosewood/40 bg-rosewood/10 px-3 py-2 font-mono text-xs text-rosewood">
            {errorMsg}
          </p>
        )}

        {/* Saldo financeiro */}
        <section aria-labelledby="saldo-heading">
          <h2 id="saldo-heading" className="mb-2 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" /> Saldo do grupo
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {balanceRows.length === 0 && (
              <p className="col-span-2 rounded-xl border border-dashed border-border p-4 text-center font-mono text-xs text-muted-foreground">
                Nenhum gasto lançado ainda.
              </p>
            )}
            {balanceRows.map((row) => {
              const balance = Number(row.balance ?? 0)
              const isPositive = balance >= 0
              return (
                <div key={row.paid_by ?? row.person_name} className="rounded-xl border border-border bg-card p-3">
                  <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    {row.paid_by ?? row.person_name}
                  </p>
                  <p className="font-display text-xl font-semibold text-foreground">
                    {formatEUR(row.total_paid ?? row.total_paid_eur)}
                  </p>
                  <p className={`font-mono text-[11px] ${isPositive ? 'text-secondary-foreground' : 'text-accent'}`}>
                    {isPositive ? 'a receber ' : 'a pagar '}
                    {formatEUR(Math.abs(balance))}
                  </p>
                </div>
              )
            })}
          </div>
        </section>

        {/* Alertas de cancelamento */}
        {urgentAlerts.length > 0 && (
          <section aria-labelledby="alertas-heading">
            <h2 id="alertas-heading" className="mb-2 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-rosewood">
              <AlertTriangle className="h-3.5 w-3.5" /> Cancelamento próximo
            </h2>
            <div className="flex flex-col gap-2">
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
          </section>
        )}

        {/* Tabs de destino */}
        <section aria-labelledby="roteiro-heading">
          <h2 id="roteiro-heading" className="mb-2 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> Roteiro
          </h2>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button
              onClick={() => setActiveDestId('ALL')}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-wide transition-colors ${
                activeDestId === 'ALL'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground'
              }`}
            >
              Visão geral
            </button>
            {destinations.map((d) => (
              <button
                key={d.id}
                onClick={() => setActiveDestId(d.id)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-wide transition-colors ${
                  d.id === activeDestId
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground'
                }`}
              >
                {d.city_name}
                {d.is_bate_volta && ' •'}
              </button>
            ))}
          </div>

          {/* Filtro por status */}
          <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
            <button
              onClick={() => setStatusFilter('all')}
              className={`shrink-0 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                statusFilter === 'all'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground'
              }`}
            >
              Todos
            </button>
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`shrink-0 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                  statusFilter === s
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground'
                }`}
              >
                {STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>

          {/* Hospedagem do destino ativo (ou de todas, na Visão geral) */}
          {filteredAccommodations.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {filteredAccommodations.map((acc) => (
                <div key={acc.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">{acc.hotel_name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {activeDestId === 'ALL' && destById[acc.destination_id]
                          ? `${destById[acc.destination_id]} · `
                          : ''}
                        {formatDate(acc.check_in)} → {formatDate(acc.check_out)}
                      </p>
                    </div>
                    <StatusBadge
                      status={acc.status}
                      onChange={(newStatus) => handleStatusChange('accommodations', acc.id, newStatus)}
                    />
                  </div>
                  <p className="mt-1 font-mono text-xs text-foreground">{formatEUR(acc.total_cost_eur)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Timeline cronológica (atividades + transporte) */}
          <div className="mt-4 flex flex-col gap-4">
            {timelineByDay.length === 0 && (
              <p className="rounded-xl border border-dashed border-border p-4 text-center font-mono text-xs text-muted-foreground">
                Nada planejado para {activeDestId === 'ALL' ? 'a viagem' : activeDest?.city_name ?? 'este destino'}{' '}
                ainda.
              </p>
            )}
            {timelineByDay.map(({ date, items }) => (
              <div key={date}>
                <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                  {date === 'Sem data' ? date : formatDate(date)}
                </p>
                <div className="flex flex-col gap-2">
                  {items.map((item, idx) => (
                    <div
                      key={`${item.kind}-${item.data.id ?? idx}`}
                      className="flex items-start justify-between gap-2 rounded-xl border border-border bg-card p-3"
                    >
                      <div className="flex items-start gap-2">
                        {item.kind === 'activity' ? (
                          <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        ) : (
                          <Plane className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        )}
                        <div>
                          <p className="font-medium text-foreground">
                            {item.kind === 'activity'
                              ? item.data.activity_name
                              : `${item.data.origin_city} → ${item.data.destination_city}`}
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {activeDestId === 'ALL' && item.kind === 'activity' && destById[item.data.destination_id]
                              ? `${destById[item.data.destination_id]} · `
                              : ''}
                            {item.time ?? '—'}
                            {item.kind === 'activity' && item.data.shift ? ` · ${item.data.shift}` : ''}
                            {item.data.cost_per_person_eur != null &&
                              ` · ${formatEUR(item.data.cost_per_person_eur)}/pessoa`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <StatusBadge
                          status={item.data.status}
                          onChange={(newStatus) =>
                            handleStatusChange(
                              item.kind === 'activity' ? 'itinerary_activities' : 'transport',
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
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Ações rápidas (mobile-first, fixas no rodapé) */}
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-2">
          <button
            onClick={() => setOpenSheet('activity')}
            disabled={!activeDestId || activeDestId === 'ALL'}
            title={activeDestId === 'ALL' ? 'Escolha uma cidade para adicionar um passeio' : undefined}
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
          title={`Novo passeio em ${activeDest?.city_name ?? ''}`}
          icon={Ticket}
          onClose={() => setOpenSheet(null)}
          onSubmit={handleAddActivity}
          fields={[
            { name: 'activity_name', label: 'Nome do passeio', required: true },
            { name: 'assigned_date', label: 'Data', type: 'date' },
            { name: 'shift', label: 'Turno', type: 'select', options: ['Manhã', 'Tarde', 'Noite'] },
            { name: 'exact_time', label: 'Horário exato', type: 'time' },
            { name: 'cost_per_person_eur', label: 'Custo por pessoa (EUR)', type: 'number' },
            {
              name: 'paid_by',
              label: 'Pago por (se já foi pago, lança automaticamente como gasto)',
              type: 'select',
              options: travelers.map((t) => t.name),
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
            { name: 'destination_city', label: 'Cidade de destino', required: true },
            { name: 'departure_date', label: 'Data de partida', type: 'date' },
            { name: 'departure_time', label: 'Hora de partida', type: 'time' },
            { name: 'arrival_time', label: 'Hora de chegada', type: 'time' },
            { name: 'cost_per_person_eur', label: 'Custo por pessoa (EUR)', type: 'number' },
            {
              name: 'paid_by',
              label: 'Pago por (se já foi pago, lança automaticamente como gasto)',
              type: 'select',
              options: travelers.map((t) => t.name),
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
            { name: 'destination_city', label: 'Cidade de destino', required: true },
            { name: 'departure_date', label: 'Data de partida', type: 'date' },
            { name: 'departure_time', label: 'Hora de partida', type: 'time' },
            { name: 'arrival_time', label: 'Hora de chegada', type: 'time' },
            { name: 'cost_per_person_eur', label: 'Custo por pessoa (EUR)', type: 'number' },
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
            { name: 'category', label: 'Categoria' },
            { name: 'total_cost_eur', label: 'Valor total (EUR)', type: 'number', required: true },
            { name: 'paid_by', label: 'Pago por', type: 'select', options: travelers.map((t) => t.name), required: true },
            {
              name: 'split_type',
              label: 'Divisão',
              type: 'select',
              options: ['igual', 'individual'],
              default: 'igual',
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