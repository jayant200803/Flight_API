// Master project hand-over doc. Run: node scripts/make-handover-doc.mjs
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType
} from 'docx';
import { writeFileSync } from 'fs';

const NAVY='0B2545', GREY='666666', CODEBG='F2F3F5';
const T=(t,o={})=>new TextRun({text:t,...o});
const P=(c,o={})=>new Paragraph({children:Array.isArray(c)?c:[c],...o});
const h1=(t)=>new Paragraph({text:t,heading:HeadingLevel.HEADING_1,spacing:{before:260,after:100}});
const h2=(t)=>new Paragraph({children:[T(t,{bold:true,color:NAVY,size:24})],spacing:{before:160,after:60}});
const label=(t)=>P(T(t,{bold:true,color:NAVY,size:22}),{spacing:{after:30}});
const body=(t)=>P(T(t,{size:22}),{spacing:{after:80}});
const bullet=(t)=>new Paragraph({children:[T(t,{size:22})],bullet:{level:0},spacing:{after:20}});
const code=(t)=>new Paragraph({shading:{type:ShadingType.CLEAR,fill:CODEBG},spacing:{after:100,before:40},
  border:{top:{style:BorderStyle.SINGLE,size:2,color:'DDDDDD'},bottom:{style:BorderStyle.SINGLE,size:2,color:'DDDDDD'},left:{style:BorderStyle.SINGLE,size:2,color:'DDDDDD'},right:{style:BorderStyle.SINGLE,size:2,color:'DDDDDD'}},
  children:t.split('\n').map((ln,i)=>new TextRun({text:ln,font:'Consolas',size:18,break:i?1:0}))});
const cell=(t,hdr=false,w)=>new TableCell({width:w?{size:w,type:WidthType.PERCENTAGE}:undefined,
  shading:hdr?{type:ShadingType.CLEAR,fill:NAVY}:undefined,margins:{top:50,bottom:50,left:90,right:90},
  children:[new Paragraph({children:[new TextRun({text:t,bold:hdr,color:hdr?'FFFFFF':'000000',font:/[{}._?=/\[\]:]/.test(t)&&!hdr?'Consolas':undefined,size:18})]})]});
const table=(head,rows,w)=>new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[
  new TableRow({tableHeader:true,children:head.map((h,i)=>cell(h,true,w[i]))}),
  ...rows.map(r=>new TableRow({children:r.map((c,i)=>cell(c,false,w[i]))}))]});

const SUPA='https://ogxttimsdjgahwpzzjyv.supabase.co';
const KEY='sb_publishable_SNafVoNYzjtRzby3l2R2oA_0KEXqBWW';
const ch=[];

ch.push(P([T('Flight Booking Voice Agent',{bold:true,size:40,color:NAVY})],{spacing:{after:40}}));
ch.push(P([T('Backend — Project Hand-over',{size:26,color:GREY})],{spacing:{after:40}}));
ch.push(P([T('OneInbox demo · built on Supabase · live UI via Realtime',{italics:true,size:20,color:GREY})],{spacing:{after:160}}));

// What this is
ch.push(h1('1. What this is'));
ch.push(body('A backend for the flight-booking voice-agent demo. A customer can retrieve a booking, search flights, change flight, pick a seat, add baggage, see a price quote, and confirm — all driven by the voice agent. The UI shows the live conversation and booking changes in real time.'));
ch.push(body('There is NO separate server. Everything is PostgreSQL functions on Supabase, exposed as REST (RPC). A small Vercel site hosts a Swagger explorer. Live UI updates are delivered through Supabase Realtime.'));

// Architecture
ch.push(h1('2. Architecture'));
ch.push(code(
`Voice agent / Frontend
     |  POST /rest/v1/rpc/<fn>  (+ apikey, Authorization, Content-Type)
     v
Supabase Postgres functions (the 9 RPCs)  --->  flights / seats / bookings / customers
     |  each RPC also writes 1 row
     v
ui_events table  --(DB Webhook on INSERT)-->  ui-push Edge Function
                                                   |  broadcast
                                                   v
                                    Supabase Realtime channels:  "demo"  +  "booking:{ref}"
                                                   |
                                                   v
                                                 UI (live)`));

// Connection
ch.push(h1('3. Connection details'));
ch.push(table(['Item','Value'],[
  ['API base URL', SUPA+'/rest/v1'],
  ['Call pattern', 'POST /rpc/{function_name}  with a JSON body'],
  ['Auth key (apikey + Bearer)', KEY+'  (publishable — browser/agent safe)'],
  ['Swagger explorer', 'https://flight-api-gold.vercel.app'],
  ['OpenAPI spec', 'https://flight-api-gold.vercel.app/openapi.json'],
  ['GitHub repo', 'https://github.com/jayant200803/Flight_API'],
],[30,70]));
ch.push(body('The service_role secret key is used ONLY server-side (Vercel webhook env var + Edge Function). Never put it in the agent or frontend.'));

// The APIs
ch.push(h1('4. The 9 RPC endpoints'));
ch.push(table(['Function','Body','Purpose'],[
  ['get_booking','{ p_ref }','Current booking (flight, seat, baggage, pricing)'],
  ['search_flights','{ p_origin, p_destination, p_date, p_ref? }','Up to 6 flights + cheapest summary'],
  ['change_flight','{ p_ref, p_new_flight_number }','Move to a flight (clears seat)'],
  ['get_seat_map','{ p_flight_number, p_summary_only?, p_ref? }','Seat map + free-seat summaries'],
  ['change_seat','{ p_ref, p_new_seat_number }','Select a seat'],
  ['change_baggage','{ p_ref, p_baggage_count }','Set bags (1 incl., EUR45 each extra)'],
  ['quote_booking','{ p_ref }','Price change vs last confirmed'],
  ['confirm_booking','{ p_ref }','Lock booking, issue boarding pass'],
  ['reset_demo','{ }','Reset all demo bookings to start'],
],[24,44,32]));
ch.push(label('Behaviours'));
ch.push(bullet('Case-insensitive: refs, flight numbers, seats, airports match in any case.'));
ch.push(bullet('Voice refs cleaned: "a b c 1 2 3" and "abc-123" resolve to ABC123. Empty ref = anonymous.'));
ch.push(bullet('Any change sets status=pending and clears boarding_pass_ref until confirm runs again.'));
ch.push(bullet('Changing to the current flight returns already_on_flight (seat kept).'));
ch.push(bullet('confirm requires a seat (else no_seat_selected).'));
ch.push(bullet('Errors return HTTP 200 with { error }. Values: booking_not_found, flight_not_found, already_on_flight, seat_not_found, seat_unavailable, min_one_bag, no_seat_selected.'));
ch.push(label('Seat map summaries (voice-agent friendly, FREE EUR0 first)'));
ch.push(bullet('available_window_seats (A/F), available_aisle_seats (C/D), available_middle_seats (B/E), available_front_row_seats (rows 1-5 +EUR15), available_emergency_row_seats (rows 12-13 +EUR25).'));
ch.push(bullet('p_summary_only=true omits the 180-seat array (tiny reply for the agent); default false returns the full grid for the UI.'));

// Demo data
ch.push(h1('5. Demo data'));
ch.push(bullet('Bookings ABC123 .. ABC152 (30), each a different passenger, each own seat; all start on NS1142, EUR250, 1 bag, confirmed. Use a fresh ref per tester.'));
ch.push(bullet('Route SIN -> NRT. Flights seeded 2026-10-08 .. 2026-10-21. 8 Oct is the demo day: NS1156 cheapest (-60), NS1150 (-35), NS1180 (-20, low), NS1120 sold out, NS1134 09:40.'));
ch.push(bullet('On NS1156: seat 23C is booked (unavailable); 6A/6F free at EUR0.'));
ch.push(bullet('reset_demo (or re-running seed.sql) restores everything.'));

// Live UI
ch.push(h1('6. Live UI feed (ui_events + webhook + Edge Function)'));
ch.push(body('Every RPC logs one row to ui_events (id, booking_ref, event_type, payload, created_at). A Supabase Database Webhook on ui_events INSERT calls the ui-push Edge Function, which broadcasts on Realtime.'));
ch.push(table(['Edge Function URL', SUPA+'/functions/v1/ui-push'],[
  ['Channels','"demo" (fixed) AND "booking:{booking_ref}"'],
  ['Event name','the event_type'],
  ['demo_reset goes to','"demo" and booking:anonymous'],
],[30,70]));
ch.push(label('Event per RPC'));
ch.push(table(['RPC / case','event_type','payload'],[
  ['get_booking','booking_loaded','full booking'],
  ['search_flights','flights_shown','{ count, cheapest_*, flights[] }'],
  ['change_flight','flight_changed','full booking'],
  ['get_seat_map','seats_shown','{ flight_number, booked_seats[] } (only booked/blocked)'],
  ['change_seat','seat_changed','full booking'],
  ['change_baggage','bags_changed','full booking'],
  ['quote_booking','quote_ready','{ flight_change, seat_change, baggage_change, total_change }'],
  ['confirm_booking','booking_confirmed','full booking + boarding_pass_ref'],
  ['any error','error','{ code, message }'],
  ['reset_demo','demo_reset','{ references[] }'],
],[24,24,52]));
ch.push(label('UI subscribe (note the payload nesting)'));
ch.push(code(`import { createClient } from '@supabase/supabase-js';
const sb = createClient('${SUPA}', '${KEY}');

sb.channel('demo')   // fixed channel; works before the ref is known
  .on('broadcast', { event: 'seat_changed' }, (msg) => {
      // msg.payload = { booking_ref, event_type, payload: <REAL DATA>, created_at }
      const data = msg.payload.payload;    // <- the booking / seats / quote object
      render(data);
  })
  .subscribe();`));

// Deliverables
ch.push(h1('7. Deliverables produced'));
ch.push(bullet('Postman collection: postman/Flight_Booking_API.postman_collection.json (all 9 RPCs + headers).'));
ch.push(bullet('webhook.site: verified every RPC produces one event (screenshot captured).'));
ch.push(bullet('Edge Function ui-push deployed; channels demo + booking:{ref}. Verified a subscriber receives broadcasts.'));
ch.push(bullet('Docs: this hand-over, plus the API integration guide, webhook guide, and live-UI deliverables docs.'));

// Testing
ch.push(h1('8. How to test'));
ch.push(code(`npm install
npm run test:full        # 113 checks: all endpoints + edge cases (resets data)
npm run test:ui-events   # every RPC logs exactly one correct ui_events row
npm run test:webhook     # (optional) the Vercel /api/webhook variant`));
ch.push(bullet('Or import the Postman collection and Send each request in order.'));
ch.push(bullet('Swagger explorer: open the Vercel URL, Try it out -> Execute on each endpoint.'));

// Setup recap
ch.push(h1('9. Setup / reset recap'));
ch.push(bullet('DB build (one-time, SQL Editor): 0001_schema.sql, 0002_functions.sql, 0003_call_events.sql, 0004_ui_events.sql, seed.sql.'));
ch.push(bullet('Vercel env var SUPABASE_SERVICE_ROLE_KEY (for the /api/webhook function).'));
ch.push(bullet('Database Webhook on ui_events INSERT -> ui-push Edge Function URL.'));
ch.push(bullet('Before a fresh demo: call reset_demo (or re-run seed.sql).'));

const doc=new Document({styles:{default:{document:{run:{font:'Calibri'}}}},
  sections:[{properties:{page:{margin:{top:1000,bottom:1000,left:1000,right:1000}}},children:ch}]});
writeFileSync('Flight_Booking_Project_Handover.docx', await Packer.toBuffer(doc));
console.log('Wrote Flight_Booking_Project_Handover.docx');
