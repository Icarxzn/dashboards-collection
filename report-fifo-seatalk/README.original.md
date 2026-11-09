# 📊 Report FIFO - Stage In

Automação de relatório diário de quebra de FIFO (First In, First Out) no processo de Stage In, com envio automático para o Seatalk.

## 🎯 Funcionalidades

- ✅ Busca automática de dados do Google Sheets
- ✅ Geração de relatório formatado com:
  - Data do relatório
  - TO's Respeitados e Não Respeitados
  - Target e Fechamento com indicadores visuais
  - Breakdown por turno (T1, T2, T3)
  - Lista de TO's do turno ofensor
  - Link para relatório completo
- ✅ Envio automático para Seatalk via webhook
- ✅ Execução automática diária às 8h via GitHub Actions

## 📋 Estrutura do Projeto

```
Report-FIFO-STAGE-IN/
├── .github/
│   └── workflows/
│       └── daily-report.yml      # GitHub Action para automação
├── bootseatalk.py                # Script principal
├── credencial.json               # Credenciais Google (não versionado)
├── requirements.txt              # Dependências Python
├── .gitignore                    # Arquivos ignorados pelo Git
├── README.md                     # Este arquivo
└── SETUP_GITHUB_ACTION.md        # Guia de configuração do GitHub Action
```

## 🚀 Como usar

### Execução Local

1. **Instalar dependências:**
```bash
pip install -r requirements.txt
```

2. **Configurar credenciais:**
   - Coloque o arquivo `credencial.json` na raiz do projeto
   - Este arquivo contém as credenciais de acesso ao Google Sheets

3. **Executar o script:**
```bash
python bootseatalk.py
```

### Automação via GitHub Actions

Para configurar a execução automática diária, siga o guia completo em [SETUP_GITHUB_ACTION.md](SETUP_GITHUB_ACTION.md).

**Resumo:**
1. Criar repositório no GitHub
2. Adicionar `GOOGLE_CREDENTIALS` como secret
3. Push do código
4. O relatório será enviado automaticamente às 8h todos os dias

## 🔧 Configuração

### Variáveis no código (`bootseatalk.py`):

```python
SPREADSHEET_ID = "1WcrqSIEuXBUXxxOI6VklIF1x_Kl1OXPi18TEj1cs_aQ"  # ID da planilha
SHEET_NAME = "Filtro"                                              # Nome da aba
WEBHOOK_URL = "https://openapi.seatalk.io/webhook/group/..."      # Webhook Seatalk
CRED_FILE = "credencial.json"                                      # Arquivo de credenciais
```

### Estrutura da Planilha:

| Célula | Conteúdo |
|--------|----------|
| B1 | Data do relatório |
| B2 | T1 (%) |
| B3 | T2 (%) |
| B4 | T3 (%) |
| B5 | Total/Fechamento (%) |
| B6 | Target (%) |
| D2 | TO Respected (quantidade) |
| E2 | TO Not Respected (quantidade) |
| A9+ | Lista de turnos e TO's |

## 📊 Exemplo de Relatório

```
📊 Quebra de FIFO - Stage in

📅 Data: 24/05/2026
✔️ TO Respected: 503
✖️ TO Not Respected: 5

🎯 Target: 1,00%
✔️ Fechamento: 0,99%

T1 - 0,00%
T2 - 0,00%
T3 - 3,05%

Turno    TO´S Not Respected
────────────────────
T3       TO20260517S4FCN
T3       TO20260522TFYBP
T3       TO20260519SB6LU

📊 Acesse o relatório completo:
https://docs.google.com/spreadsheets/d/...
```

## 🔒 Segurança

- ✅ Credenciais protegidas via `.gitignore`
- ✅ Uso de GitHub Secrets para automação
- ✅ Arquivo `credencial.json` nunca é commitado
- ✅ Credenciais temporárias no GitHub Actions (deletadas após execução)

## 🛠️ Tecnologias

- **Python 3.10+**
- **gspread** - Integração com Google Sheets
- **google-auth** - Autenticação Google
- **requests** - Requisições HTTP para webhook
- **GitHub Actions** - Automação de execução

## 📝 Dependências

```
gspread==5.12.0
google-auth==2.23.4
requests==2.31.0
```

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto é de uso interno.

## 📞 Suporte

Para dúvidas ou problemas:
- Verifique os logs no GitHub Actions
- Consulte o arquivo [SETUP_GITHUB_ACTION.md](SETUP_GITHUB_ACTION.md)
- Revise a configuração das credenciais e webhook