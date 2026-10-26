// Importa los workflows de n8n/workflows/*.json en el n8n del proyecto (ADR-06) por la API pública:
//   1. Resuelve cada credencial por su NOMBRE EXACTO (nunca por tipo). Falla si no existe, si hay más de
//      una con ese nombre (ambigüedad) o si su tipo no es el que espera el nodo.
//   2. Resuelve POR NOMBRE el Error Workflow de cada flujo (settings.errorWorkflow) y el flujo que llama cada nodo
//      Execute Workflow: el repo guarda nombres, la instancia IDs (ADR-06, HU0002). Falla si el nombre no existe.
//   3. Crea o actualiza el workflow (identificado por nombre) y lo publica (activa). n8n 2.x guarda el PUT como
//      borrador: hay que publicarlo para que corra esa versión, y un Error Workflow sin versión publicada no se puede
//      elegir. Verifica que la versión publicada sea la importada (activeVersionId = versionId).
//   4. Verifica en la instancia que cada nodo quedó con la credencial que declara el repo.
//   5. Exporta el estado real de la instancia al repo, con nombres en lugar de IDs y sin campos propios de la instancia.
// Importa en orden de dependencias: registro-errores, notificacion-multicanal y luego el resto. Si falla uno del que
// dependen otros, no importa los siguientes (un flujo nuevo no queda activo llamando a una versión vieja).
// Usa N8N_CIL_API_URL y N8N_CIL_API_KEY (variables de Windows, las mismas del MCP). No imprime secretos.
// Uso: node scripts/importar-workflows.mjs [nombre-del-flujo ...]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { RAIZ } from "./lib/keycloak.mjs";

const FLUJOS_TI = new Set([
  "captacion",
  "recepcion-registro",
  "verificacion-completitud",
  "agendamiento",
  "generacion-carta",
  "notificacion-multicanal",
  "seguimiento-recordatorios",
]);
// Workflows técnicos que no cuentan entre los 7 del TI (C2, ADR-06).
const FLUJOS_TECNICOS = new Set(["registro-errores"]);
// Los que otros flujos referencian van primero (el Error Workflow y el subflujo de notificaciones).
const ORDEN = ["registro-errores", "notificacion-multicanal"];
const posicion = (nombre) => (ORDEN.includes(nombre) ? ORDEN.indexOf(nombre) : ORDEN.length);

const EXECUTE_WORKFLOW = "n8n-nodes-base.executeWorkflow";
const DIR = resolve(RAIZ, "n8n/workflows");

const URL_N8N = process.env.N8N_CIL_API_URL?.replace(/\/$/, "");
const CLAVE = process.env.N8N_CIL_API_KEY;
if (!URL_N8N || !CLAVE) {
  console.error("Faltan N8N_CIL_API_URL o N8N_CIL_API_KEY en el entorno (ver GUIA-INSTALACION.md §3).");
  process.exit(2);
}

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(`${URL_N8N}/api/v1${ruta}`, {
    method: metodo,
    headers: { "X-N8N-API-KEY": CLAVE, accept: "application/json", ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`n8n ${metodo} ${ruta}: HTTP ${res.status} ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

async function listarTodo(ruta) {
  const todos = [];
  let cursor;
  do {
    const sep = ruta.includes("?") ? "&" : "?";
    const pagina = await api("GET", `${ruta}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    todos.push(...pagina.data);
    cursor = pagina.nextCursor;
  } while (cursor);
  return todos;
}

// ---------- credenciales: solo por nombre exacto ----------
const credenciales = await listarTodo("/credentials");

function resolverCredencial(tipo, nombre, contexto) {
  const coinciden = credenciales.filter((c) => c.name === nombre);
  if (coinciden.length === 0) {
    throw new Error(`Falta la credencial «${nombre}» (${tipo}) que usa ${contexto}. Créala en n8n (GUIA-INSTALACION.md §3).`);
  }
  if (coinciden.length > 1) {
    throw new Error(`Hay ${coinciden.length} credenciales llamadas «${nombre}»: es ambiguo, deja solo una.`);
  }
  if (coinciden[0].type !== tipo) {
    throw new Error(`La credencial «${nombre}» es de tipo ${coinciden[0].type}, pero ${contexto} espera ${tipo}.`);
  }
  return coinciden[0];
}

function referenciasDeCredenciales(flujo) {
  const refs = [];
  for (const nodo of flujo.nodes) {
    for (const [tipo, ref] of Object.entries(nodo.credentials ?? {})) {
      if (ref.id) throw new Error(`El nodo «${nodo.name}» trae un id de credencial en el repo: solo se admite el nombre (ADR-06).`);
      if (!ref.name) throw new Error(`El nodo «${nodo.name}» no indica el nombre de su credencial ${tipo}.`);
      refs.push({ nodo: nodo.name, tipo, nombre: ref.name });
    }
  }
  return refs;
}

// ---------- referencias entre workflows: por nombre en el repo, por ID en la instancia ----------
// idPorNombre: Map nombre → id de los workflows de la instancia (se completa a medida que se crean).
function idDe(idPorNombre, nombre, contexto) {
  const id = idPorNombre.get(nombre);
  if (!id) throw new Error(`${contexto} referencia al workflow «${nombre}», que no existe en n8n: impórtalo primero.`);
  return id;
}

function referenciasParaInstancia(flujo, idPorNombre) {
  const settings = { ...(flujo.settings ?? {}) };
  if (settings.errorWorkflow) settings.errorWorkflow = idDe(idPorNombre, settings.errorWorkflow, "settings.errorWorkflow");
  const nodes = flujo.nodes.map((nodo) => {
    if (nodo.type !== EXECUTE_WORKFLOW) return nodo;
    const ref = nodo.parameters?.workflowId;
    const nombre = ref?.cachedResultName;
    if (!ref?.__rl || !nombre || ref.value !== nombre) {
      throw new Error(`El nodo «${nodo.name}» debe nombrar su flujo en workflowId (value = cachedResultName = nombre del flujo).`);
    }
    const workflowId = { __rl: true, mode: "list", value: idDe(idPorNombre, nombre, `El nodo «${nodo.name}»`), cachedResultName: nombre };
    return { ...nodo, parameters: { ...nodo.parameters, workflowId } };
  });
  return { nodes, settings };
}

function nombreDe(nombrePorId, id, contexto) {
  const nombre = nombrePorId.get(id);
  if (!nombre) throw new Error(`${contexto} apunta al workflow ${id}, que no está en la instancia.`);
  return nombre;
}

function referenciasParaRepo(w, nombrePorId) {
  const settings = { ...(w.settings ?? {}) };
  if (settings.errorWorkflow) settings.errorWorkflow = nombreDe(nombrePorId, settings.errorWorkflow, "settings.errorWorkflow");
  const nodes = w.nodes.map((nodo) => {
    if (nodo.type !== EXECUTE_WORKFLOW || !nodo.parameters?.workflowId?.__rl) return nodo;
    const nombre = nombreDe(nombrePorId, nodo.parameters.workflowId.value, `El nodo «${nodo.name}»`);
    // Sin cachedResultUrl: lleva el ID de la instancia.
    const workflowId = { __rl: true, mode: "list", value: nombre, cachedResultName: nombre };
    return { ...nodo, parameters: { ...nodo.parameters, workflowId } };
  });
  return { nodes, settings };
}

function paraInstancia(flujo, idPorNombre) {
  const { nodes: conReferencias, settings } = referenciasParaInstancia(flujo, idPorNombre);
  const nodes = conReferencias.map((nodo) => {
    if (!nodo.credentials) return nodo;
    const credentials = Object.fromEntries(
      Object.entries(nodo.credentials).map(([tipo, ref]) => {
        const c = resolverCredencial(tipo, ref.name, `el nodo «${nodo.name}»`);
        return [tipo, { id: c.id, name: c.name }];
      }),
    );
    return { ...nodo, credentials };
  });
  return { name: flujo.name, nodes, connections: flujo.connections, settings };
}

// Estado real de la instancia, sin IDs de credenciales ni de otros workflows, ni campos propios de la instancia.
function paraRepo(w, nombrePorId) {
  const { nodes: conNombres, settings } = referenciasParaRepo(w, nombrePorId);
  const nodes = conNombres.map((nodo) =>
    nodo.credentials
      ? { ...nodo, credentials: Object.fromEntries(Object.entries(nodo.credentials).map(([t, r]) => [t, { name: r.name }])) }
      : nodo,
  );
  return { name: w.name, nodes, connections: w.connections, settings };
}

const publicado = (w) => w.active && w.activeVersionId === w.versionId;

// ---------- importación ----------
const pedidos = process.argv.slice(2);
const archivos = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => !pedidos.length || pedidos.includes(f.replace(/\.json$/, "")))
  .sort((a, b) => posicion(a.replace(/\.json$/, "")) - posicion(b.replace(/\.json$/, "")) || a.localeCompare(b));
if (!archivos.length) {
  console.error("No hay workflows que importar.");
  process.exit(2);
}

const existentes = await listarTodo("/workflows?excludePinnedData=true");
// Nombres repetidos en la instancia: ambiguos, no se resuelven (falla el flujo que los use).
const idPorNombre = new Map();
for (const w of existentes) idPorNombre.set(w.name, existentes.filter((x) => x.name === w.name).length === 1 ? w.id : undefined);
const nombrePorId = new Map(existentes.map((w) => [w.id, w.name]));
let fallos = 0;

for (const archivo of archivos) {
  const nombreArchivo = archivo.replace(/\.json$/, "");
  try {
    const flujo = JSON.parse(readFileSync(resolve(DIR, archivo), "utf8"));
    if (!FLUJOS_TI.has(flujo.name) && !FLUJOS_TECNICOS.has(flujo.name)) {
      throw new Error(`«${flujo.name}» no es uno de los 7 flujos del TI ni un workflow técnico aprobado.`);
    }
    if (flujo.name !== nombreArchivo) throw new Error(`el nombre del workflow («${flujo.name}») no coincide con el archivo.`);

    const refs = referenciasDeCredenciales(flujo);
    const cuerpo = paraInstancia(flujo, idPorNombre); // falla aquí si falta o es ambigua una credencial o un workflow

    const mismos = existentes.filter((w) => w.name === flujo.name);
    if (mismos.length > 1) throw new Error(`hay ${mismos.length} workflows llamados «${flujo.name}» en n8n: es ambiguo.`);

    let id;
    if (mismos.length === 1) {
      id = mismos[0].id;
      await api("PUT", `/workflows/${id}`, cuerpo);
      console.log(`${flujo.name}: actualizado (id ${id})`);
    } else {
      id = (await api("POST", "/workflows", cuerpo)).id;
      console.log(`${flujo.name}: creado (id ${id})`);
      idPorNombre.set(flujo.name, id);
      nombrePorId.set(id, flujo.name);
    }

    let instancia = await api("GET", `/workflows/${id}?excludePinnedData=true`);
    if (!publicado(instancia)) {
      await api("POST", `/workflows/${id}/activate`);
      instancia = await api("GET", `/workflows/${id}?excludePinnedData=true`);
    }
    console.log(`${flujo.name}: activo = ${instancia.active ? "sí" : "NO"}, versión publicada = ${publicado(instancia) ? "la importada" : "OTRA"}`);
    if (!publicado(instancia)) throw new Error("n8n no publicó la versión importada.");

    // Verificación: cada nodo de la instancia tiene exactamente la credencial que declara el repo.
    let credencialesOk = true;
    for (const r of refs) {
      const esperada = resolverCredencial(r.tipo, r.nombre, `el nodo «${r.nodo}»`);
      const real = instancia.nodes.find((n) => n.name === r.nodo)?.credentials?.[r.tipo];
      const ok = real?.id === esperada.id && real?.name === esperada.name;
      credencialesOk &&= ok;
      console.log(`  ${ok ? "✔" : "✘"} «${r.nodo}»: ${r.tipo} = ${real?.name ?? "(ninguna)"}${ok ? "" : ` (se esperaba «${r.nombre}»)`}`);
    }
    if (!credencialesOk) throw new Error("hay nodos con una credencial distinta de la declarada en el repo.");

    writeFileSync(resolve(DIR, archivo), `${JSON.stringify(paraRepo(instancia, nombrePorId), null, 2)}\n`);
    console.log(`${flujo.name}: exportado al repo desde la instancia`);
  } catch (e) {
    fallos++;
    console.error(`✘ ${nombreArchivo}: ${e.message}`);
    if (ORDEN.includes(nombreArchivo)) {
      console.error(`Se detiene la importación: otros flujos dependen de «${nombreArchivo}».`);
      break;
    }
  }
}

process.exit(fallos ? 1 : 0);
