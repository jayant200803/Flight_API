-- =====================================================================
-- Seed data — Oslo (OSL) -> London Heathrow (LHR), 2026-10-01 (Thu)
-- Matches the Nordic Sky demo video (OSL->LHR, Thu 1 - Sun 4 October)
-- while keeping the PRD scenarios (sold-out NS1120, low-avail NS1180).
-- Safe to re-run (truncates first).
-- =====================================================================
truncate table seats, bookings, pricing, flights, customers restart identity cascade;

-- ---------- Flights (6 options on the same day) ----------
insert into flights (flight_number, origin_airport, destination_airport, departure_time, arrival_time, total_seats, base_fare, aircraft_type) values
('NS1142','OSL','LHR','2026-10-01 14:05:00','2026-10-01 15:50:00',180,250.00,'Boeing 787-9'), -- current booking flight
('NS1120','OSL','LHR','2026-10-01 07:00:00','2026-10-01 08:45:00',180,260.00,'Airbus A350-900'), -- SOLD OUT scenario
('NS1134','OSL','LHR','2026-10-01 09:40:00','2026-10-01 11:25:00',180,250.00,'Boeing 787-9'), -- video: "NS1134 at 09:40"
('NS1150','OSL','LHR','2026-10-01 17:15:00','2026-10-01 19:00:00',180,215.00,'Airbus A350-900'), -- video: "NS1150 at 17:15" (-35)
('NS1156','OSL','LHR','2026-10-01 20:30:00','2026-10-01 22:15:00',180,190.00,'Boeing 787-9'), -- cheapest (-60)
('NS1180','OSL','LHR','2026-10-01 23:00:00','2026-10-02 00:45:00',180,230.00,'Airbus A350-900'); -- LOW availability

-- ---------- Customer ----------
insert into customers (account_number, customer_name, date_of_birth, email, phone, crm_id) values
('NS7620','Ingrid Solberg','1990-05-15','ingrid.solberg@example.com','+65 8123 4567','CRM-NS7620');

-- ---------- Seats for every flight (rows 1-30, cols A-F) ----------
-- Classification: A/F = window, C/D = aisle, B/E = aisle (no middle enum in PRD);
-- rows 12-13 = emergency_row (+25); rows 1-2 = front rows (+15); others = 0.
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
        if r in (12,13) then st := 'emergency_row'; delta := 25;
        elsif r in (1,2) then st := (case when c in ('A','F') then 'window' else 'aisle' end); delta := 15;
        else st := (case when c in ('A','F') then 'window' else 'aisle' end); delta := 0;
        end if;
        insert into seats (flight_id, seat_number, row_number, column_letter, seat_type, base_price_delta, status)
        values (f.flight_id, r::text||c, r, c, st, delta,
                (case when random() < occ then 'booked' else 'available' end)::seat_status);
      end loop;
    end loop;
  end loop;
end $$;

-- Guarantee the demo seats: 23C booked on NS1142 (current), 6A & 6F free on NS1156
update seats set status='booked'
 where flight_id=(select flight_id from flights where flight_number='NS1142') and seat_number='23C';
update seats set status='available', booking_id=null
 where flight_id=(select flight_id from flights where flight_number='NS1156') and seat_number in ('6A','6F');

-- ---------- The demo booking (on NS1142, seat 23C, 1 bag, EUR 250) ----------
insert into bookings (
  customer_id, flight_id, booking_reference, primary_passenger_name, passenger_count,
  seat_number, baggage_count, booking_status, base_price, seat_surcharge, baggage_charge,
  total_price, orig_base_price, orig_seat_surcharge, orig_baggage_charge)
select c.customer_id, f.flight_id, 'NS7K2Q', c.customer_name, 1,
       '23C', 1, 'confirmed', 250.00, 0.00, 0.00,
       250.00, 250.00, 0.00, 0.00
from customers c cross join flights f
where c.account_number='NS7620' and f.flight_number='NS1142';

-- link seat 23C to that booking
update seats set booking_id = (select booking_id from bookings where booking_reference='NS7K2Q')
 where flight_id=(select flight_id from flights where flight_number='NS1142') and seat_number='23C';

-- ---------- Pricing reference rows ----------
insert into pricing (flight_id, seat_type, price_delta, change_fee_override)
select flight_id, 'window'::seat_type, 0, 0 from flights
union all select flight_id, 'aisle'::seat_type, 0, 0 from flights
union all select flight_id, 'emergency_row'::seat_type, 25, 0 from flights;

-- ---------- Sync occupied_seats counters ----------
update flights f set occupied_seats = (
  select count(*) from seats s where s.flight_id=f.flight_id and s.status='booked');
