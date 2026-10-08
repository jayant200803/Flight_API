// Tests the webhook handler end-to-end against the live Supabase project:
//  - POST stores events in call_events
//  - GET reads them back
//  - Supabase Realtime pushes new inserts (what the UI will subscribe to)
//
// Prereq: run supabase/migrations/0003_call_events.sql once, and have
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY in .env.
// Usage: node tests/webhook-test.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import handler from '../api/webhook.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

// minimal Express-like mock for the Vercel handler
function mockRes() {
  return {
    _status: 0, _json: null, _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
    end() { return this; },
  };
}
const callPost = async (body) => { const res = mockRes(); await handler({ method: 'POST', body }, res); return res; };
const callGet  = async (query) => { const res = mockRes(); await handler({ method: 'GET', query }, res); return res; };

const CALL = 'test-call-' + Date.now();
const REF = 'ABC123';

console.log('POST transcript + tool_call events...');
const r1 = await callPost({ call_id: CALL, booking_reference: REF, type: 'transcript', role: 'customer', text: 'Can I change my flight?' });
ok(r1._status === 200 && r1._json.ok && r1._json.event_id, 'customer transcript stored (event_id ' + r1._json?.event_id + ')');
const r2 = await callPost({ call_id: CALL, booking_reference: 'abc 1 2 3', type: 'tool_call', role: 'agent', text: 'Moving you to NS1156', name: 'change_flight' });
ok(r2._status === 200 && r2._json.ok, 'agent tool_call stored (ref cleaned from "abc 1 2 3")');

console.log('GET by call_id...');
const g = await callGet({ call_id: CALL });
ok(g._status === 200 && g._json.count === 2, 'GET returns the 2 events for this call');
ok(g._json.events[0].text === 'Can I change my flight?', 'first event text matches');
ok(g._json.events[1].booking_reference === 'ABC123', 'spoken ref "abc 1 2 3" was cleaned to ABC123');

console.log('Realtime — what the UI will subscribe to...');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const got = await new Promise(async (resolve) => {
  let done = false;
  const ch = sb.channel('rt-test-' + CALL)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_events', filter: `call_id=eq.${CALL}` },
        (p) => { if (!done) { done = true; resolve(p.new); } })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // small delay so the postgres_changes listener is fully attached
        setTimeout(() => callPost({ call_id: CALL, type: 'transcript', role: 'agent', text: 'You are now on NS1156.' }), 600);
      }
    });
  setTimeout(() => { if (!done) { done = true; resolve(null); } }, 12000);
  // keep ref to channel so it isn't GC'd
  globalThis.__ch = ch;
});
ok(got && got.text === 'You are now on NS1156.', 'Realtime pushed the new event live to a subscriber');

// cleanup this test's events
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
await admin.from('call_events').delete().eq('call_id', CALL);

console.log('\n=====================================================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? 'ALL WEBHOOK CHECKS PASSED ✓' : 'SOME CHECKS FAILED ✗');
process.exit(fail === 0 ? 0 : 1);
