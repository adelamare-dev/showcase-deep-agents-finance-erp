# Postgres archive (not wired)

These files are **not wired into the app**. Nothing in `src/` or `agent/` imports them, `tsconfig.json` and `eslint.config.mjs` exclude this folder, and the demo needs no database: the agent service keeps its data in memory and the web UI reads it through `GET /api/erp/snapshot`.

They are kept for the day a private, persistent copy of the demo is built. **Adapt before use.**

| File | What it is |
|---|---|
| `docker-compose.yml` | Local Postgres 16 that loads `seed.sql` at first start. |
| `seed.sql` | Schema only (no data rows): the demo data lives in `agent/erp_seed.py`, and a second copy here would be a second truth. |
| `db.ts` | A `postgres` (porsager) client driven by `DATABASE_URL`. The `postgres` package is no longer a dependency. |
| `db-seed.ts` | The former server-side dashboards table and its templates. The templates now live in `src/content/dashboard-templates.ts`. |

## Deriving a private repository from this public one

A fork of a public repository stays public, and a template repository loses the link with the original. Instead, mirror it:

```bash
git clone --bare https://github.com/<you>/<this-repo>.git
cd <this-repo>.git
git push --mirror https://github.com/<you>/<private-repo>.git
cd .. && rm -rf <this-repo>.git

git clone https://github.com/<you>/<private-repo>.git
cd <private-repo>
git remote add upstream https://github.com/<you>/<this-repo>.git
git remote set-url --push upstream DISABLE
# later: git fetch upstream && git merge upstream/main
```

## Adding persistence in the private repository

- Use **psycopg 3** with an `AsyncConnectionPool` opened in the FastAPI lifespan.
- Replace `MemorySaver` with `AsyncPostgresSaver`. This is not a one-line parameter swap: the saver is created inside an `async with` block and needs `await saver.setup()` once.
- Have the store in `agent/erp_store.py` read and write through the pool, keeping its derived values (totals, KPIs, aging) computed on read.
- Revisit the types in `seed.sql`: amounts are `FLOAT` there, while the store holds whole dollars as integers.
