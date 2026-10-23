# KPI Dashboard

Main URL: https://kpi-dashboard.vin8228.workers.dev/?v=20260611a

The existing HTML/CSS/JavaScript dashboard is served by a Cloudflare Worker. Shared approved data and immutable version history are stored in Cloudflare D1. Excel validation and comparison run on the Worker; uploads require explicit approval before saving. Uploads and history are available to everyone without sign-in.

## Baseline and uploads

The initial baseline is **2. 4 Main Services KPI Checklist 2025 & 2026-1.xlsx** (1,830 monthly task records). `data/baseline.json` seeds an empty database only. Once a user approves an upload, that approved version becomes the shared baseline for the next upload. Restarting or redeploying does not restore the original seed over saved versions.

1. Select an Excel document.
2. Confirm validation. The four service worksheets and their tasks are checked.
3. Review the affected-record total and three summary cards: Status Changes, Assignment Changes and Monthly Updates. Counts and examples come from the actual comparison. **View Details** expands the searchable table and optional assignment matching. No saved data changes at this point.
4. Click **Update Successful** to apply the reviewed changes. While saving, controls are disabled. After saving succeeds, Step 4 confirms success and both charts refresh. **View Changes** shows its audit report.

Cancel at stages 1–3 leaves the current saved baseline unchanged. Invalid documents cannot be approved. An identical upload creates no redundant version. A database with no seed creates its first baseline with an empty change report.

At Step 1, a filename matching Version History (including the current baseline) asks **Do you want to use the newly uploaded file?** **Use Uploaded File** validates the selected upload and compares its contents with the current baseline; **Cancel** keeps the baseline unchanged. Step 3 lets the user review and apply the changes. Changed data is saved as a new version, preserving older versions even when filenames are identical. Identical KPI data produces no redundant version.

**Version History** lists all saved files. **Use This Version** starts at Step 2, validating the saved KPI records against the current baseline, then shows Step 3's differences. Clicking **Update Successful** selects the saved file as the baseline, refreshes both charts and shows Step 4's success message. Cancel leaves the baseline unchanged. No duplicate version is created. Saved files with identical KPI data can still be selected after confirmation. Reviews expire after one hour; stale reviews and removed target versions cannot be applied.

Other open dashboard tabs refresh approved shared data on focus or within 30 seconds. An open review is kept intact; stale approval is rejected by the server.

**Remove** in Version History opens a confirmation showing the file and saved date. **Cancel** keeps it; **Delete Document** permanently removes that saved version for everyone. The current baseline cannot be removed until another version is selected. The server also checks this at deletion time, protecting a version selected by another user while the confirmation is open.

## Status and deadline rules

| Excel cell | Status |
| --- | --- |
| Tick or Closing | Task Done |
| Dashes | Not Applicable |
| Colored cell without an explicit tick/Closing/dash | Wait for Approval |
| Blank, uncolored cell | Blank task; Delay Task after its reporting month ends |

Explicit text marks override background fills. Signature rows, worksheet legends and unassigned E-Invoice requests explicitly marked NO are excluded.

These workbooks contain monthly periods rather than individual due dates. A blank task in the current or a future month is displayed as **Not due yet**, excluded from delay totals and included in completion-rate denominators. It becomes delayed after the reporting month ends in **Asia/Singapore**. This is a display calculation, not a manufactured Excel change or saved version. Completion rates count both **PIC Completed** and **Boss Completed** tasks. The existing **To** month is the review month: the chart includes work through the preceding month, as stated beside the date filter.

## Stable task matching

Each approved assignment receives a stable identity independent of Excel row numbers. Matching first uses an optional `Task ID` or `Record ID`, then normalized company/service/task/reviewer assignment. A unique remaining task within the same company/service/task type can retain its identity across PIC and role changes.

Legacy workbooks have no permanent IDs. A company rename cannot reliably be distinguished from a removed task plus a new company using row position. The review screen offers **Link renamed or reassigned companies** for a user to resolve these cases. Unlinked tasks are explicitly listed as added/removed. Explicit IDs can track company renames directly. IDs must identify one assignment; main and sub assignments need different IDs, and each monthly record for that assignment uses the same ID.

Validation supports the four matrix worksheets and complete `Clean_Data` exports. New PIC names are added to dashboard filters automatically. Unknown statuses, missing required sheets/fields, invalid month headings, conflicting IDs and duplicate monthly records are rejected.

## Local development and testing

```powershell
npm.cmd install
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --persist-to .wrangler/workflow-local
npm.cmd run dev
```

No account or password is required. Write requests require a matching Origin.

```powershell
npm.cmd test
npm.cmd run test:browser
```

Browser/API tests run the actual Worker and D1 locally using isolated `.wrangler/workflow-tests` and `.wrangler/first-import-tests` stores. The setup resets only those local test stores. They do not use a remote database. Tests use installed Microsoft Edge in headless mode.

The regression suite uses both actual workbooks:

- `KPI Checklist for Closing Year 2026.xlsx`: 1,482 validated monthly records.
- `2. 4 Main Services KPI Checklist 2025 & 2026-1.xlsx`: 1,830 validated monthly records.

It covers both upload directions, all chart filters, first import, no changes, cancellation, failed validation/save, shared persistence, history, version selection, public access, stale updates, stable identities, deadline boundaries and mobile layout.

`public/` is the deployed asset directory. The root HTML/JS/CSS copies are retained to match the existing repository layout; keep them synchronized when editing. The import script regenerates bundled data but does not modify an existing D1 baseline.

## Deployment

Only deploy after local tests pass against both Excel files. Set the real D1 database ID in `wrangler.toml`, apply migrations to that database before publishing. Do not deploy the placeholder local database ID or the test-only `EMPTY_BASELINE` setting.

```powershell
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote
npm.cmd run deploy
```

The initial seed and approved records remain in D1; changing `data/baseline.json` does not overwrite a nonempty shared database. For a normal baseline change, use the approved upload workflow.
