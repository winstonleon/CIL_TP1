-- migrate:up
-- HU0022 (plan, P14): tipo_documento guarda el nombre visible que escribe Secretaría en G09
-- («Partida de nacimiento»). Dos nombres que solo difieren en mayúsculas son el mismo requisito del grado.
-- Solo se agrega un índice único: uq_requisito_grado_tipo se conserva (sin DROP).
CREATE UNIQUE INDEX uq_requisito_grado_tipo_minusculas
  ON requisito_documental (id_grado, lower(tipo_documento));

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
