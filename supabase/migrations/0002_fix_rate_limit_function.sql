drop function if exists public.consume_rate_limit(text, integer, integer);

create function public.consume_rate_limit(
  bucket_key text,
  max_hits integer,
  window_ms integer
)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_reset timestamptz;
  current_count integer;
  window_interval interval := make_interval(secs => window_ms / 1000.0);
begin
  loop
    select rate_limit_buckets.hit_count, rate_limit_buckets.reset_at
      into current_count, current_reset
      from public.rate_limit_buckets
      where rate_limit_buckets.bucket_key = consume_rate_limit.bucket_key
      for update;

    if not found then
      insert into public.rate_limit_buckets(bucket_key, hit_count, reset_at)
      values (consume_rate_limit.bucket_key, 1, now() + window_interval)
      on conflict on constraint rate_limit_buckets_pkey do nothing;

      allowed := true;
      remaining := max_hits - 1;
      reset_at := now() + window_interval;
      return next;
      return;
    end if;

    if current_reset <= now() then
      update public.rate_limit_buckets
      set hit_count = 1,
          reset_at = now() + window_interval
      where public.rate_limit_buckets.bucket_key = consume_rate_limit.bucket_key;

      allowed := true;
      remaining := max_hits - 1;
      reset_at := now() + window_interval;
      return next;
      return;
    end if;

    if current_count >= max_hits then
      allowed := false;
      remaining := 0;
      reset_at := current_reset;
      return next;
      return;
    end if;

    update public.rate_limit_buckets
    set hit_count = current_count + 1
    where public.rate_limit_buckets.bucket_key = consume_rate_limit.bucket_key;

    allowed := true;
    remaining := max_hits - current_count - 1;
    reset_at := current_reset;
    return next;
    return;
  end loop;
end;
$$;
