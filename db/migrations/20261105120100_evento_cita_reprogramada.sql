-- migrate:up
-- HU0009-2.0 (plan del bloque 6, decisión R4 de John, 05/11/2026): la familia reprograma una cita de evaluación y deja el
-- evento `cita_reprogramada` en la bitácora (sección 4.7). La reprogramación no cambia el estado del expediente, así que
-- no hay transicion_estado: el evento es la evidencia del cambio y el ancla de sus avisos (ADR-07), solo con ids.
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
    'documentos_confirmados',
    'completitud_verificada',
    'subsanacion_registrada',
    'cita_reprogramada'
  ));

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
