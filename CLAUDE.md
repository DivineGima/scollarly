# CLAUDE.md: Coding-agent guardrail for Scollarly v2

This file is edited in place. It is not versioned. Read it fully at the start of every coding task.

## Absolute rules

- Never push to `main`. Work on a feature branch and open a merge request on GitHub for every change.
- Never start work on a phase whose essentials file does not exist. Stop and flag it. Do not improvise scope.
- Never silently deviate from a decision logged in the current `system_architecture_N.md` or the current `PRD_N.md`. If there is a conflict, stop and flag it.
- Never code in deviation from the system design rules in `SYSTEM DESIGN RULES.html` and the other source files. This is absolute.
- A halt-and-flag at any step below stops the whole sequence. Do not continue to later steps or begin coding.
- Human actions (legal review, DNS, OAuth credentials, vendor terms, owner sign-off) are never marked done by you. Record them only when the owner says so.

## Start-of-task sequence (follow in this exact order)

### Step 1: Read `/tracker/`

Find the current phase and status. The tracker holds dated session summaries made by Claude Code. Every entry must carry:
- a date
- which essentials file and which architecture version it was built against
- a status per module ID: `in-progress` or `complete`

Format is otherwise your choice. If `/tracker/` does not exist or has no entries, that is not an error. It means no stage has started, so begin at `system_architecture_essential_1.md`.

If the tracker has a section named **Standing owner check-ins**, ask the owner each open check-in at the start of the session and show its link (amended 2026-10-24, owner decision D15). Do not skip it, and stop asking only when the owner says the item is done or no longer wanted.

### Step 2: Choose the essentials file

Look in `/essentials/` for files matching `^system_architecture_essential_\d+\.md$`. Take the lowest-numbered file that still has an incomplete stage according to the tracker (essential_1 if nothing has started). If the file does not exist, halt and flag.

### Step 3: Resolve the current architecture version

Within `/system_architecture/` only, match files against `^system_architecture_\d+\.md$` (the character right after the underscore must be a digit). Extract the trailing integer from each and take the highest as current. This pattern deliberately excludes `system_architecture_essential_N.md`, which lives in `/essentials/` and must never count as an architecture version. If names do not parse cleanly (non-numeric suffix, gaps, duplicates), halt and flag. Read the current architecture file. Consult older versions only to resolve a conflict.

### Step 4: Essentials-vs-architecture drift check

Read the `Source Architecture Version:` line of the essentials file from Step 2 and compare it with the current version from Step 3.
- If they match, continue.
- If they differ, read the changelog field **Downstream Impact on Essentials** of every intervening architecture version.
  - If every field starts with the literal token `NO_IMPACT`, log it in the tracker and continue.
  - If any field starts with `IMPACT`, or the field is missing, halt and flag. Do not assume the essentials scope is still valid.

### Step 5: Resolve the current PRD version

Within `/prd/`, match `^PRD_\d+\.md$`, take the highest trailing integer. Halt and flag on any ambiguity.

### Step 6: Architecture-vs-PRD drift check

Read the `Derived From: PRD_M.md` line near the top of the current architecture and compare M with the current PRD version from Step 5.
- If they match, continue.
- If they differ, read the changelog field **Downstream Impact** of every intervening PRD version.
  - If every field starts with `NO_IMPACT`, log it and continue.
  - If any field starts with `IMPACT`, or is missing, halt and flag. The requirements may have changed. This is a decision for the owner.

### Step 7: Read the current PRD

Read `/prd/PRD_N.md` (the current version) and cross-reference it for any requirements question.

There is no direct essentials-to-PRD check. The chain (essentials, then architecture, then PRD) already covers it.

### Version-alignment halts

Halt and flag if:
- The highest numbers in `/prd/`, `/system_architecture/` and `/essentials/` do not share the same N.
- An essentials file's `Source Architecture Version:` or `Source PRD:` line does not carry its own N (for example `essential_2` citing `system_architecture_1.md`).

## Source files

Read `SYSTEM DESIGN RULES.html` and the other source files at the start of every coding task. The location is the repository root unless the owner says otherwise. If a source file is not present, halt and flag. Do not guess its content. Where source files contain links to fuller resources, use those links to get accurate, current information.

## The 12 non-negotiable fullstack rules (enforce on every task)

1. Understand the problem deeply before designing or coding.
2. Define functional and non-functional requirements clearly.
3. Estimate scale and traffic with back-of-the-envelope math.
4. Design the data model before APIs.
5. Define the API / interface layer explicitly.
6. Design high-level architecture only after the above steps.
7. Deep dive into critical components (schema, caching, queues, storage).
8. Address cross-cutting concerns: observability, security, CI/CD, error handling, idempotency.
9. Enforce branching discipline: never push directly to `main`; always work on a feature branch and open a merge request on GitHub for every change.
10. Apply the Extensibility & Change-Tolerance rules (data model, API, auth, database, feature/module removal) on every change, with the same strict standard on every project, regardless of scale.
11. Review, challenge, and simplify the design.
12. Document and communicate the architecture (ADRs, diagrams, rationale).

## Project guardrails (from the current architecture, section 15; re-read the file for the full text)

- Only `server/repositories` imports Drizzle. Only `server/auth` imports the Neon Auth SDK and otpauth. Only `server/media` uses the Neon Object Storage client and credential. Nothing imports Resend (removed, D15).
- Never put access control in middleware. Authorisation is enforced through the auth facade and the `Actor` type, backed by Neon row level security as a second lock: the app connects as a non-owner runtime role, every table has `FORCE ROW LEVEL SECURITY` and a policy, and CI fails on a table without one. Neither lock replaces the other. (Amended 2026-10-24, owner decision D15.)
- Signed-in screens are a prerendered shell with no data and no session logic, plus plain data functions in the Worker entry (`src/server/edge/authed.ts`). No Server Actions and no server-rendered signed-in pages: Next.js costs more CPU than Workers Free allows (D18, ADR-040). Never put personal data in a shell or in any cache. Each such module adds a CPU row (shell and data call, at most 8 ms each).
- No admin library (shadcn/ui, Recharts) in any public route.
- No third-party scripts, no hotlinked images, no Next.js image optimiser.
- Every WhatsApp URL comes from the one helper, using the number in `site_setting`. No hardcoded numbers.
- No physical deletes in v1. Archive instead.
- No personal data in logs or analytics events. Never store raw IP addresses.
- Store all times in UTC. Display and group in WAT (`Africa/Douala`).
- Every migration is additive-first.
- Never add a paid service or change hosting. If Stage 0 fails a gate, stop and report to the owner. If any service asks for a payment method (R2 did, so it was dropped), stop and ask the owner.
- Do not publish unconfirmed statistics, testimonials or team bios.

## Working rules

- Work one stage at a time, in order, per the essentials file.
- Write tests with each module. A module is complete only when its tests pass in CI.
- After each stage update the tracker (date, essentials file, architecture version, status per module ID).
- If you are unsure, ask the owner. Never assume.