# Evidencias visuales de HU0003 (pantalla P02)

Capturas de P02 en el entorno de desarrollo, tomadas por el propio E2E `e2e/visita-guiada.spec.ts` (Playwright, Chromium) en la corrida de `npm run evidencias:matriz` del cierre del bloque 1 (HU0003 + HU0004).
- **Tamaño:** escritorio de 1440 × 960, la referencia del mockup `docs/ui/P02-Visita.dc.html`. Son capturas de página completa.
- **Código:** el del tramo 2 del bloque 1, sobre la base `de6fc1d`, con cambios sin commit. El commit que las incluye lo agrega el equipo.
- **Cómo se copian:** el E2E las escribe en `test-results/HU0003-HU0004/capturas-e2e/`, que git ignora, y se copian aquí a mano.

**Todos los datos son ficticios.** El apoderado es «María Fernanda Quispe E2e» y su correo `hu0003-e2e-<marca>@ejemplo.test`. P02 es pública y se abre con el enlace del correo de la carpeta. Antes de capturar, la prueba comprueba que la página no muestre el token del enlace (`?t=…`, ADR-18), ningún secreto ni correos que no sean ficticios.

| Archivo | Qué muestra | Escenario |
|---|---|---|
| `p02-agenda-visita.png` | P02 abierta desde el enlace del correo de la carpeta. Muestra el calendario en el mes del horario, con el día resaltado y elegido, los horarios del día con «Disponible» o «Reservado», y «Tu visita» con el apoderado (S9: «Apoderado/a»), el grado, la fecha, la hora, el lugar («[Dirección del colegio]», C39) y los asistentes escritos. Los horarios son de una directora activa de la campaña activa (C25) | HU0003-1.0 |
| `p02-visita-reservada.png` | Confirmación después de «Confirmar visita»: «Tu visita quedó agendada para el … a las … Te enviamos la confirmación a tu correo.» (S13) | HU0003-1.0 |

## Qué comprueba el E2E además de las capturas

- **HU0003-1.0:**
  - **Reserva:** la API responde 201 y el expediente pasa a `visita_agendada`.
  - **Confirmación:** la envía `agendamiento` y llega a Mailpit con la fecha, la hora, el lugar y los asistentes.
  - **Recordatorio (D4, 24 h antes):** lo envía `seguimiento-recordatorios`. La visita se agenda dentro de las próximas 24 h, así que llega enseguida.
  - **Un solo recordatorio:** durante dos ciclos del barrido no llega otro, y en la BD hay una sola fila `recordatorio_visita` `enviado`.
- **HU0003-2.0:** la cubren la prueba de API con dos reservas simultáneas del último cupo (una 201 y otra 409 `HORARIO_SIN_CUPO`, cupos en 0 y una sola cita) y la de frontend del aviso del mockup con la recarga de los horarios. El E2E no la repite, porque una carrera entre dos navegadores no es reproducible.
- **C31:** el E2E abre el enlace del correo de la carpeta. Las pruebas de API cubren los enlaces inválidos, vencidos (por estado, P2) y ya usados.
