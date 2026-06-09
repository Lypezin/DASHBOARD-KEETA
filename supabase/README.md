# Supabase setup

Execute `supabase/migrations/20260609162000_keeta_dashboard.sql` no SQL Editor do projeto Supabase.

Essa migration cria:

- `keeta_import_batches`
- `keeta_delivery_rows`
- `keeta_shift_config`
- `keeta_daily_targets`
- indices para data, turno, modal, UTR e busca por nome
- RPCs `keeta_dashboard_summary` e `keeta_target_vs_delivered`

A coluna `delivered_hours` e gerada no banco como `target_hours_value / 24.0`, seguindo a regra da dashboard.
