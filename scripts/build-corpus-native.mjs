import {build} from '../packages/zotero-addon/node_modules/esbuild/lib/main.js';
await build({
  stdin:{contents:'export { readFullPdfGeometry } from "./fullPdf";',resolveDir:process.cwd()+'/packages/zotero-addon/src/modules',loader:'ts'},
  bundle:true,format:'iife',globalName:'CorpusModules',outfile:'.cache/corpus-audit/native-bundle.js',
});
