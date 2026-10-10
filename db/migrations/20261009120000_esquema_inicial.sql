-- migrate:up
-- Esquema inicial de la base admision según docs/der/modelo-datos.md (DBML v1.1):
-- 19 entidades, 28 relaciones y los CHECK indicados en las notas del DBML.
-- Tablas y columnas en minúsculas sin comillas (decisión del Sprint 0).
-- Los valores de los enums son la propuesta del DBML (ADR-10): cambiarlos requiere otra migración.

-- =====================================================================
-- ENUMS
-- =====================================================================

CREATE TYPE nivel_educativo AS ENUM ('inicial', 'primaria', 'secundaria');

CREATE TYPE estado_expediente AS ENUM (
  'prospecto',
  'contacto_no_entregado',
  'no_desea_postular',
  'visita_agendada',
  'portal_habilitado',
  'en_postulacion',
  'incompleto',
  'en_validacion',
  'en_evaluacion',
  'en_observacion',
  'no_apto',
  'apto',
  'lista_espera',
  'vacante_asignada',
  'carta_emitida',
  'caducado'
);

CREATE TYPE estado_revision AS ENUM ('pendiente', 'en_revision', 'conforme', 'observado');

CREATE TYPE categoria_requisito AS ENUM ('postulante_y_padres', 'colegio_procedencia', 'financiero', 'condicion_especial');

CREATE TYPE condicion_aplicacion AS ENUM (
  'todos',
  'solo_colegio_peruano',
  'solo_condicion_especial',
  'si_dependiente',
  'si_independiente'
);

CREATE TYPE condicion_laboral AS ENUM ('dependiente', 'independiente');

CREATE TYPE tipo_cita AS ENUM (
  'visita',
  'jornada_observacion',
  'evaluacion_psicologica',
  'evaluacion_academica',
  'entrevista_padres'
);

CREATE TYPE estado_cita AS ENUM ('reservada', 'confirmada', 'asistio', 'no_asistio', 'reprogramada', 'cancelada');

CREATE TYPE tipo_dictamen AS ENUM ('apto', 'en_observacion', 'no_apto');

CREATE TYPE tipo_pago AS ENUM ('derecho_admision', 'cuota_ingreso');

CREATE TYPE modalidad_pago AS ENUM ('unico', 'fraccionado');

CREATE TYPE canal_notificacion AS ENUM ('correo', 'whatsapp');

CREATE TYPE estado_envio AS ENUM ('pendiente', 'enviado', 'fallido');

CREATE TYPE rol_personal AS ENUM ('secretaria', 'directora', 'psicologa', 'evaluador_academico', 'tesoreria');

-- =====================================================================
-- DOMINIO: FAMILIA Y POSTULANTE
-- =====================================================================

CREATE TABLE apoderado (
  id_apoderado      serial PRIMARY KEY,
  dni_cifrado       text,
  dni_hash          varchar(64),
  nombres           varchar(100) NOT NULL,
  apellidos         varchar(100) NOT NULL,
  telefono          varchar(20)  NOT NULL,
  correo            varchar(150) NOT NULL,
  condicion_laboral condicion_laboral,
  CONSTRAINT uq_apoderado_dni_hash UNIQUE (dni_hash),
  CONSTRAINT ck_apoderado_dni_par CHECK ((dni_cifrado IS NULL) = (dni_hash IS NULL))
);

CREATE TABLE consentimiento (
  id_consentimiento     serial PRIMARY KEY,
  id_apoderado          integer     NOT NULL REFERENCES apoderado (id_apoderado),
  version_politica      varchar(20) NOT NULL,
  fecha_hora_aceptacion timestamptz NOT NULL DEFAULT now(),
  canal_origen          varchar(30) NOT NULL,
  autoriza_whatsapp     boolean     NOT NULL DEFAULT false
);

CREATE TABLE cuenta_acceso (
  id_cuenta        serial PRIMARY KEY,
  id_apoderado     integer     NOT NULL REFERENCES apoderado (id_apoderado),
  keycloak_user_id uuid        NOT NULL,
  fecha_creacion   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cuenta_acceso_apoderado UNIQUE (id_apoderado),
  CONSTRAINT uq_cuenta_acceso_keycloak UNIQUE (keycloak_user_id)
);

CREATE TABLE postulante (
  id_postulante              serial PRIMARY KEY,
  dni_cifrado                text,
  dni_hash                   varchar(64),
  nombres                    varchar(100),
  apellido_paterno           varchar(100),
  apellido_materno           varchar(100),
  fecha_nacimiento           date,
  ficha_completa             boolean NOT NULL DEFAULT false,
  estudio_en_colegio_peruano boolean NOT NULL DEFAULT false,
  colegio_procedencia        varchar(150),
  tiene_condicion_especial   boolean NOT NULL DEFAULT false,
  CONSTRAINT uq_postulante_dni_hash UNIQUE (dni_hash),
  CONSTRAINT ck_postulante_dni_par CHECK ((dni_cifrado IS NULL) = (dni_hash IS NULL)),
  CONSTRAINT ck_postulante_ficha_completa CHECK (
    NOT ficha_completa OR (
      dni_cifrado IS NOT NULL AND dni_hash IS NOT NULL AND nombres IS NOT NULL
      AND apellido_paterno IS NOT NULL AND apellido_materno IS NOT NULL AND fecha_nacimiento IS NOT NULL
    )
  )
);

CREATE TABLE postulante_apoderado (
  id_postulante integer     NOT NULL REFERENCES postulante (id_postulante),
  id_apoderado  integer     NOT NULL REFERENCES apoderado (id_apoderado),
  parentesco    varchar(30) NOT NULL,
  PRIMARY KEY (id_postulante, id_apoderado)
);

-- =====================================================================
-- DOMINIO: TRAZABILIDAD Y SEGURIDAD (Personal va antes porque muchas tablas lo referencian)
-- =====================================================================

CREATE TABLE personal (
  id_personal      serial PRIMARY KEY,
  nombres          varchar(100) NOT NULL,
  apellidos        varchar(100) NOT NULL,
  rol              rol_personal NOT NULL,
  correo           varchar(150) NOT NULL,
  keycloak_user_id uuid         NOT NULL,
  activo           boolean      NOT NULL DEFAULT true,
  CONSTRAINT uq_personal_correo UNIQUE (correo),
  CONSTRAINT uq_personal_keycloak UNIQUE (keycloak_user_id)
);

-- =====================================================================
-- DOMINIO: EXPEDIENTE Y REQUISITOS
-- =====================================================================

CREATE TABLE grado (
  id_grado                        serial PRIMARY KEY,
  nivel                           nivel_educativo NOT NULL,
  nombre_grado                    varchar(50)     NOT NULL,
  campana_admision                varchar(10)     NOT NULL,
  vacantes_autorizadas            integer         NOT NULL,
  vacantes_disponibles            integer         NOT NULL,
  requiere_jornada_observacion    boolean         NOT NULL DEFAULT false,
  requiere_evaluacion_psicologica boolean         NOT NULL DEFAULT false,
  requiere_evaluacion_academica   boolean         NOT NULL DEFAULT false,
  monto_cuota_ingreso             numeric(10,2)   NOT NULL,
  max_fracciones                  smallint        NOT NULL DEFAULT 1,
  CONSTRAINT uq_grado_nombre_campana UNIQUE (nombre_grado, campana_admision),
  CONSTRAINT ck_grado_vacantes CHECK (vacantes_disponibles >= 0 AND vacantes_disponibles <= vacantes_autorizadas),
  CONSTRAINT ck_grado_max_fracciones CHECK (max_fracciones >= 1)
);

CREATE TABLE requisito_documental (
  id_requisito         serial PRIMARY KEY,
  id_grado             integer              NOT NULL REFERENCES grado (id_grado),
  tipo_documento       varchar(80)          NOT NULL,
  categoria            categoria_requisito  NOT NULL,
  condicion_aplicacion condicion_aplicacion NOT NULL DEFAULT 'todos',
  obligatorio          boolean              NOT NULL DEFAULT true,
  por_apoderado        boolean              NOT NULL DEFAULT false,
  CONSTRAINT uq_requisito_grado_tipo UNIQUE (id_grado, tipo_documento),
  CONSTRAINT ck_requisito_por_apoderado CHECK (
    condicion_aplicacion NOT IN ('si_dependiente', 'si_independiente') OR por_apoderado
  )
);

CREATE TABLE expediente (
  id_expediente         serial PRIMARY KEY,
  id_apoderado_titular  integer           NOT NULL REFERENCES apoderado (id_apoderado),
  id_postulante         integer           REFERENCES postulante (id_postulante),
  id_grado              integer           NOT NULL REFERENCES grado (id_grado),
  fecha_registro        timestamptz       NOT NULL DEFAULT now(),
  estado                estado_expediente NOT NULL DEFAULT 'prospecto',
  estado_documental     estado_revision   NOT NULL DEFAULT 'pendiente',
  estado_financiero     estado_revision   NOT NULL DEFAULT 'pendiente',
  modalidad_pago_cuota  modalidad_pago,
  numero_fracciones     smallint,
  posicion_lista_espera integer
);

CREATE TABLE cuestionario_expectativas (
  id_cuestionario     serial PRIMARY KEY,
  id_expediente       integer     NOT NULL REFERENCES expediente (id_expediente),
  respuestas          jsonb       NOT NULL,
  es_borrador         boolean     NOT NULL DEFAULT true,
  fecha_actualizacion timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cuestionario_expediente UNIQUE (id_expediente)
);

CREATE TABLE documento (
  id_documento        serial PRIMARY KEY,
  id_expediente       integer         NOT NULL REFERENCES expediente (id_expediente),
  id_requisito        integer         NOT NULL REFERENCES requisito_documental (id_requisito),
  id_personal_revisor integer         REFERENCES personal (id_personal),
  id_apoderado        integer         REFERENCES apoderado (id_apoderado),
  url_archivo         varchar(500)    NOT NULL,
  formato             varchar(10)     NOT NULL,
  tamano_kb           integer         NOT NULL,
  fecha_carga         timestamptz     NOT NULL DEFAULT now(),
  estado_verificacion estado_revision NOT NULL DEFAULT 'pendiente',
  motivo_observacion  text,
  vigente             boolean         NOT NULL DEFAULT true
);

-- =====================================================================
-- DOMINIO: EVALUACIÓN
-- =====================================================================

CREATE TABLE horario_disponible (
  id_horario       serial PRIMARY KEY,
  id_personal      integer     NOT NULL REFERENCES personal (id_personal),
  tipo_cita        tipo_cita   NOT NULL,
  fecha            date        NOT NULL,
  hora_inicio      time        NOT NULL,
  hora_fin         time        NOT NULL,
  cupos            smallint    NOT NULL DEFAULT 1,
  campana_admision varchar(10) NOT NULL,
  CONSTRAINT ck_horario_horas CHECK (hora_fin > hora_inicio),
  CONSTRAINT ck_horario_cupos CHECK (cupos >= 0)
);

CREATE TABLE cita (
  id_cita       serial PRIMARY KEY,
  id_expediente integer     NOT NULL REFERENCES expediente (id_expediente),
  id_personal   integer     NOT NULL REFERENCES personal (id_personal),
  id_horario    integer     NOT NULL REFERENCES horario_disponible (id_horario),
  tipo_cita     tipo_cita   NOT NULL,
  fecha_hora    timestamptz NOT NULL,
  estado        estado_cita NOT NULL DEFAULT 'reservada',
  asistentes    varchar(300),
  CONSTRAINT uq_cita_personal_fecha UNIQUE (id_personal, fecha_hora)
);

CREATE TABLE resultado_evaluacion (
  id_resultado     serial PRIMARY KEY,
  id_cita          integer     NOT NULL REFERENCES cita (id_cita),
  id_personal      integer     NOT NULL REFERENCES personal (id_personal),
  tipo_evaluacion  tipo_cita   NOT NULL,
  resultado        varchar(50) NOT NULL,
  observaciones    text,
  informe_url      varchar(500),
  fecha_registro   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_resultado_cita UNIQUE (id_cita)
);

CREATE TABLE dictamen_admision (
  id_dictamen   serial PRIMARY KEY,
  id_expediente integer       NOT NULL REFERENCES expediente (id_expediente),
  id_personal   integer       NOT NULL REFERENCES personal (id_personal),
  dictamen      tipo_dictamen NOT NULL,
  conclusiones  text,
  informe_url   varchar(500),
  fecha_emision timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_dictamen_expediente UNIQUE (id_expediente)
);

-- =====================================================================
-- DOMINIO: PAGOS Y RESULTADO
-- =====================================================================

CREATE TABLE pago (
  id_pago                serial PRIMARY KEY,
  id_expediente          integer         NOT NULL REFERENCES expediente (id_expediente),
  id_personal_validador  integer         REFERENCES personal (id_personal),
  tipo_pago              tipo_pago       NOT NULL,
  numero_fraccion        smallint        NOT NULL DEFAULT 1,
  numero_operacion       varchar(40)     NOT NULL,
  banco                  varchar(60)     NOT NULL,
  monto                  numeric(10,2)   NOT NULL,
  fecha_pago             date            NOT NULL,
  comprobante_url        varchar(500)    NOT NULL,
  estado_validacion      estado_revision NOT NULL DEFAULT 'pendiente',
  motivo_observacion     text,
  CONSTRAINT uq_pago_numero_operacion UNIQUE (numero_operacion),
  CONSTRAINT uq_pago_expediente_tipo_fraccion UNIQUE (id_expediente, tipo_pago, numero_fraccion),
  CONSTRAINT ck_pago_monto CHECK (monto > 0),
  CONSTRAINT ck_pago_numero_fraccion CHECK (numero_fraccion >= 1)
);

CREATE TABLE carta_vacante (
  id_carta             serial PRIMARY KEY,
  id_expediente        integer      NOT NULL REFERENCES expediente (id_expediente),
  id_personal_autoriza integer      NOT NULL REFERENCES personal (id_personal),
  fecha_emision        timestamptz  NOT NULL DEFAULT now(),
  url_documento        varchar(500) NOT NULL,
  CONSTRAINT uq_carta_expediente UNIQUE (id_expediente)
);

-- =====================================================================
-- DOMINIO: TRAZABILIDAD Y SEGURIDAD
-- =====================================================================

CREATE TABLE notificacion (
  id_notificacion serial PRIMARY KEY,
  id_expediente   integer            NOT NULL REFERENCES expediente (id_expediente),
  canal           canal_notificacion NOT NULL,
  tipo_evento     varchar(60)        NOT NULL,
  fecha_envio     timestamptz        NOT NULL DEFAULT now(),
  estado_envio    estado_envio       NOT NULL DEFAULT 'pendiente'
);

CREATE TABLE registro_auditoria (
  id_evento       bigserial PRIMARY KEY,
  id_expediente   integer     REFERENCES expediente (id_expediente),
  id_personal     integer     REFERENCES personal (id_personal),
  tipo_evento     varchar(60) NOT NULL,
  estado_anterior varchar(40),
  estado_nuevo    varchar(40),
  fecha_hora      timestamptz NOT NULL DEFAULT now(),
  detalle         jsonb,
  -- Catálogo de la sección 4.7 del modelo de datos. Un valor nuevo necesita aprobación (ADR-05).
  CONSTRAINT ck_auditoria_tipo_evento CHECK (tipo_evento IN (
    'transicion_estado',
    'atencion_inicio',
    'atencion_fin',
    'acceso_denegado',
    'inicio_sesion',
    'cambio_configuracion',
    'gestion_usuario',
    'notificacion_rebotada'
  ))
);

-- Bitácora de solo inserción (R6, rules/db.md): se rechaza UPDATE, DELETE y TRUNCATE.
CREATE FUNCTION rechazar_cambio_auditoria() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'registro_auditoria es de solo inserción (% no permitido)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER tg_auditoria_sin_update_delete
  BEFORE UPDATE OR DELETE ON registro_auditoria
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio_auditoria();

CREATE TRIGGER tg_auditoria_sin_truncate
  BEFORE TRUNCATE ON registro_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio_auditoria();

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
