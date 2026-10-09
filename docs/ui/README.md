# Mockups aprobados (23 pantallas)

Son copias de los artboards del lienzo «Mockups – Sistema de Admisión CIL» (claude.ai, versión del 08/10/2026), en el formato `.dc.html` del lienzo.

- **Para Claude Code son la fuente de verdad visual.** Usa sus campos, etiquetas, textos, estados, colores y tipografías.
- **No se pueden abrir sueltos en el navegador.** Dependen del motor del lienzo (`support.js`) y el logo apunta a `/_blob/…`, que solo existe ahí. Para ver el diseño, abre el lienzo. El logo real del colegio se agrega al frontend como un recurso propio.
- Los valores entre corchetes (`[por definir]`) son configuración o datos que el colegio aún no define. No se fijan en el código.
- Los datos que muestran (familia Quispe Rojas, ADM-2027-0142, etc.) son ficticios y solo ilustran.

## Índice

| Código | Archivo | Pantalla | Usuario | HU |
|---|---|---|---|---|
| P01 | `Main.dc.html` | Solicitud de información y consentimiento (con autorización opcional de WhatsApp) | Familia | HU0001 |
| P02 | `P02-Visita.dc.html` | Agendamiento de visita guiada (cupo individual, nombres de asistentes) | Familia | HU0003 |
| P03 | `P03-Acceso.dc.html` | Acceso al portal (tema de login de Keycloak) | Familia | HU0023 |
| P03b | `P03b-NuevaContrasena.dc.html` | Crear contraseña nueva en el primer ingreso (tema de Keycloak) | Familia | HU0023-1.0 |
| P03c | `P03c-CuentaBloqueada.dc.html` | Cuenta bloqueada tras 5 intentos (tema de Keycloak) | Familia | HU0023-2.0 |
| P04 | `P04-Panel.dc.html` | Panel de seguimiento | Familia | HU0020, HU0016 |
| P05 | `P05-Ficha.dc.html` | Ficha, paso 1 · Datos del postulante | Familia | HU0005 |
| P05b | `P05b-DatosPadres.dc.html` | Ficha, paso 2 · Datos de los padres (DNI y condición laboral) | Familia | HU0005 |
| P06 | `P06-Documentos.dc.html` | Carga y subsanación de documentos | Familia | HU0006, HU0017 |
| P07 | `P07-Pagos.dc.html` | Pagos: cuota de ingreso | Familia | HU0013, HU0014 |
| P07b | `P07b-DerechoAdmision.dc.html` | Registro del derecho de admisión (formulario, error de duplicado y constancia) | Familia | HU0007 |
| P08 | `P08-Evaluaciones.dc.html` | Agendamiento de evaluaciones según el grado | Familia | HU0009 |
| G01 | `G01-Acceso.dc.html` | Acceso del personal (tema de login de Keycloak) | Personal | HU0021 |
| G02 | `G02-Bandeja.dc.html` | Bandeja de expedientes | Secretaría | HU0008, HU0017 |
| G03 | `G03-Expediente.dc.html` | Detalle del expediente y validación documental | Secretaría | HU0008 |
| G04 | `G04-Visitas.dc.html` | Visitas guiadas, registro de asistencia y prospectos con contacto no entregado | Secretaría | HU0004, HU0002-2.0 |
| G05 | `G05-Tesoreria.dc.html` | Validaciones de Tesorería | Tesorería | HU0011, HU0015, HU0024 |
| G06 | `G06-Psicologia.dc.html` | Agenda de Psicología y dictamen | Psicóloga | HU0010 |
| G07 | `G07-Vacantes.dc.html` | Adjudicación de vacantes | Directora | HU0012 |
| G08 | `G08-Indicadores.dc.html` | Tablero de indicadores | Directora | HU0019 |
| G09 | `G09-Configuracion.dc.html` | Configuración de la campaña | Secretaría | HU0022 |
| G10 | `G10-Usuarios.dc.html` | Usuarios y roles | Directora | HU0021 |
| G11 | `G11-EvalAcademica.dc.html` | Evaluación académica | Evaluador académico | HU0025 |

`canvas.json` no se copia: es el índice interno del lienzo.

## Identidad visual (TI 6.4)

| Uso | Color |
|---|---|
| Estructura y acciones principales | azul marino `#10326E` |
| Acentos y elemento activo | dorado `#E9BD23` |
| Avisos | amarillo claro `#FEE05B` |

Tipografías: Fraunces para los títulos y Public Sans para el texto. Los mockups también usan neutros y colores de estado (por ejemplo, conforme `#1E6B47` y observado `#8A4B08`); tómalos de los archivos.
