import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('📦 Bundling Vapi SDK for browser...');

build({
  entryPoints: [join(__dirname, '../node_modules/@vapi-ai/web/dist/vapi.js')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'VapiSDK',
  outfile: join(__dirname, '../public/js/vapi.bundle.js'),
  minify: false, // Keep readable for debugging
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  logLevel: 'info'
})
  .then(() => {
    console.log('✅ Vapi SDK bundled successfully to public/js/vapi.bundle.js');
    console.log('   The SDK is available as window.VapiSDK.default');
  })
  .catch((error) => {
    console.error('❌ Bundle failed:', error);
    process.exit(1);
  });
