# PRD 2: Scollarly v2 (major refactor of the live app)

**Status:** Version 2, drafted 2026-10-31 from the owner's approved design document (`docs/designs/scollarly-v2-refactor.md`, office-hours session of 2026-10-31). It is a complete, current text: it keeps everything in `PRD_1.md` that still holds (F1 to F11, amended through 2026-10-24) and adds F12 to F19. `PRD_1.md` is kept only as history and for resolving conflicts. For this refactor the owner chose new versions instead of editing in place, which reverses decision D13 for this refactor only (design document decision D16). Items still needed before launch are in section 12.2.
**Date:** 2026-10-31
**Basis:** `PRD_1.md` (final v1.0 plus amendments), the live app as built through Stage 12, the owner's answers and reference images in the 2026-10-31 office-hours session (the images are samples for layout only, not exact designs).

## Changelog (PRD_2 against PRD_1)

- **Added:** F12 hub navigation (pill tab bar and a More sheet for student, admin and owner), F13 landing page (a redesign of `/`), F14 separate Sign in and Create account, F15 onboarding for students and for parents that creates a lead, F16 personalised student experience, F17 notifications, F18 CRM dashboards, F19 brand assets (logo, app icon, splash).
- **Changed:** the admin and owner area is reorganised from about 22 routes into 4 hub screens plus a More sheet (F12). The student area gains a tab bar and an onboarding path (F12, F15, F16). Success metrics gain a simplification measure (section 2).
- **Unchanged:** the three roles (student, admin, owner; a parent is a student account), Google-only sign-in, the free-plan CPU design, offline rules, WAT, zero recurring cost, the brand (light only, blue, black, white), and every rule in `CLAUDE.md`.
- **Dropped:** none of F1 to F11. The Stage 0 probe screens (`/admin/phase0`, `/me/phase0`) stay as unlinked developer pages.
- **Downstream Impact:** IMPACT. `system_architecture_2.md` must add the hub routes, the new data (`student_profile`, the per-user `account_confirmed_at`, `notifications_seen_at` and tours-seen list, filling the existing programme `field` (the course category) and `level` columns), the derived notifications design and the new decisions (ADR-041 onwards), and `system_architecture_essential_2.md` must be a single stage that builds F12 to F19 plus the carried-over Stage 10 and 11 items.

## How to read this document

Every decision is tagged so nothing is silently invented:

- **[Owner]** you stated or chose it.
- **[Carried]** it already exists in design.md or the current site and is kept.
- **[Mine]** you asked me to decide, or it was needed to make the spec coherent. Please confirm or overrule.
- **[Open]** it is unresolved and I have not guessed. See section 12.
- **[Owner, amended 2026-10-23]** the owner changed or settled this after the first draft, in the system design session. These items replace the earlier text.
- **[Owner, refactor 2026-10-31]** the owner decided this in the office-hours session for PRD_2.
- **[Mine, refactor]** needed to make the refactor coherent; the owner confirms or overrules it (also listed in section 12.2).

---

## 1. Problem

Scollarly connects African students with Indian universities. Students pay nothing; universities pay Scollarly after enrolment. [Carried]

1. **The site is built for good connections, but the users don't have them.** Target users are mostly Android users on limited, expensive data [Carried]. The current homepage is one 840-line client component with a forced ~3s intro splash, parallax, floating particles and 30+ animations. It has 15 raw `<img>` tags, PNG images, and 9 university logos hotlinked from Wikimedia and other sites that fail on slow or no data. The contact form needs a live connection and loses the message if it fails.
2. **There is nowhere to manage students.** The only stored data is `ContactSubmission`. The team can't see where a student is in the process, who is handling them, or who has gone unanswered. The `User` and `Post` tables exist but are unused.
3. **Content changes need a code deploy.** Fees, universities, testimonials, stats and the journey timeline live in TypeScript files (design.md ADR-003). The sole developer is the only person who can update them.
4. **The student-to-admin handoff is lossy.** The WhatsApp buttons open a blank chat or a generic message, so admins re-ask the basics (country, results, course) every time.
5. **There is no visibility for the owner.** No funnel, no per-admin performance, no placement revenue.
6. **Trust content is inconsistent.** The site claims "100+ students helped", "9 students admitted", "hundreds of students" and "60+ students" in different places. The phone number shown (+91 98157 25968) differs from the WhatsApp number used by every button (+237 651 232 301). Team bios carry a code comment "REPLACE with real team data before launch". The site publishes info@scollarly.com, but you do not own the scollarly.com domain. 6 of 9 universities have unconfirmed fees and 4 have no campus tour.

## 2. Goals, success metrics, non-goals

### Goals
- G1. The public site works usably on slow, expensive or intermittent data, and installs as an app. [Owner]
- G2. Every WhatsApp handoff carries the student's context so admins don't re-ask basics. [Mine, from "easy interaction between students and admins"]
- G3. Content is managed in a database through an admin screen, not in code. [Owner]
- G4. Students, admins and the owner have separate accounts and permissions. Only the owner can create admins. [Owner]
- G5. Admins and the owner get a detailed analytics dashboard. [Owner]
- G6. Zero recurring cost for v1: no paid APIs. Free tiers are allowed. [Owner]
- G7. **Every feature in this document (F1 to F19) is built and shipped in version 2, in one stage.** [Owner, amended 2026-10-23; extended for the refactor 2026-10-31]
- G8. An admin or the owner finds each of their four daily jobs (work leads, update content, check results, manage team and system) in one tap from the Home tab, and understands each page without being told. [Owner, refactor 2026-10-31]
- G9. A new student or parent signs up knowing it is a sign-up, answers a short questionnaire, and lands in an app that already shows their name and the universities that fit their chosen course. [Owner, refactor 2026-10-31]

### Success metrics [Mine: you delegated this; flagged for confirmation]

**Primary metric: lead readiness at first contact.** The share of WhatsApp handoffs that carry a stored lead reference with a complete minimum profile (for a full lead: name, WhatsApp number, country, qualification, at least one preferred programme; for a quick lead: name, WhatsApp number, country, and the university or programme the visitor was on) [Mine, amended 2026-10-23]. Chosen because it is measurable with no API and no cost, and it directly measures "admins don't re-ask basics".

**Supporting metrics:**

| Metric | How it is measured with no API |
|---|---|
| WhatsApp tap rate (sessions with a tap / sessions) | First-party event logged on tap |
| First-response time | Time from the lead's SLA start (server received time, see FR-12) to the admin's first logged reply in the dashboard (proxy; admins log a reply with one tap). Limitation: not measured from WhatsApp itself. |
| Unanswered leads | Leads with no logged reply past their SLA target, as defined in FR-12 |
| Pipeline freshness | Share of active leads whose stage was updated in the last N days (N to be set by owner) |
| Onboarding completion (F15) | Onboardings finished / onboardings started, from first-party counts. Each finished onboarding yields exactly one lead. |
| Simplification (F12), refactor | In the watched test at the end of the stage (essentials_2 S13.9), the share of the 4 admin jobs a new admin completes without help or a wrong turn. Target not set until the first watched test. [Mine, refactor] |
| First-load weight and speed | Measured on a throttled mobile profile; budget in section 8 |

**Targets:** not set. No baseline data was available. Set targets after 4 weeks of measurement. [Open]

### Non-goals for v1
- WhatsApp Business API or any automated messaging. [Owner chose smart links]
- Payments of any kind **taken from students or through the site**. Recording amounts that universities have paid to Scollarly (F10) is not a payment feature; it is bookkeeping.
- Native mobile apps.
- A live Instagram feed. [Carried]
- Launching French content (architecture only, see F11). [Carried]
- Student document upload (offer letters, passports, results files). Not in v1. [Mine]

## 3. Target users

| User | Who | Context | Needs |
|---|---|---|---|
| **Student** | African students aged 17-28 seeking undergraduate or postgraduate admission in India. Countries: Cameroon, Nigeria, Ghana, Ivory Coast, Senegal, Guinea, South Africa. [Carried] | Mostly Android, limited and expensive data, WhatsApp is the main channel, English first and French later. | Trust that this is not a scam, fee clarity, a light site, a clear next step, and to see where they stand. |
| **Parent** (a kind of student account, not a role) | A parent or guardian applying for a child. [Owner, refactor 2026-10-31] | Same device and data conditions as students. | The same screens as a student. The questionnaire collects the child's details and the parent's contact. The account has the student role and records `relationship = parent`. |
| **Admin** | Scollarly team members invited by the owner. **"Admin" covers all Scollarly staff other than the owner. There are exactly three roles in v1: student, admin, owner. No other role exists.** [Owner, amended 2026-10-23] | Handle students daily, mostly on WhatsApp. | See all leads, update stages, message students in one tap, see their own workload, record payments received. |
| **Owner** | The business owner. | Needs the whole picture. | Create and remove admins, see the funnel, admin performance and payments received. |

**Expected volume:** about 1 to 100 leads per month, an approximate owner estimate. Sessions per month are unknown. Users are the students, admins and the owner only. [Owner, amended 2026-10-23]

## 4. Constraints [Owner unless noted]

- No paid APIs or tools in v1. Free tiers are acceptable but their limits and terms must be verified before committing. [Mine]
- Auth: **Google sign-in only** through **Neon Auth**, Neon's managed service built on Better Auth, which keeps its users and sessions in our own Neon database. There are no passwords, so there is no password reset and no verification email. Roles, the owner's second factor and invites live in our own tables. [Owner, amended 2026-10-24 (D15)]
- WhatsApp: smart links only. [Owner chose smart links]
- Brand-new codebase. [Owner] The "additive only" rules in claude.md and the "no admin / no auth / no new tables" decisions in design.md apply to the old site only and are superseded. The new repo needs its own CLAUDE.md.
- The old Vercel projects (`scollarly`, `scollarly-story`) are being deleted, so there is no live site until v2 ships. [Owner]
- Tech stack as listed below. [Owner]
- Hosting: Cloudflare Workers only. Vercel is removed from the plan. [Owner]
- **The Workers Free CPU limit (about 10 ms per request) shapes the design.** [Owner, amended 2026-10-23 (D14)] Stage 0 measured that Next.js, self-hosted Better Auth and password hashing exceed it. The design therefore (a) answers public pages and images from the edge cache before Next.js starts, (b) has no password sign-in and runs sign-in and sessions at Neon instead of inside the Worker (D15), and (c) keeps handlers and session checks thin. A paid plan is not assumed; if the redesign cannot meet the gates, the decision returns to the owner.
- Domain: scollarly.co.in is the only domain. scollarly.com is not used anywhere. [Owner] Until the .IN verification at the registrar is complete, the build and its measurements use the free `workers.dev` address (owner decision D12, 2026-10-23). The domain is needed before launch, not for the build.
- **Timezone: WAT (West Africa Time, `Africa/Douala`, UTC+1, no daylight saving) is the single timezone for the dashboard, the SLA and all reports. It is held in one configured value.** [Owner, amended 2026-10-23]
- **Content images are stored in a Neon Object Storage bucket** (Neon's S3-compatible storage, in the same project as the database). [Owner, amended 2026-10-24 (D16)] R2 was the first choice but its checkout asked for a payment method, so it is not used. Neon Object Storage needs no card and gives 5 GB per project on the free plan. Its request and transfer limits are not stated on the pages read and are confirmed in Phase 0.

### Tech stack [Owner]

| Layer | Tool | Function |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Public site, student area and admin dashboard in one app |
| UI | Tailwind + shadcn/ui | Light UI, shadcn in the dashboard only |
| Translations | next-intl | English now, French ready |
| PWA / offline | Serwist + idb | Offline pages and a queue for leads and WhatsApp taps |
| Charts | Recharts | Analytics dashboard only |
| Backend / API | Route Handlers and plain edge functions (signed-in data and changes), Zod | Lead sync, role checks, validation |
| Database | Neon Postgres | Leads, stages, content, events, placements |
| Image storage | Neon Object Storage (bucket, public-read) | Content images, served from the edge cache (D16) |
| ORM | Drizzle | Typed queries and migrations |
| Authentication | Neon Auth (managed Better Auth in our Neon database) | Google sign-in only and sessions (D15) |
| Owner 2FA | otpauth library plus our own lockout and recovery codes | Authenticator-app code for the owner only (D15) |
| Access control | Auth facade and Actor in our code, plus Neon row level security | Two locks: the code check and database policies (D15) |
| Email | None in v1 | Resend is removed (D15). Admin invites are copyable links shared by hand |
| Bot protection | Cloudflare Turnstile | Protects the lead forms (there is no password sign-up to protect) |
| Testing | Vitest, Playwright, Lighthouse CI, axe | Unit, end-to-end and offline tests, page budget, accessibility |
| CI | GitHub Actions | Tests on every push |
| Hosting | Cloudflare Workers (OpenNext) only | Free hosting that allows commercial use is the goal, to be confirmed |

**What the stack means for the requirements** (I have not verified the vendor limits below; they need checking before build):

- **Hosting.** Cloudflare Workers only. [Owner] There is no fallback host. If the Phase 0 test (section 13) shows the app does not fit the free Workers limits, the decision comes back to you before anything is spent.
- **Next.js on Cloudflare Workers via OpenNext.** Needs a check that the chosen Next.js version, the Workers free-plan size and CPU limits, and Serwist all work together. This is tested first, in Phase 0.
- **Neon free tier.** Check storage, compute hours and idle suspend. A database that has gone idle makes the first request slow, which hurts users on weak connections.
- **Content images in Neon Object Storage.** [Owner, amended 2026-10-24 (D16)] Images are size-capped and monitored (FR-18). Delivery is answered from the edge cache in the Worker entry, before Next.js starts, so image requests wake neither Next.js nor the database. Reads use a public-read bucket (no signing); uploads are signed with a Neon credential kept as a Worker secret. The free plan allows 5 GB per project.
- **Dashboard-only libraries.** shadcn/ui and Recharts must not enter the public bundle. They load only on admin routes. Lighthouse CI enforces the page budget (FR/NFR in section 8) on every push.
- **2FA.** Required for the owner only. [Owner] Admins and students are not required to use it. Authenticator-app codes plus recovery codes; SMS codes would add cost and are not assumed. [Mine]
- **Email domain.** scollarly.co.in is the only domain. [Owner] **No email is sent in v1** (Resend removed, D15). If email is added later, the sending domain and a mailbox become launch requirements again. The old `info@scollarly.com` address is replaced by an address on scollarly.co.in, and a mailbox must exist to receive mail there (section 12.2).
- **Drizzle replaces Prisma.** The old Prisma schema and migration are not reused. Existing `ContactSubmission` rows, if any, are migrated by a one-off script.
- **Turnstile and offline leads.** See the edge case in section 10.
- **Analytics.** No third-party analytics tool is listed, which matches assumption A9 (first-party events, GA4 removed).

## 5. Reuse, remove, rebuild

### Reuse (content and decisions)
| Item | Notes |
|---|---|
| Copy: services, 6-step process, 5-step visa process, 12 FAQs, "Why Scollarly", mission/values | Move into the content DB. Fix typos first (e.g. "universites", "thier" in the hero). |
| 9 universities, programmes, NAAC grades, fee data for CU, Jain, Kalinga, campus tour assets | Seed into the DB. Keep `dataConfirmed` and `lastUpdated`/`urlLastChecked` semantics. |
| Rules from design.md | Never show 0 or placeholder fees; fee ranges plus disclaimer; thumbnail-first video, no autoplay, `youtube-nocookie`, 11-char ID validation; verified-testimonial consent and blurred documents; 4h/24h WhatsApp SLA; no fake content. |
| `offer-letter-sample.webp` | Already blurred. Keep. |
| `ContactSubmission` records, if any exist | Migrate into the new leads table. |
| next-intl approach, `messages/en.json` and `fr.json` key structure | Keep the pattern; apply to all UI text this time. |
| Resend for confirmation emails | Removed 2026-10-24 (D15): no flow sends email in v1. |
| Brand: blue/black/white, logos | Re-host the logos in the content image store (FR-18); don't hotlink. |

### Remove
- Forced intro splash, parallax, floating particles, morphing blobs, 3D tilt, and the 30+ keyframe animation set. Keep at most subtle transitions that respect `prefers-reduced-motion`.
- Hotlinked images (Cloudinary, Wikimedia, university sites). Re-host as WebP in the content image store (FR-18). [Owner, amended 2026-10-23]
- Unused dependencies visible in package.json (e.g. recharts is the only one likely needed, for the dashboard; others such as `@mdxeditor/editor`, `@dnd-kit/*`, `react-syntax-highlighter`, `z-ai-web-dev-sdk`, `next-auth` need a usage check before being dropped). [Mine]
- `mini-services/` Flask app, `db/custom.db` (SQLite leftover), `examples/websocket`, the `upload/` PDFs (old Lelanga brand), `Caddyfile`, `.zscripts`, and the legacy `public/scollarly/` copies. [Mine: confirm the ProductTour guided-spotlight component too]
- In-memory rate limiting in the contact route. It does not work on serverless.
- The whole-page `"use client"` pattern. Public pages should be server-rendered with small client islands.

### Rebuild
- Homepage and university pages (lighter, DB-driven).
- Contact form becomes the lead intake (F3).
- Trust components (ticker, testimonials, journey, offer-letter proof) become DB-driven with consent and verification flags.

## 6. Core features

F1 to F11 are built and live (Stages 0 to 12 of `PRD_1`). F12 to F19 are the refactor and are all built in the one stage of `system_architecture_essential_2.md`. The "Build stage" column for F12 to F19 names the module order inside that stage, not a release split. [Owner, amended 2026-10-23; refactor 2026-10-31]

| # | Feature | Build stage (all in v1) |
|---|---|---|
| F1 | Lite public site (home, universities, fees, campus tours, process, visa, FAQ, blog, trust) | 1 |
| F2 | Installable PWA with offline reading and offline queue | 1 |
| F3 | Lead intake with a stored lead reference | 1 |
| F4 | Smart WhatsApp links (student to admin, admin to student) | 1 |
| F5 | Auth and roles (student, admin, owner) | 1 |
| F6 | Content management (admin screen over DB content, including images) | 1 |
| F7 | Admin lead management (list, stage, notes, assignment, log reply) | 1 |
| F8 | Student portal (profile, stage tracking) | 2 |
| F9 | Analytics dashboard (funnel, source and country, admin performance, payments received) | Funnel and source in 1; admin performance and payments in 2 |
| F10 | Placement payments received (ledger) | 2 |
| F11 | i18n architecture (en live, fr scaffolded) | 1 (structure) |
| F12 | Hub navigation: pill tab bar and More sheet for student, admin and owner; four hub screens per staff role; page help | S13.1 (shared parts), S13.4 and S13.6 |
| F13 | Landing page (redesign of `/`) with a course finder | S13.7 |
| F14 | Separate Sign in and Create account | S13.2 |
| F15 | Onboarding for students and for parents, creating a lead | S13.3 |
| F16 | Personalised student experience (name, pre-selected answers, ordered universities) | S13.4 |
| F17 | Notifications (a page and an unread dot, derived from existing data) | S13.5 |
| F18 | CRM dashboards (Home and Insights) | S13.6 |
| F19 | Brand assets: logo, app icon, splash | S13.7 |

Build stages are a recommended order so that one developer can ship and test in steps. Every feature above ships in version 1. The PRD's "Stage 1" and "Stage 2" are mapped to the build contract's stages in section 13.

### F1 Lite public site
Server-rendered pages, content from the DB. Images are WebP and lazy. Video and 360° tours load only on tap. No page requires JavaScript to read its main content. A "last updated" date shows on fee data.

### F2 Installable PWA
After one visit, the student can browse cached public pages (universities, fees, process, visa, FAQ) offline. Lead forms and WhatsApp-tap events queue on the device and send when a connection returns. The app is installable to the home screen.

### F3 Lead intake
A short form that does not require an account [Mine, confirm]. Fields follow the existing process step 1 and 2: name, WhatsApp number (with country code), country, qualification type and results (O-level/A-level or Grade 10/11), at least 3 preferred programmes. Email optional unless signed in. [Mine, confirm WhatsApp number required.] Each lead gets a short human-readable reference generated on the device, so it works offline.

**Two forms** [Mine, confirm, amended 2026-10-23]. The full form above (at `/apply`) needs at least 3 preferred programmes. The quick form, opened by every "Chat on WhatsApp" button, asks only for name, WhatsApp number and country, and carries the university (and programme) of the page the visitor was on. It also creates a stored lead with a reference, so every WhatsApp handoff has one. A later full application creates a separate lead, and admins see the overlap through duplicate detection by number.

**Send first, then open WhatsApp** [Mine, confirm, amended 2026-10-23]. When the device is online, the form sends the lead and waits up to 4 seconds before opening WhatsApp, so the lead is stored before the handoff. Offline, slow or failed: the lead stays queued on the device and WhatsApp opens anyway.

### F4 Smart WhatsApp links
- **Student to Scollarly:** every WhatsApp button first opens the quick form from F3, then opens WhatsApp with a pre-filled message containing the lead reference plus context (university, programme, page). The tap is logged first. The message also carries a short summary (name, country, programme), so the admin is not working blind if the lead has not synced yet. [Mine]
- **Admin to student:** each lead in the dashboard has a "Message on WhatsApp" button that opens a chat to the student's number with a stage-appropriate pre-filled message the admin can edit.
- v1 uses one shared Scollarly WhatsApp number, set in a single configured value. Per-admin numbers are deferred. [Mine]

### F5 Auth and roles
Google sign-in through Neon Auth [Owner, amended 2026-10-24 (D15)], with 2FA required for the owner only [Owner]. There are no passwords [Owner, amended 2026-10-23 (D14)]. A person who signs in with Google for the first time has no Scollarly account until they confirm it (F14): they become a Student only by confirming, or by starting onboarding from Create account. [Owner, refactor 2026-10-31] Only the owner can invite or promote someone to Admin. Admins cannot create admins. The owner role cannot be removed, self-demoted if last, or granted by anyone else. Owner powers need a session that has passed the 2FA check, and destructive owner actions need a 2FA check within the last 10 minutes [Mine, confirm]. Removing an admin cuts their access on their next request.

### F6 Content management
Admin screens for: universities, programmes, fee structures, campus experiences, official resources, testimonials, team, FAQs, trust stats, journeys, blog posts, and images. Fee and tour records keep `dataConfirmed`, `lastUpdated` and `urlLastChecked`, and the dashboard flags stale ones (fees over 180 days, tours over 90 days [Carried]). Testimonials need `verified` and a consent record before they can be published. Who may edit content is [Mine, Q: A4]. Images are uploaded by admins and the owner from these screens and stored per FR-18. [Owner, amended 2026-10-23]

### F7 Admin lead management
List with filters (stage, country, university, assigned admin, overdue). Detail with profile, notes, history, stage control, "log reply", assign/reassign. Stages are the existing 6 process steps [Carried]: share results, choose course, offer letter, confirm admission, visa, arrive. The journey timeline and process list differ slightly today, so the canonical list needs your confirmation [Mine, A8].

### F8 Student portal
A signed-in student sees their profile, current stage, next step, and the WhatsApp button to their admin. Works offline from the last synced state.

### F9 Analytics dashboard
Admins and owner [Owner]. First-party events stored in the DB (no third-party script). [Mine, A9] All dates and times are shown in WAT. [Owner, amended 2026-10-23]
- **Funnel by stage:** visit, WhatsApp tap, lead, then each process stage to arrived, with drop-off.
- **Source and country:** by country, university and page.
- **Admin performance:** leads handled, first-response time (proxy), overdue count.
- **Payments received:** totals by university and by month, in USD, from the F10 ledger. Admins and the owner can both see this. [Owner, amended 2026-10-23]

### F10 Placement payments received
Universities pay Scollarly in US dollars. The amount is not fixed per student, so no expected or invoiced amount is tracked in v1. Only payments actually received are recorded. [Owner, amended 2026-10-23]
- Admins and the owner can record a payment received: university, optional linked lead, amount in USD, date received, optional note.
- Recorded payments are not edited. A mistake is voided (with a reason) and re-entered. Every entry and every void stores who and when. [Mine, confirm that both admins and the owner may void]
- Admins and the owner can view the history and totals.

### F11 i18n
All UI text goes through translation keys from day one. French is scaffolded but not launched. University names stay in English. [Carried] The old site did not actually do this on the homepage; the new one must.

### F12 Hub navigation [Owner, refactor 2026-10-31]
- After sign-in every role sees a floating pill tab bar and, next to it, a separate round button that opens a **More** sheet. Light colours only; the reference images are samples of shape and layout.
- **Admin and owner tabs:** Home, Leads, Content, Insights. **Student tabs:** Home, Universities, My progress, Help.
- **More sheet:** Notifications on top. Admin and owner then see Team (owner only), Security, Audit, Health, Settings, Profile and Sign out. A student sees Profile, My data, language and Sign out.
- Each tab is one screen. Admin and owner screens absorb today's separate pages as sections: Leads (list, link requests, data requests, overdue view), Content (universities, FAQs, photos, blog, stale list, media), Insights (funnel, sources and countries, admin performance, payments). Old addresses redirect to the matching section so bookmarks keep working.
- **Page help:** every admin and owner page shows a one-line purpose under its title and a helpful empty screen (it says what to do next). The first time a person opens a tab they see a short 3-step tour that can be dismissed and never repeats. There is no per-page "?" button.

### F13 Landing page [Owner, refactor 2026-10-31]
`/` is redesigned as a landing page that people reach from search. Its main action is a **course finder**: pick a course, see the universities that offer it, then "Create your free account" carrying the chosen course into onboarding. It also shows the university logos, the 6-step process, an FAQ teaser, an install prompt and the WhatsApp link. It shows only confirmed facts: no statistics, testimonials or team biographies until the owner supplies and confirms them (E1 to E3). Photos are the owner's own, served from our own storage. The reference image is a sample of layout and feel, not a design to copy.

### F14 Sign in and Create account [Owner, refactor 2026-10-31]
- `/sign-in` says "Welcome back" with one Google button and a clear link "New here? Create account". `/sign-up` says "Create your account", asks "I am a student" or "I am a parent", and has one Google button. Google stays the only login.
- A new person who tapped Sign in sees "No account found for this Google account. Create one?" with Confirm and Back, and nothing becomes a Scollarly account until they confirm. A person who came from Create account goes straight to onboarding.
- No page or endpoint tells anyone whether an email already has an account before Google has returned.

### F15 Onboarding for students and parents [Owner, refactor 2026-10-31]
- One question per screen with a progress bar and a back button. A half-finished answer set is kept on the phone and nothing is sent until the last screen.
- **Student questions:** Basics (name, WhatsApp number with country code, country), School results (qualification type and grades), Study plan (level, preferred courses, intake year). **Parent questions:** who is applying (child's name and country), the same school-results and study-plan questions about the child, and the parent's own name and WhatsApp number.
- The last screen has a privacy and consent tick. Finishing creates the account's profile and **one lead** for admins, automatically, in one request that retrying never repeats. It works offline: the answers queue like a lead and the person still sees their name and answers on the phone. The question set stays short (no budget, city or scholarship questions) [Owner, refactor 2026-10-31].
- A finished onboarding is an application: admins see it in Leads with a reference and the usual response clock.

### F16 Personalised student experience [Owner, refactor 2026-10-31]
- After onboarding the student's Home greets them by name and shows their stage and next step. Their answers are pre-selected wherever they apply, for example the Universities tab opens already filtered to their chosen courses.
- Universities that offer a chosen course come first. Among them the order is the best NAAC grade first (A++ down to B), universities with no stated grade last, ties in alphabetical order. Universities that do not offer the course follow.
- The order is worked out on the phone from public university data plus the student's saved answers, so no personal data enters any cached page, and it keeps working offline from the last saved copy.
- This needs a shared list of courses: each programme gets a course category (stored in its existing `field` column) and a `level` (existing column); both are empty today. The owner approves the categories (section 12.2).

### F17 Notifications [Owner, refactor 2026-10-31]
- A Notifications page opens from the More sheet; an unread dot sits on the round button. No push messages and no email. For urgent items an admin uses the existing one-tap WhatsApp button.
- Items are worked out from data the app already stores, plus one "last seen" time per user (no notifications table). "Mark all read" moves that time.
- **Student:** stage changed, an adviser replied, a new university matches my course; reminder to finish onboarding.
- **Admin:** a new lead, a lead due soon or overdue against its response clock, link requests, data requests; reminder when a lead waits too long.
- **Owner:** everything an admin sees, plus a payment recorded, stale fees or tour links, and health and storage alerts.

### F18 CRM dashboards [Owner, refactor 2026-10-31]
- Home (per role) shows what needs the person today (overdue leads, new leads, requests), four number tiles each compared with the last period, one main chart, a recent-activity list and a week / month switch. Insights shows the same numbers in more detail: the funnel as progress bars, leads by country, performance per admin (the owner sees everyone, an admin sees their own) and payments by month.
- The dashboards must be easy to read: few numbers, one sentence of explanation per chart, big type, readable on a phone. All times in WAT. When read offline they show "Last updated".

### F19 Brand assets [Owner, refactor 2026-10-31]
The supplied logo is traced into a clean vector file. The app icon (all sizes, including maskable and the Apple touch icon) and the installed-app splash use the logo in white on dark neon blue. The website header and the landing page keep the black logo on white. The splash appears only when the installed app launches and while its screen loads, never as a timed screen on the website (PRD_1 "Remove": forced splash). The logo also appears on the live app and the landing page.

## 7. User stories

**Student**
- S1. As a student on slow data, I want pages to load fast and without heavy animation, so I don't waste data.
- S2. As a student, I want to read university and fee information offline after one visit.
- S3. As a student, I want to see fees as a range with a clear disclaimer, and a "contact us" option where fees are unconfirmed, so I'm never shown a wrong number.
- S4. As a student, I want to start a chat on WhatsApp in one tap with my details already included, so I don't retype anything.
- S5. As a student with no signal, I want my submission saved on my phone and sent when I reconnect.
- S6. As a student, I want to sign in with Google and see which step of the process I'm at.
- S7. As a student, I want proof this is real (verified testimonials, a real offer letter) before I share my documents.
- S8. As a student, I want to watch a campus tour only if I choose to, so it doesn't use my data unasked.
- S9. As a visitor from a search, I want to pick my course on the first screen and see which universities offer it. (F13)
- S10. As a new person, I want it to be clear whether I am signing in or creating an account, so I never join by accident. (F14)
- S11. As a student, I want a short questionnaire, one question at a time, so I can finish it on my phone. (F15)
- S12. As a parent, I want to apply for my child and give my own contact, so the adviser talks to me. (F15)
- S13. As a student, I want the app to greet me by name and show the universities that fit my course first. (F16)
- S14. As a student or parent, I want to see what changed since my last visit in one place. (F17)

**Admin**
- A1. As an admin, I want to see new leads and who is unanswered past the SLA.
- A2. As an admin, I want a student's profile in front of me before I reply, so I don't re-ask basics.
- A3. As an admin, I want one tap to open WhatsApp to a student with a message suited to their stage.
- A4. As an admin, I want to change a student's stage and add notes.
- A5. As an admin, I want to update a university's fees or a testimonial without asking the developer.
- A6. As an admin, I want to see my own workload and response times.
- A7. As an admin, I want to record a payment a university has made, and see the totals. [Owner, amended 2026-10-23]
- A8. As an admin, I want four obvious tabs and a one-line explanation on each page, so I never have to ask where something is. (F12)
- A9. As an admin, I want a Home screen that tells me what needs me today. (F18)
- A10. As an admin, I want to be told when a lead is about to become overdue. (F17)

**Owner**
- O1. As the owner, I want to invite and remove admins, and no one else can.
- O2. As the owner, I want the funnel, source and country, and admin performance in one dashboard.
- O3. As the owner, I want to see the payments received from each university, by month. [Owner, amended 2026-10-23]
- O4. As the owner, I want to be warned when fee data or tour links are stale.
- O5. As the owner, I want one Home and one Insights screen that show how the business is doing in a few numbers I can read at a glance. (F18)
- O6. As the owner, I want team, security, audit, health and settings within one tap behind the More button, and hidden from admins. (F12)

## 8. Requirements

### Functional (selected, testable)
| ID | Requirement |
|---|---|
| FR-1 | Public pages render their main content without client JavaScript. |
| FR-2 | Fee numbers render only when `dataConfirmed` is true; otherwise a WhatsApp CTA. Zero or null is never displayed as a fee. [Carried] |
| FR-3 | Video and 360° iframes load only after a user tap; never autoplay; YouTube via `youtube-nocookie.com` with ID validated as `^[a-zA-Z0-9_-]{11}$`. [Carried] |
| FR-4 | Every WhatsApp URL is built by one helper from a configured number and `encodeURIComponent`-encoded text. No hardcoded numbers. [Carried] |
| FR-5 | A lead can be created offline, gets a device-generated reference, and syncs idempotently (retry never creates a duplicate). |
| FR-6 | A WhatsApp tap is logged before navigation and queued if offline. |
| FR-7 | Signing up always creates a Student. Only the owner can create or remove Admins. Role is checked on the server for every protected action, never only in the UI. |
| FR-8 | The owner role cannot be removed, and the last owner cannot be demoted. Owner-only actions (inviting or removing admins, role changes) require a session in which the owner has passed the 2FA check, and destructive ones need a 2FA check within the last 10 minutes. [Owner, amended 2026-10-23; the 10-minute window is Mine, confirm] Recording and viewing payments is not owner-only (see FR-17). [Owner, amended 2026-10-23] |
| FR-9 | Admin dashboards and content screens are inaccessible to students. Students can only see their own record. |
| FR-10 | Every stage change and admin action is stored with who and when. |
| FR-11 | The lead detail has a "Message on WhatsApp" button with a stage-based, editable template. |
| FR-12 | Leads past the SLA are flagged in a dedicated view. [Owner, amended 2026-10-23] **SLA rule:** (a) the clock starts at the server's received time for the lead, not the device's creation time, so a lead queued offline is not overdue before admins can see it; (b) the target is set once at that moment from the day of the week in WAT: Monday to Friday is 4 hours, Saturday and Sunday is 24 hours; (c) the clock runs continuously on the wall clock, and the target is never recalculated when it crosses midnight or a weekend boundary (example: a lead received Friday 23:00 WAT is due Saturday 03:00 WAT); (d) the target time and the hours applied are stored on the lead, so a later change to the settings never rewrites history; (e) a lead is answered when an admin first logs a reply. |
| FR-13 | Testimonials and journeys cannot be published without `verified` and a recorded consent. Offer-letter images must be pre-blurred before upload. [Carried] |
| FR-14 | Stale fee data (over 180 days) and stale tour links (over 90 days) are listed for the owner and admins. [Carried] |
| FR-15 | All user-facing strings use translation keys. |
| FR-16 | Content edits appear on the public site without a code deploy, and the PWA cache refreshes (stale-while-revalidate). |
| FR-17 | Admins and the owner can record, void and view payments received from universities, in USD only, per F10. Entries are append-only; a void requires a reason; every entry and void stores who and when. No expected or invoiced amount is stored. [Owner, amended 2026-10-23] |
| FR-18 | Content images (logos, campus photos, testimonial photos, blog images) are stored in a Neon Object Storage bucket. The browser resizes each image to WebP before upload. Proposed caps: about 300 KB for photos and 50 KB for logos, checked again on the server. The server checks the file signature, and SVG is not accepted. Images are served with long-lived cache headers through the edge cache. Total image storage is shown to the owner, with an alert at 70% of its budget (proposed budget about 3.5 GB of Neon Object Storage's free 5 GB). Offer-letter images require an in-browser blur step and a confirmation before upload. [Owner, amended 2026-10-24 (D16). The numbers are [Mine, confirm]] |

**Functional requirements added by the refactor (PRD_2)** [Owner, refactor 2026-10-31 unless noted]

| ID | Requirement |
|---|---|
| FR-19 | Every signed-in screen shows the shared pill tab bar (student: Home, Universities, My progress, Help; admin and owner: Home, Leads, Content, Insights) and a separate round More button. What each role may open is decided on the server for every request, not only hidden in the screen (extends FR-7 and FR-9). |
| FR-20 | Each admin and owner tab is one screen served with one data call. Every old admin address redirects to the matching tab section. No old address returns an error. |
| FR-21 | Every admin and owner page has a one-line purpose under its title and an empty state that says what to do next. The first-visit tour shows once per person per tab, can be dismissed, and never repeats. |
| FR-22 | `/` is a server-rendered landing page with no personal data, showing only confirmed facts. Its course finder lists the universities offering a chosen course from public data. The page keeps the public budgets of section 8 (first load under 200 KB, public JavaScript under 118 KB gzip). |
| FR-23 | Sign in and Create account are separate. No endpoint or page answers "does this email have an account" before Google has returned. A person who arrives through Sign in without a Scollarly account sees a confirm screen, and no Scollarly account (confirmed) exists until they confirm or start onboarding from Create account. [Mine, refactor: the Neon Auth login itself exists once Google returns and cannot be avoided; what the person confirms is the Scollarly account.] |
| FR-24 | Onboarding keeps its draft on the device, sends once at the end, and creates the profile and exactly one lead in one idempotent request that shares its idempotency key with the lead queue. A retry, an offline retry or a second device never creates a second lead. A second lead from the same WhatsApp number is surfaced to admins, never merged silently (extends FR-5). |
| FR-25 | The profile stores `relationship` (`student` or `parent`). A parent account has the student role. There is no fourth role (extends FR-7). |
| FR-26 | On the student's screens the name and saved answers are pre-selected. The universities list is ordered: universities offering a chosen course first, then NAAC grade (best first, unknown last), then name A to Z. The ordering is computed on the device from public data and saved answers. No personal data is placed in any cached page or shell. |
| FR-27 | Notifications are derived from stored data and one `notifications_seen_at` time per user. The unread dot counts items newer than that time. No push, no email, no notifications table. |
| FR-28 | Home and Insights show at most four number tiles, one main chart, one activity list and a week / month switch per role; an admin sees their own results and the owner sees everyone's. Each chart carries a one-line explanation. |
| FR-29 | Offline, a student reads their last saved copy. An admin or the owner reads their last dashboard totals only; no lead name, phone number or email is kept on the device, and the copy is deleted on sign-out and when a different user signs in. All changes need a connection (amends assumption A7). |
| FR-30 | The logo exists as a vector file. The app icon set and installed-app splash use the white logo on dark neon blue; the website and landing page use the black logo on white. Nothing delays a page for a splash. |
| FR-31 | Every programme has a course category (the `field` column) and a `level`, used by the course finder and the ordering. A course with no university offering it shows a plain message and a WhatsApp button, never an empty screen. [Mine, refactor] |
| FR-32 | All new text goes through translation keys (extends FR-15). |

### Non-functional
- **Performance budget** (proposed starting values, to be validated on a throttled mobile profile and real low-end Android): first public page load under 200 KB transferred excluding lazy images; no layout-blocking splash; Lighthouse mobile performance at least 85 [Carried]. Owner to confirm.
- **Offline:** public read pages and the lead queue work offline. Sign-in and every change require a connection. The student's last saved copy and the staff's last dashboard totals can be read offline (FR-29). [Mine, A7; amended 2026-10-31]
- **Clarity (refactor):** a new admin completes each of the four daily jobs without help, measured in a watched test (section 2).
- **Cost:** no paid service in the request path. Free-tier limits (DB size, auth users, bandwidth, inactivity pausing, commercial-use terms) verified before selection and monitored.
- **Expected volume:** about 1 to 100 leads per month (approximate, owner estimate); sessions unknown. [Owner, amended 2026-10-23]
- **Security and privacy:** server-side authorisation; no personal data in analytics events beyond an anonymous session ID; no unblurred personal documents in the repo [Carried]; data export and deletion on a student's request.
- **Accessibility:** readable at 375px, touch targets sized for mobile, respects reduced motion.
- **Maintainability:** content in the DB, not code; migrations versioned.

## 9. Data entities (high level, no schema yet)

Users and roles; leads (profile, preferred programmes, reference, source, assigned admin); stage history and admin actions; notes; events (page view, WhatsApp tap, form submit); universities, programmes, fee structures, campus experiences, official resources; content images; testimonials with consent records; team members; FAQs; trust stats; journeys; blog posts; placement payments received (with voids). **Added by the refactor:** a student profile (relationship, onboarding answers, consent version, onboarding time), and on each user an account-confirmed time, a notifications last-seen time and a list of tours seen, and filled-in course category (`field`) and `level` values on each programme (columns that already exist).

## 10. Edge cases

**Connectivity**
- Background Sync is not supported in all browsers (notably iOS Safari), so the queue does not depend on it. It retries whenever the app is open and online.
- Google sign-in needs a connection; show a clear offline message and keep the lead flow usable without an account.
- Cached fee data can be old: always show "last updated", and replace the cache on reconnect.
- 360° tours and videos are unavailable offline: show a clear "needs connection" state, not a broken frame.
- The user taps WhatsApp offline: the lead is saved locally with its reference, WhatsApp opens (it can hold the message), and sync happens later.
- **Turnstile vs the offline queue.** A lead queued offline cannot carry a fresh Turnstile token, and a background sync has no page to show a challenge. Decision [Mine]: Turnstile runs when the app is open and online, and queued leads are submitted then with a fresh token. Until then the lead stays on the device and the WhatsApp message carries the summary. When the app is online, the form sends first and waits up to 4 seconds, then opens WhatsApp, so the lead is stored before the handoff (amended 2026-10-23). Server-side rate limiting is the second layer (the old in-memory limiter does not work on Workers or serverless).

**Data and identity**
- Duplicate leads from the same student (retries, two devices, new session): dedupe by reference first, then by WhatsApp number, and surface possible duplicates to admins rather than auto-merge.
- WhatsApp number missing a country code, wrong length, or shared between students: validate and normalise; allow multiple students per number with a warning.
- A lead later signs up with a different email: link by number or reference with admin confirmation, never silently. The admin records how identity was checked: the verified email matches the lead, or the student replied on WhatsApp from the number on file. [Mine, amended 2026-10-23]
- There is no password sign-up, forgot-password or resend-verification, so those forms cannot be abused to use up the free email allowance. No email is sent in v1. The lead forms keep Turnstile and the rate limiter. [Owner, amended 2026-10-23 (D14)]
- Applicants aged 17 are minors. Consent and parent involvement need a legal check. [Open, Q6]
- Student requests deletion: leads, notes and events tied to them must be erasable while keeping anonymous aggregates. Payment records are not personal data and are kept; a link to an erased lead is cleared. [Mine]

**Refactor (F12 to F19)** [Mine, refactor, unless noted]
- Google succeeds but the person closes the tab before confirming: no Scollarly account exists; the next visit starts again. Abandoned unconfirmed sign-ins are listed for the existing expiry purge.
- A person confirms the account and then abandons onboarding: they see a Home that asks them to finish, and a reminder appears in Notifications. No lead exists until onboarding is submitted.
- Offline submit: the answers queue; the person sees their name and answers from the phone; the lead is created when the app is online again, once.
- A student who applied earlier through `/apply` or WhatsApp then finishes onboarding with the same number: a second lead is created and admins see the duplicate (never merged silently). The link-my-application flow stays.
- A parent and the child both finish onboarding for the same child: two leads, shown as a possible duplicate by number.
- A chosen course that no university offers: a plain message and a WhatsApp button.
- A university with no stated NAAC grade: listed after graded universities with "NAAC grade not stated".
- A student changes their chosen courses later: the order changes on the next open, from the saved copy first.
- The pill bar on a very small or very large phone, with a keyboard open, or in landscape: it never covers an input and respects safe areas and reduced motion.
- An admin's role is removed while they are on a hub: the next data call is refused and the screen shows the sign-in page (extends the existing removal rule).
- Tour or page-help text in a locale that has no translation: falls back to English.

**Roles**
- An admin is removed while holding leads: leads return to an unassigned pool and are flagged.
- The owner loses their 2FA device or account access: recovery codes are issued when 2FA is enrolled and kept by the owner; a documented manual database recovery is the last resort. [Mine]
- First owner bootstrap: there is a single owner (you). The owner's email is a server-side configured value, and the first verified sign-in with that email gets the owner role and must enrol 2FA. No one else can obtain the role through sign-up. [Mine]
- A promoted admin has an existing student record: it remains and is not exposed to other students.

**Content**
- Fee currency differs (USD for Chandigarh, INR for others): show with conversion note; never mix in totals.
- A university has no campus asset or prospectus: the existing "available on request" and "request details" fallbacks apply.
- YouTube video removed or ID invalid: fall back to a search link. [Carried]
- An image fails to load or is too large: the upload is rejected with a clear message, and pages show a text placeholder, never a broken image. [Mine]

**WhatsApp**
- WhatsApp not installed: the wa.me link opens a web page; also show the number to copy.
- Message text over URL length limits or containing special characters or emoji: always encode; keep templates short.
- Number changes: single configured value, so one change updates every link.

**Analytics**
- Ad blockers and offline sessions cause undercounting: use first-party events and queue offline events; state the limitation on the dashboard.
- Bots inflate visits: basic filtering.
- Time zones: all reporting uses WAT, held in one configured value. Admins in India (IST) see WAT times. [Owner, amended 2026-10-23]
- Free-tier storage: raw events need a retention and daily-aggregation policy.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Scope is large for one developer at zero cost; all features are in v1 | Ordered build stages with exit criteria, Phase 0 gate first; WhatsApp API explicitly deferred |
| Free tiers pause, cap or restrict commercial use | Verify terms before choosing hosting, DB and auth; monitor usage; keep data portable |
| The chosen stack may not fit Cloudflare's free Workers limits, and there is no fallback host | Phase 0 test of a thin slice (page + auth + DB query + image + offline page) on Workers before building the rest; if it fails, the decision returns to the owner |
| Offline queue, bot protection and sync interact badly (Turnstile, iOS background sync) | Design and test the queue end to end early with Playwright offline tests |
| Response time can't be measured exactly without the API | Admin-logged proxy, labelled as such on the dashboard |
| Google sign-in only: a student without a Google account cannot sign in to track progress | Anonymous lead intake and WhatsApp work without an account; the account is only for tracking. Revisit if many students lack a Google account |
| Trust claims on the site are inconsistent or unverifiable | Resolve Q3 before launch; testimonials gated by consent |
| Storing students' personal data brings legal duties in several countries | Legal check [Open, Q6]; minimise stored data; deletion on request |
| Neon Object Storage is generally available, but its request and transfer limits on the free plan are not stated on the pages read | The owner checks Neon's plans page (section 12.2); Phase 0 measures reads and the usage meter alerts at 70% of the budget. If a limit is too low the decision returns to the owner; images stay in Neon behind the same storage interface |
| Neon Auth is a managed service: an outage blocks sign-in, and it has no authenticator-app 2FA yet | Public pages and lead intake do not depend on it. Owner 2FA is our own code on a proven library. The owner checks Neon's roadmap each session until its MFA ships (tracker) |
| Admins can enter payment amounts | Append-only ledger with void-and-re-enter and a full audit trail (FR-17) |
| The refactor features come from the owner's own use; no real admin or student has used the app yet | The stage ends with a watched test by real people (essentials_2 S13.9); results decide what is adjusted before launch |
| Google's OAuth app is still in Testing mode, so real students cannot sign up | Publishing it is an owner action (H8) and blocks the first real onboarding |
| Collecting a child's details and a parent's contact, and creating a lead automatically, needs legal cover for minors and the student countries | Consent tick with a recorded notice version on the last onboarding screen; the legal check (Q6, H5) stays an owner item before launch |
| Only 4 of the 9 seeded universities have a NAAC grade, so the order is weak for the rest | Unknown grades are listed last and labelled; the owner supplies the grades |
| Programmes have no shared course list yet | A course category (`field`) and `level` filled in per programme, approved by the owner (section 12.2) |
| Each hub screen must fit the free-plan CPU limit | One screen, one data call; the CPU row of every hub is measured on the deployed Worker (essentials_2 S13.6) |
| Derived notifications could cost reads on every screen load | Computed only when the Notifications page or the dot is requested, from indexed queries, measured |

## 12. Decisions and remaining items

### 12.1 Decided

| Topic | Decision | By |
|---|---|---|
| Version scope | All features F1 to F11 are built in version 1. Build stages are only an order of work. | Owner, amended 2026-10-23 |
| Roles | Three roles only: student, admin, owner. All other staff are admins. | Owner, amended 2026-10-23 |
| Timezone | WAT (`Africa/Douala`) for the dashboard, the SLA and reports | Owner, amended 2026-10-23 |
| Expected volume | About 1 to 100 leads per month, approximate | Owner, amended 2026-10-23 |
| Content images | Stored in a Neon Object Storage bucket, with caps and edge caching (FR-18) | Owner, amended 2026-10-24 (D16) |
| University payments | Paid in USD, amounts not fixed; only payments received are recorded; admins and the owner can enter and view them | Owner, amended 2026-10-23 |
| SLA rule | As defined in FR-12 | Owner (agreed to a precise rule), amended 2026-10-23 |
| Owner | One owner: you. Created from a server-side configured email at first verified sign-in. | Owner / Mine |
| 2FA | Required for the owner only. Authenticator app plus recovery codes. | Owner / Mine |
| Authentication | Neon Auth (managed Better Auth), Google sign-in only (no passwords) | Owner, amended 2026-10-24 (D15) |
| Hosting | Cloudflare Workers only. Vercel removed. No fallback host. | Owner |
| Domain | scollarly.co.in only. Email sends from mail.scollarly.co.in. scollarly.com is not used. | Owner |
| Offline lead verification | Turnstile runs when the app is open and online; queued leads submit then. No dependency on background sync. | Mine |
| WhatsApp number | One shared Scollarly number in v1, set in a single configured value. Per-admin numbers deferred. | Mine |
| Pre-filled WhatsApp message | Carries the lead reference plus a short summary (name, country, programme) | Mine |
| Unconfirmed trust content | Any statistic, testimonial or team bio you have not confirmed is not published at launch | Mine |
| Student document uploads | Not in v1 | Mine |
| Landing page | `/` is redesigned; same address search already knows. Main action is a course finder. | Owner, refactor 2026-10-31 |
| Sign in versus Create account | Two separate buttons; a new person who taps Sign in confirms before an account is made; Google stays the only login | Owner, refactor 2026-10-31 |
| Parent | A student-role account with `relationship = parent`; no fourth role; collects the child's details and the parent's contact | Owner, refactor 2026-10-31 |
| Questionnaire | Student: Basics, School results, Study plan. No budget, city or scholarship questions. | Owner, refactor 2026-10-31 |
| Onboarding and leads | Finishing onboarding creates a lead automatically | Owner, refactor 2026-10-31 |
| Order of universities | Offering the chosen course first, then best NAAC grade, ties A to Z, unknown grade last | Owner, refactor 2026-10-31 |
| Navigation | Admin and owner: Home, Leads, Content, Insights. Student: Home, Universities, My progress, Help. A round More button holds Notifications and the other pages. | Owner, refactor 2026-10-31 |
| Colours | Light only, blue, black and white. Reference images are samples of layout only. | Owner, refactor 2026-10-31 |
| Notifications | In-app page and unread dot only, derived from stored data plus one last-seen time; admins nudge by WhatsApp | Owner, refactor 2026-10-31 |
| Page help | One-line purpose, helpful empty screens, first-visit tour; no "?" button | Owner, refactor 2026-10-31 |
| Offline for signed-in screens | Students read their last copy; admins and the owner read last dashboard totals only | Owner, refactor 2026-10-31 |
| Logo and splash | Traced to a vector; white on dark neon blue for the app icon and splash; black on white on pages | Owner, refactor 2026-10-31 |
| Versioning for this refactor | New files `PRD_2.md`, `system_architecture_2.md`, `system_architecture_essential_2.md`, `tracker_2.md` instead of editing in place | Owner, refactor 2026-10-31 |
| One stage | The whole refactor is one stage in essentials_2 | Owner, refactor 2026-10-31 |

### Assumptions that stand (you did not change them)

| ID | Assumption |
|---|---|
| A1 | A lead can be created without an account; sign-up is for tracking |
| A2 | Admins see all leads (not just assigned) in v1 |
| A3 | **Amended:** payments received are visible and can be entered by admins and the owner (F10) [Owner, amended 2026-10-23] |
| A4 | Admins can edit content; the owner can edit everything |
| A5 | An admin sees their own performance; the owner sees everyone's |
| A6 | WhatsApp number is required on the lead form |
| A7 | Admin dashboard and sign-in are online-only |
| A8 | The 6 process steps are the canonical stages |
| A9 | First-party analytics replaces GA4 (lighter, works offline); GA4 removed |
| A10 | Superseded: the old Vercel projects are being deleted, so there is no live site until v2 launches |

### 12.2 Owner actions needed before launch

These do not block starting the build. They block going live.

1. **Q2: Correct phone numbers.** Which number is the Scollarly WhatsApp number (+237 651 232 301 on every button), and which number should the contact section show (+91 98157 25968 today)?
2. **Q3: Confirmed trust content.** Provide the real figures for students helped and students admitted, confirm the 5 testimonials are real and consented, and confirm the team bios. Anything unconfirmed is left out.
3. **Q6: Minors and data protection.** Get a legal check on consent for 17-year-old applicants and on the privacy rules in the student countries. I have not verified which laws apply.
4. **Mailbox and email.** Not needed in v1: Resend is removed (D15) and invites are copyable links.
5. **Domain on Cloudflare.** Needed before launch, not for the build. The Stage 0 probe showed the Cache API works on the `workers.dev` address, so the build and the gates use `workers.dev`. At the time of this amendment scollarly.co.in is locked at the registrar pending .IN KYC (owner decision D12).
6. **Neon Auth and Google sign-in.** Switch on Neon Auth for the project in the Neon console and create the Google OAuth credentials for it. Google's redirect address will be Neon Auth's, not the `workers.dev` address; this is confirmed when the credentials are created. Needed before Stage 2 testing.
7. **Vendor limits.** Confirm the free-tier limits and commercial-use terms of Cloudflare Workers, Neon (including Neon Auth and Neon Object Storage) and Turnstile. Phase 0 starts this.
8. **Neon Object Storage limits.** Read Neon's plans page and confirm the free-plan request and transfer limits for Object Storage. No card is needed. (R2 was dropped because its checkout asked for a payment method; D16.)

### 12.2b Owner items added by the refactor (not marked done by Claude Code)

| # | Item | Needed before |
|---|---|---|
| R1 | Publish Google's OAuth app (it is in Testing mode with the owner as the only test user, H8), or real students cannot sign up | First real onboarding |
| R2 | Approve the list of course categories and the level for each of the 77 programmes (Claude Code proposes a mapping; the owner confirms) | S13.3 and S13.4 |
| R3 | Supply NAAC grades for the 5 universities with none, or accept "not stated, listed last" | S13.4 |
| R4 | Confirm the dark neon blue hex for the app icon. Proposed start: `#1F3BFF`. [Mine, confirm] | S13.7 |
| R5 | Legal check and text for a parent applying for a child, minors, and consent for automatic lead creation (extends Q6, H5) | Launch |
| R6 | Trust content for the landing page (E1 to E3). Until supplied the landing page shows none. | Launch |
| R7 | Confirm the stage number and module numbering (Stage 13, S13.x). [Mine, confirm] | Start of the stage |
| R8 | Decide whether `CLAUDE.md` Step 2 should be amended so that essentials_1's open Stages 10 and 11 do not stop the start-of-task sequence (section 13 and tracker_2 flag F21). The owner's file; Claude Code does not edit it. | Start of the stage |

### 12.3 Needed before a specific feature

- **Q4: How universities pay you.** Resolved: paid in USD, amounts not fixed, only received payments are recorded (F10). [Owner, amended 2026-10-23]
- **Metric targets** and the "N days" for pipeline freshness. Set after 4 weeks of measurement.
- **Performance budget.** Confirm or change the proposed 200 KB first load and Lighthouse 85.
- **Image caps and storage budget (FR-18).** Confirm or change the proposed 300 KB photo cap, 50 KB logo cap and 150 MB budget.

## 13. Build order

**Version 2 refactor (this document):** one stage, Stage 13, in `essentials/system_architecture_essential_2.md`: S13.1 foundations, S13.2 sign in and create account, S13.3 onboarding, S13.4 student app, S13.5 notifications, S13.6 admin and owner hubs with CRM dashboards, S13.7 landing page and brand, S13.8 carry-over from Stages 10 and 11, S13.9 watched test and QA. [Owner, refactor 2026-10-31; stage numbering is Mine, confirm]

The text below is the original version 1 build order, kept for history.

### Version 1 build order (history)

All stages ship in version 1. [Owner, amended 2026-10-23]

Mapping to the build contract (`essentials/system_architecture_essential_1.md`, Stages 0 to 11): Phase 0 is Stage 0. The PRD's "Stage 1, core" is roughly essentials Stages 1 to 7. The PRD's "Stage 2" is roughly essentials Stages 8 and 9. Essentials Stages 10 and 11 (owner pages, operations, hardening, launch) have no separate PRD stage. The essentials file is the source for order and exit criteria.

- **Phase 0, proof of fit:** one thin slice deployed on Cloudflare Workers' free plan: a server-rendered page, Google sign-in with Neon Auth (the first slice used self-hosted Better Auth), a password hash and sign-in measured against the CPU limit, one Neon query, a stub authenticated admin page and a stub lead endpoint (so their CPU can be measured), one image stored in a Neon Object Storage bucket and served from the edge, one Serwist offline page, and Lighthouse CI on it. If it does not fit, stop and bring the decision back to the owner before building more. [Mine] **Measured on 2026-10-23:** the first slice failed the CPU gates for password sign-in, the lead POST and image serving on the free plan, so Phase 0 stays open and now also proves the lean design (essentials S0.10). [Owner decision D14] The Neon-centred redesign (D15, D16) is proven in the same module.
- **Stage 1, core:** F1, F2, F3, F4, F5, F6, F7, F11 structure, and the funnel and source/country views.
- **Stage 2:** F8 student portal, admin performance, F10 placement payments received and the payments view in F9.
- **Later (after v1):** French launch, student document upload (if you decide yes), WhatsApp Business API.

## Amendment log (pre-build, 2026-10-23)

Edited in place by the owner's instruction after the engineering review. Nothing had been built or committed. Each change is also reflected in `system_architecture_1.md` and `essentials/system_architecture_essential_1.md`.

- Quick WhatsApp form added next to the full form; metric minimum profile defined for both (F3, F4, success metrics).
- Send first, then open WhatsApp, up to 4 seconds when online (F3, section 10).
- Turnstile also protects sign-up, forgot-password and resend-verification, with a daily cap on student-originated emails (stack table, section 10). *(Superseded on 2026-10-23: there is no password sign-up any more; see the log below.)*
- Owner 2FA rule made precise: a session that has passed 2FA, plus a 10-minute check for destructive actions (F5, FR-8).
- Admin approval of a student link records how identity was checked (section 10).
- Phase 0 slice includes a stub admin page and a stub lead endpoint; the domain action may be needed before Phase 0 ends (sections 12.2, 13).
- PRD "Stage 1/2" mapped to the essentials stages (section 13).

## Amendment log (after the Stage 0 measurements, 2026-10-23)

Edited in place by the owner's instruction (decision D13: edit the existing documents, no new versions). Version stays 1. Cause: the Stage 0 slice was deployed to Workers Free and measured, and the CPU limit (about 10 ms per request) was exceeded by password sign-in (scrypt and PBKDF2), the lead POST and image serving. The owner chose to redesign for the free plan (decision D14). Each change is also reflected in `system_architecture_1.md`, `essentials/system_architecture_essential_1.md` and the tracker.

- **Google sign-in only; no passwords** (constraints, stack table, F5, S6, section 10, risks). No verification, reset or resend emails exist any more.
- **Email is optional in v1**: admin invites only, and invite links can be shared by hand. Mailbox and Resend are no longer launch requirements (section 12.2, items 4).
- **The CPU limit is a stated constraint**, with the three design responses: edge fast path, no passwords, thin handlers (section 4).
- **Hosting on `workers.dev` until the domain is verified** (D12); the Cache API was measured to work there (section 4, section 12.2 item 5).
- **Images stay in Neon for now**, served from the edge before Next.js starts; object storage is the named fallback and is the owner's decision (section 4).
- **New trade-off recorded:** a student without a Google account cannot sign in to track progress (section 11).
- **Phase 0 stays open** and gains a lean-design proof (section 13; essentials S0.10).

## Amendment log (Neon-centred redesign, 2026-10-24, decision D15)

Edited in place by the owner's instruction (D13). Version stays 1. Cause: the owner asked to move authentication, authorisation and images onto Neon after the free-plan redesign (D14), following an engineering review.

- **Neon Auth** (managed Better Auth in our Neon database) runs Google sign-in and sessions instead of Better Auth inside the Worker (sections 4, 6, 10, 11).
- **Owner 2FA** uses the otpauth library plus our own lockout and recovery codes, because Neon Auth has no authenticator-app 2FA yet. The PRD rule is unchanged (F5, FR-8).
- **Access control** is the auth facade and Actor in our code plus Neon row level security (two locks).
- **Images** move to a Neon Object Storage bucket (section 4, FR-18). The first choice, R2, asked for a payment method at checkout on 2026-10-24, so D16 switched to Neon Object Storage (free plan, no card).
- **Resend is removed.** No email is sent in v1 (section 4, 12.2).
- The proofs for all of this are added to Stage 0 Module S0.10. A failed gate returns the matching decision to the owner.

## Amendment (images in Neon Object Storage, 2026-10-24, decision D16)

D15 chose a Cloudflare R2 bucket for images. R2's checkout asked for a payment method, and the project rule is never to add a paid service. While looking for a free alternative it was found that Neon has its own S3-compatible Object Storage (generally available, available in the project's region aws-eu-central-1, 5 GB per project on the free plan, public-read buckets). **An earlier statement in the D15 review that "Neon has no object storage" was wrong and is corrected.** The owner chose Neon Object Storage (D16). Everything else in D15 is unchanged.
## Amendment (signed-in screens on the free plan, 2026-10-24, decision D18)

Edited in place by the owner's instruction (D13). Version stays 1. Cause: the first Module S0.10 run showed that a signed-in page rendered by Next.js uses more CPU than Workers Free allows, and the owner chose to stay on the free plan. **No requirement changes.** Only the technology row for Backend / API changes: signed-in screens use a cached page shell and plain data functions instead of Server Actions and server-rendered pages. Downstream Impact: NO_IMPACT on requirements; the effect is in the architecture (ADR-040) and the essentials.
## Amendment log (PRD_2, refactor, 2026-10-31)

Written from the owner's approved design document `docs/designs/scollarly-v2-refactor.md`. Not edited in place: this is a new version (owner decision, design document D16). Everything before this heading is `PRD_1.md` carried forward with its own amendment logs; where the two disagree, the text above this heading marked `[Owner, refactor 2026-10-31]` or `[Mine, refactor]` wins.

- F12 to F19 added (hub navigation, landing page, sign in and create account, onboarding, personalised student experience, notifications, CRM dashboards, brand assets).
- FR-19 to FR-32 added; assumption A7 amended (staff may read last dashboard totals offline).
- Goals G7 (extended), G8 and G9 added; two success measures added.
- Roles unchanged (three). A parent is a student account with `relationship = parent`.
- Owner items R1 to R8 added (section 12.2b).
- Downstream Impact: IMPACT on `system_architecture_2.md` and `system_architecture_essential_2.md` (see the Changelog at the top).
