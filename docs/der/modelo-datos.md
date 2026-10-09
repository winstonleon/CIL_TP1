# Modelo de datos — Sistema de tramitación de admisión (DBML) · v1.1

> **v1.1 (08/10/2026).** Incorpora las decisiones del equipo tras la revisión cruzada con los mockups y el backlog: autenticación con Keycloak, DNI cifrado, apellidos separados del postulante, autorización de WhatsApp, condición laboral por apoderado, documentos por apoderado, documento vigente, asistentes a la visita, nuevos estados del expediente y catálogo de eventos de auditoría. El detalle está en la sección 8.

> **Instrucciones para la IA que lea este archivo**
>
> 1. Este archivo es la especificación del modelo de datos de un sistema de tramitación del proceso de admisión de un colegio privado de Lima (Inicial, Primaria y Secundaria).
> 2. La fuente de verdad es el bloque DBML de la sección 3. Las secciones 4 a 7 explican lo que DBML no puede expresar: las reglas de negocio, los datos semilla y los puntos pendientes.
> 3. Las entidades, atributos, claves y cardinalidades provienen del diagrama entidad-relación aprobado (19 entidades). En cambio, **los tipos de datos y los valores de los enums son una propuesta** para PostgreSQL y aún no los ha validado el equipo. Si generas código que dependa de un valor de enum, avísalo.
> 4. No inventes tablas ni columnas. Si una funcionalidad necesita un dato que no está aquí, indícalo como brecha en lugar de agregarlo en silencio.

---

## 1. Contexto técnico

| Capa | Tecnología | Relación con los datos |
|---|---|---|
| Base de datos | PostgreSQL (una única base de datos lógica, no una por servicio) | Implementa este modelo |
| Identidad | Keycloak (autoalojado, OIDC) | Guarda las credenciales, las contraseñas temporales, el bloqueo por intentos fallidos y la recuperación de acceso. **La BD de admisión no guarda contraseñas**: solo el `keycloak_user_id` de cada cuenta |
| Capa de servicios | API REST en Node.js con Express.js | **Es el único componente que lee y escribe en la BD.** Valida los tokens de Keycloak y concentra la autorización por rol, el cifrado de columnas y la auditoría |
| Orquestación | n8n autoalojado (7 flujos) | **No accede directamente a la BD**: lee y escribe a través de la API (webhooks internos y API REST) |
| Interfaz | Vue (portal de familias + gestión interna) | Consume la API REST |
| Despliegue | Docker Compose en un VPS; la BD y n8n solo están en la red interna de Docker | — |

Las 19 entidades se agrupan en 5 dominios:

| Dominio | Entidades |
|---|---|
| Familia y postulante | Apoderado, Postulante, Postulante_Apoderado, Consentimiento, Cuenta_Acceso |
| Expediente y requisitos | Expediente, Grado, Requisito_Documental, Documento, Cuestionario_Expectativas |
| Evaluación | Horario_Disponible, Cita, Resultado_Evaluacion, Dictamen_Admision |
| Pagos y resultado | Pago, Carta_Vacante |
| Trazabilidad y seguridad | Notificacion, Registro_Auditoria, Personal |

---

## 2. Convenciones

- Los nombres de tablas y columnas se usan tal como aparecen en el DER, en español, sin tildes y en `snake_case` (las tablas con mayúscula inicial).
- Las claves primarias son `integer` autoincrementales (`serial`), salvo en la tabla puente `Postulante_Apoderado`, que tiene PK compuesta.
- `UK` en el DER equivale aquí a `unique`.
- Las FK marcadas como «opcional» en el DER son columnas que admiten nulos (sin `not null`).
- Las fechas con hora usan `timestamptz` (zona horaria America/Lima en la aplicación).
- Los montos están en soles (PEN) y usan `numeric(10,2)`.

---

## 3. Esquema DBML

```dbml
Project admision_colegio {
  database_type: 'PostgreSQL'
  Note: 'Sistema de tramitación del proceso de admisión. 19 entidades. Tipos y enums: propuesta pendiente de validación.'
}

// =====================================================================
// ENUMS (propuesta; los valores de tipo_cita sí provienen del DER)
// =====================================================================

Enum nivel_educativo {
  inicial
  primaria
  secundaria
}

Enum estado_expediente {
  prospecto            [note: 'solicitó información; aún no postula']
  contacto_no_entregado [note: 'rebotó el correo con la carpeta informativa (HU0002-2.0); secretaría corrige datos y reenvía (G04)']
  no_desea_postular    [note: 'asistió a la visita y no desea postular por ahora (G04)']
  visita_agendada
  portal_habilitado    [note: 'asistió a la visita y se le enviaron credenciales']
  en_postulacion       [note: 'llenando la ficha y cargando documentos']
  incompleto           [note: 'el sistema detectó documentos faltantes']
  en_validacion        [note: 'tres validaciones en paralelo']
  en_evaluacion
  en_observacion       [note: 'dictamen En observación; requisitos complementarios']
  no_apto
  apto
  lista_espera
  vacante_asignada
  carta_emitida        [note: 'estado final exitoso']
  caducado             [note: 'venció el plazo máximo de una etapa']
}

Enum estado_revision {
  pendiente
  en_revision
  conforme
  observado
}

Enum categoria_requisito {
  postulante_y_padres
  colegio_procedencia
  financiero            [note: 'documentación financiera de los padres; visible SOLO para el rol tesoreria']
  condicion_especial    [note: 'informes de terapia o condición especial']
}

Enum condicion_aplicacion {
  todos
  solo_colegio_peruano     [note: 'se exige si Postulante.estudio_en_colegio_peruano = true']
  solo_condicion_especial  [note: 'se exige si Postulante.tiene_condicion_especial = true']
  si_dependiente           [note: 'se exige a cada apoderado con condicion_laboral = dependiente (requiere por_apoderado = true)']
  si_independiente         [note: 'se exige a cada apoderado con condicion_laboral = independiente (requiere por_apoderado = true)']
}

Enum condicion_laboral {
  dependiente     [note: 'boletas de pago de los últimos 3 meses']
  independiente   [note: 'recibos por honorarios y declaración jurada anual']
}

Enum tipo_cita {
  visita
  jornada_observacion
  evaluacion_psicologica
  evaluacion_academica
  entrevista_padres
}

Enum estado_cita {
  reservada
  confirmada
  asistio
  no_asistio
  reprogramada
  cancelada
}

Enum tipo_dictamen {
  apto
  en_observacion
  no_apto
}

Enum tipo_pago {
  derecho_admision   [note: 'S/ 300, pago único']
  cuota_ingreso      [note: 'monto según Grado.monto_cuota_ingreso; único o fraccionado']
}

Enum modalidad_pago {
  unico
  fraccionado
}

Enum canal_notificacion {
  correo
  whatsapp
}

Enum estado_envio {
  pendiente
  enviado
  fallido
}

Enum rol_personal {
  secretaria
  directora
  psicologa
  evaluador_academico
  tesoreria
}

// =====================================================================
// DOMINIO: FAMILIA Y POSTULANTE
// =====================================================================

Table Apoderado {
  id_apoderado serial [pk]
  dni_cifrado text [note: 'DNI o CE cifrado con AES-256-GCM en la API. Nulo hasta la ficha (P05b): P01 no lo pide']
  dni_hash varchar(64) [unique, note: 'HMAC-SHA256 del DNI normalizado; garantiza la unicidad sin descifrar']
  nombres varchar(100) [not null]
  apellidos varchar(100) [not null, note: 'un solo campo, como en P01 y P05b']
  telefono varchar(20) [not null]
  correo varchar(150) [not null]
  condicion_laboral condicion_laboral [note: 'se declara en P05b; determina los requisitos financieros (R7)']
  Note: 'Padre, madre o apoderado. Se crea desde el formulario de solicitud de información (P01), solo si hay consentimiento. CHECK: dni_cifrado y dni_hash son ambos nulos o ambos no nulos.'
}

Table Consentimiento {
  id_consentimiento serial [pk]
  id_apoderado integer [not null]
  version_politica varchar(20) [not null, note: 'versión de la política de privacidad aceptada']
  fecha_hora_aceptacion timestamptz [not null, default: `now()`]
  canal_origen varchar(30) [not null, note: 'p. ej. formulario_web, facebook, instagram']
  autoriza_whatsapp boolean [not null, default: false, note: 'casilla opcional de P01 (HU0001-1.0); sin ella no se envía nada por WhatsApp']
  Note: 'Evidencia del consentimiento (Ley N.° 29733 y DS 016-2024-JUS). Registro histórico: no se actualiza; ante una nueva versión de la política se inserta otra fila.'
}

Table Cuenta_Acceso {
  id_cuenta serial [pk]
  id_apoderado integer [not null, unique, note: 'relación 1:0..1 con Apoderado']
  keycloak_user_id uuid [unique, not null, note: 'id del usuario en el realm de Keycloak (rol familia)']
  fecha_creacion timestamptz [not null, default: `now()`]
  Note: 'Vínculo entre el Apoderado y su usuario de Keycloak. Se crea cuando secretaría registra la asistencia a la visita y el interés en postular (G04): la API crea el usuario en Keycloak con contraseña temporal y la acción requerida de cambiarla (P03b). Usuario, contraseña, bloqueo (P03c) y recuperación viven en Keycloak.'
}

Table Postulante {
  id_postulante serial [pk]
  dni_cifrado text [note: 'cifrado con AES-256-GCM en la API']
  dni_hash varchar(64) [unique, note: 'HMAC-SHA256 del DNI normalizado']
  nombres varchar(100)
  apellido_paterno varchar(100)
  apellido_materno varchar(100)
  fecha_nacimiento date
  ficha_completa boolean [not null, default: false, note: 'false = borrador (HU0005-2.0). Pasa a true con "Guardar y continuar" en P05']
  estudio_en_colegio_peruano boolean [not null, default: false, note: 'activa los requisitos de colegio de procedencia']
  colegio_procedencia varchar(150)
  tiene_condicion_especial boolean [not null, default: false, note: 'activa los requisitos de informes de terapia']
  Note: 'Menor que postula. Dato personal de menor de edad: tratamiento restringido. Los campos admiten nulos mientras la ficha es borrador. CHECK: si ficha_completa = true, dni_cifrado, dni_hash, nombres, apellido_paterno, apellido_materno y fecha_nacimiento no son nulos.'
}

Table Postulante_Apoderado {
  id_postulante integer [not null]
  id_apoderado integer [not null]
  parentesco varchar(30) [not null, note: 'padre, madre, apoderado u otro']
  indexes {
    (id_postulante, id_apoderado) [pk]
  }
  Note: 'Relación N:M entre postulantes y apoderados (un menor puede tener padre y madre registrados).'
}

// =====================================================================
// DOMINIO: EXPEDIENTE Y REQUISITOS
// =====================================================================

Table Grado {
  id_grado serial [pk]
  nivel nivel_educativo [not null]
  nombre_grado varchar(50) [not null, note: 'p. ej. 3 años, Kindergarten, 1.° de primaria']
  campana_admision varchar(10) [not null, note: 'p. ej. 2027']
  vacantes_autorizadas integer [not null]
  vacantes_disponibles integer [not null]
  requiere_jornada_observacion boolean [not null, default: false]
  requiere_evaluacion_psicologica boolean [not null, default: false]
  requiere_evaluacion_academica boolean [not null, default: false]
  monto_cuota_ingreso numeric(10,2) [not null]
  max_fracciones smallint [not null, default: 1, note: 'valor por definir con el colegio']
  indexes {
    (nombre_grado, campana_admision) [unique]
  }
  Note: 'Configuración de la campaña por grado (pantalla G09, rol secretaria). CHECK: 0 <= vacantes_disponibles <= vacantes_autorizadas; max_fracciones >= 1.'
}

Table Requisito_Documental {
  id_requisito serial [pk]
  id_grado integer [not null]
  tipo_documento varchar(80) [not null, note: 'p. ej. partida_nacimiento, dni_postulante, libreta_notas, boleta_pago_padre']
  categoria categoria_requisito [not null]
  condicion_aplicacion condicion_aplicacion [not null, default: 'todos']
  obligatorio boolean [not null, default: true]
  por_apoderado boolean [not null, default: false, note: 'true = se exige a cada apoderado del postulante (p. ej. boletas); cada archivo se asocia a un apoderado en Documento.id_apoderado']
  indexes {
    (id_grado, tipo_documento) [unique]
  }
  Note: 'Qué documentos exige cada grado y bajo qué condición (G09). CHECK: si condicion_aplicacion es si_dependiente o si_independiente, por_apoderado = true.'
}

Table Expediente {
  id_expediente serial [pk]
  id_apoderado_titular integer [not null]
  id_postulante integer [note: 'opcional: nulo mientras la familia es prospecto y aún no registró la ficha']
  id_grado integer [not null, note: 'grado de interés o de postulación']
  fecha_registro timestamptz [not null, default: `now()`]
  estado estado_expediente [not null, default: 'prospecto']
  estado_documental estado_revision [not null, default: 'pendiente', note: 'rama de validación documental (secretaria)']
  estado_financiero estado_revision [not null, default: 'pendiente', note: 'rama de documentación financiera (tesoreria)']
  modalidad_pago_cuota modalidad_pago
  numero_fracciones smallint [note: '<= Grado.max_fracciones']
  posicion_lista_espera integer [note: 'solo si estado = lista_espera']
  Note: 'Entidad central: una postulación de un menor a un grado en una campaña. Código visible al usuario: ADM-<campaña>-<id con 4 dígitos>.'
}

Table Cuestionario_Expectativas {
  id_cuestionario serial [pk]
  id_expediente integer [not null, unique, note: 'relación 1:0..1 con Expediente']
  respuestas jsonb [not null, note: 'estructura de preguntas abierta']
  es_borrador boolean [not null, default: true, note: 'guardado automático (P05)']
  fecha_actualizacion timestamptz [not null, default: `now()`]
}

Table Documento {
  id_documento serial [pk]
  id_expediente integer [not null]
  id_requisito integer [not null]
  id_personal_revisor integer [note: 'opcional: nulo hasta que alguien lo revise']
  id_apoderado integer [note: 'obligatorio si el requisito es por_apoderado: indica de qué padre es el documento']
  url_archivo varchar(500) [not null, note: 'ruta en el almacenamiento documental (Google Drive)']
  formato varchar(10) [not null, note: 'pdf, jpg, png']
  tamano_kb integer [not null]
  fecha_carga timestamptz [not null, default: `now()`]
  estado_verificacion estado_revision [not null, default: 'pendiente']
  motivo_observacion text [note: 'obligatorio si estado_verificacion = observado; lo recibe la familia']
  vigente boolean [not null, default: true, note: 'false = reemplazado por una subsanación; queda como historial']
  Note: 'Archivo cargado por la familia para cumplir un requisito. Un requisito puede tener varios archivos vigentes (p. ej. 3 boletas). Una subsanación inserta la fila nueva y marca vigente = false en la reemplazada, en la misma transacción.'
}

// =====================================================================
// DOMINIO: EVALUACIÓN
// =====================================================================

Table Horario_Disponible {
  id_horario serial [pk]
  id_personal integer [not null, note: 'responsable: directora (visita), psicologa o evaluador_academico']
  tipo_cita tipo_cita [not null]
  fecha date [not null]
  hora_inicio time [not null]
  hora_fin time [not null]
  cupos smallint [not null, default: 1, note: 'la visita guiada es individual en este colegio']
  campana_admision varchar(10) [not null]
  Note: 'Turnos que ofrece el personal. CHECK: hora_fin > hora_inicio; cupos >= 0.'
}

Table Cita {
  id_cita serial [pk]
  id_expediente integer [not null]
  id_personal integer [not null]
  id_horario integer [not null]
  tipo_cita tipo_cita [not null]
  fecha_hora timestamptz [not null]
  estado estado_cita [not null, default: 'reservada']
  asistentes varchar(300) [note: 'solo para tipo_cita = visita: nombres de los asistentes (HU0003-1.0, P02 y G04)']
  indexes {
    (id_personal, fecha_hora) [unique, name: 'uq_cita_personal_fecha', note: 'evita la doble reserva del mismo responsable']
  }
}

Table Resultado_Evaluacion {
  id_resultado serial [pk]
  id_cita integer [not null, unique, note: 'relación 1:0..1 con Cita']
  id_personal integer [not null]
  tipo_evaluacion tipo_cita [not null, note: 'cualquier valor de tipo_cita excepto visita']
  resultado varchar(50) [not null, note: 'escala por definir; puede ser inasistencia']
  observaciones text
  informe_url varchar(500) [note: 'informe psicopedagógico: CONFIDENCIAL, solo para psicologa y directora']
  fecha_registro timestamptz [not null, default: `now()`]
  Note: 'Resultado de cada evaluación parcial (observación, psicológica, académica o entrevista).'
}

Table Dictamen_Admision {
  id_dictamen serial [pk]
  id_expediente integer [not null, unique, note: 'un solo dictamen vigente por expediente (1:0..1)']
  id_personal integer [not null, note: 'rol psicologa']
  dictamen tipo_dictamen [not null]
  conclusiones text
  informe_url varchar(500)
  fecha_emision timestamptz [not null, default: `now()`]
  Note: 'Decisión final de la evaluación. Si dictamen = en_observacion y luego cambia, se actualiza esta fila y el cambio queda en Registro_Auditoria.'
}

// =====================================================================
// DOMINIO: PAGOS Y RESULTADO
// =====================================================================

Table Pago {
  id_pago serial [pk]
  id_expediente integer [not null]
  id_personal_validador integer [note: 'opcional: nulo hasta la validación de tesoreria']
  tipo_pago tipo_pago [not null]
  numero_fraccion smallint [not null, default: 1, note: '1 = pago único o primera fracción']
  numero_operacion varchar(40) [unique, not null, note: 'impide registrar dos veces el mismo comprobante']
  banco varchar(60) [not null]
  monto numeric(10,2) [not null]
  fecha_pago date [not null]
  comprobante_url varchar(500) [not null]
  estado_validacion estado_revision [not null, default: 'pendiente']
  motivo_observacion text
  indexes {
    (id_expediente, tipo_pago, numero_fraccion) [unique]
  }
  Note: 'Comprobantes registrados por la familia (no hay pasarela de pagos en línea). CHECK: monto > 0; numero_fraccion >= 1.'
}

Table Carta_Vacante {
  id_carta serial [pk]
  id_expediente integer [not null, unique, note: 'relación 1:0..1 con Expediente']
  id_personal_autoriza integer [not null, note: 'rol directora; su firma escaneada va en el PDF']
  fecha_emision timestamptz [not null, default: `now()`]
  url_documento varchar(500) [not null, note: 'PDF generado por n8n desde una plantilla']
}

// =====================================================================
// DOMINIO: TRAZABILIDAD Y SEGURIDAD
// =====================================================================

Table Notificacion {
  id_notificacion serial [pk]
  id_expediente integer [not null]
  canal canal_notificacion [not null]
  tipo_evento varchar(60) [not null, note: 'p. ej. carpeta_enviada, documento_observado, recordatorio_48h, carta_emitida']
  fecha_envio timestamptz [not null, default: `now()`]
  estado_envio estado_envio [not null, default: 'pendiente']
}

Table Registro_Auditoria {
  id_evento bigserial [pk]
  id_expediente integer [note: 'opcional: hay eventos sin expediente, p. ej. inicio de sesión o cambios de configuración']
  id_personal integer [note: 'opcional: nulo si el actor es la familia o el sistema (n8n)']
  tipo_evento varchar(60) [not null, note: 'valores del catálogo de la sección 4.7']
  estado_anterior varchar(40)
  estado_nuevo varchar(40)
  fecha_hora timestamptz [not null, default: `now()`]
  detalle jsonb
  Note: 'Bitácora de solo inserción (sin UPDATE ni DELETE). Fuente para calcular el lead time y el cycle time por etapa y para la minería de procesos.'
}

Table Personal {
  id_personal serial [pk]
  nombres varchar(100) [not null]
  apellidos varchar(100) [not null]
  rol rol_personal [not null]
  correo varchar(150) [unique, not null]
  keycloak_user_id uuid [unique, not null, note: 'id del usuario en el realm de Keycloak; su rol de realm coincide con Personal.rol']
  activo boolean [not null, default: true, note: 'las cuentas se desactivan, no se eliminan; se sincroniza con enabled de Keycloak']
  Note: 'Usuarios internos. Los crea y desactiva el rol directora (G10). La API crea el usuario en Keycloak y Keycloak le envía el enlace para definir su contraseña (G01).'
}

// =====================================================================
// RELACIONES (28). Notación DBML: ">" muchos-a-uno, "-" uno-a-uno.
// =====================================================================

// Familia y postulante
Ref: Consentimiento.id_apoderado > Apoderado.id_apoderado             // Apoderado otorga 1:N Consentimiento
Ref: Cuenta_Acceso.id_apoderado - Apoderado.id_apoderado              // Apoderado accede con 1:0..1 Cuenta_Acceso
Ref: Postulante_Apoderado.id_apoderado > Apoderado.id_apoderado       // 1:N
Ref: Postulante_Apoderado.id_postulante > Postulante.id_postulante    // 1:N

// Expediente
Ref: Expediente.id_apoderado_titular > Apoderado.id_apoderado         // titular de 1:N
Ref: Expediente.id_postulante > Postulante.id_postulante              // postula en 1:N
Ref: Expediente.id_grado > Grado.id_grado                             // postula a 1:N
Ref: Requisito_Documental.id_grado > Grado.id_grado                   // exige 1:N
Ref: Cuestionario_Expectativas.id_expediente - Expediente.id_expediente // incluye 1:0..1
Ref: Documento.id_expediente > Expediente.id_expediente               // contiene 1:N
Ref: Documento.id_requisito > Requisito_Documental.id_requisito       // cumplido por 1:N
Ref: Documento.id_apoderado > Apoderado.id_apoderado                  // pertenece a 1:N (solo requisitos por_apoderado)

// Evaluación
Ref: Cita.id_expediente > Expediente.id_expediente                    // agenda 1:N
Ref: Cita.id_horario > Horario_Disponible.id_horario                  // reservado en 1:N
Ref: Resultado_Evaluacion.id_cita - Cita.id_cita                      // genera 1:0..1
Ref: Dictamen_Admision.id_expediente - Expediente.id_expediente       // se decide en 1:0..1

// Pagos y resultado
Ref: Pago.id_expediente > Expediente.id_expediente                    // registra 1:N
Ref: Carta_Vacante.id_expediente - Expediente.id_expediente           // resuelve en 1:0..1

// Trazabilidad
Ref: Notificacion.id_expediente > Expediente.id_expediente            // genera 1:N
Ref: Registro_Auditoria.id_expediente > Expediente.id_expediente      // trazado en 1:N

// Personal
Ref: Documento.id_personal_revisor > Personal.id_personal             // revisa 1:N
Ref: Cita.id_personal > Personal.id_personal                          // atiende 1:N
Ref: Resultado_Evaluacion.id_personal > Personal.id_personal          // registra 1:N
Ref: Dictamen_Admision.id_personal > Personal.id_personal             // emite 1:N
Ref: Pago.id_personal_validador > Personal.id_personal                // valida 1:N
Ref: Carta_Vacante.id_personal_autoriza > Personal.id_personal        // autoriza 1:N
Ref: Registro_Auditoria.id_personal > Personal.id_personal            // ejecuta 1:N
Ref: Horario_Disponible.id_personal > Personal.id_personal            // ofrece 1:N
```

---

## 4. Reglas de negocio que el esquema no expresa por sí solo

Cada regla indica dónde debe aplicarse: en la **BD** (restricción, trigger o CHECK), en la **API** (Node.js/Express) o en **n8n** (flujo de orquestación).

### 4.1 Protección de datos (Ley N.° 29733 y DS 016-2024-JUS)
| # | Regla | Dónde |
|---|---|---|
| R1 | Sin consentimiento no se almacena ningún dato. Apoderado, Consentimiento y Expediente se crean en una sola transacción, y solo si el usuario marcó la casilla de consentimiento. La autorización de WhatsApp es opcional e independiente (`Consentimiento.autoriza_whatsapp`). | API |
| R2 | Los documentos con `Requisito_Documental.categoria = 'financiero'` solo los ven y validan los usuarios con rol `tesoreria`. Para los demás roles, la API no devuelve ni la URL ni el contenido. | API |
| R3 | Los informes psicopedagógicos (`Resultado_Evaluacion.informe_url`, `Dictamen_Admision.informe_url`) solo los ven `psicologa` y `directora`. | API |
| R4 | Ni la BD ni n8n se exponen fuera de la red interna. n8n lee y escribe a través de la API. | Infraestructura |
| R5 | La BD de admisión no guarda contraseñas. Keycloak gestiona credenciales, contraseña temporal con cambio obligatorio (P03b), bloqueo tras 5 intentos fallidos (P03c) y recuperación. | Keycloak |
| R5b | Los DNI se cifran en la API (AES-256-GCM) antes de escribirse; la unicidad se controla con `dni_hash`. La clave nunca está en la BD ni en n8n. | API |

### 4.2 Flujo del expediente
| # | Regla | Dónde |
|---|---|---|
| R6 | **Toda** transición de `Expediente.estado`, `estado_documental` o `estado_financiero` inserta una fila en `Registro_Auditoria` con `estado_anterior` y `estado_nuevo`. Registro_Auditoria es solo de inserción. | API (o trigger en BD) |
| R7 | Lista de documentos exigidos para un expediente = filas de `Requisito_Documental` del grado donde `condicion_aplicacion = 'todos'`, más las de `'solo_colegio_peruano'` si `Postulante.estudio_en_colegio_peruano`, más las de `'solo_condicion_especial'` si `Postulante.tiene_condicion_especial`. Los requisitos con `por_apoderado = true` se exigen **una vez por cada apoderado** del postulante (`Postulante_Apoderado`); los de `'si_dependiente'` o `'si_independiente'`, solo a los apoderados con esa `condicion_laboral`. Solo cuentan los documentos con `vigente = true`. | API / n8n |
| R8 | Verificación de completitud: si falta algún documento obligatorio, el estado pasa a `incompleto` y se notifica qué falta. Si está completo, el expediente pasa a `en_validacion`. | n8n |
| R9 | Las **tres validaciones son paralelas e independientes**: documental (`estado_documental`, rol `secretaria`), derecho de admisión (Pago `derecho_admision`, rol `tesoreria`) y documentación financiera (`estado_financiero`, rol `tesoreria`). Cada una tiene su propio ciclo de observación y subsanación. Las evaluaciones se habilitan solo cuando las tres están `conforme`. | API / n8n |
| R10 | No se consultan centrales de riesgo. La revisión financiera es documental. | Alcance |

### 4.3 Evaluaciones
| # | Regla | Dónde |
|---|---|---|
| R11 | Evaluaciones exigidas según el grado (`Grado.requiere_*`): **Inicial** = jornada de observación; **1.° de primaria** = evaluación psicológica; **2.° de primaria en adelante y Secundaria** = evaluación psicológica + evaluación académica, en paralelo. **Todos** = entrevista a los padres al final. | Datos semilla + API |
| R12 | No puede haber dos citas del mismo responsable a la misma fecha y hora (índice único `uq_cita_personal_fecha`). Al reservar se descuenta `Horario_Disponible.cupos` dentro de la misma transacción. | BD + API |
| R13 | El dictamen lo emite la `psicologa` después de la entrevista a los padres. Si es `en_observacion`, secretaría coordina requisitos complementarios y luego se emite un nuevo dictamen. Si es `no_apto`, se notifica y el proceso termina. | API / n8n |

### 4.4 Vacantes, pagos y carta
| # | Regla | Dónde |
|---|---|---|
| R14 | Solo la `directora` asigna vacantes, y solo a expedientes con dictamen `apto`. Asignar una vacante descuenta 1 de `Grado.vacantes_disponibles`; si es 0, el expediente pasa a `lista_espera` con su `posicion_lista_espera`. | API |
| R15 | `Grado.vacantes_autorizadas` no puede fijarse por debajo del número de vacantes ya adjudicadas (pantalla G09). | API |
| R16 | Derecho de admisión: S/ 300, un solo pago (`numero_fraccion = 1`). | API |
| R17 | Cuota de ingreso: `Grado.monto_cuota_ingreso` (S/ 7000 en Inicial y Primaria, S/ 4000 en Secundaria), en pago único o fraccionado hasta `Grado.max_fracciones`. | API |
| R18 | **Disparador de la carta:** cuando un Pago con `tipo_pago = 'cuota_ingreso'`, `numero_fraccion = 1` y `estado_validacion = 'conforme'` queda conciliado, n8n genera automáticamente la Carta de Vacante en PDF con la firma escaneada de la Directora, la envía a la familia y el expediente pasa a `carta_emitida`. Las fracciones posteriores no generan una nueva carta. | n8n |
| R19 | `numero_operacion` es único en toda la tabla, de modo que un comprobante no puede registrarse dos veces. | BD |

### 4.5 Seguimiento programado (flujo diario de n8n)
| # | Regla | Dónde |
|---|---|---|
| R20 | Cada día se revisan los expedientes con una acción pendiente de la familia. Si no hubo interacción en **48 horas**, se envía un recordatorio por correo y, solo si la familia lo autorizó y el canal está activo, por WhatsApp (se inserta en `Notificacion` con `tipo_evento = 'recordatorio_48h'`). | n8n |
| R21 | Si venció el **plazo máximo** de la etapa, el expediente pasa a `caducado`, se liberan los cupos o la vacante que tenía reservados y se notifica a la familia. | n8n |
| R22 | Toda comunicación enviada se registra en `Notificacion`, también los envíos fallidos (`estado_envio = 'fallido'`). Si WhatsApp no está autorizado o el canal está desactivado, no se crea fila para ese canal. Un rebote del correo de la carpeta informativa pasa el expediente a `contacto_no_entregado` (HU0002-2.0). | n8n |

### 4.6 Permisos por rol (resumen)
| Rol | Puede |
|---|---|
| `secretaria` | Ver la bandeja de expedientes completos, validar u observar documentos no financieros, registrar asistencia a visitas (lo que crea la Cuenta_Acceso), configurar la campaña (Grado, Requisito_Documental, Horario_Disponible) |
| `tesoreria` | Validar pagos y la documentación financiera |
| `psicologa` | Registrar resultados de observación, evaluación psicológica y entrevista; emitir el dictamen |
| `evaluador_academico` | Registrar el resultado o la inasistencia en la evaluación académica |
| `directora` | Asignar vacantes, ver el tablero de indicadores, crear y desactivar usuarios del Personal; autoriza la carta (firma) |
| Familia (Cuenta_Acceso) | Solo sus propios expedientes: ficha, cuestionario, documentos, pagos y citas |

---

### 4.7 Catálogo de eventos de auditoría y medición del tiempo de atención
`Registro_Auditoria.tipo_evento` solo admite estos valores (el detalle va en `detalle`):

| tipo_evento | Cuándo se registra | Actor |
|---|---|---|
| `transicion_estado` | Cambio de `Expediente.estado`, `estado_documental` o `estado_financiero` (R6); lleva `estado_anterior` y `estado_nuevo` | Personal, familia o sistema |
| `atencion_inicio` | El personal **abre** un ítem para atenderlo: detalle del expediente (G03), pago o documentación financiera (G05), cita o dictamen (G06), evaluación académica (G11), postulante apto (G07). `detalle` indica el ítem | Personal |
| `atencion_fin` | El personal **registra su decisión** sobre ese ítem: conforme, observado, resultado, inasistencia, dictamen o asignación de vacante | Personal |
| `acceso_denegado` | Intento de ver datos restringidos por rol (HU0021-2.0) | Personal |
| `inicio_sesion` | Inicio de sesión exitoso (para «Último acceso» en G10) | Personal o familia |
| `cambio_configuracion` | Cambios en Grado, Requisito_Documental u Horario_Disponible | Secretaría |
| `gestion_usuario` | Alta, cambio, desactivación o reactivación de Personal | Directora |
| `notificacion_rebotada` | Rebote del correo de un prospecto | Sistema |

**Medición (OE3, HU0019).** *Lead time* = de la creación del expediente a `carta_emitida`. *Cycle time* de una etapa = suma de los intervalos entre cada `atencion_inicio` y su `atencion_fin` correspondiente en esa etapa. Supuesto aceptado: si alguien abre un ítem y lo deja abierto, el cycle time se sobreestima; un `atencion_inicio` sin `atencion_fin` en 8 horas no se cuenta.

---

## 5. Datos semilla de referencia (campaña 2027)

| nivel | nombre_grado | jornada_obs. | psicológica | académica | cuota (S/) |
|---|---|---|---|---|---|
| inicial | 3 años | ✔ | — | — | 7000 |
| inicial | 4 años | ✔ | — | — | 7000 |
| inicial | Kindergarten (5 años) | ✔ | — | — | 7000 |
| primaria | 1.° de primaria | — | ✔ | — | 7000 |
| primaria | 2.° a 6.° de primaria | — | ✔ | ✔ | 7000 |
| secundaria | 1.° a 5.° de secundaria | — | ✔ | ✔ | 4000 |

La entrevista a los padres aplica a todos los grados, por lo que no tiene una columna `requiere_*`.

---

## 6. Flujos de n8n y tablas que tocan (siempre a través de la API)

| Flujo | Disparador | Tablas principales |
|---|---|---|
| F1 Captación | Webhook: formulario P01 | Apoderado, Consentimiento, Expediente, Notificacion |
| F2 Recepción y registro | Webhook: ficha/documentos | Postulante, Postulante_Apoderado, Cuestionario_Expectativas, Documento |
| F3 Verificación de completitud | Webhook: carga de documento | Documento, Requisito_Documental, Expediente |
| F4 Agendamiento | Webhook: reserva de cita | Horario_Disponible, Cita, Notificacion |
| F5 Generación de carta | Webhook: pago conciliado (R18) | Pago, Carta_Vacante, Expediente |
| F6 Notificación multicanal | Invocado por los demás flujos | Notificacion |
| F7 Seguimiento y recordatorios | Programado diario | Expediente, Notificacion, Registro_Auditoria |

---

## 7. Pendientes y supuestos (no inventar valores)

- **Tipos de datos y enums:** son una propuesta. Solo los valores de `tipo_cita` y las reglas marcadas en las notas del DER provienen del diseño aprobado.
- **Por definir con el colegio:**
  - `Grado.max_fracciones` y el calendario de las fracciones.
  - La escala de `Resultado_Evaluacion.resultado` para la evaluación académica.
  - El plazo máximo por etapa (R21).
  - Los horarios de visitas y evaluaciones.
  - El número de vacantes por grado.
- **Fuera de alcance (no modelar):**
  - La consulta a centrales de riesgo.
  - La pasarela de pagos en línea.
  - El cálculo de devoluciones de la cuota.
  - El registro del admitido en SIEWEB o SIAGIE (el sistema académico existente no se integra ni se modifica).
- **Almacenamiento de archivos:** las columnas `*_url` apuntan a Google Drive. La BD guarda la referencia, no el archivo.
- **Por definir con el colegio (v1.1):** la política de contraseñas y el tiempo de bloqueo en Keycloak (P03b, P03c).
- **Datos derivados, sin columna propia:** el código de la constancia de P07b (`CONST-<código del expediente>-<id_pago>`), la fecha de validación de un pago (P07) y el último acceso del personal (G10) se obtienen de `Registro_Auditoria`.

---

## 8. Historial de cambios

### v1.1 (08/10/2026): revisión cruzada con los mockups (23 pantallas) y el backlog
| Cambio | Motivo |
|---|---|
| `Apoderado.dni` y `Postulante.dni` → `dni_cifrado` + `dni_hash` | Cifrado por columna decidido por el equipo; `dni_hash` mantiene la unicidad |
| `Apoderado.dni_*` admite nulos | P01 no pide DNI; se completa en P05b |
| `Postulante.apellidos` → `apellido_paterno` + `apellido_materno` | Mockup P05 |
| `Postulante` admite nulos y agrega `ficha_completa` | Borrador de la ficha (HU0005-2.0) sin guardar el DNI en claro |
| `Consentimiento.autoriza_whatsapp` | HU0001-1.0 y HU0002-1.0; casilla opcional de P01 |
| `Apoderado.condicion_laboral` y enum `condicion_laboral` | P05b, P06, G05 y G09 |
| `condicion_aplicacion` + `si_dependiente`, `si_independiente`; `Requisito_Documental.por_apoderado`; `Documento.id_apoderado` | Requisitos financieros por cada padre (decisión 1A) |
| `Documento.vigente` | Varios archivos por requisito y subsanaciones |
| `Cita.asistentes` | HU0003-1.0, P02 y G04 |
| `estado_expediente` + `contacto_no_entregado`, `no_desea_postular` | HU0002-2.0 y G04 |
| `Cuenta_Acceso` reducida a `keycloak_user_id`; `Personal.hash_contrasena` → `keycloak_user_id`; se elimina el enum `estado_cuenta` | Autenticación con Keycloak (decisión 3A); se mantienen 19 entidades |
| Sección 4.7: catálogo de `tipo_evento` y definición de inicio y fin de atención | Medición del cycle time (HU0019, OE3; decisión 2A) |
| Regla R3 confirmada: la Directora ve el informe psicológico | G10 alineado con R3 |
