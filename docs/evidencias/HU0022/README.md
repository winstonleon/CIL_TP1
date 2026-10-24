# Evidencias visuales de HU0022 (pantalla G09 y acceso G01)

Capturas del frontend y del acceso del personal en el entorno de desarrollo, tomadas el 23/10/2026 con Playwright
(Chromium, escritorio de 1440 × 900; las de G09, de página completa). Corresponden al **código del tramo (d) de
HU0022 sobre la base `4c9736c`, con cambios sin commit**; el commit que las incluye lo agrega el equipo.

**Todos los datos son ficticios** (correos `@ejemplo.test`). Antes de cada captura se comprobó, como en HU0021, que el
texto visible no tuviera tokens ni enlaces de acción (`eyJ`, `action-token`, `key=`, `access_token`, `Bearer`) y que
todos los correos fueran `@ejemplo.test`. Las capturas las tomó un script de una sola vez fuera del repositorio, con la
cuenta de prueba `secretaria.prueba@ejemplo.test`.

| Archivo | Pantalla | Rol de la sesión | Qué muestra | Escenario |
|---|---|---|---|---|
| `g01-acceso-campana-activa.png` | G01 · Acceso del personal (tema de Keycloak) | Sin sesión | «Colegio Internacional de Lima · Campaña 2027», tomada de `CAMPANA_ACTIVA` | C23 |
| `g09-grados-vacantes-evaluaciones.png` | G09, pestaña «Grados, vacantes y evaluaciones» | Secretaría | Los 14 grados de la campaña 2027 con vacantes autorizadas, adjudicadas («—» = 0), evaluaciones (seleccionadas en dorado, no seleccionadas en contorno), cuota y máximo de fracciones; el panel con los requisitos de 3.° de primaria y «Derecho de admisión: S/ 300» | HU0022-1.0 |
| `g09-requisitos-documentales.png` | G09, pestaña «Requisitos documentales» | Secretaría | Los 10 requisitos de 3.° de primaria con su categoría y condición de aplicación, y el panel «Nuevo requisito» | HU0022-1.0 |
| `g09-cuota-ingreso.png` | G09, pestaña «Cuota de ingreso» | Secretaría | Cuota y máximo de fracciones editables por grado | HU0022-1.0 |
| `g09-horarios.png` | G09, pestaña «Horarios» | Secretaría | Los 2 horarios de demostración y el panel «Nuevo horario» | HU0022-1.0 |

No hay captura de HU0022-2.0 («Ya hay N adjudicadas»): en dev no hay vacantes adjudicadas y crearlas sería inventarlas.
La agrega HU0012 con una adjudicación real (compromiso C25). El comportamiento está probado en
`api/test/configuracion.test.ts` y `frontend/src/views/gestion/ConfiguracionCampana.test.ts`.

## Datos que aparecen

- **Grados:** los 14 de la campaña 2027 que crea `npm run db:seed` (`db/seeds/01-grados-2027.sql`). Las vacantes
  (20) y el máximo de fracciones (1) son ficticios: el colegio aún no los define (modelo de datos §7).
- **Datos de demostración creados desde G09 para estas capturas** (plan HU0022, P8). Quedan en la base de dev, **no
  están en `db/seeds`** y ninguna HU debe depender de ellos:
  - los **10 requisitos documentales del mockup G09**, en el grado 3.° de primaria: Partida de nacimiento, DNI del
    postulante, DNI del padre y DNI de la madre (Todos); Certificado oficial de estudios, Libreta de notas del grado
    que cursa y Constancias de buen comportamiento y de no adeudo (Si estudió en otro colegio del Perú); Informes de
    terapias (Si declara una condición especial); Boletas de pago (últimos 3 meses) y Recibos por honorarios y DJ
    anual (Financiero · solo Tesorería; Si es dependiente / Si es independiente, por apoderado);
  - **2 horarios ficticios** (los reales son [por definir], §7): visita guiada con Directora Prueba el 05/11/2026 de
    09:00 a 10:00 (1 cupo) y evaluación académica con Evaluador Prueba el 06/11/2026 de 08:00 a 10:00 (2 cupos).
- **Cuentas:** las de prueba de `infra/keycloak/usuarios-prueba.json` (`*.prueba@ejemplo.test`).
- Cada alta quedó en la bitácora como `cambio_configuracion` (12 eventos: 10 requisitos y 2 horarios).
