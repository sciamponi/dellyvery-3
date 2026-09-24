import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import {
  UtensilsCrossed, Bell, Zap, Shield, ShoppingBag,
  Smartphone, ChevronDown, ArrowRight, Check, Store, Clock, TrendingUp
} from 'lucide-react';

const benefits = [
  { icon: ShoppingBag, title: 'Cardápio digital', desc: 'Monte seu cardápio com fotos, categorias e adicionais. Clientes pedem direto pelo link.' },
  { icon: Bell, title: 'Pedidos em tempo real', desc: 'Receba pedidos instantaneamente com som e notificação. Fila de produção organizada.' },
  { icon: TrendingUp, title: 'Gestão completa', desc: 'Acompanhe faturamento, produtos mais vendidos e tempo médio de preparo.' },
  { icon: Smartphone, title: '100% responsivo', desc: 'Funciona em qualquer dispositivo. Seus clientes pedem pelo celular sem instalar nada.' },
  { icon: Zap, title: 'Delivery integrado', desc: 'Zonas de entrega, taxas e tempos por bairro. Tudo configurável em minutos.' },
  { icon: Shield, title: 'Dados seguros', desc: 'Isolamento total entre empresas. Suas informações e as de seus clientes protegidas.' },
];

const steps = [
  { num: '01', title: 'Crie seu restaurante', desc: 'Configure nome, contato e identidade visual em um wizard guiado.' },
  { num: '02', title: 'Monte seu cardápio', desc: 'Adicione categorias, produtos, fotos e preços. Defina zonas de entrega.' },
  { num: '03', title: 'Receba pedidos', desc: 'Compartilhe o link do cardápio. Receba pedidos e gerencie em tempo real.' },
];

const faqs = [
  { q: 'Preciso instalar algo?', a: 'Não. A plataforma DELLYVERY funciona direto do navegador. Seus clientes acessam o cardápio por um link, sem baixar nenhum aplicativo.' },
  { q: 'Como funciona o delivery?', a: 'Você define zonas de entrega com taxas e tempos estimados por bairro. O cliente escolhe a zona ao finalizar o pedido.' },
  { q: 'Posso usar no celular?', a: 'Sim. O sistema é 100% responsivo e funciona perfeitamente em celulares, tablets e computadores.' },
  { q: 'Quanto custa?', a: 'Comece com 7 dias grátis, sem cartão de crédito. Escolha o plano que cabe no seu negócio depois.' },
  { q: 'Funciona para qualquer tipo de restaurante?', a: 'Sim. Hamburguerias, pizzarias, lanchonetes, restaurantes e qualquer estabelecimento que aceite pedidos online.' },
];

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-5 text-left"
      >
        <span className="font-semibold text-foreground pr-4">{q}</span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="pb-5 text-muted-foreground leading-relaxed">{a}</p>}
    </div>
  );
}

export default function Landing() {
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    base44.entities.Plan.filter({ active: true }, 'sort_order').then(setPlans).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-background font-body">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-heading text-lg font-bold text-primary-foreground">D</div>
            <span className="font-heading text-lg font-bold text-foreground">DELLYVERY</span>
          </Link>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#beneficios" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Benefícios</a>
            <a href="#planos" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Planos</a>
            <a href="#como-funciona" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Como funciona</a>
            <a href="#faq" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-2">
                      <Button asChild className="bg-primary hover:bg-primary/90">
              <Link to="/login">Entrar</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-2 md:py-28">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
              <Zap className="h-4 w-4" /> Sem instalação • Sem cartão
            </div>
            <h1 className="font-heading text-4xl font-bold leading-tight text-foreground md:text-5xl lg:text-6xl">
              Pedidos online<br />
              <span className="text-primary">sem complicação</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-md">
              Transforme seu restaurante em uma máquina de vendas. Cardápio digital, gestão de pedidos e delivery — tudo em um só lugar.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="bg-primary hover:bg-primary/90">
                <Link to="/criar-restaurante">Criar restaurante grátis <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/dashboard">Ver demonstração</Link>
              </Button>
            </div>
            <div className="flex items-center gap-6 pt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-green-600" /> 7 dias grátis</span>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-green-600" /> Sem cartão</span>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-green-600" /> Sem complicação</span>
            </div>
          </div>
          <div className="relative">
            <div className="overflow-hidden rounded-3xl shadow-2xl">
              <Image
                src="https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&q=80"
                fittingType="fill"
                className="aspect-[4/3] w-full"
                alt="Hambúrguer artesanal"
              />
            </div>
            <div className="absolute -bottom-4 -left-4 flex items-center gap-3 rounded-2xl bg-card p-4 shadow-xl border border-border">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-100">
                <Store className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Pedidos hoje</p>
                <p className="text-xs text-muted-foreground">Em tempo real</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pain points */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid gap-8 md:grid-cols-3">
            {[
              { icon: Clock, title: 'Anotando em papel?', desc: 'Pedidos se perdem, erros de anotação e falta de organização.' },
              { icon: UtensilsCrossed, title: 'Cardápio desatualizado?', desc: 'Clientes ligam para saber o cardápio e preços. Tempo perdido.' },
              { icon: Smartphone, title: 'Sem presença online?', desc: 'Seus clientes estão no celular. Você não está.' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-50">
                  <item.icon className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-foreground">{item.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section id="beneficios" className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="font-heading text-3xl font-bold text-foreground md:text-4xl">Tudo que você precisa</h2>
          <p className="mt-3 text-muted-foreground max-w-2xl mx-auto">Uma plataforma completa para gerir seu restaurante do pedido à entrega.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {benefits.map((b, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-6 hover:shadow-lg transition-shadow">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
                <b.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-heading font-semibold text-foreground mb-2">{b.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{b.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="como-funciona" className="bg-card border-y border-border">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <div className="text-center mb-12">
            <h2 className="font-heading text-3xl font-bold text-foreground md:text-4xl">Comece em 3 passos</h2>
            <p className="mt-3 text-muted-foreground">Do zero ao primeiro pedido em minutos.</p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {steps.map((s, i) => (
              <div key={i} className="relative text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary font-heading text-xl font-bold text-primary-foreground mb-4">
                  {s.num}
                </div>
                <h3 className="font-heading text-lg font-semibold text-foreground mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90">
              <Link to="/criar-restaurante">Criar meu restaurante agora <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="planos" className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="font-heading text-3xl font-bold text-foreground md:text-4xl">Planos simples e transparentes</h2>
          <p className="mt-3 text-muted-foreground">Comece grátis por 7 dias. Sem cartão de crédito.</p>
        </div>
        {plans.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">Carregando planos...</div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {plans.map(p => (
              <div key={p.id} className={`relative rounded-2xl border bg-card p-6 flex flex-col ${p.is_popular ? 'border-primary shadow-lg lg:scale-105' : 'border-border'}`}>
                {p.is_popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">Popular</div>}
                <h3 className="font-heading text-lg font-bold text-foreground">{p.name}</h3>
                <p className="mt-2"><span className="font-heading text-3xl font-bold text-foreground">R$ {p.price}</span><span className="text-sm text-muted-foreground">/mês</span></p>
                <ul className="mt-4 space-y-2 flex-1">
                  {p.features?.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" /> {f}
                    </li>
                  ))}
                </ul>
                <Button asChild className={`mt-6 w-full ${p.is_popular ? 'bg-primary hover:bg-primary/90' : ''}`} variant={p.is_popular ? 'default' : 'outline'}>
                  <Link to="/criar-restaurante">Assinar</Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="font-heading text-3xl font-bold text-foreground md:text-4xl">Perguntas frequentes</h2>
        </div>
        <div>
          {faqs.map((f, i) => <FaqItem key={i} {...f} />)}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <div className="grid gap-8 md:grid-cols-4">
            <div className="md:col-span-1">
              <Link to="/" className="flex items-center gap-2 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-heading text-sm font-bold text-primary-foreground">D</div>
                <span className="font-heading font-bold text-foreground">DELLYVERY</span>
              </Link>
              <p className="text-sm text-muted-foreground">Pedidos online • Controle completo</p>
              <p className="text-xs text-muted-foreground mt-2">por Automatiza Solução</p>
            </div>
            <div>
              <h4 className="font-heading font-semibold text-foreground text-sm mb-3">Produto</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#beneficios" className="hover:text-foreground">Benefícios</a></li>
                <li><a href="#como-funciona" className="hover:text-foreground">Como funciona</a></li>
                <li><Link to="/criar-restaurante" className="hover:text-foreground">Criar restaurante</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-heading font-semibold text-foreground text-sm mb-3">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground">LGPD</a></li>
                <li><a href="#" className="hover:text-foreground">Privacidade</a></li>
                <li><a href="#" className="hover:text-foreground">Termos</a></li>
                <li><a href="#" className="hover:text-foreground">Reembolso</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-heading font-semibold text-foreground text-sm mb-3">Contato</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>contato@haoburgao.com.br</li>
                <li>haoburgao.com.br</li>
              </ul>
            </div>
          </div>
          <div className="mt-10 border-t border-border pt-6 text-center">
            <p className="text-xs text-muted-foreground">© 2026 Automatiza Solução. DELLYVERY é um produto Automatiza.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}