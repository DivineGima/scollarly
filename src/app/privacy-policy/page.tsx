import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Scollarly",
  description: "How Scollarly collects, uses, and protects your personal information.",
};

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="mb-10">
          <Link href="/" className="text-sm text-blue-600 hover:text-blue-700 font-medium">← Back to Home</Link>
        </div>

        <h1 className="text-4xl font-bold text-neutral-900 mb-3">Privacy Policy</h1>
        <p className="text-neutral-500 text-sm mb-12">Last updated: May 2026</p>

        <div className="space-y-10 text-neutral-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Who we are</h2>
            <p>Scollarly is an education consulting agency that helps African students apply to partner universities in India. Our services are provided free of charge to students. We are funded by universities when students we refer successfully enroll.</p>
            <p className="mt-3">Contact: <a href="mailto:info@scollarly.com" className="text-blue-600 hover:underline">info@scollarly.com</a> · WhatsApp: +237 651 232 301 · Mohali, India</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">What data we collect</h2>
            <p>When you submit an inquiry through our contact form, we collect:</p>
            <ul className="mt-3 list-disc list-inside space-y-1.5 pl-2">
              <li><strong>Full name</strong> — to address you correctly in communications</li>
              <li><strong>Email address</strong> — to send you a confirmation and follow-up guidance</li>
              <li><strong>Phone / WhatsApp number</strong> (optional) — to contact you via WhatsApp if you prefer</li>
              <li><strong>Country</strong> (optional) — to understand where our students come from</li>
              <li><strong>Message</strong> — to understand your academic goals and provide relevant guidance</li>
            </ul>
            <p className="mt-4">We also collect standard web analytics data (page views, session duration) through Google Analytics 4. This data is anonymized and does not personally identify you.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">How we use your data</h2>
            <ul className="list-disc list-inside space-y-1.5 pl-2">
              <li>To respond to your inquiry and guide you through the university application process</li>
              <li>To send you relevant information about programs, scholarships, and visa procedures</li>
              <li>To connect you with partner universities (with your explicit consent)</li>
              <li>To improve our services and understand which countries students come from</li>
            </ul>
            <p className="mt-4 font-medium text-neutral-900">We never sell your data to third parties. We never share your personal information with advertisers.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Data retention</h2>
            <p>We retain your contact information for up to <strong>2 years</strong> from the date of your inquiry. After this period, your data is deleted from our systems.</p>
            <p className="mt-3">If you are successfully placed at a partner university, we may retain minimal records (name, university, program, year) for reporting purposes to our university partners.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Your rights</h2>
            <p>You have the right to:</p>
            <ul className="mt-3 list-disc list-inside space-y-1.5 pl-2">
              <li>Request a copy of the data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data at any time</li>
              <li>Opt out of marketing communications at any time</li>
            </ul>
            <p className="mt-4">To exercise these rights, email us at <a href="mailto:info@scollarly.com" className="text-blue-600 hover:underline">info@scollarly.com</a> with subject line "Data Request".</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Cookies</h2>
            <p>Our website uses Google Analytics 4 cookies to measure traffic and usage patterns. These cookies do not store personally identifiable information. You can disable cookies in your browser settings at any time.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Changes to this policy</h2>
            <p>We may update this policy from time to time. The "Last updated" date at the top of this page will reflect any changes. Continued use of our website after updates constitutes acceptance of the revised policy.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Contact</h2>
            <p>Questions about this policy? Reach us at <a href="mailto:info@scollarly.com" className="text-blue-600 hover:underline">info@scollarly.com</a> or on WhatsApp at <a href="https://wa.me/237651232301" className="text-blue-600 hover:underline">+237 651 232 301</a>.</p>
          </section>
        </div>

        <div className="mt-16 pt-8 border-t border-neutral-200 text-sm text-neutral-500">
          <Link href="/" className="hover:text-blue-600 transition-colors">← Back to Scollarly</Link>
          <span className="mx-4">·</span>
          <Link href="/terms-of-service" className="hover:text-blue-600 transition-colors">Terms of Service</Link>
        </div>
      </div>
    </div>
  );
}
