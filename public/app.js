'use strict';

// ---------- Utilidades ----------
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const STATUS = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  em_atendimento: 'Em atendimento',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  faltou: 'Não compareceu',
};
const selo = (s) => `<span class="selo st-${s}">${STATUS[s] || s}</span>`;

const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const somarDias = (iso, n) => {
  const [a, m, d] = iso.split('-').map(Number);
  const x = new Date(a, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const dataBR = (iso) => {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
};
const diaSemana = (iso) => {
  const [a, m, d] = iso.split('-').map(Number);
  return DIAS[new Date(a, m - 1, d).getDay()];
};

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
  el.className = 'aviso' + (ruim ? ' ruim' : '');
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

// Executa uma ação de formulário mostrando erro no próprio formulário
async function tentar(form, fn) {
  const erro = $('.erro', form);
  const botao = $('button[type=submit]', form);
  if (erro) erro.textContent = '';
  if (botao) botao.disabled = true;
  try {
    await fn();
  } catch (e) {
    if (erro) erro.textContent = e.message;
    else avisar(e.message, true);
  } finally {
    if (botao) botao.disabled = false;
  }
}

// ---------- Estado e navegação ----------
const estado = { usuario: null, loja: null, permissoes: [], lojas: [] };
const pode = (p) => estado.permissoes.includes(p);
const perfil = () => estado.usuario?.perfil;

const MENUS = {
  admin: [['agenda', 'Agenda'], ['novo', 'Novo agendamento'], ['clientes', 'Clientes'], ['usuarios', 'Usuários'], ['lojas', 'Lojas'], ['horarios', 'Horários'], ['relatorios', 'Relatórios'], ['auditoria', 'Auditoria']],
  gerente: [['agenda', 'Agenda da loja'], ['novo', 'Novo agendamento'], ['clientes', 'Clientes'], ['usuarios', 'Equipe'], ['horarios', 'Horários'], ['relatorios', 'Relatórios']],
  atendente: [['agenda', 'Agenda da loja'], ['novo', 'Novo agendamento'], ['clientes', 'Clientes']],
  optometrista: [['agenda', 'Minha agenda'], ['horarios', 'Meus horários']],
  cliente: [['novo', 'Agendar exame'], ['meus', 'Meus agendamentos'], ['exames', 'Meus exames']],
};

const TELAS = {};

function rotaAtual() {
  const r = location.hash.replace('#/', '') || '';
  const menu = MENUS[perfil()] || [];
  if (r === 'perfil' || menu.some(([id]) => id === r)) return r;
  return menu[0][0];
}

async function iniciar() {
  const me = await api('GET', '/api/auth/me').catch(() => ({ usuario: null }));
  if (!me.usuario) {
    estado.usuario = null;
    return telaEntrada();
  }
  Object.assign(estado, { usuario: me.usuario, loja: me.loja, permissoes: me.permissoes });
  estado.lojas = await api('GET', '/api/lojas');
  renderizar();
}

function renderizar() {
  const rota = rotaAtual();
  const u = estado.usuario;
  $('#app').innerHTML = `
    <header class="topo">
      <div class="marca">Óticas Diniz<small>Agendamento de exames de vista</small></div>
      <nav>${MENUS[u.perfil].map(([id, nome]) => `<a href="#/${id}" class="${id === rota ? 'ativo' : ''}">${nome}</a>`).join('')}</nav>
      <div class="quem">
        <a href="#/perfil" style="color:#fff">${esc(u.nome)}</a><br>
        <span style="opacity:.8">${esc(u.perfil_rotulo)}${estado.loja ? ' · ' + esc(estado.loja.nome) : ''}</span>
        <button class="btn sec peq" id="sair">Sair</button>
      </div>
    </header>
    <main id="tela"></main>`;
  $('#sair').onclick = async () => {
    await api('POST', '/api/auth/logout', {});
    estado.usuario = null;
    location.hash = '';
    telaEntrada();
  };
  TELAS[rota]($('#tela'));
}
window.addEventListener('hashchange', () => estado.usuario && renderizar());

// ---------- Entrada / cadastro ----------
function telaEntrada(modo = 'login') {
  $('#app').innerHTML = `
    <div class="entrada"><div class="cartao">
      <div class="marca">Óticas Diniz<small style="color:var(--texto-suave)">Agendamento de exames de vista</small></div>
      ${
        modo === 'login'
          ? `<form id="f">
          <label>E-mail<input name="email" type="email" required autocomplete="username"></label>
          <label>Senha<input name="senha" type="password" required autocomplete="current-password"></label>
          <p class="erro"></p>
          <button class="btn" type="submit" style="width:100%">Entrar</button>
          <p class="suave" style="text-align:center">Ainda não tem conta? <a href="#" id="trocar">Cadastre-se para agendar</a></p>
        </form>
        <div class="demo"><b>Acessos de demonstração</b> (senha <code>diniz123</code>):<br>
          <code>admin@diniz.com</code> · <code>gerente.centro@diniz.com</code><br>
          <code>atendente.centro@diniz.com</code> · <code>ana@diniz.com</code><br>
          <code>cliente@exemplo.com</code></div>`
          : `<form id="f">
          <h2>Criar conta</h2>
          <label>Nome completo<input name="nome" required></label>
          <label>E-mail<input name="email" type="email" required autocomplete="username"></label>
          <div class="linha"><label>Celular / WhatsApp<input name="telefone" required></label><label>CPF<input name="cpf" inputmode="numeric"></label></div>
          <label>Data de nascimento<input name="data_nascimento" type="date"></label>
          <label>Senha (mín. 8 caracteres)<input name="senha" type="password" minlength="8" required autocomplete="new-password"></label>
          <p class="erro"></p>
          <button class="btn" type="submit" style="width:100%">Criar conta e agendar</button>
          <p class="suave" style="text-align:center"><a href="#" id="trocar">Já tenho conta</a></p>
        </form>`
      }
    </div></div>`;
  $('#trocar').onclick = (e) => {
    e.preventDefault();
    telaEntrada(modo === 'login' ? 'cadastro' : 'login');
  };
  const f = $('#f');
  f.onsubmit = (e) => {
    e.preventDefault();
    tentar(f, async () => {
      await api('POST', modo === 'login' ? '/api/auth/login' : '/api/auth/cadastro', dadosForm(f));
      location.hash = '';
      iniciar();
    });
  };
}

// ---------- Agenda (equipe) ----------
TELAS.agenda = async (el) => {
  const p = perfil();
  const prefs = (TELAS.agenda.prefs ||= { data: hoje(), loja: '', dias: 1 });
  el.innerHTML = `
    <div class="cartao">
      <div class="linha">
        <label>Data<input type="date" id="f-data" value="${prefs.data}"></label>
        <label>Período<select id="f-dias"><option value="1">Só o dia</option><option value="7">7 dias</option><option value="30">30 dias</option></select></label>
        ${p === 'admin' ? `<label>Loja<select id="f-loja"><option value="">Todas</option>${estado.lojas.map((l) => `<option value="${l.id}">${esc(l.nome)}</option>`).join('')}</select></label>` : ''}
        ${p !== 'optometrista' ? `<label>Optometrista<select id="f-opt"><option value="">Todos</option></select></label>` : ''}
        <label>Status<select id="f-status"><option value="">Todos</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <div class="fixo acoes" style="margin-bottom:12px">
          <button class="btn sec" id="ant" title="Dia anterior">‹</button>
          <button class="btn sec" id="hoje">Hoje</button>
          <button class="btn sec" id="prox" title="Próximo dia">›</button>
        </div>
      </div>
    </div>
    <div id="metr" class="metricas"></div>
    <div class="cartao tabela-rolagem" id="lista"></div>`;
  $('#f-dias').value = prefs.dias;
  if ($('#f-loja')) $('#f-loja').value = prefs.loja;

  if ($('#f-opt')) {
    const lojaId = p === 'admin' ? prefs.loja : estado.usuario.loja_id;
    const opts = await api('GET', '/api/optometristas' + (lojaId ? `?loja_id=${lojaId}` : ''));
    $('#f-opt').innerHTML += opts.map((o) => `<option value="${o.id}">${esc(o.nome)}</option>`).join('');
  }

  const carregar = async () => {
    prefs.data = $('#f-data').value || hoje();
    prefs.dias = Number($('#f-dias').value);
    if ($('#f-loja')) prefs.loja = $('#f-loja').value;
    const q = new URLSearchParams({ data_inicio: prefs.data, data_fim: somarDias(prefs.data, prefs.dias - 1) });
    if (prefs.loja && p === 'admin') q.set('loja_id', prefs.loja);
    if ($('#f-opt')?.value) q.set('optometrista_id', $('#f-opt').value);
    if ($('#f-status').value) q.set('status', $('#f-status').value);
    const lista = await api('GET', '/api/agendamentos?' + q);
    const conta = (s) => lista.filter((a) => s.includes(a.status)).length;
    $('#metr').innerHTML = [
      ['Marcados', lista.filter((a) => a.status !== 'cancelado').length],
      ['Confirmados', conta(['confirmado'])],
      ['Concluídos', conta(['concluido'])],
      ['Faltas', conta(['faltou'])],
      ['Cancelados', conta(['cancelado'])],
    ].map(([n, v]) => `<div class="metrica"><b>${v}</b><span>${n}</span></div>`).join('');
    $('#lista').innerHTML = lista.length
      ? `<table><thead><tr>${prefs.dias > 1 ? '<th>Data</th>' : ''}<th>Hora</th><th>Cliente</th><th class="esconder-celular">Telefone</th>
          ${p !== 'optometrista' ? '<th class="esconder-celular">Optometrista</th>' : ''}${p === 'admin' ? '<th class="esconder-celular">Loja</th>' : ''}<th>Status</th></tr></thead>
        <tbody>${lista
          .map(
            (a) => `<tr class="clicavel" data-id="${a.id}">${prefs.dias > 1 ? `<td>${dataBR(a.data)}</td>` : ''}<td><b>${a.hora}</b></td>
            <td>${esc(a.cliente_nome)}</td><td class="esconder-celular">${esc(a.cliente_telefone || '')}</td>
            ${p !== 'optometrista' ? `<td class="esconder-celular">${esc(a.optometrista_nome)}</td>` : ''}${p === 'admin' ? `<td class="esconder-celular">${esc(a.loja_nome)}</td>` : ''}
            <td>${selo(a.status)}</td></tr>`
          )
          .join('')}</tbody></table>`
      : `<div class="vazio">Nenhum agendamento neste período.</div>`;
    $$('#lista tr[data-id]').forEach((tr) => (tr.onclick = () => detalheAgendamento(Number(tr.dataset.id), carregar)));
  };

  $$('#f-data, #f-dias, #f-opt, #f-status').forEach((x) => x && (x.onchange = carregar));
  if ($('#f-loja')) $('#f-loja').onchange = () => { prefs.loja = $('#f-loja').value; TELAS.agenda(el); };
  const mover = (n) => { $('#f-data').value = somarDias($('#f-data').value || hoje(), n); carregar(); };
  $('#ant').onclick = () => mover(-1);
  $('#prox').onclick = () => mover(1);
  $('#hoje').onclick = () => { $('#f-data').value = hoje(); carregar(); };
  carregar();
};

// Ações disponíveis para cada perfil, conforme o status atual
function acoesPara(a) {
  const p = perfil();
  const ehHoje = a.data === hoje();
  const passou = new Date(`${a.data}T${a.hora}`) < new Date();
  const aberto = ['agendado', 'confirmado'].includes(a.status);
  const r = [];
  if (a.status === 'agendado' && ['admin', 'gerente', 'atendente', 'cliente'].includes(p)) r.push(['confirmado', 'Confirmar presença', 'btn sec']);
  if (aberto && ehHoje && ['admin', 'gerente', 'optometrista'].includes(p)) r.push(['em_atendimento', 'Iniciar atendimento', 'btn']);
  if (a.status === 'em_atendimento' && ['admin', 'optometrista'].includes(p)) r.push(['concluido', 'Concluir atendimento', 'btn']);
  if (aberto && ['admin', 'gerente', 'atendente', 'cliente'].includes(p)) r.push(['remarcar', 'Remarcar', 'btn sec']);
  if (aberto && passou && ['admin', 'gerente', 'atendente', 'optometrista'].includes(p)) r.push(['faltou', 'Marcar falta', 'btn sec']);
  if (aberto && ['admin', 'gerente', 'atendente', 'cliente'].includes(p)) r.push(['cancelado', 'Cancelar', 'btn perigo']);
  const podeVerExame = pode('exames.ver') || pode('exames.proprios');
  if (podeVerExame && (a.tem_exame || (p === 'optometrista' && ['em_atendimento', 'concluido'].includes(a.status))))
    r.push(['exame', p === 'optometrista' ? 'Registrar / ver exame' : 'Ver resultado do exame', 'btn sec']);
  return r;
}

async function detalheAgendamento(id, aoMudar) {
  const a = await api('GET', `/api/agendamentos/${id}`);
  const m = abrirModal(`
    <h2>Exame de vista · ${dataBR(a.data)} às ${a.hora}</h2>
    <dl class="detalhe">
      <dt>Status</dt><dd>${selo(a.status)}</dd>
      <dt>Cliente</dt><dd>${esc(a.cliente_nome)}<br><span class="suave">${esc(a.cliente_telefone || '')} ${esc(a.cliente_email)}</span></dd>
      <dt>Loja</dt><dd>${esc(a.loja_nome)}<br><span class="suave">${esc(a.loja_endereco || '')}</span></dd>
      <dt>Optometrista</dt><dd>${esc(a.optometrista_nome)}</dd>
      <dt>Dia</dt><dd>${diaSemana(a.data)}, ${a.duracao} min</dd>
      ${a.observacoes ? `<dt>Observações</dt><dd>${esc(a.observacoes)}</dd>` : ''}
      ${a.motivo_cancelamento ? `<dt>Motivo do cancelamento</dt><dd>${esc(a.motivo_cancelamento)}</dd>` : ''}
    </dl>
    <div class="acoes">${acoesPara(a).map(([k, n, c]) => `<button class="${c}" data-acao="${k}">${n}</button>`).join('') || '<span class="suave">Nenhuma ação disponível.</span>'}</div>`);
  $$('[data-acao]', m).forEach(
    (b) =>
      (b.onclick = async () => {
        const acao = b.dataset.acao;
        if (acao === 'exame') return telaExame(a, aoMudar);
        if (acao === 'remarcar') return telaRemarcar(a, aoMudar);
        let motivo;
        if (acao === 'cancelado') {
          motivo = window.prompt('Motivo do cancelamento (opcional):', '');
          if (motivo === null) return;
        }
        try {
          await api('PATCH', `/api/agendamentos/${a.id}/status`, { status: acao, motivo });
          avisar('Agendamento atualizado.');
          if (acao === 'em_atendimento' && perfil() === 'optometrista') return telaExame({ ...a, status: 'em_atendimento' }, aoMudar);
          fecharModal();
          aoMudar && aoMudar();
        } catch (e) {
          avisar(e.message, true);
        }
      })
  );
}

const CAMPOS_OLHO = [['esferico', 'Esférico'], ['cilindrico', 'Cilíndrico'], ['eixo', 'Eixo'], ['acuidade', 'Acuidade']];

async function telaExame(a, aoMudar) {
  const ex = (await api('GET', `/api/agendamentos/${a.id}/exame`)) || {};
  const editavel = perfil() === 'optometrista' && ['em_atendimento', 'concluido'].includes(a.status);
  const campo = (n) => (editavel ? `<input name="${n}" value="${esc(ex[n] || '')}">` : esc(ex[n] || '—'));
  const m = abrirModal(`
    <h2>Resultado do exame</h2>
    <p class="suave">${esc(a.cliente_nome)} · ${dataBR(a.data)} · ${esc(a.optometrista_nome)}</p>
    <form id="fx">
      <table class="olhos"><thead><tr><th></th>${CAMPOS_OLHO.map(([, r]) => `<th>${r}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><th>OD</th>${CAMPOS_OLHO.map(([c]) => `<td>${campo('od_' + c)}</td>`).join('')}</tr>
          <tr><th>OE</th>${CAMPOS_OLHO.map(([c]) => `<td>${campo('oe_' + c)}</td>`).join('')}</tr>
        </tbody></table>
      <div class="linha" style="margin-top:12px">
        <label>Adição${editavel ? `<input name="adicao" value="${esc(ex.adicao || '')}">` : `<div>${esc(ex.adicao || '—')}</div>`}</label>
        <label>DNP${editavel ? `<input name="dnp" value="${esc(ex.dnp || '')}">` : `<div>${esc(ex.dnp || '—')}</div>`}</label>
      </div>
      <label>Observações${editavel ? `<textarea name="observacoes" rows="3">${esc(ex.observacoes || '')}</textarea>` : `<div>${esc(ex.observacoes || '—')}</div>`}</label>
      <p class="erro"></p>
      ${
        editavel
          ? `<div class="acoes"><button class="btn" type="submit">Salvar exame</button>
             ${a.status === 'em_atendimento' ? '<button class="btn sec" type="button" id="concluir">Salvar e concluir atendimento</button>' : ''}</div>`
          : ''
      }
    </form>`);
  const f = $('#fx', m);
  const salvar = () => api('PUT', `/api/agendamentos/${a.id}/exame`, dadosForm(f));
  f.onsubmit = (e) => {
    e.preventDefault();
    tentar(f, async () => {
      await salvar();
      avisar('Exame salvo.');
      aoMudar && aoMudar();
    });
  };
  if ($('#concluir', m))
    $('#concluir', m).onclick = () =>
      tentar(f, async () => {
        await salvar();
        await api('PATCH', `/api/agendamentos/${a.id}/status`, { status: 'concluido' });
        avisar('Atendimento concluído.');
        fecharModal();
        aoMudar && aoMudar();
      });
}

// Seletor de data + horários livres, reaproveitado no agendamento e na remarcação
function seletorHorario(cont, { lojaId, optometristaId = '', aoEscolher }) {
  cont.innerHTML = `
    <div class="linha">
      <label>Data<input type="date" id="sh-data" min="${hoje()}" max="${somarDias(hoje(), 60)}" value="${hoje()}"></label>
      <label>Optometrista<select id="sh-opt"><option value="">Qualquer disponível</option></select></label>
    </div>
    <div id="sh-lista"></div>`;
  let escolha = null;
  const carregarOpts = async () => {
    const opts = await api('GET', `/api/optometristas?loja_id=${lojaId}`);
    $('#sh-opt', cont).innerHTML =
      '<option value="">Qualquer disponível</option>' + opts.map((o) => `<option value="${o.id}">${esc(o.nome)}</option>`).join('');
    $('#sh-opt', cont).value = optometristaId;
  };
  const carregar = async () => {
    escolha = null;
    aoEscolher(null);
    const data = $('#sh-data', cont).value;
    const q = new URLSearchParams({ loja_id: lojaId, data });
    if ($('#sh-opt', cont).value) q.set('optometrista_id', $('#sh-opt', cont).value);
    const lista = await api('GET', '/api/horarios?' + q);
    $('#sh-lista', cont).innerHTML = lista.length
      ? `<p class="suave">${diaSemana(data)}, ${dataBR(data)}: escolha um horário</p>
         <div class="horarios">${lista.map((s) => `<button type="button" data-h="${s.hora}" title="${esc(s.optometristas.map((o) => o.nome).join(', '))}">${s.hora}</button>`).join('')}</div>`
      : `<div class="vazio">Sem horários livres nesta data. Tente outro dia.</div>`;
    $$('[data-h]', cont).forEach(
      (b) =>
        (b.onclick = () => {
          $$('[data-h]', cont).forEach((x) => x.classList.remove('sel'));
          b.classList.add('sel');
          escolha = { data, hora: b.dataset.h, optometrista_id: $('#sh-opt', cont).value || undefined };
          aoEscolher(escolha);
        })
    );
  };
  $('#sh-data', cont).onchange = carregar;
  $('#sh-opt', cont).onchange = carregar;
  carregarOpts().then(carregar);
}

function telaRemarcar(a, aoMudar) {
  const m = abrirModal(`
    <h2>Remarcar exame</h2>
    <p class="suave">${esc(a.cliente_nome)} · atualmente em ${dataBR(a.data)} às ${a.hora} · ${esc(a.loja_nome)}</p>
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
      avisar('Exame remarcado.');
      fecharModal();
      aoMudar && aoMudar();
    });
  };
}

// ---------- Novo agendamento ----------
let clientePreSelecionado = null; // vindo da ficha do cliente

TELAS.novo = (el) => {
  const p = perfil();
  const ehCliente = p === 'cliente';
  const pre = clientePreSelecionado;
  clientePreSelecionado = null;
  const st = { cliente: ehCliente ? estado.usuario : pre, loja: p === 'gerente' || p === 'atendente' ? estado.usuario.loja_id : null, escolha: null };

  const passo = () => {
    if (!st.cliente) return pedirCliente();
    if (!st.loja) return pedirLoja();
    return pedirHorario();
  };
  const cabecalho = (n) => {
    const nomes = ehCliente ? ['Loja', 'Data e horário'] : p === 'admin' ? ['Cliente', 'Loja', 'Data e horário'] : ['Cliente', 'Data e horário'];
    return `<div class="passos">${nomes.map((x) => `<span class="${x === n ? 'ativo' : ''}">${x}</span>`).join('')}</div>`;
  };

  function pedirCliente() {
    el.innerHTML = `<h1>Novo agendamento</h1>${cabecalho('Cliente')}
      <div class="cartao">
        <label>Buscar cliente por nome, CPF, telefone ou e-mail<input id="busca" placeholder="Digite ao menos 2 letras" autofocus></label>
        <div id="res"></div>
        <button class="btn sec" id="novo-cli">+ Cadastrar novo cliente</button>
      </div>`;
    let t;
    $('#busca').oninput = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const termo = $('#busca').value.trim();
        if (termo.length < 2) return ($('#res').innerHTML = '');
        const lista = await api('GET', '/api/usuarios?perfil=cliente&busca=' + encodeURIComponent(termo));
        $('#res').innerHTML = lista.length
          ? `<table><tbody>${lista
              .filter((c) => c.ativo)
              .map((c) => `<tr class="clicavel" data-id="${c.id}"><td><b>${esc(c.nome)}</b></td><td>${esc(c.telefone || '')}</td><td class="esconder-celular">${esc(c.email)}</td></tr>`)
              .join('')}</tbody></table>`
          : '<p class="suave">Nenhum cliente encontrado.</p>';
        $$('#res tr[data-id]').forEach((tr) => (tr.onclick = () => { st.cliente = lista.find((c) => c.id === Number(tr.dataset.id)); passo(); }));
      }, 250);
    };
    $('#novo-cli').onclick = () =>
      formUsuario({ perfil: 'cliente' }, (c) => {
        st.cliente = c;
        passo();
      });
  }

  function pedirLoja() {
    el.innerHTML = `<h1>${ehCliente ? 'Agendar exame de vista' : 'Novo agendamento'}</h1>${cabecalho('Loja')}
      ${!ehCliente ? `<p>Cliente: <b>${esc(st.cliente.nome)}</b></p>` : '<p class="suave">Escolha a loja mais perto de você.</p>'}
      <div class="metricas">${estado.lojas
        .map(
          (l) => `<button class="metrica" style="text-align:left;cursor:pointer" data-loja="${l.id}">
            <b style="font-size:1.05rem">${esc(l.nome)}</b><span>${esc(l.endereco || '')}<br>${esc(l.cidade || '')} · ${esc(l.telefone || '')}<br>
            Funciona ${l.hora_abertura}–${l.hora_fechamento}</span></button>`
        )
        .join('')}</div>`;
    $$('[data-loja]').forEach((b) => (b.onclick = () => { st.loja = Number(b.dataset.loja); passo(); }));
  }

  function pedirHorario() {
    const loja = estado.lojas.find((l) => l.id === st.loja);
    el.innerHTML = `<h1>${ehCliente ? 'Agendar exame de vista' : 'Novo agendamento'}</h1>${cabecalho('Data e horário')}
      <div class="cartao">
        <p>${!ehCliente ? `Cliente: <b>${esc(st.cliente.nome)}</b> · ` : ''}Loja: <b>${esc(loja?.nome || '')}</b>
        ${p !== 'gerente' && p !== 'atendente' ? ' · <a href="#" id="trocar-loja">trocar loja</a>' : ''}</p>
        <div id="sel"></div>
        <form id="fa">
          <label>Observações (opcional)<textarea name="observacoes" rows="2" placeholder="${ehCliente ? 'Ex.: uso lentes de contato' : 'Ex.: cliente usa lentes de contato'}"></textarea></label>
          <p class="erro"></p>
          <div class="acoes"><button class="btn" type="submit" disabled>Confirmar agendamento</button>
          ${!ehCliente ? '<button class="btn sec" type="button" id="trocar-cli">Trocar cliente</button>' : ''}</div>
        </form>
      </div>`;
    const f = $('#fa');
    seletorHorario($('#sel'), {
      lojaId: st.loja,
      aoEscolher: (e) => {
        st.escolha = e;
        $('button[type=submit]', f).disabled = !e;
      },
    });
    if ($('#trocar-loja')) $('#trocar-loja').onclick = (e) => { e.preventDefault(); st.loja = null; passo(); };
    if ($('#trocar-cli')) $('#trocar-cli').onclick = () => { st.cliente = null; passo(); };
    f.onsubmit = (e) => {
      e.preventDefault();
      tentar(f, async () => {
        const ag = await api('POST', '/api/agendamentos', {
          ...st.escolha,
          loja_id: st.loja,
          cliente_id: st.cliente.id,
          observacoes: dadosForm(f).observacoes,
        });
        el.innerHTML = `<div class="cartao" style="max-width:560px">
          <h1>Exame agendado ✓</h1>
          <dl class="detalhe">
            <dt>Cliente</dt><dd>${esc(ag.cliente_nome)}</dd>
            <dt>Quando</dt><dd>${diaSemana(ag.data)}, ${dataBR(ag.data)} às ${ag.hora}</dd>
            <dt>Onde</dt><dd>${esc(ag.loja_nome)}<br><span class="suave">${esc(ag.loja_endereco || '')}</span></dd>
            <dt>Optometrista</dt><dd>${esc(ag.optometrista_nome)}</dd>
          </dl>
          <p class="suave">Chegue com 10 minutos de antecedência e traga seus óculos atuais, se tiver.</p>
          <div class="acoes"><a class="btn" href="#/${ehCliente ? 'meus' : 'agenda'}" style="text-decoration:none">${ehCliente ? 'Ver meus agendamentos' : 'Ir para a agenda'}</a>
          <button class="btn sec" id="outro">Fazer outro agendamento</button></div>
        </div>`;
        $('#outro').onclick = () => TELAS.novo(el);
      });
    };
  }

  passo();
};

// ---------- Cliente ----------
TELAS.meus = async (el) => {
  const lista = await api('GET', '/api/agendamentos?ordem=desc');
  const futuros = lista.filter((a) => ['agendado', 'confirmado', 'em_atendimento'].includes(a.status)).reverse();
  const passados = lista.filter((a) => !futuros.includes(a));
  const linha = (a) => `<tr class="clicavel" data-id="${a.id}"><td><b>${dataBR(a.data)}</b> ${a.hora}</td><td>${esc(a.loja_nome)}</td><td class="esconder-celular">${esc(a.optometrista_nome)}</td><td>${selo(a.status)}</td></tr>`;
  el.innerHTML = `
    <h1>Meus agendamentos</h1>
    <div class="cartao tabela-rolagem"><h2>Próximos</h2>${
      futuros.length ? `<table><tbody>${futuros.map(linha).join('')}</tbody></table>` : `<div class="vazio">Você não tem exames marcados. <a href="#/novo">Agendar agora</a></div>`
    }</div>
    ${passados.length ? `<div class="cartao tabela-rolagem"><h2>Histórico</h2><table><tbody>${passados.map(linha).join('')}</tbody></table></div>` : ''}`;
  $$('tr[data-id]', el).forEach((tr) => (tr.onclick = () => detalheAgendamento(Number(tr.dataset.id), () => TELAS.meus(el))));
};

TELAS.exames = async (el) => {
  const lista = await api('GET', `/api/clientes/${estado.usuario.id}/exames`);
  el.innerHTML = `<h1>Meus exames</h1>${
    lista.length
      ? lista.map((e) => cartaoExame(e)).join('')
      : '<div class="cartao vazio">Os resultados aparecem aqui depois que o optometrista registrar seu exame.</div>'
  }`;
};

const cartaoExame = (e) => `
  <div class="cartao">
    <h3>${dataBR(e.data)} · ${esc(e.loja_nome)}</h3>
    <p class="suave">${esc(e.optometrista_nome)}${e.registro_profissional ? ' · ' + esc(e.registro_profissional) : ''}</p>
    <div class="tabela-rolagem"><table class="olhos"><thead><tr><th></th>${CAMPOS_OLHO.map(([, r]) => `<th>${r}</th>`).join('')}</tr></thead><tbody>
      <tr><th>OD</th>${CAMPOS_OLHO.map(([c]) => `<td>${esc(e['od_' + c] || '—')}</td>`).join('')}</tr>
      <tr><th>OE</th>${CAMPOS_OLHO.map(([c]) => `<td>${esc(e['oe_' + c] || '—')}</td>`).join('')}</tr>
    </tbody></table></div>
    <p>Adição: <b>${esc(e.adicao || '—')}</b> · DNP: <b>${esc(e.dnp || '—')}</b></p>
    ${e.observacoes ? `<p>${esc(e.observacoes)}</p>` : ''}
  </div>`;

// ---------- Usuários e clientes ----------
TELAS.clientes = (el) => listaUsuarios(el, { soClientes: true });
TELAS.usuarios = (el) => listaUsuarios(el, { soClientes: false });

const ROTULOS_PERFIL = { admin: 'Administrador da rede', gerente: 'Gerente de loja', atendente: 'Atendente / recepção', optometrista: 'Optometrista', cliente: 'Cliente' };
const PERFIS_GERENCIAVEIS = { admin: ['admin', 'gerente', 'atendente', 'optometrista'], gerente: ['atendente', 'optometrista'] };
const nomeLoja = (id) => estado.lojas.find((l) => l.id === id)?.nome || '—';

async function listaUsuarios(el, { soClientes }) {
  const p = perfil();
  const perfis = soClientes ? ['cliente'] : PERFIS_GERENCIAVEIS[p];
  el.innerHTML = `
    <h1>${soClientes ? 'Clientes' : p === 'admin' ? 'Usuários' : 'Equipe da loja'}</h1>
    <div class="cartao"><div class="linha">
      <label>Buscar<input id="busca" placeholder="Nome, e-mail, CPF ou telefone"></label>
      ${!soClientes ? `<label>Perfil<select id="perfil"><option value="">Todos</option>${perfis.map((x) => `<option value="${x}">${ROTULOS_PERFIL[x]}</option>`).join('')}</select></label>` : ''}
      ${!soClientes && p === 'admin' ? `<label>Loja<select id="loja"><option value="">Todas</option>${estado.lojas.map((l) => `<option value="${l.id}">${esc(l.nome)}</option>`).join('')}</select></label>` : ''}
      ${pode(soClientes ? 'clientes.cadastrar' : 'usuarios.gerenciar') ? `<div class="fixo" style="margin-bottom:12px"><button class="btn" id="novo">+ ${soClientes ? 'Novo cliente' : 'Novo usuário'}</button></div>` : ''}
    </div></div>
    <div class="cartao tabela-rolagem" id="lista"></div>`;

  const carregar = async () => {
    const q = new URLSearchParams();
    if ($('#busca').value.trim()) q.set('busca', $('#busca').value.trim());
    if (soClientes) q.set('perfil', 'cliente');
    else if ($('#perfil').value) q.set('perfil', $('#perfil').value);
    if ($('#loja')?.value) q.set('loja_id', $('#loja').value);
    let lista = await api('GET', '/api/usuarios?' + q);
    if (!soClientes) lista = lista.filter((u) => u.perfil !== 'cliente');
    $('#lista').innerHTML = lista.length
      ? `<table><thead><tr><th>Nome</th><th class="esconder-celular">E-mail</th><th>${soClientes ? 'Telefone' : 'Perfil'}</th>${!soClientes ? '<th class="esconder-celular">Loja</th>' : ''}<th>Situação</th></tr></thead>
        <tbody>${lista
          .map(
            (u) => `<tr class="clicavel ${u.ativo ? '' : 'inativo'}" data-id="${u.id}"><td><b>${esc(u.nome)}</b></td><td class="esconder-celular">${esc(u.email)}</td>
            <td>${soClientes ? esc(u.telefone || '') : esc(u.perfil_rotulo)}</td>${!soClientes ? `<td class="esconder-celular">${esc(nomeLoja(u.loja_id))}</td>` : ''}
            <td>${u.ativo ? 'Ativo' : 'Inativo'}</td></tr>`
          )
          .join('')}</tbody></table>`
      : '<div class="vazio">Nenhum registro encontrado.</div>';
    $$('#lista tr[data-id]').forEach(
      (tr) =>
        (tr.onclick = () => {
          const u = lista.find((x) => x.id === Number(tr.dataset.id));
          if (u.id === estado.usuario.id) return (location.hash = '#/perfil');
          soClientes ? fichaCliente(u, carregar) : formUsuario(u, carregar);
        })
    );
  };
  let t;
  $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(carregar, 250); };
  $$('#perfil, #loja').forEach((x) => (x.onchange = carregar));
  if ($('#novo')) $('#novo').onclick = () => formUsuario({ perfil: soClientes ? 'cliente' : perfis[perfis.length - 1] }, carregar);
  carregar();
}

async function fichaCliente(c, aoMudar) {
  const ags = await api('GET', `/api/agendamentos?cliente_id=${c.id}&ordem=desc`);
  const m = abrirModal(`
    <h2>${esc(c.nome)}</h2>
    <dl class="detalhe">
      <dt>E-mail</dt><dd>${esc(c.email)}</dd><dt>Telefone</dt><dd>${esc(c.telefone || '—')}</dd>
      <dt>CPF</dt><dd>${esc(c.cpf || '—')}</dd><dt>Nascimento</dt><dd>${dataBR(c.data_nascimento) || '—'}</dd>
    </dl>
    <h3>Agendamentos ${perfil() !== 'admin' ? 'nesta loja' : ''}</h3>
    ${ags.length ? `<table><tbody>${ags.map((a) => `<tr><td>${dataBR(a.data)} ${a.hora}</td><td>${esc(a.loja_nome)}</td><td>${selo(a.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="suave">Nenhum agendamento.</p>'}
    <div class="acoes" style="margin-top:16px"><button class="btn" id="agendar">Agendar exame</button><button class="btn sec" id="editar">Editar cadastro</button></div>`);
  $('#agendar', m).onclick = () => {
    fecharModal();
    clientePreSelecionado = c;
    if (location.hash === '#/novo') renderizar();
    else location.hash = '#/novo';
  };
  $('#editar', m).onclick = () => formUsuario(c, aoMudar);
}

function formUsuario(u, aoSalvar) {
  const p = perfil();
  const novo = !u.id;
  const ehCliente = u.perfil === 'cliente';
  const opcoesPerfil = ehCliente ? ['cliente'] : PERFIS_GERENCIAVEIS[p];
  const m = abrirModal(`
    <h2>${novo ? (ehCliente ? 'Novo cliente' : 'Novo usuário') : 'Editar ' + esc(u.nome)}</h2>
    <form id="fu">
      <label>Nome completo<input name="nome" required value="${esc(u.nome || '')}"></label>
      <div class="linha">
        <label>E-mail<input name="email" type="email" required value="${esc(u.email || '')}"></label>
        <label>Telefone / WhatsApp<input name="telefone" value="${esc(u.telefone || '')}"></label>
      </div>
      ${ehCliente ? `<div class="linha"><label>CPF<input name="cpf" value="${esc(u.cpf || '')}"></label><label>Nascimento<input name="data_nascimento" type="date" value="${esc(u.data_nascimento || '')}"></label></div>` : ''}
      ${
        !ehCliente
          ? `<div class="linha">
        <label>Perfil<select name="perfil">${opcoesPerfil.map((x) => `<option value="${x}" ${x === u.perfil ? 'selected' : ''}>${ROTULOS_PERFIL[x]}</option>`).join('')}</select></label>
        ${p === 'admin' ? `<label id="campo-loja">Loja<select name="loja_id"><option value="">—</option>${estado.lojas.map((l) => `<option value="${l.id}" ${l.id === u.loja_id ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}</select></label>` : ''}
      </div>
      <label id="campo-reg">Registro profissional (optometrista)<input name="registro_profissional" value="${esc(u.registro_profissional || '')}"></label>`
          : ''
      }
      <label>${novo ? 'Senha inicial' : 'Nova senha (deixe em branco para manter)'}<input name="senha" type="password" minlength="8" ${novo ? 'required' : ''} autocomplete="new-password"></label>
      ${!novo ? `<label><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''} style="display:inline;width:auto"> Acesso ativo</label>` : ''}
      <p class="erro"></p>
      <button class="btn" type="submit">Salvar</button>
    </form>`);
  const f = $('#fu', m);
  const ajustar = () => {
    const pf = $('[name=perfil]', f)?.value;
    if ($('#campo-reg', f)) $('#campo-reg', f).hidden = pf !== 'optometrista';
    if ($('#campo-loja', f)) $('#campo-loja', f).hidden = pf === 'admin';
  };
  if ($('[name=perfil]', f)) $('[name=perfil]', f).onchange = ajustar;
  ajustar();
  f.onsubmit = (e) => {
    e.preventDefault();
    tentar(f, async () => {
      const d = dadosForm(f);
      d.perfil = d.perfil || u.perfil;
      if (!novo) d.ativo = !!$('[name=ativo]', f).checked;
      if (!d.senha) delete d.senha;
      const salvo = await api(novo ? 'POST' : 'PUT', novo ? '/api/usuarios' : `/api/usuarios/${u.id}`, d);
      avisar('Cadastro salvo.');
      fecharModal();
      aoSalvar && aoSalvar(salvo);
    });
  };
}

// ---------- Lojas ----------
TELAS.lojas = async (el) => {
  const lojas = await api('GET', '/api/lojas?todas=1');
  el.innerHTML = `
    <h1>Lojas</h1>
    <div class="cartao tabela-rolagem">
      <div class="acoes" style="margin-bottom:12px"><button class="btn" id="nova">+ Nova loja</button></div>
      <table><thead><tr><th>Loja</th><th class="esconder-celular">Endereço</th><th>Funcionamento</th><th>Consulta</th><th>Situação</th></tr></thead>
      <tbody>${lojas
        .map(
          (l) => `<tr class="clicavel ${l.ativa ? '' : 'inativo'}" data-id="${l.id}"><td><b>${esc(l.nome)}</b><br><span class="suave">${esc(l.telefone || '')}</span></td>
          <td class="esconder-celular">${esc(l.endereco || '')}<br><span class="suave">${esc(l.cidade || '')}</span></td>
          <td>${l.hora_abertura}–${l.hora_fechamento}</td><td>${l.duracao_consulta} min</td><td>${l.ativa ? 'Ativa' : 'Inativa'}</td></tr>`
        )
        .join('')}</tbody></table>
    </div>`;
  const recarregar = async () => {
    estado.lojas = await api('GET', '/api/lojas');
    TELAS.lojas(el);
  };
  $('#nova').onclick = () => formLoja({}, recarregar);
  $$('tr[data-id]', el).forEach((tr) => (tr.onclick = () => formLoja(lojas.find((l) => l.id === Number(tr.dataset.id)), recarregar)));
};

function formLoja(l, aoSalvar) {
  const m = abrirModal(`
    <h2>${l.id ? 'Editar loja' : 'Nova loja'}</h2>
    <form id="fl">
      <label>Nome<input name="nome" required value="${esc(l.nome || '')}"></label>
      <label>Endereço<input name="endereco" value="${esc(l.endereco || '')}"></label>
      <div class="linha"><label>Cidade<input name="cidade" value="${esc(l.cidade || '')}"></label><label>Telefone<input name="telefone" value="${esc(l.telefone || '')}"></label></div>
      <div class="linha">
        <label>Abre às<input name="hora_abertura" type="time" required value="${l.hora_abertura || '09:00'}"></label>
        <label>Fecha às<input name="hora_fechamento" type="time" required value="${l.hora_fechamento || '18:00'}"></label>
        <label>Duração do exame (min)<input name="duracao_consulta" type="number" min="10" max="180" step="5" required value="${l.duracao_consulta || 30}"></label>
      </div>
      <label><input type="checkbox" name="ativa" ${l.ativa === 0 ? '' : 'checked'} style="display:inline;width:auto"> Loja ativa (aceita agendamentos)</label>
      <p class="erro"></p>
      <button class="btn" type="submit">Salvar</button>
    </form>`);
  const f = $('#fl', m);
  f.onsubmit = (e) => {
    e.preventDefault();
    tentar(f, async () => {
      const d = dadosForm(f);
      d.duracao_consulta = Number(d.duracao_consulta);
      d.ativa = $('[name=ativa]', f).checked;
      await api(l.id ? 'PUT' : 'POST', l.id ? `/api/lojas/${l.id}` : '/api/lojas', d);
      avisar('Loja salva.');
      fecharModal();
      aoSalvar();
    });
  };
}

// ---------- Horários de atendimento e bloqueios ----------
TELAS.horarios = async (el) => {
  const p = perfil();
  const configura = pode('agenda.configurar');
  const [disp, bloq, opts] = await Promise.all([
    api('GET', '/api/disponibilidades'),
    api('GET', '/api/bloqueios'),
    configura ? api('GET', '/api/optometristas') : Promise.resolve([]),
  ]);
  const optsEscopo = p === 'gerente' ? opts.filter((o) => o.loja_id === estado.usuario.loja_id || disp.some((d) => d.optometrista_id === o.id)) : opts;
  el.innerHTML = `
    <h1>${p === 'optometrista' ? 'Meus horários' : 'Horários dos optometristas'}</h1>
    <div class="cartao tabela-rolagem">
      <h2>Horários semanais de atendimento</h2>
      ${disp.length ? `<table><thead><tr>${p !== 'optometrista' ? '<th>Optometrista</th>' : ''}<th>Loja</th><th>Dia</th><th>Horário</th>${configura ? '<th></th>' : ''}</tr></thead><tbody>
        ${disp.map((d) => `<tr>${p !== 'optometrista' ? `<td>${esc(d.optometrista_nome)}</td>` : ''}<td>${esc(d.loja_nome)}</td><td>${DIAS[d.dia_semana]}</td><td>${d.hora_inicio}–${d.hora_fim}</td>
          ${configura ? `<td><button class="btn perigo peq" data-del-disp="${d.id}">Remover</button></td>` : ''}</tr>`).join('')}
      </tbody></table>` : '<div class="vazio">Nenhum horário cadastrado.</div>'}
      ${p === 'optometrista' ? '<p class="suave">Para mudar seus horários fixos, fale com o gerente da loja.</p>' : ''}
      ${
        configura
          ? `<form id="fd" style="margin-top:16px"><h3>Adicionar horário</h3><div class="linha">
        <label>Optometrista<select name="optometrista_id" required>${optsEscopo.map((o) => `<option value="${o.id}">${esc(o.nome)}</option>`).join('')}</select></label>
        ${p === 'admin' ? `<label>Loja<select name="loja_id">${estado.lojas.map((l) => `<option value="${l.id}">${esc(l.nome)}</option>`).join('')}</select></label>` : ''}
        <div style="flex-basis:100%;margin-bottom:12px"><span class="suave">Dias</span><div class="acoes" style="margin-top:4px">${DIAS.map((d, i) => `<label style="margin:0;color:var(--texto)"><input type="checkbox" name="dias" value="${i}" ${i >= 1 && i <= 5 ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
        <label>Início<input type="time" name="hora_inicio" value="09:00" required></label>
        <label>Fim<input type="time" name="hora_fim" value="18:00" required></label>
        <div class="fixo" style="margin-bottom:12px"><button class="btn" type="submit">Adicionar</button></div>
      </div><p class="erro"></p></form>`
          : ''
      }
    </div>
    <div class="cartao tabela-rolagem">
      <h2>Folgas e bloqueios de agenda</h2>
      ${bloq.length ? `<table><thead><tr>${p !== 'optometrista' ? '<th>Optometrista</th>' : ''}<th>Data</th><th>Horário</th><th>Motivo</th><th></th></tr></thead><tbody>
        ${bloq.map((b) => `<tr>${p !== 'optometrista' ? `<td>${esc(b.optometrista_nome)}</td>` : ''}<td>${dataBR(b.data)}</td><td>${b.hora_inicio === '00:00' && b.hora_fim === '23:59' ? 'Dia todo' : `${b.hora_inicio}–${b.hora_fim}`}</td>
          <td>${esc(b.motivo || '')}</td><td><button class="btn perigo peq" data-del-bloq="${b.id}">Remover</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="vazio">Nenhum bloqueio futuro.</div>'}
      <form id="fb" style="margin-top:16px"><h3>Bloquear agenda</h3><div class="linha">
        ${p !== 'optometrista' ? `<label>Optometrista<select name="optometrista_id" required>${optsEscopo.map((o) => `<option value="${o.id}">${esc(o.nome)}</option>`).join('')}</select></label>` : ''}
        <label>Data<input type="date" name="data" min="${hoje()}" required></label>
        <label>Início<input type="time" name="hora_inicio" placeholder="dia todo"></label>
        <label>Fim<input type="time" name="hora_fim"></label>
        <label>Motivo<input name="motivo" placeholder="Folga, curso, férias…"></label>
        <div class="fixo" style="margin-bottom:12px"><button class="btn" type="submit">Bloquear</button></div>
      </div><p class="suave">Deixe início e fim em branco para bloquear o dia inteiro.</p><p class="erro"></p></form>
    </div>`;
  const recarregar = () => TELAS.horarios(el);
  $$('[data-del-disp]', el).forEach((b) => (b.onclick = async () => {
    try { await api('DELETE', `/api/disponibilidades/${b.dataset.delDisp}`, {}); recarregar(); } catch (e) { avisar(e.message, true); }
  }));
  $$('[data-del-bloq]', el).forEach((b) => (b.onclick = async () => {
    try { await api('DELETE', `/api/bloqueios/${b.dataset.delBloq}`, {}); recarregar(); } catch (e) { avisar(e.message, true); }
  }));
  const fd = $('#fd', el);
  if (fd)
    fd.onsubmit = (e) => {
      e.preventDefault();
      tentar(fd, async () => {
        const { dias: _, ...d } = dadosForm(fd);
        const dias = $$('[name=dias]:checked', fd).map((o) => Number(o.value));
        if (!dias.length) throw new Error('Escolha ao menos um dia.');
        const falhas = [];
        for (const dia of dias) {
          try {
            await api('POST', '/api/disponibilidades', { ...d, dia_semana: dia });
          } catch (err) {
            falhas.push(`${DIAS[dia]}: ${err.message}`);
          }
        }
        if (falhas.length < dias.length) {
          await TELAS.horarios(el);
          avisar('Horário adicionado.');
        }
        if (falhas.length) avisar(falhas.join(' '), true);
      });
    };
  const fb = $('#fb', el);
  fb.onsubmit = (e) => {
    e.preventDefault();
    tentar(fb, async () => {
      const d = dadosForm(fb);
      if (!d.hora_inicio) delete d.hora_inicio;
      if (!d.hora_fim) delete d.hora_fim;
      const r = await api('POST', '/api/bloqueios', d);
      if (r.agendamentos_afetados.length)
        alert(`Atenção: há ${r.agendamentos_afetados.length} exame(s) marcado(s) nesse período que precisam ser remarcados:\n` +
          r.agendamentos_afetados.map((a) => `${a.hora} - ${a.cliente_nome}`).join('\n'));
      avisar('Agenda bloqueada.');
      recarregar();
    });
  };
};

// ---------- Relatórios ----------
TELAS.relatorios = async (el) => {
  const p = perfil();
  el.innerHTML = `
    <h1>Relatórios</h1>
    <div class="cartao"><div class="linha">
      <label>De<input type="date" id="ini" value="${somarDias(hoje(), -30)}"></label>
      <label>Até<input type="date" id="fim" value="${somarDias(hoje(), 30)}"></label>
      ${p === 'admin' ? `<label>Loja<select id="loja"><option value="">Rede inteira</option>${estado.lojas.map((l) => `<option value="${l.id}">${esc(l.nome)}</option>`).join('')}</select></label>` : ''}
    </div></div>
    <div id="res"></div>`;
  const carregar = async () => {
    const q = new URLSearchParams({ inicio: $('#ini').value, fim: $('#fim').value });
    if ($('#loja')?.value) q.set('loja_id', $('#loja').value);
    const r = await api('GET', '/api/relatorios/resumo?' + q);
    const s = r.por_status;
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    const realizados = (s.concluido || 0) + (s.faltou || 0);
    const taxa = realizados ? Math.round(((s.concluido || 0) / realizados) * 100) + '%' : '—';
    const tabela = (titulo, linhas) => `
      <div class="cartao tabela-rolagem"><h2>${titulo}</h2>${
        linhas.length
          ? `<table><thead><tr><th>Nome</th><th>Total</th><th>Concluídos</th><th>Faltas</th><th>Cancelados</th></tr></thead><tbody>
            ${linhas.map((l) => `<tr><td>${esc(l.nome)}</td><td>${l.total}</td><td>${l.concluidos}</td><td>${l.faltas}</td><td>${l.cancelados}</td></tr>`).join('')}</tbody></table>`
          : '<div class="vazio">Sem dados no período.</div>'
      }</div>`;
    $('#res').innerHTML = `
      <div class="metricas">
        <div class="metrica"><b>${total}</b><span>Agendamentos</span></div>
        <div class="metrica"><b>${(s.agendado || 0) + (s.confirmado || 0)}</b><span>A realizar</span></div>
        <div class="metrica"><b>${s.concluido || 0}</b><span>Exames realizados</span></div>
        <div class="metrica"><b>${s.faltou || 0}</b><span>Faltas</span></div>
        <div class="metrica"><b>${s.cancelado || 0}</b><span>Cancelamentos</span></div>
        <div class="metrica"><b>${taxa}</b><span>Comparecimento</span></div>
      </div>
      ${p === 'admin' && !$('#loja').value ? tabela('Por loja', r.por_loja) : ''}
      ${tabela('Por optometrista', r.por_optometrista)}`;
  };
  $$('#ini, #fim, #loja').forEach((x) => (x.onchange = carregar));
  carregar();
};

// ---------- Auditoria ----------
TELAS.auditoria = async (el) => {
  const lista = await api('GET', '/api/auditoria');
  el.innerHTML = `<h1>Auditoria</h1><p class="suave">Últimas 300 ações registradas no sistema.</p>
    <div class="cartao tabela-rolagem"><table><thead><tr><th>Quando (UTC)</th><th>Usuário</th><th>Ação</th><th>Registro</th><th class="esconder-celular">Detalhes</th></tr></thead><tbody>
    ${lista.map((x) => `<tr><td>${esc(x.criado_em)}</td><td>${esc(x.usuario_nome || '—')}</td><td>${esc(x.acao)}</td><td>${esc(x.entidade || '')} ${x.entidade_id ?? ''}</td>
      <td class="esconder-celular suave" style="max-width:360px;word-break:break-word">${esc(x.detalhes || '')}</td></tr>`).join('')}
    </tbody></table></div>`;
};

// ---------- Meu perfil ----------
TELAS.perfil = (el) => {
  const u = estado.usuario;
  el.innerHTML = `
    <h1>Meu perfil</h1>
    <div class="cartao" style="max-width:560px">
      <p class="suave">${esc(u.perfil_rotulo)}${estado.loja ? ' · ' + esc(estado.loja.nome) : ''} · ${esc(u.email)}</p>
      <form id="fp">
        <label>Nome<input name="nome" required value="${esc(u.nome)}"></label>
        <label>Telefone / WhatsApp<input name="telefone" value="${esc(u.telefone || '')}"></label>
        <h3>Trocar senha</h3>
        <div class="linha"><label>Senha atual<input type="password" name="senha_atual" autocomplete="current-password"></label>
        <label>Nova senha<input type="password" name="nova_senha" minlength="8" autocomplete="new-password"></label></div>
        <p class="erro"></p>
        <button class="btn" type="submit">Salvar</button>
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
