# Stage 2 runbook: authentication, roles and the admin shell

Built against `essentials/system_architecture_essential_1.md`, `system_architecture_1.md` and `PRD_1.md` (all version 1). Module status is in `tracker/tracker_1.md`. Stage 2 is **built and tested locally; it is not complete**: CI has not run, the migration is not applied to the live database, and the real Google sign-in has not been measured on the deployed Worker (see "What is left").

## What Stage 2 added

| Module | Where |
|---|---|
| S2.1 Production Neon Auth behind the facade | Unchanged facade (`src/server/auth/facade.ts`). New: `src/server/edge/landing.ts` (`GET /auth/landing`), `src/server/edge/mutations.ts` (the mutation router), `src/server/edge/endpoint-env.ts`, `src/server/edge/validate.ts`, wiring in `src/server/edge/authed-runtime.ts` and `worker/index.ts` |
| S2.2 Sign-in and sign-out pages | `src/app/[locale]/(auth)/sign-in`, `sign-out`; islands in `src/components/auth/`; the sign-in button is a plain link to `/auth/start` |
| S2.3 Owner bootstrap, 2FA, step-up | Bootstrap in `landing.ts`; endpoints in `src/modules/auth/endpoints.ts`; pages `(auth)/two-factor/enrol` and `verify`; `regenerateRecoveryCodes` in `src/server/auth/second-factor.ts`; the step-up prompt in `src/components/admin/step-up.tsx` |
| S2.4 `Actor` and role guards | `Access` rules in `mutations.ts` (`denyAccess`), the `auth` area in `src/server/edge/authed.ts`, the owner-is-permanent trigger in migration 0004 |
| S2.5 Invites and Team | `src/modules/team/`, `src/server/repositories/team.ts`, `(auth)/accept-invite/[token]`, `src/components/admin/team-panel.tsx` |
| S2.6 Admin shell | `src/app/[locale]/(admin)/admin/` (layout, Overview, Profile, Team, Audit, Security), `src/components/admin/`, Tailwind in `admin.css` only |
| S2.7 Audit log | `src/server/repositories/audit.ts` (`auditEntry` joins a change's transaction; `writeAudit` stands alone), `src/modules/audit/`, `audit-panel.tsx` |

Migration `0004_stage2_auth.sql` (additive): a unique index (one open invite per email), the owner-is-permanent trigger on `app_user`, and SECURITY DEFINER functions `app_invite_status`, `app_accept_invite`, `app_remove_admin`, `app_list_team`, `app_profile`, `app_set_profile_name`, `app_my_sessions`, `app_revoke_other_sessions`, `app_scrub_session_pii`, plus a trigger on `neon_auth.session` that blanks the IP address and browser string (flag F13).

## The sign-in path

```
/sign-in  --link-->  /auth/start[?invite=T]  -->  Google  -->  Neon Auth  -->  /auth/return[?invite=T]
   --sets the session cookie-->  /auth/landing[?invite=T]
        no session            -> /sign-in?error=failed
        invite=T              -> accept (verified email must match) -> /admin, or /accept-invite/T?error=1
        student               -> /me
        admin                 -> /admin
        OWNER_EMAIL, no owner -> becomes the owner -> /two-factor/enrol
        owner, not verified   -> /two-factor/verify (or /enrol if no authenticator is confirmed)
        owner, verified       -> /admin
```

`/auth/landing` also clears the IP address and browser string Neon Auth stored on the new session (F13).

## Endpoints added

| Endpoint | Who | Notes |
|---|---|---|
| `GET /api/v1/auth/two-factor-status` | the owner account | `{enrolled, pending, verified, stepUpFresh}` |
| `POST /api/v1/auth/twoFactor.begin`, `.confirm`, `.verify`, `.recovery` | the owner account (2FA not required) | wrong code `400` with `fields.code` `INVALID_CODE` or `CODE_ALREADY_USED`; lockout `429` with `Retry-After: 900`; already enrolled `409` |
| `POST /api/v1/invites/check` | anyone, rate limited (20 a minute) | `{status:"open", email}` or `{status:"unusable"}`, never a reason |
| `GET /api/v1/admin/session` | admin, owner | role (effective), name, email, step-up state: drives the menu |
| `POST /api/v1/admin/profile.setName`, `.signOutOthers` | admin, owner | |
| `GET /api/v1/admin/team`, `/audit`, `/security` | owner (2FA verified) | `403` for anyone else; the database refuses them too |
| `POST /api/v1/admin/team.invite` | owner, fresh 2FA | the link is in this response only; also "Resend" |
| `POST /api/v1/admin/team.revokeInvite` | owner | |
| `POST /api/v1/admin/team.removeAdmin` | owner, fresh 2FA | one transaction: role, sessions, leads, audit |
| `POST /api/v1/admin/security.regenerateRecoveryCodes` | owner, fresh 2FA | |
| `POST /api/v1/admin/security.signOutEverywhere` | owner | keeps this session |

A request that needs a fresh 2FA check and has none gets `403` with code `STEP_UP_REQUIRED`; the admin screens then ask for a code and repeat the call.

## Adding the next screen

1. A data call goes in the module's `endpoints.ts` (a function of `(actor, call)`) and is added to `authedDeps` in `authed-runtime.ts`. A mutation is a `Mutation` with its `Access` and is added to `mutationDeps`.
2. A page under `src/app/[locale]/(admin)/admin/` renders a client panel. One line in `NAV` in `admin-shell.tsx` adds the menu item.
3. Strings go in `messages/en.json` and `fr.json` under `admin`.
4. Add the operation to `IMPLEMENTED` in `tests/integration/authz-matrix.test.ts`.
5. Add a CPU row (shell and data call, at most 8 ms each) to the tracker after the next deploy.

## What is left before Stage 2 can be called complete

These are the exit criteria that need something this session cannot do. None was marked done.

1. **CI** must pass on the pull request (lint, typecheck, unit, integration on Postgres 16, the Worker build and its size gate, Lighthouse, Playwright). The OpenNext build fails silently on Windows, so the Worker bundle size was **not** checked locally.
2. **Apply migration 0004** with the owner role (`npm run db:migrate`). Because it adds a trigger to Neon's own `neon_auth.session`, try it first on a throwaway Neon branch (`neon branches create`, point `MIGRATION_DATABASE_URL` at it, migrate, sign in once, check `select "ipAddress","userAgent" from neon_auth.session` is null, delete the branch). A read-only check on 2026-10-24 showed the migration role may update and add triggers to that table. If the trigger cannot be created, the migration prints a notice and `/auth/landing` still clears the columns after each sign-in.
3. **Deploy and sign in once for real** with the Worker log open: record the CPU of `/auth/return` and `/auth/landing` (gate 10 ms) and whether Google accepted the `workers.dev` redirect (it did in Stage 0).
4. **Owner first sign-in** with the address in `OWNER_EMAIL`: it should land on `/two-factor/enrol`. This is a human step.
5. **Measure** the shell and data call of the new screens and the mutation endpoints (invite, remove): each at most 8 ms warm p95. Nothing is measured yet.
6. The Playwright specs answer the edge endpoints with `page.route`, because `next start` has no Worker entry. What proves the endpoints is `tests/integration/stage2-auth.test.ts`; what proves the screens is `tests/e2e/stage2-auth.spec.ts`. A deploy smoke test of both together is part of S11.7.

## Known limits and follow-ups

- **Navigating between admin screens is a full page load** (cached shell plus data call), as ADR-040 chose. A smoother way is Stage 5.
- The owner who has not passed 2FA gets a plain `404` if they type `/admin` by hand (the shell is for admins only, by design); the sign-in landing sends them to the right page.
- `/accept-invite/[token]` is rendered per request (`force-dynamic`), so no cache entry holds a secret address. It costs a Next.js render, which is acceptable for a page opened once per invite.
- The sign-out page deletes nothing in the browser yet. The offline progress snapshot is a Stage 8 item (S8.1), which must delete it from `SignOutRunner`.
- The audit page shows an email only for people still on the team; a removed admin appears as "Former team member" with the id kept in the data.
- French text for Stage 2 is unreviewed by a native speaker, like the rest of `fr.json`; `fr` is not an active locale.
- Dialogs use the browser's `<dialog>` element instead of Radix, to avoid a dependency. The shadcn/ui pattern (`cva`, `cn`) is otherwise followed.
