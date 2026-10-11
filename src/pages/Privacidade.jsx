import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

// MINUTA — conteúdo inicial pendente de revisão jurídica.
// Não constitui política definitiva; revisar antes de publicar externamente.
// PrivacidadeContent é reutilizado no modal do /cadastro (sem desmontar o
// formulário); a página abaixo preserva a rota pública.
export function PrivacidadeContent({ showNotice = true }) {
  return (
    <>
      {showNotice && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 mb-4 text-sm text-amber-800">
          Minuta em revisão — este texto é provisório e precisa de validação jurídica antes de uso externo.
        </div>
      )}
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-bold text-foreground">Política de Privacidade</h1>
        <p className="text-sm text-muted-foreground">Última atualização: outubro de 2026.</p>
        <section className="space-y-2 text-sm text-foreground">
          <h2 className="font-heading font-semibold">1. Dados que coletamos</h2>
          <p className="text-muted-foreground">Na página de cadastro, coletamos nome, documentos (CNPJ/CPF quando informados), contatos (telefone e e-mail), dados da empresa e endereço, além do serviço de interesse e observações fornecidas por você.</p>
        </section>
        <section className="space-y-2 text-sm text-foreground">
          <h2 className="font-heading font-semibold">2. Finalidade</h2>
          <p className="text-muted-foreground">Os dados são usados exclusivamente para contato comercial e elaboração de proposta ou contrato, conforme consentimento concedido no envio do cadastro.</p>
        </section>
        <section className="space-y-2 text-sm text-foreground">
          <h2 className="font-heading font-semibold">3. Compartilhamento</h2>
          <p className="text-muted-foreground">Não compartilhamos seus dados com terceiros para fins de marketing. O acesso é restrito à equipe administrativa da Automatiza Solução.</p>
        </section>
        <section className="space-y-2 text-sm text-foreground">
          <h2 className="font-heading font-semibold">4. Seus direitos (LGPD)</h2>
          <p className="text-muted-foreground">Você pode solicitar a qualquer momento a confirmação, correção ou eliminação dos seus dados pelos canais oficiais de contato.</p>
        </section>
        <section className="space-y-2 text-sm text-foreground">
          <h2 className="font-heading font-semibold">5. Segurança</h2>
          <p className="text-muted-foreground">Aplicamos controles de acesso por perfil e não solicitamos senhas, dados bancários ou pagamentos nesta página.</p>
        </section>
      </div>
    </>
  );
}

export default function Privacidade() {
  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-2xl border border-border bg-card p-6">
          <PrivacidadeContent />
          <Button asChild variant="outline" className="mt-4">
            <Link to="/cadastro"><ArrowLeft className="h-4 w-4" /> Voltar ao cadastro</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
