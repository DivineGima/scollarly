'use client'

import { useTranslations } from 'next-intl'

interface InstagramCTAProps {
  handle: string
  url: string
}

export function InstagramCTA({ handle, url }: InstagramCTAProps) {
  const t = useTranslations('Trust')

  return (
    <section className="bg-neutral-50 border-t border-neutral-200 py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-md mx-auto text-center">
          <div
            className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center text-3xl"
            style={{
              background: 'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
            }}
          >
            📸
          </div>
          <h3 className="text-xl font-bold text-neutral-900 mb-1">
            {t('instagram_title')}
          </h3>
          <p className="text-neutral-500 text-sm mb-6 font-medium">{handle}</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-7 py-3 font-semibold rounded-xl text-white text-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
            style={{
              background: 'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
            }}
          >
            {t('instagram_cta')} →
          </a>
        </div>
      </div>
    </section>
  )
}
