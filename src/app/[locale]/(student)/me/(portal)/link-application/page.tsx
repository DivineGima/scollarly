import { setRequestLocale } from "next-intl/server";
import { LinkForm } from "@/components/student/link-form";

// A12. Nothing is read here; the form only sends a request for an admin to confirm.
export default async function LinkApplicationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LinkForm />;
}
