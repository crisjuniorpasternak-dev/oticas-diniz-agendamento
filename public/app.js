'use strict';

// ---------- Utilidades ----------
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const STATUS = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  compareceu: 'Compareceu',
  faltou: 'Não compareceu',
  cancelado: 'Cancelado',
};
// Ícones em traço (24x24)
const ICONES = {
  inicio: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  agendamentos: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3M7.5 13.5h3M7.5 17h6"/>',
  novo: '<path d="M12 5v14M5 12h14"/>',
  relatorios: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  configuracoes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  unidades: '<path d="M12 21s-7-5.6-7-11.5a7 7 0 0 1 14 0C19 15.4 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  sair: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
  ok: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  vazio: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3M9.5 14.5l5 3M14.5 14.5l-5 3"/>',
  anterior: '<path d="m15 6-6 6 6 6"/>',
  proximo: '<path d="m9 6 6 6-6 6"/>',
};
const icone = (n) => `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">${ICONES[n] || ''}</svg>`;
const vazio = (texto) => `<div class="vazio">${icone('vazio')}${texto}</div>`;
const iniciais = (nome) => String(nome || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const selo = (s) => `<span class="selo st-${s}">${STATUS[s] || s}</span>`;
const seloOrigem = (o) => (o === 'crm' ? '<span class="selo origem-crm">CRM</span>' : '');

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoje = () => iso(new Date());
const somarDias = (dataIso, n) => {
  const [a, m, d] = dataIso.split('-').map(Number);
  return iso(new Date(a, m - 1, d + n));
};
const dataBR = (dataIso) => (dataIso ? dataIso.split('-').reverse().join('/') : '');
const diaSemana = (dataIso) => {
  const [a, m, d] = dataIso.split('-').map(Number);
  return DIAS[new Date(a, m - 1, d).getDay()];
};
const jaPassou = (a) => new Date(`${a.data}T${a.hora}`) <= new Date();

async function api(metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401 && estado.usuario && !url.startsWith('/api/auth')) {
    estado.usuario = null;
    iniciar();
  }
  if (!r.ok) throw new Error(dados.erro || 'Não foi possível concluir a operação.');
  return dados;
}

function avisar(msg, ruim = false) {
  const el = $('#aviso');
  el.textContent = msg;
  el.hidden = true;
  el.className = 'aviso' + (ruim ? ' ruim' : '');
  void el.offsetWidth; // reinicia a animação de entrada
  el.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => (el.hidden = true), 3500);
}

function abrirModal(html) {
  $('#modal-conteudo').innerHTML = html;
  $('#modal').hidden = false;
  return $('#modal-conteudo');
}
function fecharModal() {
  $('#modal').hidden = true;
  $('#modal-conteudo').innerHTML = '';
}
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-fechar]') || e.target.id === 'modal') fecharModal();
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && fecharModal());

const dadosForm = (form) => Object.fromEntries(new FormData(form).entries());

// Executa uma ação de formulário mostrando o erro no próprio formulário
async function tentar(form, fn) {
  const erro = $('.erro', form);
  const botao = $('button[type=submit]', form);
  if (erro) erro.textContent = '';
  if (botao) botao.classList.add('carregando');
  try {
    await fn();
  } catch (e) {
    if (erro && erro.isConnected) {
      erro.textContent = e.message;
      erro.classList.remove('tremer');
      void erro.offsetWidth;
      erro.classList.add('tremer');
    } else avisar(e.message, true);
  } finally {
    if (botao) botao.classList.remove('carregando');
  }
}

const guardar = (k, v) => {
  try {
    v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
  } catch {}
};
const lembrar = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

// ---------- Estado e navegação ----------
const estado = { usuario: null, loja: null, permissoes: {}, lojas: [], unidade: null };
const pode = (p) => !!estado.permissoes[p];
const ehAdmin = () => estado.usuario?.perfil === 'admin';
const nomeLoja = (id) => estado.lojas.find((l) => l.id === id)?.nome || '—';
// Unidade em foco: a do usuário, ou a escolhida pelo administrador ('' = todas)
const unidadeAtual = () => (ehAdmin() ? estado.unidade || '' : estado.usuario.loja_id);
const filtroUnidade = () => (unidadeAtual() ? `loja_id=${unidadeAtual()}` : '');

function menu() {
  // [rota, nome, nome curto para a barra inferior do celular]
  const m = [['inicio', 'Início', 'Início'], ['agendamentos', 'Agendamentos', 'Agenda']];
  if (pode('agendar')) m.push(['novo', 'Novo agendamento', 'Novo']);
  if (pode('relatorios')) m.push(['relatorios', 'Relatórios', 'Relatórios']);
  if (pode('usuarios') || pode('horarios') || pode('unidades')) m.push(['configuracoes', 'Configurações', 'Ajustes']);
  return m;
}

const TELAS = {};

function rotaAtual() {
  const [r, sub] = (location.hash.replace('#/', '') || '').split('/');
  if (r === 'unidades' && ehAdmin()) return ['unidades'];
  if (r === 'perfil') return ['perfil'];
  if (menu().some(([id]) => id === r)) return [r, sub];
  return [ehAdmin() && lembrar('unidade') === null ? 'unidades' : 'inicio'];
}

async function iniciar() {
  const me = await api('GET', '/api/auth/me').catch(() => ({ usuario: null }));
  if (!me.usuario) {
    estado.usuario = null;
    estado.demo = !!me.demo;
    return telaEntrada();
  }
  Object.assign(estado, { usuario: me.usuario, loja: me.loja, permissoes: me.permissoes });
  estado.lojas = await api('GET', '/api/lojas');
  const salva = lembrar('unidade');
  estado.unidade = ehAdmin() && salva && estado.lojas.some((l) => String(l.id) === salva) ? Number(salva) : null;
  renderizar();
}

function renderizar() {
  const [rota, sub] = rotaAtual();
  const u = estado.usuario;
  const unidades = ehAdmin() ? [['unidades', 'Unidades', 'Unidades']] : [];
  const itens = [...menu().slice(0, 1), ...unidades, ...menu().slice(1)];
  const logo = `<span class="selo-logo">D</span>`;
  $('#app').innerHTML = `
    <div class="casca">
      <aside class="lateral">
        <div class="logo">${logo}<div class="logo-texto"><b>Óticas Diniz</b><small>Agendamentos</small></div></div>
        <nav class="nav" aria-label="Menu principal">${itens
          .map(([id, nome, curto]) => `<a href="#/${id}" class="nav-item ${id === rota ? 'ativo' : ''}" title="${nome}">${icone(id)}<span class="longo">${nome}</span><span class="curto">${curto}</span></a>`)
          .join('')}</nav>
        <div class="rodape"><a href="#" class="nav-item" data-sair title="Sair">${icone('sair')}<span>Sair</span></a></div>
      </aside>
      <div class="conteudo">
        <header class="barra">
          <a href="#/inicio" class="logo-celular" aria-label="Início">${logo}</a>
          <div class="seletor-unidade">${icone('unidades')}${
            ehAdmin()
              ? `<select id="unidade" aria-label="Unidade">
                  <option value="">Todas as unidades</option>
                  ${estado.lojas.map((l) => `<option value="${l.id}" ${l.id === estado.unidade ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}
                </select>`
              : `<span>${esc(estado.loja?.nome || '')}</span>`
          }</div>
          <div class="espaco"></div>
          <a href="#/perfil" class="usuario" title="Meu perfil"><span class="nome"><b>${esc(u.nome)}</b><small>${esc(u.perfil_rotulo)}</small></span><span class="avatar">${esc(iniciais(u.nome))}</span></a>
        </header>
        <main id="tela"><div class="tela-carregando"><div class="esqueleto"></div><div class="esqueleto"></div><div class="esqueleto"></div></div></main>
      </div>
      <nav class="inferior" aria-label="Menu">${menu()
        .map(([id, , curto]) =>
          id === 'novo'
            ? `<a href="#/novo" class="principal ${id === rota ? 'ativo' : ''}"><span class="bolha">${icone('novo')}</span><span class="rotulo">${curto}</span></a>`
            : `<a href="#/${id}" class="${id === rota ? 'ativo' : ''}">${icone(id)}<span class="rotulo">${curto}</span></a>`
        )
        .join('')}</nav>
    </div>`;
  if ($('#unidade'))
    $('#unidade').onchange = (e) => {
      estado.unidade = e.target.value ? Number(e.target.value) : null;
      guardar('unidade', e.target.value);
      if (rota === 'unidades') location.hash = '#/inicio';
      else renderizar();
    };
  TELAS[rota]($('#tela'), sub);
}
window.addEventListener('hashchange', () => estado.usuario && renderizar());
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-sair]')) return;
  e.preventDefault();
  await api('POST', '/api/auth/logout', {});
  estado.usuario = null;
  location.hash = '';
  telaEntrada();
});

// ---------- Entrada ----------
function telaEntrada() {
  $('#app').innerHTML = `
    <div class="entrada">
      <section class="arte">
        <div class="logo" style="display:flex;align-items:center;gap:12px"><span class="selo-logo">D</span><b style="font-size:1.1rem">Óticas Diniz</b></div>
        <div><h1>Agendamentos de exame de vista</h1><p>Acompanhe quem foi agendado, quem compareceu e quem faltou em cada unidade.</p></div>
      </section>
      <section class="formulario">
        <form id="f">
          <h2 style="font-size:1.4rem">Entrar</h2>
          <p class="suave" style="margin-top:-6px;margin-bottom:24px">Use o e-mail e a senha da sua unidade.</p>
          <label>E-mail<input name="email" type="email" required autocomplete="username" placeholder="unidade@diniz.com"></label>
          <label>Senha<input name="senha" type="password" required autocomplete="current-password"></label>
          <p class="erro"></p>
          <button class="btn" type="submit">Entrar</button>
          ${
            estado.demo
              ? `<div class="demo"><b>Acessos de demonstração</b> (senha <code>diniz123</code>):<br>
                 <code>admin@diniz.com</code> · <code>centro@diniz.com</code><br>
                 <code>aventureiro@diniz.com</code> · <code>recepcao.centro@diniz.com</code></div>`
              : ''
          }
        </form>
      </section>
    </div>`;
  const f = $('#f');
  f.onsubmit = (e) => {
    e.preventDefault();
    tentar(f, async () => {
      await api('POST', '/api/auth/login', dadosForm(f));
      location.hash = '';
      iniciar();
    });
  };
}

// ---------- Seleção de unidade (administrador) ----------
TELAS.unidades = async (el) => {
  const contagem = await api('GET', `/api/agendamentos/contagem?por=unidade&data_inicio=${hoje()}&data_fim=${hoje()}`);
  const de = (id) => contagem.find((c) => c.loja_id === id) || { total: 0, compareceu: 0, faltou: 0 };
  const total = contagem.reduce((s, c) => s + c.total, 0);
  el.innerHTML = `
    <div class="cabeca"><div><h1>Selecione a unidade</h1><p class="suave">Agendamentos de hoje, ${diaSemana(hoje()).toLowerCase()} ${dataBR(hoje())}</p></div></div>
    <div class="unidades">
      <button class="unidade todas" data-u=""><span class="topo-cartao"><span class="pino">${icone('inicio')}</span><span><b>Todas as unidades</b><span class="suave">${estado.lojas.length} unidade(s)</span></span></span>
        <span class="num">${total}</span><span class="suave">agendamentos hoje</span></button>
      ${estado.lojas
        .map((l, i) => {
          const c = de(l.id);
          const base = c.total || 1;
          return `<button class="unidade" data-u="${l.id}" style="animation-delay:${Math.min(i + 1, 8) * 40}ms"><span class="topo-cartao"><span class="pino">${icone('unidades')}</span><span><b>${esc(l.nome)}</b><span class="suave">${esc(l.cidade || l.endereco || '')}</span></span></span>
            <span class="num">${c.total}</span><span class="suave">hoje · ${c.compareceu} compareceram · ${c.faltou} faltaram</span>
            <span class="barra-presenca"><i class="p-ok" style="width:${(c.compareceu / base) * 100}%"></i><i class="p-falta" style="width:${(c.faltou / base) * 100}%"></i></span></button>`;
        })
        .join('')}
    </div>
    ${!estado.lojas.length ? `<div class="cartao">${vazio('Nenhuma unidade cadastrada ainda. <a href="#/configuracoes/unidades">Cadastrar a primeira unidade</a>')}</div>` : ''}`;
  $$('[data-u]', el).forEach(
    (b) =>
      (b.onclick = () => {
        estado.unidade = b.dataset.u ? Number(b.dataset.u) : null;
        guardar('unidade', b.dataset.u);
        location.hash = '#/inicio';
      })
  );
};

// ---------- Início: hoje + calendário ----------
TELAS.inicio = async (el) => {
  const st = (TELAS.inicio.st ||= { mes: hoje().slice(0, 7), dia: hoje() });
  const tituloUnidade = unidadeAtual() ? nomeLoja(unidadeAtual()) : 'Todas as unidades';
  el.innerHTML = `
    <div class="cabeca"><div><h1>${esc(tituloUnidade)}</h1><p class="suave">Hoje é ${diaSemana(hoje()).toLowerCase()}, ${dataBR(hoje())}</p></div>
      ${pode('agendar') ? `<a class="btn" href="#/novo">${icone('novo')} Novo agendamento</a>` : ''}</div>
    <div class="metricas" id="hoje">${'<div class="metrica carregando"><b>00</b><span>carregando</span></div>'.repeat(5)}</div>
    <div class="painel">
      <div class="cartao">
        <div class="calendario-topo">
          <button class="btn sec icone-so" id="mes-ant" aria-label="Mês anterior">${icone('anterior')}</button>
          <h2 id="mes-nome"></h2>
          <button class="btn sec icone-so" id="mes-prox" aria-label="Próximo mês">${icone('proximo')}</button>
        </div>
        <div class="calendario" id="cal"></div>
      </div>
      <div class="cartao">
        <h2>Próximos dias</h2>
        <ul class="proximos" id="proximos"></ul>
      </div>
    </div>
    <div class="cartao tabela-rolagem" id="dia"></div>`;

  const f = filtroUnidade();
  const carregarHoje = async () => {
    const [c] = await api('GET', `/api/agendamentos/contagem?data_inicio=${hoje()}&data_fim=${hoje()}&${f}`);
    const x = c || { total: 0, agendado: 0, confirmado: 0, compareceu: 0, faltou: 0, cancelado: 0 };
    $('#hoje').innerHTML = [
      ['Agendamentos hoje', x.total - x.cancelado, 'destaque'],
      ['Aguardando', x.agendado + x.confirmado, 't-espera'],
      ['Compareceram', x.compareceu, 't-ok'],
      ['Não compareceram', x.faltou, 't-falta'],
      ['Cancelados', x.cancelado, 't-neutro'],
    ]
      .map(([n, v, cl]) => `<div class="metrica ${cl || ''}"><b>${v}</b><span>${n}</span></div>`)
      .join('');
  };

  const carregarProximos = async () => {
    const lista = await api('GET', `/api/agendamentos/contagem?data_inicio=${hoje()}&data_fim=${somarDias(hoje(), 13)}&status=agendado,confirmado&${f}`);
    $('#proximos').innerHTML = lista.length
      ? lista
          .map((d) => `<li data-dia="${d.data}"><span>${d.data === hoje() ? '<b>Hoje</b>' : `${diaSemana(d.data)}, ${dataBR(d.data).slice(0, 5)}`}</span><span class="contador">${d.total}</span></li>`)
          .join('')
      : `<li class="suave" style="cursor:default">Nenhum agendamento nos próximos 14 dias.</li>`;
    $$('#proximos [data-dia]').forEach((li) => (li.onclick = () => escolherDia(li.dataset.dia)));
  };

  const carregarMes = async () => {
    const [a, m] = st.mes.split('-').map(Number);
    $('#mes-nome').textContent = `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} de ${a}`;
    const primeiro = new Date(a, m - 1, 1);
    const inicio = new Date(a, m - 1, 1 - primeiro.getDay());
    const dias = Array.from({ length: 42 }, (_, i) => iso(new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i)));
    const cont = await api('GET', `/api/agendamentos/contagem?data_inicio=${dias[0]}&data_fim=${dias[41]}&${f}`);
    const por = Object.fromEntries(cont.map((c) => [c.data, c]));
    $('#cal').innerHTML =
      DIAS.map((d) => `<div class="sem">${d.slice(0, 3)}</div>`).join('') +
      dias
        .map((d) => {
          const c = por[d];
          const ativos = c ? c.total - c.cancelado : 0;
          const cls = [d.slice(0, 7) !== st.mes ? 'fora' : '', d === hoje() ? 'hoje' : '', d === st.dia ? 'sel' : ''].join(' ');
          return `<button class="${cls}" data-dia="${d}"><span class="dia">${Number(d.slice(8))}</span>
            ${ativos ? `<span class="qtd">${ativos}</span>` : ''}
            ${c && (c.compareceu || c.faltou) ? `<span class="pres"><span class="ok">✓ ${c.compareceu}</span><span class="falta">✗ ${c.faltou}</span></span>` : ''}</button>`;
        })
        .join('');
    $$('#cal [data-dia]').forEach((b) => (b.onclick = () => escolherDia(b.dataset.dia)));
  };

  const carregarDia = async () => {
    const lista = await api('GET', `/api/agendamentos?data_inicio=${st.dia}&data_fim=${st.dia}&${f}`);
    $('#dia').innerHTML = `<div class="cabeca" style="margin-bottom:12px"><h2 style="margin:0">${st.dia === hoje() ? 'Hoje' : diaSemana(st.dia)}, ${dataBR(st.dia)} · ${lista.filter((a) => a.status !== 'cancelado').length} agendamento(s)</h2></div>
      ${tabelaAgendamentos(lista, { rapido: true })}`;
    ligarTabela($('#dia'), lista, recarregar);
  };

  const escolherDia = (d) => {
    st.dia = d;
    if (d.slice(0, 7) !== st.mes) st.mes = d.slice(0, 7);
    carregarMes();
    carregarDia();
  };
  const recarregar = () => Promise.all([carregarHoje(), carregarMes(), carregarDia(), carregarProximos()]);
  const mudarMes = (n) => {
    const [a, m] = st.mes.split('-').map(Number);
    st.mes = iso(new Date(a, m - 1 + n, 1)).slice(0, 7);
    carregarMes();
  };
  $('#mes-ant').onclick = () => mudarMes(-1);
  $('#mes-prox').onclick = () => mudarMes(1);
  recarregar();
};

// Tabela de agendamentos com botões rápidos de presença
function tabelaAgendamentos(lista, { rapido = false, comData = false } = {}) {
  if (!lista.length) return vazio('Nenhum agendamento.');
  const todas = !unidadeAtual();
  return `<table class="cartoes"><thead><tr>${comData ? '<th>Data</th>' : ''}<th>Hora</th><th>Cliente</th><th class="esconder-celular">Telefone</th>
      ${todas ? '<th>Unidade</th>' : ''}<th>Status</th>${rapido ? '<th>Presença</th>' : ''}</tr></thead>
    <tbody>${lista
      .map(
        (a) => `<tr class="clicavel" data-id="${a.id}">${comData ? `<td data-label="Data">${dataBR(a.data)}</td>` : ''}<td class="c-hora"><b>${a.hora}</b></td>
        <td class="c-nome">${esc(a.cliente_nome)} ${seloOrigem(a.origem)}</td><td class="esconder-celular">${esc(a.cliente_telefone || '')}</td>
        ${todas ? `<td data-label="Unidade">${esc(a.loja_nome)}</td>` : ''}<td class="c-status">${selo(a.status)}</td>
        ${
          rapido
            ? `<td class="acoes">${
                ['agendado', 'confirmado'].includes(a.status) && a.data <= hoje()
                  ? `<button class="btn ok peq" data-rapido="compareceu" data-ag="${a.id}">${icone('ok')} Compareceu</button>
                     ${jaPassou(a) ? `<button class="btn alerta peq" data-rapido="faltou" data-ag="${a.id}">Faltou</button>` : ''}`
                  : ''
              }</td>`
            : ''
        }</tr>`
      )
      .join('')}</tbody></table>`;
}

function ligarTabela(raiz, lista, aoMudar) {
  $$('tr[data-id]', raiz).forEach((tr) => (tr.onclick = () => detalheAgendamento(Number(tr.dataset.id), aoMudar)));
  $$('[data-rapido]', raiz).forEach(
    (b) =>
      (b.onclick = async (e) => {
        e.stopPropagation();
        b.classList.add('carregando');
        try {
          await api('PATCH', `/api/agendamentos/${b.dataset.ag}/status`, { status: b.dataset.rapido });
          avisar(b.dataset.rapido === 'compareceu' ? 'Presença registrada.' : 'Falta registrada.');
          aoMudar();
        } catch (err) {
          b.classList.remove('carregando');
          avisar(err.message, true);
        }
      })
  );
}

// Ações possíveis para o usuário, conforme o status atual
function acoesPara(a) {
  const gerencia = ehAdmin() || estado.usuario.perfil === 'gerente';
  const aberto = ['agendado', 'confirmado'].includes(a.status);
  const r = [];
  if (a.status === 'agendado') r.push(['confirmado', 'Confirmar', 'btn sec']);
  if ((aberto || a.status === 'faltou') && a.data <= hoje()) r.push(['compareceu', 'Compareceu', 'btn ok']);
  if ((aberto || a.status === 'compareceu') && jaPassou(a)) r.push(['faltou', 'Não compareceu', 'btn alerta']);
  if (aberto && pode('agendar')) r.push(['remarcar', 'Remarcar', 'btn sec'], ['cancelado', 'Cancelar', 'btn sec']);
  if (!aberto && gerencia) r.push(['agendado', 'Reabrir', 'btn sec']);
  return r;
}

async function detalheAgendamento(id, aoMudar) {
  const a = await api('GET', `/api/agendamentos/${id}`);
  const m = abrirModal(`
    <h2>${esc(a.cliente_nome)}</h2>
    <dl class="detalhe">
      <dt>Status</dt><dd>${selo(a.status)} ${seloOrigem(a.origem)}</dd>
      <dt>Quando</dt><dd>${diaSemana(a.data)}, ${dataBR(a.data)} às ${a.hora}</dd>
      <dt>Unidade</dt><dd>${esc(a.loja_nome)}</dd>
      <dt>Telefone</dt><dd>${esc(a.cliente_telefone || '—')}</dd>
      ${a.cliente_email ? `<dt>E-mail</dt><dd>${esc(a.cliente_email)}</dd>` : ''}
      ${a.observacoes ? `<dt>Observações</dt><dd>${esc(a.observacoes)}</dd>` : ''}
      ${a.motivo_cancelamento ? `<dt>Cancelamento</dt><dd>${esc(a.motivo_cancelamento)}</dd>` : ''}
      <dt>Origem</dt><dd>${a.origem === 'crm' ? `CRM${a.id_externo ? ` (id ${esc(a.id_externo)})` : ''}` : `Sistema${a.criado_por_nome ? ` · por ${esc(a.criado_por_nome)}` : ''}`}</dd>
    </dl>
    <div class="acoes">${acoesPara(a).map(([k, n, c]) => `<button class="${c}" data-acao="${k}">${n}</button>`).join('') || '<span class="suave">Nenhuma ação disponível.</span>'}</div>`);
  $$('[data-acao]', m).forEach(
    (b) =>
      (b.onclick = async () => {
        const acao = b.dataset.acao;
        if (acao === 'remarcar') return telaRemarcar(a, aoMudar);
        let motivo;
        if (acao === 'cancelado') {
          motivo = window.prompt('Motivo do cancelamento (opcional):', '');
          if (motivo === null) return;
        }
        try {
          await api('PATCH', `/api/agendamentos/${a.id}/status`, { status: acao, motivo });
          avisar('Agendamento atualizado.');
          fecharModal();
          aoMudar && aoMudar();
        } catch (e) {
          avisar(e.message, true);
        }
      })
  );
}

// Seletor de data + horários livres (agendar e remarcar)
function seletorHorario(cont, { lojaId, aoEscolher }) {
  const encaixe = ehAdmin() || estado.usuario.perfil === 'gerente';
  cont.innerHTML = `
    <div class="linha">
      <label>Data<input type="date" id="sh-data" min="${hoje()}" value="${hoje()}"></label>
      ${encaixe ? '<label class="check fixo" style="margin-bottom:22px"><input type="checkbox" id="sh-encaixe"> Encaixe (fora da grade)</label>' : ''}
    </div>
    <div id="sh-lista"></div>`;
  const carregar = async () => {
    aoEscolher(null);
    const data = $('#sh-data', cont).value;
    if (!data) return;
    if ($('#sh-encaixe', cont)?.checked) {
      $('#sh-lista', cont).innerHTML = '<label>Horário do encaixe<input type="time" id="sh-hora" required></label>';
      $('#sh-hora', cont).oninput = (e) => aoEscolher(e.target.value ? { data, hora: e.target.value, encaixe: true } : null);
      return;
    }
    const lista = await api('GET', `/api/horarios?loja_id=${lojaId}&data=${data}`);
    $('#sh-lista', cont).innerHTML = lista.length
      ? `<p class="suave">${diaSemana(data)}, ${dataBR(data)}: escolha um horário</p>
         <div class="horarios">${lista.map((s) => `<button type="button" data-h="${s.hora}">${s.hora}<small>${s.vagas} vaga${s.vagas > 1 ? 's' : ''}</small></button>`).join('')}</div>`
      : vazio('Sem horários livres nesta data.');
    $$('[data-h]', cont).forEach(
      (b) =>
        (b.onclick = () => {
          $$('[data-h]', cont).forEach((x) => x.classList.remove('sel'));
          b.classList.add('sel');
          aoEscolher({ data, hora: b.dataset.h });
        })
    );
  };
  $('#sh-data', cont).onchange = carregar;
  if ($('#sh-encaixe', cont)) $('#sh-encaixe', cont).onchange = carregar;
  carregar();
}

function telaRemarcar(a, aoMudar) {
  const m = abrirModal(`
    <h2>Remarcar</h2>
    <p class="suave">${esc(a.cliente_nome)} · hoje marcado para ${dataBR(a.data)} às ${a.hora}</p>
    <div id="sel"></div>
    <form id="fr"><p class="erro"></p><button class="btn" type="submit" disabled>Confirmar nova data</button></form>`);
  let escolha = null;
  const f = $('#fr', m);
  seletorHorario($('#sel', m), {
    lojaId: a.loja_id,
    aoEscolher: (e) => {
      escolha = e;
      $('button[type=submit]', f).disabled = !e;
    },
  });
  f.onsubmit = (e) => {
    e.preventDefault();
    tentar(f, async () => {
      await api('PUT', `/api/agendamentos/${a.id}/remarcar`, escolha);
      avisar('Agendamento remarcado.');
      fecharModal();
      aoMudar && aoMudar();
    });
  };
}

// ---------- Lista de agendamentos ----------
TELAS.agendamentos = async (el) => {
  const st = (TELAS.agendamentos.st ||= { inicio: hoje(), fim: somarDias(hoje(), 30), status: '', origem: '', busca: '' });
  el.innerHTML = `
    <div class="cabeca"><div><h1>Agendamentos</h1><p class="suave">Filtre por período, status ou cliente</p></div><div class="acoes"><button class="btn sec" id="csv">Exportar planilha</button>${pode('agendar') ? `<a class="btn" href="#/novo">${icone('novo')} Novo</a>` : ''}</div></div>
    <div class="cartao"><div class="linha">
      <label>De<input type="date" id="f-ini" value="${st.inicio}"></label>
      <label>Até<input type="date" id="f-fim" value="${st.fim}"></label>
      <label>Status<select id="f-status"><option value="">Todos</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Origem<select id="f-origem"><option value="">Todas</option><option value="sistema">Sistema</option><option value="crm">CRM</option></select></label>
      <label>Cliente<input id="f-busca" placeholder="Nome ou telefone" value="${esc(st.busca)}"></label>
    </div></div>
    <div class="cartao tabela-rolagem" id="lista"></div>`;
  $('#f-status').value = st.status;
  $('#f-origem').value = st.origem;
  let lista = [];
  const carregar = async () => {
    Object.assign(st, { inicio: $('#f-ini').value, fim: $('#f-fim').value, status: $('#f-status').value, origem: $('#f-origem').value, busca: $('#f-busca').value.trim() });
    const q = new URLSearchParams({ data_inicio: st.inicio, data_fim: st.fim });
    if (unidadeAtual()) q.set('loja_id', unidadeAtual());
    for (const k of ['status', 'origem', 'busca']) if (st[k]) q.set(k, st[k]);
    lista = await api('GET', '/api/agendamentos?' + q);
    $('#lista').innerHTML = `<p class="suave" style="margin-top:0">${lista.length} agendamento(s)</p>` + tabelaAgendamentos(lista, { rapido: true, comData: true });
    ligarTabela($('#lista'), lista, carregar);
  };
  let t;
  $('#f-busca').oninput = () => {
    clearTimeout(t);
    t = setTimeout(carregar, 300);
  };
  $$('#f-ini, #f-fim, #f-status, #f-origem').forEach((x) => (x.onchange = carregar));
  $('#csv').onclick = () => {
    const linhas = [['Data', 'Hora', 'Unidade', 'Cliente', 'Telefone', 'Status', 'Origem', 'Observações']].concat(
      lista.map((a) => [dataBR(a.data), a.hora, a.loja_nome, a.cliente_nome, a.cliente_telefone || '', STATUS[a.status], a.origem === 'crm' ? 'CRM' : 'Sistema', a.observacoes || ''])
    );
    const csv = '﻿' + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `agendamentos-${st.inicio}-a-${st.fim}.csv`;
    link.click();
  };
  carregar();
};

// ---------- Novo agendamento ----------
TELAS.novo = (el) => {
  const st = { cliente: null, escolha: null, loja: unidadeAtual() || (estado.lojas.length === 1 ? estado.lojas[0].id : null) };
  el.innerHTML = `
    <div class="cabeca"><div><h1>Novo agendamento</h1><p class="suave">Escolha o cliente, o dia e o horário</p></div></div>
    <div class="cartao" style="max-width:820px">
      ${
        ehAdmin()
          ? `<label>Unidade<select id="n-loja"><option value="">Escolha a unidade</option>${estado.lojas.map((l) => `<option value="${l.id}" ${l.id === st.loja ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}</select></label>`
          : ''
      }
      <h3 class="passo" style="margin-top:0"><i>1</i> Cliente</h3>
      <label>Buscar cliente já cadastrado (nome ou telefone)<input id="n-busca" placeholder="Digite ao menos 2 letras ou 4 números"></label>
      <div id="n-res"></div>
      <div id="n-cliente"></div>
      <h3 class="passo"><i>2</i> Data e horário</h3>
      <div id="n-horario"></div>
      <form id="n-form">
        <label>Observações (opcional)<textarea name="observacoes" rows="2"></textarea></label>
        <p class="erro"></p>
        <button class="btn" type="submit">Confirmar agendamento</button>
      </form>
    </div>`;

  const formNovoCliente = () => {
    st.cliente = null;
    $('#n-cliente').innerHTML = `<div class="linha">
      <label>Nome do cliente<input id="c-nome" required></label>
      <label>Telefone / WhatsApp<input id="c-tel"></label>
      <label>E-mail<input id="c-email" type="email"></label></div>`;
  };
  const clienteEscolhido = (c) => {
    st.cliente = c;
    $('#n-res').innerHTML = '';
    $('#n-busca').value = '';
    $('#n-cliente').innerHTML = `<div class="cliente-escolhido"><span class="avatar">${esc(iniciais(c.nome))}</span><div style="flex:1"><b>${esc(c.nome)}</b><br><span class="suave">${esc(c.telefone || '')}</span></div><a href="#" id="c-trocar">Trocar</a></div>`;
    $('#c-trocar').onclick = (e) => {
      e.preventDefault();
      formNovoCliente();
    };
  };
  formNovoCliente();

  let t;
  $('#n-busca').oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const termo = $('#n-busca').value.trim();
      if (termo.length < 2) return ($('#n-res').innerHTML = '');
      const lista = await api('GET', '/api/clientes?busca=' + encodeURIComponent(termo));
      $('#n-res').innerHTML = lista.length
        ? `<table style="margin-bottom:16px"><tbody>${lista.map((c) => `<tr class="clicavel" data-c="${c.id}"><td><b>${esc(c.nome)}</b></td><td>${esc(c.telefone || '')}</td></tr>`).join('')}</tbody></table>`
        : '<p class="suave">Nenhum cliente encontrado. Preencha os dados abaixo para cadastrar.</p>';
      $$('[data-c]', $('#n-res')).forEach((tr) => (tr.onclick = () => clienteEscolhido(lista.find((c) => c.id === Number(tr.dataset.c)))));
    }, 300);
  };

  const montarHorario = () => {
    st.escolha = null;
    if (!st.loja) return ($('#n-horario').innerHTML = '<p class="suave">Escolha a unidade para ver os horários.</p>');
    seletorHorario($('#n-horario'), { lojaId: st.loja, aoEscolher: (e) => (st.escolha = e) });
  };
  if ($('#n-loja'))
    $('#n-loja').onchange = (e) => {
      st.loja = e.target.value ? Number(e.target.value) : null;
      montarHorario();
    };
  montarHorario();

  const f = $('#n-form');
  f.onsubmit = (e) => {
    e.preventDefault();
    tentar(f, async () => {
      if (!st.loja) throw new Error('Escolha a unidade.');
      if (!st.escolha) throw new Error('Escolha a data e o horário.');
      const corpo = { ...st.escolha, loja_id: st.loja, observacoes: dadosForm(f).observacoes };
      if (st.cliente) corpo.cliente_id = st.cliente.id;
      else {
        const nome = $('#c-nome').value.trim();
        if (!nome) throw new Error('Informe o nome do cliente.');
        corpo.cliente = { nome, telefone: $('#c-tel').value.trim(), email: $('#c-email').value.trim() };
      }
      const ag = await api('POST', '/api/agendamentos', corpo);
      el.innerHTML = `<div class="cartao" style="max-width:560px">
        <div class="confirmado-icone">${icone('ok')}</div>
        <h1>Agendamento confirmado</h1>
        <dl class="detalhe">
          <dt>Cliente</dt><dd>${esc(ag.cliente_nome)}</dd>
          <dt>Quando</dt><dd>${diaSemana(ag.data)}, ${dataBR(ag.data)} às ${ag.hora}</dd>
          <dt>Unidade</dt><dd>${esc(ag.loja_nome)}</dd>
        </dl>
        <div class="acoes"><a class="btn" href="#/inicio">Ir para o início</a><button class="btn sec" id="outro">Novo agendamento</button></div>
      </div>`;
      $('#outro').onclick = () => TELAS.novo(el);
    });
  };
};

// ---------- Relatórios ----------
TELAS.relatorios = async (el) => {
  el.innerHTML = `
    <div class="cabeca"><div><h1>Relatórios</h1><p class="suave">Comparecimento por período, unidade e origem</p></div></div>
    <div class="cartao"><div class="linha">
      <label>De<input type="date" id="ini" value="${somarDias(hoje(), -30)}"></label>
      <label>Até<input type="date" id="fim" value="${hoje()}"></label>
    </div></div>
    <div id="res"></div>`;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const carregar = async () => {
    const q = new URLSearchParams({ inicio: $('#ini').value, fim: $('#fim').value });
    if (unidadeAtual()) q.set('loja_id', unidadeAtual());
    const r = await api('GET', '/api/relatorios/resumo?' + q);
    const g = r.geral;
    const tabela = (titulo, linhas, nome) => `
      <div class="cartao tabela-rolagem"><h2>${titulo}</h2>${
        linhas.length
          ? `<table><thead><tr><th>${nome}</th><th>Agendados</th><th>Compareceram</th><th>Não compareceram</th><th>Cancelados</th><th>Comparecimento</th></tr></thead><tbody>
            ${linhas.map((l) => `<tr><td>${esc(l.nome)}</td><td>${l.total}</td><td>${l.compareceu}</td><td>${l.faltou}</td><td>${l.cancelado}</td><td><b>${pct(l.compareceu, l.compareceu + l.faltou)}</b></td></tr>`).join('')}</tbody></table>`
          : vazio('Sem dados no período.')
      }</div>`;
    $('#res').innerHTML = `
      <div class="metricas">
        <div class="metrica destaque"><b>${pct(g.compareceu, g.compareceu + g.faltou)}</b><span>Taxa de comparecimento</span></div>
        <div class="metrica t-neutro"><b>${g.total}</b><span>Agendamentos</span></div>
        <div class="metrica t-ok"><b>${g.compareceu || 0}</b><span>Compareceram</span></div>
        <div class="metrica t-falta"><b>${g.faltou || 0}</b><span>Não compareceram</span></div>
        <div class="metrica t-neutro"><b>${g.cancelado || 0}</b><span>Cancelados</span></div>
        <div class="metrica t-espera"><b>${(g.agendado || 0) + (g.confirmado || 0)}</b><span>Sem registro de presença</span></div>
      </div>
      ${!unidadeAtual() ? tabela('Por unidade', r.por_unidade, 'Unidade') : ''}
      ${tabela('Por origem', r.por_origem.map((o) => ({ ...o, nome: o.origem === 'crm' ? 'CRM (Datacrazy)' : 'Sistema' })), 'Origem')}`;
  };
  $$('#ini, #fim').forEach((x) => (x.onchange = carregar));
  carregar();
};

// ---------- Configurações ----------
const ABAS = [
  ['unidades', 'Unidades', () => pode('unidades')],
  ['usuarios', 'Usuários', () => pode('usuarios')],
  ['horarios', 'Horários', () => pode('horarios')],
  ['integracao', 'Integração CRM', () => pode('integracao')],
  ['logs', 'Logs', () => pode('logs')],
];
const CONFIG = {};

TELAS.configuracoes = (el, sub) => {
  const abas = ABAS.filter(([, , ok]) => ok());
  const atual = abas.some(([id]) => id === sub) ? sub : abas[0][0];
  el.innerHTML = `<div class="cabeca"><div><h1>Configurações</h1><p class="suave">Unidades, acessos, horários e integração</p></div></div>
    <nav class="abas">${abas.map(([id, nome]) => `<a href="#/configuracoes/${id}" class="${id === atual ? 'ativo' : ''}">${nome}</a>`).join('')}</nav>
    <div id="aba"></div>`;
  CONFIG[atual]($('#aba'));
};

// Unidades
CONFIG.unidades = async (el) => {
  const lojas = await api('GET', '/api/lojas?todas=1');
  el.innerHTML = `
    <div class="cartao tabela-rolagem">
      <div class="cabeca"><p class="suave" style="margin:0">Cada unidade tem o seu próprio acesso e só enxerga os próprios agendamentos.</p><button class="btn" id="nova">+ Nova unidade</button></div>
      ${
        lojas.length
          ? `<table><thead><tr><th>Unidade</th><th class="esconder-celular">Endereço</th><th>Atendimento</th><th>Situação</th></tr></thead>
        <tbody>${lojas
          .map(
            (l) => `<tr class="clicavel ${l.ativa ? '' : 'inativo'}" data-id="${l.id}"><td><b>${esc(l.nome)}</b><br><span class="suave">${esc(l.telefone || '')}</span></td>
            <td class="esconder-celular">${esc(l.endereco || '')}<br><span class="suave">${esc(l.cidade || '')}</span></td>
            <td>${l.duracao_consulta} min · ${l.vagas_por_horario} vaga(s) por horário</td><td>${l.ativa ? 'Ativa' : 'Inativa'}</td></tr>`
          )
          .join('')}</tbody></table>`
          : vazio('Nenhuma unidade cadastrada.')
      }
    </div>`;
  const recarregar = async () => {
    estado.lojas = await api('GET', '/api/lojas');
    renderizar();
  };
  $('#nova', el).onclick = () => formUnidade({}, recarregar);
  $$('tr[data-id]', el).forEach((tr) => (tr.onclick = () => formUnidade(lojas.find((l) => l.id === Number(tr.dataset.id)), recarregar)));
};

function formUnidade(l, aoSalvar) {
  const nova = !l.id;
  const m = abrirModal(`
    <h2>${nova ? 'Nova unidade' : 'Editar unidade'}</h2>
    <form id="fl">
      <label>Nome<input name="nome" required value="${esc(l.nome || '')}" placeholder="Ex.: Óticas Diniz Aventureiro"></label>
      <label>Endereço<input name="endereco" value="${esc(l.endereco || '')}"></label>
      <div class="linha"><label>Cidade<input name="cidade" value="${esc(l.cidade || '')}"></label><label>Telefone<input name="telefone" value="${esc(l.telefone || '')}"></label></div>
      ${
        nova
          ? `<div class="linha">
              <label>Abre às<input name="hora_abertura" type="time" required value="09:00"></label>
              <label>Fecha às<input name="hora_fechamento" type="time" required value="18:00"></label>
              <label>Duração (min)<input name="duracao_consulta" type="number" min="5" max="240" step="5" required value="30"></label>
              <label>Vagas por horário<input name="vagas_por_horario" type="number" min="1" max="50" required value="1"></label>
            </div>
            <h3>Acesso da unidade</h3>
            <p class="suave">Obrigatório. É com este e-mail e senha que a unidade entra no sistema.</p>
            <div class="linha">
              <label>E-mail de acesso<input name="acesso_email" type="email" required autocomplete="off"></label>
              <label>Senha (mín. 8)<input name="acesso_senha" type="password" minlength="8" required autocomplete="new-password"></label>
            </div>
            <label class="check"><input type="checkbox" name="acesso_pode_agendar"> Liberar criação de agendamentos para este acesso</label>`
          : `<label class="check"><input type="checkbox" name="ativa" ${l.ativa === 0 ? '' : 'checked'}> Unidade ativa</label>
             <p class="suave">Horários, vagas e responsáveis desta unidade ficam nas abas Horários e Usuários.</p>`
      }
      <p class="erro"></p>
      <button class="btn" type="submit">Salvar</button>
    </form>`);
  const f = $('#fl', m);
  f.onsubmit = (e) => {
    e.preventDefault();
    tentar(f, async () => {
      const d = dadosForm(f);
      if (nova) {
        d.duracao_consulta = Number(d.duracao_consulta);
        d.vagas_por_horario = Number(d.vagas_por_horario);
        d.acesso_pode_agendar = !!$('[name=acesso_pode_agendar]', f).checked;
      } else d.ativa = $('[name=ativa]', f).checked;
      await api(nova ? 'POST' : 'PUT', nova ? '/api/lojas' : `/api/lojas/${l.id}`, d);
      avisar('Unidade salva.');
      fecharModal();
      aoSalvar();
    });
  };
}

// Usuários
const ROTULOS = { admin: 'Administrador', gerente: 'Gerente da unidade', atendente: 'Recepção' };
const perfisPermitidos = () => (estado.usuario.principal ? ['admin', 'gerente', 'atendente'] : ehAdmin() ? ['gerente', 'atendente'] : ['atendente']);

CONFIG.usuarios = async (el) => {
  const q = unidadeAtual() && ehAdmin() ? `?loja_id=${unidadeAtual()}` : '';
  const lista = await api('GET', '/api/usuarios' + q);
  el.innerHTML = `
    <div class="cartao tabela-rolagem">
      <div class="cabeca"><p class="suave" style="margin:0">${ehAdmin() ? 'Defina quem é administrador, gerente ou recepção de cada unidade, e quem pode criar agendamentos.' : 'Responsáveis pela sua unidade.'}</p>
        <button class="btn" id="novo">+ Novo usuário</button></div>
      <table><thead><tr><th>Nome</th><th class="esconder-celular">E-mail</th><th>Perfil</th><th>Unidade</th><th>Pode agendar</th><th>Situação</th></tr></thead>
      <tbody>${lista
        .map(
          (u) => `<tr class="${u.editavel ? 'clicavel' : ''} ${u.ativo ? '' : 'inativo'}" data-id="${u.id}"><td><b>${esc(u.nome)}</b></td>
          <td class="esconder-celular">${esc(u.email)}</td><td>${esc(u.perfil_rotulo)}</td><td>${u.loja_id ? esc(nomeLoja(u.loja_id)) : 'Todas'}</td>
          <td>${ehAdmin() && u.editavel && u.perfil !== 'admin' ? `<label class="check" style="margin:0"><input type="checkbox" data-pode="${u.id}" ${u.pode_agendar ? 'checked' : ''}> ${u.pode_agendar ? 'Sim' : 'Não'}</label>` : u.pode_agendar ? 'Sim' : 'Não'}</td>
          <td>${u.ativo ? 'Ativo' : 'Inativo'}</td></tr>`
        )
        .join('')}</tbody></table>
    </div>`;
  const recarregar = () => CONFIG.usuarios(el);
  $('#novo', el).onclick = () => formUsuario({ perfil: 'atendente', loja_id: unidadeAtual() || null }, recarregar);
  $$('tr.clicavel', el).forEach((tr) => (tr.onclick = (e) => !e.target.closest('label') && formUsuario(lista.find((u) => u.id === Number(tr.dataset.id)), recarregar)));
  $$('[data-pode]', el).forEach(
    (c) =>
      (c.onchange = async () => {
        try {
          await api('PUT', `/api/usuarios/${c.dataset.pode}`, { pode_agendar: c.checked });
          avisar(c.checked ? 'Criação de agendamentos liberada.' : 'Criação de agendamentos bloqueada.');
          recarregar();
        } catch (e) {
          avisar(e.message, true);
        }
      })
  );
};

function formUsuario(u, aoSalvar) {
  const novo = !u.id;
  const perfis = perfisPermitidos();
  const m = abrirModal(`
    <h2>${novo ? 'Novo usuário' : 'Editar ' + esc(u.nome)}</h2>
    <form id="fu">
      <label>Nome<input name="nome" required value="${esc(u.nome || '')}"></label>
      <div class="linha"><label>E-mail<input name="email" type="email" required value="${esc(u.email || '')}"></label>
      <label>Telefone<input name="telefone" value="${esc(u.telefone || '')}"></label></div>
      <div class="linha">
        <label>Perfil<select name="perfil">${perfis.map((p) => `<option value="${p}" ${p === u.perfil ? 'selected' : ''}>${ROTULOS[p]}</option>`).join('')}</select></label>
        ${ehAdmin() ? `<label id="campo-loja">Unidade<select name="loja_id"><option value="">—</option>${estado.lojas.map((l) => `<option value="${l.id}" ${l.id === u.loja_id ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}</select></label>` : ''}
      </div>
      ${ehAdmin() ? `<label class="check" id="campo-pode"><input type="checkbox" name="pode_agendar" ${u.pode_agendar ? 'checked' : ''}> Pode criar, remarcar e cancelar agendamentos</label>` : ''}
      <label>${novo ? 'Senha inicial (mín. 8)' : 'Nova senha (em branco mantém a atual)'}<input name="senha" type="password" minlength="8" ${novo ? 'required' : ''} autocomplete="new-password"></label>
      ${!novo ? `<label class="check"><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''}> Acesso ativo</label>` : ''}
      <p class="erro"></p>
      <button class="btn" type="submit">Salvar</button>
    </form>`);
  const f = $('#fu', m);
  const ajustar = () => {
    const admin = $('[name=perfil]', f).value === 'admin';
    if ($('#campo-loja', f)) $('#campo-loja', f).hidden = admin;
    if ($('#campo-pode', f)) $('#campo-pode', f).hidden = admin;
  };
  $('[name=perfil]', f).onchange = ajustar;
  ajustar();
  f.onsubmit = (e) => {
    e.preventDefault();
    tentar(f, async () => {
      const d = dadosForm(f);
      if (ehAdmin()) d.pode_agendar = !!$('[name=pode_agendar]', f).checked;
      if (!novo) d.ativo = !!$('[name=ativo]', f).checked;
      if (!d.senha) delete d.senha;
      await api(novo ? 'POST' : 'PUT', novo ? '/api/usuarios' : `/api/usuarios/${u.id}`, d);
      avisar('Usuário salvo.');
      fecharModal();
      aoSalvar();
    });
  };
}

// Horários da unidade e bloqueios
CONFIG.horarios = async (el) => {
  const lojaId = unidadeAtual() || estado.lojas[0]?.id;
  if (!lojaId) return (el.innerHTML = `<div class="cartao">${vazio('Cadastre uma unidade primeiro.')}</div>`);
  const [{ loja, horarios }, bloqueios] = await Promise.all([api('GET', `/api/lojas/${lojaId}/horarios`), api('GET', `/api/bloqueios?loja_id=${lojaId}`)]);
  const doDia = (d) => horarios.find((h) => h.dia_semana === d);
  el.innerHTML = `
    ${ehAdmin() && !unidadeAtual() ? `<p class="suave">Mostrando <b>${esc(loja.nome)}</b>. Escolha outra unidade no topo da página.</p>` : ''}
    <div class="cartao">
      <h2>Horário de atendimento · ${esc(loja.nome)}</h2>
      <form id="fh">
        <table class="semana"><tbody>
          ${DIAS.map((nome, d) => {
            const h = doDia(d);
            return `<tr><td><label class="check" style="margin:0"><input type="checkbox" data-aberto="${d}" ${h ? 'checked' : ''}> ${nome}</label></td>
              <td><input type="time" data-ini="${d}" value="${h?.hora_inicio || loja.hora_abertura}"></td>
              <td><input type="time" data-fim="${d}" value="${h?.hora_fim || loja.hora_fechamento}"></td></tr>`;
          }).join('')}
        </tbody></table>
        <div class="linha" style="margin-top:12px">
          <label>Duração de cada atendimento (min)<input name="duracao_consulta" type="number" min="5" max="240" step="5" value="${loja.duracao_consulta}"></label>
          <label>Vagas por horário<input name="vagas_por_horario" type="number" min="1" max="50" value="${loja.vagas_por_horario}"></label>
          <div class="fixo" style="margin-bottom:12px"><button class="btn" type="submit">Salvar horários</button></div>
        </div>
        <p class="erro"></p>
      </form>
    </div>
    <div class="cartao tabela-rolagem">
      <h2>Feriados e fechamentos</h2>
      ${
        bloqueios.length
          ? `<table><thead><tr><th>Data</th><th>Horário</th><th>Motivo</th><th></th></tr></thead><tbody>
        ${bloqueios.map((b) => `<tr><td>${dataBR(b.data)}</td><td>${b.hora_inicio === '00:00' && b.hora_fim === '23:59' ? 'Dia todo' : `${b.hora_inicio}–${b.hora_fim}`}</td><td>${esc(b.motivo || '')}</td>
          <td><button class="btn sec peq" data-del="${b.id}">Remover</button></td></tr>`).join('')}</tbody></table>`
          : '<p class="suave">Nenhum fechamento futuro.</p>'
      }
      <form id="fb" style="margin-top:12px"><div class="linha">
        <label>Data<input type="date" name="data" min="${hoje()}" required></label>
        <label>Início<input type="time" name="hora_inicio"></label>
        <label>Fim<input type="time" name="hora_fim"></label>
        <label>Motivo<input name="motivo" placeholder="Feriado, inventário…"></label>
        <div class="fixo" style="margin-bottom:12px"><button class="btn" type="submit">Fechar agenda</button></div>
      </div><p class="suave">Deixe início e fim em branco para fechar o dia inteiro.</p><p class="erro"></p></form>
    </div>`;
  const recarregar = () => CONFIG.horarios(el);
  const fh = $('#fh', el);
  fh.onsubmit = (e) => {
    e.preventDefault();
    tentar(fh, async () => {
      const lista = DIAS.map((_, d) => d)
        .filter((d) => $(`[data-aberto="${d}"]`, fh).checked)
        .map((d) => ({ dia_semana: d, hora_inicio: $(`[data-ini="${d}"]`, fh).value, hora_fim: $(`[data-fim="${d}"]`, fh).value }));
      const d = dadosForm(fh);
      await api('PUT', `/api/lojas/${lojaId}/horarios`, { horarios: lista, duracao_consulta: Number(d.duracao_consulta), vagas_por_horario: Number(d.vagas_por_horario) });
      avisar('Horários salvos.');
    });
  };
  const fb = $('#fb', el);
  fb.onsubmit = (e) => {
    e.preventDefault();
    tentar(fb, async () => {
      const d = dadosForm(fb);
      if (!d.hora_inicio) delete d.hora_inicio;
      if (!d.hora_fim) delete d.hora_fim;
      const r = await api('POST', '/api/bloqueios', { ...d, loja_id: lojaId });
      if (r.agendamentos_afetados.length)
        alert(`Atenção: ${r.agendamentos_afetados.length} agendamento(s) nesse período precisam ser remarcados:\n` + r.agendamentos_afetados.map((a) => `${a.hora} - ${a.cliente_nome}`).join('\n'));
      avisar('Agenda fechada nesse período.');
      recarregar();
    });
  };
  $$('[data-del]', el).forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api('DELETE', `/api/bloqueios/${b.dataset.del}`, {});
          recarregar();
        } catch (e) {
          avisar(e.message, true);
        }
      })
  );
};

// Integração com o CRM
CONFIG.integracao = async (el) => {
  const c = await api('GET', '/api/integracao');
  const exemplo = JSON.stringify(
    { id: 'id-do-negocio-no-crm', lead: { id: 'id-do-lead', name: 'Nome do cliente', phone: '(47) 99999-0000' }, unidade: 'Aventureiro', data: '30/10/2026', hora: '14:30' },
    null,
    2
  );
  el.innerHTML = `
    <div class="cartao">
      <h2>1. Receber agendamentos do CRM (Datacrazy → sistema)</h2>
      <p class="suave">No Datacrazy, crie uma automação que envie um <b>webhook (POST)</b> para o endereço abaixo quando um agendamento for feito. Se o mesmo negócio for enviado de novo, o agendamento é atualizado, não duplicado. Envie <code>"status": "cancelado"</code> para cancelar.</p>
      <label>Endereço do webhook (mantenha em sigilo)</label>
      <code class="bloco" id="url-entrada">${esc(c.url_entrada)}</code>
      <div class="acoes" style="margin:10px 0 14px"><button class="btn sec peq" id="copiar">Copiar endereço</button><button class="btn sec peq" id="novo-token">Gerar novo endereço</button></div>
      <details><summary>Exemplo do que enviar</summary><code class="bloco">${esc(exemplo)}</code>
        <p class="suave">A unidade pode ser o nome (ou parte dele) ou o código da unidade. A data aceita 30/10/2026 ou 2026-10-30, e a hora pode vir junto (2026-10-30T14:30).</p></details>
    </div>
    <div class="cartao">
      <h2>2. Avisar o CRM (sistema → Datacrazy)</h2>
      <p class="suave">A cada agendamento criado, remarcado, cancelado ou com presença marcada aqui, o sistema envia um POST para este endereço (ex.: o webhook de entrada de uma automação do Datacrazy).</p>
      <form id="fs">
        <label>URL que recebe os eventos<input name="saida_url" placeholder="https://..." value="${esc(c.saida_url)}"></label>
        <label>Token enviado no cabeçalho X-Webhook-Token (opcional)<input name="saida_token" placeholder="${c.saida_token_definido ? '•••••• (definido; preencha para trocar)' : ''}" autocomplete="off"></label>
        <p class="erro"></p>
        <div class="acoes"><button class="btn" type="submit">Salvar</button><button class="btn sec" type="button" id="testar">Enviar teste</button></div>
      </form>
    </div>
    <div class="cartao tabela-rolagem">
      <h2>Últimos eventos</h2>
      ${
        c.eventos.length
          ? `<table><thead><tr><th>Quando (UTC)</th><th>Direção</th><th>Evento</th><th>Resultado</th><th class="esconder-celular">Detalhe</th></tr></thead><tbody>
        ${c.eventos.map((e) => `<tr><td>${esc(e.criado_em)}</td><td>${e.direcao === 'entrada' ? 'CRM → sistema' : 'sistema → CRM'}</td><td>${esc(e.evento)}</td>
          <td>${e.sucesso ? '✓ ok' : '✗ falhou'}</td><td class="esconder-celular suave" style="max-width:380px;word-break:break-word">${esc(e.detalhe)}</td></tr>`).join('')}</tbody></table>`
          : '<p class="suave">Nenhum evento ainda.</p>'
      }
    </div>`;
  const recarregar = () => CONFIG.integracao(el);
  $('#copiar', el).onclick = async () => {
    try {
      await navigator.clipboard.writeText(c.url_entrada);
      avisar('Endereço copiado.');
    } catch {
      avisar('Selecione e copie o endereço manualmente.', true);
    }
  };
  $('#novo-token', el).onclick = async () => {
    if (!confirm('O endereço atual vai parar de funcionar. Continuar?')) return;
    await api('POST', '/api/integracao/novo-token', {});
    recarregar();
  };
  const fs = $('#fs', el);
  fs.onsubmit = (e) => {
    e.preventDefault();
    tentar(fs, async () => {
      const d = dadosForm(fs);
      if (!d.saida_token) delete d.saida_token;
      await api('PUT', '/api/integracao', d);
      avisar('Integração salva.');
      recarregar();
    });
  };
  $('#testar', el).onclick = async () => {
    try {
      const r = await api('POST', '/api/integracao/testar', {});
      avisar(r.enviado ? 'Teste enviado com sucesso.' : `O CRM não aceitou o teste${r.status ? ` (HTTP ${r.status})` : ''}.`, !r.enviado);
      recarregar();
    } catch (e) {
      avisar(e.message, true);
    }
  };
};

// Logs (somente administrador principal)
CONFIG.logs = async (el) => {
  const lista = await api('GET', '/api/auditoria');
  el.innerHTML = `<div class="cartao tabela-rolagem"><p class="suave">Últimas 500 ações registradas. Visível somente para o administrador principal.</p>
    <table><thead><tr><th>Quando (UTC)</th><th>Usuário</th><th>Ação</th><th>Registro</th><th class="esconder-celular">Detalhes</th></tr></thead><tbody>
    ${lista.map((x) => `<tr><td>${esc(x.criado_em)}</td><td>${esc(x.usuario_nome || (x.acao.endsWith('_crm') ? 'CRM' : '—'))}</td><td>${esc(x.acao)}</td><td>${esc(x.entidade || '')} ${x.entidade_id ?? ''}</td>
      <td class="esconder-celular suave" style="max-width:380px;word-break:break-word">${esc(x.detalhes || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
};

// ---------- Meu perfil ----------
TELAS.perfil = (el) => {
  const u = estado.usuario;
  el.innerHTML = `
    <div class="cabeca"><div><h1>Meu perfil</h1></div></div>
    <div class="cartao" style="max-width:560px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px"><span class="avatar" style="width:48px;height:48px;font-size:1rem">${esc(iniciais(u.nome))}</span><div><b>${esc(u.nome)}</b><p class="suave" style="margin:0">${esc(u.perfil_rotulo)}${estado.loja ? ' · ' + esc(estado.loja.nome) : ''} · ${esc(u.email)}</p></div></div>
      <form id="fp">
        <label>Nome<input name="nome" required value="${esc(u.nome)}"></label>
        <label>Telefone<input name="telefone" value="${esc(u.telefone || '')}"></label>
        <h3>Trocar senha</h3>
        <div class="linha"><label>Senha atual<input type="password" name="senha_atual" autocomplete="current-password"></label>
        <label>Nova senha<input type="password" name="nova_senha" minlength="8" autocomplete="new-password"></label></div>
        <p class="erro"></p>
        <div class="acoes"><button class="btn" type="submit">Salvar</button><button class="btn sec" type="button" data-sair>${icone('sair')} Sair</button></div>
      </form>
    </div>`;
  const f = $('#fp');
  f.onsubmit = (e) => {
    e.preventDefault();
    tentar(f, async () => {
      const r = await api('PUT', '/api/perfil', dadosForm(f));
      estado.usuario = r.usuario;
      avisar('Dados atualizados.');
      renderizar();
    });
  };
};

iniciar();
