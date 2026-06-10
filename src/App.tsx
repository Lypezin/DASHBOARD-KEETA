import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bike,
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
  Target,
  Upload,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { addDays, format, getDaysInMonth } from 'date-fns'
import { fetchDashboardData, importDeliveryRows, upsertDailyTargets, upsertShiftConfig } from './supabase'
import type { DailyTarget, DashboardRow, Filters, ShiftConfig } from './types'

const defaultShifts: ShiftConfig[] = [
  { turno: 'Almoço', expected_hours: 4 },
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
  courierId: '',
  turno: '',
  modal: '',
}

const modalColors = ['#141414', '#ffcc00', '#2e7d32', '#e6502e', '#4776e6', '#78716c']
const DashboardCharts = lazy(() => import('./Charts').then((module) => ({ default: module.DashboardCharts })))
const tablePageSize = 250

type DeliveryTableRow = {
  key: string
  dateLabel: string
  courier_id_txt: string
  conc: string
  turno: string
  online_time_pct: number
  utr: number | null
  modal: string
  pedidos: number
  delivered_hours: number
  sourceRows: number
}

type DeliverySortKey = 'online' | 'utr' | 'delivered'
type SortDirection = 'desc' | 'asc'

type AvailableWeek = {
  key: string
  year: number
  weekNumber: number
  startDate: string
  endDate: string
  label: string
}

type Notice = {
  type: 'success' | 'error'
  message: string
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
  return 'Múltiplos'
}

function optionValues(rows: DashboardRow[], key: keyof DashboardRow) {
  return Array.from(new Set(rows.map((row) => String(row[key] ?? '').trim()).filter(Boolean))).sort()
}

function normalizedTextKey(value: string) {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function uniqueNormalizedOptions(values: string[]) {
  const options = new Map<string, string>()

  for (const rawValue of values) {
    const value = rawValue.trim()
    if (!value) continue

    const key = normalizedTextKey(value)
    if (!options.has(key)) options.set(key, value)
  }

  return Array.from(options.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'))
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
  const [rows, setRows] = useState<DashboardRow[]>([])
  const [targets, setTargets] = useState<DailyTarget[]>([])
  const [shifts, setShifts] = useState<ShiftConfig[]>(defaultShifts)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [adminMonth, setAdminMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [adminTurno, setAdminTurno] = useState('')
  const [monthTargets, setMonthTargets] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'admin' | 'import'>('dashboard')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const deferredNameFilter = useDeferredValue(filters.name)
  const deferredCourierIdFilter = useDeferredValue(filters.courierId)
  const normalizedNameFilter = useMemo(() => deferredNameFilter.trim().toLowerCase(), [deferredNameFilter])
  const normalizedCourierIdFilter = useMemo(() => deferredCourierIdFilter.trim().toLowerCase(), [deferredCourierIdFilter])

  async function refreshData() {
    setLoading(true)
    try {
      const data = await fetchDashboardData()
      setRows(data.rows)
      setTargets(data.targets)
      setShifts(data.shifts.length ? data.shifts : defaultShifts)
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível carregar os dados.' })
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
    return uniqueNormalizedOptions([
      ...optionValues(rows, 'turno'),
      ...shifts.map((shift) => shift.turno).filter(Boolean),
    ])
  }, [rows, shifts])

  useEffect(() => {
    if (adminTurnoOptions.length === 0) {
      if (adminTurno) setAdminTurno('')
      return
    }

    if (adminTurnoOptions.includes(adminTurno)) return

    const canonicalTurno = adminTurnoOptions.find((turno) => normalizedTextKey(turno) === normalizedTextKey(adminTurno))
    setAdminTurno(canonicalTurno ?? adminTurnoOptions[0])
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
      const nameOk = !normalizedNameFilter || row.conc.toLowerCase().includes(normalizedNameFilter)
      const idOk = !normalizedCourierIdFilter || row.courier_id_txt.toLowerCase().includes(normalizedCourierIdFilter)
      const turnoOk = !filters.turno || row.turno === filters.turno
      const modalOk = !filters.modal || row.modal === filters.modal
      return dateOk && nameOk && idOk && turnoOk && modalOk
    })
  }, [effectiveRange.endDate, effectiveRange.startDate, filters.modal, filters.turno, normalizedCourierIdFilter, normalizedNameFilter, rows])

  const summary = useMemo(() => {
    const delivered = filteredRows.reduce((sum, row) => sum + Number(row.delivered_hours || 0), 0)
    const avgOnline = filteredRows.length
      ? filteredRows.reduce((sum, row) => sum + Number(row.online_time_pct || 0), 0) / filteredRows.length
      : 0
    const couriers = new Set(filteredRows.map((row) => row.courier_id_txt).filter(Boolean)).size
    const pedidos = filteredRows.reduce((sum, row) => sum + Number(row.pedidos || 0), 0)

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
      pedidos,
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
    const turnoOrder = ['Almoço', 'Lanche', 'Jantar', 'Ceia']
    return Array.from(grouped.values()).map((item) => ({
      ...item,
      online: item.rows ? item.online / item.rows : 0,
    })).sort((a, b) => {
      const ai = turnoOrder.indexOf(a.turno)
      const bi = turnoOrder.indexOf(b.turno)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
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
  const hasManualFilters = Boolean(filters.startDate || filters.endDate || filters.name || filters.courierId || filters.turno || filters.modal)
  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: keyof Filters; label: string; value: string }> = []

    if (filters.startDate) chips.push({ key: 'startDate', label: 'Início', value: formatDisplayDate(filters.startDate) })
    if (filters.endDate) chips.push({ key: 'endDate', label: 'Fim', value: formatDisplayDate(filters.endDate) })
    if (filters.name) chips.push({ key: 'name', label: 'Parceiro', value: filters.name })
    if (filters.courierId) chips.push({ key: 'courierId', label: 'ID', value: filters.courierId })
    if (filters.turno) chips.push({ key: 'turno', label: 'Turno', value: filters.turno })
    if (filters.modal) chips.push({ key: 'modal', label: 'Modal', value: filters.modal })

    return chips
  }, [filters.courierId, filters.endDate, filters.modal, filters.name, filters.startDate, filters.turno])

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
        pedidos: Number(row.pedidos || 0),
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
      pedidos: number
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
        pedidos: 0,
        onlineSum: 0,
        utrSum: 0,
        utrCount: 0,
        sourceRows: 0,
      }

      if (row.delivery_date) item.dates.push(row.delivery_date)
      item.turnos.add(row.turno)
      item.modals.add(row.modal)
      item.delivered_hours += Number(row.delivered_hours || 0)
      item.pedidos += Number(row.pedidos || 0)
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
        pedidos: item.pedidos,
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
      setNotice({ type: 'success', message: `Importação concluída. ${parsed.length} registros processados.` })
      await refreshData()
      setActiveTab('dashboard')
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Erro ao importar arquivo.' })
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

  const adminCalendarGrid = useMemo(() => {
    if (!adminDays.length) return []
    const [year, month] = adminMonth.split('-').map(Number)
    const firstDate = new Date(year, month - 1, 1)
    const firstDayOfWeek = firstDate.getDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const paddingCount = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1

    const padding = Array.from({ length: paddingCount }, (_, index) => ({
      iso: `padding-${index}`,
      day: 0,
      weekday: '',
      isPadding: true,
    }))

    const realDays = adminDays.map((day) => ({
      ...day,
      isPadding: false,
    }))

    return [...padding, ...realDays]
  }, [adminDays, adminMonth])

  const adminMonthTotal = useMemo(() => {
    return adminDays.reduce((sum, day) => sum + Number(monthTargets[day.iso] || 0), 0)
  }, [adminDays, monthTargets])

  async function saveMonthTargets() {
    if (!adminTurno) {
      setNotice({ type: 'error', message: 'Selecione um turno para salvar as metas.' })
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
      setNotice({ type: 'success', message: `Metas de ${adminMonth} para ${adminTurno} salvas com sucesso.` })
      await refreshData()
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Erro ao salvar metas.' })
    } finally {
      setLoading(false)
    }
  }

  async function saveShifts() {
    setLoading(true)
    try {
      await upsertShiftConfig(shifts)
      setNotice({ type: 'success', message: 'Configuração de turnos salva com sucesso.' })
      await refreshData()
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Erro ao salvar turnos.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brandMark">KEETA</div>
        <nav className="nav">
          <button className={clsx(activeTab === 'dashboard' && 'active')} onClick={() => setActiveTab('dashboard')} aria-pressed={activeTab === 'dashboard'}>
            <SlidersHorizontal size={18} /> Dashboard
          </button>
          <button className={clsx(activeTab === 'import' && 'active')} onClick={() => setActiveTab('import')} aria-pressed={activeTab === 'import'}>
            <Upload size={18} /> Importar
          </button>
          <button className={clsx(activeTab === 'admin' && 'active')} onClick={() => setActiveTab('admin')} aria-pressed={activeTab === 'admin'}>
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
          <button className={clsx('iconButton', loading && 'loading')} onClick={refreshData} disabled={loading} title="Atualizar dados" aria-busy={loading}>
            <RefreshCw size={18} />
          </button>
        </header>

        {notice && <NoticeBar notice={notice} onClose={() => setNotice(null)} />}

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
              <label><Search size={15} /> Parceiro <TooltipHint text="Busca pelo nome do parceiro" /><input placeholder="Buscar parceiro..." value={filters.name} onChange={(event) => setFilters({ ...filters, name: event.target.value })} /></label>
              <label><Search size={15} /> ID <TooltipHint text="Busca pelo ID do entregador." /><input placeholder="Buscar ID..." value={filters.courierId} onChange={(event) => setFilters({ ...filters, courierId: event.target.value })} /></label>
              <label><Filter size={15} /> Turno <TooltipHint text="Filtra pelo turno de trabalho." /><select value={filters.turno} onChange={(event) => setFilters({ ...filters, turno: event.target.value })}><option value="">Todos</option>{optionValues(rows, 'turno').map((value) => <option key={value}>{value}</option>)}</select></label>
              <label><Bike size={15} /> Modal <TooltipHint text="Filtra pelo tipo de veículo." /><select value={filters.modal} onChange={(event) => setFilters({ ...filters, modal: event.target.value })}><option value="">Todos</option>{optionValues(rows, 'modal').map((value) => <option key={value}>{value}</option>)}</select></label>
              <button
                type="button"
                className="clearFilters"
                disabled={!hasManualFilters}
                onClick={() => setFilters((current) => ({
                  ...current,
                  startDate: '',
                  endDate: '',
                  name: '',
                  courierId: '',
                  turno: '',
                  modal: '',
                }))}
              >
                Limpar filtros
              </button>
            </section>

            {activeFilterChips.length > 0 && (
              <section className="activeFilters" aria-label="Filtros ativos">
                <span>Filtros ativos</span>
                <div>
                  {activeFilterChips.map((chip) => (
                    <button
                      type="button"
                      key={chip.key}
                      onClick={() => setFilters((current) => ({ ...current, [chip.key]: '' }))}
                      aria-label={`Remover filtro ${chip.label}`}
                    >
                      <strong>{chip.label}</strong>
                      {chip.value}
                      <X size={13} />
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="kpis">
              <Metric title="Horas entregues" value={formatDurationHours(summary.delivered)} hint="Total no período" tooltip="Soma das horas programadas no período filtrado." />
              <Metric title="Meta de horas" value={formatNumber(summary.targetTotal, 0)} hint="Planejado" tooltip="Total de horas planejadas no Admin para este período." />
              <Metric title="Aderência" value={formatPercent(summary.targetAdherence)} hint="Entregue vs meta" strong tooltip="Percentual de horas entregues em relação ao planejado." />
              <Metric title="Pedidos" value={formatNumber(summary.pedidos, 0)} hint="Total no período" tooltip="Soma da coluna pedidos no período filtrado." />
              <Metric title="Entregadores" value={formatNumber(summary.couriers)} hint="Ativos" tooltip="Quantidade de entregadores únicos no período." />
            </section>

            <Suspense fallback={<section className="panel chartLoading" aria-label="Carregando gráficos"><span /><span /><span /></section>}>
              <DashboardCharts byTurno={byTurno} byModal={byModal} modalColors={modalColors} targetComparison={targetComparison} />
            </Suspense>

            <DeliveryTable rows={deliveryTableRows} isSingleDayView={isSingleDayView} />
          </>
        )}

        {activeTab === 'import' && (
          <section className="importStage">
            <div className="importHero">
              <div className="importIcon"><FileSpreadsheet size={30} /></div>
              <div>
                <p className="eyebrow">Importação de dados</p>
                <h2>Importar planilha</h2>
              </div>
            </div>
            <label
              className={clsx('fileDrop premiumDrop', loading && 'loading')}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                fileInputRef.current?.click()
              }}
            >
              <input ref={fileInputRef} type="file" accept=".xlsx,.csv" onChange={(event) => handleImport(event.target.files?.[0] ?? null)} />
              <div className="dropIconWrap">
                {loading ? <LoaderCircle size={28} /> : <Upload size={28} />}
              </div>
              <strong>{loading ? 'Processando…' : 'Clique para selecionar o arquivo'}</strong>
              <span>Arraste ou selecione um arquivo XLSX ou CSV</span>
            </label>
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
                  <span><Target size={14} /> Meta do mês {adminTurno ? `· ${adminTurno}` : ''}</span>
                  <strong>{formatDurationHours(adminMonthTotal)}</strong>
                </div>
                <div>
                  <span><CalendarDays size={14} /> Dias configurados</span>
                  <strong>{Object.values(monthTargets).filter((value) => Number(value) > 0).length}</strong>
                </div>
              </div>
              <div className="calendarWrap">
                <div className="monthTargets">
                  {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => (
                    <div key={d} className="calendarHeaderCell">{d}</div>
                  ))}
                  {adminCalendarGrid.map((day) => {
                    if (day.isPadding) {
                      return <div key={day.iso} className="dayTargetPadding" />
                    }
                    return (
                      <label className={clsx('dayTarget', Number(monthTargets[day.iso] || 0) > 0 && 'configured')} key={day.iso}>
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
                    )
                  })}
                </div>
              </div>
              <button className="primary" onClick={saveMonthTargets} disabled={loading}><Save size={17} /> Salvar metas</button>
            </div>
            <div className="panel shiftPanel">
              <p className="eyebrow">Configuração</p>
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

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const Icon = notice.type === 'success' ? CheckCircle2 : AlertTriangle

  return (
    <section className={clsx('notice', notice.type)} role={notice.type === 'error' ? 'alert' : 'status'}>
      <Icon size={18} />
      <span>{notice.message}</span>
      <button type="button" onClick={onClose} aria-label="Fechar aviso">
        <X size={15} />
      </button>
    </section>
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
  const [sort, setSort] = useState<{ key: DeliverySortKey; direction: SortDirection }>({ key: 'delivered', direction: 'desc' })
  const [visibleCount, setVisibleCount] = useState(tablePageSize)

  function toggleSort(key: DeliverySortKey) {
    setSort((current) => {
      if (current.key !== key) return { key, direction: 'desc' }
      return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
    })
  }

  useEffect(() => {
    setVisibleCount(tablePageSize)
  }, [rows, sort])

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const valueA = sort.key === 'online' ? a.online_time_pct : sort.key === 'utr' ? a.utr : a.delivered_hours
      const valueB = sort.key === 'online' ? b.online_time_pct : sort.key === 'utr' ? b.utr : b.delivered_hours

      if (valueA === null && valueB === null) return 0
      if (valueA === null) return 1
      if (valueB === null) return -1

      const diff = valueA - valueB
      return sort.direction === 'asc' ? diff : -diff
    })
  }, [rows, sort])

  const visibleRows = useMemo(() => sortedRows.slice(0, visibleCount), [sortedRows, visibleCount])
  const hiddenRows = Math.max(sortedRows.length - visibleRows.length, 0)

  function SortHeader({ label, sortKey }: { label: string; sortKey: DeliverySortKey }) {
    const active = sort.key === sortKey
    const nextDirection = active && sort.direction === 'desc' ? 'menor para maior' : 'maior para menor'

    return (
      <button
        type="button"
        className={clsx('sortHeader', active && 'active')}
        onClick={() => toggleSort(sortKey)}
        aria-label={`Ordenar ${label} do ${nextDirection}`}
      >
        {label}
        <span>{active ? (sort.direction === 'desc' ? '↓' : '↑') : '↕'}</span>
      </button>
    )
  }

  return (
    <section className="panel tablePanel">
      <div className="tableTitle">
        <div>
          <p className="eyebrow">{isSingleDayView ? 'Visão diária' : 'Consolidado por entregador'}</p>
          <h2>Entregadores</h2>
        </div>
        <div className="tableActions">
          <span><Clock3 size={14} /> {formatNumber(rows.length)} {isSingleDayView ? 'linhas no dia' : 'entregadores'}</span>
        </div>
      </div>
      <div className="tableWrap">
        <table>
          <caption>Entregadores filtrados no período selecionado</caption>
          <thead>
            <tr>
              <th>Data</th>
              <th>ID</th>
              <th>Parceiro</th>
              <th>Turno</th>
              <th><SortHeader label="Online %" sortKey="online" /></th>
              <th><SortHeader label="UTR" sortKey="utr" /></th>
              <th>Modal</th>
              <th><SortHeader label="Horas entregues" sortKey="delivered" /></th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <div className="emptyTable">
                    <strong>Nenhum entregador encontrado</strong>
                    <span>Ajuste os filtros ou importe uma planilha para preencher esta visão.</span>
                  </div>
                </td>
              </tr>
            )}
            {visibleRows.map((row) => (
              <tr key={row.key}>
                <td>{row.dateLabel}</td>
                <td>{row.courier_id_txt}</td>
                <td>{row.conc}</td>
                <td>{row.turno}</td>
                <td className="numericCell">{formatPercent(row.online_time_pct)}</td>
                <td className="numericCell">{formatDecimal(row.utr)}</td>
                <td>{row.modal}</td>
                <td className="numericCell">
                  <span className="durationCell">{formatDurationHours(row.delivered_hours)}</span>
                  {!isSingleDayView && <small>{row.sourceRows} linhas</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenRows > 0 && (
        <div className="tableLoadMore">
          <span>Mostrando {formatNumber(visibleRows.length)} de {formatNumber(sortedRows.length)} linhas para manter a navegação fluida.</span>
          <button type="button" onClick={() => setVisibleCount((current) => current + tablePageSize)}>
            Ver mais {formatNumber(Math.min(tablePageSize, hiddenRows))}
          </button>
        </div>
      )}
    </section>
  )
}
