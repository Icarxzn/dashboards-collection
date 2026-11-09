/**
 * Painel FIFO Stage IN — Web App (Apps Script)
 * Planilha: "Stage IN - Performace"
 *   Stage IN PE4 / Stage IN PE2   -> base (IMPORTRANGE da Consulta de cada unidade)
 *   Headcount PE4 / Headcout PE2  -> HC (IMPORTRANGE SOC-PE4 / SOC-PE2)
 */

const CONFIG = {
  SHEET_ID: '1fB_CvpryMOy0ZhMLqW1LgJNhkvIKiZqn7k_fstKRJCU',
  UNIDADES: [
    { id: 'PE4', nome: 'PE4', base: ['Stage IN PE4'], hc: ['Headcount PE4', 'Headcout PE4'] },
    { id: 'PE2', nome: 'PE2', base: ['Stage IN PE2'], hc: ['Headcount PE2', 'Headcout PE2'] },
  ],
  DIAS: 45,                      // janela de dias enviada ao painel
  META: { bom: 1, medio: 2 },    // % quebra: <=1 bom, <=2 médio, >2 ruim
  CACHE_SEG: 1500,               // validade do cache; o gatilho renova a cada 10 min
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('FIFO Stage IN')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Chamado pelo painel. Retorna JSON (string) com as duas unidades.
 * Serve do cache; forcar=true (botão Atualizar) relê a planilha.
 */
function getDados(forcar) {
  if (!forcar) {
    const hit = lerCache_();
    if (hit) return hit;
  }
  const json = montarDados_();
  gravarCache_(json);
  garantirGatilho_();
  return json;
}

/** Gatilho de tempo: mantém o cache quente para ninguém esperar a leitura da planilha. */
function aquecerCache() {
  gravarCache_(montarDados_());
}

// O CacheService aceita até 100 KB por chave: o JSON vai compactado (gzip + base64) e fatiado.
const CACHE_KEY = 'stagein_v3';
const CACHE_FATIA = 90000;

function lerCache_() {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get(CACHE_KEY + '_n'));
    if (!n) return null;
    const chaves = [];
    for (let i = 0; i < n; i++) chaves.push(CACHE_KEY + '_' + i);
    const partes = cache.getAll(chaves);
    if (Object.keys(partes).length !== n) return null;
    const b64 = chaves.map(k => partes[k]).join('');
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip');
    return Utilities.ungzip(blob).getDataAsString('UTF-8');
  } catch (e) {
    return null;
  }
}

function gravarCache_(json) {
  try {
    const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json, 'application/json')).getBytes());
    const itens = {};
    let n = 0;
    for (let i = 0; i < b64.length; i += CACHE_FATIA) itens[CACHE_KEY + '_' + n++] = b64.substr(i, CACHE_FATIA);
    itens[CACHE_KEY + '_n'] = String(n);
    CacheService.getScriptCache().putAll(itens, CONFIG.CACHE_SEG);
  } catch (e) {
    console.warn('Cache não gravado: ' + e);
  }
}

function garantirGatilho_() {
  try {
    const existe = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'aquecerCache');
    if (!existe) ScriptApp.newTrigger('aquecerCache').timeBased().everyMinutes(10).create();
  } catch (e) {
    console.warn('Gatilho não criado: ' + e);
  }
}

function montarDados_() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const tz = ss.getSpreadsheetTimeZone();
  const unidades = CONFIG.UNIDADES.map(u => {
    const base = aba_(ss, u.base);
    const hc = aba_(ss, u.hc);
    const dados = base ? lerBase_(base.getDataRange().getValues(), tz) : vazio_();
    dados.hc = hc ? lerHc_(hc.getDataRange().getValues()) : [];
    aplicarTurnoHc_(dados);
    dados.id = u.id;
    dados.nome = u.nome;
    return dados;
  });
  return JSON.stringify({
    geradoEm: Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'),
    meta: CONFIG.META,
    unidades: unidades,
  });
}

function aba_(ss, nomes) {
  for (let i = 0; i < nomes.length; i++) {
    const sh = ss.getSheetByName(nomes[i]);
    if (sh) return sh;
  }
  return null;
}

function vazio_() {
  return { rows: [], grupos: [], areas: [], ops: [] };
}

/**
 * Linha compacta enviada ao painel:
 * [data, turno, quebra(0/1), hora, grupoIdx, areaIdx, opInIdx, opOutIdx, permanenciaMin, TO, rankIn, rankOut, stagingHHmm]
 */
function lerBase_(values, tz) {
  if (values.length < 2) return vazio_();
  const head = values[0].map(norm_);
  const c = {};
  ['adjusted_date', 'mapping_item_number', 'staging_date', 'rank_in', 'stage_out_date', 'rank_out',
    'fifo_status', 'turno', 'staging_area_name', 'group_name', 'operator_staging', 'operator_stage_out']
    .forEach(k => { c[k] = head.indexOf(k); });

  const grupos = dic_(), areas = dic_(), ops = dic_();
  const brutas = [];
  let maxData = '';
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const data = dataIso_(r[c.adjusted_date], tz);
    if (!data) continue;
    if (data > maxData) maxData = data;
    brutas.push([data, r]);
  }
  const corte = maxData ? somaDias_(maxData, -(CONFIG.DIAS - 1)) : '';

  const rows = [];
  brutas.forEach(([data, r]) => {
    if (data < corte) return;
    const sIn = dataHora_(r[c.staging_date], tz);
    const sOut = dataHora_(r[c.stage_out_date], tz);
    const perm = sIn && sOut ? Math.round((epoch_(sOut) - epoch_(sIn)) / 60000) : null;
    rows.push([
      data,
      String(r[c.turno] || '').trim().toUpperCase(),
      /not/i.test(String(r[c.fifo_status])) ? 1 : 0,
      sIn ? Number(sIn.substr(11, 2)) : null,
      grupos.id(String(r[c.group_name] || '').trim() || '(sem grupo)'),
      areas.id(String(r[c.staging_area_name] || '').trim() || '(sem área)'),
      ops.id(String(r[c.operator_staging] || '').trim()),
      ops.id(String(r[c.operator_stage_out] || '').trim()),
      perm,
      String(r[c.mapping_item_number] || ''),
      Number(r[c.rank_in]) || null,
      Number(r[c.rank_out]) || null,
      sIn ? sIn.substr(0, 16) : '',
    ]);
  });
  return {
    rows: rows,
    grupos: grupos.lista,
    areas: areas.lista,
    ops: ops.lista.map(parseOp_),
  };
}

/** HC: envia só o necessário ao painel (sem CPF, e-mail, telefone). [id, nome, turno, status, cargo, setor, lider] */
function lerHc_(values) {
  if (values.length < 2) return [];
  const head = values[0].map(norm_);
  const col = nome => head.indexOf(nome);
  const c = {
    id: col('ops id'), nome: col('nome'), turno: col('turno'), status: col('status'),
    cargo: col('cargo'), setor: col('setor'), lider: col('lider'),
  };
  const v = (r, i) => i < 0 ? '' : String(r[i] || '').trim();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const id = v(r, c.id);
    if (!id) continue;
    out.push([id, v(r, c.nome), v(r, c.turno).toUpperCase(), v(r, c.status).toUpperCase(),
      v(r, c.cargo), v(r, c.setor), v(r, c.lider)]);
  }
  return out;
}

/**
 * Mesma regra do report do Seatalk (bootseatalk.py): o turno da TO é o turno de quem tirou
 * do stage (operador do stage-out) no headcount (ativo tem prioridade); fora do HC, vale a
 * coluna turno da base. Quem tira escolhe a ordem de saída, então a quebra é dele.
 */
function aplicarTurnoHc_(dados) {
  const TURNOS = ['T1', 'T2', 'T3'];
  const turnoOp = {};
  dados.hc.forEach(h => {
    const id = h[0].toLowerCase();
    if (TURNOS.indexOf(h[2]) < 0) return;
    if (!(id in turnoOp) || h[3] === 'ATIVO') turnoOp[id] = h[2];
  });
  dados.rows.forEach(r => {
    const id = (dados.ops[r[7]] || [''])[0].toLowerCase();
    if (id && turnoOp[id]) r[1] = turnoOp[id];
  });
}

/** minúsculo e sem acento: "Líder" -> "lider" */
function norm_(h) {
  return String(h).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
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

/** "[Ops124076]NOME" -> ["Ops124076", "NOME"] */
function parseOp_(s) {
  const m = /^\[(.*?)\]\s*(.*)$/.exec(s);
  return m ? [m[1].trim(), m[2].trim()] : ['', s];
}

function dataIso_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (typeof v === 'number' && v > 30000) return somaDias_('1899-12-30', Math.floor(v));
  const s = String(v || '').trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? m[0] : '';
}

/** Normaliza para "yyyy-MM-dd HH:mm:ss" */
function dataHora_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
  const s = String(v || '').trim();
  let m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s);
  if (m) return m[1] + ' ' + m[2];
  m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})/.exec(s);
  return m ? m[3] + '-' + m[2] + '-' + m[1] + ' ' + m[4] : '';
}

function epoch_(s) {
  return Date.UTC(+s.substr(0, 4), +s.substr(5, 2) - 1, +s.substr(8, 2),
    +s.substr(11, 2), +s.substr(14, 2), +s.substr(17, 2));
}

function somaDias_(iso, n) {
  const d = new Date(Date.UTC(+iso.substr(0, 4), +iso.substr(5, 2) - 1, +iso.substr(8, 2) + n));
  return d.toISOString().substr(0, 10);
}
