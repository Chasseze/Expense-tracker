const http = require('http');
const url = 'http://localhost:3000/api/status';

function check() {
  http.get(url, (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
      try {
        const obj = JSON.parse(data);
        console.log(JSON.stringify(obj, null, 2));
        process.exit(0);
      } catch (e) {
        console.error('Invalid JSON response:', data);
        process.exit(2);
      }
    });
  }).on('error', (err) => {
    console.error('request failed:', err.message);
    process.exit(1);
  });
}

check();
