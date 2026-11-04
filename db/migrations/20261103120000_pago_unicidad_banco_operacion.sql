-- migrate:up
-- HU0007-2.0 (plan del bloque 3, P1 a, 03/11/2026): «ya registrado para el mismo banco». R19 pasa de único en toda la
-- tabla a único por banco: el mismo número en otro banco es otro comprobante. No cambia ninguna tabla ni columna.
-- Si hubiera filas con (banco, numero_operacion) repetido, el ADD falla; no puede haberlas, porque la restricción
-- anterior era más estricta.
ALTER TABLE pago
  DROP CONSTRAINT uq_pago_numero_operacion,
  ADD CONSTRAINT uq_pago_banco_numero_operacion UNIQUE (banco, numero_operacion);

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
