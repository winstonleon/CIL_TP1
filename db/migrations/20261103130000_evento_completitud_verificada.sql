-- migrate:up
-- HU0017 (plan del bloque 4, D5, 03/11/2026): cada verificación de completitud de una confirmación deja el evento
-- `completitud_verificada` en la bitácora (sección 4.7). Una verificación incompleta no cambia el estado (D1-A), así que
-- sin este evento el ciclo confirmación → verificación no quedaría registrado. Se reemplaza el CHECK; no cambia ninguna
-- tabla ni columna.
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
    'documentos_confirmados',
    'completitud_verificada'
  ));

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
