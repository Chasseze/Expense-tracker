const http = require('http');

const opts = {
  hostname: 'localhost',
  port: 3000,
  path: '/dev/disable-auth',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': 2
  }
};

const req = http.request(opts, (res) => {
  let data = '';
  res.on('data', (d) => data += d);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Body:', data);
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('Request failed:', err.message);
  process.exit(2);
});

req.write('{}');
req.end();
