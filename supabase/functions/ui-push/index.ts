// Supabase Edge Function: ui-push
// Receives the Database Webhook fired on `ui_events` INSERT and re-broadcasts the
// event on Supabase Realtime channel  booking:{booking_ref}  with event = event_type.
// The UI listens on that channel for live updates.
//
// Deploy:  supabase functions deploy ui-push --no-verify-jwt
// (then point Database -> Webhooks (on ui_events INSERT) at this function's URL)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  // DB Webhooks wrap the row in `record`; also accept a plain row body.
  const row = body?.record ?? body ?? {};
  const booking_ref = row.booking_ref ?? "anonymous";
  const event_type  = row.event_type ?? "event";
  const payload     = row.payload ?? {};

  // Broadcast via the Realtime REST endpoint (no server-side subscribe needed).
  const resp = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      messages: [{
        topic: `booking:${booking_ref}`,   // channel name the UI subscribes to
        event: event_type,                 // broadcast event name
        payload: { booking_ref, event_type, payload, created_at: row.created_at ?? new Date().toISOString() },
      }],
    }),
  });

  return new Response(
    JSON.stringify({ ok: resp.ok, channel: `booking:${booking_ref}`, event: event_type }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
});
