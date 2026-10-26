# Evidencias visuales de HU0001 (pantalla P01)

Capturas de P01 en el entorno de desarrollo. Las toma el propio E2E, `e2e/solicitud-informacion.spec.ts` (Playwright, Chromium), y estas son las de la corrida de `npm run evidencias:matriz` del 25/10/2026.
- **Tamaños:** escritorio de 1440 × 960, la referencia del mockup; las de errores son de página completa; la móvil, de 390 px.
- **Código:** el del tramo (c) de HU0001 sobre la base `ad190e5`, con cambios sin commit. El commit que las incluye lo agrega el equipo.
- **Cómo se copian:** el E2E las escribe en `test-results/HU0001/capturas-e2e/`, que git ignora, y se copian aquí a mano. Así cada corrida no reescribe los PNG versionados.

**Todos los datos son ficticios.** Los nombres son «Nombre E2e» y «Apellido Prueba», el celular 987 654 321 y el correo `hu0001-e2e-<marca>@ejemplo.test`. En la captura de formato inválido aparecen además el correo `familia@ejemplo` y el celular `887654321`, también ficticios. P01 es pública y no tiene sesión, así que no muestra tokens ni enlaces de acción.

| Archivo | Qué muestra | Escenario |
|---|---|---|
| `p01-formulario.png` | P01 abierta con `?origen=instagram` (la URL no se ve en la captura): formulario completo, con «Autorizo que me contacten por WhatsApp» y el consentimiento marcados, y «Primaria · 3.° de primaria» elegido. Los textos siguen `docs/ui/Main.dc.html`; la campaña y los grados vienen de la API (seed de dev), con el formato aprobado «Nivel · nombre guardado» en lugar del «Primaria · 3.° grado» del mockup | HU0001-1.0 |
| `p01-politica.png` | «Política de privacidad» abierta antes de aceptarla: «Versión borrador-1» y el texto entre corchetes (provisional, C29) | HU0001-1.0 |
| `p01-confirmacion.png` | Confirmación que reemplaza al formulario: «Solicitud registrada. Te enviaremos la carpeta informativa al correo que indicaste, con el enlace para agendar tu visita guiada.» | HU0001-1.0 |
| `p01-campos-vacios.png` | Envío con todo vacío: aviso «Revisa los campos marcados.», los campos y la caja de consentimiento resaltados, y el mensaje de cada uno | HU0001-2.0 |
| `p01-formato-invalido.png` | Correo `familia@ejemplo` y celular `887654321`, con sus mensajes de formato; los demás campos sin error | HU0001-2.0 |
| `p01-sin-consentimiento.png` | Datos válidos sin marcar el consentimiento: «El consentimiento es obligatorio para continuar.» y la caja resaltada | HU0001-3.0 |
| `p01-movil.png` | A 390 px: el encabezado, el panel azul y el formulario apilados, sin scroll horizontal | Soporte (P01) |

## Qué comprueba el E2E además de las capturas

- **HU0001-1.0:** la API responde 201 y la BD de dev (consulta de solo lectura) tiene:
  - el apoderado sin DNI y con el celular en E.164 (`+51987654321`);
  - el consentimiento con la versión `borrador-1`, el canal `instagram` y WhatsApp autorizado;
  - el expediente en `prospecto`, sin postulante, en 3.° de primaria;
  - ningún evento de auditoría (decisión P2 del plan).
- **HU0001-2.0:** el escenario del backlog dice «resalta los campos con error con el color del estado «observado» de los prototipos (#8A4B08)» (corregido el 23 y el 25/10/2026; ADR-17).
  - El E2E comprueba que el borde de los campos y los mensajes usan `--observado` (`#8A4B08`), el color del estado observado de P06, G03, G05 y P07b.
  - También comprueba `aria-invalid`, `aria-describedby`, el foco en el primer campo con error y que no sale ningún POST.
- **HU0001-3.0:** no sale ningún POST y no queda ninguna fila con ese correo.
- **Soporte:**
  - el campo trampa (`comentario`) queda fuera de pantalla, fuera del orden de tabulación y fuera del árbol de accesibilidad;
  - a 1440 y a 960 px el panel y el formulario van lado a lado; a 959 y a 390 px se apilan, sin scroll horizontal.

## Lo que no se ve en las capturas

- **El logo del colegio:** el repo todavía no tiene el archivo (plan HU0001, S6).
- **El evento hacia n8n (ADR-16).** La API lo dispara después del commit, pero el flujo `captacion` es de HU0002 (C27). Hasta entonces n8n responde 404 y el log de la API dice `Evento captacion no entregado a n8n (id_expediente=…, 1 intento, HTTP 404)`, sin datos personales.
  - Lo prueba `api/test/solicitudInformacion.test.ts` contra un n8n simulado.
- **Los datos que quedan en dev:** cada corrida deja un prospecto `hu0001-e2e-*@ejemplo.test` (C16).
