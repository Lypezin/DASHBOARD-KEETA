export type DeliveryRow = {
  id: string
  delivery_date: string | null
  turno: string
  online_time_pct: number
  utr: string | null
  conc: string
  courier_id_txt: string
  modal: string
  target_hours_value: number
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
  name: string
  turno: string
  modal: string
  utr: string
}
