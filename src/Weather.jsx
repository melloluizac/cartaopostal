import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw, Plane, Droplets, Thermometer, ChevronDown, ChevronUp } from 'lucide-react'

// ---------------------------------------------------------------------------
// Aba "Clima" — regras em "Regras do Clima do Roteiro":
//  1. previsão diária Open-Meteo (até 7 dias = alta, 8–16 = média)
//  2. tendência ECMWF EC46 (17+ dias, ou dia da previsão sem chance de chuva)
//  3. média histórica 2016–2025, janela de ±2 dias (só se a tendência falhar)
// As cidades e datas NÃO ficam no código: vêm do Roteiro (cidades com datas de
// chegada/saída, hospedagens, passeios e transportes). As coordenadas são
// buscadas pelo nome da cidade (geocoding da Open-Meteo) e guardadas no navegador.
// ---------------------------------------------------------------------------

const LS_GEO = 'cp_weather_geo_v1'
const LS_CLIM = 'cp_weather_clim_v1'
const LS_HIST = 'cp_weather_hist_v1'
const MAX_HIST = 40

// ---- utilidades -----------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0')
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseIso = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const diffDays = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000)
const addDays = (iso, n) => {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n)
  return toIso(d)
}
const norm = (s) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
const fmtDM = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

const lsGet = (key) => {
  try {
    return JSON.parse(window.localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}
const lsSet = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // armazenamento cheio ou bloqueado: o app segue sem cache
  }
}

async function getJson(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

const median = (arr) => {
  const a = arr.filter((v) => v != null && !Number.isNaN(v)).sort((x, y) => x - y)
  if (!a.length) return null
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}
const mean = (arr) => {
  const a = arr.filter((v) => v != null && !Number.isNaN(v))
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null
}

// ---- ícones ---------------------------------------------------------------

function iconFromWmo(code) {
  if (code === 0) return { emoji: '☀️', label: 'ensolarado' }
  if (code === 1) return { emoji: '🌤️', label: 'poucas nuvens' }
  if (code === 2) return { emoji: '⛅', label: 'parcialmente nublado' }
  if (code === 3) return { emoji: '☁️', label: 'nublado' }
  if (code === 45 || code === 48) return { emoji: '🌫️', label: 'neblina' }
  if ((code >= 51 && code <= 57) || (code >= 80 && code <= 82)) return { emoji: '🌦️', label: 'garoa/pancadas' }
  if (code >= 61 && code <= 67) return { emoji: '🌧️', label: 'chuva' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { emoji: '🌨️', label: 'neve' }
  if (code >= 95 && code <= 99) return { emoji: '⛈️', label: 'trovoada' }
  return { emoji: '⛅', label: 'tempo variável' }
}
function iconFromChance(prob) {
  if (prob >= 50) return { emoji: '🌧️', label: 'chuva provável' }
  if (prob >= 30) return { emoji: '🌦️', label: 'chuva possível' }
  return { emoji: '⛅', label: 'pouca chuva' }
}

// ---- cidades e datas a partir do Roteiro ----------------------------------

// Período de cada cidade: datas de chegada/saída cadastradas; sem elas, usa
// hospedagens e passeios daquela cidade.
function destRange(dest, accommodations, activities) {
  let start = dest.arrival_date || null
  let end = dest.departure_date || null
  if (!start || !end) {
    const dates = [
      ...accommodations.filter((a) => a.destination_id === dest.id).flatMap((a) => [a.check_in, a.check_out]),
      ...activities.filter((a) => a.destination_id === dest.id).map((a) => a.assigned_date),
    ]
      .filter(Boolean)
      .sort()
    if (!start && dates.length) start = dates[0]
    if (!end && dates.length) end = dates[dates.length - 1]
  }
  if (start && !end) end = start
  if (end && !start) start = end
  return start && end ? { start, end } : null
}

// Devolve Map(data -> [{ city, role }]). role: 'saída' | 'chegada' | 'bate-volta'
// | 'base' | 'voo' | null. Nada de cidade escrita no código.
function deriveDays({ destinations, accommodations, activities, transport }) {
  const ranges = destinations
    .map((d) => ({ dest: d, range: destRange(d, accommodations, activities) }))
    .filter((r) => r.range)
  const nameOf = (raw) => {
    const hit = destinations.find((d) => norm(d.city_name) === norm(raw))
    return hit ? hit.city_name : raw
  }
  const isDest = (raw) => destinations.some((d) => norm(d.city_name) === norm(raw))

  const dates = new Set()
  for (const { range } of ranges) {
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) dates.add(d)
  }
  for (const t of transport) if (t.departure_date) dates.add(t.departure_date)

  const result = new Map()
  for (const date of Array.from(dates).sort()) {
    const entries = new Map() // norm(city) -> { city, role }
    const put = (city, role) => {
      const k = norm(city)
      if (!entries.has(k)) entries.set(k, { city, role })
      else if (role && !entries.get(k).role) entries.get(k).role = role
    }

    const covering = ranges.filter(({ range }) => range.start <= date && date <= range.end)
    const longer = covering.filter(({ range }) => range.start < range.end)
    for (const { dest, range } of covering) {
      let role = null
      if (covering.length > 1) {
        const others = covering.filter((c) => c.dest !== dest)
        const single = range.start === range.end
        if (single && others.some((c) => c.range.start < c.range.end)) role = 'bate-volta'
        else if (!single && others.some((c) => c.range.start === c.range.end)) role = 'base'
        else if (range.end === date && others.some((c) => c.range.start === date)) role = 'saída'
        else if (range.start === date && others.some((c) => c.range.end === date)) role = 'chegada'
      }
      put(dest.city_name, role)
    }

    const todays = transport.filter((t) => t.departure_date === date)
    for (const t of todays) {
      const origin = nameOf(t.origin_city)
      const destination = nameOf(t.destination_city)
      const originIn = entries.has(norm(origin))
      const destIn = entries.has(norm(destination))
      const roundTrip = todays.some(
        (o) => o !== t && norm(o.origin_city) === norm(t.destination_city) && norm(o.destination_city) === norm(t.origin_city)
      )
      if (roundTrip) {
        // bate-volta: a cidade de partida é a base, a de destino é a visitada
        put(origin, 'base')
        put(destination, 'bate-volta')
        entries.get(norm(origin)).role = 'base'
        entries.get(norm(destination)).role = 'bate-volta'
        continue
      }
      if (originIn && !entries.get(norm(origin)).role) entries.get(norm(origin)).role = 'saída'
      if (destIn && !entries.get(norm(destination)).role) entries.get(norm(destination)).role = 'chegada'
      // voo sem chegada no dia: nenhuma das pontas é uma cidade do roteiro naquele dia
      if (!originIn && !destIn) {
        put(`${origin} → ${destination}`, 'voo')
      } else if (!originIn && isDest(origin)) {
        put(origin, 'saída')
      } else if (!destIn && isDest(destination) && !originIn) {
        put(destination, 'chegada')
      }
    }
    result.set(date, Array.from(entries.values()))
  }
  return result
}

// ---- APIs -----------------------------------------------------------------

async function geocode(name) {
  const cache = lsGet(LS_GEO) || {}
  const key = norm(name)
  if (cache[key]) return cache[key]
  const json = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=pt&format=json`
  )
  const hit = json?.results?.[0]
  if (!hit) return null
  const geo = { lat: hit.latitude, lon: hit.longitude }
  cache[key] = geo
  lsSet(LS_GEO, cache)
  return geo
}

async function fetchForecast({ lat, lon }) {
  const json = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum` +
      `&hourly=precipitation_probability,weather_code,temperature_2m&forecast_days=16&timezone=auto`
  )
  if (!json?.daily?.time) return null
  const hourly = {}
  const ht = json.hourly?.time ?? []
  const hp = json.hourly?.precipitation_probability ?? []
  const hc = json.hourly?.weather_code ?? []
  const hT = json.hourly?.temperature_2m ?? []
  const acc = {} // date -> slot -> { probs, temps, codes }
  ht.forEach((t, i) => {
    const date = t.slice(0, 10)
    const hour = Number(t.slice(11, 13))
    const slot = hour >= 6 && hour < 12 ? 'm' : hour >= 12 && hour < 18 ? 't' : hour >= 18 ? 'n' : null
    if (!slot) return
    acc[date] = acc[date] || {}
    acc[date][slot] = acc[date][slot] || { probs: [], temps: [], codes: [] }
    if (hp[i] != null) acc[date][slot].probs.push(hp[i])
    if (hT[i] != null) acc[date][slot].temps.push(hT[i])
    if (hc[i] != null) acc[date][slot].codes.push(hc[i])
  })
  const modeOf = (arr) => {
    const count = {}
    let best = null
    for (const v of arr) {
      count[v] = (count[v] || 0) + 1
      if (best == null || count[v] > count[best]) best = v
    }
    return best
  }
  for (const [date, slots] of Object.entries(acc)) {
    hourly[date] = { m: null, t: null, n: null, periods: {} }
    for (const slot of ['m', 't', 'n']) {
      const x = slots[slot]
      if (!x) continue
      hourly[date][slot] = x.probs.length ? Math.max(...x.probs) : null
      hourly[date].periods[slot] = {
        prob: hourly[date][slot],
        temp: x.temps.length ? Math.round(x.temps.reduce((a, v) => a + v, 0) / x.temps.length) : null,
        code: modeOf(x.codes),
      }
    }
  }
  const byDate = {}
  json.daily.time.forEach((date, i) => {
    const prob = json.daily.precipitation_probability_max?.[i]
    if (prob == null) return // dia sem chance de chuva informada: cobre a tendência
    byDate[date] = {
      min: json.daily.temperature_2m_min?.[i],
      max: json.daily.temperature_2m_max?.[i],
      prob,
      mm: json.daily.precipitation_sum?.[i] ?? 0,
      code: json.daily.weather_code?.[i],
      ...(hourly[date] ?? { m: null, t: null, n: null, periods: {} }),
    }
  })
  return byDate
}

async function fetchTrend({ lat, lon }) {
  const json = await getJson(
    `https://seasonal-api.open-meteo.com/v1/seasonal?latitude=${lat}&longitude=${lon}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=46&timezone=auto`
  )
  const daily = json?.daily
  if (!daily?.time) return null
  const keysOf = (v) => Object.keys(daily).filter((k) => k === v || k.startsWith(`${v}_`))
  const kMax = keysOf('temperature_2m_max')
  const kMin = keysOf('temperature_2m_min')
  const kPrec = keysOf('precipitation_sum')
  const byDate = {}
  daily.time.forEach((date, i) => {
    const mins = kMin.map((k) => daily[k]?.[i])
    const maxs = kMax.map((k) => daily[k]?.[i])
    const precs = kPrec.map((k) => daily[k]?.[i]).filter((v) => v != null)
    if (!precs.length) return
    const mm = median(precs)
    const prob = precs.length < 10 ? (mm >= 1 ? 60 : 20) : (precs.filter((v) => v >= 1).length / precs.length) * 100
    byDate[date] = { min: median(mins), max: median(maxs), prob, mm }
  })
  return byDate
}

// Média histórica 2016–2025 numa janela de ±2 dias, por dia/mês. Baixa uma vez
// por cidade e guarda no navegador.
async function fetchClimatology({ lat, lon }, needed) {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`
  const cache = lsGet(LS_CLIM) || {}
  const stored = cache[cacheKey] || {}
  const missing = needed.filter((k) => !stored[k])
  if (!missing.length) return stored
  const json = await getJson(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&start_date=2016-01-01&end_date=2025-12-31` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`
  )
  const d = json?.daily
  if (!d?.time) return stored
  const byMd = {}
  d.time.forEach((date, i) => {
    const md = date.slice(5)
    ;(byMd[md] = byMd[md] || []).push(i)
  })
  for (const md of missing) {
    // vizinhos ±2 dias num ano de referência não bissexto
    const idxs = []
    for (let off = -2; off <= 2; off++) {
      const ref = new Date(2021, Number(md.slice(0, 2)) - 1, Number(md.slice(3)) + off)
      idxs.push(...(byMd[`${pad(ref.getMonth() + 1)}-${pad(ref.getDate())}`] ?? []))
    }
    if (!idxs.length) continue
    const precs = idxs.map((i) => d.precipitation_sum?.[i]).filter((v) => v != null)
    stored[md] = {
      min: mean(idxs.map((i) => d.temperature_2m_min?.[i])),
      max: mean(idxs.map((i) => d.temperature_2m_max?.[i])),
      prob: precs.length ? (precs.filter((v) => v >= 1).length / precs.length) * 100 : 0,
      mm: mean(precs) ?? 0,
    }
  }
  cache[cacheKey] = stored
  lsSet(LS_CLIM, cache)
  return stored
}

// ---- leitura de um dia -----------------------------------------------------

function buildReading({ date, today, forecast, trend, clim }) {
  const diff = diffDays(today, date)
  if (diff < 0) return null
  const f = forecast?.[date]
  if (diff <= 15 && f) {
    const icon = iconFromWmo(f.code)
    return {
      src: 'prev',
      conf: diff <= 7 ? 'alta' : 'media',
      min: Math.round(f.min),
      max: Math.round(f.max),
      prob: Math.round(f.prob),
      mm: Math.round(f.mm * 10) / 10,
      m: f.m,
      t: f.t,
      n: f.n,
      periods: f.periods,
      icon: icon.emoji,
      desc: icon.label,
      code: f.code,
    }
  }
  const tr = trend?.[date]
  if (tr && tr.min != null && tr.max != null) {
    const icon = iconFromChance(tr.prob)
    return {
      src: 'trend',
      conf: 'baixa',
      min: Math.round(tr.min),
      max: Math.round(tr.max),
      prob: Math.round(tr.prob),
      mm: Math.round(tr.mm * 10) / 10,
      icon: icon.emoji,
      desc: icon.label,
    }
  }
  const h = clim?.[date.slice(5)]
  if (h && h.min != null && h.max != null) {
    const icon = iconFromChance(h.prob)
    return {
      src: 'hist',
      conf: 'reserva',
      min: Math.round(h.min),
      max: Math.round(h.max),
      prob: Math.round(h.prob),
      mm: Math.round(h.mm * 10) / 10,
      icon: icon.emoji,
      desc: icon.label,
    }
  }
  return null
}

// ---- mudanças desde a leitura de um dia anterior ---------------------------

function diffReading(prev, cur) {
  if (!cur || cur.src === 'hist') return null
  const changes = []
  // o dia era tendência (ou não existia na base) e agora vem da previsão diária
  if (cur.src === 'prev' && (!prev || prev.src !== 'prev')) return { entered: true, changes, prev }
  // tendência só se compara com tendência, previsão só com previsão
  if (!prev || prev.src !== cur.src) return null
  if (prev.min !== cur.min) changes.push(`min ${prev.min}° → ${cur.min}°`)
  if (prev.max !== cur.max) changes.push(`máx ${prev.max}° → ${cur.max}°`)
  if (Math.abs(prev.prob - cur.prob) >= 10) changes.push(`chuva ${prev.prob}% → ${cur.prob}%`)
  if (Math.abs((prev.mm ?? 0) - (cur.mm ?? 0)) >= 1) changes.push(`${prev.mm} mm → ${cur.mm} mm`)
  if (cur.src === 'prev') {
    for (const [k, label] of [['m', 'manhã'], ['t', 'tarde'], ['n', 'noite']]) {
      if (prev[k] != null && cur[k] != null && Math.abs(prev[k] - cur[k]) >= 15) {
        changes.push(`${label} ${prev[k]}% → ${cur[k]}%`)
      }
    }
    if (prev.icon !== cur.icon) changes.push(`${prev.icon} → ${cur.icon}`)
  }
  return changes.length ? { entered: false, changes, prev } : null
}

// ---- visual ----------------------------------------------------------------

const CONF_DOT = {
  alta: { background: '#5f8a4f', border: '1px solid #5f8a4f' },
  media: { background: '#d9a521', border: '1px solid #d9a521' },
  // tendência: laranja cheio · média histórica: laranja pontilhado
  baixa: { background: '#c8641e', border: '1px solid #c8641e' },
  reserva: {
    backgroundColor: 'transparent',
    backgroundImage: 'radial-gradient(#c8641e 0.9px, transparent 1.1px)',
    backgroundSize: '3px 3px',
    border: '1px solid #c8641e',
  },
}
const CONF_TEXT = {
  alta: 'confiança alta (previsão diária, até 7 dias)',
  media: 'confiança média (previsão diária, 8 a 16 dias)',
  baixa: 'confiança baixa (tendência ECMWF, indica a semana e não o dia exato)',
  reserva: 'reserva (média histórica 2016–2025)',
}

function rainStyle(prob, src) {
  let background = '#f5f0e3'
  let color = '#3b2a22'
  if (prob >= 70) {
    background = '#37656e'
    color = '#f5f0e3'
  } else if (prob >= 50) background = '#9fbfc5'
  else if (prob >= 20) background = '#dce8ea'
  const style = { backgroundColor: background, color }
  return style
}

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

function mondayOf(iso) {
  const d = parseIso(iso)
  const wd = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - wd)
  return toIso(d)
}

export default function WeatherTab({ destinations, accommodations, activities, transport }) {
  const [weather, setWeather] = useState({}) // `${norm(city)}|${date}` -> leitura
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [baseDay, setBaseDay] = useState(null)
  const [changesByKey, setChangesByKey] = useState({})
  const [selected, setSelected] = useState(null)
  const [changesOpen, setChangesOpen] = useState(false) // "Mudanças" começa recolhida
  // Barra de rolagem extra no topo do calendário, sincronizada com a de baixo.
  const topScrollRef = useRef(null)
  const bodyScrollRef = useRef(null)
  const syncing = useRef(false)
  const syncScroll = (from, to) => {
    if (syncing.current || !from.current || !to.current) return
    syncing.current = true
    to.current.scrollLeft = from.current.scrollLeft
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }

  const days = useMemo(
    () => deriveDays({ destinations, accommodations, activities, transport }),
    [destinations, accommodations, activities, transport]
  )

  // Lista única de cidades (do Roteiro) e as datas em que cada uma aparece
  const cities = useMemo(() => {
    const map = new Map()
    for (const [date, list] of days) {
      for (const { city, role } of list) {
        if (role === 'voo') continue
        const k = norm(city)
        if (!map.has(k)) map.set(k, { key: k, name: city, dates: [] })
        map.get(k).dates.push(date)
      }
    }
    return Array.from(map.values())
  }, [days])
  const citiesSignature = useMemo(
    () => cities.map((c) => `${c.key}:${c.dates.join(',')}`).join('|'),
    [cities]
  )

  // Atualização diária: se já existe uma leitura de HOJE para as mesmas
  // cidades/datas, usa a salva. Só busca de novo amanhã, quando o Roteiro
  // mudar, ou se a pessoa tocar em "Atualizar agora" (force).
  const load = useCallback(async (force = false) => {
    if (!cities.length) return
    const today = toIso(new Date())
    const hist0 = lsGet(LS_HIST) || []
    const saved = hist0.find((h) => h.day === today)
    if (!force && saved && !saved.partial && saved.v === 2 && saved.sig === citiesSignature && Object.keys(saved.data).length) {
      const base0 = [...hist0].reverse().find((h) => h.day < today)
      const changes0 = {}
      if (base0) {
        for (const [key, cur] of Object.entries(saved.data)) {
          const d = diffReading(base0.data[key], cur)
          if (d) changes0[key] = d
        }
      }
      setChangesByKey(changes0)
      setBaseDay(base0?.day ?? null)
      setWeather(saved.data)
      const at = saved.at ? new Date(saved.at) : null
      setStatus(
        `Leitura de hoje${at ? ` (${pad(at.getHours())}:${pad(at.getMinutes())})` : ''}. Atualiza sozinha amanhã, ou toque em “Atualizar agora”.`
      )
      return
    }
    setLoading(true)
    setStatus('')
    const out = {}
    const failed = []
    await Promise.all(
      cities.map(async (c) => {
        const geo = await geocode(c.name)
        if (!geo) {
          failed.push(c.name)
          return
        }
        const [forecast, trend] = await Promise.all([fetchForecast(geo), fetchTrend(geo)])
        const needHist = c.dates.filter((d) => {
          const diff = diffDays(today, d)
          if (diff < 0) return false
          if (diff <= 15 && forecast?.[d]) return false
          return !trend?.[d]
        })
        const clim = needHist.length
          ? await fetchClimatology(geo, Array.from(new Set(needHist.map((d) => d.slice(5)))))
          : null
        for (const date of c.dates) {
          const reading = buildReading({ date, today, forecast, trend, clim })
          if (reading) out[`${c.key}|${date}`] = reading
        }
      })
    )

    const hist = lsGet(LS_HIST) || []
    if (!Object.keys(out).length) {
      // sem conexão ou sem dados: mostra a última leitura salva
      const last = hist[hist.length - 1]
      if (last) {
        setWeather(last.data)
        setBaseDay(null)
        setStatus(`Sem conexão: mostrando a última leitura salva (${fmtDM(last.day)}).`)
      } else {
        setStatus('Não foi possível buscar o clima agora. Verifique a conexão.')
      }
      setLoading(false)
      return
    }

    // compara com a leitura mais recente de um DIA ANTERIOR
    const base = [...hist].reverse().find((h) => h.day < today)
    const changes = {}
    if (base) {
      for (const [key, cur] of Object.entries(out)) {
        const d = diffReading(base.data[key], cur)
        if (d) changes[key] = d
      }
    }
    setChangesByKey(changes)
    setBaseDay(base?.day ?? null)
    setWeather(out)

    // leituras do mesmo dia se substituem
    const next = hist.filter((h) => h.day !== today)
    next.push({ day: today, data: out, sig: citiesSignature, v: 2, at: Date.now(), partial: failed.length > 0 })
    lsSet(LS_HIST, next.slice(-MAX_HIST))

    const msgs = []
    if (failed.length) msgs.push(`Cidade não encontrada: ${failed.join(', ')}.`)
    setStatus(msgs.join(' ') || `Atualizado às ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`)
    setLoading(false)
  }, [cities, citiesSignature])

  // Busca ao abrir a aba e quando o Roteiro muda (cidades/datas)
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citiesSignature])

  // ---- calendário -----------------------------------------------------------
  const tripDates = useMemo(() => Array.from(days.keys()).sort(), [days])
  const weeks = useMemo(() => {
    if (!tripDates.length) return []
    const first = mondayOf(tripDates[0])
    const lastDate = tripDates[tripDates.length - 1]
    const out = []
    for (let start = first; start <= lastDate; start = addDays(start, 7)) {
      out.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)))
    }
    return out
  }, [tripDates])

  // Lista de mudanças por dia e cidade
  const changeList = useMemo(() => {
    const rows = []
    for (const [date, list] of days) {
      for (const { city } of list) {
        const ch = changesByKey[`${norm(city)}|${date}`]
        if (!ch) continue
        rows.push({
          date,
          city,
          text: ch.entered ? 'entrou na previsão diária' : ch.changes.join(', '),
        })
      }
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date))
  }, [days, changesByKey])

  if (!tripDates.length) {
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-center font-mono text-xs text-muted-foreground">
        Cadastre cidades com datas no Roteiro para ver a previsão do tempo.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="clima-heading">
        <div className="flex items-center justify-between gap-2">
          <h2 id="clima-heading" className="font-display text-xl font-semibold text-foreground">
            Clima do roteiro
          </h2>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-foreground disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3 w-3" aria-hidden="true" />}
            Atualizar agora
          </button>
        </div>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {status || (loading ? 'Buscando previsão…' : '')}
        </p>
      </section>

      {/* Mudanças desde a leitura de um dia anterior */}
      <section aria-labelledby="mudancas-heading" className="rounded-xl border border-border bg-card p-3">
        <h3 id="mudancas-heading" className="m-0">
          <button
            type="button"
            onClick={() => setChangesOpen((v) => !v)}
            aria-expanded={changesOpen}
            className="flex w-full items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            <span>
              Mudanças desde a leitura anterior
              {baseDay && changeList.length > 0 ? ` · ${changeList.length}` : ''}
            </span>
            {changesOpen ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </h3>
        {!changesOpen ? null : !baseDay ? (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Primeira leitura salva. As mudanças aparecem a partir da próxima leitura em outro dia.
          </p>
        ) : changeList.length === 0 ? (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">Nada mudou desde {fmtDM(baseDay)}.</p>
        ) : (
          <>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">Base: {fmtDM(baseDay)}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {changeList.map((r) => (
                <li key={`${r.city}-${r.date}`} className="font-mono text-[11px] text-foreground">
                  <span className="font-semibold">
                    {fmtDM(r.date)} · {r.city}:
                  </span>{' '}
                  {r.text}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Legenda */}
      <section className="flex flex-col gap-1.5 font-mono text-[10px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {[
            ['#f5f0e3', '< 20%'],
            ['#dce8ea', '20–49%'],
            ['#9fbfc5', '50–69%'],
            ['#37656e', '≥ 70%'],
          ].map(([bg, label]) => (
            <span key={label} className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm border border-border" style={{ backgroundColor: bg }} />
              {label}
            </span>
          ))}
          <span>chance de chuva</span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded-sm" style={{ border: '2px solid #d9a521' }} />
            mudou desde a leitura anterior
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {[
            ['alta', 'alta'],
            ['media', 'média'],
            ['baixa', 'tendência'],
            ['reserva', 'média histórica'],
          ].map(([k, label]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={CONF_DOT[k]} />
              {label}
            </span>
          ))}
        </div>
      </section>

      {/* Calendário semanal (rola de lado no celular) */}
      <div
        ref={topScrollRef}
        onScroll={() => syncScroll(topScrollRef, bodyScrollRef)}
        className="-mx-4 overflow-x-auto px-4"
        style={{ scrollbarWidth: 'thin' }}
        aria-hidden="true"
      >
        <div className="h-2 min-w-[700px]" />
      </div>
      <div
        ref={bodyScrollRef}
        onScroll={() => syncScroll(bodyScrollRef, topScrollRef)}
        className="-mx-4 overflow-x-auto px-4 pb-2"
      >
        <div className="min-w-[700px]">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => (
              <p key={w} className="text-center font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {w}
              </p>
            ))}
          </div>
          <div className="mt-1 flex flex-col gap-1">
            {weeks.map((week) => (
              <div key={week[0]} className="grid grid-cols-7 gap-1">
                {week.map((date) => {
                  const list = days.get(date)
                  const inTrip = !!list
                  return (
                    <div
                      key={date}
                      className={`min-h-[96px] rounded-lg border border-border p-1 ${
                        inTrip ? 'bg-background' : 'bg-muted/40 opacity-40'
                      }`}
                    >
                      <p className="mb-1 font-mono text-[10px] text-muted-foreground">{fmtDM(date)}</p>
                      <div className="flex flex-col gap-1">
                        {(list ?? []).map(({ city, role }) => {
                          if (role === 'voo') {
                            return (
                              <div
                                key={city}
                                className="rounded-md border border-border bg-card p-1 font-mono text-[9px] text-muted-foreground"
                              >
                                <Plane className="mb-0.5 inline h-3 w-3" aria-hidden="true" /> {city}
                              </div>
                            )
                          }
                          const key = `${norm(city)}|${date}`
                          const w = weather[key]
                          const ch = changesByKey[key]
                          const isSel = selected?.key === key
                          return (
                            <button
                              type="button"
                              key={key}
                              onClick={() => setSelected(isSel ? null : { key, city, date, role })}
                              title={w ? `${city}: ${CONF_TEXT[w.conf]}` : city}
                              className="rounded-md p-1 text-left font-mono"
                              style={{
                                ...(w ? rainStyle(w.prob, w.src) : { backgroundColor: '#f5f0e3', color: '#6f6350' }),
                                border: ch
                                  ? '2px solid #d9a521'
                                  : isSel
                                  ? '2px solid #37656e'
                                  : '1px solid rgba(59,42,34,0.15)',
                              }}
                            >
                              <span className="flex items-center gap-1">
                                {w && <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={CONF_DOT[w.conf]} />}
                                <span className="truncate text-[10px] font-semibold">{city}</span>
                              </span>
                              {w ? (
                                <>
                                  <span className="mt-0.5 flex items-center justify-between text-[10px]">
                                    <span>{w.icon}</span>
                                    <span className="flex items-center gap-0.5">
                                      <Droplets className="h-2.5 w-2.5 opacity-60" aria-hidden="true" />
                                      {w.prob}%
                                    </span>
                                  </span>
                                  <span className="flex items-center justify-between gap-0.5 text-[10px]">
                                    <span style={{ color: w.prob >= 70 ? '#bfe0e6' : '#2f6fa8' }}>
                                      {w.src === 'prev' ? '' : '~'}
                                      {w.min}°
                                    </span>
                                    <Thermometer className="h-2.5 w-2.5 shrink-0 opacity-50" aria-hidden="true" />
                                    <span style={{ color: w.prob >= 70 ? '#ffd2c4' : '#b3402a' }}>
                                      {w.src === 'prev' ? '' : '~'}
                                      {w.max}°
                                    </span>
                                  </span>
                                  {w.src !== 'prev' && (
                                    <span className="block text-[8px] opacity-80">
                                      {w.src === 'trend' ? 'tendência ECMWF' : 'média histórica'}
                                    </span>
                                  )}
                                  {isSel && (
                                    <span
                                      className="mt-1 block pt-1 text-[10px] leading-snug"
                                      style={{ borderTop: '1px solid rgba(128,128,128,0.35)' }}
                                    >
                                      {w.src === 'prev' && w.periods && Object.keys(w.periods).length > 0 ? (
                                        [['m', 'manhã'], ['t', 'tarde'], ['n', 'noite']].map(([k, label]) => {
                                          const p = w.periods[k]
                                          if (!p) return null
                                          const ic = p.code != null ? iconFromWmo(p.code).emoji : ''
                                          return (
                                            <span key={k} className="mb-1 block">
                                              <span className="block font-semibold">{label}</span>
                                              <span className="flex items-center justify-between gap-1">
                                                <span>{ic}</span>
                                                <span className="flex items-center gap-0.5">
                                                  <Droplets className="h-2.5 w-2.5 opacity-60" aria-hidden="true" />
                                                  {p.prob ?? '–'}%
                                                </span>
                                                <span>{p.temp != null ? `${p.temp}°` : '–'}</span>
                                              </span>
                                            </span>
                                          )
                                        })
                                      ) : (
                                        <span className="block opacity-80">Sem detalhe por turno para este dia.</span>
                                      )}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="block text-[9px] opacity-70">
                                  {loading ? '…' : diffDays(toIso(new Date()), date) < 0 ? 'já passou' : 'sem dados'}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="font-mono text-[10px] text-muted-foreground">
        Cidades e datas vêm do Roteiro. Dados: Open-Meteo (previsão diária, tendência ECMWF EC46 e média histórica
        2016–2025). O histórico de leituras fica salvo neste navegador.
      </p>
    </div>
  )
}
