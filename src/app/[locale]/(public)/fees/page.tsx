import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FeeTable, type FeeRowItem } from "@/components/public/fee-table";
import { pageMetadata } from "@/components/public/page-metadata";
import { feeDate } from "@/components/public/university-parts";
import { WhatsAppButton } from "@/components/public/whatsapp-button";
import { formatRange } from "@/modules/content/fees";
import { readCatalogue, readSite } from "@/modules/content/read";

// A4 /fees. Only universities with a confirmed fee show a range; the others say "Contact us" (FR-2).
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata((await params).locale, "fees");
}

export default async function FeesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, { universities }, { blocks }] = await Promise.all([getTranslations("fees"), readCatalogue(), readSite()]);

  const rows: FeeRowItem[] = universities.map((u) => ({
    slug: u.slug,
    name: u.name,
    lines: u.fees.map((line) => ({ id: line.id, currency: line.currency, range: formatRange(line), period: line.period, updated: feeDate(line) })),
  }));
  const currencies = [...new Set(universities.flatMap((u) => u.fees.map((line) => line.currency)))].sort();

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="lead">{t("intro")}</p>
      {rows.length > 0 ? (
        <FeeTable
          rows={rows}
          currencies={currencies}
          labels={{
            university: t("university"),
            fee: t("fee"),
            updated: t("updated", { date: "{date}" }),
            contactUs: t("contactUs"),
            filterCurrency: t("filterCurrency"),
            all: t("all"),
            disclaimer: blocks["fees.disclaimer"] ?? t("disclaimer"),
          }}
        />
      ) : (
        <p>{t("empty")}</p>
      )}
      <p className="cta-row">
        <WhatsAppButton context={{ page: "/fees" }} />
      </p>
    </>
  );
}
