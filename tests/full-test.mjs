// =====================================================================
// Comprehensive test — exercises EVERY case described in the PRD docs
// against the live Supabase database, with real seeded data.
//
// Covers: all 6 demo scenes (happy path) + every documented edge case:
//   sold-out flight, low availability, seat surcharges (window/front/exit),
//   baggage pricing, quote math, confirm baseline reset, and all error paths
//   (booking_not_found, flight_not_found, seat_not_found, seat_unavailable,
//    min_one_bag, empty search).
//
// It RESETS booking ABC123 to the starting state first (via service role),
// so it is fully repeatable — run it as many times as you like.
//
// Usage:  node tests/full-test.mjs
// =====================================================================
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon) { console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY in .env'); process.exit(1); }
if (!svc) { console.error('Set SUPABASE_SERVICE_ROLE_KEY in .env (needed to reset state between runs)'); process.exit(1); }

const sb = createClient(url, anon);        // the agent/frontend role
const admin = createClient(url, svc);      // service role, for resetting state

const REF = 'ABC123';
let pass = 0, fail = 0;
const n = (v) => Number(v);

const call = async (fn, args) => {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn} transport error: ${error.message}`);
  return data;
};
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗ FAIL:', msg); }
};
const section = (t) => console.log('\n=== ' + t + ' ===');

// ---------- Reset the demo booking to its starting state ----------
async function reset() {
  const { data: b } = await admin.from('bookings').select('booking_id').eq('booking_reference', REF).single();
  const { data: f1142 } = await admin.from('flights').select('flight_id').eq('flight_number', 'NS1142').single();
  const bid = b.booking_id, fid = f1142.flight_id;
  // release every seat this booking currently holds (any flight)
  await admin.from('seats').update({ status: 'available', booking_id: null }).eq('booking_id', bid);
  // re-hold 23C on NS1142
  await admin.from('seats').update({ status: 'booked', booking_id: bid })
    .eq('flight_id', fid).eq('seat_number', '23C');
  // restore the booking row to the seeded starting values
  await admin.from('bookings').update({
    flight_id: fid, seat_number: '23C', baggage_count: 1, booking_status: 'confirmed',
    base_price: 250.00, seat_surcharge: 0.00, baggage_charge: 0.00, total_price: 250.00,
    orig_base_price: 250.00, orig_seat_surcharge: 0.00, orig_baggage_charge: 0.00,
    boarding_pass_ref: null
  }).eq('booking_id', bid);
}

console.log('Resetting demo booking to starting state...');
await reset();
await call('reset_demo', {});   // also guarantees NS1156: 23C booked, 6A/6F free

// ---------------------------------------------------------------
section('Error handling — get_booking');
let e = await call('get_booking', { p_ref: 'ZZZZZZ' });
ok(e.error === 'booking_not_found', 'unknown ref returns booking_not_found');

// ---------------------------------------------------------------
section('Scene 1 — retrieve current booking (NS1142 / 23C / EUR 250)');
let b = await call('get_booking', { p_ref: REF });
ok(b.flight.flight_number === 'NS1142', 'flight is NS1142');
ok(b.flight.origin === 'SIN' && b.flight.destination === 'NRT', 'route is SIN -> NRT');
ok(b.passenger_name === 'Aarav Mehta', 'ABC123 passenger is Aarav Mehta');
ok(b.seat_number === '23C', 'seat is 23C');
ok(b.seat_type === 'aisle', 'seat_type is aisle (col C)');
ok(n(b.pricing.base_price) === 250, 'base_price is 250');
ok(n(b.pricing.seat_surcharge) === 0, 'seat_surcharge is 0');
ok(n(b.pricing.baggage_charge) === 0, 'baggage_charge is 0');
ok(n(b.pricing.total_price) === 250, 'total price is 250');
ok(b.pricing.currency === 'EUR', 'currency is EUR');
ok(b.baggage_count === 1, '1 bag included');
ok(b.baggage_weight_kg === 23, 'baggage weight is 23 kg per bag');
ok(b.status === 'confirmed', 'status confirmed');

// ---------------------------------------------------------------
section('Case-insensitivity — lowercase inputs resolve');
const lc = await call('get_booking', { p_ref: 'abc123' });
ok(!lc.error && lc.booking_reference === 'ABC123', 'get_booking("abc123") resolves to ABC123');
// voice transcription: spaced/punctuated refs are cleaned before matching
const spoken = await call('get_booking', { p_ref: 'a b c 1 2 5' });
ok(!spoken.error && spoken.booking_reference === 'ABC125', 'get_booking("a b c 1 2 5") resolves to ABC125');
const dashed = await call('get_booking', { p_ref: 'abc-123' });
ok(!dashed.error && dashed.booking_reference === 'ABC123', 'get_booking("abc-123") resolves to ABC123');
const qSpoken = await call('quote_booking', { p_ref: 'A B C 1 2 3' });
ok(!qSpoken.error && qSpoken.currency === 'EUR', 'quote_booking accepts spoken ref too');
const lcSeat = await call('get_seat_map', { p_flight_number: 'ns1156' });
ok(lcSeat.flight_number === 'ns1156' && Array.isArray(lcSeat.seats) && lcSeat.seats.length === 180, 'get_seat_map("ns1156") works lowercase');

// ---------------------------------------------------------------
section('Scene 2 — flight search + price deltas + availability scenarios');
const search = await call('search_flights', { p_origin: 'SIN', p_destination: 'NRT', p_date: '2026-10-08', p_ref: REF });
ok(search.count === 6 && Array.isArray(search.flights) && search.flights.length === 6, 'returns object with 6 flights');
ok(search.cheapest_flight_number === 'NS1156', 'summary cheapest_flight_number is NS1156');
ok(n(search.cheapest_price_delta) === -60, 'summary cheapest_price_delta is -60 (with p_ref)');
ok(n(search.cheapest_base_fare) === 190, 'summary cheapest_base_fare is 190');
const flights = search.flights;
const sorted = flights.every((f, i) => i === 0 || f.departure_time >= flights[i-1].departure_time);
ok(sorted, 'flights sorted by departure time');
const by = Object.fromEntries(flights.map(f => [f.flight_number, f]));
ok(n(by['NS1156'].price_delta) === -60, 'NS1156 price delta is -60 (cheapest)');
ok(n(by['NS1150'].price_delta) === -35, 'NS1150 price delta is -35');
ok(n(by['NS1180'].price_delta) === -20, 'NS1180 price delta is -20');
ok(n(by['NS1142'].price_delta) === 0, 'NS1142 (current) price delta is 0');
ok(n(by['NS1120'].available_seats) === 0, 'NS1120 is SOLD OUT (0 seats available)');
ok(n(by['NS1180'].available_seats) > 0 && n(by['NS1180'].available_seats) <= 20, 'NS1180 has LOW availability');
ok(n(by['NS1156'].available_seats) > 0, 'NS1156 has seats available');

section('Scene 2b — search edge cases');
const none = await call('search_flights', { p_origin: 'XXX', p_destination: 'YYY', p_date: '2026-10-08', p_ref: REF });
ok(none.count === 0 && none.flights.length === 0, 'unknown route returns empty list');
ok(none.cheapest_flight_number === null, 'no cheapest when no flights');
const lower = await call('search_flights', { p_origin: 'sin', p_destination: 'nrt', p_date: '2026-10-08', p_ref: REF });
ok(lower.flights.length === 6, 'origin/destination are case-insensitive');
// flights exist on other days too (not just 8 Oct)
const d9 = await call('search_flights', { p_origin: 'SIN', p_destination: 'NRT', p_date: '2026-10-09', p_ref: REF });
ok(d9.count === 6, '2026-10-09 returns 6 flights');
const d21 = await call('search_flights', { p_origin: 'SIN', p_destination: 'NRT', p_date: '2026-10-21', p_ref: REF });
ok(d21.count === 6, '2026-10-21 returns 6 flights');
// p_ref is optional: caller with no booking -> cheapest by lowest base_fare, deltas are null
const noRef = await call('search_flights', { p_origin: 'SIN', p_destination: 'NRT', p_date: '2026-10-08' });
ok(noRef.flights.length === 6, 'search works without p_ref (optional)');
ok(noRef.cheapest_flight_number === 'NS1156', 'without p_ref, cheapest is NS1156 (lowest fare)');
ok(n(noRef.cheapest_base_fare) === 190, 'without p_ref, cheapest_base_fare is 190');
ok(noRef.cheapest_price_delta === null, 'without p_ref, cheapest_price_delta is null');
ok(noRef.flights.every(f => f.price_delta === null), 'without p_ref, every flight price_delta is null');

// ---------------------------------------------------------------
section('Error handling — change_flight');
ok((await call('change_flight', { p_ref: 'ZZZZZZ', p_new_flight_number: 'NS1156' })).error === 'booking_not_found', 'bad ref -> booking_not_found');
ok((await call('change_flight', { p_ref: REF, p_new_flight_number: 'NS9999' })).error === 'flight_not_found', 'bad flight -> flight_not_found');
ok((await call('change_flight', { p_ref: REF, p_new_flight_number: 'NS1142' })).error === 'already_on_flight', 'same flight (NS1142) -> already_on_flight');
ok((await call('get_booking', { p_ref: REF })).seat_number === '23C', 'seat preserved when already_on_flight (not cleared)');

section('Scene 3 — change flight to NS1156 (clears seat, base -> 190, status -> pending)');
b = await call('change_flight', { p_ref: REF, p_new_flight_number: 'NS1156' });
ok(b.flight.flight_number === 'NS1156', 'moved to NS1156');
ok(b.seat_number === null, 'seat selection cleared');
ok(n(b.pricing.base_price) === 190, 'base price now 190');
ok(n(b.pricing.seat_surcharge) === 0, 'seat surcharge reset to 0');
ok(b.status === 'pending', 'status flipped to pending after change');
ok(b.boarding_pass_ref === null, 'old boarding pass cleared after change');
// verify old seat 23C on NS1142 was released
const { data: old23c } = await admin.from('seats').select('status,booking_id')
  .eq('seat_number', '23C')
  .eq('flight_id', (await admin.from('flights').select('flight_id').eq('flight_number','NS1142').single()).data.flight_id)
  .single();
ok(old23c.status === 'available' && old23c.booking_id === null, 'old seat 23C on NS1142 released');

section('Guard — confirm with NO seat selected (right after flight change)');
ok((await call('confirm_booking', { p_ref: REF })).error === 'no_seat_selected', 'confirm without a seat -> no_seat_selected');

// ---------------------------------------------------------------
section('Scene 4 — seat map + seat selection');
const sm = await call('get_seat_map', { p_flight_number: 'NS1156' });
const seatmap = sm.seats;
ok(sm.total === 180 && seatmap.length === 180, 'seat map returns object with 180 seats');
ok(typeof sm.available_window_seats === 'string' && sm.available_window_seats.length > 0, 'summary available_window_seats present: ' + sm.available_window_seats);
ok(sm.available_window_seats.includes('6A') && sm.available_window_seats.includes('6F'), 'summary lists 6A and 6F as window seats');
ok(n(sm.available_count) > 0, 'summary available_count present');
// free (€0) seats listed first -> 6A/6F come before any €15 front-row window
ok(sm.available_window_seats.startsWith('6A, 6F'), 'window list is FREE-first (starts 6A, 6F): ' + sm.available_window_seats);
// aisle summary contains only true aisle seats (C/D), never middle (B/E)
ok(sm.available_aisle_seats.split(', ').filter(Boolean).every(s => ['C','D'].includes(s.slice(-1))), 'available_aisle_seats are only C/D (no middle)');
// middle seats exist, typed middle, and have their own list (B/E only)
ok(seatmap.some(s => s.seat_type === 'middle'), 'B/E seats are typed middle');
ok(typeof sm.available_middle_seats === 'string', 'available_middle_seats present');
ok(sm.available_middle_seats.split(', ').filter(Boolean).every(s => ['B','E'].includes(s.slice(-1))), 'middle list is only B/E columns');
// 23C is booked (unavailable) on NS1156, per the demo
ok(seatmap.find(s => s.seat_number === '23C').status === 'booked', '23C is booked (unavailable) on NS1156');
const windowsFree = seatmap.filter(s => s.seat_type === 'window' && s.status === 'available');
ok(windowsFree.some(s => s.seat_number === '6A') && windowsFree.some(s => s.seat_number === '6F'), '6A and 6F are free window seats');

section('get_seat_options — lightweight summary for the voice agent (no seats array)');
const opts = await call('get_seat_options', { p_flight_number: 'NS1156' });
ok(opts.seats === undefined, 'get_seat_options has NO heavy seats array');
ok(opts.available_window_seats.startsWith('6A, 6F'), 'get_seat_options window list free-first (6A, 6F)');
ok(typeof opts.available_aisle_seats === 'string' && typeof opts.available_middle_seats === 'string', 'get_seat_options has aisle + middle lists');
ok(n(opts.available_count) > 0, 'get_seat_options has available_count');

section('get_seat_map p_summary_only=true — summary without the seats array');
const smSum = await call('get_seat_map', { p_flight_number: 'NS1156', p_summary_only: true });
ok(smSum.seats === undefined, 'summary_only=true omits seats array');
ok(smSum.total === 180 && n(smSum.available_count) > 0, 'summary_only still has total + available_count');
ok(smSum.available_window_seats.startsWith('6A, 6F'), 'summary_only window list free-first');
// extra-legroom lists
ok(typeof smSum.available_front_row_seats === 'string' && typeof smSum.available_emergency_row_seats === 'string', 'summary has front_row + emergency_row lists');
const fr = smSum.available_front_row_seats.split(', ').filter(Boolean);
ok(fr.length > 0 && fr.every(s => parseInt(s) >= 1 && parseInt(s) <= 5), 'front_row seats are rows 1-5: ' + smSum.available_front_row_seats);
const er = smSum.available_emergency_row_seats.split(', ').filter(Boolean);
ok(er.length > 0 && er.every(s => [12,13].includes(parseInt(s))), 'emergency_row seats are rows 12-13: ' + smSum.available_emergency_row_seats);
const smFull = await call('get_seat_map', { p_flight_number: 'NS1156' });
ok(Array.isArray(smFull.seats) && smFull.seats.length === 180, 'default (summary_only=false) still returns full 180 seats');
ok(typeof smFull.available_front_row_seats === 'string' && typeof smFull.available_emergency_row_seats === 'string', 'full map also has front_row + emergency_row lists');
const hasExit = seatmap.some(s => s.seat_type === 'emergency_row' && n(s.base_price_delta) === 25);
ok(hasExit, 'emergency_row seats carry +25 surcharge');
const hasFront = seatmap.some(s => s.row_number <= 2 && n(s.base_price_delta) === 15);
ok(hasFront, 'front-row seats carry +15 surcharge');

section('Error handling — change_seat');
ok((await call('change_seat', { p_ref: REF, p_new_seat_number: 'ZZZ' })).error === 'seat_not_found', 'nonexistent seat -> seat_not_found');
const bookedSeat = seatmap.find(s => s.status === 'booked');
if (bookedSeat) ok((await call('change_seat', { p_ref: REF, p_new_seat_number: bookedSeat.seat_number })).error === 'seat_unavailable', `already-booked seat ${bookedSeat.seat_number} -> seat_unavailable`);

section('Scene 4b — surcharge seats then back to free window 6A');
const exitFree = seatmap.find(s => s.seat_type === 'emergency_row' && s.status === 'available');
if (exitFree) {
  b = await call('change_seat', { p_ref: REF, p_new_seat_number: exitFree.seat_number });
  ok(n(b.pricing.seat_surcharge) === 25, `emergency seat ${exitFree.seat_number} applies +25 surcharge`);
  ok(n(b.pricing.total_price) === 215, 'total reflects 190 + 25 = 215');
}
const frontFree = seatmap.find(s => s.row_number <= 2 && s.status === 'available');
if (frontFree) {
  b = await call('change_seat', { p_ref: REF, p_new_seat_number: frontFree.seat_number });
  ok(n(b.pricing.seat_surcharge) === 15, `front-row seat ${frontFree.seat_number} applies +15 surcharge`);
}
b = await call('change_seat', { p_ref: REF, p_new_seat_number: '6A' });
ok(b.seat_number === '6A', 'seat 6A selected');
ok(n(b.pricing.seat_surcharge) === 0, '6A is free (no surcharge)');

// ---------------------------------------------------------------
section('Scene 5 — baggage pricing + quote math');
ok((await call('change_baggage', { p_ref: REF, p_baggage_count: 0 })).error === 'min_one_bag', 'baggage < 1 -> min_one_bag');
b = await call('change_baggage', { p_ref: REF, p_baggage_count: 3 });
ok(n(b.pricing.baggage_charge) === 90, '3 bags = 2 extra = EUR 90');
b = await call('change_baggage', { p_ref: REF, p_baggage_count: 2 });
ok(n(b.pricing.baggage_charge) === 45, '2 bags = 1 extra = EUR 45');
const q = await call('quote_booking', { p_ref: REF });
ok(n(q.flight_change) === -60, 'quote flight_change = -60');
ok(n(q.seat_change) === 0, 'quote seat_change = 0');
ok(n(q.baggage_change) === 45, 'quote baggage_change = +45');
ok(n(q.total_change) === -15, 'quote total_change = -15 (net saving)');

// ---------------------------------------------------------------
section('Scene 6 — confirm (lock, boarding pass, CRM, email) + baseline reset');
const c = await call('confirm_booking', { p_ref: REF });
ok(c.confirmation === 'confirmed', 'confirmation = confirmed');
ok(typeof c.boarding_pass_ref === 'string' && c.boarding_pass_ref.startsWith('BP-'), 'boarding pass issued: ' + c.boarding_pass_ref);
ok(c.crm_synced === true, 'CRM synced');
ok(c.email_sent === true, 'email sent (stub)');
ok(c.booking.status === 'confirmed', 'booking locked as confirmed');
// after confirm, the quote baseline resets -> all deltas 0
const q2 = await call('quote_booking', { p_ref: REF });
ok(n(q2.total_change) === 0, 'quote baseline reset after confirm (total_change = 0)');

// ---------------------------------------------------------------
section('Multiple demo bookings — ABC124 is a fresh identical booking');
const b124 = await call('get_booking', { p_ref: 'ABC124' });
ok(b124.flight.flight_number === 'NS1142', 'ABC124 starts on NS1142');
ok(b124.seat_number === '23D', 'ABC124 has its own seat 23D');
ok(n(b124.pricing.total_price) === 250 && b124.status === 'confirmed', 'ABC124 is €250, confirmed (fresh)');
ok(b124.passenger_name === 'Priya Nair', 'ABC124 has its own passenger name (Priya Nair, not Aarav)');

section('reset_demo RPC — restores ALL demo bookings to the starting state');
const rd = await call('reset_demo', {});
ok(rd.reset_count >= 12, `reset_demo reset ${rd.reset_count} bookings`);
ok(Array.isArray(rd.references) && rd.references.includes('ABC123') && rd.references.includes('ABC134'), 'references ABC123..ABC134 present');
ok(rd.booking.flight.flight_number === 'NS1142', 'reset_demo -> ABC123 back on NS1142');
ok(rd.booking.seat_number === '23C', 'reset_demo -> ABC123 seat 23C');
ok(n(rd.booking.pricing.total_price) === 250, 'reset_demo -> ABC123 total 250');
ok(rd.booking.status === 'confirmed', 'reset_demo -> ABC123 confirmed');
ok(rd.booking.boarding_pass_ref === null, 'reset_demo -> ABC123 boarding pass cleared');
// after reset, NS1156 demo seats are guaranteed: 23C booked, 6A/6F free (€0)
const smR = await call('get_seat_map', { p_flight_number: 'NS1156' });
const seatR = Object.fromEntries(smR.seats.map(s => [s.seat_number, s]));
ok(seatR['23C'].status === 'booked', 'reset_demo -> NS1156 23C booked (unavailable)');
ok(seatR['6A'].status === 'available' && n(seatR['6A'].base_price_delta) === 0, 'reset_demo -> NS1156 6A free (€0)');
ok(seatR['6F'].status === 'available' && n(seatR['6F'].base_price_delta) === 0, 'reset_demo -> NS1156 6F free (€0)');

// ---------------------------------------------------------------
console.log('\n=====================================================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? 'ALL CASES PASSED ✓' : 'SOME CASES FAILED ✗');
process.exit(fail === 0 ? 0 : 1);
