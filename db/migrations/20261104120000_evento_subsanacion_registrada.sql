-- migrate:up
-- HU0008, HU0011 y HU0024 (plan del bloque 5, ajuste 1 de John, 04/11/2026): la familia subsana una observación en
-- en_validacion (reemplaza un documento observado o registra un comprobante nuevo del derecho observado) y deja el evento
-- `subsanacion_registrada` en la bitácora (sección 4.7). El Pago no tiene historial: el evento guarda el banco, el número
-- de operación y la clave del comprobante anterior. Se reemplaza el CHECK; no cambia ninguna tabla ni columna.
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
    'subsanacion_registrada'
  ));

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
