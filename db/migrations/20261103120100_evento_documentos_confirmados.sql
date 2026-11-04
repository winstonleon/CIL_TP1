-- migrate:up
-- HU0006-1.0 (plan del bloque 3, P3 A, 03/11/2026): «Confirmar documentos» solicita la verificación de completitud
-- (HU0017) sin cambiar el estado del expediente. Deja el evento `documentos_confirmados` en la bitácora (sección 4.7).
-- Se reemplaza el CHECK; no cambia ninguna tabla ni columna.
ALTER TABLE registro_auditoria
  DROP CONSTRAINT ck_auditoria_tipo_evento,
  ADD CONSTRAINT ck_auditoria_tipo_evento CHECK (tipo_evento IN (
    'transicion_estado',
    'atencion_inicio',
    'atencion_fin',
    'acceso_denegado',
    'cambio_configuracion',
    'gestion_usuario',
    'notificacion_rebotada',
    'documentos_confirmados'
  ));

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
