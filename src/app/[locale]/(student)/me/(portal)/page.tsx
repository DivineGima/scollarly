import { setRequestLocale } from "next-intl/server";
import { ProgressPanel } from "@/components/student/progress-panel";

// A11. A shell with no data: the stage and the next step are read in the browser after the page loads.
export default async function MePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ProgressPanel />;
}
