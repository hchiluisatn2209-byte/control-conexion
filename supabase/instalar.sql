-- =====================================================================
--  Control de Conexión — instalación en Supabase
--  Pega TODO este archivo en Supabase > SQL Editor y pulsa "Run".
--  Se puede volver a ejecutar sin perder datos.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Las tablas viven en el esquema "privado", que Supabase NO publica por su API.
-- Agentes y páginas solo pueden usar las funciones de más abajo.
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

-- ---------- Ajustes generales (una sola fila) ----------
create table if not exists privado.ajustes (
  id                   int primary key default 1 check (id = 1),
  clave_admin_hash     text,
  zona_horaria         text not null default 'America/Guayaquil',
  minutos_desconexion  int  not null default 3,    -- sin latido por más de N min = desconectado
  minutos_inactividad  int  not null default 10,   -- sin teclado/ratón por más de N min = inactivo
  dias_conservar       int  not null default 60    -- latidos más antiguos se borran
);
insert into privado.ajustes (id) values (1) on conflict do nothing;

-- ---------- Personas ----------
create table if not exists privado.empleados (
  id            serial primary key,
  nombre        text not null,
  email         text unique not null,
  equipo        text not null default 'General',
  github_user   text,
  token_agente  text unique not null default encode(extensions.gen_random_bytes(24), 'hex'),
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);

-- ---------- Latidos que envía el agente cada minuto ----------
create table if not exists privado.latidos (
  id               bigserial primary key,
  empleado_id      int not null references privado.empleados(id) on delete cascade,
  recibido_en      timestamptz not null default now(),
  equipo_host      text,
  ip_local         text,
  internet_ok      boolean,
  latencia_ms      int,
  github_ok        boolean,
  github_detalle   text,
  postgres_ok      boolean,
  postgres_detalle text,
  inactivo_seg     int,
  trabajando       boolean not null default false
);
create index if not exists idx_latidos_emp_fecha on privado.latidos (empleado_id, recibido_en desc);

-- ---------- Jornadas (inicio / fin) ----------
create table if not exists privado.jornadas (
  id           bigserial primary key,
  empleado_id  int not null references privado.empleados(id) on delete cascade,
  inicio       timestamptz not null default now(),
  fin          timestamptz
);
create index if not exists idx_jornadas_emp on privado.jornadas (empleado_id, inicio desc);

-- ---------- Versión 2: uso de aplicaciones, páginas de trabajo y tiempo conectado ----------
alter table privado.ajustes add column if not exists paginas_trabajo text[]  not null default '{}';
alter table privado.ajustes add column if not exists registrar_uso   boolean not null default true;
alter table privado.latidos add column if not exists intervalo_seg int;
alter table privado.latidos add column if not exists paginas jsonb;

-- Tiempo por aplicación / sitio y día (solo nombres, nunca contenido)
create table if not exists privado.uso (
  empleado_id  int  not null references privado.empleados(id) on delete cascade,
  dia          date not null,
  app          text not null,
  sitio        text not null default '',
  segundos     int  not null default 0,
  primary key (empleado_id, dia, app, sitio)
);
create index if not exists idx_uso_dia on privado.uso (dia);

-- Protección extra por si alguien publica el esquema por error
alter table privado.ajustes   enable row level security;
alter table privado.empleados enable row level security;
alter table privado.latidos   enable row level security;
alter table privado.jornadas  enable row level security;
alter table privado.uso       enable row level security;

-- =====================================================================
--  Funciones internas
-- =====================================================================

-- Medianoche de hoy en la zona horaria configurada
create or replace function privado.inicio_hoy() returns timestamptz
language sql stable set search_path = '' as $$
  select date_trunc('day', now() at time zone a.zona_horaria) at time zone a.zona_horaria
  from privado.ajustes a
$$;

create or replace function privado.dia_hoy() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone a.zona_horaria)::date from privado.ajustes a
$$;

create or replace function privado.empleado_por_token(p_token text) returns int
language plpgsql stable set search_path = '' as $$
declare v_id int;
begin
  select e.id into v_id from privado.empleados e where e.token_agente = p_token and e.activo;
  if v_id is null then
    raise exception 'Token no válido' using errcode = '28000';
  end if;
  return v_id;
end $$;

create or replace function privado.exigir_admin(p_clave text) returns void
language plpgsql volatile set search_path = '' as $$
declare v_hash text;
begin
  select clave_admin_hash into v_hash from privado.ajustes;
  if v_hash is null then
    raise exception 'Aún no se ha fijado la clave de administrador (paso 3 de la guía)';
  end if;
  if p_clave is null or extensions.crypt(p_clave, v_hash) <> v_hash then
    perform pg_sleep(1);  -- frena intentos de adivinar la clave
    raise exception 'Clave de administrador incorrecta' using errcode = '28000';
  end if;
end $$;

-- Para fijar o cambiar la clave:  select privado.fijar_clave_admin('mi-clave-larga');
create or replace function privado.fijar_clave_admin(p_clave text) returns text
language plpgsql set search_path = '' as $$
begin
  if length(p_clave) < 12 then
    raise exception 'Usa una clave de al menos 12 caracteres';
  end if;
  update privado.ajustes set clave_admin_hash = extensions.crypt(p_clave, extensions.gen_salt('bf'));
  return 'Clave de administrador guardada';
end $$;

-- Estado actual de cada persona
drop function if exists privado.estado_actual();
create function privado.estado_actual()
returns table (
  id int, nombre text, email text, equipo text, github_user text,
  ultimo_latido timestamptz, equipo_host text, ip_local text,
  internet_ok boolean, latencia_ms int, github_ok boolean, github_detalle text,
  postgres_ok boolean, postgres_detalle text, inactivo_seg int, paginas jsonb,
  jornada_abierta boolean, estado text, segundos_hoy int,
  conectado_seg int, activo_seg int, primera_conexion timestamptz)
language sql stable set search_path = '' as $$
  select e.id, e.nombre, e.email, e.equipo, e.github_user,
         l.recibido_en, l.equipo_host, l.ip_local,
         l.internet_ok, l.latencia_ms, l.github_ok, l.github_detalle,
         l.postgres_ok, l.postgres_detalle, l.inactivo_seg, l.paginas,
         ja.abierta,
         case
           when l.recibido_en is null
             or l.recibido_en < now() - make_interval(mins => a.minutos_desconexion) then 'desconectado'
           when not ja.abierta then 'pausa'
           when coalesce(l.inactivo_seg, 0) > a.minutos_inactividad * 60 then 'inactivo'
           else 'conectado'
         end,
         coalesce((
           select sum(extract(epoch from (coalesce(j.fin, now()) - greatest(j.inicio, h.ini))))
           from privado.jornadas j
           where j.empleado_id = e.id and coalesce(j.fin, now()) > h.ini
         ), 0)::int,
         coalesce(c.conectado, 0)::int, coalesce(c.activo, 0)::int, c.primera
  from privado.empleados e
  cross join privado.ajustes a
  cross join (select privado.inicio_hoy() as ini) h
  left join lateral (
    select * from privado.latidos x where x.empleado_id = e.id order by x.recibido_en desc limit 1
  ) l on true
  left join lateral (
    select sum(coalesce(x.intervalo_seg, 60)) as conectado,
           sum(coalesce(x.intervalo_seg, 60)) filter (where coalesce(x.inactivo_seg, 0) <= a.minutos_inactividad * 60) as activo,
           min(x.recibido_en) as primera
    from privado.latidos x where x.empleado_id = e.id and x.recibido_en >= h.ini
  ) c on true
  cross join lateral (
    select exists (select 1 from privado.jornadas j where j.empleado_id = e.id and j.fin is null) as abierta
  ) ja
  where e.activo
$$;

-- Borra latidos antiguos (se programa con pg_cron, paso opcional de la guía)
create or replace function privado.limpiar() returns int
language plpgsql set search_path = '' as $$
declare n int;
begin
  delete from privado.latidos
  where recibido_en < now() - make_interval(days => (select dias_conservar from privado.ajustes));
  get diagnostics n = row_count;
  delete from privado.uso where dia < privado.dia_hoy() - 365;
  return n;
end $$;

-- =====================================================================
--  API pública (la usan el agente y las páginas)
-- =====================================================================

-- Agente: latido cada minuto
create or replace function public.latido(p_token text, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id int := privado.empleado_por_token(p_token); v_trab boolean; a record;
begin
  select * into a from privado.ajustes;
  select exists (select 1 from privado.jornadas where empleado_id = v_id and fin is null) into v_trab;
  insert into privado.latidos (empleado_id, equipo_host, ip_local, internet_ok, latencia_ms,
                               github_ok, github_detalle, postgres_ok, postgres_detalle, inactivo_seg, trabajando,
                               intervalo_seg, paginas)
  values (v_id,
          left(p_datos->>'host', 100), left(p_datos->>'ip', 60),
          (p_datos->>'internet_ok')::boolean, (p_datos->>'latencia_ms')::int,
          (p_datos->>'github_ok')::boolean, left(p_datos->>'github_detalle', 300),
          (p_datos->>'postgres_ok')::boolean, left(p_datos->>'postgres_detalle', 300),
          (p_datos->>'inactivo_seg')::int, v_trab,
          least(greatest(coalesce((p_datos->>'intervalo')::int, 60), 10), 600),
          case when jsonb_typeof(p_datos->'paginas') = 'array' then p_datos->'paginas' end);

  -- Tiempo por aplicación / sitio
  if a.registrar_uso and jsonb_typeof(p_datos->'uso') = 'array' then
    insert into privado.uso as u (empleado_id, dia, app, sitio, segundos)
    select v_id, privado.dia_hoy(), t.app, t.sitio, least(sum(t.seg), 3600)::int
    from (
      select left(coalesce(nullif(trim(x->>'app'), ''), 'Desconocido'), 60) as app,
             left(coalesce(trim(x->>'sitio'), ''), 60) as sitio,
             greatest(coalesce((x->>'seg')::int, 0), 0) as seg
      from jsonb_array_elements(p_datos->'uso') x
    ) t
    group by t.app, t.sitio
    on conflict (empleado_id, dia, app, sitio) do update set segundos = u.segundos + excluded.segundos;
  end if;

  -- La respuesta lleva los ajustes centrales: el agente los aplica sin reinstalar
  return jsonb_build_object('ok', true, 'trabajando', v_trab,
                            'paginas', to_jsonb(a.paginas_trabajo),
                            'registrar_uso', a.registrar_uso,
                            'umbral_inactivo_seg', a.minutos_inactividad * 60);
end $$;

-- Empleado: su estado
create or replace function public.yo(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id int := privado.empleado_por_token(p_token);
begin
  return (
    select to_jsonb(s) || jsonb_build_object(
      'uso', coalesce((select jsonb_agg(jsonb_build_object('app', u.app, 'sitio', u.sitio, 'segundos', u.segundos) order by u.segundos desc)
                       from (select * from privado.uso where empleado_id = v_id and dia = privado.dia_hoy() order by segundos desc limit 10) u), '[]'),
      'jornada', (
      select to_jsonb(j) from (
        select inicio, fin from privado.jornadas where empleado_id = v_id order by inicio desc limit 1) j))
    from privado.estado_actual() s where s.id = v_id);
end $$;

create or replace function public.iniciar_jornada(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id int := privado.empleado_por_token(p_token);
begin
  update privado.jornadas set fin = now() where empleado_id = v_id and fin is null;
  insert into privado.jornadas (empleado_id) values (v_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.terminar_jornada(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id int := privado.empleado_por_token(p_token);
begin
  update privado.jornadas set fin = now() where empleado_id = v_id and fin is null;
  return jsonb_build_object('ok', true);
end $$;

-- Administrador: estado de todos
create or replace function public.admin_estado(p_clave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform privado.exigir_admin(p_clave);
  return jsonb_build_object(
    'generado', now(),
    'ajustes', (select jsonb_build_object('zona_horaria', zona_horaria, 'minutos_inactividad', minutos_inactividad,
                                          'paginas_trabajo', paginas_trabajo, 'registrar_uso', registrar_uso)
                from privado.ajustes),
    'empleados', coalesce((select jsonb_agg(to_jsonb(s) order by s.nombre) from privado.estado_actual() s), '[]'));
end $$;

-- Administrador: actividad minuto a minuto de hoy
create or replace function public.admin_dia(p_clave text, p_id int) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform privado.exigir_admin(p_clave);
  return coalesce((
    select jsonb_agg(m order by m.minuto) from (
      select date_trunc('minute', recibido_en) as minuto,
             bool_and(coalesce(internet_ok, true) and coalesce(github_ok, true) and coalesce(postgres_ok, true)) as todo_ok,
             max(inactivo_seg) as inactivo_seg,
             bool_or(trabajando) as trabajando
      from privado.latidos
      where empleado_id = p_id and recibido_en >= privado.inicio_hoy()
      group by 1) m), '[]');
end $$;

-- Administrador: agregar una persona (devuelve su token)
create or replace function public.admin_crear_empleado(
  p_clave text, p_nombre text, p_email text, p_equipo text default 'General', p_github_user text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform privado.exigir_admin(p_clave);
  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'Nombre y email son obligatorios';
  end if;
  insert into privado.empleados (nombre, email, equipo, github_user)
  values (trim(p_nombre), lower(trim(p_email)), coalesce(nullif(trim(p_equipo), ''), 'General'), nullif(trim(p_github_user), ''))
  on conflict (email) do update set nombre = excluded.nombre, equipo = excluded.equipo,
                                    github_user = excluded.github_user, activo = true
  returning id, nombre, email, equipo, github_user, token_agente into r;
  return to_jsonb(r);
end $$;

-- Administrador: carga masiva  [{nombre,email,equipo,github_user}, ...]
create or replace function public.admin_cargar_empleados(p_clave text, p_lista jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare x jsonb; res jsonb := '[]'; r record;
begin
  perform privado.exigir_admin(p_clave);
  for x in select * from jsonb_array_elements(p_lista) loop
    continue when coalesce(trim(x->>'nombre'), '') = '' or coalesce(trim(x->>'email'), '') = '';
    insert into privado.empleados (nombre, email, equipo, github_user)
    values (trim(x->>'nombre'), lower(trim(x->>'email')),
            coalesce(nullif(trim(x->>'equipo'), ''), 'General'), nullif(trim(x->>'github_user'), ''))
    on conflict (email) do update set nombre = excluded.nombre, equipo = excluded.equipo,
                                      github_user = excluded.github_user, activo = true
    returning nombre, email, token_agente into r;
    res := res || jsonb_build_object('nombre', r.nombre, 'email', r.email, 'token', r.token_agente);
  end loop;
  return res;
end $$;

-- Administrador: ver el token de una persona (para configurar su agente)
create or replace function public.admin_token(p_clave text, p_id int) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform privado.exigir_admin(p_clave);
  return (select token_agente from privado.empleados where id = p_id);
end $$;

-- Administrador: tokens de todas las personas activas (para descargar todas las configuraciones)
create or replace function public.admin_tokens(p_clave text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform privado.exigir_admin(p_clave);
  return coalesce((select jsonb_agg(jsonb_build_object('nombre', nombre, 'email', email, 'token', token_agente) order by nombre)
                   from privado.empleados where activo), '[]');
end $$;

-- Administrador: generar un token nuevo (el anterior deja de funcionar)
create or replace function public.admin_renovar_token(p_clave text, p_id int) returns text
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  perform privado.exigir_admin(p_clave);
  update privado.empleados set token_agente = encode(extensions.gen_random_bytes(24), 'hex')
  where id = p_id returning token_agente into t;
  return t;
end $$;

-- Administrador: dar de baja (deja de aparecer y su agente ya no puede reportar)
create or replace function public.admin_desactivar_empleado(p_clave text, p_id int) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform privado.exigir_admin(p_clave);
  update privado.empleados set activo = false where id = p_id;
  update privado.jornadas set fin = now() where empleado_id = p_id and fin is null;
  return jsonb_build_object('ok', true);
end $$;

-- Administrador: aplicaciones y sitios de una persona en un día
create or replace function public.admin_uso(p_clave text, p_id int, p_dia date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform privado.exigir_admin(p_clave);
  return coalesce((select jsonb_agg(jsonb_build_object('app', app, 'sitio', sitio, 'segundos', segundos) order by segundos desc)
                   from privado.uso where empleado_id = p_id and dia = coalesce(p_dia, privado.dia_hoy())), '[]');
end $$;

-- Administrador: aplicaciones y sitios más usados por todo el equipo en un día
create or replace function public.admin_uso_equipo(p_clave text, p_dia date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform privado.exigir_admin(p_clave);
  return coalesce((
    select jsonb_agg(t order by t.segundos desc) from (
      select u.app, u.sitio, sum(u.segundos)::int as segundos, count(distinct u.empleado_id)::int as personas
      from privado.uso u join privado.empleados e on e.id = u.empleado_id and e.activo
      where u.dia = coalesce(p_dia, privado.dia_hoy())
      group by u.app, u.sitio order by 3 desc limit 15) t), '[]');
end $$;

-- Administrador: ajustes que los agentes toman automáticamente
create or replace function public.admin_guardar_ajustes(p_clave text, p_paginas text[], p_registrar_uso boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text[];
begin
  perform privado.exigir_admin(p_clave);
  select coalesce(array_agg(distinct trim(x)), '{}') into v
  from unnest(coalesce(p_paginas, '{}')) x where trim(x) <> '';
  if exists (select 1 from unnest(v) x where x !~* '^https?://[^ ]+$') then
    raise exception 'Cada página debe empezar con http:// o https:// y no tener espacios';
  end if;
  if cardinality(v) > 10 then raise exception 'Máximo 10 páginas de trabajo'; end if;
  update privado.ajustes set paginas_trabajo = v, registrar_uso = coalesce(p_registrar_uso, true);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Permisos ----------
revoke all on all functions in schema privado from public, anon, authenticated;
revoke all on function
  public.latido(text, jsonb), public.yo(text), public.iniciar_jornada(text), public.terminar_jornada(text),
  public.admin_estado(text), public.admin_dia(text, int), public.admin_crear_empleado(text, text, text, text, text),
  public.admin_cargar_empleados(text, jsonb), public.admin_token(text, int), public.admin_tokens(text), public.admin_renovar_token(text, int),
  public.admin_desactivar_empleado(text, int), public.admin_uso(text, int, date), public.admin_uso_equipo(text, date),
  public.admin_guardar_ajustes(text, text[], boolean)
from public;
grant execute on function
  public.latido(text, jsonb), public.yo(text), public.iniciar_jornada(text), public.terminar_jornada(text),
  public.admin_estado(text), public.admin_dia(text, int), public.admin_crear_empleado(text, text, text, text, text),
  public.admin_cargar_empleados(text, jsonb), public.admin_token(text, int), public.admin_tokens(text), public.admin_renovar_token(text, int),
  public.admin_desactivar_empleado(text, int), public.admin_uso(text, int, date), public.admin_uso_equipo(text, date),
  public.admin_guardar_ajustes(text, text[], boolean)
to anon, authenticated;

select 'Instalación completa. Siguiente paso: fijar la clave de administrador.' as resultado;
