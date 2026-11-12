# VERITAS deployment checklist: Vercel + Convex + Clerk (University of San Agustin)

Production serves **verified `@usa.edu.ph` Google accounts only**, through Clerk. Work top to bottom; every step has a check.

## 0. What you need

| Account | Used for |
| --- | --- |
| Clerk (production instance) | Google sign-in, issues the JWT Convex trusts |
| Convex (production deployment) | database, functions, file storage |
| Vercel | hosts the Next.js app |
| Google Workspace admin (`usa.edu.ph`) | optional but recommended: OAuth consent screen set to *Internal* |

## 1. Clerk

1. Create a **Production** instance (not Development).
2. *User & Authentication → SSO connections*: enable **Google**; disable email/password and every other provider.
3. *Configure → Restrictions → Allowlist*: add `usa.edu.ph`.
4. Recommended: custom Google OAuth credentials from a Google Cloud project inside the Workspace, consent screen **Internal**.
5. *Configure → JWT templates → New → Convex* (template name must be `convex`). It carries `email` and `email_verified`; the backend rejects tokens without a verified `@usa.edu.ph` email.
6. Note two values: the **Publishable key** (`pk_live_…`) and the **Frontend API URL** (`https://clerk.<your-domain>`, the JWT issuer).

No Clerk middleware and no `CLERK_SECRET_KEY` are needed: the app is static and offline-first, and all protected data goes through Convex.

## 2. Convex (production)

Dashboard → your project → **Production** deployment → *Settings → Environment Variables*:

| Variable | Value | Notes |
| --- | --- | --- |
| `OMR_AUTH_PROVIDERS` | `[{"domain":"https://clerk.<your-domain>","applicationID":"convex"}]` | Clerk only. See "Production guardrail" below. |
| `OMR_ENV` | `production` | Makes the guardrail explicit (it also fails closed without it). |
| `OMR_ALLOWED_EMAIL_DOMAINS` | `usa.edu.ph` | Default; comma-separate to add a staging domain. Matches exactly: sub-domains are refused. |
| `OMR_AUTO_JOIN` | `teacher` | Role given automatically to a verified `@usa.edu.ph` account the first time it opens VERITAS: `teacher` (default), `viewer`, or `off` (admins add people by hand). VERITAS is single-institution: the workspace “University of San Agustin • Iloilo City” is created and joined automatically, there is no school picker. |
| `DEFAULT_ADMIN_EMAILS` | `dean@usa.edu.ph,edtech@usa.edu.ph` | Comma/space separated. These people become **admin of every school** on sign-in (and of schools created later), so someone can open `/admin` on day one. Never demotes an owner. |

Then create a **production deploy key** (*Settings → URL & Deploy Key → Generate Production Deploy Key*). You will paste it into Vercel as `CONVEX_DEPLOY_KEY`.

Via CLI instead of the dashboard:

```bash
npx convex env set --prod OMR_AUTH_PROVIDERS '[{"domain":"https://clerk.<your-domain>","applicationID":"convex"}]'
npx convex env set --prod OMR_ENV production
npx convex env set --prod DEFAULT_ADMIN_EMAILS 'dean@usa.edu.ph,edtech@usa.edu.ph'
```

### Production guardrail (already built in)

`scripts/dev-auth.mjs` mints tokens from a throwaway key pair for local development. It can never work in production:

- `convex/auth.config.ts` drops the dev issuer (`https://omr-dev-auth.local`), every `customJwt` provider and any non-HTTPS provider whenever the deployment is production (`NODE_ENV=production`, `OMR_ENV=production`, or any non-local deployment that has not declared `OMR_ENV=development`). If nothing valid remains, nobody can sign in (fail closed). A blocked provider is logged as `[omr-auth] Blocked …` in the Convex logs.
- `convex/lib/access.ts` additionally refuses any token whose issuer is the dev issuer.
- `scripts/dev-auth.mjs` exits when `NODE_ENV`, `OMR_ENV`, `CONVEX_DEPLOYMENT` or `CONVEX_DEPLOY_KEY` point at production.
- The Next.js app ignores `NEXT_PUBLIC_OMR_AUTH=dev` in production builds.

A **cloud development** deployment that uses dev tokens must say so: `node scripts/dev-auth.mjs setup | sh` sets `OMR_ENV=development` for you.

## 3. Vercel

1. Import the GitHub repo (`mjbadorable/omr-grade-engine`), framework **Next.js**.
2. *Settings → Build & Development*: **Build Command** `npx convex deploy --cmd 'npm run build'` (also set in `vercel.json`; builds without `CONVEX_DEPLOY_KEY`, such as previews, fall back to a plain `npm run build` and run local-first). Install command and output directory stay default.
3. *Settings → Environment Variables*:

| Variable | Environments | Value |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | Production | the **production** deploy key from step 2 |
| `CONVEX_DEPLOY_KEY` | Preview (optional) | a **preview** deploy key: every preview gets its own throwaway Convex backend |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Production | `pk_live_…` from step 1 |
| `NEXT_PUBLIC_OMR_AUTH` | none | leave **unset** |
| `NEXT_PUBLIC_CONVEX_URL` | none | set automatically by `convex deploy` for the build |

   `npx convex deploy` pushes `convex/` (schema, functions, auth config) to the production deployment, then runs `npm run build` with `NEXT_PUBLIC_CONVEX_URL` pointing at it, so code and backend always ship together.
4. Deploy. The first build also runs `npm run vendor` (copies OpenCV.js into `public/vendor`).

## 4. Smoke test (10 minutes, a real faculty account)

- [ ] `https://<app>/designer` loads while signed out (local-first works).
- [ ] Top-right **Sign in (@usa.edu.ph)** → Google with a **non**-`@usa.edu.ph` account is refused with a clear message.
- [ ] Sign in with a `@usa.edu.ph` account: your name, a role badge (Teacher / Admin / Owner) and the avatar appear top right on every page; the active-exam chip says “Synced workspace” once an exam exists.
- [ ] A `DEFAULT_ADMIN_EMAILS` account sees **Admin** in the nav and can open `/admin`; an ordinary teacher cannot (and `/admin` shows "Admins only").
- [ ] Drop a real syllabus PDF in `/designer`; the review panel lists POs, COs and 9 modules.
- [ ] Design a sheet and print it (or open Scan): it is saved to the workspace automatically and stays the active exam. Scan 3 sheets on a phone (camera mode), open `/grade`: sheets appear within seconds, the **Outcomes** tab shows CO cards.
- [ ] Toggle airplane mode, edit an answer key and correct one answer: the header badge reads **Saved Offline · Queued for Sync (2)**; turn it off: **All Changes Synced** and the edits are on the server.
- [ ] Convex dashboard → Logs shows no `[omr-auth] Blocked` lines (if it does, remove the offending provider from `OMR_AUTH_PROVIDERS`).

## 5. Field calibration with real sheets (before the pilot)

Print the designer's sample PDF on the school's actual printer and paper, fill it with the pencils/pens teachers will really use, and photograph on the phones they own.

1. `/scan` → open **Scanner calibration**, enable **Calibration mode** (scans are analysed but never saved or uploaded) and **Diagnostic overlay**.
2. Scan 10 sheets per pencil/pen type. On each, check: green rings on every intended answer, no yellow rings on clean marks, `Ref. marks found` ≥ 90 %, `Contrast` ≥ 0.25.
3. Faint #2 pencil missed? choose the **Faint #2 pencil** preset (or lower *Ink level*) and **Rescan with these settings**. Smudges read as answers? use **Dark ballpoint**.
4. Use **Export JSON** on a few sheets and keep them with the batch notes; tuning is remembered per browser.
5. Camera mode warns before capture: *Too Dark* (use the torch button or move), *Glare Detected* (tilt the phone), *Hold Steady — Align all 4 corners*.

## 6. Rollback

Vercel → *Deployments* → promote the previous deployment. Convex schema changes in this release are additive (optional fields and new indexes), so the previous frontend keeps working against the new backend.
