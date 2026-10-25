import * as z from "zod";
import { requiredText } from "@/lib/schemas/common";
import { INVITE_TOKEN_PATTERN } from "./service";

/** A 6-digit authenticator code, or a recovery code with its dashes. The service normalises it. */
export const codeBody = z.strictObject({ code: requiredText(64) });
export type CodeBody = z.infer<typeof codeBody>;

export const inviteCheckBody = z.strictObject({ token: z.string().regex(INVITE_TOKEN_PATTERN) });
