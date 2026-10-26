# Synced KPI documents

GitHub Actions mirrors Version History here automatically, on a five-minute
schedule (GitHub may delay a run). Use **Actions → Sync KPI documents → Run workflow**
to request a sync manually. Pull the repository to update the local VS Code folder.

Each version has a separate ID-prefixed Excel file and JSON data snapshot. Older
versions uploaded before original-file storage was added have only a JSON snapshot.
Uploading the Excel again retains its exact original bytes for future syncs.

Removing a version in the dashboard removes its managed files here on the next
successful sync. The current baseline cannot be removed. Files remain in earlier
Git commits, as usual for Git history. This is a mirror, not a second source of
dashboard data: editing these files does not change the live dashboard.

`manifest.json` records the current baseline and managed versions. Do not edit it
or the generated files manually. Sync does not delete other manually added files
or the separate `data/baseline.json` seed.
