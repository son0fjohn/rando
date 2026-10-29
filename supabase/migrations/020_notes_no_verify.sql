-- Notes: anyone signed in can leave one, guests included — no verified
-- phone or Kakao account needed (the owner's call). Everything else in
-- leave_note stays as 019 has it: bans, the text filter, 5 a day, the 20 m
-- snap, the spot. Earning coins from notes (_note_pay) still needs a
-- verified account, like every other coin.

create or replace function leave_note(p_lat float8, p_lng float8, p_kind text, p_body text default null,
                                      p_top text default null, p_bottom text default null, p_image text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  slat  float8;
  slng  float8;
  sp    note_spots%rowtype;
  why   text;
  today integer;
  n     notes%rowtype;
begin
  if me is null then raise exception 'sign in first'; end if;
  if _note_banned(me) then return jsonb_build_object('ok', false, 'why', 'banned'); end if;
  if p_kind not in ('text', 'photo', 'meme') then raise exception 'bad kind'; end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 85 or abs(p_lng) > 180 then raise exception 'bad position'; end if;
  p_body := nullif(btrim(p_body), ''); p_top := nullif(btrim(p_top), ''); p_bottom := nullif(btrim(p_bottom), '');
  if p_kind = 'text' and (p_body is null or p_image is not null or p_top is not null or p_bottom is not null) then raise exception 'bad note'; end if;
  if p_kind <> 'text' and (p_image is null or p_image !~ ('^' || me::text || '/[0-9a-f-]{36}\.jpg$')) then raise exception 'bad image'; end if;
  if p_kind = 'photo' and (p_top is not null or p_bottom is not null) then raise exception 'bad note'; end if;
  if p_kind = 'meme' and p_body is not null then raise exception 'bad note'; end if;
  if char_length(coalesce(p_body, '')) > 200 or char_length(coalesce(p_top, '')) > 60 or char_length(coalesce(p_bottom, '')) > 60 then
    return jsonb_build_object('ok', false, 'why', 'long');
  end if;
  why := coalesce(note_text_problem(p_body), note_text_problem(p_top), note_text_problem(p_bottom));
  if why is not null then return jsonb_build_object('ok', false, 'why', why); end if;
  -- 5 a day (a lock on the author's row keeps two at once from both getting the 5th)
  perform pg_advisory_xact_lock(hashtext('notes:' || me::text));
  select count(*) into today from notes where author = me and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if today >= 5 then return jsonb_build_object('ok', false, 'why', 'limit', 'left', 0); end if;
  -- snapped again here, whatever the phone sent
  slat := note_snap_lat(p_lat);
  slng := note_snap_lng(slat, p_lng);
  select * into sp from note_spots s where note_dist(slat, slng, s.lat, s.lng) <= 60
    order by note_dist(slat, slng, s.lat, s.lng) limit 1;
  insert into notes (author, kind, body, cap_top, cap_bottom, image, image_state, lat, lng, spot, expires_at)
    values (me, p_kind, p_body, p_top, p_bottom, p_image, case when p_image is null then 'none' else 'pending' end,
            slat, slng, sp.id, now() + (case when sp.id is null then 7 else 10 end) * interval '1 day')
    returning * into n;
  return _note_card(n, me) || jsonb_build_object('left', 4 - today);
end;
$$;
