'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'

interface VerifiedTestimonialCardProps {
  name: string
  country: string
  countryFlag: string
  university: string
  course: string
  year: number
  quote: string
  verified: boolean
}

const AVATAR_COLORS = [
  'bg-blue-600',
  'bg-purple-600',
  'bg-green-600',
  'bg-orange-600',
  'bg-teal-600',
]

function getAvatarColor(name: string): string {
  const index = name.charCodeAt(0) % AVATAR_COLORS.length
  return AVATAR_COLORS[index]
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function VerifiedTestimonialCard({
  name,
  country,
  countryFlag,
  university,
  course,
  year,
  quote,
  verified,
}: VerifiedTestimonialCardProps) {
  const t = useTranslations('Trust')

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-6 hover:border-blue-300 hover:shadow-lg transition-all duration-300 flex flex-col h-full">
      <div className="flex items-center gap-4 mb-5">
        <div
          className={`w-12 h-12 ${getAvatarColor(name)} rounded-full flex items-center justify-center text-white font-bold text-base shrink-0 select-none`}
          aria-label={`${name} avatar`}
        >
          {getInitials(name)}
        </div>
        <div>
          <div className="font-semibold text-neutral-900">{name}</div>
          <div className="text-xs text-neutral-500">
            {countryFlag} {country}
          </div>
        </div>
      </div>

      <blockquote className="text-neutral-700 text-sm leading-relaxed flex-1 mb-5 italic">
        &ldquo;{quote}&rdquo;
      </blockquote>

      <div className="pt-4 border-t border-neutral-100 space-y-2">
        <div className="text-xs text-neutral-500">{course}</div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
            {t('studying_at', { university, year })}
          </div>
          {verified && (
            <Badge variant="outline" className="text-green-400 border-green-400 text-xs">
              {t('verified_badge')}
            </Badge>
          )}
        </div>
      </div>
    </div>
  )
}
