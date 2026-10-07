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

---

## 3. Endpoints

| Function | Purpose | Arguments |
|---|---|---|
| `get_booking` | Retrieve current booking | `p_ref` |
| `search_flights` | Search flights by route/date | `p_origin`, `p_destination`, `p_date`, `p_ref` |
| `change_flight` | Change flight (clears seat) | `p_ref`, `p_new_flight_number` |
| `get_seat_map` | Seat map for a flight | `p_flight_number` |
| `change_seat` | Select a seat | `p_ref`, `p_new_seat_number` |
| `change_baggage` | Set number of bags (1 incl., €45/extra) | `p_ref`, `p_baggage_count` |
| `quote_booking` | Itemised price change vs last confirmed | `p_ref` |
| `confirm_booking` | Lock booking, issue boarding pass | `p_ref` |

### Error handling
Errors return **HTTP 200** with an `{ "error": "..." }` body. Always check for an `error` key.
Possible values: `booking_not_found`, `flight_not_found`, `seat_not_found`, `seat_unavailable`, `min_one_bag`.

---

## 4. Demo data

- Booking reference: **NS7K2Q** (Ingrid Solberg)
- Route: **OSL → LHR**, date **2026-10-01** (Thu)
- Starts on **NS1142**, seat **23C**, **€250**
- Flights: `NS1156` cheapest (−€60), `NS1150` (−€35), `NS1180` (−€20, low availability), `NS1120` sold out, `NS1134` at 09:40
- Seat surcharges: window €0 · front rows (1–2) €15 · emergency rows (12–13) €25
- Re-run `supabase/seed.sql` to reset to this starting state.

---

## 5. Example requests & responses

### get_booking
```bash
curl -X POST "https://ogxttimsdjgahwpzzjyv.supabase.co/rest/v1/rpc/get_booking" \
  -H "apikey: sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW" \
  -H "Authorization: Bearer sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW" \
  -H "Content-Type: application/json" \
  -d '{"p_ref":"NS7K2Q"}'
```
```json
{
  "booking_reference": "NS7K2Q",
  "status": "confirmed",
  "passenger_name": "Ingrid Solberg",
  "flight": { "flight_number": "NS1142", "origin": "OSL", "destination": "LHR",
              "departure_time": "2026-10-01T14:05:00", "arrival_time": "2026-10-01T15:50:00",
              "aircraft": "Boeing 787-9" },
  "seat_number": "23C",
  "baggage_count": 1,
  "pricing": { "base_price": 250.00, "seat_surcharge": 0.00, "baggage_charge": 0.00,
               "total_price": 250.00, "currency": "EUR" },
  "boarding_pass_ref": null
}
```

### search_flights
```bash
curl -X POST ".../rpc/search_flights" -H ...headers... \
  -d '{"p_origin":"OSL","p_destination":"LHR","p_date":"2026-10-01","p_ref":"NS7K2Q"}'
```
```json
[
  { "flight_number": "NS1156", "departure_time": "2026-10-01T20:30:00",
    "arrival_time": "2026-10-01T22:15:00", "base_fare": 190.00,
    "price_delta": -60.00, "available_seats": 111, "stops": 0 }
  // ...5 more flights. NS1120 has available_seats: 0 (sold out).
]
```

### change_flight → change_seat → change_baggage → quote → confirm
```jsonc
// change_flight  body: {"p_ref":"NS7K2Q","p_new_flight_number":"NS1156"}  → base 190, seat cleared
// change_seat    body: {"p_ref":"NS7K2Q","p_new_seat_number":"6A"}        → window, €0 surcharge
// change_baggage body: {"p_ref":"NS7K2Q","p_baggage_count":2}             → +€45
// quote_booking  body: {"p_ref":"NS7K2Q"}
//   → { "flight_change": -60, "seat_change": 0, "baggage_change": 45, "total_change": -15, "currency": "EUR" }
// confirm_booking body: {"p_ref":"NS7K2Q"}
//   → { "confirmation": "confirmed", "boarding_pass_ref": "BP-NS7K2Q-NS1156", "crm_synced": true, "email_sent": true }
```

---

## 6. Typical agent flow

1. `get_booking(p_ref)` — show current trip
2. `search_flights(p_origin, p_destination, p_date, p_ref)` — offer options with price deltas
3. `change_flight(p_ref, p_new_flight_number)` — move to chosen flight (seat is cleared)
4. `get_seat_map(p_flight_number)` → `change_seat(p_ref, p_new_seat_number)` — pick a seat
5. `change_baggage(p_ref, p_baggage_count)` → `quote_booking(p_ref)` — show the price change
6. `confirm_booking(p_ref)` — lock it in, boarding pass issued
