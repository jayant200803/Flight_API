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

// ---------------------------------------------------------------
section('Error handling — get_booking');
let e = await call('get_booking', { p_ref: 'ZZZZZZ' });
ok(e.error === 'booking_not_found', 'unknown ref returns booking_not_found');

// ---------------------------------------------------------------
section('Scene 1 — retrieve current booking (NS1142 / 23C / EUR 250)');
let b = await call('get_booking', { p_ref: REF });
ok(b.flight.flight_number === 'NS1142', 'flight is NS1142');
ok(b.flight.origin === 'SIN' && b.flight.destination === 'NRT', 'route is SIN -> NRT');
ok(b.passenger_name === 'Shivam Sharma', 'passenger is Shivam Sharma');
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
section('Scene 2 — flight search + price deltas + availability scenarios');
const search = await call('search_flights', { p_origin: 'SIN', p_destination: 'NRT', p_date: '2026-10-08', p_ref: REF });
ok(search.count === 6 && Array.isArray(search.flights) && search.flights.length === 6, 'returns object with 6 flights');
ok(search.cheapest_flight_number === 'NS1156', 'summary cheapest_flight_number is NS1156');
ok(n(search.cheapest_price_delta) === -60, 'summary cheapest_price_delta is -60');
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
const windowsFree = seatmap.filter(s => s.seat_type === 'window' && s.status === 'available');
ok(windowsFree.some(s => s.seat_number === '6A') && windowsFree.some(s => s.seat_number === '6F'), '6A and 6F are free window seats');
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

section('reset_demo RPC — restores ALL demo bookings to the starting state');
const rd = await call('reset_demo', {});
ok(rd.reset_count >= 12, `reset_demo reset ${rd.reset_count} bookings`);
ok(Array.isArray(rd.references) && rd.references.includes('ABC123') && rd.references.includes('ABC134'), 'references ABC123..ABC134 present');
ok(rd.booking.flight.flight_number === 'NS1142', 'reset_demo -> ABC123 back on NS1142');
ok(rd.booking.seat_number === '23C', 'reset_demo -> ABC123 seat 23C');
ok(n(rd.booking.pricing.total_price) === 250, 'reset_demo -> ABC123 total 250');
ok(rd.booking.status === 'confirmed', 'reset_demo -> ABC123 confirmed');
ok(rd.booking.boarding_pass_ref === null, 'reset_demo -> ABC123 boarding pass cleared');

// ---------------------------------------------------------------
console.log('\n=====================================================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? 'ALL CASES PASSED ✓' : 'SOME CASES FAILED ✗');
process.exit(fail === 0 ? 0 : 1);
