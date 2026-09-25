import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { createCustomer as sbCreateCustomer, onlyDigits as sbOnlyDigits, isDuplicateCustomer } from '@/api/customers';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Upload, FileText, X, Check } from 'lucide-react';

const FIELDS = [
  { id: 'ignore', label: 'Ignorar coluna' },
  { id: 'name', label: 'Nome *' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'phone', label: 'Telefone' },
  { id: 'email', label: 'Email' },
  { id: 'address', label: 'Endereço' },
  { id: 'neighborhood', label: 'Bairro' },
  { id: 'city', label: 'Cidade' },
  { id: 'zip_code', label: 'CEP' },
  { id: 'notes', label: 'Observações' },
];

const HEADER_ALIASES = {
  nome: 'name', nomes: 'name', name: 'name', cliente: 'name',
  whatsapp: 'whatsapp', zap: 'whatsapp', celular: 'whatsapp',
  telefone: 'phone', tel: 'phone', fone: 'phone', phone: 'phone',
  email: 'email', 'e-mail': 'email',
  endereco: 'address', endereço: 'address', rua: 'address', address: 'address',
  bairro: 'neighborhood', neighborhood: 'neighborhood',
  cidade: 'city', city: 'city', municipio: 'city', município: 'city',
  cep: 'zip_code', zip: 'zip_code', 'cep/zip': 'zip_code',
  obs: 'notes', observacoes: 'notes', observações: 'notes', notes: 'notes',
};

function normHeader(h) {
  return (h || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function splitLine(line, delimiter) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return { headers: [], rows: [], error: 'Arquivo vazio ou sem linhas de dados.' };
  const delimiter = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const headers = splitLine(lines[0], delimiter);
  const rows = lines.slice(1).map(l => splitLine(l, delimiter));
  return { headers, rows, delimiter, error: null };
}

function onlyDigits(v) {
  return (v || '').replace(/\D/g, '');
}

export default function CustomerImportDialog({ open, onOpenChange, companyId, useSupabase, existingCustomers = [], onImported }) {
  const { toast } = useToast();
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const reset = () => {
    setFileName('');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = (v) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      toast({ title: 'Arquivo inválido', description: 'Selecione um arquivo .csv', variant: 'destructive' });
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (parsed.error) {
        toast({ title: 'Erro ao ler CSV', description: parsed.error, variant: 'destructive' });
        return;
      }
      const auto = {};
      parsed.headers.forEach((h, i) => {
        const alias = HEADER_ALIASES[normHeader(h).replace(/[-_]/g, '')] || HEADER_ALIASES[normHeader(h)];
        auto[i] = alias && FIELDS.some(f => f.id === alias) ? alias : 'ignore';
      });
      // Garante que "nome" seja mapeado se houver coluna óbvia não detectada
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(auto);
      setResult(null);
    } catch (err) {
      toast({ title: 'Erro ao ler arquivo', description: err?.message, variant: 'destructive' });
    }
  };

  const known = {
    whatsapp: new Set(existingCustomers.map(c => sbOnlyDigits(c.whatsapp)).filter(Boolean)),
    phone: new Set(existingCustomers.map(c => sbOnlyDigits(c.phone)).filter(Boolean)),
    email: new Set(existingCustomers.map(c => (c.email || '').trim().toLowerCase()).filter(Boolean)),
  };

  const preview = rows.map((cells, idx) => {
    const obj = {};
    Object.entries(mapping).forEach(([colIdx, field]) => {
      if (field !== 'ignore') obj[field] = (cells[Number(colIdx)] || '').trim();
    });
    const problems = [];
    if (!obj.name) problems.push('Nome é obrigatório');
    const w = onlyDigits(obj.whatsapp);
    const p = onlyDigits(obj.phone);
    const em = (obj.email || '').trim().toLowerCase();
    const dup = (w && known.whatsapp.has(w)) || (p && known.phone.has(p)) || (em && known.email.has(em));
    return { idx, obj, problems, duplicate: !!dup && problems.length === 0 };
  });

  const valid = preview.filter(r => r.problems.length === 0 && !r.duplicate);
  const invalid = preview.filter(r => r.problems.length > 0);
  const duplicates = preview.filter(r => r.duplicate);
  const hasNameMapped = Object.values(mapping).includes('name');

  const handleImport = async () => {
    if (!hasNameMapped) {
      toast({ title: 'Mapeamento incompleto', description: 'Mapeie uma coluna para Nome.', variant: 'destructive' });
      return;
    }
    setImporting(true);
    let created = 0;
    const errors = [];
    for (const r of valid) {
      try {
        // FASE 5.3: mesma dedupe; criação via adapter (RLS) quando Supabase.
        if (isDuplicateCustomer(existingCustomers, r.obj)) continue;
        const payload = {
          company_id: companyId,
          name: r.obj.name,
          whatsapp: r.obj.whatsapp || '',
          phone: r.obj.phone || '',
          email: r.obj.email || '',
          address: r.obj.address || '',
          neighborhood: r.obj.neighborhood || '',
          city: r.obj.city || '',
          zip_code: r.obj.zip_code || '',
          notes: r.obj.notes || '',
          tags: [],
          is_favorite: false,
          is_blocked: false,
        };
        if (useSupabase) await sbCreateCustomer(supabase, companyId, payload);
        else {
          await base44.entities.Customer.create(payload);
        }
        created++;
      } catch (err) {
        errors.push(`Linha ${r.idx + 2}: ${err?.message || 'erro'}`);
      }
    }
    setImporting(false);
    setResult({ created, skipped: duplicates.length, invalid: invalid.length, errors });
    toast({ title: `${created} cliente(s) importado(s)` });
    onImported?.();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar clientes (CSV)</DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4 py-2">
            <div>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
              <Button variant="outline" onClick={() => fileRef.current?.click()} className="w-full sm:w-auto">
                <Upload className="h-4 w-4" /> {fileName || 'Selecionar arquivo CSV'}
              </Button>
              {fileName && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                  <FileText className="h-4 w-4" /> {fileName} • {rows.length} {rows.length === 1 ? 'linha' : 'linhas'}
                </p>
              )}
            </div>

            {headers.length > 0 && (
              <>
                <div className="space-y-2">
                  <Label>Mapeamento das colunas</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {headers.map((h, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{h || `(coluna ${i + 1})`}</span>
                        <Select value={mapping[i] || 'ignore'} onValueChange={v => setMapping(p => ({ ...p, [i]: v }))}>
                          <SelectTrigger className="w-36 shrink-0"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FIELDS.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-border p-3 text-sm space-y-1">
                  <p><Check className="inline h-4 w-4 text-green-600" /> {valid.length} pronto(s) para importar</p>
                  {duplicates.length > 0 && <p className="text-muted-foreground">• {duplicates.length} já cadastrado(s) — serão ignorados</p>}
                  {invalid.length > 0 && <p className="text-destructive">• {invalid.length} linha(s) inválida(s) (sem nome)</p>}
                  {!hasNameMapped && <p className="text-destructive">• Mapeie uma coluna para Nome</p>}
                </div>

                {invalid.length > 0 && (
                  <div className="max-h-32 overflow-y-auto rounded-xl border border-border p-2 text-xs text-muted-foreground">
                    {invalid.slice(0, 20).map(r => (
                      <p key={r.idx}>Linha {r.idx + 2}: {r.problems.join('; ')}</p>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2 py-4 text-sm">
            <p><Check className="inline h-4 w-4 text-green-600" /> {result.created} cliente(s) criado(s)</p>
            {result.skipped > 0 && <p className="text-muted-foreground">• {result.skipped} ignorado(s) (já cadastrados)</p>}
            {result.invalid > 0 && <p className="text-muted-foreground">• {result.invalid} linha(s) inválida(s)</p>}
            {result.errors.slice(0, 10).map((e, i) => <p key={i} className="text-destructive text-xs">{e}</p>)}
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={importing}>
                <X className="h-4 w-4" /> Cancelar
              </Button>
              <Button onClick={handleImport} disabled={importing || valid.length === 0 || !hasNameMapped}>
                {importing ? 'Importando...' : `Importar ${valid.length} cliente(s)`}
              </Button>
            </>
          ) : (
            <Button onClick={() => handleClose(false)}>Fechar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
