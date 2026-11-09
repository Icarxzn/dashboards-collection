"""
Exporta cada aba de cada planilha do catálogo para CSV (UTF-8 com BOM, separador vírgula),
preservando cabeçalho e valores exatamente como aparecem na planilha (valores formatados).

Destino:  dashboards/<dash>/dados/<unidade>/<aba>.csv   (+ _resumo.csv com linhas/colunas por aba)
          report-fifo-seatalk/dados/<aba>.csv

Uso:
    python tools/exportar_planilhas.py --cred "C:/caminho/credencial.json"
    python tools/exportar_planilhas.py --cred ... --so 04-tos-packed      (só um dashboard)

A credencial é a conta de serviço do projeto (botdash@dashboard-483113.iam.gserviceaccount.com);
ela precisa ter acesso (leitor) a cada planilha. Não commite a credencial.
"""
import argparse
import csv
import os
import re
import sys
import time

import gspread
from google.oauth2.service_account import Credentials

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from catalogo import PROJETOS, EXTRAS  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


# Colunas com dado pessoal sensível (abas de headcount): a coluna fica no CSV, mas os valores
# viram "***" — o CSV serve de referência de estrutura, não de cadastro de pessoas.
SENSIVEIS = {"cpf", "e-mail", "email", "telefone", "celular", "data nascimento", "genero", "rg", "endereco"}


def norm(h):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", h.strip().lower()) if unicodedata.category(c) != "Mn")


def mascarar(valores):
    if not valores:
        return 0
    cols = [i for i, h in enumerate(valores[0]) if norm(h) in SENSIVEIS]
    for linha in valores[1:]:
        for i in cols:
            if i < len(linha) and linha[i].strip():
                linha[i] = "***"
    return len(cols)


def nome_arquivo(aba):
    """'Inbound Queue List]' -> 'Inbound_Queue_List.csv'"""
    s = re.sub(r"[^\w\- ]+", "", aba, flags=re.UNICODE).strip()
    return re.sub(r"\s+", "_", s) + ".csv"


def exportar(gc, sheet_id, destino):
    os.makedirs(destino, exist_ok=True)
    ss = gc.open_by_key(sheet_id)
    resumo = []
    for ws in ss.worksheets():
        for tentativa in range(3):
            try:
                valores = ws.get_all_values()
                break
            except gspread.exceptions.APIError as e:  # cota por minuto: espera e tenta de novo
                if tentativa == 2:
                    raise
                print(f"    cota da API, aguardando ({e})")
                time.sleep(30)
        # tira linhas totalmente vazias do fim
        while valores and not any(c.strip() for c in valores[-1]):
            valores.pop()
        if mascarar(valores):
            print(f"    {ws.title!r}: colunas pessoais mascaradas")
        arq = nome_arquivo(ws.title)
        with open(os.path.join(destino, arq), "w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f).writerows(valores)
        linhas = max(len(valores) - 1, 0)
        colunas = len(valores[0]) if valores else 0
        resumo.append([ws.title, arq, linhas, colunas, " | ".join(valores[0]) if valores else ""])
        print(f"    {ws.title!r}: {linhas} linhas x {colunas} colunas -> {arq}")
    with open(os.path.join(destino, "_resumo.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["aba", "arquivo", "linhas_de_dados", "colunas", "cabecalho"])
        w.writerows(resumo)
    return ss.title, resumo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cred", required=True, help="caminho da credencial.json da conta de serviço")
    ap.add_argument("--so", help="exporta só este dashboard (ex.: 04-tos-packed)")
    args = ap.parse_args()

    gc = gspread.authorize(Credentials.from_service_account_file(args.cred, scopes=SCOPES))
    alvos = [(p["sheet_id"], os.path.join(RAIZ, "dashboards", p["dash"], "dados", p["unidade"]), p["dash"])
             for p in PROJETOS]
    alvos += [(e["sheet_id"], os.path.join(RAIZ, e["pasta"], "dados"), e["pasta"]) for e in EXTRAS]
    if args.so:
        alvos = [a for a in alvos if a[2] == args.so]

    falhas = []
    for sheet_id, destino, dash in alvos:
        print(f"{dash} -> {os.path.relpath(destino, RAIZ)}")
        try:
            for tentativa in range(3):
                try:
                    titulo, _ = exportar(gc, sheet_id, destino)
                    break
                except gspread.exceptions.APIError as e:  # 429 = cota de 60 leituras/min: espera a janela virar
                    if tentativa == 2 or "429" not in str(e):
                        raise
                    print("  cota da API esgotada, aguardando 65s...")
                    time.sleep(65)
            print(f"  ok: {titulo}")
        except Exception as e:  # sem acesso, planilha apagada etc.: registra e segue
            print(f"  FALHOU: {e}")
            falhas.append((dash, sheet_id, str(e)))
    if falhas:
        print("\nFalhas:")
        for f in falhas:
            print("  ", *f)
        sys.exit(1)


if __name__ == "__main__":
    main()
