/**
 * Queue List · Inbound — Web App (Apps Script)
 * Planilha: "Queue list PE4"
 *   Inbound Queue List] -> fila de veículos (mesmos campos da API SPX inbound queue list)
 * A planilha não tem a API de trips (ETA, origem, status do linehaul): cada item da fila vira
 * uma "viagem" cuja chegada é a entrada na fila e cujo status sai do queue_status.
 */

const CONFIG = {
  SHEET_ID:  '1EKYXxW3rbpTsI3UQ3mlMRc5ZP7QDC9Q-ksc04rrIEIY',
  UNIDADE:   'PE4',
  ABA_QUEUE: 'Inbound Queue List]',
  ATIVOS:    [1, 2, 3, 5],   // queue_status na fila; 4 = liberado (já saiu)
  CACHE_SEG: 600,            // validade do cache; o gatilho renova a cada 1 min
};

function doGet() {
  garantirGatilho_();
  const t = HtmlService.createTemplateFromFile('Index');
  t.unidade = CONFIG.UNIDADE;
  return t.evaluate()
    .setTitle('Queue List · Inbound · ' + CONFIG.UNIDADE)
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
  queue: () => montarQueue_(),
};

function getQueueData() { return doCache_('queue'); }

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
const CACHE_PREFIXO = 'queue_v1_';
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
 * Equivalente a /api/queue + /api/trips:
 * { queue: { list: [item da fila no formato da API] }, trips: { fetchedAt, list: [] } }
 * A trips fica vazia; o painel monta as viagens a partir da fila (itens "queue-only").
 */
function montarQueue_() {
  const ss = planilha_();
  const sh = ss.getSheetByName(CONFIG.ABA_QUEUE);
  if (!sh) return JSON.stringify({ error: 'Aba "' + CONFIG.ABA_QUEUE + '" não encontrada' });
  const values = sh.getDataRange().getDisplayValues();
  const head = values[0].map(h => String(h).trim());
  const col = k => head.indexOf(k);
  const tz = ss.getSpreadsheetTimeZone();

  // Carimbo "Atualizado: dd/MM/yyyy HH:mm:ss" no cabeçalho; sem ele, usa a hora da leitura
  const carimbo = head.map(h => /Atualizado:\s*(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})/.exec(h)).find(Boolean);
  const fetchedAt = carimbo
    ? carimbo[3] + '-' + carimbo[2] + '-' + carimbo[1] + 'T' + carimbo[4] + offset_(tz)
    : new Date().toISOString();

  const v = (r, k) => col(k) < 0 ? '' : String(r[col(k)] || '').trim();
  const n = (r, k) => Number(v(r, k)) || 0;

  // A aba guarda o histórico: a mesma fila pode aparecer mais de uma vez; vale a entrada mais recente
  const porFila = {};
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const id = v(r, 'queue_id') || v(r, 'queue_number');
    if (!id) continue;
    const entrada = epochSeg_(v(r, 'add_to_queue_time'), tz) || 0;
    if (porFila[id] && porFila[id].entrada >= entrada) continue;
    porFila[id] = { r: r, entrada: entrada };
  }

  const list = [];
  Object.keys(porFila).forEach(id => {
    const r = porFila[id].r;
    const status = n(r, 'queue_status');
    if (CONFIG.ATIVOS.indexOf(status) < 0) return;
    const entrada = porFila[id].entrada;
    list.push({
      queue_id:           v(r, 'queue_id'),
      queue_number:       v(r, 'queue_number'),
      queue_status:       status,
      waiting_time:       n(r, 'waiting_time'),
      on_hold_time:       n(r, 'on_hold_time'),
      order_quantity:     n(r, 'order_quantity'),
      assigned_dock_name: v(r, 'assigned_dock_name'),
      occupied_dock_name: v(r, 'occupied_dock_name'),
      is_prioritized:     n(r, 'is_prioritized'),
      add_to_queue_time:  entrada,
      route_info: {
        lh_trip_number:    v(r, 'lh_trip_number'),
        trip_name:         v(r, 'lh_trip_name'),
        vehicle_number:    v(r, 'vehicle_number'),
        driver_name:       v(r, 'driver_name'),
        vehicle_type_name: v(r, 'vehicle_type_name'),
        agency_name:       v(r, 'agency'),
      },
      // Estação destino (aqui): chegada = entrada na fila; ocupando doca = descarregando (60), senão na fila (50)
      _trip_detail: {
        vehicle_type_name: v(r, 'vehicle_type_name'),
        agency_name:       v(r, 'agency'),
        trip_station: [{
          sequence_number:     2,
          station_name:        'SoC ' + CONFIG.UNIDADE,
          trip_station_status: status === 3 ? 60 : 50,
          ata:                 entrada,
          eta:                 0,
          atd:                 0,
          unload_quantity:     0,
        }],
      },
    });
  });

  return JSON.stringify({
    queue: { list: list },
    trips: { fetchedAt: fetchedAt, list: [] },
  });
}

/** "yyyy-MM-dd HH:mm:ss" no fuso da planilha -> segundos Unix */
function epochSeg_(s, tz) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(s || '').trim());
  if (!m) return null;
  return Math.floor(new Date(m[1] + 'T' + m[2] + offset_(tz)).getTime() / 1000);
}

function offset_(tz) {
  return Utilities.formatDate(new Date(), tz, 'XXX');
}
