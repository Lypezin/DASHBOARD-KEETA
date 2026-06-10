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

export type DashboardRow = Pick<
  DeliveryRow,
  | 'id'
  | 'delivery_date'
  | 'turno'
  | 'online_time_pct'
  | 'utr'
  | 'conc'
  | 'courier_id_txt'
  | 'modal'
  | 'pedidos'
  | 'delivered_hours'
>

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
