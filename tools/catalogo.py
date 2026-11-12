"""
Catálogo único dos dashboards: planilha, projeto Apps Script e web app de cada um.
Usado por exportar_planilhas.py e gerar_previews.py — ao criar/mover um dashboard, atualize aqui.
"""

# pasta (relativa à raiz do repositório) -> metadados
PROJETOS = [
    {"dash": "01-stage-out", "unidade": "pe2", "nome": "Staging Area Dashboard (Stage OUT)",
     "sheet_id": "1YWwbGW_Nn7GzIFDtUxPqKixpKDEoyfCwzHdLmviGUFY", "sheet_nome": "Stage OUT - PE2",
     "script_id": "1GZfijTr7q3rEExAtjw1tETqtRynImNyuT-9zFYoDozamBLlgdbKsO-wD",
     "deploy_id": "AKfycbzHHMx-OIPcZVzcopNUia59oZoNFAvdbZPulURMPOKkyV53SYpcqkUYpsTOp3DIa25LuA"},
    {"dash": "01-stage-out", "unidade": "pe4", "nome": "Staging Area Dashboard (Stage OUT)",
     "sheet_id": "1iDoTjbpZ1pZjJSg2zLNiQhROvDWJ_WGD1stWLAD9364", "sheet_nome": "Stage OUT - PE4",
     "script_id": "1GnrUXP1e0u66jjapUtMlm1DTh-Q2ZmzugAgwal84jXPBOHwmGajQflrf",
     "deploy_id": "AKfycbyBGhseVjSCIGpDwTUxmjNc6aThRaxSZhIjOIptAD01fTdodydz8oCuMggxQbsh-NLIRg"},
    {"dash": "02-stage-in", "unidade": "pe2", "nome": "Inbound Staging Area (Stage IN)",
     "sheet_id": "1eYzK7P5vU5ss2e8OapEzOUPGECXMOl4KKee6WTifHrQ", "sheet_nome": "Stage IN PE2",
     "script_id": "1w_M3VcLbziJy1G43zxT-8_Dybr6_FHoQlnodMT72-Z4fd1xE2enIzJp9",
     "deploy_id": "AKfycbzJaq4X3EfyNhmFu_bMYBWdefIbQz1lzHwyZ-DPsFFt2vKfuHK8nF8WukuBM9Dvh0qm"},
    {"dash": "02-stage-in", "unidade": "pe4", "nome": "Inbound Staging Area (Stage IN)",
     "sheet_id": "1toQyHNQKDoj9_JhJVVUMm3PS-XkaS5VM_3zFY7tKHH0", "sheet_nome": "Stage IN PE4",
     "script_id": "1TabT54rvg99wFNV9S8RUnqcEi1VMH6ROne7bASSza02DA2ySWlzirvbB",
     "deploy_id": "AKfycbz1KeC2LE6OOVV6VOw61Rmo-wwtYhBq1TAcuH3EgcQ9eCBktNIge2H01S6-lDF68-f7aw"},
    {"dash": "03-queue-list", "unidade": "pe2", "nome": "Queue List · Inbound",
     "sheet_id": "1sDr6qxgBAcUIrgZ6S9t5O21dxDAHPFfWhbUoQEaS4OQ", "sheet_nome": "Queue list PE2",
     "script_id": "1Cc6_HjjGL2_fIfymh6YSq2m4PIImbagfs1ajIM37uLyjkgZWw61KkmK1",
     "deploy_id": "AKfycbyd5D6sA2tuRHzoTgp4pRwTXVSqK337qHs3zOdn41jCNWntgBTG3M6AtU6QK-7Hs71wYg"},
    {"dash": "03-queue-list", "unidade": "pe4", "nome": "Queue List · Inbound",
     "sheet_id": "1EKYXxW3rbpTsI3UQ3mlMRc5ZP7QDC9Q-ksc04rrIEIY", "sheet_nome": "Queue list PE4",
     "script_id": "1CE-kabqeiGjM-XO71Vgqz_Bchl4IzmHMzQBzRgbpjBLpcT3k8qDVqxn3",
     "deploy_id": "AKfycbyo55xuNfibeRthH5SfgoKRE65Mo4RaOxmg3OOeq52Sq9J9_WNajxA8q1293DRpnyn_Bw"},
    {"dash": "04-tos-packed", "unidade": "pe2", "nome": "TO's Packed Dashboard",
     "sheet_id": "1PtjTH54K4SgdoghDifedn-SIQurw3ui1tJOi8RAJM5c", "sheet_nome": "Packed PE2",
     "script_id": "1JJEh6sXbh0QbPpPiMyQIxb7jrB33Hnn67ZGRAZytlVCfdbd8JIm1gNbZ",
     "deploy_id": "AKfycbyEuVftFQvcd66LW3A3MBe0sETox3kmT4LUnyfAtG5n6J81TwD3tGPt3fo1BSlhwQM"},
    {"dash": "04-tos-packed", "unidade": "pe4", "nome": "TO's Packed Dashboard",
     "sheet_id": "14fV7S7EJL5i65ii1uziVxqlZuv9O4nDDwfiy7N31V5A", "sheet_nome": "Packed PE4",
     "script_id": "1NGwtsrhpWHXd-zM3-yRlugjHz4RegOi0ajpS6TZrnYEcxFX43NSiWFCk",
     "deploy_id": "AKfycbxDo43TOdwQhvc6_U1hO9Nso8KbfyQVEfWcQ4_Sv2FNboVGBeyzquuD0rDNpIjyTFC-"},
    {"dash": "05-tos-packing", "unidade": "pe2", "nome": "TO's Packing Dashboard",
     "sheet_id": "1kYFVON190UYh4XiDnR0923w1tsp8E43lVBqtCiZTZzs", "sheet_nome": "Packing PE2",
     "script_id": "1UQgJ9L2k5iV-U2g1UOkOViqsDf_lU0pHOROxtujG0lMYt4oBcOuuguDP",
     "deploy_id": "AKfycby7yXnsVuZR5pC7lXPk6q6L_bVb4OoqpM7if0fdWOWlZUBP9ZTs2tbUNURNQm9YahEB"},
    {"dash": "05-tos-packing", "unidade": "pe4", "nome": "TO's Packing Dashboard",
     "sheet_id": "13aFCuxkrZf-45mc_lgfsQA2KjlBkhIDdYoolkfHpsY8", "sheet_nome": "Packing PE4",
     "script_id": "1kYkuLc6drl6j2ydI-VRoqKlApN0aALUkP1eqEgEHKMn4rPmfDo2HhPHg",
     "deploy_id": "AKfycbwHppGkkWEuLaeOk5YU2yBmzp-_T6kC2_WEhRL37A7m4IZ_Sah3Rq2mq0QY1QerCyNY"},
    {"dash": "06-produtividade-sacas", "unidade": "pe2", "nome": "Produtividade de Sacas",
     "sheet_id": "1d73wxdpuN4pm_IvomoB70WoPn8X4nZ8O0Kf2gSexz-0", "sheet_nome": "Saca management PE2",
     "script_id": "1SPJlLzXllCWkw_NZ3XyLFkVYSpzFwSp60LbaNnxqz4RVF5whJ_XUdG6U",
     "deploy_id": "AKfycbwCff3M6jVGI3DbiP3Ce-uwTDNkYScUG_zuOYxaOeRrRo_Ywn47Zutjm0PufWDgFBPo"},
    {"dash": "06-produtividade-sacas", "unidade": "pe4", "nome": "Produtividade de Sacas",
     "sheet_id": "1FCivD51mADNhBA1J-eZDqdnEHYosf2CP9yQzP0lx3r0", "sheet_nome": "Saca management PE4",
     "script_id": "1Lg6bbTkHHNUrKv1F-iXtVQ1WDOEi1Jrm6nKPzQNm2NyyCja24f3TT0lF",
     "deploy_id": "AKfycbydJnPkhf1EL4ZkLq8jDkx-ZJYci8E9iR72r96R08Q0DwwKsgHYIzljEtefBVTJQUhT"},
    {"dash": "07-fifo-stage-in", "unidade": "app", "nome": "Painel FIFO Stage IN (PE2 + PE4)",
     "sheet_id": "1fB_CvpryMOy0ZhMLqW1LgJNhkvIKiZqn7k_fstKRJCU", "sheet_nome": "Stage IN - Performace",
     "script_id": "1K3DwOj1bT43k0y4OzUkkVJTmVC_oYXoEazkJcEUC1VgnB7ld0OjD_ybg",
     "deploy_id": "AKfycbymhO0ljXXcgPygiGrbvtjxC0_1kPpPA49hY8Acf18XSHM_OKHcHlkwfQoC7KA3_U7h"},
    {"dash": "08-produtividade-operadores", "unidade": "pe2", "nome": "Produtividade por Operador",
     "sheet_id": "1ro9a0FBqqtAetLoNS_8M885Dudw1f84jxUa_rI8FYNs", "sheet_nome": "Produtividade PE2",
     "script_id": "1O09ck43G7a2siM6LCexaQ36CocbAkUisvOSZJy9H5nnhLBD7B-owZEbb",
     "deploy_id": "AKfycbwLQS99GJ8_YhL1JKLwBk7SFyp7owKGzlQElT1GklpNjACbgms_EXZh4oJBb6iafk8J"},
    {"dash": "09-produtividade-turno", "unidade": "pe2", "nome": "Produtividade por Turno",
     "sheet_id": "15zDTkfz-01gZgefZz9aukXbXnXM2WDbF3zA1iWPXGOE", "sheet_nome": "Produtividade PE2",
     "script_id": "1yOxXxJQbJX9VEdKsErbfz3VB1q4HFnKDts2iNqN9f0TEQRzjVgkBKxZ-",
     "deploy_id": "AKfycbxwkHQWKlW_egNvJtSnmAiAFgxO7FGppeSiTsB0_WdE2tFnbOeUioqq-lEySjvkm_Lg"},
]

# Planilhas usadas fora dos web apps
EXTRAS = [
    {"pasta": "report-fifo-seatalk", "unidade": "pe4", "nome": "Report FIFO Stage IN (Seatalk)",
     "sheet_id": "19ejea0roWLSroIskVg0a2Pr0dXcTjsm0zUxOwL8SQkI", "sheet_nome": "Report FIFO Stage IN"},
]

URL_WEBAPP = "https://script.google.com/a/macros/shopee.com/s/{deploy_id}/exec"
URL_SHEET = "https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
URL_SCRIPT = "https://script.google.com/home/projects/{script_id}/edit"
