// DELLVERY 3 — CSS de impressão do flyer (fonte única; testável).
// Objetivo: UMA folha A4 retrato, só o flyer, sem resto da página,
// sem depender de escala manual do navegador, com margem segura no QR.

export const FLYER_PRINT_CSS = `
@page { size: A4 portrait; margin: 0; }
@media print {
  body * { visibility: hidden; }
  .fly-print, .fly-print * { visibility: visible; }
  .fly-print {
    position: absolute; left: 0; top: 0; width: 210mm; height: 297mm;
    max-width: none; margin: 0; padding: 12mm; box-sizing: border-box;
    page-break-inside: avoid; break-inside: avoid;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: #fff;
  }
  .fly-print img { max-width: 100%; }
  .fly-print-img { max-height: 265mm; object-fit: contain; }
  .no-print { display: none !important; }
}
`;
