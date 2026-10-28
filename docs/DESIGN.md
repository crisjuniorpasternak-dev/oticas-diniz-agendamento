# Sistema de design · Óticas Diniz Agendamentos

O sistema é um painel de uso diário em lojas. A recepção usa principalmente o celular e o balcão, e a gestão usa o computador. O tom é amigável e profissional, com acessibilidade WCAG AA. Todos os valores abaixo estão como variáveis CSS em `public/estilo.css`.

## 1. Estratégia responsiva

| Faixa | Estrutura | O que muda |
|---|---|---|
| Celular, 320–767px | Barra superior de 56px com a logo, o seletor de unidade e o avatar. Navegação inferior fixa de 64px, mais a área segura do iPhone. | Prioridade: agendamentos de hoje, depois o calendário, os próximos dias e a lista do dia. As métricas ficam em 2 colunas, com "Agendamentos hoje" ocupando a linha inteira. O botão "Novo" sai do cabeçalho e vira o botão central da barra inferior. O telefone e a unidade somem da lista do dia. A "Sair" vai para Meu perfil. |
| Tablet, 768–1023px | Trilho lateral de 84px, com ícones de 22px e o rótulo curto embaixo. | O calendário e os próximos dias ficam empilhados. As métricas vão para 3 colunas. O nome do usuário some, e fica só o avatar. |
| Notebook, 1024–1279px | Barra lateral completa de 248px. | Calendário e próximos dias lado a lado (1,65 : 1). Margens de 24px. |
| Computador, 1280px+ | Barra lateral de 248px. O conteúdo tem no máximo 1280px, com margens de 32px. | Layout completo. Estados de hover em linhas, cartões, dias e horários. |

**Alvos de toque:** pelo menos 44px de altura em botões, campos e itens de menu. Os botões de presença (Compareceu e Faltou) ocupam a largura do cartão no celular. O botão "Novo" tem 52px e fica no centro da barra inferior, na zona do polegar.

**Três componentes com desenho diferente por faixa (não só redimensionados):**
1. **Navegação:** barra lateral completa no computador, trilho de ícones no tablet e barra inferior com botão central no celular.
2. **Lista de agendamentos:** tabela no computador e no tablet. No celular cada linha vira um cartão: a hora fica em destaque à esquerda, o status no canto e os botões de presença embaixo, na largura toda.
3. **Detalhe do agendamento (modal):** caixa centralizada no computador. No celular vira uma folha que sobe de baixo, com alça e botões em duas colunas.

O calendário também se adapta. Cada dia é um cartão com a contagem e as presenças no computador. No celular fica compacto, com o número do dia e a contagem.

**Padrão de navegação:** os mesmos 4 ou 5 destinos aparecem em todas as faixas, sempre na mesma ordem: Início, Agenda, Novo, Relatórios e Ajustes. A unidade escolhida fica sempre no topo. Assim a pessoa não precisa reaprender o menu ao trocar de aparelho.

## 2. Microinterações

Os tempos usados são rápido 120ms, médio 200ms e lento 320ms. As curvas são `cubic-bezier(.2,.8,.2,1)` para saídas suaves e `cubic-bezier(.34,1.56,.64,1)` para o efeito de mola na confirmação.

| Estado | Botão | Por quê |
|---|---|---|
| Padrão | Fundo vermelho 600, texto branco, sombra leve e raio de 8px. | Firme e legível. |
| Hover | O fundo passa para o 700 e o botão sobe 1px com uma sombra maior, em 200ms. | Mostra que o botão responde, sem chamar atenção demais. |
| Pressionado | O fundo vai para o 800 e o botão encolhe para 97%, em 60ms. | Sensação física de clique. |
| Foco (teclado) | Anel de 3px na cor da marca, com 28% de opacidade. | Navegação por teclado visível (WCAG 2.4.7). |
| Carregando | O texto fica transparente e um anel gira a cada 700ms. O botão mantém a largura e não aceita outro clique. | Evita clique duplo e o layout não pula. |
| Sucesso | Aviso no rodapé com ✓ verde, que entra com efeito de mola em 320ms e some em 3,5s. Horário escolhido e a tela de confirmação pulsam (escala 0,92 → 1,04 → 1). | Confirmação clara e amigável. |
| Erro | A mensagem aparece em vermelho com ⚠ e treme na horizontal (5px, 360ms). O aviso de erro também treme. | O olho vai direto para o problema. |
| Desativado | Opacidade de 45%, cursor bloqueado, sem sombra e sem movimento. | Fica claro que não dá para clicar. |

Ao carregar uma tela aparecem blocos cinza com brilho em vez de tela em branco, e os cartões de métricas entram em sequência, com 40ms entre cada um. Quem ativa "reduzir movimento" no aparelho recebe as mudanças sem animação.

## 3. Paleta

**Primária (vermelho Diniz, com o 600 como cor da marca):** 50 `#fef2f3`, 100 `#fde3e6`, 200 `#fbccd2`, 300 `#f7a3ae`, 400 `#ef6b7d`, 500 `#e03a52`, 600 `#c8102e`, 700 `#a50d26`, 800 `#8a0f25`, 900 `#741226`.

**Secundária (azul-petróleo):** 50 `#effaf9`, 100 `#d5f2ef`, 200 `#ade4df`, 300 `#7bcfc8`, 400 `#48b3ac`, 500 `#2a9790`, 600 `#1f7a75`, 700 `#1c625f`, 800 `#1a4f4d`, 900 `#183f3e`. É a complementar do vermelho no círculo cromático. Fica reservada para o que vem do CRM, para não competir com o vermelho nem com as cores de status.

**Neutros quentes:** 0 `#ffffff`, 50 `#f8f7f7`, 100 `#f1efef`, 200 `#e4e1e1`, 300 `#cfcbcb`, 400 `#a39e9e`, 500 `#77706f`, 600 `#5c5655`, 700 `#45403f`, 800 `#2d2928`, 900 `#1c1918`. Os cinzas puxam levemente para o vermelho, para o conjunto parecer da mesma família.

**Semânticas (claro / padrão / escuro):**
- Sucesso: `#e7f6ee` / `#16794a` / `#0f5c38`
- Aviso: `#fff4e0` / `#9a5107` / `#7a4005`
- Erro: usa a primária, `#fef2f3` / `#c8102e` / `#8a0f25`
- Informação: `#e8f1fc` / `#1f62b8` / `#174a8b`

No sistema, "compareceu" é verde, "não compareceu" é âmbar (atenção, não erro), "confirmado" é azul e "agendado" é cinza.

**Modo escuro:** acompanha o aparelho automaticamente. O fundo é `#141112`, as superfícies são `#1e1a1b` e `#272223`, o texto é `#f3eeee` e o texto suave é `#b5adad`. O botão usa `#d61f3c`, e o texto da marca usa `#ff8a9b`. As cores semânticas ficam mais claras (`#4cc98a`, `#f2a54a`, `#7fb2f0`) sobre fundos escuros da mesma cor.

**Por que essas cores:** o vermelho transmite energia e urgência na medida certa para uma agenda. Os neutros quentes e os cantos arredondados deixam o tom amigável, e o vermelho fica concentrado nas ações principais para não cansar a vista.

**Nomes dos tokens:** `--cor-primaria-50` a `--cor-primaria-900`, `--cor-secundaria-*`, `--cor-neutra-*`, `--cor-sucesso-claro|--cor-sucesso|--cor-sucesso-escuro` (o mesmo vale para aviso, erro e info). Os componentes usam os papéis `--fundo`, `--superficie`, `--texto`, `--texto-suave`, `--marca` e `--marca-texto`. Espaçamento: `--e-1` a `--e-7` (4, 8, 12, 16, 24, 32 e 48px). Raios: `--r-sm` 8, `--r-md` 12 e `--r-lg` 16.

## 4. Contraste WCAG AA

O mínimo exigido é 4,5:1 para texto normal.

| Modo | Uso | Cores | Contraste | Resultado |
|---|---|---|---|---|
| Claro | Texto principal | `#1c1918` sobre `#f8f7f7` | 16.34:1 | Aprovado |
| Claro | Texto em cartão | `#1c1918` sobre `#ffffff` | 17.48:1 | Aprovado |
| Claro | Texto suave | `#5c5655` sobre `#ffffff` | 7.20:1 | Aprovado |
| Claro | Texto suave no fundo | `#5c5655` sobre `#f8f7f7` | 6.73:1 | Aprovado |
| Claro | Botão primário | `#ffffff` sobre `#c8102e` | 5.88:1 | Aprovado |
| Claro | Botão primário (hover) | `#ffffff` sobre `#a50d26` | 7.82:1 | Aprovado |
| Claro | Link / texto da marca | `#a50d26` sobre `#ffffff` | 7.82:1 | Aprovado |
| Claro | Selo da marca | `#a50d26` sobre `#fef2f3` | 7.15:1 | Aprovado |
| Claro | Botão sucesso | `#ffffff` sobre `#16794a` | 5.43:1 | Aprovado |
| Claro | Selo compareceu | `#16794a` sobre `#e7f6ee` | 4.86:1 | Aprovado |
| Claro | Selo faltou | `#9a5107` sobre `#fff4e0` | 5.42:1 | Aprovado |
| Claro | Selo confirmado | `#1f62b8` sobre `#e8f1fc` | 5.27:1 | Aprovado |
| Claro | Selo CRM | `#1c625f` sobre `#effaf9` | 6.66:1 | Aprovado |
| Claro | Erro em texto | `#c8102e` sobre `#ffffff` | 5.88:1 | Aprovado |
| Claro | Menu lateral | `#cfc8c8` sobre `#1c1918` | 10.61:1 | Aprovado |
| Claro | Selo agendado | `#5c5655` sobre `#f1efef` | 6.28:1 | Aprovado |
| Escuro | Texto principal | `#f3eeee` sobre `#141112` | 16.34:1 | Aprovado |
| Escuro | Texto em cartão | `#f3eeee` sobre `#1e1a1b` | 14.99:1 | Aprovado |
| Escuro | Texto suave | `#b5adad` sobre `#1e1a1b` | 7.83:1 | Aprovado |
| Escuro | Botão primário | `#ffffff` sobre `#d61f3c` | 5.10:1 | Aprovado |
| Escuro | Link / texto da marca | `#ff8a9b` sobre `#1e1a1b` | 7.68:1 | Aprovado |
| Escuro | Selo da marca | `#ff8a9b` sobre `#3a1a20` | 6.94:1 | Aprovado |
| Escuro | Botão sucesso | `#0b2416` sobre `#4cc98a` | 7.85:1 | Aprovado |
| Escuro | Selo compareceu | `#4cc98a` sobre `#12301f` | 6.83:1 | Aprovado |
| Escuro | Selo faltou | `#f2a54a` sobre `#33240e` | 7.33:1 | Aprovado |
| Escuro | Selo confirmado | `#7fb2f0` sobre `#142640` | 6.90:1 | Aprovado |
| Escuro | Selo CRM | `#7bcfc8` sobre `#13302e` | 7.79:1 | Aprovado |
| Escuro | Botão alerta | `#f2a54a` sobre `#1e1a1b` | 8.42:1 | Aprovado |
