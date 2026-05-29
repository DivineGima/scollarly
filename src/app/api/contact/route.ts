import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendConfirmationEmail, sendAgencyNotification } from "@/lib/email";

// In-memory rate limit: 5 submissions per IP per hour
const rateLimit = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many inquiries. Please try again in an hour or contact us on WhatsApp." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, email, phone, message, country } = body;

    if (!name || name.trim().length < 2) {
      return NextResponse.json(
        { error: "Please enter your full name." },
        { status: 400 }
      );
    }
    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }
    if (!message || message.trim().length < 10) {
      return NextResponse.json(
        { error: "Please enter a message of at least 10 characters." },
        { status: 400 }
      );
    }

    const submission = await db.contactSubmission.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone?.trim() || null,
        message: message.trim(),
        country: country?.trim() || null,
      },
    });

    // Fire emails without blocking the response on failure
    await Promise.allSettled([
      sendConfirmationEmail(submission.email, submission.name),
      sendAgencyNotification({
        name: submission.name,
        email: submission.email,
        phone: submission.phone ?? undefined,
        message: submission.message,
        country: submission.country ?? undefined,
      }),
    ]);

    return NextResponse.json(
      { success: true, message: "Your inquiry has been received." },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again or contact us on WhatsApp." },
      { status: 500 }
    );
  }
}
