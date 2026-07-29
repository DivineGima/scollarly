'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { PlayCircle } from 'lucide-react'
import { whatsappUrl } from '@/lib/constants'
import type { University } from '@/data/universities'

interface CampusExperienceProps {
  campusExperience: University['campusExperience']
  universityName: string
}

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/

function isValidYouTubeId(id: string): boolean {
  return YOUTUBE_ID_REGEX.test(id)
}

function checkUrlStaleness(urlLastChecked: string, label: string) {
  if (process.env.NODE_ENV !== 'development') return
  const daysDiff = (Date.now() - new Date(urlLastChecked).getTime()) / (1000 * 60 * 60 * 24)
  if (daysDiff > 90) {
    console.warn(
      `[CampusExperience] URL for "${label}" was last checked ${Math.floor(daysDiff)} days ago. Please verify it is still valid.`
    )
  }
}

export function CampusExperience({ campusExperience, universityName }: CampusExperienceProps) {
  const [videoLoaded, setVideoLoaded] = useState(false)
  const t = useTranslations('UniversityPage')

  checkUrlStaleness(campusExperience.urlLastChecked, campusExperience.label)

  if (campusExperience.type === 'coming_soon') {
    const message = t('campus_photos_request_message', { universityName })
    return (
      <section>
        <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('campus_experience_title')}</h2>
        <div className="border border-neutral-200 rounded-2xl p-6 bg-neutral-50">
          <p className="font-semibold text-neutral-900 mb-2">📸 {t('campus_photos_request_title')}</p>
          <p className="text-neutral-600 text-sm mb-5 leading-relaxed">{t('campus_photos_request_body')}</p>
          <a
            href={whatsappUrl(message)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            📱 {t('campus_photos_request_button')}
          </a>
        </div>
      </section>
    )
  }

  if (campusExperience.type === 'youtube') {
    const youtubeId = campusExperience.youtubeId ?? ''
    const isValid = isValidYouTubeId(youtubeId)

    if (!isValid) {
      const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(universityName + ' campus tour')}`
      return (
        <section>
          <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('campus_experience_title')}</h2>
          <div className="border border-neutral-200 rounded-2xl p-6 bg-neutral-50">
            <a
              href={fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 font-medium text-sm"
            >
              {t('campus_youtube_fallback_link', { universityName })}
            </a>
          </div>
        </section>
      )
    }

    return (
      <section>
        <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('campus_experience_title')}</h2>
        <div className="border border-neutral-200 rounded-2xl overflow-hidden">
          {videoLoaded ? (
            <div className="aspect-video w-full">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
                title={`${universityName} campus tour`}
                className="w-full h-full"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setVideoLoaded(true)}
              className="relative w-full aspect-video bg-gradient-to-br from-neutral-800 to-neutral-950 flex flex-col items-center justify-center gap-4 group hover:from-neutral-700 hover:to-neutral-900 transition-all duration-200 cursor-pointer"
              aria-label={`Play ${universityName} campus tour`}
            >
              <PlayCircle className="w-16 h-16 text-white/70 group-hover:text-white group-hover:scale-110 transition-all duration-200" />
              <div className="text-center px-4">
                <p className="text-white font-semibold text-sm">{t('campus_watch_button')}</p>
                <p className="text-white/50 text-xs mt-1">{campusExperience.label}</p>
              </div>
            </button>
          )}
        </div>
      </section>
    )
  }

  // iframe_360 — opens in a new tab (safest for cross-origin 360° tours)
  if (!campusExperience.iframeUrl) {
    const message = t('campus_photos_request_message', { universityName })
    return (
      <section>
        <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('campus_experience_title')}</h2>
        <div className="border border-neutral-200 rounded-2xl p-6 bg-neutral-50">
          <p className="font-semibold text-neutral-900 mb-2">📸 {t('campus_photos_request_title')}</p>
          <p className="text-neutral-600 text-sm mb-5 leading-relaxed">{t('campus_photos_request_body')}</p>
          <a
            href={whatsappUrl(message)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            📱 {t('campus_photos_request_button')}
          </a>
        </div>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('campus_experience_title')}</h2>
      <div className="border border-neutral-200 rounded-2xl overflow-hidden">
        <a
          href={campusExperience.iframeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex w-full aspect-video bg-gradient-to-br from-blue-900 to-blue-950 flex-col items-center justify-center gap-4 group hover:from-blue-800 hover:to-blue-900 transition-all duration-200 cursor-pointer"
          aria-label={`Explore ${universityName} 360° campus tour`}
        >
          <span className="text-6xl select-none">🌐</span>
          <div className="text-center px-4">
            <p className="text-white font-semibold text-sm">{t('campus_explore_360_button')}</p>
            <p className="text-white/50 text-xs mt-1">{campusExperience.label}</p>
          </div>
        </a>
      </div>
    </section>
  )
}
