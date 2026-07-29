'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'

interface OfferLetterProofProps {
  imageSrc: string
  universityName: string
}

export function OfferLetterProof({ imageSrc, universityName }: OfferLetterProofProps) {
  const t = useTranslations('Trust')

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden hover:border-blue-300 hover:shadow-lg transition-all duration-300 flex flex-col h-full">
      <div className="relative w-full aspect-[3/4] bg-neutral-100">
        <Image
          src={imageSrc}
          alt={`Offer letter for a ${universityName} student, personal details blurred for privacy`}
          fill
          className="object-contain"
          loading="lazy"
        />
      </div>
      <div className="p-5">
        <div className="inline-block px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold mb-2">
          🔒 {t('offer_letter_badge')}
        </div>
        <p className="text-neutral-500 text-xs leading-relaxed">
          {t('offer_letter_caption')}
        </p>
      </div>
    </div>
  )
}
