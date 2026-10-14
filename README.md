# Align

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
npm test   # API integration tests (Vitest, Supertest, mongodb-memory-server)
npm run lint
npm run build   # client bundle plus api/index.js for Vercel
```

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

Auth routes that accept a password (`register`, `login`, `password`) are limited to 20 requests per 15 minutes per IP. The limit is kept in the function instance, so it resets on a cold start.

## API

JSON bodies, no envelope. Errors are `{ "error": "..." }`. Deletes return 204. The session is a JWT in an httpOnly cookie named `token`, expiring in 7 days.

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `PATCH /api/auth/me`, `POST /api/auth/password`, `DELETE /api/auth/me`
- `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `PATCH /api/projects/:id/archive`
- `GET/POST /api/projects/:id/tasks`, `PATCH/DELETE /api/tasks/:id`
- `GET/POST /api/projects/:id/notes`, `GET/PATCH/DELETE /api/notes/:id`, `GET /api/notes`
- `GET /api/dashboard`, `GET /api/search?q=`

Every query is scoped to the signed-in user. Deleting a project deletes its tasks and notes. Deleting an account deletes all of that user's data. Archive toggles `active` and `archived`.
