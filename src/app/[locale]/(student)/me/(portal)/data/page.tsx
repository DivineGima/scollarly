import { setRequestLocale } from "next-intl/server";
import { DataPanel } from "@/components/student/data-panel";

// A13 steps 2 and 3. Nothing is read here; the data is made on request, and the erasure is a request the student confirms.
export default async function DataPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DataPanel />;
}
