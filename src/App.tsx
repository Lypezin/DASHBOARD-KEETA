import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Database,
  FileSpreadsheet,
  Filter,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Upload,
} from 'lucide-react'
import clsx from 'clsx'
import { format } from 'date-fns'
import { fetchDashboardData, importDeliveryRows, isSupabaseConfigured, upsertDailyTarget, upsertShiftConfig } from './supabase'
import type { DailyTarget, DeliveryRow, Filters, ShiftConfig } from './types'

const defaultShifts: ShiftConfig[] = [
  { turno: 'Almoco', expected_hours: 4 },
  { turno: 'Lanche', expected_hours: 3 },
  { turno: 'Jantar', expected_hours: 4 },
  { turno: 'Ceia', expected_hours: 2 },
]

const emptyFilters: Filters = {
  startDate: '',
  endDate: '',
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

function optionValues(rows: DeliveryRow[], key: keyof DeliveryRow) {
  return Array.from(new Set(rows.map((row) => String(row[key] ?? '').trim()).filter(Boolean))).sort()
}

export function App() {
  const [rows, setRows] = useState<DeliveryRow[]>([])
  const [targets, setTargets] = useState<DailyTarget[]>([])
  const [shifts, setShifts] = useState<ShiftConfig[]>(defaultShifts)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [targetForm, setTargetForm] = useState<DailyTarget>({
    target_date: format(new Date(), 'yyyy-MM-dd'),
    turno: null,
    required_hours: 10000,
  })
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

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const dateOk = (!filters.startDate || (row.delivery_date ?? '') >= filters.startDate)
        && (!filters.endDate || (row.delivery_date ?? '') <= filters.endDate)
      const nameOk = !filters.name || row.conc.toLowerCase().includes(filters.name.toLowerCase())
      const turnoOk = !filters.turno || row.turno === filters.turno
      const modalOk = !filters.modal || row.modal === filters.modal
      const utrOk = !filters.utr || row.utr === filters.utr
      return dateOk && nameOk && turnoOk && modalOk && utrOk
    })
  }, [filters, rows])

  const summary = useMemo(() => {
    const delivered = filteredRows.reduce((sum, row) => sum + Number(row.delivered_hours || 0), 0)
    const avgOnline = filteredRows.length
      ? filteredRows.reduce((sum, row) => sum + Number(row.online_time_pct || 0), 0) / filteredRows.length
      : 0
    const couriers = new Set(filteredRows.map((row) => row.courier_id_txt).filter(Boolean)).size

    const targetTotal = targets
      .filter((target) => {
        const dateOk = (!filters.startDate || target.target_date >= filters.startDate)
          && (!filters.endDate || target.target_date <= filters.endDate)
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
  }, [filteredRows, filters, targets])

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
      if (!target.turno) continue
      const item = grouped.get(target.turno) ?? { turno: target.turno, delivered: 0, target: 0, online: 0, rows: 0 }
      item.target += Number(target.required_hours || 0)
      grouped.set(item.turno, item)
    }
    return Array.from(grouped.values()).map((item) => ({
      ...item,
      online: item.rows ? item.online / item.rows : 0,
    }))
  }, [filteredRows, targets])

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

  async function saveTarget() {
    setLoading(true)
    try {
      await upsertDailyTarget(targetForm)
      setStatus('Meta diaria salva.')
      await refreshData()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Erro ao salvar meta.')
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
        <div className="connection">
          <span className={clsx('dot', isSupabaseConfigured && 'ok')} />
          {isSupabaseConfigured ? 'Supabase conectado' : 'Configurar Supabase'}
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operacao de entregadores</p>
            <h1>Aderencia e horas entregues</h1>
          </div>
          <button className="iconButton" onClick={refreshData} disabled={loading} title="Atualizar dados">
            <RefreshCw size={18} />
          </button>
        </header>

        <section className="notice">{status}</section>

        {activeTab === 'dashboard' && (
          <>
            <section className="filters">
              <label><CalendarDays size={15} /> Inicio<input type="date" value={filters.startDate} onChange={(event) => setFilters({ ...filters, startDate: event.target.value })} /></label>
              <label><CalendarDays size={15} /> Fim<input type="date" value={filters.endDate} onChange={(event) => setFilters({ ...filters, endDate: event.target.value })} /></label>
              <label><Search size={15} /> Nome<input placeholder="Conc" value={filters.name} onChange={(event) => setFilters({ ...filters, name: event.target.value })} /></label>
              <label><Filter size={15} /> Turno<select value={filters.turno} onChange={(event) => setFilters({ ...filters, turno: event.target.value })}><option value="">Todos</option>{optionValues(rows, 'turno').map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>Modal<select value={filters.modal} onChange={(event) => setFilters({ ...filters, modal: event.target.value })}><option value="">Todos</option>{optionValues(rows, 'modal').map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>UTR<select value={filters.utr} onChange={(event) => setFilters({ ...filters, utr: event.target.value })}><option value="">Todas</option>{optionValues(rows, 'utr').map((value) => <option key={value}>{value}</option>)}</select></label>
            </section>

            <section className="kpis">
              <Metric title="Horas entregues" value={formatNumber(summary.delivered, 1)} hint="target hours / 24" />
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
          <section className="importBox">
            <FileSpreadsheet size={42} />
            <h2>Importar planilha operacional</h2>
            <p>Colunas esperadas: Turno, %OnlineTime, UTR, Conc, courier_id_txt, modal e target hours.</p>
            <label className="fileDrop">
              <input type="file" accept=".xlsx,.csv" onChange={(event) => handleImport(event.target.files?.[0] ?? null)} />
              <Upload size={20} /> Selecionar planilha
            </label>
          </section>
        )}

        {activeTab === 'admin' && (
          <section className="adminGrid">
            <div className="panel">
              <h2>Meta de horas por dia</h2>
              <label>Data<input type="date" value={targetForm.target_date} onChange={(event) => setTargetForm({ ...targetForm, target_date: event.target.value })} /></label>
              <label>Turno<select value={targetForm.turno ?? ''} onChange={(event) => setTargetForm({ ...targetForm, turno: event.target.value || null })}><option value="">Geral do dia</option>{shifts.map((shift) => <option key={shift.turno}>{shift.turno}</option>)}</select></label>
              <label>Horas a entregar<input type="number" value={targetForm.required_hours} onChange={(event) => setTargetForm({ ...targetForm, required_hours: Number(event.target.value) })} /></label>
              <button className="primary" onClick={saveTarget} disabled={loading}><Save size={17} /> Salvar meta</button>
            </div>
            <div className="panel">
              <h2>Horas padrao dos turnos</h2>
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
              <th>Turno</th>
              <th>Aderencia</th>
              <th>UTR</th>
              <th>Nome</th>
              <th>ID</th>
              <th>Modal</th>
              <th>Horas entregues</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 250).map((row) => (
              <tr key={row.id}>
                <td>{row.delivery_date ?? '-'}</td>
                <td>{row.turno}</td>
                <td>{formatPercent(row.online_time_pct)}</td>
                <td>{row.utr ?? '-'}</td>
                <td>{row.conc}</td>
                <td>{row.courier_id_txt}</td>
                <td>{row.modal}</td>
                <td>{formatNumber(row.delivered_hours, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
