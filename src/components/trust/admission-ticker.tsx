'use client'

import { useTranslations } from 'next-intl'
import { admissionStats } from '@/data/trust-data'

interface AdmissionTickerProps {
  stats: typeof admissionStats
}

export function AdmissionTicker({ stats }: AdmissionTickerProps) {
  const t = useTranslations('Trust')

  const tickerText = t('ticker_text', { count: stats.totalStudents, year: stats.academicYear })
  const tickerSubtext = t('ticker_subtext', { countries: stats.countries.join(', ') })

  const tickerContent = (
    <span className="inline-flex items-center gap-10 px-10">
      <span className="font-semibold">{tickerText}</span>
      <span className="text-blue-400 select-none">·</span>
      <span className="text-neutral-400">{tickerSubtext}</span>
      <span className="text-blue-400 select-none">·</span>
    </span>
  )

  return (
    <div className="bg-neutral-950 border-t border-b border-neutral-800 py-3 overflow-hidden">
      <style>{`
        @keyframes scollarly-ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .scollarly-ticker-track {
          animation: scollarly-ticker 28s linear infinite;
          will-change: transform;
        }
        .scollarly-ticker-track:hover {
          animation-play-state: paused;
        }
      `}</style>
      <div
        className="scollarly-ticker-track flex whitespace-nowrap text-sm text-neutral-300"
        aria-live="off"
        aria-label={tickerText}
      >
        {tickerContent}
        {tickerContent}
      </div>
    </div>
  )
}
