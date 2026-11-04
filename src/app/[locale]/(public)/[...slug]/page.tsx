import { notFound } from "next/navigation";

/**
 * Any address no page answers ends here and takes the 404 page of this group (`../not-found.tsx`). Without it the unknown address got the
 * framework's bare default page, whose `<html>` has no `lang` attribute (WCAG 3.1.1), no header and no way back. Nothing is rendered here.
 */
export default function UnknownAddress(): never {
  notFound();
}
