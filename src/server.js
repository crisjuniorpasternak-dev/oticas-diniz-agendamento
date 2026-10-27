process.env.TZ = process.env.TZ || 'America/Sao_Paulo';
const { prepararBanco } = require('./db');
const { criarApp } = require('./app');

prepararBanco().then((db) => {
  const app = criarApp(db);
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1); // HTTPS termina no proxy da hospedagem
  const porta = Number(process.env.PORT || 3000);
  app.listen(porta, () => console.log(`Óticas Diniz – Agendamentos rodando em http://localhost:${porta}`));
});
