-- =====================================================================
-- Flight Booking Voice Agent Demo — RPC functions (the 7 PRD endpoints)
-- Called via POST {SUPABASE_URL}/rest/v1/rpc/<function_name>
-- All money in EUR. Baggage: 1 bag included, each extra bag = EUR 45.
-- =====================================================================

create or replace function _recalc_total(p_booking_id bigint)
returns void language plpgsql as $$
begin
  update bookings
     set total_price = base_price + seat_surcharge + baggage_charge,
         updated_at  = now()
   where booking_id = p_booking_id;
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
  where b.booking_reference = p_ref;
$$;

-- 1) GET /bookings/{ref}
create or replace function get_booking(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := _booking_json(p_ref);
  if r is null then
    return jsonb_build_object('error','booking_not_found','booking_reference',p_ref);
  end if;
  return r;
end $$;

-- 2) GET /flights/search  (returns up to 6 flights with price delta vs current booking)
create or replace function search_flights(
  p_origin text, p_destination text, p_date date, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare base numeric(10,2); arr jsonb; cheap jsonb;
begin
  select orig_base_price into base from bookings where booking_reference = p_ref;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into arr from (
    select f.flight_number,
           f.departure_time, f.arrival_time,
           0 as stops,
           f.base_fare as base_fare,
           round(f.base_fare - coalesce(base, f.base_fare), 2) as price_delta,
           (f.total_seats - f.occupied_seats) as available_seats
    from flights f
    where f.origin_airport = upper(p_origin)
      and f.destination_airport = upper(p_destination)
      and f.departure_time::date = p_date
    order by f.departure_time
    limit 6
  ) t;
  -- cheapest flight that still has seats (summary for the voice agent)
  select to_jsonb(x) into cheap from (
    select e->>'flight_number' as flight_number,
           (e->>'price_delta')::numeric as price_delta
    from jsonb_array_elements(arr) e
    where (e->>'available_seats')::int > 0
    order by (e->>'price_delta')::numeric asc, e->>'departure_time' asc
    limit 1
  ) x;
  return jsonb_build_object(
    'count', jsonb_array_length(arr),
    'cheapest_flight_number', cheap->>'flight_number',
    'cheapest_price_delta', (cheap->>'price_delta')::numeric,
    'flights', arr
  );
end $$;

-- 3) PATCH /bookings/{ref}/flight  (change flight, clears seat)
create or replace function change_flight(p_ref text, p_new_flight_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_booking bookings%rowtype; v_flight flights%rowtype;
begin
  select * into v_booking from bookings where booking_reference = p_ref;
  if not found then return jsonb_build_object('error','booking_not_found'); end if;
  select * into v_flight from flights where flight_number = p_new_flight_number;
  if not found then return jsonb_build_object('error','flight_not_found','flight_number',p_new_flight_number); end if;
  if v_flight.flight_id = v_booking.flight_id then
    return jsonb_build_object('error','already_on_flight','flight_number',p_new_flight_number,
      'message','The booking is already on this flight.');
  end if;

  -- free the old seat if one was held
  if v_booking.seat_number is not null then
    update seats set status='available', booking_id=null
     where flight_id = v_booking.flight_id and seat_number = v_booking.seat_number;
  end if;

  update bookings
     set flight_id        = v_flight.flight_id,
         base_price       = v_flight.base_fare,
         seat_number      = null,
         seat_surcharge   = 0,
         booking_status   = 'pending',   -- any change re-opens the booking
         boarding_pass_ref = null,       -- old boarding pass no longer valid
         updated_at       = now()
   where booking_id = v_booking.booking_id;

  perform _recalc_total(v_booking.booking_id);
  return _booking_json(p_ref);
end $$;

-- 4) GET /flights/{id}/seats  (seat map)
create or replace function get_seat_map(p_flight_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare arr jsonb; win text; ais text; avail int;
begin
  select coalesce(jsonb_agg(row_to_json(t) order by (t.row_number, t.column_letter)), '[]'::jsonb)
    into arr
  from (
    select s.seat_number, s.row_number, s.column_letter,
           s.seat_type, s.status, s.base_price_delta
    from seats s join flights f on f.flight_id = s.flight_id
    where f.flight_number = p_flight_number
  ) t;
  -- summaries for the voice agent (first 10 available of each type, free of surcharge first)
  select string_agg(seat_number, ', ' order by row_number, column_letter) into win from (
    select s.seat_number, s.row_number, s.column_letter
    from seats s join flights f on f.flight_id = s.flight_id
    where f.flight_number = p_flight_number and s.seat_type = 'window' and s.status = 'available'
    order by s.row_number, s.column_letter limit 10) z;
  select string_agg(seat_number, ', ' order by row_number, column_letter) into ais from (
    select s.seat_number, s.row_number, s.column_letter
    from seats s join flights f on f.flight_id = s.flight_id
    where f.flight_number = p_flight_number and s.seat_type = 'aisle' and s.status = 'available'
    order by s.row_number, s.column_letter limit 10) z;
  select count(*) into avail from seats s join flights f on f.flight_id = s.flight_id
    where f.flight_number = p_flight_number and s.status = 'available';
  return jsonb_build_object(
    'flight_number', p_flight_number,
    'total', jsonb_array_length(arr),
    'available_count', avail,
    'available_window_seats', coalesce(win, ''),
    'available_aisle_seats', coalesce(ais, ''),
    'seats', arr
  );
end $$;

-- 5) PATCH /bookings/{ref}/seat
create or replace function change_seat(p_ref text, p_new_seat_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_booking bookings%rowtype; v_seat seats%rowtype;
begin
  select * into v_booking from bookings where booking_reference = p_ref;
  if not found then return jsonb_build_object('error','booking_not_found'); end if;

  select * into v_seat from seats
   where flight_id = v_booking.flight_id and seat_number = p_new_seat_number;
  if not found then return jsonb_build_object('error','seat_not_found','seat_number',p_new_seat_number); end if;
  if v_seat.status <> 'available' then
    return jsonb_build_object('error','seat_unavailable','seat_number',p_new_seat_number);
  end if;

  -- free previous seat
  if v_booking.seat_number is not null then
    update seats set status='available', booking_id=null
     where flight_id = v_booking.flight_id and seat_number = v_booking.seat_number;
  end if;

  update seats set status='booked', booking_id=v_booking.booking_id
   where seat_id = v_seat.seat_id;

  update bookings
     set seat_number     = v_seat.seat_number,
         seat_surcharge  = v_seat.base_price_delta,
         booking_status  = 'pending',
         boarding_pass_ref = null,
         updated_at      = now()
   where booking_id = v_booking.booking_id;

  perform _recalc_total(v_booking.booking_id);
  return _booking_json(p_ref);
end $$;

-- 5b) Helper used in Scene 5 to add/remove baggage (1 included, extra = EUR 45)
create or replace function change_baggage(p_ref text, p_baggage_count int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where booking_reference = p_ref;
  if not found then return jsonb_build_object('error','booking_not_found'); end if;
  if p_baggage_count < 1 then return jsonb_build_object('error','min_one_bag'); end if;

  update bookings
     set baggage_count   = p_baggage_count,
         baggage_charge  = greatest(p_baggage_count - 1, 0) * 45.00,
         booking_status  = 'pending',
         boarding_pass_ref = null,
         updated_at      = now()
   where booking_id = v_booking.booking_id;

  perform _recalc_total(v_booking.booking_id);
  return _booking_json(p_ref);
end $$;

-- 6) POST /bookings/{ref}/quote  (breakdown vs last confirmed state)
create or replace function quote_booking(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b bookings%rowtype; fc numeric; sc numeric; bc numeric;
begin
  select * into b from bookings where booking_reference = p_ref;
  if not found then return jsonb_build_object('error','booking_not_found'); end if;
  fc := round(b.base_price     - b.orig_base_price, 2);
  sc := round(b.seat_surcharge - b.orig_seat_surcharge, 2);
  bc := round(b.baggage_charge - b.orig_baggage_charge, 2);
  return jsonb_build_object(
    'flight_change',  fc,
    'seat_change',    sc,
    'baggage_change', bc,
    'total_change',   round(fc + sc + bc, 2),
    'currency',       'EUR'
  );
end $$;

-- 7) POST /bookings/{ref}/confirm  (lock, boarding pass, CRM sync)
create or replace function confirm_booking(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b bookings%rowtype; v_pass text;
begin
  select * into b from bookings where booking_reference = p_ref;
  if not found then return jsonb_build_object('error','booking_not_found'); end if;
  if b.seat_number is null then
    return jsonb_build_object('error','no_seat_selected',
      'message','Please select a seat before confirming the booking.');
  end if;

  v_pass := 'BP-' || b.booking_reference || '-' ||
            (select flight_number from flights where flight_id = b.flight_id);

  update bookings
     set booking_status      = 'confirmed',
         boarding_pass_ref   = v_pass,
         orig_base_price     = base_price,      -- new baseline after confirm
         orig_seat_surcharge = seat_surcharge,
         orig_baggage_charge = baggage_charge,
         crm_synced_at       = now(),
         updated_at          = now()
   where booking_id = b.booking_id;

  -- keep flight occupancy roughly in sync
  update flights f set occupied_seats = (
     select count(*) from seats s where s.flight_id = f.flight_id and s.status='booked')
   where f.flight_id = b.flight_id;

  return jsonb_build_object(
    'confirmation', 'confirmed',
    'booking',      _booking_json(p_ref),
    'boarding_pass_ref', v_pass,
    'crm_synced',   true,
    'email_sent',   true,     -- stub: real email/PDF is a future edge function
    'message', 'Booking confirmed. Boarding pass sent to customer email.'
  );
end $$;

-- 8) Demo helper: reset booking ABC123 to the starting state
--    (NS1142, seat 23C, 1 bag, EUR 250, confirmed). Re-runnable, safe to call anytime.
create or replace function reset_demo()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bid bigint; v_fid bigint;
begin
  select booking_id into v_bid from bookings where booking_reference = 'ABC123';
  if v_bid is null then return jsonb_build_object('error','demo_booking_missing'); end if;
  select flight_id into v_fid from flights where flight_number = 'NS1142';

  -- release every seat this booking currently holds (on any flight)
  update seats set status='available', booking_id=null where booking_id = v_bid;
  -- re-hold 23C on NS1142
  update seats set status='booked', booking_id=v_bid
   where flight_id = v_fid and seat_number = '23C';

  -- restore the booking row to the seeded starting values
  update bookings set
    flight_id           = v_fid,
    seat_number         = '23C',
    baggage_count       = 1,
    booking_status      = 'confirmed',
    base_price          = 250.00,
    seat_surcharge      = 0.00,
    baggage_charge      = 0.00,
    total_price         = 250.00,
    orig_base_price     = 250.00,
    orig_seat_surcharge = 0.00,
    orig_baggage_charge = 0.00,
    boarding_pass_ref   = null,
    crm_synced_at       = null,
    updated_at          = now()
  where booking_id = v_bid;

  -- resync occupancy counters
  update flights f set occupied_seats = (
    select count(*) from seats s where s.flight_id = f.flight_id and s.status='booked')
   where f.flight_id > 0;

  return _booking_json('ABC123');
end $$;

-- ---------- Grants: let the anon/auth API roles call the functions ----------
grant execute on function
  get_booking(text), search_flights(text,text,date,text), change_flight(text,text),
  get_seat_map(text), change_seat(text,text), change_baggage(text,int),
  quote_booking(text), confirm_booking(text), reset_demo()
to anon, authenticated;
