// @ts-nocheck
const bcrypt = require('bcryptjs');
bcrypt.hash('admin123', 10).then(h => {
  require('fs').writeFileSync('/tmp/admin_hash.txt', h);
  console.log('Written hash to /tmp/admin_hash.txt');
  console.log('Hash:', h);
  bcrypt.compare('admin123', h).then(r => console.log('Verify:', r));
});
