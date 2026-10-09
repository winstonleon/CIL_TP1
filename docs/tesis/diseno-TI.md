# Extracto del Trabajo de Investigación (TI)

> **Divergencias conocidas con las decisiones vigentes (08/10/2026).** Si este extracto contradice `docs/decisiones.md`, `docs/der/modelo-datos.md` o `docs/ui/`, mandan esos archivos:
> - **Identidad:** se usa Keycloak (ADR-02). La arquitectura física de 6.2.4 aún no muestra ese contenedor.
> - **Pantallas:** el lienzo tiene 23 (se agregan P03b, P03c, P05b y P07b). La Tabla 8 aún lista 19.
> - **Modelo de datos:** rige el DBML v1.1. La figura 12 no refleja sus cambios (DNI cifrado, apellidos separados, Keycloak, condición laboral, etc.).
> - **Informe psicológico:** lo ven la Psicóloga y la Directora (regla R3 del modelo de datos).

> Extraído de `TI_Herhuay_Brayan_León_John.docx`. Solo secciones que gobiernan la implementación: alcance funcional (Tabla 3) y capítulo 6 completo. Las figuras están en `figuras/` con baja resolución (solo referencia).

## Alcance funcional respecto del As-Is (sección 1.2.4.2)

El proceso crítico es la admisión de postulantes, desde el primer contacto de la familia hasta la entrega de la carta de vacante. Según el levantamiento realizado con la Directora de la institución, comprende las siguientes etapas:

1. **Primer contacto.** La familia se comunica por teléfono o por Instagram y Facebook, cuyos enlaces redirigen al teléfono de admisión. Se le envía información y la carpeta de admisión.  
2. **Visita guiada.** Se programa una cita presencial para explicar el proyecto educativo. En esta institución las visitas son individuales.  
3. **Entrega de la carpeta de admisión.** La familia presenta la ficha de inscripción, un cuestionario de expectativas sobre el colegio, la partida de nacimiento del menor, el DNI del padre, la madre y el menor, la libreta de notas del colegio o nido de procedencia (si corresponde) y, cuando el niño tiene alguna condición o terapia, los informes correspondientes.  
4. **Cobro del derecho de admisión.** Al presentar la carpeta, la familia paga S/ 300 (monto de esta institución).  
5. **Evaluación psicopedagógica.** Se programa una entrevista de la psicóloga con el menor y sus padres, que emite un informe.  
6. **Verificación financiera.** Idealmente, el área administrativa consulta centrales de riesgo para estimar la capacidad de pago de la familia.  
7. **Comunicación del resultado.** En un promedio de dos a tres días se comunica a la familia que obtuvo la vacante.  
8. **Pago de la cuota de ingreso.** La familia realiza el primer pago de la cuota de ingreso, prorrateada en los años de estudio y sujeta a devolución proporcional si el alumno se retira.  
9. **Entrega de la carta de vacante.** Con el pago realizado, el colegio emite la carta de vacante, que la familia presenta al colegio de procedencia

**Alcance funcional del sistema respecto del proceso As-Is.** La Tabla 3 delimita qué etapas serán soportadas por el sistema de tramitación. El criterio aplicado es que la funcionalidad pueda construirse con n8n autoalojado y servicios sin licencia comercial, sin contratos con terceros y sin sustituir decisiones que requieren juicio profesional.

**Tabla 3**

Cobertura del sistema de tramitación por etapa

| Etapa As-Is | Cobertura | Funcionalidad o motivo |
| :---- | :---- | :---- |
| 1\. Primer contacto | Parcial | Formulario web de solicitud de información con envío automático de la carpeta digital; la atención en redes sociales solo enlaza al formulario |
| 2\. Visita guiada | Parcial | Agendamiento y recordatorios automáticos; la visita es presencial. |
| 3\. Carpeta de admisión | Dentro | Formulario de postulación, carga de documentos, verificación automática de completitud y ordenamiento del expediente. |
| 4\. Derecho de admisión | Parcial | Carga del comprobante de pago y validación por Tesorería dentro del flujo; no se procesan pagos en línea, pues requiere contratar una pasarela de pagos. |
| 5\. Evaluación psicopedagógica | Parcial | Agendamiento sincronizado y registro del resultado por la psicóloga; la evaluación es juicio profesional. |
| 6\. Verificación financiera | Fuera | Requiere contrato con una central de riesgo y una base legal específica para tratar esos datos (Ley N.° 29733); no aplica a instituciones públicas. |
| 7\. Comunicación del resultado | Dentro | Control de vacantes y notificación multicanal del estado del trámite. |
| 8\. Cuota de ingreso | Parcial | Carga del comprobante y confirmación de Tesorería; el cálculo de devoluciones queda fuera. |
| 9\. Carta de vacante | Dentro | Generación automática del documento desde plantilla tras la confirmación de Tesorería y la autorización de la Directora, y envío a la familia. |
| Registro del admitido en SIEWEB o SIAGIE | Fuera | Corresponde al enrolamiento, excluido del alcance del proyecto. |

# **6\. Diseño y Desarrollo de la Propuesta** {#6.-diseño-y-desarrollo-de-la-propuesta}

Este capítulo presenta el diseño del sistema de tramitación correspondiente al objetivo específico 2 (OE2): diseñar la arquitectura del sistema de tramitación y los flujos de trabajo optimizados para la gestión del proceso de admisión. El diseño se expresa en cuatro artefactos complementarios: el modelo del proceso To-Be en BPMN 2.0, la arquitectura empresarial en ArchiMate 3.1, elaborada en la herramienta Archi y organizada en seis vistas, el modelo de datos entidad-relación y los prototipos de alta fidelidad de las interfaces. En conjunto constituyen la evidencia del indicador I3 (arquitectura lógica, arquitectura física, diagrama entidad-relación e interfaz web), y el modelo To-Be constituye, además, la especificación de flujos exigida por el indicador I4.

Las tecnologías que se nombran en las vistas de implementación (n8n como motor de orquestación, Node.js con Express.js como capa de servicios, Vue para la interfaz y PostgreSQL como gestor de base de datos) corresponden a las alternativas seleccionadas en el análisis de la propuesta. El caso de estudio es el Colegio Internacional de Lima (CIL), institución educativa privada que ofrece los niveles de Inicial (3 y 4 años, y Kindergarten), Primaria (1.° a 6.° grado) y Secundaria (1.° a 5.° grado).

## **6.1. Diseño del proceso de admisión To-Be** {#6.1.-diseño-del-proceso-de-admisión-to-be}

El rediseño siguió el ciclo BPM de diagnóstico, rediseño, implementación y monitoreo (Teixeira et al., 2024\) y se modeló en BPMN 2.0, notación que en casos comparables permitió representar el proceso actual y el propuesto y localizar las esperas entre áreas (Renna y Colonnese, 2025a). Para decidir qué actividades automatizar se aplicó el criterio de Gunawan et al. (2025): se automatizan las actividades de alto volumen, estandarizadas y que no requieren juicio profesional, como el registro, la verificación de completitud, el agendamiento, las notificaciones y la generación documental. En cambio, la validación de documentos y pagos, las evaluaciones y la adjudicación de vacantes permanecen como tareas humanas asistidas por el sistema.

### ***6.1.1. Participantes y carriles del modelo*** {#6.1.1.-participantes-y-carriles-del-modelo}

El modelo se compone de dos participantes. El primero, Proceso de Admisión To-Be, se organiza en siete carriles: familia postulante; sistema de tramitación (orquestación); personal de admisión y secretaría; Directora; Psicóloga; Evaluador académico, y Tesorería. El segundo, Seguimiento programado de expedientes, representa un flujo que se inicia cada día mediante un evento temporizado. En ambos, las tareas de servicio corresponden a flujos ejecutados por el motor de orquestación; las tareas de usuario, a acciones que el personal o la familia realizan en la interfaz web, y las tareas manuales, a actividades presenciales. Debido a su extensión, el proceso principal se presenta en tres figuras consecutivas.

### ***6.1.2. Captación, visita guiada y postulación*** {#6.1.2.-captación,-visita-guiada-y-postulación}

El proceso inicia cuando la familia solicita información desde las redes sociales del colegio. Antes de registrar cualquier dato, la familia otorga su consentimiento informado para el tratamiento de sus datos personales y los del menor, conforme a la Ley N.° 29733\. El sistema registra al prospecto y envía automáticamente la carpeta informativa por correo electrónico y mensajería instantánea; luego, la familia agenda la visita guiada, el sistema bloquea el cupo y programa un recordatorio. La Directora conduce la visita y el personal de secretaría registra la asistencia: si la familia no asistió, el sistema la invita a reprogramar; si asistió y desea postular, el sistema habilita el portal de postulación y envía las credenciales de acceso.

En el portal, la familia registra la ficha de inscripción y el cuestionario de expectativas, y carga los documentos del expediente. La lista de documentos depende del grado y de lo declarado en la ficha: se exigen los documentos del colegio de procedencia cuando el postulante estudió en otro colegio del Perú, los informes de terapia cuando se declaró una condición especial y, en todos los casos, la documentación financiera de los padres. El sistema verifica automáticamente la completitud del expediente y, si falta algún documento, notifica a la familia el detalle de lo faltante.

**Figura 2**

*Proceso To-Be: captación, visita guiada y postulación*

[figura: figuras/fig02-tobe-captacion-postulacion.png]

*Nota*. Elaboración Propia

### ***6.1.3. Validaciones en paralelo y evaluaciones según el nivel*** {#6.1.3.-validaciones-en-paralelo-y-evaluaciones-según-el-nivel}

Cuando el expediente está completo, una compuerta paralela abre tres validaciones simultáneas: el personal de secretaría valida la legibilidad y conformidad de los documentos; Tesorería valida el pago del derecho de admisión (S/ 300), y Tesorería revisa la documentación financiera de los padres sin consultar centrales de riesgo. Cada rama cuenta con su propio ciclo de subsanación, de modo que una observación en una rama no detiene las demás. La programación de las instancias de aprobación incide en el lead time del proceso (Renna y Colonnese, 2025b); por ello, estas tres validaciones, que no dependen entre sí, se ejecutan en paralelo y no de forma secuencial. La compuerta de unión exige que las tres concluyan conformes antes de habilitar las evaluaciones.

A continuación, el sistema habilita el agendamiento y la familia selecciona los turnos que corresponden al grado del postulante. Una compuerta exclusiva distingue dos rutas. En Inicial, la Psicóloga conduce una jornada de observación en la que el postulante asiste a un día de clases. En Primaria y Secundaria, la evaluación psicológica se realiza en paralelo con la evaluación académica, que el Evaluador académico toma desde 2.° de primaria. Ambas rutas convergen en la entrevista a los padres, tras la cual la Psicóloga emite el dictamen de admisión: Apto, En observación, caso en que secretaría coordina requisitos complementarios con la familia antes de un nuevo dictamen, o No apto, caso en que el sistema notifica el resultado y el proceso concluye.

**Figura 3**

*Proceso To-Be: validaciones en paralelo y evaluaciones según el nivel*

[figura: figuras/fig03-tobe-validaciones-evaluaciones.png]

*Nota*. Elaboración propia.

### ***6.1.4. Adjudicación, cuota de ingreso y carta de vacante*** {#6.1.4.-adjudicación,-cuota-de-ingreso-y-carta-de-vacante}

Con el dictamen Apto, la Directora asigna la vacante. Si el grado no tiene vacantes disponibles, el sistema registra al postulante en la lista de espera y lo notifica; en caso contrario, notifica a la familia la vacante otorgada, el monto de la cuota de ingreso según el nivel (S/ 7,000 en Inicial y Primaria; S/ 4,000 en Secundaria) y las opciones de pago único o fraccionado. La familia carga el comprobante del pago único o de la primera fracción y Tesorería concilia el abono. Una vez conciliado, el sistema genera la Carta de Vacante en PDF, con la firma escaneada de la Directora, y la envía a la familia, con lo que el proceso de admisión concluye.

**Figura 4**

*Proceso To-Be: adjudicación, cuota de ingreso y emisión de la carta de vacante*

[figura: figuras/fig04-tobe-adjudicacion-carta.png]

*Nota*. Elaboración propia.

### ***6.1.5. Seguimiento programado de expedientes*** {#6.1.5.-seguimiento-programado-de-expedientes}

El segundo participante modela un flujo que se inicia cada día. El sistema revisa los expedientes con acciones pendientes: si una familia no ha interactuado durante 48 horas, envía un recordatorio por correo y mensajería; si venció el plazo máximo de la etapa, caduca la postulación, libera el cupo reservado y notifica a la familia.

**Figura 5**

*Seguimiento programado de expedientes*

[figura: figuras/fig05-seguimiento-programado.png]

*Nota*. Elaboración propia.

**Tabla 4**

*Distribución de actividades entre el sistema y las personas en el proceso To-Be*

| Etapa | Actividades automatizadas por el sistema | Actividades a cargo de personas |
| :---- | :---- | :---- |
| Captación y visita guiada | Registro del prospecto, envío de la carpeta informativa, bloqueo del cupo, recordatorio, habilitación del portal y envío de credenciales | Consentimiento y registro (familia); conducción de la visita (Directora); registro de asistencia (secretaría) |
| Postulación | Verificación de completitud y notificación de documentos faltantes | Ficha, cuestionario y carga de documentos (familia) |
| Validaciones | Apertura de las tres validaciones en paralelo y notificación de observaciones | Validación documental (secretaría); validación del derecho de admisión y de la documentación financiera (Tesorería) |
| Evaluaciones | Habilitación del agendamiento, bloqueo de horarios y envío de pautas | Selección de turnos (familia); jornada de observación, evaluación psicológica, entrevista y dictamen (Psicóloga); evaluación académica (Evaluador académico) |
| Adjudicación y cierre | Notificación del resultado y de la cuota; registro en lista de espera; generación y envío de la carta | Asignación de la vacante (Directora); carga del comprobante (familia); conciliación del pago (Tesorería) |
| Seguimiento | Recordatorios a las 48 horas sin interacción y caducidad por vencimiento de plazo | Ninguna |

*Nota*. Elaboración propia.

## **6.2. Arquitectura empresarial del sistema** {#6.2.-arquitectura-empresarial-del-sistema}

La arquitectura se modeló en ArchiMate 3.1 con la herramienta Archi, en seis vistas que separan el propósito del sistema, su estructura lógica y su despliegue físico. La vista lógica describe qué hace el sistema y cómo se organizan sus responsabilidades sin nombrar tecnologías; la vista física describe dónde se ejecuta cada elemento y con qué tecnología. Esta separación permite modificar la infraestructura sin alterar la lógica del proceso, y hace explícito que la correspondencia entre elementos lógicos y físicos no es uno a uno.

### ***6.2.1. Vista de motivación*** {#6.2.1.-vista-de-motivación}

La vista de motivación explica por qué existe la arquitectura. Los interesados, la Dirección del colegio y la Jefatura de Admisión, influyen sobre el impulsor «Ineficiencia operativa del proceso de admisión», que motiva el objetivo general de optimizar el tiempo de atención. Ese objetivo se concreta en los requisitos I3 e I4, realizados por los entregables de diseño (modelo To-Be, diagrama entidad-relación y modelo de arquitectura) y por los elementos centrales del sistema. Sobre el requisito I3 influyen un principio y dos restricciones. El principio es integrar sin modificar el sistema académico existente, porque la compatibilidad con los sistemas vigentes es el antecedente más influyente de la adopción de la automatización (Durão y Palma dos Reis, 2025\) y la alineación funcional es un factor de éxito en instituciones educativas (Fattah-Weil et al., 2026). Las restricciones son el presupuesto cero en licencias propietarias y la protección de datos personales de menores exigida por la Ley N.° 29733, que realiza el servicio de cifrado TLS.

**Figura 6**

*Vista de motivación: trazabilidad del OE2 con los indicadores I3 e I4*

[figura no incluida]

*Nota*. Elaboración propia.

### ***6.2.2. Arquitectura de negocio*** {#6.2.2.-arquitectura-de-negocio}

La arquitectura de negocio representa el proceso To-Be como seis procesos encadenados: captación de prospectos y visita guiada; postulación web y registro del expediente; verificación documental, financiera y del derecho de admisión; evaluaciones de admisión según el nivel; adjudicación de la vacante y comunicación del resultado, y validación de la cuota de ingreso y emisión de la carta de vacante. Los seis realizan el servicio de negocio Servicio de Tramitación de Admisión, que atiende a la familia postulante. Cada proceso tiene asignados sus actores (familia, secretaría, Tesorería, Psicóloga, Evaluador académico y Directora) y accede a los objetos de negocio del trámite: el expediente, los comprobantes de pago, la documentación financiera de los padres y la carta de vacante.

**Figura 7**

*Arquitectura de negocio del proceso de admisión To-Be*

[figura no incluida]

*Nota*. Elaboración propia.

### ***6.2.3. Arquitectura lógica*** {#6.2.3.-arquitectura-lógica}

La arquitectura lógica combina dos patrones: un modelo en capas y una orquestación centralizada, en la que un único motor coordina la secuencia de flujos, a diferencia de la coreografía, en la que cada servicio reacciona por su cuenta. El motor se activa por eventos, mediante un receptor de webhooks, y por tiempo, mediante un evento programado diario. La vista no nombra marcas ni productos, de modo que describe responsabilidades y no tecnologías. La Tabla 5 resume sus capas.

Dos reglas de diseño gobiernan esta vista. La primera es que la interfaz y el motor de orquestación acceden a los datos únicamente a través de la capa de servicios, que concentra la autenticación, la autorización por rol y la auditoría: cada transición del expediente queda registrada (Marian et al., 2025), lo que compensa que la edición comunitaria del orquestador carezca de registros de auditoría robustos (Casaclang et al., 2026\) y deja una base para aplicar minería de procesos en el futuro (Li et al., 2025). La segunda es que los flujos son construidos y documentados por el equipo técnico, mientras el personal opera el sistema sin modificar su lógica, lo que previene la deuda técnica y la TI en la sombra asociadas a las plataformas low-code (Viljoen et al., 2024). La convergencia entre diseño de procesos, diseño de aplicaciones y observabilidad en un mismo entorno sigue el enfoque iBPM (Arno y Gabryelczyk, 2025).

**Tabla 5**

*Capas de la arquitectura lógica del sistema de tramitación*

| Capa | Componentes | Responsabilidad |
| :---- | :---- | :---- |
| Presentación | Aplicación web de trámites: módulo de postulación (familias), módulo de gestión interna (secretaría, Psicología, evaluación académica y Tesorería) y módulo de indicadores (Dirección) | Interacción con familias y personal; consume la API REST |
| Servicios | API de servicios de trámites: API REST, servicio de autenticación y autorización por rol, servicio de expedientes, documentos y pagos, y servicio de auditoría | Control de acceso, reglas de negocio, acceso a datos y registro de auditoría |
| Entrada | Receptor de eventos (webhook) y evento programado diario | Punto único de activación del motor de orquestación |
| Orquestación | Motor de orquestación con siete flujos: captación, recepción y registro, verificación de completitud, agendamiento, generación de carta, notificación multicanal, y seguimiento y recordatorios | Coordinación centralizada de la secuencia del proceso |
| Integración | Adaptadores de almacenamiento documental, calendario, correo y mensajería | Comunicación con servicios externos |
| Datos | Base de datos lógica de admisión: expediente digital, consentimiento, documentación financiera (acceso restringido), carta de vacante y registro de auditoría | Persistencia del trámite; un único repositorio lógico |
| Sistemas externos | Servicios de almacenamiento, calendario, correo y mensajería; sistema de gestión académica existente | Fuera de la frontera del sistema; el sistema académico no se integra ni se modifica |

*Nota*. Elaboración propia.

La capa de datos adopta una única base de datos lógica, y no el patrón de una base de datos por servicio, porque el sistema tiene un solo orquestador y no microservicios independientes. La viabilidad de un orquestador de flujos basado en nodos en un entorno educativo está documentada por Vu et al. (2026).

**Figura 8**

*Arquitectura lógica del sistema de tramitación*

[figura: figuras/fig08-arquitectura-logica.png]

*Nota*. Elaboración propia.

### ***6.2.4. Arquitectura física*** {#6.2.4.-arquitectura-física}

La arquitectura física despliega el sistema en un único servidor privado virtual (VPS) con Linux, Docker Engine y Docker Compose. Un solo nodo es coherente con la restricción de presupuesto cero en licencias y con el volumen de una campaña de admisión escolar. El servidor se divide en dos zonas. En la zona pública, cuyos únicos puertos expuestos son el 80 y el 443, el contenedor NGINX termina el cifrado TLS, sirve el frontend compilado en Vue y reenvía las peticiones «/api» a la capa de servicios. En la red interna de Docker, sin exposición a Internet, se ejecutan la API en Node.js con Express.js, el motor n8n, el gestor PostgreSQL y un contenedor de respaldo diario de la base de datos.

Tres decisiones responden a la protección de datos de menores. La base de datos no publica puertos al exterior y solo la consultan la API y n8n dentro de la red interna. n8n tampoco se expone: la API lo invoca mediante webhooks internos y n8n lee y escribe los expedientes a través de la API. Además, el respaldo diario mitiga el riesgo de pérdida de flujos y datos identificado en el plan del proyecto. Cada elemento lógico se realiza mediante un artefacto desplegado: el build de Vue realiza la aplicación web; el código de la API, la capa de servicios; las definiciones de flujos en JSON, el motor de orquestación, y el esquema de la base de datos, la base de datos lógica. Los servicios externos (Google Drive y Sheets, Google Calendar, un proveedor SMTP y la API de mensajería de WhatsApp) atienden a n8n, mientras que SIEWEB, el sistema institucional existente, permanece sin conexión.

**Tabla 6**

*Componentes de la arquitectura física*

| Componente | Tecnología | Exposición | Función |
| :---- | :---- | :---- | :---- |
| Proxy inverso y frontend | NGINX y build de Vue | Pública (80/443) | Terminación TLS, entrega de la interfaz y reenvío de «/api» |
| Capa de servicios | Node.js con Express.js | Red interna | Autenticación, autorización por rol, auditoría y acceso a datos |
| Motor de orquestación | n8n (autoalojado) | Red interna | Ejecución de los siete flujos de trabajo |
| Base de datos | PostgreSQL | Red interna | Persistencia según el diagrama entidad-relación |
| Respaldo | Tarea programada (pg\_dump) | Red interna | Copia diaria de la base de datos |
| Servicios externos | Google Drive/Sheets, Google Calendar, SMTP, WhatsApp | Externos (SaaS) | Almacenamiento, calendario, correo y mensajería |

*Nota*. Elaboración propia.

**Figura 9**

*Arquitectura física del sistema de tramitación en producción*

[figura: figuras/fig09-arquitectura-fisica.png]

*Nota*. Elaboración propia.

### ***6.2.5. Vista de capas integrada*** {#6.2.5.-vista-de-capas-integrada}

La vista de capas integrada ofrece un corte vertical que conecta los procesos de negocio con su soporte tecnológico. Cada proceso de negocio es atendido por un servicio de aplicación; cada servicio es realizado por un flujo del motor de orquestación, y el motor y la aplicación web son realizados por artefactos desplegados en contenedores. Esta vista permite verificar que ningún proceso del To-Be carece de soporte en la aplicación ni en la infraestructura.

**Figura 10**

*Vista de capas integrada: negocio, aplicación y tecnología*

[figura no incluida]

*Nota*. Elaboración propia.

### ***6.2.6. Despliegue en desarrollo y en producción*** {#6.2.6.-despliegue-en-desarrollo-y-en-producción}

La última vista muestra que los mismos cuatro artefactos, que son el build de Vue, el código de la API, las definiciones de flujos y el esquema de la base de datos, se despliegan en dos topologías distintas. En desarrollo se ejecutan en un equipo local con Docker Desktop y docker-compose, con datos ficticios y sin proxy TLS ni respaldos. En producción se ejecutan en el VPS, con NGINX en la zona pública, la red interna y el respaldo diario. Además, las seis capas lógicas se materializan en solo cuatro contenedores de aplicación, lo que confirma que la relación entre la vista lógica y la física no es uno a uno.

**Figura 11**

*Despliegue en desarrollo y en producción*

[figura: figuras/fig11-despliegue-dev-prod.png]

*Nota*. Elaboración propia.

## **6.3. Modelo de datos** {#6.3.-modelo-de-datos}

El modelo de datos se diseñó como un diagrama entidad-relación de 19 entidades, implementable en PostgreSQL. La Tabla 7 agrupa las entidades por dominio. El diseño parte de la concepción del sistema de tramitación como un registro trazable del ciclo de vida del expediente (Kalucza y Sievert, 2024; Marian et al., 2025): el expediente es la entidad central y todas las acciones sobre él quedan vinculadas a su historial.

**Tabla 7**

*Entidades del modelo de datos agrupadas por dominio*

| Dominio | Entidades | Propósito |
| :---- | :---- | :---- |
| Familia y postulante | Apoderado, Postulante, Postulante\_Apoderado, Consentimiento, Cuenta\_Acceso | Identificación de la familia, consentimiento informado y acceso al portal |
| Expediente y requisitos | Expediente, Grado, Requisito\_Documental, Documento, Cuestionario\_Expectativas | Configuración de la campaña por grado y contenido del expediente |
| Evaluación | Horario\_Disponible, Cita, Resultado\_Evaluacion, Dictamen\_Admision | Agenda, resultado de cada evaluación y dictamen final |
| Pagos y resultado | Pago, Carta\_Vacante | Derecho de admisión, cuota de ingreso y carta de vacante |
| Trazabilidad y seguridad | Notificacion, Registro\_Auditoria, Personal | Comunicaciones, historial de estados y usuarios internos por rol |

*Nota*. Elaboración propia.

Siete reglas de diseño se reflejan en el modelo:

* Restricciones de unicidad sobre el DNI, el usuario de acceso, el correo del personal y el número de operación de cada pago, que impiden registrar dos veces un mismo comprobante.  
* Unicidad de la cita por persona responsable, fecha y hora, que evita la doble reserva de un mismo horario.  
* El atributo categoría de Requisito\_Documental distingue la documentación financiera, visible solo para Tesorería, y el atributo condición de aplicación indica si un documento se exige a todos, solo a quienes estudiaron en otro colegio del Perú o solo a quienes declararon una condición especial.  
* Grado almacena la configuración de cada campaña: vacantes autorizadas y disponibles, evaluaciones requeridas, monto de la cuota de ingreso y número máximo de fracciones.  
* Resultado\_Evaluacion registra el resultado de cada cita (jornada de observación, evaluación psicológica, evaluación académica o entrevista), mientras que Dictamen\_Admision registra una sola decisión por expediente.  
* Pago.numero\_fraccion distingue el pago único o la primera fracción, cuya conciliación dispara la emisión de la carta, de las fracciones posteriores.  
* Registro\_Auditoria guarda el estado anterior y el nuevo de cada transición, lo que asegura la trazabilidad del expediente (Marian et al., 2025\) y permite aplicar minería de procesos para medir tiempos por etapa (Li et al., 2025).

**Figura 12**

*Diagrama entidad-relación del sistema de tramitación*

[figura no incluida: el DER vigente es docs/der/modelo-datos.md]  

*Nota*. Elaboración propia.

## **6.4. Diseño de las interfaces de usuario** {#6.4.-diseño-de-las-interfaces-de-usuario}

Se diseñaron 19 prototipos de alta fidelidad en formato de escritorio (1440 px de ancho). El sistema es web y puede usarse desde cualquier dispositivo, pero se priorizó la computadora como dispositivo de referencia. Los prototipos aplican la identidad visual del CIL: azul marino (\#10326E) para la estructura y las acciones principales, dorado (\#E9BD23) para los acentos y el elemento activo, y amarillo claro (\#FEE05B) para los avisos. Emplean la tipografía Fraunces en los títulos y Public Sans en el texto. Los datos que aparecen son ficticios, y los valores que el colegio aún debe definir figuran entre corchetes, como los horarios, el número máximo de fracciones y la escala de la evaluación académica.

Las interfaces se organizan en dos áreas: el portal de familias y la gestión interna. En la gestión interna, la navegación lateral muestra solo las opciones del rol que inició sesión. Dos principios guiaron el diseño. El primero son las vistas de resumen y los tableros, porque la usabilidad y la calidad de la información son los predictores más fuertes de la utilidad que perciben quienes deciden sobre casos (Tynkkynen et al., 2026). El segundo es la reducción de la carga administrativa del solicitante mediante la digitalización y el rediseño del formulario (Kalucza y Sievert, 2024). Cada pantalla muestra además los estados relevantes del trámite (conforme, en revisión, observado y pendiente). La Tabla 8 presenta el inventario completo.

**Tabla 8**

*Inventario de interfaces del sistema de tramitación*

| Código | Pantalla | Usuario | Propósito |
| :---- | :---- | :---- | :---- |
| P01 | Solicitud de información y consentimiento | Familia | Registrar el interés con consentimiento informado |
| P02 | Agendamiento de visita guiada | Familia | Elegir día y horario disponibles |
| P03 | Acceso al portal de postulación | Familia | Ingresar con las credenciales enviadas tras la visita |
| P04 | Panel de seguimiento | Familia | Consultar el avance, las acciones pendientes y el historial |
| P05 | Ficha de inscripción y cuestionario | Familia | Registrar datos del postulante con guardado como borrador |
| P06 | Carga y subsanación de documentos | Familia | Cargar los documentos exigidos según el grado y subsanar observaciones |
| P07 | Registro de comprobantes de pago | Familia | Registrar el derecho de admisión y la cuota de ingreso (única o fraccionada) |
| P08 | Agendamiento de evaluaciones | Familia | Elegir turnos para las citas que exige el grado |
| G01 | Acceso del personal | Personal | Ingresar al sistema según el rol asignado |
| G02 | Bandeja de expedientes | Secretaría | Priorizar los expedientes completos por revisar |
| G03 | Detalle del expediente | Secretaría | Validar u observar documentos |
| G04 | Visitas guiadas | Secretaría | Registrar la asistencia y habilitar el portal |
| G05 | Validaciones de Tesorería | Tesorería | Validar pagos y revisar la documentación financiera |
| G06 | Agenda y dictámenes | Psicóloga | Registrar evaluaciones, entrevista y dictamen |
| G07 | Adjudicación de vacantes | Directora | Asignar vacantes según el inventario por grado |
| G08 | Tablero de indicadores | Directora | Monitorear el embudo, el lead time y el cycle time |
| G09 | Configuración de la campaña | Secretaría | Definir grados, vacantes, evaluaciones, requisitos, cuota y horarios |
| G10 | Usuarios y roles | Directora | Crear, modificar y desactivar cuentas del personal |
| G11 | Evaluaciones académicas | Evaluador académico | Registrar el resultado o la inasistencia |

*Nota*. Elaboración propia.

### ***6.4.1. Portal de familias*** {#6.4.1.-portal-de-familias}

**P01.** La familia registra sus datos de contacto y el grado de interés. El envío exige marcar el consentimiento para el tratamiento de datos conforme a la Ley N.° 29733; sin él no se almacena ningún dato.

**Figura 13**

*Solicitud de información y consentimiento informado*

[prototipo: ver docs/ui/]*Nota*. Elaboración propia.

**P02**. Un calendario resalta los días con horarios disponibles e indica los cupos restantes por horario. La pantalla muestra también el estado de un horario que acaba de completarse.

**Figura 14**

*Agendamiento de la visita guiada*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**P03**. La familia ingresa con las credenciales temporales recibidas después de la visita; en el primer ingreso se le solicita crear una contraseña nueva.

**Figura 15**

*Acceso al portal de postulación*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**P04.** Muestra el avance en seis etapas, las acciones pendientes con acceso directo a la pantalla que las resuelve y el historial del expediente, de modo que la familia no necesita llamar al colegio para conocer el estado de su trámite.

**Figura 16**

*Panel de seguimiento de la postulación*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**P05.** Formulario en cuatro pasos con guardado automático como borrador. Las respuestas sobre el colegio de procedencia y la condición especial determinan los documentos que se exigirán después.

**Figura 17**

*Ficha de inscripción y cuestionario de expectativas*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**P06.** Agrupa los documentos en tres secciones: postulante y padres, colegio de procedencia y documentación financiera, esta última revisada solo por Tesorería. Cada documento indica si está conforme, en revisión u observado, y el motivo de la observación.

**Figura 18**

*Carga y subsanación de documentos*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**P07.** Presenta el derecho de admisión ya validado y el registro de la cuota de ingreso del nivel, con la elección entre pago único o fraccionado y los datos del comprobante.

**Figura 19**

*Registro de comprobantes de pago*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**P08.** Muestra solo las citas que exige el grado del postulante; en el ejemplo, 3.° de primaria requiere evaluación académica, evaluación psicológica y entrevista a los padres.

**Figura 20**

*Agendamiento de evaluaciones según el grado*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

### ***6.4.2. Gestión interna*** {#6.4.2.-gestión-interna}

**G01.** Acceso exclusivo para el personal. Las cuentas las crea la Dirección y cada rol ve solo las opciones que le corresponden.

**Figura 21**

*Acceso del personal*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**G02.** Lista los expedientes con filtros por estado, grado y antigüedad. Solo muestra expedientes que el sistema ya verificó como completos, lo que elimina la revisión manual de requisitos faltantes.

**Figura 22**

*Bandeja de expedientes de secretaría*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**G03.** Permite marcar cada documento como conforme u observado y redactar el motivo que recibirá la familia. La documentación financiera y el informe psicopedagógico aparecen bloqueados para este rol.

**Figura 23**

*Detalle del expediente y validación documental*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**G04.** Presenta las visitas del día; al registrar la asistencia y el interés de la familia, el sistema crea su cuenta y habilita el portal de postulación.

**Figura 24**

*Agenda de visitas y registro de asistencia*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**G05.** Reúne los pendientes de Tesorería (derecho de admisión, documentación financiera y cuota de ingreso) y permite verificar cada documento contra lo exigido antes de marcarlo como conforme u observado.

**Figura 25**

*Validaciones de Tesorería*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**G06.** Muestra la agenda con los distintos tipos de cita y el estado de cada componente de la evaluación, incluido el resultado académico, antes de habilitar el dictamen confidencial.

**Figura 26**

*Agenda de Psicología y registro del dictamen*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**G07.** Presenta los postulantes aptos y el inventario de vacantes por grado; si el grado no tiene vacantes, la asignación se bloquea y se ofrece la lista de espera.

**Figura 27**

*Adjudicación de vacantes*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**G08.** Muestra el embudo de admisión, el lead time y el cycle time por etapa, calculados a partir del registro de auditoría. Las cifras del prototipo son ilustrativas.

**Figura 28**

*Tablero de indicadores*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**G09.** Define por grado las vacantes, las evaluaciones requeridas y la cuota de ingreso, además de los requisitos documentales con su condición de aplicación. Impide fijar menos vacantes que las ya adjudicadas.

**Figura 29**

*Configuración de la campaña*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**G10.** Permite crear, modificar y desactivar cuentas del personal, y presenta la matriz de permisos por rol.

**Figura 30**

*Usuarios y roles*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

**G11.** Presenta las citas del día y el formulario de resultado, que queda disponible para la Psicóloga. El Evaluador académico no accede al informe psicológico ni a la documentación financiera.

**Figura 31**

*Registro de la evaluación académica*

[prototipo: ver docs/ui/]

*Nota*. Elaboración propia.

## **6.5. Coherencia entre los artefactos de diseño** {#6.5.-coherencia-entre-los-artefactos-de-diseño}

Las decisiones de diseño se reflejan de forma consistente en los cuatro artefactos. La Tabla 9 muestra dónde se materializa cada una, lo que permite verificar que el proceso, la arquitectura, los datos y las interfaces describen el mismo sistema.

**Tabla 9**

*Materialización de las decisiones de diseño en los artefactos*

| Decisión de diseño | Proceso To-Be | Arquitectura | Modelo de datos | Interfaces |
| :---- | :---- | :---- | :---- | :---- |
| Validaciones en paralelo | Compuerta paralela con tres ramas | Flujo de verificación y servicio de expedientes | Estados documental y financiero en Expediente | P04, G03, G05 |
| Evaluaciones según el nivel | Compuerta por nivel y evaluación académica desde 2.° de primaria | Actor Evaluador académico; flujo de agendamiento | Grado, Cita, Resultado\_Evaluacion, Dictamen\_Admision | P08, G06, G11 |
| Documentación financiera restringida | Rama de revisión por Tesorería | Objeto de datos de acceso exclusivo; servicio de autorización | Categoría financiera en Requisito\_Documental | P06, G05, G10 |
| Auditoría centralizada | Registro de cada transición | Servicio de auditoría en la capa de servicios | Registro\_Auditoria | G08 |
| Carta al conciliar el primer pago | Conciliación previa a la generación de la carta | Flujo de generación de carta | Pago.numero\_fraccion, Carta\_Vacante | P04, P07, G05 |
| Seguimiento programado | Participante con evento temporizado | Evento programado diario; flujo de seguimiento | Notificacion | P04 |
| Configuración por campaña | Parámetros de vacantes, requisitos y horarios | Módulo de gestión interna | Grado, Requisito\_Documental, Horario\_Disponible | G09 |
