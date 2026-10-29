# Óticas Diniz · Controle de agendamentos

Sistema web para controlar os agendamentos de exame de vista de cada unidade da rede: quem foi marcado, quem compareceu e quem faltou. Recebe os agendamentos feitos no CRM (Datacrazy) e avisa o CRM sobre cada presença ou falta.

## Como rodar

Requer Node.js 20 ou mais novo. Localmente o banco é um arquivo SQLite; em produção, um banco Turso (SQLite na nuvem).

```bash
npm install
npm start          # http://localhost:3000
npm test           # testes da API, das permissões e da integração
```

Na primeira execução local o banco (`dados/agendamentos.db`) é criado com 3 unidades e agendamentos de exemplo. Senha de todos: `diniz123`.

| Acesso | E-mail |
|---|---|
| Administrador principal | admin@diniz.com |
| Unidade Centro (gerente, pode agendar) | centro@diniz.com |
| Unidade Aventureiro (gerente) | aventureiro@diniz.com |
| Recepção do Centro | recepcao.centro@diniz.com |

## Hierarquia de acessos

| Função | Admin principal | Administrador | Gerente da unidade | Recepção |
|---|:-:|:-:|:-:|:-:|
| Unidades que enxerga | Todas | Todas | A sua | A sua |
| Marcar compareceu / não compareceu, confirmar | ✓ | ✓ | ✓ | ✓ |
| Criar, remarcar e cancelar agendamentos | ✓ | ✓ | Se liberado | Se liberado |
| Liberar "pode agendar" para usuários | ✓ | ✓ | | |
| Reabrir um agendamento já fechado | ✓ | ✓ | ✓ | |
| Cadastrar unidades (com e-mail e senha da unidade) | ✓ | ✓ | | |
| Cadastrar usuários | Todos os perfis | Gerentes e recepção | Recepção da unidade | |
| Horários e feriados da unidade | ✓ | ✓ | ✓ | |
| Relatórios | Rede | Rede | Unidade | |
| Integração com o CRM | ✓ | ✓ | | |
| Logs | ✓ | | | |

O administrador principal é o primeiro administrador (criado por `ADMIN_EMAIL`/`ADMIN_SENHA`).

## Fechamento do dia

A gerente da unidade (e também supervisor e administrador, nas unidades que veem) lança em **Fechamento do dia** as consultas de cada dia, no mesmo modelo da planilha: optometrista, nome do cliente, valor, forma de pagamento (cortesia, dinheiro, débito, crédito ou Pix na máquina da clínica), nº da OS quando a consulta virou venda e, opcionalmente, o valor da venda. Quem foi marcado como "compareceu" na agenda aparece como sugestão para entrar no fechamento.

Os totais seguem a planilha: consultas, cortesias, pagamento em dinheiro, em cartão/Pix máquina, total, quanto faltou para a meta diária da unidade e a chave Pix (meta e chave ficam em Configurações › Unidades). Também mostra quantas consultas venderam (com OS), quantas não venderam e o valor vendido.

A aba **Relatório** soma os fechamentos por período, unidade, optometrista e forma de pagamento, e exporta em CSV o resumo por dia e as consultas linha a linha.

- `GET /api/fechamentos/dia?loja_id=&data=`: fechamento do dia, totais e quem compareceu na agenda.
- `PUT /api/fechamentos/dia`: `{ loja_id, data, opto, observacoes, itens: [{ nome, valor, forma, os, valor_venda, agendamento_id }] }` substitui as linhas do dia.
- `GET /api/fechamentos/relatorio?inicio=&fim=&loja_id=`.

## Integração com o CRM

Em **Integrações** (menu lateral):

1. **Entrada (CRM → sistema):** endereço de webhook com token. O CRM envia um POST com cliente, unidade, data e hora. Reenviar o mesmo `id` atualiza o agendamento em vez de duplicar, e `"status": "cancelado"` cancela.
   ```json
   { "id": "id-do-negocio", "lead": { "id": "id-do-lead", "name": "Nome", "phone": "(47) 99999-0000" },
     "unidade": "Aventureiro", "data": "30/10/2026", "hora": "14:30" }
   ```
   Também aceita `nome`, `telefone`, `email`, `data_hora` (ISO), `unidade_id` e envio como formulário. Datas com fuso (`...Z`) são convertidas para o horário de Brasília.

   Respostas: `201`/`200` com `"ok": true` (e `"avisos"` quando, por exemplo, a data já passou). Em erro, `4xx` com `"ok": false`, `"codigo"`, `"erro"`, `"campo"` e `"como_corrigir"`. Códigos: `TOKEN_AUSENTE`, `TOKEN_INVALIDO`, `CORPO_VAZIO`, `JSON_INVALIDO`, `DATA_AUSENTE`, `DATA_INVALIDA`, `HORA_AUSENTE`, `HORA_INVALIDA`, `UNIDADE_AUSENTE`, `UNIDADE_NAO_ENCONTRADA` (traz `unidades_disponiveis`), `UNIDADE_AMBIGUA`, `CLIENTE_AUSENTE`, `AGENDAMENTO_NAO_ENCONTRADO`.
2. **Saída (sistema → CRM):** URL que recebe um POST a cada evento: `agendamento.criado`, `agendamento.remarcado`, `agendamento.confirmado`, `agendamento.compareceu`, `agendamento.faltou`, `agendamento.cancelado`. O corpo traz o agendamento (com `id_externo` do CRM e `compareceu: true/false`), a unidade e o cliente (com `crm_id`). Um token opcional vai no cabeçalho `X-Webhook-Token`.

Os últimos eventos, com sucesso ou falha, aparecem na mesma tela.

## Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Banco Turso (obrigatório na Vercel). Sem elas, usa o arquivo local `DB_FILE`. |
| `ADMIN_EMAIL`, `ADMIN_SENHA` | Cria o administrador principal se ainda não houver administrador. |
| `SEM_DEMO=1` | Não cria dados de demonstração localmente (em produção eles nunca são criados). |
| `PORT`, `DB_FILE`, `TZ` | Porta, arquivo do banco local e fuso (padrão `America/Sao_Paulo`). |

## Publicar na Vercel

1. Importe o repositório na Vercel (framework *Other*, sem comando de build).
2. Em **Storage**, conecte um banco **Turso** ao projeto.
3. Em **Settings → Environment Variables**, adicione `ADMIN_EMAIL` e `ADMIN_SENHA` (mín. 8 caracteres) e faça um novo deploy.

A interface fica em `public/` e a API em `api/index.js`, conforme `vercel.json`.

## Estrutura

```
api/index.js        entrada na Vercel
src/local.js        inicialização local
src/rotas.js        rotas da API e regras de acesso
src/permissoes.js   perfis e permissões
src/agenda.js       horários livres por unidade
src/integracao.js   webhooks de entrada e saída do CRM
src/db.js           esquema do banco, migração e dados de demonstração
public/             interface web (HTML, CSS e JavaScript puro)
test/               testes automatizados (node --test)
```
