-- =============================================================================
-- 本機開發用 seed（supabase db reset 時自動執行）
--
-- Phase 1 只建立一個本機測試帳號，示範資料（氫氟酸／汞／蘇丹紅）
-- 會在對應資料表建立後於後續 Phase 加入本檔。
--
-- 帳號：dev@example.com
-- 密碼：devpassword123
-- 僅用於本機 supabase start，不會出現在正式環境。
-- =============================================================================

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000a1',
  'authenticated',
  'authenticated',
  'dev@example.com',
  crypt('devpassword123', gen_salt('bf')),
  timezone('utc', now()),
  '{"provider":"email","providers":["email"]}',
  '{"display_name":"本機開發者"}',
  timezone('utc', now()),
  timezone('utc', now())
)
on conflict (id) do nothing;

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","email":"dev@example.com","email_verified":true,"phone_verified":false}',
  'email',
  timezone('utc', now()),
  timezone('utc', now()),
  timezone('utc', now())
)
on conflict (id) do nothing;
