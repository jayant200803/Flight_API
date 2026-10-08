// Webhook for the live flight-booking UI.
// POST  /api/webhook            -> store an event (from OneInbox / the agent) in Supabase
// GET   /api/webhook?call_id=X   -> read recent events for a call (for testing / replay)
// GET   /api/webhook?booking_reference=ABC123
//
// Writes to the same flight Supabase project (table: call_events). Existing
// flight tables/functions are untouched. The UI subscribes to call_events via
// Supabase Realtime, or reads them with the GET above.
//
// Required env var on Vercel:  SUPABASE_SERVICE_ROLE_KEY
// Optional env var:            SUPABASE_URL  (defaults to the flight project)
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || 'https://ogxttimsdjgahwpzzjyv.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// best-effort: pull a value from any of several possible field names
const pick = (obj, keys) => {
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  return null;
};
const cleanRef = (v) =>
  v ? String(v).toUpperCase().replace(/[^A-Z0-9]/g, '') || null : null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, apikey');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set in the Vercel environment' });
  }
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  // ---- read events (for testing / replay) ----
  if (req.method === 'GET') {
    const { call_id, booking_reference, limit } = req.query || {};
    let q = sb.from('call_events').select('*').order('created_at', { ascending: true }).limit(Number(limit) || 50);
    if (call_id) q = q.eq('call_id', call_id);
    if (booking_reference) q = q.eq('booking_reference', cleanRef(booking_reference));
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ count: data.length, events: data });
  }

  // ---- store an incoming event ----
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = { raw: body }; } }
    body = body && typeof body === 'object' ? body : { raw: body };

    const row = {
      call_id:           pick(body, ['call_id', 'callId', 'conversation_id', 'conversationId', 'session_id', 'sessionId', 'id']),
      booking_reference: cleanRef(pick(body, ['booking_reference', 'booking_ref', 'bookingReference', 'p_ref', 'ref'])),
      event_type:        pick(body, ['event_type', 'type', 'event', 'name']),
      role:              pick(body, ['role', 'speaker', 'sender']),
      text:              pick(body, ['text', 'message', 'transcript', 'content', 'utterance']),
      payload:           body,
    };

    const { data, error } = await sb.from('call_events').insert(row).select('event_id, created_at').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, event_id: data.event_id, created_at: data.created_at });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
