-- migrate:up
-- HU0019 y C54 (plan del bloque 9, aprobado por John, 05/11/2026): registro_auditoria solo tenía la PK.
-- Medido con EXPLAIN ANALYZE sobre 50 000 eventos y 2 000 expedientes (docs/evidencias/HU0019/explain-indices.log):
-- - ix_auditoria_expediente_tipo: las filas del tablero G08 bajan de 12,4 s a 31 ms.
-- - ix_auditoria_fin_evento_inicio: inicioAbierto ya no recorre todos los atencion_fin por cada inicio.
-- El índice propuesto por (id_personal, detalle->'item') no se creó: el planificador no lo usó (22 ms por la PK).
CREATE INDEX ix_auditoria_expediente_tipo ON registro_auditoria (id_expediente, tipo_evento);

CREATE INDEX ix_auditoria_fin_evento_inicio ON registro_auditoria (((detalle->>'id_evento_inicio')::bigint))
  WHERE tipo_evento = 'atencion_fin';

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
