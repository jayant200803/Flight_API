# Webhook — live UI feed (hand-over)

A webhook for the real-time UI. It receives call/transcript events (from OneInbox
or the agent), stores them in the **same flight Supabase project** (new table
`call_events`), and the UI can read them or subscribe live via **Supabase Realtime**.

Nothing in the existing flight API changes — this is purely additive.

---

## 1. Endpoint

```
https://flight-api-gold.vercel.app/api/webhook
```

### Send an event — POST
Point OneInbox's webhook (or anything) at the URL. Send **any JSON**; the webhook
stores the full body and also extracts common fields if present:

| Stored column | Picked from any of | Notes |
|---|---|---|
| `call_id` | call_id, callId, conversation_id, session_id, id | groups events of one call |
| `booking_reference` | booking_reference, booking_ref, p_ref, ref | cleaned → upper, no spaces (`"a b c 1 2 3"` → `ABC123`) |
| `event_type` | event_type, type, event, name | e.g. transcript / tool_call / call_started / call_ended |
| `role` | role, speaker, sender | agent / customer / system |
| `text` | text, message, transcript, content, utterance | the spoken line |
| `payload` | *(the entire body)* | nothing is lost |

Example:
```bash
curl -X POST https://flight-api-gold.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"call_id":"call_123","booking_reference":"ABC123","type":"transcript","role":"customer","text":"Can I change my flight?"}'
# -> { "ok": true, "event_id": 42, "created_at": "..." }
```

### Read events — GET (for testing / replay)
```
GET /api/webhook?call_id=call_123
GET /api/webhook?booking_reference=ABC123
GET /api/webhook?call_id=call_123&limit=100
# -> { "count": N, "events": [ ...oldest first... ] }
```

---

## 2. Live feed for the UI — Supabase Realtime

The UI subscribes to inserts on `call_events` (no polling):

```js
import { createClient } from '@supabase/supabase-js';
const sb = createClient(
  'https://ogxttimsdjgahwpzzjyv.supabase.co',
  'sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW'   // publishable key (browser-safe)
);

sb.channel('call-feed')
  .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'call_events',
        filter: 'call_id=eq.call_123' },        // or booking_reference=eq.ABC123
      ({ new: evt }) => {
        // evt = { event_id, call_id, booking_reference, event_type, role, text, payload, created_at }
        renderTranscriptLine(evt);
      })
  .subscribe();
```

The **left panel** (booking/seat state) can likewise subscribe to Realtime on the
existing `bookings` tables, or just re-call `get_booking` after each agent action.

---

## 3. Setup (one-time)

1. **DB**: run `supabase/migrations/0003_call_events.sql` once (creates `call_events`,
   RLS read policy, Realtime). Additive — does not affect existing tables/functions.
2. **Vercel env var**: in the project → Settings → Environment Variables, add
   `SUPABASE_SERVICE_ROLE_KEY` = the service_role secret. The webhook uses it
   server-side to write events (never exposed to the browser).

## 4. Test

```
npm run test:webhook     # POST -> store -> GET -> Realtime push (uses .env)
```
