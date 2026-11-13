# VERITAS (`omr-grade-engine`) — Project Instructions

## Code & App Security Guardrails (Layer 1 - Always Active When Coding)
- **Default-Deny Auth:** In `middleware.ts`, protect all routes by default (`clerkMiddleware`). Only explicitly allowlist public routes. *(Note: if a static/offline-first architecture intentionally omits Clerk middleware, every protected backend endpoint must still fail closed on `ctx.auth.getUserIdentity()`.)*
- **Server-Side Identity & Scoping (Convex / Supabase):** Never trust `userId` or `role` passed from the client in `args` or body. Always derive identity via `await ctx.auth.getUserIdentity()` (or Supabase `auth.uid()` / `getUser()`) and scope every query/mutation to that verified ID.
- **Strict Validation (No Mass Assignment):** Every Convex function MUST define strict `args` validators (`convex/values`, never `v.any()`). Every Next.js API route/Server Action MUST validate inputs server-side with `Zod`.
- **Internal Functions & RBAC:** Use `internalMutation` / `internalAction` for backend-only jobs. Verify roles (admin/faculty/user) from the database per request—never from `localStorage` or unverified client state.
- **Secrets Isolation:** Never hardcode keys or prefix server secrets (Clerk secret, Convex deploy key, Supabase service role, LLM API keys) with `NEXT_PUBLIC_` or `VITE_`.
- **Uploads, Webhooks & Cost:** Keep private uploads out of `/public`, verify webhook signatures (`svix`/Stripe) before mutating state, and enforce persistent server-side rate limits on AI/expensive endpoints.

## Security Audit & Fix Triggers
- `/security-audit`: Run the two-pass read-only OWASP & Vibe-Coding security audit defined in `.claude/skills/security-audit/SKILL.md` (and `.claude/commands/security-audit.md`). Do not modify files during the audit until the remediation plan is approved.
- `/security-fix`: Apply approved fixes from the `/security-audit` remediation plan using Workflow B (Red-Green TDD + `typecheck` / `lint` / `test` / `build` verification).

