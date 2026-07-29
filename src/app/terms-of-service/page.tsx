import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service, Scollarly",
  description: "The terms governing your use of Scollarly's free education consulting services.",
};

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="mb-10">
          <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium">← Back to Home</Link>
        </div>

        <h1 className="text-4xl font-bold text-neutral-900 mb-3">Terms of Service</h1>
        <p className="text-neutral-500 text-sm mb-12">Last updated: May 2026</p>

        <div className="space-y-10 text-neutral-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Our service</h2>
            <p>Scollarly provides free education consulting services to African students who wish to study at partner universities in India. "Free" means that <strong>students and their families pay Scollarly nothing</strong>, no registration fees, no consultation fees, no placement fees.</p>
            <p className="mt-3">Scollarly is compensated directly by partner universities when a student we introduce successfully enrolls. This model aligns our interests with yours: we succeed only when you do.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">What we provide</h2>
            <ul className="list-disc list-inside space-y-1.5 pl-2">
              <li>Guidance on selecting suitable universities and programs based on your academic background</li>
              <li>Assistance preparing and submitting university applications</li>
              <li>Support navigating the offer letter and admission confirmation process</li>
              <li>Step-by-step guidance on the Indian student visa process</li>
              <li>Pre-departure orientation and post-arrival support in India</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">No guarantee of admission or visa</h2>
            <p>While Scollarly does everything in its power to support your application, we cannot guarantee:</p>
            <ul className="mt-3 list-disc list-inside space-y-1.5 pl-2">
              <li>University admission, final admission decisions rest solely with the university</li>
              <li>Visa approval, visa decisions are made by the Indian Embassy or High Commission in your country</li>
              <li>Scholarship availability, scholarships depend on the university's current offers and your eligibility</li>
            </ul>
            <p className="mt-4">Scollarly is not liable for rejection of any university application or visa application, provided we have fulfilled our advisory role in good faith.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Your responsibilities</h2>
            <p>By using Scollarly's services, you agree to:</p>
            <ul className="mt-3 list-disc list-inside space-y-1.5 pl-2">
              <li>Provide accurate, complete, and truthful information in all applications and documents</li>
              <li>Promptly provide any additional documents requested by Scollarly or the university</li>
              <li>Notify Scollarly of any changes to your academic results, personal circumstances, or contact details</li>
              <li>Pay all university fees directly to the university as instructed, Scollarly never handles student money</li>
            </ul>
            <p className="mt-4"><strong>Document fraud is a criminal offense.</strong> Submitting false academic transcripts or other fraudulent documents will result in immediate termination of our services and may be reported to relevant authorities.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">University fees</h2>
            <p>Universities charge their own tuition fees, registration fees, and accommodation fees. These fees are paid directly to the university, not to Scollarly. Scollarly will always clearly communicate what fees are due to the university and when, so there are no surprises.</p>
            <p className="mt-3">If anyone claiming to represent Scollarly asks you to pay money into a personal account, <strong>do not pay and contact us immediately</strong> at <a href="mailto:info@scollarly.com" className="text-blue-600 hover:underline">info@scollarly.com</a> or WhatsApp <a href="https://wa.me/919815725968" className="text-blue-600 hover:underline">+91 98157 25968</a>.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Termination of service</h2>
            <p>Scollarly reserves the right to terminate its services to any student who provides false information, engages in abusive communication, or otherwise violates these terms. Students may also withdraw from the process at any time with no penalty.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Governing law</h2>
            <p>These terms are governed by the laws of India. Any disputes arising shall first be addressed through good-faith negotiation. Scollarly's liability is limited to the value of the services provided, which is zero, as our services are free.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Contact</h2>
            <p>Questions? Email <a href="mailto:info@scollarly.com" className="text-blue-600 hover:underline">info@scollarly.com</a> or WhatsApp us at <a href="https://wa.me/919815725968" className="text-blue-600 hover:underline">+91 98157 25968</a>.</p>
          </section>
        </div>

        <div className="mt-16 pt-8 border-t border-neutral-200 text-sm text-neutral-500">
          <Link href="/" className="hover:text-blue-600 transition-colors">← Back to Scollarly</Link>
          <span className="mx-4">·</span>
          <Link href="/privacy-policy" className="hover:text-blue-600 transition-colors">Privacy Policy</Link>
        </div>
      </div>
    </div>
  );
}
