import { setRequestLocale } from "next-intl/server";
import { PaymentsPanel } from "@/components/admin/payments-panel";

// B9. A shell with no data: the totals, the list and the record form's choices are read in the browser after the page loads.
export default async function AdminPaymentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PaymentsPanel />;
}
