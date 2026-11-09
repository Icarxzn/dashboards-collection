/**
 * TO's Packing Dashboard — Web App (Apps Script)
 * Planilha: "Packing PE2"
 *   Packing -> TOs em embalagem (mesmos campos da API SPX general_to/outbound/search, status Packing)
 */

const CONFIG = {
  SHEET_ID:  '1kYFVON190UYh4XiDnR0923w1tsp8E43lVBqtCiZTZzs',
  UNIDADE:   'PE2',
  ABA_TOS:   'Packing',
  CACHE_SEG: 600,       // validade do cache; o gatilho renova a cada 1 min
};

// Campos da aba Packing enviados ao painel
const CAMPOS_TOS = ['to_number', 'current_station_name', 'ctime', 'complete_time', 'operator', 'sender',
  'receiver', 'dest_station_id', 'dest_station_name', 'weight', 'status', 'quantity', 'pack_name',
  'staging_area_id', 'lh_trip_number', 'display_direction'];
const DATAS_TOS = ['ctime', 'complete_time'];
const NUM_TOS = ['weight', 'quantity'];

function doGet() {
  garantirGatilho_();
  const t = HtmlService.createTemplateFromFile('Index');
  t.unidade = CONFIG.UNIDADE;
  return t.evaluate()
    .setTitle("TO's Packing Dashboard · " + CONFIG.UNIDADE)
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
  packing: () => montarPacking_(),
};

function getTosPacking() { return doCache_('packing'); }

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
const CACHE_PREFIXO = 'packing_v1_';
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

/** Equivalente ao /api/tos-packing: { fetchedAt, list: [ {to_number, ctime, ...} ] } */
function montarPacking_() {
  const ss = planilha_();
  const tz = ss.getSpreadsheetTimeZone();
  const sh = ss.getSheetByName(CONFIG.ABA_TOS);
  if (!sh) return JSON.stringify({ error: 'Aba "' + CONFIG.ABA_TOS + '" não encontrada' });
  const values = sh.getDataRange().getDisplayValues();
  const head = values[0].map(h => String(h).trim());
  const col = {};
  head.forEach((h, i) => { if (h && !/^Atualizado:/.test(h) && !(h in col)) col[h] = i; });

  // Carimbo "Atualizado: dd/MM/yyyy HH:mm:ss" (o primeiro do cabeçalho); sem ele, usa a hora da leitura
  const carimbo = head.map(h => /Atualizado:\s*(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})/.exec(h)).find(Boolean);
  const fetchedAt = carimbo
    ? carimbo[3] + '-' + carimbo[2] + '-' + carimbo[1] + 'T' + carimbo[4] + offset_(tz)
    : new Date().toISOString();

  const list = [];
  values.slice(1).forEach(r => {
    if (!r[col.to_number]) return;
    const o = {};
    CAMPOS_TOS.forEach(k => {
      if (col[k] === undefined) return;
      const v = String(r[col[k]] || '').trim();
      o[k] = DATAS_TOS.indexOf(k) >= 0 ? epochSeg_(v, tz)
           : NUM_TOS.indexOf(k) >= 0 ? (Number(v) || 0)
           : v;
    });
    list.push(o);
  });
  return JSON.stringify({ fetchedAt: fetchedAt, list: list });
}

/** "yyyy-MM-dd HH:mm:ss" no fuso da planilha -> segundos Unix */
function epochSeg_(s, tz) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(s || '').trim());
  if (!m) return 0;
  return Math.floor(new Date(m[1] + 'T' + m[2] + offset_(tz)).getTime() / 1000);
}

function offset_(tz) {
  return Utilities.formatDate(new Date(), tz, 'XXX');
}
