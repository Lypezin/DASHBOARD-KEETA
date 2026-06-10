create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.keeta_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  row_count integer not null default 0 check (row_count >= 0),
  imported_at timestamptz not null default now()
);

create table if not exists public.keeta_shift_config (
  turno text primary key,
  expected_hours numeric(8, 2) not null check (expected_hours >= 0),
  updated_at timestamptz not null default now()
);

insert into public.keeta_shift_config (turno, expected_hours)
values
  ('Almoço', 4),
  ('Lanche', 3),
  ('Jantar', 4),
  ('Ceia', 2)
on conflict (turno) do update
set expected_hours = excluded.expected_hours,
    updated_at = now();

create table if not exists public.keeta_daily_targets (
  id uuid primary key default gen_random_uuid(),
  target_date date not null,
  turno text null,
  turno_key text generated always as (coalesce(turno, '__all__')) stored,
  required_hours numeric(12, 2) not null check (required_hours >= 0),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists keeta_daily_targets_date_turno_uidx
  on public.keeta_daily_targets (target_date, turno_key);

create table if not exists public.keeta_delivery_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid null references public.keeta_import_batches(id) on delete set null,
  source_row_number integer null,
  delivery_date date null,
  turno text not null default '',
  online_time_pct numeric(8, 4) not null default 0,
  utr text null,
  conc text not null default '',
  courier_id_txt text not null default '',
  modal text not null default '',
  pedidos numeric(12, 2) not null default 0,
  target_hours_value numeric(12, 4) not null default 0,
  delivered_hours numeric(12, 4) generated always as (target_hours_value / 24.0) stored,
  raw_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);

create index if not exists keeta_delivery_rows_date_idx
  on public.keeta_delivery_rows (delivery_date);

create index if not exists keeta_delivery_rows_turno_idx
  on public.keeta_delivery_rows (turno);

create index if not exists keeta_delivery_rows_modal_idx
  on public.keeta_delivery_rows (modal);

create index if not exists keeta_delivery_rows_utr_idx
  on public.keeta_delivery_rows (utr);

create index if not exists keeta_delivery_rows_conc_trgm_idx
  on public.keeta_delivery_rows using gin (conc gin_trgm_ops);

create or replace function public.set_keeta_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_keeta_daily_targets_updated_at on public.keeta_daily_targets;
create trigger set_keeta_daily_targets_updated_at
before update on public.keeta_daily_targets
for each row execute function public.set_keeta_updated_at();

drop trigger if exists set_keeta_shift_config_updated_at on public.keeta_shift_config;
create trigger set_keeta_shift_config_updated_at
before update on public.keeta_shift_config
for each row execute function public.set_keeta_updated_at();

create or replace function public.keeta_dashboard_summary(
  p_start_date date default null,
  p_end_date date default null,
  p_turnos text[] default null,
  p_modals text[] default null,
  p_utrs text[] default null,
  p_name text default null
)
returns table (
  turno text,
  modal text,
  utr text,
  couriers bigint,
  rows_count bigint,
  delivered_hours numeric,
  avg_online_time_pct numeric
)
language sql
stable
as $$
  select
    d.turno,
    d.modal,
    d.utr,
    count(distinct d.courier_id_txt) as couriers,
    count(*) as rows_count,
    coalesce(sum(d.delivered_hours), 0) as delivered_hours,
    coalesce(avg(d.online_time_pct), 0) as avg_online_time_pct
  from public.keeta_delivery_rows d
  where (p_start_date is null or d.delivery_date >= p_start_date)
    and (p_end_date is null or d.delivery_date <= p_end_date)
    and (p_turnos is null or d.turno = any(p_turnos))
    and (p_modals is null or d.modal = any(p_modals))
    and (p_utrs is null or d.utr = any(p_utrs))
    and (p_name is null or d.conc ilike '%' || p_name || '%')
  group by d.turno, d.modal, d.utr
  order by delivered_hours desc;
$$;

create or replace function public.keeta_target_vs_delivered(
  p_start_date date default null,
  p_end_date date default null,
  p_turno text default null
)
returns table (
  target_date date,
  turno text,
  delivered_hours numeric,
  required_hours numeric,
  adherence_pct numeric
)
language sql
stable
as $$
  with delivered as (
    select
      d.delivery_date as target_date,
      d.turno,
      sum(d.delivered_hours) as delivered_hours
    from public.keeta_delivery_rows d
    where d.delivery_date is not null
      and (p_start_date is null or d.delivery_date >= p_start_date)
      and (p_end_date is null or d.delivery_date <= p_end_date)
      and (p_turno is null or d.turno = p_turno)
    group by d.delivery_date, d.turno
  ),
  targets as (
    select
      t.target_date,
      coalesce(t.turno, d.turno) as turno,
      t.required_hours
    from public.keeta_daily_targets t
    left join delivered d on d.target_date = t.target_date and t.turno is null
    where (p_start_date is null or t.target_date >= p_start_date)
      and (p_end_date is null or t.target_date <= p_end_date)
      and (p_turno is null or t.turno is null or t.turno = p_turno)
  )
  select
    coalesce(t.target_date, d.target_date) as target_date,
    coalesce(t.turno, d.turno) as turno,
    coalesce(d.delivered_hours, 0) as delivered_hours,
    coalesce(t.required_hours, 0) as required_hours,
    case
      when coalesce(t.required_hours, 0) = 0 then 0
      else (coalesce(d.delivered_hours, 0) / t.required_hours) * 100
    end as adherence_pct
  from targets t
  full join delivered d
    on d.target_date = t.target_date
   and d.turno = t.turno
  order by target_date desc, turno;
$$;
