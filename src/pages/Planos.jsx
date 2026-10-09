import React, { useEffect } from 'react';

// Página pública de contratação do Dellyvery (1º ano).
// O conteúdo (landing + checkout Pix) vive em public/planos/index.html
// e é exibido em tela cheia aqui, preservando 1:1 TV, modal e mobile.
export default function Planos() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'Dellyvery — Planos e contratação';
    return () => { document.title = prev; };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0c0a09' }}>
      <iframe
        title="Dellyvery — Planos e contratação"
        src="/planos/"
        style={{ width: '100%', height: '100dvh', border: 0, display: 'block' }}
        allow="clipboard-write"
      />
    </div>
  );
}
