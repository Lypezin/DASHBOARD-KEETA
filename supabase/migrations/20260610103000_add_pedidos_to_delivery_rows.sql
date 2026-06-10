alter table public.keeta_delivery_rows
  add column if not exists pedidos numeric(12, 2) not null default 0;

with normalized as (
  select
    id,
    replace(
      regexp_replace(coalesce(raw_payload ->> 'pedidos', ''), '[^0-9,.-]', '', 'g'),
      ',',
      '.'
    ) as value
  from public.keeta_delivery_rows
  where raw_payload ? 'pedidos'
)
update public.keeta_delivery_rows rows
set pedidos = case
  when normalized.value ~ '^-?[0-9]+(\.[0-9]+)?$' then normalized.value::numeric
  else 0
end
from normalized
where rows.id = normalized.id;
