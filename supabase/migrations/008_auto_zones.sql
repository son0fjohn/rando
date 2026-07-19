-- 008: auto zones — accurate coarse location outside the Itaewon launch
-- area. The client snaps on-device: within 3km of a fixed zone it uses
-- that; otherwise it rounds its position to a ~2.2km grid cell and asks
-- for that CELL (never raw GPS — the server validates the value is on the
-- grid and rejects anything more precise). Everyone in the same cell
-- shares one zone marker, exactly like the fixed zones.

alter table public.zones
  add column kind text not null default 'fixed' check (kind in ('fixed', 'auto'));

create or replace function public.ensure_auto_zone(
  p_cell_lat double precision,
  p_cell_lng double precision
)
returns public.zones
language plpgsql
security definer
set search_path = public
as $$
declare
  zid text;
  z zones;
  h int;
begin
  -- reject anything not exactly on the coarse grid (no precise coords)
  if abs(round(p_cell_lat / 0.02) * 0.02 - p_cell_lat) > 1e-9
     or abs(round(p_cell_lng / 0.02) * 0.02 - p_cell_lng) > 1e-9 then
    raise exception 'not a coarse grid cell';
  end if;
  if p_cell_lat < -90 or p_cell_lat > 90 or p_cell_lng < -180 or p_cell_lng > 180 then
    raise exception 'out of range';
  end if;

  zid := 'auto_' || replace(p_cell_lat::text, '.', 'p') || '_' || replace(p_cell_lng::text, '.', 'p');
  select * into z from zones where id = zid;
  if found then return z; end if;

  -- deterministic marker spot on the world art, derived from the cell id
  h := abs(hashtext(zid));
  insert into zones (id, name, lat, lng, marker_x, marker_y, kind)
  values (
    zid,
    'Area ' || to_char(p_cell_lat, 'FM990.00') || ', ' || to_char(p_cell_lng, 'FM9990.00'),
    p_cell_lat, p_cell_lng,
    18 + (h % 65),
    44 + ((h / 100) % 34),
    'auto'
  )
  on conflict (id) do nothing;
  select * into z from zones where id = zid;
  return z;
end;
$$;

revoke all on function public.ensure_auto_zone(double precision, double precision) from public, anon;
grant execute on function public.ensure_auto_zone(double precision, double precision) to authenticated;
