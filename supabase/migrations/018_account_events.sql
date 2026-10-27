-- Accounts: guests first, saved with one tap (Kakao / Apple / Google), phone
-- verification only for the stranger features. Five more onboarding events
-- (web/analytics.js), so the dashboard can say how saving goes and how SMS
-- codes fare (sent vs verified vs failed, by reason only: never the number
-- or the server's message).
--
-- Apply after 017: python3 scripts/apply_migration.py supabase/migrations/018_account_events.sql

alter table public.events drop constraint if exists events_name_check;
alter table public.events add constraint events_name_check check (name in (
  'app_open', 'party_link_opened', 'joined_party', 'name_set', 'character_shuffled', 'character_confirmed',
  'first_game_started', 'first_game_finished', 'recap_shown', 'recap_shared', 'own_party_created', 'invite_sent',
  'verification_prompted', 'verification_completed', 'permission_prompted', 'permission_granted', 'permission_declined',
  'account_save_prompted', 'account_saved', 'account_signed_in', 'verification_code_sent', 'verification_failed'));
