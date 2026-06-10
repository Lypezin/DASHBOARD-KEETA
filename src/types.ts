export type DeliveryRow = {
  id: string
  delivery_date: string | null
  turno: string
  online_time_pct: number
  utr: string | null
  conc: string
  courier_id_txt: string
  modal: string
  pedidos: number
  target_hours_value: number
  total_hours_scheduled_value: number
  delivered_hours: number
  imported_at: string
}

export type DailyTarget = {
  id?: string
  target_date: string
  turno: string | null
  required_hours: number
  notes?: string | null
}

export type ShiftConfig = {
  turno: string
  expected_hours: number
}

export type ParsedImportRow = Omit<DeliveryRow, 'id' | 'imported_at'> & {
  source_row_number: number
  raw_payload: Record<string, unknown>
}

export type Filters = {
  startDate: string
  endDate: string
  weekYear: string
  weekNumber: string
  name: string
  courierId: string
  turno: string
  modal: string
}

export type AvailableWeek = {
  key: string
  year: number
  weekNumber: number
  startDate: string
  endDate: string
  label?: string
}

export type DashboardSummary = {
  delivered: number
  pedidos: number
  couriers: number
  targetTotal: number
  targetAdherence: number
}

export type DashboardTurnoRow = {
  turno: string
  delivered: number
  target: number
  online: number
}

export type DashboardModalRow = {
  name: string
  value: number
}

export type DashboardTableRow = {
  key: string
  firstDate: string | null
  lastDate: string | null
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

export type DashboardMeta = {
  available_weeks: AvailableWeek[]
  turnos: string[]
  modals: string[]
}

export type DashboardPayload = {
  summary: DashboardSummary
  byTurno: DashboardTurnoRow[]
  byModal: DashboardModalRow[]
  tableRows: DashboardTableRow[]
  tableTotal: number
}
