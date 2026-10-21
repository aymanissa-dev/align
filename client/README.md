# Align client

React, Vite, and Tailwind frontend for Align. See the repository README for how to run it with the API.

```bash
npm install
npm run dev
```

`npm run build` typechecks and writes `dist/`.

The UI reads `VITE_API` from the repo-root `.env`. Leave it unset to use the API. Set `VITE_API=mock` to use the localStorage mock (an empty workspace in the browser, with no seeded account).
