# Report FIFO Stage IN → Seatalk

Script Python que monta o **report diário de quebra de FIFO do Stage IN (SOC-PE4)** e envia ao grupo do
Seatalk: uma mensagem de texto (TOs respected / not respected, target, fechamento, % por turno, lista das
TOs quebradas, menções aos responsáveis) e uma **imagem** com os indicadores e o mapa de calor da semana.

> O README original do projeto foi mantido em [`README.original.md`](README.original.md).

## Estrutura dos arquivos

```
report-fifo-seatalk/
├── bootseatalk.py        script: lê a planilha, calcula, gera texto + imagem e envia
├── requirements.txt      gspread, google-auth, requests, playwright, tzdata
├── README.original.md    documentação anterior
└── dados/                CSV das abas da planilha (headcount mascarado) + _resumo.csv
```

## Fonte de dados

Planilha [Report FIFO Stage IN PE4](https://docs.google.com/spreadsheets/d/19ejea0roWLSroIskVg0a2Pr0dXcTjsm0zUxOwL8SQkI/edit)
(lida com a conta de serviço, só leitura):

| Aba | Uso |
|---|---|
| **Consulta** (`A:N`) | base de TOs: data (A), TO (B), `fifo_status` (G), turno (H), `operator_stage_out` (N) |
| **Filtro** (`B6`) | target de % de quebra (se vazio, 1,0%) |
| **Headcount** (`A:O`) | OPS ID (A), Status (K), Turno (O) — para achar o turno de quem tirou do stage |

## Regras de negócio

- **Dia de referência:** ontem (D-1); se a base ainda não tem ontem, o último dia disponível.
- **Turno da TO** = turno, no headcount, do **operador do stage-out** (ATIVO tem prioridade); fora do HC,
  vale o turno da coluna H.
- **Quebra** = `fifo_status` contém "not". **% = quebras ÷ TOs** (por turno e no dia).
- **Semana:** segunda a domingo, sem atravessar a virada do mês.
- **Menções:** se algum turno passa do target, marca os responsáveis do turno (`MENCOES_TURNO`) e o FYI
  (`MENCOES_FYI`). Lista no máximo 10 TOs no texto.

## Dependências e configuração

| Onde | O quê |
|---|---|
| Arquivo `credencial.json` na pasta (ou variável `GOOGLE_CREDENTIALS` com o JSON) | conta de serviço com leitura na planilha |
| Variável de ambiente `SEATALK_WEBHOOK_URL` | webhook do grupo no Seatalk (**não fica no código**) |
| `bootseatalk.py` | `SPREADSHEET_ID`, `TARGET_PADRAO`, `MENCOES_TURNO`, `MENCOES_FYI`, `LINK_RELATORIO` |

## Como executar

```bash
cd report-fifo-seatalk
```

```bash
pip install -r requirements.txt
```

```bash
playwright install chromium
```

Prévia sem enviar nada (gera `preview_fifo.png`):

```bash
DRY_RUN=1 python bootseatalk.py
```

Envio real (precisa do webhook):

```bash
SEATALK_WEBHOOK_URL="https://openapi.seatalk.io/webhook/group/..." python bootseatalk.py
```

## Manutenção

- **Responsáveis por turno** → `MENCOES_TURNO`.
- O envio é feito **uma vez só** (sem nova tentativa) para não duplicar mensagem no grupo.
