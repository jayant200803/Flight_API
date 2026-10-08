-- =====================================================================
-- Seed data — Singapore (SIN) -> Tokyo Narita (NRT), 2026-10-08 (Thu)
-- PRD scenario: 6 flights, one sold out (NS1120), one low-availability (NS1180).
-- Safe to re-run (truncates first).
-- =====================================================================
truncate table seats, bookings, pricing, flights, customers restart identity cascade;

-- ---------- Flights (6 options on the same day) ----------
insert into flights (flight_number, origin_airport, destination_airport, departure_time, arrival_time, total_seats, base_fare, aircraft_type) values
('NS1142','SIN','NRT','2026-10-08 14:05:00','2026-10-08 15:50:00',180,250.00,'Boeing 787-9'), -- current booking flight
('NS1120','SIN','NRT','2026-10-08 07:00:00','2026-10-08 08:45:00',180,260.00,'Airbus A350-900'), -- SOLD OUT scenario
('NS1134','SIN','NRT','2026-10-08 09:40:00','2026-10-08 11:25:00',180,250.00,'Boeing 787-9'), -- 0 delta
('NS1150','SIN','NRT','2026-10-08 17:15:00','2026-10-08 19:00:00',180,215.00,'Airbus A350-900'), -- -35
('NS1156','SIN','NRT','2026-10-08 20:30:00','2026-10-08 22:15:00',180,190.00,'Boeing 787-9'), -- cheapest (-60)
('NS1180','SIN','NRT','2026-10-08 23:00:00','2026-10-09 00:45:00',180,230.00,'Airbus A350-900'); -- -20, LOW availability

-- ---------- Flights for additional days (2026-10-09 .. 2026-10-21) ----------
-- Same 6 daily options (SIN->NRT), unique numbers per day (NS<MMDD><seq>),
-- normal availability. Lets the agent search any date in this range.
do $$
declare d date; i int;
begin
  for i in 1..13 loop
    d := date '2026-10-08' + i;
    insert into flights (flight_number, origin_airport, destination_airport, departure_time, arrival_time, total_seats, base_fare, aircraft_type) values
      ('NS'||to_char(d,'MMDD')||'1','SIN','NRT', d + time '14:05', d + time '15:50', 180, 250.00, 'Boeing 787-9'),
      ('NS'||to_char(d,'MMDD')||'2','SIN','NRT', d + time '07:00', d + time '08:45', 180, 260.00, 'Airbus A350-900'),
      ('NS'||to_char(d,'MMDD')||'3','SIN','NRT', d + time '09:40', d + time '11:25', 180, 250.00, 'Boeing 787-9'),
      ('NS'||to_char(d,'MMDD')||'4','SIN','NRT', d + time '17:15', d + time '19:00', 180, 215.00, 'Airbus A350-900'),
      ('NS'||to_char(d,'MMDD')||'5','SIN','NRT', d + time '20:30', d + time '22:15', 180, 190.00, 'Boeing 787-9'),
      ('NS'||to_char(d,'MMDD')||'6','SIN','NRT', d + time '23:00', (d + 1) + time '00:45', 180, 230.00, 'Airbus A350-900');
  end loop;
end $$;

-- ---------- Customer ----------
insert into customers (account_number, customer_name, date_of_birth, email, phone, crm_id) values
('AC7620','Shivam Sharma','1992-07-18','shivam@example.com','+65 8123 4567','CRM-AC7620');

-- ---------- Seats for every flight (rows 1-30, cols A-F) ----------
-- Classification: A/F = window, C/D = aisle, B/E = middle;
-- rows 12-13 = emergency_row (+25); rows 1-5 = front rows (+15); others = 0.
do $$
declare f record; r int; c text; cols text[] := array['A','B','C','D','E','F'];
        st seat_type; delta numeric; occ numeric;
begin
  perform setseed(0.42);
  for f in select flight_id, flight_number from flights loop
    -- occupancy target per scenario
    occ := case f.flight_number
             when 'NS1120' then 1.00   -- sold out
             when 'NS1180' then 0.92   -- low availability
             when 'NS1142' then 0.55   -- ~50-60%
             else 0.40 end;
    for r in 1..30 loop
      foreach c in array cols loop
        if r in (12,13) then
          st := 'emergency_row'; delta := 25;
        else
          st := case when c in ('A','F') then 'window'::seat_type
                     when c in ('C','D') then 'aisle'::seat_type
                     else 'middle'::seat_type end;   -- B/E = middle
          delta := case when r between 1 and 5 then 15 else 0 end;
        end if;
        insert into seats (flight_id, seat_number, row_number, column_letter, seat_type, base_price_delta, status)
        values (f.flight_id, r::text||c, r, c, st, delta,
                (case when random() < occ then 'booked' else 'available' end)::seat_status);
      end loop;
    end loop;
  end loop;
end $$;

-- Guarantee demo seats on NS1156: 23C booked (so "23C not available on this flight"),
-- and the two free window seats 6A & 6F available at EUR 0.
update seats set status='booked', booking_id=null
 where flight_id=(select flight_id from flights where flight_number='NS1156') and seat_number='23C';
update seats set status='available', booking_id=null
 where flight_id=(select flight_id from flights where flight_number='NS1156') and seat_number in ('6A','6F');

-- ---------- 12 identical demo bookings: ABC123 .. ABC134 ----------
-- Each starts on NS1142, 1 bag, EUR 250, confirmed, with its own aisle seat
-- (distinct seats so there is no clash on the shared flight). ABC123 = seat 23C.
do $$
declare v_cid bigint; v_fid bigint; i int; v_ref text; v_seat text; v_bid bigint;
        seats text[] := array['23C','23D','23E','23B','24B','24C','24D','24E','25B','25C','25D','25E'];
begin
  select customer_id into v_cid from customers where account_number='AC7620';
  select flight_id   into v_fid from flights   where flight_number='NS1142';
  for i in 1 .. array_length(seats,1) loop
    v_ref  := 'ABC' || (122 + i)::text;   -- i=1 -> ABC123
    v_seat := seats[i];
    insert into bookings (
      customer_id, flight_id, booking_reference, primary_passenger_name, passenger_count,
      seat_number, baggage_count, booking_status, base_price, seat_surcharge, baggage_charge,
      total_price, orig_base_price, orig_seat_surcharge, orig_baggage_charge)
    values (v_cid, v_fid, v_ref, 'Shivam Sharma', 1,
      v_seat, 1, 'confirmed', 250.00, 0.00, 0.00,
      250.00, 250.00, 0.00, 0.00)
    returning booking_id into v_bid;
    update seats set status='booked', booking_id=v_bid
      where flight_id=v_fid and seat_number=v_seat;
  end loop;
end $$;

-- ---------- Pricing reference rows ----------
insert into pricing (flight_id, seat_type, price_delta, change_fee_override)
select flight_id, 'window'::seat_type, 0, 0 from flights
union all select flight_id, 'aisle'::seat_type, 0, 0 from flights
union all select flight_id, 'emergency_row'::seat_type, 25, 0 from flights;

-- ---------- Sync occupied_seats counters ----------
update flights f set occupied_seats = (
  select count(*) from seats s where s.flight_id=f.flight_id and s.status='booked');
