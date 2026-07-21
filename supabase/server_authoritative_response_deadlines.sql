-- Persist and enforce one server-authoritative response deadline per buzz.
-- Normal clues allow 15 seconds; Double Tap clues allow 40 seconds.

begin;

alter table public.rooms
add column if not exists buzz_opened_at timestamptz;

alter table public.buzzes
add column if not exists response_deadline_at timestamptz;

update public.buzzes as b
set response_deadline_at = b.buzzed_at + case
  when coalesce(q.is_double_tap, false) then interval '40 seconds'
  else interval '15 seconds'
end
from public.questions as q
where q.id = b.question_id
  and b.response_deadline_at is null;

alter table public.buzzes
alter column response_deadline_at set not null;

create or replace function public.enforce_buzz_response_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_double_tap boolean;
begin
  if tg_op = 'INSERT' then
    select coalesce(q.is_double_tap, false) into v_is_double_tap
    from public.questions as q
    where q.id = new.question_id;

    if not found then
      raise exception using
        errcode = '23503',
        message = 'Buzz question was not found';
    end if;

    new.response_deadline_at := clock_timestamp() + case
      when v_is_double_tap then interval '40 seconds'
      else interval '15 seconds'
    end;
    return new;
  end if;

  -- A client can never extend or replace the deadline established at insert.
  new.response_deadline_at := old.response_deadline_at;

  if new.response is distinct from old.response
    or new.response_submitted_at is distinct from old.response_submitted_at
  then
    if old.response_submitted_at is not null then
      raise exception using
        errcode = '55000',
        message = 'Response was already submitted';
    end if;

    if clock_timestamp() > old.response_deadline_at then
      raise exception using
        errcode = '55000',
        message = 'Response window has closed';
    end if;

    if new.response is null or btrim(new.response) = '' then
      raise exception using
        errcode = '22023',
        message = 'Response cannot be blank';
    end if;

    -- Never trust a timestamp supplied by the phone.
    new.response_submitted_at := clock_timestamp();
  end if;

  return new;
end;
$$;

drop trigger if exists buzz_response_deadline_guard on public.buzzes;
create trigger buzz_response_deadline_guard
before insert or update on public.buzzes
for each row execute function public.enforce_buzz_response_deadline();

revoke all on function public.enforce_buzz_response_deadline() from public, anon, authenticated;

commit;
