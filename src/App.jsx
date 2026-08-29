import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
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
  ArrowRight,
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

// Lista de datas ISO (inclusive) entre duas datas — usada pra montar o
// "esqueleto" da timeline com base na chegada/saída de uma cidade, mesmo
// antes de qualquer passeio/transporte/hospedagem ser cadastrado nela.
function generateDateRange(startIso, endIso) {
  const dates = []
  const current = new Date(`${startIso}T00:00:00`)
  const end = new Date(`${endIso}T00:00:00`)
  if (Number.isNaN(current.getTime()) || Number.isNaN(end.getTime()) || current > end) return dates
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10))
    current.setDate(current.getDate() + 1)
  }
  return dates
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
  // Lembra só o e-mail (nunca a senha) num app raro de precisar logar de
  // novo — assim, se o iOS limpar a sessão salva, a pessoa digita só a
  // senha, não o e-mail inteiro de novo.
  const [email, setEmail] = useState(() => localStorage.getItem('cartaoPostalLastEmail') ?? '')
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
    if (error) {
      setError(error.message)
      return
    }
    localStorage.setItem('cartaoPostalLastEmail', email)
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

// Mapa de largura fracionária pra campos que dividem uma linha (ex: Cidade
// 2/3 + Status 1/3, ou Valor Total 1/3 + Quem Pagou 2/3).
const FIELD_WIDTH_CLASS = {
  '1/3': 'w-1/3',
  '2/3': 'w-2/3',
  '1/2': 'w-1/2',
}

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
  const [activeSuggestionField, setActiveSuggestionField] = useState(null)

  function setField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  // Ao clicar numa sugestão do autocomplete, preenche o próprio campo com o
  // rótulo da sugestão e qualquer outro campo indicado em `fillValues` (ex:
  // categoria e valor, no caso do "+ Gasto" puxando de um passeio já
  // cadastrado). A pessoa ainda pode digitar por cima de qualquer campo
  // preenchido assim.
  function handleSelectSuggestion(fieldName, suggestion) {
    setForm((prev) => ({
      ...prev,
      [fieldName]: suggestion.label,
      ...(suggestion.fillValues ?? {}),
    }))
    setActiveSuggestionField(null)
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

  // Só os campos visíveis no momento (respeitando `hideWhen`), na ordem em
  // que foram declarados.
  const visibleFields = fields.filter((f) => !f.hideWhen || !f.hideWhen(form))

  // Agrupa campos com o mesmo `row` numa única linha lado a lado; campos
  // sem `row` ficam cada um na sua própria linha (comportamento padrão).
  const rows = []
  const rowIndexByKey = {}
  for (const f of visibleFields) {
    if (f.row) {
      if (rowIndexByKey[f.row] === undefined) {
        rowIndexByKey[f.row] = rows.length
        rows.push({ key: f.row, fields: [f] })
      } else {
        rows[rowIndexByKey[f.row]].fields.push(f)
      }
    } else {
      rows.push({ key: f.name, fields: [f] })
    }
  }

  function renderField(f) {
    const matchingSuggestions =
      f.suggestions && form[f.name]
        ? f.suggestions.filter((s) => s.label.toLowerCase().includes(form[f.name].toLowerCase())).slice(0, 6)
        : []

    return (
      <div className="flex flex-col gap-1">
        <label className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {f.label}
          {f.required && ' *'}
        </label>
        {f.suggestions ? (
          <div className="relative">
            <input
              type="text"
              value={form[f.name]}
              required={f.required}
              autoComplete="off"
              onChange={(e) => setField(f.name, e.target.value)}
              onFocus={() => setActiveSuggestionField(f.name)}
              onBlur={() => setTimeout(() => setActiveSuggestionField(null), 150)}
              className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none ring-primary/40 focus:ring-2"
            />
            {activeSuggestionField === f.name && matchingSuggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                {matchingSuggestions.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectSuggestion(f.name, s)}
                    className="block w-full px-3 py-2 text-left font-mono text-xs text-foreground hover:bg-muted"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : f.variant === 'status-pill' ? (
          // Pílula de status: bem mais arredondada que os outros campos, e
          // assume a cor do status selecionado — tanto fechada quanto nas
          // opções da lista.
          <select
            value={form[f.name]}
            required={f.required}
            onChange={(e) => setField(f.name, e.target.value)}
            style={
              STATUS_OPTION_COLORS[form[f.name]]
                ? {
                    backgroundColor: STATUS_OPTION_COLORS[form[f.name]].bg,
                    color: STATUS_OPTION_COLORS[form[f.name]].fg,
                  }
                : undefined
            }
            className="rounded-full border border-input bg-background px-3 py-2 text-center font-mono text-xs font-semibold uppercase tracking-wide text-foreground outline-none ring-primary/40 focus:ring-2"
          >
            {f.options.map((opt) => {
              const value = typeof opt === 'string' ? opt : opt.value
              const label = typeof opt === 'string' ? opt : opt.label
              const colors = STATUS_OPTION_COLORS[value]
              return (
                <option
                  key={value}
                  value={value}
                  style={colors ? { backgroundColor: colors.bg, color: colors.fg } : undefined}
                >
                  {label}
                </option>
              )
            })}
          </select>
        ) : f.type === 'select' ? (
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
    )
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
          {rows.map((row) => {
            if (row.fields.length === 1) {
              const f = row.fields[0]
              return <div key={row.key}>{renderField(f)}</div>
            }
            // Linha com mais de um campo lado a lado. A linha "cities" (só
            // usada no formulário de Transporte) ganha uma seta entre os
            // dois campos, indicando origem ➔ destino.
            return (
              <div key={row.key} className="flex items-start gap-2">
                {row.fields.map((f, i) => (
                  <Fragment key={f.name}>
                    <div className={f.width ? FIELD_WIDTH_CLASS[f.width] : 'flex-1'}>
                      {renderField(f)}
                    </div>
                    {row.key === 'cities' && i === 0 && (
                      <div className="flex h-[38px] shrink-0 items-end pb-2 text-muted-foreground">
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>
            )
          })}

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
  const [includePendenteAtrasado, setIncludePendenteAtrasado] = useState(false)
  const [includePlanejando, setIncludePlanejando] = useState(false)
  const [gastosUserFilter, setGastosUserFilter] = useState('') // preenchido via effect abaixo
  const [ledgerDrawerOpen, setLedgerDrawerOpen] = useState(false)
  const [ledgerFilters, setLedgerFilters] = useState({ category: 'all', paidBy: 'all', city: 'all', status: 'all' })
  const [editingExpense, setEditingExpense] = useState(null)
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
  const [copyFailed, setCopyFailed] = useState(false)
  const [generatingCode, setGeneratingCode] = useState(false)
  const [cityNoteBannerOpen, setCityNoteBannerOpen] = useState(false)

  // Recolhe o banner de anotações sempre que troca de cidade, pra não
  // "vazar" a nota de uma cidade aberta sem querer pra outra.
  useEffect(() => {
    setCityNoteBannerOpen(false)
  }, [activeDestId])

  async function handleCopyInviteCode() {
    if (!trip?.invite_code) return
    const text = trip.invite_code

    // Tenta a Clipboard API primeiro. Em alguns contextos (ex: iframe de
    // preview do StackBlitz sem a permissão "clipboard-write" liberada),
    // ela falha silenciosamente — daí o fallback com execCommand abaixo.
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        setCodeCopied(true)
        setTimeout(() => setCodeCopied(false), 2000)
        return
      }
      throw new Error('Clipboard API indisponível neste contexto')
    } catch {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        setCodeCopied(true)
        setTimeout(() => setCodeCopied(false), 2000)
      } catch {
        // Nenhum dos dois jeitos funcionou (comum em iframes bem restritos)
        // — pelo menos avisa a pessoa, já que o código já está visível no
        // próprio botão pra copiar manualmente.
        setCopyFailed(true)
        setTimeout(() => setCopyFailed(false), 3000)
      }
    }
  }

  // Pra viagens criadas antes dessa coluna existir (sem invite_code salvo).
  // Só funciona pra quem é dona da trip — RLS bloqueia participante tentando
  // alterar a trip de outra pessoa.
  async function handleGenerateInviteCode() {
    if (!trip) return
    setGeneratingCode(true)
    let lastError = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateInviteCode()
      const { error } = await supabase.from('trips').update({ invite_code: code }).eq('id', trip.id)
      if (!error) {
        setTrip((prev) => ({ ...prev, invite_code: code }))
        setGeneratingCode(false)
        return
      }
      lastError = error
      if (error.code !== '23505') break
    }
    setGeneratingCode(false)
    setErrorMsg(lastError?.message ?? 'Não foi possível gerar o código.')
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

  // Pré-seleciona o usuário logado no filtro de "Total da Viagem" assim que
  // soubermos quem ele é — só na primeira vez (não sobrescreve se a pessoa
  // já trocou manualmente pra "Todos" ou outro nome).
  useEffect(() => {
    if (!gastosUserFilter && currentTravelerName) setGastosUserFilter(currentTravelerName)
  }, [currentTravelerName, gastosUserFilter])

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
  async function syncLinkedExpense({
    existingExpenseId,
    totalCost,
    paidBy,
    splitType,
    date,
    description,
    category,
    status,
  }) {
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
          status: status || 'confirmado',
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
        status: status || 'confirmado',
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
        arrival_date: form.arrival_date || null,
        departure_date: form.departure_date || null,
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
        status: form.status || 'planejando',
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
        status: form.status || 'planejando',
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
        status: form.status || 'planejando',
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
      notes: form.notes || null,
      // Gasto lançado direto (sem passeio/transporte/hospedagem de origem)
      // já nasce "confirmado" — é dinheiro que já saiu do bolso na hora.
      status: 'confirmado',
      created_by: session.user.id,
    })
    if (error) throw error
    await refreshFinancials()
  }

  // Editar/excluir um lançamento direto pelo drawer de Lançamentos. Se esse
  // gasto for vinculado a um passeio/transporte/hospedagem (linked_expense_id
  // aponta pra cá), o item de origem continua com seus próprios dados — só o
  // gasto em si muda.
  async function handleUpdateExpense(id, form) {
    const { paidBy, splitType } = resolveResponsavel(form.responsavel)
    const { error } = await supabase
      .from('expenses_ledger')
      .update({
        total_cost_eur: form.total_cost_eur ? Number(form.total_cost_eur) : 0,
        paid_by: paidBy,
        split_type: splitType,
        category: form.category || null,
        notes: form.notes || null,
        status: form.status || 'confirmado',
      })
      .eq('id', id)
    if (error) throw error
    await refreshFinancials()
  }

  async function handleDeleteExpense(id) {
    // linked_expense_id nas outras tabelas tem ON DELETE SET NULL — apagar
    // aqui não deixa nenhum passeio/transporte/hospedagem "orfão" quebrado,
    // só desfaz o vínculo automaticamente.
    const { error } = await supabase.from('expenses_ledger').delete().eq('id', id)
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
        destination_id: form.destination_id,
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
      status: form.status || 'planejando',
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
      status: form.status || 'planejando',
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
      status: form.status || 'planejando',
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

  // Sugestões pro autocomplete de "Descrição" no formulário de Gasto —
  // busca em TODOS os passeios já cadastrados na viagem (não só na cidade
  // atual), pra evitar digitar/lançar a mesma coisa duas vezes.
  const expenseSuggestions = useMemo(
    () =>
      overviewActivities
        .filter((a) => a.activity_name)
        .map((a) => {
          const city = destById[a.destination_id]
          return {
            key: a.id,
            label: city ? `${a.activity_name} (${city})` : a.activity_name,
            fillValues: {
              category: 'Passeio',
              total_cost_eur: a.total_cost_eur != null ? String(a.total_cost_eur) : '',
            },
          }
        }),
    [overviewActivities, destById]
  )

  // Rótulo de uma cidade pro cabeçalho do dia. Se for bate-volta, procura a
  // cidade "base" mais próxima antes dela na ordem do roteiro e monta
  // "Base (Bate-volta: Cidade)" — ex: "Milão (Bate-volta: Como)".
  function cityLabelForDest(dest) {
    if (!dest) return ''
    if (!dest.is_bate_volta) return dest.city_name
    const idx = destinations.findIndex((d) => d.id === dest.id)
    let base = dest.city_name
    for (let i = idx - 1; i >= 0; i--) {
      if (!destinations[i].is_bate_volta) {
        base = destinations[i].city_name
        break
      }
    }
    return `${base} (Bate-volta: ${dest.city_name})`
  }

  // Rótulo geo-contextual de um dia inteiro da timeline: se tiver um
  // transporte entre cidades naquele dia, mostra "Origem ➔ Destino" (dia de
  // deslocamento); senão mostra a cidade (com sufixo de bate-volta se for
  // o caso).
  function dayContextLabel(items) {
    const transportItem = items.find((i) => i.kind === 'transport')
    if (transportItem) {
      return `${transportItem.data.origin_city} ➔ ${transportItem.data.destination_city}`
    }
    if (activeDestId !== 'ALL') {
      return activeDest ? cityLabelForDest(activeDest) : ''
    }
    const withDest = items.find((i) => i.data.destination_id)
    if (withDest) {
      return cityLabelForDest(destinations.find((d) => d.id === withDest.data.destination_id))
    }
    return ''
  }

  // Custo por pessoa exibido na timeline: se o item é "Individual", o valor
  // por pessoa é o próprio total (só a pessoa paga, por ela mesma). Se é
  // "igual" (um viajante específico foi escolhido como responsável), divide
  // pelo número de viajantes ativos — dinamicamente, não em blocos fixos.
  function perPersonCost(row) {
    if (row.total_cost_eur == null) return null
    const total = Number(row.total_cost_eur)
    return row.split_type === 'igual' ? total / Math.max(travelers.length, 1) : total
  }

  // Monta o link "Como chegar" pro tipo certo de item — passeio/hospedagem
  // buscam pelo nome + cidade; transporte busca pela estação/cidade de
  // partida (é o que mais importa saber "como chegar" num item de viagem).
  function mapsUrlFor(item) {
    const cityContext =
      activeDestId === 'ALL' ? destById[item.data.destination_id] ?? '' : activeDest?.city_name ?? ''
    if (item.kind === 'activity') return buildMapsSearchUrl(`${item.data.activity_name} ${cityContext}`)
    if (item.kind === 'transport') return buildMapsSearchUrl(item.data.origin_station || item.data.origin_city)
    if (item.kind === 'accommodation') return buildMapsSearchUrl(`${item.data.hotel_name} ${cityContext}`)
    return null
  }

  // Intervalo de datas pra hospedagem, sem nunca cair num travessão de
  // campo vazio — se só uma ponta existir, mostra só ela.
  function dateRangeLabel(checkIn, checkOut) {
    if (checkIn && checkOut) return `${formatDate(checkIn)} → ${formatDate(checkOut)}`
    if (checkIn) return formatDate(checkIn)
    if (checkOut) return formatDate(checkOut)
    return null
  }

  // Todo valor no banco é guardado em EUR. Isso converte pra moeda de
  // exibição escolhida na criação da viagem, usando a cotação base
  // cadastrada. Se a moeda for EUR (ou não houver cotação definida), mostra
  // em EUR sem converter nada.
  const formatMoney = useCallback(
    (amountEur) => {
      const amount = Number(amountEur ?? 0)
      const currency = trip?.currency || 'EUR'
      const rate = Number(trip?.base_euro_rate)
      if (currency === 'EUR' || !rate) {
        return formatEUR(amount)
      }
      try {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount * rate)
      } catch {
        // código de moeda inválido pro Intl (não deveria acontecer, já que
        // vem de uma lista fixa) — cai pro EUR sem converter.
        return formatEUR(amount)
      }
    },
    [trip?.currency, trip?.base_euro_rate]
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

    // Esqueleto: garante um dia (mesmo vazio) pra cada data entre chegada e
    // saída da cidade, pra não deixar a timeline em branco logo depois de
    // cadastrar uma cidade nova com essas datas preenchidas.
    const destsToScaffold =
      activeDestId === 'ALL' ? destinations : destinations.filter((d) => d.id === activeDestId)
    for (const dest of destsToScaffold) {
      if (!dest.arrival_date || !dest.departure_date) continue
      for (const dateStr of generateDateRange(dest.arrival_date, dest.departure_date)) {
        if (!groups[dateStr]) {
          groups[dateStr] = [{ kind: 'placeholder', time: '00:00', data: { destination_id: dest.id } }]
        }
      }
    }

    return Object.entries(groups)
      .sort(([a], [b]) => (a === 'Sem data' ? 1 : b === 'Sem data' ? -1 : a.localeCompare(b)))
      .map(([date, items]) => ({
        date,
        items: items.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99')),
      }))
  }, [filteredAccommodations, filteredActivities, filteredTransport, destinations, activeDestId])

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

  // Gastos filtrados pelo dropdown de usuário da seção "Total da viagem"
  // (independente do drawer de Lançamentos, que tem seus próprios filtros).
  const gastosFilteredExpenses = useMemo(
    () => (gastosUserFilter === 'Todos' ? expenses : expenses.filter((e) => e.paid_by === gastosUserFilter)),
    [expenses, gastosUserFilter]
  )

  const grandTotal = useMemo(
    () => gastosFilteredExpenses.reduce((sum, e) => sum + (Number(e.total_cost_eur) || 0), 0),
    [gastosFilteredExpenses]
  )

  // Sempre mostra as 5 categorias do sistema, na mesma ordem, mesmo com
  // total zero — o eixo do gráfico não "pula" categoria sem gasto.
  const categoryTotals = useMemo(() => {
    const totals = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0]))
    for (const e of gastosFilteredExpenses) {
      const cat = EXPENSE_CATEGORIES.includes(e.category) ? e.category : 'Outros'
      totals[cat] = (totals[cat] ?? 0) + (Number(e.total_cost_eur) || 0)
    }
    return EXPENSE_CATEGORIES.map((c) => [c, totals[c]])
  }, [gastosFilteredExpenses])

  const maxCategoryAmount = useMemo(
    () => Math.max(1, ...categoryTotals.map(([, amount]) => amount)),
    [categoryTotals]
  )

  // Estimativa de custo com base nos pontos do roteiro (passeios, transportes
  // e hospedagens de TODAS as cidades) — independente de já ter sido lançado
  // um gasto de verdade ou não. "Confirmado" é sempre incluído; os outros
  // dois grupos de status são opcionais via checkbox.
  const estimateStatuses = useMemo(() => {
    const set = new Set(['confirmado'])
    if (includePendenteAtrasado) {
      set.add('pendente')
      set.add('atrasado')
    }
    if (includePlanejando) set.add('planejando')
    return set
  }, [includePendenteAtrasado, includePlanejando])

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

  // "Cidade" não é um campo real de expenses_ledger — extrai de forma
  // aproximada o texto entre parênteses no fim da descrição (padrão que o
  // autocomplete de passeios já usa, ex: "Coliseu (Roma)"). É uma
  // aproximação, não um dado estruturado de verdade.
  const expenseCities = useMemo(() => {
    const cities = new Set()
    for (const e of expenses) {
      const match = e.description?.match(/\(([^)]+)\)\s*$/)
      if (match) cities.add(match[1])
    }
    return Array.from(cities).sort()
  }, [expenses])

  function expenseCityTag(description) {
    return description?.match(/\(([^)]+)\)\s*$/)?.[1] ?? null
  }

  // Lançamentos filtrados pra exibição dentro do drawer de auditoria.
  const ledgerFilteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (ledgerFilters.category !== 'all' && e.category !== ledgerFilters.category) return false
      if (ledgerFilters.paidBy !== 'all' && e.paid_by !== ledgerFilters.paidBy) return false
      if (ledgerFilters.status !== 'all' && (e.status ?? 'confirmado') !== ledgerFilters.status) return false
      if (ledgerFilters.city !== 'all' && expenseCityTag(e.description) !== ledgerFilters.city) return false
      return true
    })
  }, [expenses, ledgerFilters])

  // Abre o drawer de Lançamentos já pré-filtrado — usado pelo drill-down dos
  // gráficos (clicar numa barra de categoria ou num card de saldo).
  function openLedgerDrawer(partialFilters) {
    setLedgerFilters({ category: 'all', paidBy: 'all', city: 'all', status: 'all', ...partialFilters })
    setLedgerDrawerOpen(true)
  }

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
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 px-6 py-3 backdrop-blur sm:px-8">
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

        {/* Filtros da tela Roteiro — moram dentro do header sticky de propósito,
            pra ficarem "grudados" bem abaixo dele ao rolar a página. */}
        {view === 'roteiro' && (
          <div className="mx-auto mt-2 grid max-w-2xl grid-cols-3 gap-2">
            <select
              value={activeDestId}
              onChange={(e) => setActiveDestId(e.target.value)}
              className="rounded-md border border-input bg-card px-2 py-1 font-mono text-[10px] text-foreground"
            >
              <option value="ALL">Cidades</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.city_name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-input bg-card px-2 py-1 font-mono text-[10px] text-foreground"
            >
              <option value="all">Status</option>
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
              className="rounded-md border border-input bg-card px-2 py-1 font-mono text-[10px] text-foreground"
            >
              <option value="all">Categorias</option>
              <option value="activity">Passeio</option>
              <option value="transport">Transporte</option>
              <option value="accommodation">Hospedagem</option>
            </select>
          </div>
        )}
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
              {trip.invite_code ? (
                <>
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
                  {copyFailed && (
                    <p className="mt-1 font-mono text-[10px] text-accent">
                      Não deu pra copiar automaticamente — selecione o código acima manualmente.
                    </p>
                  )}
                </>
              ) : (
                <button
                  onClick={handleGenerateInviteCode}
                  disabled={generatingCode}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground disabled:opacity-60"
                >
                  {generatingCode && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                  Gerar código de convite
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

            {activeDestId !== 'ALL' && cityNoteByDestId[activeDestId]?.notes_content && (
              <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setCityNoteBannerOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-3 py-2 font-mono text-[11px] text-muted-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    <ClipboardList className="h-3 w-3 shrink-0" aria-hidden="true" />
                    Anotações de {activeDest?.city_name}
                  </span>
                  {cityNoteBannerOpen ? (
                    <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                </button>
                {cityNoteBannerOpen && (
                  <p className="whitespace-pre-wrap border-t border-border px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {cityNoteByDestId[activeDestId].notes_content}
                  </p>
                )}
              </div>
            )}

            {/* Timeline cronológica (hospedagem + passeios + transporte) */}
            <div className="mt-4 flex flex-col gap-4">
              {timelineByDay.length === 0 && (
                <p className="rounded-xl border border-dashed border-border p-4 text-center font-mono text-xs text-muted-foreground">
                  Nada planejado para {activeDestId === 'ALL' ? 'a viagem' : activeDest?.city_name ?? 'este destino'}{' '}
                  ainda.
                </p>
              )}
              {timelineByDay.map(({ date, items }) => {
                const realItems = items.filter((i) => i.kind !== 'placeholder')
                const isAccordion = activeDestId === 'ALL'
                const isExpanded = !isAccordion || expandedDays.has(date)
                const contextLabel = dayContextLabel(items)
                return (
                  <div key={date}>
                    <button
                      type="button"
                      onClick={() => isAccordion && toggleDay(date)}
                      className={`mb-1.5 flex w-full items-center justify-between font-mono uppercase tracking-wide ${
                        isAccordion ? 'cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-foreground">
                        {date === 'Sem data' ? date : formatDate(date)}
                        {contextLabel && ` · ${contextLabel}`}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 pl-2 text-[9px] font-normal text-muted-foreground/70">
                        {realItems.length} {realItems.length === 1 ? 'item' : 'itens'}
                        {isAccordion &&
                          (isExpanded ? (
                            <ChevronUp className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="h-3 w-3" aria-hidden="true" />
                          ))}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="flex flex-col gap-2">
                        {realItems.length === 0 && (
                          <p className="rounded-xl border border-dashed border-border p-3 text-center font-mono text-[11px] text-muted-foreground">
                            Nada planejado ainda pra este dia.
                          </p>
                        )}
                        {realItems.map((item, idx) => {
                          const isAccommodation = item.kind === 'accommodation'
                          const ItemIcon = item.kind === 'activity' ? Ticket : item.kind === 'transport' ? Plane : Hotel
                          const showCost = item.data.total_cost_eur != null && item.data.status !== 'confirmado'
                          const mapsUrl = mapsUrlFor(item)

                          // Monta a linha de detalhes sem nunca deixar um
                          // travessão de campo vazio — só entra o que existir.
                          const detailParts = []
                          if (
                            activeDestId === 'ALL' &&
                            (item.kind === 'activity' || isAccommodation) &&
                            destById[item.data.destination_id]
                          ) {
                            detailParts.push(destById[item.data.destination_id])
                          }
                          if (isAccommodation) {
                            const range = dateRangeLabel(item.data.check_in, item.data.check_out)
                            if (range) detailParts.push(range)
                          }
                          // "Turno" só aparece se não houver horário exato —
                          // com os dois juntos, um vira redundante.
                          if (item.kind === 'activity' && item.data.shift && !item.data.exact_time) {
                            detailParts.push(item.data.shift)
                          }
                          // Custo só aparece se o status NÃO for "confirmado"
                          // (uma vez confirmado, o valor já está no extrato
                          // de gastos — repetir aqui só polui a timeline).
                          if (showCost) {
                            detailParts.push(`${formatMoney(perPersonCost(item.data))}/pessoa`)
                          }

                          const stationParts =
                            item.kind === 'transport' && (item.data.origin_station || item.data.destination_station)
                              ? item.data.origin_station && item.data.destination_station
                                ? `${item.data.origin_station} → ${item.data.destination_station}`
                                : item.data.origin_station || item.data.destination_station
                              : null

                          return (
                            <div key={`${item.kind}-${item.data.id ?? idx}`} className="flex items-stretch gap-2">
                              {/* Trilho externo: ícone "nu" em Vintage Blue direto sobre o
                                  fundo Warm Cream, sem card/borda/fundo próprio, formando
                                  uma coluna contínua de diário de viagem. */}
                              <div className="flex w-5 shrink-0 flex-col items-center">
                                <ItemIcon
                                  className={`mt-1 shrink-0 text-primary ${isAccommodation ? 'h-3.5 w-3.5' : 'h-4 w-4'}`}
                                  aria-hidden="true"
                                />
                                {idx < realItems.length - 1 && (
                                  <div className="mt-1 w-px flex-1 bg-border" aria-hidden="true" />
                                )}
                              </div>

                              <div
                                className={`flex flex-1 items-start justify-between gap-2 rounded-xl border border-border bg-card ${
                                  isAccommodation ? 'p-2' : 'p-3'
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  {!isAccommodation && item.time && (
                                    <span className="shrink-0 pt-0.5 font-mono text-[11px] font-semibold text-foreground">
                                      {item.time.slice(0, 5)}
                                    </span>
                                  )}
                                  <div>
                                    <p className={`font-medium text-foreground ${isAccommodation ? 'text-sm' : ''}`}>
                                      {item.kind === 'activity' && item.data.activity_name}
                                      {item.kind === 'transport' &&
                                        `${item.data.origin_city} → ${item.data.destination_city}`}
                                      {isAccommodation && item.data.hotel_name}
                                    </p>
                                    {detailParts.length > 0 && (
                                      <p className="font-mono text-[11px] text-muted-foreground">
                                        {detailParts.join(' · ')}
                                      </p>
                                    )}
                                    {stationParts && (
                                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                        {stationParts}
                                      </p>
                                    )}
                                    {item.kind === 'activity' && item.data.booking_rule && (
                                      <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                                        <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        {item.data.booking_rule}
                                      </p>
                                    )}
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                      {mapsUrl && (
                                        <a
                                          href={mapsUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="inline-flex items-center gap-1 font-mono text-[10px] text-primary underline underline-offset-2"
                                        >
                                          <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                                          Como chegar
                                        </a>
                                      )}
                                      {item.kind === 'activity' && item.data.ticket_url && (
                                        <a
                                          href={item.data.ticket_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="inline-flex items-center gap-1 font-mono text-[10px] text-primary underline underline-offset-2"
                                        >
                                          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                          Abrir ingresso
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-col items-center gap-1">
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
                    <button
                      key={b.name}
                      type="button"
                      onClick={() => openLedgerDrawer({ paidBy: b.name })}
                      className="rounded-xl border border-border bg-card p-3 text-left"
                    >
                      <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{b.name}</p>
                      <p className="font-display text-xl font-semibold text-foreground">{formatMoney(b.totalPaid)}</p>
                      <p className={`font-mono text-[11px] ${isPositive ? 'text-secondary-foreground' : 'text-accent'}`}>
                        {isPositive ? 'a receber ' : 'a pagar '}
                        {formatMoney(Math.abs(b.balance))}
                      </p>
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                "Total pago" soma tudo que a pessoa desembolsou. "A receber/a pagar" considera só os gastos 50/50.
                Toque num card pra ver os lançamentos dessa pessoa.
              </p>
            </section>

            <section aria-labelledby="total-heading">
              <div className="mb-2 flex items-center justify-between">
                <h2 id="total-heading" className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  Total da viagem
                </h2>
                <select
                  value={gastosUserFilter}
                  onChange={(e) => setGastosUserFilter(e.target.value)}
                  className="rounded-md border border-input bg-card px-2 py-1 font-mono text-[10px] text-foreground"
                >
                  <option value="Todos">Todos</option>
                  {travelers.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="font-display text-4xl font-semibold text-foreground">{formatMoney(grandTotal)}</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                Soma dos gastos já lançados{gastosUserFilter !== 'Todos' ? ` por ${gastosUserFilter}` : ''}.
              </p>

              <div className="mt-4 flex flex-col gap-2.5">
                {categoryTotals.map(([cat, amount]) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => openLedgerDrawer({ category: cat })}
                    title={formatMoney(amount)}
                    className="text-left"
                  >
                    <div className="mb-1 flex items-center justify-between font-mono text-[11px] text-foreground">
                      <span>{cat}</span>
                      <span className="text-muted-foreground">{formatMoney(amount)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-primary transition-all"
                        style={{ width: `${(amount / maxCategoryAmount) * 100}%` }}
                      />
                    </div>
                  </button>
                ))}
              </div>
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                Toque numa categoria pra ver só os lançamentos dela.
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
                {formatMoney(roteiroEstimateTotal)}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                Soma dos custos de passeios, transportes e hospedagens cadastrados, por status — independente de já
                ter virado gasto lançado.
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                <label className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <input type="checkbox" checked readOnly className="accent-primary" />
                  Confirmado (base, sempre incluído)
                </label>
                <label className="flex items-center gap-2 font-mono text-[11px] text-foreground">
                  <input
                    type="checkbox"
                    checked={includePendenteAtrasado}
                    onChange={(e) => setIncludePendenteAtrasado(e.target.checked)}
                    className="accent-primary"
                  />
                  Somar pendente + atrasado
                </label>
                <label className="flex items-center gap-2 font-mono text-[11px] text-foreground">
                  <input
                    type="checkbox"
                    checked={includePlanejando}
                    onChange={(e) => setIncludePlanejando(e.target.checked)}
                    className="accent-primary"
                  />
                  Somar planejando
                </label>
              </div>
            </section>

            <button
              type="button"
              onClick={() => openLedgerDrawer({})}
              className="rounded-lg border border-border bg-card py-3 text-center font-mono text-xs uppercase tracking-wide text-foreground"
            >
              Ver todos os Lançamentos
            </button>
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
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-border bg-card/95 px-6 py-3 backdrop-blur sm:px-8">
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
            { name: 'arrival_date', label: 'Data de chegada (opcional)', type: 'date' },
            { name: 'departure_date', label: 'Data de saída (opcional)', type: 'date' },
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
                    row: 'first',
                    width: '2/3',
                  },
                ]
              : []),
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
              default: 'planejando',
              variant: 'status-pill',
              row: 'first',
              width: activeDestId === 'ALL' ? '1/3' : undefined,
            },
            { name: 'activity_name', label: 'Nome do passeio', required: true },
            { name: 'assigned_date', label: 'Data', type: 'date' },
            { name: 'exact_time', label: 'Horário exato', type: 'time' },
            {
              name: 'shift',
              label: 'Turno',
              type: 'select',
              options: ['Manhã', 'Tarde', 'Noite'],
              // Some assim que a pessoa preenche um horário exato, já que os
              // dois viram redundantes.
              hideWhen: (values) => !!values.exact_time,
            },
            { name: 'total_cost_eur', label: 'Valor Total', type: 'number', row: 'money', width: '1/3' },
            {
              name: 'responsavel',
              label: 'Quem Pagou',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
              row: 'money',
              width: '2/3',
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
            {
              name: 'origin_city',
              label: 'Cidade de Origem',
              required: true,
              default: activeDest?.city_name ?? '',
              row: 'cities',
            },
            { name: 'destination_city', label: 'Cidade de Destino', required: true, row: 'cities' },
            { name: 'origin_station', label: 'Estação/aeroporto de saída (opcional)', row: 'stations' },
            { name: 'destination_station', label: 'Estação/aeroporto de chegada (opcional)', row: 'stations' },
            { name: 'departure_date', label: 'Data de partida', type: 'date' },
            { name: 'departure_time', label: 'Hora de partida', type: 'time', row: 'times', width: '1/2' },
            { name: 'arrival_time', label: 'Hora de chegada', type: 'time', row: 'times', width: '1/2' },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
              default: 'planejando',
              variant: 'status-pill',
            },
            { name: 'total_cost_eur', label: 'Valor Total', type: 'number', row: 'money', width: '1/3' },
            {
              name: 'responsavel',
              label: 'Quem Pagou',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
              row: 'money',
              width: '2/3',
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
                    row: 'first',
                    width: '2/3',
                  },
                ]
              : []),
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
              default: 'planejando',
              variant: 'status-pill',
              row: 'first',
              width: activeDestId === 'ALL' ? '1/3' : undefined,
            },
            { name: 'hotel_name', label: 'Nome do hotel', required: true },
            { name: 'check_in', label: 'Check-in', type: 'date' },
            { name: 'check_out', label: 'Check-out', type: 'date' },
            { name: 'total_cost_eur', label: 'Valor Total', type: 'number', row: 'money', width: '1/3' },
            {
              name: 'responsavel',
              label: 'Quem Pagou',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
              row: 'money',
              width: '2/3',
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
            {
              name: 'destination_id',
              label: 'Cidade',
              type: 'select',
              options: destinations.map((d) => ({ value: d.id, label: d.city_name })),
              required: true,
              row: 'first',
              width: '2/3',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
              variant: 'status-pill',
              row: 'first',
              width: '1/3',
            },
            { name: 'activity_name', label: 'Nome do passeio', required: true },
            { name: 'assigned_date', label: 'Data', type: 'date' },
            { name: 'exact_time', label: 'Horário exato', type: 'time' },
            {
              name: 'shift',
              label: 'Turno',
              type: 'select',
              options: ['Manhã', 'Tarde', 'Noite'],
              hideWhen: (values) => !!values.exact_time,
            },
            { name: 'total_cost_eur', label: 'Valor Total', type: 'number', row: 'money', width: '1/3' },
            {
              name: 'responsavel',
              label: 'Quem Pagou',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
              row: 'money',
              width: '2/3',
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
            { name: 'origin_city', label: 'Cidade de Origem', required: true, row: 'cities' },
            { name: 'destination_city', label: 'Cidade de Destino', required: true, row: 'cities' },
            { name: 'origin_station', label: 'Estação/aeroporto de saída (opcional)', row: 'stations' },
            { name: 'destination_station', label: 'Estação/aeroporto de chegada (opcional)', row: 'stations' },
            { name: 'departure_date', label: 'Data de partida', type: 'date' },
            { name: 'departure_time', label: 'Hora de partida', type: 'time', row: 'times', width: '1/2' },
            { name: 'arrival_time', label: 'Hora de chegada', type: 'time', row: 'times', width: '1/2' },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
              variant: 'status-pill',
            },
            { name: 'total_cost_eur', label: 'Valor Total', type: 'number', row: 'money', width: '1/3' },
            {
              name: 'responsavel',
              label: 'Quem Pagou',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
              row: 'money',
              width: '2/3',
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
            {
              name: 'destination_id',
              label: 'Cidade',
              type: 'select',
              options: destinations.map((d) => ({ value: d.id, label: d.city_name })),
              required: true,
              row: 'first',
              width: '2/3',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
              variant: 'status-pill',
              row: 'first',
              width: '1/3',
            },
            { name: 'hotel_name', label: 'Nome do hotel', required: true },
            { name: 'check_in', label: 'Check-in', type: 'date' },
            { name: 'check_out', label: 'Check-out', type: 'date' },
            { name: 'total_cost_eur', label: 'Valor Total', type: 'number', row: 'money', width: '1/3' },
            {
              name: 'responsavel',
              label: 'Quem Pagou',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
              row: 'money',
              width: '2/3',
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
            { name: 'description', label: 'Descrição', required: true, suggestions: expenseSuggestions },
            { name: 'transaction_date', label: 'Data', type: 'date', default: todayIso() },
            { name: 'category', label: 'Categoria', type: 'select', options: EXPENSE_CATEGORIES },
            { name: 'total_cost_eur', label: 'Valor Total', type: 'number', row: 'money', width: '1/3' },
            {
              name: 'responsavel',
              label: 'Quem Pagou',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
              row: 'money',
              width: '2/3',
            },
            { name: 'notes', label: 'Notas', type: 'textarea' },
          ]}
        />
      )}

      {/* Drawer de auditoria "Lançamentos" — desliza da direita, altura cheia */}
      {ledgerDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-foreground/30 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-sm flex-col bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-display text-lg font-semibold text-foreground">Lançamentos</h2>
              <button
                onClick={() => setLedgerDrawerOpen(false)}
                aria-label="Fechar"
                className="rounded-full p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="sticky top-0 z-10 grid grid-cols-2 gap-2 border-b border-border bg-card px-4 py-3">
              <select
                value={ledgerFilters.category}
                onChange={(e) => setLedgerFilters((f) => ({ ...f, category: e.target.value }))}
                className="rounded-md border border-input bg-background px-2 py-1 font-mono text-[10px] text-foreground"
              >
                <option value="all">Categoria</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={ledgerFilters.paidBy}
                onChange={(e) => setLedgerFilters((f) => ({ ...f, paidBy: e.target.value }))}
                className="rounded-md border border-input bg-background px-2 py-1 font-mono text-[10px] text-foreground"
              >
                <option value="all">Quem Pagou</option>
                {travelers.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>

              <select
                value={ledgerFilters.city}
                onChange={(e) => setLedgerFilters((f) => ({ ...f, city: e.target.value }))}
                className="rounded-md border border-input bg-background px-2 py-1 font-mono text-[10px] text-foreground"
              >
                <option value="all">Cidade</option>
                {expenseCities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={ledgerFilters.status}
                onChange={(e) => setLedgerFilters((f) => ({ ...f, status: e.target.value }))}
                className="rounded-md border border-input bg-background px-2 py-1 font-mono text-[10px] text-foreground"
              >
                <option value="all">Status</option>
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
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {ledgerFilteredExpenses.length === 0 && (
                <p className="rounded-xl border border-dashed border-border p-4 text-center font-mono text-xs text-muted-foreground">
                  Nenhum lançamento encontrado com esses filtros.
                </p>
              )}
              <div className="flex flex-col gap-2">
                {ledgerFilteredExpenses.map((e) => {
                  const splitLabel = e.split_type === 'igual' ? '50/50' : 'Individual'
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setEditingExpense(e)}
                      className="rounded-xl border border-border bg-card p-3 text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-foreground">{e.description}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {e.category ?? 'Sem categoria'} · {formatDate(e.transaction_date)} · {e.paid_by}
                          </p>
                        </div>
                        <p className="font-mono text-sm font-semibold text-foreground">
                          {formatMoney(e.total_cost_eur)}
                        </p>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                          {splitLabel}
                        </span>
                        <StatusBadge status={e.status ?? 'confirmado'} />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Editar um lançamento (aberto a partir de um card do drawer acima) */}
      {editingExpense && (
        <QuickAddSheet
          title="Editar lançamento"
          icon={Wallet}
          onClose={() => setEditingExpense(null)}
          initialValues={{
            ...editingExpense,
            responsavel: editingExpense.split_type === 'igual' ? editingExpense.paid_by : 'individual',
            status: editingExpense.status ?? 'confirmado',
          }}
          onSubmit={(form) => handleUpdateExpense(editingExpense.id, form)}
          onDelete={() => handleDeleteExpense(editingExpense.id)}
          fields={[
            { name: 'total_cost_eur', label: 'Valor Total', type: 'number', row: 'money', width: '1/3' },
            {
              name: 'responsavel',
              label: 'Quem Pagou',
              type: 'select',
              options: responsavelOptions,
              default: 'individual',
              row: 'money',
              width: '2/3',
            },
            { name: 'category', label: 'Categoria', type: 'select', options: EXPENSE_CATEGORIES },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['confirmado', 'pendente', 'atrasado', 'planejando'],
              variant: 'status-pill',
            },
            { name: 'notes', label: 'Notas', type: 'textarea' },
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
