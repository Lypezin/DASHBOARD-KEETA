alter table public.keeta_delivery_rows
  add column if not exists total_hours_scheduled_value numeric(12, 4) not null default 0;

update public.keeta_delivery_rows
set total_hours_scheduled_value = coalesce(
  nullif(raw_payload->>'total_hours_scheduled', '')::numeric,
  nullif(raw_payload->>'total hours scheduled', '')::numeric,
  nullif(raw_payload->>'totalHoursScheduled', '')::numeric,
  target_hours_value,
  0
)
where total_hours_scheduled_value = 0;

alter table public.keeta_delivery_rows
  drop column if exists delivered_hours;

alter table public.keeta_delivery_rows
  add column delivered_hours numeric(12, 4)
  generated always as (total_hours_scheduled_value) stored;
