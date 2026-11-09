/**
 * Produtividade de Sacas — Web App (Apps Script)
 * Planilha: "Saca management PE2"
 *   Saca management -> histórico de TOs packed (dt_complete, to_number, destino, orders, unitizador)
 *   Planejamento    -> capacidade planejada por data/hora/esteira
 */

const CONFIG = {
  SHEET_ID:      '1d73wxdpuN4pm_IvomoB70WoPn8X4nZ8O0Kf2gSexz-0',
  UNIDADE:       'PE2',
  STATION_LABEL: 'SoC_PE_Jaboatão dos Guararapes',
  ABA_HIST:      'Saca management',
  ABA_PLAN:      'Planejamento',
  CACHE_SEG:     600,       // validade do cache; o gatilho renova a cada 1 min
};

function doGet() {
  garantirGatilho_();
  const t = HtmlService.createTemplateFromFile('Index');
  t.unidade = CONFIG.UNIDADE;
  t.stationLabel = CONFIG.STATION_LABEL;
  return t.evaluate()
    .setTitle('Produtividade de Sacas · ' + CONFIG.UNIDADE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, viewport-fit=cover')
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
  hist: () => montarHistorico_(),
  plan: () => montarPlanejamento_(),
};

function getSacasHistory()     { return doCache_('hist'); }
function getSacasPlanejamento() { return doCache_('plan'); }

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
const CACHE_PREFIXO = 'sacas_v1_';
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

/**
 * Equivalente ao /api/sacas-history, compactado (o histórico tem dezenas de milhares de TOs):
 * { fetchedAt, dests: [nome], tipos: [unitizador], list: [[to_number, iDest, pacotes, iTipo, complete_time]] }
 */
function montarHistorico_() {
  const ss = planilha_();
  const tz = ss.getSpreadsheetTimeZone();
  const sh = ss.getSheetByName(CONFIG.ABA_HIST);
  if (!sh) return JSON.stringify({ error: 'Aba "' + CONFIG.ABA_HIST + '" não encontrada' });
  const values = sh.getDataRange().getDisplayValues();
  const head = values[0].map(h => String(h).trim());
  const c = {};
  head.forEach((h, i) => { if (h && !(h in c)) c[h] = i; });

  const carimbo = head.map(h => /Atualizado:\s*(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})/.exec(h)).find(Boolean);
  const fetchedAt = carimbo
    ? carimbo[3] + '-' + carimbo[2] + '-' + carimbo[1] + 'T' + carimbo[4] + offset_(tz)
    : new Date().toISOString();

  const dests = dic_(), tipos = dic_();
  const off = offset_(tz);
  const list = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const to = String(r[c.to_number] || '').trim();
    if (!to) continue;
    list.push([
      to,
      dests.id(String(r[c.dest_station_name] || '').trim()),
      num_(r[c.orders]),
      tipos.id(String(r[c.unitizador] || '').trim()),
      epochSeg_(r[c.dt_complete], off),
    ]);
  }
  return JSON.stringify({ fetchedAt: fetchedAt, dests: dests.lista, tipos: tipos.lista, list: list });
}

/** Equivalente ao /api/sacas-planejamento: { list: [{ data: 'dd/MM/yyyy', hora, planejadoGeral }] } (soma das esteiras) */
function montarPlanejamento_() {
  const ss = planilha_();
  const sh = ss.getSheetByName(CONFIG.ABA_PLAN);
  if (!sh) return JSON.stringify({ error: 'Aba "' + CONFIG.ABA_PLAN + '" não encontrada' });
  const values = sh.getDataRange().getDisplayValues();
  const head = values[0].map(h => String(h).trim().toLowerCase());
  const cData = head.indexOf('data'), cHora = head.indexOf('hora'), cCap = head.indexOf('capacidade');
  const soma = {};
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const data = String(r[cData] || '').trim();
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data)) continue;
    const hora = parseInt(r[cHora], 10);
    if (isNaN(hora)) continue;
    const k = data + '|' + hora;
    soma[k] = (soma[k] || 0) + num_(r[cCap]);
  }
  const list = Object.keys(soma).map(k => {
    const [data, hora] = k.split('|');
    return { data: data, hora: Number(hora), planejadoGeral: soma[k] };
  });
  return JSON.stringify({ list: list });
}

function dic_() {
  const map = {}, lista = [];
  return {
    lista: lista,
    id: s => {
      if (!(s in map)) { map[s] = lista.length; lista.push(s); }
      return map[s];
    },
  };
}

/** "4.250" / "1.234,5" / "169" -> número */
function num_(v) {
  const s = String(v || '').trim();
  if (!s) return 0;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/** "yyyy-MM-dd HH:mm:ss" no fuso da planilha -> segundos Unix */
function epochSeg_(s, off) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(s || '').trim());
  if (!m) return 0;
  return Math.floor(new Date(m[1] + 'T' + m[2] + off).getTime() / 1000);
}

function offset_(tz) {
  return Utilities.formatDate(new Date(), tz, 'XXX');
}
