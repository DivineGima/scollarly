'use client'

import { useTranslations } from 'next-intl'
import { whatsappUrl } from '@/lib/constants'

interface UniversityWhatsAppCTAProps {
  variant: 'homepage' | 'sidebar'
  universityName?: string
}

export function UniversityWhatsAppCTA({ variant, universityName }: UniversityWhatsAppCTAProps) {
  const t = useTranslations('WhatsAppCTA')
  const ctaUrl = variant === 'sidebar' && universityName
    ? whatsappUrl(t('sidebar_message', { universityName }))
    : whatsappUrl(t('default_message'))

  if (variant === 'sidebar') {
    return (
      <div className="border border-neutral-200 rounded-2xl p-5">
        <p className="font-semibold text-neutral-900 text-sm mb-1">{t('title')}</p>
        <p className="text-neutral-500 text-xs leading-relaxed mb-4">{t('body')}</p>
        <a
          href={ctaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors text-xs"
        >
          📱 {t('button')}
        </a>
      </div>
    )
  }

  // homepage variant — full-width, fits inside dark Section (bg-neutral-950)
  return (
    <div className="mt-10 bg-neutral-900 border border-neutral-800 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center gap-5">
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-white text-base mb-1">{t('title')}</p>
        <p className="text-neutral-400 text-sm leading-relaxed">{t('body')}</p>
      </div>
      <a
        href={ctaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 inline-flex items-center justify-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors text-sm whitespace-nowrap"
      >
        📱 {t('button')}
      </a>
    </div>
  )
}
