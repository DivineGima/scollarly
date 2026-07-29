'use client'

import { useTranslations } from 'next-intl'
import { whatsappUrl } from '@/lib/constants'
import type { StudentJourney } from '@/data/trust-data'

interface StudentJourneyTimelineProps {
  journey: StudentJourney
}


export function StudentJourneyTimeline({ journey }: StudentJourneyTimelineProps) {
  const t = useTranslations('Trust')
  const ctaUrl = whatsappUrl('Hi, I want to start my journey to India. Can you help?')

  return (
    <section className="py-20 md:py-28 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <span className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold tracking-wide uppercase mb-4 bg-blue-100 text-blue-800">
            {t('results_badge')}
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-neutral-900 mb-3">
            {t('timeline_title')}
          </h2>
          <p className="text-neutral-600 text-lg max-w-xl mx-auto">
            {t('timeline_subtitle')}
          </p>
          <div className="flex justify-center mt-4">
            <div className="h-1 w-16 bg-gradient-to-r from-blue-500 to-blue-400 rounded-full" />
          </div>
        </div>

        {/* Student header */}
        <div className="flex items-center gap-3 justify-center mb-10">
          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-sm select-none">
            {journey.studentInitials.split('.')[0]}
          </div>
          <div className="text-sm">
            <span className="font-semibold text-neutral-900">{journey.studentInitials}</span>
            <span className="text-neutral-500 ml-2">
              {journey.countryFlag} {journey.country} · {journey.course} · {journey.university}
            </span>
          </div>
        </div>

        {/* ── Desktop: horizontal timeline ── */}
        <div className="hidden lg:block mb-10">
          {/* Dot row with connecting lines */}
          <div className="flex items-center mb-4">
            {journey.steps.map((step, i) => (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <div className="w-9 h-9 rounded-full bg-green-500 border-4 border-green-100 flex items-center justify-center shrink-0 text-white text-xs font-bold shadow-sm">
                  ✓
                </div>
                {i < journey.steps.length - 1 && (
                  <div className="flex-1 h-0.5 bg-green-200 mx-1" />
                )}
              </div>
            ))}
          </div>
          {/* Label row */}
          <div className="flex">
            {journey.steps.map((step, i) => (
              <div
                key={i}
                className="flex-1 pr-3 last:pr-0"
                style={{ maxWidth: `${100 / journey.steps.length}%` }}
              >
                <div className="font-semibold text-neutral-900 text-xs leading-snug mb-1">
                  {step.label}
                </div>
                <div className="text-neutral-500 text-xs leading-relaxed">
                  {step.description}
                </div>
                {step.proof && (
                  <span className="inline-block mt-1.5 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                    {step.proof === 'offer_letter' ? t('proof_offer_letter') : step.proof === 'visa' ? t('proof_visa') : t('proof_arrival')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Mobile: vertical timeline ── */}
        <div className="lg:hidden space-y-0 mb-10">
          {journey.steps.map((step, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-green-500 border-4 border-green-100 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm">
                  ✓
                </div>
                {i < journey.steps.length - 1 && (
                  <div className="w-0.5 flex-1 bg-green-200 min-h-8 my-1" />
                )}
              </div>
              <div className="pb-6">
                <div className="font-semibold text-neutral-900 text-sm mb-1">
                  {step.label}
                </div>
                <div className="text-neutral-500 text-sm leading-relaxed">
                  {step.description}
                </div>
                {step.proof && (
                  <span className="inline-block mt-1.5 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                    {step.proof === 'offer_letter' ? t('proof_offer_letter') : step.proof === 'visa' ? t('proof_visa') : t('proof_arrival')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center">
          <a
            href={ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-8 h-12 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20 transition-all duration-300 hover:-translate-y-0.5"
          >
            {t('timeline_cta')} →
          </a>
        </div>
      </div>
    </section>
  )
}
