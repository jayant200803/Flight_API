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
| (helper) reset demo data | `reset_demo` | *(none)* |

> Full field-by-field details are in **INTEGRATION.md** and the Swagger explorer. Summary below.

### Notes for the agent/frontend teams
- All money is EUR. Baggage: 1 bag included, each extra bag = EUR 45.
- **Inputs are case-insensitive** — booking ref, flight number, seat number and airport codes match in any case (`abc123` = `ABC123`).
- **Booking refs tolerate voice input** — spaces/punctuation are stripped, so `"a b c 1 2 5"` and `"abc-125"` both resolve to `ABC125`.
- **`search_flights` returns an object:** `{ count, cheapest_flight_number, cheapest_base_fare, cheapest_price_delta, flights[] }`. `p_ref` is **optional**: with it, cheapest = lowest `price_delta` excluding the current flight; without it, cheapest = lowest `base_fare`, `cheapest_price_delta` is `null`, and every flight `price_delta` is `null`.
- **`get_seat_map` returns an object:** `{ flight_number, total, available_count, available_window_seats, available_aisle_seats, available_middle_seats, seats[] }`. Summary lists are FREE(€0)-first; seat types are window (A/F), aisle (C/D), middle (B/E), emergency_row (12–13). Middle seats are excluded from the aisle list.
- **`get_booking`** includes `seat_type` and `baggage_weight_kg` (23) alongside the pricing breakdown.
- **Any change re-opens the booking:** `change_flight` / `change_seat` / `change_baggage` set `status='pending'` and clear `boarding_pass_ref` until `confirm_booking` runs.
- `change_flight` clears the seat; changing to the current flight returns `already_on_flight` (seat kept).
- `quote_booking` returns `{flight_change, seat_change, baggage_change, total_change}` vs the last **confirmed** state. Negative total = saving.
- `confirm_booking` requires a seat (else `no_seat_selected`); locks the booking, issues a boarding pass, marks CRM + email (stubs).
- `reset_demo` restores all demo bookings (ABC123..ABC134) to the starting state.
- Errors return `{ "error": "...", ... }` with HTTP 200, so always check for an `error` key.
  Values: `booking_not_found`, `flight_not_found`, `already_on_flight`, `seat_not_found`, `seat_unavailable`, `min_one_bag`, `no_seat_selected`.

### Demo data
- Booking references: **ABC123 .. ABC134** (12 bookings, each a different passenger — ABC123 = Aarav Mehta) — use a fresh one per demo/tester. Each starts on NS1142, 1 bag, EUR 250, confirmed, own aisle seat (ABC123 = 23C).
- PRD route: **SIN -> NRT on 2026-10-08** (Thu). Search with `p_origin='SIN', p_destination='NRT', p_date='2026-10-08'`.
- Flights: NS1156 is cheapest (-60), NS1150 is -35, NS1180 is -20 (low availability), NS1120 is sold out, NS1134 departs 09:40.
- Seat surcharges: window €0, front rows 1–5 €15, emergency rows 12–13 €25.
