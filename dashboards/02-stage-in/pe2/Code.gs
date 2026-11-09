/**
 * Inbound Staging Area Dashboard — Web App (Apps Script)
 * Planilha: "Stage IN PE2"
 *   Stage IN -> ruas do inbound staging (mesmos campos da API SPX inbound_staging_area)
 *   Consulta -> TOs/gaiolas por rua com pacotes e aging (faz o papel da planilha "Report")
 */

const CONFIG = {
  SHEET_ID:  '1eYzK7P5vU5ss2e8OapEzOUPGECXMOl4KKee6WTifHrQ',
  UNIDADE:   'PE2',
  ABA_STAGE: 'Stage IN',
  ABA_TOS:   'Consulta',
  CACHE_SEG: 600,       // validade do cache; o gatilho renova a cada 1 min
};

const NUMERICOS = ['capacity', 'status', 'to_quantity', 'cage_quantity', 'staging_duration_time'];

// Turno pela hora em que a TO foi endereçada
const TURNOS = [
  { id: 'T1', de: 6,  ate: 14 },
  { id: 'T2', de: 14, ate: 22 },
  { id: 'T3', de: 22, ate: 6  },
];

function doGet() {
  garantirGatilho_();
  const t = HtmlService.createTemplateFromFile('Index');
  t.unidade = CONFIG.UNIDADE;
  t.appUrl = ScriptApp.getService().getUrl();
  return t.evaluate()
    .setTitle('Inbound Staging Area · ' + CONFIG.UNIDADE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Usado no Index.html: <?!= include('Styles'); ?> / <?!= include('JavaScript'); ?> */
function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

function planilha_() {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID);
}

// ═══════════════════════════════════════════════════════════════
//  CACHE  (o painel lê daqui; o gatilho aquecerCache renova a cada 1 min)
// ═══════════════════════════════════════════════════════════════
const MONTADORES = {
  stage:  () => montarStageIn_(),
  report: () => montarReportData_(),
};

function getStageIn()    { return doCache_('stage'); }
function getReportData() { return doCache_('report'); }

function doCache_(chave) {
  const hit = lerCache_(chave);
  if (hit) return hit;
  const json = MONTADORES[chave]();
  gravarCache_(chave, json);
  return json;
}

/** Gatilho de tempo: relê a planilha e deixa tudo pronto no cache. */
function aquecerCache() {
  Object.keys(MONTADORES).forEach(k => {
    try { gravarCache_(k, MONTADORES[k]()); } catch (e) { console.warn('aquecerCache ' + k + ': ' + e); }
  });
}

// O CacheService aceita até 100 KB por chave: o JSON vai compactado (gzip + base64) e fatiado.
const CACHE_PREFIXO = 'stagein_v1_';
const CACHE_FATIA = 90000;

function lerCache_(chave) {
  try {
    const cache = CacheService.getScriptCache();
    const base = CACHE_PREFIXO + chave;
    const n = Number(cache.get(base + '_n'));
    if (!n) return null;
    const chaves = [];
    for (let i = 0; i < n; i++) chaves.push(base + '_' + i);
    const partes = cache.getAll(chaves);
    if (Object.keys(partes).length !== n) return null;
    const b64 = chaves.map(k => partes[k]).join('');
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip');
    return Utilities.ungzip(blob).getDataAsString('UTF-8');
  } catch (e) {
    return null;
  }
}

function gravarCache_(chave, json) {
  try {
    const base = CACHE_PREFIXO + chave;
    const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json, 'application/json')).getBytes());
    const itens = {};
    let n = 0;
    for (let i = 0; i < b64.length; i += CACHE_FATIA) itens[base + '_' + n++] = b64.substr(i, CACHE_FATIA);
    itens[base + '_n'] = String(n);
    CacheService.getScriptCache().putAll(itens, CONFIG.CACHE_SEG);
  } catch (e) {
    console.warn('Cache não gravado (' + chave + '): ' + e);
  }
}

function garantirGatilho_() {
  try {
    const existe = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'aquecerCache');
    if (!existe) ScriptApp.newTrigger('aquecerCache').timeBased().everyMinutes(1).create();
  } catch (e) {
    console.warn('Gatilho não criado: ' + e);
  }
}

// ═══════════════════════════════════════════════════════════════
//  LEITURA DA PLANILHA
// ═══════════════════════════════════════════════════════════════

/** Equivalente ao /api/stage-in: { fetchedAt, list: [ {area_name, staging_group_name, ...} ] } */
function montarStageIn_() {
  const ss = planilha_();
  const sh = ss.getSheetByName(CONFIG.ABA_STAGE);
  if (!sh) return JSON.stringify({ error: 'Aba "' + CONFIG.ABA_STAGE + '" não encontrada' });
  const values = sh.getDataRange().getDisplayValues();
  const head = values[0].map(h => String(h).trim());

  // Carimbo "Atualizado: dd/MM/yyyy HH:mm:ss" no cabeçalho; sem ele, usa a hora da leitura
  const carimbo = head.map(h => /Atualizado:\s*(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})/.exec(h)).find(Boolean);
  const fetchedAt = carimbo
    ? carimbo[3] + '-' + carimbo[2] + '-' + carimbo[1] + 'T' + carimbo[4] + offset_(ss)
    : new Date().toISOString();

  const campos = head.filter(h => h && !/^Atualizado:/.test(h));
  const list = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!String(r[head.indexOf('area_name')] || '').trim()) continue;
    const o = {};
    campos.forEach(k => {
      const v = r[head.indexOf(k)];
      o[k] = NUMERICOS.indexOf(k) >= 0 ? (Number(v) || 0) : String(v).trim();
    });
    list.push(o);
  }
  return JSON.stringify({ fetchedAt: fetchedAt, list: list });
}

/**
 * Equivalente ao /api/report-data:
 * { byZone: {zona: {pacotes}}, byArea: {rua: {pacotes, zona, to_quantity}},
 *   byAreaTOs: {rua: [{to, pacotes, aging_h, hora_end, turno}]}, byTurno: {T1: {pacotes}}, rowCount }
 */
function montarReportData_() {
  const ss = planilha_();
  const sh = ss.getSheetByName(CONFIG.ABA_TOS);
  if (!sh) return JSON.stringify({ error: 'Aba "' + CONFIG.ABA_TOS + '" não encontrada' });
  const values = sh.getDataRange().getDisplayValues();
  const head = values[0].map(h => String(h).trim());
  const c = {};
  ['mapping_item_number', 'staging_area_name', 'group_name', 'aging_hours', 'num_packs_in_staging', 'last_update']
    .forEach(k => { c[k] = head.indexOf(k); });
  const tz = ss.getSpreadsheetTimeZone();

  // A mesma TO pode aparecer mais de uma vez: fica a última linha
  const porTo = {};
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const to = String(r[c.mapping_item_number] || '').trim();
    const rua = String(r[c.staging_area_name] || '').trim();
    if (!to || !rua) continue;
    const aging = num_(r[c.aging_hours]);
    const fim = epoch_(r[c.last_update], tz);
    const end = fim ? new Date(fim - aging * 3600000) : null;
    const hora = end ? Number(Utilities.formatDate(end, tz, 'H')) : null;
    porTo[to] = {
      to: to,
      rua: rua,
      zona: String(r[c.group_name] || '').trim(),
      pacotes: num_(r[c.num_packs_in_staging]),
      aging_h: aging,
      hora_end: end ? Utilities.formatDate(end, tz, 'dd/MM HH:mm') : '—',
      turno: hora === null ? '' : turnoDaHora_(hora),
    };
  }

  const byZone = {}, byArea = {}, byAreaTOs = {}, byTurno = {};
  Object.keys(porTo).forEach(k => {
    const t = porTo[k];
    const z = byZone[t.zona] || (byZone[t.zona] = { pacotes: 0 });
    z.pacotes += t.pacotes;
    const a = byArea[t.rua] || (byArea[t.rua] = { pacotes: 0, zona: t.zona, to_quantity: 0 });
    a.pacotes += t.pacotes;
    if (!/^CG/i.test(t.to)) a.to_quantity++;
    (byAreaTOs[t.rua] || (byAreaTOs[t.rua] = [])).push({
      to: t.to, pacotes: t.pacotes, aging_h: t.aging_h, hora_end: t.hora_end, turno: t.turno,
    });
    if (t.turno) {
      const tu = byTurno[t.turno] || (byTurno[t.turno] = { pacotes: 0 });
      tu.pacotes += t.pacotes;
    }
  });

  return JSON.stringify({
    geradoEm: Date.now(),
    rowCount: Object.keys(porTo).length,
    byZone: byZone, byArea: byArea, byAreaTOs: byAreaTOs, byTurno: byTurno,
  });
}

function turnoDaHora_(h) {
  const t = TURNOS.find(x => x.de < x.ate ? (h >= x.de && h < x.ate) : (h >= x.de || h < x.ate));
  return t ? t.id : '';
}

/** "0,47" / "1.234,5" / "95" -> número */
function num_(v) {
  const s = String(v || '').trim();
  if (!s) return 0;
  const n = s.indexOf(',') >= 0 ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return isNaN(n) ? 0 : n;
}

/** "yyyy-MM-dd HH:mm:ss[.SSS]" no fuso da planilha -> milissegundos */
function epoch_(v, tz) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(v || '').trim());
  if (!m) return null;
  const off = Utilities.formatDate(new Date(), tz, 'XXX');
  return new Date(m[1] + 'T' + m[2] + off).getTime();
}

function offset_(ss) {
  return Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'XXX');
}
