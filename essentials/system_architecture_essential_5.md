# Essentials 5: Scollarly v5 (four stages, for PRD_5)

*Drafted 2026-11-06 from the owner's flow file and review; amended 2026-11-07 after the engineering review (reuse of existing structures, roles renamed, polling alerts). Signed off by the owner 2026-11-07. A new version, not an edit of `system_architecture_essential_4.md`.*

## Aim & Outcome

Three roles (student, manager, admin); students assigned automatically to a manager; the seven steps as the only statuses; one university per application; the step-2 student form prefilled; private documents, letters and proof of payment; quiet files and deletion three months after Arrived or Closed; one Inbox and one student screen for staff; the corrected home-page steps and fees wording. Every CI, deploy and merge run stays within 3 to 8 minutes. Nothing that works today may break.

## Source PRD

Source PRD: PRD_5.md

## Source Architecture Components

Source Architecture Version: system_architecture_5.md

Built by this file: section 24 (all of it). Rules obeyed, not rebuilt: sections 5 to 11, 13 to 15 of version 1, section 21 of version 2, section 22 of version 3, section 23 of version 4.

## Build Steps

### Working rules

1. Stages in order; modules in order inside a stage; a module starts when the one before has tests passing in CI. At most three modules per stage.
2. A feature branch and pull request per module. Never push to `main`.
3. Module IDs (`S16.1`) with status `in-progress` or `complete` in `tracker_5.md` (entries name this file and architecture 5).
4. Tests with each module. Migrations additive-first (`0022` to `0025`; nothing is dropped, except that `0022` replaces the role check and the one-owner index and renames one column, 24.2, which is safe because the clean-out leaves one account). All text through translation keys. No paid service, third-party script, hotlinked image or charting library.
5. Human actions (legal review, Momo helper wording and setup, owner sign-off, CLAUDE.md amendments, the real Momo process) are recorded only when the owner says so.
6. A new CPU row for every new function (gate 8 ms warm p95), measured with the deploy workflow's opt-in measurement before Stage 19 closes.
7. No new CI job. Keep the v4 pipeline; if a run goes over 8 minutes, fix it before the module closes.
8. Use the connected tools: Neon MCP for migrations and row level security checks, the Cloudflare plugin for Workers, GitHub MCP for pull requests and checks, Playwright MCP for phone-width checks, context7 for library documentation.
9. If a conflict appears, stop and flag.

**Owner prerequisites (all stages):** sign-off of PRD_5, architecture 5 and this file; the `CLAUDE.md` Step 2 change and the two guardrail amendments (documents only in the private bucket through `server/media`; deleting files, not records, three months after Arrived or Closed).

### Stage 16: Roles and assignment

| ID | Module | What is built | Tests |
|---|---|---|---|
| S16.1 | Roles | First the one-time clean-out of tracker_5 flag F41, as a one-off script (not a migration): rehearse on a Neon branch, then a Neon snapshot, then delete every account except the owner's with their data (children before parents) and the 2 payment records. Then migration `0022` (24.2): rename roles (`admin` to `manager`, `owner` to `admin`), the new role check, at most two admins, the SQL role functions, `assigned_admin_id` renamed `assigned_manager_id`, new nullable `app_user` columns, aliases in `isRole`; and the row level security rewrite (24.2) with the CI policy check extended. The owner signs in again after the deploy (F45). | Integration: manager B cannot read or write manager A's rows; a removed manager loses access on the next request; both admins need the second factor; old role names still read as the new ones; a third admin is refused. |
| S16.2 | Assignment | 24.3: `app_assign_manager` on `student_profile.assigned_manager_id` (set at sign-up, copied to the lead at apply), `FOR UPDATE SKIP LOCKED`, away switch, `admin/reassign`, manager removal, the manager's WhatsApp number (from `app_user`) in every signed-in WhatsApp button. | Unit: turn order and away skip; integration: two sign-ups at once, no manager available. |
| S16.3 | Seven steps | 24.2 migration `0023` and 24.4: the seven `pipeline_stage` rows (old rows kept and mapped), the new `lead` columns, the transition table with compare-and-set, the document condition **switched off** until S17.1, the partial unique index for one open application, Admin undo and reopen, the three-day clock. | Unit: every allowed and refused transition, boundaries of the clock; e2e: refusal then a new application. |

### Stage 17: Documents, letters, payments

| ID | Module | What is built | Tests |
|---|---|---|---|
| S17.1 | Private documents | **First the bounded probe (24.5, decision D5)** on a Neon branch: private bucket, presigned PUT from a browser with CORS, presigned GET, delete, quota; record the result and route in tracker_5 (F42, F43). Then `0024`, the `student-docs` bucket, `documents.ts`, upload, content check, approve or reject, signed link with the safe headers, audit; switch on the document condition of 24.4. | Unit: content signature and size; integration: bucket not public, link expires; e2e: failed upload retried alone. |
| S17.2 | Step-2 form | The prefilled form (FR-43), the university passport switch, the passport field only when it is on. | Unit: prefill; e2e at phone width. |
| S17.3 | Letters, proof, ledger, purge | 24.6 and 24.7: letters, payment proof and approval, `0025` ledger approval, the daily purge as a separate job step (by student, at most 40 objects per run), erasure and sign-out clearing of documents. | Integration: ledger entry pending and excluded from existing totals until approved; purge idempotent and keeps shared documents; erasure removes files; student downloads a letter. |

### Stage 18: Screens and public pages

| ID | Module | What is built | Tests |
|---|---|---|---|
| S18.1 | Inbox and student screen | 24.9: the Inbox sections, the student screen, the Next step button, WhatsApp templates, alerts derived on read with the 120-second timer poll and Inbox refetch (24.10; no push, no notification table). | Integration role scoping; e2e at phone width; axe. |
| S18.2 | Admin trim | The pages removed or merged (the `phase0` pages only unlinked, F44), 301 redirects, quiet and suggest-closing, `admin/leads/:id/close`, Team, Universities. | Redirect table test; e2e close a file. |
| S18.3 | Student and public text | Student Progress (seven steps) and alerts; the home steps and the fees wording (after the owner approves the words), English and French. | Unit: no old text in any public HTML; e2e signed-out pages; axe; public bundle check. |

### Stage 19: QA and release

| ID | Module | What is built | Tests |
|---|---|---|---|
| S19.1 | QA and security | Traceability (FR-39 to FR-52 to tests), checklist, review of document access, no personal data in logs, role isolation. | Full CI. |
| S19.2 | Speed and CPU | Time the pull request, build, Playwright, Lighthouse and deploy runs (each within 3 to 8 minutes); CPU rows for every new function including the polled count; Neon compute hours over a working day with the poll running; check that `scripts/measure-cpu.mjs` does not need `phase0` (F44). | The deploy workflow's CPU rows pass. |
| S19.3 | Deploy and carry-over | One deploy with the measurement on, tracker_5, and the owner-paced items still open from Stage 15 (S15.7 list), which stay `in-progress` until the owner says they are done. | `scripts/smoke.mjs` against the live site. |

## Tests (summary)

As architecture 5 section 24.12, plus the existing suites staying green.
