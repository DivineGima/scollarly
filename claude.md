# claude.md — Scollarly Coding Agent Guardrails
**Project:** Scollarly Feature Addition  
**Design Reference:** `design.md` (read this first — always)  
**Rule:** Every decision in this file traces back to `design.md`. If you are unsure about anything, re-read `design.md` before proceeding.

---

## 0. Read This First

You are implementing a feature addition to an existing, working Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + Prisma + PostgreSQL project called Scollarly.

**YOUR PRIME DIRECTIVE:**  
You are ADDING to what exists. You are NOT rebuilding, refactoring, or "improving" anything that already works. If a file exists and works, you touch it only to add the new fields or components defined in `design.md`. Nothing else.

**Before touching any file:**
1. Read `design.md` Section relevant to that file
2. Understand what already exists
3. Add only what is specified
4. Stop

---

## 1. Project Understanding

### What Exists (DO NOT TOUCH unless specified)
- `src/app/page.tsx` — main homepage (modify only to ADD new sections defined in design.md)
- `src/app/universities/[slug]/page.tsx` — university detail pages (modify only to ADD new sections)
- `src/data/universities.ts` — university data (modify only to ADD new fields to existing objects)
- `src/lib/db.ts`, `src/lib/email.ts`, `src/lib/blog.ts` — DO NOT TOUCH
- `prisma/schema.prisma` — DO NOT TOUCH (no new tables needed)
- `src/app/api/contact/` — DO NOT TOUCH
- All existing UI components in `src/components/ui/` — DO NOT TOUCH existing files

### What You Are Building
Exactly what is in `design.md` Sections 4–7. Nothing more.

---

## 2. Non-Negotiable Rules

### 2.1 Additive Only
```
✅ ALLOWED: Add new fields to existing TypeScript interfaces
✅ ALLOWED: Add new components to existing pages
✅ ALLOWED: Create new files in new directories
✅ ALLOWED: Add new dependencies specified in design.md
❌ FORBIDDEN: Refactor existing working code
❌ FORBIDDEN: Rename existing variables, functions, or files
❌ FORBIDDEN: Change existing API routes
❌ FORBIDDEN: Modify the Prisma schema
❌ FORBIDDEN: Change existing component logic
❌ FORBIDDEN: "Improve" code that wasn't asked to be changed
```

### 2.2 TypeScript Strictness
- All new code must be fully typed — no `any`, no `unknown` without a comment explaining why
- Extend existing interfaces additively — do not rewrite them
- New interfaces go in the same file as the data they describe, or in a dedicated `src/types/` file if shared across 3+ components

### 2.3 Performance — CRITICAL (African Mobile Users)
These rules are NON-NEGOTIABLE. Target users are on mobile in Africa with limited data:

```typescript
// ✅ CORRECT — thumbnail first, video on click
const [videoLoaded, setVideoLoaded] = useState(false)
return videoLoaded 
  ? <iframe src={`https://www.youtube-nocookie.com/embed/${youtubeId}`} />
  : <button onClick={() => setVideoLoaded(true)}><Image ... /></button>

// ❌ WRONG — never do this
<iframe src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1`} />
```

```tsx
// ✅ CORRECT — always lazy load images
<Image src={url} loading="lazy" alt={alt} />

// ❌ WRONG
<img src={url} />  // Never use raw img tags
```

- No YouTube or 360° iframe loads on page load — EVER
- No autoplay video — EVER
- All images through Next.js `<Image>` component — ALWAYS
- All new images must be WebP format

### 2.4 i18n Compliance — ALL New Components
Every new component you write must use `next-intl` for ALL user-facing strings:

```tsx
// ✅ CORRECT
import { useTranslations } from 'next-intl'
const t = useTranslations('UniversityPage')
return <h2>{t('feeStructureTitle')}</h2>

// ❌ WRONG — hardcoded English
return <h2>Fee Structure</h2>
```

Add every new string key to BOTH `messages/en.json` (with English value) AND `messages/fr.json` (with empty string value).

### 2.5 Data Integrity Rules for Fee Display
```typescript
// ✅ CORRECT — check dataConfirmed before rendering numbers
if (!university.feeStructure.dataConfirmed) {
  return <FeeDataUnavailable /> // Shows WhatsApp CTA
}
return <FeeBreakdown data={university.feeStructure} />

// ❌ WRONG — never show 0 or null as a fee
return <p>Fee: ₹{university.feeStructure.tuitionPerYear.min}</p> // Could show ₹0
```

### 2.6 No Hardcoded WhatsApp Numbers
```typescript
// ✅ CORRECT — use a constant
import { WHATSAPP_NUMBER } from '@/lib/constants'
const url = `https://wa.me/${WHATSAPP_NUMBER}`

// ❌ WRONG
const url = 'https://wa.me/237651232301'
```

Create `src/lib/constants.ts` if it doesn't exist:
```typescript
export const WHATSAPP_NUMBER = '237651232301'
export const WHATSAPP_BASE_URL = `https://wa.me/${WHATSAPP_NUMBER}`
```

### 2.7 External Links
```tsx
// ✅ CORRECT — always for external links
<a href={url} target="_blank" rel="noopener noreferrer">

// ❌ WRONG
<a href={url} target="_blank">
```

### 2.8 No Fake/Placeholder Content
```
❌ FORBIDDEN: Lorem ipsum text
❌ FORBIDDEN: Placeholder fee numbers (e.g. ₹0, ₹99999)
❌ FORBIDDEN: "Coming soon" content that looks like real content
❌ FORBIDDEN: Fake student testimonials
❌ FORBIDDEN: Unblurred personal documents
✅ CORRECT: If data doesn't exist, show the appropriate CTA or "Coming Soon" state defined in design.md
```

---

## 3. File Creation Rules

### 3.1 New Directories to Create
```
src/components/university/     ← University detail page components
src/components/trust/          ← Trust and social proof components
src/data/trust-data.ts         ← New data file (not a directory)
messages/                      ← i18n message files
public/proof/                  ← Proof assets (blurred offer letter etc.)
```

### 3.2 New Components — Exact File Names
Follow `design.md` Section 9 exactly:

| Component | File Path |
|---|---|
| FeeStructureSection | `src/components/university/fee-structure.tsx` |
| CampusExperience | `src/components/university/campus-experience.tsx` |
| OfficialResources | `src/components/university/official-resources.tsx` |
| UniversityWhatsAppCTA | `src/components/ui/university-whatsapp-cta.tsx` |
| AdmissionTicker | `src/components/trust/admission-ticker.tsx` |
| StudentJourneyTimeline | `src/components/trust/student-journey-timeline.tsx` |
| OfferLetterProof | `src/components/trust/offer-letter-proof.tsx` |
| VerifiedTestimonialCard | `src/components/trust/verified-testimonial-card.tsx` |
| InstagramCTA | `src/components/trust/instagram-cta.tsx` |

Do not create components with different names. Do not merge components. Do not split components further.

---

## 4. Data Rules

### 4.1 universities.ts Extension
When extending `universities.ts`:
- Add new fields AFTER all existing fields in each university object
- Do NOT reorder existing fields
- Do NOT rename existing fields
- Set `dataConfirmed: false` for any university where fee data is not verified
- Set `type: 'coming_soon'` for any university without a confirmed campus tour asset

### 4.2 Fee Data — What Goes In
Use ONLY the data confirmed in `design.md` Section 4.2 Fee Table. Do not invent fee numbers. If a university is not in that table, set `dataConfirmed: false`.

### 4.3 Campus Experience — What Goes In
Use ONLY the confirmed assets from `design.md` Section 4.2 Campus Experience Table:
- CU 360°: `https://www.iviewd.com/cu2/`
- CT University YouTube: `bHh1-efoe4w`
- Kalinga 360°: `https://virtualtour.kalingauniversity.ac.in/`
- Jain YouTube: `5ddvpNEqpec`
- Rayat-Bahra YouTube: `CB4w1yp1Z_I`
- All others: `type: 'coming_soon'`

---

## 5. Implementation Order — Follow Exactly

Follow the order in `design.md` Section 15. Do not skip steps. Do not reorder.

```
Step 1: Extend universities.ts with new TypeScript interface fields
Step 2: Create trust-data.ts
Step 3: Install next-intl, set up i18n config and message files
Step 4: Build university detail components (fee, campus, resources)
Step 5: Build UniversityWhatsAppCTA component
Step 6: Build trust components (ticker, timeline, proof, testimonials, instagram)
Step 7: Integrate all components into pages
Step 8: [Manual] Developer uploads blurred offer letter to /public/proof/
Step 9: Test all components at 375px mobile viewport
Step 10: Run Lighthouse — score must be ≥ 85
```

---

## 6. Styling Rules

### 6.1 Use Existing Design System
- Use ONLY Tailwind CSS utility classes — no custom CSS unless Tailwind cannot achieve the effect
- Follow the existing dark theme in the project — new components must match the existing aesthetic
- Use existing shadcn/ui components where applicable (Card, Badge, Button) — do not reinvent
- Use Framer Motion for animations — it is already installed

### 6.2 Responsive Rules
- Mobile-first — design at 375px, then scale up
- Test at: 375px, 768px, 1024px, 1280px
- The CampusExperience component must maintain aspect ratio on all screen sizes (use `aspect-video` Tailwind class)
- Timeline: vertical on mobile (`flex-col`), horizontal on desktop (`flex-row`)

### 6.3 Verified Badge
```tsx
// Use this exact implementation for the "Verified" badge
<Badge variant="outline" className="text-green-400 border-green-400 text-xs">
  ✓ Verified Admission
</Badge>
```

---

## 7. What You Must NOT Do

```
❌ Do not add an admin panel
❌ Do not activate NextAuth
❌ Do not add new database tables
❌ Do not add new API routes
❌ Do not build a budget filter or course matching tool
❌ Do not add a PDF download of scraped university data
❌ Do not autoplay any video or iframe
❌ Do not use raw <img> tags — always Next.js <Image>
❌ Do not hardcode strings in components (use t() from next-intl)
❌ Do not hardcode the WhatsApp number — use constants.ts
❌ Do not show unblurred personal documents
❌ Do not invent fee numbers — use only confirmed data or show CTA
❌ Do not refactor existing working code
❌ Do not change the Prisma schema
❌ Do not touch /api/contact
❌ Do not add external analytics beyond the existing GA4
❌ Do not embed a live Instagram feed (link only until page is operational)
```

---

## 8. Fullstack Engineering Standards

These apply to every line of code written in this project:

### 8.1 Understand Before Building
- Read the relevant section of `design.md` fully before writing any code for that feature
- Understand the data flow: where data comes from → how it is transformed → what the user sees
- Understand the failure state: what happens if data is missing or external resource fails

### 8.2 Data Model First
- Update `universities.ts` TypeScript interfaces before building components that consume them
- Components should never receive `any` typed data

### 8.3 Error Handling at Every Layer
```tsx
// ✅ Every external resource needs a fallback
<CampusExperience 
  data={university.campusExperience}
  fallback={<ComingSoonCard />}
/>

// ✅ Fee data needs a guard
{university.feeStructure.dataConfirmed 
  ? <FeeBreakdown /> 
  : <FeeContactCTA />
}
```

### 8.4 Idempotency on CTAs
WhatsApp CTA links must include pre-filled message text so the student doesn't need to type anything — reduces friction:
```typescript
const whatsappUrl = (message: string) => 
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`
```

### 8.5 Security on Public Assets
- `/public/proof/` files are publicly accessible — ONLY put pre-blurred images here
- Never put original unedited documents in the repository — ever

### 8.6 Observability
- The existing Google Analytics 4 integration is in `layout.tsx` — it will automatically track page views for new pages
- No additional analytics setup needed
- Do not add console.log statements in production code

### 8.7 Build Must Pass
Before considering any feature complete:
```bash
bun run build    # Must complete with zero errors
bun run lint     # Must return zero errors
```
TypeScript errors are blocking — fix them before moving on.

---

## 9. Definition of Done

A feature is complete when:
- [ ] All components in `design.md` Section 9 for that feature are built
- [ ] All data in `universities.ts` is extended correctly
- [ ] All strings use `t()` from next-intl
- [ ] No hardcoded WhatsApp numbers in components
- [ ] `dataConfirmed: false` universities show CTA, not empty data
- [ ] `coming_soon` campus experiences show Coming Soon card, not broken iframe
- [ ] YouTube/360° embeds do NOT load on page load
- [ ] All images use Next.js `<Image>` with `loading="lazy"`
- [ ] `bun run build` passes with zero errors
- [ ] `bun run lint` passes with zero errors
- [ ] Tested at 375px mobile viewport — no overflow, no broken layout
- [ ] All external links have `target="_blank" rel="noopener noreferrer"`
- [ ] English strings in `messages/en.json`, empty keys in `messages/fr.json`

---

## 10. When In Doubt

1. Re-read `design.md`
2. If still unclear — do the simpler thing
3. If the simpler thing conflicts with `design.md` — stop and ask
4. Never assume. Never invent requirements. Never add features not in `design.md`.