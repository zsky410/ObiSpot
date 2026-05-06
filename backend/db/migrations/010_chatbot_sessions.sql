-- Persist chatbot sessions and resolved conversation state on chat logs.

alter table if exists public.chat_logs
  add column if not exists session_id uuid;

update public.chat_logs
set session_id = gen_random_uuid()
where session_id is null;

alter table if exists public.chat_logs
  alter column session_id set not null;

alter table if exists public.chat_logs
  add column if not exists assistant_reply text;

update public.chat_logs
set assistant_reply = coalesce(assistant_reply, response)
where assistant_reply is null;

alter table if exists public.chat_logs
  add column if not exists source text;

alter table if exists public.chat_logs
  add column if not exists state jsonb not null default '{}'::jsonb;

create index if not exists idx_chat_logs_user_session_created
  on public.chat_logs (user_id, session_id, created_at);

create index if not exists idx_chat_logs_user_created_desc
  on public.chat_logs (user_id, created_at desc);
