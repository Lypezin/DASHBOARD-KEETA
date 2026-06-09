import * as XLSX from 'xlsx'
import type { ParsedImportRow } from './types'

const columnAliases = {
  online: ['%onlinetime', 'onlinetime', '% online time', 'online time'],
  utr: ['utr'],
  conc: ['conc', 'nome', 'name'],
  courierId: ['courier_id_txt', 'courier id', 'id'],
  modal: ['modal'],
  turno: ['turno'],
  targetHours: ['target hours', 'target_hours', 'targethours'],
  date: ['data', 'date', 'delivery_date', 'dt', 'dia'],
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function findValue(row: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(row)
  for (const alias of aliases) {
    const found = entries.find(([key]) => normalizeHeader(key) === alias)
    if (found) return found[1]
  }
  return null
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function numberValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(String(value ?? '').replace('%', '').replace(',', '.').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function percentValue(value: unknown) {
  const parsed = numberValue(value)
  if (parsed > 0 && parsed <= 1) return parsed * 100
  return parsed
}

function excelDateToIso(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }

  const raw = text(value)
  if (!raw) return null

  const brazilian = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (brazilian) {
    const year = brazilian[3].length === 2 ? `20${brazilian[3]}` : brazilian[3]
    return `${year}-${brazilian[2].padStart(2, '0')}-${brazilian[1].padStart(2, '0')}`
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

export async function parseWorkbook(file: File): Promise<ParsedImportRow[]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

  return jsonRows
    .map((row, index) => {
      const targetHours = numberValue(findValue(row, columnAliases.targetHours))
      return {
        source_row_number: index + 2,
        delivery_date: excelDateToIso(findValue(row, columnAliases.date)),
        turno: text(findValue(row, columnAliases.turno)),
        online_time_pct: percentValue(findValue(row, columnAliases.online)),
        utr: text(findValue(row, columnAliases.utr)) || null,
        conc: text(findValue(row, columnAliases.conc)),
        courier_id_txt: text(findValue(row, columnAliases.courierId)),
        modal: text(findValue(row, columnAliases.modal)),
        target_hours_value: targetHours,
        delivered_hours: targetHours / 24,
        raw_payload: row,
      }
    })
    .filter((row) => row.turno || row.conc || row.courier_id_txt)
}
