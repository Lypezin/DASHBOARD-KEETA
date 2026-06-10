import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
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

type DayChartRow = {
  date: string
  delivered: number
  pedidos: number
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

const chartTick = { fontFamily: 'Inter', fontSize: 12, fontWeight: 600, fill: 'var(--muted)' }
const chartTickStrong = { fontFamily: 'Inter', fontSize: 12, fontWeight: 700, fill: 'var(--ink)' }
const legendStyle = { fontFamily: 'Inter', fontSize: 12, fontWeight: 600, paddingBottom: 16 }
const labelStyle = { fontFamily: 'Inter', fontSize: 11, fontWeight: 700, fill: 'var(--ink)' }

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value || 0)
}

function formatPercent(value: number) {
  return `${formatNumber(value, 2)}%`
}

function formatDurationHours(value: number) {
  const totalSeconds = Math.round((value || 0) * 3600)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatShortDate(value: string) {
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}`
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="chartEmpty">
      <strong>Sem dados para exibir</strong>
      <span>{message}</span>
    </div>
  )
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
  mode: 'hours' | 'percent' | 'modal' | 'daily'
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="chartTooltip">
      {label && <strong>{label}</strong>}
      {payload.map((entry) => {
        const value = Number(entry.value ?? 0)
        const modalPercent = Number(entry.payload?.percent ?? 0)
        const entryName = String(entry.name ?? '')
        const formattedValue = mode === 'daily' && entryName.toLowerCase().includes('pedido')
          ? formatNumber(value, 0)
          : mode === 'percent'
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
  byDay,
  modalColors,
  targetComparison,
}: {
  byTurno: TurnoChartRow[]
  byModal: ModalChartRow[]
  byDay: DayChartRow[]
  modalColors: string[]
  targetComparison: TargetComparison
}) {
  const modalTotal = byModal.reduce((sum, item) => sum + item.value, 0)
  const modalData = byModal.map((item) => ({
    ...item,
    percent: modalTotal > 0 ? (item.value / modalTotal) * 100 : 0,
  }))
  const hasTurnoData = byTurno.some((item) => item.delivered > 0 || item.target > 0 || item.online > 0)
  const hasModalData = modalData.some((item) => item.value > 0)
  const hasGoalData = targetComparison.target > 0 || targetComparison.delivered > 0
  const hasDayData = byDay.some((item) => item.delivered > 0 || item.pedidos > 0)
  const dominantModal = modalData.reduce((current, item) => item.value > current.value ? item : current, { name: 'Sem modal', value: 0, percent: 0 })
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
        {hasTurnoData ? (
          <ResponsiveContainer width="100%" height={310}>
            <BarChart data={byTurno} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(21,18,10,0.08)" />
              <XAxis
                dataKey="turno"
                tickLine={false}
                axisLine={{ stroke: 'rgba(21,18,10,0.12)' }}
                tick={chartTick}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={chartTick}
              />
              <Tooltip content={<ChartTooltip mode="hours" />} cursor={{ fill: 'rgba(255, 204, 0, 0.06)' }} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                iconSize={8}
                wrapperStyle={legendStyle}
              />
              <Bar dataKey="target" name="A entregar" fill="#15120a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="delivered" name="Entregues" fill="#ffcc00" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <ChartEmpty message="Ajuste os filtros ou importe dados para visualizar as horas por turno." />}
      </div>

      <div className="panel chartPanel goalPanel">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">Aderência da meta</p>
            <h2>Meta vs entregue</h2>
          </div>
          <span>{targetComparison.target > 0 ? formatPercent(targetComparison.adherence) : 'Sem meta'}</span>
        </div>
        {hasGoalData ? (
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
                tick={chartTickStrong}
              />
              <Tooltip content={<ChartTooltip mode="hours" />} cursor={{ fill: 'rgba(255, 204, 0, 0.06)' }} />
              <Bar dataKey="hours" name="Horas" radius={[0, 6, 6, 0]}>
                {goalData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                <LabelList
                  dataKey="hours"
                  position="right"
                  formatter={(value) => formatDurationHours(Number(value ?? 0))}
                  style={labelStyle}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <ChartEmpty message="Cadastre metas ou importe horas para comparar planejamento e execução." />}
      </div>

      <div className="panel chartPanel">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">Distribuição</p>
            <h2>Modal</h2>
          </div>
        </div>
        {hasModalData ? (
          <div className="donutChartWrap">
            <ResponsiveContainer width="100%" height={310}>
              <PieChart>
                <Pie
                  data={modalData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={72}
                  outerRadius={98}
                  paddingAngle={2}
                  labelLine={false}
                  label={({ x, y, textAnchor, name, payload }: any) => (
                    <text
                      x={x}
                      y={y}
                      textAnchor={textAnchor}
                      fontFamily="Inter"
                      fontSize={12}
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
            <div className="donutCenter" aria-hidden="true">
              <strong>{formatPercent(dominantModal.percent)}</strong>
              <span>{dominantModal.name}</span>
            </div>
          </div>
        ) : <ChartEmpty message="Sem horas filtradas para distribuir por modal." />}
      </div>

      <div className="panel chartPanel wide">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">Qualidade</p>
            <h2>Aderência online por turno</h2>
          </div>
        </div>
        {hasTurnoData ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={byTurno} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(21,18,10,0.08)" />
              <XAxis
                dataKey="turno"
                tickLine={false}
                axisLine={{ stroke: 'rgba(21,18,10,0.12)' }}
                tick={chartTick}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => `${val}%`}
                tick={chartTick}
              />
              <Tooltip content={<ChartTooltip mode="percent" />} cursor={{ stroke: '#15120a', strokeWidth: 1 }} />
              <Area dataKey="online" name="Tempo online médio" fill="rgba(255, 204, 0, 0.2)" stroke="#ffcc00" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <ChartEmpty message="Sem aderência online para os filtros atuais." />}
      </div>

      <div className="panel chartPanel wide timelinePanel">
        <div className="chartHeader">
          <div>
            <p className="eyebrow">Evolução diária</p>
            <h2>Horas entregues e pedidos por dia</h2>
          </div>
        </div>
        {hasDayData ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={byDay} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(21,18,10,0.08)" />
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                tickLine={false}
                axisLine={{ stroke: 'rgba(21,18,10,0.12)' }}
                tick={chartTick}
              />
              <YAxis yAxisId="hours" tickLine={false} axisLine={false} tick={chartTick} />
              <YAxis yAxisId="orders" orientation="right" tickLine={false} axisLine={false} tick={chartTickStrong} />
              <Tooltip labelFormatter={(value) => formatShortDate(String(value))} content={<ChartTooltip mode="daily" />} />
              <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={legendStyle} />
              <Line yAxisId="hours" type="monotone" dataKey="delivered" name="Horas entregues" stroke="#ffcc00" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff7d1' }} activeDot={{ r: 6 }} />
              <Line yAxisId="orders" type="monotone" dataKey="pedidos" name="Pedidos" stroke="#15120a" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <ChartEmpty message="Sem dados diários para os filtros atuais." />}
      </div>
    </section>
  )
}
