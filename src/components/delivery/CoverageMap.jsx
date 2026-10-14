import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polygon, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Search, Loader2, X } from 'lucide-react';
import { searchAddresses } from '@/lib/geocode';
import { fromGeoJSON, resolveZoneForPoint, SAO_PAULO_CENTER } from '@/lib/deliveryGeo';

const fmtCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

// Cores distintas por zona (índice estável na lista recebida).
const ZONE_COLORS = ['#DC2626', '#2563EB', '#16A34A', '#9333EA', '#EA580C', '#0D9488'];

function FitInitial({ center }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], center.zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// Mapa de cobertura: entorno do restaurante, zonas desenhadas e
// verificação de endereço (mesmo critério de polígonos do servidor).
// Somente leitura: pesquisa (GET Nominatim) + ray casting local.
// Sem coordenadas da empresa no banco: geocodifica o endereço textual
// sob demanda; sem ele, parte de São Paulo e aguarda a pesquisa.
export default function CoverageMap({ zones = [], companyAddress }) {
  const { toast } = useToast();
  const [restaurant, setRestaurant] = useState(null);
  const [locatingRestaurant, setLocatingRestaurant] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [searchError, setSearchError] = useState('');
  const [picked, setPicked] = useState(null);

  const zoned = useMemo(() => {
    const list = Array.isArray(zones) ? zones : [];
    return list
      .map((z, i) => ({ zone: z, color: ZONE_COLORS[i % ZONE_COLORS.length], path: fromGeoJSON(z?.polygon) }))
      .filter((x) => x.path.length >= 3);
  }, [zones]);

  // Centro inicial: tenta o endereço da empresa uma vez (sem inventar).
  useEffect(() => {
    const q = [companyAddress?.address, companyAddress?.city].map((s) => String(s || '').trim()).filter(Boolean).join(', ');
    if (!q) return;
    let cancelled = false;
    setLocatingRestaurant(true);
    searchAddresses({ address: companyAddress.address || '', city: companyAddress.city || '' }, { limit: 1 })
      .then((found) => {
        if (!cancelled && found.length > 0) setRestaurant(found[0]);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLocatingRestaurant(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const center = restaurant
    ? { lat: restaurant.lat, lng: restaurant.lng, zoom: 14 }
    : { ...SAO_PAULO_CENTER, zoom: 12 };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchError('');
    setCandidates([]);
    try {
      const found = await searchAddresses({ address: q }, { limit: 5 });
      if (found.length === 0) {
        setSearchError('Endereço não localizado. Confira rua, número, bairro ou CEP.');
        return;
      }
      setCandidates(found);
    } catch {
      setSearchError('Falha de rede na pesquisa. Tente novamente.');
    } finally {
      setSearching(false);
    }
  };

  const check = picked ? resolveZoneForPoint(zones, { lng: picked.lng, lat: picked.lat }) : null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            placeholder="Rua, número, bairro ou CEP..."
            className="pl-9 h-10 text-sm"
            aria-label="Pesquisar endereço"
          />
        </div>
        <Button onClick={handleSearch} disabled={searching || !query.trim()} className="h-10 px-4 shrink-0">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span className="hidden sm:inline ml-1.5">Buscar</span>
        </Button>
      </div>

      {searchError && (
        <p className="text-xs text-amber-700 rounded-lg border border-amber-300 bg-amber-50 p-2.5" role="alert">
          {searchError}
        </p>
      )}
      {candidates.length > 0 && (
        <div className="rounded-xl border border-border divide-y divide-border max-h-36 overflow-y-auto">
          {candidates.map((c, i) => (
            <button
              key={`${c.lat},${c.lng},${i}`}
              type="button"
              onClick={() => { setPicked(c); setCandidates([]); }}
              className="block w-full px-3 py-2 text-left text-xs hover:bg-muted"
            >
              <span className="block truncate font-medium">{c.displayName || `${c.lat}, ${c.lng}`}</span>
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <MapContainer center={[center.lat, center.lng]} zoom={center.zoom} scrollWheelZoom className="h-[300px] sm:h-[380px] w-full z-0">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitInitial center={center} />
          {zoned.map(({ zone, color, path }) => (
            <Polygon
              key={zone.id}
              positions={[...path.map((p) => [p.lat, p.lng]), [path[0].lat, path[0].lng]]}
              pathOptions={{ color, weight: 2, fillOpacity: 0.15 }}
            >
              <Tooltip direction="top" sticky>
                {zone.name} • {fmtCurrency(zone.fee)}
                {zone.active === false ? ' (inativa)' : ''}
              </Tooltip>
            </Polygon>
          ))}
          {restaurant && (
            <CircleMarker center={[restaurant.lat, restaurant.lng]} radius={8} pathOptions={{ color: '#111827', weight: 2, fillOpacity: 0.9 }}>
              <Tooltip direction="top" sticky>Restaurante</Tooltip>
            </CircleMarker>
          )}
          {picked && (
            <CircleMarker center={[picked.lat, picked.lng]} radius={8} pathOptions={{ color: '#DC2626', weight: 2, fillOpacity: 0.9 }}>
              <Tooltip direction="top" sticky>Endereço consultado</Tooltip>
            </CircleMarker>
          )}
        </MapContainer>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#111827]" /> Restaurante{locatingRestaurant ? ' (localizando...)' : ''}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#DC2626]" /> Endereço consultado
        </span>
        {zoned.map(({ zone, color }) => (
          <span key={zone.id} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-6 rounded-sm border-2" style={{ borderColor: color, backgroundColor: `${color}26` }} />
            {zone.name} • {fmtCurrency(zone.fee)}
          </span>
        ))}
        {zoned.length === 0 && <span>Nenhuma zona com área desenhada.</span>}
      </div>

      {/* Resultado da verificação (mesmo critério do servidor) */}
      {picked && (
        <div
          className={`rounded-xl border p-3 text-sm ${check && check.zone ? 'border-green-300 bg-green-50 text-green-800' : 'border-amber-300 bg-amber-50 text-amber-800'}`}
          role="status"
        >
          {check && check.zone ? (
            <p>
              ✅ Dentro da área: <strong>{check.zone.name}</strong> — taxa {fmtCurrency(check.zone.fee)}
              {check.matches.length > 1 ? ` (sobreposição: vale a menor taxa entre ${check.matches.length} zonas)` : ''}.
              A taxa final é sempre a do servidor no pedido.
            </p>
          ) : (
            <p>⚠️ Fora das áreas atendidas. Não será possível aprovar entrega neste endereço.</p>
          )}
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setPicked(null)}>
              <X className="h-3.5 w-3.5" /> Limpar consulta
            </Button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">Mapa © OpenStreetMap. A verificação usa os mesmos polígonos do servidor.</p>
    </div>
  );
}
