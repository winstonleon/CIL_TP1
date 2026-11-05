-- migrate:up
-- HU0009 (plan del bloque 6, decisión C40 de John, 05/11/2026): `uq_cita_personal_fecha` pasa de restricción a índice
-- único PARCIAL, con el mismo nombre (el código y las pruebas lo reconocen por su nombre):
-- - solo cuenta las citas activas: una cita `reprogramada` o `cancelada` ya liberó su turno (HU0009-2.0: «libera el
--   turno anterior»), así que otra familia puede reservarlo aunque la fila de la cita anterior se conserve;
-- - no cuenta la jornada de observación, que es grupal: un mismo horario admite tantas citas como cupos tenga (C40 a).
-- El resto (visita y evaluaciones individuales) sigue con una sola cita por responsable, fecha y hora (R12, TI 6.3).
-- No cambia ninguna tabla ni columna.
ALTER TABLE cita DROP CONSTRAINT uq_cita_personal_fecha;

CREATE UNIQUE INDEX uq_cita_personal_fecha ON cita (id_personal, fecha_hora)
  WHERE estado NOT IN ('reprogramada', 'cancelada') AND tipo_cita <> 'jornada_observacion';

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
