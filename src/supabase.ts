import { createClient } from '@supabase/supabase-js'
import type { DailyTarget, DashboardMeta, DashboardPayload, ParsedImportRow, ShiftConfig } from './types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null

const dailyTargetsSelect = 'id,target_date,turno,required_hours,notes'
const shiftConfigSelect = 'turno,expected_hours'

async function fetchAllRows<T>(table: string, orderColumn: string, selectColumns = '*') {
  if (!supabase) return [] as T[]

  const pageSize = 1000
  const rows: T[] = []

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from(table)
      .select(selectColumns)
      .order(orderColumn, { ascending: false, nullsFirst: false })
      .range(from, to)

    if (error) throw error
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < pageSize) break
  }

  return rows
}

export async function fetchDashboardData() {
  if (!supabase) {
    return {
      meta: { available_weeks: [], turnos: [], modals: [] } as DashboardMeta,
      targets: [] as DailyTarget[],
      shifts: [] as ShiftConfig[],
    }
  }

  const [metaResult, targetsResult, shiftsResult] = await Promise.all([
    supabase.rpc('keeta_dashboard_meta'),
    fetchAllRows<DailyTarget>('keeta_daily_targets', 'target_date', dailyTargetsSelect),
    supabase.from('keeta_shift_config').select(shiftConfigSelect).order('turno'),
  ])

  if (metaResult.error) throw metaResult.error
  if (shiftsResult.error) throw shiftsResult.error

  return {
    meta: (metaResult.data ?? { available_weeks: [], turnos: [], modals: [] }) as DashboardMeta,
    targets: targetsResult,
    shifts: (shiftsResult.data ?? []) as ShiftConfig[],
  }
}

export async function fetchDashboardPayload(params: {
  startDate: string
  endDate: string
  name: string
  courierId: string
  turno: string
  modal: string
  sortKey: 'online' | 'utr' | 'delivered'
  sortDirection: 'asc' | 'desc'
  limit: number
  offset: number
}) {
  const emptyPayload: DashboardPayload = {
    summary: { delivered: 0, pedidos: 0, couriers: 0, targetTotal: 0, targetAdherence: 0 },
    byTurno: [],
    byModal: [],
    tableRows: [],
    tableTotal: 0,
  }

  if (!supabase) return emptyPayload

  const { data, error } = await supabase.rpc('keeta_dashboard_payload', {
    p_start_date: params.startDate || null,
    p_end_date: params.endDate || null,
    p_name: params.name || null,
    p_courier_id: params.courierId || null,
    p_turno: params.turno || null,
    p_modal: params.modal || null,
    p_sort_key: params.sortKey,
    p_sort_direction: params.sortDirection,
    p_limit: params.limit,
    p_offset: params.offset,
  })

  if (error) throw error
  return (data ?? emptyPayload) as DashboardPayload
}

export async function importDeliveryRows(fileName: string, rows: ParsedImportRow[]) {
  if (!supabase) throw new Error('Supabase não configurado.')
  if (rows.length === 0) throw new Error('Nenhuma linha válida encontrada.')

  const { data: batch, error: batchError } = await supabase
    .from('keeta_import_batches')
    .insert({
      file_name: fileName,
      row_count: rows.length,
    })
    .select('id')
    .single()

  if (batchError) throw batchError

  const payload = rows.map((row) => ({
    batch_id: batch.id,
    source_row_number: row.source_row_number,
    delivery_date: row.delivery_date,
    turno: row.turno,
    online_time_pct: row.online_time_pct,
    utr: row.utr,
    conc: row.conc,
    courier_id_txt: row.courier_id_txt,
    modal: row.modal,
    pedidos: row.pedidos,
    target_hours_value: row.target_hours_value,
    total_hours_scheduled_value: row.total_hours_scheduled_value,
    raw_payload: row.raw_payload,
  }))

  for (let index = 0; index < payload.length; index += 500) {
    const chunk = payload.slice(index, index + 500)
    const { error } = await supabase.from('keeta_delivery_rows').insert(chunk)
    if (error) throw error
  }

  return batch.id as string
}

export async function upsertDailyTarget(target: DailyTarget) {
  if (!supabase) throw new Error('Supabase não configurado.')
  const { error } = await supabase.from('keeta_daily_targets').upsert(
    {
      target_date: target.target_date,
      turno: target.turno || null,
      required_hours: target.required_hours,
      notes: target.notes || null,
    },
    { onConflict: 'target_date,turno_key' },
  )
  if (error) throw error
}

export async function upsertDailyTargets(targets: DailyTarget[]) {
  if (!supabase) throw new Error('Supabase não configurado.')
  const payload = targets.map((target) => ({
    target_date: target.target_date,
    turno: target.turno || null,
    required_hours: target.required_hours,
    notes: target.notes || null,
  }))
  const { error } = await supabase.from('keeta_daily_targets').upsert(payload, { onConflict: 'target_date,turno_key' })
  if (error) throw error
}

export async function upsertShiftConfig(shifts: ShiftConfig[]) {
  if (!supabase) throw new Error('Supabase não configurado.')
  const { error } = await supabase.from('keeta_shift_config').upsert(shifts, { onConflict: 'turno' })
  if (error) throw error
}
