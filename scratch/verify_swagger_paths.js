import fs from 'fs';

const raw = fs.readFileSync('./swagger-output.json', 'utf8');
const doc = JSON.parse(raw);

console.log('--- ALL SWAGGER PATHS ---');
Object.keys(doc.paths).forEach(p => {
  const methods = Object.keys(doc.paths[p]).join(', ').toUpperCase();
  const tags = doc.paths[p][Object.keys(doc.paths[p])[0]]?.tags?.join(', ') || '';
  console.log(`${methods.padEnd(8)} ${p.padEnd(35)} [${tags}]`);
});
