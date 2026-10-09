---
paths:
  - "db/**"
---

# Reglas de base de datos

- El modelo vigente es `docs/der/modelo-datos.md` (DBML v1.1): 19 entidades y 28 relaciones. El `.drawio` de 10 entidades está obsoleto. No agregues tablas ni columnas que no estén ahí sin aprobación.
- Hay tres bases en el mismo servidor: `admision` (este modelo), `n8n` y `keycloak`. Las migraciones de este repo solo tocan `admision`.
- Los CHECK de las notas del DBML se implementan en la migración, por ejemplo `ficha_completa` ⇒ campos obligatorios, o `dni_cifrado` y `dni_hash` ambos nulos o ambos con valor.
- Tablas y columnas en `snake_case` y en español, en singular (`expediente`, `requisito_documental`).
- Migraciones solo hacia adelante, con un archivo por cambio, en `db/migrations/`. Nunca edites una migración ya aplicada en `main`.
- Unicidades clave: `dni_hash` (apoderado y postulante), `keycloak_user_id`, correo del personal, número de operación del pago y cita por responsable, fecha y hora (`uq_cita_personal_fecha`).
- `registro_auditoria` es de solo inserción. Nadie hace UPDATE ni DELETE sobre ella; se refuerza con permisos o con un trigger.
- Columnas cifradas: tipo `text`, sufijo `_cifrado` (`dni_cifrado`), con su `_hash` si debe ser única. Una columna nueva cifrada necesita aprobación (ADR-03).
- Las seeds usan solo datos ficticios evidentes (DNI `00000001`, correos `@ejemplo.test`).
