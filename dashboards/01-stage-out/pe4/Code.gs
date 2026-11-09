/**
 * Staging Area Dashboard — Web App (Apps Script)
 * Planilha: "Stage OUT - PE4"
 *   Stage OUT -> lista de ruas (mesmos campos da API SPX Staging Area Outbound)
 *   Packed    -> TOs fechadas (sacas), agrupadas por dest_station_id
 */

const CONFIG = {
  SHEET_ID: '1iDoTjbpZ1pZjJSg2zLNiQhROvDWJ_WGD1stWLAD9364',
  ABA_STAGE: 'Stage OUT',
  ABA_SACAS: 'Packed',
  PACK_SACA: /saca/i,   // pack_name que conta como saca
  CACHE_SEG: 600,       // validade do cache; o gatilho renova a cada 1 min
};

const NUMERICOS = ['staging_area_status', 'capacity', 'transport_order_quantity', 'loose_order_quantity',
  'priority', 'cage_quantity', 'staging_duration_time'];

function doGet() {
  garantirGatilho_();
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Staging Area Dashboard · PE4')
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
//  JUSTIFICATIVAS  (aba "Justificativas" na própria planilha, criada na 1ª gravação)
// ═══════════════════════════════════════════════════════════════
const ABA_JUST = 'Justificativas';
const CAB_JUST = ['data', 'chave', 'rua_id', 'rua', 'destino', 'farol', 'tempo_h', 'motivo', 'observacao', 'responsavel', 'usuario'];

/** Lista de justificativas: [{chave, rua, destino, motivo, observacao, responsavel, data}] */
function getJustificativas() {
  const sh = planilha_().getSheetByName(ABA_JUST);
  if (!sh || sh.getLastRow() < 2) return JSON.stringify([]);
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, CAB_JUST.length).getDisplayValues();
  return JSON.stringify(values.map(r => {
    const o = {};
    CAB_JUST.forEach((k, i) => { o[k] = r[i]; });
    return o;
  }));
}

/** Grava uma justificativa por rua: j = { ruas: [{chave, rua_id, rua, farol, tempo_h}], destino, motivo, observacao, responsavel } */
function salvarJustificativa(j) {
  if (!j || !j.ruas || !j.ruas.length || !j.motivo) throw new Error('Informe a rua e o motivo.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = planilha_();
    let sh = ss.getSheetByName(ABA_JUST);
    if (!sh) {
      sh = ss.insertSheet(ABA_JUST);
      sh.appendRow(CAB_JUST);
      sh.setFrozenRows(1);
    }
    let usuario = '';
    try { usuario = Session.getActiveUser().getEmail(); } catch (e) {}
    const agora = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const linhas = j.ruas.map(r => [agora, r.chave, r.rua_id, r.rua, j.destino || '', r.farol || '', r.tempo_h || '',
      j.motivo, j.observacao || '', j.responsavel || '', usuario]);
    sh.getRange(sh.getLastRow() + 1, 1, linhas.length, CAB_JUST.length).setValues(linhas);
  } finally {
    lock.releaseLock();
  }
  return getJustificativas();
}

// ═══════════════════════════════════════════════════════════════
//  CACHE  (o painel lê daqui; o gatilho aquecerCache renova a cada 1 min)
// ═══════════════════════════════════════════════════════════════
const MONTADORES = {
  stage:  () => montarStageOut_(),
  cage:   () => montarCageData_(),
};

function getStageOut() { return doCache_('stage'); }
function getCageData() { return doCache_('cage'); }
function getReport()   { return doCache_('report'); }

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
const CACHE_PREFIXO = 'stageout_v1_';
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

/** Equivalente ao /api/stage-out: { fetchedAt, list: [ {staging_area_id, ...} ] } */
function montarStageOut_() {
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
    if (!r[0]) continue;
    const o = {};
    campos.forEach(k => {
      const v = r[head.indexOf(k)];
      o[k] = NUMERICOS.indexOf(k) >= 0 ? (Number(v) || 0) : v;
    });
    list.push(o);
  }
  return JSON.stringify({ fetchedAt: fetchedAt, list: list });
}

/** Equivalente ao /api/cage-data, mas por destino: { byDest: { '7743': { sacas, pedidos } }, total } */
function montarCageData_() {
  const tos = lerSacas_();
  const byDest = {};
  tos.forEach(t => {
    const d = byDest[t.dest] || (byDest[t.dest] = { sacas: 0, pedidos: 0 });
    d.sacas++;
    d.pedidos += t.quantity;
  });
  return JSON.stringify({ byDest: byDest, total: tos.length });
}

/** Detalhe da rua (modal): dados da rua + sacas Packed do destino dela */
function getRuaDetail(staging_area_id) {
  const stage = JSON.parse(getStageOut());
  if (stage.error) return JSON.stringify({ error: stage.error });
  const rua = stage.list.find(r => r.staging_area_id === staging_area_id);
  if (!rua) return JSON.stringify({ error: 'Rua ' + staging_area_id + ' não está na aba ' + CONFIG.ABA_STAGE });

  const m = /^\[(\d+)\]/.exec(rua.to_destination || '');
  const dest = m ? m[1] : '';
  const items = lerSacas_()
    .filter(t => t.dest === dest)
    .sort((a, b) => (b.scan_time || 0) - (a.scan_time || 0))
    .map(t => ({
      target_item_type: 2,
      target_item_number: t.to_number,
      to_receiver: t.receiver,
      quantity: t.quantity,
      scan_time: t.scan_time,
    }));
  rua.items = items;
  return JSON.stringify(rua);
}

/** Aba Report: todas as TOs da aba Packed (Saca, Scuttle, Pallet...) */
function montarReport_() {
  const ss = planilha_();
  const sh = ss.getSheetByName(CONFIG.ABA_SACAS);
  if (!sh) return JSON.stringify({ error: 'Aba "' + CONFIG.ABA_SACAS + '" não encontrada' });
  const values = sh.getDataRange().getValues();
  const head = values[0].map(h => String(h).trim());
  const c = {};
  ['to_number', 'operator', 'pack_name', 'quantity', 'weight', 'ctime', 'dest_station_name', 'status']
    .forEach(k => { c[k] = head.indexOf(k); });
  const tz = ss.getSpreadsheetTimeZone();
  const v = (r, k) => c[k] < 0 ? '' : r[c[k]];
  const tos = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!v(r, 'to_number')) continue;
    tos.push([
      String(v(r, 'to_number')),
      String(v(r, 'operator')).replace(/^\[.*?\]\s*/, ''),
      String(v(r, 'pack_name') || '—'),
      Number(v(r, 'quantity')) || 0,
      Number(v(r, 'weight')) || 0,          // gramas
      epochSeg_(v(r, 'ctime'), tz),
      String(v(r, 'dest_station_name') || '—'),
      String(v(r, 'status') || ''),
    ]);
  }
  return JSON.stringify({ geradoEm: Math.floor(Date.now() / 1000), tos: tos });
}

function lerSacas_() {
  const ss = planilha_();
  const sh = ss.getSheetByName(CONFIG.ABA_SACAS);
  if (!sh) throw new Error('Aba "' + CONFIG.ABA_SACAS + '" não encontrada');
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0].map(h => String(h).trim());
  const c = {};
  ['to_number', 'receiver', 'dest_station_id', 'complete_time', 'quantity', 'pack_name']
    .forEach(k => { c[k] = head.indexOf(k); });
  const tz = ss.getSpreadsheetTimeZone();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[c.to_number]) continue;
    if (c.pack_name >= 0 && !CONFIG.PACK_SACA.test(String(r[c.pack_name]))) continue;
    out.push({
      to_number: String(r[c.to_number]),
      receiver: String(r[c.receiver] || ''),
      dest: String(r[c.dest_station_id] || '').trim(),
      quantity: Number(r[c.quantity]) || 0,
      scan_time: epochSeg_(r[c.complete_time], tz),
    });
  }
  return out;
}

/** Date ou "yyyy-MM-dd HH:mm:ss" (fuso da planilha) -> segundos Unix */
function epochSeg_(v, tz) {
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(v || '').trim());
  if (!m) return null;
  const off = Utilities.formatDate(new Date(), tz, 'XXX');
  return Math.floor(new Date(m[1] + 'T' + m[2] + off).getTime() / 1000);
}

function offset_(ss) {
  return Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'XXX');
}
