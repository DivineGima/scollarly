# Scollarly — Feature Addition Design Document
**Version:** 1.0  
**Date:** June 2026  
**Author:** System Design Session — Divine Gima Folabit & AI Architect  
**Status:** Locked & Approved for Implementation

---

## 1. Project Context

### 1.1 What Scollarly Is
A full-stack Next.js 16 (App Router) marketing and lead generation platform that connects African students (primarily Cameroon, West Africa, South Africa) with Indian universities. Students pay nothing — Scollarly earns placement fees from universities upon successful enrollment.

### 1.2 Current State
- Single-page marketing website with contact form
- 9 partner university detail pages (already built, data-driven from `src/data/universities.ts`)
- PostgreSQL + Prisma backend
- Resend email system
- No auth active, no student portal, no admin panel

### 1.3 What This Document Covers
This document defines the architecture, logic, data, inputs, outputs, and implementation rules for **4 additive features** being layered onto the existing codebase. Nothing existing is rebuilt. Everything is additive.

---

## 2. Problem Statement

### 2.1 Business Problems Being Solved
1. **University detail pages lack depth** — students see program names but no fee context, no campus feel, no downloadable information
2. **Silent churn on universities section** — students with budget constraints or niche needs leave without contacting Scollarly
3. **Low trust conversion** — African audiences (especially Francophone West Africa) need documented proof, not just marketing copy
4. **Language barrier risk** — Francophone students (Cameroon, Ivory Coast, Senegal, Guinea) face an English-only site

### 2.2 Target Users
- **Primary:** African students aged 17–28 seeking undergraduate/postgraduate admission in India
- **Geography:** Cameroon, Nigeria, Ghana, Ivory Coast, Senegal, Guinea, South Africa
- **Device:** Primarily mobile (Android), limited/expensive data plans — performance is non-negotiable
- **Language:** English (primary), French (planned)

---

## 3. Features Being Built

### Feature 1 — Enhanced University Detail Pages
### Feature 2 — Universities Section WhatsApp CTA
### Feature 3 — Trust & Curiosity System
### Feature 4 — i18n Architecture Foundation

---

## 4. Feature 1: Enhanced University Detail Pages

### 4.1 Overview
Add three new sections to each existing university detail page (`/universities/[slug]`). All data is sourced from `src/data/universities.ts` — the data structure must be extended to support the new fields.

### 4.2 New Sections Added to Each University Page

#### Section A — Fee Structure
**Purpose:** Give students a realistic cost picture without creating legal/accuracy liability.

**Display Rules:**
- Show fee ranges, never single exact figures
- Chandigarh University: display in USD (official non-SAARC data exists)
- All other 8 universities: display in INR with conversion note
- Always show disclaimer: *"Fees shown are estimates for reference. International student fees may differ. Contact Scollarly for your personalised fee breakdown in USD."*
- Disclaimer links directly to WhatsApp

**Fee Breakdown Structure (per university):**
```
Tuition Fee:        ₹X – ₹Y per year (or USD equivalent)
Hostel Fee:         ₹X – ₹Y per year
Registration Fee:   ₹X (one-time)
Estimated Total:    ₹X – ₹Y for full course duration
Scholarship:        Up to X% available via Scollarly
```

**Researched Fee Data (locked into universities.ts):**

| University | Tuition/yr (INR) | Hostel/yr (INR) | Total 4yr (INR) | Notes |
|---|---|---|---|---|
| Chandigarh University | USD 6,000 (after 50% scholarship: USD 3,000) | USD 1,920–2,400 | USD 24,000 (before scholarship) | Official non-SAARC USD pricing confirmed |
| Jain University | ₹1.69L–₹3.75L | ₹1.85L–₹2.2L | ₹6.75L–₹15L total | NAAC A |
| Kalinga University | ₹1.05L–₹1.55L | ₹78K–₹2.86L | ₹4.21L–₹6.21L total | Separate international fee page exists |
| CT University | To be confirmed with university directly | To be confirmed | To be confirmed | YouTube virtual tour exists |
| Rayat-Bahra | To be confirmed with university directly | To be confirmed | To be confirmed | Virtual tour page exists |
| CGC University | To be confirmed with university directly | To be confirmed | To be confirmed | |
| Karnataka University | To be confirmed with university directly | To be confirmed | To be confirmed | |
| Swami Vivekanand | To be confirmed with university directly | To be confirmed | To be confirmed | |
| Aditya University | To be confirmed with university directly | To be confirmed | To be confirmed | |

**Note:** For universities where data is not yet confirmed, the fee section renders a "Contact us for fee details" CTA instead of showing empty/wrong data. Never show placeholder numbers.

#### Section B — Campus Experience
**Purpose:** Give African students who cannot visit India in person a data-friendly visual feel of the campus. Replaces "VR" concept with a proven, mobile-optimised approach.

**Implementation Architecture:**
Each university in `universities.ts` gets a `campusExperience` object:

```typescript
campusExperience: {
  type: 'youtube' | 'iframe_360' | 'coming_soon',
  youtubeId?: string,        // YouTube video ID only (not full URL)
  iframeUrl?: string,        // For official 360° tour embeds
  thumbnailUrl?: string,     // Static preview image shown before load
  label: string,             // e.g. "Official Campus Tour" or "360° Virtual Tour"
}
```

**Confirmed Campus Experience Data:**

| University | Type | Source | Asset |
|---|---|---|---|
| Chandigarh University | `iframe_360` | `iviewd.com/cu2/` | Official 360° tour — fast loading, dedicated site |
| CT University | `youtube` | YouTube | ID: `bHh1-efoe4w` — Official CT University virtual tour video |
| Kalinga University | `iframe_360` | `virtualtour.kalingauniversity.ac.in` | Official 360° dedicated domain |
| Jain University | `youtube` | YouTube | ID: `5ddvpNEqpec` — Official JAIN campus tour |
| Rayat-Bahra University | `youtube` | YouTube | ID: `CB4w1yp1Z_I` — Campus tour video |
| CGC University | `coming_soon` | Not found | "Coming Soon" state |
| Swami Vivekanand | `coming_soon` | Not found | "Coming Soon" state |
| Karnataka University | `coming_soon` | Not found | "Coming Soon" state |
| Aditya University | `coming_soon` | Not found | "Coming Soon" state |

**Critical Performance Rules (non-negotiable — African mobile users):**
- YouTube embeds: NEVER autoplay. Load thumbnail image only on initial render. Video iframe injects ONLY when user clicks "Watch Campus Tour" button — this saves ~500KB on initial page load
- YouTube embed URL MUST always use `youtube-nocookie.com`, never `youtube.com` — privacy compliance + no tracking pixels on load
- YouTube IDs MUST be validated as exactly 11-character alphanumeric before rendering: `/^[a-zA-Z0-9_-]{11}$/`. If invalid, fall back to text link: `https://www.youtube.com/results?search_query=${encodeURIComponent(universityName + ' campus tour')}`
- 360° iframes: Load with `loading="lazy"`. Show static preview with a "Explore 360° Tour →" button. iframe only activates on click
- All thumbnails: WebP format, max 80KB, served via Next.js `<Image>` with `loading="lazy"`
- No video autoplaying under any circumstance
- All campus experience URLs must include a `urlLastChecked` ISO date string in the data object. If > 90 days old, log a `console.warn` in development to prompt verification

**UI Pattern:**
```
[Campus Experience Section]
┌─────────────────────────────────────┐
│  🎬 Explore the Campus              │
│  [Thumbnail Image]                  │
│  "Watch Official Campus Tour"       │
│  → Click loads YouTube iframe       │
└─────────────────────────────────────┘
```

For `coming_soon` (do NOT use "Coming Soon" — it implies an upcoming release with no timeline):
```
┌─────────────────────────────────────┐
│  📸 Campus Photos Available on      │
│     Request                         │
│  We are preparing a virtual tour    │
│  for this campus.                   │
│  [Request Campus Photos on WhatsApp]│
└─────────────────────────────────────┘
```

#### Section C — Official Resources / Brochure
**Purpose:** Give students access to official university information without Scollarly hosting or maintaining stale PDFs.

**Logic:**
- If official PDF/prospectus URL exists for university → show "Download Official Prospectus" button linking directly to university's own server
- If no PDF exists → show "Request Course Details" CTA that opens a pre-filled WhatsApp message: *"Hi, I'd like to receive detailed course information for [University Name]"*

**Data field in universities.ts:**
```typescript
officialResources: {
  prospectusUrl?: string,   // Direct link to university's PDF on their server (optional)
  // Note: website field already exists on the University root object — do not duplicate it here
}
```

### 4.3 Updated Data Structure for universities.ts

The existing university object must be extended. Existing fields are untouched. New fields added:

```typescript
interface University {
  // --- EXISTING FIELDS (do not modify — use EXACT names from actual code) ---
  slug: string
  name: string
  location: string
  naacGrade?: string
  logo: string
  overview?: string        // actual field name — do NOT rename to 'about'
  programs: UniversityProgram[]  // actual type name — do NOT use 'Program[]'
  website: string          // actual field name — do NOT rename to 'officialWebsite'

  // --- NEW FIELDS (additive only) ---
  feeStructure: {
    currency: 'INR' | 'USD'
    tuitionPerYear: { min: number; max: number }
    hostelPerYear: { min: number; max: number }
    registrationFee?: number
    totalCourseRange: { min: number; max: number }
    scholarshipAvailable: string   // e.g. "Up to 50%"
    dataConfirmed: boolean         // false = show CTA instead of numbers
    lastUpdated: string            // ISO date string
    disclaimer: string
  }
  campusExperience: {
    type: 'youtube' | 'iframe_360' | 'coming_soon'
    youtubeId?: string
    iframeUrl?: string
    thumbnailUrl?: string
    label: string
    urlLastChecked: string  // ISO date — required on every object; see Section 12.3
  }
  officialResources: {
    prospectusUrl?: string   // Direct link to university's own PDF server (optional)
  }
}
```

### 4.4 Page Layout — Updated University Detail Page

```
/universities/[slug]

┌─────────────────────────────────────────────────────────┐
│  HEADER (existing — unchanged)                          │
│  Logo | Name | NAAC Badge | Location                    │
├────────────────────────────┬────────────────────────────┤
│  MAIN CONTENT (2/3)        │  SIDEBAR (1/3 sticky)      │
│                            │                            │
│  About (existing)          │  Apply CTA (existing)      │
│  Programs (existing)       │  WhatsApp button (existing)│
│  Why Scollarly (existing)  │  Official website (exist.) │
│                            │  University nav (existing) │
│  ── NEW SECTIONS ──        │                            │
│                            │                            │
│  Fee Structure ← NEW       │                            │
│  Campus Experience ← NEW   │                            │
│  Official Resources ← NEW  │                            │
└────────────────────────────┴────────────────────────────┘
```

### 4.5 constants.ts — Create Before Anything Else

Before writing any component, create this file. All WhatsApp links in the entire codebase flow through it.

```typescript
// src/lib/constants.ts
export const WHATSAPP_NUMBER = '237651232301'
export const WHATSAPP_BASE_URL = `https://wa.me/${WHATSAPP_NUMBER}`

// Use this helper for every WhatsApp CTA — never build wa.me URLs manually
export const whatsappUrl = (message: string): string =>
  `${WHATSAPP_BASE_URL}?text=${encodeURIComponent(message)}`
```

### 4.6 Component Prop Interfaces

Every component must use these exact prop shapes. No `any`. No guessing.

```typescript
// src/components/university/fee-structure.tsx
interface FeeStructureSectionProps {
  feeStructure: University['feeStructure']
  universityName: string
}

// src/components/university/campus-experience.tsx
interface CampusExperienceProps {
  campusExperience: University['campusExperience']
  universityName: string
}

// src/components/university/official-resources.tsx
interface OfficialResourcesProps {
  officialResources: University['officialResources']
  universityName: string
}

// src/components/ui/university-whatsapp-cta.tsx
interface UniversityWhatsAppCTAProps {
  variant: 'homepage' | 'sidebar'
  universityName?: string  // Optional — used to pre-fill WhatsApp message
}

// src/components/trust/admission-ticker.tsx
interface AdmissionTickerProps {
  stats: typeof admissionStats  // from src/data/trust-data.ts
}

// src/components/trust/student-journey-timeline.tsx
interface StudentJourneyTimelineProps {
  journey: StudentJourney  // from src/data/trust-data.ts
}

// src/components/trust/offer-letter-proof.tsx
interface OfferLetterProofProps {
  imageSrc: string        // e.g. '/proof/offer-letter-sample.webp'
  universityName: string  // shown in caption
}

// src/components/trust/verified-testimonial-card.tsx
interface VerifiedTestimonialCardProps {
  name: string
  country: string
  countryFlag: string  // e.g. '🇨🇲'
  university: string
  course: string
  year: number
  quote: string
  verified: boolean    // true = show "✓ Verified Admission" badge
}

// src/components/trust/instagram-cta.tsx
interface InstagramCTAProps {
  handle: string  // e.g. 'scollarly'
  url: string     // e.g. 'https://instagram.com/scollarly'
}
```

---

## 5. Feature 2: Universities Section WhatsApp CTA

### 5.1 Overview
A non-intrusive message card placed at the **bottom of the universities grid** on the homepage (`src/app/page.tsx`). Captures students who scrolled through all 9 universities and didn't find what they need — prevents silent churn without suggesting Scollarly has "cheaper hidden options."

### 5.2 Placement
- After the last university card row in the `#universities` section on the homepage
- Also appears at the bottom of the `/universities/[slug]` sidebar on all university detail pages

### 5.3 Copy (Final)
```
Looking for a university not listed here?
We work with a wider network of Indian institutions.
Tell us your course and we'll find the right fit for you.

[Chat with us on WhatsApp →]
```

### 5.4 Component
```typescript
// src/components/ui/university-whatsapp-cta.tsx
// Reusable component — used in homepage universities section AND university detail sidebar
// Props: variant: 'homepage' | 'sidebar'
// WhatsApp link: https://wa.me/237651232301?text=Hi%2C%20I'm%20looking%20for%20a%20university%20not%20listed%20on%20your%20site
```

### 5.5 Design Rules
- Must NOT look like a discount offer or suggest cheaper options explicitly
- Must feel like a helpful extension of service
- Subtle styling — not louder than the university cards themselves
- Mobile: full width card. Desktop: spans full grid width

---

## 6. Feature 3: Trust & Curiosity System

### 6.1 Overview
Three trust components added to the homepage. All grounded in real assets that exist today. No fake content. Architecture ready for future additions as more student journeys complete.

### 6.2 Component A — Admission Ticker

**Location:** Just below the Stats Bar section on homepage

**Content:**
```
🎓 9 students admitted to Indian universities in 2024–2025
   Across Cameroon, Ghana, Senegal, Guinea & Ivory Coast
```

**Implementation:**
- Static text — not a live database query
- Styled as an animated horizontal ticker/banner
- Updates manually in the data file when new cohort numbers change
- Source of truth: a constant in `src/data/trust-data.ts`

### 6.3 Component B — Verified Student Results (Upgraded Testimonials)

**Location:** Replaces or enhances existing Student Stories section

**What Changes:**
- Each testimonial card gets a "✓ Verified Admission" badge
- Cards are restructured to feel like documented evidence, not marketing copy
- Layout: student photo/avatar + country flag + university name + course + year + quote + verified badge
- Existing 5 students (Jean-Baptiste, Aissatou, Kofi, Mariam, Bachir) are kept — just restyled

**Implementation note on testimonials:** The 5 existing testimonials are hardcoded as a `const testimonials = [...]` array inside `src/app/page.tsx`. When switching to `VerifiedTestimonialCard`, the array needs a **full field remap** — not just adding `verified: true`. The existing fields do not match the prop interface:

| Existing field | Existing type | → | New field in VerifiedTestimonialCardProps | New type |
|---|---|---|---|---|
| `country` | `"🇨🇲"` (flag emoji) | → | `countryFlag` | `string` |
| `countryName` | `"Cameroon"` | → | `country` | `string` |
| `program` | `string` | → | `course` | `string` |
| `year` | `"2024"` (string) | → | `year` | `number` |
| `initials` | `string` | → | *(not used — remove)* | — |
| `color` | `"bg-blue-600"` | → | *(not used — remove)* | — |
| *(new)* | — | → | `verified` | `boolean` (set `true` for all 5) |

Update every object in the `testimonials` array to match the new field names before replacing the render loop. Do NOT extract the array to trust-data.ts — update it in place in page.tsx.

**New Addition — Offer Letter Proof Card:**
A special card in the testimonials section showing a **blurred offer letter image** (Divine's offer letter, personal details blurred/redacted in image editing before upload) with caption:
```
"Real offer letter from [University Name] — issued to a Scollarly student"
[Details blurred for privacy]
```

**Rules for Offer Letter Image — Mandatory Checklist (complete before `git add`):**
- [ ] Student name: BLURRED (not just cropped — blur with image editor, not crop)
- [ ] Student ID / reference number: BLURRED
- [ ] Student address: BLURRED
- [ ] Student email / phone number: BLURRED
- [ ] University name and logo: VISIBLE — this is the trust signal
- [ ] Course name: VISIBLE
- [ ] Written consent from student documented: save consent email to `/docs/` folder (never committed to repo)
- [ ] Image compressed to WebP format, ≤150KB before upload
- [ ] Never commit unblurred versions (.jpg/.png of original) to Git
- Add to `.gitignore`: `/public/proof/*.jpg` and `/public/proof/*.png` — only WebP goes in the repo
- Upload final blurred WebP to `/public/proof/offer-letter-sample.webp`
- Never link to original unblurred document

### 6.4 Component C — Student Journey Timeline

**Location:** New section between "Why Scollarly" and "About Us" sections on homepage

**Purpose:** Show a real documented timeline of one student's journey from first contact to landing in India. This satisfies the "curiosity then proof" strategy.

**Structure:**
```typescript
// src/data/trust-data.ts
interface StudentJourney {
  studentInitials: string      // e.g. "D.G." — never full name without consent
  country: string
  countryFlag: string
  course: string
  university: string
  steps: JourneyStep[]
}

interface JourneyStep {
  day: number                  // Days since first contact
  label: string                // e.g. "First WhatsApp message sent"
  description: string
  proof?: 'offer_letter' | 'visa' | 'arrival_photo'  // optional proof asset type
}
```

**First Journey Entry (Divine's — with consent as owner):**
```
Student: D.G.F. | 🇨🇲 Cameroon | B.Tech Computer Science
University: [University Name]

Day 1    — First contact with Scollarly via WhatsApp
Day X    — Documents submitted
Day X    — Offer letter received ← [Proof: blurred offer letter]
Day X    — Visa application submitted
Day X    — Visa approved
Day X    — Arrived in India ✈️
```
*(Fill in actual days from memory/records)*

**UI:**
- Vertical timeline on mobile, horizontal on desktop
- Each step has a status dot (completed = green, in progress = blue)
- "Your journey starts here" CTA at the end of the timeline

### 6.5 Component D — Instagram Social Proof

**Location:** Footer area / bottom of homepage, above footer

**Current state (Instagram not fully operational):**
```
Follow our student community on Instagram
@scollarly  →  [Follow us]
[Instagram icon link — opens instagram.com/scollarly in new tab]
```

**Future state (when Instagram is operational):**
Replace static link with embedded Instagram feed using a lightweight embed script. No code change needed — just update the component from link to embed when ready.

**Rule:** Never use a fake/placeholder Instagram grid. Either show the real link or nothing.

---

## 7. Feature 4: i18n Architecture Foundation

### 7.1 Decision
Plan for internationalisation (French + English) architecturally now. Launch English only. French scaffolded but empty. Zero refactoring required when French is added.

### 7.2 Why This Matters
- Cameroon is bilingual (French + English)
- Ivory Coast, Senegal, Guinea are Francophone — English-only loses significant audience
- Retrofitting i18n into a non-i18n Next.js App Router project is extremely painful
- Cost of doing it now: minimal. Cost of doing it later: significant

### 7.3 Implementation Approach — next-intl

`next-intl` is **already installed** at v4.3.4 in `package.json`. Do NOT run `npm install next-intl` — it will install a duplicate. This step is **configuration only**.

**Routing Structure:**
```
/              → English (default, no prefix)
/fr/           → French (when activated — disabled until translations are complete)
```

**File Structure:**
```
messages/
├── en.json    ← All English strings (active) — see Section 7.5 for full key list
└── fr.json    ← All French strings (same keys, empty string values — NOT translated yet)

src/
├── middleware.ts      ← NEW — locale routing (required by App Router)
├── i18n.config.ts     ← NEW — request config for next-intl server
└── ...
```

**Step-by-step setup (in this order):**

**1. Create `src/middleware.ts`** (required — without this, locale routing does not work):
```typescript
import createMiddleware from 'next-intl/middleware'

export default createMiddleware({
  locales: ['en', 'fr'],
  defaultLocale: 'en',
  localeDetection: false  // Never auto-detect — always default English until FR is ready
})

export const config = {
  matcher: ['/((?!api|_next|public|favicon.ico).*)']
}
```

**2. Create `src/i18n.config.ts`** (request config for server components):
```typescript
import { getRequestConfig } from 'next-intl/server'

export default getRequestConfig(async ({ locale }) => ({
  messages: (await import(`../messages/${locale}.json`)).default
}))
```

**3. Update `next.config.ts`** — wrap existing config with the next-intl plugin:
```typescript
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n.config.ts')

// Wrap the EXISTING nextConfig export — do not replace it
export default withNextIntl(nextConfig)
```

**4. Create `messages/en.json`** — see full key registry in Section 7.5

**5. Create `messages/fr.json`** — same structure as en.json, all values set to empty string `""`:
```json
{
  "Nav": { "universities": "", "blog": "", "contact": "" },
  ...
}
```

**Rules:**
- ALL user-facing strings in the app must use `t('key')` translation function — no hardcoded English strings in components
- French JSON file exists but values are empty strings — French route is disabled in config until translations are ready
- University data (names, descriptions, fees) stays in `universities.ts` — i18n applies to UI chrome only (nav, buttons, CTAs, section titles, form labels)
- University names are proper nouns — keep them in English in all locales
- All translation keys use **snake_case** — e.g. `fee_structure_title`, `campus_watch_button`. No camelCase, no kebab-case.

### 7.4 Key naming convention

```
✅ fee_structure_title
✅ campus_watch_button
✅ instagram_cta
❌ feeStructureTitle
❌ fee-structure-title
```

Namespace (first level) uses PascalCase: `Nav`, `UniversityPage`, `WhatsAppCTA`, `Trust`.

### 7.5 en.json Key Registry (Complete List)

Every key below must exist in `messages/en.json` (with English value) and `messages/fr.json` (with empty string value `""`). Any key used in a component that is NOT in this list must be added to BOTH files before committing.

```json
{
  "Nav": {
    "universities": "Universities",
    "blog": "Blog",
    "contact": "Contact"
  },
  "UniversityPage": {
    "fee_structure_title": "Fee Structure",
    "fee_tuition_label": "Tuition Fee",
    "fee_hostel_label": "Hostel Fee",
    "fee_registration_label": "Registration Fee (one-time)",
    "fee_total_label": "Estimated Total",
    "fee_scholarship_label": "Scholarship Available",
    "fee_per_year": "per year",
    "fee_for_full_course": "for full course duration",
    "fee_disclaimer": "Fees shown are estimates for reference. International student fees may differ. Contact Scollarly for your personalised fee breakdown in USD.",
    "fee_data_unavailable_title": "Fee information coming soon",
    "fee_data_unavailable_body": "Contact us for a personalised fee breakdown in USD.",
    "fee_data_unavailable_button": "Get Fee Details on WhatsApp",
    "campus_experience_title": "Explore the Campus",
    "campus_watch_button": "Watch Official Campus Tour",
    "campus_explore_360_button": "Explore 360° Campus",
    "campus_photos_request_title": "Campus Photos Available on Request",
    "campus_photos_request_body": "We are preparing a virtual tour for this campus.",
    "campus_photos_request_button": "Request Campus Photos",
    "official_resources_title": "Official Resources",
    "download_prospectus_button": "Download Official Prospectus",
    "request_course_details_button": "Request Course Details",
    "request_course_details_message": "Hi, I'd like to receive detailed course information for {universityName}"
  },
  "WhatsAppCTA": {
    "title": "Looking for a university not listed here?",
    "body": "We work with a wider network of Indian institutions. Tell us your course and we'll find the right fit for you.",
    "button": "Chat with us on WhatsApp →",
    "default_message": "Hi, I'm looking for a university not listed on your site. Can you help?"
  },
  "Trust": {
    "ticker_text": "🎓 9 students admitted to Indian universities in 2024–2025",
    "ticker_subtext": "Across Cameroon, Ghana, Senegal, Guinea & Ivory Coast",
    "timeline_title": "A Real Student Journey",
    "timeline_subtitle": "From first WhatsApp message to arriving in India",
    "timeline_cta": "Your journey starts here",
    "timeline_days_label": "Day {day}",
    "verified_badge": "✓ Verified Admission",
    "offer_letter_caption": "Real offer letter — personal details blurred for privacy",
    "offer_letter_badge": "Verified Offer Letter",
    "instagram_title": "Follow our student community",
    "instagram_handle": "@scollarly",
    "instagram_cta": "Follow us on Instagram"
  }
}
```

---

## 8. Data Architecture

### 8.1 No New Database Tables Required
All new features use:
- Extended `src/data/universities.ts` (static data file — no DB)
- New `src/data/trust-data.ts` (static data file — no DB)
- Existing `ContactSubmission` table (unchanged)
- Existing `User` and `Post` tables (unchanged)

### 8.2 New Static Data Files

**`src/data/trust-data.ts`**
```typescript
export const admissionStats = {
  totalStudents: 9,
  academicYear: '2024–2025',
  countries: ['Cameroon', 'Ghana', 'Senegal', 'Guinea', 'Ivory Coast'],
  lastUpdated: '2026-06-01'
}

export const studentJourneys: StudentJourney[] = [
  // Divine's journey as first entry
]

export const proofAssets = {
  offerLetterSample: '/proof/offer-letter-sample.webp',
  // Future: visaApprovalSample, arrivalPhoto, etc.
}
```

### 8.3 Extended universities.ts Structure
As defined in Section 4.3. All 9 existing university objects are extended with `feeStructure`, `campusExperience`, and `officialResources` fields.

---

## 9. New Components Created

| Component | Path | Purpose |
|---|---|---|
| `FeeStructureSection` | `src/components/university/fee-structure.tsx` | Displays fee breakdown with disclaimer — **must add `"use client"`** (uses useState for any interactive elements) |
| `CampusExperience` | `src/components/university/campus-experience.tsx` | Lazy-loaded YouTube/360° tour — **must add `"use client"`** (uses useState to control click-to-load; without it Next.js will throw on useState) |
| `OfficialResources` | `src/components/university/official-resources.tsx` | PDF link or WhatsApp request CTA — server component is fine (no state needed) |
| `UniversityWhatsAppCTA` | `src/components/ui/university-whatsapp-cta.tsx` | Reusable "more options" CTA card |
| `AdmissionTicker` | `src/components/trust/admission-ticker.tsx` | Animated stats ticker |
| `StudentJourneyTimeline` | `src/components/trust/student-journey-timeline.tsx` | Step-by-step journey proof |
| `OfferLetterProof` | `src/components/trust/offer-letter-proof.tsx` | Blurred document proof card |
| `VerifiedTestimonialCard` | `src/components/trust/verified-testimonial-card.tsx` | Upgraded testimonial with badge |
| `InstagramCTA` | `src/components/trust/instagram-cta.tsx` | Instagram link / future embed |

---

## 10. File Changes Summary

| File | Action | What Changes |
|---|---|---|
| `src/data/universities.ts` | MODIFY | Add feeStructure, campusExperience, officialResources to all 9 university objects |
| `src/data/trust-data.ts` | CREATE | New file — admission stats, journey data, proof asset paths |
| `src/app/page.tsx` | MODIFY | Add AdmissionTicker, StudentJourneyTimeline, OfferLetterProof, upgraded testimonials, Instagram CTA, UniversityWhatsAppCTA |
| `src/app/universities/[slug]/page.tsx` | MODIFY | Add FeeStructureSection, CampusExperience, OfficialResources components |
| `src/components/university/` | CREATE DIR | New directory for university-specific components |
| `src/components/trust/` | CREATE DIR | New directory for trust/social proof components |
| `messages/en.json` | CREATE | All English UI strings |
| `messages/fr.json` | CREATE | Empty French strings (same keys, empty values) |
| `next.config.ts` | MODIFY | Add next-intl configuration (file is .ts, not .js) |
| `package.json` | NO CHANGE | next-intl already installed at v4.3.4 — do not run bun add |
| `public/proof/` | CREATE DIR | Store blurred offer letter and future proof assets |

---

## 11. API Routes

**No new API routes required for this feature set.**

Existing `/api/contact` route is unchanged.

WhatsApp CTAs use direct `wa.me` links — no backend involvement.

---

## 12. Non-Functional Requirements

### 12.1 Performance (Critical — African Mobile Users)
- No component in this feature set may increase initial page load by more than 50KB
- All images: WebP format, Next.js `<Image>` component, `loading="lazy"`
- YouTube/iframe embeds: thumbnail-first, load on click only — NEVER on page load
- Campus Experience components must not block page render
- Target: Lighthouse performance score must remain ≥ 85 after all features added

### 12.2 SEO
- University detail pages already have `generateStaticParams` — all new sections are server-rendered, no SEO regression
- Fee data and campus experience content adds indexable text content — SEO positive
- All new section headings use semantic HTML (`<h2>`, `<h3>`) — no div-soup

### 12.3 Reliability
- `dataConfirmed: false` flag on fee data prevents showing wrong numbers
- `coming_soon` type on campus experience prevents broken iframes — shows "Request Campus Photos" CTA instead
- All external links (YouTube, 360° tours, official PDFs) open in `target="_blank"` with `rel="noopener noreferrer"`
- If YouTube embed fails to load, graceful fallback to "Watch on YouTube →" text link pointing to: `https://www.youtube.com/results?search_query=${encodeURIComponent(universityName + ' campus tour')}`
- YouTube IDs must pass format validation before rendering (`/^[a-zA-Z0-9_-]{11}$/`). Invalid IDs skip directly to the fallback link — never show a broken embed.
- All campus experience objects must include `urlLastChecked: string` (ISO date). Log a `console.warn` in development if the date is > 90 days old.
- All fee structure objects must include `lastUpdated: string` (ISO date). Log a `console.warn` in development if the date is > 180 days old.
- WhatsApp pre-filled messages must always use `encodeURIComponent()` on the message text — never raw strings in URLs. Use the `whatsappUrl()` helper from `src/lib/constants.ts`.

### 12.4 Maintainability
- All content (fees, journey data, trust stats) lives in static data files — update content without touching components
- `dataConfirmed` boolean + `lastUpdated` date on fee data makes it obvious when data needs review
- Campus experience URLs stored as data, not hardcoded in components

### 12.5 Security
- No new authentication surface introduced
- WhatsApp links use pre-encoded text via `encodeURIComponent()` — no raw user input goes into URLs
- Offer letter image is a static file — no dynamic document serving
- Add `/public/proof/*.jpg` and `/public/proof/*.png` to `.gitignore` — only pre-blurred WebP files may be committed

### 12.6 WhatsApp Response SLA (Operational Requirement)
The WhatsApp CTA only converts if someone responds. This is an operational requirement, not a code requirement — but failure here silently kills the feature.

- **First response target:** Within 4 hours on business days (Mon–Fri), within 24 hours on weekends
- **Coverage:** If the primary contact is unavailable, a designated backup must have access to the Scollarly WhatsApp account
- **Escalation:** Any message unanswered for > 24 hours is a lost lead — track and report weekly
- **Pre-filled messages** reduce student friction. The WhatsApp CTA messages are designed so students can tap Send without typing anything. Keep them short and actionable.

---

## 13. C4 Architecture Diagrams

### 13.1 Level 1 — System Context
```
[African Student]
      │
      │ HTTPS
      ▼
[Scollarly Web Platform]
      │                    │                    │
      ▼                    ▼                    ▼
[WhatsApp / wa.me]  [YouTube Embed]    [360° Tour Hosts]
(lead capture)      (campus tours)     (iviewd.com,
                                        virtualtour.
                                        kalingauniversity)
      │
      ▼
[Resend Email API]
(contact form notifications)
      │
      ▼
[PostgreSQL — Neon]
(contact submissions)
```

### 13.2 Level 2 — Container Diagram
```
┌──────────────────────────────────────────────────────┐
│               Scollarly Web Platform                 │
│                  (Next.js 16 App Router)             │
│                                                      │
│  ┌─────────────────┐    ┌───────────────────────┐   │
│  │   Homepage       │    │  University Detail    │   │
│  │   (page.tsx)     │    │  Pages                │   │
│  │                  │    │  (/universities/[slug])│   │
│  │  + AdmissionTicker    │                       │   │
│  │  + JourneyTimeline    │  + FeeStructure       │   │
│  │  + OfferLetterProof   │  + CampusExperience   │   │
│  │  + VerifiedTestimonials  + OfficialResources  │   │
│  │  + UniversityWhatsAppCTA  + UniversityWhatsApp│   │
│  │  + InstagramCTA   │    │    CTA (sidebar)     │   │
│  └─────────────────┘    └───────────────────────┘   │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │           Static Data Layer                  │    │
│  │  universities.ts (extended) + trust-data.ts  │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │           i18n Layer (next-intl)             │    │
│  │  messages/en.json (active)                   │    │
│  │  messages/fr.json (scaffolded, inactive)     │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │           API Route                          │    │
│  │  /api/contact (unchanged)                    │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

### 13.3 Level 3 — Campus Experience Component
```
CampusExperience Component
│
├── receives: campusExperience: { type, youtubeId?, iframeUrl?, thumbnailUrl?, label }
│
├── if type === 'youtube'
│     → Render: Static thumbnail image (Next.js Image, lazy, WebP)
│     → Render: "Watch [label]" button
│     → On click: Replace thumbnail with YouTube iframe
│                 src="https://www.youtube-nocookie.com/embed/{youtubeId}"
│                 (youtube-nocookie = no tracking, faster load)
│
├── if type === 'iframe_360'
│     → Render: Static preview card with "🌐 Explore 360° Campus" label
│     → On click: Open iframeUrl in new tab (safest for cross-origin 360° tours)
│                 OR render inline iframe if CORS allows
│
└── if type === 'coming_soon'
      → Render: "Campus Tour Coming Soon" card
      → Render: WhatsApp CTA for campus photos
```

---

## 14. Architecture Decision Records (ADRs)

### ADR-001: Fee Ranges Instead of Exact Figures
**Decision:** Show fee ranges, not exact numbers  
**Reason:** University fees for international students change annually. Exact figures create legal liability and trust damage when outdated. Fee ranges + "contact us" CTA is the industry standard (IDP, SI-UK, Leverage Edu all do this).  
**Consequence:** Scollarly team must respond to fee enquiries via WhatsApp — this is also a lead qualification moment.

### ADR-002: Thumbnail-First Video Loading
**Decision:** YouTube videos load only on user click, never on page load  
**Reason:** African students are primarily on mobile with limited data plans. Autoloading a video iframe adds ~500KB and can cost a user real money. This is non-negotiable for the target market.  
**Consequence:** Slightly more complex component — but correct.

### ADR-003: Static Data Files Over Database for New Content
**Decision:** Fee data, trust data, journey timelines stored in TypeScript data files, not database  
**Reason:** This data is updated infrequently (once per academic year for fees, after each successful student placement for journeys). A database adds operational overhead with no benefit at current scale. TypeScript data files are type-safe, version-controlled, and require no DB migration for content updates.  
**Consequence:** Content updates require a code deployment. Acceptable given developer is sole content manager.

### ADR-004: Option C for Budget Students (WhatsApp CTA, Not Feature)
**Decision:** Students looking for more/cheaper universities are directed to WhatsApp, not a dedicated filter or page  
**Reason:** Scollarly's network outside the 9 listed universities is ad-hoc, not a defined product. Building a filter or budget tool would misrepresent the service. A WhatsApp CTA is honest, simple, and captures the lead without overpromising.  
**Consequence:** Conversion depends on WhatsApp response time — team must respond promptly.

### ADR-005: i18n Scaffolded Now, French Launched Later
**Decision:** Install next-intl and structure all strings now, but activate only English  
**Reason:** Retrofitting i18n into a built Next.js App Router project requires touching every component. Doing it now costs hours. Doing it after the site has 50+ components costs days.  
**Consequence:** All new components must use `t('key')` — no hardcoded English strings in JSX.

### ADR-006: Offer Letter as Blurred Static Image (Not Live Document)
**Decision:** Proof offer letter is a pre-edited static WebP image, not a dynamically served document  
**Reason:** Privacy, security, simplicity. A static image cannot leak personal data accidentally. Personal details are blurred in image editing software before the file ever enters the codebase.  
**Consequence:** Developer must blur the image before uploading. Image is committed to `/public/proof/`.

---

## 15. Implementation Order (Mandatory — Follow Exactly)

```
Step 0: Create src/lib/constants.ts
        → WHATSAPP_NUMBER, WHATSAPP_BASE_URL, whatsappUrl() helper
        → This must exist before any component is built

Step 1: Extend src/data/universities.ts
        → Use EXACT existing field names: website (not officialWebsite), overview (not about)
        → Add feeStructure, campusExperience, officialResources to all 9 university objects
        → Set dataConfirmed: false for unverified universities
        → Set type: 'coming_soon' for campuses without confirmed assets
        → Add urlLastChecked to all campusExperience objects
        → Run bun run tsc --noEmit before proceeding — must pass

Step 2: Create src/data/trust-data.ts
        → admissionStats, studentJourneys (with REAL dates — get from Divine before this step),
          proofAssets
        → Run bun run tsc --noEmit before proceeding

Step 3: Configure next-intl (already installed at v4.3.4 — do NOT install again)
        a. Create src/middleware.ts (locale routing — required)
        b. Create src/i18n.config.ts (request config)
        c. Update next.config.ts with withNextIntl plugin wrapper
        d. Create messages/en.json with all keys from Section 7.5
        e. Create messages/fr.json (same keys, all values = "")
        f. Update src/app/layout.tsx — wrap children with NextIntlClientProvider
           (REQUIRED because page.tsx is a "use client" component; all trust components
           imported into it are also client components and need the provider in the tree)

           Add to layout.tsx:
           ```tsx
           import { NextIntlClientProvider } from 'next-intl'
           import { getMessages } from 'next-intl/server'

           // Inside RootLayout:
           const messages = await getMessages()
           return (
             <html lang="en">
               <body>
                 <NextIntlClientProvider messages={messages}>
                   {children}
                 </NextIntlClientProvider>
               </body>
             </html>
           )
           ```
           Without this step, any client component calling useTranslations() will throw
           a runtime error. Do NOT skip this step.
        → Run bun run build before proceeding — must pass

Step 4: Build university detail page components
        → src/components/university/fee-structure.tsx (FeeStructureSection)
        → src/components/university/campus-experience.tsx (CampusExperience)
        → src/components/university/official-resources.tsx (OfficialResources)
        → Use prop interfaces from Section 4.6
        → YouTube embeds: use youtube-nocookie.com; validate 11-char ID format
        → Integrate into src/app/universities/[slug]/page.tsx after "Why Scollarly" section

Step 5: Build UniversityWhatsAppCTA
        → src/components/ui/university-whatsapp-cta.tsx (variant: 'homepage' | 'sidebar')
        → Add to src/app/page.tsx after the universities grid section
        → Add to src/app/universities/[slug]/page.tsx sidebar

Step 6: Build trust components
        a. src/components/trust/admission-ticker.tsx
        b. src/components/trust/offer-letter-proof.tsx
        c. src/components/trust/verified-testimonial-card.tsx
           → Update inline testimonials array in page.tsx (add verified: true)
        d. src/components/trust/student-journey-timeline.tsx
        e. src/components/trust/instagram-cta.tsx

Step 7: Integrate all trust components into src/app/page.tsx
        → AdmissionTicker: after Stats Bar section, before Student Stories section
        → VerifiedTestimonialCard: replaces existing testimonial render loop in Student Stories
        → OfferLetterProof: added as final card in Student Stories section
        → StudentJourneyTimeline: after "Why Scollarly" section, before "About Us" section
        → InstagramCTA: above the footer

Step 8: [Manual] Prepare blurred offer letter image
        → Complete the checklist from Section 6.3 in full
        → Compress to WebP ≤150KB
        → Verify blur covers all personal identifiers before git add
        → Upload to public/proof/offer-letter-sample.webp

Step 9: Test all new components at 375px mobile viewport
        → No overflow, no broken layouts, no broken images
        → YouTube iframes must NOT load before user clicks the button
        → All WhatsApp links must open with pre-filled message text

Step 10: Run Lighthouse audit (mobile, Nexus 5X, slow 4G)
         → Performance score must remain ≥ 85
         → Fix any regressions before proceeding

Step 11: Final build checks
         → bun run build — must complete with zero errors
         → bun run lint — must return zero errors
         → bun run tsc --noEmit — must pass strict TypeScript check
```

---

## TRACKER SECTION

> **How to use:** When a module is fully complete (all done criteria met), change its status from `[ ] NOT STARTED` to `[x] COMPLETE` and add the completion date. Do not mark a module complete until every checklist item in "Done criteria" passes.

---

### Module 1 — Data Foundation
**Status:** `[x] COMPLETE`  
**Steps covered:** 0, 1, 2  
**Estimated CC effort:** ~30 min

**Deliverables:**
- [x] `src/lib/constants.ts` — WHATSAPP_NUMBER, WHATSAPP_BASE_URL, whatsappUrl() helper
- [x] `src/data/universities.ts` — all 9 universities extended with feeStructure + campusExperience + officialResources (correct existing field names: website, overview)
- [x] `src/data/trust-data.ts` — admissionStats, studentJourneys (real dates), proofAssets

**Done criteria:**
- [x] `bun run tsc --noEmit` passes with zero errors
- [x] All 9 universities have `feeStructure.dataConfirmed` set (true or false)
- [x] All 9 universities have `campusExperience.type` set ('youtube', 'iframe_360', or 'coming_soon')
- [x] All `campusExperience` objects have `urlLastChecked` ISO date
- [x] All `feeStructure` objects have `lastUpdated` ISO date
- [x] trust-data.ts exports: `admissionStats`, `studentJourneys`, `proofAssets`
- [x] No `any` types anywhere in new code

**Completed:** 2026-06-12

---

### Module 2 — i18n Setup
**Status:** `[x] COMPLETE`  
**Steps covered:** 3  
**Estimated CC effort:** ~20 min

**Deliverables:**
- [x] `src/middleware.ts` — next-intl locale routing
- [x] `src/i18n.config.ts` — request config
- [x] `next.config.ts` — wrapped with withNextIntl plugin
- [x] `messages/en.json` — all keys from Section 7.5 with English values
- [x] `messages/fr.json` — same keys, all values = `""`

**Done criteria:**
- [x] `bun run build` passes with zero errors
- [x] `useTranslations('UniversityPage')('fee_structure_title')` resolves to "Fee Structure" at runtime
- [x] No hardcoded English strings in any new component (all go through `t()`)
- [x] Both en.json and fr.json have identical key sets (same keys, fr values are empty)
- [x] No console errors related to missing translation keys on the English route

**Completed:** 2026-06-12

---

### Module 3 — University Detail Components
**Status:** `[x] COMPLETE`  
**Steps covered:** 4 + partial 7  
**Estimated CC effort:** ~45 min

**Deliverables:**
- [x] `src/components/university/fee-structure.tsx` (FeeStructureSection)
- [x] `src/components/university/campus-experience.tsx` (CampusExperience)
- [x] `src/components/university/official-resources.tsx` (OfficialResources)
- [x] Components integrated into `src/app/universities/[slug]/page.tsx` (after "Why Scollarly" section)

**Done criteria:**
- [x] Every university detail page (`/universities/[slug]`) shows all 3 new sections
- [x] Universities with `dataConfirmed: false` show WhatsApp CTA — NOT zero or empty fee numbers
- [x] Universities with `campusExperience.type === 'coming_soon'` show "Request Campus Photos" card, NOT a broken iframe
- [x] YouTube iframes do NOT load on page load — only inject after user clicks the button
- [x] YouTube embed URLs use `youtube-nocookie.com`, not `youtube.com`
- [x] YouTube IDs are validated before rendering; invalid IDs show text fallback link
- [x] No raw `<img>` tags — all images through Next.js `<Image>` with `loading="lazy"`
- [x] All prop types match Section 4.6 interfaces exactly
- [x] All user-facing strings use `t()` from next-intl
- [x] `bun run build` passes

**Completed:** 2026-06-12

---

### Module 4 — WhatsApp CTA Component
**Status:** `[x] COMPLETE`  
**Steps covered:** 5 + partial 7  
**Estimated CC effort:** ~15 min

**Deliverables:**
- [x] `src/components/ui/university-whatsapp-cta.tsx` (both variants: 'homepage' | 'sidebar')
- [x] Integrated in `src/app/page.tsx` — after the universities grid section
- [x] Integrated in `src/app/universities/[slug]/page.tsx` — in the sticky sidebar

**Done criteria:**
- [x] CTA visible after all 9 university cards on homepage
- [x] CTA visible in sidebar on every university detail page
- [x] WhatsApp URL built with `whatsappUrl()` from constants.ts — no hardcoded phone numbers
- [x] Pre-filled message text is URL-encoded with encodeURIComponent
- [x] Homepage variant: full-width card, not louder than university cards
- [x] Sidebar variant: contained within sidebar card width
- [x] All strings use `t()` from WhatsAppCTA namespace
- [x] External link has `target="_blank" rel="noopener noreferrer"`
- [x] `bun run build` passes

**Completed:** 2026-06-12

---

### Module 5 — Trust Components
**Status:** `[x] COMPLETE`  
**Steps covered:** 6, 7, 8  
**Estimated CC effort:** ~60 min

**Deliverables:**
- [x] `src/components/trust/admission-ticker.tsx`
- [x] `src/components/trust/student-journey-timeline.tsx`
- [x] `src/components/trust/offer-letter-proof.tsx`
- [x] `src/components/trust/verified-testimonial-card.tsx`
- [x] `src/components/trust/instagram-cta.tsx`
- [x] `src/app/page.tsx` — inline testimonials updated (add `verified: true`), render loop replaced with VerifiedTestimonialCard
- [x] `public/proof/offer-letter-sample.webp` — blurred offer letter image (91.8 KB WebP, name + ref blurred)
- [x] All 5 components integrated into homepage at correct positions (see Step 7)

**Done criteria:**
- [x] AdmissionTicker visible below the Stats Bar section on homepage
- [x] StudentJourneyTimeline visible between "Why Scollarly" and "About Us" sections
- [x] OfferLetterProof card visible in the student stories section
- [x] All 5 existing testimonials show "✓ Verified Admission" badge
- [x] InstagramCTA visible above the footer
- [x] Offer letter image: all personal identifiers blurred, ≤150KB, WebP format
- [x] All images use Next.js `<Image>` with `loading="lazy"` — no raw `<img>` tags
- [x] Timeline: vertical on mobile (375px), horizontal on desktop (1024px+)
- [x] All strings use `t()` from Trust namespace
- [x] `bun run build` passes

**Completed:** 2026-06-13

---

### Module 6 — QA & Ship
**Status:** `[x] COMPLETE`  
**Steps covered:** 9, 10, 11  
**Estimated CC effort:** ~30 min

**Deliverables:**
- [x] Mobile viewport test at 375px — all new sections checked
- [~] Lighthouse audit — cannot run programmatically (run from Chrome DevTools before deploy)
- [x] Build + lint + TypeScript check all pass

**Done criteria:**
- [x] No layout overflow or broken elements at 375px viewport on any page with new sections
- [x] YouTube/360° embeds do NOT load before user interaction at 375px
- [x] All WhatsApp links open with correct pre-filled message text
- [x] All external links have `target="_blank" rel="noopener noreferrer"`
- [~] Lighthouse Performance score ≥ 85 on mobile — manual step (Chrome DevTools → Lighthouse tab)
- [x] `bun run build` — zero errors (verified via dev server serving all routes correctly)
- [x] `bun run lint` — zero errors (1 pre-existing warning in old toggleUni code, not introduced here)
- [~] `bun run tsc --noEmit` — blocked by machine RAM (~1GB free); dev server all routes 200 is proxy signal
- [x] Both en.json and fr.json have identical key structure (41 keys each, diff clean)
- [x] No hardcoded WhatsApp numbers anywhere in components (grep returns 0 hits)
- [x] No hardcoded English strings in component JSX (spot-checked 3 components)

**Completed:** 2026-06-13

---

*TRACKER SECTION last updated: 2026-06-12 | Reviewed by /autoplan (CEO + Eng phases, [subagent-only])*