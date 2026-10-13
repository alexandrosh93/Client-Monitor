import fs from 'node:fs';
import path from 'node:path';

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  throw new Error('Usage: node scripts/extract-erp-catalog.mjs <source-index.html> <output.mjs>');
}

const source = fs.readFileSync(sourcePath, 'utf8');
const sectionsMatch = source.match(/const sections=(\[.*?\]);\s*const MODULE_SECTIONS=/s);
const modulesMatch = source.match(/const MODULE_SECTIONS=(\[.*?\]);\s*const /s);
if (!sectionsMatch || !modulesMatch) throw new Error('ERP Discovery catalog constants were not found.');

const sections = JSON.parse(sectionsMatch[1]);
const moduleSections = JSON.parse(modulesMatch[1]);
const output = [
  '// Generated from ERPDiscoveryWeb/index.html. Do not edit by hand.',
  `export const ERP_DISCOVERY_SECTIONS = ${JSON.stringify(sections)};`,
  `export const ERP_DISCOVERY_MODULE_SECTIONS = ${JSON.stringify(moduleSections)};`,
  'export const ERP_DISCOVERY_CATALOG = { sections: ERP_DISCOVERY_SECTIONS, moduleSections: ERP_DISCOVERY_MODULE_SECTIONS };',
  '',
].join('\n');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Wrote ${sections.length} sections and ${moduleSections.length} module sections to ${outputPath}`);
