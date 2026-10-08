-- =====================================================================
-- Flight Booking Voice Agent Demo — RPC functions (the 7 PRD endpoints)
-- Called via POST {SUPABASE_URL}/rest/v1/rpc/<function_name>
-- All money in EUR. Baggage: 1 bag included, each extra bag = EUR 45.
--
-- Every RPC also logs ONE row to ui_events (see _emit) so the UI can show
-- live changes. Requires ui_events (supabase/migrations/0004_ui_events.sql).
-- =====================================================================

create or replace function _recalc_total(p_booking_id bigint)
returns void language plpgsql as $$
begin
  update bookings
     set total_price = base_price + seat_surcharge + baggage_charge,
         updated_at  = now()
   where booking_id = p_booking_id;
end $$;

-- Helper: normalise a spoken/typed booking ref — strip spaces/punctuation, uppercase.
-- e.g. "a b c 1 2 5" -> "ABC125", "abc-125" -> "ABC125".
create or replace function _clean_ref(p text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

-- Helper: log one UI event. booking_ref falls back to 'anonymous'.
create or replace function _emit(p_ref text, p_type text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into ui_events (booking_ref, event_type, payload)
  values (coalesce(nullif(_clean_ref(p_ref), ''), 'anonymous'), p_type, coalesce(p_payload, '{}'::jsonb));
end $$;

-- Helper: build the full booking object returned everywhere
create or replace function _booking_json(p_ref text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'booking_reference', b.booking_reference,
    'status',            b.booking_status,
    'passenger_name',    b.primary_passenger_name,
    'passenger_count',   b.passenger_count,
    'flight', jsonb_build_object(
       'flight_number', f.flight_number,
       'origin',        f.origin_airport,
       'destination',   f.destination_airport,
       'departure_time',f.departure_time,
       'arrival_time',  f.arrival_time,
       'aircraft',      f.aircraft_type
    ),
    'seat_number',    b.seat_number,
    'seat_type',      (select s.seat_type from seats s
                         where s.flight_id = b.flight_id and s.seat_number = b.seat_number),
    'baggage_count',  b.baggage_count,
    'baggage_weight_kg', 23,
    'pricing', jsonb_build_object(
       'base_price',     b.base_price,
       'seat_surcharge', b.seat_surcharge,
       'baggage_charge', b.baggage_charge,
       'total_price',    b.total_price,
       'currency',       'EUR'
    ),
    'boarding_pass_ref', b.boarding_pass_ref,
    'updated_at',        b.updated_at
  )
  from bookings b join flights f on f.flight_id = b.flight_id
  where upper(b.booking_reference) = _clean_ref(p_ref);
$$;

-- 1) GET /bookings/{ref}
create or replace function get_booking(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := _booking_json(p_ref);
  if r is null then
    perform _emit(p_ref, 'error', jsonb_build_object('code','booking_not_found','message','Booking not found.'));
    return jsonb_build_object('error','booking_not_found','booking_reference',p_ref);
  end if;
  perform _emit(p_ref, 'booking_loaded', r);
  return r;
end $$;

-- 2) GET /flights/search  (returns up to 6 flights with price delta vs current booking)
drop function if exists search_flights(text,text,date,text);
create or replace function search_flights(
  p_origin text, p_destination text, p_date date, p_ref text default null)
returns json language plpgsql security definer set search_path = public as $$
declare base numeric(10,2); v_cur_fnum text; arr jsonb; cheap jsonb; v_out json;
begin
  select orig_base_price into base from bookings where upper(booking_reference) = _clean_ref(p_ref);
  select f.flight_number into v_cur_fnum
    from flights f join bookings b on b.flight_id = f.flight_id
   where upper(b.booking_reference) = _clean_ref(p_ref);

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into arr from (
    select f.flight_number, f.departure_time, f.arrival_time, 0 as stops,
           f.base_fare as base_fare,
           case when base is null then null else round(f.base_fare - base, 2) end as price_delta,
           (f.total_seats - f.occupied_seats) as available_seats
    from flights f
    where f.origin_airport = upper(p_origin)
      and f.destination_airport = upper(p_destination)
      and f.departure_time::date = p_date
    order by f.departure_time
    limit 6
  ) t;

  select to_jsonb(x) into cheap from (
    select e->>'flight_number' as flight_number,
           (e->>'base_fare')::numeric  as base_fare,
           (e->>'price_delta')::numeric as price_delta
    from jsonb_array_elements(arr) e
    where (e->>'available_seats')::int > 0
      and (v_cur_fnum is null or e->>'flight_number' <> v_cur_fnum)
    order by case when base is null then (e->>'base_fare')::numeric
                  else (e->>'price_delta')::numeric end asc,
             e->>'departure_time' asc
    limit 1
  ) x;

  v_out := json_build_object(
    'count', jsonb_array_length(arr),
    'cheapest_flight_number', cheap->>'flight_number',
    'cheapest_base_fare', (cheap->>'base_fare')::numeric,
    'cheapest_price_delta', case when base is null then null else (cheap->>'price_delta')::numeric end,
    'flights', arr
  );
  perform _emit(p_ref, 'flights_shown', v_out::jsonb);
  return v_out;
end $$;

-- 3) PATCH /bookings/{ref}/flight  (change flight, clears seat)
create or replace function change_flight(p_ref text, p_new_flight_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_booking bookings%rowtype; v_flight flights%rowtype; v_out jsonb;
begin
  select * into v_booking from bookings where upper(booking_reference) = _clean_ref(p_ref);
  if not found then
    perform _emit(p_ref,'error', jsonb_build_object('code','booking_not_found','message','Booking not found.'));
    return jsonb_build_object('error','booking_not_found'); end if;
  select * into v_flight from flights where upper(flight_number) = upper(p_new_flight_number);
  if not found then
    perform _emit(p_ref,'error', jsonb_build_object('code','flight_not_found','message','Flight '||p_new_flight_number||' not found.'));
    return jsonb_build_object('error','flight_not_found','flight_number',p_new_flight_number); end if;
  if v_flight.flight_id = v_booking.flight_id then
    perform _emit(p_ref,'error', jsonb_build_object('code','already_on_flight','message','Already on this flight.'));
    return jsonb_build_object('error','already_on_flight','flight_number',p_new_flight_number,
      'message','The booking is already on this flight.'); end if;

  if v_booking.seat_number is not null then
    update seats set status='available', booking_id=null
     where flight_id = v_booking.flight_id and seat_number = v_booking.seat_number;
  end if;

  update bookings
     set flight_id        = v_flight.flight_id,
         base_price       = v_flight.base_fare,
         seat_number      = null,
         seat_surcharge   = 0,
         booking_status   = 'pending',
         boarding_pass_ref = null,
         updated_at       = now()
   where booking_id = v_booking.booking_id;

  perform _recalc_total(v_booking.booking_id);
  v_out := _booking_json(p_ref);
  perform _emit(p_ref, 'flight_changed', v_out);
  return v_out;
end $$;

-- 4) GET /flights/{id}/seats  (seat map)
-- Pass p_summary_only=true to omit the 180-seat array from the RESPONSE (agent);
-- the UI event (seats_shown) always carries the full list. p_ref tags the event.
drop function if exists get_seat_map(text);
drop function if exists get_seat_map(text, boolean);
drop function if exists get_seat_map(text, boolean, text);
create or replace function get_seat_map(p_flight_number text, p_summary_only boolean default false, p_ref text default null)
returns json language plpgsql security definer set search_path = public as $$
declare arr jsonb; win text; ais text; mid text; emr text; frnt text; avail int; tot int;
begin
  select coalesce(jsonb_agg(row_to_json(t) order by (t.row_number, t.column_letter)), '[]'::jsonb) into arr
  from (
    select s.seat_number, s.row_number, s.column_letter, s.seat_type, s.status, s.base_price_delta
    from seats s join flights f on f.flight_id = s.flight_id
    where upper(f.flight_number) = upper(p_flight_number)
  ) t;
  select string_agg(seat_number, ', ' order by base_price_delta, row_number, column_letter) into win from (
    select s.seat_number, s.row_number, s.column_letter, s.base_price_delta
    from seats s join flights f on f.flight_id = s.flight_id
    where upper(f.flight_number) = upper(p_flight_number) and s.seat_type = 'window' and s.status = 'available'
    order by s.base_price_delta, s.row_number, s.column_letter limit 10) z;
  select string_agg(seat_number, ', ' order by base_price_delta, row_number, column_letter) into ais from (
    select s.seat_number, s.row_number, s.column_letter, s.base_price_delta
    from seats s join flights f on f.flight_id = s.flight_id
    where upper(f.flight_number) = upper(p_flight_number) and s.seat_type = 'aisle' and s.status = 'available'
    order by s.base_price_delta, s.row_number, s.column_letter limit 10) z;
  select string_agg(seat_number, ', ' order by base_price_delta, row_number, column_letter) into mid from (
    select s.seat_number, s.row_number, s.column_letter, s.base_price_delta
    from seats s join flights f on f.flight_id = s.flight_id
    where upper(f.flight_number) = upper(p_flight_number) and s.seat_type = 'middle' and s.status = 'available'
    order by s.base_price_delta, s.row_number, s.column_letter limit 10) z;
  select string_agg(seat_number, ', ' order by row_number, column_letter) into emr from (
    select s.seat_number, s.row_number, s.column_letter
    from seats s join flights f on f.flight_id = s.flight_id
    where upper(f.flight_number) = upper(p_flight_number) and s.seat_type = 'emergency_row' and s.status = 'available'
    order by s.row_number, s.column_letter limit 10) z;
  select string_agg(seat_number, ', ' order by row_number, column_letter) into frnt from (
    select s.seat_number, s.row_number, s.column_letter
    from seats s join flights f on f.flight_id = s.flight_id
    where upper(f.flight_number) = upper(p_flight_number) and s.row_number between 1 and 5 and s.status = 'available'
    order by s.row_number, s.column_letter limit 10) z;
  select count(*) filter (where s.status = 'available'), count(*) into avail, tot
    from seats s join flights f on f.flight_id = s.flight_id
   where upper(f.flight_number) = upper(p_flight_number);

  -- UI event always carries the FULL seat list (for drawing the plane)
  perform _emit(p_ref, 'seats_shown', jsonb_build_object('flight_number', p_flight_number, 'seats', arr));

  if p_summary_only then
    return json_build_object(
      'flight_number', p_flight_number, 'total', tot, 'available_count', avail,
      'available_window_seats', coalesce(win,''), 'available_aisle_seats', coalesce(ais,''),
      'available_middle_seats', coalesce(mid,''), 'available_front_row_seats', coalesce(frnt,''),
      'available_emergency_row_seats', coalesce(emr,''));
  end if;
  return json_build_object(
    'flight_number', p_flight_number, 'total', tot, 'available_count', avail,
    'available_window_seats', coalesce(win,''), 'available_aisle_seats', coalesce(ais,''),
    'available_middle_seats', coalesce(mid,''), 'available_front_row_seats', coalesce(frnt,''),
    'available_emergency_row_seats', coalesce(emr,''), 'seats', arr);
end $$;

-- 4b) Lightweight seat summary for the VOICE AGENT (no seats array in the reply).
drop function if exists get_seat_options(text);
drop function if exists get_seat_options(text, text);
create or replace function get_seat_options(p_flight_number text, p_ref text default null)
returns json language plpgsql security definer set search_path = public as $$
declare arr jsonb; win text; ais text; mid text; emr text; frnt text; avail int;
begin
  select coalesce(jsonb_agg(row_to_json(t) order by (t.row_number, t.column_letter)), '[]'::jsonb) into arr
  from (select s.seat_number, s.row_number, s.column_letter, s.seat_type, s.status, s.base_price_delta
        from seats s join flights f on f.flight_id = s.flight_id
        where upper(f.flight_number) = upper(p_flight_number)) t;
  select string_agg(seat_number, ', ' order by base_price_delta, row_number, column_letter) into win from (
    select s.seat_number, s.row_number, s.column_letter, s.base_price_delta from seats s join flights f on f.flight_id = s.flight_id
    where upper(f.flight_number) = upper(p_flight_number) and s.seat_type = 'window' and s.status = 'available'
    order by s.base_price_delta, s.row_number, s.column_letter limit 10) z;
  select string_agg(seat_number, ', ' order by base_price_delta, row_number, column_letter) into ais from (
    select s.seat_number, s.row_number, s.column_letter, s.base_price_delta from seats s join flights f on f.flight_id = s.flight_id
    where upper(f.flight_number) = upper(p_flight_number) and s.seat_type = 'aisle' and s.status = 'available'
    order by s.base_price_delta, s.row_number, s.column_letter limit 10) z;
  select string_agg(seat_number, ', ' order by base_price_delta, row_number, column_letter) into mid from (
    select s.seat_number, s.row_number, s.column_letter, s.base_price_delta from seats s join flights f on f.flight_id = s.flight_id
    where upper(f.flight_number) = upper(p_flight_number) and s.seat_type = 'middle' and s.status = 'available'
    order by s.base_price_delta, s.row_number, s.column_letter limit 10) z;
  select string_agg(seat_number, ', ' order by row_number, column_letter) into emr from (
    select s.seat_number, s.row_number, s.column_letter from seats s join flights f on f.flight_id = s.flight_id
    where upper(f.flight_number) = upper(p_flight_number) and s.seat_type = 'emergency_row' and s.status = 'available'
    order by s.row_number, s.column_letter limit 10) z;
  select string_agg(seat_number, ', ' order by row_number, column_letter) into frnt from (
    select s.seat_number, s.row_number, s.column_letter from seats s join flights f on f.flight_id = s.flight_id
    where upper(f.flight_number) = upper(p_flight_number) and s.row_number between 1 and 5 and s.status = 'available'
    order by s.row_number, s.column_letter limit 10) z;
  select count(*) into avail from seats s join flights f on f.flight_id = s.flight_id
    where upper(f.flight_number) = upper(p_flight_number) and s.status = 'available';
  perform _emit(p_ref, 'seats_shown', jsonb_build_object('flight_number', p_flight_number, 'seats', arr));
  return json_build_object(
    'flight_number', p_flight_number, 'available_count', avail,
    'available_window_seats', coalesce(win,''), 'available_aisle_seats', coalesce(ais,''),
    'available_middle_seats', coalesce(mid,''), 'available_front_row_seats', coalesce(frnt,''),
    'available_emergency_row_seats', coalesce(emr,''));
end $$;

-- 5) PATCH /bookings/{ref}/seat
create or replace function change_seat(p_ref text, p_new_seat_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_booking bookings%rowtype; v_seat seats%rowtype; v_out jsonb;
begin
  select * into v_booking from bookings where upper(booking_reference) = _clean_ref(p_ref);
  if not found then
    perform _emit(p_ref,'error', jsonb_build_object('code','booking_not_found','message','Booking not found.'));
    return jsonb_build_object('error','booking_not_found'); end if;

  select * into v_seat from seats
   where flight_id = v_booking.flight_id and upper(seat_number) = upper(p_new_seat_number);
  if not found then
    perform _emit(p_ref,'error', jsonb_build_object('code','seat_not_found','message','Seat '||p_new_seat_number||' not found.'));
    return jsonb_build_object('error','seat_not_found','seat_number',p_new_seat_number); end if;
  if v_seat.status <> 'available' then
    perform _emit(p_ref,'error', jsonb_build_object('code','seat_unavailable','message','Seat '||p_new_seat_number||' is not available.'));
    return jsonb_build_object('error','seat_unavailable','seat_number',p_new_seat_number); end if;

  if v_booking.seat_number is not null then
    update seats set status='available', booking_id=null
     where flight_id = v_booking.flight_id and seat_number = v_booking.seat_number;
  end if;
  update seats set status='booked', booking_id=v_booking.booking_id where seat_id = v_seat.seat_id;

  update bookings
     set seat_number     = v_seat.seat_number,
         seat_surcharge  = v_seat.base_price_delta,
         booking_status  = 'pending',
         boarding_pass_ref = null,
         updated_at      = now()
   where booking_id = v_booking.booking_id;

  perform _recalc_total(v_booking.booking_id);
  v_out := _booking_json(p_ref);
  perform _emit(p_ref, 'seat_changed', v_out);
  return v_out;
end $$;

-- 5b) add/remove baggage (1 included, extra = EUR 45)
create or replace function change_baggage(p_ref text, p_baggage_count int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_booking bookings%rowtype; v_out jsonb;
begin
  select * into v_booking from bookings where upper(booking_reference) = _clean_ref(p_ref);
  if not found then
    perform _emit(p_ref,'error', jsonb_build_object('code','booking_not_found','message','Booking not found.'));
    return jsonb_build_object('error','booking_not_found'); end if;
  if p_baggage_count < 1 then
    perform _emit(p_ref,'error', jsonb_build_object('code','min_one_bag','message','At least one bag is required.'));
    return jsonb_build_object('error','min_one_bag'); end if;

  update bookings
     set baggage_count   = p_baggage_count,
         baggage_charge  = greatest(p_baggage_count - 1, 0) * 45.00,
         booking_status  = 'pending',
         boarding_pass_ref = null,
         updated_at      = now()
   where booking_id = v_booking.booking_id;

  perform _recalc_total(v_booking.booking_id);
  v_out := _booking_json(p_ref);
  perform _emit(p_ref, 'bags_changed', v_out);
  return v_out;
end $$;

-- 6) POST /bookings/{ref}/quote  (breakdown vs last confirmed state)
create or replace function quote_booking(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b bookings%rowtype; fc numeric; sc numeric; bc numeric; v_out jsonb;
begin
  select * into b from bookings where upper(booking_reference) = _clean_ref(p_ref);
  if not found then
    perform _emit(p_ref,'error', jsonb_build_object('code','booking_not_found','message','Booking not found.'));
    return jsonb_build_object('error','booking_not_found'); end if;
  fc := round(b.base_price     - b.orig_base_price, 2);
  sc := round(b.seat_surcharge - b.orig_seat_surcharge, 2);
  bc := round(b.baggage_charge - b.orig_baggage_charge, 2);
  v_out := jsonb_build_object(
    'flight_change', fc, 'seat_change', sc, 'baggage_change', bc,
    'total_change', round(fc + sc + bc, 2), 'currency', 'EUR');
  perform _emit(p_ref, 'quote_ready', v_out);
  return v_out;
end $$;

-- 7) POST /bookings/{ref}/confirm  (lock, boarding pass, CRM sync)
create or replace function confirm_booking(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b bookings%rowtype; v_pass text; v_out jsonb;
begin
  select * into b from bookings where upper(booking_reference) = _clean_ref(p_ref);
  if not found then
    perform _emit(p_ref,'error', jsonb_build_object('code','booking_not_found','message','Booking not found.'));
    return jsonb_build_object('error','booking_not_found'); end if;
  if b.seat_number is null then
    perform _emit(p_ref,'error', jsonb_build_object('code','no_seat_selected','message','Please select a seat before confirming.'));
    return jsonb_build_object('error','no_seat_selected',
      'message','Please select a seat before confirming the booking.'); end if;

  v_pass := 'BP-' || b.booking_reference || '-' ||
            (select flight_number from flights where flight_id = b.flight_id);

  update bookings
     set booking_status      = 'confirmed',
         boarding_pass_ref   = v_pass,
         orig_base_price     = base_price,
         orig_seat_surcharge = seat_surcharge,
         orig_baggage_charge = baggage_charge,
         crm_synced_at       = now(),
         updated_at          = now()
   where booking_id = b.booking_id;

  update flights f set occupied_seats = (
     select count(*) from seats s where s.flight_id = f.flight_id and s.status='booked')
   where f.flight_id = b.flight_id;

  v_out := jsonb_build_object(
    'confirmation', 'confirmed',
    'booking',      _booking_json(p_ref),
    'boarding_pass_ref', v_pass,
    'crm_synced',   true,
    'email_sent',   true,
    'message', 'Booking confirmed. Boarding pass sent to customer email.');
  perform _emit(p_ref, 'booking_confirmed', v_out);
  return v_out;
end $$;

-- 8) Demo helper: reset ALL demo bookings (ABC123..ABC152) to the starting state.
create or replace function reset_demo()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fid bigint; r record; idx int; v_seat text; v_refs jsonb;
        seats text[] := array['23C','23D','23E','23B','24B','24C','24D','24E','25B','25C','25D','25E',
                               '26B','26C','26D','26E','27B','27C','27D','27E','28B','28C','28D','28E',
                               '29B','29C','29D','29E','30B','30C'];
begin
  select flight_id into v_fid from flights where flight_number = 'NS1142';
  update seats set status='available', booking_id=null
   where booking_id in (select booking_id from bookings where booking_reference like 'ABC%');
  for r in select booking_id, booking_reference from bookings
           where booking_reference like 'ABC%' order by booking_reference loop
    idx := (substring(r.booking_reference from 4))::int - 122;
    if idx < 1 or idx > array_length(seats,1) then continue; end if;
    v_seat := seats[idx];
    update bookings set
      flight_id=v_fid, seat_number=v_seat, baggage_count=1, booking_status='confirmed',
      base_price=250.00, seat_surcharge=0.00, baggage_charge=0.00, total_price=250.00,
      orig_base_price=250.00, orig_seat_surcharge=0.00, orig_baggage_charge=0.00,
      boarding_pass_ref=null, crm_synced_at=null, updated_at=now()
    where booking_id = r.booking_id;
    update seats set status='booked', booking_id=r.booking_id
     where flight_id = v_fid and seat_number = v_seat;
  end loop;
  update seats set status='booked', booking_id=null
   where flight_id = (select flight_id from flights where flight_number='NS1156') and seat_number = '23C';
  update seats set status='available', booking_id=null
   where flight_id = (select flight_id from flights where flight_number='NS1156') and seat_number in ('6A','6F');
  update flights f set occupied_seats = (
    select count(*) from seats s where s.flight_id = f.flight_id and s.status='booked')
   where f.flight_id > 0;

  select jsonb_agg(booking_reference order by booking_reference) into v_refs
    from bookings where booking_reference like 'ABC%';
  perform _emit(null, 'demo_reset', jsonb_build_object('references', v_refs));
  return jsonb_build_object(
    'reset_count', (select count(*) from bookings where booking_reference like 'ABC%'),
    'references',  v_refs,
    'booking',     _booking_json('ABC123'),
    'message',     'All demo bookings reset to the starting state.');
end $$;

-- ---------- Grants: let the anon/auth API roles call the functions ----------
grant execute on function
  get_booking(text), search_flights(text,text,date,text), change_flight(text,text),
  get_seat_map(text, boolean, text), get_seat_options(text, text), change_seat(text,text),
  change_baggage(text,int), quote_booking(text), confirm_booking(text), reset_demo()
to anon, authenticated;
