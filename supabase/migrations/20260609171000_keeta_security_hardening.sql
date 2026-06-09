create schema if not exists extensions;

alter extension pg_trgm set schema extensions;

alter table public.keeta_import_batches enable row level security;
alter table public.keeta_shift_config enable row level security;
alter table public.keeta_daily_targets enable row level security;
alter table public.keeta_delivery_rows enable row level security;

create or replace function public.set_keeta_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
set search_path = public, pg_temp
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
set search_path = public, pg_temp
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
