# 09 · Produtividade por Turno

Painel "Control Tower" da produtividade por **turno** e por **hora**: produção real × meta, atingimento,
cartões dos turnos T1/T2/T3, gráfico hora a hora, evolução dos últimos 14 dias e produtividade individual
(top 10, abaixo da média da equipe, tabela com busca e exportação CSV). Visual replicado do painel PE4 que
serviu de modelo.

| | PE2 | PE4 (modelo, outro projeto) |
|---|---|---|
| Web app | [abrir](https://script.google.com/a/macros/shopee.com/s/AKfycbxwkHQWKlW_egNvJtSnmAiAFgxO7FGppeSiTsB0_WdE2tFnbOeUioqq-lEySjvkm_Lg/exec) | [abrir](https://script.google.com/a/macros/shopee.com/s/AKfycbx8Zqg2gy4GGnhi1gdVeEuXBFbqHsQiFPJS33xHOMkxEIQdWsz01fdN3oOiWb-iCj20Ww/exec) |
| Planilha | [Produtividade PE2](https://docs.google.com/spreadsheets/d/15zDTkfz-01gZgefZz9aukXbXnXM2WDbF3zA1iWPXGOE/edit) | Produtividade PE4 |
| Projeto Apps Script | [editor](https://script.google.com/home/projects/1yOxXxJQbJX9VEdKsErbfz3VB1q4HFnKDts2iNqN9f0TEQRzjVgkBKxZ-/edit) | [editor](https://script.google.com/home/projects/1-7__VL2YM3Zxgk07uLUZQqg6GOb7tSVJVONrGRnqj27pTFXnSN4vYcE_/edit) |

> O código do PE4 **não** está neste repositório (é o projeto do modelo, mantido à parte; aqui só foi trocado o
> título para "· PE4"). A pasta `pe2/` é o painel PE2.

## Estrutura dos arquivos

```
09-produtividade-turno/
└── pe2/
    ├── Code.gs          servidor: lê Consulta e Plano, grava o histórico na aba _LEDGER_PROD, cache
    ├── Index.html       layout (topo, filtros, panorama, turnos, hora a hora, evolução, individual)
    ├── Styles.html      CSS (modo escuro e claro)
    ├── JavaScript.html  cálculos e gráficos (Chart.js 4.4.1)
    ├── appsscript.json  manifesto (America/Recife, web app DOMAIN / USER_DEPLOYING)
    └── .clasp.json      scriptId
```

## Fontes de dados (planilha Produtividade PE2)

| Aba | Uso | Campos |
|---|---|---|
| **Consulta** | produção por colaborador e hora; janela de ~12 h que desliza | `operator` (`[OpsID]NOME`), uma coluna por hora (`HH:00`, da mais recente para a mais antiga), carimbo `Atualizado:` |
| **Plano** | meta por data, hora e esteira | `Data` (dd/MM/yyyy), `Hora` (0–23), `Tipo processo`, `capacidade`, `Turno` |
| **_LEDGER_PROD** | histórico mantido pelo script (não editar à mão) | `dia` (dia operacional), `ops_id`, `nome`, `h0`…`h23` |

Função do servidor: `getDashboardData(force)` →
`{cfg:{refreshSec}, stamp, generatedAt, ledger, prod:{dia:[{id,n,h:{hora:peças}}]}, plan:{dia:{hora:meta}}}`.

## Atualização e histórico

- Gatilho `aquecerCache` a cada **1 min**: lê a Consulta, grava no `_LEDGER_PROD` (a última leitura de cada
  hora vale) e deixa o JSON no cache. A página consulta a cada **60 s**; o botão ↻ força a releitura.
- A data de cada coluna da Consulta é deduzida a partir do carimbo (a janela pode atravessar a meia-noite).
- O histórico guarda **35 dias** (`HIST_DIAS`) e apaga os mais antigos.

## Regras de negócio

- **Turnos:** T1 06:00–13:59 · T2 14:00–21:59 · T3 22:00–05:59. O T3 pertence ao dia operacional em que começou.
- **Meta da hora** = soma da `capacidade` de todas as esteiras (00h–05h usam a data do dia operacional).
- **Atingimento** = real ÷ meta somando só as **horas já fechadas** que têm meta; a hora em curso aparece no
  gráfico mas não entra na conta. Cores: ≥ 100% verde · 85–99% âmbar · < 85% vermelho.
- **Média por hora** = total do colaborador ÷ horas em que produziu. **Abaixo da média** = ≥ 2 h ativas e
  média < 70% da média da equipe.

## Dependências e configuração

- `Code.gs → CONFIG`: `SHEET_ID`, `UNIDADE`, `ABA_REAL`, `ABA_META`, `ABA_HIST`, `CACHE_SEG`, `REFRESH_SEG`, `HIST_DIAS`.
- Externas (CDN): Chart.js 4.4.1, Google Fonts (Inter, Fira Code).
- **PE4 neste padrão:** copie `pe2/`, troque `SHEET_ID`/`UNIDADE` e os nomes das abas no `CONFIG`, crie o projeto
  e a implantação (ver README principal).
