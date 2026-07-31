-- =============================================================================
-- Phase 4 修補：回收卡住的背景工作
--
-- 工作被 claim_processing_jobs 認領後狀態是 processing。
-- 若 Edge Function 中途中斷（逾時、部署中、當機），該工作不會被任何人再認領，
-- 前端就會永遠停在「處理中」。
-- 這裡提供逾時回收：超過指定分鐘數仍在 processing 的工作放回佇列重試。
-- =============================================================================

create or replace function public.requeue_stale_jobs(p_timeout_minutes integer default 5)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with stale as (
    update public.processing_jobs
    set
      status = case
        when attempts >= max_attempts then 'failed'::public.job_status
        else 'retrying'::public.job_status
      end,
      last_error = coalesce(
        last_error,
        format('工作逾時未完成（超過 %s 分鐘），已放回佇列', p_timeout_minutes)
      ),
      scheduled_at = timezone('utc', now()),
      locked_at = null,
      locked_by = null,
      finished_at = case
        when attempts >= max_attempts then timezone('utc', now())
        else null
      end
    where status = 'processing'
      and locked_at is not null
      and locked_at < timezone('utc', now()) - make_interval(mins => p_timeout_minutes)
    returning id
  )
  select count(*) into v_count from stale;

  return v_count;
end;
$$;

comment on function public.requeue_stale_jobs is
  '把逾時卡在 processing 的工作放回佇列；已達重試上限者標記為 failed。';

revoke all on function public.requeue_stale_jobs(integer) from public;
grant execute on function public.requeue_stale_jobs(integer) to service_role;

-- 一次性清理：把目前已經卡住的工作放回佇列（部署本 migration 時立即生效）。
select public.requeue_stale_jobs(0);
