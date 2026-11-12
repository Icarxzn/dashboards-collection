/**
 * Produtividade por Turno — Web App (Apps Script)   [visual replicado do painel "Produtividade por Turno" PE4]
 * Planilha: "Produtividade PE2"
 *   Consulta -> uma linha por operador: operator ("[OpsID]NOME"), efficiency_total e uma coluna por hora
 *               ("18:00", "17:00", ... da mais recente para a mais antiga) + carimbo "Atualizado: dd/MM/yyyy HH:mm:ss".
 *               É uma janela de ~12 h que desliza.
 *   Plano    -> Data (dd/MM/yyyy) | Hora (0–23) | Tipo processo (esteira) | capacidade | Turno.
 *               00h–05h usam a data do dia operacional. Meta da hora = soma das esteiras.
 *
 *   _LEDGER_PROD -> histórico (criada sozinha pelo script, igual ao modelo). Como a Consulta só tem a janela
 *               atual, cada leitura é gravada aqui: uma linha por dia operacional + operador, com 24 colunas
 *               de hora (h0…h23). A última leitura de cada hora vale. Guarda HIST_DIAS dias. Não edite à mão.
 */

const CONFIG = {
  SHEET_ID:    '15zDTkfz-01gZgefZz9aukXbXnXM2WDbF3zA1iWPXGOE',
  UNIDADE:     'PE2',
  ABA_REAL:    'Consulta',
  ABA_META:    'Plano',
  ABA_HIST:    '_LEDGER_PROD',   // histórico dentro da própria planilha
  CACHE_SEG:   600,     // validade do cache; o gatilho renova a cada 1 min
  REFRESH_SEG: 60,      // a página consulta a cada 60 s
  HIST_DIAS:   35,      // dias guardados no histórico (a tela mostra até 14 na evolução)
};

function doGet() {
  garantirGatilho_();
  const t = HtmlService.createTemplateFromFile('Index');
  t.unidade = CONFIG.UNIDADE;
  return t.evaluate()
    .setTitle('Produtividade por Turno · ' + CONFIG.UNIDADE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Usado no Index.html: <?!= include('Styles'); ?> / <?!= include('JavaScript'); ?> */
function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

// ═══════════════════════════════════════════════════════════════
//  API da página
// ═══════════════════════════════════════════════════════════════

/** force = true (botão Atualizar): relê a planilha na hora. */
function getDashboardData(force) {
  if (!force) {
    const hit = lerCache_('dash');
    if (hit) return hit;
  }
  const json = montarDashboard_();
  gravarCache_('dash', json);
  return json;
}

/** Gatilho de tempo (1 min): grava a leitura no histórico e deixa o cache pronto. */
function aquecerCache() {
  try { gravarCache_('dash', montarDashboard_()); } catch (e) { console.warn('aquecerCache: ' + e); }
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
//  MONTAGEM
//  { cfg:{refreshSec}, stamp, generatedAt, ledger:bool,
//    prod: { 'yyyy-MM-dd': [ {id, n, h:{hora: peças}} ] },   (dia operacional)
//    plan: { 'yyyy-MM-dd': {hora: meta} } }
// ═══════════════════════════════════════════════════════════════

function montarDashboard_() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const tz = ss.getSpreadsheetTimeZone();
  const janela = lerJanela_(ss, tz);

  let prod, ledger = false;
  try {
    prod = atualizarHistorico_(ss, janela);
    ledger = true;
  } catch (e) {
    console.warn('Histórico indisponível, usando só a janela: ' + e);
    prod = {};
    janela.registros.forEach(r => {
      (prod[r.dia] = prod[r.dia] || {});
      const o = prod[r.dia][r.id] || (prod[r.dia][r.id] = { id: r.id, n: r.n, h: {} });
      o.h[r.hora] = r.v;
    });
    Object.keys(prod).forEach(d => { prod[d] = Object.keys(prod[d]).map(k => prod[d][k]); });
  }

  const dias = Object.keys(prod);
  const plan = lerPlano_(ss, dias.length ? dias.slice().sort()[0] : janela.diaAtual);

  return JSON.stringify({
    cfg: { refreshSec: CONFIG.REFRESH_SEG },
    stamp: janela.stamp,
    generatedAt: new Date().toISOString(),
    ledger: ledger,
    prod: prod,
    plan: plan,
  });
}

/**
 * Lê a aba Consulta e descobre a data de cada coluna de hora (a janela pode atravessar a meia-noite).
 * registros: [{dia (dia operacional ISO), hora, id, n, v}]
 */
function lerJanela_(ss, tz) {
  const sh = ss.getSheetByName(CONFIG.ABA_REAL);
  if (!sh) throw new Error('Aba "' + CONFIG.ABA_REAL + '" não encontrada');
  const values = sh.getDataRange().getDisplayValues();
  const head = values[0].map(h => String(h).trim());
  const iOp = head.indexOf('operator');
  if (iOp < 0) throw new Error('Coluna "operator" não encontrada na aba ' + CONFIG.ABA_REAL);

  const stampTxt = head.filter(h => /^Atualizado:/i.test(h))[0] || '';
  const m = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(stampTxt);
  const agora = m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : new Date(Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss"));

  // colunas de hora na ordem da planilha (da mais recente para a mais antiga) -> data/hora de cada uma
  const cols = [];
  let cursor = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), agora.getHours());
  head.forEach((h, i) => {
    const mh = /^(\d{1,2}):00$/.exec(h);
    if (!mh) return;
    const hora = +mh[1];
    let passos = 0;
    while (cursor.getHours() !== hora && passos++ < 24) cursor = new Date(cursor.getTime() - 3600e3);
    cols.push({ i: i, hora: hora, dia: diaOperacional_(cursor) });
    cursor = new Date(cursor.getTime() - 3600e3);
  });

  const num = v => Number(String(v || '').replace(/\./g, '').replace(',', '.')) || 0;
  const registros = [];
  values.slice(1).forEach(r => {
    const bruto = String(r[iOp] || '').trim();
    if (!bruto || /^TOTAL/i.test(bruto)) return;
    const mm = /^\[([^\]]+)\]\s*(.*)$/.exec(bruto);
    const id = mm ? mm[1] : bruto, n = (mm ? mm[2] : bruto).trim();
    cols.forEach(c => {
      const v = num(r[c.i]);
      if (v > 0) registros.push({ dia: c.dia, hora: c.hora, id: id, n: n, v: v });
    });
  });
  return { stamp: stampTxt, diaAtual: diaOperacional_(agora), registros: registros };
}

/** Dia operacional (06:00 → 05:59) de um horário, em ISO yyyy-MM-dd. */
function diaOperacional_(d) {
  const x = new Date(d.getTime());
  if (x.getHours() < 6) x.setDate(x.getDate() - 1);
  return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2);
}

// ═══════════════════════════════════════════════════════════════
//  HISTÓRICO (aba _LEDGER_PROD da própria planilha)
// ═══════════════════════════════════════════════════════════════
const LEDGER_CAB = ['dia', 'ops_id', 'nome'].concat(Array.from({ length: 24 }, (_, h) => 'h' + h));

/** Abre a aba de histórico; na primeira vez, cria no fim da planilha com o cabeçalho. */
function abaHistorico_(ss) {
  let sh = ss.getSheetByName(CONFIG.ABA_HIST);
  if (!sh) sh = ss.insertSheet(CONFIG.ABA_HIST, ss.getSheets().length);
  // garante o cabeçalho (também quando a aba foi criada à mão, vazia)
  if (String(sh.getRange(1, 1).getValue()).trim() !== 'dia') {
    sh.getRange(1, 1, 1, LEDGER_CAB.length).setValues([LEDGER_CAB]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Grava a janela atual no histórico (a última leitura de cada hora vale) e devolve prod por dia. */
function atualizarHistorico_(ss, janela) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = abaHistorico_(ss);
    const n = sh.getLastRow() - 1;
    const linhas = n > 0 ? sh.getRange(2, 1, n, LEDGER_CAB.length).getValues() : [];
    const pos = {};
    linhas.forEach((l, i) => {
      if (l[0] instanceof Date) l[0] = Utilities.formatDate(l[0], Session.getScriptTimeZone(), 'yyyy-MM-dd');
      l[0] = String(l[0]);
      pos[l[0] + '|' + l[1]] = i;
    });

    janela.registros.forEach(r => {
      const k = r.dia + '|' + r.id;
      let i = pos[k];
      if (i == null) {
        const nova = [r.dia, r.id, r.n].concat(Array(24).fill(0));
        i = pos[k] = linhas.push(nova) - 1;
      }
      linhas[i][2] = r.n;
      linhas[i][3 + r.hora] = r.v;
    });

    // mantém só os últimos HIST_DIAS dias
    const corte = new Date(); corte.setDate(corte.getDate() - CONFIG.HIST_DIAS);
    const corteIso = diaOperacional_(corte);
    const manter = linhas.filter(l => l[0] >= corteIso).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

    if (n > 0) sh.getRange(2, 1, n, LEDGER_CAB.length).clearContent();
    if (manter.length) {
      sh.getRange(2, 1, manter.length, 3).setNumberFormat('@');   // dia/ops/nome como texto (sem virar data)
      sh.getRange(2, 1, manter.length, LEDGER_CAB.length).setValues(
        manter.map(l => l.map((v, j) => j < 3 ? String(v) : Number(v) || 0)));
    }

    const prod = {};
    manter.forEach(l => {
      const h = {};
      for (let k = 0; k < 24; k++) { const v = Number(l[3 + k]) || 0; if (v > 0) h[k] = v; }
      if (!Object.keys(h).length) return;
      (prod[l[0]] = prod[l[0]] || []).push({ id: l[1], n: l[2], h: h });
    });
    return prod;
  } finally {
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════════
//  META (aba Plano)
// ═══════════════════════════════════════════════════════════════
/** { 'yyyy-MM-dd': {hora: soma da capacidade} } a partir de desdeIso (e um dia à frente). */
function lerPlano_(ss, desdeIso) {
  const sh = ss.getSheetByName(CONFIG.ABA_META);
  if (!sh || sh.getLastRow() < 2) return {};
  const v = sh.getRange(1, 1, sh.getLastRow(), 4).getDisplayValues();
  const head = v[0].map(h => String(h).trim().toLowerCase());
  const iData = head.indexOf('data'), iHora = head.indexOf('hora'), iCap = head.indexOf('capacidade');
  if (iData < 0 || iHora < 0 || iCap < 0) return {};
  const num = x => Number(String(x || '').replace(/\./g, '').replace(',', '.')) || 0;
  const plan = {};
  for (let r = 1; r < v.length; r++) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v[r][iData]).trim());
    if (!m) continue;
    const iso = m[3] + '-' + m[2] + '-' + m[1];
    if (iso < desdeIso) continue;
    const h = parseInt(v[r][iHora], 10);
    if (isNaN(h) || h < 0 || h > 23) continue;
    const dia = plan[iso] || (plan[iso] = {});
    dia[h] = (dia[h] || 0) + num(v[r][iCap]);
  }
  return plan;
}

// ═══════════════════════════════════════════════════════════════
//  CACHE  (JSON compactado em gzip + base64 e fatiado: o CacheService aceita até 100 KB por chave)
// ═══════════════════════════════════════════════════════════════
const CACHE_PREFIXO = 'prodturno_v1_';
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
    return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')).getDataAsString('UTF-8');
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
