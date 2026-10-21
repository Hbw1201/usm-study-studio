import {copyFile,mkdir} from "node:fs/promises";
const destination=new URL("../public/vendor/",import.meta.url);
await mkdir(destination,{recursive:true});
// Serve the PDF worker as a static file so Vite never injects browser-only HMR into it.
await copyFile(new URL("../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",import.meta.url),new URL("pdf.worker.min.mjs",destination));
