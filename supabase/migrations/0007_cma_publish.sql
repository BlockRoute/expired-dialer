-- Seller-page publishing. The public read goes through one RPC that returns page fields only;
-- direct anon SELECT on public.cmas (which exposed notes, lead_id, credits_used, normalized_address
-- to anyone who could enumerate rows) is removed.

alter table public.cmas
  add column favor_note text,   -- "Works in your favor", shown on the seller page
  add column weigh_note text;   -- "Buyers will weigh", shown on the seller page

drop policy cmas_public_read on public.cmas;

create function public.get_published_cma(p_slug text)
returns table (
  address text,
  subject jsonb,
  comps jsonb,
  price_range jsonb,
  time_window text,
  radius_miles numeric,
  favor_note text,
  weigh_note text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.address,
    jsonb_build_object(
      'lat', c.subject -> 'lat',
      'lng', c.subject -> 'lng',
      'beds', c.subject -> 'beds',
      'baths', c.subject -> 'baths',
      'sqft', c.subject -> 'sqft',
      'yearBuilt', c.subject -> 'yearBuilt',
      'lotSqft', c.subject -> 'lotSqft',
      'taxAssessed', c.subject -> 'taxAssessed'
    ),
    coalesce(
      (select pg_catalog.jsonb_agg(e.value order by e.ord)
         from pg_catalog.jsonb_array_elements(c.comps) with ordinality as e(value, ord)
        where coalesce((e.value ->> 'excluded')::boolean, false) = false),
      '[]'::jsonb
    ),
    c.price_range,
    c.time_window,
    c.radius_miles,
    c.favor_note,
    c.weigh_note,
    c.published_at
  from public.cmas c
  where c.published_slug = p_slug
    and c.published_at is not null
    and c.price_range is not null;
$$;

revoke all on function public.get_published_cma(text) from public;
grant execute on function public.get_published_cma(text) to anon, authenticated;
