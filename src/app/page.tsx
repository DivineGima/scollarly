"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { universities } from "@/data/universities";
import { admissionStats, studentJourneys, proofAssets } from "@/data/trust-data";
import { WHATSAPP_BASE_URL } from "@/lib/constants";
import { UniversityWhatsAppCTA } from "@/components/ui/university-whatsapp-cta";
import { AdmissionTicker } from "@/components/trust/admission-ticker";
import { StudentJourneyTimeline } from "@/components/trust/student-journey-timeline";
import { OfferLetterProof } from "@/components/trust/offer-letter-proof";
import { VerifiedTestimonialCard } from "@/components/trust/verified-testimonial-card";
import { ProductTour } from "@/components/ui/product-tour";

/* ─── Animated Counter Hook ─── */
function useCounter(end: number, duration = 2000, isActive = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    let startTime: number | null = null;
    let rafId: number;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(end * eased));
      if (progress < 1) rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [end, duration, isActive]);
  return count;
}

/* ─── Intersection Observer Hook ─── */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.unobserve(el); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

/* ─── Data ─── */
const navLinks = [
  { href: "#about", label: "About" },
  { href: "#stories", label: "Stories" },
  { href: "#team", label: "Team" },
  { href: "#services", label: "Services" },
  { href: "#universities", label: "Universities" },
  { href: "#faq", label: "FAQ" },
  { href: "#contact", label: "Contact" },
];

const services = [
  { icon: "💬", title: "Consultation & Counseling", description: "We talk with you, via WhatsApp or call, to understand your situation, your results, and which programs actually fit your goals." },
  { icon: "🎓", title: "University Admissions", description: "We handle the paperwork and talk directly to the university on your behalf. No missed deadlines, no guessing, we know what each school needs." },
  { icon: "🏆", title: "Scholarships & Financial Aid", description: "Most of our partner universities offer partial scholarships to students we refer. We make sure you get every reduction you qualify for." },
  { icon: "🛡️", title: "Visa Assistance", description: "The visa step trips most students up. We've been through it dozens of times, we tell you exactly what to prepare and what to expect." },
  { icon: "🤝", title: "Pre-Departure & Post-Arrival Support", description: "We don't disappear once your visa is approved. We help with flight planning, meet you at the airport, and stay in touch while you settle in." },
];

const steps = [
  { num: 1, icon: "📄", title: "Share Your Results", desc: "Share your O-level and A-level or Grade 10 and 11 results with the Scollarly team to begin your journey." },
  { num: 2, icon: "📚", title: "Choose Your Course", desc: "Explore courses offered by our partner universities and select at least 3 preferred programs aligned with your career goals." },
  { num: 3, icon: "✉️", title: "Receive Your Offer Letter", desc: "An offer letter with a scholarship will be shared by the university. Review it carefully with our guidance." },
  { num: 4, icon: "💳", title: "Confirm Your Admission", desc: "A registration fee payment is required before the university issues your acceptance letter. This fee is later deducted from tuition." },
  { num: 5, icon: "🎫", title: "Secure Your Visa", desc: "Purchase your flight ticket and use your acceptance letter, flight ticket, and valid passport to secure your student visa." },
  { num: 6, icon: "✈️", title: "Arrive in India", desc: "Catch your flight and we'll receive you at the airport! Our team provides transport and helps you settle into your new home." },
];

const visaSteps = [
  { step: "1", title: "Admission Confirmation", desc: "Receive your official acceptance letter from the Indian institution, a critical document for your visa application." },
  { step: "2", title: "Collect Documents", desc: "Gather passport, photos, proof of admission, financial proof, health certificate, birth certificate, and proof of residence." },
  { step: "3", title: "Submit Application", desc: "Complete the online application and pay the visa fee (USD $83). Your Scollarly agent will guide you through the entire process." },
  { step: "4", title: "Processing", desc: "Visa processing takes 3-5 working days. We'll keep you updated on the status throughout." },
  { step: "5", title: "Collect Visa", desc: "Once approved, collect your passport with the visa. We'll verify all details are correct before you travel." },
];

const faqs = [
  { q: "What services does Scollarly offer?", a: "Scollarly offers guidance on university selection, scholarship opportunities, application and admission support, visa assistance, and post-admission assistance for African students interested in studying in India." },
  { q: "How can I apply for a scholarship through Scollarly?", a: "Share your grades with us and we'll check what's available based on your results. We handle the full application, everything is free." },
  { q: "What are the requirements for studying in India?", a: "Requirements vary by program but typically include academic transcripts (O-level and A-level), a valid passport, bank statements with sufficient balance, and identification documents." },
  { q: "How does Scollarly assist with the admission process?", a: "We handle everything, applications, documents, follow-ups with the university. You share your results and paperwork with us, and we take it from there." },
  { q: "What universities and programs are available?", a: "Scollarly partners with 9+ top Indian universities offering programs in engineering, business, healthcare, IT, and more." },
  { q: "Is there a cost for Scollarly's services?", a: "Nothing. The university pays us after you enroll, so you never pay us anything at any point. That's the whole model." },
  { q: "Can I connect with current students for advice?", a: "Yes! Scollarly can connect you with current students or alumni for insights and firsthand experiences." },
  { q: "What support does Scollarly provide after admission?", a: "Post-admission, we help with accommodation, orientation, airport pickup, campus orientation, and any other support you need." },
  { q: "Is India safe for African students?", a: "Yes. Cities like Mohali, Chandigarh, Bangalore, and Ludhiana have established African student communities, and our partner universities have international student support offices. We provide a cultural orientation before you depart and stay reachable after you arrive." },
  { q: "Will my Indian degree be recognized back home?", a: "Indian universities accredited by NAAC (grades A, A+) are internationally recognized. Degrees can be evaluated by organizations like WES (World Education Services) for use in applications in Europe, North America, and other countries." },
  { q: "How do I know Scollarly is not a scam?", a: "Scollarly never asks for money. Our model is simple: universities pay us when students they receive through us successfully enroll, so we get paid only when you succeed. You can verify this directly: WhatsApp us, speak to current students we've placed, and meet our team in the #team section above." },
  { q: "How long does the full process take?", a: "Typically 3-5 months from first contact to arriving in India. Getting an offer letter takes 4-8 weeks. Visa processing after admission confirmation takes 6-12 weeks. We'll give you a realistic timeline based on your specific situation." },
];

// Testimonials — field-remapped for VerifiedTestimonialCard (see design.md Section 6.3)
const testimonials = [
  {
    name: "Jean-Baptiste K.",
    countryFlag: "🇨🇲",
    country: "Cameroon",
    course: "B.Tech Computer Science",
    university: "Chandigarh University",
    year: 2024,
    verified: true,
    quote: "Got my offer letter in 3 weeks. I applied in January and was on my way to India by June. The process was faster than I expected.",
  },
  {
    name: "Aissatou D.",
    countryFlag: "🇬🇳",
    country: "Guinea",
    course: "BBA",
    university: "Jain University",
    year: 2024,
    verified: true,
    quote: "I tried two other agencies first. Both asked me for money upfront. Scollarly asked me for nothing and did more than the others promised to do.",
  },
  {
    name: "Kofi A.",
    countryFlag: "🇬🇭",
    country: "Ghana",
    course: "B.Tech Mechanical Engineering",
    university: "Kalinga University",
    year: 2023,
    verified: true,
    quote: "My visa was my biggest fear, everyone said it was complicated. They told me exactly what documents to prepare. I was approved on the first attempt.",
  },
  {
    name: "Mariam C.",
    countryFlag: "🇨🇮",
    country: "Ivory Coast",
    course: "MBA",
    university: "CT University",
    year: 2025,
    verified: true,
    quote: "From my first WhatsApp message to landing in India: 4 months. And that includes the time I spent deciding which university to choose.",
  },
  {
    name: "Bachir N.",
    countryFlag: "🇸🇳",
    country: "Senegal",
    course: "B.Pharm",
    university: "Rayat-Bahra University",
    year: 2023,
    verified: true,
    quote: "I'm now in my second year. There's a big African community on campus, I found Senegalese students in my faculty within the first week.",
  },
];

// REPLACE with real team data before launch
const team = [
  {
    initials: "AT",
    name: "Asher T. Runesu",
    role: "Co-Founder & Student Relations",
    bio: "Based in Mohali, India. Has personally guided 60+ students from Cameroon and Nigeria through the full application and visa process since 2022.",
    color: "bg-blue-600",
  },
  {
    initials: "DG",
    name: "Divine G. Folabit",
    role: "Co-Founder & University Partnerships",
    bio: "Based in Douala, Cameroon. Manages our direct relationships with all 9 partner university admission offices and scholarship programs.",
    color: "bg-indigo-600",
  },
];

/* ─── Logo URLs ─── */
const HEADER_LOGO = "https://res.cloudinary.com/drrr1g3kd/image/upload/v1779660754/Screenshot_2026-05-23_at_17.48.58-3_ctwmda.png";
const HEADER_TEXT = "https://res.cloudinary.com/drrr1g3kd/image/upload/v1779660643/Scollarly-2_ycspmg.png";
const FOOTER_LOGO = "https://res.cloudinary.com/drrr1g3kd/image/upload/v1779618806/Screenshot_2026-05-23_at_17.48.58-4_iv2fqt.png";
const FOOTER_TEXT = "https://res.cloudinary.com/drrr1g3kd/image/upload/v1779660668/Scollarly-3_zkcx65.png";

/* ─── Main Page ─── */
export default function Home() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [introVisible, setIntroVisible] = useState(true);
  const [introExiting, setIntroExiting] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [formStatus, setFormStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [formError, setFormError] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [expandedUnis, setExpandedUnis] = useState<Set<number>>(new Set());

  // Section visibility
  const { ref: statsRef, inView: statsVisible } = useInView(0.3);
  const count9 = useCounter(9, 1800, statsVisible);
  const count100 = useCounter(100, 2200, statsVisible);
  const count5 = useCounter(5, 1600, statsVisible);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setIntroExiting(true), 2800);
    const t2 = setTimeout(() => setIntroVisible(false), 3400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const phone = (form.elements.namedItem("phone") as HTMLInputElement).value;
    const message = (form.elements.namedItem("message") as HTMLTextAreaElement).value;
    const country = (form.elements.namedItem("country") as HTMLInputElement).value;

    setFormStatus("sending");
    setFormError("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, message, country }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormStatus("error");
        setFormError(data.error || "Something went wrong. Please try again.");
        return;
      }
      setFormStatus("sent");
      form.reset();
      setTimeout(() => setFormStatus("idle"), 6000);
    } catch {
      setFormStatus("error");
      setFormError("Something went wrong. Try again or WhatsApp us directly.");
    }
  };

  const toggleUni = (i: number) => {
    setExpandedUnis((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ scrollBehavior: "smooth" }}>
      {/* ─── INTRO ─── */}
      {introVisible && (
        <div className={`fixed inset-0 z-[200] bg-white flex flex-col items-center justify-center ${introExiting ? "intro-overlay-exit" : ""}`}>
          <div className="intro-logo">
            <img src={HEADER_LOGO} alt="Scollarly" className="w-44 h-44 sm:w-56 sm:h-56 object-contain" />
          </div>
          <div className="intro-text mt-6">
            <img src={HEADER_TEXT} alt="Scollarly" className="h-12 sm:h-16 object-contain" />
          </div>
        </div>
      )}

      {/* ─── NAV ─── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-xl shadow-sm border-b border-neutral-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20 md:h-24">
            <a href="#" className="flex items-center gap-3 group">
              <img src={HEADER_LOGO} alt="Scollarly" className="w-20 h-20 object-contain transition-transform duration-300 group-hover:scale-105" />
              <img src={HEADER_TEXT} alt="Scollarly" className="h-10 object-contain transition-transform duration-300 group-hover:scale-105" />
            </a>
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((l) => (
                <a key={l.href} href={l.href} className="px-3 py-2 text-sm font-medium rounded-lg text-neutral-600 hover:text-blue-600 hover:bg-blue-50 transition-colors duration-300 relative after:absolute after:bottom-1 after:left-3 after:right-3 after:h-0.5 after:bg-blue-500 after:scale-x-0 after:origin-left after:transition-transform after:duration-300 hover:after:scale-x-100">
                  {l.label}
                </a>
              ))}
              <a href="#contact" className="ml-3 inline-flex items-center justify-center px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-600/25">
                Get Started
              </a>
            </div>
            <button className="md:hidden p-2 rounded-lg hover:bg-neutral-100" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">
              {mobileOpen ? "✕" : "☰"}
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div className="md:hidden bg-white border-t border-neutral-100 shadow-lg p-4 space-y-1">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMobileOpen(false)} className="block px-4 py-3 text-neutral-700 hover:text-blue-600 hover:bg-blue-50 rounded-lg font-medium">
                {l.label}
              </a>
            ))}
            <a href="#contact" onClick={() => setMobileOpen(false)} className="block mt-2 text-center px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg">Get Started</a>
          </div>
        )}
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        <div className="absolute inset-0">
          <div style={{ transform: `translateY(${scrollY * 0.15}px)` }} className="absolute inset-0">
            <img src="/scollarly/images/hero-students.png" alt="Students" className="w-full h-full object-cover scale-110" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-neutral-950/90 via-neutral-950/70 to-neutral-950/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950/80 via-transparent to-neutral-950/30" />
        </div>
        <div className="absolute top-32 right-12 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl hero-glow animate-morph-blob" />
        <div className="absolute bottom-20 left-8 w-56 h-56 bg-blue-600/8 rounded-full blur-3xl animate-float-slow" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32">
          <div className="max-w-2xl">
            <div className="hero-badge inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 mb-6">
              <span className="text-blue-400">🌐</span>
              <span className="text-sm font-semibold text-neutral-300 tracking-wide">Empowering African Students</span>
            </div>
            <h1 className="hero-title text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-white leading-[1.1] mb-6">
              Live Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-blue-300 to-white hero-gradient-text">Dream</span>
            </h1>
            <p className="hero-subtitle text-lg sm:text-xl text-neutral-300 mb-8 leading-relaxed max-w-lg">
              We connect African students with indian universites, making sure they obtain quality education and satisfy thier quest
            </p>
            <div className="hero-buttons flex flex-col sm:flex-row gap-4">
              <a href="#process" className="inline-flex items-center justify-center gap-2 px-8 h-14 text-base font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/25 transition-all duration-300 hover:-translate-y-0.5">Start Your Journey →</a>
              <a href="#about" className="inline-flex items-center justify-center gap-2 px-8 h-14 text-base font-semibold rounded-xl bg-white/15 backdrop-blur-sm text-white hover:bg-white/25 border border-white/20 transition-all duration-300">Learn More</a>
            </div>
          </div>
        </div>
        <div className="hero-scroll absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
          <span className="text-xs text-neutral-400 tracking-widest uppercase">Scroll</span>
          <div className="w-6 h-10 border-2 border-neutral-500 rounded-full flex justify-center pt-2">
            <div className="w-1.5 h-3 bg-blue-500 rounded-full scroll-bounce" />
          </div>
        </div>
      </section>

      {/* ─── ABOUT SCOLLARLY ─── */}
      <section id="why-free" className="bg-neutral-950 py-20 md:py-28">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-lg sm:text-xl text-neutral-300 leading-relaxed">
            Scollarly is an agency that helps African students fulfill their quest to obtain the highest level of education in recognized Indian universities.
          </p>
        </div>
      </section>

      {/* ─── STATS ─── */}
      <div ref={statsRef} className="bg-neutral-950 border-t border-neutral-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            {[
              { val: `${count9}+`, label: "Partner Universities" },
              { val: `${count100}+`, label: "Students Helped" },
              { val: `${count5}+`, label: "African Countries" },
              { val: "Free", label: "Our Services" },
            ].map((s, i) => (
              <div key={i} className={`text-center transition-all duration-700 ${statsVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`} style={{ transitionDelay: `${i * 150}ms` }}>
                <div className="text-3xl sm:text-4xl font-bold text-blue-400">{s.val}</div>
                <div className="text-sm text-neutral-400 font-medium mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <AdmissionTicker stats={admissionStats} />

      {/* ─── STUDENT STORIES ─── */}
      <Section id="stories" badge="Student Stories" title="Students Just Like You, Already Living Their Dream" subtitle="These are real students we've helped. Read their stories before you decide.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((testimonial, i) => (
            <AnimDiv key={i} delay={i * 100} direction="up">
              <VerifiedTestimonialCard {...testimonial} />
            </AnimDiv>
          ))}
          <AnimDiv delay={500} direction="up">
            <OfferLetterProof
              imageSrc={proofAssets.offerLetterSample}
              universityName="Chandigarh University"
            />
          </AnimDiv>
        </div>
        <div className="mt-10 text-center">
          <p className="text-neutral-500 text-sm">Want to speak to a current student directly? <a href={WHATSAPP_BASE_URL} className="text-blue-600 font-semibold hover:underline">WhatsApp us →</a></p>
        </div>
      </Section>

      {/* ─── TEAM ─── */}
      <Section id="team" dark badge="Our Team" title="The People Behind Your Journey" subtitle="We're not a faceless website. These are the people who will actually work with you.">
        <div className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {team.map((member, i) => (
            <AnimDiv key={i} delay={i * 150} direction="up" className="bg-neutral-900 border border-neutral-800 rounded-2xl p-7 hover:border-blue-600/40 transition-all duration-300 group">
              <div className="flex items-center gap-4 mb-4">
                <div className={`w-14 h-14 ${member.color} rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0 group-hover:scale-105 transition-transform`} aria-label={`${member.name} photo`}>
                  {member.initials}
                </div>
                <div>
                  <div className="font-bold text-white">{member.name}</div>
                  <span className="inline-block mt-1 px-2.5 py-0.5 bg-blue-500/20 text-blue-300 text-xs font-semibold rounded-full">{member.role}</span>
                </div>
              </div>
              <p className="text-neutral-400 text-sm leading-relaxed">{member.bio}</p>
            </AnimDiv>
          ))}
        </div>
        <div className="mt-10 text-center">
          <a href={WHATSAPP_BASE_URL} className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 font-semibold text-sm transition-colors">
            📱 Message our team directly on WhatsApp →
          </a>
        </div>
      </Section>

      {/* ─── WHY SCOLLARLY ─── */}
      <Section id="why-us" badge="The Difference" title="Why Scollarly Beats Local Agencies" subtitle="Most education agents in Africa charge upfront fees and disappear. We built the opposite model, and the difference is not small.">
        <div className="grid sm:grid-cols-2 gap-6">
          {[
            {
              icon: "💸",
              title: "You never pay us, not once",
              desc: "Most local agents charge €200–€1,000 before you've even seen an offer letter. With Scollarly, the university pays us only after you successfully enroll. You hand over no money at any stage, not during, not after.",
            },
            {
              icon: "✅",
              title: "Your admission will be real",
              desc: "Because we only profit when you actually enroll at a real university, fake or invalid offer letters earn us nothing. We have every financial reason to make sure your admission is genuine and from an accredited institution.",
            },
            {
              icon: "🛣️",
              title: "We stay with you until you land",
              desc: "Most agents help with the application and then vanish when visa time comes. We guide you through every step, from choosing your university to the airport pickup in India. One team, the whole journey.",
            },
            {
              icon: "🔒",
              title: "Zero risk on your side",
              desc: "If for any reason things don't work out, you've lost nothing, no money, no time you can't recover. The financial risk sits entirely with us, which is exactly why we work hard to make it work.",
            },
          ].map((item, i) => (
            <AnimDiv key={i} delay={i * 120} direction="up" className="flex gap-5 p-6 bg-white border border-neutral-200 rounded-2xl hover:border-blue-300 hover:shadow-lg transition-all duration-300">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-2xl shrink-0">{item.icon}</div>
              <div>
                <h3 className="font-bold text-neutral-900 mb-2">{item.title}</h3>
                <p className="text-neutral-600 text-sm leading-relaxed">{item.desc}</p>
              </div>
            </AnimDiv>
          ))}
        </div>
        <div className="mt-10 p-6 bg-blue-50 border border-blue-200 rounded-2xl">
          <p className="text-blue-900 text-sm leading-relaxed text-center max-w-2xl mx-auto">
            <strong>The short version:</strong> We only make money when you succeed, so misleading you, rushing you into the wrong university, or cutting corners on your visa isn&apos;t just bad service, it costs us directly. Our interests and yours are one and the same.
          </p>
        </div>
      </Section>

      <StudentJourneyTimeline journey={studentJourneys[0]} />

      {/* ─── ABOUT ─── */}
      <Section id="about" badge="About Us" title="Who We Are" subtitle="We've helped hundreds of students from across Africa make it to India. Here's who we are and why we started.">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <AnimDiv className="relative" direction="left">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl group">
              <img src="/scollarly/images/student-study.png" alt="Student studying" className="w-full h-auto object-cover transition-transform duration-700 group-hover:scale-105" />
            </div>
            <div className="absolute -bottom-6 -right-4 sm:-right-6 bg-white rounded-xl shadow-xl p-4 border border-neutral-100 animate-float">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">🌐</div>
                <div>
                  <div className="text-sm font-bold text-neutral-900">Expanding Globally</div>
                  <div className="text-xs text-neutral-500">Based in India, reaching Africa & beyond</div>
                </div>
              </div>
            </div>
          </AnimDiv>
          <AnimDiv direction="right" delay={200}>
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold text-neutral-900 mb-3">Our Mission</h3>
                <p className="text-neutral-600 leading-relaxed">Scollarly started because too many African students were getting exploited by paid agents, or giving up entirely because they didn&apos;t know where to begin. We built the free alternative. Our goal is simple: if you want to study in India and you put in the effort, we make sure nothing stops you.</p>
              </div>
              {[
                { icon: "⭐", title: "Commitment", desc: "We don't just send you a university list and move on. We stay with you until you actually land in India." },
                { icon: "👥", title: "Inclusivity", desc: "Francophone, Anglophone, East African, West African, every student gets the same full service, no exceptions." },
                { icon: "✅", title: "Honesty", desc: "We tell you the truth, even when it's not what you want to hear. That's the only kind of advice that actually helps." },
              ].map((v, i) => (
                <AnimDiv key={i} delay={400 + i * 150} className="flex items-start gap-4 p-4 rounded-xl hover:bg-blue-50/50 transition-colors">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center shrink-0 text-lg">{v.icon}</div>
                  <div>
                    <h4 className="font-semibold text-neutral-900 mb-1">{v.title}</h4>
                    <p className="text-sm text-neutral-500 leading-relaxed">{v.desc}</p>
                  </div>
                </AnimDiv>
              ))}
              <p className="text-neutral-500 italic text-sm border-l-4 border-blue-400 pl-4">&ldquo;Where there&apos;s unity, God commands a blessing.&rdquo;</p>
            </div>
          </AnimDiv>
        </div>
      </Section>

      {/* ─── SERVICES ─── */}
      <Section id="services" dark badge="Our Services" title="How We Help You Succeed" subtitle="Comprehensive support from your first inquiry to settling into your new life in India.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((s, i) => (
            <AnimDiv key={i} delay={i * 120} direction="up" className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 hover:border-blue-600/50 transition-all duration-500 group hover:-translate-y-2 hover:shadow-xl">
              <div className="w-12 h-12 bg-blue-600/15 rounded-xl flex items-center justify-center mb-3 group-hover:bg-blue-600/25 group-hover:scale-110 transition-all duration-300 text-2xl">{s.icon}</div>
              <h3 className="text-white text-lg font-semibold mb-2 group-hover:text-blue-300 transition-colors">{s.title}</h3>
              <p className="text-neutral-400 leading-relaxed text-sm">{s.description}</p>
            </AnimDiv>
          ))}
        </div>
        <div className="mt-12 text-center">
          <div className="inline-flex items-center gap-3 bg-blue-600/15 border border-blue-600/30 rounded-full px-6 py-3 animate-border-glow">
            <span className="text-blue-500">✅</span>
            <span className="text-blue-200 font-semibold">All our services are completely FREE of charge</span>
          </div>
        </div>
      </Section>

      {/* ─── PROCESS ─── */}
      <Section id="process" badge="How It Works" title="Your Journey in 6 Simple Steps" subtitle="From your first inquiry to arriving in India, we guide you through every stage of the process.">
        <div className="relative">
          <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-neutral-200 via-blue-400 to-neutral-200" />
          <div className="space-y-8 lg:space-y-12">
            {steps.map((step, i) => (
              <AnimDiv key={i} delay={i * 150} direction="up" className="relative flex flex-col lg:flex-row items-center gap-6 lg:gap-12">
                <div className={`flex-1 ${i % 2 === 0 ? "lg:text-right lg:order-1" : "lg:order-3"}`}>
                  <div className="bg-white border border-neutral-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-lg transition-all duration-300">
                    <h3 className="text-lg font-semibold text-neutral-900 mb-2">{step.title}</h3>
                    <p className="text-neutral-600 text-sm leading-relaxed">{step.desc}</p>
                  </div>
                </div>
                <div className="lg:order-2 relative z-10">
                  <div className="w-14 h-14 bg-neutral-900 rounded-full flex items-center justify-center shadow-lg text-2xl">{step.icon}</div>
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-white step-glow">{step.num}</div>
                </div>
                <div className={`flex-1 ${i % 2 === 0 ? "lg:order-3" : "lg:order-1"}`} />
              </AnimDiv>
            ))}
          </div>
        </div>
        <div className="mt-16 text-center">
          <a href="#contact" className="inline-flex items-center justify-center gap-2 px-10 h-14 text-base font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/25 transition-all duration-300 hover:-translate-y-0.5">Begin Your Application →</a>
        </div>
      </Section>

      {/* ─── UNIVERSITIES ─── */}
      <Section id="universities" dark badge="Partner Universities" title="World-Class Institutions Awaiting You" subtitle="We partner with 9 leading Indian universities. Click any card to see the programs available.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {universities.map((u, i) => {
            const expanded = expandedUnis.has(i);
            const preview = u.programs.slice(0, 4);
            const rest = u.programs.slice(4);
            return (
              <AnimDiv key={i} delay={i * 80} direction="up" className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden hover:border-blue-500/50 transition-all duration-300 group">
                <div className="p-6">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-14 h-14 bg-white rounded-xl flex items-center justify-center shrink-0 p-2 group-hover:scale-105 transition-transform duration-300">
                      <img src={u.logo} alt={`${u.name} logo`} className="w-full h-full object-contain" loading="lazy" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-white text-sm leading-tight mb-1 group-hover:text-blue-300 transition-colors">{u.name}</h3>
                      <p className="text-neutral-400 text-xs">📍 {u.location}</p>
                      {u.naacGrade && <span className="inline-block mt-1 px-2 py-0.5 bg-green-500/15 text-green-400 text-xs font-bold rounded-full">NAAC {u.naacGrade}</span>}
                    </div>
                  </div>

                  {/* Program list */}
                  <div className="space-y-1.5 mb-4">
                    {preview.map((p, j) => (
                      <div key={j} className="flex items-center justify-between text-xs">
                        <span className="text-neutral-400 truncate pr-2">{p.name}</span>
                        <span className="text-neutral-400 shrink-0">{p.duration}</span>
                      </div>
                    ))}
                    {expanded && rest.map((p, j) => (
                      <div key={`r-${j}`} className="flex items-center justify-between text-xs">
                        <span className="text-neutral-400 truncate pr-2">{p.name}</span>
                        <span className="text-neutral-400 shrink-0">{p.duration}</span>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {rest.length > 0 && (
                      <button
                        onClick={() => toggleUni(i)}
                        aria-expanded={expanded}
                        className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                      >
                        {expanded ? "Hide Programs ▲" : `View All ${u.programs.length} Programs ▼`}
                      </button>
                    )}
                    <Link href={`/universities/${u.slug}`} className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors ml-auto">
                      Full Profile →
                    </Link>
                  </div>
                </div>
                <div className="border-t border-neutral-800 px-6 py-3">
                  <a href="#contact" className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors">Apply via Scollarly →</a>
                </div>
              </AnimDiv>
            );
          })}
        </div>
        <AnimDiv delay={800} direction="up" className="mt-12 rounded-2xl overflow-hidden shadow-2xl">
          <img src="/scollarly/images/india-campus.png" alt="Indian campus" className="w-full h-auto object-cover" />
        </AnimDiv>
        <UniversityWhatsAppCTA variant="homepage" />
      </Section>

      {/* ─── VISA ─── */}
      <Section id="visa" badge="Visa Support" title="We Handle the Visa Process With You" subtitle="Navigating visa processes can be challenging, but our step-by-step guidance ensures a smooth experience.">
        <div className="grid md:grid-cols-5 gap-4">
          {visaSteps.map((item, i) => (
            <AnimDiv key={i} delay={i * 120} direction="up" className="relative bg-white border border-neutral-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-lg transition-all duration-500 hover:-translate-y-2">
              <div className="text-3xl font-bold text-blue-200 mb-3">{item.step}</div>
              <h3 className="font-bold text-neutral-900 mb-2 text-sm">{item.title}</h3>
              <p className="text-xs text-neutral-500 leading-relaxed">{item.desc}</p>
              {i < 4 && <span className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 text-blue-300">→</span>}
            </AnimDiv>
          ))}
        </div>
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-start gap-3">
          <span className="text-blue-600 mt-0.5">🛡️</span>
          <p className="text-sm text-blue-800"><strong>Note:</strong> We assign a dedicated agent to assist you through the entire visa process. All documents are verified before and after application.</p>
        </div>
      </Section>

      {/* ─── FAQ ─── */}
      <Section id="faq" dark badge="FAQ" title="Frequently Asked Questions" subtitle="Everything you need to know about studying in India with Scollarly.">
        <div className="max-w-3xl mx-auto space-y-3">
          {faqs.map((faq, i) => (
            <AnimDiv key={i} delay={i * 60} direction="up" className={`bg-neutral-900 border rounded-xl overflow-hidden transition-all duration-300 ${openFaq === i ? "border-blue-600/40" : "border-neutral-800"}`}>
              <button className="w-full text-left px-6 py-5 flex items-center justify-between gap-4" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                <span className="text-white text-sm font-semibold">{faq.q}</span>
                <span className={`text-neutral-400 transition-transform duration-300 shrink-0 ${openFaq === i ? "rotate-180" : ""}`}>▼</span>
              </button>
              <div className={`overflow-hidden transition-all duration-400 ${openFaq === i ? "max-h-96" : "max-h-0"}`}>
                <p className="px-6 pb-5 text-neutral-400 text-sm leading-relaxed">{faq.a}</p>
              </div>
            </AnimDiv>
          ))}
        </div>
      </Section>

      {/* ─── CONTACT ─── */}
      <Section id="contact" badge="Get In Touch" title="Start Your Journey Today" subtitle="Ready to take the first step? Reach out to us and we'll guide you through everything.">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16">
          <AnimDiv direction="left">
            <div className="space-y-6 mb-10">
              <p className="text-neutral-600 leading-relaxed">Got questions? Fill in the form and we&apos;ll follow up on WhatsApp within 24 hours. Or skip the form entirely and message us directly, we respond the same day.</p>
              <div className="space-y-4">
                {[
                  { icon: "📞", label: "Phone / WhatsApp", value: "+91 98157 25968", href: WHATSAPP_BASE_URL },
                  { icon: "📧", label: "Email", value: "info@scollarly.com", href: "mailto:info@scollarly.com" },
                  { icon: "🌐", label: "Website", value: "scollarly.vercel.app", href: "https://scollarly.vercel.app" },
                  { icon: "📍", label: "Office", value: "Mohali, India", href: "#" },
                ].map((c, i) => (
                  <a key={i} href={c.href} className="flex items-center gap-4 p-3 rounded-xl hover:bg-blue-50 transition-colors group">
                    <div className="w-11 h-11 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 group-hover:scale-110 transition-all text-lg">{c.icon}</div>
                    <div>
                      <div className="text-xs text-neutral-400 font-medium">{c.label}</div>
                      <div className="text-sm font-semibold text-neutral-900">{c.value}</div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
            <div className="rounded-2xl overflow-hidden shadow-lg group">
              <img src="/scollarly/images/global-network.png" alt="Global network" className="w-full h-auto object-cover transition-transform duration-700 group-hover:scale-105" />
            </div>
          </AnimDiv>
          <AnimDiv direction="right" delay={200}>
            <div className="border border-neutral-200 shadow-xl rounded-xl overflow-hidden">
              <div className="p-6 pb-0">
                <h3 className="text-xl font-semibold text-neutral-900">Send Us a Message</h3>
                <p className="text-neutral-500 text-sm mt-1">Fill out the form below and our team will get back to you within 24 hours.</p>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-neutral-700 mb-1.5 block">Full Name *</label>
                    <input name="name" placeholder="Your full name" required minLength={2} className="w-full px-3.5 py-2.5 text-sm border border-neutral-200 rounded-lg outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 transition-all" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-neutral-700 mb-1.5 block">Email Address *</label>
                    <input name="email" type="email" placeholder="your@email.com" required className="w-full px-3.5 py-2.5 text-sm border border-neutral-200 rounded-lg outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 transition-all" />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-neutral-700 mb-1.5 block">Phone / WhatsApp</label>
                    <input name="phone" type="tel" placeholder="+91 98XXX XXXXX" className="w-full px-3.5 py-2.5 text-sm border border-neutral-200 rounded-lg outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 transition-all" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-neutral-700 mb-1.5 block">Country</label>
                    <input name="country" placeholder="e.g. Cameroon" className="w-full px-3.5 py-2.5 text-sm border border-neutral-200 rounded-lg outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 transition-all" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-neutral-700 mb-1.5 block">Message *</label>
                  <textarea name="message" placeholder="Tell us about your academic goals..." rows={4} required minLength={10} className="w-full px-3.5 py-2.5 text-sm border border-neutral-200 rounded-lg outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 transition-all resize-none" />
                </div>

                {formStatus === "error" && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <span>❌</span> {formError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={formStatus === "sending"}
                  className={`w-full h-12 font-semibold rounded-lg text-white transition-all duration-300 ${
                    formStatus === "sent"
                      ? "bg-green-600"
                      : formStatus === "error"
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-blue-600 hover:bg-blue-700 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-600/25"
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  {formStatus === "sending"
                    ? "Sending..."
                    : formStatus === "sent"
                    ? "✅ We've received your inquiry! Check your email."
                    : formStatus === "error"
                    ? "Try Again"
                    : "Send Message"}
                </button>

                <a href={WHATSAPP_BASE_URL} className="flex items-center justify-center gap-2 w-full h-10 text-sm font-medium text-neutral-600 hover:text-green-600 transition-colors">
                  Or <span className="font-semibold text-green-600">chat on WhatsApp →</span>
                </a>
              </form>
            </div>
          </AnimDiv>
        </div>
      </Section>

      {/* ─── CTA ─── */}
      <section className="bg-neutral-950 relative overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl animate-morph-blob" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl animate-morph-blob" style={{ animationDelay: "2s" }} />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center relative z-10">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">A Journey of a Thousand Miles Begins With One Step</h2>
          <p className="text-neutral-400 text-lg mb-8 max-w-2xl mx-auto">Don&apos;t wait, your dream education in India is closer than you think. Let Scollarly guide you there.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="#contact" className="inline-flex items-center justify-center gap-2 px-8 h-14 text-base font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/25 transition-all duration-300 hover:-translate-y-0.5">Apply Now, It&apos;s Free →</a>
            <a href={WHATSAPP_BASE_URL} className="inline-flex items-center justify-center gap-2 px-8 h-14 text-base font-semibold rounded-xl bg-white/10 backdrop-blur-sm text-white hover:bg-white/20 border border-white/20 transition-all duration-300">📞 WhatsApp Us</a>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="bg-neutral-950 text-neutral-400 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
            <div className="sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-3 mb-4">
                <img src={FOOTER_LOGO} alt="Scollarly" className="w-24 h-24 object-contain" />
                <img src={FOOTER_TEXT} alt="Scollarly" className="h-12 object-contain" />
              </div>
              <p className="text-sm text-neutral-400 leading-relaxed mb-4">Empowering African students to achieve their dreams through world-class education in India.</p>
              <p className="text-sm font-semibold text-blue-400 tracking-wide text-shimmer">LIVE • YOUR • DREAM</p>
            </div>
            <div>
              <h3 className="text-white font-semibold mb-4 text-sm">Quick Links</h3>
              <ul className="space-y-2.5">
                {navLinks.map((l) => (
                  <li key={l.href}><a href={l.href} className="text-sm hover:text-blue-400 hover:translate-x-1 transition-all duration-300 inline-block">{l.label}</a></li>
                ))}
                <li><Link href="/blog" className="text-sm hover:text-blue-400 hover:translate-x-1 transition-all duration-300 inline-block">Blog</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-white font-semibold mb-4 text-sm">Services</h3>
              <ul className="space-y-2.5">{services.map((s, i) => <li key={i}><a href="#services" className="text-sm hover:text-blue-400 hover:translate-x-1 transition-all duration-300 inline-block">{s.title}</a></li>)}</ul>
            </div>
            <div>
              <h3 className="text-white font-semibold mb-4 text-sm">Contact Us</h3>
              <ul className="space-y-3">
 
                <li><a href="mailto:info@scollarly.com" className="flex items-center gap-2 text-sm hover:text-blue-400 transition-colors">📧 info@scollarly.com</a></li>
                <li><span className="flex items-center gap-2 text-sm">📍 Mohali, India</span></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-neutral-800 mt-12 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-xs text-neutral-400">© {new Date().getFullYear()} Scollarly. All rights reserved.</p>
            <div className="flex items-center gap-4 text-xs text-neutral-400">
              <Link href="/privacy-policy" className="hover:text-blue-400 transition-colors">Privacy Policy</Link>
              <span>·</span>
              <Link href="/terms-of-service" className="hover:text-blue-400 transition-colors">Terms of Service</Link>
              <span>·</span>
              <span>Transparent firm. No cash accepted from clients.</span>
            </div>
          </div>
        </div>
      </footer>

      <ProductTour />
    </div>
  );
}

/* ─── Reusable Animated Section Component ─── */
function Section({ id, badge, title, subtitle, dark = false, children }: {
  id: string; badge: string; title: string; subtitle: string; dark?: boolean; children: React.ReactNode;
}) {
  const { ref, inView } = useInView(0.08);
  return (
    <section id={id} ref={ref} className={`py-20 md:py-28 transition-all duration-1000 ${inView ? "opacity-100" : "opacity-0"} ${dark ? "bg-neutral-950 text-white" : ""}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-semibold tracking-wide uppercase mb-4 transition-all duration-700 ${inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"} ${dark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-800"}`}>{badge}</span>
          <h2 className={`text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4 transition-all duration-700 delay-100 ${inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"} ${dark ? "text-white" : "text-neutral-900"}`}>{title}</h2>
          <p className={`max-w-2xl mx-auto text-lg transition-all duration-700 delay-200 ${inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"} ${dark ? "text-neutral-400" : "text-neutral-600"}`}>{subtitle}</p>
          <div className="flex justify-center mt-6"><div className={`h-1 bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-1000 delay-300 ${inView ? "w-20 opacity-100" : "w-0 opacity-0"}`} /></div>
        </div>
        {children}
      </div>
    </section>
  );
}

/* ─── Animated Div Component ─── */
function AnimDiv({ children, direction = "up", delay = 0, className = "" }: {
  children: React.ReactNode; direction?: "up" | "left" | "right"; delay?: number; className?: string;
}) {
  const { ref, inView } = useInView(0.1);
  const transforms = { up: "translateY(2rem)", left: "translateX(-3rem)", right: "translateX(3rem)" };
  const resetTransforms = { up: "translateY(0)", left: "translateX(0)", right: "translateX(0)" };
  return (
    <div ref={ref} className={`transition-all duration-700 ${className}`} style={{
      opacity: inView ? 1 : 0,
      transform: inView ? resetTransforms[direction] : transforms[direction],
      transitionDelay: `${delay}ms`,
    }}>
      {children}
    </div>
  );
}
