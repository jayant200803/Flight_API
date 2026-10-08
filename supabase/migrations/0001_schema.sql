-- =====================================================================
-- Flight Booking Voice Agent Demo — Schema (Supabase / PostgreSQL)
-- PRD: 5 core tables (flights, seats, customers, bookings, pricing)
-- Safe to re-run: guards + IF NOT EXISTS where possible.
-- =====================================================================

-- ---------- Enums ----------
do $$ begin
  create type seat_type   as enum ('window','aisle','middle','emergency_row');
exception when duplicate_object then null; end $$;
-- ensure 'middle' exists on databases created before it was added (idempotent)
alter type seat_type add value if not exists 'middle';

do $$ begin
  create type seat_status as enum ('available','booked','blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type booking_status as enum ('pending','confirmed','cancelled');
exception when duplicate_object then null; end $$;

-- ---------- FLIGHTS ----------
create table if not exists flights (
  flight_id         bigint generated always as identity primary key,
  flight_number     varchar(10)  unique not null,
  origin_airport    varchar(3)   not null,
  destination_airport varchar(3) not null,
  departure_time    timestamp    not null,
  arrival_time      timestamp    not null,
  total_seats       int          not null default 180,
  occupied_seats    int          not null default 0,
  base_fare         numeric(10,2) not null check (base_fare >= 0),
  aircraft_type     varchar(50)  not null default 'Boeing 787-9'
);
create index if not exists idx_flights_route_date
  on flights (origin_airport, destination_airport, departure_time);

-- ---------- CUSTOMERS ----------
create table if not exists customers (
  customer_id     bigint generated always as identity primary key,
  account_number  varchar(20)  unique not null,
  customer_name   varchar(100) not null,
  date_of_birth   date         not null,
  email           varchar(100) not null,
  phone           varchar(20)  not null,
  crm_id          varchar(50)  unique not null
);

-- ---------- BOOKINGS ----------
create table if not exists bookings (
  booking_id            bigint generated always as identity primary key,
  customer_id           bigint not null references customers(customer_id),
  flight_id             bigint not null references flights(flight_id),
  booking_reference     varchar(10) unique not null,
  primary_passenger_name varchar(100) not null,
  passenger_count       int not null default 1,
  seat_number           varchar(5),
  baggage_count         int not null default 1,          -- 1 bag included
  booking_status        booking_status not null default 'pending',
  base_price            numeric(10,2) not null,
  seat_surcharge        numeric(10,2) not null default 0,
  baggage_charge        numeric(10,2) not null default 0,
  total_price           numeric(10,2) not null,
  -- snapshot of the last CONFIRMED state, used to compute the quote deltas
  orig_base_price       numeric(10,2) not null,
  orig_seat_surcharge   numeric(10,2) not null default 0,
  orig_baggage_charge   numeric(10,2) not null default 0,
  boarding_pass_ref     varchar(40),
  crm_synced_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------- SEATS ----------
create table if not exists seats (
  seat_id          bigint generated always as identity primary key,
  flight_id        bigint not null references flights(flight_id),
  seat_number      varchar(5) not null,
  row_number       int not null,
  column_letter    char(1) not null,
  seat_type        seat_type not null,
  base_price_delta numeric(10,2) not null default 0,  -- 0 / 15 / 25
  status           seat_status not null default 'available',
  booking_id       bigint references bookings(booking_id),
  unique (flight_id, seat_number)
);
create index if not exists idx_seats_flight_status on seats (flight_id, status);

-- ---------- PRICING (reference rules, per PRD) ----------
create table if not exists pricing (
  price_id            bigint generated always as identity primary key,
  flight_id           bigint references flights(flight_id),
  seat_type           seat_type not null,
  price_delta         numeric(10,2) not null,
  change_fee_override  numeric(10,2) default 0
);

-- ---------- Row Level Security ----------
-- Tables are locked down; ALL access goes through the SECURITY DEFINER
-- RPC functions in 0002_functions.sql. This is safe for the demo.
alter table flights   enable row level security;
alter table seats     enable row level security;
alter table customers enable row level security;
alter table bookings  enable row level security;
alter table pricing   enable row level security;
