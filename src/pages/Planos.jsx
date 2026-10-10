import React, { useEffect } from 'react';

// Página pública de planos do Dellyvery (captação de interessados).
// O conteúdo vive em public/planos/index.html e é exibido em tela cheia
// aqui. Sem checkout ou cobrança: os CTAs levam a /cadastro.
export default function Planos() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'Dellyvery — Planos';
    return () => { document.title = prev; };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0c0a09' }}>
      <iframe
        title="Dellyvery — Planos"
        src="/planos/index.html"
        style={{ width: '100%', height: '100dvh', border: 0, display: 'block' }}
      />
    </div>
  );
}
