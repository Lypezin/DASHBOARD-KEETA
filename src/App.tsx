import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Filter,
  LoaderCircle,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Upload,
} from 'lucide-react'
import clsx from 'clsx'
import { addDays, format, getDaysInMonth } from 'date-fns'
import { fetchDashboardData, importDeliveryRows, upsertDailyTargets, upsertShiftConfig } from './supabase'
import type { DailyTarget, DeliveryRow, Filters, ShiftConfig } from './types'

const defaultShifts: ShiftConfig[] = [
  { turno: 'Almoco', expected_hours: 4 },
  { turno: 'Lanche', expected_hours: 3 },
  { turno: 'Jantar', expected_hours: 4 },
  { turno: 'Ceia', expected_hours: 2 },
]

function toIsoDate(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

function mondayOf(date: Date) {
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(date)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(date.getDate() + diff)
  return monday
}

function firstWeekStart(year: number) {
  return mondayOf(new Date(year, 0, 1))
}

function getWeekInfo(date = new Date()) {
  const year = date.getFullYear()
  const start = firstWeekStart(year)
  const weekNumber = Math.floor((mondayOf(date).getTime() - start.getTime()) / 604800000) + 1
  return { year, weekNumber: Math.max(1, weekNumber) }
}

function getWeekRange(year: number, weekNumber: number) {
  const start = addDays(firstWeekStart(year), (weekNumber - 1) * 7)
  return {
    startDate: toIsoDate(start),
    endDate: toIsoDate(addDays(start, 6)),
  }
}

const currentWeek = getWeekInfo()

const emptyFilters: Filters = {
  startDate: '',
  endDate: '',
  weekYear: String(currentWeek.year),
  weekNumber: String(currentWeek.weekNumber),
  name: '',
  turno: '',
  modal: '',
  utr: '',
}

const modalColors = ['#141414', '#ffcc00', '#2e7d32', '#e6502e', '#4776e6', '#78716c']
const DashboardCharts = lazy(() => import('./Charts').then((module) => ({ default: module.DashboardCharts })))

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value || 0)
}

function formatPercent(value: number) {
  return `${formatNumber(value, 1)}%`
}

function formatDurationHours(value: number) {
  const totalSeconds = Math.round((value || 0) * 3600)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function optionValues(rows: DeliveryRow[], key: keyof DeliveryRow) {
  return Array.from(new Set(rows.map((row) => String(row[key] ?? '').trim()).filter(Boolean))).sort()
}

export function App() {
  const [rows, setRows] = useState<DeliveryRow[]>([])
  const [targets, setTargets] = useState<DailyTarget[]>([])
  const [shifts, setShifts] = useState<ShiftConfig[]>(defaultShifts)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [adminMonth, setAdminMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [monthTargets, setMonthTargets] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('Pronto para carregar dados.')
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'admin' | 'import'>('dashboard')

  async function refreshData() {
    setLoading(true)
    try {
      const data = await fetchDashboardData()
      setRows(data.rows)
      setTargets(data.targets)
      setShifts(data.shifts.length ? data.shifts : defaultShifts)
      setStatus(`Dados atualizados: ${data.rows.length} linhas carregadas.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar dados.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshData()
  }, [])

  useEffect(() => {
    const nextTargets = Object.fromEntries(
      targets
        .filter((target) => target.target_date.startsWith(adminMonth) && !target.turno)
        .map((target) => [target.target_date, String(Number(target.required_hours || 0))]),
    )
    setMonthTargets(nextTargets)
  }, [adminMonth, targets])

  const effectiveRange = useMemo(() => {
    const hasInterval = Boolean(filters.startDate || filters.endDate)
    if (hasInterval) {
      return {
        startDate: filters.startDate,
        endDate: filters.endDate,
        label: 'Intervalo personalizado',
      }
    }

    const range = getWeekRange(Number(filters.weekYear), Number(filters.weekNumber))
    return {
      ...range,
      label: `Semana ${filters.weekNumber} de ${filters.weekYear}`,
    }
  }, [filters.endDate, filters.startDate, filters.weekNumber, filters.weekYear])

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const dateOk = (!effectiveRange.startDate || (row.delivery_date ?? '') >= effectiveRange.startDate)
        && (!effectiveRange.endDate || (row.delivery_date ?? '') <= effectiveRange.endDate)
      const nameOk = !filters.name || row.conc.toLowerCase().includes(filters.name.toLowerCase())
      const turnoOk = !filters.turno || row.turno === filters.turno
      const modalOk = !filters.modal || row.modal === filters.modal
      const utrOk = !filters.utr || row.utr === filters.utr
      return dateOk && nameOk && turnoOk && modalOk && utrOk
    })
  }, [effectiveRange.endDate, effectiveRange.startDate, filters, rows])

  const summary = useMemo(() => {
    const delivered = filteredRows.reduce((sum, row) => sum + Number(row.delivered_hours || 0), 0)
    const avgOnline = filteredRows.length
      ? filteredRows.reduce((sum, row) => sum + Number(row.online_time_pct || 0), 0) / filteredRows.length
      : 0
    const couriers = new Set(filteredRows.map((row) => row.courier_id_txt).filter(Boolean)).size

    const targetTotal = targets
      .filter((target) => {
        const dateOk = (!effectiveRange.startDate || target.target_date >= effectiveRange.startDate)
          && (!effectiveRange.endDate || target.target_date <= effectiveRange.endDate)
        const turnoOk = !filters.turno || !target.turno || target.turno === filters.turno
        return dateOk && turnoOk
      })
      .reduce((sum, target) => sum + Number(target.required_hours || 0), 0)

    return {
      delivered,
      avgOnline,
      couriers,
      targetTotal,
      targetAdherence: targetTotal > 0 ? (delivered / targetTotal) * 100 : 0,
    }
  }, [effectiveRange.endDate, effectiveRange.startDate, filteredRows, filters.turno, targets])

  const byTurno = useMemo(() => {
    const grouped = new Map<string, { turno: string; delivered: number; target: number; online: number; rows: number }>()
    for (const row of filteredRows) {
      const item = grouped.get(row.turno) ?? { turno: row.turno || 'Sem turno', delivered: 0, target: 0, online: 0, rows: 0 }
      item.delivered += Number(row.delivered_hours || 0)
      item.online += Number(row.online_time_pct || 0)
      item.rows += 1
      grouped.set(item.turno, item)
    }
    for (const target of targets) {
      const dateOk = (!effectiveRange.startDate || target.target_date >= effectiveRange.startDate)
        && (!effectiveRange.endDate || target.target_date <= effectiveRange.endDate)
      if (!dateOk) continue
      if (filters.turno && target.turno !== filters.turno) continue
      if (!target.turno) continue
      const item = grouped.get(target.turno) ?? { turno: target.turno, delivered: 0, target: 0, online: 0, rows: 0 }
      item.target += Number(target.required_hours || 0)
      grouped.set(item.turno, item)
    }
    return Array.from(grouped.values()).map((item) => ({
      ...item,
      online: item.rows ? item.online / item.rows : 0,
    }))
  }, [effectiveRange.endDate, effectiveRange.startDate, filteredRows, filters.turno, targets])

  const byModal = useMemo(() => {
    const grouped = new Map<string, number>()
    for (const row of filteredRows) grouped.set(row.modal || 'Sem modal', (grouped.get(row.modal || 'Sem modal') ?? 0) + row.delivered_hours)
    return Array.from(grouped, ([name, value]) => ({ name, value }))
  }, [filteredRows])

  async function handleImport(file: File | null) {
    if (!file) return
    setLoading(true)
    try {
      const { parseWorkbook } = await import('./importer')
      const parsed = await parseWorkbook(file)
      const batchId = await importDeliveryRows(file.name, parsed)
      setStatus(`Importacao concluida: ${parsed.length} linhas no lote ${batchId}.`)
      await refreshData()
      setActiveTab('dashboard')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Erro na importacao.')
    } finally {
      setLoading(false)
    }
  }

  const adminDays = useMemo(() => {
    const [year, month] = adminMonth.split('-').map(Number)
    const count = getDaysInMonth(new Date(year, month - 1, 1))
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(year, month - 1, index + 1)
      return {
        iso: toIsoDate(date),
        day: index + 1,
        weekday: new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', ''),
      }
    })
  }, [adminMonth])

  async function saveMonthTargets() {
    setLoading(true)
    try {
      const payload = adminDays.map((day) => ({
        target_date: day.iso,
        turno: null,
        required_hours: Number(monthTargets[day.iso] || 0),
        notes: `meta mensal ${adminMonth}`,
      }))
      await upsertDailyTargets(payload)
      setStatus(`Metas de ${adminMonth} salvas.`)
      await refreshData()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Erro ao salvar metas.')
    } finally {
      setLoading(false)
    }
  }

  async function saveShifts() {
    setLoading(true)
    try {
      await upsertShiftConfig(shifts)
      setStatus('Configuracao de turnos salva.')
      await refreshData()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Erro ao salvar turnos.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brandMark">KEETA</div>
        <nav className="nav">
          <button className={clsx(activeTab === 'dashboard' && 'active')} onClick={() => setActiveTab('dashboard')}>
            <SlidersHorizontal size={18} /> Dashboard
          </button>
          <button className={clsx(activeTab === 'import' && 'active')} onClick={() => setActiveTab('import')}>
            <Upload size={18} /> Importar
          </button>
          <button className={clsx(activeTab === 'admin' && 'active')} onClick={() => setActiveTab('admin')}>
            <Database size={18} /> Admin
          </button>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operacao KEETA</p>
            <h1>Aderencia e horas entregues</h1>
            <span className="rangePill">{effectiveRange.label}: {effectiveRange.startDate || 'inicio'} ate {effectiveRange.endDate || 'hoje'}</span>
          </div>
          <button className="iconButton" onClick={refreshData} disabled={loading} title="Atualizar dados">
            <RefreshCw size={18} />
          </button>
        </header>

        <section className="notice">{status}</section>

        {activeTab === 'dashboard' && (
          <>
            <section className="filters">
              <label><CalendarRange size={15} /> Semana
                <div className="weekPair">
                  <input type="number" min="2025" max="2035" value={filters.weekYear} onChange={(event) => setFilters({ ...filters, weekYear: event.target.value })} />
                  <input type="number" min="1" max="54" value={filters.weekNumber} onChange={(event) => setFilters({ ...filters, weekNumber: event.target.value })} />
                </div>
              </label>
              <label><CalendarDays size={15} /> Inicio<input type="date" value={filters.startDate} onChange={(event) => setFilters({ ...filters, startDate: event.target.value })} /></label>
              <label><CalendarDays size={15} /> Fim<input type="date" value={filters.endDate} onChange={(event) => setFilters({ ...filters, endDate: event.target.value })} /></label>
              <label><Search size={15} /> Nome<input placeholder="Conc" value={filters.name} onChange={(event) => setFilters({ ...filters, name: event.target.value })} /></label>
              <label><Filter size={15} /> Turno<select value={filters.turno} onChange={(event) => setFilters({ ...filters, turno: event.target.value })}><option value="">Todos</option>{optionValues(rows, 'turno').map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>Modal<select value={filters.modal} onChange={(event) => setFilters({ ...filters, modal: event.target.value })}><option value="">Todos</option>{optionValues(rows, 'modal').map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>UTR<select value={filters.utr} onChange={(event) => setFilters({ ...filters, utr: event.target.value })}><option value="">Todas</option>{optionValues(rows, 'utr').map((value) => <option key={value}>{value}</option>)}</select></label>
            </section>

            <section className="kpis">
              <Metric title="Horas entregues" value={formatDurationHours(summary.delivered)} hint="total_hours_scheduled" />
              <Metric title="Horas a entregar" value={formatNumber(summary.targetTotal, 0)} hint="meta admin" />
              <Metric title="Aderencia meta" value={formatPercent(summary.targetAdherence)} hint="entregues / meta" strong />
              <Metric title="OnlineTime medio" value={formatPercent(summary.avgOnline)} hint="%OnlineTime" />
              <Metric title="Entregadores" value={formatNumber(summary.couriers)} hint="IDs unicos" />
            </section>

            <Suspense fallback={<section className="panel chartLoading">Carregando graficos...</section>}>
              <DashboardCharts byTurno={byTurno} byModal={byModal} modalColors={modalColors} />
            </Suspense>

            <DeliveryTable rows={filteredRows} />
          </>
        )}

        {activeTab === 'import' && (
          <section className="importStage">
            <div className="importHero">
              <div className="importIcon"><FileSpreadsheet size={34} /></div>
              <div>
                <p className="eyebrow">Atualizacao operacional</p>
                <h2>Importar planilha de entregadores</h2>
                <p>Arquivos `.xlsx` ou `.csv` com Turno, %OnlineTime, UTR, Conc, courier_id_txt, modal e total_hours_scheduled.</p>
              </div>
            </div>
            <label className={clsx('fileDrop premiumDrop', loading && 'loading')}>
              <input type="file" accept=".xlsx,.csv" onChange={(event) => handleImport(event.target.files?.[0] ?? null)} />
              {loading ? <LoaderCircle size={22} /> : <Upload size={22} />}
              <strong>{loading ? 'Processando arquivo' : 'Selecionar planilha'}</strong>
              <span>O arquivo sera normalizado e gravado no Supabase em lotes.</span>
            </label>
            <div className="importChecklist">
              <span><CheckCircle2 size={16} /> Calcula horas entregues automaticamente</span>
              <span><CheckCircle2 size={16} /> Mantem payload bruto para auditoria</span>
              <span><CheckCircle2 size={16} /> Atualiza KPIs ao concluir</span>
            </div>
          </section>
        )}

        {activeTab === 'admin' && (
          <section className="adminGrid">
            <div className="panel monthPanel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Planejamento</p>
                  <h2>Metas de horas por dia</h2>
                </div>
                <label>Mes<input type="month" value={adminMonth} onChange={(event) => setAdminMonth(event.target.value)} /></label>
              </div>
              <div className="monthTargets">
                {adminDays.map((day) => (
                  <label className="dayTarget" key={day.iso}>
                    <span>
                      <strong>{String(day.day).padStart(2, '0')}</strong>
                      <small>{day.weekday}</small>
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={monthTargets[day.iso] ?? ''}
                      placeholder="0"
                      onChange={(event) => setMonthTargets({ ...monthTargets, [day.iso]: event.target.value })}
                    />
                  </label>
                ))}
              </div>
              <button className="primary" onClick={saveMonthTargets} disabled={loading}><Save size={17} /> Salvar metas do mes</button>
            </div>
            <div className="panel shiftPanel">
              <p className="eyebrow">Turnos</p>
              <h2>Horas padrao</h2>
              {shifts.map((shift, index) => (
                <label key={shift.turno}>{shift.turno}
                  <input type="number" value={shift.expected_hours} onChange={(event) => setShifts(shifts.map((item, itemIndex) => itemIndex === index ? { ...item, expected_hours: Number(event.target.value) } : item))} />
                </label>
              ))}
              <button className="primary" onClick={saveShifts} disabled={loading}><Save size={17} /> Salvar turnos</button>
            </div>
          </section>
        )}
      </section>
    </main>
  )
}

function Metric({ title, value, hint, strong }: { title: string; value: string; hint: string; strong?: boolean }) {
  return (
    <article className={clsx('metric', strong && 'strong')}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
}

function DeliveryTable({ rows }: { rows: DeliveryRow[] }) {
  return (
    <section className="panel tablePanel">
      <h2>Entregadores</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>ID</th>
              <th>Nome</th>
              <th>Turno</th>
              <th>Aderencia</th>
              <th>UTR</th>
              <th>Modal</th>
              <th>Horas entregues</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.delivery_date ?? '-'}</td>
                <td>{row.courier_id_txt}</td>
                <td>{row.conc}</td>
                <td>{row.turno}</td>
                <td>{formatPercent(row.online_time_pct)}</td>
                <td>{row.utr ?? '-'}</td>
                <td>{row.modal}</td>
                <td>{formatDurationHours(row.delivered_hours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
