# Matriz de trazabilidad (HU → escenario → prueba → resultado)

> Generada con `npm run evidencias:matriz` el 19/10/26, 6:33 p. m. (America/Lima) sobre el commit `b55b0ed`. No se edita a mano.

## Resumen

| Suite | Pruebas | Pasan | Fallan | Omitidas o no ejecutadas |
|---|---|---|---|---|
| API | 116 | 116 | 0 | 0 |
| Frontend | 24 | 24 | 0 | 0 |
| E2E | 28 | 28 | 0 | 0 |

- Escenarios del backlog: **54** en 25 HU; con al menos una prueba: **4**.
- Estados: sin prueba: 50 · cubierto: 3 · mecanismo probado; verificación en ruta real pendiente (C17): 1.
- Las pruebas del Sprint 0 (`S0-*`) y las de soporte (`G10`, `G01`, `C19`…) cuentan en los totales, pero no se asignan a escenarios.
- «mecanismo probado; verificación en ruta real pendiente (C17)»: todas las pruebas del escenario llevan la marca `[política, ruta de prueba]` (compromiso C17).

## HU con pruebas

### HU0021 — Crear, modificar y desactivar las cuentas del personal y asignarles un rol (secretaría, Tesorería, psicóloga, evaluador académico o Directora)

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
|  |  | Frontend | `frontend/src/views/gestion/UsuariosRoles.test.ts` | HU0021-4.0 «Desactivar» pide confirmación; al confirmar la cuenta queda «Desactivado» y sin acciones | pasó |
|  |  | E2E | `e2e/acceso-personal.spec.ts` | HU0021-4.0 una cuenta desactivada ve en G01 el mensaje de Keycloak y no entra | pasó |
|  |  | E2E | `e2e/personal-api.spec.ts` | HU0021-4.0 tras desactivar, Keycloak la deja deshabilitada y sin sesiones, el login es rechazado y la lista la muestra inactiva | pasó |
|  |  | E2E | `e2e/usuarios-roles.spec.ts` | HU0021-4.0 la directora desactiva la cuenta en G10: su sesión abierta se cierra, no puede volver a entrar y G10 la muestra «Desactivado» | pasó |

## HU sin pruebas

| HU | Escenario | Estado |
|---|---|---|
| HU0001 | HU0001-1.0 — Registro exitoso de solicitud de información con consentimiento | sin prueba |
| HU0001 | HU0001-2.0 — Intento de registro con datos obligatorios incompletos o erróneos | sin prueba |
| HU0001 | HU0001-3.0 — Intento de registro sin consentimiento | sin prueba |
| HU0002 | HU0002-1.0 — Despacho exitoso de la carpeta informativa automatizada | sin prueba |
| HU0002 | HU0002-2.0 — Falla en el despacho por rebote de correo electrónico | sin prueba |
| HU0003 | HU0003-1.0 — Reserva exitosa de visita guiada presencial | sin prueba |
| HU0003 | HU0003-2.0 — Intento de reserva en un horario tomado simultáneamente | sin prueba |
| HU0004 | HU0004-1.0 — Registro de visita conforme y apertura de postulación | sin prueba |
| HU0004 | HU0004-2.0 — Registro de inasistencia a la visita guiada | sin prueba |
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
| HU0022 | HU0022-1.0 — Configuración de un grado de la campaña | sin prueba |
| HU0022 | HU0022-2.0 — Intento de fijar menos vacantes que las ya adjudicadas | sin prueba |
| HU0023 | HU0023-1.0 — Primer ingreso con credenciales temporales | sin prueba |
| HU0023 | HU0023-2.0 — Bloqueo por intentos fallidos de ingreso | sin prueba |
| HU0024 | HU0024-1.0 — Validación conforme del derecho de admisión | sin prueba |
| HU0024 | HU0024-2.0 — Observación del comprobante del derecho de admisión | sin prueba |
| HU0025 | HU0025-1.0 — Registro del resultado de la evaluación académica | sin prueba |
| HU0025 | HU0025-2.0 — Registro de inasistencia a la evaluación académica | sin prueba |
