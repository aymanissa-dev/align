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

Auth routes that accept a password are limited per IP and per account (login 10 per 15 minutes in production). Extra attempts inside the window are delayed, then rejected with `Retry-After`. The counters live in MongoDB. Optional `JWT_SECRET_PREVIOUS` (and `JWT_KID_PREVIOUS`) keeps the previous signing key valid during rotation. `RESEND_API_KEY` and Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) stay unused until they are set. `WEBAUTHN_RP_ID` and `APP_ORIGIN` override the passkey relying party when the request host is not enough.

## API

JSON bodies, no envelope. Errors are `{ "error": "..." }`. Deletes return 204. The access session is a JWT in an httpOnly `Secure` (in production) `SameSite=Lax` cookie named `token` (15 minutes). A refresh cookie lasts 60 days, goes idle after 14 days, and rotates as a family. State-changing requests echo the readable `csrf` cookie in `X-CSRF-Token`. A database outage returns 503 with `Retry-After`.

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `PATCH /api/auth/me`, `POST /api/auth/password`, `DELETE /api/auth/me`
- `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `PATCH /api/projects/:id/archive`
- `GET/POST /api/projects/:id/tasks`, `PATCH/DELETE /api/tasks/:id`
- `GET/POST /api/projects/:id/notes`, `GET/PATCH/DELETE /api/notes/:id`, `GET /api/notes`
- `GET /api/dashboard`, `GET /api/search?q=`

Every query is scoped to the caller's workspace. Deleting a project or task moves it to trash for 30 days (`GET /api/trash`, restore under `/api/trash/.../restore`). Deleting an account removes that user's data in a transaction. Archive toggles `active` and `archived`. Workspaces have owner, admin, member, and viewer roles (`/api/workspaces`). A migration on connect moves existing documents into each user's personal workspace.
