-- ============================================================
-- Ciclo Study — schema inicial (Supabase / Postgres)
--
-- Modelo mental:
--   auth.users            (Supabase Auth, gerenciado)
--     └── profiles        1:1, guarda o papel: 'aluno' | 'professor'
--     └── students        1 linha por CICLO de estudo de um aluno
--                         .seed  = o data.js daquele aluno (SUBJECTS / SUBJECT_QUEUE / TOPICS_SEED)
--                         .state = o MESMO blob que hoje vive no localStorage (buildInitialState)
--     └── professor_students   vínculo professor -> aluno (N:N)
--     └── state_snapshots      histórico do state (recuperação / auditoria)
--     └── completions          log achatado de conclusões (relatórios do professor)
--
-- O state NÃO é normalizado de propósito: o engine.js já validado lê e escreve
-- esse objeto inteiro. Normalizar exigiria reescrever o motor.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'aluno' check (role in ('aluno','professor')),
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil 1:1 com auth.users. role define o que a API libera.';

-- cria o profile automaticamente quando um usuário se cadastra no Auth.
-- O papel pode vir em raw_user_meta_data->>'role' (definido no convite/signup).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when new.raw_user_meta_data->>'role' = 'professor' then 'professor' else 'aluno' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- students (um ciclo de estudo)
-- ------------------------------------------------------------
create table if not exists public.students (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users(id) on delete set null,
  name          text not null,
  kind          text not null default 'kaleu',           -- variante do motor (kaleu, cbm, ...)
  timezone      text not null default 'America/Boa_Vista',
  seed          jsonb not null,                          -- { subjects, subjectQueue, topicsSeed }
  state         jsonb not null,                          -- blob do engine (mesmo formato do localStorage)
  state_version bigint not null default 1,               -- concorrência otimista entre dispositivos
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists students_user_id_idx on public.students(user_id);

comment on column public.students.state is
  'Blob do engine.js: version, config, subjects, topics, subjectQueue, subjSolido, per, day, streak, log, meta.';
comment on column public.students.state_version is
  'Incrementa a cada gravação. O cliente manda o valor que leu; divergência = 409 (outro dispositivo gravou antes).';

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists students_touch_updated_at on public.students;
create trigger students_touch_updated_at
  before update on public.students
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- vínculo professor -> aluno
-- ------------------------------------------------------------
create table if not exists public.professor_students (
  professor_id uuid not null references public.profiles(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (professor_id, student_id)
);

create index if not exists professor_students_student_idx on public.professor_students(student_id);

-- ------------------------------------------------------------
-- histórico do state (rede de segurança; o state é sobrescrito a cada gravação)
-- ------------------------------------------------------------
create table if not exists public.state_snapshots (
  id            bigserial primary key,
  student_id    uuid not null references public.students(id) on delete cascade,
  state_version bigint not null,
  reason        text,                                     -- 'complete' | 'extra' | 'config' | 'seed' | ...
  state         jsonb not null,
  created_at    timestamptz not null default now()
);

create index if not exists state_snapshots_student_idx
  on public.state_snapshots(student_id, created_at desc);

-- mantém apenas os 50 snapshots mais recentes por aluno
create or replace function public.prune_state_snapshots()
returns trigger language plpgsql as $$
begin
  delete from public.state_snapshots s
  where s.student_id = new.student_id
    and s.id not in (
      select id from public.state_snapshots
      where student_id = new.student_id
      order by id desc
      limit 50
    );
  return null;
end;
$$;

drop trigger if exists state_snapshots_prune on public.state_snapshots;
create trigger state_snapshots_prune
  after insert on public.state_snapshots
  for each row execute function public.prune_state_snapshots();

-- ------------------------------------------------------------
-- completions: cada meta concluída vira uma linha (state.log achatado)
-- Serve pro painel do professor sem precisar abrir o JSONB de todo mundo.
-- ------------------------------------------------------------
create table if not exists public.completions (
  id         bigserial primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  done_on    date not null,
  item_type  text not null,        -- 'step' | 'extra' | 'per' | 'solido'
  subj       text,
  topic_id   text,
  step       text,                 -- E1, E2, EXTRA, RATIVA, Q1, Q2, Q3, QE
  hours      numeric(5,2) not null default 0,
  ref        jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists completions_student_idx on public.completions(student_id, done_on desc);

-- ============================================================
-- RLS — defesa em profundidade.
-- A API roda com a service_role (ignora RLS) e faz a autorização em código,
-- mas se um dia o front falar direto com o Postgrest, estas policies valem.
-- ============================================================

alter table public.profiles           enable row level security;
alter table public.students           enable row level security;
alter table public.professor_students enable row level security;
alter table public.state_snapshots    enable row level security;
alter table public.completions        enable row level security;

-- helper: o professor logado está vinculado a este aluno?
create or replace function public.teaches_student(p_student uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.professor_students ps
    join public.profiles p on p.id = ps.professor_id
    where ps.student_id = p_student
      and ps.professor_id = auth.uid()
      and p.role = 'professor'
  );
$$;

-- profiles
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_professor_read on public.profiles;
create policy profiles_professor_read on public.profiles
  for select using (
    exists (
      select 1 from public.students s
      where s.user_id = public.profiles.id
        and public.teaches_student(s.id)
    )
  );

-- students
drop policy if exists students_self_read on public.students;
create policy students_self_read on public.students
  for select using (user_id = auth.uid());

drop policy if exists students_self_update on public.students;
create policy students_self_update on public.students
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists students_professor_read on public.students;
create policy students_professor_read on public.students
  for select using (public.teaches_student(id));

-- professor_students
drop policy if exists ps_professor_read on public.professor_students;
create policy ps_professor_read on public.professor_students
  for select using (professor_id = auth.uid());

drop policy if exists ps_student_read on public.professor_students;
create policy ps_student_read on public.professor_students
  for select using (
    exists (select 1 from public.students s where s.id = student_id and s.user_id = auth.uid())
  );

-- snapshots / completions: leitura do próprio aluno e do professor vinculado.
-- Escrita: só service_role (nenhuma policy de insert = negado pro cliente).
drop policy if exists snapshots_read on public.state_snapshots;
create policy snapshots_read on public.state_snapshots
  for select using (
    exists (select 1 from public.students s where s.id = student_id and s.user_id = auth.uid())
    or public.teaches_student(student_id)
  );

drop policy if exists completions_read on public.completions;
create policy completions_read on public.completions
  for select using (
    exists (select 1 from public.students s where s.id = student_id and s.user_id = auth.uid())
    or public.teaches_student(student_id)
  );
