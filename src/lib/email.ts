import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export interface SubmissionData {
  name: string;
  email: string;
  phone?: string;
  message: string;
  country?: string;
}

export async function sendConfirmationEmail(to: string, name: string) {
  await resend.emails.send({
    from: 'Scollarly <info@scollarly.com>',
    to,
    subject: 'Your Scollarly inquiry has been received',
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
        <div style="background: #1e40af; padding: 32px; border-radius: 12px 12px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Your inquiry is in safe hands.</h1>
        </div>
        <div style="background: #f8fafc; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
          <p style="font-size: 16px; margin: 0 0 16px;">Hi <strong>${name}</strong>,</p>
          <p style="color: #475569; line-height: 1.6; margin: 0 0 16px;">
            Thank you for reaching out to Scollarly. We've received your inquiry and our team will get back to you within <strong>24 hours</strong>.
          </p>
          <p style="color: #475569; line-height: 1.6; margin: 0 0 24px;">
            In the meantime, if you have an urgent question, you can reach us directly on WhatsApp:
          </p>
          <a href="https://wa.me/237651232301" style="display: inline-block; background: #25d366; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
            📱 Chat on WhatsApp — +237 651 232 301
          </a>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;" />
          <p style="color: #94a3b8; font-size: 13px; margin: 0;">
            Scollarly · info@scollarly.com · Mohali, India<br/>
            Our services are 100% free. We are paid by universities when students enroll — not by you.
          </p>
        </div>
      </div>
    `,
  });
}

export async function sendAgencyNotification(submission: SubmissionData) {
  await resend.emails.send({
    from: 'Scollarly Notifications <info@scollarly.com>',
    to: 'info@scollarly.com',
    subject: `New inquiry from ${submission.name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
        <h2 style="color: #1e40af; margin: 0 0 24px;">New contact inquiry</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #64748b; width: 100px;">Name</td><td style="padding: 8px 0; font-weight: 600;">${submission.name}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Email</td><td style="padding: 8px 0;"><a href="mailto:${submission.email}">${submission.email}</a></td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Phone</td><td style="padding: 8px 0;">${submission.phone || 'Not provided'}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Country</td><td style="padding: 8px 0;">${submission.country || 'Not provided'}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b; vertical-align: top;">Message</td><td style="padding: 8px 0; line-height: 1.6;">${submission.message}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">Time</td><td style="padding: 8px 0;">${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' })} IST</td></tr>
        </table>
        <div style="margin-top: 24px;">
          <a href="https://wa.me/${submission.phone?.replace(/\D/g, '') || '237651232301'}" style="display: inline-block; background: #25d366; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin-right: 8px;">Reply on WhatsApp</a>
          <a href="mailto:${submission.email}" style="display: inline-block; background: #1e40af; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Reply by Email</a>
        </div>
      </div>
    `,
  });
}
