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
  // gid tomado de la pestaña "CARNICERIA" en el link de edición que pasó el cliente
  // (docs.google.com/spreadsheets/d/10eRhklodmpFSvbS7VBQAxjoEU4_xVwEeQTCC3TPH-P4/edit?gid=1026017082).
  // Si al cargar el tablero da error de esta hoja, confirmar que este gid siga siendo el de esa pestaña.
  carniceria: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZuBhRWAQwypAUAEFuMLzBhWKebAfplgFbPjiLEZWlWI6Pk1iWv_tkbUyuWjD5ksSK8S9VWHWiopd1/pub?gid=1026017082&single=true&output=csv',
  // gid de la pestaña "MARCAS-COMPE" (docs.google.com/spreadsheets/d/10eRhklodmpFSvbS7VBQAxjoEU4_xVwEeQTCC3TPH-P4/edit?gid=821862696).
  marcasCompe: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQZuBhRWAQwypAUAEFuMLzBhWKebAfplgFbPjiLEZWlWI6Pk1iWv_tkbUyuWjD5ksSK8S9VWHWiopd1/pub?gid=821862696&single=true&output=csv',
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
// Clasterización (no hay forma de saber a qué categoría/PDV pertenecen) --
// se agrupan como "Otros / Independiente", igual que hacía el tablero viejo.
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
  if (!res.ok) throw new Error(`HTTP ${res.status} al leer ${url}`);
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

    const cadenaKey = normKey(r['CADENA']);
    const cadenaOriginal = normDisplay(r['CADENA'] || '');
    const cadena = (!cadenaKey || CADENAS_SIN_MAESTRO.has(cadenaKey)) ? 'Otros / Independiente' : cadenaOriginal;
    // El LOCAL de cadenas como Superseis/Arete ya viene con el prefijo de
    // cadena incluido ("SUPERSEIS - MBURUCUYA"). El de Biggie no -- es
    // solo el nombre de la calle ("KUBITSCHEK SEMINARIO"), ambiguo sin
    // saber a qué cadena pertenece. Se antepone la cadena real si el
    // nombre del local todavía no la menciona.
    const localRaw = (r['LOCAL'] || '').trim();
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
function extractCarniceriaRows(rows, windowStart, windowEnd){
  const out = [];
  rows.forEach(r => {
    const fecha = parseDateFlexible(r['FECHA']);
    if (!fecha) return;
    const inWindow = fecha >= windowStart && fecha <= windowEnd;
    const pdv = normDisplay((r['PDV'] || r['LOCAL'] || '').trim());
    const local = normDisplay((r['LOCAL'] || r['PDV'] || '').trim());
    const ciudad = normDisplay((r['CIUDAD'] || '').trim());
    const relevador = normDisplay((r['RELEVADOR'] || '').trim());

    const corteRaw = (r['CORTE'] || '').trim();
    const precioRegular = toNum(r['PRECIO REGULAR']);
    if (corteRaw && precioRegular != null && precioRegular >= OUTLIER_MIN && precioRegular <= OUTLIER_MAX) {
      const precioOfertaRaw = toNum(r['PRECIO OFERTA']);
      const precioOferta = (precioOfertaRaw != null && precioOfertaRaw >= OUTLIER_MIN && precioOfertaRaw <= OUTLIER_MAX) ? precioOfertaRaw : null;
      out.push({ fecha, inWindow, relevador, pdv, local, ciudad, corte: normDisplay(corteRaw), precio_regular: precioRegular, precio_oferta: precioOferta, es_nuevo: false });
    }

    const corteNuevoRaw = (r['CORTE NUEVO'] || '').trim();
    const precioCorteNuevo = toNum(r['PRECIO CORTE NUEVO']);
    if (corteNuevoRaw && precioCorteNuevo != null && precioCorteNuevo >= OUTLIER_MIN && precioCorteNuevo <= OUTLIER_MAX) {
      out.push({ fecha, inWindow, relevador, pdv, local, ciudad, corte: normDisplay(corteNuevoRaw), marca_nuevo: normDisplay((r['MARCA CORTE NUEVO']||'').trim()), precio_regular: precioCorteNuevo, precio_oferta: null, es_nuevo: true });
    }
  });
  return out;
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

  const cortesNuevos = inWin.filter(x => x.es_nuevo).map(x => ({
    corte: x.corte, marca: x.marca_nuevo || '—', precio: x.precio_regular,
    pdv: x.pdv || x.local || '—', ciudad: x.ciudad || '—', fecha: x.fecha.toISOString().slice(0,10),
  })).sort((a,b) => b.fecha.localeCompare(a.fecha));

  const detalle = inWin.filter(x => !x.es_nuevo).map(x => ({
    fecha: x.fecha.toISOString().slice(0,10), relevador: x.relevador || '—', pdv: x.pdv || x.local || '—',
    ciudad: x.ciudad || '—', corte: x.corte, precio_regular: x.precio_regular, precio_oferta: x.precio_oferta,
  })).sort((a,b) => b.fecha.localeCompare(a.fecha)).slice(0, 300);

  return {
    total_relevamientos: inWin.length,
    pdvs_relevados: new Set(inWin.map(x=>x.pdv).filter(Boolean)).size,
    ciudades_cubiertas: new Set(inWin.map(x=>x.ciudad).filter(Boolean)).size,
    relevadores_activos: new Set(inWin.map(x=>x.relevador).filter(Boolean)).size,
    precio_por_corte: precioPorCorte,
    por_ciudad: porCiudad,
    cortes_nuevos: cortesNuevos,
    detalle,
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
      diferencial_min_pct: (p.min != null && c.min) ? diferencial(p.min, c.min) : 0,
      diferencial_max_pct: (p.max != null && c.max) ? diferencial(p.max, c.max) : 0,
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
      diferencial_min_pct: globalPropio.min ? diferencial(globalPropio.min, mm.min) : 0,
      diferencial_max_pct: globalPropio.max ? diferencial(globalPropio.max, mm.max) : 0,
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
function buildMarcasCompe(rows){
  const COL_COMPITE = 'CONTES DE FRIGO CON QUIEN COMPITE';
  return rows.map(r => {
    const corte = normDisplay((r['CORTES'] || '').trim());
    const raw = (r[COL_COMPITE] || '').trim();
    if (!corte || !raw) return null;
    const competidores = raw.split(/\s*[,/;]+\s*|\s+y\s+|\s+Y\s+/).map(s => normDisplay(s.trim())).filter(Boolean);
    return { corte, competidores: competidores.length ? competidores : [raw] };
  }).filter(Boolean);
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

/* La categoría (Cat A/B/C/Cluster H) no viene en Envasados -- se cruza
   LOCAL contra Clasterización.PDV. Si un local no matchea ninguna fila
   de Clasterización, cae en "Sin clasificar" (no se inventa categoría). */
function buildCoberturaCategoria(priceRows, localMap){
  const catAgg = new Map(); // categoria -> {total:Set, conPropia:Set}
  priceRows.forEach(x => {
    if (!x.local) return;
    const info = localMap.get(x.localJoinKey);
    const { categoria, label, prioridad } = categoriaLabel(info ? info.categoria : '');
    if (!catAgg.has(categoria)) catAgg.set(categoria, { label, prioridad, total: new Set(), conPropia: new Set() });
    const g = catAgg.get(categoria);
    g.total.add(x.local);
    if (x.propio) g.conPropia.add(x.local);
  });
  const order = ['Cat A','Cluster H','Cat B','Cat C','Sin clasificar'];
  const rows = [...catAgg.entries()].map(([categoria, g]) => ({
    categoria, label: g.label, prioridad: g.prioridad,
    total_locales: g.total.size, con_propia: g.conPropia.size,
    pct: pct(g.conPropia.size, g.total.size),
  }));
  rows.sort((a,b) => order.indexOf(a.categoria) - order.indexOf(b.categoria));
  return rows;
}

/* ---------------- 4. PEDIDOS ---------------- */
function buildPedidos(rows, windowStart, windowEnd){
  const inWin = rows.filter(r => {
    const d = parseDateFlexible(r['MARCA TEMPORAL']);
    return d && d >= windowStart && d <= windowEnd;
  }).map(r => ({
    fecha: parseDateFlexible(r['MARCA TEMPORAL']),
    repositor: normDisplay(r['NOMBRE DEL REPOSITOR'] || '—'),
    pdv: normDisplay(r['PUNTO DE VENTA'] || '—'),
    sku: (r['PRODUCTO SKU']||'').trim(),
    kilos: toNum(r['PEDIDOS POR KILO']) || 0,
  }));

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

  return {
    total_pedidos_2026: totalPedidos, kilos_totales_2026: Math.round(kilosTotales),
    por_dia_semana: porDia,
    dias_entrega_area_minerva: ['Miércoles','Jueves','Viernes','Sábado'],
    top_repositores: topRepositores, top_productos: topProductos, top_pdvs: topPdvs,
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
  const lastSeenByLocal = new Map();
  priceRowsAll.forEach(x => { if (!x.local) return; const prev = lastSeenByLocal.get(x.local); if (!prev || x.fecha > prev) lastSeenByLocal.set(x.local, x.fecha); });
  const diasSinRelevar = [...lastSeenByLocal.entries()].map(([local, fecha]) => ({
    local: normDisplay(local), dias_sin_relevar: Math.round((now - fecha) / 86400000),
  })).filter(x => x.dias_sin_relevar > 45).sort((a,b)=>b.dias_sin_relevar-a.dias_sin_relevar);

  // Prioridad = mismo chequeo pero solo para locales Cat A / Cluster H
  // (segun el maestro de Clasterizacion), con umbral mas corto (30 dias).
  const PRIORIDAD_CATS = new Set(['Cat A', 'Cluster H']);
  const lastSeenByJoinKey = new Map();
  priceRowsAll.forEach(x => {
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
async function loadMinervaData(){
  if (!SHEET_URLS.envasados || !SHEET_URLS.clasterizacion) {
    throw new Error('Faltan los links de "Publicar en la web" para las hojas Envasados y/o Clasterización en sheet-data.js (SHEET_URLS).');
  }
  const [pedidosRows, envasadosRows, clasterRows] = await Promise.all([
    fetchCsv(SHEET_URLS.pedidos), fetchCsv(SHEET_URLS.envasados), fetchCsv(SHEET_URLS.clasterizacion),
  ]);
  // Carnicería se pide aparte y no bloquea el resto del tablero si falla
  // (gid nuevo, todavía sin confirmar en producción — ver nota en SHEET_URLS).
  let carniceriaRows = [], carniceriaError = null;
  if (SHEET_URLS.carniceria) {
    try { carniceriaRows = await fetchCsv(SHEET_URLS.carniceria); }
    catch (err) { carniceriaError = err.message; }
  }
  let marcasCompeRows = [];
  if (SHEET_URLS.marcasCompe) {
    try { marcasCompeRows = await fetchCsv(SHEET_URLS.marcasCompe); }
    catch (err) { /* tabla de referencia opcional -- si falla, simplemente no se muestra */ }
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - VENTANA_DIAS * 86400000);

  const { map: localMap, cadenaKeys } = buildLocalMap(clasterRows);
  const priceRowsAll = extractPriceRows(envasadosRows, windowStart, now); // .inWindow marca cuáles entran en los últimos 3 meses
  const priceRowsWindow = priceRowsAll.filter(x => x.inWindow);

  const precioPorCorte = buildPrecioPorCorte(priceRowsAll);
  const propioDetalle = buildDetalle(priceRowsAll, true);
  const competenciaDetalle = buildDetalle(priceRowsAll, false);
  const porLocal = buildPorLocal(priceRowsAll);
  const marcas = buildMarcas(priceRowsAll, cadenaKeys);
  const porCadena = buildCoberturaCadena(priceRowsAll);
  const porCategoria = buildCoberturaCategoria(priceRowsAll, localMap);
  const carniceria = buildCarniceria(extractCarniceriaRows(carniceriaRows, windowStart, now));
  carniceria.error = carniceriaError;

  const totalLocalesSet = new Set([...localMap.keys(), ...priceRowsAll.map(x=>x.local).filter(Boolean)]);
  const locHistConPropia = new Set(priceRowsAll.filter(x=>x.propio && x.local).map(x=>x.local));
  const vigentes30 = new Set(priceRowsAll.filter(x=>x.propio && x.local && (now-x.fecha)<=30*86400000).map(x=>x.local));

  const pedidos = buildPedidos(pedidosRows, windowStart, now);
  const alertas = buildAlertas(priceRowsAll, priceRowsWindow, pedidosRows, localMap, now);
  const cumplimiento = buildCumplimientoZona(pedidosRows, localMap, windowStart, now);

  return {
    meta: {
      fecha_generacion: now.toISOString().slice(0,10),
      filas_precios_analizadas: priceRowsWindow.length,
      filtro_outliers_precio: { low: OUTLIER_MIN, high: OUTLIER_MAX, descartadas: null },
      ventana: { desde: windowStart.toISOString().slice(0,10), hasta: now.toISOString().slice(0,10), dias: VENTANA_DIAS },
    },
    resumen: {
      total_locales: totalLocalesSet.size,
      locales_con_propia: locHistConPropia.size,
      cobertura_real_pct: pct(locHistConPropia.size, totalLocalesSet.size),
      vigentes_30d: vigentes30.size,
      locales_historico_con_propia: locHistConPropia.size,
      precio_por_corte: precioPorCorte,
      cobertura_por_categoria_real: porCategoria,
      precios_por_cadena_real: porCadena,
      universo_priorizado: { locales_en_universo: localMap.size, locales_totales: totalLocalesSet.size, pct: pct(localMap.size, totalLocalesSet.size) },
    },
    precios: { propio_detalle: propioDetalle, competencia_detalle: competenciaDetalle, por_local: porLocal },
    competencia: {
      minerva_locales_presente: locHistConPropia.size,
      total_marcas_detectadas: marcas.length,
      marcas,
      marcas_compe_por_corte: buildMarcasCompe(marcasCompeRows),
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { loadMinervaData, parseCSV, extractPriceRows, buildLocalMap, SHEET_URLS };
}
