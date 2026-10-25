# Runbook: Stage 5 (admin lead management)

Built against `essentials/system_architecture_essential_1.md`, `system_architecture/system_architecture_1.md`, `prd/PRD_1.md` (all version 1). Started on the owner's word ("yes start stage 5", 2026-10-25) while the Stage 4 lead-endpoint CPU gate was still being re-measured. This file says what each page does, what you must do to put it live, and how to try each page.

## 1. What each page does

All pages are for an admin, or the owner after the 2FA check. Anyone else gets a 404 for the page and a 403 for its data.

| Page | Address | What you do there |
|---|---|---|
| Overview (B1) | `/admin` | Seven counts (new and unanswered, overdue, assigned to me, unassigned, link requests, data requests, today's leads in WAT) and a funnel by stage. Every tile and bar opens the matching list. |
| Leads (B2) | `/admin/leads` | The list, newest first. Filter by stage, country, university and assigned admin, or search by name, WhatsApp number or reference. The filters are in the address, so a list can be bookmarked. Tabs: All, Overdue (oldest due first), Unassigned, Duplicates, Link requests. |
| Lead detail (B3) | `/admin/leads/<id>` | The whole lead. **Log reply** (one tap: the first one stops the SLA clock and the badge turns to Met). **Message on WhatsApp**: a drawer with the message for the lead's stage, which you can edit, then **Open WhatsApp**; when you come back it asks "Did you send it?". Change stage (asks first), Assign, notes, the timeline, a banner for a possible duplicate, and **Erase personal data**. |
| Link requests (B4) | `/admin/leads/link-requests` | A student asked to link their account to an application. **Approve** needs how you checked: "Email matches the lead" (the system checks it too) or "Student replied on WhatsApp from the number on file". **Reject** needs a reason. |
| Data requests (B5) | `/admin/data-requests` | Export and erasure requests. **Log request** for someone who asked on WhatsApp (by the lead's reference). **Run erasure** (identity box first) or **Mark done** for an export. |

Rules the screens follow:
- A change carries the version of the lead you were looking at. If someone changed it first you see "This lead changed. Reload." and nothing is overwritten.
- Notes and logged replies do not make someone else's change fail; stage and assignment changes do.
- "Overdue" reads the stored due time and never recalculates it.
- Nothing is merged automatically. Two leads with the same WhatsApp number are only offered to you.
- Erasing is all or nothing, in one database transaction. It removes the name, number, email and results (of the lead and of any lead merged into it), overwrites the note text, clears the reference on events and the lead link on payment rows, and keeps the timeline, payments and counts.
- Every change is in the Audit log (owner), and none of those entries holds personal data.

## 2. What you must do, in this order

1. **Merge the pull request** on GitHub.
2. **Run the deploy workflow** (Actions, "Stage 0 deploy and measure", Run workflow, on `main`). It applies **migration 0006** (a new column `lead.updated_at`, a new column `lead_claim.reject_reason`, a trigger and four database functions; nothing existing is changed or removed), deploys, and runs the new Stage 5 checks and CPU rows.
3. **Try it** (section 3).
4. **Message templates (optional, Stage 6).** The WhatsApp drawer has built-in text for each of the six stages. When the content screens arrive (Stage 6) you can write your own per stage and language; until then the built-in text is used.

## 3. How to try each page after the deploy

Sign in as the owner or an admin at `https://scollarly.gimafolabit.workers.dev/sign-in`, then:

1. `/admin` shows the counts. Make one test lead first (open `/universities`, tap a WhatsApp button, fill the quick form), then reload: "New and unanswered" and "Today's leads" go up by one.
2. `/admin/leads`: your test lead is at the top. Try the search with part of your own name, and the Overdue tab.
3. Open the lead. Tap **Log reply**: the badge turns to Met. Add a note. Change the stage and confirm. Assign it to yourself. Tap **Message on WhatsApp**, change the text, **Open WhatsApp**, come back and tap **Log reply** on the question.
4. Make a second lead with the same WhatsApp number, then open `/admin/leads?view=duplicates`, **Compare**, choose **Not a duplicate** (or merge the test pair).
5. `/admin/data-requests`: **Log request**, choose Erasure, enter the test lead's reference, then **Run erasure**, tick the box, **Erase**. The lead page then says the data was erased.
6. `/admin/leads/link-requests` stays empty until the student portal (Stage 8) lets students ask.

## 4. CPU rows to record after the deploy (at most 8 ms warm p95 each)

The deploy workflow now measures: Overview counts, the leads list, the lead detail, and one write (logging a WhatsApp open). Its probes also check that anonymous visitors get 401 and students get 403 on every lead screen and operation, that a bad filter is a 400, and that erasure without the identity box is refused. The numbers go into the tracker after the run.
