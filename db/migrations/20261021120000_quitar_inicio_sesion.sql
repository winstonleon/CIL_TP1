-- migrate:up
-- HU0021, tramo (e): el equipo descartó «Último acceso» de G10 (compromiso C20) e inicio_sesion sale del catálogo
-- de la sección 4.7 del modelo de datos, porque solo servía para esa columna. Se reemplaza el CHECK; no cambia
-- ninguna tabla ni columna. Ninguna HU registró inicio_sesion: si existiera una fila con ese valor, el ADD falla
-- y la migración no se aplica.
ALTER TABLE registro_auditoria
  DROP CONSTRAINT ck_auditoria_tipo_evento,
  ADD CONSTRAINT ck_auditoria_tipo_evento CHECK (tipo_evento IN (
    'transicion_estado',
    'atencion_inicio',
    'atencion_fin',
    'acceso_denegado',
    'cambio_configuracion',
    'gestion_usuario',
    'notificacion_rebotada'
  ));

-- migrate:down
-- Migraciones solo hacia adelante (rules/db.md): no hay reversión.
