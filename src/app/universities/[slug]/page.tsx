import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { universities } from "@/data/universities";
import { FeeStructureSection } from "@/components/university/fee-structure";
import { CampusExperience } from "@/components/university/campus-experience";
import { OfficialResources } from "@/components/university/official-resources";
import { UniversityWhatsAppCTA } from "@/components/ui/university-whatsapp-cta";
import { WHATSAPP_BASE_URL } from "@/lib/constants";

export async function generateStaticParams() {
  return universities.map((u) => ({ slug: u.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const uni = universities.find((u) => u.slug === slug);
  if (!uni) return {};
  return {
    title: `${uni.name}, Study via Scollarly`,
    description: uni.overview ?? `${uni.name} in ${uni.location}, programs, fees, and application through Scollarly.`,
  };
}

export default async function UniversityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const uni = universities.find((u) => u.slug === slug);
  if (!uni) notFound();

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-neutral-950 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
          <Link href="/#universities" className="text-sm text-blue-400 hover:text-blue-300 font-medium">← All Universities</Link>
          <div className="mt-8 flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center p-2 shrink-0">
              <img src={uni.logo} alt={`${uni.name} logo`} className="w-full h-full object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h1 className="text-3xl sm:text-4xl font-bold">{uni.name}</h1>
                {uni.naacGrade && (
                  <span className="px-3 py-1 bg-green-500/20 text-green-400 text-sm font-bold rounded-full border border-green-500/30">
                    NAAC {uni.naacGrade}
                  </span>
                )}
              </div>
              <p className="text-neutral-400 text-lg">📍 {uni.location}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid lg:grid-cols-3 gap-10">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-10">
            {/* Overview */}
            {uni.overview && (
              <section>
                <h2 className="text-2xl font-bold text-neutral-900 mb-4">About {uni.name}</h2>
                <p className="text-neutral-600 leading-relaxed text-lg">{uni.overview}</p>
              </section>
            )}

            {/* Programs */}
            <section>
              <h2 className="text-2xl font-bold text-neutral-900 mb-6">Programs Available</h2>
              <div className="space-y-3">
                {uni.programs.map((program, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-neutral-50 border border-neutral-200 rounded-xl hover:border-blue-300 hover:bg-blue-50/50 transition-all duration-200">
                    <div>
                      <p className="font-semibold text-neutral-900">{program.name}</p>
                      {program.fees && <p className="text-sm text-neutral-500 mt-0.5">{program.fees}</p>}
                    </div>
                    <span className="shrink-0 ml-4 px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded-full">
                      {program.duration}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Why this university */}
            <section className="bg-blue-50 border border-blue-200 rounded-2xl p-8">
              <h2 className="text-xl font-bold text-neutral-900 mb-4">Why Apply Through Scollarly?</h2>
              <ul className="space-y-3">
                {[
                  "Scollarly has an established relationship with this university, your application gets reviewed faster",
                  "We prepare your documents to meet their exact requirements, reducing the chance of rejection",
                  "Our service is 100% free, the university pays us when you enroll, not you",
                  "We stay with you from application to airport arrival",
                ].map((point, i) => (
                  <li key={i} className="flex items-start gap-3 text-neutral-700">
                    <span className="text-green-500 font-bold shrink-0">✓</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* ── NEW SECTIONS ── */}
            <FeeStructureSection
              feeStructure={uni.feeStructure}
              universityName={uni.name}
            />

            <CampusExperience
              campusExperience={uni.campusExperience}
              universityName={uni.name}
            />

            <OfficialResources
              officialResources={uni.officialResources}
              universityName={uni.name}
            />
          </div>

          {/* Sidebar */}
          <aside className="space-y-6">
            {/* CTA card */}
            <div className="bg-neutral-950 text-white rounded-2xl p-6 sticky top-6">
              <h3 className="text-lg font-bold mb-2">Apply to {uni.name}</h3>
              <p className="text-neutral-400 text-sm mb-6 leading-relaxed">Our team will review your academic results and guide you through the full application process, free.</p>
              <Link href="/#contact" className="block w-full text-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all duration-300 hover:-translate-y-0.5">
                Apply via Scollarly →
              </Link>
              <a href={WHATSAPP_BASE_URL} className="block w-full text-center px-6 py-3 mt-3 bg-white/10 hover:bg-white/20 text-white font-medium rounded-xl border border-white/20 transition-all duration-300 text-sm">
                📱 WhatsApp First
              </a>
            </div>

            {/* University link */}
            <div className="border border-neutral-200 rounded-2xl p-5">
              <h3 className="font-semibold text-neutral-900 mb-3 text-sm">Official Links</h3>
              <a href={uni.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium">
                🌐 Visit Official Website →
              </a>
            </div>

            {/* All universities */}
            <div className="border border-neutral-200 rounded-2xl p-5">
              <h3 className="font-semibold text-neutral-900 mb-3 text-sm">All Partner Universities</h3>
              <div className="space-y-2">
                {universities.map((u) => (
                  <Link key={u.slug} href={`/universities/${u.slug}`} className={`block text-sm px-3 py-2 rounded-lg transition-colors ${u.slug === uni.slug ? "bg-blue-100 text-blue-700 font-semibold" : "text-neutral-600 hover:text-blue-600 hover:bg-neutral-50"}`}>
                    {u.name}
                  </Link>
                ))}
              </div>
            </div>

            {/* More options CTA */}
            <UniversityWhatsAppCTA variant="sidebar" universityName={uni.name} />
          </aside>
        </div>
      </div>
    </div>
  );
}
