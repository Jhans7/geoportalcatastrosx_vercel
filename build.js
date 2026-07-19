// ============================================================
// Script de build para Vercel
// Genera config.js a partir de variables de entorno
// ============================================================

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('ERROR: Las variables SUPABASE_URL y SUPABASE_KEY deben estar definidas en Vercel.');
    process.exit(1);
}

const templatePath = path.join(__dirname, 'config.template.js');
const outputPath = path.join(__dirname, 'config.js');

let template = fs.readFileSync(templatePath, 'utf8');
template = template.replace('__SUPABASE_URL__', SUPABASE_URL);
template = template.replace('__SUPABASE_KEY__', SUPABASE_KEY);

fs.writeFileSync(outputPath, template, 'utf8');
console.log('config.js generado correctamente desde variables de entorno.');
