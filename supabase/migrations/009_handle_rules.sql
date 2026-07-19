-- 009: nickname rules — handles stay pseudonymous display names.
-- 2-20 chars, no leading/trailing whitespace. Uniqueness already enforced
-- by the profiles.handle unique constraint.
alter table public.profiles
  add constraint handle_len check (
    char_length(handle) between 2 and 20
    and handle = btrim(handle)
  );
