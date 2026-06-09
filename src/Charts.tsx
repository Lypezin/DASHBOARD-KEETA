import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value || 0)
}

function formatPercent(value: number) {
  return `${formatNumber(value, 1)}%`
}

function chartNumber(value: unknown) {
  return formatNumber(Number(value ?? 0), 1)
}

function chartPercent(value: unknown) {
  return formatPercent(Number(value ?? 0))
}

export function DashboardCharts({
  byTurno,
  byModal,
  modalColors,
}: {
  byTurno: TurnoChartRow[]
  byModal: ModalChartRow[]
  modalColors: string[]
}) {
  return (
    <section className="charts">
      <div className="panel wide">
        <h2>Horas por turno</h2>
        <ResponsiveContainer width="100%" height={310}>
          <BarChart data={byTurno}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="turno" />
            <YAxis />
            <Tooltip formatter={chartNumber} />
            <Bar dataKey="target" name="A entregar" fill="#141414" radius={[4, 4, 0, 0]} />
            <Bar dataKey="delivered" name="Entregues" fill="#ffcc00" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="panel">
        <h2>Modal</h2>
        <ResponsiveContainer width="100%" height={310}>
          <PieChart>
            <Pie data={byModal} dataKey="value" nameKey="name" innerRadius={64} outerRadius={104}>
              {byModal.map((entry, index) => <Cell key={entry.name} fill={modalColors[index % modalColors.length]} />)}
            </Pie>
            <Tooltip formatter={chartNumber} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="panel wide">
        <h2>Aderencia online por turno</h2>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={byTurno}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="turno" />
            <YAxis />
            <Tooltip formatter={chartPercent} />
            <Area dataKey="online" name="%OnlineTime" fill="#ffcc00" stroke="#141414" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
