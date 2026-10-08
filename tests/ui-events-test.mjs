// Verifies every RPC logs exactly ONE ui_events row with the right event_type
// (the same flow you'd run in Postman). Prereq: run migrations 0004 + 0002.
// Usage: node tests/ui-events-test.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let pass = 0, fail = 0, lastId = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(fn + ': ' + error.message); return data; };

async function expect(fn, args, type, ref) {
  await call(fn, args);
  const { data } = await admin.from('ui_events').select('*').gt('id', lastId).order('id');
  ok(data.length === 1, `${fn} -> exactly ONE event`);
  if (data.length) {
    ok(data[0].event_type === type, `${fn} -> event_type "${type}"`);
    ok(data[0].booking_ref === ref, `${fn} -> booking_ref "${ref}"`);
    lastId = data[data.length - 1].id;
  }
}

console.log('Clearing ui_events...');
await admin.from('ui_events').delete().neq('id', 0);

console.log('Running the full RPC flow (one event each):');
await expect('reset_demo',     {},                                                                          'demo_reset',       'anonymous');
await expect('get_booking',    { p_ref: 'ABC123' },                                                         'booking_loaded',   'ABC123');
await expect('search_flights', { p_origin:'SIN', p_destination:'NRT', p_date:'2026-10-08', p_ref:'ABC123' },'flights_shown',    'ABC123');
await expect('change_flight',  { p_ref:'ABC123', p_new_flight_number:'NS1156' },                            'flight_changed',   'ABC123');
await expect('get_seat_map',   { p_flight_number:'NS1156', p_summary_only:true, p_ref:'ABC123' },           'seats_shown',      'ABC123');
await expect('change_seat',    { p_ref:'ABC123', p_new_seat_number:'6A' },                                  'seat_changed',     'ABC123');
await expect('change_baggage', { p_ref:'ABC123', p_baggage_count:2 },                                       'bags_changed',     'ABC123');
await expect('quote_booking',  { p_ref:'ABC123' },                                                          'quote_ready',      'ABC123');
await expect('confirm_booking',{ p_ref:'ABC123' },                                                          'booking_confirmed','ABC123');

console.log('Error + anonymous cases:');
await expect('get_booking',    { p_ref:'ZZZZZZ' },                                                          'error',            'ZZZZZZ');
await expect('search_flights', { p_origin:'SIN', p_destination:'NRT', p_date:'2026-10-08' },                'flights_shown',    'anonymous');

// payload spot-checks
const { data: ev } = await admin.from('ui_events').select('*').order('id');
const seat = ev.find(e => e.event_type === 'seat_changed');
ok(seat && seat.payload.seat_number === '6A', 'seat_changed payload carries the full booking (seat 6A)');
const seats = ev.find(e => e.event_type === 'seats_shown');
ok(seats && Array.isArray(seats.payload.booked_seats), 'seats_shown payload carries booked_seats array');
ok(seats && seats.payload.seats === undefined, 'seats_shown payload no longer includes the full seats list');
ok(seats && seats.payload.booked_seats.includes('23C'), 'booked_seats includes 23C (booked on NS1156)');
const conf = ev.find(e => e.event_type === 'booking_confirmed');
ok(conf && conf.payload.boarding_pass_ref, 'booking_confirmed payload has boarding_pass_ref');

console.log('Cleaning up test events...');
await admin.from('ui_events').delete().neq('id', 0);
await call('reset_demo', {});
await admin.from('ui_events').delete().neq('id', 0);

console.log('\n=====================================================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? 'ALL UI-EVENT CHECKS PASSED ✓' : 'SOME CHECKS FAILED ✗');
process.exit(fail === 0 ? 0 : 1);
