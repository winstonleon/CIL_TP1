# Evidencias visuales de HU0021 (pantalla G10)

Capturas del frontend en el entorno de desarrollo, tomadas el 14/10/2026 con Playwright (Chromium, escritorio de
1440 × 900). Corresponden al **código del tramo (b) de HU0021 sobre la base `2061609`**; el commit que las incluye
lo agrega el equipo.

**Todos los datos son ficticios** (correos `@ejemplo.test`). Antes de cada captura se comprobó que el texto
visible no tuviera tokens ni enlaces de acción (`eyJ`, `action-token`, `key=`, `access_token`, `Bearer`) y que
todos los correos fueran `@ejemplo.test`.

| Archivo | Pantalla | Rol de la sesión | Qué muestra | Escenario |
|---|---|---|---|---|
| `g10-tabla-usuarios-directora.png` | G10 · Usuarios y roles (página completa) | Directora | Tabla de cuentas con su rol y estado, la matriz «Permisos por rol» y el panel «Nuevo usuario» | HU0021-1.0, 4.0 (estado «Desactivado») |
| `g10-panel-edicion.png` | G10, panel en modo «Editar usuario» | Directora | Cuenta cargada en el panel, correo bloqueado, «Guardar cambios» y «Cancelar». Se canceló sin guardar | HU0021-3.0 |
| `g10-dialogo-desactivacion.png` | G10, diálogo de confirmación | Directora | «¿Desactivar la cuenta de Luis Paredes Díaz? No podrá iniciar sesión.». Se canceló sin desactivar | HU0021-4.0 |
| `menu-tesoreria.png` | Gestión interna, inicio | Tesorería | La barra lateral solo con «Validaciones de Tesorería» | HU0021-1.0 («únicamente las opciones de ese rol») |

## Datos que aparecen

- Cuentas de prueba de `infra/keycloak/usuarios-prueba.json` (`*.prueba@ejemplo.test`).
- Cuentas de demostración creadas desde G10 para estas capturas, con los nombres ficticios del mockup:
  Rosa Medina Quispe (Secretaría), Jorge Salazar Huamán (Tesorería), Carmen Villanueva Rojas (Psicología) y
  Luis Paredes Díaz (Evaluación académica). Luis Paredes Díaz se usó para las capturas de edición y desactivación,
  que se cancelaron; sigue activo.
- Cuentas `hu0021-e2e-*@ejemplo.test` que dejan las pruebas E2E (todas desactivadas; compromiso C16).

La vista de inicio de la gestión interna («Sesión iniciada») es la vista técnica del Sprint 0, que se reemplazará
cuando lleguen las pantallas de cada rol.
