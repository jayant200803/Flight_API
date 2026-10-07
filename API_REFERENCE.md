# API Reference — Flight Booking Voice Agent (Supabase)

All logic runs as PostgreSQL functions exposed through Supabase's auto REST layer.
There is **no separate server**. The AI agent and the frontend call each function by POST.

## How to call

```
POST  {SUPABASE_URL}/rest/v1/rpc/{function_name}
Headers:
  apikey: {SUPABASE_ANON_KEY}
  Authorization: Bearer {SUPABASE_ANON_KEY}
  Content-Type: application/json
Body: JSON object of the arguments (see each function)
```

With `supabase-js`:  `supabase.rpc('function_name', { ...args })`

| PRD endpoint | Function | Arguments |
|---|---|---|
| GET /bookings/{ref} | `get_booking` | `p_ref` |
| GET /flights/search | `search_flights` | `p_origin, p_destination, p_date, p_ref` |
| PATCH /bookings/{ref}/flight | `change_flight` | `p_ref, p_new_flight_number` |
| GET /flights/{id}/seats | `get_seat_map` | `p_flight_number` |
| PATCH /bookings/{ref}/seat | `change_seat` | `p_ref, p_new_seat_number` |
| POST /bookings/{ref}/quote | `quote_booking` | `p_ref` |
| POST /bookings/{ref}/confirm | `confirm_booking` | `p_ref` |
| (helper) add/remove baggage | `change_baggage` | `p_ref, p_baggage_count` |

### Notes for the agent/frontend teams
- All money is EUR. Baggage: 1 bag included, each extra bag = EUR 45.
- `change_flight` clears the seat selection (seat must be re-picked on the new flight).
- `quote_booking` returns `{flight_change, seat_change, baggage_change, total_change}` measured against the last **confirmed** state. A negative total means a refund/saving.
- `confirm_booking` locks the booking, issues a boarding pass reference, and marks CRM + email (email/PDF are stubs for the demo).
- Errors return `{ "error": "...", ... }` with HTTP 200, so always check for an `error` key.

### Demo data
- Booking reference: **NS7K2Q** (Ingrid Solberg), starts on NS1142, seat 23C, EUR 250.
- Route matches the demo video: **OSL -> LHR on 2026-10-01** (Thu). Search with `p_origin='OSL', p_destination='LHR', p_date='2026-10-01'`.
- Flights: NS1156 is cheapest (-60), NS1150 is -35, NS1180 is -20 (low availability), NS1120 is sold out, NS1134 departs 09:40.
