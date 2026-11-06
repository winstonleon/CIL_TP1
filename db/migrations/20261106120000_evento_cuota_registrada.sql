-- migrate:up
-- HU0014-1.0 (plan del bloque 8, aprobado por John, 05/11/2026): la familia registra el comprobante de la cuota de ingreso
-- y deja el evento `cuota_registrada` en la bitácora (sección 4.7). La cuota no cambia el estado del expediente y `Pago` no
-- guarda su fecha de registro (C49), así que el evento es la fuente del aviso a Tesorería (ADR-07) y de «Recibido» en G05,
-- solo con ids. Se reemplaza el CHECK; no cambia ninguna tabla ni columna.
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
    'cita_reprogramada',
    'cuota_registrada'
  ));

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
