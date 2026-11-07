# Tracker 5: Scollarly v5 (Stages 16 to 19)

Maintained by Claude Code. Human actions (legal review, DNS, OAuth credentials, vendor terms, owner sign-off) are recorded here only when the owner says they are done.

This tracker starts version 5 (PRD_5, architecture 5, essentials 5). `tracker_4.md` is the history of Stage 15, `tracker_3.md` of Stage 14, `tracker_2.md` of Stage 13 and `tracker_1.md` of Stages 0 to 12; all stay in the repository.

## Current position

| Item | Value |
|---|---|
| Current PRD | `PRD_5.md` (2026-11-06, full copy: part A amendments, part B the whole of PRD_4) |
| Current architecture | `system_architecture_5.md` (2026-11-06, derived from `PRD_5.md`; section 24 wins over older text) |
| Essentials file | `essentials/system_architecture_essential_5.md` (Stages 16 to 19, at most three modules each) |
| Phase | Documents written 2026-11-06; **the owner signed off the three documents 2026-11-07.** No code started. Nothing is committed yet: the owner wants one commit after Stages 16 and 17 are finished. |
| Next module | S16.1 (`CLAUDE.md` Step 2 now selects essentials 5). Waiting for the owner to say start. |
| Blocked by | The guardrail amendments (F37) block S17 and the F41 clean-out, not the rest of S16. Legal review (F38) is confirmed by the owner's lawyer, so it no longer blocks S17 going live. |

## Start-of-task check results (CLAUDE.md steps 1 to 7), 2026-11-06

| Step | Result |
|---|---|
| 2 essentials file | `system_architecture_essential_5.md` exists; `CLAUDE.md` Step 2 (owner decision 2026-11-06, flag F36) selects it while Stage 16 to 19 are incomplete |
| 3 architecture version | highest `system_architecture_N.md` is 5 |
| 4 essentials vs architecture | essentials 5 cites `system_architecture_5.md`: match |
| 5 PRD version | highest `PRD_N.md` is 5 |
| 6 architecture vs PRD | architecture 5 says `Derived From: PRD_5.md`: match |
| Version alignment | PRD 5, architecture 5, essentials 5: same N, each cites its own N |

## Standing owner check-ins

| # | Check | Link | Status |
|---|---|---|---|
| C1 | Has Neon Auth shipped authenticator-app 2FA (MFA/TOTP)? | https://neon.com/docs/auth/roadmap | **Paused by the owner (2026-10-24).** Do not ask again until about 2026-11-24. |

## Module registry

| ID | Module | Status |
|---|---|---|
| S16.1 | Roles | in-progress (code and tests done, passing locally; complete when CI passes; the F41 clean-out is written and tested but NOT yet run on production) |
| S16.2 | Assignment | in-progress (code and tests done, passing locally; complete when CI passes) |
| S16.3 | Seven steps | in-progress (code and tests done, passing locally; complete when CI passes) |
| S17.1 | Private documents | in-progress (code and tests done, passing locally: 1952 tests; complete when CI passes; the production `student-docs` bucket is NOT yet created; see the 2026-11-07 Session 4 entry) |
| S17.2 | Step-2 form | in-progress (code and tests done, passing locally; complete when CI passes; see the Session 5 entry) |
| S17.3 | Letters, proof, ledger, purge | in-progress (code and tests done, passing locally; complete when CI passes; see the Session 5 entry) |
| S18.1 | Inbox and student screen | not started |
| S18.2 | Admin trim | not started |
| S18.3 | Student and public text | not started |
| S19.1 | QA and security | not started |
| S19.2 | Speed and CPU | not started |
| S19.3 | Deploy and carry-over | not started |

## Session log

### 2026-11-06: Session 1 (decisions and documents)

Built against: the owner's `Scollarly_Proposed_Flow.html` and an office-hours review. Decisions closed by the owner: roles Student, Manager, Admin (one plus a backup with the second factor); automatic assignment in turn with an away switch and Admin reassign; one university per application, close-and-reopen on refusal; the seven steps as the only statuses with a three-day university clock; the full student form at step 2, prefilled, passport only when the university asks; private documents (JPG, PNG or PDF, 5 MB); letters uploaded by the Admin; Momo details sent only on WhatsApp, never in the app; proof of payment approved by the Admin; arrival marked by the Manager, the university's payment logged by the Manager and approved by the Admin; quiet at 14 days, suggest closing at 45, only the Admin closes; files deleted three months after Arrived or Closed (records stay); in-app dot and daily summary when push is off; student alerts in the app plus the Manager's WhatsApp; the home steps in "we" wording and fees text saying fees go to the university. Files written: PRD_5, architecture 5, essentials 5, this tracker. No code changed, no module status changes.

### 2026-11-07: Session 2 (engineering review of the v5 files)

Built against: essentials 5 and architecture 5. `/plan-eng-review` checked PRD_5, architecture 5, essentials 5 and this tracker against the code (`schema.ts`, `actor.ts`, migration 0003, `media/store.ts`, `cron.ts`): 21 issues, 0 critical gaps; Codex outside voice unavailable (not installed). Amended: architecture section 24 now reuses `lead.assigned_admin_id` (renamed `assigned_manager_id`), `pipeline_stage` rows, `app_user` columns and notifications derived on read; the roles are renamed `manager` and `admin` (owner decision, up to two admins); manager scope is enforced by rewriting the `lead_read` and `lead_update` policies; alerts are a polling dot (every 120 s, no reload) with an Inbox badge and a daily summary, no push; the purge works per student; Admin undo and reopen; probe the upload route first (flags F42, F43); `phase0` only unlinked (F44). `CLAUDE.md` Step 2 now selects essentials 5. Owner decisions D1 to D8 are recorded in the plan file. No module status changes; nothing is committed (one commit after S16 and S17).

### 2026-11-07: Session 3 (Stage 16 built)

Built against: essentials 5 and architecture 5. Done in code, nothing committed (one commit after S17): migrations `0022_roles_v5` (roles renamed owner to admin and admin to manager in the database and in code, at most two admins by a trigger, `assigned_admin_id` renamed `assigned_manager_id`, `app_user` gets `whatsapp_number`, `away`, `last_assigned_at`, admin invites name a role, the lead policies and the policies of every table that hangs off a lead now scope a manager to assigned leads) and `0023_assignment_steps_v5` (manager given when onboarding finishes, copied to the lead at apply, `app_assign_manager`, `app_reassign_manager`, `app_set_staff_settings`, `app_my_manager_whatsapp`, `app_remove_manager`; the seven `pipeline_stage` rows with old stage codes mapped by position; lead `status`, `closed_*`, `arrived_at`, `university_submitted_at`, `last_student_activity_at`; one open lead per account). Code: `src/modules/pipeline/steps.ts` (the one rule table, three-day clock, quiet days), `changeStage` now compare-and-set with the steps rules, `moveBack`, `closeLead`, `reopenLead`, team endpoints `admin/team.reassign` and `admin/staff.settings`, an invite role, the signed-in WhatsApp number from the assigned manager, `scripts/lib/cleanout-v5.ts` and `scripts/ops/cleanout-v5.ts`. Tests: 1102 unit and 816 integration tests pass locally on the in-process engine (new: `pipeline-steps`, `s16-roles-assignment-steps`, `s16-cleanout`, manager scope in `rls-policies`, apply). Decisions made while building: API action ids keep their old names (`team.removeAdmin` removes a manager); the cap on admins is a database trigger, not an index or a function; the audit action for removing a manager is `team.removeManager`; the document rule ships off (`DOCUMENT_RULE_ENABLED`). Left for later: the apply form still asks for the programme choices of v4 (one university per application is S17.2); new leads still record `stage: share_results` inside the history row written by `app_create_lead` (cosmetic, fix when that function is next changed); the public pages and the staff screens still show the v4 wording and screens until S18.

### 2026-11-07: Session 4 (S17.1 built)

Built against: essentials 5 and architecture 5. Done in code, nothing committed: migration `0024_student_documents` (table `student_document`; row level security for the student, the assigned manager and the admin; a guard trigger on which state changes are allowed and who makes them; `app_can_see_student`; `app_documents_complete`), `src/server/media/documents.ts` (presigned PUT and GET, head, ranged read, delete; the private bucket `student-docs`), `src/modules/documents/` (content check by first bytes and size, schemas, endpoints `me/documents.sign`, `me/documents.confirm`, `me/documents`, `me/document-link`, `admin/documents.review`, `admin/student-documents`, `admin/document-link`), `src/server/repositories/documents.ts`, and the document rule of step 2 to step 3 switched ON in `steps.ts` and asked in `changeStage`. Tests: 1952 pass locally (new: `document-signature`, `document-store`, `s17-1-documents`; changed: `pipeline-steps`, `rls-policies` and the owner export list know the new table; `s16` moves a file past step 2 as an admin). Decisions made while building: a `pending` state (one more than architecture 24.2 lists) so an upload that never finishes is still found by the purge and by erasure; a new upload of the same kind replaces a pending or uploaded one and deletes its file; the passport is not yet part of the rule (the university's passport switch is S17.2). **Not verified:** the signed link's `response-content-disposition` and `response-cache-control` overrides and the content-type binding were checked only in unit tests, not against the real bucket (a credential for the probe branch was refused). `X-Content-Type-Options: nosniff` cannot be set on a storage download; the attachment disposition is what stops a browser from showing the file. **Before deploy (owner):** create the private `student-docs` bucket on the production branch and read the bucket quota. The probe branch `probe-s17-1-docs` and its test bucket were deleted on the owner's word (2026-11-07).

### 2026-11-07: Session 5 (S17.2 and S17.3 built)

Built against: essentials 5 and architecture 5. Done in code, nothing committed. **Migration `0025_form_ledger_purge`:** the step-2 columns on `student_profile` (all nullable), `university.passport_required`, `app_lead_passport_required`; `placement_payment.approved_by` and `approved_at` (existing rows backfilled as approved), the insert and update policies and the guard trigger rewritten so a manager's entry is pending and only the admin approves; `app_student_purgeable`, `app_purge_candidates`, `app_mark_documents_purged`; `app_record_job` accepts `purge`; erasure hooked by triggers (`lead_clear_documents`, `app_user_delete_documents`) and `app_erasure_document_keys`. **S17.2:** `src/modules/application-form/` (schema, pure rules, endpoints `me/application-form` and `me/applicationForm.save`), `src/server/repositories/application-form.ts`, the passport switch as a field of the universities editor, and the passport joined to the document rule of step 2 to step 3. **S17.3:** letters (`admin/documents.sign` and `admin/documents.confirm`, PDF only), proof of payment (`admin/payments.proofApprove`, admin only; a manager gets 403), the ledger (`admin/payments.record` makes a manager's entry pending, `admin/payments.approve`, pending entries listed but in no total, Insights figure, home figure or notification; the Payments screen shows "Pending approval" and an Approve button to the admin), the daily purge (`src/server/media/purge.ts`, a separate step in `cron.ts` with its own record, at most 40 objects a run, one call to mark the batch), erasure (both the lead and the account path delete the student's objects after the erasure succeeds). **UI:** `/me/file` ("My file": the prefilled form, documents with retry of the one failed upload, proof of payment from step 4, letters), reached from the More sheet; English and French. Tests: 2013 pass locally (new: `s17-form-and-purge`, `upload-document`, `s17-2-3-form-letters-ledger-purge`; changed: the payment tests and fixtures know approval, `security-headers`, `s13-foundations`); an e2e spec `s17-my-file.spec.ts` is written (see below for whether it was run).

**Decisions made while building (owner to see):**
1. **CSP.** `connect-src` allowed only the site itself, so the phone could not send a file to storage. `src/lib/security-headers.ts` now also allows `https://*.storage.c-7.eu-central-1.aws.neon.tech` (`DOCUMENT_UPLOAD_ORIGIN`), the cluster the probe used. It covers every Neon storage branch on that cluster, not only ours; narrow it to the production branch's exact host once known (one line). This applies to every page, public ones too.
2. **A gap in S16 found and closed.** `app_erase_lead` runs with the owner's rights, so any manager could erase any lead. Migration 0025 adds a trigger so a manager erases only their own students' leads (`lead_erase_scope`), and `eraseLead` answers "not found" for a lead a manager cannot see. This is a security fix to S16, not part of S17.
3. **Erasure order.** The student's object keys are read first and the objects are deleted only after the erasure has succeeded, so an erasure that is refused (identity not confirmed, sign-in too old) never costs a student their files. If storage cannot delete, the erasure still stands and the answer says how many files were not deleted (`filesNotDeleted`); there is no retry list, so those need a manual follow-up.
4. **Purge limit.** 40 objects a run, as written. One run costs about 43 outbound requests (1 for the list, up to 40 deletes, 1 to mark, 1 for the record), and it comes after the rollup in the same invocation, so it may reach the free plan's limit of about 50; a run that hits it leaves the rest for tomorrow without harm. S19.2 measures it. An upload that never finished is purged after one day.
5. **Ledger rule.** An admin's own entry is approved as it is made; only a manager's waits. The operation names differ from architecture 24.6 (`admin/payments.record` and `admin/payments.approve` instead of `admin/payments/ledger`), as every action id in this app is a dotted name.
6. **My file** is in the More sheet, not a fourth or fifth tab (a new tab would also change the tour keys, which a database function checks). Moving it to a tab is S18.3 (student screens).
7. **Not done in S17:** the staff side of documents (approve or reject a file on a student screen, upload a letter, the Inbox sections and the alerts) is S18.1; there are endpoints for all of it and `uploadDocument` takes the admin's paths, but no staff screen yet. Nothing sets `lead.last_student_activity_at` yet (quiet files, S18.2). The apply form still asks for programme choices (the one-university rule of the PRD is not enforced there). Sign-out has no queued upload to clear, because uploads are online-only with a retry of the one file.
8. **Not verified against the real bucket:** see Session 4 (the signed link's response overrides). The first deploy's smoke check must open one letter and one document link.

## Flags (need the owner)

| # | Flag | Status |
|---|---|---|
| F36 | Sign off PRD_5, architecture 5 and essentials 5: **signed off by the owner 2026-11-07.** `CLAUDE.md` Step 2 now selects essentials 5 while Stages 16 to 19 are incomplete (changed 2026-11-07 at the owner's request, as done for F35). | done |
| F37 | Amend `CLAUDE.md` guardrails: (a) student documents live only in the private bucket and only `server/media` touches it; (b) files, not records, are deleted three months after Arrived or Closed (an exception to "No physical deletes in v1"); (c) the one-time clean-out of F41. | open |
| F38 | Legal review of storing passport and ID data and of the Momo-helper wording. The owner says the lawyer has confirmed and responded, so work may go ahead (2026-11-08, recorded on the owner's word; the reply itself is not in the repository). | done (owner confirmed) |
| F39 | The English and French words for the seven steps and the fees text: **the owner told Claude Code to write them (2026-11-07).** Claude Code drafts them in S18.3 and shows them in that pull request. | delegated |
| F40 | Name the Managers and the backup Admin (they will create their own accounts after the update); decide the Momo helper process (outside the app). | open |
| F41 | One-time clean-out (owner decision 2026-11-07): at the start of S16.1, after a Neon snapshot, delete all accounts except the owner's (8 on 2026-11-07: 1 admin, 7 students), their leads, profiles, notes and activity, and the 2 placement payment records. The owner is to become the Admin. Not done yet. | decided, not done |
| F42 | After the S17.1 probe: record the chosen upload route (direct signed upload or Worker streaming), the CORS result and the bucket quota. **Probe run 2026-11-07 on Neon branch `probe-s17-1-docs`: direct signed upload chosen.** A presigned PUT from a browser origin works; the preflight answers `Access-Control-Allow-Origin: *` for PUT and the `content-type` header; an anonymous GET is 403; a presigned GET returns the bytes and is 403 after it expires; delete works. **Quota: not found** in the Neon documentation; the owner reads the Object storage row in the Neon console. | route and CORS done; quota open (owner) |
| F43 | Decide photo shrinking on the phone after the F42 quota is known. | open (waits for the quota) |
| F44 | Delete the `phase0` pages only after S19.2 confirms `scripts/measure-cpu.mjs` does not need them (they are unlinked in S18.2). | open (S19.2) |
| F45 | Not needed: the role is read from the database on every request, not from the session, so the owner stays signed in after the rename (checked 2026-11-07 in `app_resolve_session`). | closed |

## CPU rows to record (architecture 24.8, measured by `scripts/measure-cpu.mjs`)

Not measured yet: `me/documents.sign`, `me/documents.confirm`, `admin/document-link`, `admin/documents/:id/link`, `admin/inbox`, `admin/student/:id`, `admin/reassign`, `me/application`, `app_assign_manager`.

## Owner actions (human, never marked done by Claude Code)

Carried from tracker_4 (see its Owner actions table): R4, R5, R6, H11, H19 / E5, the watched test, H20, and the domain. Add F36 to F40 above. None is marked done here.


### Clean-out F41 run (2026-11-07)
Snapshot `pre-v5-cleanout-2026-11-07` (snap-frosty-heart-b9qg9npn) taken; rehearsed on a Neon branch (since deleted); run on production on the owner's "delete". Result: 8 accounts, 6 profiles, 9 leads and their children, and 2 payment records removed (`--include-payments`; they were not linked to a lead). Kept: the owner account (gimafolabit@gmail.com, still role `owner` until migration 0022 is deployed) and 2 old data-request rows of an already erased account. Migrations 0022/0023 are NOT yet deployed.
