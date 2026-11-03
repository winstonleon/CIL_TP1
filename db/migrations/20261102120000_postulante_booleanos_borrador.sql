-- migrate:up
-- HU0005-2.0 (plan del bloque 2, 02/11/2026): el borrador de la ficha distingue «sin responder» de «No».
-- Las dos preguntas de P05 admiten NULL (NULL = sin responder); la API exige true o false para completar la ficha.
-- El DEFAULT false se conserva solo por compatibilidad; toda inserción debe escribir NULL explícito si la pregunta no se
-- respondió. Lo protege HU0005-2.0.
-- No se toca ck_postulante_ficha_completa (la exigencia de true o false al completar es de la API).
ALTER TABLE postulante
  ALTER COLUMN estudio_en_colegio_peruano DROP NOT NULL,
  ALTER COLUMN tiene_condicion_especial DROP NOT NULL;

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
