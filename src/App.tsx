import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Database,
  FileSpreadsheet,
  Filter,
  Info,
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
  const weekStart = mondayOf(date)
  const calendarYear = weekStart.getFullYear()
  let year = calendarYear

  if (weekStart >= firstWeekStart(calendarYear + 1)) {
    year = calendarYear + 1
  } else if (weekStart < firstWeekStart(calendarYear)) {
    year = calendarYear - 1
  }

  const start = firstWeekStart(year)
  const weekNumber = Math.floor((weekStart.getTime() - start.getTime()) / 604800000) + 1
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

type DeliveryTableRow = {
  key: string
  dateLabel: string
  courier_id_txt: string
  conc: string
  turno: string
  online_time_pct: number
  utr: number | null
  modal: string
  delivered_hours: number
  sourceRows: number
}

type AvailableWeek = {
  key: string
  year: number
  weekNumber: number
  startDate: string
  endDate: string
  label: string
}

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

function formatDecimal(value: number | null, digits = 2) {
  if (value === null || Number.isNaN(value)) return '-'
  return formatNumber(value, digits)
}

function singleOrMultiple(values: Set<string>) {
  const cleanValues = Array.from(values).filter(Boolean)
  if (cleanValues.length === 0) return '-'
  if (cleanValues.length === 1) return cleanValues[0]
  return 'Multiplos'
}

function optionValues(rows: DeliveryRow[], key: keyof DeliveryRow) {
  return Array.from(new Set(rows.map((row) => String(row[key] ?? '').trim()).filter(Boolean))).sort()
}

function formatShortDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year.slice(2)}`
}

function formatDisplayDate(value: string) {
  if (!value || value === '-') return '-'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

export function App() {
  const [rows, setRows] = useState<DeliveryRow[]>([])
  const [targets, setTargets] = useState<DailyTarget[]>([])
  const [shifts, setShifts] = useState<ShiftConfig[]>(defaultShifts)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [adminMonth, setAdminMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [adminTurno, setAdminTurno] = useState('')
  const [monthTargets, setMonthTargets] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'admin' | 'import'>('dashboard')

  async function refreshData() {
    setLoading(true)
    try {
      const data = await fetchDashboardData()
      setRows(data.rows)
      setTargets(data.targets)
      setShifts(data.shifts.length ? data.shifts : defaultShifts)
      setStatus(`${data.rows.length} registros carregados`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Não foi possível carregar os dados')
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
        .filter((target) => target.target_date.startsWith(adminMonth) && target.turno === adminTurno)
        .map((target) => [target.target_date, String(Number(target.required_hours || 0))]),
    )
    setMonthTargets(nextTargets)
  }, [adminMonth, adminTurno, targets])

  const adminTurnoOptions = useMemo(() => {
    return Array.from(new Set([
      ...optionValues(rows, 'turno'),
      ...shifts.map((shift) => shift.turno).filter(Boolean),
    ])).sort()
  }, [rows, shifts])

  useEffect(() => {
    if (adminTurno || adminTurnoOptions.length === 0) return
    setAdminTurno(adminTurnoOptions[0])
  }, [adminTurno, adminTurnoOptions])

  const availableWeeks = useMemo<AvailableWeek[]>(() => {
    const weeks = new Map<string, AvailableWeek>()

    for (const row of rows) {
      if (!row.delivery_date) continue
      const [year, month, day] = row.delivery_date.split('-').map(Number)
      const week = getWeekInfo(new Date(year, month - 1, day))
      const range = getWeekRange(week.year, week.weekNumber)
      const key = `${week.year}-${String(week.weekNumber).padStart(2, '0')}`

      weeks.set(key, {
        key,
        year: week.year,
        weekNumber: week.weekNumber,
        startDate: range.startDate,
        endDate: range.endDate,
        label: `Semana ${week.weekNumber} de ${week.year} · ${formatShortDate(range.startDate)} a ${formatShortDate(range.endDate)}`,
      })
    }

    return Array.from(weeks.values()).sort((a, b) => b.startDate.localeCompare(a.startDate))
  }, [rows])

  useEffect(() => {
    if (availableWeeks.length === 0) return
    const currentKey = `${filters.weekYear}-${String(filters.weekNumber).padStart(2, '0')}`
    const hasCurrentWeek = availableWeeks.some((week) => week.key === currentKey)
    if (!hasCurrentWeek) {
      const latest = availableWeeks[0]
      setFilters((current) => ({
        ...current,
        weekYear: String(latest.year),
        weekNumber: String(latest.weekNumber),
      }))
    }
  }, [availableWeeks, filters.weekNumber, filters.weekYear])

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
        const turnoOk = filters.turno ? target.turno === filters.turno : Boolean(target.turno)
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

  const targetComparison = useMemo(() => {
    const delivered = summary.delivered
    const target = summary.targetTotal
    const remaining = Math.max(target - delivered, 0)
    return {
      delivered,
      target,
      remaining,
      adherence: target > 0 ? (delivered / target) * 100 : 0,
    }
  }, [summary.delivered, summary.targetTotal])

  const isSingleDayView = Boolean(effectiveRange.startDate && effectiveRange.endDate && effectiveRange.startDate === effectiveRange.endDate)

  const deliveryTableRows = useMemo(() => {
    if (isSingleDayView) {
      return filteredRows.map<DeliveryTableRow>((row) => ({
        key: row.id,
        dateLabel: formatDisplayDate(row.delivery_date ?? '-'),
        courier_id_txt: row.courier_id_txt,
        conc: row.conc,
        turno: row.turno,
        online_time_pct: Number(row.online_time_pct || 0),
        utr: row.utr === null ? null : Number(row.utr),
        modal: row.modal,
        delivered_hours: Number(row.delivered_hours || 0),
        sourceRows: 1,
      }))
    }

    const grouped = new Map<string, {
      courier_id_txt: string
      conc: string
      dates: string[]
      turnos: Set<string>
      modals: Set<string>
      delivered_hours: number
      onlineSum: number
      utrSum: number
      utrCount: number
      sourceRows: number
    }>()

    for (const row of filteredRows) {
      const key = row.courier_id_txt || row.conc
      const item = grouped.get(key) ?? {
        courier_id_txt: row.courier_id_txt,
        conc: row.conc,
        dates: [],
        turnos: new Set<string>(),
        modals: new Set<string>(),
        delivered_hours: 0,
        onlineSum: 0,
        utrSum: 0,
        utrCount: 0,
        sourceRows: 0,
      }

      if (row.delivery_date) item.dates.push(row.delivery_date)
      item.turnos.add(row.turno)
      item.modals.add(row.modal)
      item.delivered_hours += Number(row.delivered_hours || 0)
      item.onlineSum += Number(row.online_time_pct || 0)
      const utr = row.utr === null ? Number.NaN : Number(row.utr)
      if (Number.isFinite(utr)) {
        item.utrSum += utr
        item.utrCount += 1
      }
      item.sourceRows += 1
      grouped.set(key, item)
    }

    return Array.from(grouped.entries()).map<DeliveryTableRow>(([key, item]) => {
      const dates = item.dates.sort()
      const firstDate = dates[0] ?? '-'
      const lastDate = dates[dates.length - 1] ?? firstDate
      return {
        key,
        dateLabel: firstDate === lastDate ? formatDisplayDate(firstDate) : `${formatDisplayDate(firstDate)} - ${formatDisplayDate(lastDate)}`,
        courier_id_txt: item.courier_id_txt,
        conc: item.conc,
        turno: singleOrMultiple(item.turnos),
        online_time_pct: item.sourceRows ? item.onlineSum / item.sourceRows : 0,
        utr: item.utrCount ? item.utrSum / item.utrCount : null,
        modal: singleOrMultiple(item.modals),
        delivered_hours: item.delivered_hours,
        sourceRows: item.sourceRows,
      }
    }).sort((a, b) => b.delivered_hours - a.delivered_hours)
  }, [filteredRows, isSingleDayView])

  async function handleImport(file: File | null) {
    if (!file) return
    setLoading(true)
    try {
      const { parseWorkbook } = await import('./importer')
      const parsed = await parseWorkbook(file)
      const batchId = await importDeliveryRows(file.name, parsed)
      void batchId
      setStatus(`Importação concluída — ${parsed.length} registros processados`)
      await refreshData()
      setActiveTab('dashboard')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Erro ao importar arquivo')
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

  const adminMonthTotal = useMemo(() => {
    return adminDays.reduce((sum, day) => sum + Number(monthTargets[day.iso] || 0), 0)
  }, [adminDays, monthTargets])

  async function saveMonthTargets() {
    if (!adminTurno) {
      setStatus('Selecione um turno para salvar as metas')
      return
    }

    setLoading(true)
    try {
      const payload = adminDays.map((day) => ({
        target_date: day.iso,
        turno: adminTurno,
        required_hours: Number(monthTargets[day.iso] || 0),
        notes: `meta mensal ${adminMonth} - ${adminTurno}`,
      }))
      await upsertDailyTargets(payload)
      setStatus(`Metas de ${adminMonth} para ${adminTurno} salvas com sucesso`)
      await refreshData()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Erro ao salvar metas')
    } finally {
      setLoading(false)
    }
  }

  async function saveShifts() {
    setLoading(true)
    try {
      await upsertShiftConfig(shifts)
      setStatus('Configuração de turnos salva com sucesso')
      await refreshData()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Erro ao salvar turnos')
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
            <p className="eyebrow">Painel operacional</p>
            <h1>Aderência e horas entregues</h1>
            <span className="rangePill">{effectiveRange.label} · {effectiveRange.startDate ? formatDisplayDate(effectiveRange.startDate) : 'início'} até {effectiveRange.endDate ? formatDisplayDate(effectiveRange.endDate) : 'hoje'}</span>
          </div>
          <button className="iconButton" onClick={refreshData} disabled={loading} title="Atualizar dados">
            <RefreshCw size={18} />
          </button>
        </header>

        {status && <section className="notice">{status}</section>}

        {activeTab === 'dashboard' && (
          <>
            <section className="filters">
              <label><CalendarRange size={15} /> Semana <TooltipHint text="Apenas semanas com dados. Ao preencher datas manuais, elas têm prioridade." />
                <select
                  value={`${filters.weekYear}-${String(filters.weekNumber).padStart(2, '0')}`}
                  onChange={(event) => {
                    const selected = availableWeeks.find((week) => week.key === event.target.value)
                    if (!selected) return
                    setFilters({ ...filters, weekYear: String(selected.year), weekNumber: String(selected.weekNumber) })
                  }}
                >
                  {availableWeeks.length === 0 && <option value={`${filters.weekYear}-${String(filters.weekNumber).padStart(2, '0')}`}>Sem semanas importadas</option>}
                  {availableWeeks.map((week) => <option key={week.key} value={week.key}>{week.label}</option>)}
                </select>
              </label>
              <label><CalendarDays size={15} /> Início <TooltipHint text="Filtra a partir desta data." /><input type="date" value={filters.startDate} onChange={(event) => setFilters({ ...filters, startDate: event.target.value })} /></label>
              <label><CalendarDays size={15} /> Fim <TooltipHint text="Mesma data no início e fim exibe a visão diária detalhada." /><input type="date" value={filters.endDate} onChange={(event) => setFilters({ ...filters, endDate: event.target.value })} /></label>
              <label><Search size={15} /> Nome<input placeholder="Conc" value={filters.name} onChange={(event) => setFilters({ ...filters, name: event.target.value })} /></label>
              <label><Filter size={15} /> Turno<select value={filters.turno} onChange={(event) => setFilters({ ...filters, turno: event.target.value })}><option value="">Todos</option>{optionValues(rows, 'turno').map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>Modal<select value={filters.modal} onChange={(event) => setFilters({ ...filters, modal: event.target.value })}><option value="">Todos</option>{optionValues(rows, 'modal').map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>UTR<select value={filters.utr} onChange={(event) => setFilters({ ...filters, utr: event.target.value })}><option value="">Todas</option>{optionValues(rows, 'utr').map((value) => <option key={value}>{value}</option>)}</select></label>
            </section>

            <section className="kpis">
              <Metric title="Horas entregues" value={formatDurationHours(summary.delivered)} hint="Total no período" tooltip="Soma das horas programadas no período filtrado." />
              <Metric title="Meta de horas" value={formatNumber(summary.targetTotal, 0)} hint="Planejado" tooltip="Total de horas planejadas no Admin para este período." />
              <Metric title="Aderência" value={formatPercent(summary.targetAdherence)} hint="Entregue vs meta" strong tooltip="Percentual de horas entregues em relação ao planejado." />
              <Metric title="Tempo online" value={formatPercent(summary.avgOnline)} hint="Média" tooltip="Média do tempo online dos entregadores no período." />
              <Metric title="Entregadores" value={formatNumber(summary.couriers)} hint="Ativos" tooltip="Quantidade de entregadores únicos no período." />
            </section>

            <Suspense fallback={<section className="panel chartLoading">Carregando gráficos…</section>}>
              <DashboardCharts byTurno={byTurno} byModal={byModal} modalColors={modalColors} targetComparison={targetComparison} />
            </Suspense>

            <DeliveryTable rows={deliveryTableRows} isSingleDayView={isSingleDayView} />
          </>
        )}

        {activeTab === 'import' && (
          <section className="importStage">
            <div className="importHero">
              <div className="importIcon"><FileSpreadsheet size={34} /></div>
              <div>
                <p className="eyebrow">Importação de dados</p>
                <h2>Importar planilha</h2>
              </div>
            </div>
            <label className={clsx('fileDrop premiumDrop', loading && 'loading')}>
              <input type="file" accept=".xlsx,.csv" onChange={(event) => handleImport(event.target.files?.[0] ?? null)} />
              {loading ? <LoaderCircle size={22} /> : <Upload size={22} />}
              <strong>{loading ? 'Processando…' : 'Selecionar arquivo'}</strong>
              <span>Os dados serão normalizados e salvos automaticamente.</span>
            </label>
            <div className="importChecklist">
              <span><CheckCircle2 size={16} /> Calcula horas a partir da planilha</span>
              <span><CheckCircle2 size={16} /> Mantém os dados originais como backup</span>
              <span><CheckCircle2 size={16} /> Atualiza o painel ao finalizar</span>
            </div>
            <div className="importFields">
              {['Turno', '%OnlineTime', 'UTR', 'Conc', 'courier_id_txt', 'modal', 'total_hours_scheduled'].map((field) => (
                <span key={field}>{field}</span>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'admin' && (
          <section className="adminGrid">
            <div className="panel monthPanel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Planejamento</p>
                  <h2>Metas diárias</h2>
                </div>
                <div className="adminSelectors">
                  <label>Mês<input type="month" value={adminMonth} onChange={(event) => setAdminMonth(event.target.value)} /></label>
                  <label>Turno
                    <select value={adminTurno} onChange={(event) => setAdminTurno(event.target.value)}>
                      {adminTurnoOptions.length === 0 && <option value="">Nenhum turno encontrado</option>}
                      {adminTurnoOptions.map((turno) => (
                        <option key={turno} value={turno}>{turno}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="adminSummary">
                <div>
                  <span>Meta do mês {adminTurno ? `· ${adminTurno}` : ''}</span>
                  <strong>{formatDurationHours(adminMonthTotal)}</strong>
                </div>
                <div>
                  <span>Dias configurados</span>
                  <strong>{Object.values(monthTargets).filter((value) => Number(value) > 0).length}</strong>
                </div>
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
              <button className="primary" onClick={saveMonthTargets} disabled={loading}><Save size={17} /> Salvar metas</button>
            </div>
            <div className="panel shiftPanel">
              <p className="eyebrow">Turnos</p>
              <h2>Horas por turno</h2>
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

function TooltipHint({ text }: { text: string }) {
  return (
    <span className="tooltipHint" tabIndex={0} data-tooltip={text} aria-label={text}>
      <Info size={13} />
    </span>
  )
}

function Metric({ title, value, hint, strong, tooltip }: { title: string; value: string; hint: string; strong?: boolean; tooltip: string }) {
  return (
    <article className={clsx('metric', strong && 'strong')}>
      <span>{title}<TooltipHint text={tooltip} /></span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
}

function DeliveryTable({ rows, isSingleDayView }: { rows: DeliveryTableRow[]; isSingleDayView: boolean }) {
  return (
    <section className="panel tablePanel">
      <div className="tableTitle">
        <div>
          <p className="eyebrow">{isSingleDayView ? 'Visao diaria' : 'Consolidado por entregador'}</p>
          <h2>Entregadores</h2>
        </div>
        <span><Clock3 size={14} /> {isSingleDayView ? 'Detalhes do dia' : 'Consolidado no período'}</span>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>ID</th>
              <th>Nome</th>
              <th>Turno</th>
              <th>Online %</th>
              <th>UTR</th>
              <th>Modal</th>
              <th>Horas entregues</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.dateLabel}</td>
                <td>{row.courier_id_txt}</td>
                <td>{row.conc}</td>
                <td>{row.turno}</td>
                <td>{formatPercent(row.online_time_pct)}</td>
                <td>{formatDecimal(row.utr)}</td>
                <td>{row.modal}</td>
                <td>
                  <span className="durationCell">{formatDurationHours(row.delivered_hours)}</span>
                  {!isSingleDayView && <small>{row.sourceRows} linhas</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
