begin;

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'profile-avatars'
  ) then
    raise exception 'Expected existing profile-avatars bucket was not found; no bucket was created.';
  end if;

  update storage.buckets
  set public = false
  where id = 'profile-avatars';
end;
$$;

commit;
