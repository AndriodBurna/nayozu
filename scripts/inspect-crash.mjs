import fs from 'fs';

const content = fs.readFileSync('node_modules/anime-sdk/dist/index.js', 'utf8');
const lines = content.split('\n');
console.log('Lines around 5204:');
for (let i = 5195; i <= 5215; i++) {
  console.log(`${i}: ${lines[i]}`);
}
