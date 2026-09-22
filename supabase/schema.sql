-- Mutare City Council IT Help Desk — Supabase schema
-- Run this in the Supabase SQL editor before connecting the app.

create type employee_role as enum ('Employee', 'Technician', 'Administrator');
create type employee_status as enum ('Active', 'Invited');
create type ticket_status as enum ('Open', 'In progress', 'Resolved');
create type ticket_priority as enum ('Critical', 'High', 'Medium', 'Low');

create table employees (
  id          text primary key,
  name        text not null,
  email       text not null unique,
  department  text not null,
  role        employee_role not null,
  status      employee_status not null default 'Active',
  created_at  timestamptz not null default now()
);

create table tickets (
  id           text primary key,
  title        text not null,
  category     text not null,
  requester_id text references employees(id) on delete set null,
  department   text not null,
  reported_at  timestamptz not null default now(),
  priority     ticket_priority not null default 'Medium',
  status       ticket_status not null default 'Open',
  assignee_id  text references employees(id) on delete set null,
  description  text not null,
  created_at   timestamptz not null default now()
);

create table activities (
  id          uuid primary key default gen_random_uuid(),
  user_id     text references employees(id) on delete cascade,
  action      text not null,
  created_at  timestamptz not null default now()
);

create index idx_tickets_requester on tickets(requester_id);
create index idx_tickets_assignee on tickets(assignee_id);
create index idx_activities_user on activities(user_id);

-- Demo prototype note: this app's Login screen accepts any password and
-- looks a person up by email in `employees`, so it is NOT using Supabase
-- Auth. Row Level Security is left disabled here so the anon key can read
-- and write freely. Before putting real data behind this, either enable
-- RLS with policies keyed to a real auth.uid(), or keep this project for
-- internal/demo use only.
