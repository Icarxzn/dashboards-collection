/**
 * Produtividade por Operador — Web App (Apps Script)
 * Planilha: "Produtividade PE2"
 *   Productivity -> uma linha por operador: operator ("[OpsID]NOME"), efficiency_total e uma coluna por
 *                   hora ("19:00", "18:00", ... da mais recente para a mais antiga) + linha "TOTAL GERAL".
 *                   O carimbo "Atualizado: dd/MM/yyyy HH:mm:ss" fica no cabeçalho.
 */

const CONFIG = {
  SHEET_ID:  '1ro9a0FBqqtAetLoNS_8M885Dudw1f84jxUa_rI8FYNs',
  UNIDADE:   'PE2',
  ABA:       'Productivity',
  ABA_META:  'Meta',    // Data | Hora | Tipo processo | capacidade | Turno (soma das esteiras por data+hora)
  CACHE_SEG: 600,       // validade do cache; o gatilho renova a cada 1 min
};

function doGet() {
  garantirGatilho_();
  const t = HtmlService.createTemplateFromFile('Index');
  t.unidade = CONFIG.UNIDADE;
  return t.evaluate()
    .setTitle('Produtividade por Operador · ' + CONFIG.UNIDADE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Usado no Index.html: <?!= include('Styles'); ?> / <?!= include('JavaScript'); ?> */
function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

// ═══════════════════════════════════════════════════════════════
//  CACHE  (o painel lê daqui; o gatilho aquecerCache renova a cada 1 min)
// ═══════════════════════════════════════════════════════════════
const MONTADORES = {
  prod: () => montarProdutividade_(),
};

function getProdutividade() { return doCache_('prod'); }

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
const CACHE_PREFIXO = 'prodop_v1_';
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
 * { fetchedAt, horas: ["08:00", ...] (ordem cronológica),
 *   ops: [{ id, nome, h: [por hora], total }], geral: { h: [...], total } }
 */
function montarProdutividade_() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const tz = ss.getSpreadsheetTimeZone();
  const sh = ss.getSheetByName(CONFIG.ABA);
  if (!sh) return JSON.stringify({ error: 'Aba "' + CONFIG.ABA + '" não encontrada' });
  const values = sh.getDataRange().getDisplayValues();
  const head = values[0].map(h => String(h).trim());

  const iOp = head.indexOf('operator');
  const iTot = head.indexOf('efficiency_total');
  if (iOp < 0) return JSON.stringify({ error: 'Coluna "operator" não encontrada' });

  // Colunas de hora ("HH:mm"); a planilha vem da mais recente para a mais antiga -> inverte
  const colsHora = [];
  head.forEach((h, i) => { if (/^\d{1,2}:\d{2}$/.test(h)) colsHora.push(i); });
  colsHora.reverse();
  const horas = colsHora.map(i => head[i].padStart(5, '0'));

  const carimbo = head.map(h => /Atualizado:\s*(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})/.exec(h)).find(Boolean);
  const fetchedAt = carimbo
    ? carimbo[3] + '-' + carimbo[2] + '-' + carimbo[1] + 'T' + carimbo[4] + Utilities.formatDate(new Date(), tz, 'XXX')
    : new Date().toISOString();

  const num = v => Number(String(v || '').replace(/\./g, '').replace(',', '.')) || 0;
  const ops = [];
  let geral = null;
  values.slice(1).forEach(r => {
    const bruto = String(r[iOp] || '').trim();
    if (!bruto) return;
    const h = colsHora.map(i => num(r[i]));
    const somaH = h.reduce((a, b) => a + b, 0);
    const total = iTot >= 0 ? num(r[iTot]) || somaH : somaH;
    if (/^TOTAL/i.test(bruto)) { geral = { h: h, total: total }; return; }
    const m = /^\[([^\]]+)\]\s*(.*)$/.exec(bruto);
    ops.push({ id: m ? m[1] : '', nome: (m ? m[2] : bruto).trim(), h: h, total: total });
  });

  if (!geral) {
    const h = horas.map((_, k) => ops.reduce((a, o) => a + o.h[k], 0));
    geral = { h: h, total: ops.reduce((a, o) => a + o.total, 0) };
  }

  // Dia operacional (06:00 → 05:59): antes das 06h ainda vale o dia anterior
  const base = carimbo ? new Date(Number(carimbo[3]), Number(carimbo[2]) - 1, Number(carimbo[1]),
                                  Number(carimbo[4].slice(0, 2)), Number(carimbo[4].slice(3, 5)))
                       : new Date(Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss"));
  const agora = pad2_(base.getHours()) + ':' + pad2_(base.getMinutes());   // hora do carimbo
  const op = new Date(base.getTime());
  if (op.getHours() < 6) op.setDate(op.getDate() - 1);
  const diaOp = pad2_(op.getDate()) + '/' + pad2_(op.getMonth() + 1) + '/' + op.getFullYear();

  return JSON.stringify({ fetchedAt: fetchedAt, agora: agora, diaOp: diaOp, horas: horas, ops: ops, geral: geral,
                          meta: lerMeta_(ss, diaOp, num) });
}

/** Meta por hora do dia operacional: { "6": 4568, "7": 8818, ... } (soma de todas as esteiras) */
function lerMeta_(ss, diaOp, num) {
  const sh = ss.getSheetByName(CONFIG.ABA_META);
  if (!sh || sh.getLastRow() < 2) return {};
  const v = sh.getRange(1, 1, sh.getLastRow(), 4).getDisplayValues();
  const head = v[0].map(h => String(h).trim().toLowerCase());
  const iData = head.indexOf('data'), iHora = head.indexOf('hora'), iCap = head.indexOf('capacidade');
  if (iData < 0 || iHora < 0 || iCap < 0) return {};
  const meta = {};
  for (let r = 1; r < v.length; r++) {
    if (String(v[r][iData]).trim() !== diaOp) continue;
    const h = parseInt(v[r][iHora], 10);
    if (isNaN(h)) continue;
    meta[h] = (meta[h] || 0) + num(v[r][iCap]);
  }
  return meta;
}

function pad2_(n) { return ('0' + n).slice(-2); }
