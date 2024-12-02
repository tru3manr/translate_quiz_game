const http = require('http');
setInterval(() => {
  http.get(`http://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
}, 280000);
