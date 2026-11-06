-- migrate:up
-- HU0010-2.0 (plan del bloque 7, decisión D4b-B de John, 05/11/2026): la psicóloga detalla los requisitos
-- complementarios del dictamen «En observación» y Secretaría los coordina con la familia (R13). Secretaría no puede leer
-- `conclusiones` (R3), así que los requisitos van en su propia columna. El nombre no lleva el sufijo `_cifrado` de
-- rules/db.md porque es el aprobado en el DER (como `conclusiones` y `observaciones`, que también se cifran). La API la cifra (ADR-03, D1-A): se guarda el
-- formato `v1:iv:tag:ct`, nunca el texto en claro. Sin CHECK por dictamen: la API la exige solo en `en_observacion`.
ALTER TABLE dictamen_admision ADD COLUMN requisitos_complementarios text;

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
