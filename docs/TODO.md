# TODO / Known Issues

## Bugs
- Player count on host lobby doesn't update in realtime when players leave teams (low priority)

## Supabase Setup Required
- Confirm `teams`, `rooms`, `questions`, `buzzes`, `wagers` tables are all added to the Supabase realtime publication (Dashboard → Database → Replication → supabase_realtime). Without this, postgres_changes subscriptions silently do nothing — broadcasts are the fallback but not a full replacement.

## Improvements

## Testing Notes
