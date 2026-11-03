# Matriz de trazabilidad (HU → escenario → prueba → resultado)

> Generada con `npm run evidencias:matriz` el 2/11/26, 5:45 p. m. (America/Lima) sobre el commit `de6fc1d` **con cambios sin commit**. No se edita a mano.

## Resumen

| Suite | Pruebas | Pasan | Fallan | Omitidas o no ejecutadas |
|---|---|---|---|---|
| API | 256 | 256 | 0 | 0 |
| Frontend | 67 | 67 | 0 | 0 |
| E2E | 57 | 57 | 0 | 0 |

- Escenarios del backlog: **55** en 25 HU; con al menos una prueba: **16**.
- Estados: cubierto: 11 · verificado: correo, sin WhatsApp; pendiente: WhatsApp autorizado (C30): 1 · verificado: rechazo síncrono; pendiente: rebote asíncrono del proveedor (C34): 1 · sin prueba: 39 · mecanismo probado; verificación en ruta real pendiente (C17): 1 · verificado: almacenamiento; pendiente: completitud, agendamiento, adjudicación (C25): 1 · verificado: regla; pendiente: adjudicación real (C25): 1.
- Las pruebas del Sprint 0 (`S0-*`) y las de soporte (`G10`, `G01`, `C19`…) cuentan en los totales, pero no se asignan a escenarios.
- «mecanismo probado; verificación en ruta real pendiente (C17)»: todas las pruebas del escenario llevan la marca `[política, ruta de prueba]` (compromiso C17).
- «verificado: …; pendiente: … (Cnn)»: escenarios que se verifican por partes (HU0022-1.0, C25; HU0022-2.0, C25; HU0002-1.0, C30; HU0002-2.0, C34). Cada prueba declara su `[parte: …]`; una parte se verifica solo con pruebas de API o E2E que pasan (las de frontend usan la API simulada). Las partes pendientes las verifica la HU o la etapa que fija su compromiso.

## HU con pruebas

### HU0001 — Registrar mis datos de contacto inicial (nombres, teléfono, correo electrónico y grado de interés) y otorgar mi consentimiento para el tratamiento de mis datos a través de un formulario web enlazado desde las redes sociales del colegio

| Escenario | Estado | Suite | Archivo | Prueba | Resultado |
|---|---|---|---|---|---|
| HU0001-1.0 — Registro exitoso de solicitud de información con consentimiento | cubierto | API | `api/test/solicitudInformacion.test.ts` | HU0001-1.0 registra el apoderado, el consentimiento y el expediente en prospecto sin postulante, y responde 201 sin identificadores | pasó |
|  |  | API | `api/test/solicitudInformacion.test.ts` | HU0001-1.0 guarda la versión vigente de la política, la hora del servidor, el canal de origen y la autorización de WhatsApp | pasó |
|  |  | API | `api/test/solicitudInformacion.test.ts` | HU0001-1.0 después del commit envía a /captacion solo el id_expediente, con X-Webhook-Secret (n8n simulado) | pasó |
|  |  | API | `api/test/solicitudInformacion.test.ts` | HU0001-1.0 con n8n caído, con 404 o con 503 el registro queda, la respuesta sigue siendo 201, solo se reintenta ante red o 5xx y el log no tiene datos personales | pasó |
|  |  | Frontend | `frontend/src/views/portal/SolicitudInformacion.test.ts` | HU0001-1.0 P01 se abre sin iniciar sesión, pide el formulario a la API sin token y muestra la campaña y los textos del mockup | pasó |
|  |  | Frontend | `frontend/src/views/portal/SolicitudInformacion.test.ts` | HU0001-1.0 envía los datos normalizados, el canal de ?origen= y el campo trampa vacío, sin token, y muestra la confirmación | pasó |
|  |  | Frontend | `frontend/src/views/portal/SolicitudInformacion.test.ts` | HU0001-1.0 el canal de origen es facebook o instagram según ?origen=, sin distinguir mayúsculas, y formulario_web en cualquier otro caso | pasó |
|  |  | E2E | `e2e/solicitud-informacion.spec.ts` | HU0001-1.0 desde un enlace de Instagram, la familia registra sus datos, autoriza WhatsApp y acepta la política: ve la confirmación y quedan el apoderado, el consentimiento y el expediente en prospecto | pasó |
| HU0001-2.0 — Intento de registro con datos obligatorios incompletos o erróneos | cubierto | API | `api/test/solicitudInformacion.test.ts` | HU0001-2.0 cada campo obligatorio omitido o vacío responde 400 y no guarda nada | pasó |
|  |  | API | `api/test/solicitudInformacion.test.ts` | HU0001-2.0 rechaza correos y celulares con formato inválido y guarda los válidos normalizados | pasó |
|  |  | API | `api/test/solicitudInformacion.test.ts` | HU0001-2.0 el cliente y el servidor aplican las mismas reglas | pasó |
|  |  | Frontend | `frontend/src/views/portal/SolicitudInformacion.test.ts` | HU0001-2.0 resalta los campos obligatorios vacíos con su mensaje, lleva el foco al primero y no llama a la API | pasó |
|  |  | Frontend | `frontend/src/views/portal/SolicitudInformacion.test.ts` | HU0001-2.0 resalta el correo y el celular con formato inválido con su mensaje y no llama a la API; corregidos, la solicitud se envía | pasó |
|  |  | E2E | `e2e/solicitud-informacion.spec.ts` | HU0001-2.0 con campos vacíos o con formato inválido, P01 resalta los campos con el color del estado observado de los prototipos, muestra los mensajes y no envía nada | pasó |
| HU0001-3.0 — Intento de registro sin consentimiento | cubierto | API | `api/test/solicitudInformacion.test.ts` | HU0001-3.0 sin aceptar la política responde 422 y no guarda nada, aunque se salte el formulario y aunque los demás campos sean inválidos | pasó |
|  |  | API | `api/test/solicitudInformacion.test.ts` | HU0001-3.0 sin consentimiento no se dispara ningún evento hacia n8n | pasó |
|  |  | Frontend | `frontend/src/views/portal/SolicitudInformacion.test.ts` | HU0001-3.0 sin el consentimiento muestra «El consentimiento es obligatorio para continuar.» y no llama a la API; las dos casillas empiezan desmarcadas | pasó |
|  |  | E2E | `e2e/solicitud-informacion.spec.ts` | HU0001-3.0 sin marcar el consentimiento, P01 indica que es obligatorio para continuar, no envía nada y no se guarda ningún dato | pasó |

### HU0002 — Distribuir automáticamente la carpeta informativa digital de admisión por correo electrónico y mensajería instantánea tras el registro de un prospecto

| Escenario | Estado | Suite | Archivo | Prueba | Resultado |
|---|---|---|---|---|---|
| HU0002-1.0 — Despacho exitoso de la carpeta informativa automatizada | verificado: correo, sin WhatsApp; pendiente: WhatsApp autorizado (C30) | API | `api/test/captacion.test.ts` | HU0002-1.0 [parte: correo] la reserva crea una notificación pendiente y devuelve el asunto y el cuerpo con la carpeta y el enlace para agendar | pasó |
|  |  | API | `api/test/captacion.test.ts` | HU0002-1.0 [parte: correo] el enlace identifica al expediente sin mostrar su id; un token alterado, truncado o de otra clave no identifica a nadie | pasó |
|  |  | API | `api/test/captacion.test.ts` | HU0002-1.0 [parte: correo] los textos del colegio van entre corchetes, y sin CARPETA_INFORMATIVA_URL el cuerpo lo dice | pasó |
|  |  | API | `api/test/captacion.test.ts` | HU0002-1.0 [parte: correo] marcar enviado o fallido cierra la notificación; repetirlo es idempotente y cambiar un estado cerrado da 409 | pasó |
|  |  | E2E | `e2e/captacion.spec.ts` | HU0002-1.0 [parte: correo] desde P01, el correo con la carpeta y el enlace llega a Mailpit en menos de un minuto y queda enviado | pasó |
|  |  | E2E | `e2e/captacion.spec.ts` | HU0002-1.0 [parte: sin WhatsApp] con la casilla marcada y el canal desactivado, o sin marcarla, no hay fila de WhatsApp y el flujo termina bien | pasó |
| HU0002-2.0 — Falla en el despacho por rebote de correo electrónico | verificado: rechazo síncrono; pendiente: rebote asíncrono del proveedor (C34) | API | `api/test/captacion.test.ts` | HU0002-2.0 [parte: rechazo síncrono] el rebote deja la notificación fallida, audita notificacion_rebotada y pasa el expediente a contacto_no_entregado en una transacción | pasó |
|  |  | API | `api/test/captacion.test.ts` | HU0002-2.0 [parte: rechazo síncrono] repetir el rebote no duplica eventos; fuera de prospecto se registra sin transición | pasó |
|  |  | API | `api/test/captacionTransaccion.test.ts` | HU0002-2.0 [parte: rechazo síncrono] si la transición falla, el rebote no deja nada: la notificación no cambia ni queda notificacion_rebotada | pasó |
|  |  | API | `api/test/prospectos.test.ts` | HU0002-2.0 [parte: rechazo síncrono] G04: la secretaria recibe los prospectos con contacto no entregado (nombre, grado, correo, teléfono y fecha), sin DNI | pasó |
|  |  | API | `api/test/prospectos.test.ts` | HU0002-2.0 [parte: rechazo síncrono] G04: otro rol recibe 403 y el intento se audita como acceso_denegado | pasó |
|  |  | Frontend | `frontend/src/views/gestion/VisitasGuiadas.test.ts` | HU0002-2.0 [parte: rechazo síncrono] G04 muestra la sección con la insignia, el texto y una fila por prospecto, con el teléfono y la fecha del mockup | pasó |
|  |  | Frontend | `frontend/src/views/gestion/VisitasGuiadas.test.ts` | HU0002-2.0 [parte: rechazo síncrono] G04 sin prospectos muestra el mensaje vacío | pasó |
|  |  | Frontend | `frontend/src/views/gestion/VisitasGuiadas.test.ts` | HU0002-2.0 [parte: rechazo síncrono] «Visitas guiadas» aparece y navega solo para secretaria | pasó |
|  |  | E2E | `e2e/captacion.spec.ts` | HU0002-2.0 [parte: rechazo síncrono] un correo rechazado por el servidor deja la notificación fallida, el rebote auditado y el prospecto en G04 | pasó |

### HU0003 — Agendar de forma autónoma una fecha y horario disponible para la visita guiada personalizada en las instalaciones del colegio

| Escenario | Estado | Suite | Archivo | Prueba | Resultado |
|---|---|---|---|---|---|
| HU0003-1.0 — Reserva exitosa de visita guiada presencial | cubierto | API | `api/test/avisosVisita.test.ts` | HU0003-1.0 el aviso de confirmación crea la notificación pendiente con fecha, hora, lugar y asistentes; repetirlo responde 409 | pasó |
|  |  | API | `api/test/avisosVisita.test.ts` | HU0003-1.0 un intento de resultado desconocido se retoma a los 10 min con una fila nueva y la anterior sigue pendiente | pasó |
|  |  | API | `api/test/avisosVisita.test.ts` | HU0003-1.0 (tope) 6 intentos de confirmación con resultado desconocido dejan una sola fila de cierre fallido y ningún intento más | pasó |
|  |  | API | `api/test/avisosVisita.test.ts` | HU0003-1.0 (barrido) el barrido selecciona avisos, no filas: una pendiente vieja de un aviso con un intento más reciente, o con una fila enviado o fallido, no vuelve a los pendientes | pasó |
|  |  | API | `api/test/avisosVisita.test.ts` | HU0003-1.0 (indicadores) la consulta de C8 cuenta cada aviso una sola vez, aunque tenga varias filas | pasó |
|  |  | API | `api/test/avisosVisita.test.ts` | HU0003-1.0 las rutas /internal/* de agendamiento y recordatorios responden 401 sin el token de servicio | pasó |
|  |  | API | `api/test/n8nAgendamiento.test.ts` | HU0003-1.0 «Validar evento» de agendamiento acepta solo { id_cita } con un entero de 1 a 2147483647 (ADR-16) | pasó |
|  |  | API | `api/test/n8nAgendamiento.test.ts` | HU0003-1.0 «Clasificar resultado» de agendamiento y de seguimiento-recordatorios elige la rama de ADR-07 ante cada resultado de notificacion-multicanal | pasó |
|  |  | API | `api/test/recordatorios.test.ts` | HU0003-1.0 el recordatorio entra en los pendientes al llegar a RECORDATORIO_VISITA_HORAS antes y su reserva es única por cita: nunca hay dos | pasó |
|  |  | API | `api/test/recordatorios.test.ts` | HU0003-1.0 pasada la hora de la visita el recordatorio deja de intentarse y sus filas conservan su estado | pasó |
|  |  | API | `api/test/visitaGuiada.test.ts` | HU0003-1.0 con el enlace de la carpeta, P02 recibe los horarios de visita futuros de la campaña con su cupo, el apoderado, el grado y el lugar | pasó |
|  |  | API | `api/test/visitaGuiada.test.ts` | HU0003-1.0 la reserva descuenta el cupo, registra la cita con los asistentes, pasa el expediente a visita_agendada con su auditoría y avisa a agendamiento después de responder | pasó |
|  |  | API | `api/test/visitaGuiada.test.ts` | HU0003-1.0 (C25) solo se ofrecen y reservan horarios de visita de la campaña activa cuyo responsable es una directora activa | pasó |
|  |  | Frontend | `frontend/src/router.test.ts` | HU0003-1.0 /visita-guiada es pública: abre P02 sin consultar la sesión ni redirigir a Keycloak, y su lectura no lleva Authorization | pasó |
|  |  | Frontend | `frontend/src/views/portal/VisitaGuiada.test.ts` | HU0003-1.0 P02 resalta los días con horarios, lista los del día con «Disponible» o «Reservado» y navega entre meses | pasó |
|  |  | Frontend | `frontend/src/views/portal/VisitaGuiada.test.ts` | HU0003-1.0 P02 exige los asistentes y confirma la visita | pasó |
|  |  | E2E | `e2e/visita-guiada.spec.ts` | HU0003-1.0 desde el enlace del correo de la carpeta, la familia reserva en P02 y recibe la confirmación y un solo recordatorio | pasó |
| HU0003-2.0 — Intento de reserva en un horario tomado simultáneamente | cubierto | API | `api/test/visitaGuiada.test.ts` | HU0003-2.0 dos reservas simultáneas del último cupo: una 201 y otra 409 HORARIO_SIN_CUPO, los cupos quedan en 0 y hay una sola cita | pasó |
|  |  | API | `api/test/visitaGuiada.test.ts` | HU0003-2.0 después del rechazo, P02 recibe ese horario como «Reservado» para elegir otro | pasó |
|  |  | API | `api/test/visitaGuiada.test.ts` | HU0003-2.0 (B2) con cupos 2, después de la primera reserva P02 muestra el horario como «Reservado» y una segunda reserva responde 409 | pasó |
|  |  | Frontend | `frontend/src/views/portal/VisitaGuiada.test.ts` | HU0003-2.0 P02 ante un 409 muestra el aviso del mockup, recarga los horarios y pide elegir otro | pasó |

### HU0004 — Registrar la asistencia y conformidad de la visita guiada personalizada

| Escenario | Estado | Suite | Archivo | Prueba | Resultado |
|---|---|---|---|---|---|
| HU0004-1.0 — Registro de visita conforme y apertura de postulación | cubierto | API | `api/test/avisosVisita.test.ts` | HU0004-1.0 el aviso de credenciales fija una contraseña temporal en Keycloak y devuelve el correo con el usuario, la contraseña y el enlace al portal; la retoma la rota y no la toca si la familia ya la cambió | pasó |
|  |  | API | `api/test/avisosVisita.test.ts` | HU0004-1.0 (tope) 6 intentos de credenciales con resultado desconocido dejan una sola fila de cierre fallido, ningún intento más, y M3 invalida la contraseña | pasó |
|  |  | API | `api/test/visitas.test.ts` | HU0004-1.0 «Asistió - Interesado en postular» crea el usuario familia y la cuenta de acceso, deja la cita asistio y el expediente en portal_habilitado con auditoría, y avisa a agendamiento | pasó |
|  |  | API | `api/test/visitas.test.ts` | HU0004-1.0 si la BD falla después de crear el usuario, se borra de Keycloak y no queda nada; un huérfano se adopta en el siguiente intento | pasó |
|  |  | API | `api/test/visitas.test.ts` | HU0004-1.0 (C28) un correo que ya tiene cuenta en Keycloak responde 409 CORREO_CON_CUENTA sin cambios | pasó |
|  |  | API | `api/test/visitas.test.ts` | HU0004-1.0 G04: la secretaria recibe las visitas de la semana sin DNI; otro rol recibe 403 con acceso_denegado; una visita ya registrada responde 409 | pasó |
|  |  | API | `api/test/visitas.test.ts` | HU0004-1.0 (P-c) GET /visitas incluye en sin_registrar las visitas reservadas de semanas anteriores | pasó |
|  |  | Frontend | `frontend/src/views/gestion/AgendaVisitas.test.ts` | HU0004-1.0 G04 «Asistió» abre «Registrar visita» y «Registrar y habilitar portal» envía asistio_interesado | pasó |
|  |  | Frontend | `frontend/src/views/gestion/AgendaVisitas.test.ts` | HU0004-1.0 (P-c) G04 muestra la sección «Sin registrar» con esas visitas y sus acciones | pasó |
|  |  | E2E | `e2e/visita-guiada.spec.ts` | HU0004-1.0 la secretaria registra «Asistió - Interesado» en G04 y llegan al correo de la familia el usuario, la contraseña temporal y el enlace al portal | pasó |
| HU0004-2.0 — Registro de inasistencia a la visita guiada | cubierto | API | `api/test/avisosVisita.test.ts` | HU0004-2.0 el aviso de reprogramación trae un enlace nuevo de P02 que vuelve a aceptar una reserva, y el de la carpeta también vale | pasó |
|  |  | API | `api/test/avisosVisita.test.ts` | HU0004-2.0 (B1) tras «No asistió» y una nueva reserva, la cita 2 recibe su propia visita_confirmada y su recordatorio, aunque la cita 1 ya los tuvo | pasó |
|  |  | API | `api/test/visitas.test.ts` | HU0004-2.0 «No asistió» deja la cita no_asistio, devuelve el expediente a prospecto con auditoría y avisa a agendamiento | pasó |
|  |  | API | `api/test/visitas.test.ts` | HU0004-2.0 (G04) la etiqueta de una visita anterior conserva su invitación después de que la familia vuelve a reservar | pasó |
|  |  | API | `api/test/visitas.test.ts` | HU0004-2.0 (G04) con varias filas por aviso, la etiqueta de la invitación muestra el cierre (enviado o fallido) si existe y, si no, «pendiente» | pasó |
|  |  | Frontend | `frontend/src/views/gestion/AgendaVisitas.test.ts` | HU0004-2.0 G04 «No asistió» envía no_asistio y la fila muestra «No asistió» | pasó |
|  |  | E2E | `e2e/visita-guiada.spec.ts` | HU0004-2.0 «No asistió» en G04 envía la invitación con un enlace nuevo de P02 que vuelve a reservar | pasó |

### HU0021 — Crear, modificar, desactivar y reactivar las cuentas del personal y asignarles un rol (secretaría, Tesorería, psicóloga, evaluador académico o Directora)

| Escenario | Estado | Suite | Archivo | Prueba | Resultado |
|---|---|---|---|---|---|
| HU0021-1.0 — Alta de una cuenta del personal | cubierto | API | `api/test/keycloakAdmin.test.ts` | HU0021-1.0 crea el usuario deshabilitado y con origen=api-personal, con un token de client credentials pedido una sola vez | pasó |
|  |  | API | `api/test/keycloakAdmin.test.ts` | HU0021-1.0 si Keycloak responde 409 (el usuario ya existe), crearUsuario devuelve null; buscarPorCorreo trae habilitado y origen | pasó |
|  |  | API | `api/test/keycloakAdmin.test.ts` | HU0021-1.0 envía el enlace UPDATE_PASSWORD hacia gestion-interna con vigencia de 72 h | pasó |
|  |  | API | `api/test/keycloakAdmin.test.ts` | HU0021-1.0 habilitar y actualizarNombres envían la representación completa (no borran atributos del perfil) | pasó |
|  |  | API | `api/test/keycloakAdmin.test.ts` | HU0021-1.0 un error de Keycloak o la falta de respuesta se traducen en 502 IDENTIDAD_NO_DISPONIBLE, sin el correo en el log | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-1.0 la directora crea la cuenta: 201, fila activa, usuario de Keycloak con el rol, habilitado al final, enlace enviado y gestion_usuario auditado | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-1.0 un correo que ya tiene cuenta, activa o desactivada, responde 409 CORREO_DUPLICADO sin llamar a Keycloak | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-1.0 si falla el envío del enlace no queda fila en personal, ni usuario en Keycloak, ni evento | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-1.0 si también falla el borrado, el huérfano queda deshabilitado y solo en el log (con su id), y el reintento con el mismo correo lo adopta | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-1.0 no adopta un usuario de Keycloak sin el atributo origen=api-personal (p. ej. la cuenta de una familia): responde 409 y no lo toca | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-1.0 no adopta un usuario de Keycloak habilitado: responde 409 y no lo toca | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-1.0 no adopta un usuario de Keycloak con credenciales: responde 409 y no lo toca | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-1.0 no adopta un usuario de Keycloak ya vinculado a una fila de personal: responde 409 y no lo toca | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-1.0 datos inválidos responden 400 VALIDACION y no llaman a Keycloak | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-1.0 un rol distinto de directora recibe 403 y queda acceso_denegado | pasó |
|  |  | Frontend | `frontend/src/router.test.ts` | HU0021-1.0 /gestion/usuarios solo la abre la directora; otro rol vuelve a /gestion | pasó |
|  |  | Frontend | `frontend/src/views/gestion/LayoutGestion.test.ts` | HU0021-1.0 al iniciar sesión, secretaria ve en la barra lateral únicamente las opciones de su rol | pasó |
|  |  | Frontend | `frontend/src/views/gestion/LayoutGestion.test.ts` | HU0021-1.0 al iniciar sesión, tesoreria ve en la barra lateral únicamente las opciones de su rol | pasó |
|  |  | Frontend | `frontend/src/views/gestion/LayoutGestion.test.ts` | HU0021-1.0 al iniciar sesión, psicologa ve en la barra lateral únicamente las opciones de su rol | pasó |
|  |  | Frontend | `frontend/src/views/gestion/LayoutGestion.test.ts` | HU0021-1.0 al iniciar sesión, evaluador_academico ve en la barra lateral únicamente las opciones de su rol | pasó |
|  |  | Frontend | `frontend/src/views/gestion/LayoutGestion.test.ts` | HU0021-1.0 al iniciar sesión, directora ve en la barra lateral únicamente las opciones de su rol | pasó |
|  |  | Frontend | `frontend/src/views/gestion/UsuariosRoles.test.ts` | HU0021-1.0 envía nombres, apellidos, correo y rol a POST /personal y la cuenta aparece en la tabla como Activo | pasó |
|  |  | Frontend | `frontend/src/views/gestion/UsuariosRoles.test.ts` | HU0021-1.0 no envía el alta si falta un campo obligatorio o el correo no es válido | pasó |
|  |  | Frontend | `frontend/src/views/gestion/UsuariosRoles.test.ts` | HU0021-1.0 si el correo ya tiene cuenta (409) muestra el mensaje de la API y no agrega filas | pasó |
|  |  | E2E | `e2e/acceso-personal.spec.ts` | HU0021-1.0 /gestion abre el acceso del personal (G01) con sus textos, campos y botón, sin recursos externos | pasó |
|  |  | E2E | `e2e/personal-api.spec.ts` | HU0021-1.0 la API crea la cuenta con su rol y Keycloak envía a Mailpit el enlace para definir la contraseña | pasó |
|  |  | E2E | `e2e/personal-api.spec.ts` | HU0021-1.0 con el enlace la persona define su contraseña, inicia sesión y su token trae solo su rol | pasó |
|  |  | E2E | `e2e/usuarios-roles.spec.ts` | HU0021-1.0 la directora crea la cuenta en G10; la persona define su contraseña con el enlace y al iniciar sesión ve solo las opciones de su rol | pasó |
| HU0021-2.0 — Acceso denegado a información restringida | mecanismo probado; verificación en ruta real pendiente (C17) | API | `api/test/accesoRestringido.test.ts` | HU0021-2.0 [política, ruta de prueba] secretaria no abre documentacion_financiera de un expediente: 403, sin contenido y acceso_denegado auditado | pasó |
|  |  | API | `api/test/accesoRestringido.test.ts` | HU0021-2.0 [política, ruta de prueba] secretaria no abre informe_psicologico de un expediente: 403, sin contenido y acceso_denegado auditado | pasó |
|  |  | API | `api/test/accesoRestringido.test.ts` | HU0021-2.0 [política, ruta de prueba] evaluador_academico no abre documentacion_financiera de un expediente: 403, sin contenido y acceso_denegado auditado | pasó |
|  |  | API | `api/test/accesoRestringido.test.ts` | HU0021-2.0 [política, ruta de prueba] evaluador_academico no abre informe_psicologico de un expediente: 403, sin contenido y acceso_denegado auditado | pasó |
|  |  | API | `api/test/accesoRestringido.test.ts` | HU0021-2.0 [política, ruta de prueba] control: tesoreria sí abre documentacion_financiera y no se registra acceso_denegado | pasó |
|  |  | API | `api/test/accesoRestringido.test.ts` | HU0021-2.0 [política, ruta de prueba] control: psicologa sí abre informe_psicologico y no se registra acceso_denegado | pasó |
|  |  | API | `api/test/accesoRestringido.test.ts` | HU0021-2.0 [política, ruta de prueba] control: directora sí abre informe_psicologico y no se registra acceso_denegado | pasó |
|  |  | API | `api/test/accesoRestringido.test.ts` | HU0021-2.0 [política, ruta de prueba] un id de expediente inexistente se bloquea igual y se audita sin id_expediente | pasó |
| HU0021-3.0 — Modificación de una cuenta del personal | cubierto | API | `api/test/keycloakAdmin.test.ts` | HU0021-3.0 establecerRolUnico quita primero los otros roles de la app y después agrega el nuevo (falla cerrado) | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-3.0 cambia nombres, apellidos y rol: personal y Keycloak actualizados y gestion_usuario sin los valores de los nombres | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-3.0 solo el rol: Keycloak no toca los nombres y el evento lista solo el rol | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-3.0 el correo no se modifica y un cuerpo vacío o inválido responde 400 | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-3.0 una cuenta inexistente responde 404 y una desactivada 409 CUENTA_INACTIVA | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-3.0 si Keycloak falla al cambiar el rol, personal queda igual, no hay evento y se restauran los nombres y el rol anteriores | pasó |
|  |  | Frontend | `frontend/src/views/gestion/UsuariosRoles.test.ts` | HU0021-3.0 «Editar» carga la cuenta en el panel con el correo bloqueado y «Guardar cambios» envía el PATCH | pasó |
|  |  | Frontend | `frontend/src/views/gestion/UsuariosRoles.test.ts` | HU0021-3.0 «Cancelar» sale de la edición sin enviar nada | pasó |
|  |  | E2E | `e2e/personal-api.spec.ts` | HU0021-3.0 tras cambiar el rol, en el siguiente inicio de sesión el token trae solo el rol nuevo | pasó |
|  |  | E2E | `e2e/usuarios-roles.spec.ts` | HU0021-3.0 la directora cambia el rol en G10 y, en su siguiente inicio de sesión, la persona ve solo las opciones del rol nuevo | pasó |
| HU0021-4.0 — Desactivación de una cuenta del personal | cubierto | API | `api/test/keycloakAdmin.test.ts` | HU0021-4.0 deshabilitar hace PUT con enabled false y cerrarSesiones hace POST /logout | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-4.0 desactiva la cuenta: Keycloak deshabilitado y sin sesiones, activo = false, gestion_usuario y el historial anterior intacto | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-4.0 una cuenta ya desactivada responde 409 CUENTA_INACTIVA y una inexistente 404 | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-4.0 si falla el cierre de sesiones, la cuenta no se vuelve a habilitar y personal queda sin cambios | pasó |
|  |  | Frontend | `frontend/src/views/gestion/UsuariosRoles.test.ts` | HU0021-4.0 «Desactivar» pide confirmación; al confirmar la cuenta queda «Desactivado» y sin Editar ni Desactivar | pasó |
|  |  | E2E | `e2e/acceso-personal.spec.ts` | HU0021-4.0 una cuenta desactivada ve en G01 el mensaje de Keycloak y no entra | pasó |
|  |  | E2E | `e2e/personal-api.spec.ts` | HU0021-4.0 tras desactivar, Keycloak la deja deshabilitada y sin sesiones, el login es rechazado y la lista la muestra inactiva | pasó |
|  |  | E2E | `e2e/usuarios-roles.spec.ts` | HU0021-4.0 la directora desactiva la cuenta en G10: su sesión abierta se cierra, no puede volver a entrar y G10 la muestra «Desactivado» | pasó |
| HU0021-5.0 — Reactivación de una cuenta del personal | cubierto | API | `api/test/personal.test.ts` | HU0021-5.0 reactiva la cuenta con el rol que tenía y su contraseña: Keycloak habilitado, activo = true, sin enlace, gestion_usuario y el historial anterior intacto | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-5.0 si la cuenta nunca definió su contraseña, Keycloak le reenvía el enlace y la auditoría lo registra | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-5.0 una cuenta activa responde 409 CUENTA_ACTIVA, una inexistente 404 y un id inválido 400, sin llamar a Keycloak | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-5.0 si falla el envío del enlace, la cuenta vuelve a quedar deshabilitada, personal sigue inactivo y no hay evento | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-5.0 si falla la habilitación en Keycloak (pudo aplicarse sin respuesta), igual se compensa con deshabilitar y personal sigue inactivo | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-5.0 si también falla la compensación, el log trae solo el id de Keycloak y personal sigue inactivo | pasó |
|  |  | API | `api/test/personal.test.ts` | HU0021-5.0 un rol distinto de directora recibe 403 y queda acceso_denegado | pasó |
|  |  | Frontend | `frontend/src/views/gestion/UsuariosRoles.test.ts` | HU0021-5.0 «Reactivar» pide confirmación; al confirmar la cuenta queda «Activo» con Editar y Desactivar | pasó |
|  |  | Frontend | `frontend/src/views/gestion/UsuariosRoles.test.ts` | HU0021-5.0 si la cuenta nunca definió su contraseña, el aviso indica que se envió el enlace a su correo | pasó |
|  |  | Frontend | `frontend/src/views/gestion/UsuariosRoles.test.ts` | HU0021-5.0 si la API responde un error, muestra su mensaje y la cuenta sigue «Desactivado» | pasó |
|  |  | E2E | `e2e/personal-api.spec.ts` | HU0021-5.0 tras reactivar, Keycloak la deja habilitada con el rol que tenía, la persona entra con su contraseña y la lista la muestra activa | pasó |
|  |  | E2E | `e2e/personal-api.spec.ts` | HU0021-5.0 una cuenta que nunca definió su contraseña recibe al reactivarla un enlace nuevo y con él puede entrar | pasó |
|  |  | E2E | `e2e/usuarios-roles.spec.ts` | HU0021-5.0 la directora reactiva la cuenta en G10; la persona vuelve a entrar con su contraseña y ve solo las opciones del rol que tenía | pasó |

### HU0022 — Configurar por campaña los grados, las vacantes, las evaluaciones requeridas, los requisitos documentales con su condición de aplicación, la cuota de ingreso y los horarios disponibles

| Escenario | Estado | Suite | Archivo | Prueba | Resultado |
|---|---|---|---|---|---|
| HU0022-1.0 — Configuración de un grado de la campaña | verificado: almacenamiento; pendiente: completitud, agendamiento, adjudicación (C25) | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] GET /configuracion lista solo los grados de la campaña activa, con sus vacantes adjudicadas y el derecho de admisión de R16 | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] guarda vacantes, evaluaciones, cuota y máximo de fracciones de un grado: ajusta las disponibles sin cambiar las adjudicadas y registra cambio_configuracion con el valor anterior y el nuevo | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] acepta una cuota de ingreso de 0 (plan HU0022, P10: colegios sin cuota) | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] un guardado sin cambios responde 200 y no registra eventos | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] varios grados se guardan juntos, con un evento por grado que cambió; si uno no es de la campaña activa (404), no se guarda ninguno | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un guardado con lista vacía y no cambia el grado | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un guardado con vacantes negativas y no cambia el grado | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un guardado con vacantes no enteras y no cambia el grado | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un guardado con máximo de fracciones 0 y no cambia el grado | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un guardado con cuota negativa y no cambia el grado | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un guardado con cuota con 3 decimales y no cambia el grado | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un guardado con cuota fuera de numeric(10,2) y no cambia el grado | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un guardado con evaluación que no es booleana y no cambia el grado | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un guardado con vacantes disponibles (no se configuran) y no cambia el grado | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un guardado con grado repetido y no cambia el grado | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] registra un requisito con su condición de aplicación, con los valores por defecto del DBML, y audita el alta | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] «si es dependiente» o «si es independiente» sin por_apoderado responde 400, como el CHECK, al registrar y al editar | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] un nombre ya registrado en el grado responde 409 REQUISITO_DUPLICADO, también si solo cambian las mayúsculas (P14); en otro grado sí se acepta | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] edita un requisito sin cambiar su grado y audita solo los campos que cambiaron (P4) | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] quita un requisito sin documentos (204 y baja auditada) y responde 409 EN_USO si ya hay documentos cargados (P4) | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] los requisitos de un grado de otra campaña o inexistente responden 404 | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] registra un horario de visita con un responsable de rol directora y lo audita solo con ids | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] registra un horario de jornada_observacion con un responsable de rol psicologa y lo audita solo con ids | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] registra un horario de evaluacion_psicologica con un responsable de rol psicologa y lo audita solo con ids | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] registra un horario de entrevista_padres con un responsable de rol psicologa y lo audita solo con ids | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] registra un horario de evaluacion_academica con un responsable de rol evaluador_academico y lo audita solo con ids | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 422 un responsable de otro rol, desactivado o inexistente (P2), sin guardar el horario | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 409 HORARIO_SUPERPUESTO un horario que se cruza con otro del mismo responsable, también de otra campaña (P1); acepta uno contiguo y el mismo horario de otra persona | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] quita un horario sin citas (204 y baja auditada) y responde 409 EN_USO si ya tiene citas (P4) | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] lista los horarios de la campaña activa (con filtro por tipo) y solo ofrece como responsables las cuentas activas de directora, psicóloga y evaluador académico | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un horario con hora de fin igual a la de inicio | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un horario con hora de fin anterior a la de inicio | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un horario con hora sin dos dígitos | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un horario con fecha inexistente | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un horario con cupos negativos | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un horario con tipo de cita desconocido | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-1.0 [parte: almacenamiento] rechaza con 400 un horario con campaña en el cuerpo (la pone el servidor) | pasó |
|  |  | Frontend | `frontend/src/views/gestion/ConfiguracionCampana.test.ts` | HU0022-1.0 [parte: almacenamiento] muestra las pestañas y la tabla del mockup con lo que devuelve la API, sin valores fijos | pasó |
|  |  | Frontend | `frontend/src/views/gestion/ConfiguracionCampana.test.ts` | HU0022-1.0 [parte: almacenamiento] edita vacantes y evaluaciones (chips con aria-pressed) y los envía en un solo guardado | pasó |
|  |  | Frontend | `frontend/src/views/gestion/ConfiguracionCampana.test.ts` | HU0022-1.0 [parte: almacenamiento] 0 adjudicadas se muestra como «—» con aria-label «0 adjudicadas», y la entrevista aplica siempre sin poder quitarse | pasó |
|  |  | Frontend | `frontend/src/views/gestion/ConfiguracionCampana.test.ts` | HU0022-1.0 [parte: almacenamiento] el panel lateral muestra los requisitos del grado elegido con los chips del mockup | pasó |
|  |  | Frontend | `frontend/src/views/gestion/ConfiguracionCampana.test.ts` | HU0022-1.0 [parte: almacenamiento] registra un requisito; «Se exige a cada apoderado» queda marcado y bloqueado con «Si es dependiente» | pasó |
|  |  | Frontend | `frontend/src/views/gestion/ConfiguracionCampana.test.ts` | HU0022-1.0 [parte: almacenamiento] edita un requisito sin poder cambiar el grado y muestra junto al campo el 409 de nombre repetido | pasó |
|  |  | Frontend | `frontend/src/views/gestion/ConfiguracionCampana.test.ts` | HU0022-1.0 [parte: almacenamiento] quita un requisito tras confirmar y, si la API responde 409 EN_USO, explica por qué no se quitó | pasó |
|  |  | Frontend | `frontend/src/views/gestion/ConfiguracionCampana.test.ts` | HU0022-1.0 [parte: almacenamiento] guarda la cuota (también 0) y el máximo de fracciones de los grados con lo que devuelve la API | pasó |
|  |  | Frontend | `frontend/src/views/gestion/ConfiguracionCampana.test.ts` | HU0022-1.0 [parte: almacenamiento] solo ofrece los responsables del rol del tipo de cita y registra el horario | pasó |
|  |  | Frontend | `frontend/src/views/gestion/ConfiguracionCampana.test.ts` | HU0022-1.0 [parte: almacenamiento] muestra junto a las horas el 409 de horario superpuesto y quita un horario tras confirmar (409 EN_USO con su motivo) | pasó |
|  |  | E2E | `e2e/configuracion.spec.ts` | HU0022-1.0 [parte: almacenamiento] la secretaría cambia en G09 vacantes, una evaluación, la cuota y el máximo de fracciones de un grado, y siguen al recargar | pasó |
|  |  | E2E | `e2e/configuracion.spec.ts` | HU0022-1.0 [parte: almacenamiento] la secretaría registra, edita y quita un requisito con su condición; un nombre repetido (sin distinguir mayúsculas) se rechaza | pasó |
|  |  | E2E | `e2e/configuracion.spec.ts` | HU0022-1.0 [parte: almacenamiento] la secretaría registra un horario de visita con la directora, se rechaza uno superpuesto y lo quita | pasó |
| HU0022-2.0 — Intento de fijar menos vacantes que las ya adjudicadas | verificado: regla; pendiente: adjudicación real (C25) | API | `api/test/configuracion.test.ts` | HU0022-2.0 [parte: regla] rechaza fijar menos vacantes que las adjudicadas: 422 con el mínimo permitido, sin cambios ni auditoría | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-2.0 [parte: regla] acepta exactamente el mínimo: las vacantes disponibles quedan en 0 | pasó |
|  |  | API | `api/test/configuracion.test.ts` | HU0022-2.0 [parte: regla] en un guardado de varios grados, uno por debajo del mínimo rechaza todo el lote y el mensaje nombra el primero | pasó |
|  |  | Frontend | `frontend/src/views/gestion/ConfiguracionCampana.test.ts` | HU0022-2.0 [parte: regla] no valida la regla en el cliente: envía el cambio y, con el 422 de la API, marca el grado con «Ya hay 27 adjudicadas» y muestra el aviso con el mínimo | pasó |

## HU sin pruebas

| HU | Escenario | Estado |
|---|---|---|
| HU0005 | HU0005-1.0 — Guardado completo de la ficha de inscripción y expectativas | sin prueba |
| HU0005 | HU0005-2.0 — Guardado parcial de borrador de ficha | sin prueba |
| HU0006 | HU0006-1.0 — Carga exitosa de legajo documental digital | sin prueba |
| HU0006 | HU0006-2.0 — Intento de carga con formato o tamaño de archivo no soportado | sin prueba |
| HU0007 | HU0007-1.0 — Registro conforme del comprobante de pago de postulación | sin prueba |
| HU0007 | HU0007-2.0 — Registro con número de operación duplicado | sin prueba |
| HU0008 | HU0008-1.0 — Conformidad documental del expediente | sin prueba |
| HU0008 | HU0008-2.0 — Observación de un documento ilegible o incorrecto | sin prueba |
| HU0009 | HU0009-1.0 — Agendamiento exitoso de las evaluaciones del grado | sin prueba |
| HU0009 | HU0009-2.0 — Reprogramación de una cita de evaluación por la familia | sin prueba |
| HU0010 | HU0010-1.0 — Registro de dictamen Apto | sin prueba |
| HU0010 | HU0010-2.0 — Registro de dictamen En observación con requisitos complementarios | sin prueba |
| HU0010 | HU0010-3.0 — Registro de dictamen No apto | sin prueba |
| HU0011 | HU0011-1.0 — Documentación financiera conforme | sin prueba |
| HU0011 | HU0011-2.0 — Documentación financiera observada | sin prueba |
| HU0012 | HU0012-1.0 — Asignación exitosa de vacante escolar | sin prueba |
| HU0012 | HU0012-2.0 — Intento de asignación en un grado sin vacantes disponibles | sin prueba |
| HU0013 | HU0013-1.0 — Elección de la modalidad de pago de la cuota de ingreso | sin prueba |
| HU0013 | HU0013-2.0 — Elección de un número de fracciones no permitido | sin prueba |
| HU0014 | HU0014-1.0 — Carga conforme del comprobante de la cuota de ingreso | sin prueba |
| HU0014 | HU0014-2.0 — Carga de archivo ilegible o con extensión no válida | sin prueba |
| HU0015 | HU0015-1.0 — Aprobación de la conciliación bancaria de la cuota | sin prueba |
| HU0015 | HU0015-2.0 — Rechazo por inconsistencia en el monto o número de operación | sin prueba |
| HU0016 | HU0016-1.0 — Generación y despacho automático de la Carta de Vacante | sin prueba |
| HU0016 | HU0016-2.0 — Bloqueo de emisión de Carta de Vacante ante pagos pendientes | sin prueba |
| HU0017 | HU0017-1.0 — Verificación de expediente completo | sin prueba |
| HU0017 | HU0017-2.0 — Detección de expediente incompleto | sin prueba |
| HU0018 | HU0018-1.0 — Envío de recordatorio por inactividad de la familia | sin prueba |
| HU0018 | HU0018-2.0 — Expiración de postulación por vencimiento del plazo de la etapa | sin prueba |
| HU0019 | HU0019-1.0 — Visualización del embudo de conversión y tiempos de atención | sin prueba |
| HU0019 | HU0019-2.0 — Exportación de reportes consolidados para toma de decisiones | sin prueba |
| HU0020 | HU0020-1.0 — Consulta del avance de la postulación | sin prueba |
| HU0020 | HU0020-2.0 — Atención de una acción pendiente desde el panel | sin prueba |
| HU0023 | HU0023-1.0 — Primer ingreso con credenciales temporales | sin prueba |
| HU0023 | HU0023-2.0 — Bloqueo por intentos fallidos de ingreso | sin prueba |
| HU0024 | HU0024-1.0 — Validación conforme del derecho de admisión | sin prueba |
| HU0024 | HU0024-2.0 — Observación del comprobante del derecho de admisión | sin prueba |
| HU0025 | HU0025-1.0 — Registro del resultado de la evaluación académica | sin prueba |
| HU0025 | HU0025-2.0 — Registro de inasistencia a la evaluación académica | sin prueba |
