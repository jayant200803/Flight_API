// Runs the full 6-scene journey against your live Supabase project.
// Usage:  npm install  &&  cp .env.example .env  (fill values)  &&  npm test
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY in .env'); process.exit(1); }
const sb = createClient(url, key);

const call = async (fn, args) => {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
};
const assert = (cond, msg) => { if (!cond) { console.error('  FAIL:', msg); process.exitCode = 1; } else console.log('  ok  :', msg); };

const REF = 'ABC123';
console.log('Scene 1 - get booking');
let b = await call('get_booking', { p_ref: REF });
assert(b.flight.flight_number === 'NS1142', 'starts on NS1142');

console.log('Scene 2 - search flights');
const flights = await call('search_flights', { p_origin:'SIN', p_destination:'NRT', p_date:'2026-10-08', p_ref: REF });
const ns1156 = flights.find(f => f.flight_number === 'NS1156');
assert(ns1156 && Number(ns1156.price_delta) === -60, 'NS1156 is -60 EUR');

console.log('Scene 3 - change flight');
b = await call('change_flight', { p_ref: REF, p_new_flight_number: 'NS1156' });
assert(b.seat_number === null && Number(b.pricing.base_price) === 190, 'flight changed, seat cleared, base 190');

console.log('Scene 4 - change seat');
b = await call('change_seat', { p_ref: REF, p_new_seat_number: '6A' });
assert(b.seat_number === '6A', 'seat 6A selected');

console.log('Scene 5 - baggage + quote');
await call('change_baggage', { p_ref: REF, p_baggage_count: 2 });
const q = await call('quote_booking', { p_ref: REF });
assert(Number(q.total_change) === -15, 'quote total change is -15 EUR');

console.log('Scene 6 - confirm');
const c = await call('confirm_booking', { p_ref: REF });
assert(c.confirmation === 'confirmed' && c.boarding_pass_ref, 'confirmed with boarding pass');

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
