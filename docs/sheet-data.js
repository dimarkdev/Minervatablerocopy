/* =====================================================================
   Carga en vivo de datos desde Google Sheets (reemplaza el JSON embebido)
   =====================================================================
   Tres hojas publicadas como CSV ("Archivo > Compartir > Publicar en la
   web", una publicación por pestaña). Completá SHEET_URLS con los 3
   links que genera Google al publicar cada pestaña — cada uno tiene la
   forma:
     https://docs.google.com/spreadsheets/d/e/XXXXX/pub?output=csv
   ===================================================================== */
const SHEET_URLS = {
  pedidos: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZuBhRWAQwypAUAEFuMLzBhWKebAfplgFbPjiLEZWlWI6Pk1iWv_tkbUyuWjD5ksSK8S9VWHWiopd1/pub?gid=0&single=true&output=csv',
  envasados: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZuBhRWAQwypAUAEFuMLzBhWKebAfplgFbPjiLEZWlWI6Pk1iWv_tkbUyuWjD5ksSK8S9VWHWiopd1/pub?gid=1111883916&single=true&output=csv',
  clasterizacion: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZuBhRWAQwypAUAEFuMLzBhWKebAfplgFbPjiLEZWlWI6Pk1iWv_tkbUyuWjD5ksSK8S9VWHWiopd1/pub?gid=921398392&single=true&output=csv',
  // gid real de "CARNICERIA" tras la reestructuración de la hoja (confirmado
  // por Di: docs.google.com/spreadsheets/d/10eRhklodmpFSvbS7VBQAxjoEU4_xVwEeQTCC3TPH-P4/edit?gid=967361718).
  // OJO: el link "pub?output=csv" de este documento no respeta el gid si la
  // publicación quedó fijada a una sola pestaña -- confirmar en "Publicar en
  // la web > Contenido publicado y configuración" que CARNICERIA esté tildada.
  carniceria: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZuBhRWAQwypAUAEFuMLzBhWKebAfplgFbPjiLEZWlWI6Pk1iWv_tkbUyuWjD5ksSK8S9VWHWiopd1/pub?gid=967361718&single=true&output=csv',
  // gid de la pestaña "MARCAS-COMPE" (docs.google.com/spreadsheets/d/10eRhklodmpFSvbS7VBQAxjoEU4_xVwEeQTCC3TPH-P4/edit?gid=821862696).
  marcasCompe: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZuBhRWAQwypAUAEFuMLzBhWKebAfplgFbPjiLEZWlWI6Pk1iWv_tkbUyuWjD5ksSK8S9VWHWiopd1/pub?gid=821862696&single=true&output=csv',
  // Panel "Vigencia de Stock" (Quiebres/Faltantes + Vencimientos). Tres
  // pestañas nuevas, mismas columnas pero contenido distinto -- ver
  // extractStockRows / extractFaltantesRows / extractVencidosRows.
  stock: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZuBhRWAQwypAUAEFuMLzBhWKebAfplgFbPjiLEZWlWI6Pk1iWv_tkbUyuWjD5ksSK8S9VWHWiopd1/pub?gid=847145876&single=true&output=csv',
  faltantes: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZuBhRWAQwypAUAEFuMLzBhWKebAfplgFbPjiLEZWlWI6Pk1iWv_tkbUyuWjD5ksSK8S9VWHWiopd1/pub?gid=99694216&single=true&output=csv',
  vencidos: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZuBhRWAQwypAUAEFuMLzBhWKebAfplgFbPjiLEZWlWI6Pk1iWv_tkbUyuWjD5ksSK8S9VWHWiopd1/pub?gid=1471317173&single=true&output=csv',
};

const VENTANA_DIAS = 90; // "últimos 3 meses" — ventana móvil, se recalcula en cada carga
const OUTLIER_MIN = 43950;
const OUTLIER_MAX = 158039;
const PROPIO_PREFIXES = ['PUL', 'ESTANCIA 92']; // marcas propias de Minerva (Pul, Pul Regular, Pul Selección, Estancia 92, Estancia 92 Angus)
const JUNK_MARCAS = new Set(['QUIEBRE TOTAL', 'QUIEBRE', 'SELECCIÓN', 'SELECCION', '']);
// Variantes de escritura de la misma marca -- confirmadas con el cliente,
// para que no aparezcan separadas en "Detalle de competencia".
const MARCA_ALIASES = [
  { match: k => k.startsWith('BRAFORD'), display: 'Victoria' },
  { match: k => k.startsWith('NELORE ESTRELLITA') || k.startsWith('ESTRELLITA'), display: 'Nelore' },
];
function resolveMarcaAlias(marcaKey, fallbackDisplay){
  const alias = MARCA_ALIASES.find(a => a.match(marcaKey));
  return alias ? alias.display : fallbackDisplay;
}
// Cadenas que Envasados sí trae, pero de las que no tenemos maestro en
// Clasterización (no hay forma de saber a qué categoría/PDV pertenecen).
// Biggie es la única hoy -- se sigue excluyendo del cruce con Clasterización
// (cobertura por categoría, universo priorizado), pero se muestra con su
// propio nombre en vez de agruparse como "Otros / Independiente": Di la
// audita como cadena propia y necesita verla separada, no perderla en un
// balde genérico.
const CADENAS_SIN_MAESTRO = new Set(['BIGGIE']);
const DIAS_SEMANA = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

/* ---------------- utilidades ---------------- */
function normKey(s){ return String(s==null?'':s).trim().replace(/\s+/g,' ').toUpperCase(); }
/* Clave para cruzar Envasados/Pedidos (LOCAL / PUNTO DE VENTA) contra
   Clasterización (PDV): el mismo local se escribe distinto en cada
   hoja -- Envasados usa "ARETE - PINEDO" (con guion), Clasterización
   usa "ARETE PINEDO" (sin guion); y Superseis se abrevia "S6" en
   Clasterización pero se escribe "SUPERSEIS" en Envasados/Pedidos. */
function normJoinKey(s){
  let k = normKey(s).replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim();
  k = k.replace(/^SUPERSEIS\b/, 'S6');
  return k;
}
function normDisplay(s){
  const t = String(s==null?'':s).trim().replace(/\s+/g,' ');
  return t.replace(/\p{L}+/gu, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
function isPropioMarca(marcaKey){ return PROPIO_PREFIXES.some(p => marcaKey.startsWith(p)); }
function toNum(v){
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // el CSV exporta los numeros de Sheets en notacion estandar (punto = decimal,
  // sin separador de miles) -- ej. "64350.0" es 64350, no 6.435.000
  const n = parseFloat(String(v).trim());
  return Number.isFinite(n) ? n : null;
}
/* La columna FECHA de Envasados mezcla celdas de fecha real (que el CSV
   exporta como YYYY-MM-DD...) con celdas de texto tipo "21/5/2026,
   4:36:16 PM" (día/mes/año, formato AR/PY) -- el Date() nativo de JS
   asume mes/día (EEUU) y con eso el 60%+ de las fechas quedaba inválida
   o, peor, mal interpretada en silencio para días <=12. Se parsea
   explícito día/mes antes de caer al parser nativo. */
function parseDateFlexible(v){
  if (!v) return null;
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[, ]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
  if (dmy) {
    let [, day, month, year, hh, mm, ss, ampm] = dmy;
    day = +day; month = +month; year = +year;
    hh = hh ? +hh : 0; mm = mm ? +mm : 0; ss = ss ? +ss : 0;
    if (ampm) {
      const pm = /p/i.test(ampm);
      if (pm && hh < 12) hh += 12;
      if (!pm && hh === 12) hh = 0;
    }
    const d = new Date(year, month - 1, day, hh, mm, ss);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/* ---------------- parser CSV (soporta comillas y comas dentro de campos) ---------------- */
function parseCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i], next = text[i+1];
    if (inQuotes){
      if (ch === '"' && next === '"'){ field += '"'; i++; }
      else if (ch === '"'){ inQuotes = false; }
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ','){ row.push(field); field = ''; }
      else if (ch === '\r'){ /* ignore */ }
      else if (ch === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
  }
  if (field.length || row.length){ row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(c => c !== '')).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? r[i].trim() : ''; });
    return obj;
  });
}

async function fetchCsv(url){
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) { console.error(`HTTP ${res.status} al leer ${url}`); throw new Error(`HTTP ${res.status} al leer los datos`); }
  const text = await res.text();
  return parseCSV(text);
}

/* ---------------- 1. CLASTERIZACIÓN → maestro de locales (universo total) ---------------- */
/* Ya no hace falta cruzar por nombre: Envasados y Pedidos traen su propia
   columna CADENA, y Envasados trae su propia columna CATEGORIA (Cat A/B/C/
   Cluster H). Clasterización se usa solo para saber el universo total de
   PDVs (total_locales / universo_priorizado) y como lista de cadenas conocidas. */
function buildLocalMap(rows){
  const map = new Map(); // normJoinKey(pdv) -> {cadena, categoria}
  const cadenaKeys = new Set();
  rows.forEach(r => {
    const pdv = normJoinKey(r['PDV'] || r['PUNTO DE VENTA']);
    if (!pdv) return;
    const cadena = normDisplay(r['CADENA'] || 'Otros / Independiente');
    const categoria = normKey(r['CATEGORIZACIÓN'] || r['CATEGORIZACION']);
    map.set(pdv, { cadena, categoria });
    cadenaKeys.add(normKey(cadena));
  });
  return { map, cadenaKeys };
}

/* Acepta tanto "CAT A/B/C" + "CLUSTER H" (nombres viejos) como
   "CLUSTER A/B/C/H" (nombres nuevos, mas legibles para demo). */
function categoriaLabel(catKey){
  if (catKey.startsWith('CAT A') || catKey.startsWith('CLUSTER A')) return { categoria:'Cat A', label:'Categoría A (prioridad alta)', prioridad:'alta' };
  if (catKey.startsWith('CLUSTER H')) return { categoria:'Cluster H', label:'Cluster H (prioridad alta)', prioridad:'alta' };
  if (catKey.startsWith('CAT B') || catKey.startsWith('CLUSTER B')) return { categoria:'Cat B', label:'Categoría B', prioridad:'media' };
  if (catKey.startsWith('CAT C') || catKey.startsWith('CLUSTER C')) return { categoria:'Cat C', label:'Categoría C', prioridad:'baja' };
  return { categoria:'Sin clasificar', label:'Sin clasificar (fuera del universo priorizado)', prioridad:'baja' };
}

/* ---------------- 2. ENVASADOS → precios propio/competencia ---------------- */
/* CADENA viene directo en cada fila. La categoría Cat A/B/C/Cluster H
   NO viene en Envasados (la columna CLASIFICACIÓN trae otra cosa:
   Biggie/General, un marcador de encuesta) — para eso se cruza LOCAL
   contra Clasterización.PDV. OJO: hoy ese cruce por nombre no coincide
   (0% de coincidencia exacta), ver buildCoberturaCategoria. */
function extractPriceRows(rows, windowStart, windowEnd){
  // Cadenas tal como aparecen en la columna CADENA de esta misma hoja, para
  // poder detectar cuándo el nombre del local ya trae la cadena real escrita
  // como prefijo (ej. "BOX - LUQUE") y esa columna quedó mal tipeada para esa
  // fila puntual. Hallazgo confirmado con Di: 154 filas (0,76% del total)
  // tenían la columna CADENA con una cadena distinta a la que el propio
  // nombre del local decía -- típico error de "se quedó en la fila anterior
  // del desplegable" al cargar. Punto de Venta es la unidad real para contar
  // sucursales; Cadena es solo una etiqueta de agrupación, así que cuando
  // hay conflicto se prioriza lo que dice el nombre del local.
  const cadenasConocidas = new Set();
  rows.forEach(r => { const k = normKey(r['CADENA']); if (k) cadenasConocidas.add(k); });

  const out = [];
  rows.forEach(r => {
    const fecha = parseDateFlexible(r['FECHA']);
    if (!fecha) return;
    const inWindow = fecha >= windowStart && fecha <= windowEnd;

    let corteRaw = '', marcaRaw = '', precio = null;
    if (r['CORTE']) {
      const parts = r['CORTE'].split(' - ');
      corteRaw = (parts[0] || '').trim();
      marcaRaw = (parts.slice(1).join(' - ') || '').trim();
      precio = toNum(r['PRECIO REGULAR']);
    } else if (r['CORTE NUEVO']) {
      corteRaw = r['CORTE NUEVO'].trim();
      marcaRaw = (r['MARCA CORTE NUEVO'] || '').trim();
      precio = toNum(r['PRECIO CORTE NUEVO']);
    } else {
      return;
    }
    const marcaKey = normKey(marcaRaw);
    if (!corteRaw || !marcaKey || JUNK_MARCAS.has(marcaKey)) return;
    if (precio == null || precio < OUTLIER_MIN || precio > OUTLIER_MAX) return;

    // La columna se llamaba "LOCAL" y Di la renombró a "PUNTO DE VENTA" (para
    // que coincida con el nombre que ya usa Carnicería) -- se prueban los dos
    // por si vuelve a cambiar.
    const localRaw = (r['PUNTO DE VENTA'] || r['LOCAL'] || '').trim();
    const prefijoLocal = localRaw.includes(' - ') ? normKey(localRaw.split(' - ')[0]) : '';
    const prefijoEsCadenaReal = prefijoLocal && cadenasConocidas.has(prefijoLocal);

    const cadenaKey = prefijoEsCadenaReal ? prefijoLocal : normKey(r['CADENA']);
    const cadenaOriginal = prefijoEsCadenaReal ? normDisplay(localRaw.split(' - ')[0]) : normDisplay(r['CADENA'] || '');
    // "Otros / Independiente" queda solo para cadena realmente vacía/desconocida.
    // Biggie (CADENAS_SIN_MAESTRO) conserva su nombre propio en la vista, aunque
    // sigue marcada como "sin maestro" para el cruce con Clasterización más abajo.
    const cadena = !cadenaKey ? 'Otros / Independiente' : cadenaOriginal;
    // Los valores de esta columna ya vienen casi siempre con el prefijo de
    // cadena incluido ("SUPERSEIS - SANBER"), pero se sigue anteponiendo la
    // cadena si todavía no la menciona (ej. Biggie, solo el nombre de la
    // calle: "KUBITSCHEK SEMINARIO").
    const localDisplay = (cadenaOriginal && !normKey(localRaw).startsWith(cadenaKey))
      ? `${cadenaOriginal} - ${localRaw}` : localRaw;

    out.push({
      fecha, inWindow,
      local: normKey(localDisplay),
      localJoinKey: normJoinKey(localRaw),
      localDisplay,
      cadena,
      corte: normDisplay(corteRaw),
      marca: resolveMarcaAlias(marcaKey, normDisplay(marcaRaw)),
      marcaKey,
      propio: isPropioMarca(marcaKey),
      precio,
    });
  });
  return out;
}


/* ---------------- 2b. CARNICERÍA → relevamiento en el canal carnicerías ---------------- */
/* Misma lógica de "corte nuevo" que Envasados, pero acá el CORTE no viene
   con marca embebida (es un local de carnicería, no un lineal de super) y
   la fila trae su propia columna CIUDAD/RELEVADOR en lugar de CADENA. */
/* Se devuelven también los "descartes" dentro de la ventana: filas que
   tenían corte/precio cargado pero se excluyeron por fecha ilegible o por
   precio fuera del rango plausible (OUTLIER_MIN/MAX, calibrado sobre
   Envasados). Sin esto, una fila descartada desaparece en silencio y no
   hay forma de saber por qué un corte nuevo cargado no aparece en el
   tablero -- ver nota junto a "Cortes nuevos detectados" en Carnicería. */
/* Estructura real de la hoja CARNICERIA reestructurada (confirmada con Di):
   FECHA, MES, DIA, MERCHANT, CADENA, PUNTO DE VENTA, CIUDAD, CORTE,
   PRECIO REGULAR, PRECIO OFERTA, NOMBRE CORTE ADICIONAL, PRECIO CORTE ADICIONAL.
   Ya no hay columna PDV ni MARCA CORTE NUEVO separadas -- se sacaron en la
   reestructuración. El parser de CSV (parseCSV) ya recorta espacios de los
   encabezados, así que "PRECIO REGULAR " en la hoja llega acá sin el espacio. */
function extractCarniceriaRows(rows, windowStart, windowEnd){
  const out = [];
  let fechaInvalida = 0, precioRegularFueraDeRango = 0, corteNuevoFueraDeRango = 0;
  rows.forEach(r => {
    const fechaRaw = (r['FECHA'] || '').trim();
    const fecha = parseDateFlexible(fechaRaw);
    if (!fecha) { if (fechaRaw) fechaInvalida++; return; }
    const inWindow = fecha >= windowStart && fecha <= windowEnd;
    const local = normDisplay((r['PUNTO DE VENTA'] || '').trim());
    const pdv = local;
    const ciudad = normDisplay((r['CIUDAD'] || '').trim());
    const relevador = normDisplay((r['MERCHANT'] || '').trim());
    const cadena = normDisplay((r['CADENA'] || '').trim()) || 'Sin cadena';

    const corteRaw = (r['CORTE'] || '').trim();
    const precioRegular = toNum(r['PRECIO REGULAR']);
    if (corteRaw && precioRegular != null) {
      if (precioRegular >= OUTLIER_MIN && precioRegular <= OUTLIER_MAX) {
        const precioOfertaRaw = toNum(r['PRECIO OFERTA']);
        // PRECIO OFERTA ahora viene en 0 (no vacío) cuando no hay oferta -- 0 no es un precio válido, se trata igual que "sin oferta".
        const precioOferta = (precioOfertaRaw != null && precioOfertaRaw > 0 && precioOfertaRaw >= OUTLIER_MIN && precioOfertaRaw <= OUTLIER_MAX) ? precioOfertaRaw : null;
        out.push({ fecha, inWindow, relevador, pdv, local, ciudad, cadena, corte: normDisplay(corteRaw), precio_regular: precioRegular, precio_oferta: precioOferta, es_nuevo: false });
      } else if (inWindow) precioRegularFueraDeRango++;
    }

    const corteNuevoRaw = (r['NOMBRE CORTE ADICIONAL'] || '').trim();
    const precioCorteNuevo = toNum(r['PRECIO CORTE ADICIONAL']);
    if (corteNuevoRaw && precioCorteNuevo != null) {
      if (precioCorteNuevo >= OUTLIER_MIN && precioCorteNuevo <= OUTLIER_MAX) {
        out.push({ fecha, inWindow, relevador, pdv, local, ciudad, cadena, corte: normDisplay(corteNuevoRaw), precio_regular: precioCorteNuevo, precio_oferta: null, es_nuevo: true });
      } else if (inWindow) corteNuevoFueraDeRango++;
    }
  });
  return { rows: out, descartes: { fecha_invalida: fechaInvalida, precio_regular_fuera_de_rango: precioRegularFueraDeRango, corte_nuevo_fuera_de_rango: corteNuevoFueraDeRango } };
}

/* Días de semana en que se detectaron ofertas en el mostrador de carnicería
   del súper (no sabemos de qué marca es cada precio -- solo que hay un
   PRECIO OFERTA cargado distinto del PRECIO REGULAR ese día). Sirve para
   ver si los súper concentran sus promos de carnicería en días fijos
   (ej. "jueves de descuento"), y así sugerir sincronizar ahí las promos
   de los cortes de Minerva, no solo en envasados. */
const DIAS_ORDEN = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
function buildOfertasPorDia(rows){
  const byDia = new Map(DIAS_ORDEN.map(d => [d, { total: 0, conOferta: 0, descuentos: [], cortes: new Map() }]));
  rows.forEach(x => {
    const g = byDia.get(DIAS_SEMANA[x.fecha.getDay()]);
    g.total++;
    if (x.precio_oferta != null && x.precio_oferta < x.precio_regular) {
      g.conOferta++;
      g.descuentos.push((1 - x.precio_oferta / x.precio_regular) * 100);
      g.cortes.set(x.corte, (g.cortes.get(x.corte) || 0) + 1);
    }
  });
  return DIAS_ORDEN.map(dia => {
    const g = byDia.get(dia);
    const descProm = g.descuentos.length ? g.descuentos.reduce((a,b) => a+b, 0) / g.descuentos.length : 0;
    return {
      dia,
      total: g.total,
      con_oferta: g.conOferta,
      tasa_oferta_pct: g.total ? Math.round((g.conOferta / g.total) * 1000) / 10 : 0,
      descuento_promedio_pct: Math.round(descProm * 10) / 10,
      top_cortes: [...g.cortes.entries()].sort((a,b) => b[1]-a[1]).slice(0,3).map(([c])=>c),
    };
  });
}

/* Patrones de oferta por CADENA de supermercado (columna real de la hoja
   Carnicería). Complementa con un índice por LOCAL individual, para
   detectar el caso "este local puntual promociona mucho más que el resto
   de su misma cadena" -- una lectura que se pierde si todo se mira
   agregado por cadena. */
function buildPatronesOferta(rows){
  const soloRegular = rows.filter(x => !x.es_nuevo && x.local);
  const inWin = soloRegular.filter(x => x.inWindow);

  const volPorCadena = new Map();
  inWin.forEach(x => volPorCadena.set(x.cadena, (volPorCadena.get(x.cadena) || 0) + 1));
  const topCadenas = [...volPorCadena.entries()].filter(([,n]) => n >= 5).sort((a,b) => b[1]-a[1]).map(([cadena]) => cadena);

  const matrizDias = topCadenas.map(cadena => ({
    cadena, dias: buildOfertasPorDia(inWin.filter(x => x.cadena === cadena)),
  }));

  const topCortesPorCadena = topCadenas.map(cadena => {
    const conOferta = inWin.filter(x => x.cadena === cadena && x.precio_oferta != null && x.precio_oferta < x.precio_regular);
    const cortes = new Map();
    conOferta.forEach(x => cortes.set(x.corte, (cortes.get(x.corte) || 0) + 1));
    return {
      cadena,
      top: [...cortes.entries()].sort((a,b) => b[1]-a[1]).slice(0,3).map(([corte,n]) => ({ corte, n })),
    };
  });

  // Índice de ofertas por local individual, comparado contra el promedio
  // de su propia cadena -- para detectar locales puntuales que ofertan
  // mucho más (o menos) que el resto de sus pares de la misma cadena.
  const tasaPorCadena = new Map(topCadenas.map(cadena => {
    const filas = inWin.filter(x => x.cadena === cadena);
    const conOferta = filas.filter(x => x.precio_oferta != null && x.precio_oferta < x.precio_regular).length;
    return [cadena, filas.length ? Math.round(conOferta/filas.length*1000)/10 : 0];
  }));
  const porLocalAgg = new Map();
  inWin.forEach(x => {
    if (!porLocalAgg.has(x.local)) porLocalAgg.set(x.local, { local: x.local, cadena: x.cadena, ciudad: x.ciudad, total: 0, conOferta: 0, cortes: new Map() });
    const g = porLocalAgg.get(x.local);
    g.total++;
    if (x.precio_oferta != null && x.precio_oferta < x.precio_regular) {
      g.conOferta++;
      g.cortes.set(x.corte, (g.cortes.get(x.corte) || 0) + 1);
    }
  });
  const indicePorLocal = [...porLocalAgg.values()]
    .filter(g => g.total >= 5)
    .map(g => {
      const tasa = Math.round(g.conOferta/g.total*1000)/10;
      const promedioCadena = tasaPorCadena.get(g.cadena) ?? null;
      return {
        local: normDisplay(g.local), cadena: g.cadena, ciudad: g.ciudad, total: g.total, con_oferta: g.conOferta,
        tasa_oferta_pct: tasa,
        promedio_cadena_pct: promedioCadena,
        vs_promedio_cadena_pct: promedioCadena != null ? Math.round((tasa - promedioCadena) * 10) / 10 : null,
        top_corte: [...g.cortes.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] || null,
      };
    })
    .sort((a,b) => b.tasa_oferta_pct - a.tasa_oferta_pct);

  // Historial completo (no solo la ventana de 90 días) para el filtro de fechas dinámico
  const historico = soloRegular.map(x => ({
    fecha: x.fecha.toISOString().slice(0,10), local: normDisplay(x.local), cadena: x.cadena, corte: x.corte,
    es_oferta: x.precio_oferta != null && x.precio_oferta < x.precio_regular,
  }));

  return { matriz_dias: matrizDias, top_cortes_por_cadena: topCortesPorCadena, indice_por_local: indicePorLocal, historico };
}

function buildCarniceria(rows){
  const inWin = rows.filter(x => x.inWindow);

  const byCorte = new Map();
  inWin.forEach(x => {
    if (!byCorte.has(x.corte)) byCorte.set(x.corte, { regular: [], oferta: [], n: 0 });
    const g = byCorte.get(x.corte);
    g.regular.push(x.precio_regular);
    if (x.precio_oferta != null) g.oferta.push(x.precio_oferta);
    g.n++;
  });
  const precioPorCorte = [...byCorte.entries()].map(([corte, g]) => {
    const r = minMax(g.regular), o = minMax(g.oferta);
    return { corte, regular_min: r.min, regular_max: r.max, oferta_min: o.min, oferta_max: o.max, n: g.n };
  }).sort((a,b) => b.n - a.n);

  const byCiudad = new Map();
  inWin.forEach(x => {
    if (!x.ciudad) return;
    if (!byCiudad.has(x.ciudad)) byCiudad.set(x.ciudad, { pdvs: new Set(), precios: [] });
    const g = byCiudad.get(x.ciudad);
    if (x.pdv) g.pdvs.add(x.pdv);
    g.precios.push(x.precio_regular);
  });
  const porCiudad = [...byCiudad.entries()].map(([ciudad, g]) => {
    const m = minMax(g.precios);
    return { ciudad, pdvs: g.pdvs.size, precio_min: m.min, precio_max: m.max, n: g.precios.length };
  }).sort((a,b) => b.pdvs - a.pdvs);

  // Se calcula sobre TODO el historial (no solo "inWin") para que el
  // selector de fechas propio de "Cortes nuevos detectados" pueda ampliar
  // más allá de la ventana móvil de 90 días -- el filtrado por fecha lo
  // hace el front al elegir el rango, no este cálculo.
  const cortesNuevos = rows.filter(x => x.es_nuevo).map(x => ({
    corte: x.corte, marca: x.marca_nuevo || '—', precio: x.precio_regular,
    pdv: x.pdv || x.local || '—', ciudad: x.ciudad || '—', fecha: x.fecha.toISOString().slice(0,10),
  })).sort((a,b) => b.fecha.localeCompare(a.fecha));

  const detalle = inWin.filter(x => !x.es_nuevo).map(x => ({
    fecha: x.fecha.toISOString().slice(0,10), relevador: x.relevador || '—', pdv: x.pdv || x.local || '—',
    ciudad: x.ciudad || '—', corte: x.corte, precio_regular: x.precio_regular, precio_oferta: x.precio_oferta,
  })).sort((a,b) => b.fecha.localeCompare(a.fecha)).slice(0, 300);

  const ofertasPorDia = buildOfertasPorDia(inWin.filter(x => !x.es_nuevo));
  const diasConMuestra = ofertasPorDia.filter(d => d.total >= 5); // día con muy pocos relevamientos no es representativo
  const mejorDia = diasConMuestra.length ? diasConMuestra.reduce((a,b) => b.tasa_oferta_pct > a.tasa_oferta_pct ? b : a) : null;

  return {
    total_relevamientos: inWin.length,
    pdvs_relevados: new Set(inWin.map(x=>x.pdv).filter(Boolean)).size,
    ciudades_cubiertas: new Set(inWin.map(x=>x.ciudad).filter(Boolean)).size,
    relevadores_activos: new Set(inWin.map(x=>x.relevador).filter(Boolean)).size,
    precio_por_corte: precioPorCorte,
    por_ciudad: porCiudad,
    cortes_nuevos: cortesNuevos,
    detalle,
    ofertas_por_dia: ofertasPorDia,
    mejor_dia_oferta: mejorDia,
    patrones_oferta: buildPatronesOferta(rows),
  };
}

function minMax(arr){ return arr.length ? { min: Math.min(...arr), max: Math.max(...arr) } : { min: null, max: null }; }
function pct(a, b){ return b ? Math.round((a / b) * 1000) / 10 : 0; }
function diferencial(ref, val){ return val ? Math.round(((ref - val) / val) * 1000) / 10 : 0; }

function buildPrecioPorCorte(priceRows){
  const byCorte = new Map();
  priceRows.forEach(x => {
    if (!x.inWindow) return;
    if (!byCorte.has(x.corte)) byCorte.set(x.corte, { propio: [], comp: [] });
    byCorte.get(x.corte)[x.propio ? 'propio' : 'comp'].push(x.precio);
  });
  const rows = [...byCorte.entries()].map(([corte, g]) => {
    const p = minMax(g.propio), c = minMax(g.comp);
    return {
      corte,
      propio_min: p.min, propio_max: p.max, comp_min: c.min, comp_max: c.max,
      // null (no 0) cuando falta alguno de los dos lados -- 0% significaría
      // "mismo precio", que es distinto de "no hay con qué comparar".
      diferencial_min_pct: (p.min != null && c.min != null) ? diferencial(p.min, c.min) : null,
      diferencial_max_pct: (p.max != null && c.max != null) ? diferencial(p.max, c.max) : null,
      n_propio: g.propio.length, n_competencia: g.comp.length,
    };
  }).filter(x => x.n_propio > 0 || x.n_competencia > 0);
  rows.sort((a,b) => (b.n_propio + b.n_competencia) - (a.n_propio + a.n_competencia));
  return rows;
}

function buildDetalle(priceRows, propio){
  const byKey = new Map();
  priceRows.forEach(x => {
    if (!x.inWindow || x.propio !== propio) return;
    const key = x.corte + '||' + x.marca;
    if (!byKey.has(key)) byKey.set(key, { corte: x.corte, marca: x.marca, precios: [] });
    byKey.get(key).precios.push(x.precio);
  });
  return [...byKey.values()].map(g => ({
    corte: g.corte, marca: g.marca,
    precio_min: Math.min(...g.precios), precio_max: Math.max(...g.precios), n: g.precios.length,
  }));
}

/* Un corte para el máximo y un corte para el mínimo, de cada lado -- sin
   restringir a ninguna familia en particular (a pedido de Di, versión
   simplificada de lo que antes era "cortes premium" con Tapa/Vacío/Costilla). */
function extremosPrecio(detalle){
  if (!detalle.length) return { max: null, min: null };
  const max = detalle.reduce((a,b) => b.precio_max > a.precio_max ? b : a);
  const min = detalle.reduce((a,b) => b.precio_min < a.precio_min ? b : a);
  return { max, min };
}

function buildPorLocal(priceRows){
  const byLocal = new Map();
  priceRows.forEach(x => {
    if (!x.inWindow || !x.local) return;
    if (!byLocal.has(x.local)) byLocal.set(x.local, { display: x.localDisplay, cadena: x.cadena, cortesPropio: new Set(), propio: [], comp: [] });
    const g = byLocal.get(x.local);
    if (x.propio) { g.cortesPropio.add(x.corte); g.propio.push(x.precio); }
    else g.comp.push(x.precio);
  });
  const rows = [...byLocal.entries()].map(([localKey, g]) => {
    const p = minMax(g.propio), c = minMax(g.comp);
    return {
      local: normDisplay(g.display), cadena: g.cadena,
      n_cortes_propio: g.cortesPropio.size,
      propio_min: p.min, propio_max: p.max, comp_min: c.min, comp_max: c.max,
    };
  }).filter(x => x.n_cortes_propio > 0);
  rows.sort((a,b) => b.n_cortes_propio - a.n_cortes_propio);
  return rows.slice(0, 80);
}

function buildMarcas(priceRowsAll, cadenaKeys){
  const byMarca = new Map();
  priceRowsAll.forEach(x => {
    if (!x.inWindow || x.propio) return;
    if (cadenaKeys.has(x.marcaKey)) return; // es cadena de super, no marca de carne (ej. Biggie, Salemma)
    if (!byMarca.has(x.marca)) byMarca.set(x.marca, { precios: [], locales: new Set(), cortes: new Map() });
    const g = byMarca.get(x.marca);
    g.precios.push(x.precio);
    if (x.local) g.locales.add(x.local);
    g.cortes.set(x.corte, (g.cortes.get(x.corte)||0) + 1);
  });
  const propioAll = priceRowsAll.filter(x => x.inWindow && x.propio).map(x => x.precio);
  const globalPropio = minMax(propioAll);
  let rows = [...byMarca.entries()].map(([marca, g]) => {
    const mm = minMax(g.precios);
    const topCortes = [...g.cortes.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);
    return {
      marca, locales: g.locales.size, precio_min: mm.min, precio_max: mm.max,
      diferencial_min_pct: (globalPropio.min != null && mm.min != null) ? diferencial(globalPropio.min, mm.min) : null,
      diferencial_max_pct: (globalPropio.max != null && mm.max != null) ? diferencial(globalPropio.max, mm.max) : null,
      top_cortes: topCortes,
    };
  }).filter(x => x.locales > 0);
  rows.sort((a,b) => b.locales - a.locales);
  const leader = rows[0] ? rows[0].locales : 1;
  rows.forEach(x => {
    const ratio = x.locales / leader;
    x.amenaza = ratio > 0.5 ? 'Alta' : (ratio >= 0.15 ? 'Media' : 'Baja');
  });
  return rows;
}

/* ---------------- 2b. MARCAS-COMPE → qué frigorífico/marca compite por cada corte ---------------- */
/* Tabla de referencia manual (no relevamiento): un corte por fila, con el
   texto libre de qué frigoríficos compiten en ese corte. La columna trae
   varios nombres juntos separados por coma/slash/"y" -- se listan como
   chips individuales para que se lea de un vistazo. */
/* Estructura real: dos columnas, COMPETENCIA (corte-marca de competencia) y
   FRIGO (el corte-marca propio equivalente) -- una fila por par. Se agrupa
   por FRIGO para armar "este corte propio compite con estas marcas". */
function buildMarcasCompe(rows){
  const agg = new Map();
  rows.forEach(r => {
    const frigo = normDisplay((r['FRIGO'] || '').trim());
    const competencia = normDisplay((r['COMPETENCIA'] || '').trim());
    if (!frigo || !competencia) return;
    if (!agg.has(frigo)) agg.set(frigo, new Set());
    agg.get(frigo).add(competencia);
  });
  return [...agg.entries()]
    .map(([corte, set]) => ({ corte, competidores: [...set] }))
    .sort((a,b) => b.competidores.length - a.competidores.length);
}

/* Diccionario corte -> familia canónica, armado directo desde MARCAS-COMPE
   en vez de adivinar por la primera palabra del nombre. Hace falta porque
   la tabla real tiene casos donde el nombre no se parece en nada (ej.
   "Ojo De Bife" compite con "Bife De Chorizo") y casos donde dos cortes
   arrancan igual pero son distintos (ej. "Colita" vs. "Colita De Cuadril").
   Tanto el corte de COMPETENCIA como el de FRIGO de cada fila se mapean a
   la familia canónica (el propio corte de FRIGO, tal como lo nombra
   Minerva) -- así un corte propio que ya coincide textualmente con FRIGO
   se resuelve directo, sin pasar por heurística. Si un corte (propio o de
   competencia) no aparece en esta tabla -- todavía no se cargó el par en
   MARCAS-COMPE -- cae a la primera palabra como aproximación. */
function buildCorteAlias(rows){
  const alias = new Map(); // normKey(corte) -> familia canónica (normKey)
  rows.forEach(r => {
    const competenciaCorte = (r['COMPETENCIA'] || '').split(' - ')[0].trim();
    const frigoCorte = (r['FRIGO'] || '').split(' - ')[0].trim();
    if (!frigoCorte) return;
    const familia = normKey(frigoCorte);
    alias.set(familia, familia);
    if (competenciaCorte) alias.set(normKey(competenciaCorte), familia);
  });
  return alias;
}
function familiaDeCorte(corte, alias){
  const k = normKey(corte);
  if (alias && alias.has(k)) return alias.get(k);
  // Respaldo si el corte todavía no está cargado tal cual en MARCAS-COMPE:
  // buscar alguna palabra significativa en común con una clave conocida del
  // diccionario, no solo la primera palabra -- necesario porque la palabra
  // que define la familia no siempre va primero (ej. "Recortes De Lomito"
  // comparte "LOMITO" con la clave "LOMITO", pero "Recortes" no dice nada).
  if (alias) {
    const STOP = new Set(['DE','DEL','LA','EL','LOS','LAS','Y']);
    const palabras = k.split(' ').filter(w => w && !STOP.has(w));
    for (const [aliasKey, familia] of alias){
      const palabrasAlias = aliasKey.split(' ').filter(w => w && !STOP.has(w));
      if (palabras.some(w => palabrasAlias.includes(w))) return familia;
    }
  }
  return k.split(' ')[0]; // último recurso: corte totalmente nuevo, sin ninguna palabra reconocible
}

/* ---------------- Vigencia de Stock (Quiebres/Faltantes + Vencimientos) ----------------
   Tres pestañas nuevas (Stock, Faltantes, Vencidos), mismas 15 columnas mas
   el contenido es distinto en cada una -- confirmado con Di:
   - STOCK: "Producto / Corte" viene poblado como "Corte - Marca".
   - FALTANTES: "Producto / Corte" viene VACÍO -- el corte, la marca y el
     motivo del faltante están todos metidos en "Observación", formato
     "Corte - Marca - Motivo" (ej. "Vacio - Pul Selección - Sin stock en depósito").
   - VENCIDOS: "Producto / Corte", "Cantidad" y "Vence" (fecha) vienen
     poblados directo, es la más limpia de las tres. */
function parseCorteMarca(texto){
  const partes = (texto || '').split(' - ').map(s => s.trim()).filter(Boolean);
  if (partes.length < 2) return { corte: normDisplay(partes[0] || ''), marca: '' };
  return { corte: normDisplay(partes[0]), marca: normDisplay(partes[1]) };
}
function parseFechaHora(fecha, hora){
  const f = parseDateFlexible(fecha);
  if (!f) return null;
  const [h, m] = (hora || '00:00').split(':').map(n => parseInt(n, 10) || 0);
  f.setHours(h, m, 0, 0);
  return f;
}

function extractStockRows(rows){
  return rows.map(r => {
    const fecha = parseFechaHora(r['Fecha'], r['Hora']);
    if (!fecha) return null;
    const { corte, marca } = parseCorteMarca(r['Producto / Corte']);
    if (!corte) return null;
    return {
      fecha, pdv: normDisplay(r['PDV'] || ''), canal: normDisplay(r['Canal'] || ''),
      promotor: normDisplay(r['Promotor'] || ''), corte, marca,
      cantidad: toNum(r['Cantidad']) || 0, ubicacion: normDisplay(r['Ubicación Stock'] || ''),
    };
  }).filter(Boolean);
}

function extractFaltantesRows(rows){
  return rows.map(r => {
    const fecha = parseFechaHora(r['Fecha'], r['Hora']);
    if (!fecha) return null;
    // "Corte - Marca - Motivo" viene todo junto en Observación.
    const partes = (r['Observación'] || '').split(' - ').map(s => s.trim()).filter(Boolean);
    if (partes.length < 2) return null;
    const corte = normDisplay(partes[0]);
    const marca = normDisplay(partes[1]);
    const motivo = partes.length >= 3 ? normDisplay(partes.slice(2).join(' - ')) : 'Sin motivo especificado';
    if (!corte) return null;
    return {
      fecha, pdv: normDisplay(r['PDV'] || ''), canal: normDisplay(r['Canal'] || ''),
      promotor: normDisplay(r['Promotor'] || ''), corte, marca, motivo,
    };
  }).filter(Boolean);
}

function extractVencidosRows(rows){
  return rows.map(r => {
    const fecha = parseFechaHora(r['Fecha'], r['Hora']);
    const fechaVence = parseDateFlexible(r['Vence']);
    if (!fecha || !fechaVence) return null;
    const { corte, marca } = parseCorteMarca(r['Producto / Corte']);
    if (!corte) return null;
    return {
      fecha, fecha_vence: fechaVence,
      pdv: normDisplay(r['PDV'] || ''), canal: normDisplay(r['Canal'] || ''),
      promotor: normDisplay(r['Promotor'] || ''), corte, marca,
      cantidad: toNum(r['Cantidad']) || 0,
    };
  }).filter(Boolean);
}

// Quiebres: se agrupa por motivo, por corte y por PDV -- todo sobre el
// total de filas cargadas en Faltantes (no tiene rango de fechas propio
// todavía, es la foto de lo relevado hasta ahora).
function buildQuiebres(faltantesRows){
  const total = faltantesRows.length;
  const porMotivo = new Map();
  const porCorte = new Map();
  const porPdv = new Map();
  faltantesRows.forEach(x => {
    porMotivo.set(x.motivo, (porMotivo.get(x.motivo) || 0) + 1);
    porCorte.set(x.corte, (porCorte.get(x.corte) || 0) + 1);
    porPdv.set(x.pdv, (porPdv.get(x.pdv) || 0) + 1);
  });
  return {
    total,
    por_motivo: [...porMotivo.entries()].map(([motivo, n]) => ({ motivo, n, pct: pct(n, total) })).sort((a,b)=>b.n-a.n),
    top_cortes: [...porCorte.entries()].map(([corte, n]) => ({ corte, n })).sort((a,b)=>b.n-a.n).slice(0, 15),
    top_pdvs: [...porPdv.entries()].map(([pdv, n]) => ({ pdv, n })).sort((a,b)=>b.n-a.n).slice(0, 15),
  };
}

// Vencimientos: se clasifica por urgencia según cuántos días faltan desde
// HOY hasta la fecha de "Vence" -- ya vencido / vence en 7 días / vence en
// 30 días / más adelante. Es la clasificación que más directo se traduce
// en "qué hay que sacar de la góndola ya".
function buildVencimientos(vencidosRows){
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const clasificados = vencidosRows.map(x => {
    const dias = Math.round((x.fecha_vence - hoy) / 86400000);
    let urgencia;
    if (dias < 0) urgencia = 'Ya vencido';
    else if (dias <= 7) urgencia = 'Vence en 7 días';
    else if (dias <= 30) urgencia = 'Vence en 30 días';
    else urgencia = 'Más adelante';
    return { ...x, dias, urgencia };
  });
  const total = clasificados.length;
  const porUrgencia = new Map();
  const ordenUrgencia = ['Ya vencido', 'Vence en 7 días', 'Vence en 30 días', 'Más adelante'];
  ordenUrgencia.forEach(u => porUrgencia.set(u, { n: 0, cantidad: 0 }));
  clasificados.forEach(x => {
    const g = porUrgencia.get(x.urgencia);
    g.n++; g.cantidad += x.cantidad;
  });
  const porCorte = new Map();
  clasificados.forEach(x => { porCorte.set(x.corte, (porCorte.get(x.corte) || 0) + x.cantidad); });

  // Corte que más se repite entre los urgentes (ya vencido + vence en 7
  // días) -- para identificar el "problema recurrente", el corte que
  // siempre está en alerta de vencimiento, no el que más unidades tiene.
  const conteoUrgente = new Map();
  clasificados.forEach(x => {
    if (x.urgencia !== 'Ya vencido' && x.urgencia !== 'Vence en 7 días') return;
    conteoUrgente.set(x.corte, (conteoUrgente.get(x.corte) || 0) + 1);
  });
  const corteRecurrente = [...conteoUrgente.entries()].map(([corte, n]) => ({ corte, n }))
    .sort((a,b) => b.n - a.n)[0] || null;

  // Alerta crítica: vencidos hace 10 días o más -- umbral aparte de "Ya
  // vencido" (que no distingue "vencido ayer" de "vencido hace un mes"),
  // para poder accionar antes de que se acumule.
  const criticos = clasificados.filter(x => x.dias <= -10).sort((a,b) => a.dias - b.dias);

  return {
    total,
    por_urgencia: ordenUrgencia.map(u => ({ urgencia: u, ...porUrgencia.get(u), pct: pct(porUrgencia.get(u).n, total) })),
    top_cortes: [...porCorte.entries()].map(([corte, cantidad]) => ({ corte, cantidad })).sort((a,b)=>b.cantidad-a.cantidad).slice(0, 15),
    urgentes: clasificados.filter(x => x.urgencia === 'Ya vencido' || x.urgencia === 'Vence en 7 días')
      .sort((a,b) => a.dias - b.dias).slice(0, 30),
    corte_recurrente: corteRecurrente,
    criticos,
  };
}

/* ---------------- 3. Cobertura por cadena / categoría (directo de Envasados) ---------------- */
function buildCoberturaCadena(priceRows){
  const cadenaAgg = new Map();
  priceRows.forEach(x => {
    if (!x.local) return;
    const cadena = x.cadena;
    if (!cadenaAgg.has(cadena)) cadenaAgg.set(cadena, { locales: new Set(), conPropia: new Set(), propio: [], comp: [] });
    const g = cadenaAgg.get(cadena);
    g.locales.add(x.local);
    if (x.propio) { g.conPropia.add(x.local); g.propio.push(x.precio); } else g.comp.push(x.precio);
  });
  const rows = [...cadenaAgg.entries()].map(([cadena, g]) => {
    const p = minMax(g.propio), c = minMax(g.comp);
    return {
      cadena, locales_total: g.locales.size, locales_con_propia: g.conPropia.size,
      propio_min: p.min, propio_max: p.max, comp_min: c.min, comp_max: c.max,
    };
  });
  rows.sort((a,b) => b.locales_total - a.locales_total);
  return rows;
}

/* Universo real por categoría (Cat A/B/C/Cluster H): se recorre
   Clasterización directo (localMap), que es la fuente de verdad de cuántos
   PDV existen en cada categoría -- no los locales que aparecen en Envasados,
   porque eso depende del cruce por nombre y puede fallar (un PDV de Cat A
   que todavía no se relevó en Envasados seguiría contando como parte del
   universo de Cat A, cosa que antes no pasaba). Devuelve, por categoría,
   qué % de sus PDV tienen a Minerva con precio relevado -- no composición
   sobre un total general, cada categoría se mide contra su propio universo.
   Biggie no está en Clasterización, así que se calcula aparte (Canal
   Conveniencia) directo desde Envasados. */
function buildCoberturaCategoria(priceRows, localMap){
  const conPropioSet = new Set();
  priceRows.forEach(x => { if (x.propio && x.local) conPropioSet.add(x.localJoinKey); });

  const catAgg = new Map(); // categoria -> {total, conPropia}
  localMap.forEach(info => {
    const { categoria, label, prioridad } = categoriaLabel(info.categoria);
    if (!catAgg.has(categoria)) catAgg.set(categoria, { label, prioridad, total: 0, conPropia: 0 });
    catAgg.get(categoria).total++;
  });
  localMap.forEach((info, pdvJoinKey) => {
    if (!conPropioSet.has(pdvJoinKey)) return;
    const { categoria } = categoriaLabel(info.categoria);
    catAgg.get(categoria).conPropia++;
  });

  const order = ['Cat A','Cluster H','Cat B','Cat C','Sin clasificar'];
  const rows = [...catAgg.entries()].map(([categoria, g]) => ({
    categoria, label: g.label, prioridad: g.prioridad,
    total_locales: g.total, con_propia: g.conPropia,
    pct: pct(g.conPropia, g.total), // % de PDV de ESA categoría con Minerva relevada
  }));
  rows.sort((a,b) => order.indexOf(a.categoria) - order.indexOf(b.categoria));
  return rows;
}

/* Biggie no está clausterizado -- se calcula aparte, directo de Envasados,
   con el mismo criterio (% de PDV con Minerva relevada). */
function buildCanalConveniencia(priceRows){
  const biggieRows = priceRows.filter(x => x.cadena === 'Biggie' && x.local);
  const total = new Set(biggieRows.map(x => x.local));
  const conPropia = new Set(biggieRows.filter(x => x.propio).map(x => x.local));
  return { total_locales: total.size, con_propia: conPropia.size, pct: pct(conPropia.size, total.size) };
}

/* ---------------- 4. PEDIDOS ---------------- */
/* Agrupa filas ya filtradas por rango de fechas (inWindow) por cadena,
   contando Puntos de Venta únicos y cantidad de registros (relevamientos de
   precio o pedidos, según la hoja). Punto de Venta es la unidad real para
   contar sucursales -- Cadena es solo la etiqueta para agrupar/mostrar, así
   que acá se cuenta por local solo (no por cadena+local): confiar en la
   columna CADENA para deduplicar fue justamente el error de antes, porque
   esa columna tiene filas mal tipeadas (ver extractPriceRows). Se usa para
   las tarjetas expandibles de Resumen (Envasados / Pedidos / Carnicería). */
function auditoriaPorCadena(rows, localField){
  const agg = new Map();
  rows.forEach(x => {
    const cadena = x.cadena || 'Sin cadena';
    if (!agg.has(cadena)) agg.set(cadena, { cadena, pdvs: new Set(), registros: 0 });
    const g = agg.get(cadena);
    if (x[localField]) g.pdvs.add(x[localField]);
    g.registros++;
  });
  return [...agg.values()]
    .map(g => ({ cadena: g.cadena, pdvs_unicos: g.pdvs.size, registros: g.registros }))
    .sort((a,b) => b.registros - a.registros);
}

function buildPedidos(rows, windowStart, windowEnd){
  const inWin = rows.filter(r => {
    const d = parseDateFlexible(r['MARCA TEMPORAL']);
    return d && d >= windowStart && d <= windowEnd;
  }).map(r => ({
    fecha: parseDateFlexible(r['MARCA TEMPORAL']),
    repositor: normDisplay(r['NOMBRE DEL REPOSITOR'] || '—'),
    cadena: normDisplay((r['CADENA']||'').trim()) || 'Sin cadena',
    pdv: normDisplay(r['PUNTO DE VENTA'] || '—'),
    sku: (r['PRODUCTO SKU']||'').trim(),
    kilos: toNum(r['PEDIDOS POR KILO']) || 0,
  }));

  // PDVs únicos y desglose por cadena, para la tarjeta expandible de
  // Resumen. Punto de Venta es la unidad real para contar sucursales;
  // Cadena es solo una etiqueta de agrupación (mismo criterio que Envasados).
  const pdvsUnicosAuditados = new Set(inWin.map(x => x.pdv)).size;
  const porCadenaAuditoria = auditoriaPorCadena(inWin, 'pdv')
    .map(x => ({ cadena: x.cadena, pdvs_unicos: x.pdvs_unicos, pedidos: x.registros }));

  const totalPedidos = inWin.length;
  const kilosTotales = inWin.reduce((s,x)=>s+x.kilos, 0);

  const porDia = {};
  DIAS_SEMANA.forEach(d => porDia[d]=0);
  inWin.forEach(x => { porDia[DIAS_SEMANA[x.fecha.getDay()]]++; });

  const repoAgg = new Map();
  inWin.forEach(x => {
    if (!repoAgg.has(x.repositor)) repoAgg.set(x.repositor, { kilos:0, pedidos:0 });
    const g = repoAgg.get(x.repositor); g.kilos += x.kilos; g.pedidos++;
  });
  const topRepositores = [...repoAgg.entries()].map(([repositor,g])=>({repositor, kilos_totales:g.kilos, pedidos_registrados:g.pedidos}))
    .sort((a,b)=>b.kilos_totales-a.kilos_totales).slice(0,15);

  // Foco en cadena, no en repositor individual -- qué cadena maneja más
  // kilaje pedido, no quién lo cargó.
  const cadenaAgg = new Map();
  inWin.forEach(x => {
    if (!cadenaAgg.has(x.cadena)) cadenaAgg.set(x.cadena, { kilos:0, pedidos:0 });
    const g = cadenaAgg.get(x.cadena); g.kilos += x.kilos; g.pedidos++;
  });
  const topCadenas = [...cadenaAgg.entries()].map(([cadena,g])=>({cadena, kilos_totales: Math.round(g.kilos), pedidos_registrados:g.pedidos}))
    .sort((a,b)=>b.kilos_totales-a.kilos_totales);

  const pdvAgg = new Map();
  inWin.forEach(x => {
    if (!pdvAgg.has(x.pdv)) pdvAgg.set(x.pdv, { kilos:0, pedidos:0 });
    const g = pdvAgg.get(x.pdv); g.kilos += x.kilos; g.pedidos++;
  });
  const topPdvs = [...pdvAgg.entries()].map(([pdv,g])=>({pdv, kilos_totales:g.kilos, pedidos_registrados:g.pedidos}))
    .sort((a,b)=>b.kilos_totales-a.kilos_totales).slice(0,15);

  const prodAgg = new Map();
  inWin.forEach(x => {
    const parts = x.sku.split(' - ');
    const marca = parts.length > 1 ? normDisplay(parts[0]) : null;
    let corte = parts.length > 1 ? parts.slice(1).join(' - ') : x.sku;
    corte = corte.replace(/^\s*\d+\s*/, '').trim();
    corte = normDisplay(corte) || '—';
    const key = marca + '||' + corte;
    if (!prodAgg.has(key)) prodAgg.set(key, { marca, corte, kilos:0 });
    prodAgg.get(key).kilos += x.kilos;
  });
  const topProductos = [...prodAgg.values()].sort((a,b)=>b.kilos-a.kilos).slice(0,15);

  // Todos los cortes (no un cluster limitado), del más pedido al menos
  // pedido, con % de kilo sobre el total -- se agrupa por CORTE solo, sin
  // separar por marca, porque acá interesa el corte en sí, no quién lo
  // fabrica.
  const corteAgg = new Map();
  inWin.forEach(x => {
    const parts = x.sku.split(' - ');
    let corte = parts.length > 1 ? parts.slice(1).join(' - ') : x.sku;
    corte = corte.replace(/^\s*\d+\s*/, '').trim();
    corte = normDisplay(corte) || '—';
    corteAgg.set(corte, (corteAgg.get(corte) || 0) + x.kilos);
  });
  const todosLosCortes = [...corteAgg.entries()].map(([corte,kilos])=>({
    corte, kilos: Math.round(kilos), pct_kilos: pct(kilos, kilosTotales),
  })).sort((a,b)=>b.kilos-a.kilos);
  const corteMasPedido = todosLosCortes[0] || null;

  return {
    total_pedidos_2026: totalPedidos, kilos_totales_2026: Math.round(kilosTotales),
    por_dia_semana: porDia,
    dias_entrega_area_minerva: ['Miércoles','Jueves','Viernes','Sábado'],
    top_repositores: topRepositores, top_productos: topProductos, top_pdvs: topPdvs,
    top_cadenas: topCadenas, todos_los_cortes: todosLosCortes, corte_mas_pedido: corteMasPedido,
    pdvs_unicos_auditados: pdvsUnicosAuditados, por_cadena_auditoria: porCadenaAuditoria,
    nota_entrega: 'No existe un campo de fecha de entrega en el archivo de pedidos — solo la fecha en que el repositor cargó el pedido. Regla de referencia mientras no haya una fuente de datos de entregas: un pedido cargado en una semana debería tener stock en el local, y por lo tanto ser auditable en precio, dentro de los 7 días siguientes a la carga.',
  };
}

/* ---------------- 4b. Cumplimiento de ventana ideal de pedido, por zona ---------------- */
function buildCumplimientoZona(pedidosRows, localMap, windowStart, windowEnd){
  const IDEAL = new Set(['Lunes','Martes','Miércoles']);
  const zonaAgg = new Map(); // zona -> {total, enVentana, porDia:{dia->{zona->n}}}
  const porDiaZona = {};
  DIAS_SEMANA.forEach(d => porDiaZona[d] = {});

  pedidosRows.forEach(r => {
    const d = parseDateFlexible(r['MARCA TEMPORAL']);
    if (!d || d < windowStart || d > windowEnd) return;
    const pdvKey = normJoinKey(r['PUNTO DE VENTA']);
    const info = localMap.get(pdvKey);
    const { categoria: zona } = categoriaLabel(info ? info.categoria : '');
    if (!zonaAgg.has(zona)) zonaAgg.set(zona, { total: 0, enVentana: 0 });
    const g = zonaAgg.get(zona);
    g.total++;
    const diaNombre = DIAS_SEMANA[d.getDay()];
    if (IDEAL.has(diaNombre)) g.enVentana++;
    porDiaZona[diaNombre][zona] = (porDiaZona[diaNombre][zona] || 0) + 1;
  });

  const order = ['Cluster H','Cat A','Cat B','Cat C'];
  let rows = [...zonaAgg.entries()].filter(([zona]) => zona !== 'Sin clasificar').map(([zona, g]) => ({
    zona, total_pedidos: g.total, en_ventana_ideal: g.enVentana, pct: pct(g.enVentana, g.total),
  }));
  rows.sort((a,b) => a.pct - b.pct || order.indexOf(a.zona) - order.indexOf(b.zona));
  if (!rows.length) rows = [{ zona: 'Sin datos', total_pedidos: 0, en_ventana_ideal: 0, pct: 0 }];
  return { cumplimiento_por_zona: rows, pedidos_por_dia_y_zona: porDiaZona };
}

/* ---------------- 5. Alertas (simples, sin inventar métricas nuevas) ---------------- */
function buildAlertas(priceRowsAll, priceRowsWindow, pedidosRows, localMap, now){
  // "días sin relevar" necesita el historial completo, no solo la ventana de
  // 3 meses -- si no, un local que no se releva hace 90+ días ni siquiera
  // aparece en priceRowsWindow y la alerta lo pierde.
  //
  // OJO: estas dos alertas hablan de "precio PROPIO" específicamente (Pul /
  // Estancia 92), no de relevamiento en general -- un local puede tener
  // visitas recientes con precios de competencia cargados y aun así no
  // tener el precio propio relevado hace tiempo (going out of stock,
  // relevador que no encontró el producto, etc.). Por eso se filtra a
  // x.propio antes de calcular "última vez visto": si se usa priceRowsAll
  // sin filtrar, cualquier fila de competencia "refresca" el reloj y la
  // alerta termina midiendo "sin ningún relevamiento" en vez de "sin
  // relevamiento de precio propio", que es lo que dice el título.
  const priceRowsPropio = priceRowsAll.filter(x => x.propio);
  const lastSeenByLocal = new Map();
  priceRowsPropio.forEach(x => { if (!x.local) return; const prev = lastSeenByLocal.get(x.local); if (!prev || x.fecha > prev) lastSeenByLocal.set(x.local, x.fecha); });
  const diasSinRelevar = [...lastSeenByLocal.entries()].map(([local, fecha]) => ({
    local: normDisplay(local), dias_sin_relevar: Math.round((now - fecha) / 86400000),
  })).filter(x => x.dias_sin_relevar > 45).sort((a,b)=>b.dias_sin_relevar-a.dias_sin_relevar);

  // Prioridad = mismo chequeo pero solo para locales Cat A / Cluster H
  // (segun el maestro de Clasterizacion), con umbral mas corto (30 dias).
  const PRIORIDAD_CATS = new Set(['Cat A', 'Cluster H']);
  const lastSeenByJoinKey = new Map();
  priceRowsPropio.forEach(x => {
    if (!x.local) return;
    const prev = lastSeenByJoinKey.get(x.localJoinKey);
    if (!prev || x.fecha > prev) lastSeenByJoinKey.set(x.localJoinKey, { fecha: x.fecha, display: x.local });
  });
  const prioridadDetalle = [];
  let sinRelevarNunca = 0;
  localMap.forEach((info, joinKey) => {
    const { categoria } = categoriaLabel(info.categoria);
    if (!PRIORIDAD_CATS.has(categoria)) return;
    const seen = lastSeenByJoinKey.get(joinKey);
    if (!seen) { sinRelevarNunca++; return; }
    const dias = Math.round((now - seen.fecha) / 86400000);
    if (dias > 30) prioridadDetalle.push({ local: normDisplay(seen.display), categoria, dias_sin_relevar: dias });
  });
  prioridadDetalle.sort((a,b)=>b.dias_sin_relevar-a.dias_sin_relevar);
  const prioridadTotal = prioridadDetalle.length + sinRelevarNunca;

  const lastPedidoByRepo = new Map();
  pedidosRows.forEach(r => {
    const d = parseDateFlexible(r['MARCA TEMPORAL']); if (!d) return;
    const repo = normDisplay(r['NOMBRE DEL REPOSITOR']||'');
    const prev = lastPedidoByRepo.get(repo); if (!prev || d > prev) lastPedidoByRepo.set(repo, d);
  });
  const diasSinPedido = [...lastPedidoByRepo.entries()].map(([repositor, fecha]) => ({
    repositor, dias_sin_pedido: Math.round((now - fecha) / 86400000),
  })).filter(x => x.dias_sin_pedido > 7).sort((a,b)=>b.dias_sin_pedido-a.dias_sin_pedido);

  const precioPorCorte = buildPrecioPorCorte(priceRowsWindow);
  const corteAlta = precioPorCorte.filter(x => (x.n_propio + x.n_competencia) >= 20 && x.diferencial_min_pct > 0);

  return {
    prioridad: { titulo: `${prioridadTotal} locales de alta prioridad (Cat A / Cluster H) sin relevar precio propio hace +30 días`, severidad: prioridadTotal>0?'alta':'baja', detalle: prioridadDetalle.slice(0,15), total: prioridadTotal, nota: `${sinRelevarNunca} locales de alta prioridad nunca tuvieron un precio propio relevado.` },
    cobertura: { titulo: `${diasSinRelevar.length} locales sin relevamiento de precio propio hace más de 45 días`, severidad: diasSinRelevar.length>0?'alta':'baja', detalle: diasSinRelevar.slice(0,15), total: diasSinRelevar.length },
    pedidos: { titulo: `${diasSinPedido.length} de ${lastPedidoByRepo.size} repositores activos sin pedido cargado en los últimos 7 días`, severidad: diasSinPedido.length>0?'alta':'baja', detalle: diasSinPedido.slice(0,15), total: diasSinPedido.length, total_activos: lastPedidoByRepo.size },
    precio: { titulo: `${corteAlta.length} cortes de alta rotación donde Minerva está por encima del precio de competencia`, severidad: corteAlta.length>0?'media':'baja', detalle: corteAlta.map(x=>({corte:x.corte, diferencial_pct:x.diferencial_min_pct})), total: corteAlta.length },
    disponibilidad: { titulo: 'Comparación mes a mes pendiente de definir metodología', severidad: 'baja', detalle: [], total: 0, nota: 'Todavía no está implementado este cálculo.' },
  };
}

/* ---------------- pipeline principal ---------------- */
// Se separa "traer los datos de la red" (fetchDashboardRaw) de "calcular
// el tablero para un rango de fechas" (buildDashboardData). Así, cuando
// se cambia el selector de fechas de arriba, se recalcula todo al
// instante con los datos ya descargados -- sin volver a pedirle nada a
// Google Sheets -- y solo el botón "Actualizar" vuelve a buscar datos
// nuevos de la planilla.
let _rawCache = null;

async function fetchDashboardRaw(){
  if (!SHEET_URLS.envasados || !SHEET_URLS.clasterizacion) {
    console.error('Faltan configurar los links de origen para Envasados y/o Clasterización en SHEET_URLS.');
    throw new Error('No se pudo inicializar la conexión de datos.');
  }
  // Se piden las 3 fuentes obligatorias por separado (no con un solo
  // Promise.all) para poder decir EXACTAMENTE cuál falló si algo sale
  // mal -- un "Failed to fetch" genérico no dice cuál es el problema,
  // y bloquea TODO el tablero por igual sin pista. El detalle técnico
  // (con URLs) va solo a la consola, nunca al mensaje que ve el cliente.
  const sheetsRequeridas = [
    { label: 'Pedidos', url: SHEET_URLS.pedidos },
    { label: 'Envasados', url: SHEET_URLS.envasados },
    { label: 'Clasterización', url: SHEET_URLS.clasterizacion },
  ];
  const resultados = await Promise.allSettled(sheetsRequeridas.map(s => fetchCsv(s.url)));
  const fallidas = resultados
    .map((res, i) => ({ ...sheetsRequeridas[i], res }))
    .filter(x => x.res.status === 'rejected');
  if (fallidas.length) {
    const detalle = fallidas.map(x => `${x.label} (${x.res.reason.message}) — ${x.url}`).join(' · ');
    console.error('No se pudieron leer estas fuentes de datos:', detalle);
    throw new Error(`No se pudieron cargar los datos de ${fallidas.map(x=>x.label).join(', ')}. Probá de nuevo en unos minutos; si sigue fallando, avisá al equipo técnico.`);
  }
  const [pedidosRows, envasadosRows, clasterRows] = resultados.map(r => r.value);
  // Carnicería se pide aparte y no bloquea el resto del tablero si falla
  // (gid nuevo, todavía sin confirmar en producción — ver nota en SHEET_URLS).
  let carniceriaRows = [], carniceriaError = null;
  if (SHEET_URLS.carniceria) {
    try { carniceriaRows = await fetchCsv(SHEET_URLS.carniceria); }
    catch (err) { console.error('No se pudo leer Carnicería:', err.message); carniceriaError = 'No se pudieron cargar los datos de Carnicería. Probá de nuevo en unos minutos.'; }
  }
  let marcasCompeRows = [];
  if (SHEET_URLS.marcasCompe) {
    try { marcasCompeRows = await fetchCsv(SHEET_URLS.marcasCompe); }
    catch (err) { /* tabla de referencia opcional -- si falla, simplemente no se muestra */ }
  }
  // Panel "Vigencia de Stock" -- opcional, no bloquea el resto del tablero
  // si alguna de las 3 pestañas falla (recién se agregaron, sin confirmar
  // publicación en producción todavía).
  let stockRows = [], faltantesRows = [], vencidosRows = [];
  if (SHEET_URLS.stock) { try { stockRows = await fetchCsv(SHEET_URLS.stock); } catch (err) { console.error('No se pudo leer Stock:', err.message); } }
  if (SHEET_URLS.faltantes) { try { faltantesRows = await fetchCsv(SHEET_URLS.faltantes); } catch (err) { console.error('No se pudo leer Faltantes:', err.message); } }
  if (SHEET_URLS.vencidos) { try { vencidosRows = await fetchCsv(SHEET_URLS.vencidos); } catch (err) { console.error('No se pudo leer Vencidos:', err.message); } }
  _rawCache = { pedidosRows, envasadosRows, clasterRows, carniceriaRows, marcasCompeRows, stockRows, faltantesRows, vencidosRows, carniceriaError, fetchedAt: new Date() };
  return _rawCache;
}

/* Recalcula TODO el tablero para el rango [windowStart, windowEnd] a
   partir de lo último que se descargó (_rawCache). "windowEnd" se usa
   además como referencia de "ahora" para las alertas y la cobertura
   vigente -- si se filtra a un período pasado, esas métricas se
   recalculan como si fuera el final de ese período, no la fecha real de
   hoy, para que todo el tablero quede consistente con el rango elegido. */
function buildDashboardData(windowStart, windowEnd){
  if (!_rawCache) throw new Error('Todavía no se cargaron los datos.');
  const { pedidosRows, envasadosRows, clasterRows, carniceriaRows, marcasCompeRows, stockRows, faltantesRows, vencidosRows, carniceriaError, fetchedAt } = _rawCache;
  const now = windowEnd;

  const { map: localMap, cadenaKeys } = buildLocalMap(clasterRows);
  const corteAlias = buildCorteAlias(marcasCompeRows);
  const priceRowsAll = extractPriceRows(envasadosRows, windowStart, windowEnd); // .inWindow marca cuáles entran en el rango elegido
  const priceRowsWindow = priceRowsAll.filter(x => x.inWindow);

  const precioPorCorte = buildPrecioPorCorte(priceRowsAll);
  const propioDetalle = buildDetalle(priceRowsAll, true);
  const competenciaDetalle = buildDetalle(priceRowsAll, false);
  const precioExtremos = { propio: extremosPrecio(propioDetalle), competencia: extremosPrecio(competenciaDetalle) };
  const porLocal = buildPorLocal(priceRowsAll);
  const marcas = buildMarcas(priceRowsAll, cadenaKeys);
  const porCadena = buildCoberturaCadena(priceRowsAll);
  const porCategoria = buildCoberturaCategoria(priceRowsAll, localMap);
  const canalConveniencia = buildCanalConveniencia(priceRowsAll);
  const carniceriaExtraidas = extractCarniceriaRows(carniceriaRows, windowStart, windowEnd);
  const quiebres = buildQuiebres(extractFaltantesRows(faltantesRows));
  const vencimientos = buildVencimientos(extractVencidosRows(vencidosRows));
  const carniceria = buildCarniceria(carniceriaExtraidas.rows);
  carniceria.descartes = carniceriaExtraidas.descartes;
  carniceria.error = carniceriaError;
  const auditoriaCarniceria = auditoriaPorCadena(carniceriaExtraidas.rows.filter(x => x.inWindow), 'local');

  // Universo total de locales y "alguna vez tuvo precio propio" quedan
  // fuera del rango elegido a propósito -- son el tamaño del universo
  // monitoreado, no una métrica de actividad reciente.
  const totalLocalesSet = new Set([...localMap.keys(), ...priceRowsAll.map(x=>x.local).filter(Boolean)]);
  const locHistConPropia = new Set(priceRowsAll.filter(x=>x.propio && x.local).map(x=>x.local));
  const vigentesEnVentana = new Set(priceRowsAll.filter(x=>x.propio && x.local && x.inWindow).map(x=>x.local));

  // Tarjetas de auditoría por canal (Resumen): a diferencia de
  // totalLocalesSet de arriba (universo histórico, mezcla Clasterización +
  // Envasados), esto es puntualmente "cuántos PDVs se auditaron con precio
  // en Envasados/Carnicería dentro del rango de fechas elegido arriba" --
  // se recalcula solo con lo que cae en la ventana, cadena por cadena.
  const auditoriaEnvasados = auditoriaPorCadena(priceRowsWindow, 'local');
  const pdvsUnicosEnvasados = new Set(priceRowsWindow.map(x => x.local)).size;

  // Presencia de marca (share): de los PDVs con al menos un precio relevado
  // en la ventana elegida, cuántos tienen presencia propia (Frigomerc) y
  // cuántos tienen presencia de competencia. No son complementarios -- un
  // mismo PDV puede tener las dos cosas a la vez, por eso no suman 100%.
  const propioWindow = priceRowsWindow.filter(x => x.propio);
  const compWindow = priceRowsWindow.filter(x => !x.propio);
  const pdvsConPropio = new Set(propioWindow.map(x => x.local)).size;
  const pdvsConCompetencia = new Set(compWindow.map(x => x.local)).size;
  const presencia = {
    pdvs_total: pdvsUnicosEnvasados,
    pdvs_con_propio: pdvsConPropio,
    pdvs_con_competencia: pdvsConCompetencia,
    pct_propio: pct(pdvsConPropio, pdvsUnicosEnvasados),
    pct_competencia: pct(pdvsConCompetencia, pdvsUnicosEnvasados),
  };
  presencia.lidera = presencia.pct_propio === presencia.pct_competencia ? 'empate'
    : (presencia.pct_propio > presencia.pct_competencia ? 'propio' : 'competencia');

  // Primer competidor: la marca de competencia con presencia en más PDVs
  // (no la que más precios tiene relevados -- PDVs distintos, para no
  // sobrepesar una marca solo porque se la releva más seguido en el mismo local).
  const compMarcaAgg = new Map();
  compWindow.forEach(x => {
    if (!compMarcaAgg.has(x.marca)) compMarcaAgg.set(x.marca, new Set());
    compMarcaAgg.get(x.marca).add(x.local);
  });
  const rankingCompetidores = [...compMarcaAgg.entries()].map(([marca,set]) => ({ marca, pdvs: set.size }))
    .sort((a,b) => b.pdvs - a.pdvs);
  presencia.primer_competidor = rankingCompetidores[0] || null;

  // Precio mínimo y máximo agregados de toda la ventana (no por corte) --
  // Minerva vs. competencia, para las tarjetas de Resumen.
  const preciosGlobales = {
    propio_min: propioWindow.length ? Math.min(...propioWindow.map(x => x.precio)) : null,
    propio_max: propioWindow.length ? Math.max(...propioWindow.map(x => x.precio)) : null,
    comp_min: compWindow.length ? Math.min(...compWindow.map(x => x.precio)) : null,
    comp_max: compWindow.length ? Math.max(...compWindow.map(x => x.precio)) : null,
  };

  const pedidos = buildPedidos(pedidosRows, windowStart, windowEnd);
  const alertas = buildAlertas(priceRowsAll, priceRowsWindow, pedidosRows, localMap, now);
  const cumplimiento = buildCumplimientoZona(pedidosRows, localMap, windowStart, windowEnd);

  return {
    meta: {
      fecha_generacion: fetchedAt.toISOString().slice(0,10),
      filas_precios_analizadas: priceRowsWindow.length,
      filtro_outliers_precio: { low: OUTLIER_MIN, high: OUTLIER_MAX, descartadas: null },
      ventana: { desde: windowStart.toISOString().slice(0,10), hasta: windowEnd.toISOString().slice(0,10), dias: Math.round((windowEnd-windowStart)/86400000) },
    },
    resumen: {
      total_locales: totalLocalesSet.size,
      locales_con_propia: locHistConPropia.size,
      cobertura_real_pct: pct(locHistConPropia.size, totalLocalesSet.size),
      vigentes_30d: vigentesEnVentana.size, // el nombre del campo quedó del diseño anterior -- ahora sigue el rango elegido, no un fijo de 30 días
      locales_historico_con_propia: locHistConPropia.size,
      precio_por_corte: precioPorCorte,
      cobertura_por_categoria_real: porCategoria,
      canal_conveniencia: canalConveniencia,
      precios_por_cadena_real: porCadena,
      universo_priorizado: { locales_en_universo: localMap.size, locales_totales: totalLocalesSet.size, pct: pct(localMap.size, totalLocalesSet.size) },
      // Tarjetas de auditoría por canal (todas respetan el rango de fechas
      // elegido arriba -- se recalculan al cambiar el filtro). Envasados
      // abarca tanto supermercados como Biggie en una sola hoja/cadena.
      auditoria_envasados: { total_pdvs: pdvsUnicosEnvasados, por_cadena: auditoriaEnvasados },
      auditoria_pedidos: { total_pdvs: pedidos.pdvs_unicos_auditados, por_cadena: pedidos.por_cadena_auditoria },
      auditoria_carniceria: { total_cadenas: auditoriaCarniceria.length, por_cadena: auditoriaCarniceria },
      presencia,
      precios_globales: preciosGlobales,
      precio_extremos: precioExtremos,
    },
    precios: { propio_detalle: propioDetalle, competencia_detalle: competenciaDetalle, por_local: porLocal },
    competencia: {
      minerva_locales_presente: locHistConPropia.size,
      total_marcas_detectadas: marcas.length,
      marcas,
      marcas_compe_por_corte: buildMarcasCompe(marcasCompeRows),
      corte_alias: corteAlias,
    },
    cobertura: {
      cobertura_total_pct: pct(locHistConPropia.size, totalLocalesSet.size),
      locales_con_minerva: locHistConPropia.size,
      locales_sin_minerva: totalLocalesSet.size - locHistConPropia.size,
      por_categoria_real: porCategoria,
      por_cadena_real: porCadena,
    },
    pedidos,
    alertas,
    carniceria,
    stock: { quiebres, vencimientos },
    recomendaciones: {
      metodologia: 'Si un corte no tiene precio relevado en un local, y la zona está cubierta por el equipo de campo, se interpreta como corte no disponible en góndola (quiebre), no como dato faltante.',
      ventana_ideal_pedido: ['Lunes','Martes','Miércoles'],
      dias_entrega_area_minerva: ['Miércoles','Jueves','Viernes','Sábado'],
      cumplimiento_por_zona: cumplimiento.cumplimiento_por_zona,
      pedidos_por_dia_y_zona: cumplimiento.pedidos_por_dia_y_zona,
      top_oportunidades: [],
    },
  };
}

/* Conveniencia para la primera carga: trae los datos y arma el tablero
   con la ventana por defecto (últimos 3 meses). Los cambios de fecha
   posteriores usan buildDashboardData() directo, sin volver a pedir
   datos -- ver bootstrapData()/applyDateFilter() en minerva.js. */
async function loadMinervaData(){
  await fetchDashboardRaw();
  const now = new Date();
  const windowStart = new Date(now.getTime() - VENTANA_DIAS * 86400000);
  return buildDashboardData(windowStart, now);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { loadMinervaData, fetchDashboardRaw, buildDashboardData, parseCSV, extractPriceRows, buildLocalMap, SHEET_URLS };
}
