-- migrate:up
-- HU0016-1.0 (plan del bloque 10, decisión D2-A de John, 06/11/2026): la firma escaneada de la Directora va en la Carta de
-- Vacante. Guarda la clave del archivo en el almacenamiento cifrado (ADR-21), como `Documento.url_archivo`: la imagen no
-- está en la BD. Nula hasta que un técnico la carga con `npm run firma:cargar`; solo se usa en cuentas `directora` activas.
ALTER TABLE personal ADD COLUMN firma_url varchar(500);

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
