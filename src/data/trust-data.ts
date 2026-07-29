export interface JourneyStep {
  day: number;
  label: string;
  description: string;
  proof?: 'offer_letter' | 'visa' | 'arrival_photo';
}

export interface StudentJourney {
  studentInitials: string;
  country: string;
  countryFlag: string;
  course: string;
  university: string;
  steps: JourneyStep[];
}

export const admissionStats = {
  totalStudents: 9,
  academicYear: '2024–2025',
  countries: ['Cameroon', 'Ghana', 'Senegal', 'Guinea', 'Ivory Coast'],
  lastUpdated: '2026-06-01',
}

export const studentJourneys: StudentJourney[] = [
  {
    studentInitials: 'D.G.F.',
    country: 'Cameroon',
    countryFlag: '🇨🇲',
    course: 'B.Tech Computer Science',
    university: 'Chandigarh University',
    steps: [
      {
        day: 1,
        label: 'First contact with Scollarly',
        description: 'Sent the first WhatsApp message to Scollarly asking about Indian universities.',
      },
      {
        day: 7,
        label: 'Documents submitted',
        description: 'Submitted academic transcripts, passport copy, and supporting documents.',
      },
      {
        day: 21,
        label: 'Offer letter received',
        description: 'Received the official offer letter from the university.',
        proof: 'offer_letter',
      },
      {
        day: 30,
        label: 'Visa application submitted',
        description: 'Student visa application submitted to the Indian High Commission.',
      },
      {
        day: 45,
        label: 'Visa approved',
        description: 'Indian student visa approved and passport returned.',
        proof: 'visa',
      },
      {
        day: 60,
        label: 'Arrived in India',
        description: 'Landed in India and began university orientation. ✈️',
        proof: 'arrival_photo',
      },
    ],
  },
]

export const proofAssets = {
  offerLetterSample: '/proof/offer-letter-sample.webp',
}
