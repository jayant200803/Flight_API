// Generates the Word document for the webhook hand-over.  Run: node scripts/make-webhook-doc.mjs
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType
} from 'docx';
import { writeFileSync } from 'fs';

const NAVY = '0B2545', GREY = '666666', CODEBG = 'F2F3F5';
const T = (t, o = {}) => new TextRun({ text: t, ...o });
const P = (c, o = {}) => new Paragraph({ children: Array.isArray(c) ? c : [c], ...o });
const h1 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 100 } });
const label = (t) => P(T(t, { bold: true, color: NAVY, size: 22 }), { spacing: { after: 40 } });
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
  margins: { top: 60, bottom: 60, left: 100, right: 100 },
  children: [new Paragraph({ children: [new TextRun({ text: t, bold: hdr, color: hdr ? 'FFFFFF' : '000000',
    font: /[{}._?=/]/.test(t) && !hdr ? 'Consolas' : undefined, size: 19 })] })],
});
const table = (head, rows) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
  new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, true, [34,46,20][i])) }),
  ...rows.map(r => new TableRow({ children: r.map(c => cell(c)) })),
]});

const children = [];
children.push(P([T('Flight Booking Voice Agent', { bold: true, size: 40, color: NAVY })], { spacing: { after: 40 } }));
children.push(P([T('Webhook — Live UI Feed (Hand-over)', { size: 26, color: GREY })], { spacing: { after: 160 } }));
children.push(body('A webhook for the real-time UI. It receives call/transcript events (from OneInbox or the agent), stores them in the same flight Supabase project (new table call_events), and the UI reads them or subscribes live via Supabase Realtime. The existing flight API is unchanged — this is purely additive.'));

children.push(h1('1. Endpoint'));
children.push(label('Webhook URL'));
children.push(code('https://flight-api-gold.vercel.app/api/webhook'));

children.push(label('Send an event — POST'));
children.push(body('Point OneInbox’s webhook (or anything) at the URL. Send any JSON; the webhook stores the full body and extracts these common fields if present:'));
children.push(table(['Stored column', 'Picked from any of', 'Notes'], [
  ['call_id', 'call_id, callId, conversation_id, session_id, id', 'groups one call'],
  ['booking_reference', 'booking_reference, booking_ref, p_ref, ref', 'cleaned -> UPPER, no spaces'],
  ['event_type', 'event_type, type, event, name', 'transcript / tool_call / ...'],
  ['role', 'role, speaker, sender', 'agent / customer / system'],
  ['text', 'text, message, transcript, content', 'the spoken line'],
  ['payload', '(the entire body)', 'nothing is lost'],
]));
children.push(P([T('', {})], { spacing: { after: 60 } }));
children.push(label('Example'));
children.push(code('curl -X POST https://flight-api-gold.vercel.app/api/webhook \\\n  -H "Content-Type: application/json" \\\n  -d \'{"call_id":"call_123","booking_reference":"ABC123","type":"transcript","role":"customer","text":"Can I change my flight?"}\'\n\n-> { "ok": true, "event_id": 42, "created_at": "..." }'));

children.push(label('Read events — GET (testing / replay)'));
children.push(code('GET /api/webhook?call_id=call_123\nGET /api/webhook?booking_reference=ABC123\nGET /api/webhook?call_id=call_123&limit=100\n\n-> { "count": N, "events": [ ...oldest first... ] }'));

children.push(h1('2. Live feed for the UI — Supabase Realtime'));
children.push(body('The UI subscribes to inserts on call_events (no polling):'));
children.push(code(`import { createClient } from '@supabase/supabase-js';
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
  .subscribe();`));
children.push(body('The left panel (booking/seat state) can likewise subscribe to Realtime on the existing bookings tables, or simply re-call get_booking after each agent action.'));

children.push(h1('3. Setup (one-time)'));
children.push(bullet('DB: run supabase/migrations/0003_call_events.sql once (creates call_events, RLS read policy, Realtime). Additive — does not affect existing tables/functions.'));
children.push(bullet('Vercel env var: Settings -> Environment Variables -> add SUPABASE_SERVICE_ROLE_KEY = the service_role secret. Used server-side only (never exposed to the browser).'));

children.push(h1('4. Test'));
children.push(code('npm run test:webhook     # POST -> store -> GET -> Realtime push'));
children.push(body('Status: webhook verified live (POST + GET + Realtime). Existing flight API untouched.'));

const doc = new Document({
  styles: { default: { document: { run: { font: 'Calibri' } } } },
  sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
});
const out = 'Flight_Booking_Webhook_Guide.docx';
writeFileSync(out, await Packer.toBuffer(doc));
console.log('Wrote', out);
