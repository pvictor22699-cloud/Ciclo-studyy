'use strict';
const http = require('node:http');
const { buildApp } = require('./factory');

async function main() {
  const app = await buildApp();
  const server = http.createServer(app);
  server.listen(app.config.port, () => {
    console.log(`Ciclo Study — API + front em http://localhost:${app.config.port}`);
    console.log(`  backend: ${app.config.backend}`);
    if (app.config.backend === 'memory') {
      console.log(`  aluno:     ${app.config.demo.studentEmail} / ${app.config.demo.studentPassword}`);
      console.log(`  professor: ${app.config.demo.professorEmail} / ${app.config.demo.professorPassword}`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
