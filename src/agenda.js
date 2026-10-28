// Regras de agenda: horários livres de cada unidade e utilidades de data.

const DIAS_ANTECEDENCIA_MAX = 60;
const STATUS_ATIVOS = ['agendado', 'confirmado'];

const paraMin = (h) => {
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + mm;
};
const paraHora = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function hojeISO(agora = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

function diaSemana(dataISO) {
  const [a, m, d] = dataISO.split('-').map(Number);
  return new Date(a, m - 1, d).getDay();
}

function dataValida(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const [a, m, d] = s.split('-').map(Number);
  const dt = new Date(a, m - 1, d);
  return dt.getFullYear() === a && dt.getMonth() === m - 1 && dt.getDate() === d;
}

const horaValida = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');

function somarDias(dataISO, dias) {
  const [a, m, d] = dataISO.split('-').map(Number);
  return hojeISO(new Date(a, m - 1, d + dias));
}

// Retorna [{ hora, vagas }] com os horários livres de uma unidade num dia.
// Cada horário aceita até "vagas_por_horario" agendamentos ativos.
async function horariosLivres(db, { lojaId, data, ignorarAgendamentoId = null, agora = new Date() }) {
  const loja = await db.get('SELECT * FROM lojas WHERE id = ? AND ativa = 1', lojaId);
  if (!loja || !dataValida(data)) return [];
  const hoje = hojeISO(agora);
  if (data < hoje || data > somarDias(hoje, DIAS_ANTECEDENCIA_MAX)) return [];

  const turnos = await db.all(
    'SELECT hora_inicio, hora_fim FROM horarios_loja WHERE loja_id = ? AND dia_semana = ? ORDER BY hora_inicio',
    lojaId,
    diaSemana(data)
  );
  if (!turnos.length) return [];
  const ocupacao = new Map(
    (
      await db.all(
        `SELECT hora, COUNT(*) n FROM agendamentos
         WHERE loja_id = ? AND data = ? AND status IN (${STATUS_ATIVOS.map(() => '?').join(',')}) AND id IS NOT ?
         GROUP BY hora`,
        lojaId,
        data,
        ...STATUS_ATIVOS,
        ignorarAgendamentoId
      )
    ).map((r) => [r.hora, r.n])
  );
  const bloqueios = (await db.all('SELECT hora_inicio, hora_fim FROM bloqueios_loja WHERE loja_id = ? AND data = ?', lojaId, data)).map(
    (b) => [paraMin(b.hora_inicio), paraMin(b.hora_fim)]
  );

  const agoraMin = data === hoje ? agora.getHours() * 60 + agora.getMinutes() : -1;
  const dur = loja.duracao_consulta;
  const livres = [];
  for (const turno of turnos) {
    for (let t = paraMin(turno.hora_inicio); t + dur <= paraMin(turno.hora_fim); t += dur) {
      if (t <= agoraMin) continue;
      if (bloqueios.some((iv) => t < iv[1] && iv[0] < t + dur)) continue;
      const hora = paraHora(t);
      const vagas = loja.vagas_por_horario - (ocupacao.get(hora) || 0);
      if (vagas > 0 && !livres.some((l) => l.hora === hora)) livres.push({ hora, vagas });
    }
  }
  return livres.sort((x, y) => x.hora.localeCompare(y.hora));
}

module.exports = {
  STATUS_ATIVOS,
  DIAS_ANTECEDENCIA_MAX,
  horariosLivres,
  hojeISO,
  dataValida,
  horaValida,
  paraMin,
  somarDias,
};
