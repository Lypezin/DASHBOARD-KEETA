create index if not exists keeta_delivery_rows_courier_id_idx
  on public.keeta_delivery_rows (courier_id_txt);

create index if not exists keeta_delivery_rows_date_turno_modal_idx
  on public.keeta_delivery_rows (delivery_date, turno, modal);

create or replace function public.keeta_dashboard_meta()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with dated_rows as (
    select distinct delivery_date
    from public.keeta_delivery_rows
    where delivery_date is not null
  ),
  weeks as (
    select
      extract(year from week_start)::int as year,
      (floor((week_start - date_trunc('week', make_date(extract(year from week_start)::int, 1, 1))::date) / 7) + 1)::int as week_number,
      week_start as start_date,
      (week_start + 6) as end_date
    from (
      select date_trunc('week', delivery_date)::date as week_start
      from dated_rows
    ) w
    group by week_start
  )
  select jsonb_build_object(
    'available_weeks',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', year::text || '-' || lpad(week_number::text, 2, '0'),
            'year', year,
            'weekNumber', week_number,
            'startDate', start_date,
            'endDate', end_date
          )
          order by start_date desc
        )
        from weeks
      ),
      '[]'::jsonb
    ),
    'turnos',
    coalesce((select jsonb_agg(turno order by turno) from (select distinct turno from public.keeta_delivery_rows where turno <> '') t), '[]'::jsonb),
    'modals',
    coalesce((select jsonb_agg(modal order by modal) from (select distinct modal from public.keeta_delivery_rows where modal <> '') m), '[]'::jsonb)
  );
$$;

create or replace function public.keeta_dashboard_payload(
  p_start_date date default null,
  p_end_date date default null,
  p_name text default null,
  p_courier_id text default null,
  p_turno text default null,
  p_modal text default null,
  p_sort_key text default 'delivered',
  p_sort_direction text default 'desc',
  p_limit integer default 250,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with filtered as (
    select
      d.id,
      d.delivery_date,
      d.turno,
      d.online_time_pct,
      d.utr,
      d.conc,
      d.courier_id_txt,
      d.modal,
      d.pedidos,
      d.delivered_hours
    from public.keeta_delivery_rows d
    where (p_start_date is null or d.delivery_date >= p_start_date)
      and (p_end_date is null or d.delivery_date <= p_end_date)
      and (p_name is null or p_name = '' or d.conc ilike '%' || p_name || '%')
      and (p_courier_id is null or p_courier_id = '' or d.courier_id_txt ilike '%' || p_courier_id || '%')
      and (p_turno is null or p_turno = '' or d.turno = p_turno)
      and (p_modal is null or p_modal = '' or d.modal = p_modal)
  ),
  target_filtered as (
    select t.target_date, t.turno, t.required_hours
    from public.keeta_daily_targets t
    where (p_start_date is null or t.target_date >= p_start_date)
      and (p_end_date is null or t.target_date <= p_end_date)
      and (p_turno is null or p_turno = '' or t.turno = p_turno)
      and t.turno is not null
  ),
  summary as (
    select
      coalesce(sum(delivered_hours), 0) as delivered,
      coalesce(sum(pedidos), 0) as pedidos,
      count(distinct courier_id_txt) as couriers
    from filtered
  ),
  target_summary as (
    select coalesce(sum(required_hours), 0) as target_total
    from target_filtered
  ),
  by_turno_delivered as (
    select
      coalesce(turno, 'Sem turno') as turno,
      coalesce(sum(delivered_hours), 0) as delivered,
      coalesce(avg(online_time_pct), 0) as online,
      count(*) as rows_count
    from filtered
    group by coalesce(turno, 'Sem turno')
  ),
  by_turno_targets as (
    select turno, coalesce(sum(required_hours), 0) as target
    from target_filtered
    group by turno
  ),
  by_turno as (
    select
      coalesce(d.turno, t.turno) as turno,
      coalesce(d.delivered, 0) as delivered,
      coalesce(t.target, 0) as target,
      coalesce(d.online, 0) as online,
      coalesce(d.rows_count, 0) as rows_count
    from by_turno_delivered d
    full join by_turno_targets t on t.turno = d.turno
  ),
  by_modal as (
    select
      coalesce(modal, 'Sem modal') as name,
      coalesce(sum(delivered_hours), 0) as value
    from filtered
    group by coalesce(modal, 'Sem modal')
  ),
  courier_grouped as (
    select
      coalesce(nullif(courier_id_txt, ''), conc) as key,
      min(delivery_date) as first_date,
      max(delivery_date) as last_date,
      max(courier_id_txt) as courier_id_txt,
      max(conc) as conc,
      case when count(distinct turno) = 1 then max(turno) else 'Múltiplos' end as turno,
      coalesce(avg(online_time_pct), 0) as online_time_pct,
      avg(
        case
          when replace(utr, ',', '.') ~ '^-?[0-9]+(\.[0-9]+)?$'
          then replace(utr, ',', '.')::numeric
          else null
        end
      ) as utr,
      case when count(distinct modal) = 1 then max(modal) else 'Múltiplos' end as modal,
      coalesce(sum(pedidos), 0) as pedidos,
      coalesce(sum(delivered_hours), 0) as delivered_hours,
      count(*) as source_rows
    from filtered
    group by coalesce(nullif(courier_id_txt, ''), conc)
  ),
  courier_ranked as (
    select *
    from courier_grouped
    order by
      case when p_sort_key = 'online' and p_sort_direction = 'asc' then online_time_pct end asc nulls last,
      case when p_sort_key = 'online' and p_sort_direction <> 'asc' then online_time_pct end desc nulls last,
      case when p_sort_key = 'utr' and p_sort_direction = 'asc' then utr end asc nulls last,
      case when p_sort_key = 'utr' and p_sort_direction <> 'asc' then utr end desc nulls last,
      case when p_sort_key = 'delivered' and p_sort_direction = 'asc' then delivered_hours end asc nulls last,
      case when p_sort_key = 'delivered' and p_sort_direction <> 'asc' then delivered_hours end desc nulls last,
      delivered_hours desc,
      conc asc
    limit greatest(0, least(coalesce(p_limit, 250), 500))
    offset greatest(0, coalesce(p_offset, 0))
  ),
  courier_count as (
    select count(*) as total from courier_grouped
  )
  select jsonb_build_object(
    'summary',
    jsonb_build_object(
      'delivered', (select delivered from summary),
      'pedidos', (select pedidos from summary),
      'couriers', (select couriers from summary),
      'targetTotal', (select target_total from target_summary),
      'targetAdherence',
        case
          when (select target_total from target_summary) > 0
          then ((select delivered from summary) / (select target_total from target_summary)) * 100
          else 0
        end
    ),
    'byTurno',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('turno', turno, 'delivered', delivered, 'target', target, 'online', online)
          order by case turno when 'Almoço' then 1 when 'Lanche' then 2 when 'Jantar' then 3 when 'Ceia' then 4 else 99 end
        )
        from by_turno
      ),
      '[]'::jsonb
    ),
    'byModal',
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('name', name, 'value', value) order by value desc)
        from by_modal
      ),
      '[]'::jsonb
    ),
    'tableRows',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', key,
            'firstDate', first_date,
            'lastDate', last_date,
            'courier_id_txt', courier_id_txt,
            'conc', conc,
            'turno', turno,
            'online_time_pct', online_time_pct,
            'utr', utr,
            'modal', modal,
            'pedidos', pedidos,
            'delivered_hours', delivered_hours,
            'sourceRows', source_rows
          )
        )
        from courier_ranked
      ),
      '[]'::jsonb
    ),
    'tableTotal', (select total from courier_count)
  );
$$;
