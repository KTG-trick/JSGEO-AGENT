const net = require('node:net');

const port = Number(process.env.GEO_AGENT_DEV_PORT || 3000);
const host = '127.0.0.1';

const socket = net.createConnection({ host, port });

socket.setTimeout(800);
socket.on('connect', () => {
  socket.destroy();
  console.error(`Port ${port} is already in use. Stop the old dev server first.`);
  process.exit(1);
});
socket.on('timeout', () => {
  socket.destroy();
  process.exit(0);
});
socket.on('error', () => {
  process.exit(0);
});
