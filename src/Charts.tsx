import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type TurnoChartRow = {
  turno: string
  delivered: number
  target: number
  online: number
}

type ModalChartRow = {
  name: string
  value: number
}

type TargetComparison = {
  delivered: number
  target: number
  remaining: number
  adherence: number
}

type TooltipEntry = {
  name?: string
  value?: number | string
  color?: string
  payload?: Record<string, unknown>
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

function ChartTooltip({
  active,
  payload,
  label,
  mode,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string
  mode: 'hours' | 'percent' | 'modal'
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="chartTooltip">
      {label && <strong>{label}</strong>}
      {payload.map((entry) => {
        const value = Number(entry.value ?? 0)
        const modalPercent = Number(entry.payload?.percent ?? 0)
        const formattedValue = mode === 'percent'
          ? formatPercent(value)
          : mode === 'modal'
            ? `${formatDurationHours(value)} · ${formatPercent(modalPercent)}`
            : formatDurationHours(value)
        const name = mode === 'modal' ? String(entry.payload?.name ?? entry.name ?? 'Modal') : entry.name

        return (
          <span key={`${name}-${formattedValue}`}>
            <i style={{ backgroundColor: entry.color }} />
            {name}: {formattedValue}
          </span>
        )
      })}
    </div>
  )
}

export function DashboardCharts({
  byTurno,
  byModal,
  modalColors,
  targetComparison,
}: {
  byTurno: TurnoChartRow[]
  byModal: ModalChartRow[]
  modalColors: string[]
  targetComparison: TargetComparison
}) {
  const modalTotal = byModal.reduce((sum, item) => sum + item.value, 0)
  const modalData = byModal.map((item) => ({
    ...item,
    percent: modalTotal > 0 ? (item.value / modalTotal) * 100 : 0,
  }))
  const goalData = [
    { name: 'Meta', hours: targetComparison.target, fill: '#15120a' },
    { name: 'Entregue', hours: targetComparison.delivered, fill: '#ffcc00' },
    { name: 'Restante', hours: targetComparison.remaining, fill: '#d9d1ba' },
  ]

  return (
    <section className="charts">
      <div className="panel chartPanel wide">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">Capacidade</p>
            <h2>Horas por turno</h2>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={310}>
          <BarChart data={byTurno}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(21,18,10,0.12)" />
            <XAxis dataKey="turno" />
            <YAxis />
            <Tooltip content={<ChartTooltip mode="hours" />} cursor={{ fill: 'rgba(255, 204, 0, 0.10)' }} />
            <Bar dataKey="target" name="A entregar" fill="#141414" radius={[4, 4, 0, 0]} />
            <Bar dataKey="delivered" name="Entregues" fill="#ffcc00" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="panel chartPanel goalPanel">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">Aderencia da meta</p>
            <h2>Meta vs entregue</h2>
          </div>
          <span>{formatPercent(targetComparison.adherence)}</span>
        </div>
        <ResponsiveContainer width="100%" height={310}>
          <BarChart data={goalData} layout="vertical" margin={{ left: 12, right: 28 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(21,18,10,0.12)" />
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={76} />
            <Tooltip content={<ChartTooltip mode="hours" />} cursor={{ fill: 'rgba(255, 204, 0, 0.10)' }} />
            <Bar dataKey="hours" name="Horas" radius={[0, 7, 7, 0]}>
              {goalData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
              <LabelList dataKey="hours" position="right" formatter={(value) => formatDurationHours(Number(value ?? 0))} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="panel chartPanel">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">Distribuicao</p>
            <h2>Modal</h2>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={310}>
          <PieChart>
            <Pie
              data={modalData}
              dataKey="value"
              nameKey="name"
              innerRadius={66}
              outerRadius={104}
              labelLine={false}
              label={(props) => `${props.name} ${formatPercent(Number(props.payload?.percent ?? 0))}`}
            >
              {modalData.map((entry, index) => <Cell key={entry.name} fill={modalColors[index % modalColors.length]} />)}
            </Pie>
            <Tooltip content={<ChartTooltip mode="modal" />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="panel chartPanel wide">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">Qualidade</p>
            <h2>Aderencia online por turno</h2>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={byTurno}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(21,18,10,0.12)" />
            <XAxis dataKey="turno" />
            <YAxis />
            <Tooltip content={<ChartTooltip mode="percent" />} cursor={{ stroke: '#15120a', strokeWidth: 1 }} />
            <Area dataKey="online" name="OnlineTime medio" fill="#ffcc00" stroke="#141414" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
