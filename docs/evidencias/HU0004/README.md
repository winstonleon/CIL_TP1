# Evidencias visuales de HU0004 (pantalla G04)

Capturas de G04 y del primer ingreso al portal en el entorno de desarrollo, tomadas por el propio E2E `e2e/visita-guiada.spec.ts` (Playwright, Chromium) en la corrida de `npm run evidencias:matriz` del cierre del bloque 1 (HU0003 + HU0004).
- **Tamaño:** escritorio de 1440 × 1080, la referencia del mockup `docs/ui/G04-Visitas.dc.html`. Son capturas de página completa.
- **Código:** el del tramo 2 del bloque 1, sobre la base `de6fc1d`, con cambios sin commit. El commit que las incluye lo agrega el equipo.
- **Cómo se copian:** el E2E las escribe en `test-results/HU0003-HU0004/capturas-e2e/`, que git ignora, y se copian aquí a mano.

**Todos los datos son ficticios.** La secretaria es el usuario de prueba de `infra/keycloak/usuarios-prueba.json` y las familias son `hu0003-e2e-<marca>@ejemplo.test`. Antes de capturar, la prueba comprueba que no se vea ningún token, secreto, contraseña (ni la temporal ni la nueva) ni correos que no sean ficticios.

| Archivo | Qué muestra | Escenario |
|---|---|---|
| `g04-registrar-visita.png` | Agenda de la semana de la visita: la franja de días con el número de visitas, la tabla del día con «Conduce: Dirección» y la fila resaltada en «Por registrar». A la derecha, el panel «Registrar visita» con «¿La familia desea postular?», solo «Sí, desea postular» (C38) y «Registrar y habilitar portal». Debajo, la sección de HU0002-2.0. Con el panel abierto, la tabla queda en unos 700 px: los botones y la etiqueta de la acción bajan de línea para que «Familia» se lea, un ajuste de CSS sobre el mockup, que en ese estado deja la columna en unos 100 px (02/11/2026). Sin el panel, la tabla es la del mockup | HU0004-1.0 |
| `g04-portal-habilitado.png` | La misma fila después de registrar: «Asistió» y «Portal habilitado» (S2) | HU0004-1.0 |
| `portal-primer-ingreso.png` | `/portal` después del primer ingreso de la familia con la contraseña temporal del correo y la nueva que le pidió Keycloak (UPDATE_PASSWORD, tema por defecto): «Sesión iniciada» y el rol `familia` | D3 (apoyo de HU0004-1.0; el tema P03b es de HU0023) |
| `g04-invitacion-reprogramar.png` | Una visita registrada como «No asistió», con «Invitación a reprogramar enviada» después de que `agendamiento` envió el correo (S2) | HU0004-2.0 |

## Qué comprueba el E2E además de las capturas

- **HU0004-1.0:**
  - el expediente pasa a `portal_habilitado` y queda una fila en `cuenta_acceso`;
  - `agendamiento` envía el correo de credenciales con el usuario (el correo), la contraseña temporal de 16 caracteres sin `0 O 1 l I`, el enlace a `/portal` y «Si recibes más de un correo, usa el más reciente»;
  - la familia entra con esa contraseña y Keycloak le exige cambiarla.
- **D3 (contraseña temporal):** se busca por valor y no aparece en `notificacion`, `registro_auditoria`, el log de la API ni la base `n8n`.
  - En `n8n` se consulta cada 3 s hasta que desaparece la fila de la ejecución no guardada (R1, como máximo 1 min). Después se revisa el volcado completo.
  - **Ruta de errores, con Mailpit detenido:** el log de la API solo trae `Fallo en n8n (flujo=agendamiento, nodo=Detener: envío pospuesto, ejecución=N)`, y `agendamiento` no guarda la ejecución (M1). Pasada la ventana de R1, ninguna ejecución de n8n trae «Contraseña temporal», salvo las de error de `notificacion-multicanal`, que se excluyen por R2, aceptado.
- **HU0004-2.0:**
  - el expediente vuelve a `prospecto` (P1);
  - la invitación trae un enlace nuevo de P02 que vuelve a reservar.
- **C11:** el webhook `agendamiento` responde 403 sin el secreto o con uno incorrecto.
