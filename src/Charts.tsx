import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
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
    <div className="chartTooltip" style={{ fontFamily: 'Inter' }}>
      {label && <strong style={{ fontFamily: 'Inter' }}>{label}</strong>}
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
          <span key={`${name}-${formattedValue}`} style={{ fontFamily: 'Inter' }}>
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
          <BarChart data={byTurno} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(21,18,10,0.08)" />
            <XAxis
              dataKey="turno"
              tickLine={false}
              axisLine={{ stroke: 'rgba(21,18,10,0.12)' }}
              tick={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 500, fill: 'var(--muted)' }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 500, fill: 'var(--muted)' }}
            />
            <Tooltip content={<ChartTooltip mode="hours" />} cursor={{ fill: 'rgba(255, 204, 0, 0.06)' }} />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, paddingBottom: 15 }}
            />
            <Bar dataKey="target" name="A entregar" fill="#15120a" radius={[4, 4, 0, 0]} />
            <Bar dataKey="delivered" name="Entregues" fill="#ffcc00" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="panel chartPanel goalPanel">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">Aderência da meta</p>
            <h2>Meta vs entregue</h2>
          </div>
          <span>{formatPercent(targetComparison.adherence)}</span>
        </div>
        <ResponsiveContainer width="100%" height={310}>
          <BarChart data={goalData} layout="vertical" margin={{ left: 10, right: 30, top: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(21,18,10,0.08)" />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={76}
              tickLine={false}
              axisLine={false}
              tick={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 600, fill: 'var(--ink)' }}
            />
            <Tooltip content={<ChartTooltip mode="hours" />} cursor={{ fill: 'rgba(255, 204, 0, 0.06)' }} />
            <Bar dataKey="hours" name="Horas" radius={[0, 6, 6, 0]}>
              {goalData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
              <LabelList
                dataKey="hours"
                position="right"
                formatter={(value) => formatDurationHours(Number(value ?? 0))}
                style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, fill: 'var(--ink)' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="panel chartPanel">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">Distribuição</p>
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
              outerRadius={96}
              labelLine={false}
              label={({ x, y, textAnchor, name, payload }: any) => (
                <text
                  x={x}
                  y={y}
                  textAnchor={textAnchor}
                  fontFamily="Inter"
                  fontSize={10}
                  fontWeight={700}
                  fill="var(--ink)"
                >
                  {`${name} ${formatPercent(Number(payload?.percent ?? 0))}`}
                </text>
              )}
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
            <h2>Aderência online por turno</h2>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={byTurno} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(21,18,10,0.08)" />
            <XAxis
              dataKey="turno"
              tickLine={false}
              axisLine={{ stroke: 'rgba(21,18,10,0.12)' }}
              tick={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 500, fill: 'var(--muted)' }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => `${val}%`}
              tick={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 500, fill: 'var(--muted)' }}
            />
            <Tooltip content={<ChartTooltip mode="percent" />} cursor={{ stroke: '#15120a', strokeWidth: 1 }} />
            <Area dataKey="online" name="OnlineTime médio" fill="rgba(255, 204, 0, 0.2)" stroke="#ffcc00" strokeWidth={2.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
