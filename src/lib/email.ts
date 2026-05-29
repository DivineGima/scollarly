export interface SubmissionData {
  name: string;
  email: string;
  phone?: string;
  message: string;
  country?: string;
}

export async function sendConfirmationEmail(to: string, name: string) {
  if (!process.env.RESEND_API_KEY) return;
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: 'Scollarly <info@scollarly.com>',
    to,
    subject: 'Your Scollarly inquiry has been received',
    html: `<p>Hi ${name}, we received your inquiry. WhatsApp: +237 651 232 301</p>`,
  });
}

export async function sendAgencyNotification(submission: SubmissionData) {
  if (!process.env.RESEND_API_KEY) return;
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: 'Scollarly Notifications <info@scollarly.com>',
    to: 'info@scollarly.com',
    subject: `New inquiry from ${submission.name}`,
    html: `<p>${submission.name} | ${submission.email} | ${submission.phone || ''} | ${submission.country || ''}</p><p>${submission.message}</p>`,
  });
}
