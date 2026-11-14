/**********************************************************************
 * FIRST MILE — CONTROL TOWER
 * Backend (Google Apps Script) — leitura da planilha [VIS] - FirstMille,
 * separacao Pickup x Fila x Concluidas por trip e configuracao persistida.
 *
 * Fonte de dados (uma planilha so — SPREADSHEET_ID abaixo):
 *   Aba "FMTrip" .............: uma linha por trip (coleta, chegada ao SOC,
 *                               ultimo inbound, pedidos e pacotes)
 *   Aba "Inbound Queue List" .: fila do SOC (placa, agencia, doca, status).
 *                               So entram chegadas First Mile (arrival_type 7),
 *                               casadas com a trip pelo driver_id.
 *
 * Etapa de cada trip:
 *   Pickup ......: tem coleta e ainda nao chegou ao SOC
 *   Fila ........: chegou ao SOC e o inbound ainda nao terminou
 *   Concluida ...: inbound terminou (Last Handover = ultimo_inbound)
 *
 * Os thresholds / SLA NAO ficam fixos no frontend: os padroes vivem
 * em DEFAULT_CONFIG e sao editaveis em runtime pelo painel de
 * Configuracoes (persistidos em PropertiesService).
 **********************************************************************/
var SPREADSHEET_ID = '1m7EKgvfEBdGiCW032sZKB6mf2QqIpYJfK-aDlo_E5zc';
var DEFAULT_TAB_TRIPS = 'FMTrip';
var DEFAULT_TAB_QUEUE = 'Inbound Queue List';
var FM_ARRIVAL_TYPE = 7;        // arrival_type da fila para First Mile (1 = Line Haul)
var QUEUE_DONE_STATUS = 4;      // queue_status: saiu da fila (finalizado)
var TRIP_CANCELLED_STATUS = 4;  // business_status da FMTrip: trip cancelada
// agency_id da FMTrip -> nome (tirado da propria fila). So e usado quando a
// trip nao casa com nenhuma linha da fila.
var AGENCY_NAMES = { '19': 'DHL', '85': 'AVISTALOGISTICA', '96': 'SPXOWNFLEET' };
var QUEUE_STATUS_LABEL = { '1': 'Na fila', '3': 'Em doca', '4': 'Finalizado' };
// Docas internas de First Mile mostradas no quadro "Status das docas" (vazias tambem).
var FM_DOCKS = ['Doca Interna 76 FM', 'Doca Interna 77 FM', 'Doca Interna 78 FM', 'Doca Interna 79 FM', 'Doca Interna 80 FM'];
var CONFIG_KEY = 'FMCT_CONFIG_V1';
var APP_VERSION = '2.0.0';

/** Colunas lidas de cada aba (cabecalhos normalizados). */
var TRIP_COLS = ['trip_id', 'route_display_name', 'cluster_name', 'vehicle_type', 'driver_id', 'driver_name',
  'agency_id', 'business_status', 'primeira_coleta', 'ultima_coleta', 'chegou_soc', 'ultimo_inbound',
  'pedidos', 'pacotes_coletados', 'pacotes_a_caminho', 'pacotes_recebidos',
  'saida_prevista', 'chegada_prevista', 'paradas', 'paradas_feitas', 'sellers', 'sellers_coletados'];
var QUEUE_COLS = ['queue_number', 'driver_id', 'driver_name', 'agency', 'vehicle_number', 'arrival_type',
  'queue_status', 'add_to_queue_time', 'occupied_dock_name', 'order_quantity'];

/** Configuracao padrao. Editavel em runtime (painel Configuracoes). */
var DEFAULT_CONFIG = {
  spreadsheetId: SPREADSHEET_ID,
  tabTrips: DEFAULT_TAB_TRIPS,
  tabQueue: DEFAULT_TAB_QUEUE,
  // Horas depois da chegada ao SOC (ou de agora, se ainda nao chegou) em que
  // uma linha da fila ainda conta como a mesma passagem da trip.
  arrivalMatchWindowHours: 6,
  // Trip coletada e sem chegada ha mais que isso sai do Pickup (dado parado).
  pickupMaxAgeHours: 24,
  // Aging na FILA (minutos). Farol e por fase:
  //   - aguardando handover (chegou, inbound em andamento): desde a Chegada ao SOC
  //   - concluida: duracao fechada Chegada -> ultimo inbound
  // Regra combinada com a operacao: maximo 2h (120 min) = critico.
  queue: { okMax: 60, attentionMax: 120 },
  // Aging no PICKUP (minutos) — base: tempo desde a ultima coleta
  pickup: { okMax: 60, attentionMax: 120 },
  // "Acima do SLA" — tempo total (agora - ultima coleta), em minutos
  slaMinutes: 180,
  queueAgingBasis: 'handover',
  consolidateOrders: 'sum',
  // Heuristica de "Onde esta o gargalo?"
  bottleneck: { pickupCriticalCount: 3, socCriticalCount: 3 },
  // Atualizacao automatica (segundos)
  autoRefreshSeconds: 60
};

/* ============================ WEB APP ============================ */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('First Mile · PE2')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ========================= CONFIGURACAO ========================= */
function getConfig() {
  return getConfig_();
}

function getConfig_() {
  var raw = PropertiesService.getScriptProperties().getProperty(CONFIG_KEY);
  var stored = {};
  if (raw) { try { stored = JSON.parse(raw) || {}; } catch (e) { stored = {}; } }
  return sanitizeConfig_(deepMerge_(clone_(DEFAULT_CONFIG), stored));
}

/** Salva um patch parcial de configuracao. Retorna a config final. */
function saveConfig(patch) {
  var current = getConfig_();
  var merged = sanitizeConfig_(deepMerge_(current, patch || {}));
  PropertiesService.getScriptProperties().setProperty(CONFIG_KEY, JSON.stringify(merged));
  return merged;
}

/** Restaura a configuracao padrao. */
function resetConfig() {
  PropertiesService.getScriptProperties().deleteProperty(CONFIG_KEY);
  return getConfig_();
}

function sanitizeConfig_(c) {
  c = c || {};
  // Chaves da versao antiga (To Handover / To Pickup / Recebimento)
  delete c.tabHandover; delete c.tabPickup; delete c.tabRecebimento; delete c.recebimentoSpreadsheetId;
  c.spreadsheetId = str_(c.spreadsheetId) || SPREADSHEET_ID;
  c.tabTrips = str_(c.tabTrips) || DEFAULT_TAB_TRIPS;
  c.tabQueue = str_(c.tabQueue) || DEFAULT_TAB_QUEUE;
  c.arrivalMatchWindowHours = clampNum_(c.arrivalMatchWindowHours, 1, 48, DEFAULT_CONFIG.arrivalMatchWindowHours);
  c.pickupMaxAgeHours = clampNum_(c.pickupMaxAgeHours, 1, 168, DEFAULT_CONFIG.pickupMaxAgeHours);
  c.queue = c.queue || {};
  c.pickup = c.pickup || {};
  c.queue.okMax = clampNum_(c.queue.okMax, 1, 100000, DEFAULT_CONFIG.queue.okMax);
  c.queue.attentionMax = clampNum_(c.queue.attentionMax, c.queue.okMax + 1, 100000, DEFAULT_CONFIG.queue.attentionMax);
  c.pickup.okMax = clampNum_(c.pickup.okMax, 1, 100000, DEFAULT_CONFIG.pickup.okMax);
  c.pickup.attentionMax = clampNum_(c.pickup.attentionMax, c.pickup.okMax + 1, 100000, DEFAULT_CONFIG.pickup.attentionMax);
  c.slaMinutes = clampNum_(c.slaMinutes, 1, 1000000, DEFAULT_CONFIG.slaMinutes);
  c.queueAgingBasis = (c.queueAgingBasis === 'total') ? 'total' : 'handover';
  c.consolidateOrders = (['sum','max','first'].indexOf(c.consolidateOrders) >= 0) ? c.consolidateOrders : 'sum';
  c.bottleneck = c.bottleneck || {};
  c.bottleneck.pickupCriticalCount = clampNum_(c.bottleneck.pickupCriticalCount, 1, 100000, DEFAULT_CONFIG.bottleneck.pickupCriticalCount);
  c.bottleneck.socCriticalCount = clampNum_(c.bottleneck.socCriticalCount, 1, 100000, DEFAULT_CONFIG.bottleneck.socCriticalCount);
  c.autoRefreshSeconds = clampNum_(c.autoRefreshSeconds, 15, 900, DEFAULT_CONFIG.autoRefreshSeconds);
  return c;
}

/* ====================== PAYLOAD PRINCIPAL ====================== */
/**
 * Retorna todo o estado que o frontend precisa. Aging e derivados
 * sao calculados no cliente (usando serverNow) para atualizacao viva
 * e filtros instantaneos sem nova consulta ao backend.
 *
 * Contrato das linhas (igual ao da versao anterior): queue[] guarda Fila e
 * Concluidas (Concluida = tem last_handover_time); pickup[] guarda Pickup.
 */
function getPayload() {
  try {
    var cfg = getConfig_();
    var ss = SpreadsheetApp.openById(cfg.spreadsheetId);
    var trips = readTable_(ss, cfg.tabTrips, TRIP_COLS);
    var fila = readTable_(ss, cfg.tabQueue, QUEUE_COLS);
    var qIdx = buildQueueIndex_(fila.rows);

    var nowMs = Date.now();
    var windowMs = cfg.arrivalMatchWindowHours * 3600000;
    var pickupMaxMs = cfg.pickupMaxAgeHours * 3600000;
    var queue = [], pickup = [];
    var skipped = { canceladas: 0, semColeta: 0, pickupParado: 0 };

    trips.rows.forEach(function (t) {
      if (num_(t.business_status) === TRIP_CANCELLED_STATUS) { skipped.canceladas++; return; }
      var firstMs = ms_(t.primeira_coleta), lastMs = ms_(t.ultima_coleta);
      var pickupMs = lastMs != null ? lastMs : firstMs;
      if (pickupMs == null) { skipped.semColeta++; return; }

      var socMs = ms_(t.chegou_soc), inbMs = ms_(t.ultimo_inbound);
      var q = matchQueue_(qIdx[key_(t.driver_id)],
        firstMs != null ? firstMs : pickupMs,
        (socMs != null ? socMs : nowMs) + windowMs);
      if (q) q.used = true;
      // Sem chegou_soc, so uma passagem ainda aberta na fila conta como chegada:
      // uma ja finalizada era de outra trip descarregada antes (dado parado).
      var arrivalMs = socMs != null ? socMs : (q && q.status !== QUEUE_DONE_STATUS ? q.addedMs : null);

      // Inbound terminou: fila finalizada, ou (sem fila casada) nada mais a caminho.
      var done = inbMs != null && (q
        ? q.status === QUEUE_DONE_STATUS
        : (toInt_(t.pacotes_a_caminho) === 0 || nowMs - inbMs > 2 * 3600000));

      var row = {
        trip_id: str_(t.trip_id),
        qtd_order: toInt_(t.pedidos),
        agency_name: (q && q.agency) || agencyName_(t.agency_id),
        driver_name: str_(t.driver_name) || (q ? q.driver_name : ''),
        placa: q ? q.placa : '',
        last_pickup_time: new Date(pickupMs).toISOString(),
        last_handover_time: done ? new Date(inbMs).toISOString() : null,
        soc_arrival_time: arrivalMs != null ? new Date(arrivalMs).toISOString() : null,
        doca_ocupada: q && q.status !== QUEUE_DONE_STATUS ? q.doca : '',
        raw_status: q ? (QUEUE_STATUS_LABEL[String(q.status)] || ('fila ' + q.status)) : '',
        arrival_match_method: q ? 'fila' : null,
        queue_number: q ? q.queue_number : '',
        route: str_(t.route_display_name),
        cluster: str_(t.cluster_name),
        vehicle_type: str_(t.vehicle_type),
        pacotes_coletados: toInt_(t.pacotes_coletados),
        pacotes_recebidos: toInt_(t.pacotes_recebidos),
        pacotes_a_caminho: toInt_(t.pacotes_a_caminho),
        saida_prevista: toIso_(t.saida_prevista),
        chegada_prevista: toIso_(t.chegada_prevista),
        paradas: toInt_(t.paradas),
        paradas_feitas: toInt_(t.paradas_feitas),
        sellers: toInt_(t.sellers),
        sellers_coletados: toInt_(t.sellers_coletados),
        _rows: 1
      };

      if (arrivalMs == null) {
        if (nowMs - pickupMs > pickupMaxMs) { skipped.pickupParado++; return; }
        pickup.push(row);
      } else {
        queue.push(row);
      }
    });

    // Veiculos First Mile na fila/doca agora sem trip correspondente na FMTrip
    // (ex.: FMTrip ainda nao atualizou): entram na Fila com o numero da fila.
    var filaSemTrip = 0;
    Object.keys(qIdx).forEach(function (k) {
      qIdx[k].forEach(function (q) {
        if (q.used || q.status === QUEUE_DONE_STATUS || nowMs - q.addedMs > pickupMaxMs) return;
        filaSemTrip++;
        queue.push({
          trip_id: q.queue_number,
          qtd_order: q.orders,
          agency_name: q.agency,
          driver_name: q.driver_name,
          placa: q.placa,
          last_pickup_time: null,
          last_handover_time: null,
          soc_arrival_time: new Date(q.addedMs).toISOString(),
          doca_ocupada: q.doca,
          raw_status: QUEUE_STATUS_LABEL[String(q.status)] || ('fila ' + q.status),
          arrival_match_method: 'fila',
          queue_number: q.queue_number,
          route: '', cluster: '', vehicle_type: '',
          pacotes_coletados: null, pacotes_recebidos: null,
          _rows: 1
        });
      });
    });

    var board = buildDocks_(fila.rows, nowMs, pickupMaxMs);

    return {
      ok: true,
      version: APP_VERSION,
      serverNow: new Date(nowMs).toISOString(),
      tz: Session.getScriptTimeZone(),
      config: cfg,
      queue: queue,
      pickup: pickup,
      docks: board.docks,
      waiting: board.waiting,
      meta: {
        spreadsheetUrl: ss.getUrl(),
        queueTab: cfg.tabQueue,
        pickupTab: cfg.tabTrips,
        queueFieldMap: fila.fieldMap,
        pickupFieldMap: trips.fieldMap,
        queueHeaders: fila.headers,
        pickupHeaders: trips.headers,
        queueRowCount: fila.rows.length,
        pickupRowCount: trips.rows.length,
        skipped: skipped,
        filaSemTrip: filaSemTrip
      }
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), version: APP_VERSION };
  }
}

/** Rode no editor (Executar) para conferir a separacao sem abrir o painel. */
function testarPayload() {
  var p = getPayload();
  if (!p.ok) { Logger.log('ERRO: ' + p.error); return; }
  var concluidas = p.queue.filter(function (r) { return r.last_handover_time; }).length;
  Logger.log('Pickup: %s | Fila: %s | Concluidas: %s | Ignoradas: %s',
    p.pickup.length, p.queue.length - concluidas, concluidas, JSON.stringify(p.meta.skipped));
  Logger.log('FM na fila sem trip na FMTrip: %s', p.meta.filaSemTrip);
  Logger.log('Docas: %s | Aguardando: %s', JSON.stringify(p.docks.map(function (d) { return d.name + (d.busy ? ' (' + d.driver + ')' : ''); })), p.waiting.length);
  Logger.log('Colunas FMTrip: %s', JSON.stringify(p.meta.pickupFieldMap));
  Logger.log('Colunas fila: %s', JSON.stringify(p.meta.queueFieldMap));
  Logger.log(JSON.stringify(p.queue.slice(0, 3), null, 2));
}

/* ======================= LEITURA DAS ABAS ======================= */
function readTable_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    var available = ss.getSheets().map(function (s) { return '"' + s.getName() + '"'; }).join(', ');
    throw new Error('Aba nao encontrada: "' + name + '". Abas disponiveis: ' + available);
  }
  var values = sh.getDataRange().getValues();
  var rawHeaders = values[0] || [];
  var headers = rawHeaders.map(normalizeHeader_);
  var idx = {}, fieldMap = {};
  cols.forEach(function (c) {
    idx[c] = headers.indexOf(c);
    fieldMap[c] = idx[c] >= 0 ? String(rawHeaders[idx[c]]) : null;
  });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (r.join('').toString().trim() === '') continue;
    var o = {};
    cols.forEach(function (c) { o[c] = idx[c] >= 0 ? r[idx[c]] : ''; });
    rows.push(o);
  }
  return { rows: rows, headers: rawHeaders.map(String), fieldMap: fieldMap };
}

/** driver_id -> passagens First Mile pela fila, em ordem de chegada. */
function buildQueueIndex_(rows) {
  var idx = {};
  rows.forEach(function (r) {
    if (num_(r.arrival_type) !== FM_ARRIVAL_TYPE) return;
    var k = key_(r.driver_id);
    var addedMs = ms_(r.add_to_queue_time);
    if (!k || addedMs == null) return;
    (idx[k] = idx[k] || []).push({
      addedMs: addedMs,
      queue_number: str_(r.queue_number),
      driver_name: str_(r.driver_name),
      agency: str_(r.agency),
      placa: normalizePlaca_(r.vehicle_number),
      status: num_(r.queue_status),
      doca: str_(r.occupied_dock_name),
      orders: toInt_(r.order_quantity)
    });
  });
  Object.keys(idx).forEach(function (k) {
    idx[k].sort(function (a, b) { return a.addedMs - b.addedMs; });
  });
  return idx;
}

/**
 * Primeira passagem pela fila depois do inicio da coleta e antes do limite.
 * Um mesmo motorista com duas trips no dia casa cada uma com a sua chegada;
 * duas trips descarregadas juntas casam com a mesma linha da fila.
 */
function matchQueue_(list, fromMs, toMs) {
  if (!list) return null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].addedMs >= fromMs && list[i].addedMs <= toMs) return list[i];
  }
  return null;
}

/**
 * Quadro das docas FM agora: quem esta descarregando em cada doca interna FM e
 * quem ainda espera na fila (so chegadas First Mile sem doca), do mais antigo
 * para o mais novo. Passagens abertas ha mais que maxAgeMs sao ignoradas.
 */
function buildDocks_(rows, nowMs, maxAgeMs) {
  var active = rows.filter(function (r) {
    var added = ms_(r.add_to_queue_time);
    return num_(r.queue_status) !== QUEUE_DONE_STATUS && added != null && nowMs - added <= maxAgeMs;
  });
  var info = function (r) {
    return {
      driver: str_(r.driver_name),
      placa: normalizePlaca_(r.vehicle_number),
      orders: toInt_(r.order_quantity),
      since: toIso_(r.add_to_queue_time),
      queue_number: str_(r.queue_number)
    };
  };
  var byDock = {};
  active.forEach(function (r) {
    var d = str_(r.occupied_dock_name);
    if (d && /\bFM\b/i.test(d)) byDock[d] = r;
  });
  var names = FM_DOCKS.slice();
  Object.keys(byDock).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
  var docks = names.map(function (n) {
    var r = byDock[n];
    var d = r ? info(r) : {};
    d.name = n;
    d.busy = !!r;
    return d;
  });
  var waiting = active
    .filter(function (r) { return num_(r.arrival_type) === FM_ARRIVAL_TYPE && !str_(r.occupied_dock_name); })
    .sort(function (a, b) { return ms_(a.add_to_queue_time) - ms_(b.add_to_queue_time); })
    .map(info);
  return { docks: docks, waiting: waiting };
}

/** agency_id pode vir formatado como data (ex.: 05/04/1900 = 96). */
function agencyName_(v) {
  var id = v;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    id = Math.round((v.getTime() - new Date(1899, 11, 30).getTime()) / 86400000);
  }
  id = str_(id);
  return AGENCY_NAMES[id] || (id ? 'Agency ' + id : '');
}

function normalizePlaca_(p) {
  return String(p == null ? '' : p).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* ======================= PARSERS / UTIL ======================= */
function normalizeHeader_(h) {
  var s = String(h == null ? '' : h);
  try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function str_(v) {
  if (v == null) return '';
  return String(v).trim();
}

/** Chave de id numerico (driver_id pode vir como numero ou texto). */
function key_(v) {
  var s = str_(v);
  return /^\d+(\.0+)?$/.test(s) ? String(parseInt(s, 10)) : s;
}

function num_(v) {
  if (v === '' || v == null) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

function toInt_(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return Math.round(v);
  var s = String(v).replace(/[^\d\-]/g, '');
  if (s === '' || s === '-') return null;
  var n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function ms_(v) {
  var iso = toIso_(v);
  return iso ? new Date(iso).getTime() : null;
}

/** Converte celula (Date ou texto) para ISO string. Retorna null se vazio/invalido. */
function toIso_(v) {
  if (v === '' || v == null || v === 0 || v === '0') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? null : v.toISOString();
  }
  var s = String(v).trim();
  if (!s) return null;
  var m;
  // dd/MM/yyyy HH:mm[:ss]
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/))) {
    var y = +m[3]; if (y < 100) y += 2000;
    return partsToIso_(y, +m[2], +m[1], +m[4], +m[5], +(m[6] || 0));
  }
  // yyyy-MM-dd HH:mm[:ss] (ou com T)
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/))) {
    return partsToIso_(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
  }
  // dd/MM/yyyy
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
    var y2 = +m[3]; if (y2 < 100) y2 += 2000;
    return partsToIso_(y2, +m[2], +m[1], 0, 0, 0);
  }
  var dd = new Date(s);
  return isNaN(dd.getTime()) ? null : dd.toISOString();
}

function partsToIso_(y, mo, d, h, mi, se) {
  var dt = new Date(y, mo - 1, d, h, mi, se || 0);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

function clampNum_(v, min, max, dflt) {
  var n = Number(v);
  if (isNaN(n)) n = dflt;
  n = Math.round(n);
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function clone_(o) { return JSON.parse(JSON.stringify(o)); }

function deepMerge_(base, patch) {
  Object.keys(patch || {}).forEach(function (k) {
    var pv = patch[k];
    if (pv && typeof pv === 'object' && !Array.isArray(pv)) {
      base[k] = deepMerge_((base[k] && typeof base[k] === 'object') ? base[k] : {}, pv);
    } else if (pv !== undefined) {
      base[k] = pv;
    }
  });
  return base;
}
