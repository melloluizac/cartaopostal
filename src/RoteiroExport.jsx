import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Hotel, MapPin, Plane, Printer, X } from 'lucide-react'

// ---------------------------------------------------------------------------
// Exportar o Roteiro: abre uma página limpa (uma seção por dia, linha do tempo
// com ícone · horário · nome) que a pessoa salva como PDF pela impressão do
// navegador, ou copia como texto pra colar no WhatsApp.
// Por padrão NÃO inclui valores, links de reserva nem notas (é pra compartilhar).
// ---------------------------------------------------------------------------

const SHIFT_SORT = { Manhã: '08:00', Tarde: '13:00', Noite: '19:00' }
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

const parseIso = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const fmtDate = (iso) => {
  const d = parseIso(iso)
  return `${WEEKDAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`
}
const diffDays = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000)
const hhmm = (t) => (t ? String(t).slice(0, 5) : '')

function buildDays({ destinations, accommodations, activities, transport }) {
  const cityOf = (destId) => destinations.find((d) => d.id === destId)?.city_name ?? ''
  const byDate = new Map()
  const push = (date, item) => {
    if (!date) return
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date).push(item)
  }

  for (const a of accommodations) {
    const city = cityOf(a.destination_id)
    if (a.check_in) {
      push(a.check_in, { kind: 'hotel', sort: '14:00', label: '', name: a.hotel_name, tag: 'Check-in', city })
    }
    if (a.check_out && a.check_out !== a.check_in) {
      push(a.check_out, { kind: 'hotel', sort: '10:00', label: '', name: a.hotel_name, tag: 'Check-out', city })
    }
  }
  for (const a of activities) {
    const time = hhmm(a.exact_time)
    push(a.assigned_date, {
      kind: 'activity',
      sort: time || SHIFT_SORT[a.shift] || '99:99',
      label: time || a.shift || '',
      name: a.activity_name,
      tag: '',
      city: cityOf(a.destination_id),
    })
  }
  for (const t of transport) {
    const dep = hhmm(t.departure_time)
    const arr = hhmm(t.arrival_time)
    push(t.departure_date, {
      kind: 'transport',
      sort: dep || '99:99',
      label: dep,
      name: `${t.origin_city} → ${t.destination_city}`,
      tag: arr ? `chegada ${arr}` : '',
      from: t.origin_city,
      to: t.destination_city,
    })
  }

  const dates = Array.from(byDate.keys()).sort()
  if (!dates.length) return []
  const first = dates[0]
  return dates.map((date) => {
    const items = byDate.get(date).sort((x, y) => x.sort.localeCompare(y.sort))
    const cities = []
    for (const it of items) {
      const list = it.kind === 'transport' ? [it.from, it.to] : [it.city]
      for (const c of list) if (c && !cities.includes(c)) cities.push(c)
    }
    const transportItem = items.find((i) => i.kind === 'transport')
    const cityLabel = transportItem
      ? `${transportItem.from} → ${transportItem.to}`
      : cities.join(' · ')
    return { date, number: diffDays(first, date) + 1, cityLabel, cities, items }
  })
}

const KIND_ICON = { activity: MapPin, hotel: Hotel, transport: Plane }
const KIND_EMOJI = { activity: '📍', hotel: '🏨', transport: '🚆' }

function toText(title, days) {
  const lines = [`*${title}*`, '']
  for (const d of days) {
    lines.push(`*Dia ${d.number} · ${fmtDate(d.date)}${d.cityLabel ? ` · ${d.cityLabel}` : ''}*`)
    for (const it of d.items) {
      const when = it.label ? `${it.label} ` : ''
      lines.push(`${KIND_EMOJI[it.kind]} ${when}${it.name}${it.tag ? ` (${it.tag})` : ''}`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

const CSS = `
.rx-overlay{position:fixed;inset:0;z-index:100;background:#cfc7b4;overflow:auto;padding:0 12px 32px;
  font-family:"IBM Plex Mono",ui-monospace,monospace;color:#2b2a26}
.rx-toolbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;justify-content:flex-end;
  max-width:680px;margin:0 auto;padding:12px 0}
.rx-btn{display:inline-flex;align-items:center;gap:6px;border-radius:8px;border:1px solid #37656e;background:#f7f1e3;
  color:#37656e;font:inherit;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:8px 12px;cursor:pointer}
.rx-btn.primary{background:#37656e;color:#f7f1e3}
.rx-btn svg{width:14px;height:14px}
.rx-page{max-width:680px;margin:0 auto;background:#f7f1e3;padding:36px 40px 40px;box-shadow:0 2px 16px rgba(0,0,0,.18)}
.rx-title{font-family:"Playfair Display",Georgia,serif;font-size:30px;margin:0;color:#37656e;letter-spacing:-.3px;font-weight:600}
.rx-sub{font-size:11px;color:#7a7568;text-transform:uppercase;letter-spacing:.08em;margin:4px 0 0}
.rx-rule{height:2px;background:#37656e;margin:18px 0 6px;opacity:.85}
.rx-day{margin-top:22px;break-inside:avoid;page-break-inside:avoid}
.rx-dayhead{display:flex;align-items:baseline;gap:10px;border-bottom:1px solid #d9cfb8;padding-bottom:6px;margin-bottom:10px}
.rx-daynum{font-family:"Playfair Display",Georgia,serif;font-size:19px;color:#b85c38;font-weight:700}
.rx-daydate{font-size:12px}
.rx-city{margin-left:auto;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#37656e;text-align:right}
.rx-tl{position:relative;margin:0;padding:0;list-style:none}
.rx-tl:before{content:"";position:absolute;left:62px;top:6px;bottom:6px;width:1px;background:#d9cfb8}
.rx-item{display:grid;grid-template-columns:48px 28px 1fr;align-items:center;gap:8px;padding:6px 0}
.rx-time{font-size:12px;color:#7a7568;text-align:right}
.rx-ico{width:28px;height:28px;border-radius:50%;background:#f7f1e3;border:1.5px solid #37656e;display:flex;
  align-items:center;justify-content:center;z-index:1;color:#37656e}
.rx-ico svg{width:15px;height:15px}
.rx-ico.hotel{border-color:#b85c38;color:#b85c38}
.rx-ico.transport{border-color:#6b7d5a;color:#6b7d5a}
.rx-name{font-size:13px;line-height:1.3}
.rx-tag{display:block;font-size:10px;color:#7a7568;text-transform:uppercase;letter-spacing:.06em;margin-top:1px}
.rx-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:26px;padding-top:12px;border-top:1px solid #d9cfb8;
  font-size:10px;color:#7a7568;text-transform:uppercase;letter-spacing:.06em}
.rx-legend span{display:inline-flex;align-items:center;gap:6px}
.rx-legend svg{width:13px;height:13px}
.rx-foot{margin-top:14px;font-size:10px;color:#7a7568;text-align:center}
.rx-empty{padding:32px 0;text-align:center;font-size:12px;color:#7a7568}
@media (max-width:520px){.rx-page{padding:24px 18px 28px}}
@media print{
  body > #root{display:none !important}
  .rx-overlay{position:static !important;background:#fff !important;overflow:visible !important;padding:0 !important}
  .rx-toolbar{display:none !important}
  .rx-page{box-shadow:none !important;max-width:none !important;padding:0 !important;background:#fff !important}
  .rx-ico{background:#fff}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{margin:14mm}
}
`

export default function RoteiroExport({ trip, destinations, accommodations, activities, transport, className }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const days = useMemo(
    () => (open ? buildDays({ destinations, accommodations, activities, transport }) : []),
    [open, destinations, accommodations, activities, transport]
  )
  const title = trip?.title ?? 'Roteiro'
  const route = useMemo(() => {
    const seq = []
    for (const d of days) for (const c of d.cities) if (!seq.includes(c)) seq.push(c)
    return seq.join(' → ')
  }, [days])

  function handlePrint() {
    const previous = document.title
    document.title = `Roteiro - ${title}`
    try {
      window.print()
    } finally {
      document.title = previous
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(toText(title, days))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copie o texto abaixo:', toText(title, days))
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Exportar
      </button>

      {open &&
        createPortal(
          <div className="rx-overlay">
            <style>{CSS}</style>
            <div className="rx-toolbar">
              <button type="button" className="rx-btn" onClick={handleCopy} disabled={!days.length}>
                <Copy aria-hidden="true" /> {copied ? 'Copiado!' : 'Copiar texto'}
              </button>
              <button type="button" className="rx-btn primary" onClick={handlePrint} disabled={!days.length}>
                <Printer aria-hidden="true" /> Salvar PDF
              </button>
              <button type="button" className="rx-btn" onClick={() => setOpen(false)} aria-label="Fechar">
                <X aria-hidden="true" />
              </button>
            </div>

            <div className="rx-page">
              <h1 className="rx-title">{title}</h1>
              <p className="rx-sub">Roteiro{route ? ` · ${route}` : ''}</p>
              <div className="rx-rule" />

              {days.length === 0 && <p className="rx-empty">Nenhum item com data no roteiro ainda.</p>}

              {days.map((d) => (
                <section key={d.date} className="rx-day">
                  <div className="rx-dayhead">
                    <span className="rx-daynum">Dia {d.number}</span>
                    <span className="rx-daydate">{fmtDate(d.date)}</span>
                    {d.cityLabel && <span className="rx-city">{d.cityLabel}</span>}
                  </div>
                  <ul className="rx-tl">
                    {d.items.map((it, i) => {
                      const Icon = KIND_ICON[it.kind]
                      return (
                        <li key={i} className="rx-item">
                          <span className="rx-time">{it.label}</span>
                          <span className={`rx-ico ${it.kind}`}>
                            <Icon aria-hidden="true" />
                          </span>
                          <span className="rx-name">
                            {it.name}
                            {it.tag && <span className="rx-tag">{it.tag}</span>}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}

              {days.length > 0 && (
                <div className="rx-legend">
                  <span>
                    <MapPin aria-hidden="true" /> Passeio
                  </span>
                  <span>
                    <Hotel aria-hidden="true" /> Hospedagem
                  </span>
                  <span>
                    <Plane aria-hidden="true" /> Transporte
                  </span>
                </div>
              )}
              <p className="rx-foot">Gerado pelo Cartão Postal</p>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
