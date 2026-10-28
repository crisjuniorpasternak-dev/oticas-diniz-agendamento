# Óticas Diniz · Agendamento de exames de vista

Sistema web para marcar, acompanhar e registrar exames de vista nas lojas da rede, com hierarquia de acessos.

## Como rodar

Requer Node.js 20 ou mais novo. Localmente o banco é um arquivo SQLite; em produção, um banco Turso (SQLite na nuvem).

```bash
npm install
npm start          # http://localhost:3000
npm test           # testes da API e das permissões
```

Na primeira execução o banco (`dados/agendamentos.db`) é criado com 3 lojas e um usuário de cada perfil.
Senha de todos: `diniz123`.

| Perfil | E-mail |
|---|---|
| Administrador da rede | admin@diniz.com |
| Gerente (Centro) | gerente.centro@diniz.com |
| Atendente (Centro) | atendente.centro@diniz.com |
| Optometrista | ana@diniz.com |
| Cliente | cliente@exemplo.com |

Variáveis de ambiente:

| Variável | Para quê |
|---|---|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Banco Turso (produção). Sem elas, usa o arquivo local `DB_FILE`. |
| `ADMIN_EMAIL`, `ADMIN_SENHA` | Cria o administrador inicial e **não** cria os dados de demonstração. |
| `SEM_DEMO=1` | Não cria dados de demonstração. |
| `NODE_ENV=production` | Cookie de sessão só por HTTPS. |
| `PORT`, `DB_FILE`, `TZ` | Porta, arquivo do banco local e fuso (padrão `America/Sao_Paulo`). |

## Publicar na Vercel

1. Na Vercel, **Add New → Project** e importe este repositório do GitHub (framework: *Other*, sem comando de build).
2. Em **Storage** (ou Marketplace), adicione o **Turso** e conecte ao projeto. Ele cria `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`.
3. Em **Settings → Environment Variables**, adicione `ADMIN_EMAIL`, `ADMIN_SENHA` (mín. 8 caracteres) e `NODE_ENV=production`.
4. Faça o deploy. O banco é criado no primeiro acesso; entre com o e-mail do administrador e cadastre lojas, equipe e horários.

A interface fica em `public/` (arquivos estáticos) e a API em `api/index.js` (função da Vercel), conforme `vercel.json`.

## Hierarquia de acessos

| Função | Admin da rede | Gerente | Atendente | Optometrista | Cliente |
|---|:-:|:-:|:-:|:-:|:-:|
| Escopo | Toda a rede | Sua loja | Sua loja | Sua agenda | Seus dados |
| Cadastrar e editar lojas | ✓ | | | | |
| Cadastrar usuários | Todos os perfis | Atendentes e optometristas da loja | Clientes | | (autocadastro) |
| Horários semanais dos optometristas | ✓ | Da loja | | Só consulta | |
| Folgas e bloqueios de agenda | ✓ | Da loja | | Os próprios | |
| Agendar exame | Qualquer loja | Na loja | Na loja | | Para si |
| Confirmar, remarcar, cancelar | ✓ | ✓ | ✓ | | Os próprios, até 2h antes |
| Marcar falta | ✓ | ✓ | ✓ | ✓ | |
| Iniciar e concluir atendimento | ✓ | Iniciar | | ✓ | |
| Registrar resultado do exame | | | | ✓ | |
| Ver resultado do exame | ✓ | | | Dos seus pacientes | Os próprios |
| Relatórios | Rede | Loja | | | |
| Auditoria | ✓ | | | | |

Dados clínicos (grau, DNP etc.) ficam restritos a optometristas, ao próprio cliente e ao administrador,
seguindo o princípio de necessidade da LGPD. Toda ação relevante é registrada na auditoria.

## Regras de agenda

- Cada loja define horário de funcionamento e duração do exame (padrão 30 min).
- Cada optometrista tem horários semanais por loja e pode atender em mais de uma loja, sem sobreposição.
- Horários livres consideram consultas já marcadas, folgas/bloqueios e o horário atual.
- Agendamento até 60 dias à frente; um exame por cliente por dia.
- Fluxo de status: Agendado → Confirmado → Em atendimento → Concluído, ou Cancelado / Não compareceu.

## Estrutura

```
api/index.js       entrada na Vercel
src/local.js       inicialização local
src/rotas.js       rotas da API e regras de acesso
src/permissoes.js  perfis e permissões
src/agenda.js      cálculo de horários livres
src/db.js          esquema do banco e dados de demonstração
public/            interface web (HTML, CSS e JavaScript puro)
test/              testes automatizados (node --test)
```

## Próximos passos sugeridos

- Lembretes e confirmação por WhatsApp/SMS (ex.: API oficial do WhatsApp Business) um dia antes do exame.
- Recuperação de senha por e-mail.
