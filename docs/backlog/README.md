# Índice del Product Backlog

25 HU, 4 épicas. Cada ficha contiene el texto literal del backlog. La columna *Pantallas* remite a los mockups de `docs/ui/` (ver su README). La columna *Flujo* es una propuesta derivada del TI (Tabla 5): confirmarla en el plan de cada HU.

## EPICA0001

Automatizar la captación de prospectos, la visita guiada y el acceso de las familias al portal de postulación.

| HU | Rol | Funcionalidad | Pantallas | Flujo n8n | Escenarios |
|---|---|---|---|---|---|
| [HU0001](HU0001.md) | Padre de familia postulante | registrar mis datos de contacto inicial (nombres, teléfono, correo electrónico y grado de interés) y otorga… | P01 (Main) | captacion | 3 |
| [HU0002](HU0002.md) | Personal de admisión | distribuir automáticamente la carpeta informativa digital de admisión por correo electrónico y mensajería i… | G04 (contacto no entregado) | captacion, notificacion-multicanal | 2 |
| [HU0003](HU0003.md) | Padre de familia postulante | agendar de forma autónoma una fecha y horario disponible para la visita guiada personalizada en las instala… | P02 | agendamiento | 2 |
| [HU0004](HU0004.md) | Personal de admisión | registrar la asistencia y conformidad de la visita guiada personalizada | G04 | captacion | 2 |
| [HU0023](HU0023.md) | Padre de familia postulante | ingresar al portal de postulación con las credenciales temporales recibidas tras la visita guiada | P03, P03b, P03c | captacion | 2 |

## EPICA0002

Digitalizar la postulación y centralizar la verificación de completitud y las validaciones en paralelo del expediente.

| HU | Rol | Funcionalidad | Pantallas | Flujo n8n | Escenarios |
|---|---|---|---|---|---|
| [HU0005](HU0005.md) | Padre de familia postulante | registrar en línea la ficha de inscripción del estudiante y el cuestionario de expectativas familiares resp… | P05, P05b | recepcion-registro | 2 |
| [HU0006](HU0006.md) | Padre de familia postulante | adjuntar en formato digital los documentos que exige el grado del menor, organizados en documentos del post… | P06 | recepcion-registro | 2 |
| [HU0007](HU0007.md) | Padre de familia postulante | registrar el comprobante de pago por derecho de admisión (S/ 300) mediante el formulario digital | P07b | recepcion-registro | 2 |
| [HU0008](HU0008.md) | Personal de admisión | validar la legibilidad y conformidad de los documentos del expediente en la bandeja de revisión | G02, G03 | verificacion-completitud (rama validación) | 2 |
| [HU0011](HU0011.md) | Personal de tesorería | revisar la documentación financiera presentada por los padres de familia postulantes, sin consultar central… | G05 | verificacion-completitud (rama validación) | 2 |
| [HU0017](HU0017.md) | Personal de admisión | que el sistema verifique automáticamente la completitud del expediente según el grado y lo declarado en la … | P06 (resultado) | verificacion-completitud | 2 |
| [HU0024](HU0024.md) | Personal de tesorería | validar el comprobante de pago del derecho de admisión (S/ 300) contra los movimientos de la cuenta bancari… | G05 | verificacion-completitud (rama validación) | 2 |

## EPICA0003

Coordinar las evaluaciones según el nivel, la adjudicación de vacantes y la cuota de ingreso.

| HU | Rol | Funcionalidad | Pantallas | Flujo n8n | Escenarios |
|---|---|---|---|---|---|
| [HU0009](HU0009.md) | Padre de familia postulante | seleccionar los turnos de las evaluaciones que exige el grado del menor (jornada de observación, evaluación… | P08 | agendamiento | 2 |
| [HU0010](HU0010.md) | Profesional de psicología | registrar los resultados de las evaluaciones a mi cargo y emitir el dictamen de admisión (Apto, En observac… | G06 | (API) + notificacion-multicanal | 3 |
| [HU0012](HU0012.md) | Dirección de admisión | asignar formalmente la vacante escolar al estudiante evaluado | G07 | (API) + notificacion-multicanal | 2 |
| [HU0013](HU0013.md) | Padre de familia postulante | elegir la modalidad de pago de la cuota de ingreso (pago único o fraccionado) según el monto establecido pa… | P07 | (API) | 2 |
| [HU0014](HU0014.md) | Padre de familia postulante | cargar el comprobante del pago único o de la primera fracción de la cuota de ingreso en el portal de admisión | P07 | (API) | 2 |
| [HU0015](HU0015.md) | Personal de tesorería | conciliar el abono de la cuota de ingreso contra los movimientos de la cuenta bancaria del colegio | G05 | (API) -> generacion-carta | 2 |
| [HU0025](HU0025.md) | Evaluador académico | registrar el resultado de la evaluación académica del postulante o su inasistencia | G11 | (API) | 2 |

## EPICA0004

Emitir la carta de vacante, dar seguimiento al trámite y gestionar la configuración, los accesos y los indicadores del proceso.

| HU | Rol | Funcionalidad | Pantallas | Flujo n8n | Escenarios |
|---|---|---|---|---|---|
| [HU0016](HU0016.md) | Personal de admisión | emitir automáticamente la Carta de Vacante en formato PDF con la firma escaneada de la Directora | P04 (descarga) | generacion-carta | 2 |
| [HU0018](HU0018.md) | Personal de admisión | distribuir recordatorios automatizados por correo electrónico y WhatsApp ante acciones pendientes y vencimi… | (sin pantalla; flujo) | seguimiento-recordatorios, notificacion-multicanal | 2 |
| [HU0019](HU0019.md) | Dirección del colegio | visualizar un tablero con el embudo de admisión, el lead time y el cycle time por etapa y la ocupación de v… | G08 | (API, sin flujo) | 2 |
| [HU0020](HU0020.md) | Padre de familia postulante | consultar el avance de mi postulación, las acciones pendientes y el historial del expediente en un panel de… | P04 | (API, sin flujo) | 2 |
| [HU0021](HU0021.md) | Dirección del colegio | crear, modificar y desactivar las cuentas del personal y asignarles un rol (secretaría, Tesorería, psicólog… | G01, G10 | (API, sin flujo) | 2 |
| [HU0022](HU0022.md) | Personal de admisión | configurar por campaña los grados, las vacantes, las evaluaciones requeridas, los requisitos documentales c… | G09 | (API, sin flujo) | 2 |
