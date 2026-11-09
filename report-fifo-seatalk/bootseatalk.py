import os
import sys
import json
import base64
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import gspread
import requests
from google.oauth2.service_account import Credentials
from playwright.sync_api import sync_playwright

SPREADSHEET_ID = "19ejea0roWLSroIskVg0a2Pr0dXcTjsm0zUxOwL8SQkI"
SHEET_CONSULTA = "Consulta"
SHEET_FILTRO = "Filtro"
SHEET_HEADCOUNT = "Headcount"
WEBHOOK_URL = os.environ.get("SEATALK_WEBHOOK_URL", "")  # no GitHub: secret SEATALK_WEBHOOK_URL
LINK_RELATORIO = "https://docs.google.com/spreadsheets/d/19ejea0roWLSroIskVg0a2Pr0dXcTjsm0zUxOwL8SQkI/edit?gid=2113883777#gid=2113883777"
CRED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "credencial.json")
FUSO = ZoneInfo("America/Recife")

TURNOS = ("T1", "T2", "T3")
TARGET_PADRAO = 1.0          # % de quebra de FIFO; usado se Filtro!B6 estiver vazio
TETO_ESCALA = 30.0           # % a partir do qual a célula do heatmap fica no vermelho mais forte
MAX_TOS_TEXTO = 10           # máximo de TOs listados na mensagem

# Colunas da aba Consulta (0-based)
# COL_OPERADOR = operator_stage_out (N): quem tira do stage escolhe a ordem de saída, então a quebra é dele
COL_DATA, COL_TO, COL_STATUS, COL_TURNO, COL_OPERADOR = 0, 1, 6, 7, 13
# Colunas da aba Headcount (0-based)
HC_OPS_ID, HC_STATUS, HC_TURNO = 0, 10, 14

# Responsáveis por turno do SOC-PE4
MENCOES_TURNO = {
    "T1": ["caio.flor@shopee.com"],
    "T2": ["monique.queiroz@shopee.com", "gabriel.apereira@shopee.com"],
    "T3": ["estefane.fabrinny@shopee.com"],
}
MENCOES_FYI = ["hikaro.almeida@shopee.com", "thaian.braga@shopee.com", "gustavo.motta@shopee.com"]

DIAS_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]


# ----------------------------------------------------------------------------
# Leitura da planilha
# ----------------------------------------------------------------------------

def get_planilha():
    scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    creds_json = os.environ.get("GOOGLE_CREDENTIALS")
    if creds_json:
        creds = Credentials.from_service_account_info(json.loads(creds_json), scopes=scopes)
    else:
        creds = Credentials.from_service_account_file(CRED_FILE, scopes=scopes)
    client = gspread.authorize(creds)
    resposta = client.open_by_key(SPREADSHEET_ID).values_batch_get(
        [f"{SHEET_CONSULTA}!A:N", f"{SHEET_FILTRO}!B6", f"{SHEET_HEADCOUNT}!A:O"]
    )
    consulta, target, headcount = (vr.get("values", []) for vr in resposta["valueRanges"])
    return consulta, target, headcount


def mapa_turnos(headcount):
    """OPS ID -> turno do colaborador na aba Headcount (ativos têm prioridade sobre desligados)."""
    mapa = {}
    for row in headcount[1:]:
        if len(row) <= HC_TURNO:
            continue
        ops_id = row[HC_OPS_ID].strip().lower()
        turno = row[HC_TURNO].strip().upper()
        if not ops_id or turno not in TURNOS:
            continue
        if ops_id not in mapa or row[HC_STATUS].strip().upper() == "ATIVO":
            mapa[ops_id] = turno
    return mapa


def _ops_id(operador):
    """'[Ops274219]SIDNEY ...' -> 'ops274219'."""
    operador = operador.strip()
    if operador.startswith("[") and "]" in operador:
        return operador[1:operador.index("]")].strip().lower()
    return ""


def _numero(texto):
    try:
        return float(str(texto).replace("%", "").replace(",", ".").strip())
    except ValueError:
        return None


def _data(texto):
    try:
        return datetime.strptime(str(texto).strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


def montar_dados(consulta, target_rows, headcount):
    target = _numero(target_rows[0][0]) if target_rows and target_rows[0] else None
    if target is None:
        target = TARGET_PADRAO

    # Conta TOs por dia/turno direto da base (aba Consulta). O turno é o do operador do
    # stage-out (quem tirou) na aba Headcount; se ele não estiver lá, usa o turno pelo horário (coluna H).
    turno_operador = mapa_turnos(headcount)
    total = defaultdict(int)
    quebras = defaultdict(int)
    tos_quebra = defaultdict(list)
    for row in consulta[1:]:
        if len(row) <= COL_TURNO:
            continue
        d = _data(row[COL_DATA])
        operador = row[COL_OPERADOR] if len(row) > COL_OPERADOR else ""
        turno = turno_operador.get(_ops_id(operador), row[COL_TURNO].strip())
        if d is None or turno not in TURNOS:
            continue
        total[(d, turno)] += 1
        if "not" in row[COL_STATUS].lower():
            quebras[(d, turno)] += 1
            tos_quebra[d].append((turno, row[COL_TO].strip()))

    datas = sorted({d for d, _ in total})
    if not datas:
        raise ValueError("Aba Consulta sem dados.")

    # Referência: ontem (D-1). Se a base ainda não tem ontem, usa o último dia disponível.
    ontem = datetime.now(FUSO).date() - timedelta(days=1)
    ate_ontem = [d for d in datas if d <= ontem]
    data_ref = ate_ontem[-1] if ate_ontem else datas[-1]

    def pct(d, t=None):
        turnos = (t,) if t else TURNOS
        tot = sum(total[(d, x)] for x in turnos)
        q = sum(quebras[(d, x)] for x in turnos)
        return (q / tot * 100) if tot else None

    resultado = {t: {"pct": pct(data_ref, t), "total": total[(data_ref, t)], "quebras": quebras[(data_ref, t)]}
                 for t in TURNOS}
    total_dia = sum(total[(data_ref, t)] for t in TURNOS)
    quebras_dia = sum(quebras[(data_ref, t)] for t in TURNOS)

    anteriores = [d for d in datas if d < data_ref]
    dia_anterior = anteriores[-1] if anteriores else None

    # Semana de segunda a domingo, sem atravessar a virada do mês
    # (ex.: 1ª semana de outubro/2026 = 01/10 a 04/10; a seguinte = 05/10 a 11/10).
    # O report de segunda (referência domingo) fecha a semana; o de terça (referência segunda) já abre a nova.
    inicio = max(data_ref - timedelta(days=data_ref.weekday()), data_ref.replace(day=1))
    fim = data_ref + timedelta(days=6 - data_ref.weekday())
    if fim.month != data_ref.month:
        fim = (data_ref.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    dias = [inicio + timedelta(days=i) for i in range((fim - inicio).days + 1)]
    semana = {}
    for t in TURNOS:
        vals = [pct(d, t) if d <= data_ref else None for d in dias]   # dias depois da referência ainda não fecharam
        validos = [v for v in vals if v is not None]
        semana[t] = {"valores": vals, "media": sum(validos) / len(validos) if validos else None}

    ordem = {t: i for i, t in enumerate(TURNOS)}
    return {
        "data_ref": data_ref,
        "target": target,
        "resultado": resultado,
        "fechamento": pct(data_ref),
        "respected": total_dia - quebras_dia,
        "not_respected": quebras_dia,
        "total": total_dia,
        "anterior": {t: pct(dia_anterior, t) if dia_anterior else None for t in TURNOS},
        "fechamento_anterior": pct(dia_anterior) if dia_anterior else None,
        "tos": sorted(tos_quebra[data_ref], key=lambda x: ordem[x[0]]),
        "dias": dias,
        "semana": semana,
    }


# ----------------------------------------------------------------------------
# Texto do report
# ----------------------------------------------------------------------------

def fmt_pct(valor):
    return "-" if valor is None else f"{valor:.2f}".replace(".", ",")


def _mencao(email):
    return f"<mention-tag target='seatalk://user?email={email}' />"


def turnos_fora_target(dados):
    return [t for t in TURNOS
            if dados["resultado"][t]["pct"] is not None and dados["resultado"][t]["pct"] > dados["target"]]


def build_report(dados):
    fechamento = dados["fechamento"]
    emoji = "✔️" if fechamento is not None and fechamento <= dados["target"] else "✖️"

    cabecalho = [
        "📊 Quebra de FIFO - Stage in",
        "",
        f"📅 Data: {dados['data_ref'].strftime('%d/%m/%Y')}",
        f"✔️ TO Respected: {dados['respected']}",
        f"✖️ TO Not Respected: {dados['not_respected']}",
        "",
        f"🎯 Target: {fmt_pct(dados['target'])}%",
        f"{emoji} Fechamento: {fmt_pct(fechamento)}%",
        "",
    ]
    for t in TURNOS:
        cabecalho.append(f"{t} - {fmt_pct(dados['resultado'][t]['pct'])}%")
    cabecalho += ["", "Turno    TO´S Not Respected", "─" * 20]

    rodape = [""]
    fora = turnos_fora_target(dados)
    if fora:
        mencoes = [_mencao(e) for e in MENCOES_FYI] + [_mencao(e) for t in fora for e in MENCOES_TURNO[t]]
        rodape += ["fyi " + " ".join(mencoes), ""]
    rodape += ["📊 Acesse o relatório completo:", LINK_RELATORIO]

    linhas_to = [f"{turno}       {to}" for turno, to in dados["tos"]] or ["Nenhum TO encontrado"]
    mostradas = linhas_to[:MAX_TOS_TEXTO]

    return "\n".join(cabecalho + mostradas + rodape)


# ----------------------------------------------------------------------------
# Imagem
# ----------------------------------------------------------------------------

def _mistura(c1, c2, t):
    t = min(max(t, 0.0), 1.0)
    a = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(c2[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02X}" for x, y in zip(a, b))


def _cor_celula(valor, target):
    """(fundo, texto). Dentro do target = verde; acima = do rosa ao vermelho forte (TETO_ESCALA)."""
    if valor is None:
        return "#F7F8FA", "#B0B7C3"
    if valor <= target:
        return "#2E9D5B", "#FFFFFF"
    t = (valor - target) / (TETO_ESCALA - target)
    return _mistura("#FBD3C9", "#C0392B", t), ("#FFFFFF" if t > 0.5 else "#7F1D1D")


def _tile(rotulo, valor, target, anterior=None, detalhe="", destaque=False):
    if valor is None:
        classe, chip = "sem", "Sem dado"
    elif valor <= target:
        classe, chip = "ok", "Dentro do target"
    else:
        classe, chip = "fora", "Fora do target"
    variacao = ""
    if valor is not None and anterior is not None:
        diff = valor - anterior
        if abs(diff) >= 0.005:
            seta, cls = ("▲", "pior") if diff > 0 else ("▼", "melhor")
            variacao = f'<div class="var {cls}">{seta} {fmt_pct(abs(diff))} p.p. vs dia anterior</div>'
        else:
            variacao = '<div class="var">= igual ao dia anterior</div>'
    return f"""
        <div class="tile {classe}{' destaque' if destaque else ''}">
          <div class="tile-top"><span class="turno">{rotulo}</span><span class="chip">{chip}</span></div>
          <div class="valor">{fmt_pct(valor)}{'%' if valor is not None else ''}</div>
          <div class="detalhe">{detalhe}</div>
          {variacao}
        </div>"""


def gerar_html(dados):
    target = dados["target"]
    tiles = [_tile("Fechamento", dados["fechamento"], target, dados["fechamento_anterior"],
                   f"{dados['not_respected']} de {dados['total']} TOs", destaque=True)]
    for t in TURNOS:
        r = dados["resultado"][t]
        tiles.append(_tile(t, r["pct"], target, dados["anterior"][t], f"{r['quebras']} de {r['total']} TOs"))

    cab_dias = "".join(
        f'<th><div class="dia">{d.strftime("%d/%m")}</div><div class="sem">{DIAS_SEMANA[d.weekday()]}</div></th>'
        for d in dados["dias"]
    )
    linhas = []
    for t in TURNOS:
        info = dados["semana"][t]
        cels = []
        for v in info["valores"]:
            fundo, cor = _cor_celula(v, target)
            cels.append(f'<td style="background:{fundo};color:{cor}">{fmt_pct(v) if v is not None else "–"}</td>')
        media = info["media"]
        fundo, cor = _cor_celula(media, target)
        cels.append(f'<td class="media" style="background:{fundo};color:{cor}">{fmt_pct(media) if media is not None else "–"}</td>')
        if media is None:
            badge = '<span class="badge sem">Sem dados</span>'
        elif media <= target:
            badge = '<span class="badge ok">✓ Ótimo</span>'
        else:
            badge = '<span class="badge fora">✗ Oportunidade</span>'
        cels.append(f'<td class="status">{badge}</td>')
        linhas.append(f'<tr><td class="turno-col">{t}</td>{"".join(cels)}</tr>')

    return f"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: 'Segoe UI', 'Inter', Roboto, Arial, sans-serif; background: #FFFFFF; color: #1F2937; -webkit-font-smoothing: antialiased; }}
#card {{ width: 920px; background: #F4F6FA; }}

.header {{
  background: linear-gradient(120deg, #1F3864 0%, #2E5090 100%);
  border-bottom: 4px solid #EE4D2D;
  padding: 22px 28px; color: #FFFFFF;
  display: flex; justify-content: space-between; align-items: center;
}}
.header .marca {{ font-size: 12.5px; letter-spacing: 2px; font-weight: 600; color: #FFB08F; }}
.header h1 {{ font-size: 25px; font-weight: 800; margin-top: 2px; }}
.header .meta {{ text-align: right; font-size: 13px; color: #D6DEEE; line-height: 1.6; }}
.header .meta b {{ color: #FFFFFF; font-size: 16px; }}

.content {{ padding: 20px; display: flex; flex-direction: column; gap: 16px; }}

.tiles {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }}
.tile {{ position: relative; overflow: hidden; background: #FFFFFF; border-radius: 14px; padding: 20px 16px 14px; box-shadow: 0 1px 3px rgba(16,24,40,.08); }}
.tile::before {{ content: ''; position: absolute; left: 0; right: 0; top: 0; height: 5px; background: var(--cor); }}
.tile.ok   {{ --cor: #16A34A; --chip-bg: #DCFCE7; --chip: #15803D; }}
.tile.fora {{ --cor: #DC2626; --chip-bg: #FEE2E2; --chip: #B91C1C; }}
.tile.sem  {{ --cor: #CBD2DC; --chip-bg: #F1F3F6; --chip: #8A94A6; }}
.tile.destaque {{ background: #1F2D3D; }}
.tile.destaque .turno {{ color: #FFFFFF; }}
.tile.destaque .detalhe {{ color: #AAB4C3; }}
.tile-top {{ display: flex; justify-content: space-between; align-items: center; gap: 6px; }}
.turno {{ font-size: 14px; font-weight: 800; color: #1F3864; }}
.chip {{ font-size: 10.5px; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: var(--chip-bg); color: var(--chip); white-space: nowrap; }}
.valor {{ font-size: 32px; font-weight: 800; margin-top: 8px; color: var(--cor); line-height: 1.1; }}
.tile.destaque.ok .valor {{ color: #4ADE80; }}
.tile.destaque.fora .valor {{ color: #F87171; }}
.tile.sem .valor {{ color: #B0B7C3; }}
.detalhe {{ font-size: 12.5px; color: #4B5563; margin-top: 4px; font-weight: 600; }}
.var {{ font-size: 12px; color: #6B7280; margin-top: 4px; font-weight: 600; }}
.var.pior {{ color: #B91C1C; }}
.var.melhor {{ color: #15803D; }}
.tile.destaque .var.pior {{ color: #F87171; }}
.tile.destaque .var.melhor {{ color: #4ADE80; }}

.secao {{ background: #FFFFFF; border-radius: 14px; box-shadow: 0 1px 3px rgba(16,24,40,.08); overflow: hidden; }}
.secao-titulo {{ padding: 13px 18px; font-size: 14px; font-weight: 800; color: #1F3864; letter-spacing: .3px; border-bottom: 1px solid #EEF0F4; display: flex; justify-content: space-between; }}
.secao-titulo span {{ font-weight: 600; color: #8A94A6; font-size: 12.5px; }}

table {{ width: 100%; border-collapse: separate; border-spacing: 4px; padding: 8px 10px 12px; font-size: 14.5px; }}
table.compacta {{ width: auto; }}
table.compacta td {{ min-width: 110px; }}
table.compacta td.turno-col {{ min-width: 48px; }}
table.compacta td.status {{ min-width: 170px; }}
th {{ font-size: 12px; color: #6B7280; font-weight: 700; padding: 4px 0 6px; text-align: center; }}
th .sem {{ font-weight: 500; color: #9CA3AF; font-size: 11px; text-transform: uppercase; }}
td {{ text-align: center; padding: 11px 2px; border-radius: 8px; font-weight: 700; font-variant-numeric: tabular-nums; }}
td.turno-col {{ color: #1F3864; font-weight: 800; background: #EEF2F8; width: 48px; }}
td.media {{ box-shadow: inset 0 0 0 2px rgba(31,56,100,.25); }}
td.status {{ background: transparent; padding: 0 2px; }}
.badge {{ display: inline-block; padding: 6px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 700; white-space: nowrap; }}
.badge.ok {{ background: #DCFCE7; color: #15803D; }}
.badge.fora {{ background: #FEE2E2; color: #B91C1C; }}
.badge.sem {{ background: #F1F3F6; color: #8A94A6; }}

.rodape {{ padding: 0 22px 16px; font-size: 11.5px; color: #8A94A6; display: flex; justify-content: flex-end; align-items: center; }}
.legenda {{ display: flex; align-items: center; gap: 6px; }}
.escala {{ width: 120px; height: 9px; border-radius: 999px; background: linear-gradient(90deg, #2E9D5B 0 22%, #FBD3C9 22%, #C0392B); }}
</style></head>
<body>
<div id="card">
  <div class="header">
    <div>
      <div class="marca">SHOPEE · SOC-PE4</div>
      <h1>Quebra de FIFO — Stage in</h1>
    </div>
    <div class="meta">Referência<br><b>{dados['data_ref'].strftime('%d/%m/%Y')}</b><br>Target ≤ {fmt_pct(target)}%</div>
  </div>
  <div class="content">
    <div class="tiles">{''.join(tiles)}
    </div>
    <div class="secao">
      <div class="secao-titulo">Semana {dados['dias'][0].strftime('%d/%m')} a {dados['dias'][-1].strftime('%d/%m')} <span>% de TOs fora do FIFO por turno</span></div>
      <table class="{'cheia' if len(dados['dias']) >= 5 else 'compacta'}">
        <thead><tr><th></th>{cab_dias}<th>Média</th><th>Semana</th></tr></thead>
        <tbody>{''.join(linhas)}</tbody>
      </table>
    </div>
  </div>
  <div class="rodape">
    <span class="legenda">≤ {fmt_pct(target)}% <span class="escala"></span> {fmt_pct(TETO_ESCALA)}%+</span>
  </div>
</div>
</body></html>"""


def renderizar_html_para_png(html):
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        try:
            page = browser.new_page(viewport={"width": 940, "height": 600}, device_scale_factor=2)
            page.set_content(html, wait_until="load")
            return page.locator("#card").screenshot()
        finally:
            browser.close()


# ----------------------------------------------------------------------------
# Envio
# ----------------------------------------------------------------------------

def _post_webhook(payload):
    """Uma única tentativa: repetir um POST que pode já ter sido entregue duplica a mensagem no grupo."""
    if not WEBHOOK_URL:
        raise RuntimeError("Defina a variável de ambiente SEATALK_WEBHOOK_URL com o webhook do grupo no Seatalk.")
    response = requests.post(WEBHOOK_URL, json=payload, timeout=30)
    response.raise_for_status()
    try:
        code = response.json().get("code", 0)
    except ValueError:
        code = 0
    if code != 0:
        raise RuntimeError(f"SeaTalk recusou a mensagem: {response.text[:200]}")


def send_to_seatalk(message):
    _post_webhook({"tag": "text", "text": {"content": message}})
    print("✅ Enviado com sucesso!")


def send_image_to_seatalk(image_bytes):
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    _post_webhook({"tag": "image", "image_base64": {"content": b64}})
    print("✅ Imagem enviada com sucesso!")


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass

    dry_run = os.environ.get("DRY_RUN") == "1"

    # Tudo é lido, validado e renderizado antes do primeiro envio:
    # se der erro em qualquer etapa, nada é mandado ao grupo.
    try:
        dados = montar_dados(*get_planilha())
        report = build_report(dados)
        imagem = renderizar_html_para_png(gerar_html(dados))
    except Exception as e:
        print(f"❌ Erro ao gerar o report: {e}\nNenhuma mensagem enviada ao SeaTalk.")
        raise

    print(report)
    print(f"\nImagem gerada ({len(imagem)} bytes)")

    if dry_run:
        saida = os.path.join(os.path.dirname(os.path.abspath(__file__)), "preview_fifo.png")
        with open(saida, "wb") as f:
            f.write(imagem)
        print(f"🧪 DRY_RUN=1: nada enviado. Prévia salva em {saida}")
        return

    send_to_seatalk(report)
    send_image_to_seatalk(imagem)


if __name__ == "__main__":
    main()
