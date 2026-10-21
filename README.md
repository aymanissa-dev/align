# Align

[![CI](https://github.com/aymanissa-dev/align/actions/workflows/ci.yml/badge.svg)](https://github.com/aymanissa-dev/align/actions/workflows/ci.yml)

Align is a minimal project manager for projects, tasks, and notes. One Vercel project serves the Vite client and the Express API on the same domain.

## Layout

- `client/` — React, Vite, and Tailwind. Screens talk to `client/src/api`.
- `server/` — Express, Mongoose, and the integration tests.
- `api/index.js` — Vercel serverless entry, bundled from `server/src/vercel.ts` by `npm run build`.

The client uses the HTTP API by default. Set `VITE_API=mock` to use the localStorage mock instead (no database).

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

Set `JWT_SECRET` in `.env`. For a database, either set `MONGODB_URI` to MongoDB Atlas or use `MONGODB_URI=memory` for a temporary database that disappears when the API stops. Set `SEED_DEMO=true` to create the demo account the sign-in page offers:

- Email: `demo@align.app`
- Password: `password`

The API listens on port 3001. Vite listens on port 5173 and proxies `/api` to it, so open http://localhost:5173. The session cookie is httpOnly. It is marked `Secure` only when `NODE_ENV` is `production`, which keeps local http working.

Frontend only, against the mock:

```bash
# in .env
VITE_API=mock

npm run dev -w client
```

## Checks

```bash
npm test            # API unit and integration tests (Vitest, Supertest, replica set)
npm run test:coverage
npm run index-audit # fails when a hot query is not an index scan
npm run lint
npm run typecheck
npm run build       # client bundle plus api/index.js for Vercel
```

GitHub Actions runs lint, typecheck, coverage, and the index audit on every push to `main`.

## Deploy on Vercel

Use **one** project and import this repository. The project root has to be the repository root. If the Vercel root directory is set to `client`, the API is not deployed — change it to the repository root (`.` / empty).

| Setting | Value |
| --- | --- |
| Root Directory | Repository root (not `client`) |
| Framework Preset | Other |
| Install Command | `MONGOMS_DISABLE_POSTINSTALL=1 npm install` |
| Build Command | `npm run build` |
| Output Directory | `client/dist` |
| Node.js Version | 22.x (20.x also works) |

`vercel.json` already sets the install command, build command, output directory, `/api` rewrite, and the SPA fallback. Dashboard values for those three commands should match the table. Root directory is only configurable in the dashboard.

Environment variables (Production and Preview):

| Name | Value |
| --- | --- |
| `MONGODB_URI` | MongoDB Atlas connection string for the `align` database |
| `JWT_SECRET` | Long random string (`openssl rand -base64 48`) |

Do not set `VITE_API`. Do not set `SEED_DEMO` in production. Do not set `NODE_ENV` yourself — if it is `production` during install, npm skips the client build tools.

In Atlas, allow the Vercel functions to connect. The practical setting is Network Access `0.0.0.0/0`, because the functions do not have fixed IP addresses.

Sign-in has one failure policy: 10 wrong passwords in a 15-minute window, counted per IP and per account. Failures 3 through 10 only delay the 401 (250ms more each time, capped at 5 seconds). The 11th attempt is a 429 with `Retry-After` for the rest of that window, and a correct password clears the per-account counter. There is no separate account lock at five failures. Forgot-password is 5 per 15 minutes; password reset is 10. Other auth routes share a limit of 60 requests per 15 minutes. Authenticator and recovery sign-in allow 5 failures per 15 minutes, per account and per IP. Signup and password changes reject breached passwords (HIBP, 1.5s timeout, fail open). Login answers first and records a change-your-password notice in the background when the password is breached. The counters live in MongoDB. Optional `JWT_SECRET_PREVIOUS` (and `JWT_KID_PREVIOUS`) keeps the previous signing key valid during rotation. `RESEND_API_KEY` and `MAIL_FROM` stay unused until they are set. Until then, forgot-password still answers `200` with "If an account exists, we've sent a reset link" and does not create a usable token. Reset and verification tokens are never returned in a production response, on Vercel production, or without `EXPOSE_DEV_TOKENS=1` outside production. Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) stays unused until it is set. `WEBAUTHN_RP_ID` and `APP_ORIGIN` override the passkey relying party when the request host is not enough.

Registration limits are per IP only (5 per hour and 20 per day), with the same progressive delay as a wrong password. On Vercel every per-IP limit, including login failures, authenticator guesses, forgot-password, and the shared 60-request auth cap, uses the platform `x-real-ip` header (or the first `x-forwarded-for` entry when that header is absent). Those headers are ignored off Vercel, so a caller cannot change the bucket. The counters, including the auth-route cap, live in MongoDB and are shared across instances. While mail is not configured, signup still signs you in immediately. The response body stays generic, and both the new-account and duplicate paths hash the password so they take similar time. Full non-enumeration turns on automatically when Resend is configured (`RESEND_API_KEY` and `MAIL_FROM` both set). Register then always returns `202` with `{ "message": "Check your email to finish creating your account." }`, whether or not that address already has an account. A new address gets a verification link. An existing address gets a notice that someone tried to sign up with that email. Sign-in happens after verification.

## API

JSON bodies, no envelope. Errors are `{ "error": "..." }` and may include a `code`. Deletes return 204. The access session is a JWT in an httpOnly `Secure` (in production) `SameSite=Lax` cookie named `token` (15 minutes) and carries the workspace id, role, and membership version. A role change or removal bumps that version. The old access token then returns `401` `{ "code": "membership_changed" }`. The client calls `POST /api/auth/refresh` once and retries. If that workspace is gone, the page says you no longer have access to this workspace. A refresh cookie lasts 60 days, goes idle after 14 days, and rotates as a family. State-changing requests echo the readable `csrf` cookie in `X-CSRF-Token`. A database outage returns 503 with `Retry-After`.

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `PATCH /api/auth/me`, `POST /api/auth/password`, `DELETE /api/auth/me`
- `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `PATCH /api/projects/:id/archive`
- `GET/POST /api/projects/:id/tasks`, `PATCH/DELETE /api/tasks/:id`
- `GET/POST /api/projects/:id/notes`, `GET/PATCH/DELETE /api/notes/:id`, `GET /api/notes`
- `GET /api/dashboard`, `GET /api/search?q=`

Every query is scoped to the caller's workspace. Deleting a project or task moves it to trash for 30 days (`GET /api/trash`, restore under `/api/trash/.../restore`). Deleting an account removes that user's data in a transaction. Archive toggles `active` and `archived`. Workspaces have owner, admin, member, and viewer roles (`/api/workspaces`). A migration on connect moves existing documents into each user's personal workspace.
