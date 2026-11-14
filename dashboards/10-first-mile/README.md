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
   descarregado = `pacotes_recebidos` (base da aderência), coletado = `pacotes_coletados`; descarga finalizada = `handedover_time`
   preenchido. Clicar em "Veículos p/ descarga" abre a lista dos veículos do dia.
1. **Cards principais** — clicáveis: Veículos/Orders na fila → tabela da Fila; Pickup/Orders em pickup →
   tabela do Pickup; **Acima do SLA** → filtra as duas tabelas (aviso com "Mostrar todos"); **Maior aging** →
   abre o detalhe do veículo.
2. **Fluxo operacional** — cada veículo conta em **uma etapa só** (função `etapa()` no `App.html`, a mesma da
   coluna Etapa da tabela):
   - **Pickup**: ainda coletando (`business_status` 6 na FMTrip ou `sellers_aguardando` > 0);
   - **Coleta realizada**: coleta concluída há menos de `ETAPA_SAIDA_MIN` (15 min);
   - **Em deslocamento**: coleta concluída há mais tempo, sem chegada ao SOC;
   - **Chegou ao SOC**: chegou, mas ainda não entrou na fila do recebimento;
   - **Fila**: na fila, sem doca;
   - **Recebendo**: em doca;
   - **Handover**: descargas finalizadas do Forecast do dia.
3. **Onde está o gargalo?** — diagnóstico, aging médio de transporte e de doca, críticos.
4. **Concentração de veículos por horário** — veículos que **chegaram ao SOC** por hora do dia operacional
   (desde 06:00; chegada da aba Recebimento, ou Handover se não houver) + parte tracejada com os que ainda estão
   em **pickup**, pela `chegada_prevista` da FMTrip. Faixas: **≤ 2** confortável · **3–4** no limite ·
   **≥ 5** acima da capacidade (linha tracejada em 4). Ajuste em `CONC = { ok: 2, limite: 4 }` no `App.html`.
5. **Veículos First Mile** — uma lista só (fila do SOC + coleta). A coluna **Etapa** diz onde cada veículo
   está, nas mesmas etapas do Fluxo (Recebendo · Doca N / Fila / Chegou ao SOC / Em deslocamento /
   Coleta realizada / Pickup · coletando).
   No cabeçalho: **Todos / Em fila / Em coleta / Concluídos** (trips do Forecast do dia escolhido já descarregadas — mesmo número de "Descarga finalizada") e
   busca por motorista, placa ou trip. Clique na linha abre o detalhe.

O **Fluxo operacional** segue o dia escolhido no Forecast: Handover = descargas finalizadas do Forecast daquele
dia; em dias anteriores as etapas em andamento contam só os veículos coletados naquele dia.

A aba **Concluídas** mantém a barra de filtros completa, com **Dia** (Hoje até D-7, pelo dia do handover) e
**Trips: Só do Forecast** (trips da aba Forcast daquele dia). Com um dia escolhido aparece o resumo do Forecast
(programadas, finalizadas, pendentes, descarregado × previsto, aderência) e os cards seguem os filtros.
No Pickup, o status "Em rota" fica em vermelho (veículo ainda não chegou ao SOC). As abas Fila/Pickup existem no código, mas ficam
escondidas (o conteúdo está na Visão Geral).

## Manutenção

- Testar sem afetar o time: `clasp push` atualiza só a versão de teste (`/dev`); publicar com
  `clasp update-deployment AKfycbzOQnXVh5npm9CYyh8Rv6sFddA3KndsgTCDJFNiYnEOxe7Z5rqiHeu_NHjoXf_PYvsh`.
- SLA, limites de aging e mapeamento de colunas ficam no modal de configurações (⚙) do próprio painel.
