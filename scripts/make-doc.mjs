// Generates the Word document for integrating the Flight Booking APIs into the
// OneInbox voice agent (Custom request actions).  Run: node scripts/make-doc.mjs
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType
} from 'docx';
import { writeFileSync } from 'fs';

const NAVY = '0B2545';
const GREY = '666666';
const CODEBG = 'F2F3F5';

const KEY = 'sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW';
const BASE = 'https://ogxttimsdjgahwpzzjyv.supabase.co/rest/v1';

// ---- small helpers ----
const T = (text, opts = {}) => new TextRun({ text, ...opts });
const P = (children, opts = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });
const space = (after = 120) => ({ spacing: { after } });

const h1 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } });
const h2 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } });

const label = (text) => P(T(text, { bold: true, color: NAVY, size: 22 }), space(40));
const body = (text) => P(T(text, { size: 22 }), space(80));

const code = (text) => new Paragraph({
  shading: { type: ShadingType.CLEAR, fill: CODEBG },
  spacing: { after: 100, before: 40 },
  border: {
    top: { style: BorderStyle.SINGLE, size: 2, color: 'DDDDDD' },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: 'DDDDDD' },
    left: { style: BorderStyle.SINGLE, size: 2, color: 'DDDDDD' },
    right: { style: BorderStyle.SINGLE, size: 2, color: 'DDDDDD' },
  },
  children: [new TextRun({ text, font: 'Consolas', size: 20 })],
});

const cell = (text, { bold = false, header = false, w } = {}) => new TableCell({
  width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined,
  shading: header ? { type: ShadingType.CLEAR, fill: NAVY } : undefined,
  margins: { top: 60, bottom: 60, left: 100, right: 100 },
  children: [new Paragraph({ children: [new TextRun({
    text, bold: bold || header, color: header ? 'FFFFFF' : '000000',
    font: /[{}._]/.test(text) && !header ? 'Consolas' : undefined, size: 20,
  })] })],
});

const fieldsTable = (rows) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ tableHeader: true, children: [
      cell('Field', { header: true, w: 34 }), cell('Type', { header: true, w: 20 }), cell('Description', { header: true, w: 46 }),
    ] }),
    ...rows.map(r => new TableRow({ children: [cell(r[0]), cell(r[1]), cell(r[2])] })),
  ],
});

// ---- endpoint definitions ----
const endpoints = [
  {
    n: 1, name: 'Get booking', fn: 'get_booking',
    when: 'Use at the START of the call to fetch the caller’s current booking, then read back the flight, seat, baggage and total price.',
    body: '{ "p_ref": "ABC123" }',
    reqFields: [['p_ref', 'string', 'Booking reference (demo: ABC123)']],
    reply: [
      ['booking_reference', 'string', 'The booking ref'],
      ['status', 'string', 'pending / confirmed / cancelled'],
      ['passenger_name', 'string', 'Passenger on the ticket'],
      ['flight.flight_number', 'string', 'Current flight, e.g. NS1142'],
      ['flight.origin / destination', 'string', 'Airports (SIN / NRT)'],
      ['flight.departure_time / arrival_time', 'datetime', 'Times'],
      ['seat_number', 'string', 'Current seat, e.g. 23C'],
      ['seat_type', 'string', 'window / aisle / emergency_row (null if no seat)'],
      ['baggage_count', 'number', 'Number of bags'],
      ['baggage_weight_kg', 'number', 'Weight per bag (23)'],
      ['pricing.base_price', 'number', 'Base fare (EUR)'],
      ['pricing.seat_surcharge', 'number', 'Seat surcharge (EUR)'],
      ['pricing.baggage_charge', 'number', 'Baggage charge (EUR)'],
      ['pricing.total_price', 'number', 'Total in EUR'],
    ],
  },
  {
    n: 2, name: 'Search flights', fn: 'search_flights',
    when: 'Use when the caller wants to change their flight. Returns up to 6 options with the price difference vs the current booking. Recommend the cheapest (lowest price_delta).',
    body: '{ "p_origin": "SIN", "p_destination": "NRT", "p_date": "2026-10-08", "p_ref": "ABC123" }',
    reqFields: [
      ['p_origin', 'string', 'Origin airport IATA (SIN)'],
      ['p_destination', 'string', 'Destination airport IATA (NRT)'],
      ['p_date', 'string (date)', 'Departure date, e.g. 2026-10-08'],
      ['p_ref', 'string (optional)', 'Booking ref for the price-delta baseline. Omit for callers with no booking — cheapest is still the lowest fare.'],
    ],
    reply: [
      ['count', 'number', 'How many flights returned'],
      ['cheapest_flight_number', 'string', 'Cheapest flight WITH seats (excludes current flight when p_ref given)'],
      ['cheapest_base_fare', 'number', 'Fare of that cheapest flight (e.g. 190)'],
      ['cheapest_price_delta', 'number', 'Its delta (e.g. -60); null when no p_ref'],
      ['flights[].price_delta', 'number', 'Per-flight delta; null when no p_ref'],
      ['flights[].flight_number', 'string', 'Flight number'],
      ['flights[].departure_time / arrival_time', 'datetime', 'Times'],
      ['flights[].base_fare', 'number', 'Fare in EUR'],
      ['flights[].available_seats', 'number', 'Free seats (0 = sold out)'],
    ],
  },
  {
    n: 3, name: 'Change flight', fn: 'change_flight',
    when: 'Use after the caller picks a new flight. Moves the booking to that flight and recomputes the price. NOTE: this clears the seat selection — you must pick a seat again afterwards.',
    body: '{ "p_ref": "ABC123", "p_new_flight_number": "NS1156" }',
    reqFields: [
      ['p_ref', 'string', 'Booking reference'],
      ['p_new_flight_number', 'string', 'Target flight number, e.g. NS1156'],
    ],
    reply: [['(same as Get booking)', 'object', 'Updated booking; seat cleared, status -> pending, boarding pass cleared. Error: already_on_flight if it is the current flight']],
  },
  {
    n: 4, name: 'Get seat map', fn: 'get_seat_map',
    when: 'Use after a flight change to see which seats are free before the caller chooses. Filter for seat_type = window/aisle and status = available.',
    body: '{ "p_flight_number": "NS1156" }',
    reqFields: [['p_flight_number', 'string', 'Flight number, e.g. NS1156']],
    reply: [
      ['total', 'number', 'Seats on the aircraft (180)'],
      ['available_count', 'number', 'How many are free'],
      ['available_window_seats', 'string', 'Free window seats, FREE(€0) first, e.g. "6A, 6F" (first 10)'],
      ['available_aisle_seats', 'string', 'Free aisle seats C/D only, free first (first 10)'],
      ['available_middle_seats', 'string', 'Free middle seats B/E, free first (first 10)'],
      ['seats[].seat_number', 'string', 'e.g. 6A'],
      ['seats[].seat_type', 'string', 'window (A/F) / aisle (C/D) / middle (B/E) / emergency_row'],
      ['seats[].status', 'string', 'available / booked / blocked'],
      ['seats[].base_price_delta', 'number', 'Surcharge: 0 / 15 / 25 EUR'],
    ],
  },
  {
    n: '4b', name: 'Seat options (voice agent)', fn: 'get_seat_options',
    when: 'Use THIS (not get_seat_map) to offer seats on a call. Returns only the summary lists — no 180-seat array — so the reply is tiny and the agent reliably reads the fields.',
    body: '{ "p_flight_number": "NS1156" }',
    reqFields: [['p_flight_number', 'string', 'Flight number, e.g. NS1156']],
    reply: [
      ['available_count', 'number', 'How many seats are free'],
      ['available_window_seats', 'string', 'Free window seats, free(€0) first'],
      ['available_aisle_seats', 'string', 'Free aisle seats C/D'],
      ['available_middle_seats', 'string', 'Free middle seats B/E'],
    ],
  },
  {
    n: 5, name: 'Change seat', fn: 'change_seat',
    when: 'Use after the caller chooses a seat. Applies the seat surcharge (window €0, front row €15, emergency row €25).',
    body: '{ "p_ref": "ABC123", "p_new_seat_number": "6A" }',
    reqFields: [
      ['p_ref', 'string', 'Booking reference'],
      ['p_new_seat_number', 'string', 'Seat to select, e.g. 6A'],
    ],
    reply: [['(same as Get booking)', 'object', 'Updated booking. Errors: seat_not_found, seat_unavailable']],
  },
  {
    n: 6, name: 'Change baggage', fn: 'change_baggage',
    when: 'Use when the caller wants to add or remove checked bags. 1 bag is included; each extra bag is €45. Minimum 1 bag.',
    body: '{ "p_ref": "ABC123", "p_baggage_count": 2 }',
    reqFields: [
      ['p_ref', 'string', 'Booking reference'],
      ['p_baggage_count', 'integer', 'Total number of bags (minimum 1)'],
    ],
    reply: [['(same as Get booking)', 'object', 'Updated booking. Error: min_one_bag if count < 1']],
  },
  {
    n: 7, name: 'Quote changes', fn: 'quote_booking',
    when: 'Use before confirming, to read back the itemised price change. A negative total_change means a saving/refund.',
    body: '{ "p_ref": "ABC123" }',
    reqFields: [['p_ref', 'string', 'Booking reference']],
    reply: [
      ['flight_change', 'number', 'Fare difference (EUR)'],
      ['seat_change', 'number', 'Seat surcharge difference (EUR)'],
      ['baggage_change', 'number', 'Baggage difference (EUR)'],
      ['total_change', 'number', 'Net change (negative = saving)'],
      ['currency', 'string', 'EUR'],
    ],
  },
  {
    n: 8, name: 'Confirm booking', fn: 'confirm_booking',
    when: 'Use after the caller agrees to the changes. Locks the booking, issues a boarding pass, syncs CRM and flags the email.',
    body: '{ "p_ref": "ABC123" }',
    reqFields: [['p_ref', 'string', 'Booking reference']],
    reply: [
      ['confirmation', 'string', 'confirmed'],
      ['boarding_pass_ref', 'string', 'e.g. BP-ABC123-NS1156'],
      ['crm_synced', 'boolean', 'true'],
      ['email_sent', 'boolean', 'true (stubbed in demo)'],
      ['booking', 'object', 'Full updated booking'],
      ['error', 'string', 'no_seat_selected if confirming with no seat chosen'],
    ],
  },
  {
    n: 9, name: 'Reset demo (helper)', fn: 'reset_demo',
    when: 'Not part of the caller flow — a helper for testing. Resets ALL demo bookings (ABC123..ABC134) to the starting state (each on NS1142, its own aisle seat, 1 bag, EUR 250, confirmed). Call it before a fresh demo run.',
    body: '{ }',
    reqFields: [['(none)', '-', 'Takes no arguments']],
    reply: [
      ['reset_count', 'number', 'How many bookings were reset'],
      ['references', 'array', 'The reset refs, e.g. ["ABC123", ... "ABC134"]'],
      ['booking', 'object', 'ABC123 restored (same shape as Get booking)'],
    ],
  },
];

// ---- build the document body ----
const children = [];

children.push(new Paragraph({ children: [T('Flight Booking Voice Agent', { bold: true, size: 40, color: NAVY })], spacing: { after: 40 } }));
children.push(new Paragraph({ children: [T('API Integration Guide (OneInbox Custom Requests)', { size: 26, color: GREY })], spacing: { after: 60 } }));
children.push(new Paragraph({ children: [T('demo · SIN → NRT · All endpoints live on Supabase', { italics: true, size: 20, color: GREY })], spacing: { after: 200 } }));

// How to add each API
children.push(h1('How to add each API in the agent'));
children.push(body('In OneInbox, create a Custom request action for each API below and fill the fields exactly as shown:'));
children.push(P([T('• Name', { bold: true }), T('  → the action name')], space(30)));
children.push(P([T('• When the agent should use this', { bold: true }), T('  → the “When to use” text')], space(30)));
children.push(P([T('• Method', { bold: true }), T('  → POST (for every endpoint)')], space(30)));
children.push(P([T('• URL', { bold: true }), T('  → the full URL')], space(30)));
children.push(P([T('• Headers', { bold: true }), T('  → the two auth headers (same for all)')], space(30)));
children.push(P([T('• Body', { bold: true }), T('  → the JSON (replace demo values with call variables, e.g. {{booking_ref}})')], space(30)));
children.push(P([T('• Use the reply', { bold: true }), T('  → map the response fields you want the agent to read back')], space(120)));

// Global settings
children.push(h1('Global settings (same for every API)'));
children.push(label('Method'));
children.push(code('POST   (all endpoints — this is a Supabase RPC API; reads are POST too)'));
children.push(label('Base URL'));
children.push(code(BASE));
children.push(label('Headers — add these to EVERY request'));
children.push(code('apikey:        ' + KEY));
children.push(code('Authorization: Bearer ' + KEY));
children.push(code('Content-Type:  application/json'));
children.push(body('The key above is the publishable key — safe for the agent/frontend (the database is protected by Row Level Security). Never use the service_role secret key here.'));

// Demo data
children.push(h1('Demo data'));
children.push(P([T('Booking references: ', {}), T('ABC123 … ABC134', { font: 'Consolas' }), T('  (Shivam Sharma) — 12 identical bookings; use a fresh one per demo/tester')], space(40)));
children.push(P([T('Route: ', {}), T('SIN → NRT', { bold: true }), T('   Date: '), T('2026-10-08', { font: 'Consolas' }), T('  (Thu)')], space(40)));
children.push(body('Starts on NS1142, seat 23C, €250. Flights: NS1156 cheapest (−60), NS1150 (−35), NS1180 (−20, low availability), NS1120 sold out, NS1134 at 09:40. Seat surcharge: window €0, front rows €15, emergency rows €25.'));
children.push(body('Note: errors come back with HTTP 200 and a body like { "error": "booking_not_found" } — always check for an “error” key.'));

// Per-endpoint sections
children.push(h1('The 8 APIs'));
for (const e of endpoints) {
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
    children: [T(`${e.n}. ${e.name}`, { bold: true, color: NAVY, size: 26 })],
  }));
  children.push(label('When the agent should use this'));
  children.push(body(e.when));
  children.push(label('Method'));
  children.push(code('POST'));
  children.push(label('URL'));
  children.push(code(`${BASE}/rpc/${e.fn}`));
  children.push(label('Headers'));
  children.push(code('apikey: ' + KEY));
  children.push(code('Authorization: Bearer ' + KEY));
  children.push(label('Body'));
  children.push(code(e.body));
  children.push(label('Request fields'));
  children.push(fieldsTable(e.reqFields));
  children.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
  children.push(label('Use the reply (response fields)'));
  children.push(fieldsTable(e.reply));
}

// Typical flow
children.push(h1('Typical call flow'));
['1. Get booking — show the current trip',
 '2. Search flights — offer options with price differences',
 '3. Change flight — move to the chosen flight (seat is cleared)',
 '4. Get seat map → Change seat — pick a seat',
 '5. Change baggage → Quote changes — read back the new price',
 '6. Confirm booking — lock it in, boarding pass issued',
].forEach(s => children.push(P(T(s, { size: 22 }), space(40))));

const doc = new Document({
  styles: { default: { document: { run: { font: 'Calibri' } } } },
  sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
});

const out = 'Flight_Booking_API_Agent_Integration.docx';
const buffer = await Packer.toBuffer(doc);
writeFileSync(out, buffer);
console.log('Wrote', out, '(' + buffer.length + ' bytes)');
