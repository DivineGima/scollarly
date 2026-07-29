'use client'

import { useTranslations } from 'next-intl'
import { whatsappUrl } from '@/lib/constants'
import type { University } from '@/data/universities'

interface OfficialResourcesProps {
  officialResources: University['officialResources']
  universityName: string
}

export function OfficialResources({ officialResources, universityName }: OfficialResourcesProps) {
  const t = useTranslations('UniversityPage')

  return (
    <section>
      <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('official_resources_title')}</h2>
      <div className="border border-neutral-200 rounded-2xl p-6 bg-neutral-50 flex flex-col sm:flex-row gap-3">
        {officialResources.prospectusUrl ? (
          <a
            href={officialResources.prospectusUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            📄 {t('download_prospectus_button')}
          </a>
        ) : (
          <a
            href={whatsappUrl(
              t('request_course_details_message', { universityName })
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            📱 {t('request_course_details_button')}
          </a>
        )}
      </div>
    </section>
  )
}
