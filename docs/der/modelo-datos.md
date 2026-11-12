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
  incompleto           [note: 'sin uso: un expediente incompleto se mantiene en en_postulacion (HU0017-2.0, R8); el valor se conserva']
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
  estudio_en_colegio_peruano boolean [default: false, note: 'activa los requisitos de colegio de procedencia. Nulo = sin responder en el borrador (HU0005-2.0); la API exige true o false para completar la ficha. El DEFAULT false se conserva solo por compatibilidad; toda inserción debe escribir NULL explícito si la pregunta no se respondió. Lo protege HU0005-2.0.']
  colegio_procedencia varchar(150)
  tiene_condicion_especial boolean [default: false, note: 'activa los requisitos de informes de terapia. Nulo = sin responder en el borrador (HU0005-2.0); la API exige true o false para completar la ficha. El DEFAULT false se conserva solo por compatibilidad; toda inserción debe escribir NULL explícito si la pregunta no se respondió. Lo protege HU0005-2.0.']
  Note: 'Menor que postula. Dato personal de menor de edad: tratamiento restringido. Los campos admiten nulos mientras la ficha es borrador, también los dos boolean (nulo = sin responder). CHECK: si ficha_completa = true, dni_cifrado, dni_hash, nombres, apellido_paterno, apellido_materno y fecha_nacimiento no son nulos.'
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
  nombre_grado varchar(50) [not null, note: 'p. ej. 3 años, Kindergarten (5 años), 1.° de primaria (como en §5)']
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
  tipo_documento varchar(80) [not null, note: 'nombre visible del documento, tal como lo registra Secretaría en G09; p. ej. Partida de nacimiento, DNI del postulante, Boletas de pago (últimos 3 meses). Único por grado sin distinguir mayúsculas (ADR-14)']
  categoria categoria_requisito [not null]
  condicion_aplicacion condicion_aplicacion [not null, default: 'todos']
  obligatorio boolean [not null, default: true]
  por_apoderado boolean [not null, default: false, note: 'true = se exige a cada apoderado del postulante (p. ej. boletas); cada archivo se asocia a un apoderado en Documento.id_apoderado']
  indexes {
    (id_grado, tipo_documento) [unique]
    (id_grado, `lower(tipo_documento)`) [unique, name: 'uq_requisito_grado_tipo_minusculas', note: 'el mismo nombre con otras mayúsculas es el mismo requisito (HU0022)']
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
  url_archivo varchar(500) [not null, note: 'clave del archivo en el adaptador de almacenamiento (UUID aleatorio, no el nombre original; ADR-12 y ADR-21). El archivo se guarda cifrado y solo se descarga por la API']
  formato varchar(10) [not null, note: 'pdf, jpg, png']
  tamano_kb integer [not null]
  fecha_carga timestamptz [not null, default: `now()`]
  estado_verificacion estado_revision [not null, default: 'pendiente']
  motivo_observacion text [note: 'obligatorio si estado_verificacion = observado; lo recibe la familia']
  vigente boolean [not null, default: true, note: 'false = reemplazado por una subsanación; queda como historial']
  Note: 'Archivo cargado por la familia para cumplir un requisito. Un requisito puede tener varios archivos vigentes (p. ej. 3 boletas). Una subsanación inserta la fila nueva y marca vigente = false en la reemplazada, en la misma transacción. En en_validacion (HU0008-2.0 y HU0011-2.0) la familia solo reemplaza un documento vigente observado: la fila nueva queda pendiente, la reemplazada conserva su estado_verificacion y su motivo_observacion, y se registra subsanacion_registrada (§4.7). Cuando la rama ya no tiene documentos observados vigentes, estado_documental o estado_financiero vuelve de observado a pendiente.'
}

// =====================================================================
// DOMINIO: EVALUACIÓN
// =====================================================================

Table Horario_Disponible {
  id_horario serial [pk]
  id_personal integer [not null, note: 'responsable, cuenta activa con el rol del tipo de cita (ADR-15): directora (visita); psicologa (jornada de observación, evaluación psicológica y entrevista a los padres); evaluador_academico (evaluación académica)']
  tipo_cita tipo_cita [not null]
  fecha date [not null]
  hora_inicio time [not null]
  hora_fin time [not null]
  cupos smallint [not null, default: 1, note: 'la visita guiada es individual en este colegio']
  campana_admision varchar(10) [not null]
  Note: 'Turnos que ofrece el personal. CHECK: hora_fin > hora_inicio; cupos >= 0. La API rechaza un horario que se superpone con otro del mismo responsable en la misma fecha, en cualquier campaña (ADR-15).'
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
    (id_personal, fecha_hora) [unique, name: 'uq_cita_personal_fecha', note: 'evita la doble reserva del mismo responsable. Índice parcial (HU0009, C40): solo cuenta las citas activas (estado distinto de reprogramada y cancelada) y no la jornada de observación, que es grupal']
  }
  Note: 'Una reprogramación (HU0009-2.0) deja la cita anterior en reprogramada, devuelve su cupo e inserta la cita nueva en la misma transacción; el cambio queda en cita_reprogramada (§4.7).'
}

Table Resultado_Evaluacion {
  id_resultado serial [pk]
  id_cita integer [not null, unique, note: 'relación 1:0..1 con Cita']
  id_personal integer [not null]
  tipo_evaluacion tipo_cita [not null, note: 'cualquier valor de tipo_cita excepto visita']
  resultado varchar(50) [not null, note: 'escala por definir; puede ser inasistencia']
  observaciones text [note: 'cifrada en la API (AES-256-GCM, ADR-03), en todos los tipos de evaluación']
  informe_url varchar(500) [note: 'informe psicopedagógico: CONFIDENCIAL, solo para psicologa y directora']
  fecha_registro timestamptz [not null, default: `now()`]
  Note: 'Resultado de cada evaluación parcial (observación, psicológica, académica o entrevista). Lo registra el responsable de la cita (HU0010 y HU0025): la cita pasa a asistio, o a no_asistio con resultado = inasistencia (solo la evaluación académica, HU0025-2.0).'
}

Table Dictamen_Admision {
  id_dictamen serial [pk]
  id_expediente integer [not null, unique, note: 'un solo dictamen vigente por expediente (1:0..1)']
  id_personal integer [not null, note: 'rol psicologa']
  dictamen tipo_dictamen [not null]
  conclusiones text [note: 'cifrada en la API (AES-256-GCM, ADR-03); confidencial: solo psicologa y directora (R3)']
  requisitos_complementarios text [note: 'solo si dictamen = en_observacion (HU0010-2.0): qué debe presentar la familia. Cifrada en la API (ADR-03). La ven psicologa, directora y secretaria (que coordina con la familia, R13); no lleva las conclusiones']
  informe_url varchar(500)
  fecha_emision timestamptz [not null, default: `now()`]
  Note: 'Decisión final de la evaluación. Si dictamen = en_observacion y luego cambia, se actualiza esta fila y el cambio queda en Registro_Auditoria: el atencion_fin del nuevo dictamen guarda en detalle.dictamen_anterior el dictamen reemplazado, con sus columnas de texto ya cifradas (ADR-25).'
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
  numero_operacion varchar(40) [not null, note: 'único por banco (R19): impide registrar dos veces el mismo comprobante']
  banco varchar(60) [not null, note: 'de la lista cerrada de bancos de P07b (HU0007, ADR-21)']
  monto numeric(10,2) [not null]
  fecha_pago date [not null]
  comprobante_url varchar(500) [not null, note: 'clave del archivo en el adaptador de almacenamiento, como Documento.url_archivo (ADR-21)']
  estado_validacion estado_revision [not null, default: 'pendiente']
  motivo_observacion text
  indexes {
    (id_expediente, tipo_pago, numero_fraccion) [unique]
    (banco, numero_operacion) [unique, name: 'uq_pago_banco_numero_operacion', note: 'R19: el mismo número en otro banco es otro comprobante (HU0007-2.0)']
  }
  Note: 'Comprobantes registrados por la familia (no hay pasarela de pagos en línea). CHECK: monto > 0; numero_fraccion >= 1. Subsanación del derecho de admisión (HU0024-2.0, con el expediente en en_validacion) y de la cuota de ingreso (HU0015-2.0, con el expediente en vacante_asignada): con estado_validacion = observado, la familia registra el comprobante nuevo en la misma fila (se mantiene la unicidad por expediente, tipo y fracción, y R19), y estado_validacion vuelve a pendiente. motivo_observacion se conserva hasta la nueva decisión de Tesorería. El banco, el número de operación y la clave del comprobante anterior quedan en subsanacion_registrada (§4.7), y su archivo no se borra.'
}

Table Carta_Vacante {
  id_carta serial [pk]
  id_expediente integer [not null, unique, note: 'relación 1:0..1 con Expediente']
  id_personal_autoriza integer [not null, note: 'rol directora; su firma escaneada va en el PDF']
  fecha_emision timestamptz [not null, default: `now()`]
  url_documento varchar(500) [not null, note: 'clave del archivo en el adaptador de almacenamiento, como Documento.url_archivo (ADR-21): PDF generado por la API desde la plantilla y cifrado en reposo (ADR-28)']
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
  id_expediente integer [note: 'opcional: hay eventos sin expediente, p. ej. cambios de configuración o gestión de usuarios']
  id_personal integer [note: 'opcional: nulo si el actor es la familia o el sistema (n8n)']
  tipo_evento varchar(60) [not null, note: 'valores del catálogo de la sección 4.7']
  estado_anterior varchar(40)
  estado_nuevo varchar(40)
  fecha_hora timestamptz [not null, default: `now()`]
  detalle jsonb
  indexes {
    (id_expediente, tipo_evento) [name: 'ix_auditoria_expediente_tipo']
    (`(detalle->>'id_evento_inicio')::bigint`) [name: 'ix_auditoria_fin_evento_inicio', note: 'parcial: solo tipo_evento = atencion_fin (C54)']
  }
  Note: 'Bitácora de solo inserción (sin UPDATE ni DELETE). Fuente para calcular el lead time y el cycle time por etapa y para la minería de procesos.'
}

Table Personal {
  id_personal serial [pk]
  nombres varchar(100) [not null]
  apellidos varchar(100) [not null]
  rol rol_personal [not null]
  correo varchar(150) [unique, not null]
  keycloak_user_id uuid [unique, not null, note: 'id del usuario en el realm de Keycloak; su rol de realm coincide con Personal.rol']
  firma_url varchar(500) [note: 'clave de la firma escaneada en el almacenamiento cifrado (ADR-21, ADR-28); solo cuentas con rol directora; nula hasta que se carga con npm run firma:cargar']
  activo boolean [not null, default: true, note: 'las cuentas se desactivan, no se eliminan; se sincroniza con enabled de Keycloak']
  Note: 'Usuarios internos. Los crea, desactiva y reactiva el rol directora (G10). La API crea el usuario en Keycloak y Keycloak le envía el enlace para definir su contraseña (G01).'
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
| R8 | Verificación de completitud (HU0017): la solicita la familia con «Confirmar documentos» (`documentos_confirmados`). El expediente está completo si cada requisito **obligatorio** de la lista de R7 tiene al menos un documento vigente **y** existe el Pago `derecho_admision` del expediente, en cualquier `estado_validacion`. Si está completo, pasa de `en_postulacion` a `en_validacion` y las tres ramas de R9 quedan abiertas en `pendiente`, sin transición propia. Si falta algo, el expediente **se mantiene en `en_postulacion`** (HU0017-2.0) y se notifica a la familia qué falta. Cada verificación deja el evento `completitud_verificada` (§4.7). | API (decide) y n8n (orquesta y notifica) |
| R9 | Las **tres validaciones son paralelas e independientes**: documental (`estado_documental`, rol `secretaria`), derecho de admisión (Pago `derecho_admision`, rol `tesoreria`) y documentación financiera (`estado_financiero`, rol `tesoreria`). Cada una tiene su propio ciclo de observación y subsanación. Las evaluaciones se habilitan solo cuando las tres están `conforme`. | API / n8n |
| R10 | No se consultan centrales de riesgo. La revisión financiera es documental. | Alcance |

### 4.3 Evaluaciones
| # | Regla | Dónde |
|---|---|---|
| R11 | Evaluaciones exigidas según el grado (`Grado.requiere_*`): **Inicial** = jornada de observación; **1.° de primaria** = evaluación psicológica; **2.° de primaria en adelante y Secundaria** = evaluación psicológica + evaluación académica, en paralelo. **Todos** = entrevista a los padres al final. Son los valores semilla: Secretaría configura en G09 las evaluaciones de cada grado (HU0022, ADR-14); la entrevista no se configura. | Datos semilla + API (configurable en G09) |
| R12 | No puede haber dos citas **activas** del mismo responsable a la misma fecha y hora (índice único parcial `uq_cita_personal_fecha`), salvo la **jornada de observación**, que es grupal: su horario admite tantas citas como cupos tenga (C40). Al reservar se descuenta `Horario_Disponible.cupos` dentro de la misma transacción; al reprogramar se devuelve el cupo del turno anterior y se descuenta el del nuevo en la misma transacción (HU0009-2.0). | BD + API |
| R13 | El dictamen lo emite la `psicologa` después de la entrevista a los padres, con los resultados de todas las evaluaciones que exige el grado (`Grado.requiere_*` y la entrevista). Si es `en_observacion`, secretaría coordina requisitos complementarios (`Dictamen_Admision.requisitos_complementarios`) y luego se emite un nuevo dictamen. Si es `no_apto`, se notifica a la familia sin el contenido del informe y el proceso termina (estado final). | API / n8n |

### 4.4 Vacantes, pagos y carta
| # | Regla | Dónde |
|---|---|---|
| R14 | Solo la `directora` asigna vacantes, y solo a expedientes con dictamen `apto`. Asignar una vacante descuenta 1 de `Grado.vacantes_disponibles`; si es 0, el expediente pasa a `lista_espera` con su `posicion_lista_espera`. | API |
| R15 | `Grado.vacantes_autorizadas` no puede fijarse por debajo del número de vacantes ya adjudicadas (pantalla G09). Vacantes adjudicadas = `vacantes_autorizadas − vacantes_disponibles`: R14 descuenta las disponibles al asignar y R21 las devuelve (ADR-14). Al cambiar las autorizadas, las disponibles se mueven con la diferencia y las adjudicadas no cambian. | API (y `ck_grado_vacantes` como segunda capa) |
| R16 | Derecho de admisión: S/ 300, un solo pago (`numero_fraccion = 1`). | API |
| R17 | Cuota de ingreso: `Grado.monto_cuota_ingreso` (S/ 7000 en Inicial y Primaria, S/ 4000 en Secundaria), en pago único o fraccionado hasta `Grado.max_fracciones`. | API |
| R18 | **Disparador de la carta:** cuando un Pago con `tipo_pago = 'cuota_ingreso'`, `numero_fraccion = 1` y `estado_validacion = 'conforme'` queda conciliado, n8n pide la carta y la API genera automáticamente la Carta de Vacante en PDF con la firma escaneada de la Directora, y en la misma transacción crea `Carta_Vacante` y pasa el expediente a `carta_emitida`. n8n avisa a la familia con un enlace al portal, donde la descarga con sesión: el PDF no viaja por correo ni por n8n (ADR-28). Las fracciones posteriores no generan una nueva carta. En un grado con `monto_cuota_ingreso = 0` no hay Pago (`ck_pago_monto`): el disparador es el expediente en `vacante_asignada` sin ningún Pago de cuota (C25, C62). | API + n8n |
| R19 | `numero_operacion` es único **por banco** (`banco`, `numero_operacion`), de modo que un comprobante no puede registrarse dos veces. El mismo número en otro banco es otro comprobante (HU0007-2.0). | BD |

### 4.5 Seguimiento programado (flujo diario de n8n)
| # | Regla | Dónde |
|---|---|---|
| R20 | Cada día se revisan los expedientes con una acción pendiente de la familia. Si no hubo interacción en **48 horas**, se envía un recordatorio por correo y, solo si la familia lo autorizó y el canal está activo, por WhatsApp (se inserta en `Notificacion` con `tipo_evento = 'recordatorio_48h'`). Un recordatorio por etapa. Las etapas, su ancla y qué cuenta como interacción están en ADR-30 (bloque 11): la interacción es la última acción escrita de la familia (sus eventos en la bitácora, la carga de un documento y el guardado del cuestionario). | API decide; n8n revisa y envía |
| R21 | Si venció el **plazo máximo** de la etapa, el expediente pasa a `caducado`, se liberan los cupos o la vacante que tenía reservados y se notifica a la familia y al personal de admisión (HU0018-2.0; buzón `CORREO_ADMISION`). La vacante se devuelve con la fila del grado bloqueada, como R14 (C25); las citas reservadas pasan a `cancelada` y el cupo vuelve solo a los turnos futuros. `caducado` es final. Los plazos son provisionales (ADR-30, ADR-19). | API decide; n8n revisa y envía |
| R22 | Toda comunicación enviada se registra en `Notificacion`, también los envíos fallidos (`estado_envio = 'fallido'`). Si WhatsApp no está autorizado o el canal está desactivado, no se crea fila para ese canal. Un rebote del correo de la carpeta informativa pasa el expediente a `contacto_no_entregado` (HU0002-2.0). **Excepciones:** el enlace para definir la contraseña del personal lo envía Keycloak (ADR-02) y no se registra en `Notificacion`, porque esa tabla exige un expediente; la evidencia queda en `registro_auditoria` (`gestion_usuario`). El enlace para recuperar la contraseña (familias y personal, HU0023) también lo envía Keycloak y no deja fila (ADR-07, D7-A). | n8n (excepción: Keycloak y API) |

### 4.6 Permisos por rol (resumen)
| Rol | Puede |
|---|---|
| `secretaria` | Ver la bandeja de expedientes completos, validar u observar documentos no financieros, registrar asistencia a visitas (lo que crea la Cuenta_Acceso), configurar la campaña (Grado, Requisito_Documental, Horario_Disponible), ver los requisitos complementarios de un dictamen en observación (sin las conclusiones ni el informe) |
| `tesoreria` | Validar pagos y la documentación financiera |
| `psicologa` | Registrar resultados de observación, evaluación psicológica y entrevista; emitir el dictamen |
| `evaluador_academico` | Registrar el resultado o la inasistencia en la evaluación académica |
| `directora` | Asignar vacantes, ver el tablero de indicadores, crear, modificar, desactivar y reactivar usuarios del Personal; autoriza la carta (firma) |
| Familia (Cuenta_Acceso) | Solo sus propios expedientes: ficha, cuestionario, documentos, pagos, citas, panel de seguimiento y Carta de Vacante |

---

### 4.7 Catálogo de eventos de auditoría y medición del tiempo de atención
`Registro_Auditoria.tipo_evento` solo admite estos valores (el detalle va en `detalle`):

| tipo_evento | Cuándo se registra | Actor |
|---|---|---|
| `transicion_estado` | Cambio de `Expediente.estado`, `estado_documental` o `estado_financiero` (R6); lleva `estado_anterior` y `estado_nuevo` | Personal, familia o sistema |
| `atencion_inicio` | El personal **abre** un ítem para atenderlo: detalle del expediente (G03), pago o documentación financiera (G05), cita o dictamen (G06), evaluación académica (G11), postulante apto (G07). `detalle` indica el ítem | Personal |
| `atencion_fin` | El personal **registra su decisión** sobre ese ítem: conforme, observado, resultado, inasistencia, dictamen o asignación de vacante. `detalle` lleva `item`, `decision` e `id_evento_inicio` (el último `atencion_inicio` abierto de la misma persona y el mismo ítem, o nulo). En las validaciones (HU0008, HU0011 y HU0024), una observación agrega el documento o el pago observado (`id_documento` o `id_pago`) y el `id_notificacion` del primer intento del aviso; la decisión que deja conformes las tres ramas de R9 agrega `habilita_agendamiento: true` (una sola vez por expediente; es el ancla del aviso `evaluaciones_habilitadas`, C52). La inasistencia a la evaluación académica agrega el `id_notificacion` de su aviso (HU0025-2.0), y un nuevo dictamen agrega `dictamen_anterior` (`dictamen`, `conclusiones` y `requisitos_complementarios` ya cifrados, `informe_url` y `fecha_emision`; HU0010-2.0). La adjudicación (ítem `adjudicacion`) agrega el `id_notificacion` de su aviso y, en lista de espera, la `posicion`. La conciliación de la primera fracción o del pago único, y la vacante de un grado con cuota 0, agregan `cuota_acreditada: true`, solo como trazabilidad (C62) | Personal |
| `subsanacion_registrada` | La familia subsana una observación en `en_validacion`: reemplaza un documento observado (HU0008-2.0, HU0011-2.0) o registra un comprobante nuevo del derecho de admisión observado (HU0024-2.0); o, en `vacante_asignada`, el de la cuota de ingreso (HU0015-2.0). `detalle`: documento `{ item, id_documento_nuevo, id_documento_anterior }`; pago `{ item, id_pago, anterior: { banco, numero_operacion, clave, motivo, monto } }` (`monto` solo en la cuota). `item` es el de la rama (`validacion_documental` o `documentacion_financiera` con el id del expediente, o `pago` con el id del pago). Con el `atencion_fin` de la observación, mide el tiempo de subsanación (HU0019) | Familia |
| `acceso_denegado` | Intento de ver datos restringidos por rol (HU0021-2.0) | Personal |
| `cambio_configuracion` | Cambios en Grado, Requisito_Documental u Horario_Disponible | Secretaría |
| `gestion_usuario` | Alta, cambio, desactivación o reactivación de Personal; carga de la firma de la Directora (`accion: "firma_cargada"`, ADR-28) | Directora; en la carga de la firma, nulo (la hace un técnico) |
| `notificacion_rebotada` | Rebote del correo de un prospecto | Sistema |
| `documentos_confirmados` | La familia presiona «Confirmar documentos» en P06 (HU0006-1.0): solicita la verificación de completitud (HU0017). El expediente no cambia de estado; `detalle` lleva `documentos_vigentes` | Familia |
| `completitud_verificada` | La API verifica la completitud de una confirmación (R8, HU0017), a pedido de n8n. Una sola vez por confirmación. `detalle` lleva `resultado` (`completo` o `incompleto`), `faltantes` (`[{ id_requisito, id_apoderado }]`), `derecho_registrado` y, si es incompleto, `id_notificacion` (primer intento del aviso de faltantes), solo con ids. Si el resultado es `completo`, la `transicion_estado` a `en_validacion` va en la misma transacción | Sistema |
| `cita_reprogramada` | La familia reprograma una cita de evaluación en P08 (HU0009-2.0). El expediente no cambia de estado. `detalle`, solo con ids: `id_cita_anterior`, `id_cita_nueva`, `id_horario_anterior`, `id_horario_nuevo`, `id_notificacion` (primer intento del aviso a la familia), `id_notificacion_responsable` (al responsable de la cita nueva) y, si el responsable cambia, `id_notificacion_responsable_anterior` | Familia |
| `cuota_registrada` | La familia registra el comprobante de la cuota de ingreso en P07 (HU0014-1.0). El expediente no cambia de estado. `detalle`, solo con ids: `id_pago` e `id_notificacion` (primer intento del aviso a Tesorería). Es la fecha «Recibido» de G05, porque `Pago` no guarda la suya (C49) | Familia |

**Medición (OE3, HU0019).** *Lead time* = de la creación del expediente a `carta_emitida`. *Cycle time* de una etapa = suma de los intervalos entre cada `atencion_inicio` y su `atencion_fin` correspondiente en esa etapa. Supuesto aceptado: si alguien abre un ítem y lo deja abierto, el cycle time se sobreestima; un `atencion_inicio` sin `atencion_fin` en 8 horas no se cuenta. Los pares se emparejan por `id_evento_inicio`; un par de más de 8 horas tampoco se cuenta. *Tramo* de una etapa = días entre la primera llegada a un hito y la primera llegada al siguiente (ADR-27); los tramos suman el lead time. Sin cartas emitidas, G08 muestra el lead time como parcial, por expediente.

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
| F1 Captación | Webhook: evento de la API tras el registro de P01 (ADR-16), más un barrido cada minuto de los prospectos sin carpeta (C27) | Apoderado, Consentimiento, Expediente, Notificacion, Registro_Auditoria |
| F2 Recepción y registro | Webhook: evento de la API con `{ id_expediente }` tras «Confirmar documentos» en P06 (HU0017), más un barrido cada minuto de las confirmaciones sin verificar y de los avisos de faltantes por retomar (ADR-16). Entrega cada expediente a F3. La ficha y los archivos los registra la API: no pasan por n8n (ADR-21) | Expediente, Registro_Auditoria (lectura, a través de la API) |
| F3 Verificación de completitud | Invocado por F2 (sub-workflow). Pide la verificación a la API (R8) y, si falta algo, notifica por F6 | Documento, Requisito_Documental, Pago, Expediente, Notificacion, Registro_Auditoria |
| F4 Agendamiento | Webhook: evento de la API con `{ id_cita }` tras la reserva en P02 (HU0003) y el registro de la asistencia en G04 (HU0004), o con `{ id_expediente, id_notificacion }` tras «Confirmar citas» y la reprogramación en P08 (HU0009), la inasistencia en G11 (HU0025) y el dictamen En observación o No apto en G06 (HU0010), la adjudicación en G07 (HU0012) y el comprobante de la cuota en P07 (HU0014), más un barrido cada minuto de los avisos pendientes, también el de la habilitación del agendamiento (C52) (ADR-16) | Horario_Disponible, Cita, Cuenta_Acceso, Notificacion, Registro_Auditoria (lectura, a través de la API) |
| F5 Generación de carta | Webhook: evento de la API con `{ id_expediente }` al conciliar la primera fracción o el pago único (R18), más un barrido cada minuto, que también toma la vacante con cuota 0 (C62). La API decide con los datos, genera el PDF y hace la transición; n8n envía el aviso (ADR-16, ADR-28) | Pago, Carta_Vacante, Expediente, Notificacion, Registro_Auditoria (a través de la API) |
| F6 Notificación multicanal | Invocado por los demás flujos | Notificacion |
| F7 Seguimiento y recordatorios | Programado diario a las 08:00 (R20 y R21, HU0018; también un Manual Trigger para el E2E), un Schedule cada minuto que retoma sus avisos (ADR-07), más un Schedule cada minuto para el recordatorio de la visita (HU0003, D4) | Expediente, Cita, Notificacion, Registro_Auditoria |

---

## 7. Pendientes y supuestos (no inventar valores)

- **Tipos de datos y enums:** son una propuesta. Solo los valores de `tipo_cita` y las reglas marcadas en las notas del DER provienen del diseño aprobado.
- **Por definir con el colegio:**
  - `Grado.max_fracciones` y el calendario de las fracciones.
  - La escala de `Resultado_Evaluacion.resultado` para la evaluación académica.
  - El plazo máximo por etapa (R21). Hoy rigen valores provisionales (ADR-30: 15 días la postulación y 7 días las demás etapas).
  - Los horarios de visitas y evaluaciones.
  - El número de vacantes por grado.
- **Fuera de alcance (no modelar):**
  - La consulta a centrales de riesgo.
  - La pasarela de pagos en línea.
  - El cálculo de devoluciones de la cuota.
  - El registro del admitido en SIEWEB o SIAGIE (el sistema académico existente no se integra ni se modifica).
- **Almacenamiento de archivos:** las columnas `*_url` guardan la clave del archivo en el adaptador de almacenamiento (`STORAGE_DRIVER`: `local` en dev; ADR-12 y ADR-21). La BD guarda la referencia, no el archivo. Los archivos se guardan cifrados (ADR-03).
- **Por definir con el colegio (v1.1):** la política de contraseñas y el tiempo de bloqueo en Keycloak (P03b, P03c). HU0023 los muestra entre corchetes (C6).
- **Datos derivados, sin columna propia:** el código de la constancia de P07b (`CONST-<código del expediente>-<id_pago>`) y la fecha de validación de un pago (P07) se obtienen de `Registro_Auditoria`.
- **Vínculo de un aviso con su cita (HU0003 y HU0004, ADR-16):** `Notificacion` no tiene `id_cita`.
  - El ancla de cada aviso es la `fecha_hora` de la `transicion_estado` de esa cita (`detalle.id_cita`). Una notificación del tipo con `fecha_envio ≥ ancla` pertenece a esa cita.
  - `fecha_envio` se llena al insertar y se actualiza en cada retoma y al cerrar.
- **Intentos de un aviso de la visita (ADR-07):** cada intento tiene su propia fila.
  - Un intento con resultado desconocido (error técnico, 502, 500 o n8n caído) queda `pendiente`: nunca se marca `fallido`.
  - El tope de 6 intentos cuenta las filas desde el ancla. Al agotarse, el aviso se cierra con una fila de cierre `fallido`, que no es un envío.
  - Cada aviso tiene como máximo una fila `enviado` o una `fallido`. Los indicadores (HU0019, C8) cuentan avisos por esas filas y no cuentan las `pendiente` como envíos.
- **Cupos frente a `uq_cita_personal_fecha` (C40, resuelto en HU0009 para las evaluaciones):** el índice es parcial: no cuenta las citas `reprogramada` ni `cancelada` (el turno liberado se vuelve a reservar) ni la jornada de observación, que es grupal. Las demás citas siguen siendo individuales: un horario individual con `cupos > 1` admite una sola cita. Los cupos de la visita (P-e) siguen en HU0022.
- **Avisos de las evaluaciones (HU0009, ADR-07):** la confirmación (`evaluaciones_confirmadas`) y los de la reprogramación (`evaluacion_reprogramada`, `evaluacion_reprogramada_responsable` y `evaluacion_liberada_responsable`) son las filas del tipo con `id_notificacion` ≥ el primer intento, que guardan la `transicion_estado` a `en_evaluacion` o el evento `cita_reprogramada`; solo se retoma el de la fuente más reciente de cada tipo. La habilitación (`evaluaciones_habilitadas`, C52) es una por expediente y se ancla en la fecha del `atencion_fin` con `habilita_agendamiento`. Un aviso al responsable se registra con el `id_expediente` de la familia y va al correo del `Personal` de la cita.
- **Avisos de la inasistencia y del dictamen (HU0010 y HU0025, ADR-25):** `evaluacion_inasistencia` (familia; primer intento en el `atencion_fin` de la inasistencia), `dictamen_en_observacion` (buzón `CORREO_ADMISION`; primer intento en la `transicion_estado` a `en_observacion`) y `dictamen_no_apto` (familia; primer intento en la `transicion_estado` a `no_apto`). Siguen la misma regla de intentos. Ninguno lleva conclusiones, observaciones, requisitos complementarios ni el informe (C11).
- **Avisos de la vacante y de la cuota (HU0012 y HU0014, ADR-26):** `vacante_asignada` y `lista_espera` (familia; primer intento en la `transicion_estado`) y `cuota_por_conciliar` (buzón `CORREO_TESORERIA`; primer intento en `cuota_registrada`). Siguen la misma regla de intentos. Ninguno lleva datos del dictamen (C11).
- **Estados de la cuota (ADR-26):** «Cuota en conciliación», «Cuota observada» y «Cuota acreditada» son el `estado_validacion` del Pago `cuota_ingreso`, fracción 1. El expediente sigue en `vacante_asignada`.

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

### Ajustes posteriores a v1.1 (21/10/2026), sin cambios en tablas ni columnas
| Cambio | Motivo |
|---|---|
| Sección 4.7: sale `inicio_sesion` del catálogo de `tipo_evento` (y su CHECK, migración `20261021120000_quitar_inicio_sesion.sql`); la nota de `Registro_Auditoria.id_expediente` ya no lo cita | El equipo quitó «Último acceso» de G10 (compromiso C20, descartado); era su único uso |
| Sección 7: el último acceso del personal deja de figurar entre los datos derivados | Ídem |
| Sección 4.6 y nota de `Personal`: la directora también reactiva cuentas | Escenario HU0021-5.0 (compromiso C21) |

### Ajustes por HU0022 (23/10/2026), sin tablas ni columnas nuevas
| Cambio | Motivo |
|---|---|
| Nota de `Requisito_Documental.tipo_documento`: guarda el nombre visible (antes, ejemplos en código como `partida_nacimiento`) | G09 muestra nombres, no hay columna para la etiqueta y un tipo nuevo no debe exigir programar (ADR-14) |
| Índice único `uq_requisito_grado_tipo_minusculas` sobre `(id_grado, lower(tipo_documento))` (migración `20261023120000_requisito_tipo_sin_mayusculas.sql`); `uq_requisito_grado_tipo` se conserva | «Partida de nacimiento» y «partida de nacimiento» son el mismo requisito (plan HU0022, P14) |
| R11: los valores son la semilla y G09 los configura por grado | Evaluaciones requeridas configurables por grado (ADR-14) |
| R15: definición de «vacantes adjudicadas» | Mínimo de HU0022-2.0 sin depender de HU0012; coincide con G07 (ADR-14, compromiso C25) |
| Nota de `Horario_Disponible`: sin superposición del mismo responsable; nota de `id_personal`: rol según el tipo de cita y cuenta activa | Evitar la doble reserva y fijar quién atiende cada cita (ADR-15) |
| Nota de `Grado.nombre_grado`: el ejemplo pasa a «Kindergarten (5 años)», como §5 y el seed | Plan HU0022, P13 |

### Ajustes por HU0002 (25/10/2026), sin tablas, columnas ni enums nuevos
| Cambio | Motivo |
|---|---|
| §6, F1: el disparador es el evento de la API tras P01 más un barrido cada minuto; suma `Registro_Auditoria` (rebote y transición) | El webhook lo llama la API (ADR-16) y un evento no entregado se recupera sin esperar al barrido diario (C27) |
| «Notificación rebotada» (HU0002-2.0) = `estado_envio = 'fallido'` más el evento `notificacion_rebotada` de §4.7 | El enum `estado_envio` no tiene «rebotado»; §4.7 ya tenía el evento (ADR-07) |

### Ajustes por HU0003 y HU0004 (29/10/2026), sin tablas, columnas ni enums nuevos
| Cambio | Motivo |
|---|---|
| §6, F4: el disparador es el evento de la API con `{ id_cita }` más un barrido cada minuto; suma `Cuenta_Acceso` | Un solo receptor para la confirmación, la invitación a reprogramar y las credenciales (ADR-16) |
| §6, F7: un Schedule cada minuto para el recordatorio de la visita | D4: 24 h antes (`RECORDATORIO_VISITA_HORAS`) |
| §7: el ancla de los avisos, una fila por intento (la de resultado desconocido queda `pendiente`) con una fila de cierre `fallido` al agotar el tope, y los cupos frente a `uq_cita_personal_fecha` | Idempotencia por cita y tope de intentos sin columnas nuevas, sin marcar `fallido` un correo que pudo salir (ADR-07); C40 |
| Transiciones `prospecto → visita_agendada`, `visita_agendada → portal_habilitado` y `visita_agendada → prospecto` | HU0003-1.0, HU0004-1.0 y HU0004-2.0. «Visita no concretada» = `Cita.estado = no_asistio`, y el expediente vuelve a `prospecto` (P1, John, 29/10/2026) |

### Ajustes por HU0005 (02/11/2026), sin tablas, columnas ni relaciones nuevas
| Cambio | Motivo |
|---|---|
| `Postulante.estudio_en_colegio_peruano` y `tiene_condicion_especial` admiten `NULL` (migración `20261102120000_postulante_booleanos_borrador.sql`; el `DEFAULT false` se conserva) | El borrador distingue «sin responder» de «No» (HU0005-2.0); la API exige true o false al completar la ficha |
| `Postulante.tiene_condicion_especial` no se cifra | Es solo un sí/no (ADR-03, HU0005) |
| Nota de los dos boolean: el `DEFAULT false` se conserva solo por compatibilidad y toda inserción escribe `NULL` explícito si la pregunta no se respondió | Lo protege HU0005-2.0 (migración, repositorio y prueba `HU0005-2.0 [parte: borrador] las preguntas sin responder vuelven como null…`) |

### Ajustes por HU0006 y HU0007 (03/11/2026), sin tablas ni columnas nuevas
| Cambio | Motivo |
|---|---|
| R19 y los índices de `Pago`: `numero_operacion` deja de ser único en toda la tabla y pasa a ser único por banco (`uq_pago_banco_numero_operacion`; migración `20261103120000_pago_unicidad_banco_operacion.sql`). `Pago.banco` sale de una lista cerrada | HU0007-2.0 («ya registrado para el mismo banco»); decisión P1 (a) de John. La Figura 12 del TI se regenera |
| §4.7: evento `documentos_confirmados` (migración `20261103120100_evento_documentos_confirmados.sql`) | HU0006-1.0 («solicita la verificación de completitud») sin estado nuevo: el expediente sigue en `en_postulacion`, como dice HU0017-2.0 (decisión P3 A) |

### Ajustes por HU0017 (03/11/2026), sin tablas ni columnas nuevas
| Cambio | Motivo |
|---|---|
| R8: el expediente incompleto se mantiene en `en_postulacion` (antes «pasa a `incompleto`»), y el comprobante del derecho de admisión cuenta para la completitud. El valor `incompleto` del enum queda sin uso y no se borra | HU0017-2.0 («mantiene el expediente en postulación»), decisión D1-A. Con D2-a, las tres ramas de R9 tienen qué validar al abrirse, y el derecho se sigue registrando solo en `en_postulacion` (ADR-21, Q-c) |
| Transición `en_postulacion → en_validacion`. `estado_documental` y `estado_financiero` quedan en `pendiente` | HU0017-1.0; «abrir» una rama = expediente en `en_validacion` con la rama en `pendiente` (D4-X) |
| §4.7: evento `completitud_verificada` (migración del CHECK) | Una verificación incompleta no cambia el estado: el evento deja el ciclo confirmación → verificación en la bitácora y es el ancla del aviso de faltantes (D5) |
| §6, F2 y F3: F2 recibe el evento de la confirmación y hace el barrido; F3 lo invoca F2 | Se mantienen los siete flujos del TI (D3-i). La ficha y los archivos no pasan por n8n (ADR-21) |
| Notas de `Documento.url_archivo` y `Pago.comprobante_url`, y §7: clave del adaptador de almacenamiento en lugar de «Google Drive» | D1 (ADR-12): almacenamiento local en dev; ADR-21 |

### Ajustes por HU0008, HU0011 y HU0024 (04/11/2026), sin tablas ni columnas nuevas
| Cambio | Motivo |
|---|---|
| Transiciones `pendiente → observado`, `pendiente → conforme` y `observado → pendiente` en `estado_documental` y `estado_financiero`. `Expediente.estado` sigue en `en_validacion`; `en_revision` queda sin uso en este bloque | R9: cada rama tiene su propio ciclo de observación y subsanación (HU0008, HU0011). La rama vuelve a `pendiente` cuando la familia reemplaza el último documento observado (A1) |
| «Habilita el agendamiento» = expediente en `en_validacion` con las tres ramas de R9 en `conforme`, sin estado ni transición propios. La decisión que completa la unión lo marca en su `atencion_fin` (`habilita_agendamiento`) | HU0008-1.0, HU0011-1.0, HU0024-1.0 (decisión B1). HU0009-1.0 parte de esa condición y hace `en_validacion → en_evaluacion` |
| Notas de `Documento` y `Pago`: subsanación en `en_validacion` (solo lo observado; el pago se actualiza en la misma fila y conserva el comprobante anterior) | Decisión A1: los tres escenarios 2.0 piden que la familia reemplace lo observado o regularice el pago |
| §4.7: evento `subsanacion_registrada` (migración del CHECK) y detalle de `atencion_fin` (`id_evento_inicio`, observación y unión) | Evidencia de la subsanación y del comprobante anterior (el pago no tiene historial), y el par inicio/fin y el tiempo de subsanación para HU0019 |

### Ajustes por HU0009 (05/11/2026), sin tablas ni columnas nuevas
| Cambio | Motivo |
|---|---|
| Transición `en_validacion → en_evaluacion`, solo con las tres ramas de R9 en `conforme` | HU0009-1.0 («cambia el estado del expediente a En evaluación»), decisión T de John |
| `uq_cita_personal_fecha` pasa a índice único **parcial**: sin las citas `reprogramada` o `cancelada` y sin la jornada de observación (migración `20261105120000_cita_indice_parcial.sql`, con el mismo nombre). R12 y §7 lo reflejan. La Figura 12 no cambia: la caja de Cita no marca UK y el índice no se dibuja | C40 (decisión de John): la jornada de observación es grupal y una reprogramación debe liberar su turno (HU0009-2.0) |
| §4.7: evento `cita_reprogramada` (migración `20261105120100_evento_cita_reprogramada.sql`) | HU0009-2.0 no cambia el estado del expediente: el evento es la evidencia del cambio y el ancla de sus avisos (decisión R4) |
| La entrevista a los padres empieza después del fin de las demás citas del expediente, al reservar y al reprogramar | R11 («entrevista a los padres al final»), decisión O de John |
| §4.7 (`atencion_fin`), §6 F4 y §7: avisos de las evaluaciones, también al responsable de la cita | HU0009-1.0 y 2.0, C52 (decisiones C52 y R3) |

### Ajustes por HU0010 y HU0025 (05/11/2026): una columna nueva, sin tablas nuevas
| Cambio | Motivo |
|---|---|
| Columna `Dictamen_Admision.requisitos_complementarios text`, cifrada (migración `20261105130000_dictamen_requisitos_complementarios.sql`). La Figura 12 se regenera | HU0010-2.0 («detalla los requisitos complementarios»): Secretaría los coordina con la familia (R13) y no puede leer `conclusiones` (R3). Decisión D4b-B de John |
| `Resultado_Evaluacion.observaciones`, `Dictamen_Admision.conclusiones` y `requisitos_complementarios` se cifran en la API | Datos de salud de menores (ADR-03, decisión D1-A) |
| Transiciones `en_evaluacion → apto`, `en_evaluacion → en_observacion`, `en_evaluacion → no_apto`, `en_observacion → apto` y `en_observacion → no_apto`. `no_apto` es final | HU0010-1.0, 2.0 («antes de un nuevo dictamen») y 3.0 («cierra el expediente»); decisiones D4a-A y D4d |
| Inasistencia a la evaluación académica = `Cita.estado = no_asistio` y `Resultado_Evaluacion.resultado = 'inasistencia'`; la familia la reprograma en P08 y la cita vieja queda `no_asistio` | HU0025-2.0 («libera la cita … para que reprograme»), decisión D2-A |
| La entrevista a los padres va al final (R11), salvo al reprogramar una inasistencia si la entrevista ya no se puede mover: registrada, ya pasada o a menos de `REPROGRAMACION_MIN_HORAS` | Sin la excepción, el expediente quedaría detenido en `en_evaluacion` (HU0025-2.0, decisión A de John; ADR-24) |
| §4.7 (`atencion_fin`), R13, §4.6, §6 F4 y §7: el detalle `dictamen_anterior`, la condición del dictamen, la lectura de Secretaría y los avisos nuevos | ADR-25 |

### Ajustes por HU0012 a HU0015 (05/11/2026), sin tablas ni columnas nuevas
| Cambio | Motivo |
|---|---|
| §4.7: evento `cuota_registrada` (migración `20261106120000_evento_cuota_registrada.sql`) y detalle de `atencion_fin` y `subsanacion_registrada` | HU0014-1.0 y HU0015-2.0; la cuota no cambia de estado y `Pago` no guarda la fecha (C49) |
| Transiciones `apto → vacante_asignada` y `apto → lista_espera`. `lista_espera` queda sin salida | HU0012-1.0 y 2.0; la salida no tiene escenario (C61) |
| R18: segundo disparador con cuota 0, y nota de Pago: subsanación de la cuota | Decisión de John (C25 punto 5, ADR-26) |
| §6 F4 y §7: los avisos nuevos y los estados derivados de la cuota | ADR-26 |

### Ajustes por HU0019 (05/11/2026), sin tablas ni columnas nuevas

| Cambio | Motivo |
|---|---|
| `Registro_Auditoria`: índices `ix_auditoria_expediente_tipo` e `ix_auditoria_fin_evento_inicio` (migración `20261106130000_indices_auditoria.sql`) | C54 y el tablero G08; medidos con `EXPLAIN ANALYZE` |
| §4.7, medición: el tramo de una etapa y el emparejamiento por `id_evento_inicio`, con el límite de 8 h inclusive | ADR-27 (D1-C y D5-A) |

### Ajustes por HU0016 y HU0020 (06/11/2026): una columna nueva, sin tablas nuevas

| Cambio | Motivo |
|---|---|
| `Personal.firma_url` (migración `20261107120000_personal_firma.sql`) | D2-A: la firma escaneada vive en el almacenamiento cifrado; la columna guarda su clave, sin variables nuevas (ADR-28) |
| Transición `vacante_asignada → carta_emitida` | HU0016-1.0 |
| R18, F5 y nota de `Carta_Vacante.url_documento`: el PDF lo genera la API, no n8n; n8n recibe el evento, pide la carta y envía el aviso | Decisión de John (plan del bloque 10): el PDF lleva el nombre de un menor y la firma de la Directora y no pasa por n8n (C11) |
| §4.6: la familia ve su panel y descarga su carta; §4.7: `gestion_usuario` incluye la carga de la firma | ADR-28 y ADR-29 |
