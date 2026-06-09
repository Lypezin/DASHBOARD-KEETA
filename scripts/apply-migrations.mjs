import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('Defina DATABASE_URL antes de rodar npm run db:apply.')
  process.exit(1)
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
})

await client.connect()

try {
  const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    await client.query(sql)
    console.log(`applied ${file}`)
  }
} finally {
  await client.end()
}
