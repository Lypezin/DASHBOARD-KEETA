import { lazy, Suspense, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
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
import { fetchDashboardData, fetchDashboardPayload, importDeliveryRows, upsertDailyTargets, upsertShiftConfig } from './supabase'
import type { AvailableWeek, DailyTarget, DashboardPayload, Filters, ShiftConfig } from './types'

const defaultShifts: ShiftConfig[] = [
  { turno: 'Almoço', expected_hours: 4 },
  { turno: 'Lanche', expected_hours: 3 },
  { turno: 'Jantar', expected_hours: 4 },
  { turno: 'Ceia', expected_hours: 2 },
]

const modalColors = ['#141414', '#ffcc00', '#2e7d32', '#e6502e', '#4776e6', '#78716c']
const DashboardCharts = lazy(() => import('./Charts').then((module) => ({ default: module.DashboardCharts })))
const tablePageSize = 250

type DeliverySortKey = 'online' | 'utr' | 'delivered'
type SortDirection = 'desc' | 'asc'
type Notice = { type: 'success' | 'error'; message: string }

const emptyDashboardPayload: DashboardPayload = {
  summary: { delivered: 0, pedidos: 0, couriers: 0, targetTotal: 0, targetAdherence: 0 },
  byTurno: [],
  byModal: [],
  tableRows: [],
  tableTotal: 0,
}

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

  if (weekStart >= firstWeekStart(calendarYear + 1)) year = calendarYear + 1
  else if (weekStart < firstWeekStart(calendarYear)) year = calendarYear - 1

  const start = firstWeekStart(year)
  const weekNumber = Math.floor((weekStart.getTime() - start.getTime()) / 604800000) + 1
  return { year, weekNumber: Math.max(1, weekNumber) }
}

function getWeekRange(year: number, weekNumber: number) {
  const start = addDays(firstWeekStart(year), (weekNumber - 1) * 7)
  return { startDate: toIsoDate(start), endDate: toIsoDate(addDays(start, 6)) }
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

function getOnlineTone(value: number) {
  if (value >= 85) return 'good'
  if (value < 70) return 'low'
  return 'neutral'
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

function formatDisplayDate(value: string | null | undefined) {
  if (!value || value === '-') return '-'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function mapWeekLabel(week: AvailableWeek): AvailableWeek {
  return {
    ...week,
    label: `Semana ${week.weekNumber} de ${week.year} · ${formatShortDate(week.startDate)} a ${formatShortDate(week.endDate)}`,
  }
}

export function App() {
  const [targets, setTargets] = useState<DailyTarget[]>([])
  const [shifts, setShifts] = useState<ShiftConfig[]>(defaultShifts)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [availableWeeks, setAvailableWeeks] = useState<AvailableWeek[]>([])
  const [turnoOptions, setTurnoOptions] = useState<string[]>([])
  const [modalOptions, setModalOptions] = useState<string[]>([])
  const [dashboardPayload, setDashboardPayload] = useState<DashboardPayload>(emptyDashboardPayload)
  const [tableOffset, setTableOffset] = useState(0)
  const [tableSort, setTableSort] = useState<{ key: DeliverySortKey; direction: SortDirection }>({ key: 'delivered', direction: 'desc' })
  const [adminMonth, setAdminMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [adminTurno, setAdminTurno] = useState('')
  const [monthTargets, setMonthTargets] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(false)
  const [dashboardLoading, setDashboardLoading] = useState(false)
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
      setAvailableWeeks(data.meta.available_weeks.map(mapWeekLabel))
      setTurnoOptions(data.meta.turnos)
      setModalOptions(data.meta.modals)
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
    return uniqueNormalizedOptions([...turnoOptions, ...shifts.map((shift) => shift.turno).filter(Boolean)])
  }, [shifts, turnoOptions])

  useEffect(() => {
    if (adminTurnoOptions.length === 0) {
      if (adminTurno) setAdminTurno('')
      return
    }
    if (adminTurnoOptions.includes(adminTurno)) return
    const canonicalTurno = adminTurnoOptions.find((turno) => normalizedTextKey(turno) === normalizedTextKey(adminTurno))
    setAdminTurno(canonicalTurno ?? adminTurnoOptions[0])
  }, [adminTurno, adminTurnoOptions])

  useEffect(() => {
    if (availableWeeks.length === 0) return
    const currentKey = `${filters.weekYear}-${String(filters.weekNumber).padStart(2, '0')}`
    const hasCurrentWeek = availableWeeks.some((week) => week.key === currentKey)
    if (!hasCurrentWeek) {
      const latest = availableWeeks[0]
      setFilters((current) => ({ ...current, weekYear: String(latest.year), weekNumber: String(latest.weekNumber) }))
    }
  }, [availableWeeks, filters.weekNumber, filters.weekYear])

  const effectiveRange = useMemo(() => {
    const hasInterval = Boolean(filters.startDate || filters.endDate)
    if (hasInterval) return { startDate: filters.startDate, endDate: filters.endDate, label: 'Intervalo personalizado' }
    const range = getWeekRange(Number(filters.weekYear), Number(filters.weekNumber))
    return { ...range, label: `Semana ${filters.weekNumber} de ${filters.weekYear}` }
  }, [filters.endDate, filters.startDate, filters.weekNumber, filters.weekYear])

  async function loadDashboardPayload(offset = 0, mode: 'replace' | 'append' = 'replace') {
    setDashboardLoading(true)
    try {
      const payload = await fetchDashboardPayload({
        startDate: effectiveRange.startDate,
        endDate: effectiveRange.endDate,
        name: normalizedNameFilter,
        courierId: normalizedCourierIdFilter,
        turno: filters.turno,
        modal: filters.modal,
        sortKey: tableSort.key,
        sortDirection: tableSort.direction,
        limit: tablePageSize,
        offset,
      })

      startTransition(() => {
        setDashboardPayload((current) => mode === 'append'
          ? { ...payload, tableRows: [...current.tableRows, ...payload.tableRows] }
          : payload)
        setTableOffset(offset + payload.tableRows.length)
      })
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível carregar a dashboard.' })
    } finally {
      setDashboardLoading(false)
    }
  }

  useEffect(() => {
    setTableOffset(0)
    void loadDashboardPayload(0, 'replace')
  }, [
    effectiveRange.startDate,
    effectiveRange.endDate,
    filters.modal,
    filters.turno,
    normalizedCourierIdFilter,
    normalizedNameFilter,
    tableSort.direction,
    tableSort.key,
  ])

  const summary = dashboardPayload.summary
  const byTurno = dashboardPayload.byTurno
  const byModal = dashboardPayload.byModal
  const targetComparison = useMemo(() => ({
    delivered: summary.delivered,
    target: summary.targetTotal,
    remaining: Math.max(summary.targetTotal - summary.delivered, 0),
    adherence: summary.targetTotal > 0 ? (summary.delivered / summary.targetTotal) * 100 : 0,
  }), [summary.delivered, summary.targetTotal])

  const hasAvailableWeeks = availableWeeks.length > 0
  const hasManualFilters = Boolean(filters.startDate || filters.endDate || filters.name || filters.courierId || filters.turno || filters.modal)
  const isSingleDayView = Boolean(effectiveRange.startDate && effectiveRange.endDate && effectiveRange.startDate === effectiveRange.endDate)
  const rangeSummary = !hasAvailableWeeks && !filters.startDate && !filters.endDate
    ? 'Aguardando importação'
    : `${effectiveRange.label} · ${effectiveRange.startDate ? formatDisplayDate(effectiveRange.startDate) : 'início'} até ${effectiveRange.endDate ? formatDisplayDate(effectiveRange.endDate) : 'hoje'}`

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
    return dashboardPayload.tableRows.map((row) => ({
      key: row.key,
      dateLabel: row.firstDate === row.lastDate
        ? formatDisplayDate(row.firstDate)
        : `${formatDisplayDate(row.firstDate)} - ${formatDisplayDate(row.lastDate)}`,
      courier_id_txt: row.courier_id_txt,
      conc: row.conc,
      turno: row.turno,
      online_time_pct: Number(row.online_time_pct || 0),
      utr: row.utr === null ? null : Number(row.utr),
      modal: row.modal,
      pedidos: Number(row.pedidos || 0),
      delivered_hours: Number(row.delivered_hours || 0),
      sourceRows: Number(row.sourceRows || 0),
    }))
  }, [dashboardPayload.tableRows])

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
      await loadDashboardPayload(0, 'replace')
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
    const firstDayOfWeek = firstDate.getDay()
    const paddingCount = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1
    const padding = Array.from({ length: paddingCount }, (_, index) => ({
      iso: `padding-${index}`,
      day: 0,
      weekday: '',
      isPadding: true,
    }))
    return [...padding, ...adminDays.map((day) => ({ ...day, isPadding: false }))]
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
      await loadDashboardPayload(0, 'replace')
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
        <nav className="nav" aria-label="Navegação principal">
          <button className={clsx(activeTab === 'dashboard' && 'active')} onClick={() => setActiveTab('dashboard')} aria-label="Abrir dashboard" aria-pressed={activeTab === 'dashboard'}>
            <SlidersHorizontal size={18} /> Dashboard
          </button>
          <button className={clsx(activeTab === 'import' && 'active')} onClick={() => setActiveTab('import')} aria-label="Abrir importação de planilha" aria-pressed={activeTab === 'import'}>
            <Upload size={18} /> Importar
          </button>
          <button className={clsx(activeTab === 'admin' && 'active')} onClick={() => setActiveTab('admin')} aria-label="Abrir área administrativa" aria-pressed={activeTab === 'admin'}>
            <Database size={18} /> Admin
          </button>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Painel operacional</p>
            <h1>Aderência e horas entregues</h1>
            <span className="rangePill">{rangeSummary}</span>
          </div>
          <div className="topbarActions">
            <span className={clsx('dataPill', dashboardLoading && 'loading')} aria-live="polite">
              <Database size={14} />
              {dashboardLoading ? 'Atualizando painel' : 'Leitura otimizada'}
            </span>
            <button className={clsx('iconButton', loading && 'loading')} onClick={refreshData} disabled={loading} title="Atualizar dados" aria-label="Atualizar dados" aria-busy={loading}>
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {notice && <NoticeBar notice={notice} onClose={() => setNotice(null)} />}

        {activeTab === 'dashboard' && (
          <>
            <section className="filters">
              <label><CalendarRange size={15} /> Semana <TooltipHint text="Apenas semanas com dados. Ao preencher datas manuais, elas têm prioridade." />
                <select
                  value={`${filters.weekYear}-${String(filters.weekNumber).padStart(2, '0')}`}
                  disabled={!hasAvailableWeeks}
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
              <label><Filter size={15} /> Turno <TooltipHint text="Filtra pelo turno de trabalho." /><select value={filters.turno} onChange={(event) => setFilters({ ...filters, turno: event.target.value })}><option value="">Todos</option>{turnoOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label><Bike size={15} /> Modal <TooltipHint text="Filtra pelo tipo de veículo." /><select value={filters.modal} onChange={(event) => setFilters({ ...filters, modal: event.target.value })}><option value="">Todos</option>{modalOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
              <button
                type="button"
                className="clearFilters"
                disabled={!hasManualFilters}
                onClick={() => setFilters((current) => ({ ...current, startDate: '', endDate: '', name: '', courierId: '', turno: '', modal: '' }))}
              >
                Limpar filtros
              </button>
            </section>

            {activeFilterChips.length > 0 && (
              <section className="activeFilters" aria-label="Filtros ativos">
                <span>Filtros ativos</span>
                <div>
                  {activeFilterChips.map((chip) => (
                    <button type="button" key={chip.key} onClick={() => setFilters((current) => ({ ...current, [chip.key]: '' }))} aria-label={`Remover filtro ${chip.label}`}>
                      <strong>{chip.label}</strong>
                      {chip.value}
                      <X size={13} />
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="kpis">
              <Metric icon={<Clock3 size={17} />} title="Horas entregues" value={formatDurationHours(summary.delivered)} hint="Total no período" tooltip="Soma das horas programadas no período filtrado." />
              <Metric icon={<Target size={17} />} title="Meta de horas" value={formatNumber(summary.targetTotal, 0)} hint="Planejado" tooltip="Total de horas planejadas no Admin para este período." />
              <Metric icon={<CheckCircle2 size={17} />} title="Aderência" value={formatPercent(summary.targetAdherence)} hint="Entregue vs meta" strong tooltip="Percentual de horas entregues em relação ao planejado." />
              <Metric icon={<FileSpreadsheet size={17} />} title="Pedidos" value={formatNumber(summary.pedidos, 0)} hint="Total no período" tooltip="Soma da coluna pedidos no período filtrado." />
              <Metric icon={<Bike size={17} />} title="Entregadores" value={formatNumber(summary.couriers)} hint="Ativos" tooltip="Quantidade de entregadores únicos no período." />
            </section>

            <Suspense fallback={<section className="panel chartLoading" aria-label="Carregando gráficos"><span /><span /><span /></section>}>
              <DashboardCharts byTurno={byTurno} byModal={byModal} modalColors={modalColors} targetComparison={targetComparison} />
            </Suspense>

            <DeliveryTable
              rows={deliveryTableRows}
              totalRows={dashboardPayload.tableTotal}
              isSingleDayView={isSingleDayView}
              loading={dashboardLoading}
              sort={tableSort}
              onSortChange={setTableSort}
              onLoadMore={() => loadDashboardPayload(tableOffset, 'append')}
            />
          </>
        )}

        {activeTab === 'import' && (
          <section className="importStage">
            <div className="importHero">
              <div className="importIcon"><FileSpreadsheet size={30} /></div>
              <div>
                <p className="eyebrow">Importação de dados</p>
                <h2>Importar planilha</h2>
                <p>Envie a base atualizada e o painel recalcula horas, pedidos, turnos e entregadores automaticamente.</p>
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
                  <p className="panelIntro">Escolha mês e turno para distribuir a meta de horas em cada dia.</p>
                </div>
                <div className="adminSelectors">
                  <label>Mês<input type="month" value={adminMonth} onChange={(event) => setAdminMonth(event.target.value)} /></label>
                  <label>Turno
                    <select value={adminTurno} onChange={(event) => setAdminTurno(event.target.value)}>
                      {adminTurnoOptions.length === 0 && <option value="">Nenhum turno encontrado</option>}
                      {adminTurnoOptions.map((turno) => <option key={turno} value={turno}>{turno}</option>)}
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
                  {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => <div key={d} className="calendarHeaderCell">{d}</div>)}
                  {adminCalendarGrid.map((day) => {
                    if (day.isPadding) return <div key={day.iso} className="dayTargetPadding" />
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
              <p className="panelIntro">Referência operacional usada para padronizar cada janela de entrega.</p>
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

function Metric({ icon, title, value, hint, strong, tooltip }: { icon: ReactNode; title: string; value: string; hint: string; strong?: boolean; tooltip: string }) {
  return (
    <article className={clsx('metric', strong && 'strong')}>
      <span><i>{icon}</i>{title}<TooltipHint text={tooltip} /></span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
}

function DeliveryTable({
  rows,
  totalRows,
  isSingleDayView,
  loading,
  sort,
  onSortChange,
  onLoadMore,
}: {
  rows: Array<{
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
  }>
  totalRows: number
  isSingleDayView: boolean
  loading: boolean
  sort: { key: DeliverySortKey; direction: SortDirection }
  onSortChange: (sort: { key: DeliverySortKey; direction: SortDirection }) => void
  onLoadMore: () => void
}) {
  const hiddenRows = Math.max(totalRows - rows.length, 0)

  function toggleSort(key: DeliverySortKey) {
    if (sort.key !== key) onSortChange({ key, direction: 'desc' })
    else onSortChange({ key, direction: sort.direction === 'desc' ? 'asc' : 'desc' })
  }

  function SortHeader({ label, sortKey }: { label: string; sortKey: DeliverySortKey }) {
    const active = sort.key === sortKey
    const nextDirection = active && sort.direction === 'desc' ? 'menor para maior' : 'maior para menor'
    return (
      <button type="button" className={clsx('sortHeader', active && 'active')} onClick={() => toggleSort(sortKey)} aria-label={`Ordenar ${label} do ${nextDirection}`}>
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
          <span><Clock3 size={14} /> {formatNumber(totalRows)} {isSingleDayView ? 'linhas no dia' : 'entregadores'}</span>
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <div className="emptyTable">
                    <strong>{loading ? 'Carregando entregadores' : 'Nenhum entregador encontrado'}</strong>
                    <span>{loading ? 'Buscando dados consolidados no Supabase.' : 'Ajuste os filtros ou importe uma planilha para preencher esta visão.'}</span>
                  </div>
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.dateLabel}</td>
                <td>{row.courier_id_txt}</td>
                <td>{row.conc}</td>
                <td>{row.turno}</td>
                <td className="numericCell">
                  <span className={clsx('onlineBadge', getOnlineTone(row.online_time_pct))}>{formatPercent(row.online_time_pct)}</span>
                </td>
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
          <span>Mostrando {formatNumber(rows.length)} de {formatNumber(totalRows)} linhas para manter a navegação fluida.</span>
          <button type="button" onClick={onLoadMore} disabled={loading}>
            {loading ? 'Carregando…' : `Ver mais ${formatNumber(Math.min(tablePageSize, hiddenRows))}`}
          </button>
        </div>
      )}
    </section>
  )
}
