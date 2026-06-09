# Dashboard KEETA

Dashboard operacional para importar planilhas de entregadores e comparar horas entregues contra metas.

Formatos de importacao aceitos: `.xlsx` e `.csv`.

## Regras implementadas

- `TURNO`: coluna `Turno`
- `ADERENCIA DO ENTREGADOR`: coluna `%OnlineTime`
- `UTR`: coluna `UTR`
- `NOME`: coluna `Conc`
- `ID`: coluna `courier_id_txt`
- `MODAL`: coluna `modal`
- `HORAS ENTREGUES`: coluna `total_hours_scheduled`

## Rodar localmente

```bash
npm install
npm run dev
```

## Banco Supabase

Execute a migration abaixo no SQL Editor do Supabase:

```text
supabase/migrations/20260609162000_keeta_dashboard.sql
```

Depois disso, a dashboard consegue carregar dados, salvar metas, configurar turnos e importar planilhas.

Tambem da para aplicar as migrations via terminal usando uma connection string Postgres:

```bash
DATABASE_URL="postgresql://postgres:SENHA@HOST:5432/postgres" npm run db:apply
```

## Admin

Os turnos padrao sao:

- Almoco: 4h
- Lanche: 3h
- Jantar: 4h
- Ceia: 2h

A meta diaria pode ser cadastrada como geral do dia ou por turno. A aderencia da meta e calculada como:

```text
horas entregues / horas a entregar * 100
```
