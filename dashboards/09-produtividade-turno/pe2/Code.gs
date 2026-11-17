/**
 * Produtividade por Turno — Web App (Apps Script)   [visual replicado do painel "Produtividade por Turno" PE4]
 * Planilha: "Produtividade PE2"
 *   Consulta -> uma linha por operador: operator ("[OpsID]NOME"), efficiency_total e uma coluna por hora
 *               ("18:00", "17:00", ... da mais recente para a mais antiga) + carimbo "Atualizado: dd/MM/yyyy HH:mm:ss".
 *               É uma janela de ~12 h que desliza.
 *   Plano    -> Data (dd/MM/yyyy) | Hora (0–23) | Tipo processo (esteira) | capacidade | Turno.
 *               00h–05h usam a data do dia operacional. Meta da hora = soma das esteiras.
 *
 *   Productivity Workstation -> total acumulado por estação (Workstation ID/Name, Manpower, Total Throughput),
 *               sem hora nem operador. As estações de cada esteira são escolhidas pelo começo do nome (ESTEIRAS).
 *   Workstation (planilha de origem, CONFIG.ORIGEM_ID) -> check-in/check-out por operador e estação.
 *               Regra da maioria: na hora em que o operador ficou metade ou mais nas estações de uma esteira,
 *               a produção dele naquela hora (Consulta) conta para a esteira.
 *   _LEDGER_ESTEIRA -> histórico por esteira (criada sozinha): produção e pessoas por hora + quem passou em cada turno.
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
  ABA_WS:      'Productivity Workstation',
  // Check-in/check-out por operador e estação (aba "Workstation" da planilha de origem do PE2, a mesma que alimenta a Consulta)
  ORIGEM_ID:   '1T3zq6DtiF--pZjeYFzSo9i-EDEBXIN0yx8VcxsMcXZY',
  ABA_CHECKIN: 'Workstation',
  ABA_HIST_EST: '_LEDGER_ESTEIRA',
};

/**
 * Esteiras: prefixo da workstation (aba Productivity Workstation) e trecho do "Tipo processo" da aba Plano.
 * PE2: P2_AU = Esteira A · P1_AU = Esteira B · P1_TE = Termoplástica (Rolete A) · P3_AU = Full (Esteira C).
 * hcPlano: HC planejado por turno (deixe null enquanto não houver fonte; a tela mostra "—").
 */
const ESTEIRAS = [
  { id: 'A',    nome: 'Esteira A',     prefixo: 'P2_AU', plano: 'esteira a',  hcPlano: { T1: null, T2: null, T3: null } },
  { id: 'B',    nome: 'Esteira B',     prefixo: 'P1_AU', plano: 'esteira b',  hcPlano: { T1: null, T2: null, T3: null } },
  { id: 'TE',   nome: 'Termoplástica', prefixo: 'P1_TE', plano: 'termopl',    hcPlano: { T1: null, T2: null, T3: null } },
  { id: 'FULL', nome: 'Full',          prefixo: 'P3_AU', plano: 'fulfil',     hcPlano: { T1: null, T2: null, T3: null } },
];

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
  const planos = lerPlano_(ss, dias.length ? dias.slice().sort()[0] : janela.diaAtual);
  const plan = planos.total;

  let est = null;
  try { est = montarEsteiras_(ss, planos.esteira, janela); } catch (e) { console.warn('Esteiras: ' + e); est = { erro: String(e) }; }

  return JSON.stringify({
    cfg: { refreshSec: CONFIG.REFRESH_SEG },
    stamp: janela.stamp,
    generatedAt: new Date().toISOString(),
    ledger: ledger,
    prod: prod,
    plan: plan,
    est: est,
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
  // horas (dia operacional + hora) que estão na janela desta leitura: nelas a Consulta é a verdade
  const horasJanela = cols.map(c => ({ dia: c.dia, hora: c.hora }));
  return { stamp: stampTxt, diaAtual: diaOperacional_(agora), registros: registros, horasJanela: horasJanela };
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

/** Garante que a aba tenha pelo menos 'ate' linhas (a aba nasce com 1000; gravar além disso dá erro). */
function garantirLinhas_(sh, ate) {
  const max = sh.getMaxRows();
  if (ate > max) sh.insertRowsAfter(max, ate - max + 500);
}

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

    // Nas horas que estão na janela atual, o histórico fica IGUAL à Consulta: primeiro zera essas horas
    // de todo mundo do dia (quem não aparece mais na base fica 0) e depois grava os valores lidos.
    // Assim um dado errado que entrou na Consulta e foi corrigido some do histórico na leitura seguinte.
    (janela.horasJanela || []).forEach(hj => {
      linhas.forEach(l => { if (l[0] === hj.dia) l[3 + hj.hora] = 0; });
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
    const temProducao = l => { for (let k = 3; k < 27; k++) if (Number(l[k]) > 0) return true; return false; };
    const manter = linhas.filter(l => l[0] >= corteIso && temProducao(l))   // linha toda zerada sai do histórico
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

    if (n > 0) sh.getRange(2, 1, n, LEDGER_CAB.length).clearContent();
    if (manter.length) {
      garantirLinhas_(sh, manter.length + 1);
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
/**
 * total:   { 'yyyy-MM-dd': {hora: soma da capacidade} }
 * esteira: { 'yyyy-MM-dd': { idEsteira: {hora: capacidade} } }   (a partir de desdeIso)
 */
function lerPlano_(ss, desdeIso) {
  const sh = ss.getSheetByName(CONFIG.ABA_META);
  if (!sh || sh.getLastRow() < 2) return { total: {}, esteira: {} };
  const v = sh.getRange(1, 1, sh.getLastRow(), 4).getDisplayValues();
  const head = v[0].map(h => String(h).trim().toLowerCase());
  const iData = head.indexOf('data'), iHora = head.indexOf('hora'), iCap = head.indexOf('capacidade'), iTipo = head.indexOf('tipo processo');
  if (iData < 0 || iHora < 0 || iCap < 0) return { total: {}, esteira: {} };
  const num = x => Number(String(x || '').replace(/\./g, '').replace(',', '.')) || 0;
  const plan = {}, porEst = {};
  const semAcento = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (let r = 1; r < v.length; r++) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v[r][iData]).trim());
    if (!m) continue;
    const iso = m[3] + '-' + m[2] + '-' + m[1];
    if (iso < desdeIso) continue;
    const h = parseInt(v[r][iHora], 10);
    if (isNaN(h) || h < 0 || h > 23) continue;
    const dia = plan[iso] || (plan[iso] = {});
    dia[h] = (dia[h] || 0) + num(v[r][iCap]);
    if (iTipo >= 0) {
      const tipo = semAcento(v[r][iTipo]);
      const e = ESTEIRAS.filter(x => tipo.indexOf(semAcento(x.plano)) >= 0)[0];
      if (e) {
        const de = (porEst[iso] = porEst[iso] || {});
        const he = (de[e.id] = de[e.id] || {});
        he[h] = (he[h] || 0) + num(v[r][iCap]);
      }
    }
  }
  return { total: plan, esteira: porEst };
}

// ═══════════════════════════════════════════════════════════════
//  ESTEIRAS (aba Productivity Workstation + histórico _LEDGER_ESTEIRA)
// ═══════════════════════════════════════════════════════════════
const EST_CAB = ['dia', 'esteira', 'ops'].concat(Array.from({ length: 24 }, (_, h) => 'h' + h), Array.from({ length: 24 }, (_, h) => 'm' + h));
const EST_VERSAO = 'EST_LEDGER_V2';   // v2 = regra da maioria (check-in); a v1 (diferença de acumulado) é descartada

/**
 * Aba Productivity Workstation (total por estação no dia) conferida com o cadastro (aba Workstation, coluna Esteira):
 *  - estacoes: por esteira, as estações e o total delas (drill-down)
 *  - conf: estações da base que não estão no cadastro e estações de packing (activity 12) sem esteira
 */
function lerWorkstation_(ss) {
  const sh = ss.getSheetByName(CONFIG.ABA_WS);
  const vazio = { stamp: '', estacoes: {}, conf: null };
  if (!sh) return vazio;
  const v = sh.getDataRange().getDisplayValues();
  const head = v[0].map(h => String(h).trim().toLowerCase());
  const col = re => head.findIndex(h => re.test(h));
  const iWs = col(/^workstation id/), iMp = col(/^manpower/), iTot = col(/^total throughput/), iAt = col(/^activity type/);
  const num = x => Number(String(x || '').replace(/\./g, '').replace(',', '.')) || 0;
  const cad = lerCadastro_();
  const est = {}, porEst = {};
  ESTEIRAS.forEach(e => { est[e.id] = []; porEst[e.id] = 0; });
  const foraCadastro = [], packingSemEsteira = [];
  let totalPacking = 0, nEst = 0;
  if (iWs >= 0 && iTot >= 0) v.slice(1).forEach(r => {
    const bruto = String(r[iWs] || '').trim(); if (!bruto) return;
    const mId = /^\[([^\]]+)\]/.exec(bruto), id = mId ? mId[1].toUpperCase() : '';
    const nome = bruto.replace(/^\[[^\]]*\]\s*/, '').trim().toUpperCase();
    const tot = num(r[iTot]), packing = iAt >= 0 && String(r[iAt]).trim() === '12';
    nEst++;
    if (cad && !cad.nomes[nome]) foraCadastro.push({ ws: nome, id: id, tot: tot, packing: packing });
    const e = esteiraDaEstacao_(nome, cad ? cad.mapa : null);
    if (packing) totalPacking += tot;
    if (e) { est[e.id].push({ ws: nome, tot: tot, mp: iMp >= 0 ? num(r[iMp]) : 0 }); porEst[e.id] += tot; }
    else if (packing) packingSemEsteira.push({ ws: nome, tot: tot });
  });
  return {
    stamp: v[0].map(String).filter(h => /^Atualizado:/i.test(h.trim()))[0] || '',
    estacoes: est,
    conf: { nEstacoes: nEst, nCadastro: cad ? Object.keys(cad.nomes).length : 0, foraCadastro: foraCadastro,
            packingSemEsteira: packingSemEsteira, totalPacking: totalPacking, porEsteira: porEst },
  };
}

/** Cadastro (aba Workstation desta planilha): todos os nomes de estação + mapa nome -> esteira. */
function lerCadastro_() {
  const sh = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('Workstation');
  if (!sh || sh.getLastRow() < 2) return null;
  const v = sh.getDataRange().getDisplayValues();
  const head = v[0].map(h => String(h).trim().toLowerCase());
  const iNome = head.indexOf('workstation name'), iEst = head.indexOf('esteira');
  if (iNome < 0) return null;
  const sa = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const nomes = {}, mapa = {};
  v.slice(1).forEach(r => {
    const nome = String(r[iNome] || '').trim().toUpperCase(); if (!nome) return;
    nomes[nome] = 1;
    const e = iEst >= 0 ? ESTEIRAS.filter(x => sa(x.nome) === sa(r[iEst]))[0] : null;
    if (e) mapa[nome] = e.id;
  });
  return { nomes: nomes, mapa: Object.keys(mapa).length ? mapa : null };
}

/**
 * Check-ins da aba Workstation (origem): minutos de cada operador em cada hora do relógio,
 * no total (todas as estações) e por esteira. chave da hora: 'yyyy-MM-dd|H' (data do relógio).
 */
/**
 * Mapa estação -> esteira da coluna "Esteira" da aba Workstation desta planilha (Workstation Name | Esteira).
 * Vale o nome da esteira (Esteira A, Esteira B, Termoplástica, Full). Sem a coluna preenchida, usa o prefixo.
 */
function lerMapaEsteiras_() {
  const c = lerCadastro_(); return c ? c.mapa : null;
}
function lerMapaEsteirasAntigo_() {
  const sh = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName('Workstation');
  if (!sh || sh.getLastRow() < 2) return null;
  const v = sh.getDataRange().getDisplayValues();
  const head = v[0].map(h => String(h).trim().toLowerCase());
  const iNome = head.indexOf('workstation name'), iEst = head.indexOf('esteira');
  if (iNome < 0 || iEst < 0) return null;
  const sa = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const mapa = {}; let n = 0;
  v.slice(1).forEach(r => {
    const e = ESTEIRAS.filter(x => sa(x.nome) === sa(r[iEst]))[0];
    if (e) { mapa[String(r[iNome]).trim().toUpperCase()] = e.id; n++; }
  });
  return n ? mapa : null;
}
function esteiraDaEstacao_(ws, mapa) {
  if (mapa) { const id = mapa[ws]; return id ? ESTEIRAS.filter(x => x.id === id)[0] : null; }
  return ESTEIRAS.filter(x => ws.indexOf(x.prefixo) === 0)[0] || null;
}

function lerCheckins_() {
  const mapa = lerMapaEsteiras_();
  const sh = SpreadsheetApp.openById(CONFIG.ORIGEM_ID).getSheetByName(CONFIG.ABA_CHECKIN);
  if (!sh) throw new Error('Aba "' + CONFIG.ABA_CHECKIN + '" não encontrada na planilha de origem');
  const v = sh.getDataRange().getDisplayValues();
  const head = v[0].map(h => String(h).trim().toLowerCase());
  const iOps = head.indexOf('ops'), iWs = head.indexOf('workstation'), iIn = head.indexOf('check_in_time'), iOut = head.indexOf('check_out_time');
  if (iOps < 0 || iWs < 0 || iIn < 0 || iOut < 0) throw new Error('Colunas ops/workstation/check_in_time/check_out_time não encontradas');
  const stampTxt = v[0].map(String).filter(h => /^Atualizado:/i.test(h.trim()))[0] || '';
  const ms = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(stampTxt);
  const agora = ms ? new Date(+ms[3], +ms[2] - 1, +ms[1], +ms[4], +ms[5], +(ms[6] || 0)).getTime() : Date.now();
  const quando = t => { const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(t || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime() : null; };
  const chave = d => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + '|' + d.getHours();
  // 1) sessões de cada operador (uma linha da aba pode ter várias, separadas por ";")
  const sess = {};
  v.slice(1).forEach(r => {
    const mo = /^\[([^\]]+)\]/.exec(String(r[iOps] || '').trim());
    if (!mo) return;
    const ops = mo[1];
    const ws = String(r[iWs] || '').replace(/^\[[^\]]*\]\s*/, '').trim().toUpperCase();
    const e = esteiraDaEstacao_(ws, mapa);
    // as listas de entrada e saída podem vir fora de ordem ("00:30;22:45" | "00:22"):
    // ordena as duas e casa cada entrada com a primeira saída depois dela e antes da próxima entrada
    const ins = String(r[iIn] || '').split(';').map(quando).filter(x => x != null).sort((x, y) => x - y);
    const outs = String(r[iOut] || '').split(';').map(quando).filter(x => x != null).sort((x, y) => x - y);
    let j = 0;
    ins.forEach((ini, k) => {
      const prox = k + 1 < ins.length ? ins[k + 1] : Infinity;
      while (j < outs.length && outs[j] < ini) j++;
      let fim = null;
      if (j < outs.length && outs[j] <= prox) { fim = outs[j]; j++; }
      (sess[ops] = sess[ops] || []).push({ ini: ini, fim: fim, e: e ? e.id : null });
    });
  });
  // 2) minutos por hora; a hora vai para UMA esteira só (a de mais minutos) lá na regra da maioria
  const tot = {}, est = {};   // tot[ops][hora] = min; est[ops][hora][id] = min
  Object.keys(sess).forEach(ops => {
    const lst = sess[ops].sort((a, b) => a.ini - b.ini);
    lst.forEach((x, k) => {
      const prox = k + 1 < lst.length ? lst[k + 1].ini : null;
      // com check-out: vale o check-out; sem check-out: até a próxima sessão ou até a leitura (máx. 12 h)
      let fim = x.fim != null && x.fim >= x.ini ? x.fim : Math.min(agora, x.ini + 12 * 3600e3, prox != null ? prox : Infinity);
      const ini = x.ini, e = x.e ? { id: x.e } : null;
      let t = ini;
      while (t < fim) {
        const d = new Date(t), prox = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
        const ate = Math.min(prox, fim), min = (ate - t) / 60000, ch = chave(d);
        const to = (tot[ops] = tot[ops] || {}); to[ch] = (to[ch] || 0) + min;
        if (e) { const eo = (est[ops] = est[ops] || {}), eh = (eo[ch] = eo[ch] || {}); eh[e.id] = (eh[e.id] || 0) + min; }
        t = ate;
      }
    });
  });
  // A aba Workstation da origem só guarda os check-ins do dia do relógio (vira à meia-noite):
  // horas de datas anteriores a esta não podem ser recalculadas com ela.
  const dAg = new Date(agora);
  const cobreDesde = dAg.getFullYear() + '-' + ('0' + (dAg.getMonth() + 1)).slice(-2) + '-' + ('0' + dAg.getDate()).slice(-2);
  return { tot: tot, est: est, stamp: stampTxt, cobreDesde: cobreDesde };
}

function abaHistEsteira_(ss) {
  let sh = ss.getSheetByName(CONFIG.ABA_HIST_EST);
  if (!sh) sh = ss.insertSheet(CONFIG.ABA_HIST_EST, ss.getSheets().length);
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(EST_VERSAO) !== '1' || String(sh.getRange(1, 3).getValue()).trim() !== 'ops') {
    sh.clearContents();                       // histórico da versão anterior não serve para a regra nova
    sh.getRange(1, 1, 1, EST_CAB.length).setValues([EST_CAB]).setFontWeight('bold');
    sh.setFrozenRows(1);
    props.setProperty(EST_VERSAO, '1');
    props.deleteProperty('EST_ESTADO_V1');
  }
  return sh;
}

/**
 * Regra da maioria, hora a hora (igual às TVs das esteiras): em cada hora, soma os minutos do operador logado
 * em todas as estações e os minutos nas estações da esteira. Se metade ou mais foi na esteira, a produção
 * inteira daquela hora (aba Consulta, ligada pelo código Ops) conta para ela; senão, nada.
 * As horas da janela da Consulta são recalculadas a cada leitura e gravadas em _LEDGER_ESTEIRA
 * (h = produção, m = pessoas na hora, ops = quem passou pela esteira em cada turno).
 */
function montarEsteiras_(ss, planoEst, janela) {
  const ck = lerCheckins_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = abaHistEsteira_(ss);
    const n = sh.getLastRow() - 1;
    const linhas = n > 0 ? sh.getRange(2, 1, n, EST_CAB.length).getValues() : [];
    const pos = {};
    linhas.forEach((l, i) => {
      if (l[0] instanceof Date) l[0] = Utilities.formatDate(l[0], Session.getScriptTimeZone(), 'yyyy-MM-dd');
      l[0] = String(l[0]); l[1] = String(l[1]);
      let o = {}; try { o = JSON.parse(l[2] || '{}'); } catch (e) { o = {}; }
      l[2] = o;
      pos[l[0] + '|' + l[1]] = i;
    });
    const linha = (dia, id) => {
      const k = dia + '|' + id;
      if (pos[k] == null) pos[k] = linhas.push([dia, id, {}].concat(Array(48).fill(0))) - 1;
      return linhas[pos[k]];
    };
    const turnoDe = h => h >= 6 && h < 14 ? 'T1' : h >= 14 && h < 22 ? 'T2' : 'T3';
    const dataRelogio = (dia, h) => {
      if (h >= 6) return dia;
      const a = dia.split('-'), d = new Date(+a[0], +a[1] - 1, +a[2] + 1);
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    };

    // horas da janela da Consulta que os check-ins ainda cobrem (data do relógio >= cobreDesde):
    // a leitura atual é a verdade -> zera e recalcula. Horas mais antigas ficam como estão no histórico.
    const cobre = (dia, hora) => dataRelogio(dia, hora) >= ck.cobreDesde;
    (janela.horasJanela || []).forEach(hj => { if (!cobre(hj.dia, hj.hora)) return; ESTEIRAS.forEach(e => {
      const l = linha(hj.dia, e.id); l[3 + hj.hora] = 0; l[27 + hj.hora] = 0;
    }); });
    janela.registros.forEach(r => {
      if (!cobre(r.dia, r.hora)) return;
      const ch = dataRelogio(r.dia, r.hora) + '|' + r.hora;
      const total = ((ck.tot[r.id] || {})[ch]) || 0;
      if (!total) return;
      const porEst = ((ck.est[r.id] || {})[ch]) || {};
      // a hora vai para UMA esteira só: a de mais minutos, se for metade ou mais do tempo logado
      let melhor = null;
      ESTEIRAS.forEach(e => { if ((porEst[e.id] || 0) > 0 && (!melhor || porEst[e.id] > porEst[melhor])) melhor = e.id; });
      ESTEIRAS.forEach(e => {
        if (e.id !== melhor || (porEst[e.id] || 0) * 2 < total) return;   // menos da metade da hora na esteira: não conta
        const l = linha(r.dia, e.id);
        l[3 + r.hora] += r.v;
        l[27 + r.hora] += 1;
        const t = turnoDe(r.hora), lst = (l[2][t] = l[2][t] || []);
        if (lst.indexOf(r.id) < 0) lst.push(r.id);
      });
    });

    // HC logado: quem teve check-in nas estações da esteira no turno (com ou sem produção na hora)
    Object.keys(ck.est).forEach(ops => Object.keys(ck.est[ops]).forEach(ch => {
      const p = ch.split('|'), h = +p[1], a = p[0].split('-');
      const dOp = diaOperacional_(new Date(+a[0], +a[1] - 1, +a[2], h));
      ESTEIRAS.forEach(e => {
        if (!(ck.est[ops][ch][e.id] > 0)) return;
        const l = linha(dOp, e.id), k = 'L_' + turnoDe(h), lst = (l[2][k] = l[2][k] || []);
        if (lst.indexOf(ops) < 0) lst.push(ops);
      });
    }));

    const corte = new Date(); corte.setDate(corte.getDate() - CONFIG.HIST_DIAS);
    const corteIso = diaOperacional_(corte);
    const temDado = l => { for (let k = 3; k < 51; k++) if (Number(l[k]) > 0) return true; return Object.keys(l[2] || {}).length > 0; };
    const manter = linhas.filter(l => l[0] >= corteIso && temDado(l)).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    if (n > 0) sh.getRange(2, 1, n, EST_CAB.length).clearContent();
    if (manter.length) {
      garantirLinhas_(sh, manter.length + 1);
      sh.getRange(2, 1, manter.length, 3).setNumberFormat('@');
      sh.getRange(2, 1, manter.length, EST_CAB.length).setValues(manter.map(l => l.map((x, j) => j < 2 ? String(x) : j === 2 ? JSON.stringify(x) : Number(x) || 0)));
    }

    const porDia = {};
    manter.forEach(l => {
      const h = {}, m = {};
      for (let k = 0; k < 24; k++) { const a = Number(l[3 + k]) || 0, b = Number(l[27 + k]) || 0; if (a) h[k] = a; if (b) m[k] = b; }
      // hc = pessoas logadas na esteira (check-in); hcProd = pessoas com horas de produção contadas nela
      const conta = pre => {
        const o = {}, todos = {};
        ['T1', 'T2', 'T3'].forEach(t => { const lst = (l[2] || {})[pre + t] || []; if (lst.length) o[t] = lst.length; lst.forEach(x => { todos[x] = 1; }); });
        o.ALL = Object.keys(todos).length;
        return o;
      };
      (porDia[l[0]] = porDia[l[0]] || {})[l[1]] = { h: h, m: m, hc: conta('L_'), hcProd: conta('') };
    });
    const ws = lerWorkstation_(ss);
    return {
      esteiras: ESTEIRAS.map(e => ({ id: e.id, nome: e.nome, prefixo: e.prefixo, hcPlano: e.hcPlano })),
      stamp: ck.stamp, atual: { estacoes: ws.estacoes }, conf: ws.conf,
      porDia: porDia, plano: planoEst,
    };
  } finally {
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════════
//  CACHE  (JSON compactado em gzip + base64 e fatiado: o CacheService aceita até 100 KB por chave)
// ═══════════════════════════════════════════════════════════════
const CACHE_PREFIXO = 'prodturno_v3_';
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
