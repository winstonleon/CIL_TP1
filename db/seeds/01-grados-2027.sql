-- Grados de la campaña 2027 según docs/der/modelo-datos.md §5.
-- Evaluaciones requeridas y cuotas: del modelo de datos (R11, R17).
-- FICTICIO: vacantes_autorizadas/disponibles (20) y max_fracciones (1) están por definir con el colegio (§7).
-- Idempotente: no toca grados ya existentes.
-- HU0022 (plan, P13): el nombre se alinea con §5 («Kindergarten (5 años)»). En una base que ya tenía la fila
-- «Kindergarten» de 2027 se renombra solo esa fila; si el nombre nuevo ya existe, no hace nada.
UPDATE grado SET nombre_grado = 'Kindergarten (5 años)'
 WHERE nombre_grado = 'Kindergarten' AND campana_admision = '2027'
   AND NOT EXISTS (SELECT 1 FROM grado WHERE nombre_grado = 'Kindergarten (5 años)' AND campana_admision = '2027');

INSERT INTO grado (
  nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles,
  requiere_jornada_observacion, requiere_evaluacion_psicologica, requiere_evaluacion_academica,
  monto_cuota_ingreso, max_fracciones
) VALUES
  ('inicial',    '3 años',            '2027', 20, 20, true,  false, false, 7000.00, 1),
  ('inicial',    '4 años',            '2027', 20, 20, true,  false, false, 7000.00, 1),
  ('inicial',    'Kindergarten (5 años)', '2027', 20, 20, true, false, false, 7000.00, 1),
  ('primaria',   '1.° de primaria',   '2027', 20, 20, false, true,  false, 7000.00, 1),
  ('primaria',   '2.° de primaria',   '2027', 20, 20, false, true,  true,  7000.00, 1),
  ('primaria',   '3.° de primaria',   '2027', 20, 20, false, true,  true,  7000.00, 1),
  ('primaria',   '4.° de primaria',   '2027', 20, 20, false, true,  true,  7000.00, 1),
  ('primaria',   '5.° de primaria',   '2027', 20, 20, false, true,  true,  7000.00, 1),
  ('primaria',   '6.° de primaria',   '2027', 20, 20, false, true,  true,  7000.00, 1),
  ('secundaria', '1.° de secundaria', '2027', 20, 20, false, true,  true,  4000.00, 1),
  ('secundaria', '2.° de secundaria', '2027', 20, 20, false, true,  true,  4000.00, 1),
  ('secundaria', '3.° de secundaria', '2027', 20, 20, false, true,  true,  4000.00, 1),
  ('secundaria', '4.° de secundaria', '2027', 20, 20, false, true,  true,  4000.00, 1),
  ('secundaria', '5.° de secundaria', '2027', 20, 20, false, true,  true,  4000.00, 1)
ON CONFLICT (nombre_grado, campana_admision) DO NOTHING;
