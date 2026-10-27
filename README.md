# Óticas Diniz · Agendamento de exames de vista

Sistema web para marcar, acompanhar e registrar exames de vista nas lojas da rede, com hierarquia de acessos.

## Como rodar

Requer Node.js 22.13 ou mais novo (usa o SQLite embutido no Node, sem banco externo).

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

Variáveis de ambiente: `PORT`, `DB_FILE` (caminho do banco), `SEM_DEMO=1` (não cria dados de demonstração),
`TZ` (padrão `America/Sao_Paulo`), `NODE_ENV=production` (cookie de sessão só por HTTPS).

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
src/server.js      inicialização
src/app.js         rotas da API e regras de acesso
src/permissoes.js  perfis e permissões
src/agenda.js      cálculo de horários livres
src/db.js          esquema do banco e dados de demonstração
public/            interface web (HTML, CSS e JavaScript puro)
test/              testes automatizados (node --test)
```

## Próximos passos sugeridos

- Lembretes e confirmação por WhatsApp/SMS (ex.: API oficial do WhatsApp Business) um dia antes do exame.
- Recuperação de senha por e-mail.
- Hospedagem (ex.: Railway, Render ou VPS) com HTTPS e backup diário do arquivo do banco.
