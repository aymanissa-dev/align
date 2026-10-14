# Align

Align is a minimal, distraction-free project management app for projects, tasks, and notes.

## Client

The frontend lives in `client/` (React, Vite, and Tailwind CSS). Every screen reads and writes through `client/src/api`, whose functions match the API routes in the build plan. Until `api/` exists, that module is a localStorage mock with fake auth. To use the real backend later, change the export in `client/src/api/index.ts` from `mockApi` to `httpApi`.

```bash
cd client
npm install
npm run dev
```

Open the URL Vite prints (http://localhost:5173). The first launch seeds a demo workspace:

- Email: `demo@align.app`
- Password: `password`

Register a new account if you want an empty workspace. Data stays in the browser under the `align.db.v1` localStorage key.

`npm run build` typechecks the client and writes a production bundle to `client/dist`.
