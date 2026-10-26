import type { SeedBundle } from "@/modules/seed/schema";
import { seedBundleSchema } from "@/modules/seed/schema";

/**
 * A synthetic seed bundle for tests: three made-up universities, so the tests can check counts and links. Nothing here
 * is real content from the old site (that arrives with the owner's data files, tracker H2).
 */
export function fixtureInput(): Record<string, unknown> {
  const university = (n: number) => ({
    slug: `test-university-${n}`,
    name: `Test University ${n}`,
    city: "Testville",
    state: "Testland",
    type: "Private",
    naac_grade: "A",
    website_url: `https://university-${n}.example.test`,
    logo: { file: `logos/university-${n}.png`, alt: `Test University ${n} logo` },
    status: "published",
    programmes: [
      { name: "Test Programme A", level: "Undergraduate", field: "Testing", duration_months: 36, status: "published" },
      { name: "Test Programme B", level: "Postgraduate", field: "Testing", duration_months: 24 },
    ],
    fees: [
      { programme: "Test Programme A", currency: "INR", amount_min: 100000, amount_max: 150000, period: "per year", data_confirmed: true, last_updated_at: "2026-09-01T00:00:00Z", status: "published" },
      { currency: "USD", period: "per year" },
    ],
    campus_experiences: [
      { kind: "video", title: "Campus tour", youtube_id: "dQw4w9WgXcQ", thumbnail: { file: "photos/shared-thumb.jpg" }, status: "published" },
      { kind: "gallery", title: "Gallery", url: `https://university-${n}.example.test/gallery` },
    ],
    resources: [{ title: "Prospectus", url: `https://university-${n}.example.test/prospectus.pdf`, kind: "prospectus" }],
  });
  return {
    universities: [university(1), university(2), university(3)],
    faqs: [
      { category: "Fees", question: "Is there a test fee?", answer: "No test fee.", status: "published" },
      { question: "A second test question?", answer: "A second test answer." },
    ],
    process_steps: [
      { kind: "application", position: 1, title: "Share your results", body: "Send the test results.", status: "published" },
      { kind: "application", position: 2, title: "Choose a course", body: "Pick one." },
      { kind: "visa", position: 1, title: "Visa step", body: "Apply." },
    ],
    content_blocks: [{ key: "why.test", translations: { en: "Test copy." }, status: "published" }],
    page_images: [{ key: "home.hero", file: "photos/hero.jpg", alt: "Test hero photo" }],
    site_settings: [
      { key: "whatsapp_number_e164", value: "+237612345678" },
      { key: "contact_phone_display", value: "+237 612 345 678" },
    ],
  };
}

export function fixtureBundle(): SeedBundle {
  return seedBundleSchema.parse(fixtureInput());
}
