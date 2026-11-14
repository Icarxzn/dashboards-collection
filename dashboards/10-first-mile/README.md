# 10 · First Mile · PE2

Acompanhamento dos veículos do **First Mile**: quem está em **Pickup** (coletou e ainda não chegou ao SOC),
quem está na **fila** do SOC aguardando handover e o que já foi **concluído**. Mostra fluxo, gargalo,
concentração de chegadas por hora e as tabelas de cada etapa.

| | PE2 |
|---|---|
| Web app | [abrir](https://script.google.com/a/macros/shopee.com/s/AKfycbzOQnXVh5npm9CYyh8Rv6sFddA3KndsgTCDJFNiYnEOxe7Z5rqiHeu_NHjoXf_PYvsh/exec) |
| Planilha | [[VIS] - FirstMille](https://docs.google.com/spreadsheets/d/1m7EKgvfEBdGiCW032sZKB6mf2QqIpYJfK-aDlo_E5zc/edit) |
| Projeto Apps Script | [editor](https://script.google.com/home/projects/1o2s9fKcUH4v__wRWT0D35JdU8TTymFuW9h1GyGeRf0hRBxqYggvG2q1g/edit) |

## Estrutura dos arquivos

```
10-first-mile/
└── app/
    ├── Code.js          servidor: lê Inbound Queue List e FMTrip (e Recebimento), monta a fila/pickup, cache, config
    ├── Index.html       topo (cartão "First Mile · PE2"), abas Visão Geral / Concluídas, gaveta de detalhe, modal de config
    ├── Styles.html      CSS (no fim, a "pele" no estilo do painel Produtividade por Turno)
    ├── App.html         toda a lógica da tela (cálculos, tabelas, gráfico de concentração)
    ├── appsscript.json  manifesto (web app DOMAIN / USER_DEPLOYING)
    └── .clasp.json      scriptId
```

## Visão Geral (ordem das seções)

0. **Forecast do dia** — aba `Forcast` (uma linha por trip, agrupada por `trip_ctime`), com seletor de
   **Hoje até D-7**. Dia cujas trips já saíram da FMTrip mostra um aviso em vez de pacotes zerados. Pacotes vêm da FMTrip pelo `trip_id`: previsto = `pedidos`,
   coletado = `pacotes_coletados`, descarregado = `pacotes_recebidos`; descarga finalizada = `handedover_time`
   preenchido. Clicar em "Veículos p/ descarga" abre a lista dos veículos do dia.
1. **Cards principais** — clicáveis: Veículos/Orders na fila → tabela da Fila; Pickup/Orders em pickup →
   tabela do Pickup; **Acima do SLA** → filtra as duas tabelas (aviso com "Mostrar todos"); **Maior aging** →
   abre o detalhe do veículo.
2. **Fluxo operacional** — Pickup → Coleta → Deslocamento → Chegou ao SOC → Fila → Handover.
3. **Onde está o gargalo?** — diagnóstico, aging médio de transporte e de doca, críticos.
4. **Concentração de veículos por horário** — veículos que **chegaram ao SOC** por hora do dia operacional
   (desde 06:00; chegada da aba Recebimento, ou Handover se não houver) + parte tracejada com os que ainda estão
   em **pickup**, pela `chegada_prevista` da FMTrip. Faixas: **≤ 2** confortável · **3–4** no limite ·
   **≥ 5** acima da capacidade (linha tracejada em 4). Ajuste em `CONC = { ok: 2, limite: 4 }` no `App.html`.
5. **Veículos First Mile** — uma lista só (fila do SOC + coleta). A coluna **Etapa** diz onde cada veículo
   está: Descarregando · Doca N / Em fila · aguardando doca / Sem chegada / Em trânsito p/ SOC / Em coleta.
   Sem barra de filtros na Visão Geral; clique na linha abre o detalhe.

O **Fluxo operacional** segue o dia escolhido no Forecast: Handover = descargas finalizadas do Forecast daquele
dia; em dias anteriores as etapas em andamento contam só os veículos coletados naquele dia.

A aba **Concluídas** mantém a barra de filtros completa. As abas Fila/Pickup existem no código, mas ficam
escondidas (o conteúdo está na Visão Geral).

## Manutenção

- Testar sem afetar o time: `clasp push` atualiza só a versão de teste (`/dev`); publicar com
  `clasp update-deployment AKfycbzOQnXVh5npm9CYyh8Rv6sFddA3KndsgTCDJFNiYnEOxe7Z5rqiHeu_NHjoXf_PYvsh`.
- SLA, limites de aging e mapeamento de colunas ficam no modal de configurações (⚙) do próprio painel.
