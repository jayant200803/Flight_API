# Flight Booking Voice Agent — Backend (Supabase)

Backend for the OneInbox flight booking voice-agent demo. It is **Supabase only**:
the database plus a set of PostgreSQL functions (RPC) that the AI agent and the
frontend call directly over Supabase's auto-generated REST API. No server to run.

Implements the 7 PRD endpoints (+ a baggage helper) and ships with seed data that
matches the demo scenes.

## What's inside
```
supabase/
  migrations/0001_schema.sql     tables + enums (flights, seats, customers, bookings, pricing)
  migrations/0002_functions.sql  the 7 RPC endpoints + helpers
  seed.sql                       demo data (booking ABC123, SIN->NRT flights, seat maps)
tests/
  api.http                       click-to-run requests (VS Code REST Client extension)
  smoke-test.mjs                 runs the full 6-scene journey and checks the numbers
API_REFERENCE.md                 how the agent/frontend call each function
```

## Setup (about 5 minutes)

### Option A — Supabase dashboard (simplest)
1. Open your Supabase project (you already have access).
2. Go to **SQL Editor** and run, in order:
   - `supabase/migrations/0001_schema.sql`
   - `supabase/migrations/0002_functions.sql`
   - `supabase/seed.sql`
3. Done. Grab your Project URL and anon key from **Project Settings -> API**.

### Option B — Supabase CLI (version controlled)
```
npm i -g supabase
supabase link --project-ref YOUR_PROJECT_REF
supabase db push          # applies migrations/
# then run seed.sql once via: supabase db execute --file supabase/seed.sql
```

## Test it
### In VS Code with the REST Client extension
Open `tests/api.http`, set `@baseUrl` and `@apikey` at the top, click **Send Request** on each.

### From the command line
```
cp .env.example .env     # fill SUPABASE_URL and SUPABASE_ANON_KEY
npm install
npm test                 # runs the full journey, prints ok/FAIL per check
```
Expected: all checks pass (NS1156 is -60, quote total is -15, booking confirms with a boarding pass).

Run the **full** suite (every PRD case + error paths, resets state automatically):
```
npm run test:full
```

## API Explorer (Swagger UI)

An interactive Swagger UI for all 8 endpoints lives in `public/`. Auth is pre-wired
with the publishable key, so anyone can open an endpoint, click **Try it out** → **Execute**.

### Preview locally
```
npx serve public        # or: python -m http.server 8080 --directory public
```
Open the printed URL.

### Deploy to Vercel
```
npm i -g vercel          # if not installed
vercel --prod            # from the project root; uses vercel.json (serves ./public)
```
`.vercelignore` keeps `.env`, `node_modules`, tests and SQL out of the deploy — only
the explorer ships. Hand the resulting URL to the integration team.

## The demo flow (what the agent does)
1. `get_booking('ABC123')` -> current booking (NS1142, 23C, EUR 250)
2. `search_flights('SIN','NRT','2026-10-08','ABC123')` -> 6 flights with price deltas
3. `change_flight('ABC123','NS1156')` -> moves to the cheaper flight, clears seat
4. `get_seat_map('NS1156')` then `change_seat('ABC123','6A')`
5. `change_baggage('ABC123',2)` then `quote_booking('ABC123')` -> {-60, 0, +45, -15}
6. `confirm_booking('ABC123')` -> locks booking, boarding pass, CRM sync

## Notes
- Money is EUR. 1 bag included; each extra bag EUR 45; demo change fee is 0.
- Access is locked down with Row Level Security; all reads/writes go through the
  SECURITY DEFINER functions, so the anon key is safe for the agent/frontend.
- Email sending and boarding-pass PDF are stubbed (flags in the confirm response).
  They can later become a Supabase Edge Function if real delivery is needed.
- Re-running `seed.sql` resets the demo to the starting state.
