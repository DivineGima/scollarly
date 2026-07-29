'use client'

import { useTranslations } from 'next-intl'
import { whatsappUrl } from '@/lib/constants'
import type { University } from '@/data/universities'

interface FeeStructureSectionProps {
  feeStructure: University['feeStructure']
  universityName: string
}

function formatCurrency(amount: number, currency: 'INR' | 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

function checkFeeDataStaleness(lastUpdated: string, universityName: string) {
  if (process.env.NODE_ENV !== 'development') return
  const updated = new Date(lastUpdated)
  const daysDiff = (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24)
  if (daysDiff > 180) {
    console.warn(
      `[FeeStructure] Fee data for "${universityName}" was last updated ${Math.floor(daysDiff)} days ago. Please verify it's still accurate.`
    )
  }
}

function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-neutral-100 last:border-0">
      <span className="text-neutral-600 text-sm">{label}</span>
      <span className="text-neutral-900 font-semibold text-sm text-right shrink-0">{value}</span>
    </div>
  )
}

export function FeeStructureSection({ feeStructure, universityName }: FeeStructureSectionProps) {
  const t = useTranslations('UniversityPage')

  checkFeeDataStaleness(feeStructure.lastUpdated, universityName)

  if (!feeStructure.dataConfirmed) {
    const message = `Hi, I need a personalised fee breakdown for ${universityName}. Can you help?`
    return (
      <section>
        <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('fee_structure_title')}</h2>
        <div className="border border-neutral-200 rounded-2xl p-6 bg-neutral-50">
          <p className="font-semibold text-neutral-900 mb-2">{t('fee_data_unavailable_title')}</p>
          <p className="text-neutral-600 text-sm mb-5 leading-relaxed">{t('fee_data_unavailable_body')}</p>
          <a
            href={whatsappUrl(message)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            📱 {t('fee_data_unavailable_button')}
          </a>
        </div>
      </section>
    )
  }

  const fmt = (n: number) => formatCurrency(n, feeStructure.currency)
  const perYear = t('fee_per_year')
  const fullCourse = t('fee_for_full_course')

  return (
    <section>
      <h2 className="text-2xl font-bold text-neutral-900 mb-4">{t('fee_structure_title')}</h2>
      <div className="border border-neutral-200 rounded-2xl overflow-hidden">
        <div className="px-6 pt-6 pb-3">
          <FeeRow
            label={`${t('fee_tuition_label')} (${perYear})`}
            value={`${fmt(feeStructure.tuitionPerYear.min)} – ${fmt(feeStructure.tuitionPerYear.max)}`}
          />
          <FeeRow
            label={`${t('fee_hostel_label')} (${perYear})`}
            value={`${fmt(feeStructure.hostelPerYear.min)} – ${fmt(feeStructure.hostelPerYear.max)}`}
          />
          {feeStructure.registrationFee !== undefined && (
            <FeeRow
              label={t('fee_registration_label')}
              value={fmt(feeStructure.registrationFee)}
            />
          )}
          <FeeRow
            label={`${t('fee_total_label')} (${fullCourse})`}
            value={`${fmt(feeStructure.totalCourseRange.min)} – ${fmt(feeStructure.totalCourseRange.max)}`}
          />
          <FeeRow
            label={t('fee_scholarship_label')}
            value={feeStructure.scholarshipAvailable}
          />
        </div>
        <div className="bg-amber-50 border-t border-amber-200 px-6 py-4">
          <p className="text-amber-800 text-xs leading-relaxed">
            {t('fee_disclaimer')}{' '}
            <a
              href={whatsappUrl(`Hi, I need a personalised fee breakdown for ${universityName}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline hover:text-amber-900"
            >
              Contact Scollarly →
            </a>
          </p>
        </div>
      </div>
    </section>
  )
}
