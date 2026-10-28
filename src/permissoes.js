// Hierarquia de acessos.
// - Administrador: vê e configura todas as unidades. O administrador principal
//   (o primeiro) também gerencia outros administradores e vê os logs.
// - Supervisor: acompanha as unidades que o administrador escolher; vê a agenda,
//   os relatórios e os horários delas e cadastra gerentes e recepção.
// - Gerente: responsável pela unidade; vê só a sua unidade e cadastra a recepção.
// - Atendente (recepção): vê a agenda da unidade e marca presença.
// Criar, remarcar e cancelar agendamentos depende da permissão "pode_agendar",
// que só o administrador libera para cada usuário.

const PERFIS = {
  admin: { rotulo: 'Administrador', escopo: 'rede' },
  supervisor: { rotulo: 'Supervisor', escopo: 'unidades' },
  gerente: { rotulo: 'Gerente da unidade', escopo: 'unidade' },
  atendente: { rotulo: 'Recepção', escopo: 'unidade' },
};

const ehAdmin = (u) => u?.perfil === 'admin';
const ehPrincipal = (u) => ehAdmin(u) && !!u.principal;
const ehSupervisor = (u) => u?.perfil === 'supervisor';
// Escolhe entre várias unidades (administrador e supervisor)
const variasUnidades = (u) => ehAdmin(u) || ehSupervisor(u);
// Gerencia a agenda: encaixe e reabrir atendimento
const gerencia = (u) => variasUnidades(u) || u?.perfil === 'gerente';
const podeAgendar = (u) => ehAdmin(u) || !!u?.pode_agendar;

// Perfis que cada usuário pode criar/editar
function perfisGerenciaveis(u) {
  if (ehPrincipal(u)) return ['admin', 'supervisor', 'gerente', 'atendente'];
  if (ehAdmin(u)) return ['supervisor', 'gerente', 'atendente'];
  if (ehSupervisor(u)) return ['gerente', 'atendente'];
  if (u?.perfil === 'gerente') return ['atendente'];
  return [];
}

function permissoes(u) {
  return {
    agendar: podeAgendar(u),
    marcar_presenca: true,
    relatorios: gerencia(u),
    usuarios: perfisGerenciaveis(u).length > 0,
    unidades: ehAdmin(u),
    horarios: gerencia(u),
    integracao: ehAdmin(u),
    logs: ehPrincipal(u),
    liberar_agendamento: ehAdmin(u),
    varias_unidades: variasUnidades(u),
  };
}

module.exports = { PERFIS, ehAdmin, ehPrincipal, ehSupervisor, variasUnidades, gerencia, podeAgendar, perfisGerenciaveis, permissoes };
