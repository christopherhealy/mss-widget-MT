// qa-server.js
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3020;
const ROOT = __dirname;  // /.../testform/logger or /.../testform/qa — wherever you put it

// util: make sure file exists with header
function ensureCsv(pth, headerCols) {
  if (!fs.existsSync(pth)) {
    fs.writeFileSync(pth, headerCols.join(',') + '\n');
  }
}
function csvQuote(v) {
  if (v === undefined || v === null) return '';
  const s = String(v).replace(/"/g, '""').replace(/\r?\n/g, ' ');
  return `"${s}"`;
}

const server = http.createServer((req, res) => {
  // simple health
  if (req.method === 'GET' && req.url.startsWith('/health')) {
    res.writeHead(200, {'Content-Type':'text/plain'});
    res.end('ok');
    return;
  }

  // expose existing QA log (helpful for report.html)
  if (req.method === 'GET' && req.url.startsWith('/qa-log')) {
    // you can serve the latest, but we’ll just serve the main one
    const logFile = path.join(ROOT, 'qa-log.csv');
    if (!fs.existsSync(logFile)) {
      res.writeHead(404, {'Content-Type':'text/plain'});
      res.end('no qa log yet');
      return;
    }
    res.writeHead(200, {
      'Content-Type':'text/csv',
      'Access-Control-Allow-Origin':'*'
    });
    fs.createReadStream(logFile).pipe(res);
    return;
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // collect body
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    // /qa-log  → test case results
    if (req.method === 'POST' && req.url.split('?')[0] === '/qa-log') {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch {}
      const file = path.join(ROOT, 'qa-log.csv');

      // columns for QA runs
      const cols = ['timestamp','component','stepId','result'];
      ensureCsv(file, cols);

      // data.rows is an array of {stepId, result}
      const ts = new Date().toISOString();
      const component = data.component || '';
      const rows = Array.isArray(data.rows) ? data.rows : [];

      const lines = rows.map(r => {
        return [
          csvQuote(ts),
          csvQuote(component),
          csvQuote(r.stepId || ''),
          csvQuote(r.result || '')
        ].join(',');
      }).join('\n') + '\n';

      fs.appendFile(file, lines, err => {
        if (err) {
          res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({ok:false,error:'write failed'}));
          return;
        }
        res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({ok:true}));
      });
      return;
    }

    // /qa-ticket → NEW: store tickets in qa-tickets.csv
    if (req.method === 'POST' && req.url.split('?')[0] === '/qa-ticket') {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch {}

      const file = path.join(ROOT, 'qa-tickets.csv');
      // columns for tickets
      const cols = [
        'timestamp',
        'tester',
        'component',
        'stepId',
        'stepText',
        'severity',
        'steps',
        'expected',
        'actual',
        'notes'
      ];
      ensureCsv(file, cols);

      const line = [
        csvQuote(new Date().toISOString()),
        csvQuote(data.tester),
        csvQuote(data.component),
        csvQuote(data.stepId),
        csvQuote(data.stepText),
        csvQuote(data.severity),
        csvQuote(data.steps),
        csvQuote(data.expected),
        csvQuote(data.actual),
        csvQuote(data.notes)
      ].join(',') + '\n';

      fs.appendFile(file, line, err => {
        if (err) {
          res.writeHead(500, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({ok:false,error:'write failed'}));
          return;
        }
        res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({ok:true, file:'qa-tickets.csv'}));
      });
      return;
    }

    // fallback
    res.writeHead(404, {'Content-Type':'text/plain','Access-Control-Allow-Origin':'*'});
    res.end('Not found');
  });
});

server.listen(PORT, () => {
  console.log(`✅ QA Logger running on http://localhost:${PORT}/qa-log  (health: /health)`);
  console.log(`✅ QA Tickets at http://localhost:${PORT}/qa-ticket`);
});