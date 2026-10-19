// Genera docs/evidencias/matriz-trazabilidad.md: HU → escenario → prueba → resultado (compromiso C1, ADR-09).
// Uso: npm run evidencias:matriz            (corre test:api, test:front y test:e2e; el E2E necesita dev levantado)
//      npm run evidencias:matriz -- --sin-e2e (no corre el E2E: sus pruebas figuran como «no ejecutada»)
// La salida de cada suite se muestra completa; además se guarda un reporte JSON en test-results/trazabilidad/.
// Una prueba cubre un escenario si su título empieza con el ID exacto (p. ej. «HU0021-1.0 …»). Las pruebas del
// Sprint 0 (S0-*) y las de soporte (G10, G01, C19…) cuentan en los totales, pero no se asignan a escenarios.
// Termina con código 1 si alguna prueba falla, si una suite no genera reporte o si un ID no existe en el backlog;
// la matriz se escribe igual.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..");
const SIN_E2E = process.argv.includes("--sin-e2e");
const DIR_REPORTES = resolve(RAIZ, "test-results", "trazabilidad");
const SALIDA = resolve(RAIZ, "docs", "evidencias", "matriz-trazabilidad.md");
const MARCA_C17 = "[política, ruta de prueba]";
const ID = /^(HU\d{4}-\d+\.\d+)(?=\s|$)/;

// ---------------------------------------------------------------- escenarios del backlog
const hus = [];
const escenarios = new Map();
for (const archivo of readdirSync(resolve(RAIZ, "docs", "backlog")).filter((f) => /^HU\d{4}\.md$/.test(f)).sort()) {
  const texto = readFileSync(resolve(RAIZ, "docs", "backlog", archivo), "utf8");
  const titulo = texto.match(/^# (HU\d{4}) — (.+)$/m);
  const hu = { id: titulo[1], titulo: titulo[2].trim(), escenarios: [] };
  for (const m of texto.matchAll(/^### (HU\d{4}-\d+\.\d+) — (.+)$/gm)) {
    const esc = { id: m[1], titulo: m[2].trim(), hu: hu.id, pruebas: [] };
    hu.escenarios.push(esc);
    escenarios.set(esc.id, esc);
  }
  hus.push(hu);
}

// ---------------------------------------------------------------- ejecución de las suites
rmSync(DIR_REPORTES, { recursive: true, force: true });
mkdirSync(DIR_REPORTES, { recursive: true });
const rutaReporte = (nombre) => resolve(DIR_REPORTES, `${nombre}.json`).replaceAll("\\", "/");

function correr(titulo, args, env = {}) {
  console.log(`\n========== ${titulo} ==========\n`);
  // En Windows npm es un .cmd: hace falta la shell. Las rutas del repo no tienen espacios.
  const r = spawnSync("npm", args, { cwd: RAIZ, stdio: "inherit", env: { ...process.env, ...env }, shell: process.platform === "win32" });
  return r.status ?? 1;
}

const vitest = (workspace) => [
  "run", "test", "--workspace", workspace, "--",
  "--reporter=verbose", "--reporter=json", `--outputFile.json=${rutaReporte(workspace)}`,
];
correr("API (Vitest)", vitest("api"));
correr("Frontend (Vitest)", vitest("frontend"));
if (SIN_E2E) {
  // Solo lista las pruebas, sin ejecutarlas, para marcarlas como «no ejecutada».
  correr("E2E (Playwright, solo listado)", ["run", "test", "--workspace", "e2e", "--", "--list", "--reporter=json"], {
    PLAYWRIGHT_JSON_OUTPUT_FILE: rutaReporte("e2e"),
  });
} else {
  correr("E2E (Playwright)", ["run", "test", "--workspace", "e2e", "--", "--reporter=list,json"], {
    PLAYWRIGHT_JSON_OUTPUT_FILE: rutaReporte("e2e"),
  });
}

// ---------------------------------------------------------------- lectura de los reportes
const suites = [];
const pruebas = [];
const rel = (archivo) => relative(RAIZ, archivo).replaceAll("\\", "/");

function leerVitest(nombre, etiqueta, carpeta) {
  const ruta = rutaReporte(nombre);
  const suite = { etiqueta, generada: existsSync(ruta), total: 0, pasan: 0, fallan: 0, omitidas: 0 };
  suites.push(suite);
  if (!suite.generada) return;
  const reporte = JSON.parse(readFileSync(ruta, "utf8"));
  for (const archivo of reporte.testResults) {
    for (const a of archivo.assertionResults) {
      const resultado = a.status === "passed" ? "pasó" : a.status === "failed" ? "falló" : "omitida";
      pruebas.push({ suite: etiqueta, archivo: rel(archivo.name.startsWith(".") ? resolve(RAIZ, carpeta, archivo.name) : archivo.name), titulo: a.title, resultado });
    }
  }
}

function leerPlaywright(etiqueta) {
  const ruta = rutaReporte("e2e");
  const suite = { etiqueta, generada: existsSync(ruta), total: 0, pasan: 0, fallan: 0, omitidas: 0 };
  suites.push(suite);
  if (!suite.generada) return;
  const reporte = JSON.parse(readFileSync(ruta, "utf8"));
  const raizPruebas = reporte.config?.rootDir ?? resolve(RAIZ, "e2e");
  const recorrer = (s) => {
    for (const spec of s.specs ?? []) {
      const estados = (spec.tests ?? []).map((t) => (t.results?.length ? t.status : "no_ejecutada"));
      const resultado = estados.includes("unexpected")
        ? "falló"
        : estados.every((e) => e === "no_ejecutada")
          ? "no ejecutada"
          : estados.every((e) => e === "skipped")
            ? "omitida"
            : estados.includes("flaky")
              ? "pasó (inestable)"
              : "pasó";
      pruebas.push({ suite: etiqueta, archivo: rel(resolve(raizPruebas, spec.file)), titulo: spec.title, resultado });
    }
    for (const hija of s.suites ?? []) recorrer(hija);
  };
  for (const s of reporte.suites ?? []) recorrer(s);
}

leerVitest("api", "API", "api");
leerVitest("frontend", "Frontend", "frontend");
leerPlaywright("E2E");

for (const s of suites) {
  const deSuite = pruebas.filter((p) => p.suite === s.etiqueta);
  s.total = deSuite.length;
  s.pasan = deSuite.filter((p) => p.resultado.startsWith("pasó")).length;
  s.fallan = deSuite.filter((p) => p.resultado === "falló").length;
  s.omitidas = s.total - s.pasan - s.fallan;
}

// ---------------------------------------------------------------- asignación a escenarios
const idsDesconocidos = new Set();
for (const p of pruebas) {
  const id = p.titulo.match(ID)?.[1];
  if (!id) continue;
  const esc = escenarios.get(id);
  if (esc) esc.pruebas.push(p);
  else idsDesconocidos.add(`${id} («${p.titulo}», ${p.archivo})`);
}

const ESTADO_C17 = "mecanismo probado; verificación en ruta real pendiente (C17)";
function estadoDe(esc) {
  if (!esc.pruebas.length) return "sin prueba";
  if (esc.pruebas.some((p) => p.resultado === "falló")) return "con fallas";
  const ejecutadas = esc.pruebas.filter((p) => p.resultado.startsWith("pasó"));
  if (!ejecutadas.length) return "no ejecutado";
  if (ejecutadas.every((p) => p.titulo.includes(MARCA_C17))) return ESTADO_C17;
  return "cubierto";
}

// ---------------------------------------------------------------- escritura
const celda = (t) => String(t).replaceAll("|", "\\|");
const git = (...args) => execFileSync("git", args, { cwd: RAIZ, encoding: "utf8" }).trim();
const commit = git("rev-parse", "--short", "HEAD");
const conCambios = git("status", "--porcelain", "--", ".", `:(exclude)${rel(SALIDA)}`) !== "";
const fecha = new Date().toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" });

const todosLosEscenarios = hus.flatMap((h) => h.escenarios);
const conteo = new Map();
for (const e of todosLosEscenarios) conteo.set(estadoDe(e), (conteo.get(estadoDe(e)) ?? 0) + 1);
const conPrueba = todosLosEscenarios.filter((e) => e.pruebas.length).length;

const md = [];
md.push("# Matriz de trazabilidad (HU → escenario → prueba → resultado)", "");
md.push(
  `> Generada con \`npm run evidencias:matriz${SIN_E2E ? " -- --sin-e2e" : ""}\` el ${fecha} (America/Lima) sobre el commit ` +
    `\`${commit}\`${conCambios ? " **con cambios sin commit**" : ""}. No se edita a mano.`,
  "",
);
md.push("## Resumen", "", "| Suite | Pruebas | Pasan | Fallan | Omitidas o no ejecutadas |", "|---|---|---|---|---|");
for (const s of suites) {
  md.push(s.generada ? `| ${s.etiqueta} | ${s.total} | ${s.pasan} | ${s.fallan} | ${s.omitidas} |` : `| ${s.etiqueta} | — | — | — | sin reporte (la suite no se ejecutó o falló al arrancar) |`);
}
md.push(
  "",
  `- Escenarios del backlog: **${todosLosEscenarios.length}** en ${hus.length} HU; con al menos una prueba: **${conPrueba}**.`,
  `- Estados: ${[...conteo].map(([estado, n]) => `${estado}: ${n}`).join(" · ")}.`,
  "- Las pruebas del Sprint 0 (`S0-*`) y las de soporte (`G10`, `G01`, `C19`…) cuentan en los totales, pero no se asignan a escenarios.",
  `- «${ESTADO_C17}»: todas las pruebas del escenario llevan la marca \`${MARCA_C17}\` (compromiso C17).`,
);
if (idsDesconocidos.size) {
  md.push("", "**IDs de prueba que no existen en el backlog:**", "", ...[...idsDesconocidos].map((x) => `- ${celda(x)}`));
}

const husConPruebas = hus.filter((h) => h.escenarios.some((e) => e.pruebas.length));
const husSinPruebas = hus.filter((h) => !h.escenarios.some((e) => e.pruebas.length));

md.push("", "## HU con pruebas");
for (const h of husConPruebas) {
  md.push("", `### ${h.id} — ${celda(h.titulo)}`, "", "| Escenario | Estado | Suite | Archivo | Prueba | Resultado |", "|---|---|---|---|---|---|");
  for (const e of h.escenarios) {
    if (!e.pruebas.length) {
      md.push(`| ${e.id} — ${celda(e.titulo)} | sin prueba | | | | |`);
      continue;
    }
    e.pruebas.forEach((p, i) => {
      const cabeza = i === 0 ? `${e.id} — ${celda(e.titulo)} | ${estadoDe(e)}` : " | ";
      md.push(`| ${cabeza} | ${p.suite} | \`${p.archivo}\` | ${celda(p.titulo)} | ${p.resultado} |`);
    });
  }
}

md.push("", "## HU sin pruebas", "", "| HU | Escenario | Estado |", "|---|---|---|");
for (const h of husSinPruebas) {
  for (const e of h.escenarios) md.push(`| ${h.id} | ${e.id} — ${celda(e.titulo)} | sin prueba |`);
}
md.push("");

writeFileSync(SALIDA, md.join("\n"));

// ---------------------------------------------------------------- resultado
const fallas = suites.reduce((n, s) => n + s.fallan, 0);
const sinReporte = suites.filter((s) => !s.generada).map((s) => s.etiqueta);
console.log(`\nMatriz escrita en ${rel(SALIDA)}`);
for (const s of suites) console.log(`  ${s.etiqueta}: ${s.generada ? `${s.total} pruebas, ${s.pasan} pasan, ${s.fallan} fallan, ${s.omitidas} omitidas o no ejecutadas` : "sin reporte"}`);
console.log(`  Escenarios con prueba: ${conPrueba} de ${todosLosEscenarios.length}`);
for (const h of husConPruebas) for (const e of h.escenarios) console.log(`  ${e.id}: ${estadoDe(e)}`);
if (idsDesconocidos.size) console.log(`  IDs desconocidos: ${[...idsDesconocidos].join("; ")}`);
if (fallas || sinReporte.length || idsDesconocidos.size) {
  console.log(`\nTermina con error: ${fallas} prueba(s) fallida(s)${sinReporte.length ? `; sin reporte: ${sinReporte.join(", ")}` : ""}${idsDesconocidos.size ? "; IDs desconocidos" : ""}`);
  process.exit(1);
}
