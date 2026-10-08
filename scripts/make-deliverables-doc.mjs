// Generates the hand-over doc for the 3 deliverables. Run: node scripts/make-deliverables-doc.mjs
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType
} from 'docx';
import { writeFileSync } from 'fs';

const NAVY = '0B2545', GREY = '666666', CODEBG = 'F2F3F5';
const T = (t, o = {}) => new TextRun({ text: t, ...o });
const P = (c, o = {}) => new Paragraph({ children: Array.isArray(c) ? c : [c], ...o });
const h1 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 100 } });
const h2 = (t) => new Paragraph({ children: [T(t, { bold: true, color: NAVY, size: 24 })], spacing: { before: 160, after: 60 } });
const label = (t) => P(T(t, { bold: true, color: NAVY, size: 22 }), { spacing: { after: 30 } });
const body = (t) => P(T(t, { size: 22 }), { spacing: { after: 80 } });
const bullet = (t) => new Paragraph({ children: [T(t, { size: 22 })], bullet: { level: 0 }, spacing: { after: 20 } });
const code = (t) => new Paragraph({
  shading: { type: ShadingType.CLEAR, fill: CODEBG }, spacing: { after: 100, before: 40 },
  border: { top:{style:BorderStyle.SINGLE,size:2,color:'DDDDDD'}, bottom:{style:BorderStyle.SINGLE,size:2,color:'DDDDDD'},
            left:{style:BorderStyle.SINGLE,size:2,color:'DDDDDD'}, right:{style:BorderStyle.SINGLE,size:2,color:'DDDDDD'} },
  children: t.split('\n').map((ln, i) => new TextRun({ text: ln, font: 'Consolas', size: 19, break: i ? 1 : 0 })),
});
const cell = (t, hdr = false, w) => new TableCell({
  width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined,
  shading: hdr ? { type: ShadingType.CLEAR, fill: NAVY } : undefined,
  margins: { top: 50, bottom: 50, left: 90, right: 90 },
  children: [new Paragraph({ children: [new TextRun({ text: t, bold: hdr, color: hdr ? 'FFFFFF' : '000000',
    font: /[{}._?=/\[\]]/.test(t) && !hdr ? 'Consolas' : undefined, size: 18 })] })],
});
const table = (head, rows, widths) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
  new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, true, widths[i])) }),
  ...rows.map(r => new TableRow({ children: r.map((c, i) => cell(c, false, widths[i])) })),
]});

const SUPA = 'https://ogxttimsdjgahwpzzjyv.supabase.co';
const children = [];

children.push(P([T('Flight Booking Voice Agent', { bold: true, size: 40, color: NAVY })], { spacing: { after: 40 } }));
children.push(P([T('Live UI Feed — Hand-over (3 deliverables)', { size: 26, color: GREY })], { spacing: { after: 160 } }));
children.push(body('Every RPC logs one row to the ui_events table. A Supabase Database Webhook (on ui_events INSERT) forwards each row to the ui-push Edge Function, which re-broadcasts it on a Supabase Realtime channel the UI listens to. Below are the three deliverables.'));

// ---- Deliverable 1 ----
children.push(h1('1. Postman collection (all 9 RPCs, with headers)'));
children.push(label('File'));
children.push(code('postman/Flight_Booking_API.postman_collection.json'));
children.push(body('Import into Postman (Ctrl+O -> pick the file). Variables base, key, ref are pre-set and all three headers are on every request.'));
children.push(label('Base URL'));
children.push(code(SUPA + '/rest/v1   (call pattern: POST /rpc/{function})'));
children.push(label('Headers (on every request)'));
children.push(code('apikey:        sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW\nAuthorization: Bearer sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW\nContent-Type:  application/json'));
children.push(label('The 9 RPCs + example bodies'));
children.push(table(['RPC (POST /rpc/..)', 'Body', 'ui_event'], [
  ['get_booking',    '{ "p_ref": "ABC123" }',                                                              'booking_loaded'],
  ['search_flights', '{ "p_origin":"SIN","p_destination":"NRT","p_date":"2026-10-08","p_ref":"ABC123" }',  'flights_shown'],
  ['change_flight',  '{ "p_ref":"ABC123","p_new_flight_number":"NS1156" }',                                'flight_changed'],
  ['get_seat_map',   '{ "p_flight_number":"NS1156","p_summary_only":true,"p_ref":"ABC123" }',              'seats_shown'],
  ['change_seat',    '{ "p_ref":"ABC123","p_new_seat_number":"6A" }',                                      'seat_changed'],
  ['change_baggage', '{ "p_ref":"ABC123","p_baggage_count":2 }',                                           'bags_changed'],
  ['quote_booking',  '{ "p_ref":"ABC123" }',                                                               'quote_ready'],
  ['confirm_booking','{ "p_ref":"ABC123" }',                                                               'booking_confirmed'],
  ['reset_demo',     '{ }',                                                                                'demo_reset'],
], [28, 52, 20]));
children.push(body('Errors (e.g. a wrong ref) produce an "error" event with { code, message }. A search with no p_ref logs under booking_ref "anonymous".'));

// ---- Deliverable 2 ----
children.push(h1('2. Edge Function URL + channel name'));
children.push(label('Edge Function (ui-push) URL'));
children.push(code(SUPA + '/functions/v1/ui-push'));
children.push(body('It receives the Database Webhook (ui_events INSERT) and re-broadcasts on Supabase Realtime.'));
children.push(table(['Item', 'Value'], [
  ['Supabase URL',   SUPA],
  ['Anon key',       'sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW'],
  ['Channels',       'Every event is broadcast to TWO channels: "demo" (fixed) and "booking:{booking_ref}". Use "demo" if the UI does not know the ref yet.'],
  ['Event name',     'the event_type (booking_loaded, flights_shown, flight_changed, seats_shown, seat_changed, bags_changed, quote_ready, booking_confirmed, error, demo_reset)'],
], [22, 78]));
children.push(label('UI subscribe (Supabase Realtime)'));
children.push(code(`import { createClient } from '@supabase/supabase-js';
const sb = createClient('${SUPA}', 'sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW');

// Option A: listen on the fixed "demo" channel (works before the ref is known)
sb.channel('demo')
  .on('broadcast', { event: 'seat_changed' }, ({ payload }) => render(payload))
  .on('broadcast', { event: 'booking_confirmed' }, ({ payload }) => render(payload))
  // ...add a handler per event_type you care about
  .subscribe();

// Option B: once you know the ref, listen on booking:{ref}
sb.channel('booking:ABC123').on('broadcast', { event: 'seat_changed' }, ...).subscribe();`));
children.push(label('Example payloads (payload field of each event)'));
children.push(code(`booking_loaded / flight_changed / seat_changed / bags_changed  -> full booking:
  { booking_reference, status, passenger_name, flight:{flight_number,origin,destination,
    departure_time,arrival_time,aircraft}, seat_number, seat_type, baggage_count,
    baggage_weight_kg:23, pricing:{base_price,seat_surcharge,baggage_charge,total_price,currency} }

flights_shown  -> { count, cheapest_flight_number, cheapest_base_fare, cheapest_price_delta,
                    flights:[ {flight_number,departure_time,arrival_time,base_fare,price_delta,available_seats,stops} ] }

seats_shown    -> { flight_number, seats:[ ...ALL 180 seats... {seat_number,row_number,
                    column_letter,seat_type,status,base_price_delta} ] }

quote_ready    -> { flight_change:-60, seat_change:0, baggage_change:45, total_change:-15, currency:"EUR" }

booking_confirmed -> { confirmation:"confirmed", booking:{...full booking...},
                       boarding_pass_ref:"BP-ABC123-NS1156", crm_synced:true, email_sent:true }

demo_reset     -> { references:["ABC123", ... "ABC152"] }      (channel: demo + booking:anonymous)

error          -> { code:"booking_not_found", message:"Booking not found." }`));
children.push(label('Deploy the Edge Function (one-time)'));
children.push(bullet('Supabase -> Edge Functions -> Deploy a new function -> name "ui-push" -> paste supabase/functions/ui-push/index.ts -> turn Verify JWT OFF -> Deploy.'));
children.push(bullet('Then Database -> Webhooks -> edit the ui_events hook -> set URL to the ui-push URL above.'));

// ---- Deliverable 3 ----
children.push(h1('3. webhook.site — events verified'));
children.push(body('Setup used for the screenshot: Database -> Webhooks -> new hook on table ui_events, event INSERT, POST to a webhook.site URL. Running the Postman flow produced one POST per RPC. Each request body (Supabase DB-webhook format):'));
children.push(code(`{
  "type": "INSERT",
  "table": "ui_events",
  "record": {
    "id": 65,
    "booking_ref": "ABC123",
    "event_type": "seat_changed",
    "payload": { ...full booking / seats / quote / etc... },
    "created_at": "2026-10-08T..."
  }
}`));
children.push(body('[ Paste the webhook.site INBOX screenshot here — showing the POST events: booking_loaded, flights_shown, flight_changed, seats_shown, seat_changed, bags_changed, quote_ready, booking_confirmed. ]'));

children.push(h1('Setup recap (one-time)'));
children.push(bullet('Run migrations 0004_ui_events.sql then 0002_functions.sql (done).'));
children.push(bullet('Install the Database Webhooks integration; create a hook on ui_events INSERT (done).'));
children.push(bullet('Deploy the ui-push Edge Function and point the hook at it (for the live UI).'));

const doc = new Document({
  styles: { default: { document: { run: { font: 'Calibri' } } } },
  sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
});
writeFileSync('Flight_Booking_Live_UI_Deliverables.docx', await Packer.toBuffer(doc));
console.log('Wrote Flight_Booking_Live_UI_Deliverables.docx');
