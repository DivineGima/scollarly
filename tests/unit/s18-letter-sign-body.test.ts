import { describe, expect, it } from "vitest";
import { signLetterBody } from "@/modules/documents/schema";

/** What the browser's upload helper sends to `admin/documents.sign` (it always adds the file's type and size to the body). */
describe("the admin letter upload body", () => {
  it("accepts what the upload helper sends for a PDF", () => {
    expect(signLetterBody.safeParse({ studentId: "stu-1", kind: "offer_letter", contentType: "application/pdf", byteSize: 1234 }).success).toBe(true);
  });

  it("still accepts the body without a type (the endpoint signs a PDF either way)", () => {
    expect(signLetterBody.safeParse({ studentId: "stu-1", kind: "acceptance_letter", byteSize: 1234 }).success).toBe(true);
  });

  it("refuses a letter that is not a PDF, and a kind that is not a letter", () => {
    const image = signLetterBody.safeParse({ studentId: "stu-1", kind: "offer_letter", contentType: "image/png", byteSize: 10 });
    expect(image.success).toBe(false);
    expect(signLetterBody.safeParse({ studentId: "stu-1", kind: "results", contentType: "application/pdf", byteSize: 10 }).success).toBe(false);
  });
});
