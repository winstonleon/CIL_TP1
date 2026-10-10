-- migrate:up
-- S0-B9: reglas de una sola fila y permisos mínimos para la API.
-- La aplica el rol de migración (dueño del esquema). El usuario de la API (ADMISION_DB_USER) es
-- miembro del rol de grupo admision_app, que crea infra/postgres/init/02-separar-roles.sh.
-- admision_app tiene nombre fijo porque las migraciones de dbmate no admiten variables.

-- =====================================================================
-- 1. Reglas de una sola fila. Las reglas entre tablas (numero_fracciones frente a
--    grado.max_fracciones, documento.id_apoderado según requisito.por_apoderado) quedan en la API.
-- =====================================================================

ALTER TABLE documento ADD CONSTRAINT ck_documento_motivo_observacion
  CHECK (estado_verificacion <> 'observado' OR btrim(coalesce(motivo_observacion, '')) <> '');

ALTER TABLE pago ADD CONSTRAINT ck_pago_motivo_observacion
  CHECK (estado_validacion <> 'observado' OR btrim(coalesce(motivo_observacion, '')) <> '');

-- Solo en esta dirección: no exige posición cuando el estado es lista_espera.
-- HU0012 (docs/compromisos.md C4): para salir de lista_espera hay que limpiar la posición antes
-- de la transición o en la misma sentencia, porque un CHECK no se puede diferir.
ALTER TABLE expediente ADD CONSTRAINT ck_expediente_posicion_lista_espera
  CHECK (posicion_lista_espera IS NULL OR estado = 'lista_espera');

ALTER TABLE resultado_evaluacion ADD CONSTRAINT ck_resultado_tipo_evaluacion
  CHECK (tipo_evaluacion <> 'visita');

-- =====================================================================
-- 2. Permisos de ejecución para la API (sin propiedad: no puede ALTER, DROP, CREATE
--    ni DISABLE TRIGGER; sin TRUNCATE, REFERENCES ni TRIGGER).
-- =====================================================================

GRANT USAGE ON SCHEMA public TO admision_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO admision_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO admision_app;

-- Bitácora de solo inserción (R6): la API solo lee e inserta. El trigger sigue como segunda capa.
REVOKE UPDATE, DELETE ON registro_auditoria FROM admision_app;

-- La tabla de control de dbmate no es de la API.
REVOKE ALL ON schema_migrations FROM admision_app;

-- Tablas y secuencias que cree el rol de migración en el futuro. Una tabla de solo inserción
-- nueva debe revocar UPDATE y DELETE en su propia migración, como arriba.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO admision_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO admision_app;

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
