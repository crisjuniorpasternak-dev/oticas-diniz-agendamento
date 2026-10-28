// Hierarquia de acessos.
// - Administrador: vê e configura todas as unidades. O administrador principal
//   (o primeiro) também gerencia outros administradores e vê os logs.
// - Gerente: responsável pela unidade; vê só a sua unidade e cadastra a recepção.
// - Atendente (recepção): vê a agenda da unidade e marca presença.
// Criar, remarcar e cancelar agendamentos depende da permissão "pode_agendar",
// que só o administrador libera para cada usuário.

const PERFIS = {
  admin: { rotulo: 'Administrador', escopo: 'rede' },
  gerente: { rotulo: 'Gerente da unidade', escopo: 'unidade' },
  atendente: { rotulo: 'Recepção', escopo: 'unidade' },
};

const ehAdmin = (u) => u?.perfil === 'admin';
const ehPrincipal = (u) => ehAdmin(u) && !!u.principal;
const podeAgendar = (u) => ehAdmin(u) || !!u?.pode_agendar;

// Perfis que cada usuário pode criar/editar
function perfisGerenciaveis(u) {
  if (ehPrincipal(u)) return ['admin', 'gerente', 'atendente'];
  if (ehAdmin(u)) return ['gerente', 'atendente'];
  if (u?.perfil === 'gerente') return ['atendente'];
  return [];
}

function permissoes(u) {
  return {
    agendar: podeAgendar(u),
    marcar_presenca: true,
    relatorios: ehAdmin(u) || u?.perfil === 'gerente',
    usuarios: perfisGerenciaveis(u).length > 0,
    unidades: ehAdmin(u),
    horarios: ehAdmin(u) || u?.perfil === 'gerente',
    integracao: ehAdmin(u),
    logs: ehPrincipal(u),
    liberar_agendamento: ehAdmin(u),
  };
}

module.exports = { PERFIS, ehAdmin, ehPrincipal, podeAgendar, perfisGerenciaveis, permissoes };
