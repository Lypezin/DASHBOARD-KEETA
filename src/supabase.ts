import { createClient } from '@supabase/supabase-js'
import type { DailyTarget, DeliveryRow, ParsedImportRow, ShiftConfig } from './types'

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

async function fetchAllRows<T>(table: string, orderColumn: string) {
  if (!supabase) return [] as T[]

  const pageSize = 1000
  const rows: T[] = []

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from(table)
      .select('*')
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
    return { rows: [] as DeliveryRow[], targets: [] as DailyTarget[], shifts: [] as ShiftConfig[] }
  }

  const [rows, targetsResult, shiftsResult] = await Promise.all([
    fetchAllRows<DeliveryRow>('keeta_delivery_rows', 'delivery_date'),
    fetchAllRows<DailyTarget>('keeta_daily_targets', 'target_date'),
    supabase.from('keeta_shift_config').select('*').order('turno'),
  ])

  if (shiftsResult.error) throw shiftsResult.error

  return {
    rows,
    targets: targetsResult,
    shifts: (shiftsResult.data ?? []) as ShiftConfig[],
  }
}

export async function importDeliveryRows(fileName: string, rows: ParsedImportRow[]) {
  if (!supabase) throw new Error('Supabase nao configurado.')
  if (rows.length === 0) throw new Error('Nenhuma linha valida encontrada.')

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
    target_hours_value: row.target_hours_value,
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
  if (!supabase) throw new Error('Supabase nao configurado.')
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
  if (!supabase) throw new Error('Supabase nao configurado.')
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
  if (!supabase) throw new Error('Supabase nao configurado.')
  const { error } = await supabase.from('keeta_shift_config').upsert(shifts, { onConflict: 'turno' })
  if (error) throw error
}
