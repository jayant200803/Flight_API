# Integration Guide — Flight Booking Voice Agent API

This is the single reference for integrating the backend into the AI agent / frontend.

---

## 1. The two links (read this first)

| Link | What it is | Who uses it |
|---|---|---|
| `https://flight-api-gold.vercel.app` | **Swagger UI** — interactive explorer for testing/docs | Humans, in a browser |
| `https://flight-api-gold.vercel.app/openapi.json` | **OpenAPI 3.0 spec** — import this to auto-generate tools | Agent builder / Postman |
| `https://ogxttimsdjgahwpzzjyv.supabase.co/rest/v1` | **The actual API base** — where data is fetched at runtime | The AI agent |

> ⚠️ **The agent does NOT call the Vercel link at runtime.** The Vercel site only hosts the
> Swagger explorer and the spec. All real requests go to the **Supabase base URL** below.

---

## 2. How to call every endpoint

- **Method:** always `POST`
- **URL:** `https://ogxttimsdjgahwpzzjyv.supabase.co/rest/v1/rpc/{function_name}`
- **Body:** JSON object of arguments
- **Headers (all three required):**

```
apikey: sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW
Authorization: Bearer sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW
Content-Type: application/json
```

> The key above is the **publishable** key — safe for the frontend/agent (tables are protected
> by Row Level Security). Never put the service_role secret key in the agent or frontend.

With `supabase-js`:  `supabase.rpc('function_name', { ...args })`

> **Inputs are case-insensitive:** booking reference, flight number, seat number and airport codes all match regardless of case — `abc123`, `ABC123`, `ns1156`, `6a` all work.
>
> **Booking refs are also cleaned for voice:** spaces and punctuation are stripped before matching, so `"a b c 1 2 5"`, `"abc-125"`, `"ABC 125"` all resolve to `ABC125`.

---

## 3. Endpoints

| Function | Purpose | Arguments |
|---|---|---|
| `get_booking` | Retrieve current booking | `p_ref` |
| `search_flights` | Search flights by route/date | `p_origin`, `p_destination`, `p_date`, `p_ref` *(optional)* |
| `change_flight` | Change flight (clears seat) | `p_ref`, `p_new_flight_number` |
| `get_seat_map` | Seat map; pass `p_summary_only=true` for summary only (agent), default `false` = full 180-seat grid (UI) | `p_flight_number`, `p_summary_only` *(opt, default false)* |
| `get_seat_options` | Seat summary only (no seats array) — alias of `get_seat_map` summary mode | `p_flight_number` |
| `change_seat` | Select a seat | `p_ref`, `p_new_seat_number` |
| `change_baggage` | Set number of bags (1 incl., €45/extra) | `p_ref`, `p_baggage_count` |
| `quote_booking` | Itemised price change vs last confirmed | `p_ref` |
| `confirm_booking` | Lock booking, issue boarding pass | `p_ref` |
| `reset_demo` | Reset ALL demo bookings (ABC123..ABC134) to the start state | *(none)* |

### Response shapes to note (voice-agent friendly)
- **`search_flights`** returns an **object**: `{ count, cheapest_flight_number, cheapest_base_fare, cheapest_price_delta, flights: [...] }`. The list is under `flights`. **`p_ref` is optional** — with it, cheapest = lowest `price_delta` (excluding the current flight) and each flight has a `price_delta`; without it, cheapest = lowest `base_fare`, `cheapest_price_delta` is `null`, and every flight's `price_delta` is `null`.
- **Voice agent: call `get_seat_map` with `p_summary_only: true`** to offer seats — returns only `{ flight_number, total, available_count, available_window_seats, available_aisle_seats, available_middle_seats }` (no seats array), a tiny reply so agent platforms that cap response parsing still read the fields. The **UI** calls it with the default (`p_summary_only` omitted / false) to get the full 180-seat grid. (`get_seat_options` is a no-arg-flag alias that always returns the summary.)
- **`get_seat_map`** returns an **object**: `{ flight_number, total, available_count, available_window_seats, available_aisle_seats, available_middle_seats, available_front_row_seats, available_emergency_row_seats, seats: [...] }`. The two extra-legroom lists cover front rows 1–5 (+€15) and emergency/exit rows 12–13 (+€25). The seat list is under `seats`; the `available_*_seats` fields are comma strings of the first 10 free seats of each type, **FREE (€0) listed first** (so the agent offers 6A/6F before any €15 front-row seat). Seat types are **window** (A/F), **aisle** (C/D), **middle** (B/E), **emergency_row** (rows 12–13). Middle seats appear only in `available_middle_seats`, never in the aisle list.
- **Any change re-opens the booking:** `change_flight` / `change_seat` / `change_baggage` set `status` to `pending` and clear `boarding_pass_ref` until `confirm_booking` runs again.

### Error handling
Errors return **HTTP 200** with an `{ "error": "..." }` body. Always check for an `error` key.
Possible values: `booking_not_found`, `flight_not_found`, `already_on_flight` (changing to the current flight), `seat_not_found`, `seat_unavailable`, `min_one_bag`, `no_seat_selected` (confirm with no seat).

---

## 4. Demo data

- Booking references: **ABC123 … ABC134** — 12 identical bookings (Shivam Sharma). **Use a fresh reference for each demo/tester** so runs don't collide. Each starts the same (NS1142, €250, 1 bag, confirmed) with its own aisle seat (ABC123 = 23C, ABC124 = 23D, …).
- Route: **SIN → NRT**. The demo booking is on **2026-10-08** (Thu); flights are seeded for **2026-10-08 → 2026-10-21**, so the agent can search any date in that range (8 Oct is the canonical demo day; other days have normal availability and their own flight numbers).
- Starts on **NS1142**, seat **23C**, **€250**
- Flights: `NS1156` cheapest (−€60), `NS1150` (−€35), `NS1180` (−€20, low availability), `NS1120` sold out, `NS1134` at 09:40
- Seat surcharges: window €0 · front rows (1–5) €15 · emergency rows (12–13) €25
- Re-run `supabase/seed.sql` to reset to this starting state.

---

## 5. Example requests & responses

### get_booking
```bash
curl -X POST "https://ogxttimsdjgahwpzzjyv.supabase.co/rest/v1/rpc/get_booking" \
  -H "apikey: sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW" \
  -H "Authorization: Bearer sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW" \
  -H "Content-Type: application/json" \
  -d '{"p_ref":"ABC123"}'
```
```json
{
  "booking_reference": "ABC123",
  "status": "confirmed",
  "passenger_name": "Shivam Sharma",
  "flight": { "flight_number": "NS1142", "origin": "SIN", "destination": "NRT",
              "departure_time": "2026-10-08T14:05:00", "arrival_time": "2026-10-08T15:50:00",
              "aircraft": "Boeing 787-9" },
  "seat_number": "23C",
  "seat_type": "aisle",
  "baggage_count": 1,
  "baggage_weight_kg": 23,
  "pricing": { "base_price": 250.00, "seat_surcharge": 0.00, "baggage_charge": 0.00,
               "total_price": 250.00, "currency": "EUR" },
  "boarding_pass_ref": null
}
```

### search_flights
```bash
curl -X POST ".../rpc/search_flights" -H ...headers... \
  -d '{"p_origin":"SIN","p_destination":"NRT","p_date":"2026-10-08","p_ref":"ABC123"}'
```
```json
{
  "count": 6,
  "cheapest_flight_number": "NS1156",
  "cheapest_base_fare": 190.00,
  "cheapest_price_delta": -60,          // null when called without p_ref
  "flights": [
    { "flight_number": "NS1156", "departure_time": "2026-10-08T20:30:00",
      "arrival_time": "2026-10-08T22:15:00", "base_fare": 190.00,
      "price_delta": -60.00, "available_seats": 111, "stops": 0 }
      // price_delta is null for every flight when no p_ref is passed.
    // ...5 more flights. NS1120 has available_seats: 0 (sold out).
  ]
}
```

### get_seat_map (response shape)
```json
{
  "flight_number": "NS1156",
  "total": 180,
  "available_count": 111,
  "available_window_seats": "6A, 6F, 7A, 7F, ...",   // FREE first, then €15 front rows
  "available_aisle_seats": "6C, 6D, 7C, ...",          // only C/D (true aisle)
  "available_middle_seats": "6B, 6E, 7B, ...",         // B/E
  "seats": [ { "seat_number": "6A", "row_number": 6, "column_letter": "A",
               "seat_type": "window", "status": "available", "base_price_delta": 0 } ]
}
```

### change_flight → change_seat → change_baggage → quote → confirm
```jsonc
// change_flight  body: {"p_ref":"ABC123","p_new_flight_number":"NS1156"}  → base 190, seat cleared
// change_seat    body: {"p_ref":"ABC123","p_new_seat_number":"6A"}        → window, €0 surcharge
// change_baggage body: {"p_ref":"ABC123","p_baggage_count":2}             → +€45
// quote_booking  body: {"p_ref":"ABC123"}
//   → { "flight_change": -60, "seat_change": 0, "baggage_change": 45, "total_change": -15, "currency": "EUR" }
// confirm_booking body: {"p_ref":"ABC123"}
//   → { "confirmation": "confirmed", "boarding_pass_ref": "BP-ABC123-NS1156", "crm_synced": true, "email_sent": true }
```

---

## 6. Typical agent flow

1. `get_booking(p_ref)` — show current trip
2. `search_flights(p_origin, p_destination, p_date, p_ref)` — offer options with price deltas
3. `change_flight(p_ref, p_new_flight_number)` — move to chosen flight (seat is cleared)
4. `get_seat_map(p_flight_number)` → `change_seat(p_ref, p_new_seat_number)` — pick a seat
5. `change_baggage(p_ref, p_baggage_count)` → `quote_booking(p_ref)` — show the price change
6. `confirm_booking(p_ref)` — lock it in, boarding pass issued
