// Genera el documento que el colegio aprueba antes de que se abra el sistema a las familias (C85): `npm run colegio:textos` (raíz del
// repo). Corre en el host, sin base de datos ni .env: usa un entorno ficticio, así que el resultado depende solo del código.
//   npm run colegio:textos                      → usa db/campanas/plantilla-2027.json
//   npm run colegio:textos -- <archivo.json>    → la hoja «Campaña» muestra ese archivo (el que el colegio firma)
// Escribe en docs/colegio/: textos-para-el-colegio-v<N>.xlsx y carta-de-vacante-ejemplo-v<N>.pdf. Sube VERSION_DOCUMENTO (en
// textosColegioCatalogo.ts) cuando se envíe una ronda nueva; el archivo de una versión anterior queda como constancia.
// El plazo de respuesta del colegio se cuenta desde el día en que se genera: si el documento se envía otro día, vuelve a generarlo ese día.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const clave = () => randomBytes(32).toString("base64");

// Lo único que cambia lo que dicen los textos es la URL pública, la dirección, las horas de anticipación y los plazos; el resto solo
// satisface la validación de la configuración. Los plazos no se fijan: valen los provisionales del código (config.ts).
for (const nombre of Object.keys(process.env)) if (nombre.startsWith("PLAZO_")) delete process.env[nombre];
Object.assign(process.env, {
  POSTGRES_HOST: "ejemplo",
  POSTGRES_PORT: "5432",
  ADMISION_DB: "admision",
  ADMISION_DB_USER: "ejemplo",
  ADMISION_DB_PASSWORD: "ejemplo",
  KEYCLOAK_PUBLIC_URL: "https://identidad.ejemplo.test",
  KEYCLOAK_INTERNAL_URL: "http://keycloak:8080",
  KEYCLOAK_REALM: "cil-admision",
  KEYCLOAK_API_CLIENT_ID: "api-admision",
  KEYCLOAK_API_CLIENT_SECRET: "ejemplo",
  FRONTEND_PUBLIC_URL: "https://admision.ejemplo.test",
  DATA_ENCRYPTION_KEY: clave(),
  DATA_HMAC_KEY: clave(),
  INTERNAL_API_TOKEN: randomBytes(32).toString("hex"),
  CAMPANA_ACTIVA: "2027",
  N8N_WEBHOOK_INTERNAL_URL: "http://n8n:5678/webhook",
  N8N_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
  ENLACE_VISITA_KEY: clave(),
  CARPETA_INFORMATIVA_URL: "",
  RECORDATORIO_VISITA_HORAS: "24",
  DIRECCION_COLEGIO: "",
  CORREO_ADMISION: "admision@ejemplo.test",
  CORREO_TESORERIA: "tesoreria@ejemplo.test",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: "ejemplo",
  REPROGRAMACION_MIN_HORAS: "24",
  ARCHIVOS_ENCRYPTION_KEY: clave(),
  ARCHIVOS_ENCRYPTION_KEY_ANTERIOR: "",
});

const { generarPdfCarta } = await import("../src/services/plantillaCarta");
const { construirCatalogo, VERSION_DOCUMENTO } = await import("./textosColegioCatalogo");
const { construirLibro, DIAS_PLAZO, fechaLarga, huellaDelContenido, leerCampanaParaVista, sumarDiasHabiles } = await import("./textosColegioLibro");
const { ahoraEnLima, leerFeriados } = await import("./agendaGenerador");

function versionDelCodigo(): string {
  try {
    const git = (...argumentos: string[]) => execFileSync("git", argumentos, { cwd: RAIZ, encoding: "utf8" }).trim();
    const commit = git("rev-parse", "--short", "HEAD");
    return git("status", "--porcelain", "--untracked-files=no") === "" ? commit : `${commit} (con cambios sin confirmar)`;
  } catch {
    return "sin información de git";
  }
}

const generado = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "long", timeStyle: "short" }).format(new Date());

// npm corre los scripts de un workspace dentro de api/: una ruta relativa se lee desde donde se invocó npm (INIT_CWD).
const rutaCampana = process.argv[2] ? resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2]) : join(RAIZ, "db", "campanas", "plantilla-2027.json");
const campana = leerCampanaParaVista(readFileSync(rutaCampana, "utf8"), basename(rutaCampana));
const catalogo = construirCatalogo();
// Los días hábiles se cuentan desde hoy (hora de Lima) sin los feriados de api/scripts/feriados.json, los mismos de dev:agenda.
const plazo = fechaLarga(sumarDiasHabiles(ahoraEnLima().fecha, DIAS_PLAZO, leerFeriados()));
const libro = await construirLibro(catalogo, campana, { version: VERSION_DOCUMENTO, generado, commit: versionDelCodigo(), plazo });

// La carta de ejemplo: la misma plantilla que emite el sistema, con datos y firma ficticios.
const carta = await generarPdfCarta({
  codigo: "ADM-2027-0001",
  fechaEmision: new Date(),
  postulante: "Postulante Ejemplo",
  nivel: "primaria",
  grado: "1.° de primaria",
  campana: "2027",
  directora: "Directora Ejemplo",
  firma: readFileSync(join(RAIZ, "api", "scripts", "firma-ficticia-dev.png")),
});

const carpeta = join(RAIZ, "docs", "colegio");
mkdirSync(carpeta, { recursive: true });
const archivoLibro = join(carpeta, `textos-para-el-colegio-v${VERSION_DOCUMENTO}.xlsx`);
const archivoCarta = join(carpeta, `carta-de-vacante-ejemplo-v${VERSION_DOCUMENTO}.pdf`);
writeFileSync(archivoLibro, libro);
writeFileSync(archivoCarta, carta);

const bloquean = catalogo.filter((t) => t.familia).length;
const cuenta = (tipo: string) => catalogo.filter((t) => t.aprobacion === tipo).length;
console.log(`Versión ${VERSION_DOCUMENTO} · huella ${huellaDelContenido(catalogo)} · ${catalogo.length} textos (${bloquean} bloquean abrir a las familias).`);
console.log(`Plazo de respuesta: hasta el ${plazo} (${DIAS_PLAZO} días hábiles). Sin respuesta: ${cuenta("por_defecto")} filas se toman como aprobadas, ${cuenta("respuesta")} no, y ${cuenta("firma")} exigen firma (más la campaña).`);
console.log(`Campaña: ${campana.campana}, ${campana.grados.length} grados, ${campana.requisitos.length} requisitos (${campana.completa ? "completa" : "con datos por completar"}).`);
console.log(`Escrito: ${archivoLibro}`);
console.log(`Escrito: ${archivoCarta}`);
