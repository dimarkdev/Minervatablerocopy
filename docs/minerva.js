let DATA = null; // se carga en vivo desde Google Sheets — ver sheet-data.js / bootstrap al final de este archivo
const fmtGs = n => n==null ? '—' : new Intl.NumberFormat('es-PY').format(Math.round(n)) + ' Gs.';
const fmtNum = n => n==null ? '—' : new Intl.NumberFormat('es-PY').format(n);
const charts = {};
function destroyChart(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } }
function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
let currentSection = 'resumen';


/* ---------------- KPI helper (con tooltip "cómo se calcula") ---------------- */
const KPI_ICONS = {
  accent: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  teal: '<path d="M20 6 9 17l-5-5"/>',
  amber: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  blue: '<path d="M3 3v18h18"/><path d="M18 9 12 15l-3-3-4 4"/>',
  violet: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
};
function kpiCard(label, value, foot, info, variant){
  const v = variant || 'teal';
  const icon = KPI_ICONS[v] || KPI_ICONS.teal;
  return `<div class="kpi-card k-${v}">
    <div class="kpi-top">
      <div class="kpi-label">${label}</div>
      <div class="kpi-icon-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg></div>
    </div>
    <div class="kpi-info">i</div>
    <div class="kpi-tooltip">${info}</div>
    <div class="kpi-value">${value}</div>
    ${foot ? `<div class="kpi-foot">${foot}</div>` : ''}
  </div>`;
}

/* ---------------- ALERT PANEL ---------------- */
const SEV_ORDER = {alta:0, media:1, baja:2};
function alertCard(key, a, extraDetailHtml){
  const sev = a.severidad;
  return `<div class="alert-card" data-alert="${key}">
    <div class="alert-top"><div class="alert-dot dot-${sev}"></div><div class="alert-label">${sev==='alta'?'Atención':(sev==='media'?'A revisar':'En orden')}</div></div>
    <div class="alert-title">${a.titulo}</div>
    <div class="alert-detail" id="detalle-${key}">${extraDetailHtml}</div>
  </div>`;
}
function renderAlertPanel(){
  const al = DATA.alertas;
  const cards = [
    alertCard('prioridad', al.prioridad, `<div class="table-scroll"><table><thead><tr><th>Local</th><th>Categoría</th><th class="num">Días sin relevar</th></tr></thead><tbody>
      ${al.prioridad.detalle.map(x=>`<tr><td>${x.local}</td><td>${x.categoria}</td><td class="num">${x.dias_sin_relevar}</td></tr>`).join('')}
      </tbody></table></div><div class="alert-note">${al.prioridad.nota}</div>`),
    alertCard('cobertura', al.cobertura, `<div class="table-scroll"><table><thead><tr><th>Local</th><th class="num">Días sin relevar</th></tr></thead><tbody>
      ${al.cobertura.detalle.map(x=>`<tr><td>${x.local}</td><td class="num">${x.dias_sin_relevar}</td></tr>`).join('')}
      </tbody></table></div><div class="alert-note">Mostrando los 15 más atrasados de ${al.cobertura.total} en total.</div>`),
    alertCard('pedidos', al.pedidos, `<div class="table-scroll"><table><thead><tr><th>Repositor</th><th class="num">Días sin pedido</th></tr></thead><tbody>
      ${al.pedidos.detalle.map(x=>`<tr><td>${x.repositor}</td><td class="num">${x.dias_sin_pedido}</td></tr>`).join('')}
      </tbody></table></div>`),
    alertCard('precio', al.precio, al.precio.total===0
      ? `<div class="alert-note">Ningún corte de alto volumen relevado está por encima del precio de competencia. Buena señal.</div>`
      : `<div class="table-scroll"><table><thead><tr><th>Corte</th><th class="num">Diferencial</th></tr></thead><tbody>
        ${al.precio.detalle.map(x=>`<tr><td>${x.corte}</td><td class="num">+${x.diferencial_pct}%</td></tr>`).join('')}
        </tbody></table></div>`),
    alertCard('disponibilidad', al.disponibilidad, `<div class="table-scroll"><table><thead><tr><th>Corte</th><th class="num">Jun</th><th class="num">Jul (parcial)</th><th class="num">Variación</th></tr></thead><tbody>
      ${al.disponibilidad.detalle.map(x=>`<tr><td>${x.corte}</td><td class="num">${x.locales_junio}</td><td class="num">${x.locales_julio_parcial}</td><td class="num">${x.variacion_pct}%</td></tr>`).join('')}
      </tbody></table></div><div class="alert-note">${al.disponibilidad.nota}</div>`),
  ];
  return `<div class="alert-panel" id="alertPanel">${cards.join('')}</div>`;
}
function bindAlertPanel(){
  document.querySelectorAll('#alertPanel .alert-card').forEach(card => {
    card.addEventListener('click', () => {
      const detail = card.querySelector('.alert-detail');
      const wasOpen = detail.classList.contains('open');
      document.querySelectorAll('#alertPanel .alert-card').forEach(cd=>{
        cd.classList.remove('expanded');
        cd.querySelector('.alert-detail').classList.remove('open');
      });
      if(!wasOpen){
        detail.classList.add('open');
        card.classList.add('expanded');
      }
    });
  });
}

/* ---------------- THEME ---------------- */
const root = document.documentElement;
const themeToggle = document.getElementById('themeToggle');
const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.5A8.5 8.5 0 1 1 11.5 3 7 7 0 0 0 21 12.5Z"/></svg>';
function setTheme(t){
  root.setAttribute('data-theme', t);
  themeToggle.innerHTML = t === 'dark' ? ICON_SUN : ICON_MOON;
  try { renderSection(currentSection, true); } catch (e) { console.error('Error al re-renderizar:', e); }
}
themeToggle.addEventListener('click', () => {
  setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});
root.setAttribute('data-theme', 'light');
themeToggle.innerHTML = ICON_MOON;

/* ---------------- REFRESH & LOGOUT ---------------- */
document.getElementById('btnRefresh').addEventListener('click', function(){
  this.classList.add('spinning');
  bootstrapData().finally(() => this.classList.remove('spinning'));
});
document.getElementById('logoutBtn').addEventListener('click', () => {
  window.location.href = '/index.html';
});

/* ---------------- NAV ---------------- */
const titles = {
  resumen: ['Resumen', 'Vista general de precios, cobertura y alertas'],
  precios: ['Precios', 'Comparativa detallada por corte, marca y local'],
  pedidos: ['Pedidos', 'Frecuencia de carga por repositor y producto'],
  competencia: ['Competencia', 'Presencia y precios de cada marca detectada'],
  cobertura: ['Cobertura', 'Relevamiento de Minerva por categoría y cadena'],
  recomendaciones: ['Recomendaciones', 'Distribución inteligente: rotación real vs. disponibilidad por zona'],
  carniceria: ['Carnicería', 'Relevamiento de precios en el canal carnicerías'],
};
document.getElementById('nav').addEventListener('click', e => {
  const item = e.target.closest('.nav-item');
  if(!item) return;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  item.classList.add('active');
  currentSection = item.dataset.section;
  const [t] = titles[currentSection];
  document.getElementById('topTitle').innerHTML = `${t}<span>Minerva Foods · Price Intelligence</span>`;
  try { renderSection(currentSection); } catch (e) { console.error('Error al renderizar sección:', e); }
});

/* ---------------- RENDER DISPATCH ---------------- */
function renderSection(name, themeChanged){
  const c = document.getElementById('content');
  if (!DATA) return; // todavía cargando / con error — ver bootstrap al final del archivo
  if(!themeChanged) c.innerHTML = '';
  if(name === 'resumen') renderResumen(c, themeChanged);
  if(name === 'precios') renderPrecios(c, themeChanged);
  if(name === 'pedidos') renderPedidos(c, themeChanged);
  if(name === 'competencia') renderCompetencia(c, themeChanged);
  if(name === 'cobertura') renderCobertura(c, themeChanged);
  if(name === 'recomendaciones') renderRecomendaciones(c, themeChanged);
  if(name === 'carniceria') renderCarniceria(c, themeChanged);
  // Fuerza un resize de los charts recién creados: si el canvas se crea antes de que
  // el navegador termine de calcular el layout del contenedor, Chart.js puede quedar
  // dibujado en 0x0 y no se ve nada hasta que se redimensiona la ventana.
  requestAnimationFrame(() => { Object.values(charts).forEach(ch => { try { ch.resize(); } catch(e){} }); });
}
window.addEventListener('resize', () => { Object.values(charts).forEach(ch => { try { ch.resize(); } catch(e){} }); });

/* ================= 1. RESUMEN ================= */
let resumenCorteFiltro = [];
function renderResumen(c, themeChanged){
  const r = DATA.resumen;
  const gridBig = cssVar('--border'), textCol = cssVar('--text2'), accent = cssVar('--accent'), teal = cssVar('--teal');
  const cortesAll = r.precio_por_corte.map(x=>x.corte);

  if(!themeChanged){
    c.innerHTML = `
    ${renderAlertPanel()}

    <div class="kpi-grid">
      ${kpiCard('Cobertura vigente (30 días)', r.vigentes_30d + ' / ' + r.total_locales,
        `${Math.round(100*r.vigentes_30d/r.total_locales)}% del universo con precio fresco`,
        'Locales con al menos un precio propio (Pul/Estancia 92) cargado en los últimos 30 días, sobre el total de locales monitoreados. Un local puede tener historial de precio propio pero si no se relevó hace más de 30 días, no cuenta como "vigente".')}
      ${kpiCard('Más barata en el piso', r.precio_por_corte.filter(x=>x.diferencial_min_pct<0).length+'/'+r.precio_por_corte.length,
        'cortes donde el mínimo de Minerva es más bajo que el mínimo de competencia',
        'Compara el precio mínimo relevado de Minerva vs. el precio mínimo relevado de la competencia, corte por corte. Cuenta en cuántos cortes el piso de Minerva es más barato.', 'accent')}
      ${kpiCard('Más barata en el techo', r.precio_por_corte.filter(x=>x.diferencial_max_pct<0).length+'/'+r.precio_por_corte.length,
        'cortes donde el máximo de Minerva es más bajo que el máximo de competencia',
        'Compara el precio máximo relevado de Minerva vs. el precio máximo relevado de la competencia, corte por corte. Cuenta en cuántos cortes el techo de Minerva es más barato.', 'accent')}
      ${kpiCard('Locales monitoreados', fmtNum(r.total_locales),
        `${r.locales_historico_con_propia} tuvieron precio propio relevado alguna vez`,
        'Cantidad total de puntos de venta distintos con al menos un registro de precio (propio o competencia) en la base.')}
    </div>

    <div class="card">
      <div class="card-head">
        <div><div class="card-title">Rango de precio por corte · Minerva vs. Competencia</div><div class="card-sub">Mínimo y máximo relevado — sin promedios</div></div>
        <input type="text" id="resumenCorteSearch" placeholder="Buscar corte..." style="padding:7px 12px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:13px; min-width:160px;">
      </div>
      <div class="chips" id="resumenCorteChips" style="margin:2px 0 14px;"></div>
      <div class="chart-wrap" style="height:340px;"><canvas id="chResumenCortes"></canvas></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Top cortes por volumen relevado</div></div>
        <div class="table-scroll"><table>
          <thead><tr><th>Corte</th><th class="num">Mín. propio</th><th class="num">Máx. propio</th><th class="num">Mín. comp.</th><th class="num">Máx. comp.</th><th class="num">Dif. mín.</th><th class="num">Dif. máx.</th></tr></thead>
          <tbody>${r.precio_por_corte.map(x => `
            <tr><td>${x.corte}</td><td class="num">${fmtGs(x.propio_min)}</td><td class="num">${fmtGs(x.propio_max)}</td>
            <td class="num">${fmtGs(x.comp_min)}</td><td class="num">${fmtGs(x.comp_max)}</td>
            <td class="num"><span class="tag ${x.diferencial_min_pct<0?'tag-propio':'tag-comp'}">${x.diferencial_min_pct>0?'+':''}${x.diferencial_min_pct}%</span></td>
            <td class="num"><span class="tag ${x.diferencial_max_pct<0?'tag-propio':'tag-comp'}">${x.diferencial_max_pct>0?'+':''}${x.diferencial_max_pct}%</span></td></tr>`).join('')}
          </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="card-title">Cobertura por categoría de PDV</div><div class="card-sub">Cat A y Cluster H son las zonas de mayor prioridad comercial</div></div></div>
        <div class="cov-grid" id="covCategoria" style="grid-template-columns:1fr;"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Precios por cadena</div><div class="card-sub">Rango mínimo–máximo, cadena real según maestro de PDVs</div></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Cadena</th><th class="num">Locales</th><th class="num">Con Minerva</th><th class="num">Mín. propio</th><th class="num">Máx. propio</th><th class="num">Mín. comp.</th><th class="num">Máx. comp.</th></tr></thead>
        <tbody>${r.precios_por_cadena_real.map(x => `
          <tr><td>${x.cadena}</td><td class="num">${x.locales_total}</td><td class="num">${x.locales_con_propia}</td>
          <td class="num">${fmtGs(x.propio_min)}</td><td class="num">${fmtGs(x.propio_max)}</td>
          <td class="num">${fmtGs(x.comp_min)}</td><td class="num">${fmtGs(x.comp_max)}</td></tr>`).join('')}
        </tbody></table></div>
      <div class="note-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
        <span>Se descartaron ${(DATA.meta.filtro_outliers_precio && DATA.meta.filtro_outliers_precio.descartadas) || 0} registros de precio fuera de un rango plausible (posibles errores de tipeo, ej. precios de 1 Gs. o de 900.000+ Gs.) antes de calcular estos mínimos y máximos.</span>
      </div>
    </div>`;

    document.getElementById('covCategoria').innerHTML = r.cobertura_por_categoria_real.map(x => {
      const cls = x.pct>=70?'pb-green':(x.pct>=40?'pb-amber':'pb-red');
      const prioBadge = x.prioridad==='alta' ? '<span class="tag tag-alta" style="margin-left:6px;">Prioridad alta</span>' : '';
      return `<div class="cov-card"><div class="cov-top"><div class="cov-cat">${x.label}${prioBadge}</div><div class="cov-pct">${x.pct}%</div></div>
      <div class="progress"><div class="progress-bar ${cls}" style="width:${x.pct}%"></div></div>
      <div class="cov-note">${x.con_propia} de ${x.total_locales} locales con Minerva relevada</div></div>`;
    }).join('');
    bindAlertPanel();

    resumenCorteFiltro = cortesAll.slice(0, Math.min(8, cortesAll.length));
    const chipsBox = document.getElementById('resumenCorteChips');
    const syncResumenChips = () => {
      const allSelected = resumenCorteFiltro.length === cortesAll.length;
      chipsBox.querySelectorAll('.chip').forEach(chip => {
        if(chip.dataset.all){ chip.classList.toggle('active', allSelected); chip.textContent = allSelected ? 'Ver menos' : `Todos (${cortesAll.length})`; }
        else chip.classList.toggle('active', resumenCorteFiltro.includes(chip.dataset.corte));
      });
    };
    chipsBox.innerHTML = `<div class="chip" data-all="1"></div>` +
      cortesAll.map(ct => `<div class="chip" data-corte="${ct}">${ct}</div>`).join('');
    syncResumenChips();
    chipsBox.addEventListener('click', e => {
      const chip = e.target.closest('.chip'); if(!chip) return;
      if(chip.dataset.all){
        resumenCorteFiltro = resumenCorteFiltro.length === cortesAll.length
          ? cortesAll.slice(0, Math.min(8, cortesAll.length)) : [...cortesAll];
      } else {
        const ct = chip.dataset.corte;
        const willDeselect = chip.classList.contains('active');
        if(willDeselect && resumenCorteFiltro.length===1) return; // mantener al menos un corte elegido
        resumenCorteFiltro = willDeselect ? resumenCorteFiltro.filter(x=>x!==ct) : [...resumenCorteFiltro, ct];
      }
      syncResumenChips();
      drawResumenCortesChart();
    });
    document.getElementById('resumenCorteSearch').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      chipsBox.querySelectorAll('.chip[data-corte]').forEach(chip => {
        chip.style.display = chip.dataset.corte.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  function drawResumenCortesChart(){
    destroyChart('resumenCortes');
    const rows = r.precio_por_corte.filter(x => resumenCorteFiltro.includes(x.corte));
    const ctx = document.getElementById('chResumenCortes');
    charts['resumenCortes'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: rows.map(x=>x.corte),
        datasets: [
          { label: 'Minerva (rango)', data: rows.map(x=>[x.propio_min, x.propio_max]), backgroundColor: teal, borderRadius: 5, maxBarThickness: 22, minBarLength: 4 },
          { label: 'Competencia (rango)', data: rows.map(x=>[x.comp_min, x.comp_max]), backgroundColor: accent, borderRadius: 5, maxBarThickness: 22, minBarLength: 4 },
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { color: textCol, font: { family:'Outfit', size: 11 } } },
          tooltip: { callbacks: { label: (i)=> `${i.dataset.label}: ${fmtGs(i.raw[0])} \u2013 ${fmtGs(i.raw[1])}` } } },
        scales: {
          x: { ticks: { color: textCol, callback: v=>fmtNum(v) }, grid: { color: gridBig } },
          y: { ticks: { color: textCol, font:{family:'Outfit', size:11} }, grid: { display:false } }
        }
      }
    });
  }
  drawResumenCortesChart();
}

/* ================= 2. PRECIOS ================= */
let preciosCorteFiltro = [];
function renderPrecios(c, themeChanged){
  const p = DATA.precios;
  const cortes = [...new Set(p.competencia_detalle.map(x=>x.corte))].sort();
  const textCol = cssVar('--text2'), gridBig = cssVar('--border'), teal = cssVar('--teal'), accent = cssVar('--accent');

  if(!themeChanged){
    c.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">Comparativo por corte y marca</div><div class="card-sub">Elegí uno o más cortes para comparar la brecha entre ellos (Minerva vs. competencia)</div></div>
        <input type="text" id="corteSearch" placeholder="Buscar corte..." style="padding:7px 12px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:13px; min-width:160px;">
      </div>
      <div class="chips" id="corteChips" style="margin-top:10px;"></div>
      <div class="chart-wrap" style="height:320px;"><canvas id="chPreciosDetalle"></canvas></div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Detalle por corte — mínimo y máximo</div></div>
      <div class="table-scroll"><table id="tblPreciosDetalle">
        <thead><tr><th>Corte</th><th>Marca</th><th>Tipo</th><th class="num">Mínimo</th><th class="num">Máximo</th><th class="num">Muestras</th></tr></thead>
        <tbody></tbody></table></div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Precios por local</div><div class="card-sub">Locales con más cortes propios relevados (top 80)</div></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Local</th><th>Cadena</th><th class="num">Cortes propios</th><th class="num">Mín. propio</th><th class="num">Máx. propio</th><th class="num">Mín. comp.</th><th class="num">Máx. comp.</th></tr></thead>
        <tbody>${p.por_local.map(x=>`
          <tr><td>${x.local}</td><td>${x.cadena}</td><td class="num">${x.n_cortes_propio}</td>
          <td class="num">${fmtGs(x.propio_min)}</td><td class="num">${fmtGs(x.propio_max)}</td>
          <td class="num">${fmtGs(x.comp_min)}</td><td class="num">${fmtGs(x.comp_max)}</td></tr>`).join('')}
        </tbody></table></div>
    </div>`;

    document.getElementById('corteChips').innerHTML = cortes.map(ct =>
      `<div class="chip" data-corte="${ct}">${ct}</div>`).join('');
    document.getElementById('corteChips').addEventListener('click', e => {
      const chip = e.target.closest('.chip'); if(!chip) return;
      const ct = chip.dataset.corte;
      const willDeselect = chip.classList.contains('active');
      if(willDeselect && preciosCorteFiltro.length===1) return; // mantener al menos un corte elegido
      chip.classList.toggle('active');
      preciosCorteFiltro = willDeselect ? preciosCorteFiltro.filter(x=>x!==ct) : [...preciosCorteFiltro, ct];
      drawPreciosChart(); fillPreciosTable();
    });
    preciosCorteFiltro = [cortes[0]];
    document.querySelector('#corteChips .chip')?.classList.add('active');

    document.getElementById('corteSearch').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('#corteChips .chip').forEach(chip => {
        chip.style.display = chip.dataset.corte.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  function drawPreciosChart(){
    destroyChart('preciosDetalle');
    if(preciosCorteFiltro.length <= 1){
      const corte = preciosCorteFiltro[0];
      const compRows = p.competencia_detalle.filter(x=>x.corte===corte).sort((a,b)=>b.precio_max-a.precio_max);
      const propioRows = p.propio_detalle.filter(x=>x.corte===corte);
      const labels = [...propioRows.map(x=>x.marca), ...compRows.map(x=>x.marca)];
      const values = [...propioRows.map(x=>[x.precio_min,x.precio_max]), ...compRows.map(x=>[x.precio_min,x.precio_max])];
      const colors = [...propioRows.map(()=>teal), ...compRows.map(()=>accent)];
      charts['preciosDetalle'] = new Chart(document.getElementById('chPreciosDetalle'), {
        type: 'bar',
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 6, maxBarThickness: 34, minBarLength: 4 }] },
        options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}, tooltip:{callbacks:{label:i=>`${fmtGs(i.raw[0])} \u2013 ${fmtGs(i.raw[1])}`}}},
          scales: { x:{ ticks:{color:textCol, font:{family:'Outfit',size:10.5}, autoSkip:false, maxRotation:35, minRotation:0} , grid:{display:false}},
                    y:{ ticks:{color:textCol, callback:v=>fmtNum(v)}, grid:{color:gridBig} } } }
      });
    } else {
      const rows = DATA.resumen.precio_por_corte.filter(x=>preciosCorteFiltro.includes(x.corte));
      charts['preciosDetalle'] = new Chart(document.getElementById('chPreciosDetalle'), {
        type: 'bar',
        data: { labels: rows.map(x=>x.corte), datasets: [
          { label:'Minerva (rango)', data: rows.map(x=>[x.propio_min, x.propio_max]), backgroundColor: teal, borderRadius:6, maxBarThickness:34, minBarLength: 4 },
          { label:'Competencia (rango)', data: rows.map(x=>[x.comp_min, x.comp_max]), backgroundColor: accent, borderRadius:6, maxBarThickness:34, minBarLength: 4 },
        ] },
        options: { responsive:true, maintainAspectRatio:false,
          plugins:{legend:{position:'top', labels:{color:textCol, font:{family:'Outfit', size:11}}}, tooltip:{callbacks:{label:i=>`${i.dataset.label}: ${fmtGs(i.raw[0])} \u2013 ${fmtGs(i.raw[1])}`}}},
          scales: { x:{ ticks:{color:textCol, font:{family:'Outfit',size:10.5}, autoSkip:false, maxRotation:35, minRotation:0} , grid:{display:false}},
                    y:{ ticks:{color:textCol, callback:v=>fmtNum(v)}, grid:{color:gridBig} } } }
      });
    }
  }
  function fillPreciosTable(){
    const rows = [
      ...p.propio_detalle.filter(x=>preciosCorteFiltro.includes(x.corte)).map(x=>({...x, tipo:'Propia'})),
      ...p.competencia_detalle.filter(x=>preciosCorteFiltro.includes(x.corte)).map(x=>({...x, tipo:'Competencia'})),
    ].sort((a,b)=> a.corte.localeCompare(b.corte) || (a.tipo==='Propia'?-1:1) - (b.tipo==='Propia'?-1:1) || b.n-a.n);
    document.querySelector('#tblPreciosDetalle tbody').innerHTML = rows.map(x=>`
      <tr><td>${x.corte}</td><td>${x.marca}</td><td><span class="tag ${x.tipo==='Propia'?'tag-propio':'tag-comp'}">${x.tipo}</span></td>
      <td class="num">${fmtGs(x.precio_min)}</td><td class="num">${fmtGs(x.precio_max)}</td><td class="num">${x.n}</td></tr>`).join('');
  }
  drawPreciosChart(); fillPreciosTable();
}

function renderPedidos(c, themeChanged){
  const pd = DATA.pedidos;
  const textCol = cssVar('--text2'), gridBig = cssVar('--border'), accent = cssVar('--accent'), teal = cssVar('--teal');
  const dias = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

  if(!themeChanged){
    c.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('Pedidos cargados (2026)', fmtNum(pd.total_pedidos_2026), null,
        'Cantidad de filas de pedido cargadas por repositores desde enero 2026 (cada fila = un producto pedido en una visita).')}
      ${kpiCard('Kilos pedidos (2026)', fmtNum(pd.kilos_totales_2026), null,
        'Suma de la columna "Pedidos por Kilo" de todas las cargas registradas en 2026. Es el mejor proxy de demanda disponible hoy — no reemplaza venta real ($).', 'accent')}
      ${kpiCard('Días de entrega (área Minerva)', pd.dias_entrega_area_minerva.join(' · '), null,
        'Días en los que, según el área de venta de Minerva, deberían llegar las entregas a los puntos de venta.')}
      ${kpiCard('Repositores activos', pd.top_repositores.length+'+', 'con pedidos registrados en 2026',
        'Repositores con al menos un pedido cargado en los últimos 45 días de historial disponible.')}
    </div>

    <div class="card">
      <div class="card-head"><div><div class="card-title">¿Cuándo cargan pedidos los repositores?</div><div class="card-sub">Distribución de pedidos por día de la semana — 2026</div></div></div>
      <div class="chart-wrap" style="height:280px;"><canvas id="chPedidosDia"></canvas></div>
      <div class="note-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
        <span>${pd.nota_entrega}</span>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Repositores por kilos pedidos</div></div>
        <div class="table-scroll"><table>
          <thead><tr><th>Repositor</th><th class="num">Kilos</th><th class="num">Pedidos</th></tr></thead>
          <tbody>${pd.top_repositores.map(x=>`<tr><td>${x.repositor}</td><td class="num">${fmtNum(x.kilos_totales)}</td><td class="num">${x.pedidos_registrados}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Cluster de cortes más pedidos</div></div>
        <div class="table-scroll"><table>
          <thead><tr><th>Marca</th><th>Corte</th><th class="num">Kilos</th></tr></thead>
          <tbody>${pd.top_productos.map(x=>`<tr><td>${x.marca||'—'}</td><td>${x.corte||'—'}</td><td class="num">${fmtNum(x.kilos)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">PDVs con más pedidos</div></div>
      <div class="table-scroll"><table>
        <thead><tr><th>PDV</th><th class="num">Kilos</th><th class="num">Pedidos</th></tr></thead>
        <tbody>${pd.top_pdvs.map(x=>`<tr><td>${x.pdv}</td><td class="num">${fmtNum(x.kilos_totales)}</td><td class="num">${x.pedidos_registrados}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  }

  destroyChart('pedidosDia');
  const entregaSet = new Set(pd.dias_entrega_area_minerva);
  charts['pedidosDia'] = new Chart(document.getElementById('chPedidosDia'), {
    type: 'bar',
    data: { labels: dias, datasets: [{ data: dias.map(d=>pd.por_dia_semana[d]||0),
      backgroundColor: dias.map(d=> entregaSet.has(d) ? teal : accent), borderRadius: 6, maxBarThickness: 46 }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}, tooltip:{callbacks:{label:i=>fmtNum(i.raw)+' pedidos'}}},
      scales:{ x:{ticks:{color:textCol}, grid:{display:false}}, y:{ticks:{color:textCol}, grid:{color:gridBig}} } }
  });
}

/* ================= 4. COMPETENCIA ================= */
function renderCompetencia(c, themeChanged){
  const cp = DATA.competencia;
  const textCol = cssVar('--text2'), gridBig = cssVar('--border'), accent = cssVar('--accent');
  const palette = ['#8b1a1a','#b3312f','#c8433f','#d9534f','#e0524d','#a52323','#943636','#7a2e2e'];

  if(!themeChanged){
    c.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('Minerva presente', fmtNum(cp.minerva_locales_presente), 'locales con precio propio relevado',
        'Cantidad de locales distintos donde se registró al menos un precio de marca propia (Pul o Estancia 92).', 'accent')}
      ${kpiCard('Marcas competidoras detectadas', cp.total_marcas_detectadas, null,
        'Cantidad de marcas de competencia distintas identificadas en el relevamiento de precios, luego de normalizar variantes de escritura.')}
      ${kpiCard('Mayor amenaza', cp.marcas[0]?.marca||'—', (cp.marcas[0]?.locales||0)+' locales de presencia',
        'La marca competidora presente en más locales. "Amenaza" combina presencia relativa a la marca líder: Alta (>50% de la presencia del líder), Media (15-50%), Baja (<15%).')}
      ${kpiCard('2do competidor', cp.marcas[1]?.marca||'—', (cp.marcas[1]?.locales||0)+' locales de presencia',
        'Segunda marca competidora con mayor presencia en el universo relevado.')}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Presencia por marca (locales)</div></div>
        <div class="chart-wrap" style="height:360px;"><canvas id="chCompPresencia"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Rango de precio por marca</div><div class="card-sub">Mínimo–máximo, sin promedio</div></div>
        <div class="chart-wrap" style="height:360px;"><canvas id="chCompPrecio"></canvas></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Detalle de competencia</div></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Marca</th><th class="num">Locales</th><th class="num">Mínimo</th><th class="num">Máximo</th><th class="num">Dif. mín. vs. Minerva</th><th class="num">Dif. máx. vs. Minerva</th><th>Cortes top</th><th>Amenaza</th></tr></thead>
        <tbody>${cp.marcas.map(m=>`
          <tr><td>${m.marca}</td><td class="num">${m.locales}</td><td class="num">${fmtGs(m.precio_min)}</td><td class="num">${fmtGs(m.precio_max)}</td>
          <td class="num">${m.diferencial_min_pct>0?'+':''}${m.diferencial_min_pct}%</td>
          <td class="num">${m.diferencial_max_pct>0?'+':''}${m.diferencial_max_pct}%</td>
          <td>${m.top_cortes.join(', ')}</td>
          <td><span class="tag tag-${m.amenaza.toLowerCase()==='alta'?'alta':(m.amenaza.toLowerCase()==='media'?'media':'baja')}">${m.amenaza}</span></td></tr>`).join('')}
        </tbody></table></div>
    </div>

    ${cp.marcas_compe_por_corte.length ? `
    <div class="card">
      <div class="card-head"><div><div class="card-title">Quién compite por corte</div><div class="card-sub">Frigoríficos/marcas que compiten con Minerva en cada corte — carga manual del equipo comercial</div></div></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Corte</th><th>Compite con</th></tr></thead>
        <tbody>${cp.marcas_compe_por_corte.map(x=>`
          <tr><td>${x.corte}</td><td><div class="chips">${x.competidores.map(m=>`<span class="tag tag-comp">${m}</span>`).join('')}</div></td></tr>`).join('')}
        </tbody></table></div>
    </div>` : ''}`;
  }

  destroyChart('compPresencia'); destroyChart('compPrecio');
  const top = cp.marcas.slice(0,15);
  charts['compPresencia'] = new Chart(document.getElementById('chCompPresencia'), {
    type: 'bar',
    data: { labels: top.map(x=>x.marca), datasets: [{ data: top.map(x=>x.locales), backgroundColor: palette[1], borderRadius:5, maxBarThickness:22 }] },
    options: { indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{ x:{ticks:{color:textCol}, grid:{color:gridBig}}, y:{ticks:{color:textCol, font:{family:'Outfit',size:10.5}}, grid:{display:false}} } }
  });
  charts['compPrecio'] = new Chart(document.getElementById('chCompPrecio'), {
    type: 'bar',
    data: { labels: top.map(x=>x.marca), datasets: [{ data: top.map(x=>[x.precio_min,x.precio_max]), backgroundColor: palette[0], borderRadius:5, maxBarThickness:22, minBarLength: 4 }] },
    options: { indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}, tooltip:{callbacks:{label:i=>`${fmtGs(i.raw[0])} – ${fmtGs(i.raw[1])}`}}},
      scales:{ x:{ticks:{color:textCol, callback:v=>fmtNum(v)}, grid:{color:gridBig}}, y:{ticks:{color:textCol, font:{family:'Outfit',size:10.5}}, grid:{display:false}} } }
  });
}
function renderCobertura(c, themeChanged){
  const cv = DATA.cobertura;
  const textCol = cssVar('--text2'), gridBig = cssVar('--border'), teal = cssVar('--teal'), accent = cssVar('--accent');
  const porCadena = cv.por_cadena_real.slice(0,12);

  if(!themeChanged){
    c.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('Cobertura total', cv.cobertura_total_pct+'%', null,
        'Porcentaje de locales monitoreados que tienen al menos un precio propio (Pul/Estancia 92) relevado alguna vez, sobre el total de locales en la base.', 'accent')}
      ${kpiCard('Locales con Minerva', fmtNum(cv.locales_con_minerva), null,
        'Cantidad de locales con al menos un registro histórico de precio propio.')}
      ${kpiCard('Locales sin Minerva (a activar)', fmtNum(cv.locales_sin_minerva), null,
        'Locales monitoreados donde nunca se registró un precio de Pul o Estancia 92 — oportunidad de activación comercial.')}
      ${kpiCard('Cadenas identificadas', cv.por_cadena_real.length, null,
        'Cadenas reales según el maestro de PDVs de Minerva (Departamento/Ciudad/Cadena/Categoría), no inferidas por nombre.')}
    </div>

    <div class="card">
      <div class="card-head"><div><div class="card-title">Semáforo de cobertura por categoría de zona</div><div class="card-sub">Cat A y Cluster H son las zonas de mayor prioridad comercial para Minerva</div></div></div>
      <div class="cov-grid" id="covSemaforo"></div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Cobertura por cadena</div><div class="card-sub">Locales con Minerva vs. sin Minerva — top 12 cadenas por tamaño</div></div>
      <div class="chart-wrap" style="height:300px;"><canvas id="chCoberturaCadena"></canvas></div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Detalle por cadena</div></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Cadena</th><th class="num">Total locales</th><th class="num">Con Minerva</th><th class="num">Sin Minerva</th><th class="num">% cobertura</th></tr></thead>
        <tbody>${cv.por_cadena_real.map(x=>{
          const pct = x.locales_total? Math.round(100*x.locales_con_propia/x.locales_total):0;
          return `<tr><td>${x.cadena}</td><td class="num">${x.locales_total}</td><td class="num">${x.locales_con_propia}</td><td class="num">${x.locales_total-x.locales_con_propia}</td><td class="num">${pct}%</td></tr>`;
        }).join('')}</tbody></table></div>
    </div>`;

    document.getElementById('covSemaforo').innerHTML = cv.por_categoria_real.map(x=>{
      const cls = x.pct>=70?'pb-green':(x.pct>=40?'pb-amber':'pb-red');
      const prioBadge = x.prioridad==='alta' ? '<span class="tag tag-alta" style="margin-left:6px;">Prioridad alta</span>' : '';
      return `<div class="cov-card"><div class="cov-top"><div class="cov-cat">${x.label}${prioBadge}</div><div class="cov-pct">${x.pct}%</div></div>
      <div class="progress"><div class="progress-bar ${cls}" style="width:${x.pct}%"></div></div>
      <div class="cov-note">${x.con_propia} de ${x.total_locales} locales</div></div>`;
    }).join('');
  }

  destroyChart('coberturaCadena');
  charts['coberturaCadena'] = new Chart(document.getElementById('chCoberturaCadena'), {
    type: 'bar',
    data: { labels: porCadena.map(x=>x.cadena),
      datasets: [
        { label:'Con Minerva', data: porCadena.map(x=>x.locales_con_propia), backgroundColor: teal, stack:'s', borderRadius:5 },
        { label:'Sin Minerva', data: porCadena.map(x=>x.locales_total-x.locales_con_propia), backgroundColor: accent, stack:'s', borderRadius:5 },
      ] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'top', labels:{color:textCol}}},
      scales:{ x:{stacked:true, ticks:{color:textCol, font:{family:'Outfit', size:10.5}}, grid:{display:false}}, y:{stacked:true, ticks:{color:textCol}, grid:{color:gridBig}} } }
  });
}

/* ================= 6. RECOMENDACIONES ================= */
function renderRecomendaciones(c, themeChanged){
  const rc = DATA.recomendaciones;
  const textCol = cssVar('--text2'), gridBig = cssVar('--border'), teal = cssVar('--teal'), accent = cssVar('--accent'), amber = cssVar('--amber');
  const zonas = ['Cat A','Cluster H','Cat B','Cat C'];
  const zonaColor = {'Cat A':accent,'Cluster H':'#b3312f','Cat B':teal,'Cat C':amber};
  const dias = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

  if(!themeChanged){
    c.innerHTML = `
    <div class="note-box" style="margin-top:0;">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.55 1 1.35 1 2.2V16h6v-.3c0-.85.4-1.65 1-2.2A6 6 0 0 0 12 3Z"/></svg>
      <span><b>Cómo se lee esta sección:</b> ${rc.metodologia} Se cruza la rotación real (kilos pedidos por repositores en 2026) con la disponibilidad relevada en góndola, por corte y por categoría de zona (Cat A / Cluster H / Cat B / Cat C).</span>
    </div>

    <div class="kpi-grid">
      ${kpiCard('Ventana ideal de pedido', rc.ventana_ideal_pedido.join(' · '), null,
        'Días en los que un pedido cargado hoy alcanza a procesarse y llegar dentro de la ventana de entrega del área Minerva (miércoles a sábado).')}
      ${kpiCard('Zona con menor cumplimiento', rc.cumplimiento_por_zona[0].zona, rc.cumplimiento_por_zona[0].pct+'% de pedidos en ventana ideal',
        'Porcentaje de pedidos cargados lunes-miércoles (ventana ideal) sobre el total de pedidos de la zona en 2026. El resto se carga jueves en adelante, dejando menos margen antes de la entrega.', 'accent')}
      ${kpiCard('Oportunidades detectadas', rc.top_oportunidades.length, 'combinaciones corte × zona con alta demanda y baja disponibilidad',
        'Cruce entre percentil de demanda (kilos pedidos, dentro de cada zona) y % de disponibilidad relevada del corte en esa zona. Se muestran las combinaciones donde ambas señales indican una oportunidad de redistribución.')}
      ${kpiCard('Corte más crítico', rc.top_oportunidades[0]?.corte||'—', 'zona '+(rc.top_oportunidades[0]?.zona||'—'),
        'El corte con mayor "gap score" — combina qué tan alta es su demanda relativa dentro de la zona con qué tan baja es su disponibilidad relevada en góndola.', 'accent')}
    </div>

    <div class="card">
      <div class="card-head"><div><div class="card-title">¿Cuándo se cargan los pedidos, por zona?</div><div class="card-sub">Ventana ideal: lunes a miércoles, para llegar a la entrega miércoles-sábado</div></div></div>
      <div class="chart-wrap" style="height:300px;"><canvas id="chPedidosZonaDia"></canvas></div>
      <div class="table-scroll" style="margin-top:14px;"><table>
        <thead><tr><th>Zona</th><th class="num">Pedidos 2026</th><th class="num">En ventana ideal (Lun-Mié)</th><th class="num">% cumplimiento</th></tr></thead>
        <tbody>${rc.cumplimiento_por_zona.map(x=>`
          <tr><td>${x.zona}</td><td class="num">${fmtNum(x.total_pedidos)}</td><td class="num">${fmtNum(x.en_ventana_ideal)}</td>
          <td class="num"><span class="tag ${x.pct>=90?'tag-propio':(x.pct>=85?'tag-media':'tag-comp')}">${x.pct}%</span></td></tr>`).join('')}
        </tbody></table></div>
    </div>

    <div class="card">
      <div class="card-head"><div><div class="card-title">Top oportunidades de redistribución</div><div class="card-sub">Cortes con alta rotación pedida y baja disponibilidad relevada, por zona — priorizar entrega ahí</div></div></div>
      ${rc.top_oportunidades.length ? `
      <div class="table-scroll"><table>
        <thead><tr><th>Zona</th><th>Corte</th><th class="num">Kilos pedidos (2026)</th><th class="num">Percentil demanda</th><th class="num">Disponibilidad relevada</th></tr></thead>
        <tbody>${rc.top_oportunidades.map(x=>`
          <tr><td><span class="tag" style="background:${zonaColor[x.zona]}22; color:${zonaColor[x.zona]};">${x.zona}</span></td><td>${x.corte}</td>
          <td class="num">${fmtNum(x.kilos_pedidos_2026)}</td><td class="num">${x.demanda_percentil}%</td>
          <td class="num"><span class="tag tag-comp">${x.disponibilidad_pct}%</span></td></tr>`).join('')}
        </tbody></table></div>
      <div class="note-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
        <span>Ejemplo de lectura: "${rc.top_oportunidades[0].recomendacion}"</span>
      </div>` : `
      <div class="note-box">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
        <span>Todavía no está implementado el cruce de demanda vs. disponibilidad por zona.</span>
      </div>`}
    </div>`;
  }

  destroyChart('pedidosZonaDia');
  const datasets = zonas.map(z => ({
    label: z,
    data: dias.map(d => rc.pedidos_por_dia_y_zona[d]?.[z] || 0),
    backgroundColor: zonaColor[z], stack: 's', borderRadius: 4,
  }));
  charts['pedidosZonaDia'] = new Chart(document.getElementById('chPedidosZonaDia'), {
    type: 'bar',
    data: { labels: dias, datasets },
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'top', labels:{color:textCol}} },
      scales:{ x:{stacked:true, ticks:{color:textCol}, grid:{display:false}}, y:{stacked:true, ticks:{color:textCol}, grid:{color:gridBig}} } }
  });
}

/* ================= 7. CARNICERÍA ================= */
let carniceriaCorteFiltro = [];
function renderCarniceria(c, themeChanged){
  const cn = DATA.carniceria;
  const textCol = cssVar('--text2'), gridBig = cssVar('--border'), teal = cssVar('--teal'), amber = cssVar('--amber');
  const cortesAll = cn.precio_por_corte.map(x=>x.corte);

  if(!themeChanged){
    c.innerHTML = `
    ${cn.error ? `
    <div class="note-box top">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
      <span>No se pudo cargar la hoja de Carnicería: ${cn.error}</span>
    </div>` : ''}

    <div class="kpi-grid">
      ${kpiCard('Relevamientos', fmtNum(cn.total_relevamientos), 'en la ventana de 90 días',
        'Cantidad de filas de precio cargadas en la hoja Carnicería (Corte + Corte nuevo), dentro de la ventana móvil de 90 días.')}
      ${kpiCard('PDVs relevados', fmtNum(cn.pdvs_relevados), null,
        'Puntos de venta distintos del canal carnicería con al menos un precio relevado en la ventana.', 'accent')}
      ${kpiCard('Ciudades cubiertas', fmtNum(cn.ciudades_cubiertas), null,
        'Ciudades distintas con al menos un relevamiento de carnicería en la ventana.', 'blue')}
      ${kpiCard('Cortes nuevos detectados', fmtNum(cn.cortes_nuevos.length), 'cortes fuera del listado habitual, cargados por el relevador',
        'Filas donde el relevador cargó un corte fuera del listado estándar (columna "Corte nuevo"), con su propia marca y precio.', 'amber')}
    </div>

    <div class="card">
      <div class="card-head">
        <div><div class="card-title">Rango de precio por corte · Carnicería</div><div class="card-sub">Precio regular vs. precio oferta relevado</div></div>
        <input type="text" id="carniceriaCorteSearch" placeholder="Buscar corte..." style="padding:7px 12px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:13px; min-width:160px;">
      </div>
      <div class="chips" id="carniceriaCorteChips" style="margin:2px 0 14px;"></div>
      <div class="chart-wrap" style="height:340px;"><canvas id="chCarniceriaCortes"></canvas></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">Precios por ciudad</div></div>
        <div class="table-scroll"><table>
          <thead><tr><th>Ciudad</th><th class="num">PDVs</th><th class="num">Mín.</th><th class="num">Máx.</th></tr></thead>
          <tbody>${cn.por_ciudad.map(x=>`
            <tr><td>${x.ciudad}</td><td class="num">${x.pdvs}</td><td class="num">${fmtGs(x.precio_min)}</td><td class="num">${fmtGs(x.precio_max)}</td></tr>`).join('')}
          </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Cortes nuevos detectados</div></div>
        ${cn.cortes_nuevos.length ? `
        <div class="table-scroll"><table>
          <thead><tr><th>Corte</th><th>Marca</th><th class="num">Precio</th><th>PDV</th><th>Ciudad</th></tr></thead>
          <tbody>${cn.cortes_nuevos.slice(0,40).map(x=>`
            <tr><td>${x.corte}</td><td>${x.marca}</td><td class="num">${fmtGs(x.precio)}</td><td>${x.pdv}</td><td>${x.ciudad}</td></tr>`).join('')}
          </tbody></table></div>` : `
        <div class="note-box top"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg><span>Ningún corte nuevo detectado en la ventana.</span></div>`}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Detalle de relevamientos</div><div class="card-sub">Últimos ${cn.detalle.length} registros de la ventana</div></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Fecha</th><th>Relevador</th><th>PDV</th><th>Ciudad</th><th>Corte</th><th class="num">Regular</th><th class="num">Oferta</th></tr></thead>
        <tbody>${cn.detalle.map(x=>`
          <tr><td>${x.fecha}</td><td>${x.relevador}</td><td>${x.pdv}</td><td>${x.ciudad}</td><td>${x.corte}</td>
          <td class="num">${fmtGs(x.precio_regular)}</td><td class="num">${x.precio_oferta!=null?fmtGs(x.precio_oferta):'—'}</td></tr>`).join('')}
        </tbody></table></div>
    </div>`;

    carniceriaCorteFiltro = cortesAll.slice(0, Math.min(8, cortesAll.length));
    const chipsBox = document.getElementById('carniceriaCorteChips');
    const syncChips = () => {
      const allSelected = carniceriaCorteFiltro.length === cortesAll.length;
      chipsBox.querySelectorAll('.chip').forEach(chip => {
        if(chip.dataset.all){ chip.classList.toggle('active', allSelected); chip.textContent = allSelected ? 'Ver menos' : `Todos (${cortesAll.length})`; }
        else chip.classList.toggle('active', carniceriaCorteFiltro.includes(chip.dataset.corte));
      });
    };
    chipsBox.innerHTML = `<div class="chip" data-all="1"></div>` + cortesAll.map(ct=>`<div class="chip" data-corte="${ct}">${ct}</div>`).join('');
    syncChips();
    chipsBox.addEventListener('click', e => {
      const chip = e.target.closest('.chip'); if(!chip) return;
      if(chip.dataset.all){
        carniceriaCorteFiltro = carniceriaCorteFiltro.length === cortesAll.length
          ? cortesAll.slice(0, Math.min(8, cortesAll.length)) : [...cortesAll];
      } else {
        const ct = chip.dataset.corte;
        const willDeselect = chip.classList.contains('active');
        if(willDeselect && carniceriaCorteFiltro.length===1) return;
        carniceriaCorteFiltro = willDeselect ? carniceriaCorteFiltro.filter(x=>x!==ct) : [...carniceriaCorteFiltro, ct];
      }
      syncChips();
      drawCarniceriaChart();
    });
    document.getElementById('carniceriaCorteSearch').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      chipsBox.querySelectorAll('.chip[data-corte]').forEach(chip => { chip.style.display = chip.dataset.corte.toLowerCase().includes(q) ? '' : 'none'; });
    });
  }

  function drawCarniceriaChart(){
    destroyChart('carniceriaCortes');
    const rows = cn.precio_por_corte.filter(x => carniceriaCorteFiltro.includes(x.corte));
    charts['carniceriaCortes'] = new Chart(document.getElementById('chCarniceriaCortes'), {
      type: 'bar',
      data: {
        labels: rows.map(x=>x.corte),
        datasets: [
          { label: 'Precio regular', data: rows.map(x=>[x.regular_min, x.regular_max]), backgroundColor: teal, borderRadius: 5, maxBarThickness: 22, minBarLength: 4 },
          { label: 'Precio oferta', data: rows.map(x=> x.oferta_min==null ? null : [x.oferta_min, x.oferta_max]), backgroundColor: amber, borderRadius: 5, maxBarThickness: 22, minBarLength: 4 },
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { color: textCol, font: { family:'Outfit', size: 11 } } },
          tooltip: { callbacks: { label: (i)=> i.raw[0]==null ? `${i.dataset.label}: sin datos` : `${i.dataset.label}: ${fmtGs(i.raw[0])} – ${fmtGs(i.raw[1])}` } } },
        scales: {
          x: { ticks: { color: textCol, callback: v=>fmtNum(v) }, grid: { color: gridBig } },
          y: { ticks: { color: textCol, font:{family:'Outfit', size:11} }, grid: { display:false } }
        }
      }
    });
  }
  drawCarniceriaChart();
}

/* ---------------- BOOTSTRAP: carga en vivo desde Google Sheets ---------------- */
const liveDot = document.querySelector('.live-indicator .live-dot');
const liveLabel = document.querySelector('.live-indicator');
function setLiveStatus(state, msg){
  if (!liveDot) return;
  liveDot.style.background = state === 'ok' ? 'var(--teal)' : (state === 'error' ? 'var(--accent)' : 'var(--text2)');
  liveLabel.title = msg || '';
}
async function bootstrapData(){
  setLiveStatus('loading', 'Cargando datos de la planilla…');
  document.getElementById('content').innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <div class="loading-text">Cargando datos... aguarde un momento</div>
      <div class="loading-bar"><div class="loading-bar-fill"></div></div>
    </div>`;
  try {
    DATA = await loadMinervaData();
    setLiveStatus('ok', `Datos actualizados: ${DATA.meta.fecha_generacion} · ventana de ${DATA.meta.ventana.dias} días (${DATA.meta.ventana.desde} a ${DATA.meta.ventana.hasta})`);
    document.getElementById('dateFrom').value = DATA.meta.ventana.desde;
    document.getElementById('dateTo').value = DATA.meta.ventana.hasta;
    renderSection(currentSection);
  } catch (err) {
    console.error('Error al cargar datos en vivo:', err);
    setLiveStatus('error', err.message);
    document.getElementById('content').innerHTML = `
      <div class="card"><div class="card-head"><div class="card-title">No se pudieron cargar los datos</div></div>
      <div class="note-box"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
      <span>${err.message}</span></div></div>`;
  }
}
bootstrapData();
