"""
Gera as imagens de preview de cada dashboard (dashboards/<dash>/preview*.png).

Monta o HTML do mesmo jeito que o Apps Script (resolve os include() e as variáveis do template),
troca o google.script.run por um "servidor de mentira" que devolve DADOS FICTÍCIOS e fotografa a
página com o Playwright (Chromium headless). Os dados são inventados de propósito: o repositório é
público e as imagens não podem mostrar operadores, TOs ou volumes reais.

Uso:
    python tools/gerar_previews.py              (todos)
    python tools/gerar_previews.py 04-tos-packed (só um)

Requer: pip install playwright && playwright install chromium  (e internet, para Chart.js/fontes).
"""
import json
import os
import random
import re
import sys
import time

from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGORA = int(time.time())
ISO_AGORA = time.strftime("%Y-%m-%dT%H:%M:%S-03:00", time.localtime(AGORA))
rnd = random.Random(42)

DESTINOS = [("104", "LM_PB_João Pessoa"), ("109", "LM_PE_Cabo de Santo Agostinho"), ("110", "LM_PE_Garanhuns"),
            ("101", "LM_PE_Recife_Boa Viagem"), ("105", "LM_AL_Maceió"), ("111", "LM_SE_Aracaju"),
            ("108", "LM_PE_Paulista"), ("107", "LM_RN_Natal"), ("106", "LM_PE_Petrolina")]
OPERADORES = ["operador.a", "operador.b", "operador.c", "operador.d"]


# ── montagem do HTML ───────────────────────────────────────────────────────
def montar(pasta, variaveis):
    """Lê Index.html, resolve <?!= include('X'); ?> e <?= var ?> como o HtmlService faria."""
    ler = lambda n: open(os.path.join(pasta, n), encoding="utf-8").read()
    html = ler("Index.html")
    html = re.sub(r"<\?!=\s*include\('(\w+)'\);?\s*\?>", lambda m: ler(m.group(1) + ".html"), html)
    return re.sub(r"<\?=\s*(\w+)\s*\?>", lambda m: variaveis[m.group(1)], html)


def stub(respostas):
    """google.script.run falso: cada função devolve o JSON de 'respostas' (como o Code.gs, em string)."""
    return """<script>
const __d = %s;
window.google = { script: { run: (function mk(ok, fail) {
  return new Proxy({}, { get(_, k) {
    if (k === 'withSuccessHandler') return f => mk(f, fail);
    if (k === 'withFailureHandler') return f => mk(ok, f);
    return (...a) => setTimeout(() => {
      const v = __d[k] === undefined ? { error: 'sem dados de exemplo' } : __d[k];
      if (ok) ok(typeof v === 'string' ? v : JSON.stringify(v));
    }, 30);
  } });
})(null, null) } };
</script>""" % json.dumps(respostas, ensure_ascii=False)


# ── dados fictícios ────────────────────────────────────────────────────────
def ruas_stage_out():
    lst = []
    for i in range(28):
        d = DESTINOS[i % len(DESTINOS)]
        g, t = rnd.randint(0, 5), rnd.randint(0, 4)
        dur = rnd.choice([900, 7200, 20000, 50000, 95000, 140000, 190000]) if g + t else 0
        lst.append({"staging_area_id": "OBS-%02d" % i, "staging_area_name": "OUT-%d" % (100 + i), "staging_area_status": 1,
                    "capacity": 11, "operator": OPERADORES[i % 4] + "@shopee.com", "to_destination": "[%s]%s" % d,
                    "transport_order_quantity": t, "loose_order_quantity": 0, "priority": 1,
                    "occupancy_percentage": "%.2f %%" % min(100, (g + t) / 11 * 100 * 1.6),
                    "cage_quantity": g, "staging_duration_time": dur})
    return lst


def tos_packed(status="Packed", n=60, horas=30):
    lst = []
    for i in range(n):
        d = DESTINOS[i % len(DESTINOS)]
        ct = AGORA - rnd.randint(120, horas * 3600)
        lst.append({"to_number": "TO2611%07d" % i, "current_station_name": "SoC_PE_Exemplo", "sender": "SoC_PE_Exemplo",
                    "ctime": ct - rnd.randint(300, 3000), "complete_time": ct if status == "Packed" else 0,
                    "operator": "[Ops0]" + OPERADORES[i % 4].upper(), "receiver": d[1], "dest_station_id": d[0],
                    "dest_station_name": d[1], "weight": rnd.randint(2000, 60000), "status": status,
                    "quantity": rnd.randint(1, 60), "pack_name": rnd.choice(["Saca", "Saca", "Scuttle"]),
                    "staging_area_id": "-", "lh_trip_number": "", "display_direction": "Forward"})
    return lst


def stage_in():
    zonas = ["0 - 50 (volumoso)", "51 - 80 (Zona Grande)", "81+ (Híbrida)", "Zona Sacas", "Drenagem Volumoso"]
    lst, by_area, by_tos, by_zone, by_turno = [], {}, {}, {}, {}
    for i in range(40):
        z, rua = zonas[i % 5], "RUA-INB-%02d" % i
        tq, cg = rnd.randint(0, 6), rnd.randint(0, 2)
        dur = rnd.randint(600, 200000) if tq + cg else 0
        lst.append({"area_id": "IBS-%d" % i, "area_name": rua, "capacity": 33, "status": 1, "to_quantity": tq,
                    "cage_quantity": cg, "operator": OPERADORES[i % 4] + "@shopee.com",
                    "occupy_percentage": "%.2f %%" % ((tq + cg) / 33 * 100), "staging_duration_time": dur,
                    "staging_group_name": z})
        tos = []
        for k in range(tq + cg):
            pac, turno = rnd.randint(1, 120), rnd.choice(["T1", "T2", "T3"])
            tos.append({"to": ("CG%d" % (i * 10 + k)) if k >= tq else "TO2611%05d%d" % (i, k), "pacotes": pac,
                        "aging_h": rnd.random() * dur / 3600, "hora_end": "09/11 21:00", "turno": turno})
            by_zone.setdefault(z, {"pacotes": 0})["pacotes"] += pac
            by_turno.setdefault(turno, {"pacotes": 0})["pacotes"] += pac
        if tos:
            by_tos[rua] = tos
            by_area[rua] = {"pacotes": sum(t["pacotes"] for t in tos), "zona": z, "to_quantity": tq}
    return ({"fetchedAt": ISO_AGORA, "list": lst},
            {"geradoEm": AGORA, "rowCount": 1, "byZone": by_zone, "byArea": by_area, "byAreaTOs": by_tos, "byTurno": by_turno})


def queue():
    lst = []
    for i, st in enumerate([3, 3, 1, 1, 2, 5, 3, 1]):
        ent = AGORA - 900 * (i + 1) * 2
        lst.append({"queue_id": "Q%d" % i, "queue_number": "IB%05d" % i, "queue_status": st, "waiting_time": 8 * (i + 1),
                    "on_hold_time": 0, "order_quantity": 800 + i * 450, "is_prioritized": 0,
                    "assigned_dock_name": "Doca Inbound %d" % (80 + i) if st == 2 else "",
                    "occupied_dock_name": "Doca Inbound %d" % (90 + i) if st == 3 else "", "add_to_queue_time": ent,
                    "route_info": {"lh_trip_number": "LT0EXEMPLO%02d" % i, "trip_name": "viagem exemplo",
                                   "vehicle_number": "ABC1D%02d" % i, "driver_name": "MOTORISTA EXEMPLO %d" % i,
                                   "vehicle_type_name": rnd.choice(["TRUCK", "CARRETA", "TOCO"]), "agency_name": "TRANSPORTADORA"},
                    "_trip_detail": {"vehicle_type_name": "TRUCK", "agency_name": "TRANSPORTADORA",
                                     "trip_station": [{"sequence_number": 2, "station_name": "SoC Exemplo",
                                                       "trip_station_status": 60 if st == 3 else 50, "ata": ent,
                                                       "eta": 0, "atd": 0, "unload_quantity": 0}]}})
    return {"queue": {"list": lst}, "trips": {"fetchedAt": ISO_AGORA, "list": []}}


def sacas():
    dests = [d[1] for d in DESTINOS[:5]]
    tipos = ["Saca", "Scuttle", "Scuttle Volumoso", ""]
    lst = [["TO%08d" % i, rnd.randint(0, 4), rnd.randint(1, 120), rnd.choices([0, 1, 2, 3], [70, 20, 8, 2])[0],
            AGORA - rnd.randint(0, 9 * 86400)] for i in range(3000)]
    plan = [{"data": time.strftime("%d/%m/%Y", time.localtime(AGORA - d * 86400)), "hora": h, "planejadoGeral": 1100}
            for d in range(10) for h in range(24)]
    return {"fetchedAt": ISO_AGORA, "dests": dests, "tipos": tipos, "list": lst}, {"list": plan}


def fifo_mock():
    grupos, areas = ["Zona Sacas", "81+ (Híbrida)", "0 - 50 (volumoso)"], ["RUA-INB-%02d" % i for i in range(12)]
    ops = [["Ops%03d" % i, "OPERADOR EXEMPLO %d" % i] for i in range(10)]
    hoje = time.strftime("%Y-%m-%d", time.localtime(AGORA))
    unidades = []
    for uid in ["PE4", "PE2"]:
        rows = []
        for i in range(2500):
            dia = time.strftime("%Y-%m-%d", time.localtime(AGORA - rnd.randint(0, 20) * 86400))
            h = rnd.randint(0, 23)
            turno = "T1" if 6 <= h < 14 else "T2" if 14 <= h < 22 else "T3"
            rows.append([dia, turno, 1 if rnd.random() < 0.015 else 0, h, rnd.randint(0, 2), rnd.randint(0, 11),
                         rnd.randint(0, 9), rnd.randint(0, 9), rnd.randint(5, 600), "TO%07d" % i, i, i,
                         "%s %02d:%02d" % (dia, h, rnd.randint(0, 59))])
        hc = [[o[0], o[1], rnd.choice(["T1", "T2", "T3"]), "ATIVO", "Operador", "Inbound", "LÍDER EXEMPLO"] for o in ops]
        unidades.append({"id": uid, "nome": uid, "rows": rows, "grupos": grupos, "areas": areas, "ops": ops, "hc": hc})
    return {"geradoEm": time.strftime("%d/%m/%Y %H:%M", time.localtime(AGORA)), "meta": {"bom": 1, "medio": 2},
            "unidades": unidades, "_hoje": hoje}


# ── o que fotografar em cada dashboard ─────────────────────────────────────
def casos():
    ruas = ruas_stage_out()
    cage = {"byDest": {d[0]: {"sacas": rnd.randint(5, 60), "pedidos": 0} for d in DESTINOS}, "total": 300}
    stage_in_stage, stage_in_rep = stage_in()
    sacas_hist, sacas_plan = sacas()
    return {
        "01-stage-out": dict(pasta="pe2", vars={"unidade": "PE2"},
                             dados={"getStageOut": {"fetchedAt": ISO_AGORA, "list": ruas}, "getCageData": cage,
                                    "getJustificativas": []},
                             fotos=[("preview-dashboard.png", "document.querySelector('.dest-header')?.click()"),
                                    ("preview-report.png", "showTab('report')")]),
        "02-stage-in": dict(pasta="pe2", vars={"unidade": "PE2", "appUrl": json.dumps("https://exemplo/exec")},
                            dados={"getStageIn": stage_in_stage, "getReportData": stage_in_rep},
                            fotos=[("preview-dashboard.png", ""),
                                   ("preview-operacional.png", "document.querySelector('[data-zone=\"__op__\"]')?.click()")]),
        "03-queue-list": dict(pasta="pe2", vars={"unidade": "PE2"}, dados={"getQueueData": queue()},
                              fotos=[("preview-dashboard.png", "")]),
        "04-tos-packed": dict(pasta="pe2", vars={"unidade": "PE2"},
                              dados={"getTosPacked": {"fetchedAt": ISO_AGORA, "list": tos_packed()},
                                     "getStageOut": {"fetchedAt": ISO_AGORA, "list": ruas}},
                              fotos=[("preview-dashboard.png", "document.querySelector('.dest-header')?.click()"),
                                     ("preview-report.png", "document.getElementById('tabReport').click()")]),
        "05-tos-packing": dict(pasta="pe2", vars={"unidade": "PE2"},
                               dados={"getTosPacking": {"fetchedAt": ISO_AGORA,
                                                        "list": tos_packed("Packing", 50, 12)}},
                               fotos=[("preview-dashboard.png", "document.querySelector('.dest-header')?.click()"),
                                      ("preview-report.png", "switchTab('report')")]),
        "06-produtividade-sacas": dict(pasta="pe2", vars={"unidade": "PE2",
                                                          "stationLabel": json.dumps("SoC_PE_Exemplo")},
                                       dados={"getSacasHistory": sacas_hist, "getSacasPlanejamento": sacas_plan},
                                       fotos=[("preview-dashboard.png", "")]),
        "07-fifo-stage-in": dict(pasta="app", vars={}, mock=fifo_mock(), fotos=[("preview-dashboard.png", "")]),
    }


def fotografar(page, html_path, destino, acao):
    page.goto("file:///" + html_path.replace("\\", "/"))
    page.wait_for_timeout(2500)
    if acao:
        page.evaluate(acao)
        page.wait_for_timeout(1500)
    page.evaluate("window.scrollTo(0, 0)")
    altura = min(page.evaluate("document.documentElement.scrollHeight"), 2600)
    page.screenshot(path=destino, full_page=True, clip={"x": 0, "y": 0, "width": 1440, "height": altura})


def main():
    so = sys.argv[1] if len(sys.argv) > 1 else None
    tmp = os.path.join(RAIZ, "tools", "_tmp_previews")
    os.makedirs(tmp, exist_ok=True)
    with sync_playwright() as p:
        nav = p.chromium.launch()
        page = nav.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        for dash, c in casos().items():
            if so and dash != so:
                continue
            pasta = os.path.join(RAIZ, "dashboards", dash, c["pasta"])
            html = montar(pasta, c["vars"])
            injeta = (("<script>window.MOCK = %s;</script>" % json.dumps(c["mock"], ensure_ascii=False))
                      if "mock" in c else stub(c["dados"]))
            html = re.sub(r"(<head[^>]*>)", r"\1" + injeta.replace("\\", "\\\\"), html, count=1)
            arq = os.path.join(tmp, dash + ".html")
            open(arq, "w", encoding="utf-8").write(html)
            for nome, acao in c["fotos"]:
                destino = os.path.join(RAIZ, "dashboards", dash, nome)
                fotografar(page, arq, destino, acao)
                print(dash, "->", nome)
        nav.close()
    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)


if __name__ == "__main__":
    main()
